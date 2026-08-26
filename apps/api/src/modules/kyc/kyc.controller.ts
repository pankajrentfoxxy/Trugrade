import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  accountHolderNameSchema,
  bankAccountNumberSchema,
  ifscSchema,
  uuidSchema,
} from '@trugrade/contracts';
import { CurrentUser, Public, RequirePermissions, RequireRoles } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { ForbiddenError } from '../../shared/errors/domain-errors';
import { RequestContextService, type Principal } from '../../shared/db/org-scope';
import { RateLimiter, type RateLimitRule } from '../../shared/redis/redis.service';
import { ValidationError } from '../../shared/errors/domain-errors';
import { AuditService, IdentityService, type OrganizationSummary } from '../identity';
import { VendorService, type VendorReviewCaptures } from '../vendor';
import { KycService, type OnboardingSummary, type ReviewQueueItem } from './kyc.service';
import type { ConsentPurpose, ConsentState } from './internal/consent.service';
import {
  VerificationService,
  type BankAccountChangeResult,
  type VerificationOutcomeView,
} from './internal/verification.service';
import {
  DocumentService,
  type DocumentTypeRuleView,
  type UploadedBytes,
  type KycDocumentView,
} from './internal/document.service';
import {
  consentPurposeSchema,
  createLeadBodySchema,
  pennyDropBodySchema,
  recordConsentBodySchema,
  requestFixBodySchema,
  reviewDecisionBodySchema,
  replaceDocumentBodySchema,
  reviewQueueQuerySchema,
  saveStepBodySchema,
  stepCodeSchema,
  uploadDocumentBodySchema,
  verifyGstinBodySchema,
  verifyPanBodySchema,
  type CreateLeadBodyDto,
  type PennyDropBodyDto,
  type RecordConsentBodyDto,
  type RequestFixBodyDto,
  type ReviewDecisionBodyDto,
  type ReviewQueueQueryDto,
  type SaveStepBodyDto,
  type ReplaceDocumentBodyDto,
  type UploadDocumentBodyDto,
  type VerifyGstinBodyDto,
  type VerifyPanBodyDto,
} from './dto/kyc.dto';

/**
 * KYC and onboarding, over HTTP.
 *
 * Three controllers rather than one, because the three have genuinely different
 * answers to "who is allowed to call this", and a single class would have to
 * express that in per-method metadata that overrides the class's — which is
 * exactly the arrangement where one forgotten decorator opens a door:
 *
 *   - `KycReviewController` — platform staff, gated on `kyc.application.*`.
 *   - `OnboardingController` — the applicant, acting on their **own** org.
 *   - `OnboardingLeadController` — nobody yet; the lead exists before the account.
 *
 * The rule that matters most is in `ownOrgId` below: **the org id is taken from
 * the session and never from the request.** Accepting one from a path or a body
 * would mean one vendor could read another vendor's KYC by editing a URL, and
 * nothing downstream would notice — `KycService` takes an org id as an argument
 * and trusts it, as a service should. The trust boundary is here.
 */

/**
 * The applicant's own org, or a refusal.
 *
 * Platform staff have `orgId: null` — they have no application of their own, so
 * "onboard myself" is not a thing they can do. Assisted onboarding, if it is
 * ever wanted, is a reviewer route with an explicit org id and its own audit
 * trail, not this one with the guard loosened.
 */
function ownOrgId(user: Principal): string {
  if (!user.orgId) {
    throw new ForbiddenError(
      'This account is not attached to a business, so there is no application to work on.',
      { reason: 'onboarding_without_org', orgType: user.orgType },
    );
  }
  return user.orgId;
}

/** Everything a reviewer needs on one screen, assembled from four reads. */
export interface KycApplicationView {
  org: OrganizationSummary;
  onboarding: OnboardingSummary;
  /** Masked inputs only — VR-META-03: support staff never see a full value. */
  verifications: Awaited<ReturnType<KycService['verificationHistory']>>;
  /** The four RETROFIT Change 4 captures, from the vendor module's barrel. */
  captures: VendorReviewCaptures;
}

