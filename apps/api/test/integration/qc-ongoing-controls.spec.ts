/**
 * Task 10's three ongoing controls, against the real database.
 *
 * Everything here depends on something only Postgres does: `trg_recompute_sellable`
 * deriving `is_sellable`, `trg_listing_counters` rewriting the listing's counts,
 * the CHECK vocabulary on `qc_reverification`, and a DATE column read on the
 * IST calendar. A fake would pass all of it and prove nothing.
 *
 * The property under test in every case is the same one: **a machine we can no
 * longer stand behind must stop being sellable without anybody remembering to
 * make it stop.**
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { EventBus } from '../../src/shared/events/event-bus';
import { NotificationPort } from '../../src/shared/adapters/ports';
import { RequestContextService } from '../../src/shared/db/org-scope';
import { QcRepository } from '../../src/modules/qc/internal/qc.repository';
import { QcExpiryService } from '../../src/modules/qc/internal/qc-expiry.service';
import { ReverificationService } from '../../src/modules/qc/internal/reverification.service';
import { AuditRecheckService } from '../../src/modules/qc/internal/audit-recheck.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { seedSellableUnit } from '../support/factories';

/**
 * 09:00 IST TODAY. Every window in this suite is reckoned from here.
 *
 * The date has to track the real one. `seedSellableUnit` writes qc_valid_until
 * relative to the DATABASE's CURRENT_DATE, while the service reads this fake
 * clock — so a hardcoded instant agreed with the database on exactly one day and
 * silently disagreed by one row afterwards. Pinning the day was hiding a
 * disagreement rather than removing one: the fixed TIME is what these tests
 * actually need, because the windows are reckoned in IST and a run at 23:00 UTC
 * would otherwise land on the following IST day.
 */
const NOW = (() => {
  const [y, m, d] = new Date().toISOString().slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 3, 30, 0));
})();

let moduleRef: TestingModule;
let raw: PrismaClient;
let clock: FixedClock;
let expiry: QcExpiryService;
let reverification: ReverificationService;
let recheck: AuditRecheckService;
let sent: Array<{ to: string; templateCode: string; variables: Record<string, string> }>;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  clock = new FixedClock(NOW);
  sent = [];

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule],
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
      RequestContextService,
      EventBus,
      {
        provide: NotificationPort,
        useValue: {
          send: async (req: { to: string; templateCode: string; variables: Record<string, string> }) => {
            sent.push(req);
            return { providerMessageId: 'fake-' + sent.length, accepted: true };
          },
        },
      },
      QcRepository,
      QcExpiryService,
      ReverificationService,
      AuditRecheckService,
    ],
  }).compile();

  expiry = moduleRef.get(QcExpiryService);
  reverification = moduleRef.get(ReverificationService);
  recheck = moduleRef.get(AuditRecheckService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  clock.advanceTo(NOW);
  sent.length = 0;
});

