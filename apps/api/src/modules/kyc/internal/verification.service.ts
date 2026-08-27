import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  GSTIN,
  isValidGstin,
  panFromGstin,
  stateCodeFromGstin,
  normaliseGstin,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { AppConfig } from '../../../shared/config';
import {
  BankVerificationPort,
  GstinVerificationPort,
  NotificationPort,
  PanVerificationPort,
  type NotificationChannel,
  type VerificationOutcome,
  type VerificationResult,
} from '../../../shared/adapters/ports';
import {
  ConflictError,
  PreconditionFailedError,
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
/**
 * How many DIFFERENT values for one check type, from one applicant in 24 hours,
 * stop looking like typing and start looking like someone shopping for a value
 * that passes. PHASE_01: "a third attempt with different values is a signal,
 * not a coincidence."
 *
 * KNOWN TENSION, deliberately left as-is and raised in docs/BUILD_LEDGER.md:
 * this fires on an honest buyer. One legal entity holds one GSTIN PER STATE, and
 * registration step 3 exists to collect the extra ones — so a buyer operating in
 * Delhi, Haryana and Karnataka is paused for fraud while entering exactly what
 * we asked for.
 *
 * Raising the number for GSTIN was the obvious fix and is the wrong one: it
 * weakens a fraud control without making it correct, and how many registrations
 * we tolerate before pausing an application is a commercial call, not a coding
 * one.
 *
 * The correct rule is sharper than any threshold. Characters 3-12 of a GSTIN
 * ARE the holder's PAN, so every GSTIN one org submits must carry the SAME
 * embedded PAN — three state registrations of one company share one, three
 * companies' GSTINs do not. That catches shopping on the second attempt instead
 * of the third and never fires on a legitimate multi-state buyer. It needs the
 * embedded PAN recorded beside the hash, which `verification_check` does not
 * store today, so it is a schema change rather than a constant.
 */
const FRAUD_FLAG_DISTINCT_VALUES = 3;

/** Exponential backoff for automatic provider retries. Never consumes an attempt. */
export const PROVIDER_RETRY_SCHEDULE_SECONDS = [30, 120, 600, 3600];

/** `platform_config` key holding the post-change payout freeze, in hours. */
const FREEZE_HOURS_KEY = 'kyc.bank_change_freeze_hours';

/** The DLT/Meta template the owner alert is sent under, on every channel. */
export const BANK_CHANGE_ALERT_TEMPLATE = 'BANK_ACCOUNT_CHANGED';

/**
 * The column-encryption key outside production.
 *
 * `PII_ENCRYPTION_KEY` is required in production by the env loader precisely
 * because this column exists; a dev machine and CI still have to produce a
 * ciphertext, and a fixed local key is honest about being local. What must never
 * happen is a readable account number sitting in a column named `_enc`.
 */
const DEV_PII_KEY = 'trugrade-local-pii-key';

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

/** What `changeBankAccount` did, in the order it did it. */
export interface BankAccountChangeResult {
  /** The penny-drop. A non-PASS means nothing below it happened. */
  verification: VerificationOutcomeView;
  accountId: string | null;
  /** Payouts to this account are refused by the database until this instant. */
  frozenUntil: Date | null;
  /** Channels the owner alert was accepted on. Empty is an incident, not a state. */
  alertedVia: NotificationChannel[];
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
    private readonly notifications: NotificationPort,
    private readonly config: AppConfig,
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
        // SCOPED TO THE APPLICANT. Without this the budget was keyed on the
        // VALUE alone, and a GSTIN is public information — it is printed on
        // every invoice its holder issues. So any org could spend another org's
        // five daily attempts on a GSTIN it simply looked up, and the victim
        // would hit "You have tried this too many times today" having tried
        // nothing at all. A registration flow that a competitor can close from
        // the outside is worse than one with no limit.
        //
        // It also broke the honest case: two genuine applicants who share an
        // accountant, or the same operator onboarding several clients, would
        // exhaust each other.
        //
        // `checkForValueShopping` below already scoped itself this way; only
        // this query was missed. The sentence the applicant reads — "you have
        // tried this too many times" — was only ever true per applicant.
        ...(subject.orgId ? { org_id: subject.orgId } : {}),
        ...(subject.orgId ? {} : subject.leadId ? { lead_id: subject.leadId } : {}),
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
    // The message comes from the rule rather than being retyped here. It was a
    // second copy, and it had drifted: it still carried the example GSTIN that
    // fails its own check digit, so fixing the rule alone would have left this
    // path showing the wrong thing.
    if (!gstin) throw new ValidationError(GSTIN.message);

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
    // The SAME value `record` below hashes.
    //
    // This used to hash `${accountNumber}:${ifsc}` while `record` hashed the
    // account number alone, so the two never agreed and both controls that read
    // `input_hash` were quietly wrong: the five-a-day retry limit filtered on a
    // hash that matched no stored row and therefore never bound at all, and
    // `checkForValueShopping` saw the pending hash as a value it had never seen —
    // so a supplier who mistyped an account number once, corrected it, and
    // pressed save had their application paused for suspected fraud on the
    // second attempt. Found by T9 driving the real screen; the fix is that the
    // policy and the record hash the same thing.
    const { attemptNo, attemptsRemaining } = await this.assertRetryAllowed(
      'BANK_PENNY_DROP',
      this.hashInput(accountNumber),
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

  /**
   * Change the account we pay a vendor into. Penny-drop, freeze, alert.
   *
   * PHASE_01 exit criterion, and the reason all three are one method rather than
   * three: **this is an account-takeover control, and a control assembled by its
   * callers is a control one caller will assemble wrong.** The threat is not a
   * typo. It is somebody with a session redirecting the payout account to their
   * own and collecting the next run. Against that threat the penny-drop alone is
   * worthless — the attacker's own account passes it — so the two parts that
   * actually defend anything are the freeze, which buys a day, and the alert,
   * which spends that day telling the owner.
   *
   * The order below is deliberate and every step is a refusal:
   *
   *   1. **Can the owner be warned at all?** Checked FIRST, before the penny-drop,
   *      because the penny-drop costs a rupee and consumes one of five daily
   *      attempts, and because an org whose owner is unreachable must not be able
   *      to change its payout account *at all* — a silent redirect is the exact
   *      outcome this criterion exists to prevent. Refusing here is unhelpful to
   *      a badly-configured org and correct against the threat.
   *   2. **Penny-drop.** A non-PASS writes nothing: no row, no freeze, no alarm.
   *      A name mismatch is a human's problem rather than a takeover, and firing
   *      "your payout account was changed" over a change that did not happen is
   *      how an alert stops being read.
   *   3. **Write and freeze, in one transaction.** The old account is demoted and
   *      the new one inserted together. Half of that is an org with no payout
   *      account, which is a worse failure than the change not happening.
   *   4. **Alert, after the commit.** A false alarm on a rolled-back change would
   *      train the owner to ignore the one that matters, and the freeze is
   *      durable by then — so the ordering favours never crying wolf over warning
   *      a fraction of a second earlier.
   *
   * Every registered channel of the owner is used, never just the one the session
   * arrived on. That is what "a channel they did not initiate the change from"
   * means in practice: an attacker holds whatever they phished, one mailbox or
   * one SIM, and the warning has to leave by a door they are not standing in.
   * There is no suppression switch and deliberately no "do not alert me" flag.
   */
  async changeBankAccount(input: {
    orgId: string;
    actorUserId: string;
    accountNumber: string;
    ifsc: string;
    accountHolderName: string;
    accountType?: 'CURRENT' | 'SAVINGS' | 'CC' | 'OD';
  }): Promise<BankAccountChangeResult> {
    const targets = await this.ownerAlertTargets(input.orgId);
    if (targets.length === 0) {
      throw new PreconditionFailedError(
        'We cannot change a payout account without being able to warn the account owner. Add a mobile number or email address for the owner first, then try again.',
        { reason: 'bank_change_owner_unreachable', orgId: input.orgId },
      );
    }

    const verification = await this.pennyDrop(
      input.accountNumber,
      input.ifsc,
      input.accountHolderName,
      { orgId: input.orgId },
      input.actorUserId,
    );
    if (verification.outcome !== 'PASS') {
      return { verification, accountId: null, frozenUntil: null, alertedVia: [] };
    }

    const hours = await this.freezeHours();
    const now = this.clock.now();
    const frozenUntil = new Date(now.getTime() + hours * 3_600_000);
    const last4 = input.accountNumber.slice(-4);
    const ifsc = input.ifsc.toUpperCase();
    const resolved = verification.resolved as
      | { beneficiaryName?: string; bankName?: string; branch?: string }
      | undefined;

    const accountId = await this.prisma.runInTransaction(async () => {
      // One default payout account per org, so no payout run ever has to choose.
      await this.prisma.db.bank_account.updateMany({
        where: { org_id: input.orgId, purpose: 'PAYOUT', is_default: true },
        data: { is_default: false, updated_at: now },
      });

      // pgcrypto, with the key the env loader already demands in production for
      // exactly this column. Raw SQL because the encryption has to happen inside
      // the database call: reading the key into JS, encrypting there and handing
      // Prisma a Buffer would put the plaintext in a second place for no gain.
      const [row] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO kyc.bank_account
          (org_id, purpose, account_holder_name, account_number_enc, account_number_last4,
           ifsc, bank_name, branch, account_type, penny_drop_status, penny_drop_name,
           name_match_score, verified_at, is_default, frozen_until, created_at, updated_at)
        VALUES
          (${input.orgId}::uuid, 'PAYOUT', ${input.accountHolderName},
           pgp_sym_encrypt(${input.accountNumber}, ${this.piiKey()}),
           ${last4}, ${ifsc},
           ${resolved?.bankName ?? null}, ${resolved?.branch ?? null},
           ${input.accountType ?? 'CURRENT'}, 'SUCCESS',
           ${resolved?.beneficiaryName ?? null},
           ${verification.matchScore ?? null}, ${now}, TRUE, ${frozenUntil}, ${now}, ${now})
        RETURNING id`;
      return row!.id;
    });

    const alertedVia = await this.alertOwner(targets, {
      last4,
      ifsc,
      frozenUntil,
      hours,
      orgId: input.orgId,
    });

    if (alertedVia.length === 0) {
      // The freeze holds regardless — it is the half of this control that does
      // not depend on a third party. But a freeze nobody was told about expires
      // silently in a day, so this is an incident and not a debug line.
      this.logger.error(
        `BANK CHANGE ALERT UNDELIVERED: org ${input.orgId} changed its payout account to ` +
          `...${last4} and every owner channel refused the warning. ` +
          `The freeze expires ${frozenUntil.toISOString()}.`,
      );
    }

    return { verification, accountId, frozenUntil, alertedVia };
  }

  /**
   * Where the owner can be reached, out of band.
   *
   * The **owner**, not the actor and not the org's contact list. Takeover by a
   * lesser user inside the org is a real shape of this attack, and alerting the
   * person who made the change would tell the attacker their change went through
   * and tell nobody else anything.
   */
  private async ownerAlertTargets(
    orgId: string,
  ): Promise<Array<{ channel: NotificationChannel; to: string }>> {
    const owner = await this.prisma.db.user_account.findFirst({
      where: { org_id: orgId, is_org_owner: true, status: 'ACTIVE' },
      select: { mobile: true, email: true },
      orderBy: { created_at: 'asc' },
    });
    if (!owner) return [];

    // An unverified contact point is used anyway. A warning delivered to an
    // address we never round-tripped is still a warning, and withholding it over
    // a missing tick would be choosing tidiness over the entire point.
    return [
      ...(owner.mobile ? [{ channel: 'SMS' as const, to: owner.mobile }] : []),
      ...(owner.email ? [{ channel: 'EMAIL' as const, to: String(owner.email) }] : []),
    ];
  }

  /** Fan out, survive an individual failure, report what was accepted. */
  private async alertOwner(
    targets: Array<{ channel: NotificationChannel; to: string }>,
    vars: { last4: string; ifsc: string; frozenUntil: Date; hours: number; orgId: string },
  ): Promise<NotificationChannel[]> {
    const variables = {
      last4: vars.last4,
      ifsc: vars.ifsc,
      freezeHours: String(vars.hours),
      frozenUntil: vars.frozenUntil.toISOString(),
    };

    const receipts = await Promise.all(
      targets.map(async (t) => {
        try {
          const receipt = await this.notifications.send({
            channel: t.channel,
            to: t.to,
            templateCode: BANK_CHANGE_ALERT_TEMPLATE,
            locale: 'en',
            variables,
            // Transactional without qualification. A security alert is not
            // marketing and must not consult a preference an attacker holding
            // the session could have turned off a minute earlier.
            isTransactional: true,
          });
          return receipt.accepted ? t.channel : null;
        } catch (e) {
          // One dead provider must not stop the other channel, and must never
          // unwind a freeze that is already committed.
          this.logger.error(
            `Bank-change alert failed on ${t.channel} for org ${vars.orgId}: ${(e as Error).message}`,
          );
          return null;
        }
      }),
    );

    return receipts.filter((c): c is NotificationChannel => c !== null);
  }

  /**
   * The freeze window, through `v_current_config` rather than the table.
   *
   * The view applies the effective date; the table would sometimes answer with a
   * row that does not apply yet. A missing or nonsensical value throws rather
   * than falling back to 24 — silently substituting a number nobody configured is
   * how a control ends up running at a setting that was deliberately changed and
   * quietly ignored.
   */
  private async freezeHours(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${FREEZE_HOURS_KEY}`;
    const v = row?.value_json;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new PreconditionFailedError("We can't do that just now. Please try again shortly.", {
        reason: row ? 'malformed_platform_config' : 'missing_platform_config',
        key: FREEZE_HOURS_KEY,
        value: v,
      });
    }
    return v;
  }

  private piiKey(): string {
    return this.config.get('PII_ENCRYPTION_KEY') ?? DEV_PII_KEY;
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
