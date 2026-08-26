import { Injectable } from '@nestjs/common';
import {
  GRADES,
  TIMEZONE,
  type Grade,
  type GradeThresholds,
  type SpecMatchPolicy,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { PreconditionFailedError } from '../../../shared/errors/domain-errors';
import type { MismatchSeverity, ToleranceComparison } from '../dto/qc.dto';
import { QcRepository, type QcToleranceRuleRow } from './qc.repository';

/**
 * `qc.qc_tolerance_rule` and `catalog.grade_definition`, resolved as of a date
 * and applied.
 *
 * Grading is a liability control under CP e-Comm r.7(5): we vouch for the grade,
 * so the grade has to be **re-derivable** months later against the numbers that
 * were in force on the day of the inspection — not against today's. Everything
 * in this file exists to make that true. Nothing here carries a threshold of its
 * own; the eleven seeded rules and the effective-dated grade definitions are the
 * only source, and a rule this engine cannot apply raises rather than passes.
 *
 * Three things it owns:
 *
 *   1. **Resolution as of a date.** `resolve(onDate)` reads the tolerance rules
 *      and the grade thresholds that applied on `onDate`, and stamps the pair
 *      with a `version` string. That string is written to
 *      `qc_report.rules_version` when the report is created and checked again
 *      when the verdict is written — a report graded against a rule set other
 *      than the one it records is a grade nobody can reproduce.
 *
 *   2. **The four comparisons in use.** EXACT, GTE, WITHIN_PCT, ONE_BAND_DOWN.
 *      `WITHIN_BAND` is legal in the CHECK and unseeded; it raises rather than
 *      quietly reading as "within tolerance", because a comparison the engine
 *      does not implement is not a comparison that passed.
 *
 *   3. **Severity.** `compareSpec()` in `@trugrade/contracts` carries its own
 *      default severities so it stays usable without a database. Where a
 *      tolerance rule covers the same field, the **rule wins** — it is the
 *      versioned, ops-tunable one, and the constant is the fallback.
 *
 * ## The knob that is deliberately read from the rules, not from config
 *
 * `qc.spec_match_screen_tolerance_in` and `qc.spec_match_cpu_blocking` exist in
 * `platform_config`, and the `screen_size` / `cpu_detected` tolerance rules say
 * the same thing again. Two knobs for one number is how the two stop agreeing,
 * so the rule wins where there is one and the config key is the fallback for
 * when there is not. The rule is the half that is effective-dated, and only the
 * effective-dated half can be defended against an old report.
 *
 * **The two currently disagree in the seed** — `screen_size` is WITHIN_PCT `0`
 * (exact) while `qc.spec_match_screen_tolerance_in` is `0.2`. The rule wins, so
 * the platform behaves as 0% today. Ops should reconcile the two rather than
 * this file picking the looser number on their behalf.
 */

/** `platform.v_current_config`, as a map. Shared by the three services in this lane. */
export type ConfigMap = ReadonlyMap<string, unknown>;

export async function readConfig(
  prisma: PrismaService,
  keys: readonly string[],
): Promise<ConfigMap> {
  const rows = await prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
    SELECT key, value_json FROM platform.v_current_config
     WHERE key = ANY(${[...keys]}::text[])`;
  return new Map(rows.map((r) => [r.key, r.value_json]));
}

/**
 * A config value that must exist.
 *
 * Missing keys raise rather than fall back to a number compiled into the build.
 * A silent default is how "ops retuned the auto-approval gate and nothing
 * happened" gets diagnosed three weeks later as a caching bug.
 */
function cfgRaw(cfg: ConfigMap, key: string): unknown {
  const value = cfg.get(key);
  if (value === undefined) {
    throw new PreconditionFailedError(
      `QC configuration "${key}" is not set, so an inspection cannot be graded.`,
      { key, reason: 'missing_platform_config' },
    );
  }
  return value;
}

export function cfgNum(cfg: ConfigMap, key: string): number {
  const value = cfgRaw(cfg, key);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PreconditionFailedError(`QC configuration "${key}" is not a number.`, { key });
  }
  return value;
}

export function cfgBool(cfg: ConfigMap, key: string): boolean {
  const value = cfgRaw(cfg, key);
  if (typeof value !== 'boolean') {
    throw new PreconditionFailedError(`QC configuration "${key}" is not a boolean.`, { key });
  }
  return value;
}

// ---------------------------------------------------------------------------

/**
 * The outcome of one tolerance comparison.
 *
 * Three states, not two. `NOT_REPORTED` is the one that keeps `never-fabricate`
 * (07 §2) honest: the tool did not measure this, which is neither a pass nor a
 * mismatch. Collapsing it into `WITHIN` certifies something nobody looked at;
 * collapsing it into `OUTSIDE` fires a mismatch on every machine whose collector
 * cannot read a cycle count (07 §3.5). It has to be its own answer.
 */
export type ToleranceOutcome = 'WITHIN' | 'OUTSIDE' | 'NOT_REPORTED';

export interface ToleranceCheck {
  /** The rule's own `field`: a `qc_hardware_detected` column name, or `grade`. */
  field: string;
  comparison: ToleranceComparison;
  outcome: ToleranceOutcome;
  severity: MismatchSeverity;
  isBlocking: boolean;
  /** Rendered for `qc_mismatch.declared_value` / `actual_value`, which are TEXT. */
  declared: string;
  detected: string;
}

export interface ToleranceRuleSet {
  /** `YYYY-MM-DD`. The inspection date this set was resolved as of. */
  onDate: string;
  /**
   * `qc_report.rules_version`.
   *
   * The two effective dates that pin the set, so a dispute is answered by
   * reading two rows rather than by trusting that nothing has been edited since.
   * Re-resolving on the report's own start date reproduces it exactly.
   */
  version: string;
  gradeThresholds: GradeThresholds;
  rules: ReadonlyMap<string, QcToleranceRuleRow>;
}

interface GradeDefRow {
  grade: Grade;
  min_battery_health_pct: number;
  max_cycle_count: number | null;
  effective_from: string;
}

@Injectable()
export class ToleranceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
  ) {}

  /**
   * The rule set in force on `onDate` (`YYYY-MM-DD`).
   *
   * Called once at the start of an inspection — the resolved `version` goes onto
   * the report at creation — and again when the verdict is written, against the
   * report's own start date. Resolving it a second time at completion against
   * *today* would quietly re-grade an inspection that began before a rule change.
   */
  async resolve(onDate: string): Promise<ToleranceRuleSet> {
    const [rules, grades] = await Promise.all([
      this.repo.findToleranceRules(onDate),
      this.gradeDefinitions(onDate),
    ]);

    if (rules.length === 0) {
      // Not a warning. With no rules every declared-versus-detected comparison
      // is a no-op, nothing is ever flagged, and QC-025 inverts silently.
      throw new PreconditionFailedError(
        'No QC tolerance rules were in force on this date, so a grade cannot be derived.',
        { onDate, reason: 'no_tolerance_rules' },
      );
    }
    if (grades.length !== GRADES.length) {
      throw new PreconditionFailedError(
        'The grade definitions in force on this date are incomplete, so a grade cannot be derived.',
        { onDate, found: grades.map((g) => g.grade), reason: 'incomplete_grade_definition' },
      );
    }

    const thresholds = Object.fromEntries(
      grades.map((g) => [
        g.grade,
        {
          minBatteryHealthPct: Number(g.min_battery_health_pct),
          // A NULL ceiling is "no ceiling", not "zero cycles allowed".
          maxCycleCount: g.max_cycle_count === null ? Infinity : Number(g.max_cycle_count),
        },
      ]),
    ) as unknown as GradeThresholds;

    return {
      onDate,
      version: `tol:${maxOf(rules.map((r) => r.effectiveFrom))}/grade:${maxOf(
        grades.map((g) => g.effective_from),
      )}`,
      gradeThresholds: thresholds,
      rules: new Map(rules.map((r) => [r.field, r])),
    };
  }

  /**
   * `catalog.grade_definition`, as of a date.
   *
   * A separate statement rather than a join: `catalog` is another module's
   * schema and `no-cross-schema-join` is a lint error, not a preference. The
   * shape mirrors `catalog.v_current_grade_definition`, except that the view is
   * pinned to CURRENT_DATE and this has to answer for an old inspection.
   */
  private async gradeDefinitions(onDate: string): Promise<GradeDefRow[]> {
    return this.prisma.$queryRaw<GradeDefRow[]>`
      SELECT DISTINCT ON (grade)
             grade, min_battery_health_pct, max_cycle_count,
             effective_from::text AS effective_from
        FROM catalog.grade_definition
       WHERE effective_from <= ${onDate}::date
         AND (effective_to IS NULL OR effective_to > ${onDate}::date)
       ORDER BY grade, effective_from DESC`;
  }

  /**
   * The policy `compareSpec()` is called with.
   *
   * Takes the declared screen size because the rule is a **percentage** and
   * `SpecMatchPolicy` wants **inches**; 2% of a 13.3" panel is not 2% of a 17.3"
   * one. Both knobs fall back to `platform_config` when no rule covers them —
   * see the file header on why the rule wins when one does.
   */
  specPolicy(set: ToleranceRuleSet, cfg: ConfigMap, declaredScreenIn?: number): SpecMatchPolicy {
    const screen = set.rules.get('screen_size');
    const cpu = set.rules.get('cpu_detected');

    let screenToleranceIn = cfgNum(cfg, 'qc.spec_match_screen_tolerance_in');
    if (screen && declaredScreenIn !== undefined && Number.isFinite(declaredScreenIn)) {
      if (screen.comparison === 'WITHIN_PCT') {
        screenToleranceIn = (Math.abs(declaredScreenIn) * numeric(screen.toleranceValue, 0)) / 100;
      } else if (screen.comparison === 'EXACT') {
        screenToleranceIn = 0;
      }
    }

    return {
      screenToleranceIn,
      cpuBlocking: cpu ? cpu.isBlocking : cfgBool(cfg, 'qc.spec_match_cpu_blocking'),
    };
  }

  /**
   * The severity a mismatch on `field` carries.
   *
   * `compareSpec()` labels its own findings so it stays usable with no database
   * behind it. Where a versioned rule covers the same field it overrides, which
   * is what makes "an i3 sold as an i5 is blocking" an ops decision rather than
   * a deploy.
   */
  severityFor(set: ToleranceRuleSet, field: string, fallback: MismatchSeverity): MismatchSeverity {
    return set.rules.get(field)?.severity ?? fallback;
  }

  /**
   * Apply the rule for `field`, if there is one.
   *
   * `null` means **no rule covers this field**, which is not the same as a pass —
   * the caller keeps its own judgement. `storage_type` and `gpu_type` are covered
   * by `compareSpec()` and are deliberately unseeded here.
   */
  check(
    set: ToleranceRuleSet,
    field: string,
    declared: unknown,
    detected: unknown,
  ): ToleranceCheck | null {
    const rule = set.rules.get(field);
    if (!rule) return null;

    const base = {
      field,
      comparison: rule.comparison,
      severity: rule.severity,
      isBlocking: rule.isBlocking,
      declared: render(declared),
      detected: render(detected),
    };

    if (detected === null || detected === undefined || detected === '') {
      return { ...base, outcome: 'NOT_REPORTED' };
    }

    return { ...base, outcome: this.compare(rule, declared, detected, set.gradeThresholds) };
  }

  private compare(
    rule: QcToleranceRuleRow,
    declared: unknown,
    detected: unknown,
    thresholds: GradeThresholds,
  ): ToleranceOutcome {
    switch (rule.comparison) {
      case 'EXACT': {
        // A tolerance_value on an EXACT rule is a **required literal**, not a
        // tolerance: `bios_locked` must be 'false' and `smart_status` must be
        // 'OK' whatever the vendor declared. Where it is NULL the declaration is
        // what must be matched — `ram_detected_gb`, `storage_detected_gb`,
        // `cpu_detected`.
        const expected = rule.toleranceValue ?? declared;
        return render(detected).toUpperCase() === render(expected).toUpperCase()
          ? 'WITHIN'
          : 'OUTSIDE';
      }

      case 'GTE':
        return numeric(detected, NaN) >= numeric(rule.toleranceValue, 0) ? 'WITHIN' : 'OUTSIDE';

      case 'WITHIN_PCT': {
        const d = numeric(declared, NaN);
        const a = numeric(detected, NaN);
        if (!Number.isFinite(d) || !Number.isFinite(a)) return 'NOT_REPORTED';
        const allowed = (Math.abs(d) * numeric(rule.toleranceValue, 0)) / 100;
        return Math.abs(a - d) <= allowed ? 'WITHIN' : 'OUTSIDE';
      }

      case 'ONE_BAND_DOWN': {
        // Both seeded users of this comparison band onto the same three grades:
        // `grade` arrives as a grade label, `battery_health_pct` as a percentage
        // the grade definitions turn into one. `bandOf` takes either, so there is
        // one code path rather than a special case per field.
        const declaredBand = bandOf(declared, thresholds);
        const detectedBand = bandOf(detected, thresholds);
        if (declaredBand === null || detectedBand === null) return 'NOT_REPORTED';
        return detectedBand - declaredBand <= Math.max(0, numeric(rule.toleranceValue, 1))
          ? 'WITHIN'
          : 'OUTSIDE';
      }

      case 'WITHIN_BAND':
        // Legal in the CHECK, never seeded, and not implemented. Raising is the
        // only honest answer: a comparison the engine cannot make is not a
        // comparison that passed, and returning WITHIN would certify a machine
        // against a rule nobody ran.
        throw new PreconditionFailedError(
          `Tolerance rule "${rule.field}" uses WITHIN_BAND, which this engine does not implement.`,
          { field: rule.field, comparison: rule.comparison, reason: 'unimplemented_comparison' },
        );
    }
  }
}

// ---------------------------------------------------------------------------

/** `qc_mismatch.declared_value` and `actual_value` are TEXT. Booleans included. */
function render(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

function numeric(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Which grade band a value sits in. 0 is A+, 2 is B, 3 is below anything we list.
 *
 * A grade label indexes directly. A number is a battery-health percentage, which
 * the effective-dated thresholds turn into the same three bands — the identical
 * ladder `gradeFromBattery()` walks inside `evaluateQcReport()`, read from the
 * same rows, so the two cannot disagree about where a 74% battery lands.
 */
function bandOf(value: unknown, thresholds: GradeThresholds): number | null {
  if (typeof value === 'string') {
    const i = (GRADES as readonly string[]).indexOf(value.toUpperCase());
    if (i >= 0) return i;
  }
  const pct = numeric(value, NaN);
  if (!Number.isFinite(pct)) return null;
  for (let i = 0; i < GRADES.length; i++) {
    if (pct >= thresholds[GRADES[i]!].minBatteryHealthPct) return i;
  }
  return GRADES.length;
}

function maxOf(dates: readonly string[]): string {
  return dates.reduce((a, b) => (b > a ? b : a), dates[0] ?? '');
}

/**
 * The IST calendar date of an instant.
 *
 * VR-160: storage is UTC, every business window in this system is Asia/Kolkata.
 * A 90-day validity reckoned off the UTC date expires a day early for anyone
 * reading it in India, which on a certificate is a day of stock nobody can sell.
 * Shared by the verdict and the grade correction so the two cannot disagree
 * about which day an inspection happened on.
 */
export function istDate(when: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(when);
}

/** Calendar-day arithmetic on a `YYYY-MM-DD`, with no timezone left to get wrong. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
