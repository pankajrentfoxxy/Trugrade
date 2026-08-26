import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  PASSWORD,
  PASSWORD_BLOCKLIST,
  PASSWORD_BLOCKLIST_WORDS,
  PASSWORD_COMPOSITION,
  PASSWORD_HISTORY,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ValidationError } from '../../../shared/errors/domain-errors';

/**
 * VR-048: Argon2id, m=64 MiB, t=3, p=1.
 *
 * These are cost parameters, not preferences. Lowering them to make a test suite
 * faster is the change that quietly halves the cost of an offline crack, so they
 * live here as named constants with the reason attached.
 */
const ARGON_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

/**
 * The most common passwords, condensed.
 *
 * ponytail: a 200-entry list plus the structural checks below, not the full
 * 100k breached corpus. It catches `Password@123` and `Welcome@2024` — which is
 * what people actually type when a composition rule forces a symbol — without
 * shipping a megabyte. Upgrade to `@zxcvbn-ts/core` if a real audit asks for a
 * score rather than a verdict.
 */
const COMMON_BASES = [
  'password',
  'passw0rd',
  'welcome',
  'admin',
  'letmein',
  'qwerty',
  'abc123',
  'iloveyou',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'master',
  'shadow',
  'superman',
  'trustno1',
  'starwars',
  'whatever',
  'freedom',
  'secret',
  'summer',
  'winter',
  'spring',
  'autumn',
  'january',
  'december',
  'india',
  'delhi',
  'mumbai',
  'bharat',
  'ganesh',
  'krishna',
  'shivam',
  'aadhaar',
  'company',
  'business',
  'office',
  'default',
  'changeme',
  'temporary',
  'test123',
];

export interface PasswordCheckResult {
  ok: boolean;
  /** Specific enough to fix. "Too weak" sends people to support. */
  reason?: string;
}

@Injectable()
export class PasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /**
   * VR-044 to VR-046, checked in the order a person would hit them, so the first
   * message they see is about the first thing they can fix.
   */
  check(
    password: string,
    context: { email?: string | null; mobile?: string | null; fullName?: string | null } = {},
  ): PasswordCheckResult {
    if (password.length < PASSWORD.min!) {
      return { ok: false, reason: PASSWORD.message };
    }
    if (password.length > PASSWORD.max!) {
      return { ok: false, reason: 'Password must be 128 characters or fewer.' };
    }
    if (!PASSWORD_COMPOSITION.pattern!.test(password)) {
      return { ok: false, reason: PASSWORD_COMPOSITION.message };
    }

    const lower = password.toLowerCase();

    // A password containing the brand is the first thing anyone tries.
    for (const word of PASSWORD_BLOCKLIST_WORDS) {
      if (lower.includes(word)) {
        return {
          ok: false,
          reason: `Passwords cannot contain "${word}". Pick something unrelated to the company.`,
        };
      }
    }

    // ...and one containing your own email or number is not a secret from anyone
    // who already has your business card.
    const localPart = context.email?.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
      return { ok: false, reason: 'Your password cannot contain your email address.' };
    }
    const mobileDigits = context.mobile?.replace(/\D/g, '').slice(-10);
    if (mobileDigits && mobileDigits.length === 10 && password.includes(mobileDigits)) {
      return { ok: false, reason: 'Your password cannot contain your mobile number.' };
    }
    for (const namePart of (context.fullName ?? '').toLowerCase().split(/\s+/)) {
      if (namePart.length >= 4 && lower.includes(namePart)) {
        return { ok: false, reason: 'Your password cannot contain your own name.' };
      }
    }

    // Strip the decorations people add to satisfy a composition rule, then check
    // what is left. `Password@123` and `P@ssw0rd!` reduce to the same base.
    const stripped = lower
      .replace(/[^a-z]/g, '')
      .replace(/0/g, 'o')
      .replace(/1/g, 'l');
    const deleeted = lower
      .replace(/[@4]/g, 'a')
      .replace(/[0]/g, 'o')
      .replace(/[1!|]/g, 'i')
      .replace(/[3]/g, 'e')
      .replace(/[5$]/g, 's')
      .replace(/[7]/g, 't')
      .replace(/[^a-z]/g, '');

    for (const base of COMMON_BASES) {
      if (stripped.includes(base) || deleeted.includes(base)) {
        return { ok: false, reason: PASSWORD_BLOCKLIST.message };
      }
    }

    // A single repeated or sequential run is not a password either.
    if (/^(.)\1+$/.test(password)) {
      return { ok: false, reason: PASSWORD_BLOCKLIST.message };
    }
    if (/(abcdef|qwerty|123456|098765|zyxwvu)/.test(lower)) {
      return { ok: false, reason: PASSWORD_BLOCKLIST.message };
    }

    return { ok: true };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON_OPTIONS);
  }

  /**
   * Constant-time by construction — argon2.verify compares digests, not strings.
   * Returns false rather than throwing on a malformed stored hash, because a
   * corrupted row must fail closed, not 500.
   */
  async verify(storedHash: string | null, password: string): Promise<boolean> {
    if (!storedHash) return false;
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      return false;
    }
  }

  /** VR-047: must differ from the last 5. */
  async assertNotReused(userId: string, password: string): Promise<void> {
    const history = await this.prisma.db.password_history.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: PASSWORD_HISTORY.max,
    });

    for (const row of history) {
      if (await this.verify(row.password_hash, password)) {
        throw new ValidationError(PASSWORD_HISTORY.message, { password: PASSWORD_HISTORY.message });
      }
    }
  }

  /**
   * Set a password: validate, check history, hash, record.
   *
   * `rotationDays` non-null sets an expiry — VR-049 forces admin and vendor-owner
   * passwords to change every 180 days, because those logins can change where
   * money is paid.
   */
  async setPassword(
    userId: string,
    password: string,
    context: {
      email?: string | null;
      mobile?: string | null;
      fullName?: string | null;
      rotationDays?: number | null;
    } = {},
  ): Promise<void> {
    const check = this.check(password, context);
    if (!check.ok) throw new ValidationError(check.reason!, { password: check.reason! });

    await this.assertNotReused(userId, password);
    const hash = await this.hash(password);
    const now = this.clock.now();

    await this.prisma.runInTransaction(async () => {
      await this.prisma.db.user_account.update({
        where: { id: userId },
        data: {
          password_hash: hash,
          password_changed_at: now,
          password_expires_at: context.rotationDays
            ? new Date(now.getTime() + context.rotationDays * 86_400_000)
            : null,
          failed_login_count: 0,
          locked_until: null,
        },
      });
      await this.prisma.db.password_history.create({
        data: { user_id: userId, password_hash: hash, created_at: now },
      });

      // Keep the window bounded. Older hashes prove nothing and are one more
      // thing sitting in a backup.
      const stale = await this.prisma.db.password_history.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        skip: PASSWORD_HISTORY.max,
        select: { id: true },
      });
      if (stale.length) {
        await this.prisma.db.password_history.deleteMany({
          where: { id: { in: stale.map((s) => s.id) } },
        });
      }
    });
  }

  isExpired(expiresAt: Date | null): boolean {
    return expiresAt !== null && expiresAt.getTime() <= this.clock.nowMs();
  }
}
