import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { OTP_POLICY, type OtpPurpose } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { RateLimiter } from '../../../shared/redis/redis.service';
import { NotificationPort } from '../../../shared/adapters/ports';
import { ValidationError, RateLimitedError } from '../../../shared/errors/domain-errors';

/**
 * One-time passwords.
 *
 * VR-050 to VR-055. The rules that are easy to get subtly wrong, and why each
 * one is here:
 *
 *   - **Stored as a salted hash, never plaintext.** An OTP table that leaks is a
 *     bulk account-takeover if the codes are readable.
 *   - **Consumed atomically.** `UPDATE ... WHERE consumed_at IS NULL RETURNING`
 *     is the whole mechanism; a read-then-write lets two racing requests both
 *     succeed with the same code.
 *   - **Scope-bound.** A code issued for LOGIN cannot verify a BANK_CHANGE. Without
 *     this, phishing someone into a login OTP redirects their payouts.
 *   - **Burned on the last failed attempt**, not merely counted. A code that
 *     survives five wrong guesses survives the sixth.
 */

const CODE_LENGTH = 6;

export interface IssueOtpResult {
  otpId: string;
  expiresAt: Date;
  resendAvailableAt: Date;
  /** Only in non-production, so a developer and an E2E test can read it. */
  devCode?: string;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationPort,
  ) {}

  private hash(code: string, target: string): string {
    // Salted with the target so an attacker cannot precompute one rainbow table
    // for all six-digit codes across every account.
    return createHash('sha256').update(`${target}:${code}`).digest('hex');
  }

  private generate(): string {
    // CSPRNG. Math.random() here would make codes predictable from one sample.
    return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  }

  /**
   * Issue a code. Rate-limited per target and per purpose.
   *
   * `isProduction` gates whether the code comes back in the response — never in
   * production, always in dev and test, because otherwise every E2E test needs a
   * mail-server scrape.
   *
   * `deliver: false` runs the whole issue — every rate-limit window, the
   * supersede, the row — and skips only the send. It exists for the routes that
   * must not answer whether an address belongs to an account: `login/otp` and
   * `password/forgot` are called with an address nobody has proved they can
   * read, so the *refusals* have to be identical too. A route that only consumed
   * the cooldown for addresses it recognised would answer "is this dealer on
   * Trugrade" with a 429 on the second try, which is the directory the whole
   * business is built on not having.
   */
  async issue(input: {
    target: string;
    purpose: OtpPurpose;
    channel: 'SMS' | 'EMAIL' | 'WHATSAPP';
    templateCode: string;
    locale?: 'en' | 'hi';
    refType?: string;
    refId?: string;
    isProduction: boolean;
    variables?: Record<string, string>;
    /** Default true. False issues the code and sends nothing. See above. */
    deliver?: boolean;
  }): Promise<IssueOtpResult> {
    const { target, purpose } = input;

    // VR-053: 60 s between resends, 5 per hour, 20 per day. Three windows,
    // because each catches a different shape of abuse — impatience, a script,
    // and a sustained campaign.
    await this.limiter.consume(
      {
        name: `otp-cooldown:${purpose}`,
        limit: 1,
        windowSeconds: OTP_POLICY.resendCooldownSeconds,
      },
      target,
    );
    await this.limiter.consume(
      { name: `otp-hour:${purpose}`, limit: OTP_POLICY.maxResendsPerHour, windowSeconds: 3600 },
      target,
    );
    await this.limiter.consume(
      { name: `otp-day:${purpose}`, limit: OTP_POLICY.maxResendsPerDay, windowSeconds: 86_400 },
      target,
    );

    const code = this.generate();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OTP_POLICY.ttlSeconds * 1000);

    // Any live code for this target and purpose is superseded. Two valid codes
    // at once doubles the guess surface for no benefit.
    await this.prisma.db.otp_request.updateMany({
      where: { target, purpose, consumed_at: null, burned_at: null },
      data: { burned_at: now },
    });

    const row = await this.prisma.db.otp_request.create({
      data: {
        target,
        purpose,
        code_hash: this.hash(code, target),
        channel: input.channel,
        expires_at: expiresAt,
        ref_type: input.refType ?? null,
        ref_id: input.refId ?? null,
        created_at: now,
      },
    });

    if (input.deliver !== false) {
      await this.notifications.send({
        channel: input.channel,
        to: target,
        templateCode: input.templateCode,
        locale: input.locale ?? 'en',
        variables: {
          code,
          minutes: String(Math.round(OTP_POLICY.ttlSeconds / 60)),
          ...input.variables,
        },
        // An OTP is transactional by definition: it never respects a marketing
        // preference, because it is not marketing.
        isTransactional: true,
      });
    }

    return {
      otpId: row.id,
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + OTP_POLICY.resendCooldownSeconds * 1000),
      // Withheld when nothing was sent: a dev tool that hands out a code for an
      // address that has no account would be the enumeration oracle this flag
      // exists to close, wearing a NODE_ENV as a disguise.
      ...(input.isProduction || input.deliver === false ? {} : { devCode: code }),
    };
  }

  /**
   * Verify and consume, atomically.
   *
   * Returns the row so a caller can read `ref_id` — the lead or user the code was
   * issued against — without trusting the client to tell it.
   */
  async verify(input: {
    target: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<{ otpId: string; refType: string | null; refId: string | null }> {
    const now = this.clock.now();

    // A wrong-guess budget per target, on top of the per-code attempt count.
    // Without it, an attacker just requests a new code every five guesses.
    await this.limiter.consume(
      { name: `otp-verify:${input.purpose}`, limit: 20, windowSeconds: 3600 },
      input.target,
    );

    const row = await this.prisma.db.otp_request.findFirst({
      where: { target: input.target, purpose: input.purpose, consumed_at: null, burned_at: null },
      orderBy: { created_at: 'desc' },
    });

    if (!row) {
      throw new ValidationError(OTP_POLICY.expiredMessage, { code: OTP_POLICY.expiredMessage });
    }
    if (row.expires_at.getTime() <= now.getTime()) {
      await this.prisma.db.otp_request.update({ where: { id: row.id }, data: { burned_at: now } });
      throw new ValidationError(OTP_POLICY.expiredMessage, { code: OTP_POLICY.expiredMessage });
    }

    if (row.code_hash !== this.hash(input.code, input.target)) {
      const attempts = row.attempts + 1;
      const burned = attempts >= OTP_POLICY.maxVerifyAttempts;
      await this.prisma.db.otp_request.update({
        where: { id: row.id },
        data: { attempts, burned_at: burned ? now : null },
      });

      if (burned) {
        throw new ValidationError(OTP_POLICY.burnedMessage, { code: OTP_POLICY.burnedMessage });
      }
      const left = OTP_POLICY.maxVerifyAttempts - attempts;
      throw new ValidationError(
        `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left before you need a new one.`,
        { code: 'That code is not right.' },
      );
    }

    // The consume itself. Conditional on still being unconsumed, so two racing
    // requests cannot both win — the second updates zero rows.
    const consumed = await this.prisma.db.otp_request.updateMany({
      where: { id: row.id, consumed_at: null },
      data: { consumed_at: now },
    });

    if (consumed.count === 0) {
      throw new ValidationError(OTP_POLICY.usedMessage, { code: OTP_POLICY.usedMessage });
    }

    // Clear the cooldown: a successful verification should not leave the user
    // unable to request a code for the *next* step.
    await this.limiter.reset(
      {
        name: `otp-cooldown:${input.purpose}`,
        limit: 1,
        windowSeconds: OTP_POLICY.resendCooldownSeconds,
      },
      input.target,
    );

    return { otpId: row.id, refType: row.ref_type, refId: row.ref_id };
  }

  /**
   * VR-055. Confirm a code was verified for THIS purpose within a short window,
   * without consuming it again — used where a flow verifies first and commits
   * afterwards, e.g. the dual-OTP contact change.
   */
  async wasRecentlyVerified(
    target: string,
    purpose: OtpPurpose,
    withinSeconds = 900,
  ): Promise<boolean> {
    const since = new Date(this.clock.nowMs() - withinSeconds * 1000);
    const row = await this.prisma.db.otp_request.findFirst({
      where: { target, purpose, consumed_at: { gte: since } },
      orderBy: { consumed_at: 'desc' },
    });
    return row !== null;
  }

  /** How long until this target may request another code. For the UI countdown. */
  async cooldownRemaining(target: string, purpose: OtpPurpose): Promise<number> {
    const remaining = await this.limiter.peek(
      {
        name: `otp-cooldown:${purpose}`,
        limit: 1,
        windowSeconds: OTP_POLICY.resendCooldownSeconds,
      },
      target,
    );
    return remaining > 0 ? 0 : OTP_POLICY.resendCooldownSeconds;
  }

  /** Surface a rate-limit refusal as the OTP-shaped message, not a generic 429. */
  static isCooldown(e: unknown): e is RateLimitedError {
    return e instanceof RateLimitedError;
  }
}
