/**
 * The verdict and the grade correction, against the real database.
 *
 * Two named tests carry this file, and everything else exists to make them
 * unambiguous:
 *
 *   **QC-025** — declare 16 GB, present an 8 GB machine. The unit must not
 *   become sellable, the difference must be on the record as a BLOCKING
 *   `qc_mismatch`, and the vendor must be told which field is wrong.
 *
 *   **QC-031** — a grade correction with no vendor response auto-applies on day
 *   two. Proved by moving a `FixedClock`, not by waiting two days.
 *
 * Real Postgres because every assertion here is something only Postgres
 * enforces: `chk_actually_different` on the correction, `chk_override_reason` on
 * the report, and `trg_recompute_sellable`, which is the single place
 * `is_sellable` is decided and therefore the only honest answer to "is this
 * machine on the storefront".
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { QcRepository, type AreaResultInput } from '../../src/modules/qc/internal/qc.repository';
import { ToleranceService } from '../../src/modules/qc/internal/tolerance.service';
import { VerdictService } from '../../src/modules/qc/internal/verdict.service';
import { GradeCorrectionService } from '../../src/modules/qc/internal/grade-correction.service';
import { QC_AREA_CODES } from '../../src/modules/qc/dto/qc.dto';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeTechnician, seedSellableUnit } from '../support/factories';

let moduleRef: TestingModule;
let prisma: PrismaService;
let repo: QcRepository;
let tolerance: ToleranceService;
let verdicts: VerdictService;
let corrections: GradeCorrectionService;
let clock: FixedClock;
let raw: PrismaClient;

let vendorOrgId: string;
let listingId: string;
let unitId: string;
let serial: string;
let technicianId: string;
let providerId: string;
let rulesVersion: string;

/** The twelve areas, all clean. Every test starts here and breaks one thing. */
const ALL_PASS: AreaResultInput[] = QC_AREA_CODES.map((area) => ({
  area,
  score: 10,
  maxScore: 10,
  status: 'PASS' as const,
}));

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  // Pinned to the database's own CURRENT_DATE rather than to a literal. The
  // seeded tolerance rules default `effective_from` to CURRENT_DATE at migration
  // time, so a hard-coded clock in the past resolves an empty rule set and the
  // whole file fails for a reason that has nothing to do with grading.
  // 06:00 UTC is 11:30 IST — the same calendar day either way.
  const [today] = await raw.$queryRaw<Array<{ d: string }>>`SELECT CURRENT_DATE::text AS d`;
  clock = new FixedClock(new Date(`${today!.d}T06:00:00.000Z`));

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
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
      EventBus,
      QcRepository,
      ToleranceService,
      GradeCorrectionService,
      VerdictService,
    ],
  }).compile();

  prisma = moduleRef.get(PrismaService);
  repo = moduleRef.get(QcRepository);
  tolerance = moduleRef.get(ToleranceService);
  verdicts = moduleRef.get(VerdictService);
  corrections = moduleRef.get(GradeCorrectionService);
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

  // `sealed: false` gives a unit with no report of its own, which is where an
  // inspection actually starts. The factory's SKU is 16 GB / 512 GB NVMe /
  // i5-1145G7 / 13.3" — the declaration QC-025 is measured against.
  const seeded = await seedSellableUnit({ sealed: false, grade: 'A' }, raw);
  ({ vendorOrgId, listingId, unitId, serial } = seeded);

  technicianId = (await makeTechnician(raw)).technicianId;
  providerId = (await repo.findToolProviderByCode('DEVICESURE'))!.id;
  rulesVersion = (await tolerance.resolve(clock.todayInIst())).version;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A report as ingestion would leave it: raw payload stored, hardware parsed,
 * areas written, `rules_version` stamped from the rule set resolved at the start
 * of the inspection — and no verdict yet.
 */
