import { z } from 'zod';
import {
  accountHolderNameSchema,
  bankAccountNumberSchema,
  emailSchema,
  fullNameSchema,
  gstinSchema,
  ifscSchema,
  mobileSchema,
  panSchema,
} from '@trugrade/contracts';
import { CONSENT_PURPOSES } from '../internal/consent.service';

/**
 * Request shapes for the KYC review console and the applicant's own onboarding.
 *
 * Two rules govern the enums below, both learned the hard way elsewhere in this
 * repo:
 *
 *   1. **The vocabulary is the database's, not a phase document's.** Every enum
 *      here was read off a live `CREATE TYPE` or `CHECK` in
 *      `20260826000000_baseline_core`. `KycService.reviewQueue` passes its filter
 *      straight into `org_type` / `status` with an `as never` cast, so a value
 *      that only exists in prose arrives as an enum-cast 500 rather than a 422
 *      anybody can read.
 *   2. **Narrower than the column where the wider value is meaningless for this
 *      path.** The queue filter accepts only the three statuses that can *be* in
 *      a queue; `?status=VERIFIED` is not a queue, it is a report, and it should
 *      say so rather than quietly return nothing.
 *
 * Shared primitives come from `@trugrade/contracts` — a second copy that agrees
 * today is a second copy that drifts, and these are the ones with check digits.
 */

// ---------------------------------------------------------------------------
// Vocabulary mirrors
// ---------------------------------------------------------------------------

/**
 * `public.org_type`, spelled the way the column spells it.
 *
 * Note `INTERNAL`, not `PLATFORM`: the domain calls TrueTech's own org PLATFORM
 * and `IdentityService` translates at its boundary, but this value is a queue
 * filter that reaches the enum cast untranslated.
 */
export const dbOrgTypeSchema = z.enum(['VENDOR', 'BUYER', 'INTERNAL']);

/** The three `org_status` values an application can hold while it waits. */
export const reviewableStatusSchema = z.enum(['KYC_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED']);

/**
 * The reviewer's three outcomes, in the domain's vocabulary.
 *
 * `KycService.decide` maps these onto the imperative words the table stores
 * (`APPROVE` / `REJECT` / `REQUEST_INFO`). The mapping stays there; restating it
 * here would give the wire a fourth spelling of the same three ideas.
 */
export const reviewDecisionSchema = z.enum(['APPROVED', 'REJECTED', 'INFO_REQUESTED']);

/**
 * A step code is data, not a type.
 *
 * The whole point of the generic stepper is that adding, reordering or retiring
 * a step is a row in `kyc.onboarding_step_definition` rather than a release — so
 * enumerating the known codes here would put the release back. A shape check is
 * all a transport can honestly assert; an unknown code is a 404 from the
 * service, which is the right answer for a step this org does not have.
 */
export const stepCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'That is not a step code.');

export const consentPurposeSchema = z.enum(CONSENT_PURPOSES);

/** GST state code — `CHAR(2)` on the lead, and always two digits. */
const stateCodeSchema = z.string().regex(/^\d{2}$/, 'Enter the two-digit state code.');

// ---------------------------------------------------------------------------
// Reviewer requests
// ---------------------------------------------------------------------------

export const reviewQueueQuerySchema = z.object({
  orgType: dbOrgTypeSchema.optional(),
  status: reviewableStatusSchema.optional(),
});

/**
 * `notes` is optional *here* on purpose: it is mandatory for a rejection and for
 * a request for information, and `KycService.decide` is where that rule lives.
 * Duplicating it as a zod refinement would give two places to change when the
 * rule does, and the service's message ("the applicant sees it, and 'rejected'
 * tells them nothing they can act on") is the one worth showing.
 */
export const reviewDecisionBodySchema = z.object({
  decision: reviewDecisionSchema,
  reasonCodes: z.array(z.string().min(1).max(64)).max(10).default([]),
  notes: z.string().max(2_000).optional(),
});

/** The reviewer's note is read verbatim by the applicant, hence the length floor. */
export const requestFixBodySchema = z.object({
  blockingReason: z.string().min(15).max(1_000),
});

// ---------------------------------------------------------------------------
// The applicant's own onboarding
// ---------------------------------------------------------------------------

/**
 * A step's answers, as typed so far.
 *
 * Deliberately unvalidated beyond "it is an object": a draft is a half-filled
 * form, that is its normal state, and rejecting one for being incomplete would
 * defeat save-and-finish-later. The size ceiling is Express's body limit, and
 * the per-field rules belong to whichever module promotes the step.
 */