describe('90-day expiry', () => {
  it('unlists a unit the day after its report ran out, and leaves the trail', async () => {
    // Valid through today, so the trigger computed is_sellable = TRUE on insert.
    const unit = await seedSellableUnit({ qcValidUntilDays: 0 }, raw);

    const before = await raw.$queryRaw<Array<{ is_sellable: boolean; status: string }>>`
      SELECT is_sellable, status::text FROM listing.unit WHERE id = ${unit.unitId}::uuid`;
    expect(before[0]!.is_sellable).toBe(true);

    // Nothing has touched the row, so `is_sellable` is still TRUE the morning
    // after it stopped being true. That staleness is the whole reason the job
    // exists — the trigger only fires on a write.
    clock.advanceDays(1);
    const expired = await expiry.expireDue();
    expect(expired).toEqual([unit.unitId]);

    const after = await raw.$queryRaw<Array<{ is_sellable: boolean; status: string }>>`
      SELECT is_sellable, status::text FROM listing.unit WHERE id = ${unit.unitId}::uuid`;
    expect(after[0]!.status).toBe('QC_EXPIRED');
    // Never written by hand — `trg_recompute_sellable` derived it from the status.
    expect(after[0]!.is_sellable).toBe(false);

    const trail = await raw.$queryRaw<Array<{ to_status: string; ref_type: string }>>`
      SELECT to_status::text, ref_type FROM listing.stock_movement
       WHERE unit_id = ${unit.unitId}::uuid AND to_status = 'QC_EXPIRED'`;
    expect(trail).toHaveLength(1);
    expect(trail[0]!.ref_type).toBe('QC_EXPIRY');
  });

  it('leaves a unit alone on its last valid day', async () => {
    const unit = await seedSellableUnit({ qcValidUntilDays: 0 }, raw);
    expect(await expiry.expireDue()).toEqual([]);

    const row = await raw.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM listing.unit WHERE id = ${unit.unitId}::uuid`;
    expect(row[0]!.status).toBe('LISTED');
  });

  it('warns the vendor once, fourteen days out, with the count and the date', async () => {
    const unit = await seedSellableUnit({ qcValidUntilDays: 14 }, raw);
    await raw.$executeRaw`
      INSERT INTO identity.org_contact
        (org_id, contact_type, full_name, mobile, is_primary, is_active)
      VALUES (${unit.vendorOrgId}::uuid, 'WAREHOUSE', 'Warehouse Desk', '919810000001', TRUE, TRUE)`;

    const warned = await expiry.warnExpiring();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ unitsExpiring: 1, notified: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.variables.units).toBe('1');

    // A row in the log, so "the vendor was warned" is a fact somebody can look
    // up rather than a belief about a cron job.
    const logged = await raw.$queryRaw<Array<{ template_code: string; status: string }>>`
      SELECT template_code, status FROM platform.notification_log
       WHERE org_id = ${unit.vendorOrgId}::uuid`;
    expect(logged).toHaveLength(1);
    expect(logged[0]!.status).toBe('SENT');

    // The next day the unit is thirteen days out and is not warned again.
    sent.length = 0;
    clock.advanceDays(1);
    expect(await expiry.warnExpiring()).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('re-verification at pickup', () => {
  it('clears a machine whose seal and serial both check out', async () => {
    const unit = await seedSellableUnit({}, raw);
    const [seal] = await raw.$queryRaw<Array<{ seal_code: string }>>`
      SELECT seal_code FROM qc.qc_seal WHERE unit_id = ${unit.unitId}::uuid`;

    const result = await reverification.verifyAtPickup({
      unitId: unit.unitId,
      sealCodeScanned: seal!.seal_code,
      // Lower case with a stray hyphen, as a scanner or a thumb produces it.
      serialScanned: unit.serial.toLowerCase().replace(/^(.{4})/, '$1-'),
    });

    expect(result.outcome).toBe('PASS');
    expect(result.sealIntact).toBe(true);
    expect(result.serialMatches).toBe(true);
    expect(result.reverification).not.toBeNull();
    expect(result.reverification!.trigger).toBe('DISPATCH_PICKUP');
    expect(result.reverification!.method).toBe('SEAL_CHECK');

    const [after] = await raw.$queryRaw<Array<{ status: string; verified_at: Date | null }>>`
      SELECT status::text, verified_at FROM qc.qc_seal WHERE unit_id = ${unit.unitId}::uuid`;
    expect(after!.status).toBe('INTACT');
    expect(after!.verified_at).not.toBeNull();
  });

  it('rejects outright when the serial under the seal is a different machine', async () => {
    const unit = await seedSellableUnit({}, raw);
    const [seal] = await raw.$queryRaw<Array<{ seal_code: string }>>`
      SELECT seal_code FROM qc.qc_seal WHERE unit_id = ${unit.unitId}::uuid`;

    const result = await reverification.verifyAtPickup({
      unitId: unit.unitId,
      sealCodeScanned: seal!.seal_code,
      serialScanned: 'NOTTHISLAPTOP',
    });

    // FAIL_REJECT, not FAIL_RESEND_TO_QC: re-running QC on the wrong machine
    // answers the wrong question (QC-012).
    expect(result.outcome).toBe('FAIL_REJECT');
    expect(result.reverification!.serialMatches).toBe(false);
    // Recorded either way. The refusal is only defensible three months later if
    // the scan that produced it is on the record.
    expect(result.reverification!.serialScanned).toBe('NOTTHISLAPTOP');
  });

  it('breaks the seal and raises the event when the sticker does not match', async () => {
    const unit = await seedSellableUnit({}, raw);

    const result = await reverification.verifyAtPickup({
      unitId: unit.unitId,
      sealCodeScanned: 'TRG-0000-0000000',
      serialScanned: unit.serial,
    });

    expect(result.outcome).toBe('FAIL_RESEND_TO_QC');

    const [seal] = await raw.$queryRaw<Array<{ status: string; broken_reason: string }>>`
      SELECT status::text, broken_reason FROM qc.qc_seal WHERE unit_id = ${unit.unitId}::uuid`;
    expect(seal!.status).toBe('BROKEN');

    const outbox = await raw.$queryRaw<Array<{ event_name: string }>>`
      SELECT event_name FROM platform.event_outbox WHERE event_name = 'qc.seal.broken'`;
    expect(outbox).toHaveLength(1);
  });
});

describe('audit recheck sampling', () => {
  it('is deterministic, so a retried ingestion cannot change the answer', async () => {
    const id = '3f1a6c88-4d2b-4c9e-9f10-6b1c2d3e4f50';
    const first = await recheck.isSelectedForRecheck(id);
    for (let i = 0; i < 5; i++) {
      expect(await recheck.isSelectedForRecheck(id)).toBe(first);
    }
  });

  it('samples somewhere near the configured percentage', async () => {
    const ids = Array.from(
      { length: 2000 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const selected = (await Promise.all(ids.map((id) => recheck.isSelectedForRecheck(id)))).filter(
      Boolean,
    ).length;
    // Seeded at 5%. A hash bucket is not a coin, but it is uniform enough that a
    // band this wide only fails if the selection is actually broken.
    expect(selected / ids.length).toBeGreaterThan(0.02);
    expect(selected / ids.length).toBeLessThan(0.09);
  });
});
