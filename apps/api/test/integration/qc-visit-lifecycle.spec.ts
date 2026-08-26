/**
 * Scheduling, sealing and closing a vendor-site visit, against the real database.
 *
 * The headline assertion is the phase's first rule: **a failed unit is absent
 * from the storefront.** Not dimmed, not out-of-stock, not filtered out by a
 * flag a later query might forget — absent from `listing.v_sellable_unit`, which
 * is the only source a buyer-facing query is allowed to read. Two units pass,
 * one fails, the visit closes, and the buyer-facing query returns two rows.
 *
 * Everything else here is a property that only Postgres or the interaction
 * between these three services can demonstrate: the seal photograph being
 * structurally required, `licence_seats` NULL meaning "no cap" rather than zero,
 * geo variance on arrival, and a close that refuses rather than half-lists.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Money } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { OtpService } from '../../src/modules/identity/internal/otp.service';
import { QcRepository } from '../../src/modules/qc/internal/qc.repository';
import { SchedulingService } from '../../src/modules/qc/internal/scheduling.service';
import { SealingService } from '../../src/modules/qc/internal/sealing.service';
import { VisitClosingService } from '../../src/modules/qc/internal/visit-closing.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import {
  makeAddress,
  makeCatalog,
  makeListing,
  makeOrganization,
  makeTechnician,
} from '../support/factories';

/** A Wednesday, so `facility_hours` for a normal working weekday applies. */
const NOW = new Date('2026-09-02T04:00:00.000Z');
const VISIT_DATE = '2026-09-03';

/** Udyog Vihar Phase IV, Gurugram — the address `makeAddress` writes. */
const SITE_LAT = 28.4949;
const SITE_LNG = 77.0873;

let moduleRef: TestingModule;
let raw: PrismaClient;
let redis: RedisService;
let ctx: RequestContextService;
let repo: QcRepository;
let scheduling: SchedulingService;
let sealing: SealingService;
let closing: VisitClosingService;

let vendorOrgId: string;
let addressId: string;
let facilityId: string;
let skuId: string;
let listingId: string;
let technicianId: string;
let providerId: string;
let visitId: string;

let sealCounter = 0;
const nextSealCode = (): string => `TRG-26HR-${String(++sealCounter).padStart(7, '0')}`;

/** Run inside a request context: `EventBus.publish` reads one for the trace id. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test' }, fn);
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule, AdaptersModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(NOW) },
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
      EventBus,
      OtpService,
      QcRepository,
      SchedulingService,
      SealingService,
      VisitClosingService,
    ],
  }).compile();

  await moduleRef.init();
  redis = moduleRef.get(RedisService);
  ctx = moduleRef.get(RequestContextService);
  repo = moduleRef.get(QcRepository);
  scheduling = moduleRef.get(SchedulingService);
  sealing = moduleRef.get(SealingService);
  closing = moduleRef.get(VisitClosingService);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  await redis.client.flushdb();

  vendorOrgId = await makeOrganization({}, raw);
  addressId = await makeAddress(vendorOrgId, {}, raw);
  await raw.$executeRaw`
    UPDATE identity.org_address
       SET latitude = ${String(SITE_LAT)}::numeric, longitude = ${String(SITE_LNG)}::numeric
     WHERE id = ${addressId}::uuid`;
  await raw.$executeRaw`
    INSERT INTO identity.pincode_master (pincode, district, state, state_code, zone, is_metro, is_ncr)
    VALUES ('122015', 'Gurugram', 'Haryana', '06', 'NORTH', TRUE, TRUE)
    ON CONFLICT (pincode) DO NOTHING`;
  await raw.$executeRaw`
    INSERT INTO identity.org_contact (org_id, contact_type, full_name, mobile, is_primary)
    VALUES (${vendorOrgId}::uuid, 'WAREHOUSE', 'Suresh Nair', '+919812345678', TRUE)`;

  const [facility] = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
    VALUES (${vendorOrgId}::uuid, ${addressId}::uuid, 'WAREHOUSE')
    RETURNING id`;
  facilityId = facility!.id;
  // Open 09:00–18:00 every day, so the weekday arithmetic is not what a
  // scheduling test is accidentally asserting.
  for (let dow = 0; dow < 7; dow++) {
    await raw.$executeRaw`
      INSERT INTO vendor.facility_hours (facility_id, day_of_week, open_time, close_time)
      VALUES (${facilityId}::uuid, ${dow}, '09:00', '18:00')`;
  }

  ({ skuId } = await makeCatalog({}, raw));
  listingId = await makeListing(
    { vendorOrgId, skuId, pickupAddressId: addressId, qty: 3, status: 'AWAITING_QC' },
    raw,
  );

  ({ technicianId } = await makeTechnician(raw));
  await repo.upsertAvailability(technicianId, [
    { theDate: VISIT_DATE, slotFrom: '09:00:00', slotTo: '18:00:00' },
  ]);

  providerId = (await repo.findToolProviderByCode('DEVICESURE'))!.id;
  sealCounter = 0;
});

/**
 * A unit the verdict lane has already decided on: QC_PASSED with one current,
 * unexpired report. Everything from here is this lane's work.
 */