/**
 * The review screen's own payload, flat.
 *
 * A second shape rather than a projection of `KycApplicationView` because it is
 * the shape one screen asserts against, and the four captures are the reason
 * that screen exists: the retrofit added them precisely so a human would look at
 * them before approving a vendor. A reviewer who never sees the dispatch address
 * approves a vendor whose e-way bills will name the wrong origin, and correcting
 * that across their catalogue afterwards is expensive.
 */
export interface VendorReviewView extends VendorReviewCaptures {
  orgId: string;
  legalName: string;
  status: string;
  constitutionType: string | null;
}

/**
 * A payout-account change. Declared here rather than in `dto/kyc.dto.ts` because
 * it is the body of exactly one route and nothing else reads it; the shared DTO
 * file is for schemas two callers agree on.
 *
 * `accountHolderName` is the name the penny-drop is scored against, so it is
 * required and not defaulted from the org: a fuzzy match against a name the
 * client never sent would compare the bank's answer with something the applicant
 * never claimed.
 */
const changeBankAccountBodySchema = z.object({
  accountNumber: bankAccountNumberSchema,
  ifsc: ifscSchema,
  accountHolderName: accountHolderNameSchema,
  accountType: z.enum(['CURRENT', 'SAVINGS', 'CC', 'OD']).default('CURRENT'),
});

type ChangeBankAccountBodyDto = z.infer<typeof changeBankAccountBodySchema>;

/** The stepper plus what was typed into it, which is what "resume" needs. */
export interface ResumableOnboarding extends OnboardingSummary {
  /**
   * Saved answers, keyed by step code. Absent for a step never started and for a
   * COMPLETE one — completion clears the draft on purpose, because by then the
   * promoted tables are the source of truth and a stale draft is a second copy
   * of the answer that can disagree.
   */
  answers: Record<string, Record<string, unknown>>;
}

// ===========================================================================
// The review console
// ===========================================================================

@Controller('kyc')
export class KycReviewController {
  constructor(
    private readonly kyc: KycService,
    private readonly identity: IdentityService,
    private readonly vendor: VendorService,
  ) {}

  /**
   * The queue, already ordered by how close each promise is to being broken.
   *
   * No pagination: `KycService.reviewQueue` takes 200, and a queue that needs a
   * second page is a staffing incident rather than a UI problem. Adding paging
   * would let it grow quietly past the point where anyone notices.
   */
  @Get('review-queue')
  @RequirePermissions('kyc.application.read')
  reviewQueue(
    @Query(new ZodValidationPipe(reviewQueueQuerySchema)) query: ReviewQueueQueryDto,
  ): Promise<ReviewQueueItem[]> {
    return this.kyc.reviewQueue(query);
  }

  /**
   * One application, in full.
   *
   * The verification history is part of the same response rather than a second
   * call: a reviewer deciding on a GSTIN that came back MISMATCH needs to see
   * that it did, and a screen that has to fetch it separately is a screen where
   * somebody approves before it arrives.
   */
  @Get('orgs/:orgId')
  @RequirePermissions('kyc.application.read')
  async application(
    @Param('orgId', new ZodValidationPipe(uuidSchema)) orgId: string,
  ): Promise<KycApplicationView> {
    const [org, onboarding, verifications, captures] = await Promise.all([
      this.identity.getOrganization(orgId),
      this.kyc.getOnboarding(orgId),
      this.kyc.verificationHistory({ orgId }),
      this.vendor.reviewCaptures(orgId),
    ]);
    return { org, onboarding, verifications, captures };
  }

