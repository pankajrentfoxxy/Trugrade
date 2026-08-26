import { Injectable } from '@nestjs/common';
import {
  GRADE_CAP_RULES,
  QC_REQUIRED_AREAS,
  compareSpec,
  evaluateQcReport,
  type AreaResult,
  type AutoApprovalPolicy,
  type BlockReason,
  type DeclaredSpec,
  type DetectedSpec,
  type Grade,
  type QcArea,
  type SpecMatchResult,
  type VerdictResult,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events/event-bus';
import { NotFoundError, PreconditionFailedError } from '../../../shared/errors/domain-errors';
import { QC_AREA_CODES, type QcUnitOutcome, type QcVerdictValue } from '../dto/qc.dto';
import {
  QcRepository,
  type AreaResultInput,
  type MismatchInput,
  type QcAreaResultRow,
  type QcHardwareRow,
  type QcReportRow,
} from './qc.repository';
import { GradeCorrectionService } from './grade-correction.service';
import {
  ToleranceService,
  addDays,
  cfgBool,
  cfgNum,
  istDate,
  readConfig,
  type ConfigMap,
  type ToleranceRuleSet,
} from './tolerance.service';

/**
 * The verdict: what we are willing to say about a machine, and on whose behalf.
 *
 * The arithmetic is **not here.** `evaluateQcReport()` and `compareSpec()` live
 * in `@trugrade/contracts` because the technician app, the QC console and the
 * DeviceSure webhook must all reach the same answer from the same inputs, which
 * they cannot if each re-implements it. This file's job is the three things a
 * pure function cannot do:
 *
 *   1. **Load the inputs** — the declared SKU from `catalog`, the detected
 *      hardware and area results from `qc`, the tolerance rules and grade
 *      thresholds in force *on the inspection date*, and the auto-approval gate
 *      from `platform_config`. Nothing is compiled in.
 *   2. **Call the pure function once.**
 *   3. **Persist the answer** — the report, its mismatch rows, the unit's
 *      sellability, the visit's per-unit outcome, and the event other modules act
 *      on.
 *
 * ## The three rules this file is accountable for
 *
 * **A failed unit never appears on the storefront.** Not dimmed, not
 * out-of-stock — absent. Enforced in the same transaction as the verdict, by
 * clearing `qc_passed_at`/`qc_valid_until` on the unit and letting
 * `trg_recompute_sellable` decide. Deliberately *not* left to the event: an
 * outbox row that fails to dispatch must not be able to leave a failed machine
 * on sale.
 *
 * **The grade is ours, not the tool's.** `grade_proposed` is what DeviceSure
 * said; `grade_final` is what we are prepared to defend under CP e-Comm r.7(5).
 * Where they differ, `chk_override_reason` requires a written reason, and this
 * file writes a specific one rather than a placeholder.
 *
 * **Reproducible.** The rule set is resolved as of the report's own start date,
 * and the verdict refuses to run if `qc_report.rules_version` does not match what
 * that resolution produced. A grade derived against a rule set other than the one
 * the report records cannot be re-derived, and therefore cannot be defended.
 *
 * ## Two things `@trugrade/contracts` cannot express today
 *
 * Both are flagged rather than worked around, and both are marked `ponytail:` at
 * the site so they delete themselves when the contract catches up.
 *
 *   - `QC_AREAS` in `rules.ts` is the phase document's **cosmetic** vocabulary
 *     (CHASSIS, LID, PALMREST…). The `qc_area_result` CHECK allows twelve
 *     **functional** codes (DISPLAY, KEYBOARD, BIOS_SECURITY…). They do not map:
 *     five cosmetic areas collapse to PHYSICAL and four functional ones have no
 *     cosmetic counterpart. So `QC_REQUIRED_AREAS.includes()` is false for every
 *     row we actually store, and the 07 §3.1 floor rules — the ones that stop an
 *     A+ certificate with a dead USB port — never fire. `applyAreaFloor()` below
 *     applies them with the same exported `GRADE_CAP_RULES` constant until then.
 *
 *   - `VerdictInput` has no `specPolicy`, so `evaluateQcReport()` always compares
 *     the specification with `DEFAULT_SPEC_POLICY`. The screen tolerance and the
 *     CPU-blocking flag are ops-tunable in `qc_tolerance_rule` and in
 *     `platform_config`, and neither can reach it. This file runs the comparison
 *     again with the resolved policy and escalates the verdict when that policy is
 *     **stricter** — never when it is looser, because relaxing a block on the
 *     strength of a second local computation is exactly the "engine that quietly
 *     corrects its source" this phase forbids.
 */

/** Every `platform_config` key the gate is tuned by. */
const CONFIG_KEYS = [
  'qc.auto_approve_min_score',
  'qc.auto_approve_block_on_fail',
  'qc.auto_approve_block_on_not_measured',
  'qc.auto_approve_require_grade_match',
  'qc.auto_approve_require_spec_match',
  'qc.auto_approve_require_seal',
  'qc.auto_approve_require_serial_match',
  'qc.spec_match_screen_tolerance_in',
  'qc.spec_match_cpu_blocking',
  'qc.report_validity_days',
] as const;

export interface EvaluateOptions {
  /**
   * Area results to write before evaluating — the console's manual inspection
   * form and the technician app post them with the verdict call. Omit and
   * whatever ingestion already wrote is used.
   *
   * An area that was **not measured** must be omitted from this list, never sent
   * as PASS: the CHECK has no NOT_MEASURED status, so absence is how it is
   * recorded, and `evaluate()` turns the absence back into a NOT_MEASURED input.
   */
  areas?: readonly AreaResultInput[];
  /**
   * The tool-versus-manifest serial comparison, for a report with no tool run.
   *
   * Never defaulted. `serial_matches = FALSE` is the QC-012 hard stop, and
   * defaulting the unknown case to `true` would switch that stop off for every
   * manually entered inspection — the one path where nobody scanned anything.
   */
  serialMatches?: boolean;
  /** Overrides the completion instant. The 90-day window is measured from it. */
  completedAt?: Date;
}

export interface VerdictOutcome {
  qcReportId: string;
  unitId: string;
  verdict: QcVerdictValue;
  /** What the tool said. */
  gradeProposed: Grade | null;
  /** What we are prepared to claim. `null` means not listable at any grade. */
  gradeFinal: Grade | null;
  qcScore: number;
  /** The whole gate: score AND every enabled guard. Only this may reach a listing. */
  autoApproved: boolean;
  blockedBy: BlockReason[];
  /** Shown to the vendor verbatim. */
  vendorMessage: string;
  /** `YYYY-MM-DD`, set only where the inspection actually certified the machine. */
  validUntil: string | null;
  gradeCorrectionId: string | null;
  mismatches: number;
  rulesVersion: string;
}

interface UnitRow {
  id: string;
  listing_id: string | null;
  vendor_org_id: string;
  sku_id: string;
  grade_declared: Grade;
  vendor_ask_price: string | null;
}

interface SkuRow {
  sku_code: string;
  ram_gb: number;
  storage_gb: number;
  storage_type: string;
  cpu_model: string;
  screen_size_inch: number;
  gpu_type: string;
}

@Injectable()
export class VerdictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: QcRepository,
    private readonly tolerance: ToleranceService,
    private readonly corrections: GradeCorrectionService,
    private readonly bus: EventBus,
  ) {}

  /**
   * Grade a report and write the consequences, in one transaction.
   *
   * One transaction because the writes are one fact: a report that says FAIL, a
   * unit that is not sellable, and a visit line that records the outcome.
   * Splitting them leaves a window in which a failed machine is still on sale,
   * and rule 1 has no window.
   */
  async evaluate(qcReportId: string, options: EvaluateOptions = {}): Promise<VerdictOutcome> {
    return this.prisma.runInTransaction(async () => {
      const report = await this.repo.findReportById(qcReportId);
      if (!report) throw new NotFoundError('qc_report', { qcReportId });

      const set = await this.rulesFor(report);
      const cfg = await readConfig(this.prisma, CONFIG_KEYS);
      const unit = await this.unit(report.unitId);
      const sku = await this.sku(unit.sku_id);

      if (options.areas?.length) await this.repo.upsertAreaResults(qcReportId, options.areas);

      const [hardware, areaRows, seals] = await Promise.all([
        this.repo.findHardware(qcReportId),
        this.repo.findAreaResults(qcReportId),
        this.repo.findSealsByUnit(report.unitId),
      ]);

      const areas = toAreaInputs(areaRows);
      const declaredSpec = toDeclaredSpec(sku);
      const detectedSpec = hardware ? toDetectedSpec(hardware) : undefined;
      const qcScore = this.scoreOf(report, areaRows);
      const serialMatches = await this.serialMatchesFor(report, options);

      const policy: AutoApprovalPolicy = {
        minScore: cfgNum(cfg, 'qc.auto_approve_min_score'),
        blockOnRequiredFail: cfgBool(cfg, 'qc.auto_approve_block_on_fail'),
        blockOnRequiredNotMeasured: cfgBool(cfg, 'qc.auto_approve_block_on_not_measured'),
        requireGradeMatch: cfgBool(cfg, 'qc.auto_approve_require_grade_match'),
        requireSpecMatch: cfgBool(cfg, 'qc.auto_approve_require_spec_match'),
        requireSeal: cfgBool(cfg, 'qc.auto_approve_require_seal'),
        requireSerialMatch: cfgBool(cfg, 'qc.auto_approve_require_serial_match'),
      };

      const seal = seals.find((s) => s.qcReportId === qcReportId);
      const base = evaluateQcReport({
        declaredGrade: unit.grade_declared,
        declaredSpec,
        detectedSpec,
        seal: seal ? { code: seal.sealCode, photoKey: seal.appliedPhotoKey } : undefined,
        policy,
        gradeThresholds: set.gradeThresholds,
        measurements: {
          qcScore,
          areas,
          batteryHealthPct: hardware?.batteryHealthPct ?? undefined,
          batteryCycleCount: hardware?.cycleCount ?? undefined,
          serialMatches,
          toolGrade: report.gradeProposed ?? undefined,
        },
      });

      const result = applyAreaFloor(
        this.escalateForResolvedPolicy(base, set, cfg, declaredSpec, detectedSpec),
        areas,
        policy,
        unit.grade_declared,
      );

      return this.persist({ report, unit, set, cfg, result, hardware, qcScore, options });
    });
  }

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  /**
   * The rule set the report was produced under, re-resolved and verified.
   *
   * `rules_version` is written when the report is created: the ingestion path
   * calls `ToleranceService.resolve()` first and stamps the result. Re-resolving
   * here against the report's own start date and comparing is the cheap check
   * that makes reproducibility real rather than aspirational — if a rule changed
   * mid-inspection the two strings differ, and the verdict refuses rather than
   * grading against numbers the report does not record.
   */
  private async rulesFor(report: QcReportRow): Promise<ToleranceRuleSet> {
    const set = await this.tolerance.resolve(istDate(report.startedAt));
    if (!report.rulesVersion) {
      throw new PreconditionFailedError(
        'This inspection was recorded without a rule version, so its grade could not be re-derived later.',
        { qcReportId: report.id, expected: set.version, reason: 'missing_rules_version' },
      );
    }
    if (report.rulesVersion !== set.version) {
      throw new PreconditionFailedError(
        'The QC rules in force have changed since this inspection began. Re-inspect rather than grading against rules the report does not record.',
        {
          qcReportId: report.id,
          recorded: report.rulesVersion,
          resolved: set.version,
          reason: 'rules_version_drift',
        },
      );
    }
    return set;
  }

  /**
   * The aggregate score, 0–100.
   *
   * The tool's own aggregate wins where there is one: it is what the certificate
   * shows and what a buyer would read, and two numbers on one document is 07 §3.3
   * all over again. The twelve area rows are the fallback for the manual-entry
   * path, where there is no tool and the score has to come from what the
   * technician recorded. Neither is a threshold, so neither belongs in config.
   */
  private scoreOf(report: QcReportRow, areas: readonly QcAreaResultRow[]): number {
    if (report.qcScore !== null) return report.qcScore;
    const max = areas.reduce((n, a) => n + a.maxScore, 0);
    if (max <= 0) {
      throw new PreconditionFailedError(
        'This inspection has neither a tool score nor any recorded area results, so it cannot be graded.',
        { qcReportId: report.id, reason: 'no_score' },
      );
    }
    return Math.round((areas.reduce((n, a) => n + a.score, 0) / max) * 100);
  }

  /**
   * Did the serial the tool read match the manifest?
   *
   * Three states collapse to two here, and the third is a refusal rather than a
   * default. `serial_matches = NULL` on the tool run means the ingestion path
   * could not compare either — the same unknown, and answering it with `true`
   * would switch the QC-012 hard stop off on exactly the reports where nobody
   * checked which machine was on the bench.
   */
  private async serialMatchesFor(
    report: QcReportRow,
    options: EvaluateOptions,
  ): Promise<boolean> {
    if (options.serialMatches !== undefined) return options.serialMatches;

    const run = report.toolRunId ? await this.repo.findToolRunById(report.toolRunId) : null;
    if (run?.serialMatches === undefined || run?.serialMatches === null) {
      throw new PreconditionFailedError(
        'This inspection has no serial comparison recorded. Confirm the serial the tool read against the manifest before grading.',
        { qcReportId: report.id, reason: 'serial_match_unknown' },
      );
    }
    return run.serialMatches;
  }

  /**
   * ponytail: `VerdictInput` cannot carry a `SpecMatchPolicy`, so
   * `evaluateQcReport()` always compares against `DEFAULT_SPEC_POLICY` and the
   * screen tolerance and CPU-blocking flag ops actually configured never reach
   * it. This runs the comparison again with the resolved policy and escalates
   * only where the resolved policy is **stricter**.
   *
   * One direction on purpose: a second local computation may add a reason to
   * refuse a machine, never remove one. Delete this method the day `VerdictInput`
   * takes a policy — the single call inside the contract is then the only one.
   */
  private escalateForResolvedPolicy(
    base: VerdictResult,
    set: ToleranceRuleSet,
    cfg: ConfigMap,
    declared: DeclaredSpec,
    detected: DetectedSpec | undefined,
  ): VerdictResult {
    if (!detected || !base.specMatch) return base;

    const resolved = compareSpec(
      declared,
      detected,
      this.tolerance.specPolicy(set, cfg, declared.screenSizeIn),
    );

    // Same or looser: keep the contract's answer, but carry the rule severities
    // forward so `qc_mismatch` records the ops-tuned ones.
    if (resolved.mismatches.length <= base.specMatch.mismatches.length) {
      return { ...base, specMatch: this.withRuleSeverities(base.specMatch, set) };
    }

    const specMatch = this.withRuleSeverities(resolved, set);
    return {
      ...base,
      specMatch,
      blockedBy: base.blockedBy.includes('SPEC_MISMATCH')
        ? base.blockedBy
        : [...base.blockedBy, 'SPEC_MISMATCH'],
      autoApproved: false,
      gradeFound: specMatch.blocking ? null : base.gradeFound,
      verdict: specMatch.blocking ? 'FAIL' : base.verdict === 'PASS' ? 'MISMATCH' : base.verdict,
    };
  }

  /**
   * `compareSpec()` labels its findings from constants so it stays usable with no
   * database behind it. Where an effective-dated rule covers the same field, the
   * rule wins — that is what makes "an i3 sold as an i5 is blocking" an ops
   * decision rather than a deploy.
   */
  private withRuleSeverities(match: SpecMatchResult, set: ToleranceRuleSet): SpecMatchResult {
    const mismatches = match.mismatches.map((m) => ({
      ...m,
      severity: this.tolerance.severityFor(set, toleranceField(m.field), m.severity),
    }));
    return { ...match, mismatches, blocking: mismatches.some((m) => m.severity === 'BLOCKING') };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private async persist(input: {
    report: QcReportRow;
    unit: UnitRow;
    set: ToleranceRuleSet;
    cfg: ConfigMap;
    result: VerdictResult;
    hardware: QcHardwareRow | null;
    qcScore: number;
    options: EvaluateOptions;
  }): Promise<VerdictOutcome> {
    const { report, unit, set, cfg, result, hardware, qcScore, options } = input;
    const completedAt = options.completedAt ?? this.clock.now();

    // `valid_until` is the life of a claim, so it is written only where we make
    // one. A validity window on a machine we refused to vouch for is the kind of
    // column a later query reads as "this passed".
    const certified = result.autoApproved && result.gradeFound !== null;
    const validUntil = certified
      ? addDays(istDate(completedAt), cfgNum(cfg, 'qc.report_validity_days'))
      : null;

    const gradeProposed = report.gradeProposed ?? result.gradeFound;
    const gradeFinal = result.gradeFound;

    await this.repo.completeReport(report.id, {
      verdict: result.verdict,
      qcScore,
      gradeProposed,
      gradeFinal,
      gradeOverrideReason: overrideReason(gradeProposed, gradeFinal, result),
      completedAt,
      validUntil,
    });

    const mismatches = this.mismatchRows(result, set, unit, hardware);
    await this.writeMismatches(report.id, mismatches);

    await this.updateUnit(unit, {
      status: result.verdict === 'FAIL' ? 'QC_FAILED' : certified ? 'QC_PASSED' : 'QC_MISMATCH',
      gradeActual: gradeFinal,
      qcScore,
      batteryHealthPct: hardware?.batteryHealthPct ?? null,
      passedAt: certified ? completedAt : null,
      validUntil,
      reportId: report.id,
    });
    await this.updateVisitUnit(report, result);

    const gradeCorrectionId =
      result.requiresGradeCorrection && gradeFinal !== null
        ? await this.corrections.raise({
            unitId: unit.id,
            listingId: unit.listing_id,
            qcReportId: report.id,
            vendorOrgId: unit.vendor_org_id,
            gradeDeclared: unit.grade_declared,
            gradeCorrected: gradeFinal,
            reason: result.vendorMessage,
            priceBefore: unit.vendor_ask_price,
          })
        : null;

    const [after] = await this.prisma.$queryRaw<Array<{ is_sellable: boolean }>>`
      SELECT is_sellable FROM listing.unit WHERE id = ${unit.id}::uuid`;

    await this.bus.publish('qc.report.completed', {
      qcReportId: report.id,
      unitId: unit.id,
      vendorOrgId: unit.vendor_org_id,
      skuId: unit.sku_id,
      verdict: result.verdict,
      gradeDeclared: unit.grade_declared,
      gradeActual: gradeFinal,
      qcScore,
      // The truth after this transaction, not a prediction. A unit is not
      // sellable at this point even on a clean pass — it still needs a seal and
      // a LISTED status, which are other lanes' work.
      isSellable: after?.is_sellable ?? false,
    });

    return {
      qcReportId: report.id,
      unitId: unit.id,
      verdict: result.verdict,
      gradeProposed,
      gradeFinal,
      qcScore,
      autoApproved: result.autoApproved,
      blockedBy: result.blockedBy,
      vendorMessage: result.vendorMessage,
      validUntil,
      gradeCorrectionId,
      mismatches: mismatches.length,
      rulesVersion: set.version,
    };
  }

  /**
   * `qc_mismatch` rows: the declared-versus-detected differences, plus the three
   * tolerance rules `compareSpec()` has no opinion on — battery health, the grade
   * band and the cycle count.
   *
   * `field` is always a `qc_hardware_detected` column name, or `grade`, so a
   * mismatch row and the tolerance rule that produced it name the same thing and
   * a dispute can be traced from one to the other.
   */
  private mismatchRows(
    result: VerdictResult,
    set: ToleranceRuleSet,
    unit: UnitRow,
    hardware: QcHardwareRow | null,
  ): MismatchInput[] {
    const rows: MismatchInput[] = (result.specMatch?.mismatches ?? []).map((m) => ({
      field: toleranceField(m.field),
      declaredValue: m.declared,
      // The raw reading, not the normalised one. The certificate has to show what
      // the tool actually said — "15 GB" — even where the comparison was made
      // against the corrected 16.
      actualValue: m.detectedRaw,
      severity: this.tolerance.severityFor(set, toleranceField(m.field), m.severity),
    }));

    const extra: Array<[string, unknown, unknown]> = [
      ['battery_health_pct', unit.grade_declared, hardware?.batteryHealthPct ?? null],
      ['grade', unit.grade_declared, result.gradeFound],
      ['cycle_count', null, hardware?.cycleCount ?? null],
    ];

    for (const [field, declared, detected] of extra) {
      const check = this.tolerance.check(set, field, declared, detected);
      // NOT_REPORTED is not a mismatch. A cycle count the collector could not
      // read (07 §3.5) must not fire a MINOR difference on every honest machine —
      // the grade cap for an unmeasured battery is the contract's job, not a row
      // here claiming the vendor declared something wrong.
      if (check?.outcome !== 'OUTSIDE') continue;
      rows.push({
        field: check.field,
        declaredValue: check.declared,
        actualValue: check.detected,
        severity: check.severity,
      });
    }

    return rows;
  }

  /**
   * Insert once.
   *
   * `qc_mismatch` has no natural key, so re-running `evaluate()` on the same
   * report would double every row. A re-inspection creates a *new* report and is
   * unaffected; a retry of the same one is idempotent this way.
   */
  private async writeMismatches(reportId: string, rows: readonly MismatchInput[]): Promise<void> {
    if (rows.length === 0) return;
    const existing = await this.repo.findMismatches(reportId);
    if (existing.length > 0) return;
    await this.repo.insertMismatches(reportId, rows);
  }

  /**
   * The unit, and with it the storefront.
   *
   * `is_sellable` is not written here — `listing.recompute_is_sellable()` owns
   * it, in one place, and this sets the inputs it reads. Clearing `qc_passed_at`
   * and `qc_valid_until` on anything short of a clean pass is what makes rule 1
   * true for a **re**-inspection: a unit that was live yesterday and failed today
   * leaves the storefront in this statement, not on the next job run.
   */
  private async updateUnit(
    unit: UnitRow,
    patch: {
      status: string;
      gradeActual: Grade | null;
      qcScore: number;
      batteryHealthPct: number | null;
      passedAt: Date | null;
      validUntil: string | null;
      reportId: string;
    },
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE listing.unit SET
        status             = ${patch.status}::public.unit_status,
        grade_actual       = ${patch.gradeActual}::public.grade_type,
        qc_report_id       = ${patch.reportId}::uuid,
        qc_score           = ${patch.qcScore}::int,
        battery_health_pct = COALESCE(${patch.batteryHealthPct}::numeric, battery_health_pct),
        qc_passed_at       = ${patch.passedAt}::timestamptz,
        qc_valid_until     = ${patch.validUntil}::date
      WHERE id = ${unit.id}::uuid`;
  }

  private async updateVisitUnit(report: QcReportRow, result: VerdictResult): Promise<void> {
    if (!report.visitId) return;
    const [line] = await this.repo.findVisitUnits({
      visitId: report.visitId,
      unitId: report.unitId,
    });
    if (!line) return;

    await this.repo.updateVisitUnit(line.id, {
      outcome: visitOutcome(result),
      qcReportId: report.id,
      completedAt: this.clock.now(),
    });
    await this.repo.recountVisit(report.visitId);
  }

  // -------------------------------------------------------------------------

  /**
   * The unit and the SKU, read as two statements.
   *
   * Not a join: two module schemas in one query is a `no-cross-schema-join`
   * error, and the seam it protects is the one that lets `qc` become its own
   * service later without rewriting anything here.
   */
  private async unit(unitId: string): Promise<UnitRow> {
    const [row] = await this.prisma.$queryRaw<UnitRow[]>`
      SELECT id, listing_id, vendor_org_id, sku_id, grade_declared,
             vendor_ask_price::text AS vendor_ask_price
        FROM listing.unit WHERE id = ${unitId}::uuid`;
    if (!row) throw new NotFoundError('unit', { unitId });
    return row;
  }

  /**
   * The cast on `screen_size_inch` is load-bearing. NUMERIC(4,1) arrives from
   * Prisma as a Decimal, and Decimal-minus-number is NaN — `NaN > tolerance` is
   * false, so an uncoerced value makes the screen check pass for every machine
   * ever inspected, silently. A screen size is a measurement rather than money,
   * so a float is the right type for it.
   */
  private async sku(skuId: string): Promise<SkuRow> {
    const [row] = await this.prisma.$queryRaw<SkuRow[]>`
      SELECT sku_code, ram_gb, storage_gb, storage_type, cpu_model,
             screen_size_inch::float8 AS screen_size_inch, gpu_type
        FROM catalog.sku WHERE id = ${skuId}::uuid`;
    if (!row) throw new NotFoundError('sku', { skuId });
    return row;
  }
}

// ---------------------------------------------------------------------------
// Input mapping
// ---------------------------------------------------------------------------

/**
 * The twelve area inputs, including the ones nobody measured.
 *
 * `qc_area_result.status` has no NOT_MEASURED — the CHECK allows PASS, WARN and
 * FAIL only — so an unmeasured area is recorded as an **absent row**. The verdict
 * engine's `blockOnRequiredNotMeasured` reads a positive NOT_MEASURED outcome, so
 * the absence is turned back into one here. Without this, "the thermal sensor
 * could not be read" is indistinguishable from "the thermal sensor is fine",
 * which is precisely the defect 07 §3.1 found on the sample certificate.
 */
function toAreaInputs(rows: readonly QcAreaResultRow[]): AreaResult[] {
  const measured = new Set(rows.map((r) => r.area));
  const areas: AreaResult[] = rows.map((r) => ({
    // ponytail: the two vocabularies genuinely differ — see the file header. The
    // cast lets the schema's codes reach a function typed against the document's;
    // `applyAreaFloor()` restores the behaviour the cast costs.
    area: r.area as unknown as QcArea,
    outcome: r.status as AreaResult['outcome'],
    score: r.score,
  }));
  for (const code of QC_AREA_CODES) {
    if (!measured.has(code)) {
      areas.push({ area: code as unknown as QcArea, outcome: 'NOT_MEASURED' });
    }
  }
  return areas;
}

function toDeclaredSpec(sku: SkuRow): DeclaredSpec {
  return {
    skuCode: sku.sku_code,
    ramGb: Number(sku.ram_gb),
    storageGb: Number(sku.storage_gb),
    storageType: sku.storage_type,
    cpuModel: sku.cpu_model,
    screenSizeIn: Number(sku.screen_size_inch),
    gpuType: sku.gpu_type,
  };
}

/**
 * What the tool reported, mapped without correction.
 *
 * `ram_detected_gb` goes in as `ramUsableGb`, which is what it is: Windows
 * `TotalPhysicalMemory`, i.e. memory usable by the OS — 15 GB on a 16 GB machine
 * (07 §3.4). `compareSpec()` snaps it to the installed figure and renders both.
 * There is no `ram_installed_gb` column to read, and inventing one here by adding
 * a gigabyte would be a parser quietly correcting its source; the fix belongs in
 * DeviceSure's Windows collector.
 *
 * Every `null` becomes `undefined`, which `compareSpec()` reads as **not
 * reported** rather than as a mismatch. A missing value is not a passing value,
 * and it is not a failing one either.
 */
function toDetectedSpec(hw: QcHardwareRow): DetectedSpec {
  return {
    ramUsableGb: hw.ramDetectedGb,
    ramModuleCount: hw.ramModules ?? undefined,
    storageBinaryGb: hw.storageDetectedGb ?? undefined,
    storageType: hw.storageType ?? undefined,
    cpuModel: hw.cpuDetected ?? undefined,
    screenSizeIn: hw.screenSize ?? undefined,
    gpuType: hw.gpuDetected ?? undefined,
    biosLocked: hw.biosLocked,
    mdmLocked: hw.mdmLocked,
    computraceActive: hw.computraceActive,
    smartStatus: hw.smartStatus ?? undefined,
  };
}

/** `SpecField` → the `qc_tolerance_rule.field` / `qc_hardware_detected` column. */
const TOLERANCE_FIELD: Readonly<Record<string, string>> = Object.freeze({
  RAM_GB: 'ram_detected_gb',
  STORAGE_GB: 'storage_detected_gb',
  STORAGE_TYPE: 'storage_type',
  CPU_MODEL: 'cpu_detected',
  SCREEN_SIZE_IN: 'screen_size',
  GPU_TYPE: 'gpu_detected',
  BIOS_LOCK: 'bios_locked',
  MDM_LOCK: 'mdm_locked',
  COMPUTRACE: 'computrace_active',
  SMART_STATUS: 'smart_status',
});

function toleranceField(specField: string): string {
  return TOLERANCE_FIELD[specField] ?? specField.toLowerCase();
}

// ---------------------------------------------------------------------------
// The area floor, until `@trugrade/contracts` can see the schema's codes
// ---------------------------------------------------------------------------

/**
 * ponytail: 07 §3.1's floor rules, applied to the area codes
 * `QC_REQUIRED_AREAS` does not contain.
 *
 * A weighted mean cannot express "one critical component failed" — eleven areas
 * at 100 and one at 30 averages ~94 and the dead USB port disappears — which is
 * why `evaluateQcReport()` has a floor. It cannot apply that floor to our rows,
 * because `QC_AREAS` in `rules.ts` carries the cosmetic vocabulary and every
 * functional code we store is therefore "not required" to it.
 *
 * The caps come from the same exported `GRADE_CAP_RULES` constant the contract
 * uses, so there is one table of caps rather than two. **Delete this function the
 * moment `QC_AREAS` carries the twelve schema codes**: `unseen` is empty then and
 * every line below is a no-op.
 */
function applyAreaFloor(
  result: VerdictResult,
  areas: readonly AreaResult[],
  policy: AutoApprovalPolicy,
  declaredGrade: Grade,
): VerdictResult {
  const unseen = areas.filter(
    (a) => !(QC_REQUIRED_AREAS as readonly string[]).includes(a.area as string),
  );
  if (unseen.length === 0) return result;

  // Worst-wins. `null` is "not listable at any grade" and therefore last.
  const order: Array<Grade | null> = ['A_PLUS', 'A', 'B', null];
  const rank = (g: Grade | null): number => order.indexOf(g);

  let grade = result.gradeFound;
  const cappedBy = [...result.cappedBy];
  const blockedBy = [...result.blockedBy];
  const failed: string[] = [];
  const unmeasured: string[] = [];

  for (const area of unseen) {
    if (area.outcome === 'FAIL') {
      if (rank(GRADE_CAP_RULES.failOnRequired) > rank(grade)) grade = GRADE_CAP_RULES.failOnRequired;
      cappedBy.push({ area: area.area, outcome: 'FAIL' });
      failed.push(label(area.area));
      if (policy.blockOnRequiredFail && !blockedBy.includes('REQUIRED_AREA_FAILED')) {
        blockedBy.push('REQUIRED_AREA_FAILED');
      }
    } else if (area.outcome === 'WARN') {
      if (rank(GRADE_CAP_RULES.warnOnRequired) > rank(grade)) grade = GRADE_CAP_RULES.warnOnRequired;
      cappedBy.push({ area: area.area, outcome: 'WARN' });
    } else if (area.outcome === 'NOT_MEASURED') {
      if (rank(GRADE_CAP_RULES.notMeasuredOnRequired) > rank(grade)) {
        grade = GRADE_CAP_RULES.notMeasuredOnRequired;
      }
      cappedBy.push({ area: area.area, outcome: 'NOT_MEASURED' });
      unmeasured.push(label(area.area));
      if (policy.blockOnRequiredNotMeasured && !blockedBy.includes('REQUIRED_AREA_NOT_MEASURED')) {
        blockedBy.push('REQUIRED_AREA_NOT_MEASURED');
      }
    }
  }

  if (blockedBy.length === result.blockedBy.length && grade === result.gradeFound) return result;

  // Recomputed, not carried over. A cap that moves the grade from the declared A
  // to a B is a grade correction the vendor is owed, and the contract decided
  // `requiresGradeCorrection` before this function had capped anything.
  const requiresGradeCorrection = grade !== null && grade !== declaredGrade;
  if (requiresGradeCorrection && policy.requireGradeMatch && !blockedBy.includes('GRADE_MISMATCH')) {
    blockedBy.push('GRADE_MISMATCH');
  }

  const verdict: QcVerdictValue =
    grade === null || !result.scorePassed
      ? 'FAIL'
      : requiresGradeCorrection || result.specMatch?.matches === false
        ? 'MISMATCH'
        : cappedBy.length > 0
          ? 'PASS_WITH_NOTE'
          : result.verdict;

  return {
    ...result,
    verdict,
    gradeFound: grade,
    requiresGradeCorrection,
    cappedBy,
    blockedBy,
    autoApproved: blockedBy.length === 0,
    // Rewritten only where this function is the reason the unit is blocked.
    // Otherwise the contract's message is the more specific one and stands.
    vendorMessage:
      result.blockedBy.length > 0
        ? result.vendorMessage
        : failed.length > 0
          ? `The inspection recorded a failure on the ${listOf(failed)}. Fix it and run the inspection again — a unit with a failed component cannot be listed whatever its overall score.`
          : `The inspection could not measure the ${listOf(unmeasured)}. We will not certify a component nobody measured — please re-run the inspection.`,
  };
}

const AREA_LABEL: Readonly<Record<string, string>> = Object.freeze({
  DISPLAY: 'display',
  KEYBOARD: 'keyboard',
  BATTERY: 'battery',
  STORAGE: 'storage',
  MEMORY_CPU: 'memory and CPU',
  PORTS: 'ports',
  CONNECTIVITY: 'wireless',
  CAMERA_AUDIO: 'camera and audio',
  THERMAL: 'cooling',
  BIOS_SECURITY: 'BIOS security',
  DATA_SECURITY: 'data security',
  PHYSICAL: 'physical condition',
});

function label(area: string): string {
  return AREA_LABEL[area] ?? area.toLowerCase().replace(/_/g, ' ');
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? 'component';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------

/**
 * `chk_override_reason`: a proposed grade may differ from the final grade only
 * with a written reason.
 *
 * Written rather than templated-empty, because this sentence is what a dispute
 * turns on. "Overridden" is not a reason; "the tool proposed A+, graded A because
 * the cooling system was not measured" is.
 */
function overrideReason(
  proposed: Grade | null,
  final: Grade | null,
  result: VerdictResult,
): string | null {
  if (proposed === null || final === null || proposed === final) return null;
  const caps = result.cappedBy.map((c) => `${label(c.area as string)} ${c.outcome.toLowerCase()}`);
  return caps.length > 0
    ? `Tool proposed ${proposed}; graded ${final} on ${caps.join(', ')}.`
    : `Tool proposed ${proposed}; graded ${final} — ${result.blockedBy.join(', ') || 'platform review'}.`;
}

function visitOutcome(result: VerdictResult): QcUnitOutcome {
  if (result.verdict === 'FAIL') return 'FAIL';
  if (result.requiresGradeCorrection) return 'PASS_GRADE_CORRECTED';
  // A spec mismatch that is not a grade correction is a machine that is not what
  // was listed. There is no "sell it anyway" outcome for that.
  if (result.verdict === 'MISMATCH') return 'FAIL';
  return result.verdict === 'PASS_WITH_NOTE' ? 'PASS_WITH_NOTE' : 'PASS';
}
