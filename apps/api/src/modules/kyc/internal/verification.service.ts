import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  isValidGstin,
  panFromGstin,
  stateCodeFromGstin,
  normaliseGstin,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import {
  BankVerificationPort,
  GstinVerificationPort,
  PanVerificationPort,
  type VerificationOutcome,
  type VerificationResult,
} from '../../../shared/adapters/ports';
import {
  ConflictError,
  RateLimitedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';

/**
 * External verification.
 *
 * The distinction this whole file exists to preserve:
 *
 *   **PROVIDER_ERROR is our problem. FAIL is the applicant's.**
 *
 * Conflating them is the single most common onboarding-UX failure in Indian KYC
 * flows — the GST portal is down, the applicant sees "verification failed", and
 * they re-upload documents that were never the problem. So a provider error
 * retries automatically, does **not** consume an attempt, and says "nothing for
 * you to do"; a genuine failure consumes an attempt and names what to fix.
 *
 * PHASE_01 Task 5. Retry policy, which the source document leaves open and this
 * pins down: 5 attempts per input hash per 24 h, a 15-minute cooldown after 3,
 * and a fraud flag at attempt 3 with three *different* values — "a third attempt
 * on the same GSTIN with different values is a signal, not a coincidence".
 */

const MAX_ATTEMPTS_PER_DAY = 5;
const COOLDOWN_AFTER_ATTEMPTS = 3;
const COOLDOWN_MINUTES = 15;
const FRAUD_FLAG_DISTINCT_VALUES = 3;

/** Exponential backoff for automatic provider retries. Never consumes an attempt. */
export const PROVIDER_RETRY_SCHEDULE_SECONDS = [30, 120, 600, 3600];

export type CheckType =
  | 'GSTIN'
  | 'PAN'
  | 'PAN_GSTIN_LINK'
  | 'BANK_PENNY_DROP'
  | 'IFSC'
  | 'UDYAM'
  | 'CIN'
  | 'AADHAAR_ESIGN'
  | 'BLACKLIST';

export interface VerificationSubject {
  orgId?: string | null;
  /** A lead can be verified before any org exists. Hence the schema fix. */
  leadId?: string | null;
}

export interface VerificationOutcomeView {
  id: string;
  checkType: CheckType;
  outcome: VerificationOutcome;
  /** What the applicant reads. Different for every outcome, by design. */
  message: string;
  /** Present on PASS/MISMATCH: the resolved entity that makes a tick trustworthy. */
  resolved?: Record<string, unknown>;
  matchScore?: number;
  attemptNo: number;
  attemptsRemaining: number;
  /** True when the caller should retry later rather than ask the user for anything. */
  willRetryAutomatically: boolean;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly gstin: GstinVerificationPort,
    private readonly pan: PanVerificationPort,
    private readonly bank: BankVerificationPort,
  ) {}

  /** VR-META-03: support staff never see a full value, and we can still rate-limit. */
  private hashInput(value: string): string {
    return createHash('sha256').update(value.toUpperCase().trim()).digest('hex');
  }

  private mask(value: string): string {
    const v = value.trim();
    if (v.length <= 6) return `${v.slice(0, 2)}****`;
    return `${v.slice(0, 4)}${'*'.repeat(Math.max(4, v.length - 7))}${v.slice(-3)}`;
  }

  /**
   * Enforce the retry policy against the durable history.
   *
   * Counts only attempts that *consumed* one — a run of provider errors must not
   * exhaust an applicant's budget for a service being down.
   */
  private async assertRetryAllowed(
    checkType: CheckType,
    inputHash: string,
    subject: VerificationSubject,
  ): Promise<{ attemptNo: number; attemptsRemaining: number }> {
    const since = new Date(this.clock.nowMs() - 86_400_000);

    const consuming = await this.prisma.db.verification_check.findMany({
      where: {
        check_type: checkType,
        input_hash: inputHash,
        checked_at: { gte: since },
        status: { in: ['PASS', 'FAIL', 'MISMATCH'] },
      },
      orderBy: { checked_at: 'desc' },
    });

    if (consuming.length >= MAX_ATTEMPTS_PER_DAY) {
      throw new RateLimitedError(
        86_400,
        'You have tried this too many times today. Contact our support team and we will check it manually.',
      );
    }

    const last = consuming[0];
    if (consuming.length >= COOLDOWN_AFTER_ATTEMPTS && last) {
      const elapsed = this.clock.nowMs() - last.checked_at.getTime();
      if (elapsed < COOLDOWN_MINUTES * 60_000) {
        throw new RateLimitedError(
          Math.ceil((COOLDOWN_MINUTES * 60_000 - elapsed) / 1000),
          `Please wait ${COOLDOWN_MINUTES} minutes before trying this again.`,
        );
      }
    }

    // The fraud signal: three attempts on the same *subject* with three different
    // values. One typo is a typo; three different GSTINs is someone shopping for
    // one that passes. Counted INCLUDING the value being attempted now — counting
    // only what is already recorded would always wave the third one through.
    await this.checkForValueShopping(checkType, subject, inputHash);

    return {
      attemptNo: consuming.length + 1,
      attemptsRemaining: MAX_ATTEMPTS_PER_DAY - consuming.length - 1,
    };
  }

  private async checkForValueShopping(
    checkType: CheckType,
    subject: VerificationSubject,
    pendingHash: string,
  ): Promise<void> {
    if (!subject.orgId && !subject.leadId) return;
    const since = new Date(this.clock.nowMs() - 86_400_000);

    const distinct = await this.prisma.db.verification_check.findMany({
      where: {
        check_type: checkType,
        checked_at: { gte: since },
        ...(subject.orgId ? { org_id: subject.orgId } : { lead_id: subject.leadId }),
      },
      select: { input_hash: true },
      distinct: ['input_hash'],
    });

    const hashes = new Set(distinct.map((d) => d.input_hash));
    hashes.add(pendingHash);

    if (hashes.size >= FRAUD_FLAG_DISTINCT_VALUES) {
      this.logger.warn(
        `FRAUD SIGNAL: ${hashes.size} distinct ${checkType} values attempted by ` +
          `${subject.orgId ? `org ${subject.orgId}` : `lead ${subject.leadId}`} in 24h`,
      );
      throw new ConflictError(
        'We have seen several different values for this check on your application. For your security we have paused it — our team will be in touch shortly.',
        { reason: 'value_shopping', checkType, distinctValues: hashes.size },
      );
    }
  }

  private async record(
    checkType: CheckType,
    rawInput: string,
    subject: VerificationSubject,
    result: VerificationResult<unknown>,
    attemptNo: number,
    triggeredBy?: string | null,
  ): Promise<string> {
    const row = await this.prisma.db.verification_check.create({
      data: {
        org_id: subject.orgId ?? null,
        lead_id: subject.leadId ?? null,
        check_type: checkType,
        input_value_masked: this.mask(rawInput),
        input_hash: this.hashInput(rawInput),
        provider: result.provider,
        status: result.outcome,
        response_summary: (result.data ?? null) as object,
        match_score: result.matchScore ?? null,
        failure_reason: result.reason ?? null,
        // Recorded per call: we will switch providers, and the history has to say
        // which one answered and what it cost.
        cost_paise: result.costPaise,
        latency_ms: result.latencyMs,
        attempt_no: attemptNo,
        triggered_by: triggeredBy ?? null,
        checked_at: this.clock.now(),
      },
    });
    return row.id;
  }

  // -------------------------------------------------------------------------
  // GSTIN
  // -------------------------------------------------------------------------

  async verifyGstin(
    gstinRaw: string,
    subject: VerificationSubject,
    opts: { expectedLegalName?: string; expectedPan?: string; triggeredBy?: string | null } = {},
  ): Promise<VerificationOutcomeView> {
    const gstin = normaliseGstin(gstinRaw);
    if (!gstin)
      throw new ValidationError('Enter a valid 15-character GSTIN (e.g. 06ABCDE1234F1Z5).');

    // VR-002: the check digit is arithmetic we can do here. Failing it locally
    // turns a 30-second round trip into an instant "you mistyped a character",
    // and — importantly — does not spend an attempt on a value that cannot exist.
    if (!isValidGstin(gstin)) {
      throw new ValidationError('This GSTIN fails its check-digit test. Please re-enter.', {
        gstin: 'This GSTIN fails its check-digit test. Please re-enter.',
      });
    }

    // VR-006: characters 3–12 are the holder's PAN. Comparing locally catches a
    // mismatched pair before either round trip.
    if (opts.expectedPan) {
      const embedded = panFromGstin(gstin);
      if (embedded && embedded !== opts.expectedPan.toUpperCase()) {
        throw new ValidationError(
          'The PAN inside this GSTIN does not match the PAN you provided.',
          {
            gstin: 'The PAN inside this GSTIN does not match the PAN you provided.',
          },
        );
      }
    }

    const { attemptNo, attemptsRemaining } = await this.assertRetryAllowed(
      'GSTIN',
      this.hashInput(gstin),
      subject,
    );

    const result = await this.gstin.verify(gstin, opts.expectedLegalName);
    const id = await this.record('GSTIN', gstin, subject, result, attemptNo, opts.triggeredBy);

    return this.toView(id, 'GSTIN', result, attemptNo, attemptsRemaining, {
      passMessage: result.data
        ? `Active · ${(result.data as { legalName: string }).legalName} · ${this.stateName(gstin)}`
        : 'Verified.',
    });
  }

  private stateName(gstin: string): string {
    const code = stateCodeFromGstin(gstin);
    const names: Record<string, string> = {
      '06': 'Haryana',
      '07': 'Delhi',
      '09': 'Uttar Pradesh',
      '27': 'Maharashtra',
      '29': 'Karnataka',
      '33': 'Tamil Nadu',
      '24': 'Gujarat',
      '19': 'West Bengal',
    };
    return code ? `${names[code] ?? 'State'} (${code})` : 'India';
  }

  // -------------------------------------------------------------------------
  // PAN
  // -------------------------------------------------------------------------

  async verifyPan(
    panRaw: string,
    subject: VerificationSubject,
    opts: { expectedName?: string; entityType?: string; triggeredBy?: string | null } = {},
  ): Promise<VerificationOutcomeView> {
    const pan = panRaw.trim().toUpperCase();

    // VR-008: the 4th character encodes the holder type. A PAN whose type
    // contradicts the declared constitution is a mistake worth catching here,
    // with a message that says which two things disagree.
    if (opts.entityType) {
      const fourth = pan[3];
      const expected = this.panCharForEntity(opts.entityType);
      if (expected && fourth && fourth !== expected) {
        throw new ValidationError(
          `This PAN belongs to ${this.panHolderDescription(fourth)}, but you selected "${opts.entityType}". Check which is right.`,
          { pan: 'The PAN type does not match the constitution you selected.' },
        );
      }
    }

    const { attemptNo, attemptsRemaining } = await this.assertRetryAllowed(
      'PAN',
      this.hashInput(pan),
      subject,
    );
    const result = await this.pan.verify(pan, opts.expectedName);
    const id = await this.record('PAN', pan, subject, result, attemptNo, opts.triggeredBy);

    return this.toView(id, 'PAN', result, attemptNo, attemptsRemaining, {
      passMessage: result.data ? `Valid · ${(result.data as { name: string }).name}` : 'Verified.',
    });
  }

  private panCharForEntity(entityType: string): string | null {
    // Keyed on `constitution_type`: PROPRIETORSHIP, PARTNERSHIP, LLP, PVT_LTD,
    // LTD, TRUST, SOCIETY, OTHER. OTHER is deliberately absent — we cannot infer
    // a PAN class from it, and guessing would produce a false rejection.
    const map: Record<string, string> = {
      PVT_LTD: 'C',
      LTD: 'C',
      PROPRIETORSHIP: 'P',
      LLP: 'F',
      PARTNERSHIP: 'F',
      TRUST: 'T',
      SOCIETY: 'A',
    };
    return map[entityType] ?? null;
  }

  private panHolderDescription(fourth: string): string {
    const map: Record<string, string> = {
      C: 'a company',
      P: 'an individual',
      H: 'a Hindu Undivided Family',
      F: 'a firm or LLP',
      A: 'an association of persons',
      T: 'a trust',
      B: 'a body of individuals',
      L: 'a local authority',
      G: 'a government body',
    };
    return map[fourth] ?? 'a different entity type';
  }

  // -------------------------------------------------------------------------
  // Bank
  // -------------------------------------------------------------------------

  async pennyDrop(
    accountNumber: string,
    ifsc: string,
    expectedName: string,
    subject: VerificationSubject,
    triggeredBy?: string | null,
  ): Promise<VerificationOutcomeView> {
    const { attemptNo, attemptsRemaining } = await this.assertRetryAllowed(
      'BANK_PENNY_DROP',
      this.hashInput(`${accountNumber}:${ifsc}`),
      subject,
    );

    const result = await this.bank.pennyDrop(accountNumber, ifsc.toUpperCase(), expectedName);
    const id = await this.record(
      'BANK_PENNY_DROP',
      accountNumber,
      subject,
      result,
      attemptNo,
      triggeredBy,
    );

    return this.toView(id, 'BANK_PENNY_DROP', result, attemptNo, attemptsRemaining, {
      passMessage: result.data
        ? `Verified · ${(result.data as { beneficiaryName: string }).beneficiaryName} · ${(result.data as { bankName: string }).bankName}`
        : 'Verified.',
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Turn an adapter result into what the applicant sees.
   *
   * The whole point is the branch on outcome: four different messages, because
   * four different things happened and only two of them are anything the person
   * can act on.
   */
  private toView(
    id: string,
    checkType: CheckType,
    result: VerificationResult<unknown>,
    attemptNo: number,
    attemptsRemaining: number,
    opts: { passMessage: string },
  ): VerificationOutcomeView {
    const base = {
      id,
      checkType,
      outcome: result.outcome,
      resolved: (result.data ?? undefined) as Record<string, unknown> | undefined,
      matchScore: result.matchScore,
      attemptNo,
    };

    switch (result.outcome) {
      case 'PASS':
        return {
          ...base,
          message: opts.passMessage,
          attemptsRemaining,
          willRetryAutomatically: false,
        };

      case 'MISMATCH':
        return {
          ...base,
          message: result.reason ?? 'The details do not quite match. Our team will take a look.',
          attemptsRemaining,
          willRetryAutomatically: false,
        };

      case 'FAIL':
        return {
          ...base,
          message:
            result.reason ?? 'We could not verify this. Please check the value and try again.',
          attemptsRemaining,
          willRetryAutomatically: false,
        };

      case 'PROVIDER_ERROR':
      case 'TIMEOUT':
        return {
          ...base,
          // Not the applicant's problem, and the message must not imply it is.
          message:
            result.reason ??
            "We couldn't reach that service just now. We'll retry automatically — there's nothing for you to do.",
          // The attempt is NOT consumed. This is the whole distinction.
          attemptsRemaining: attemptsRemaining + 1,
          willRetryAutomatically: true,
        };
    }
  }

  /** History for the review console, most recent first. Values stay masked. */
  async history(
    subject: VerificationSubject,
    checkType?: CheckType,
  ): Promise<
    Array<{
      id: string;
      checkType: string;
      outcome: string;
      maskedInput: string;
      provider: string;
      matchScore: number | null;
      failureReason: string | null;
      attemptNo: number;
      latencyMs: number | null;
      costPaise: number | null;
      checkedAt: Date;
    }>
  > {
    const rows = await this.prisma.db.verification_check.findMany({
      where: {
        ...(subject.orgId ? { org_id: subject.orgId } : {}),
        ...(subject.leadId ? { lead_id: subject.leadId } : {}),
        ...(checkType ? { check_type: checkType } : {}),
      },
      orderBy: { checked_at: 'desc' },
      take: 100,
    });

    return rows.map((r) => ({
      id: r.id,
      checkType: r.check_type,
      outcome: r.status,
      maskedInput: r.input_value_masked,
      provider: r.provider,
      matchScore: r.match_score ? Number(r.match_score) : null,
      failureReason: r.failure_reason,
      attemptNo: r.attempt_no,
      latencyMs: r.latency_ms,
      costPaise: r.cost_paise,
      checkedAt: r.checked_at,
    }));
  }
}
