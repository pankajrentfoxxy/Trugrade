/**
 * The four pre-session auth routes T10 added, and the one property that decides
 * whether they are safe to expose at all.
 *
 * **A sign-in surface is the classic user-enumeration oracle**, and on this
 * platform it is worse than usual: vendor anonymity is the property the whole
 * business rests on (`docs/_CONTEXT.md`), so a route that answers "is this
 * dealer on Trugrade" one address at a time hands a competitor the supplier
 * list. `POST /auth/login`'s constant-time miss already closes that door;
 * `login/otp` and `password/forgot` open a new one, because unlike the
 * registration routes they *do* look the address up.
 *
 * So nothing below asserts that a guard exists. Each test attempts the
 * distinction — known address against unknown, twice each, first call and
 * refusal — and compares what came back field for field. A helpful extra field
 * added to one of the two paths a year from now fails here.
 *
 * The other three tests are for the things that would be quietly wrong rather
 * than quietly unsafe: a code that signs somebody in must run the *same*
 * suspension check the password path runs, a reset must actually end the
 * sessions it claims to, and an account whose role needs a second factor must
 * not be able to sign in on one code to the same mailbox.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { Response } from 'express';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';
import { TokenService } from '../../src/shared/auth/token.service';
import { EventBus } from '../../src/shared/events';
import {
  ForbiddenError,
  RateLimitedError,
  ValidationError,
} from '../../src/shared/errors/domain-errors';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { IdentityController } from '../../src/modules/identity/identity.controller';
import { PasswordService } from '../../src/modules/identity/internal/password.service';
import { OtpService } from '../../src/modules/identity/internal/otp.service';
import { AuditService } from '../../src/modules/identity/internal/audit.service';
import { ContactChangeService } from '../../src/modules/identity/internal/contact-change.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let controller: IdentityController;
let identity: IdentityService;
let passwords: PasswordService;
let redis: RedisService;
let ctx: RequestContextService;
let outbox: NotificationOutbox;
let clock: FixedClock;
let raw: PrismaClient;

const KNOWN = 'procurement@harbourpoint.example';
const UNKNOWN = 'nobody@harbourpoint.example';
const PASSWORD = 'Vermilion-Ledger-88!';

/** Express only ever gets cookies set on it here; nothing reads the response. */
const fakeResponse = (): Response =>
  ({ cookie: () => undefined, clearCookie: () => undefined }) as unknown as Response;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);
  clock = new FixedClock(new Date('2026-08-27T06:00:00.000Z'));

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule, AdaptersModule],
    providers: [
      { provide: ClockPort, useValue: clock },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      RedisService,
      RateLimiter,
      LockService,
      TokenService,
      PasswordService,
      OtpService,
      AuditService,
      ContactChangeService,
      IdentityService,
      EventBus,
      IdentityController,
    ],
  }).compile();

  await moduleRef.init();
  controller = moduleRef.get(IdentityController);
  identity = moduleRef.get(IdentityService);
  passwords = moduleRef.get(PasswordService);
  redis = moduleRef.get(RedisService);
  ctx = moduleRef.get(RequestContextService);
  outbox = moduleRef.get(NotificationOutbox);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

let orgId: string;
let userId: string;

beforeEach(async () => {
  await truncateAll(raw);
  // Every budget these routes consume lives in Redis and none of them are on the
  // fake clock, so a leftover cooldown from the previous test would fail the next
  // one on a rate limit that has nothing to do with what it asserts.
  await redis.client.flushdb();
  outbox.clear();
  clock.advanceTo(new Date('2026-08-27T06:00:00.000Z'));

  orgId = await makeOrganization({ legal_name: 'Harbourpoint Devices Pvt Ltd' }, raw);
  userId = await makeUser(orgId, { email: KNOWN, full_name: 'Ishaan Malhotra' }, raw);
  await passwords.setPassword(userId, PASSWORD, { email: KNOWN });
  await identity.assignRole(userId, 'CUSTOMER_OWNER');
  await raw.$executeRaw`
    UPDATE identity.organization SET status = 'VERIFIED' WHERE id = ${orgId}::uuid`;
});

/** Run inside a request context, exactly as `RequestContextInterceptor` establishes it. */
function inRequest<T>(fn: () => Promise<T>, ip = '203.0.113.10'): Promise<T> {
  return ctx.run({ requestId: 'test', ip, userAgent: 'jest' }, fn);
}

/** Everything a caller can observe, with the one dev-only field removed. */
const observable = (
  reply: Awaited<ReturnType<IdentityController['sendLoginCode']>>,
): Record<string, unknown> => {
  const { devCode: _devCode, ...rest } = reply;
  return rest;
};

