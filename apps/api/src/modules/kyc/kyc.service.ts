import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normaliseEmail, normaliseGstin, normaliseMobile } from '@trugrade/contracts';
import { PrismaService } from '../../shared/db/prisma.service';
import { ClockPort } from '../../shared/clock';
import { EventBus } from '../../shared/events';
import { AuditService } from '../identity';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/domain-errors';
import {
  OnboardingService,
  type ProgressView,
  type StepDefinitionView,
} from './internal/onboarding.service';
import { VerificationService, type VerificationOutcomeView } from './internal/verification.service';
import { ConsentService, type ConsentPurpose, type ConsentState } from './internal/consent.service';

/**
 * One hashing function for every identifier the blacklist screens, so a value
 * hashed at registration and the same value hashed at approval agree.
 */
export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value.toUpperCase().trim()).digest('hex');
}

/** 48 working hours for a vendor, 24 for a buyer. */
const REVIEW_SLA_HOURS: Record<string, number> = { VENDOR: 48, BUYER: 24, INTERNAL: 24 };

/**
 * What a reviewer decided, in the reviewer's own words.
 *
 * `decide()` refuses a rejection with no notes because "the applicant sees it,
 * and 'rejected' tells them nothing they can act on" — and until this existed
 * nothing showed it to them. A REJECTED organisation could sign in, be told it
 * was not approved, and have no way to learn why. Rendered verbatim, never
 * summarised: the sentence was written to be read by this applicant.
 */
export interface ReviewDecision {
  /** APPROVE / REJECT / REQUEST_INFO, as `kyc_review` stores it. */
  decision: string;
  notes: string | null;
  reasonCodes: string[];
  decidedAt: Date;
}

export interface OnboardingSummary {
  orgId: string;
  status: string;
  progress: ProgressView;
  consents: ConsentState[];
  slaDueAt: Date | null;
  slaBreached: boolean;
  /** The latest decision, or null while the application is still with us. */
  decision: ReviewDecision | null;
}

export interface ReviewQueueItem {
  orgId: string;
  legalName: string;
  orgType: string;
  status: string;
  submittedAt: Date | null;
  slaDueAt: Date | null;
  /** Negative once breached. Ops sorts on this. */
  hoursRemaining: number | null;
  slaBreached: boolean;
}

/**
 * The public interface of the `kyc` module.
 */
export interface IKycService {
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;
  getOnboarding(orgId: string): Promise<OnboardingSummary>;
  /** True once every required step is COMPLETE and the org is VERIFIED. */
  isOnboardingComplete(orgId: string): Promise<boolean>;
}

