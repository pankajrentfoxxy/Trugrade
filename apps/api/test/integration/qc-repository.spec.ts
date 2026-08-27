/**
 * The QC repository, against the real database.
 *
 * Everything asserted here is something only Postgres enforces — a partial
 * unique index, an idempotent ON CONFLICT, a NUMERIC round trip, a CHECK on a
 * twelve-value vocabulary, a non-deferrable FK that dictates statement order. An
 * in-memory fake would pass all of it and prove nothing.
 *
 * Five sibling services build on this repository, so the properties below are
 * the ones they are entitled to assume: ingestion is idempotent, a nonce cannot
 * be replayed, a re-inspection supersedes rather than overwrites, money comes
 * back as `Money` and a percentage as a number, and the twelve area codes are
 * the schema's rather than the phase document's.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Money, VERIFICATION_CODE } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  CurrentReportExistsError,
  NonceReplayError,
  QcRepository,
  SealCodeInUseError,
  generateVerificationCode,
} from '../../src/modules/qc/internal/qc.repository';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeTechnician, seedSellableUnit } from '../support/factories';

const NOW = new Date('2026-08-26T09:00:00.000Z');

let moduleRef: TestingModule;
let repo: QcRepository;
let raw: PrismaClient;

let vendorOrgId: string;
let pickupAddressId: string;
let skuId: string;
let listingId: string;
let unitId: string;
let serial: string;
let technicianId: string;
let technicianUserId: string;
let providerId: string;
let facilityId: string;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule],
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
      QcRepository,
    ],
  }).compile();

  repo = moduleRef.get(QcRepository);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);

  // `sealed: false` gives a unit with no QC report, which is where an inspection
  // actually starts. The sealed variant would already hold the one current
  // report every test here is about creating.
  const seeded = await seedSellableUnit({ sealed: false }, raw);
  ({ vendorOrgId, pickupAddressId, skuId, listingId, unitId, serial } = seeded);

  const tech = await makeTechnician(raw);
  technicianId = tech.technicianId;
  technicianUserId = tech.userId;

  const [facility] = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
    VALUES (${vendorOrgId}::uuid, ${pickupAddressId}::uuid, 'WAREHOUSE')
    RETURNING id`;
  facilityId = facility!.id;

  providerId = (await repo.findToolProviderByCode('DEVICESURE'))!.id;
});

/** A minimal valid report draft. Each caller varies only what it is testing. */
function reportDraft(overrides: Record<string, unknown> = {}) {
  return {
    unitId,
    technicianId,
    deviceCertId: 'CERT-' + randomUUID().slice(0, 8),
    agentVersion: '0.1.0',
    startedAt: NOW,
    signature: 'sig',
    nonce: 'rn-' + randomUUID(),
    ...overrides,
  };
}

describe('the public verification code', () => {
  it('matches VR-111b and does not repeat', () => {
    const codes = Array.from({ length: 500 }, generateVerificationCode);
    for (const c of codes) expect(c).toMatch(VERIFICATION_CODE.pattern!);
    expect(new Set(codes).size).toBe(500);
  });

  it('is written onto every report, so no caller can forget it', async () => {
    const report = await repo.createReport(reportDraft());
    expect(report.verificationCode).toMatch(VERIFICATION_CODE.pattern!);
    const found = await repo.findReportByVerificationCode(report.verificationCode!);
    expect(found?.id).toBe(report.id);
  });
});