async function inspectedUnit(
  verdict: 'PASS' | 'FAIL',
): Promise<{ unitId: string; reportId: string; serial: string }> {
  const unitId = randomUUID();
  const reportId = randomUUID();
  const serial = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const status = verdict === 'PASS' ? 'QC_PASSED' : 'QC_FAILED';

  await raw.$executeRaw`
    INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                              grade_declared, grade_actual, status, location,
                              qc_passed_at, qc_valid_until, qc_score)
    VALUES (${unitId}::uuid, ${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid, ${serial},
            'A'::grade_type, 'A'::grade_type, ${status}::unit_status, 'VENDOR',
            ${verdict === 'PASS' ? NOW : null},
            ${verdict === 'PASS' ? '2026-12-01' : null}::date,
            ${verdict === 'PASS' ? 92 : 41})`;

  await raw.$executeRaw`
    INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                              started_at, completed_at, signature, nonce, grade_proposed,
                              grade_final, qc_score, verdict, valid_until, is_current,
                              verification_code)
    VALUES (${reportId}::uuid, ${unitId}::uuid, ${technicianId}::uuid,
            ${'CERT-' + reportId.slice(0, 8)}, '0.1.0',
            ${NOW}, ${NOW}, ${'sig_' + reportId}, ${randomUUID()},
            'A'::grade_type, 'A'::grade_type, ${verdict === 'PASS' ? 92 : 41},
            ${verdict}::qc_verdict, '2026-12-01'::date, TRUE,
            ${reportId.replace(/-/g, '').slice(0, 14).toUpperCase()})`;

  return { unitId, reportId, serial };
}

/** A visit at REQUESTED with the given units on its manifest. */
async function visitWith(units: Array<{ unitId: string; serial: string }>): Promise<string> {
  const visit = await repo.createVisit({
    visitNumber: `QCV-TEST-${randomUUID().slice(0, 8).toUpperCase()}`,
    vendorOrgId,
    facilityId,
    addressId,
    unitsRequested: units.length,
    toolProviderId: providerId,
  });
  await repo.addVisitUnits(
    visit.id,
    units.map((u, i) => ({
      unitId: u.unitId,
      serialNumber: u.serial,
      listingId,
      sequenceNo: i + 1,
    })),
  );
  return visit.id;
}

/** Schedule, set off, arrive. The three steps before anything is inspected. */
async function arrive(id: string): Promise<void> {
  await scheduling.schedule(id, {
    scheduledDate: VISIT_DATE,
    slotFrom: '09:00',
    slotTo: '18:00',
    technicianId,
  });
  await scheduling.advance(id, 'EN_ROUTE');
  await scheduling.checkIn(id, { latitude: SITE_LAT, longitude: SITE_LNG });
}

async function setOutcome(id: string, unitId: string, outcome: string): Promise<void> {
  const rows = await repo.findVisitUnits({ visitId: id });
  const row = rows.find((r) => r.unitId === unitId)!;
  await repo.updateVisitUnit(row.id, { outcome: outcome as never, completedAt: NOW });
}

async function signAndClose(id: string) {
  const request = await inRequest(() => closing.requestSignoff(id));
  await inRequest(() => closing.signOff(id, { code: request.devCode!, signedName: 'Suresh Nair' }));
  return inRequest(() => closing.close(id));
}

// ---------------------------------------------------------------------------
// The rule this phase exists for
// ---------------------------------------------------------------------------

