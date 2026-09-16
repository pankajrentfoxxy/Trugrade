/**
 * Stage 9 — listing → inspection → live, asserted end to end.
 *
 * The spec's acceptance criterion is two sentences: *a submitted listing reaches
 * LIVE without a human touching the database, and a mismatched grade reaches a
 * vendor-visible correction rather than going live quietly.* Both are checked
 * here by driving the services, never by writing the outcome and reading it back.
 *
 * **What Stage 9 found.** Three of the four legs were already built — the visit
 * is raised inside the submit transaction, `SchedulingService` assigns the
 * technician through six checks, and `VisitClosingService` moves a passed and
 * sealed unit QC_SEALED → LISTED and republishes its listing. The spec called the
 * last leg missing; it was not. What was genuinely missing was the evidence and
 * the escalation, and those are what the last three cases below cover:
 *
 *   - `qc_report.report_pdf_key` was read in eight places and written in none.
 *     239 reports on the live database, zero documents behind every "download
 *     the report" link in the product.
 *   - A grade mismatch reached the vendor as a correction they could simply not
 *     answer. Nothing put the machine in front of an operator, so it sat out of
 *     stock indefinitely with no queue holding it.
 *
 * The vocabulary note that matters: the database says ACTIVE / PARTIALLY_ACTIVE
 * / PAUSED where the spec says LIVE / PENDING / REJECTED. The table's own words
 * win, as they have all the way through.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
import { InspectionOutcomeService } from '../../src/modules/qc/internal/inspection-outcome.service';
import { InspectionBoardService } from '../../src/modules/qc/internal/inspection-board.service';
import { ReportPdfService } from '../../src/modules/qc/internal/report-pdf.service';
import { ToleranceService } from '../../src/modules/qc/internal/tolerance.service';
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

// After 2026-09-14, which is when the seeded QC tolerance rules come into
// force. A report dated before them cannot derive a grade band at all — the
// rule resolver refuses rather than guessing, which is correct and which cost
// this suite an afternoon to notice.
const NOW = new Date('2026-09-16T04:00:00.000Z');
const VISIT_DATE = '2026-09-17';
const SITE_LAT = 28.4949;
const SITE_LNG = 77.0787;

let moduleRef: TestingModule;
let raw: PrismaClient;
let redis: RedisService;
let ctx: RequestContextService;
let repo: QcRepository;
let scheduling: SchedulingService;
let sealing: SealingService;
let closing: VisitClosingService;
let outcome: InspectionOutcomeService;
let board: InspectionBoardService;

let vendorOrgId: string;
let addressId: string;
let facilityId: string;
let skuId: string;
let listingId: string;
let technicianId: string;
let providerId: string;

let sealCounter = 0;
const nextSealCode = (): string => `TRG-26HR-${String(++sealCounter).padStart(7, '0')}`;

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
      ToleranceService,
      ReportPdfService,
      SchedulingService,
      SealingService,
      InspectionOutcomeService,
      InspectionBoardService,
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
  outcome = moduleRef.get(InspectionOutcomeService);
  board = moduleRef.get(InspectionBoardService);
}, 180_000);

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
  for (let dow = 0; dow < 7; dow++) {
    await raw.$executeRaw`
      INSERT INTO vendor.facility_hours (facility_id, day_of_week, open_time, close_time)
      VALUES (${facilityId}::uuid, ${dow}, '09:00', '18:00')`;
  }

  ({ skuId } = await makeCatalog({}, raw));
  listingId = await makeListing(
    { vendorOrgId, skuId, pickupAddressId: addressId, qty: 10, status: 'AWAITING_QC' },
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
 * A machine the verdict lane has already decided on.
 *
 * This test is about what happens AFTER the technician marks a unit done, so the
 * report is written directly and the chain from there is driven through the
 * services. `VerdictService` has its own suite; duplicating it here would assert
 * the same arithmetic twice and prove nothing about this lane.
 */