const thrown = async (fn: () => Promise<unknown>): Promise<Error> => {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a refusal and got none');
};

// ---------------------------------------------------------------------------

describe('a pre-session code route must not be able to say whether an address has an account', () => {
  /**
   * Both senders are compared, because they are the same method with a different
   * purpose and the moment one of them grows a branch the other does not have,
   * that difference IS the answer.
   */
  const senders = [
    ['login/otp', (email: string) => controller.sendLoginCode({ email })],
    ['password/forgot', (email: string) => controller.sendPasswordResetCode({ email })],
  ] as const;

  it.each(senders)('%s answers identically for a known and an unknown address', async (_n, send) => {
    const known = await inRequest(() => send(KNOWN));
    const unknown = await inRequest(() => send(UNKNOWN));

    // `sentTo` is a mask of what was typed, so it differs only where the input
    // did. Everything derived from anything else must be identical.
    expect(Object.keys(observable(unknown)).sort()).toEqual(Object.keys(observable(known)).sort());
    expect(unknown.channel).toBe(known.channel);
    expect(unknown.expiresAt).toBe(known.expiresAt);
    expect(unknown.resendAvailableAt).toBe(known.resendAvailableAt);
  });

  it.each(senders)('%s refuses a second call the same way for both', async (_n, send) => {
    // The whole point of `deliver: false`: an unknown address consumes the same
    // per-target cooldown, so the 429 arrives at the same moment for both. Before
    // that flag existed, only a known address could ever be rate-limited — and a
    // 429 on the second try was a yes.
    await inRequest(() => send(KNOWN));
    await inRequest(() => send(UNKNOWN));

    const onKnown = await thrown(() => inRequest(() => send(KNOWN)));
    const onUnknown = await thrown(() => inRequest(() => send(UNKNOWN)));

    expect(onKnown).toBeInstanceOf(RateLimitedError);
    expect(onUnknown).toBeInstanceOf(RateLimitedError);
    expect(onUnknown.message).toBe(onKnown.message);
  });

  it('sends an email for a real account and nothing at all for an address it does not know', async () => {
    await inRequest(() => controller.sendLoginCode({ email: UNKNOWN }));
    expect(outbox.all()).toHaveLength(0);

    await inRequest(() => controller.sendLoginCode({ email: KNOWN }));
    expect(outbox.all()).toHaveLength(1);
    expect(outbox.all()[0]?.to).toBe(KNOWN);
  });

  it('says one thing about a bad code, whoever typed it', async () => {
    await inRequest(() => controller.sendLoginCode({ email: KNOWN }));

    const onKnown = await thrown(() =>
      inRequest(() =>
        controller.verifyLoginCode({ email: KNOWN, code: '000000' }, fakeResponse()),
      ),
    );
    const onUnknown = await thrown(() =>
      inRequest(() =>
        controller.verifyLoginCode({ email: UNKNOWN, code: '000000' }, fakeResponse()),
      ),
    );

    expect(onKnown).toBeInstanceOf(ValidationError);
    expect(onUnknown).toBeInstanceOf(ValidationError);
    // `OtpService.verify` distinguishes "wrong, 4 attempts left" from "expired",
    // and only an address with an account can ever produce the first — so the
    // controller flattens both. This is the assertion that catches somebody
    // helpfully restoring the attempt counter.
    expect(onUnknown.message).toBe(onKnown.message);
    expect((onKnown as ValidationError).fields).toEqual(
      (onUnknown as ValidationError).fields,
    );
  });
});