  /**
   * The same application, shaped for the review screen.
   *
   * A buyer org has no vendor tables behind it, so all four captures come back
   * `null` and the screen shows four gaps — which is honest for a screen only a
   * vendor application should reach, and better than a 404 that reads as "this
   * application does not exist".
   */
  @Get('review/:orgId')
  @RequirePermissions('kyc.application.read')
  async review(
    @Param('orgId', new ZodValidationPipe(uuidSchema)) orgId: string,
  ): Promise<VendorReviewView> {
    const [org, captures] = await Promise.all([
      this.identity.getOrganization(orgId),
      this.vendor.reviewCaptures(orgId),
    ]);
    return {
      orgId: org.id,
      legalName: org.legalName,
      status: org.status,
      constitutionType: org.constitution,
      ...captures,
    };
  }

  /**
   * Approve, reject, or send it back for more information.
   *
   * Gated on `kyc.application.approve` — the strongest of the three things this
   * one route can do — which is why requesting a *fix* is a separate route
   * below: `OPS_MANAGER` holds `kyc.application.review` and should be able to
   * chase a missing document without also being able to approve a vendor.
   *
   * The reviewer's identity comes from the session. A body-supplied reviewer id
   * would make the audit trail a suggestion.
   */
  @Post('orgs/:orgId/decision')
  @HttpCode(204)
  @RequirePermissions('kyc.application.approve')
  decide(
    @CurrentUser() user: Principal,
    @Param('orgId', new ZodValidationPipe(uuidSchema)) orgId: string,
    @Body(new ZodValidationPipe(reviewDecisionBodySchema)) body: ReviewDecisionBodyDto,
  ): Promise<void> {
    return this.kyc.decide({ orgId, reviewerId: user.userId, ...body });
  }

  /** Send one step back with a reason the applicant reads verbatim. */
  @Post('orgs/:orgId/steps/:stepKey/request-fix')
  @HttpCode(204)
  @RequirePermissions('kyc.application.review')
  requestFix(
    @CurrentUser() user: Principal,
    @Param('orgId', new ZodValidationPipe(uuidSchema)) orgId: string,
    @Param('stepKey', new ZodValidationPipe(stepCodeSchema)) stepKey: string,
    @Body(new ZodValidationPipe(requestFixBodySchema)) body: RequestFixBodyDto,
  ): Promise<void> {
    return this.kyc.requestFix(orgId, stepKey, body.blockingReason, user.userId);
  }
}

// ===========================================================================
// The applicant's own onboarding
// ===========================================================================

/**
 * Roles, not permissions, and deliberately so.
 *
 * There is no `kyc.*` permission in `ROLE_PERMISSIONS` that any vendor or buyer
 * role holds — the kyc permissions are all reviewer-side. Inventing one is not
 * an option (they are a closed union), and borrowing `identity.user.write`
 * would gate "finish my KYC" on a string that means something else. So the rule
 * here is the role itself: the people who can commit their business to terms.
 * `VENDOR_OPS` and the viewer roles are excluded on purpose — submitting KYC is
 * a legal declaration, not an operational task.
 */
@Controller('onboarding')
@RequireRoles('VENDOR_OWNER', 'VENDOR_ADMIN', 'CUSTOMER_OWNER', 'CUSTOMER_ADMIN')
export class OnboardingController {
  constructor(
    private readonly kyc: KycService,
    private readonly audit: AuditService,
    // The internal service directly, not through `KycService`. It is this
    // module's own provider and this is this module's own controller, so the
    // seam rule is not in play; adding a pass-through would only put a second
    // signature between the route and the control it invokes.
    private readonly verification: VerificationService,
    private readonly documents: DocumentService,
  ) {}

  // -------------------------------------------------------------------------
  // The stepper
  // -------------------------------------------------------------------------

  /**
   * Materialise this org's steps from the definitions.
   *
   * Idempotent, and safe to call every time the wizard mounts — which is how it
   * should be called. `initialiseSteps` is also run at registration and again
   * when the constitution changes, but the client should not have to know which
   * of those already happened to be able to save a draft.
   */
  @Post('start')
  @HttpCode(204)
  start(@CurrentUser() user: Principal): Promise<void> {
    return this.kyc.startOnboarding(ownOrgId(user));
  }