describe('a failed unit is absent from the storefront', () => {
  it('lists only the passed units after the visit closes', async () => {
    const passA = await inspectedUnit('PASS');
    const passB = await inspectedUnit('PASS');
    const fail = await inspectedUnit('FAIL');
    visitId = await visitWith([passA, passB, fail]);
    await arrive(visitId);

    await setOutcome(visitId, passA.unitId, 'PASS');
    await setOutcome(visitId, passB.unitId, 'PASS');
    await setOutcome(visitId, fail.unitId, 'FAIL');

    for (const u of [passA, passB]) {
      await inRequest(() =>
        sealing.applySeal({
          unitId: u.unitId,
          qcReportId: u.reportId,
          sealCode: nextSealCode(),
          appliedBy: technicianId,
          appliedPhotoKey: `qc/seals/${u.unitId}.jpg`,
        }),
      );
    }

    const result = await signAndClose(visitId);

    expect(result.visit.status).toBe('PARTIALLY_COMPLETED');
    expect(result.unitsListed).toBe(2);
    expect(result.unitsFailed).toBe(1);
    expect(result.listings).toEqual([
      expect.objectContaining({ listingId, status: 'PARTIALLY_ACTIVE', sellableUnits: 2 }),
    ]);

    // THE assertion. `listing.v_sellable_unit` is the only unit source a
    // customer-facing query may read, and the failed machine is not in it —
    // there is no row to dim and no flag to remember to filter on.
    const sellable = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.v_sellable_unit WHERE listing_id = ${listingId}::uuid`;
    expect(sellable.map((r) => r.id).sort()).toEqual([passA.unitId, passB.unitId].sort());
    expect(sellable.map((r) => r.id)).not.toContain(fail.unitId);
  });

  it('pauses a listing whose whole batch failed rather than calling it out of stock', async () => {
    const fail = await inspectedUnit('FAIL');
    visitId = await visitWith([fail]);
    await arrive(visitId);
    await setOutcome(visitId, fail.unitId, 'FAIL');

    const result = await signAndClose(visitId);

    expect(result.listings[0]!.status).toBe('PAUSED');
    expect(result.listings[0]!.sellableUnits).toBe(0);
    const sellable = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.v_sellable_unit WHERE listing_id = ${listingId}::uuid`;
    expect(sellable).toHaveLength(0);
  });

  it('marks the visit COMPLETED and the listing ACTIVE when everything passes', async () => {
    const unit = await inspectedUnit('PASS');
    visitId = await visitWith([unit]);
    await arrive(visitId);
    await setOutcome(visitId, unit.unitId, 'PASS');
    await inRequest(() =>
      sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: nextSealCode(),
        appliedBy: technicianId,
        appliedPhotoKey: `qc/seals/${unit.unitId}.jpg`,
      }),
    );

    const result = await signAndClose(visitId);
    expect(result.visit.status).toBe('COMPLETED');
    expect(result.listings[0]!.status).toBe('ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

describe('sealing', () => {
  it('cannot record a seal without a photograph', async () => {
    const unit = await inspectedUnit('PASS');
    await expect(
      sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: nextSealCode(),
        appliedBy: technicianId,
        appliedPhotoKey: '   ',
      }),
    ).rejects.toThrow(/photograph/i);

    const seals = await repo.findSealsByUnit(unit.unitId);
    expect(seals).toHaveLength(0);
  });

  it('refuses a seal on a failed inspection', async () => {
    const unit = await inspectedUnit('FAIL');
    await expect(
      sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: nextSealCode(),
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/x.jpg',
      }),
    ).rejects.toThrow(/passed machine/i);
  });

  it('refuses a seal code that is not from one of our rolls', async () => {
    const unit = await inspectedUnit('PASS');
    await expect(
      sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: 'ZZZ-26HR-0000009',
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/x.jpg',
      }),
    ).rejects.toThrow(/TRG-/);
  });

  it('takes a unit off the storefront the moment its seal is broken', async () => {
    const unit = await inspectedUnit('PASS');
    visitId = await visitWith([unit]);
    await arrive(visitId);
    await setOutcome(visitId, unit.unitId, 'PASS');
    const sealCode = nextSealCode();
    await inRequest(() =>
      sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode,
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/x.jpg',
      }),
    );
    await signAndClose(visitId);

    const before = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.v_sellable_unit WHERE id = ${unit.unitId}::uuid`;
    expect(before).toHaveLength(1);

    await inRequest(() =>
      sealing.reportBroken({ sealCode, reason: 'Seal torn at pickup', detectedBy: 'PICKUP' }),
    );

    const after = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.v_sellable_unit WHERE id = ${unit.unitId}::uuid`;
    expect(after).toHaveLength(0);

    // BROKEN is terminal, and the event logistics needs is on the outbox.
    await expect(sealing.verifyIntact({ sealCode, verifiedBy: randomUUID() })).rejects.toThrow(
      /current status/i,
    );
    const [event] = await raw.$queryRaw<Array<{ event_name: string }>>`
      SELECT event_name FROM platform.event_outbox WHERE event_name = 'qc.seal.broken'`;
    expect(event?.event_name).toBe('qc.seal.broken');
  });

  it('chains a replacement seal to the one it replaces', async () => {
    const unit = await inspectedUnit('PASS');
    const first = nextSealCode();
    await inRequest(() =>
      sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: first,
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/1.jpg',
      }),
    );
    const second = nextSealCode();
    const { replaced, applied } = await inRequest(() =>
      sealing.replaceSeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: second,
        supersedesSealCode: first,
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/2.jpg',
        reason: 'Sticker lifted in transit handling',
      }),
    );

    expect(replaced.status).toBe('REPLACED');
    expect(replaced.replacedBySealId).toBe(applied.id);
    expect(await sealing.currentSeal(unit.unitId)).toMatchObject({ sealCode: second });
  });
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