describe('tool-run ingestion', () => {
  const runInput = () => ({
    unitId,
    toolProviderId: providerId,
    toolVersion: '0.1.0',
    deviceCertId: 'CERT-1',
    rawReportHash: 'a'.repeat(64),
    toolRunId: 'cert-' + randomUUID(),
    nonce: 'n-' + randomUUID(),
  });

  it('QC-001: the same run submitted twice is ONE row, not a duplicate and not a 500', async () => {
    const input = runInput();
    const first = await repo.insertToolRun({ ...input, rawReportJson: { device: { serial } } });
    expect(first.alreadyIngested).toBe(false);

    const second = await repo.insertToolRun({ ...input, nonce: 'n-' + randomUUID() });
    expect(second.alreadyIngested).toBe(true);
    expect(second.row.id).toBe(first.row.id);

    const counted = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM qc.qc_tool_run WHERE unit_id = ${unitId}::uuid`;
    expect(Number(counted[0]!.n)).toBe(1);
  });

  it('QC-004: a replayed nonce under a different run id is refused, not deduplicated', async () => {
    const first = await repo.insertToolRun(runInput());
    await expect(
      repo.insertToolRun({ ...runInput(), nonce: first.row.nonce! }),
    ).rejects.toBeInstanceOf(NonceReplayError);
  });

  it('keeps the raw payload verbatim through a parse failure', async () => {
    const payload = { certificate: { id: 'x' }, grade: 'A+', testResults: [{ area: 'PORTS' }] };
    const { row } = await repo.insertToolRun({ ...runInput(), rawReportJson: payload });
    await repo.updateToolRunParse(row.id, {
      parseStatus: 'PARSE_FAILED',
      parseError: 'unmapped field',
    });
    const after = await repo.findToolRunById(row.id);
    expect(after!.parseStatus).toBe('PARSE_FAILED');
    expect(after!.rawReportJson).toEqual(payload);
  });
});

describe('one live report per machine', () => {
  it('refuses a second current report with a typed error, not a 500', async () => {
    await repo.createReport(reportDraft());
    await expect(repo.createReport(reportDraft())).rejects.toBeInstanceOf(CurrentReportExistsError);
  });

  it('QC-045: a re-inspection supersedes and leaves the prior report untouched', async () => {
    const original = await repo.createReport(reportDraft({ validUntil: '2026-11-24' }));
    await repo.completeReport(original.id, {
      verdict: 'PASS',
      qcScore: 92,
      gradeProposed: 'A',
      gradeFinal: 'A',
      completedAt: NOW,
    });

    const { report: fresh, supersededId } = await repo.supersedeReport(unitId, reportDraft());
    expect(supersededId).toBe(original.id);
    expect(fresh.isCurrent).toBe(true);

    const old = await repo.findReportById(original.id);
    expect(old!.isCurrent).toBe(false);
    expect(old!.supersededById).toBe(fresh.id);
    // History is the evidence: the numbers we published are still readable.
    expect(old!.qcScore).toBe(92);
    expect(old!.gradeFinal).toBe('A');
    expect(old!.verificationCode).toBe(original.verificationCode);

    expect((await repo.findReportsByUnit(unitId))).toHaveLength(2);
    expect((await repo.findCurrentReportByUnit(unitId))!.id).toBe(fresh.id);
  });

  it('supersedes a unit that has no report yet without inventing one', async () => {
    const { supersededId } = await repo.supersedeReport(unitId, reportDraft());
    expect(supersededId).toBeNull();
  });
});

describe('the row boundary', () => {
  it('returns money as Money and percentages as numbers', async () => {
    const report = await repo.createReport(reportDraft());

    const [mismatch] = await repo.insertMismatches(report.id, [
      {
        field: 'RAM_GB',
        declaredValue: '16 GB',
        actualValue: '8 GB',
        severity: 'BLOCKING',
        discountAmount: Money.parse('1500.50'),
      },
    ]);
    expect(mismatch!.discountAmount).toBeInstanceOf(Money);
    expect(mismatch!.discountAmount!.toString()).toBe('1500.50');

    const hw = await repo.upsertHardware(report.id, {
      hwSerial: serial,
      ramDetectedGb: 15,
      batteryHealthPct: 77.5,
      screenSize: 13.3,
    });
    expect(typeof hw.batteryHealthPct).toBe('number');
    expect(hw.batteryHealthPct).toBe(77.5);
    expect(hw.screenSize).toBe(13.3);

    const visit = await repo.createVisit({
      visitNumber: 'QCV-' + randomUUID().slice(0, 8),
      vendorOrgId,
      facilityId,
      addressId: pickupAddressId,
      unitsRequested: 1,
      visitFee: Money.parse('1500.00'),
    });
    expect(visit.visitFee).toBeInstanceOf(Money);
    expect(visit.visitFee.toString()).toBe('1500.00');
  });

  it('returns DATE and TIME as text, so a 90-day expiry cannot drift a day in IST', async () => {
    const report = await repo.createReport(reportDraft({ validUntil: '2026-11-24' }));
    expect(report.validUntil).toBe('2026-11-24');

    const visit = await repo.createVisit({
      visitNumber: 'QCV-' + randomUUID().slice(0, 8),
      vendorOrgId,
      facilityId,
      addressId: pickupAddressId,
      unitsRequested: 1,
      scheduledDate: '2026-09-01',
      slotFrom: '09:30',
      slotTo: '17:00',
    });
    expect(visit.scheduledDate).toBe('2026-09-01');
    expect(visit.slotFrom).toBe('09:30:00');
  });

  it('stores what the tool reported and corrects nothing (07 §3.4)', async () => {
    const report = await repo.createReport(reportDraft());
    // DeviceSure reports 15 GB for a 16 GB machine. The fix is in their Windows
    // collector; a repository that quietly adds 1 here is one nobody can reason
    // about six months later.
    const hw = await repo.upsertHardware(report.id, {
      hwSerial: serial,
      ramDetectedGb: 15,
      rawJson: { ramInstalledGb: 16 },
    });
    expect(hw.ramDetectedGb).toBe(15);
    expect(hw.rawJson).toEqual({ ramInstalledGb: 16 });
  });
});

describe('the twelve area codes are the schema’s, not the document’s', () => {
  it('accepts the functional vocabulary and upserts rather than duplicating', async () => {
    const report = await repo.createReport(reportDraft());

    await repo.upsertAreaResults(report.id, [
      { area: 'DISPLAY', score: 10, maxScore: 10, status: 'PASS' },
      { area: 'PORTS', score: 3, maxScore: 10, status: 'FAIL', details: { note: 'usb dead' } },
      { area: 'MEMORY_CPU', score: 9.5, maxScore: 10, status: 'PASS' },
    ]);
    await repo.upsertAreaResults(report.id, [
      { area: 'PORTS', score: 8, maxScore: 10, status: 'WARN' },
    ]);

    const areas = await repo.findAreaResults(report.id);
    expect(areas).toHaveLength(3);
    expect(areas.find((a) => a.area === 'PORTS')!.status).toBe('WARN');
    expect(areas.find((a) => a.area === 'MEMORY_CPU')!.score).toBe(9.5);
  });

  it('refuses the phase document’s cosmetic vocabulary at the CHECK', async () => {
    const report = await repo.createReport(reportDraft());
    await expect(
      repo.upsertAreaResults(report.id, [
        // CHASSIS is what PHASE_04_QC.md Task 3 and contracts' QC_AREAS name.
        // The database has never allowed it, and this is the guard for the day
        // someone copies the list out of the doc.
        { area: 'CHASSIS' as never, score: 10, maxScore: 10, status: 'PASS' },
      ]),
    ).rejects.toThrow();
  });
});

describe('seals', () => {
  const sealCode = () =>
    'TRG-26HR-' + String(Math.floor(Math.random() * 9_999_999)).padStart(7, '0');

  it('cannot be applied twice, and verification is a different identity from application', async () => {
    const report = await repo.createReport(reportDraft());
    const code = sealCode();
    const seal = await repo.applySeal({
      sealCode: code,
      unitId,
      qcReportId: report.id,
      appliedBy: technicianId,
      appliedPhotoKey: 'qc/seals/a.jpg',
    });
    expect(seal.status).toBe('APPLIED');
    expect(seal.appliedPhotoKey).toBe('qc/seals/a.jpg');

    await expect(
      repo.applySeal({
        sealCode: code,
        unitId,
        qcReportId: report.id,
        appliedBy: technicianId,
        appliedPhotoKey: 'qc/seals/b.jpg',
      }),
    ).rejects.toBeInstanceOf(SealCodeInUseError);

    // applied_by is a qc_technician; verified_by is a user_account, because the
    // person at the door at pickup is logistics staff.
    const verified = await repo.updateSealStatus(code, {
      status: 'INTACT',
      verifiedAt: NOW,
      verifiedBy: technicianUserId,
    });
    expect(verified!.status).toBe('INTACT');
    expect(verified!.appliedBy).toBe(technicianId);
    expect(verified!.verifiedBy).toBe(technicianUserId);
  });
});

describe('visits', () => {
  async function visit(): Promise<string> {
    const v = await repo.createVisit({
      visitNumber: 'QCV-' + randomUUID().slice(0, 8),
      vendorOrgId,
      facilityId,
      addressId: pickupAddressId,
      unitsRequested: 1,
    });
    return v.id;
  }

  it('takes a manifest idempotently and totals its counters from the rows', async () => {
    const visitId = await visit();
    const added = await repo.addVisitUnits(visitId, [{ unitId, serialNumber: serial, listingId }]);
    expect(added).toHaveLength(1);
    // The technician app replays its offline queue; a repeat is a no-op, not a 500.
    expect(await repo.addVisitUnits(visitId, [{ unitId, serialNumber: serial }])).toHaveLength(0);

    await repo.updateVisitUnit(added[0]!.id, { outcome: 'PASS_GRADE_CORRECTED' });
    const counted = await repo.recountVisit(visitId);
    expect(counted!.unitsPresented).toBe(1);
    expect(counted!.unitsInspected).toBe(1);
    expect(counted!.unitsPassed).toBe(1);
    expect(counted!.unitsGradeCorrected).toBe(1);
    expect(counted!.unitsFailed).toBe(0);
    expect(counted!.unitsAbsent).toBe(0);
  });

  it('filters and paginates, and a patch does not clobber the fee it was not given', async () => {
    const v = await repo.createVisit({
      visitNumber: 'QCV-' + randomUUID().slice(0, 8),
      vendorOrgId,
      facilityId,
      addressId: pickupAddressId,
      unitsRequested: 4,
      scheduledDate: '2026-09-01',
      visitFee: Money.parse('1500.00'),
    });

    const page = await repo.findVisits({ vendorOrgId, status: 'REQUESTED', pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.rows[0]!.id).toBe(v.id);
    expect(await repo.findVisits({ technicianId: randomUUID() })).toMatchObject({ total: 0 });
    expect(await repo.findVisits({ scheduledFrom: '2026-10-01' })).toMatchObject({ total: 0 });

    const arrived = await repo.updateVisit(v.id, {
      status: 'IN_PROGRESS',
      arrivalGeoLat: 28.459497,
      arrivalGeoLng: 77.026634,
      geoVarianceMetres: 612,
    });
    expect(arrived!.status).toBe('IN_PROGRESS');
    expect(arrived!.arrivalGeoLat).toBe(28.459497);
    expect(arrived!.visitFee.toString()).toBe('1500.00');
  });

  it('reports cost per inspected unit once the visit is closed', async () => {
    const visitId = await visit();
    await repo.addVisitUnits(visitId, [{ unitId, serialNumber: serial }]);
    await repo.updateVisitUnit((await repo.findVisitUnits({ visitId }))[0]!.id, {
      outcome: 'PASS',
    });
    await repo.recountVisit(visitId);
    await repo.updateVisit(visitId, { status: 'COMPLETED', startedAt: NOW, completedAt: NOW });
    await raw.$executeRaw`
      INSERT INTO qc.qc_visit_expense (visit_id, expense_type, amount)
      VALUES (${visitId}::uuid, 'FUEL', 900.00)`;

    const [econ] = await repo.findVisitEconomics(visitId);
    expect(econ!.totalExpense).toBeInstanceOf(Money);
    expect(econ!.totalExpense.toString()).toBe('900.00');
    expect(econ!.costPerUnit!.toString()).toBe('900.00');
  });
});

describe('technicians and rules', () => {
  it('matches on zone and certified tool through the GIN index', async () => {
    expect((await repo.findTechnicianByUserId(technicianUserId))!.id).toBe(technicianId);
    const found = await repo.findTechnicians({ zone: 'NCR', tool: 'DEVICESURE' });
    expect(found.map((t) => t.id)).toContain(technicianId);
    expect(await repo.findTechnicians({ zone: 'NOWHERE' })).toHaveLength(0);
  });

  it('upserts a roster without duplicating a slot', async () => {
    await repo.upsertAvailability(technicianId, [
      { theDate: '2026-09-01', slotFrom: '09:00', slotTo: '13:00' },
      { theDate: '2026-09-01', slotFrom: '14:00', slotTo: '18:00', status: 'BOOKED' },
    ]);
    const [changed] = await repo.upsertAvailability(technicianId, [
      { theDate: '2026-09-01', slotFrom: '09:00', slotTo: '12:00', status: 'LEAVE' },
    ]);
    expect(changed!.status).toBe('LEAVE');
    expect(changed!.theDate).toBe('2026-09-01');
    expect(changed!.slotFrom).toBe('09:00:00');

    const roster = await repo.findAvailability({
      technicianIds: [technicianId],
      from: '2026-08-31',
      to: '2026-09-02',
    });
    expect(roster).toHaveLength(2);

    // The scheduler asks for a whole day across every technician, so the
    // technician filter has to be genuinely optional rather than bind NULL and
    // silently match nothing.
    const wholeDay = await repo.findAvailability({ from: '2026-09-01', to: '2026-09-01' });
    expect(wholeDay).toHaveLength(2);
    expect(await repo.findAvailability({ from: '2026-09-01', to: '2026-09-01', status: 'BOOKED' }))
      .toHaveLength(1);
  });

  it('reads the tolerance rules in force on a date, one per field', async () => {
    // Asked for TODAY, not a literal date. The seed stamps `effective_from` with
    // the day it ran, so a hardcoded '2026-08-26' passed only on a database
    // seeded on or before that day and failed every day after — a test that
    // starts failing on a calendar boundary rather than on a code change.
    const today = await repo.findToleranceRules(new Date().toISOString().slice(0, 10));
    expect(today.length).toBeGreaterThan(0);
    expect(new Set(today.map((r) => r.field)).size).toBe(today.length);
    // A report from before any rule existed must not silently pick up today's.
    expect(await repo.findToleranceRules('1999-01-01')).toHaveLength(0);
  });
});

describe('sampling rules', () => {
  // PLATINUM has no seeded rule, and `truncateAll` preserves this table as
  // reference data — so this block cleans up after itself rather than relying on
  // the truncate that protects it.
  afterEach(async () => {
    await raw.$executeRaw`DELETE FROM qc.qc_sampling_rule WHERE vendor_tier = 'PLATINUM'`;
  });

  it('leaves exactly one active rule per tier', async () => {
    const first = await repo.upsertSamplingRule({
      vendorTier: 'PLATINUM',
      effectiveFrom: '2026-08-26',
      minUnitsInspected: 5000,
      samplePct: 25,
      minPassRate: 98.5,
      alwaysFullAboveValue: Money.parse('5000000.00'),
    });
    expect(first.alwaysFullAboveValue).toBeInstanceOf(Money);
    expect(first.minPassRate).toBe(98.5);
    expect((await repo.findActiveSamplingRule('PLATINUM'))!.id).toBe(first.id);

    await repo.upsertSamplingRule({
      vendorTier: 'PLATINUM',
      effectiveFrom: '2026-08-27',
      minUnitsInspected: 6000,
      samplePct: 20,
    });
    const active = await repo.findActiveSamplingRule('PLATINUM');
    expect(active!.samplePct).toBe(20);
  });
});

describe('the aggregates the offers grid is served from', () => {
  it('upserts per (vendor, sku, grade) and keeps percentages as numbers', async () => {
    await repo.upsertVendorSkuQuality(
      { vendorOrgId, skuId, grade: 'A' },
      {
        unitsInspected: 12,
        avgQcScore: 91.25,
        gradeCorrections: 1,
        gradeAccuracyPct: 91.67,
        lastInspectedAt: NOW,
      },
    );
    await repo.upsertVendorSkuQuality(
      { vendorOrgId, skuId, grade: 'A' },
      { unitsInspected: 13, gradeCorrections: 1 },
    );

    const rows = await repo.findVendorSkuQuality(vendorOrgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unitsInspected).toBe(13);

    const wide = await repo.upsertVendorQuality(vendorOrgId, {
      unitsInspected: 40,
      gradeCorrections: 2,
      gradeAccuracyPct: 95,
    });
    expect(wide.gradeAccuracyPct).toBe(95);
    expect(typeof wide.gradeAccuracyPct).toBe('number');
  });
});