  /**
   * The steps, plus the answers already typed into them.
   *
   * `progress.resumeAt` is where the client should land: the first required step
   * that is not COMPLETE, including one a reviewer sent back. The drafts are
   * fetched only for the steps that can hold one — a COMPLETE step's draft was
   * cleared, and a NOT_STARTED step never had one — so the extra reads are
   * bounded by how far the applicant actually got.
   */
  @Get('steps')
  async steps(@CurrentUser() user: Principal): Promise<ResumableOnboarding> {
    const orgId = ownOrgId(user);
    const summary = await this.kyc.getOnboarding(orgId);

    const inFlight = summary.progress.steps.filter(
      (s) => s.status !== 'NOT_STARTED' && s.status !== 'COMPLETE',
    );
    const drafts = await Promise.all(
      inFlight.map(
        async (s) => [s.stepCode, await this.kyc.getStepDraft(orgId, s.stepCode)] as const,
      ),
    );

    return {
      ...summary,
      answers: Object.fromEntries(
        drafts.filter((d): d is [string, Record<string, unknown>] => d[1] !== null),
      ),
    };
  }

  /** Save-and-finish-later. Validates shape only; a half-filled form is normal. */
  @Put('steps/:stepKey')
  @HttpCode(204)
  saveStep(
    @CurrentUser() user: Principal,
    @Param('stepKey', new ZodValidationPipe(stepCodeSchema)) stepKey: string,
    @Body(new ZodValidationPipe(saveStepBodySchema)) body: SaveStepBodyDto,
  ): Promise<void> {
    return this.kyc.saveStepDraft(ownOrgId(user), stepKey, body.answers, body.completionPct);
  }

  /**
   * Mark a step done.
   *
   * `completeStep` takes a *promotion* — the writes that move the draft into the
   * tables that own it — and clears `draft_json` afterwards, on the principle
   * that the promoted tables then become the single source of truth. No module
   * has registered a promotion for a step code yet, so the only honest thing
   * this layer can do is make sure the answers survive that clearing: the audit
   * log is append-only, redacts PAN and account numbers on the way in, and is
   * written inside the same transaction, so a failed completion leaves neither
   * a completed step nor an orphan record of one.
   *
   * ponytail: an audit row is a record, not a queryable profile. When a step's
   * real destination exists (`gst_profile` for STATUTORY, `vendor_capability`
   * for CAPABILITY), the upgrade is that module exporting a promotion function
   * through its barrel and this handler passing it instead — not a bigger
   * controller.
   */
  @Post('steps/:stepKey/complete')
  @HttpCode(204)
  completeStep(
    @CurrentUser() user: Principal,
    @Param('stepKey', new ZodValidationPipe(stepCodeSchema)) stepKey: string,
  ): Promise<void> {
    const orgId = ownOrgId(user);
    return this.kyc.completeStep(orgId, stepKey, async (answers) => {
      await this.audit.record({
        action: 'kyc.onboarding.step_answers',
        entityType: 'onboarding_progress',
        entityId: `${orgId}:${stepKey}`,
        after: answers,
        actorUserId: user.userId,
        actorOrgId: orgId,
      });
    });
  }

  /**
   * Submit for review, which starts the SLA clock.
   *
   * Returns the due date rather than 204: the applicant is owed the promise in
   * the same breath they make the submission, and a screen that says only
   * "submitted" is the one that generates the "when will I hear back" ticket.
   * An incomplete application comes back as a 409 naming the outstanding steps.
   */
  @Post('submit')
  submit(@CurrentUser() user: Principal): Promise<{ slaDueAt: Date }> {
    return this.kyc.submitForReview(ownOrgId(user), user.userId);
  }

  // -------------------------------------------------------------------------
  // Consent (DPDP Act 2023)
  // -------------------------------------------------------------------------

