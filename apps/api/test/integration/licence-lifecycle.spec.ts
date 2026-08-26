/**
 * Change 6.5 — the DeviceSure licence lifecycle, end to end.
 *
 * Under the self-serve QC model the vendor runs the tool that sets their own
 * payout. That is only defensible because the licence is revocable: revocation
 * *is* the enforcement mechanism the entire quality model rests on, and there is
 * no second control behind it. Suspending a vendor whose agents keep certifying
 * is the failure this file exists to prevent.
 *
 * It goes through the outbox rather than calling the service directly, because
 * the ordering guarantee is half the design: the licence must not be issued
 * until the approval transaction has committed.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { OutboxDispatcher } from '../../src/shared/events/outbox-dispatcher';
import { QcPlatformPort } from '../../src/shared/adapters/ports';
import { FakeQcPlatform } from '../../src/shared/adapters/fakes/infra.fakes';
import { LicenceService } from '../../src/modules/vendor/internal/licence.service';
import {
  closeTestDb,
  migrateTestDatabase,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization } from '../support/factories';

let moduleRef: TestingModule;
let bus: EventBus;
let dispatcher: OutboxDispatcher;
let prisma: PrismaService;
let qc: FakeQcPlatform;
let raw: PrismaClient;

const REVIEWER = '99999999-0000-4000-8000-0000000000ff';

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(new Date('2026-08-26T06:00:00.000Z')) },
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
      { provide: QcPlatformPort, useClass: FakeQcPlatform },
      EventBus,
      OutboxDispatcher,
      LicenceService,
    ],
  }).compile();

  prisma = moduleRef.get(PrismaService);
  bus = moduleRef.get(EventBus);
  dispatcher = moduleRef.get(OutboxDispatcher);
  qc = moduleRef.get(QcPlatformPort);
  moduleRef.get(RequestContextService).run({ requestId: 't', traceId: 't' }, () => undefined);

  // Registers the subscriptions, exactly as Nest does at boot.
  await moduleRef.init();
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

async function aVendorWithProfile(): Promise<string> {
  const orgId = await makeOrganization({ org_type: 'VENDOR' }, raw);
  await raw.$executeRaw`
    INSERT INTO vendor.vendor_profile (org_id, business_category)
    VALUES (${orgId}::uuid, 'REFURBISHER')
    ON CONFLICT (org_id) DO NOTHING`;
  return orgId;
}

async function licenceState(
  orgId: string,
): Promise<{ status: string; key: string | null; qcMode: string }> {
  const [row] = await raw.$queryRaw<
    Array<{ devicesure_status: string; devicesure_licence_key: string | null; qc_mode: string }>
  >`SELECT devicesure_status, devicesure_licence_key, qc_mode
    FROM vendor.vendor_profile WHERE org_id = ${orgId}::uuid`;
  return { status: row!.devicesure_status, key: row!.devicesure_licence_key, qcMode: row!.qc_mode };
}

describe('verification issues a licence', () => {
  it('does not issue until the dispatcher drains', async () => {
    const orgId = await aVendorWithProfile();
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });

    // The whole point of the outbox: publishing is a database write, not a call.
    expect((await licenceState(orgId)).status).toBe('NONE');

    await dispatcher.drain();
    const after = await licenceState(orgId);
    expect(after.status).toBe('ACTIVE');
    expect(after.key).toMatch(/^DS-/);
  });

  it('leaves the vendor SUPERVISED — a licence is not a promotion', async () => {
    const orgId = await aVendorWithProfile();
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();

    // Q15: our expert attends the first listing whatever the licence says. Only
    // QC may promote them to self-serve, by setting first_supervised_visit_at.
    expect((await licenceState(orgId)).qcMode).toBe('SUPERVISED');
  });

  it('is idempotent — a redelivered event does not mint a second key', async () => {
    const orgId = await aVendorWithProfile();
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();
    const first = await licenceState(orgId);

    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();

    // A retry that issued a second licence would leave a revoked vendor holding
    // a working key — the exact hole revocation is supposed to close.
    expect((await licenceState(orgId)).key).toBe(first.key);
  });
});

describe('suspension revokes it', () => {
  it('revokes at DeviceSure and locally', async () => {
    const orgId = await aVendorWithProfile();
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();

    await bus.publish('vendor.suspended', {
      orgId,
      reason: 'Repeated grade corrections',
      suspendedBy: REVIEWER,
      revokeQcLicence: true,
    });
    await dispatcher.drain();

    expect(qc.isRevoked(orgId)).toBe(true);
    const after = await licenceState(orgId);
    expect(after.status).toBe('REVOKED');
    // Reinstatement is not a silent return to self-serve.
    expect(after.qcMode).toBe('SUPERVISED');
  });

  it('honours revokeQcLicence:false — some suspensions are billing, not quality', async () => {
    const orgId = await aVendorWithProfile();
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();

    await bus.publish('vendor.suspended', {
      orgId,
      reason: 'Unpaid platform fee',
      suspendedBy: REVIEWER,
      revokeQcLicence: false,
    });
    await dispatcher.drain();

    expect(qc.isRevoked(orgId)).toBe(false);
    expect((await licenceState(orgId)).status).toBe('ACTIVE');
  });

  it('retries rather than lying when DeviceSure is unreachable', async () => {
    const orgId = await aVendorWithProfile();
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();

    const boom = jest
      .spyOn(qc, 'revokeVendorLicence')
      .mockRejectedValueOnce(new Error('DeviceSure unreachable'));

    await bus.publish('vendor.suspended', {
      orgId,
      reason: 'Repeated grade corrections',
      suspendedBy: REVIEWER,
      revokeQcLicence: true,
    });
    await dispatcher.drain();

    // The one outcome worse than the error: marking it revoked locally while
    // their agents keep certifying. The row must still say ACTIVE.
    expect((await licenceState(orgId)).status).toBe('ACTIVE');
    const [row] = await raw.$queryRaw<Array<{ status: string; attempts: number }>>`
      SELECT status, attempts FROM platform.event_outbox WHERE event_name = 'vendor.suspended'`;
    expect(row!.status).toBe('FAILED');

    boom.mockRestore();
  });
});

describe('a vendor with no profile row', () => {
  it('fails loudly rather than silently skipping the licence', async () => {
    const orgId = await makeOrganization({ org_type: 'VENDOR' }, raw);
    await bus.publish('vendor.verified', { orgId, verifiedBy: REVIEWER });
    await dispatcher.drain();

    // Swallowing this would leave an approved vendor permanently unable to
    // inspect anything, with nothing anywhere saying why.
    const [row] = await raw.$queryRaw<Array<{ status: string; last_error: string | null }>>`
      SELECT status, last_error FROM platform.event_outbox WHERE event_name = 'vendor.verified'`;
    expect(row!.status).toBe('FAILED');
    expect(row!.last_error).toMatch(/No vendor profile/);
  });
});