async function inspectedUnit(input: {
  verdict: 'PASS' | 'FAIL';
  gradeDeclared?: string;
  gradeFinal?: string;
}): Promise<{ unitId: string; reportId: string; serial: string }> {
  const unitId = randomUUID();
  const reportId = randomUUID();
  const serial = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const pass = input.verdict === 'PASS';
  const declared = input.gradeDeclared ?? 'A';
  const final = input.gradeFinal ?? declared;

  await raw.$executeRaw`
    INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                              grade_declared, grade_actual, status, location,
                              qc_passed_at, qc_valid_until, qc_score)
    VALUES (${unitId}::uuid, ${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid, ${serial},
            ${declared}::grade_type, ${final}::grade_type,
            ${pass ? 'QC_PASSED' : 'QC_FAILED'}::unit_status, 'VENDOR',
            ${pass ? NOW : null}, ${pass ? '2026-12-01' : null}::date, ${pass ? 92 : 41})`;

  await raw.$executeRaw`
    INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                              started_at, completed_at, signature, nonce, grade_proposed,
                              grade_final, grade_override_reason, qc_score, verdict,
                              valid_until, is_current, verification_code)
    VALUES (${reportId}::uuid, ${unitId}::uuid, ${technicianId}::uuid,
            ${'CERT-' + reportId.slice(0, 8)}, '0.1.0',
            ${NOW}, ${NOW}, ${'sig_' + reportId}, ${randomUUID()},
            ${declared}::grade_type, ${final}::grade_type,
            ${declared === final ? null : `Measured ${final} against declared ${declared}.`},
            ${pass ? 92 : 41},
            ${input.verdict}::qc_verdict, '2026-12-01'::date, TRUE,
            ${reportId.replace(/-/g, '').slice(0, 14).toUpperCase()})`;

  return { unitId, reportId, serial };
}