async function inspect(
  overrides: {
    ramDetectedGb?: number;
    batteryHealthPct?: number;
    cycleCount?: number;
    smartStatus?: 'OK' | 'WARNING' | 'FAILING';
    qcScore?: number;
    areas?: AreaResultInput[];
    seal?: boolean;
    serialMatches?: boolean;
    rulesVersion?: string;
  } = {},
): Promise<string> {
  const report = await repo.createReport({
    unitId,
    technicianId,
    deviceCertId: `CERT-${randomUUID().slice(0, 8)}`,
    agentVersion: '0.1.0',
    startedAt: clock.now(),
    signature: `sig_${randomUUID()}`,
    nonce: randomUUID(),
    qcScore: overrides.qcScore ?? 95,
    rulesVersion: overrides.rulesVersion ?? rulesVersion,
  });

  const run = await repo.insertToolRun({
    unitId,
    toolProviderId: providerId,
    toolVersion: '0.1.0',
    deviceCertId: `CERT-${randomUUID().slice(0, 8)}`,
    rawReportHash: 'a'.repeat(64),
    toolRunId: randomUUID(),
    parseStatus: 'PARSED',
    serialFromTool: serial,
    serialMatches: overrides.serialMatches ?? true,
    nonce: randomUUID(),
  });
  await repo.attachToolRun(report.id, run.row.id);

  await repo.upsertHardware(report.id, {
    hwSerial: serial,
    // What the tool reported, verbatim. 16 for a clean machine; QC-025 sends 8.
    ramDetectedGb: overrides.ramDetectedGb ?? 16,
    ramModules: 2,
    storageType: 'NVME_SSD',
    storageDetectedGb: 477,
    cpuDetected: 'i5-1145G7',
    screenSize: 13.3,
    gpuDetected: 'Intel Iris Xe',
    // 80% bands to grade A, which is what the unit was declared as — so a
    // test about the ports does not also trip a grade correction.
    batteryHealthPct: overrides.batteryHealthPct ?? 80,
    cycleCount: overrides.cycleCount ?? 120,
    smartStatus: overrides.smartStatus ?? 'OK',
    biosLocked: false,
    mdmLocked: false,
    computraceActive: false,
  });

  await repo.upsertAreaResults(report.id, overrides.areas ?? ALL_PASS);

  if (overrides.seal !== false) {
    const seal = await repo.applySeal({
      // From the UUID rather than Math.random: `seal_code` is UNIQUE across every
      // roll ever issued, and a fixture that can collide is a suite that fails
      // once a month for a reason nobody can reproduce.
      sealCode: `TRG-26HR-${report.id.replace(/-/g, '').slice(0, 7).toUpperCase()}`,
      unitId,
      qcReportId: report.id,
      appliedBy: technicianId,
      appliedPhotoKey: `qc/seals/${report.id}.jpg`,
    });
    // `applySeal` writes `qc_seal`; pointing the unit at it is the sealing lane's
    // statement, stood in for here because `trg_recompute_sellable` reads it and
    // "is this on the storefront" is the question half this file asks.
    await raw.$executeRaw`UPDATE listing.unit SET seal_id = ${seal.id}::uuid WHERE id = ${unitId}::uuid`;
  }

  return report.id;
}

async function unitRow(): Promise<{
  status: string;
  is_sellable: boolean;
  grade_actual: string | null;
  qc_valid_until: string | null;
}> {
  const [row] = await raw.$queryRaw<
    Array<{
      status: string;
      is_sellable: boolean;
      grade_actual: string | null;
      qc_valid_until: string | null;
    }>
  >`SELECT status::text, is_sellable, grade_actual::text,
           qc_valid_until::text AS qc_valid_until
      FROM listing.unit WHERE id = ${unitId}::uuid`;
  return row!;
}

// ---------------------------------------------------------------------------

describe('QC-025 — declared 16 GB, an 8 GB machine on the bench', () => {
  it('does not let the unit become sellable, and says which field is wrong', async () => {
    const reportId = await inspect({ ramDetectedGb: 8 });

    const outcome = await verdicts.evaluate(reportId);

    // Not auto-approved, and blocked on the specification rather than on a
    // score — the machine tested is not the machine that was listed.
    expect(outcome.autoApproved).toBe(false);
    expect(outcome.blockedBy).toContain('SPEC_MISMATCH');
    expect(outcome.gradeFinal).toBeNull();
    expect(outcome.validUntil).toBeNull();

    // Rule 1: absent from the storefront, not dimmed.
    const unit = await unitRow();
    expect(unit.is_sellable).toBe(false);
    expect(unit.qc_valid_until).toBeNull();

    // The difference is on the record, in the tolerance table's own vocabulary,
    // at the severity the seeded rule gives it.
    const mismatches = await repo.findMismatches(reportId);
    const ram = mismatches.find((m) => m.field === 'ram_detected_gb');
    expect(ram).toBeDefined();
    expect(ram!.severity).toBe('BLOCKING');
    expect(ram!.declaredValue).toBe('16 GB');
    expect(ram!.actualValue).toBe('8 GB');

    // Specific enough for the vendor to act on without opening a ticket.
    expect(outcome.vendorMessage).toMatch(/16 GB/);
    expect(outcome.vendorMessage).toMatch(/8 GB/);

    // And the event other modules act on was written to the outbox.
    const [event] = await raw.$queryRaw<Array<{ event_name: string; payload_json: unknown }>>`
      SELECT event_name, payload_json FROM platform.event_outbox
       WHERE event_name = 'qc.report.completed'`;
    expect(event).toBeDefined();
    expect((event!.payload_json as { isSellable: boolean }).isSellable).toBe(false);
  });

  /**
   * The other half of 07 §3.4, and the one that would break every unit rather
   * than one: Windows reports 15 GB for a 16 GB machine. That must not be a
   * mismatch — and the fix is in `compareSpec`'s normalisation, never a `+1` on
   * the way into `qc_hardware_detected`.
   */
  it('15 GB usable on a 16 GB machine is not a mismatch, and 15 is what we stored', async () => {
    const reportId = await inspect({ ramDetectedGb: 15 });

    const outcome = await verdicts.evaluate(reportId);

    expect(outcome.blockedBy).not.toContain('SPEC_MISMATCH');
    expect(await repo.findMismatches(reportId)).toHaveLength(0);
    expect((await repo.findHardware(reportId))!.ramDetectedGb).toBe(15);
  });
});

