/**
 * The transactional outbox.
 *
 * The property under test is the one that makes the whole event system safe:
 * **an event published inside a transaction must not reach a subscriber until
 * that transaction commits.** Get it wrong and a subscriber acts on an order
 * that was rolled back — and the subscriber that matters is the one that raises
 * a purchase order to a vendor or accrues a payable.
 *
 * PHASE_00_FOUNDATION.md Task 4.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { OutboxDispatcher } from '../../src/shared/events/outbox-dispatcher';
import { closeTestDb, migrateTestDatabase, testDatabaseUrl, testDb, truncateAll } from '../support/db';

let moduleRef: TestingModule;
let bus: EventBus;
let dispatcher: OutboxDispatcher;
let prisma: PrismaService;
let clock: FixedClock;
let raw: PrismaClient;

const ORG = '11111111-0000-4000-8000-0000000000aa';

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  clock = new FixedClock(new Date('2026-08-26T06:00:00.000Z'));

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: clock },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          // Point the service at the test database rather than the dev one.
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      EventBus,
      OutboxDispatcher,
    ],
  }).compile();

  prisma = moduleRef.get(PrismaService);
  bus = moduleRef.get(EventBus);
  dispatcher = moduleRef.get(OutboxDispatcher);
  const ctx = moduleRef.get(RequestContextService);
  // Establish a context so the outbox row carries a trace id like it would in a request.
  ctx.run({ requestId: 'test-request', traceId: 'test-trace' }, () => undefined);
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  await raw.$executeRaw`DELETE FROM platform.event_outbox`;
});

describe('publish writes a row; it does not dispatch', () => {
  it('a handler does not run until the dispatcher drains', async () => {
    const seen: string[] = [];
    bus.on('vendor.verified', 'test:collector', async (e) => {
      seen.push(e.payload.orgId);
    });

    await bus.publish('vendor.verified', { orgId: ORG, verifiedBy: ORG });

    // The row exists...
    const pending = await raw.event_outbox.count({ where: { status: 'PENDING' } });
    expect(pending).toBe(1);
    // ...and nothing has been called.
    expect(seen).toEqual([]);

    const result = await dispatcher.drain();
    expect(result.dispatched).toBe(1);
    expect(seen).toEqual([ORG]);
  });
});

describe('a rolled-back transaction publishes nothing', () => {
  it('the outbox row disappears with the rest of the transaction', async () => {
    const seen: string[] = [];
    bus.on('listing.published', 'test:rollback-collector', async (e) => {
      seen.push(e.payload.listingId);
    });

    const listingId = '33333333-0000-4000-8000-000000000001';

    await expect(
      prisma.runInTransaction(async () => {
        await bus.publish('listing.published', {
          listingId,
          skuId: '44444444-0000-4000-8000-000000000001',
          sellableUnitCount: 5,
          partial: false,
        });
        // Something later in the same transaction fails — a PO that cannot be
        // raised, a credit check that comes back short, a constraint violation.
        throw new Error('deliberate failure after publish');
      }),
    ).rejects.toThrow('deliberate failure after publish');

    // No row at all: the INSERT went down with the transaction.
    const count = await raw.event_outbox.count();
    expect(count).toBe(0);

    await dispatcher.drain();
    expect(seen).toEqual([]);
  });

  it('a committed transaction does publish, so the mechanism is not simply broken', async () => {
    const seen: string[] = [];
    bus.on('listing.published', 'test:commit-collector', async (e) => {
      seen.push(e.payload.listingId);
    });

    const listingId = '33333333-0000-4000-8000-000000000002';
    await prisma.runInTransaction(async () => {
      await bus.publish('listing.published', {
        listingId,
        skuId: '44444444-0000-4000-8000-000000000002',
        sellableUnitCount: 5,
        partial: false,
      });
    });

    expect(await raw.event_outbox.count()).toBe(1);
    await dispatcher.drain();
    expect(seen).toEqual([listingId]);
  });
});

describe('a failing handler retries and then dead-letters — it never silently vanishes', () => {
  it('backs off, then lands in DEAD_LETTER with the error retained', async () => {
    bus.on('qc.expired', 'test:always-fails', async () => {
      throw new Error('subscriber exploded');
    });

    await bus.publish('qc.expired', {
      unitId: '55555555-0000-4000-8000-000000000001',
      vendorOrgId: ORG,
      expiredAt: clock.nowIso(),
    });

    // First attempt fails and schedules a retry.
    let result = await dispatcher.drain();
    expect(result.failed).toBe(1);

    let row = await raw.event_outbox.findFirstOrThrow();
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('subscriber exploded');
    expect(row.next_retry_at).not.toBeNull();

    // Nothing is retried before its backoff elapses.
    result = await dispatcher.drain();
    expect(result.dispatched + result.failed).toBe(0);

    // Walk forward through the whole backoff schedule.
    for (let attempt = 2; attempt <= 6; attempt++) {
      clock.advanceBy(25 * 3600 * 1000);
      await dispatcher.drain();
    }

    row = await raw.event_outbox.findFirstOrThrow();
    expect(row.status).toBe('DEAD_LETTER');
    expect(row.attempts).toBeGreaterThanOrEqual(6);
    expect(await dispatcher.deadLetterCount()).toBe(1);
  });

  it('an ops replay puts a dead-lettered event back in the queue', async () => {
    let shouldFail = true;
    const seen: string[] = [];
    bus.on('qc.seal.broken', 'test:flaky', async (e) => {
      if (shouldFail) throw new Error('not yet');
      seen.push(e.payload.sealCode);
    });

    await bus.publish('qc.seal.broken', {
      unitId: '55555555-0000-4000-8000-000000000002',
      sealCode: 'TRG-26HR-0004821',
      detectedAt: clock.nowIso(),
      detectedBy: 'PICKUP',
    });

    for (let i = 0; i < 6; i++) {
      clock.advanceBy(25 * 3600 * 1000);
      await dispatcher.drain();
    }
    expect(await dispatcher.deadLetterCount()).toBe(1);

    // The cause is fixed, and ops replays it.
    shouldFail = false;
    const row = await raw.event_outbox.findFirstOrThrow();
    await dispatcher.replay(row.id);
    const result = await dispatcher.drain();

    expect(result.dispatched).toBe(1);
    expect(seen).toEqual(['TRG-26HR-0004821']);
  });
});

describe('one bad subscriber does not take down the others', () => {
  it('a good handler still runs when a sibling throws, and the row is retried for both', async () => {
    const good: string[] = [];
    bus.on('payment.captured', 'test:good', async (e) => {
      good.push(e.payload.paymentId);
    });
    bus.on('payment.captured', 'test:bad', async () => {
      throw new Error('sibling exploded');
    });

    await bus.publish('payment.captured', {
      paymentId: '66666666-0000-4000-8000-000000000001',
      buyerOrgId: ORG,
      amount: '42000.00',
      rail: 'NEFT_RTGS',
      gatewayRef: null,
    });

    const result = await dispatcher.drain();
    expect(good).toHaveLength(1);
    expect(result.failed).toBe(1);

    const row = await raw.event_outbox.findFirstOrThrow();
    expect(row.last_error).toContain('test:bad');
    expect(row.last_error).not.toContain('test:good');
  });
});

describe('a malformed payload fails where it was written, not where it was read', () => {
  it('refuses to publish an event that does not match its schema', async () => {
    await expect(
      // Missing `verifiedBy`, which the schema requires.
      bus.publish('vendor.verified', { orgId: ORG } as never),
    ).rejects.toThrow(/Refusing to publish a malformed vendor.verified/);

    expect(await raw.event_outbox.count()).toBe(0);
  });

  it('rejects an id that is not a uuid, rather than storing it for a subscriber to trip over', async () => {
    await expect(
      bus.publish('vendor.verified', { orgId: 'not-a-uuid', verifiedBy: ORG } as never),
    ).rejects.toThrow(/orgId/);
  });
});