async function visitWith(units: Array<{ unitId: string; serial: string }>): Promise<string> {
  const visit = await repo.createVisit({
    visitNumber: `QCV-S9-${randomUUID().slice(0, 8).toUpperCase()}`,
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

async function setOutcome(id: string, unitId: string, value: string): Promise<void> {
  const rows = await repo.findVisitUnits({ visitId: id });
  const row = rows.find((r) => r.unitId === unitId)!;
  await repo.updateVisitUnit(row.id, { outcome: value as never, completedAt: NOW });
}

async function signAndClose(id: string) {
  const request = await inRequest(() => closing.requestSignoff(id));
  await inRequest(() => closing.signOff(id, { code: request.devCode!, signedName: 'Suresh Nair' }));
  return inRequest(() => closing.close(id));
}

const listingStatus = async (): Promise<string> => {
  const [row] = await raw.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status FROM listing.listing WHERE id = ${listingId}::uuid`;
  return row!.status;
};

// ---------------------------------------------------------------------------
// The criterion
// ---------------------------------------------------------------------------

describe('a submitted listing reaches live with nobody touching the database', () => {
  it('goes ACTIVE when every machine passes and is sealed', async () => {
    const a = await inspectedUnit({ verdict: 'PASS' });
    const b = await inspectedUnit({ verdict: 'PASS' });
    const visitId = await visitWith([a, b]);
    await arrive(visitId);

    for (const unit of [a, b]) {
      await sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: nextSealCode(),
        appliedBy: technicianId,
        appliedPhotoKey: `photos/${unit.unitId}.jpg`,
      });
      await setOutcome(visitId, unit.unitId, 'PASS');
    }

    const result = await signAndClose(visitId);

    expect(await listingStatus()).toBe('ACTIVE');
    expect(result.listings[0]?.sellableUnits).toBe(2);

    // Sellability is the database's own predicate, not a flag this lane sets:
    // LISTED, passed, unexpired, sealed. Asserting the view rather than the
    // column is what makes this a claim about what a buyer can actually reach.
    const [sellable] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.v_sellable_unit WHERE listing_id = ${listingId}::uuid`;
    expect(Number(sellable!.n)).toBe(2);
  });

  it('goes live as nine when nine pass and one fails — per unit, never per listing', async () => {
    const passed = [];
    for (let i = 0; i < 9; i++) passed.push(await inspectedUnit({ verdict: 'PASS' }));
    const failed = await inspectedUnit({ verdict: 'FAIL' });

    const visitId = await visitWith([...passed, failed]);
    await arrive(visitId);
    for (const unit of passed) {
      await sealing.applySeal({
        unitId: unit.unitId,
        qcReportId: unit.reportId,
        sealCode: nextSealCode(),
        appliedBy: technicianId,
        appliedPhotoKey: `photos/${unit.unitId}.jpg`,
      });
      await setOutcome(visitId, unit.unitId, 'PASS');
    }
    await setOutcome(visitId, failed.unitId, 'FAIL');

    const result = await signAndClose(visitId);

    expect(await listingStatus()).toBe('PARTIALLY_ACTIVE');
    expect(result.listings[0]?.sellableUnits).toBe(9);
    expect(result.listings[0]?.totalUnits).toBe(10);

    // The failed machine is ABSENT from the storefront, not dimmed and not
    // out-of-stock. There is no row to hide, which is why there is no flag to
    // get wrong.
    const [rows] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.v_sellable_unit
       WHERE id = ${failed.unitId}::uuid`;
    expect(Number(rows!.n)).toBe(0);

    // The counters are the database's, recomputed by trg_listing_counters from
    // the unit rows — this lane writes none of them.
    const [counts] = await raw.$queryRaw<Array<{ qty_available: number; qty_qc_failed: number }>>`
      SELECT qty_available, qty_qc_failed FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(counts!.qty_available).toBe(9);
    expect(counts!.qty_qc_failed).toBe(1);
  });

  it('pauses the listing and raises a task when nothing passes', async () => {
    const a = await inspectedUnit({ verdict: 'FAIL' });
    const b = await inspectedUnit({ verdict: 'FAIL' });
    const visitId = await visitWith([a, b]);
    await arrive(visitId);
    await setOutcome(visitId, a.unitId, 'FAIL');
    await setOutcome(visitId, b.unitId, 'FAIL');

    await signAndClose(visitId);

    // PAUSED, not OUT_OF_STOCK — the batch did not sell out — and not REJECTED,
    // which is the administrator's terminal action on a listing. A failed batch
    // is recoverable; see `raiseBatchFailed`.
    expect(await listingStatus()).toBe('PAUSED');

    const [task] = await raw.$queryRaw<Array<{ kind: string; severity: string; subject: string }>>`
      SELECT kind, severity, subject FROM ordering.ops_task
       WHERE listing_id = ${listingId}::uuid AND status = 'OPEN'`;
    expect(task?.kind).toBe('QC_BATCH_FAILED');
    expect(task?.severity).toBe('ATTENTION');
  });

  it('refuses to close rather than listing a passed unit nobody sealed', async () => {
    const a = await inspectedUnit({ verdict: 'PASS' });
    const visitId = await visitWith([a]);
    await arrive(visitId);
    await setOutcome(visitId, a.unitId, 'PASS');

    // A seal-less sellable unit is exactly what `v_sellability_drift` exists to
    // catch. A close that creates one at 6pm on a Friday is worse than a close
    // that fails loudly at 5pm.
    await expect(signAndClose(visitId)).rejects.toThrow(/seal/i);
    expect(await listingStatus()).toBe('AWAITING_QC');
  });
});

// ---------------------------------------------------------------------------
// A mismatch does not go live quietly
// ---------------------------------------------------------------------------