describe('the verdict', () => {
  it('passes a clean machine, sets a 90-day window and writes the rules version', async () => {
    // 80% is grade A, which is what the vendor declared.
    const reportId = await inspect({ batteryHealthPct: 80 });

    const outcome = await verdicts.evaluate(reportId);

    expect(outcome.verdict).toBe('PASS');
    expect(outcome.autoApproved).toBe(true);
    expect(outcome.gradeFinal).toBe('A');
    expect(outcome.rulesVersion).toBe(rulesVersion);

    const report = await repo.findReportById(reportId);
    expect(report!.validUntil).toBe(
      new Date(new Date(`${clock.todayInIst()}T00:00:00Z`).getTime() + 90 * 86_400_000)
        .toISOString()
        .slice(0, 10),
    );
    expect(report!.rulesVersion).toBe(rulesVersion);
  });

  /**
   * 07 §3.1: the certificate graded A+ with a failed USB port. A weighted mean
   * cannot express "one component failed" — eleven areas at 10 and one at 3
   * still averages 94 — so the floor rule has to fire independently of the mean.
   */
  it('refuses to auto-approve an A+ score with a failed port', async () => {
    const areas = ALL_PASS.map((a) =>
      a.area === 'PORTS' ? { ...a, score: 3, status: 'FAIL' as const } : a,
    );
    const reportId = await inspect({ areas, qcScore: 94 });

    const outcome = await verdicts.evaluate(reportId);

    expect(outcome.autoApproved).toBe(false);
    expect(outcome.blockedBy).toContain('REQUIRED_AREA_FAILED');
    // Capped from the declared A down to B, which is itself a grade correction.
    expect(outcome.gradeFinal).toBe('B');
    expect(outcome.gradeCorrectionId).not.toBeNull();
    expect((await unitRow()).is_sellable).toBe(false);
  });

  /**
   * A missing value is not a passing value. `qc_area_result.status` has no
   * NOT_MEASURED, so an unmeasured area is an absent row — and the absence has to
   * survive as a positive "not measured" all the way into the grade cap.
   */
  it('caps the grade when an area was never measured', async () => {
    const areas = ALL_PASS.filter((a) => a.area !== 'THERMAL');
    const reportId = await inspect({ areas });

    const outcome = await verdicts.evaluate(reportId);

    expect(outcome.blockedBy).toContain('REQUIRED_AREA_NOT_MEASURED');
    expect(outcome.autoApproved).toBe(false);
    expect(outcome.gradeFinal).not.toBe('A_PLUS');
  });

  it('stops on a serial mismatch before grading anything (QC-012)', async () => {
    const reportId = await inspect({ serialMatches: false });

    const outcome = await verdicts.evaluate(reportId);

    expect(outcome.verdict).toBe('FAIL');
    expect(outcome.blockedBy).toEqual(['SERIAL_MISMATCH']);
    expect((await unitRow()).is_sellable).toBe(false);
  });

  /**
   * A grade cannot be defended if it cannot be re-derived. A report carrying a
   * rule version other than the one its own inspection date resolves to is a
   * grade nobody can reproduce, so it is refused rather than guessed at.
   */
  it('refuses to grade against a rule set the report does not record', async () => {
    const reportId = await inspect({ rulesVersion: 'tol:2020-01-01/grade:2020-01-01' });
    await expect(verdicts.evaluate(reportId)).rejects.toThrow(/rules in force have changed/i);
  });

  it('refuses to grade an inspection with no serial comparison at all', async () => {
    const report = await repo.createReport({
      unitId,
      technicianId,
      deviceCertId: 'CERT-MANUAL',
      agentVersion: '0.1.0',
      startedAt: clock.now(),
      signature: 'sig_manual',
      nonce: randomUUID(),
      qcScore: 95,
      rulesVersion,
    });
    await expect(verdicts.evaluate(report.id)).rejects.toThrow(/serial/i);
  });

  /**
   * A re-inspection supersedes; it never overwrites. The prior report keeps its
   * score, its grade and its verification code, because it is what we told a
   * buyer at the time.
   */
  it('a failing re-inspection takes a live unit off the storefront (QC-045)', async () => {
    const first = await inspect({ batteryHealthPct: 80 });
    await verdicts.evaluate(first);
    await raw.$executeRaw`UPDATE listing.unit SET status = 'LISTED'::unit_status WHERE id = ${unitId}::uuid`;
    expect((await unitRow()).is_sellable).toBe(true);

    // The same machine, re-inspected, with a dead drive.
    const second = await repo.supersedeReport(unitId, {
      unitId,
      technicianId,
      deviceCertId: 'CERT-RECHECK',
      agentVersion: '0.1.0',
      startedAt: clock.now(),
      signature: 'sig_recheck',
      nonce: randomUUID(),
      qcScore: 95,
      rulesVersion,
    });
    await repo.upsertHardware(second.report.id, {
      hwSerial: serial,
      ramDetectedGb: 16,
      storageType: 'NVME_SSD',
      storageDetectedGb: 477,
      cpuDetected: 'i5-1145G7',
      screenSize: 13.3,
      gpuDetected: 'Intel Iris Xe',
      batteryHealthPct: 80,
      smartStatus: 'FAILING',
      biosLocked: false,
      mdmLocked: false,
      computraceActive: false,
    });
    await repo.upsertAreaResults(second.report.id, ALL_PASS);

    const outcome = await verdicts.evaluate(second.report.id, { serialMatches: true });

    expect(outcome.autoApproved).toBe(false);
    expect((await unitRow()).is_sellable).toBe(false);

    // The first report is preserved, not rewritten.
    const previous = await repo.findReportById(first);
    expect(previous!.isCurrent).toBe(false);
    expect(previous!.verdict).toBe('PASS');
    expect(previous!.supersededById).toBe(second.report.id);
  });
});