describe('scheduling', () => {
  beforeEach(async () => {
    // `licence_seats` lives on the SEEDED DEVICESURE provider, and truncateAll
    // does not touch reference data — so the seat-cap test below leaves it at 1
    // permanently. That made this block pass exactly once per fresh database and
    // fail on every rerun, which reads as a flaky suite rather than as a test
    // that forgot to put the world back. Reset it here rather than in an
    // afterEach: a test that fails mid-way still has to leave a clean provider
    // behind for the next one.
    await raw.$executeRaw`
      UPDATE qc.qc_tool_provider SET licence_seats = NULL WHERE id = ${providerId}::uuid`;

    const unit = await inspectedUnit('PASS');
    visitId = await visitWith([unit]);
  });

  it('treats a NULL licence_seats as no cap rather than zero seats', async () => {
    const [provider] = await raw.$queryRaw<Array<{ licence_seats: number | null }>>`
      SELECT licence_seats FROM qc.qc_tool_provider WHERE id = ${providerId}::uuid`;
    expect(provider!.licence_seats).toBeNull();

    const visit = await scheduling.schedule(visitId, {
      scheduledDate: VISIT_DATE,
      slotFrom: '09:00',
      slotTo: '18:00',
      technicianId,
    });
    expect(visit.status).toBe('TECH_ASSIGNED');
  });

  it('refuses a technician when every licence seat is already in use', async () => {
    await raw.$executeRaw`
      UPDATE qc.qc_tool_provider SET licence_seats = 1 WHERE id = ${providerId}::uuid`;

    // Another technician is already out with the only seat.
    const other = await makeTechnician(raw);
    const otherVisit = await repo.createVisit({
      visitNumber: `QCV-SEAT-${randomUUID().slice(0, 8).toUpperCase()}`,
      vendorOrgId,
      facilityId,
      addressId,
      unitsRequested: 1,
      toolProviderId: providerId,
      technicianId: other.technicianId,
      scheduledDate: VISIT_DATE,
      status: 'TECH_ASSIGNED',
    });
    expect(otherVisit.id).toBeDefined();

    await expect(
      scheduling.schedule(visitId, {
        scheduledDate: VISIT_DATE,
        slotFrom: '09:00',
        slotTo: '18:00',
        technicianId,
      }),
    ).rejects.toThrow(/licence seats/i);
  });

  it('refuses a day the site is closed', async () => {
    await raw.$executeRaw`
      INSERT INTO vendor.facility_holiday (facility_id, holiday_date, reason)
      VALUES (${facilityId}::uuid, ${VISIT_DATE}::date, 'Ganesh Chaturthi')`;

    await expect(
      scheduling.schedule(visitId, {
        scheduledDate: VISIT_DATE,
        slotFrom: '09:00',
        slotTo: '18:00',
        technicianId,
      }),
    ).rejects.toThrow(/closed/i);
  });

  it('refuses a slot outside the site’s opening hours', async () => {
    await expect(
      scheduling.schedule(visitId, {
        scheduledDate: VISIT_DATE,
        slotFrom: '07:00',
        slotTo: '09:00',
        technicianId,
      }),
    ).rejects.toThrow(/opens at 09:00/i);
  });

  it('refuses a technician over their daily unit capacity', async () => {
    await raw.$executeRaw`
      UPDATE qc.qc_visit SET units_requested = 39 WHERE id = ${visitId}::uuid`;
    await repo.createVisit({
      visitNumber: `QCV-LOAD-${randomUUID().slice(0, 8).toUpperCase()}`,
      vendorOrgId,
      facilityId,
      addressId,
      unitsRequested: 5,
      toolProviderId: providerId,
      technicianId,
      scheduledDate: VISIT_DATE,
      status: 'TECH_ASSIGNED',
    });

    await expect(
      scheduling.schedule(visitId, {
        scheduledDate: VISIT_DATE,
        slotFrom: '09:00',
        slotTo: '18:00',
        technicianId,
      }),
    ).rejects.toThrow(/40-unit day/);
  });

  it('offers only slots the booking path would accept', async () => {
    const slots = await scheduling.findSlots(visitId, { from: VISIT_DATE, to: '2026-09-10' });
    expect(slots).toEqual([
      expect.objectContaining({ technicianId, scheduledDate: VISIT_DATE, slotFrom: '09:00:00' }),
    ]);
  });

  it('records geo variance on arrival and flags a check-in far from the site', async () => {
    await scheduling.schedule(visitId, {
      scheduledDate: VISIT_DATE,
      slotFrom: '09:00',
      slotTo: '18:00',
      technicianId,
    });
    await scheduling.advance(visitId, 'EN_ROUTE');

    // ~2.2 km north of the registered warehouse.
    const result = await scheduling.checkIn(visitId, {
      latitude: SITE_LAT + 0.02,
      longitude: SITE_LNG,
    });

    expect(result.alerted).toBe(true);
    expect(result.geoVarianceMetres).toBeGreaterThan(500);
    expect(result.visit.status).toBe('IN_PROGRESS');
    // Recorded on every check-in, not only the suspicious ones — a variance is
    // only interpretable against the distribution of all the others.
    expect(result.visit.geoVarianceMetres).toBe(result.geoVarianceMetres);
  });

  it('refuses a status move the lifecycle does not allow', async () => {
    await expect(scheduling.advance(visitId, 'IN_PROGRESS')).rejects.toThrow(/current status/i);
  });

  it('gives the slot back when a visit is cancelled', async () => {
    await scheduling.schedule(visitId, {
      scheduledDate: VISIT_DATE,
      slotFrom: '09:00',
      slotTo: '18:00',
      technicianId,
    });
    const booked = await repo.findAvailability({
      technicianIds: [technicianId],
      from: VISIT_DATE,
      to: VISIT_DATE,
    });
    expect(booked[0]!.status).toBe('BOOKED');

    await scheduling.advance(visitId, 'CANCELLED', { reason: 'Vendor postponed the batch' });
    const freed = await repo.findAvailability({
      technicianIds: [technicianId],
      from: VISIT_DATE,
      to: VISIT_DATE,
    });
    expect(freed[0]!.status).toBe('AVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

describe('sampling', () => {
  it('falls back to full inspection when the tier has not earned the discount', async () => {
    const a = await inspectedUnit('PASS');
    const b = await inspectedUnit('PASS');
    visitId = await visitWith([a, b]);
    await raw.$executeRaw`
      UPDATE identity.organization SET tier = 'PLATINUM'::vendor_tier WHERE id = ${vendorOrgId}::uuid`;
    // The rule is published here rather than relied on from the seed.
    // `qc_sampling_rule` is one of the tables `truncateAll` deliberately
    // preserves, so any suite that writes to it leaks into every later suite —
    // and one already deletes the seeded PLATINUM row.
    await repo.upsertSamplingRule({
      vendorTier: 'PLATINUM',
      effectiveFrom: '2026-08-26',
      minUnitsInspected: 5000,
      minPassRate: 98.5,
      minGradeAccuracy: 99.0,
      samplePct: 25,
      alwaysFullAboveValue: Money.parse('5000000'),
    });

    // PLATINUM's rule wants 5,000 units inspected. This vendor has none, so the
    // 25% discount is not theirs yet however the tier column reads.
    const plan = await scheduling.planSample(visitId);
    expect(plan.tier).toBe('PLATINUM');
    expect(plan.samplePct).toBe(100);
    expect(plan.fullInspection).toBe(true);
    expect(plan.reason).toMatch(/5000/);
    expect(plan.unitIds.sort()).toEqual([a.unitId, b.unitId].sort());
  });

  it('samples when the vendor genuinely meets the rule', async () => {
    const units = [];
    for (let i = 0; i < 4; i++) units.push(await inspectedUnit('PASS'));
    visitId = await visitWith(units);

    await raw.$executeRaw`
      UPDATE identity.organization SET tier = 'GOLD'::vendor_tier WHERE id = ${vendorOrgId}::uuid`;
    await repo.upsertVendorQuality(vendorOrgId, {
      unitsInspected: 3000,
      gradeCorrections: 10,
      gradeAccuracyPct: 99.5,
    });
    await raw.$executeRaw`
      INSERT INTO platform.vendor_scorecard
        (vendor_org_id, period_start, period_end, qc_pass_rate, grade_accuracy, units_in_period)
      VALUES (${vendorOrgId}::uuid, '2026-08-01'::date, '2026-08-31'::date, 99.0, 99.5, 400)`;

    const plan = await scheduling.planSample(visitId);
    expect(plan.samplePct).toBe(50);
    expect(plan.unitsToInspect).toBe(2);
    expect(plan.unitIds).toHaveLength(2);
    expect(plan.fullInspection).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe('closing the visit', () => {
  it('refuses to close before the vendor has signed off', async () => {
    const unit = await inspectedUnit('FAIL');
    visitId = await visitWith([unit]);
    await arrive(visitId);
    await setOutcome(visitId, unit.unitId, 'FAIL');

    await expect(inRequest(() => closing.close(visitId))).rejects.toThrow(/sign off/i);
  });

  it('refuses to close while a machine still has no outcome', async () => {
    const a = await inspectedUnit('PASS');
    const b = await inspectedUnit('PASS');
    visitId = await visitWith([a, b]);
    await arrive(visitId);
    await setOutcome(visitId, a.unitId, 'PASS');
    await inRequest(() =>
      sealing.applySeal({
        unitId: a.unitId,
        qcReportId: a.reportId,
        sealCode: nextSealCode(),
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/a.jpg',
      }),
    );

    const request = await inRequest(() => closing.requestSignoff(visitId));
    await inRequest(() =>
      closing.signOff(visitId, { code: request.devCode!, signedName: 'Suresh Nair' }),
    );
    await expect(inRequest(() => closing.close(visitId))).rejects.toThrow(/no outcome yet/i);
  });

  it('refuses to list a machine that passed but was never sealed', async () => {
    const unit = await inspectedUnit('PASS');
    visitId = await visitWith([unit]);
    await arrive(visitId);
    await setOutcome(visitId, unit.unitId, 'PASS');

    await expect(signAndClose(visitId)).rejects.toThrow(/not sealed/i);

    // Nothing half-happened: the unit is still QC_PASSED and not sellable.
    const [row] = await raw.$queryRaw<Array<{ status: string; is_sellable: boolean }>>`
      SELECT status, is_sellable FROM listing.unit WHERE id = ${unit.unitId}::uuid`;
    expect(row!.status).toBe('QC_PASSED');
    expect(row!.is_sellable).toBe(false);
  });

  it('stores a hash of the sign-off code and never the code itself', async () => {
    const unit = await inspectedUnit('FAIL');
    visitId = await visitWith([unit]);
    await arrive(visitId);
    await setOutcome(visitId, unit.unitId, 'FAIL');

    const request = await inRequest(() => closing.requestSignoff(visitId));
    expect(request.sentTo).not.toContain('9812345678');
    const signed = await inRequest(() =>
      closing.signOff(visitId, { code: request.devCode!, signedName: 'Suresh Nair' }),
    );

    expect(signed.vendorSignoffName).toBe('Suresh Nair');
    expect(signed.vendorOtpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.vendorOtpHash).not.toContain(request.devCode!);
  });

  it('totals expenses as Money, not as a float', async () => {
    const unit = await inspectedUnit('PASS');
    visitId = await visitWith([unit]);
    await closing.recordExpense(visitId, {
      expenseType: 'FUEL',
      amount: Money.parse('1234.56'),
      distanceKm: 62.5,
      receiptKey: 'qc/receipts/fuel.jpg',
    });
    await closing.recordExpense(visitId, {
      expenseType: 'TOLL',
      amount: Money.parse('0.07'),
    });

    const { rows, total } = await closing.expenses(visitId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.amount.toString()).toBe('1234.56');
    expect(rows[0]!.distanceKm).toBe(62.5);
    // 1234.56 + 0.07 in floating point is 1234.6299999999999.
    expect(total.toString()).toBe('1234.63');
  });
});