  /**
   * One purpose, one affirmative act. There is no "grant all" and there is no
   * default on `granted`, so nothing here can record a consent nobody gave.
   */
  @Post('consent')
  @HttpCode(204)
  recordConsent(
    @CurrentUser() user: Principal,
    @Body(new ZodValidationPipe(recordConsentBodySchema)) body: RecordConsentBodyDto,
  ): Promise<void> {
    return this.kyc.recordConsent({ orgId: ownOrgId(user), userId: user.userId, ...body });
  }

  /**
   * The caller's own consents, scoped to them rather than to the org.
   *
   * Deliberately a different scope from the `consents` array on `GET steps`,
   * which is the org-wide view a reviewer also sees. This one backs a
   * preferences screen, and the person who ticked a box is the person who must
   * be able to untick it — showing them a colleague's grant they cannot
   * withdraw would be worse than showing them nothing.
   */
  @Get('consent')
  consents(@CurrentUser() user: Principal): Promise<ConsentState[]> {
    return this.kyc.consentState(ownOrgId(user), user.userId);
  }

  /**
   * Withdrawal is a timestamp, never a delete — the grant it withdraws is the
   * evidence consent ever existed. An essential purpose refuses with a message
   * pointing at account closure, because the alternative is opting out into a
   * broken account.
   */
  @Delete('consent/:purpose')
  @HttpCode(204)
  withdrawConsent(
    @CurrentUser() user: Principal,
    @Param('purpose', new ZodValidationPipe(consentPurposeSchema)) purpose: ConsentPurpose,
  ): Promise<void> {
    return this.kyc.withdrawConsent(ownOrgId(user), purpose, user.userId);
  }

  // -------------------------------------------------------------------------
  // Verification — PROVIDER_ERROR is our problem, FAIL is theirs
  // -------------------------------------------------------------------------

  /**
   * All three verifications answer with a `VerificationOutcomeView` and force a
   * 200 rather than Nest's default 201. They do write a `verification_check`
   * row, but nothing addressable is created and there is nowhere to point a
   * `Location` at — the meaningful answer is the outcome, and a PROVIDER_ERROR
   * that reports "201 Created" would be actively misleading about what happened.
   *
   * Rate limiting is `VerificationService`'s own, against the durable history:
   * five consuming attempts per input per day, a cooldown after three, and a
   * fraud flag on a third attempt with a third different value. It has to live
   * there rather than here because a provider outage must not consume an
   * applicant's budget, and only the service knows which attempts consumed one.
   */
  @Post('verify/gstin')
  @HttpCode(200)
  verifyGstin(
    @CurrentUser() user: Principal,
    @Body(new ZodValidationPipe(verifyGstinBodySchema)) body: VerifyGstinBodyDto,
  ): Promise<VerificationOutcomeView> {
    return this.kyc.verifyGstin(
      body.gstin,
      { orgId: ownOrgId(user) },
      {
        expectedLegalName: body.expectedLegalName,
        expectedPan: body.expectedPan,
        triggeredBy: user.userId,
      },
    );
  }

  @Post('verify/pan')
  @HttpCode(200)
  verifyPan(
    @CurrentUser() user: Principal,
    @Body(new ZodValidationPipe(verifyPanBodySchema)) body: VerifyPanBodyDto,
  ): Promise<VerificationOutcomeView> {
    return this.kyc.verifyPan(
      body.pan,
      { orgId: ownOrgId(user) },
      {
        expectedName: body.expectedName,
        entityType: body.entityType,
        triggeredBy: user.userId,
      },
    );
  }

  @Post('verify/bank')
  @HttpCode(200)
  pennyDrop(
    @CurrentUser() user: Principal,
    @Body(new ZodValidationPipe(pennyDropBodySchema)) body: PennyDropBodyDto,
  ): Promise<VerificationOutcomeView> {
    return this.kyc.pennyDrop(
      body.accountNumber,
      body.ifsc,
      body.expectedName,
      { orgId: ownOrgId(user) },
      user.userId,
    );
  }

