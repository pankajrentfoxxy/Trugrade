/**
 * PHASE_01 exit criterion: *email/mobile change requires both OTPs and notifies
 * the old address.*
 *
 * The half of that sentence worth testing hardest is the old-address OTP. An
 * attacker who has a live session passes the new-address code trivially — they
 * chose the address. So every assertion here that looks like duplication ("the
 * new code alone", "the old code alone") is really one assertion made twice from
 * opposite ends: neither proof is sufficient by itself.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter } from '../../src/shared/redis/redis.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';
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
let contactChange: ContactChangeService;
let clock: FixedClock;
let raw: PrismaClient;
let redis: RedisService;
let ctx: RequestContextService;
let outbox: NotificationOutbox;

const OLD_EMAIL = 'priya@alphasystems.in';
const NEW_EMAIL = 'priya.sharma@alphasystems.in';
const OLD_MOBILE = '+919876543210';
const NEW_MOBILE = '+919812345670';

/** Longer than `REQUEST_TTL_SECONDS` in the service under test. */
const PAST_EXPIRY_MS = 16 * 60 * 1000;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);
  clock = new FixedClock(new Date('2026-08-26T06:00:00.000Z'));

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
      OtpService,
      AuditService,
      ContactChangeService,
    ],
  }).compile();

  await moduleRef.init();
  contactChange = moduleRef.get(ContactChangeService);
  redis = moduleRef.get(RedisService);
  ctx = moduleRef.get(RequestContextService);
  outbox = moduleRef.get(NotificationOutbox);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

let userId: string;

beforeEach(async () => {
  await truncateAll(raw);
  // The OTP cooldown, the resend budget and the verify budget all live in Redis
  // and none of them are on the fake clock. Without this flush a test that opens
  // a second request inside the same 60-second window fails on a rate limit that
  // has nothing to do with what it was asserting.
  await redis.client.flushdb();
  outbox.clear();
  clock.advanceTo(new Date('2026-08-26T06:00:00.000Z'));

  const orgId = await makeOrganization({ legal_name: 'Alpha Systems Pvt Ltd' }, raw);
  userId = await makeUser(orgId, { email: OLD_EMAIL, full_name: 'Priya Sharma' }, raw);
  await raw.$executeRaw`
    UPDATE identity.user_account SET mobile = ${OLD_MOBILE} WHERE id = ${userId}::uuid`;
});

/** Run inside a request context, as the guard would establish it. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test', ip: '203.0.113.10', userAgent: 'jest' }, fn);
}

function start(field: 'EMAIL' | 'MOBILE' = 'EMAIL', newValue = NEW_EMAIL) {
  return inRequest(() => contactChange.request(userId, { field, newValue }));
}

/** `noUncheckedIndexedAccess` is on; a row this test asked for and did not get is a bug in the test. */
function only<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

async function currentContact(): Promise<{ email: string | null; mobile: string | null }> {
  return only(
    await raw.$queryRaw<Array<{ email: string | null; mobile: string | null }>>`
      SELECT email::text AS email, mobile FROM identity.user_account WHERE id = ${userId}::uuid`,
  );
}

function auditActions(): Promise<Array<{ action: string; actor_user_id: string | null }>> {
  return raw.$queryRaw`
    SELECT action, actor_user_id::text AS actor_user_id
    FROM identity.audit_log
    WHERE action LIKE 'identity.contact_change%'
    ORDER BY created_at, id`;
}

// ---------------------------------------------------------------------------