@Injectable()
export class KycService implements IKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly onboarding: OnboardingService,
    private readonly verification: VerificationService,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    const steps = await this.prisma.db.onboarding_step_definition.count({
      where: { is_active: true },
    });
    return steps >= 12
      ? { ok: true }
      : {
          ok: false,
          detail: `Only ${steps} onboarding steps defined — the stepper would be incomplete.`,
        };
  }

  // -------------------------------------------------------------------------
  // Leads — captured before the org exists, so abandonment is measurable
  // -------------------------------------------------------------------------

  /**
   * One row per signup attempt, created on the *first* form submit.
   *
   * Deliberately before `organization` exists: this is what captures the people
   * who never finish, and without it the funnel has no denominator.
   */
  async createLead(input: {
    intendedOrgType: 'VENDOR' | 'BUYER';
    companyName: string;
    contactName: string;
    mobile: string;
    email?: string;
    city?: string;
    stateCode?: string;
    source?: string;
    utm?: { source?: string; medium?: string; campaign?: string };
    deviceFingerprint?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ leadId: string; mobile: string }> {
    const mobile = normaliseMobile(input.mobile);
    if (!mobile) {
      throw new ValidationError('Enter a valid 10-digit Indian mobile number starting 6–9.', {
        mobile: 'Enter a valid 10-digit Indian mobile number starting 6–9.',
      });
    }

    await this.assertNotBlacklisted([
      { entityType: 'MOBILE', value: mobile },
      ...(input.email ? [{ entityType: 'EMAIL', value: normaliseEmail(input.email) ?? '' }] : []),
    ]);

    const lead = await this.prisma.db.registration_lead.create({
      data: {
        intended_org_type: input.intendedOrgType,
        company_name_raw: input.companyName,
        contact_name: input.contactName,
        mobile,
        email: input.email ? normaliseEmail(input.email) : null,
        city: input.city ?? null,
        state_code: input.stateCode ?? null,
        source: input.source ?? 'ORGANIC',
        utm_source: input.utm?.source ?? null,
        utm_medium: input.utm?.medium ?? null,
        utm_campaign: input.utm?.campaign ?? null,
        device_fingerprint: input.deviceFingerprint ?? null,
        ip: input.ip ?? null,
        user_agent: input.userAgent ?? null,
        status: 'NEW',
      },
    });

    return { leadId: lead.id, mobile };
  }

  async markLeadStatus(leadId: string, status: string, abandonedAtStep?: string): Promise<void> {
    await this.prisma.db.registration_lead.update({
      where: { id: leadId },
      data: { status, abandoned_at_step: abandonedAtStep ?? null },
    });
  }

  // -------------------------------------------------------------------------
  // Blacklist — checked at registration AND again at approval
  // -------------------------------------------------------------------------

  /**
   * The gap between the two checks is exactly where a value gets changed, which
   * is why it runs twice rather than once.
   */
  async assertNotBlacklisted(
    values: Array<{ entityType: string; value: string }>,
    subject: { leadId?: string; orgId?: string } = {},
    stage: 'REGISTRATION' | 'APPROVAL' | 'PERIODIC' = 'REGISTRATION',
  ): Promise<void> {
    return this.assertHashesNotBlacklisted(
      values
        .filter((v) => v.value)
        .map((v) => ({ entityType: v.entityType, hash: hashIdentifier(v.value) })),
      subject,
      stage,
    );
  }

  /**
   * The hash-only path.
   *
   * PAN and bank account numbers are encrypted at the column — we hold
   * `pan_enc` and `pan_hash`, never a readable PAN. Screening them means
   * comparing the stored hash against the blacklist's, not decrypting a value
   * back into memory to re-hash it. Decrypting PII to run a lookup is exactly the
   * habit that puts it in a log.
   */
  async assertHashesNotBlacklisted(
    values: Array<{ entityType: string; hash: string }>,
    subject: { leadId?: string; orgId?: string } = {},
    stage: 'REGISTRATION' | 'APPROVAL' | 'PERIODIC' = 'REGISTRATION',
  ): Promise<void> {
    for (const { entityType, hash } of values) {
      if (!hash) continue;

      const entry = await this.prisma.db.blacklist_entry.findFirst({
        where: { entity_type: entityType, value_hash: hash },
      });
      if (!entry) continue;

      if (subject.leadId || subject.orgId) {
        await this.prisma.db.blacklist_hit.create({
          data: {
            lead_id: subject.leadId ?? null,
            org_id: subject.orgId ?? null,
            entity_type: entityType,
            value_hash: hash,
            blacklist_entry_id: entry.id,
            stage,
          },
        });
      }

      // Deliberately vague to the applicant, specific in the log. Telling someone
      // which of their identifiers is blacklisted tells them which one to change.
      throw new ForbiddenError(
        'We are not able to open an account with these details. If you believe this is a mistake, contact support@trugrade.in and quote your mobile number.',
        { reason: 'blacklist_hit', entityType, entryId: entry.id },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Onboarding
  // -------------------------------------------------------------------------

  /** The step list itself, for a client that has no org yet. */
  listStepDefinitions(orgType: 'VENDOR' | 'BUYER'): Promise<StepDefinitionView[]> {
    return this.onboarding.listDefinitions(orgType);
  }

  async startOnboarding(orgId: string): Promise<void> {
    await this.onboarding.initialiseSteps(orgId);
  }

  async getOnboarding(orgId: string): Promise<OnboardingSummary> {
    const [org, progress, consents, review] = await Promise.all([
      this.prisma.db.organization.findUnique({ where: { id: orgId } }),
      this.onboarding.getProgress(orgId),
      this.consent.currentState(orgId),
      this.prisma.db.kyc_review.findFirst({
        where: { org_id: orgId },
        orderBy: { decided_at: 'desc' },
      }),
    ]);
    if (!org) throw new NotFoundError('organisation');

    return {
      orgId,
      status: org.status,
      progress,
      consents,
      decision: review
        ? {
            decision: review.decision,
            notes: review.notes,
            reasonCodes: review.reason_codes,
            decidedAt: review.decided_at,
          }
        : null,
      slaDueAt: org.review_sla_due_at,
      slaBreached: Boolean(
        org.review_sla_due_at &&
          org.review_sla_due_at.getTime() < this.clock.nowMs() &&
          ['KYC_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'].includes(org.status),
      ),
    };
  }

  async isOnboardingComplete(orgId: string): Promise<boolean> {
    const org = await this.prisma.db.organization.findUnique({ where: { id: orgId } });
    return org?.status === 'VERIFIED';
  }

  saveStepDraft(
    orgId: string,
    stepCode: string,
    draft: Record<string, unknown>,
    completionPct: number,
  ): Promise<void> {
    return this.onboarding.saveDraft(orgId, stepCode, draft, completionPct);
  }

  getStepDraft(orgId: string, stepCode: string): Promise<Record<string, unknown> | null> {
    return this.onboarding.getDraft(orgId, stepCode);
  }

  completeStep(
    orgId: string,
    stepCode: string,
    promote: (draft: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    return this.onboarding.completeStep(orgId, stepCode, promote);
  }

  /**
   * Submit for review. Sets the SLA clock, because an SLA nobody can see is an
   * SLA nobody meets.
   */
  async submitForReview(orgId: string, actorUserId: string): Promise<{ slaDueAt: Date }> {
    const progress = await this.onboarding.getProgress(orgId);
    if (!progress.isSubmittable) {
      const outstanding = progress.steps
        .filter((s) => s.isRequired && s.status !== 'COMPLETE')
        .map((s) => s.title);
      throw new ConflictError(
        `Finish ${outstanding.length === 1 ? 'this step' : 'these steps'} first: ${outstanding.join(', ')}.`,
        { outstanding },
      );
    }

    const org = await this.prisma.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundError('organisation');

    const now = this.clock.now();
    const slaDueAt = this.addWorkingHours(now, REVIEW_SLA_HOURS[org.org_type] ?? 48);

    await this.prisma.db.organization.update({
      where: { id: orgId },
      data: { status: 'KYC_SUBMITTED', submitted_for_review_at: now, review_sla_due_at: slaDueAt },
    });

    await this.audit.record({
      action: 'kyc.submitted_for_review',
      entityType: 'organization',
      entityId: orgId,
      after: { slaDueAt },
      actorUserId,
      actorOrgId: orgId,
    });

    return { slaDueAt };
  }

  /**
   * Working hours, not wall-clock hours: a vendor who submits at 6pm on Friday is
   * not owed a decision by Sunday afternoon, and pretending otherwise makes every
   * weekend look like an SLA breach.
   *
   * **"48 working hours" means 48 hours across working DAYS, not 48 hours of
   * desk time.** The distinction is worth stating because the other reading —
   * counting only 10:00–18:00 — turns 48 into six calendar days, which is not
   * what anyone means by a two-day SLA, and it is what the first version did.
   *
   * ponytail: Sundays off, no holiday calendar. Add one when the ops team
   * observes holidays that actually matter to the queue.
   */
  private addWorkingHours(from: Date, hours: number): Date {
    const cursor = new Date(from);
    let remaining = hours;

    while (remaining > 0) {
      cursor.setUTCHours(cursor.getUTCHours() + 1);
      // IST is UTC+5:30, so a UTC Saturday evening is already Sunday in Delhi.
      const ist = new Date(cursor.getTime() + 5.5 * 3_600_000);
      if (ist.getUTCDay() !== 0) remaining -= 1;
    }
    return cursor;
  }

  /** The ops queue, oldest-against-SLA first. Breaches sort to the top. */
  async reviewQueue(
    filter: { orgType?: string; status?: string } = {},
  ): Promise<ReviewQueueItem[]> {
    const rows = await this.prisma.db.organization.findMany({
      where: {
        status: filter.status
          ? { equals: filter.status as never }
          : { in: ['KYC_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'] },
        ...(filter.orgType ? { org_type: filter.orgType as never } : {}),
      },
      orderBy: { review_sla_due_at: 'asc' },
      take: 200,
    });

    const now = this.clock.nowMs();
    return rows.map((o) => ({
      orgId: o.id,
      legalName: o.legal_name,
      orgType: o.org_type,
      status: o.status,
      submittedAt: o.submitted_for_review_at,
      slaDueAt: o.review_sla_due_at,
      hoursRemaining: o.review_sla_due_at
        ? Math.round(((o.review_sla_due_at.getTime() - now) / 3_600_000) * 10) / 10
        : null,
      slaBreached: Boolean(o.review_sla_due_at && o.review_sla_due_at.getTime() < now),
    }));
  }

  /**
   * A named person decides. Recorded with who, when and why.
   *
   * Approval re-runs the blacklist check — the gap since registration is exactly
   * where a value gets changed.
   */
  async decide(input: {
    orgId: string;
    reviewerId: string;
    decision: 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
    reasonCodes?: string[];
    notes?: string;
  }): Promise<void> {
    const org = await this.prisma.db.organization.findUnique({ where: { id: input.orgId } });
    if (!org) throw new NotFoundError('organisation');

    if (input.decision !== 'APPROVED' && !input.notes?.trim()) {
      throw new ValidationError(
        'Give a reason. The applicant sees it, and "rejected" tells them nothing they can act on.',
        { notes: 'A specific reason is required.' },
      );
    }

    if (input.decision === 'APPROVED') {
      await this.recheckBlacklistAtApproval(input.orgId);
    }

    // The stored vocabulary is imperative (APPROVE / REJECT / REQUEST_INFO); the
    // domain speaks in outcomes. Map at the boundary rather than bending either.
    const storedDecision =
      input.decision === 'APPROVED'
        ? 'APPROVE'
        : input.decision === 'REJECTED'
          ? 'REJECT'
          : 'REQUEST_INFO';

    const nextStatus =
      input.decision === 'APPROVED'
        ? 'VERIFIED'
        : input.decision === 'REJECTED'
          ? 'REJECTED'
          : 'INFO_REQUESTED';

    await this.prisma.runInTransaction(async () => {
      await this.prisma.db.kyc_review.create({
        data: {
          org_id: input.orgId,
          reviewer_id: input.reviewerId,
          decision: storedDecision,
          reason_codes: input.reasonCodes ?? [],
          notes: input.notes ?? null,
          decided_at: this.clock.now(),
        },
      });

      await this.prisma.db.organization.update({
        where: { id: input.orgId },
        data: {
          status: nextStatus as never,
          ...(input.decision === 'APPROVED'
            ? { onboarding_completed_at: this.clock.now(), review_sla_due_at: null }
            : {}),
        },
      });

      // Inside the transaction, because `publish` only writes an outbox row.
      // A vendor whose approval rolls back must not end up holding a working
      // DeviceSure licence, and calling the QC platform inline here would either
      // hold this transaction open across a network hop or do exactly that.
      if (input.decision === 'APPROVED') {
        if (org.org_type === 'VENDOR') {
          await this.bus.publish('vendor.verified', {
            orgId: input.orgId,
            verifiedBy: input.reviewerId,
          });
        } else if (org.org_type === 'BUYER') {
          await this.bus.publish('buyer.verified', {
            orgId: input.orgId,
            verifiedBy: input.reviewerId,
          });
        }
      }
    });

    await this.audit.record({
      action: `kyc.review.${input.decision.toLowerCase()}`,
      entityType: 'organization',
      entityId: input.orgId,
      before: { status: org.status },
      after: { status: nextStatus, reasonCodes: input.reasonCodes, notes: input.notes },
      actorUserId: input.reviewerId,
      actorOrgId: input.orgId,
    });
  }

  /** Re-screen every identifier we hold, at the moment of approval. */
  private async recheckBlacklistAtApproval(orgId: string): Promise<void> {
    const [gst, pan, bank, contacts] = await Promise.all([
      this.prisma.db.gst_profile.findMany({ where: { org_id: orgId }, select: { gstin: true } }),
      // pan_hash, not the PAN. The plaintext is encrypted and stays that way.
      this.prisma.db.pan_record.findMany({ where: { org_id: orgId }, select: { pan_hash: true } }),
      this.prisma.db.bank_account.findMany({
        where: { org_id: orgId },
        select: { account_number_last4: true, ifsc: true },
      }),
      this.prisma.db.org_contact.findMany({
        where: { org_id: orgId },
        select: { mobile: true, email: true },
      }),
    ]);

    await this.assertHashesNotBlacklisted(
      [
        ...gst.map((g) => ({ entityType: 'GSTIN', hash: hashIdentifier(g.gstin) })),
        ...pan.map((p) => ({ entityType: 'PAN', hash: p.pan_hash })),
        // The blacklist holds full account numbers; the last four plus the IFSC
        // is what we can screen without decrypting, and it is what a
        // blacklisting operator records for exactly this reason.
        ...bank.map((b) => ({
          entityType: 'BANK_ACCOUNT_LAST4',
          hash: hashIdentifier(`${b.account_number_last4}:${b.ifsc}`),
        })),
        ...contacts.flatMap((c) => [
          ...(c.mobile ? [{ entityType: 'MOBILE', hash: hashIdentifier(c.mobile) }] : []),
          ...(c.email ? [{ entityType: 'EMAIL', hash: hashIdentifier(String(c.email)) }] : []),
        ]),
      ],
      { orgId },
      'APPROVAL',
    );
  }

  requestFix(orgId: string, stepCode: string, reason: string, reviewerId: string): Promise<void> {
    return this.onboarding.requestFix(orgId, stepCode, reason, reviewerId);
  }

  // -------------------------------------------------------------------------
  // Pass-throughs to the internal services
  // -------------------------------------------------------------------------

  verifyGstin(
    gstin: string,
    subject: { orgId?: string | null; leadId?: string | null },
    opts?: { expectedLegalName?: string; expectedPan?: string; triggeredBy?: string | null },
  ): Promise<VerificationOutcomeView> {
    return this.verification.verifyGstin(normaliseGstin(gstin) ?? gstin, subject, opts);
  }

  verifyPan(
    pan: string,
    subject: { orgId?: string | null; leadId?: string | null },
    opts?: { expectedName?: string; entityType?: string; triggeredBy?: string | null },
  ): Promise<VerificationOutcomeView> {
    return this.verification.verifyPan(pan, subject, opts);
  }

  pennyDrop(
    accountNumber: string,
    ifsc: string,
    expectedName: string,
    subject: { orgId?: string | null; leadId?: string | null },
    triggeredBy?: string | null,
  ): Promise<VerificationOutcomeView> {
    return this.verification.pennyDrop(accountNumber, ifsc, expectedName, subject, triggeredBy);
  }

  verificationHistory(subject: {
    orgId?: string | null;
    leadId?: string | null;
  }): ReturnType<VerificationService['history']> {
    return this.verification.history(subject);
  }

  recordConsent(input: Parameters<ConsentService['grant']>[0]): Promise<void> {
    return this.consent.grant(input);
  }

  withdrawConsent(orgId: string, purpose: ConsentPurpose, userId?: string | null): Promise<void> {
    return this.consent.withdraw(orgId, purpose, userId);
  }

  consentState(orgId: string, userId?: string | null): Promise<ConsentState[]> {
    return this.consent.currentState(orgId, userId);
  }

  maySend(input: Parameters<ConsentService['maySend']>[0]): Promise<boolean> {
    return this.consent.maySend(input);
  }

  funnel(orgIds: readonly string[]): ReturnType<OnboardingService['funnel']> {
    return this.onboarding.funnel(orgIds);
  }
}