export const saveStepBodySchema = z.object({
  answers: z.record(z.unknown()),
  completionPct: z.number().int().min(0).max(100),
});

/**
 * `granted` has no default, mirroring the column.
 *
 * CP e-Comm r.4(9) requires explicit affirmative action, so there is no shape of
 * this request in which consent is assumed — a client that omits the field gets
 * a 422, never a silent yes.
 */
export const recordConsentBodySchema = z.object({
  purpose: consentPurposeSchema,
  granted: z.boolean(),
  /** Which notice they read. "They agreed" is not a record of what they agreed to. */
  noticeVersion: z.string().min(1).max(40),
  noticeLanguage: z.enum(['en', 'hi']),
  channel: z.enum(['WEB', 'MOBILE', 'API', 'PAPER']).default('WEB'),
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * The expected values are optional because they are a *match*, not a filter: a
 * GSTIN that resolves but resolves to a different legal name is a MISMATCH the
 * applicant can act on, and sending nothing to compare against collapses that
 * into a bare PASS.
 */
export const verifyGstinBodySchema = z.object({
  gstin: gstinSchema,
  expectedLegalName: z.string().min(1).max(200).optional(),
  expectedPan: panSchema.optional(),
});

export const verifyPanBodySchema = z.object({
  pan: panSchema,
  expectedName: fullNameSchema.optional(),
  /** The PAN's fourth character encodes this; sending it lets the check disagree. */
  entityType: z.string().min(1).max(30).optional(),
});

export const pennyDropBodySchema = z.object({
  accountNumber: bankAccountNumberSchema,
  ifsc: ifscSchema,
  /** The name the bank returns is compared against this one, fuzzily. */
  expectedName: accountHolderNameSchema,
});

// ---------------------------------------------------------------------------
// Leads — the funnel's denominator, captured before any account exists
// ---------------------------------------------------------------------------

export const createLeadBodySchema = z.object({
  intendedOrgType: z.enum(['VENDOR', 'BUYER']),
  companyName: z.string().min(2).max(200),
  contactName: fullNameSchema,
  mobile: mobileSchema,
  email: emailSchema.optional(),
  city: z.string().min(1).max(80).optional(),
  stateCode: stateCodeSchema.optional(),
  source: z.string().min(1).max(40).optional(),
  utm: z
    .object({
      source: z.string().max(80).optional(),
      medium: z.string().max(80).optional(),
      campaign: z.string().max(120).optional(),
    })
    .optional(),
  deviceFingerprint: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * The form fields that ride alongside a multipart upload.
 *
 * Multipart, so every value arrives as a string — hence `documentDate` being
 * coerced from `YYYY-MM-DD` here rather than typed as a date. The column is a
 * DATE, and parsing "2026-01-15" as an instant would shift it a day in either
 * direction depending on the server's timezone, which for an age check measured
 * in days is a real off-by-one.
 *
 * There is deliberately **no `orgId` field, on this or any other document
 * request**. The org comes from the session. A body that can name an org is a
 * body that can name somebody else's, and the difference between the two is one
 * forgotten comparison in one handler.
 *
 * `docType` is a shape check, not an enum, for the same reason `stepCodeSchema`
 * is: `kyc.document_type_rule` is data so ops can add a document type without a
 * release, and an unknown code comes back from the service as a 422 that names
 * what is wrong with it.
 */
export const uploadDocumentBodySchema = z.object({
  docType: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'That is not a document type.'),
  documentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date on the document as YYYY-MM-DD.')
    .optional(),
});
export type UploadDocumentBodyDto = z.infer<typeof uploadDocumentBodySchema>;

/** Replacing keeps the document id and therefore its type; only the date can move. */
export const replaceDocumentBodySchema = uploadDocumentBodySchema.omit({ docType: true });
export type ReplaceDocumentBodyDto = z.infer<typeof replaceDocumentBodySchema>;

export type ReviewQueueQueryDto = z.infer<typeof reviewQueueQuerySchema>;
export type ReviewDecisionBodyDto = z.infer<typeof reviewDecisionBodySchema>;
export type RequestFixBodyDto = z.infer<typeof requestFixBodySchema>;
export type SaveStepBodyDto = z.infer<typeof saveStepBodySchema>;
export type RecordConsentBodyDto = z.infer<typeof recordConsentBodySchema>;
export type VerifyGstinBodyDto = z.infer<typeof verifyGstinBodySchema>;
export type VerifyPanBodyDto = z.infer<typeof verifyPanBodySchema>;
export type PennyDropBodyDto = z.infer<typeof pennyDropBodySchema>;
export type CreateLeadBodyDto = z.infer<typeof createLeadBodySchema>;