// ---------------------------------------------------------------------------

describe('grade correction', () => {
  /** Declared A, battery says A+. The grade moves, so the price band moves. */
  async function correctedInspection(): Promise<string> {
    const reportId = await inspect({ batteryHealthPct: 92 });
    const outcome = await verdicts.evaluate(reportId);
    expect(outcome.verdict).toBe('MISMATCH');
    expect(outcome.gradeCorrectionId).not.toBeNull();
    return outcome.gradeCorrectionId!;
  }

  it('raises a correction and tells the vendor immediately, with a deadline', async () => {
    const correctionId = await correctedInspection();

    const correction = await corrections.findById(correctionId);
    expect(correction!.gradeDeclared).toBe('A');
    expect(correction!.gradeCorrected).toBe('A_PLUS');
    expect(correction!.countsAgainstAccuracy).toBe(true);
    expect(correction!.vendorResponse).toBeNull();

    const [event] = await raw.$queryRaw<Array<{ payload_json: unknown }>>`
      SELECT payload_json FROM platform.event_outbox
       WHERE event_name = 'qc.grade_correction.raised'`;
    const payload = event!.payload_json as { respondByAt: string; vendorOrgId: string };
    expect(payload.vendorOrgId).toBe(vendorOrgId);
    // Two days, from `qc.grade_correction_auto_days` — not a constant here.
    expect(Date.parse(payload.respondByAt) - clock.nowMs()).toBe(2 * 86_400_000);

    expect((await unitRow()).is_sellable).toBe(false);
  });

  /** QC-031. */
  it('auto-applies on day two when the vendor says nothing', async () => {
    const correctionId = await correctedInspection();

    // Day one: nothing is due yet.
    clock.advanceDays(1);
    expect((await corrections.autoApplyDue()).applied).toEqual([]);

    // Day two, and the window is spent.
    clock.advanceDays(1);
    const run = await corrections.autoApplyDue();

    expect(run.applied).toEqual([correctionId]);
    expect(run.failed).toEqual([]);

    const correction = await corrections.findById(correctionId);
    expect(correction!.autoAppliedAt).not.toBeNull();
    expect(correction!.vendorResponse).toBeNull();
    expect(correction!.countsAgainstAccuracy).toBe(true);

    const unit = await unitRow();
    expect(unit.grade_actual).toBe('A_PLUS');
    expect(unit.status).toBe('QC_PASSED');
    // The 90 days run from the inspection, not from the vendor's silence.
    expect(unit.qc_valid_until).not.toBeNull();
  });

  it('does not auto-apply over an answer the vendor already gave', async () => {
    const correctionId = await correctedInspection();
    await corrections.respond(correctionId, 'ACCEPT_NEW_GRADE');

    clock.advanceDays(5);
    expect((await corrections.autoApplyDue()).applied).toEqual([]);

    const correction = await corrections.findById(correctionId);
    expect(correction!.autoAppliedAt).toBeNull();
    expect(correction!.vendorResponse).toBe('ACCEPT_NEW_GRADE');
    expect((await unitRow()).grade_actual).toBe('A_PLUS');
  });

  it('ACCEPT_AND_REPRICE writes the vendor ask and refuses without one', async () => {
    const correctionId = await correctedInspection();

    await expect(corrections.respond(correctionId, 'ACCEPT_AND_REPRICE')).rejects.toThrow(
      /new amount/i,
    );

    const { Money } = await import('@trugrade/contracts');
    await corrections.respond(correctionId, 'ACCEPT_AND_REPRICE', {
      vendorAskPrice: Money.rupees(38_000),
    });

    const [row] = await raw.$queryRaw<Array<{ vendor_ask_price: string }>>`
      SELECT vendor_ask_price::text FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(row!.vendor_ask_price).toBe('38000.00');
  });

  it('WITHDRAW_UNIT returns the machine and releases its serial', async () => {
    const correctionId = await correctedInspection();
    await corrections.respond(correctionId, 'WITHDRAW_UNIT');

    const unit = await unitRow();
    expect(unit.status).toBe('RETURNED_TO_VENDOR');
    expect(unit.is_sellable).toBe(false);
  });

  it('DISPUTE opens a FULL_RESCAN and only an upheld ruling clears the mark', async () => {
    const correctionId = await correctedInspection();
    await corrections.respond(correctionId, 'DISPUTE', { note: 'Battery was replaced last week.' });

    const [rescan] = await repo.findReverifications(unitId);
    expect(rescan!.method).toBe('FULL_RESCAN');
    expect(rescan!.trigger).toBe('VENDOR_REQUEST');
    expect(rescan!.outcome).toBe('ESCALATE');

    // The unit stays where the verdict left it while the dispute is open.
    expect((await unitRow()).is_sellable).toBe(false);

    const upheld = await corrections.resolveDispute(correctionId, { upheld: true });
    expect(upheld.countsAgainstAccuracy).toBe(false);
  });

  it('refuses a correction that does not actually correct anything', async () => {
    const reportId = await inspect({ batteryHealthPct: 92 });
    await verdicts.evaluate(reportId);

    await expect(
      corrections.raise({
        unitId,
        listingId,
        qcReportId: reportId,
        vendorOrgId,
        gradeDeclared: 'A',
        gradeCorrected: 'A',
        reason: 'nothing changed',
      }),
    ).rejects.toThrow(/two different grades/i);
  });

  /**
   * Accepting a grade does not un-fail a component. The correction settles the
   * grade question and nothing else — a machine with a failing drive stays off
   * the storefront whatever the vendor agrees to.
   */
  it('does not release a unit that is blocked by something other than the grade', async () => {
    const reportId = await inspect({ batteryHealthPct: 92, smartStatus: 'FAILING' });
    const outcome = await verdicts.evaluate(reportId);

    // A blocking spec difference is not listable at any grade, so no grade
    // correction is raised — there is no corrected grade to offer.
    expect(outcome.gradeFinal).toBeNull();
    expect(outcome.gradeCorrectionId).toBeNull();
    expect((await unitRow()).is_sellable).toBe(false);

    const correctionId = await corrections.raise({
      unitId,
      listingId,
      qcReportId: reportId,
      vendorOrgId,
      gradeDeclared: 'A',
      gradeCorrected: 'B',
      reason: 'manual correction by a QC manager',
    });
    await corrections.respond(correctionId, 'ACCEPT_NEW_GRADE');

    const unit = await unitRow();
    expect(unit.grade_actual).toBe('B');
    expect(unit.status).not.toBe('QC_PASSED');
    expect(unit.is_sellable).toBe(false);
  });
});