  /**
   * Change the account we pay into. PHASE_01: penny-drop, freeze, owner alert.
   *
   * Separate from `verify/bank` above and not a flag on it, because the two are
   * different acts. `verify/bank` is "does this account exist and is it mine" and
   * is meant to be called from a form as the applicant types; this one commits
   * the answer and starts a payout freeze. Folding the freeze into the check
   * would mean a mistyped-then-corrected account number holds a vendor's payouts
   * for a day.
   *
   * 200 rather than 201 for the same reason the verification routes force one:
   * the meaningful answer is the outcome, and a penny-drop that came back
   * MISMATCH created nothing to point a `Location` at.
   */
  @Post('bank-account')
  @HttpCode(200)
  changeBankAccount(
    @CurrentUser() user: Principal,
    @Body(new ZodValidationPipe(changeBankAccountBodySchema)) body: ChangeBankAccountBodyDto,
  ): Promise<BankAccountChangeResult> {
    return this.verification.changeBankAccount({
      orgId: ownOrgId(user),
      // From the session, never the body. This lands on the `verification_check`
      // row as `triggered_by`, which is the record of who redirected the money —
      // and an actor id a caller may supply is an actor id an attacker will.
      actorUserId: user.userId,
      ...body,
    });
  }

  /** The applicant's own attempts, masked exactly as the reviewer sees them. */
  @Get('verifications')
  verifications(@CurrentUser() user: Principal): ReturnType<KycService['verificationHistory']> {
    return this.kyc.verificationHistory({ orgId: ownOrgId(user) });
  }

  // -------------------------------------------------------------------------
  // Documents — buyer step 5, vendor step 6
  // -------------------------------------------------------------------------

  /**
   * What this applicant has to supply, and the rules each one is held to.
   *
   * The wizard needs this before it can render the step at all: the list is
   * `kyc.document_type_rule` data, not a constant, so ops can add a document
   * type without a release. A hard-coded list in the client is a list that goes
   * stale silently and asks a vendor for a document we stopped needing.
   */
  @Get('documents/types')
  documentTypes(): Promise<DocumentTypeRuleView[]> {
    return this.documents.types();
  }

  /** Everything this org has uploaded, with each one's review state. */
  @Get('documents')
  listDocuments(@CurrentUser() user: Principal): Promise<KycDocumentView[]> {
    return this.documents.list(ownOrgId(user));
  }

  /**
   * Upload one document.
   *
   * `multipart/form-data`, one file per request rather than an array, because
   * the step shows per-file progress and a per-file error. A batch endpoint
   * would have to invent a partial-success shape, and "three of your five
   * uploaded" is a worse thing to render than five independent rows.
   *
   * Everything that decides whether these bytes are acceptable — the magic-byte
   * sniff, the size cap, the EXIF strip, the document-age rule — lives in
   * `DocumentService`, and none of it trusts anything the client said. The
   * declared MIME type and `Content-Length` reach the service only so a
   * contradiction with the actual bytes can be detected.
   */
  @Post('documents')
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser() user: Principal,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(uploadDocumentBodySchema)) body: UploadDocumentBodyDto,
  ): Promise<KycDocumentView> {
    return this.documents.upload({
      orgId: ownOrgId(user),
      uploadedBy: user.userId,
      docType: body.docType,
      documentDate: parseDocumentDate(body.documentDate),
      file: requireFile(file),
    });
  }

  /**
   * Replace the bytes behind a document, keeping its id.
   *
   * Keeping the id is the point: a credit application's bank statement or a
   * vendor certification already references this row, and delete-then-upload
   * would silently break the reference while looking like it worked.
   */
  @Put('documents/:documentId')
  replaceDocument(
    @CurrentUser() user: Principal,
    @Param('documentId', new ZodValidationPipe(uuidSchema)) documentId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(replaceDocumentBodySchema)) body: ReplaceDocumentBodyDto,
  ): Promise<KycDocumentView> {
    return this.documents.replace({
      orgId: ownOrgId(user),
      uploadedBy: user.userId,
      documentId,
      documentDate: parseDocumentDate(body.documentDate),
      file: requireFile(file),
    });
  }

  @Delete('documents/:documentId')
  @HttpCode(204)
  removeDocument(
    @CurrentUser() user: Principal,
    @Param('documentId', new ZodValidationPipe(uuidSchema)) documentId: string,
  ): Promise<void> {
    return this.documents.remove(ownOrgId(user), documentId, user.userId);
  }

  /**
   * A short-lived signed URL for the applicant's own document.
   *
   * The bytes never travel through the API. `file_key` is an internal S3 path
   * and must not reach a client — it is the kind of identifier that leaks an
   * org slug into a URL somebody then pastes into a support ticket.
   */
  @Get('documents/:documentId/url')
  documentUrl(
    @CurrentUser() user: Principal,
    @Param('documentId', new ZodValidationPipe(uuidSchema)) documentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.documents.downloadUrl(ownOrgId(user), documentId);
  }
}