describe('opening a request', () => {
  it('sends a code to both addresses and changes nothing yet', async () => {
    const view = await start();

    expect(view.status).toBe('PENDING');
    expect(view.completed).toBe(false);
    expect(view.devCodes?.old).toMatch(/^[0-9]{6}$/);
    expect(view.devCodes?.new).toMatch(/^[0-9]{6}$/);
    // Two codes, two different codes. One code accepted at both ends would make
    // the second proof free for whoever holds the first.
    expect(view.devCodes?.old).not.toBe(view.devCodes?.new);

    expect(outbox.forRecipient(OLD_EMAIL)).toHaveLength(1);
    expect(outbox.forRecipient(NEW_EMAIL)).toHaveLength(1);
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });

  it('never echoes either address in full', async () => {
    const view = await start();
    expect(view.oldValueMasked).not.toContain('alphasystems');
    expect(view.newValueMasked).not.toContain('alphasystems');
    expect(view.oldValueMasked).toContain('*');
  });

  it('records who asked and from where', async () => {
    const view = await start();
    const row = only(
      await raw.$queryRaw<Array<{ ip: string; user_agent: string }>>`
        SELECT host(ip) AS ip, user_agent FROM identity.contact_change_request
        WHERE id = ${view.requestId}::uuid`,
    );
    expect(row).toMatchObject({ ip: '203.0.113.10', user_agent: 'jest' });
  });

  it('refuses an address that already belongs to somebody else', async () => {
    const otherOrg = await makeOrganization({ legal_name: 'Beta Systems Pvt Ltd' }, raw);
    await makeUser(otherOrg, { email: NEW_EMAIL }, raw);
    await expect(start()).rejects.toThrow(/already registered/i);
  });
});

describe('both codes are required', () => {
  it('refuses to complete on the OLD code alone', async () => {
    const view = await start();
    const after = await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!),
    );

    expect(after.oldVerified).toBe(true);
    expect(after.newVerified).toBe(false);
    expect(after.completed).toBe(false);
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });

  /**
   * The one that matters. An attacker on a stolen session owns the new address
   * and can always produce this code; if it were sufficient the account would be
   * theirs and the real owner would be locked out of their own recovery path.
   */
  it('refuses to complete on the NEW code alone', async () => {
    const view = await start();
    const after = await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'NEW', view.devCodes!.new!),
    );

    expect(after.newVerified).toBe(true);
    expect(after.oldVerified).toBe(false);
    expect(after.completed).toBe(false);
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });

  it('will not let the new address’s code stand in for the old one', async () => {
    const view = await start();
    // Same six digits, presented for the other half. The OTP is scope-bound, so
    // this is a wrong code rather than a shortcut.
    await expect(
      inRequest(() => contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.new!)),
    ).rejects.toThrow(/not right|expired/i);
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });

  it('completes once both have landed, in either order', async () => {
    const view = await start();
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'NEW', view.devCodes!.new!),
    );
    const done = await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!),
    );

    expect(done.completed).toBe(true);
    expect(done.status).toBe('COMPLETED');
    expect(await currentContact()).toMatchObject({ email: NEW_EMAIL });

    // The new address is verified by construction — a code just arrived there.
    const row = only(
      await raw.$queryRaw<Array<{ email_verified_at: Date | null }>>`
        SELECT email_verified_at FROM identity.user_account WHERE id = ${userId}::uuid`,
    );
    expect(row.email_verified_at).not.toBeNull();
  });

  it('moves the mobile the same way', async () => {
    const view = await start('MOBILE', NEW_MOBILE);
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!),
    );
    const done = await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'NEW', view.devCodes!.new!),
    );

    expect(done.completed).toBe(true);
    expect(await currentContact()).toMatchObject({ mobile: NEW_MOBILE, email: OLD_EMAIL });
  });
});

describe('the old address is told', () => {
  it('gets the outcome on success, transactionally, with the new address masked', async () => {
    const view = await start();
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!),
    );
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'NEW', view.devCodes!.new!),
    );

    const alert = outbox.forRecipient(OLD_EMAIL).find((m) => m.templateCode.endsWith('ALERT'));
    expect(alert).toBeDefined();
    expect(alert!.variables.outcome).toBe('COMPLETED');
    // Not suppressible: a marketing preference cannot silence a takeover alert.
    expect(alert!.isTransactional).toBe(true);
    expect(alert!.variables.newValue).not.toContain('alphasystems');

    const row = only(
      await raw.$queryRaw<Array<{ notified_old_at: Date | null }>>`
        SELECT notified_old_at FROM identity.contact_change_request
        WHERE id = ${view.requestId}::uuid`,
    );
    expect(row.notified_old_at).not.toBeNull();
  });

  it('gets it on cancellation too — regardless of outcome', async () => {
    const view = await start();
    const cancelled = await inRequest(() =>
      contactChange.cancel(userId, view.requestId, 'Not me.'),
    );

    expect(cancelled.status).toBe('CANCELLED');
    const alert = outbox.forRecipient(OLD_EMAIL).find((m) => m.templateCode.endsWith('ALERT'));
    expect(alert?.variables.outcome).toBe('CANCELLED');
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });
});