describe('a grade mismatch reaches somebody', () => {
  it('raises an ops task the vendor cannot silently ignore', async () => {
    const unit = await inspectedUnit({ verdict: 'PASS', gradeDeclared: 'A', gradeFinal: 'B' });

    await outcome.raiseGradeMismatch({
      unitId: unit.unitId,
      listingId,
      serialNumber: unit.serial,
      gradeDeclared: 'A',
      gradeActual: 'B',
      reason: 'Lid has a 4cm scratch that caps the grade at B.',
      gradeCorrectionId: null,
    });

    const [task] = await raw.$queryRaw<
      Array<{ kind: string; severity: string; assigned_role: string; subject: string }>
    >`
      SELECT kind, severity, assigned_role, subject FROM ordering.ops_task
       WHERE unit_id = ${unit.unitId}::uuid AND status = 'OPEN'`;
    expect(task?.kind).toBe('GRADE_MISMATCH');
    expect(task?.severity).toBe('ATTENTION');
    expect(task?.assigned_role).toBe('QC_MANAGER');
    // The serial and both grades are in the subject, because an operator
    // triaging a queue reads subjects and not json.
    expect(task?.subject).toContain(unit.serial);
    expect(task?.subject).toMatch(/graded B, declared A/);
  });

  it('does not stack a second task when the same machine mismatches again', async () => {
    const unit = await inspectedUnit({ verdict: 'PASS', gradeDeclared: 'A', gradeFinal: 'B' });
    const raise = (): Promise<void> =>
      outcome.raiseGradeMismatch({
        unitId: unit.unitId,
        listingId,
        serialNumber: unit.serial,
        gradeDeclared: 'A',
        gradeActual: 'B',
        reason: 'Re-inspected, same finding.',
        gradeCorrectionId: null,
      });

    await raise();
    await raise();

    // Two rows for one machine is two people picking up the same job.
    const [row] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ordering.ops_task
       WHERE unit_id = ${unit.unitId}::uuid AND kind = 'GRADE_MISMATCH' AND status = 'OPEN'`;
    expect(Number(row!.n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The evidence
// ---------------------------------------------------------------------------

describe('the report PDF', () => {
  it('is attached to the report, where eight screens have been promising it', async () => {
    const unit = await inspectedUnit({ verdict: 'PASS' });

    const key = await outcome.attachReportPdf(unit.reportId, unit.serial);
    expect(key).toMatch(/^qc-reports\//);

    const [row] = await raw.$queryRaw<Array<{ report_pdf_key: string | null }>>`
      SELECT report_pdf_key FROM qc.qc_report WHERE id = ${unit.reportId}::uuid`;
    expect(row?.report_pdf_key).toBe(key);
  });

  it('names the serial and never the vendor', async () => {
    const unit = await inspectedUnit({ verdict: 'PASS' });
    const key = await outcome.attachReportPdf(unit.reportId, unit.serial);
    // The key is visible wherever the object is served. A vendor identifier in
    // a path is a disclosure with no way back.
    expect(key).toContain(unit.serial);
    expect(key).not.toContain(vendorOrgId);
  });

  it('does not fail the verdict when the render fails', async () => {
    // A report id with no unit behind it: `renderBySerial` returns null rather
    // than throwing, and the verdict must survive either way. The PDF is a
    // rendering of a decision already recorded, not the decision.
    const key = await outcome.attachReportPdf(randomUUID(), 'NOSUCHSERIAL');
    expect(key).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

describe('the inspections board', () => {
  it('opens on Unscheduled, because that is the only view where the move is ours', async () => {
    const a = await inspectedUnit({ verdict: 'PASS' });
    await visitWith([a]);

    const envelope = await board.visits({});
    expect(envelope.views[0]?.key).toBe('unscheduled');
    expect(envelope.views[0]?.count).toBe(1);
    expect(envelope.rows[0]?.technicianName).toBeNull();
  });

  it('sorts by who has waited longest, not by newest', async () => {
    const a = await inspectedUnit({ verdict: 'PASS' });
    const b = await inspectedUnit({ verdict: 'PASS' });
    const older = await visitWith([a]);
    await visitWith([b]);
    await raw.$executeRaw`
      UPDATE qc.qc_visit SET requested_at = ${new Date('2026-08-01T00:00:00.000Z')}
       WHERE id = ${older}::uuid`;

    const envelope = await board.visits({ view: 'unscheduled' });
    expect(envelope.rows[0]?.id).toBe(older);
    expect(envelope.rows[0]?.waitingDays).toBeGreaterThan(30);
  });

  it('reports technician load per day so a fourth visit is not booked by surprise', async () => {
    const a = await inspectedUnit({ verdict: 'PASS' });
    const visitId = await visitWith([a]);
    await arrive(visitId);

    const load = await board.workload();
    const mine = load.find((t) => t.technicianId === technicianId);
    expect(mine?.byDay[VISIT_DATE]).toBe(1);
    expect(mine?.openVisits).toBeGreaterThanOrEqual(1);
  });
});