/**
 * A multipart request with no file part is a client bug, not a validation
 * failure the applicant can act on — but it still has to say something true
 * rather than throw a TypeError three frames down inside the service.
 */
function requireFile(file: Express.Multer.File | undefined): UploadedBytes {
  if (!file) {
    throw new ValidationError('No file was attached. Choose a file and try again.', {
      file: 'Attach the file you want to upload.',
    });
  }
  return {
    bytes: file.buffer,
    declaredMime: file.mimetype,
    filename: file.originalname,
    declaredSize: file.size,
  };
}

/**
 * The shape is already checked by the DTO; this only turns it into a Date, and
 * refuses a date that parses but is not real — 2026-02-31 passes the regex.
 */
function parseDocumentDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
    throw new ValidationError(`${value} is not a real date.`, {
      documentDate: 'Enter the date printed on the document, as YYYY-MM-DD.',
    });
  }
  return parsed;
}

// ===========================================================================
// The lead — captured before there is anything to authenticate
// ===========================================================================

/**
 * Ten a day from one address is a busy co-working space; a hundred is a script.
 * The lead table is the funnel's denominator and feeds a human callback list, so
 * the cost of junk in it is somebody's afternoon.
 */
const LEAD_LIMIT: RateLimitRule = { name: 'kyc-lead', limit: 10, windowSeconds: 86_400 };

/**
 * Its own class purely so `@Public()` is the whole story.
 *
 * Hanging this route off `OnboardingController` would leave that class's
 * `@RequireRoles` in force — `PermissionsGuard` reads role metadata off the
 * class when the handler has none, and would reject an anonymous caller after
 * `AuthGuard` had already let them through. Two classes, two postures, nothing
 * to remember.
 */
@Controller('onboarding')
export class OnboardingLeadController {
  constructor(
    private readonly kyc: KycService,
    private readonly limiter: RateLimiter,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * The first form submit, before the organisation exists.
   *
   * This row is deliberately created ahead of any account: it is what captures
   * the people who never finish, and without it the funnel has no denominator.
   * A blacklisted mobile or email is refused here with a message that names
   * neither — telling someone which identifier is blocked tells them which one
   * to change.
   */
  @Post('leads')
  @Public()
  async createLead(
    @Body(new ZodValidationPipe(createLeadBodySchema)) body: CreateLeadBodyDto,
  ): Promise<{ leadId: string; mobile: string }> {
    const context = this.ctx.get();
    await this.limiter.consume(LEAD_LIMIT, context?.ip ?? 'unknown');
    return this.kyc.createLead({ ...body, ip: context?.ip, userAgent: context?.userAgent });
  }
}