describe('wrong codes and stale requests', () => {
  it('burns an attempt on a wrong code, and burns the code on the last one', async () => {
    const view = await start();

    await expect(
      inRequest(() => contactChange.verify(userId, view.requestId, 'OLD', '000000')),
    ).rejects.toThrow(/not right/i);

    const after = only(
      await raw.$queryRaw<Array<{ attempts: number }>>`
        SELECT attempts FROM identity.otp_request
        WHERE purpose = 'CONTACT_CHANGE_OLD' AND target = ${OLD_EMAIL}`,
    );
    expect(after.attempts).toBe(1);

    // Four more wrong guesses exhausts the budget, and the fifth burns the code
    // rather than merely counting it — a code that survives five wrong guesses
    // survives the sixth.
    for (let i = 0; i < 4; i++) {
      await expect(
        inRequest(() => contactChange.verify(userId, view.requestId, 'OLD', '000000')),
      ).rejects.toThrow();
    }
    await expect(
      inRequest(() => contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!)),
    ).rejects.toThrow();
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });

  it('cannot be completed once it has expired, even with both correct codes', async () => {
    const view = await start();
    clock.advanceBy(PAST_EXPIRY_MS);

    await expect(
      inRequest(() => contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!)),
    ).rejects.toThrow(/expired/i);

    const row = only(
      await raw.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM identity.contact_change_request WHERE id = ${view.requestId}::uuid`,
    );
    expect(row.status).toBe('EXPIRED');
    expect(await currentContact()).toMatchObject({ email: OLD_EMAIL });
  });

  it('is not a capability: another user cannot drive it with the id alone', async () => {
    const view = await start();
    const otherOrg = await makeOrganization({ legal_name: 'Beta Systems Pvt Ltd' }, raw);
    const attacker = await makeUser(otherOrg, {}, raw);

    await expect(
      inRequest(() =>
        contactChange.verify(attacker, view.requestId, 'NEW', view.devCodes!.new!),
      ),
    ).rejects.toThrow(/find that contact change request/i);
  });

  it('keeps only one request live, so there is only ever one old-address code', async () => {
    const first = await start();
    await redis.client.flushdb(); // the 60-second resend cooldown, not the rule under test
    const second = await start('EMAIL', 'priya.s@alphasystems.in');

    await expect(
      inRequest(() => contactChange.verify(userId, first.requestId, 'NEW', first.devCodes!.new!)),
    ).rejects.toThrow(/cancelled/i);
    expect(second.status).toBe('PENDING');
  });
});

describe('the audit trail', () => {
  it('records every transition against the actor who caused it', async () => {
    const view = await start();
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!),
    );
    await expect(
      inRequest(() => contactChange.verify(userId, view.requestId, 'NEW', '000000')),
    ).rejects.toThrow();
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'NEW', view.devCodes!.new!),
    );

    const entries = await auditActions();
    expect(entries.map((e) => e.action)).toEqual([
      'identity.contact_change.requested',
      'identity.contact_change.otp_verified',
      'identity.contact_change.otp_failed',
      'identity.contact_change.otp_verified',
      'identity.contact_change.completed',
    ]);
    expect(entries.every((e) => e.actor_user_id === userId)).toBe(true);
  });

  it('records the change with both addresses masked', async () => {
    const view = await start();
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'OLD', view.devCodes!.old!),
    );
    await inRequest(() =>
      contactChange.verify(userId, view.requestId, 'NEW', view.devCodes!.new!),
    );

    const row = only(
      await raw.$queryRaw<Array<{ before_json: unknown; after_json: unknown }>>`
        SELECT before_json, after_json FROM identity.audit_log
        WHERE action = 'identity.contact_change.completed'`,
    );
    expect(JSON.stringify(row)).not.toContain('alphasystems');
  });
});