describe('signing in with a code is the same sign-in, not a shortcut around it', () => {
  const codeFor = async (email: string): Promise<string> => {
    const sent = await inRequest(() => controller.sendLoginCode({ email }));
    if (!sent.devCode) throw new Error('no devCode — is the config production?');
    return sent.devCode;
  };

  it('issues a session for the right account', async () => {
    const code = await codeFor(KNOWN);
    const session = await inRequest(() =>
      controller.verifyLoginCode({ email: KNOWN, code }, fakeResponse()),
    );

    expect(session.userId).toBe(userId);
    expect(session.orgId).toBe(orgId);
    expect(session.mfaRequired).toBe(false);
  });

  it('refuses a suspended organisation exactly as the password path does', async () => {
    const code = await codeFor(KNOWN);
    await raw.$executeRaw`
      UPDATE identity.organization SET status = 'SUSPENDED' WHERE id = ${orgId}::uuid`;

    const refusal = await thrown(() =>
      inRequest(() => controller.verifyLoginCode({ email: KNOWN, code }, fakeResponse())),
    );
    expect(refusal).toBeInstanceOf(ForbiddenError);
    expect(refusal.message).toContain('suspended');

    // And the password path says the identical thing, because it is the identical
    // code. Two copies of "is this organisation suspended" is one copy too many.
    const byPassword = await thrown(() =>
      inRequest(() => controller.login({ email: KNOWN, password: PASSWORD }, fakeResponse())),
    );
    expect(byPassword.message).toBe(refusal.message);
  });

  it('sends no code at all to an account whose role needs a second factor', async () => {
    // A supplier owner's second factor is a code to this same mailbox. Signing
    // them in on one code and then asking for another to the same address is one
    // factor asked twice, so the route declines — silently, because a visible
    // decline would be the enumeration answer wearing a different hat.
    await identity.assignRole(userId, 'VENDOR_OWNER');
    outbox.clear();

    const reply = await inRequest(() => controller.sendLoginCode({ email: KNOWN }));

    expect(outbox.all()).toHaveLength(0);
    expect(reply.sentTo).toBeTruthy();
    expect(reply.devCode).toBeUndefined();

    // A reset, by contrast, is open to them: it ends in a password, and the
    // second factor still has to be satisfied on the next sign-in.
    await inRequest(() => controller.sendPasswordResetCode({ email: KNOWN }));
    expect(outbox.all()).toHaveLength(1);
  });
});

describe('a reset ends every session that was open at the time', () => {
  it('signs the intruder out along with the owner, and clears the lockout', async () => {
    // A live session, exactly as a signed-in tab would hold one.
    const before = await inRequest(() =>
      controller.login({ email: KNOWN, password: PASSWORD }, fakeResponse()),
    );
    expect(before.userId).toBe(userId);

    // Five failures, so the account is inside its lockout window. Somebody who
    // has just proved they can read the mailbox must not then meet the guesses
    // that sent them here.
    for (let i = 0; i < 5; i += 1) {
      await thrown(() =>
        inRequest(() => controller.login({ email: KNOWN, password: `Wrong-${i}!` }, fakeResponse())),
      );
    }

    const sent = await inRequest(() => controller.sendPasswordResetCode({ email: KNOWN }));
    const NEW_PASSWORD = 'Kestrel-Harbour-2026!';
    await inRequest(() =>
      controller.resetPassword({ email: KNOWN, code: sent.devCode!, password: NEW_PASSWORD }),
    );

    // The old password no longer opens anything…
    const stale = await thrown(() =>
      inRequest(() => controller.login({ email: KNOWN, password: PASSWORD }, fakeResponse())),
    );
    expect(stale.message).toBe('That email or password is not right.');

    // …the new one does, on the first attempt, with no wait…
    const after = await inRequest(() =>
      controller.login({ email: KNOWN, password: NEW_PASSWORD }, fakeResponse()),
    );
    expect(after.userId).toBe(userId);

    // …and every session row that existed beforehand is revoked.
    const live = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM identity.session
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;
    expect(Number(live[0]?.n ?? 0)).toBe(1);
  });

  it('refuses to reset on a code that was issued for signing in', async () => {
    // VR-055, and the reason a scope-bound OTP exists at all: phishing someone
    // into a sign-in code must not hand over their password.
    const signIn = await inRequest(() => controller.sendLoginCode({ email: KNOWN }));

    const refusal = await thrown(() =>
      inRequest(() =>
        controller.resetPassword({
          email: KNOWN,
          code: signIn.devCode!,
          password: 'Kestrel-Harbour-2026!',
        }),
      ),
    );
    expect(refusal).toBeInstanceOf(ValidationError);

    // And the password is untouched.
    const still = await inRequest(() =>
      controller.login({ email: KNOWN, password: PASSWORD }, fakeResponse()),
    );
    expect(still.userId).toBe(userId);
  });
});

describe('the wait a client renders is the wait the server measured', () => {
  it('carries the remaining seconds on the error, not merely a message', async () => {
    // `DomainExceptionFilter` puts this on `Retry-After` and drops `detail` from
    // the body, so this number is the only thing a browser can count down.
    await inRequest(() => controller.sendLoginCode({ email: KNOWN }));
    const refusal = (await thrown(() =>
      inRequest(() => controller.sendLoginCode({ email: KNOWN })),
    )) as RateLimitedError;

    const detail = (refusal as unknown as { detail?: { retryAfterSeconds?: number } }).detail;
    expect(detail?.retryAfterSeconds).toBeGreaterThan(0);
    expect(refusal.message).toMatch(/Try again in \d+ minute/);
  });
});
