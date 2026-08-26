/**
 * The QC verdict and the auto-approval gate.
 *
 * This is the highest-liability pure function in the system. It decides whether a
 * machine goes live on our own invoice, at a grade we vouch for under Consumer
 * Protection (E-Commerce) Rule 7(5), on the basis of a report produced — after the
 * first supervised visit — by the vendor who gets paid for it.
 *
 * It lives in `packages/contracts` rather than in the `qc` module for two reasons:
 * it is pure, so it is exhaustively unit-testable without a database; and the
 * technician app, the QC console and the ingestion endpoint must all reach the
 * same verdict from the same inputs, which they cannot if each re-implements it.
 *
 * Every threshold here is a *default*. The live values come from `platform_config`
 * and are passed in, so ops can retune without a deploy.
 */

import {
  GRADE_THRESHOLDS,
  QC_REQUIRED_AREAS,
  type Grade,
  type QcArea,
  type QcAreaOutcome,
  type QcVerdict,
} from './rules';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface AreaResult {
  area: QcArea;
  outcome: QcAreaOutcome;
  /** 0–10. Absent when the area was not measured — never defaulted to 0. */
  score?: number;
  note?: string;
}

export interface QcMeasurements {
  /** The aggregate the tool produced, 0–100. */
  qcScore: number;
  areas: readonly AreaResult[];
  /** Absent means not reported. `0` would be a measurement, and a false one. */
  batteryHealthPct?: number;
  /** `07 §3.5`: a cycle count of exactly 0 on a worn battery is a default, not a reading. */
  batteryCycleCount?: number;
  /** From the tool, compared against the manifest. FALSE is an immediate stop. */
  serialMatches: boolean;
  /** DeviceSure grades A+/A/B/C/D/FAIL. C, D and FAIL are not listable. */
  toolGrade?: string;
}

export interface AutoApprovalPolicy {
  /**
   * The client's rule (Q15): a score strictly above this auto-approves.
   * Necessary, but deliberately not sufficient — see `blockOnRequiredFail`.
   */
  minScore: number;
  /** Cap the grade rather than approve when a required area FAILs. */
  blockOnRequiredFail: boolean;
  /** An unmeasured required area is a material unknown we would be vouching for. */
  blockOnRequiredNotMeasured: boolean;
  /** A grade mismatch auto-listed at the declared grade is our misrepresentation. */
  requireGradeMatch: boolean;
  requireSeal: boolean;
  requireSerialMatch: boolean;
}

export const DEFAULT_AUTO_APPROVAL: AutoApprovalPolicy = Object.freeze({
  minScore: 75,
  blockOnRequiredFail: true,
  blockOnRequiredNotMeasured: true,
  requireGradeMatch: true,
  requireSeal: true,
  requireSerialMatch: true,
});

export interface VerdictInput {
  declaredGrade: Grade;
  measurements: QcMeasurements;
  /** A seal is applied only after a pass; absent during evaluation is normal. */
  seal?: { code: string; photoKey: string | null };
  policy?: AutoApprovalPolicy;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Why a unit was blocked. Each maps to a message the vendor can act on. */
export type BlockReason =
  | 'SERIAL_MISMATCH'
  | 'SCORE_BELOW_THRESHOLD'
  | 'REQUIRED_AREA_FAILED'
  | 'REQUIRED_AREA_NOT_MEASURED'
  | 'GRADE_MISMATCH'
  | 'BELOW_MINIMUM_GRADE'
  | 'NO_SEAL'
  | 'SEAL_NOT_PHOTOGRAPHED'
  | 'NOT_LISTABLE_TOOL_GRADE';

export interface VerdictResult {
  verdict: QcVerdict;
  /** Null when the machine does not reach grade B — nothing worse than B is sold. */
  gradeFound: Grade | null;
  /** Did the aggregate clear the client's threshold, considered on its own? */
  scorePassed: boolean;
  /** The whole gate: score AND every enabled guard. */
  autoApproved: boolean;
  /** Empty when auto-approved. Ordered most-blocking first. */
  blockedBy: BlockReason[];
  /** What the vendor is told, verbatim. Specific enough to act on (08 §8 rule 2). */
  vendorMessage: string;
  /** True when the declared and found grades differ — creates a grade_correction. */
  requiresGradeCorrection: boolean;
  /** Areas that capped the grade, for the console and the certificate face. */
  cappedBy: Array<{ area: QcArea; outcome: QcAreaOutcome }>;
}

// ---------------------------------------------------------------------------

const GRADE_ORDER: readonly Grade[] = ['A_PLUS', 'A', 'B'];

/** The stricter (lower) of two grades. `null` means "not sellable at all". */
function capGrade(current: Grade | null, cap: Grade | null): Grade | null {
  if (current === null || cap === null) return null;
  return GRADE_ORDER.indexOf(current) >= GRADE_ORDER.indexOf(cap) ? current : cap;
}

/**
 * Grade from the measured battery, per `catalog.grade_definition`.
 * An unreported battery does not silently pass — it caps at A, because we would
 * otherwise be certifying A+ on a figure nobody measured.
 */
function gradeFromBattery(m: QcMeasurements): { grade: Grade | null; measured: boolean } {
  if (m.batteryHealthPct === undefined || !Number.isFinite(m.batteryHealthPct)) {
    return { grade: 'A', measured: false };
  }
  const pct = m.batteryHealthPct;
  if (pct >= GRADE_THRESHOLDS.A_PLUS.minBatteryHealthPct)
    return { grade: 'A_PLUS', measured: true };
  if (pct >= GRADE_THRESHOLDS.A.minBatteryHealthPct) return { grade: 'A', measured: true };
  if (pct >= GRADE_THRESHOLDS.B.minBatteryHealthPct) return { grade: 'B', measured: true };
  // Below the B floor the machine is not sellable at any grade.
  return { grade: null, measured: true };
}

/**
 * `07 §4 item 8` — DeviceSure grades A+/A/B/C/D/FAIL; we list A+/A/B only.
 * C, D and FAIL map to *not listable*, explicitly, never by convention.
 */
export function mapToolGrade(toolGrade: string | undefined): Grade | null {
  switch ((toolGrade ?? '').toUpperCase().replace(/[\s+]/g, (c) => (c === '+' ? '_PLUS' : ''))) {
    case 'A_PLUS':
      return 'A_PLUS';
    case 'A':
      return 'A';
    case 'B':
      return 'B';
    default:
      return null;
  }
}

/**
 * Evaluate a QC report.
 *
 * The ordering below is deliberate: a serial mismatch short-circuits everything,
 * because at that point we do not know which machine we are looking at and every
 * other number on the report is about something else.
 */
export function evaluateQcReport(input: VerdictInput): VerdictResult {
  const policy = input.policy ?? DEFAULT_AUTO_APPROVAL;
  const m = input.measurements;
  const blockedBy: BlockReason[] = [];
  const cappedBy: VerdictResult['cappedBy'] = [];

  // --- 1. Serial. An immediate hard stop (QC-012). ---------------------------
  // The label does not belong to the laptop. Do not grade it, do not seal it.
  if (!m.serialMatches) {
    return {
      verdict: 'FAIL',
      gradeFound: null,
      scorePassed: false,
      autoApproved: false,
      blockedBy: ['SERIAL_MISMATCH'],
      vendorMessage:
        'The serial number the tool read does not match the serial declared for this unit. We have stopped the inspection and raised this with our QC manager — please confirm which machine was tested.',
      requiresGradeCorrection: false,
      cappedBy: [],
    };
  }

  // --- 2. Component floor rules (07 §3.1) ------------------------------------
  // A weighted mean cannot express "one critical component failed", so the mean
  // never decides alone. Eleven areas at 100 and one at 30 averages to ~94, and
  // the dead port disappears. This is where it stops disappearing.
  let grade: Grade | null = 'A_PLUS';

  for (const area of m.areas) {
    const required = (QC_REQUIRED_AREAS as readonly string[]).includes(area.area);
    if (!required) continue;

    if (area.outcome === 'FAIL') {
      // We sell nothing below B, so a required-area failure caps at B — and a
      // B that failed a required area is then not sellable either.
      grade = capGrade(grade, 'B');
      cappedBy.push({ area: area.area, outcome: 'FAIL' });
      if (policy.blockOnRequiredFail && !blockedBy.includes('REQUIRED_AREA_FAILED')) {
        blockedBy.push('REQUIRED_AREA_FAILED');
      }
    } else if (area.outcome === 'NOT_MEASURED') {
      // "Certified A+, 1 of 15 components not measurable" is honest. Silence is not.
      grade = capGrade(grade, 'A');
      cappedBy.push({ area: area.area, outcome: 'NOT_MEASURED' });
      if (policy.blockOnRequiredNotMeasured && !blockedBy.includes('REQUIRED_AREA_NOT_MEASURED')) {
        blockedBy.push('REQUIRED_AREA_NOT_MEASURED');
      }
    } else if (area.outcome === 'WARN') {
      grade = capGrade(grade, 'A');
      cappedBy.push({ area: area.area, outcome: 'WARN' });
    }
  }

  // --- 3. Battery ------------------------------------------------------------
  const battery = gradeFromBattery(m);
  grade = capGrade(grade, battery.grade);
  if (!battery.measured) {
    cappedBy.push({ area: 'BATTERY', outcome: 'NOT_MEASURED' });
    if (policy.blockOnRequiredNotMeasured && !blockedBy.includes('REQUIRED_AREA_NOT_MEASURED')) {
      blockedBy.push('REQUIRED_AREA_NOT_MEASURED');
    }
  }

  // --- 4. The tool's own grade, mapped ---------------------------------------
  if (m.toolGrade !== undefined) {
    const mapped = mapToolGrade(m.toolGrade);
    if (mapped === null) {
      grade = null;
      blockedBy.push('NOT_LISTABLE_TOOL_GRADE');
    } else {
      grade = capGrade(grade, mapped);
    }
  }

  // --- 5. The client's score threshold (Q15) ---------------------------------
  const scorePassed = m.qcScore > policy.minScore;
  if (!scorePassed) blockedBy.push('SCORE_BELOW_THRESHOLD');

  // --- 6. Nothing worse than B is sold ---------------------------------------
  // Skipped when the tool grade already explained why: "below grade B" and
  // "the tool graded this C" are the same fact, and the second one is the useful
  // half. Saying both makes the vendor guess which to act on.
  if (
    grade === null &&
    !blockedBy.includes('BELOW_MINIMUM_GRADE') &&
    !blockedBy.includes('NOT_LISTABLE_TOOL_GRADE')
  ) {
    blockedBy.push('BELOW_MINIMUM_GRADE');
  }

  // --- 7. Grade correction ---------------------------------------------------
  const requiresGradeCorrection = grade !== null && grade !== input.declaredGrade;
  if (requiresGradeCorrection && policy.requireGradeMatch) blockedBy.push('GRADE_MISMATCH');

  // --- 8. Seal ---------------------------------------------------------------
  if (policy.requireSeal) {
    if (!input.seal) blockedBy.push('NO_SEAL');
    else if (!input.seal.photoKey) blockedBy.push('SEAL_NOT_PHOTOGRAPHED');
  }

  // --- 9. Verdict ------------------------------------------------------------
  const verdict: QcVerdict =
    grade === null || !scorePassed
      ? 'FAIL'
      : requiresGradeCorrection
        ? 'MISMATCH'
        : cappedBy.length > 0
          ? 'PASS_WITH_NOTE'
          : 'PASS';

  return {
    verdict,
    gradeFound: grade,
    scorePassed,
    autoApproved: blockedBy.length === 0,
    blockedBy: orderReasons(blockedBy),
    vendorMessage: messageFor(orderReasons(blockedBy), {
      grade,
      declared: input.declaredGrade,
      cappedBy,
      score: m.qcScore,
      policy,
    }),
    requiresGradeCorrection,
    cappedBy,
  };
}

/** Most-blocking first, so the vendor is told the thing that actually stops them. */
const REASON_PRIORITY: readonly BlockReason[] = [
  'SERIAL_MISMATCH',
  'NOT_LISTABLE_TOOL_GRADE',
  'BELOW_MINIMUM_GRADE',
  'REQUIRED_AREA_FAILED',
  'SCORE_BELOW_THRESHOLD',
  'REQUIRED_AREA_NOT_MEASURED',
  'GRADE_MISMATCH',
  'NO_SEAL',
  'SEAL_NOT_PHOTOGRAPHED',
];

function orderReasons(reasons: BlockReason[]): BlockReason[] {
  return [...new Set(reasons)].sort(
    (a, b) => REASON_PRIORITY.indexOf(a) - REASON_PRIORITY.indexOf(b),
  );
}

const GRADE_LABEL: Record<Grade, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };
const AREA_LABEL: Record<string, string> = {
  CHASSIS: 'chassis',
  LID: 'lid',
  PALMREST: 'palmrest',
  KEYBOARD: 'keyboard',
  TRACKPAD: 'trackpad',
  SCREEN: 'screen',
  HINGES: 'hinges',
  PORTS: 'ports',
  BATTERY: 'battery',
  STORAGE: 'storage',
  MEMORY: 'memory',
  THERMALS: 'thermals',
};

/**
 * What the vendor reads. It has to name the specific thing to fix, because they
 * are the ones re-running the tool — "Inspection failed" sends them to support,
 * "the left USB port did not respond" sends them to the machine.
 */
function messageFor(
  reasons: BlockReason[],
  ctx: {
    grade: Grade | null;
    declared: Grade;
    cappedBy: VerdictResult['cappedBy'];
    score: number;
    policy: AutoApprovalPolicy;
  },
): string {
  if (reasons.length === 0) {
    return `Passed at grade ${GRADE_LABEL[ctx.grade!]}, score ${ctx.score}. This unit is live.`;
  }

  const failed = ctx.cappedBy
    .filter((c) => c.outcome === 'FAIL')
    .map((c) => AREA_LABEL[c.area] ?? c.area);
  const unmeasured = ctx.cappedBy
    .filter((c) => c.outcome === 'NOT_MEASURED')
    .map((c) => AREA_LABEL[c.area] ?? c.area);

  switch (reasons[0]) {
    case 'BELOW_MINIMUM_GRADE':
      return 'This unit does not reach grade B, which is the lowest grade we list. It cannot be sold on the platform — please withdraw it.';
    case 'NOT_LISTABLE_TOOL_GRADE':
      return 'The inspection graded this unit below B. We list A+, A and B only, so this unit cannot go live.';
    case 'REQUIRED_AREA_FAILED':
      return `The inspection recorded a failure on the ${listOf(failed)}. Fix it and run the inspection again — a unit with a failed component cannot be listed whatever its overall score.`;
    case 'SCORE_BELOW_THRESHOLD':
      return `The inspection scored ${ctx.score}, and we list at above ${ctx.policy.minScore}. Address what the report flags and run it again.`;
    case 'REQUIRED_AREA_NOT_MEASURED':
      return `The inspection could not measure the ${listOf(unmeasured)}. We will not certify a component nobody measured — please re-run the inspection, and contact us if it still cannot read ${unmeasured.length > 1 ? 'them' : 'it'}.`;
    case 'GRADE_MISMATCH':
      return `You declared grade ${GRADE_LABEL[ctx.declared]}; the inspection found grade ${GRADE_LABEL[ctx.grade!]}. Accept the corrected grade, re-price it, or dispute it — no response within 2 days applies the correction automatically.`;
    case 'NO_SEAL':
      return 'This unit passed inspection but has no tamper seal recorded. Apply a seal from your issued roll and photograph it on the machine.';
    case 'SEAL_NOT_PHOTOGRAPHED':
      return 'The seal was recorded without a photograph. Photograph the seal on the machine — there is no seal without a photograph.';
    default:
      return 'This unit cannot be listed yet. Open the inspection report for the details.';
  }
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'component';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Score-distribution monitoring
// ---------------------------------------------------------------------------

/**
 * Publishing an auto-approval threshold creates an incentive to hit exactly one
 * point above it. A vendor whose scores cluster just over the line is gaming it,
 * and that is measurable rather than merely suspected.
 *
 * Compares the share of a vendor's units landing in `[threshold, threshold + band)`
 * against the share expected from a roughly even spread across the passing range.
 * A ratio well above 1 is the signal; the caller decides what to do with it
 * (the design intent is to put that vendor back on 100% audit recheck).
 */
export interface ClusteringSignal {
  unitsInBand: number;
  unitsTotal: number;
  observedShare: number;
  expectedShare: number;
  /** observed ÷ expected. Above ~2.5 on a decent sample is worth a look. */
  ratio: number;
  suspicious: boolean;
}

export function detectScoreClustering(
  scores: readonly number[],
  opts: { threshold?: number; band?: number; minSample?: number; ratioAlert?: number } = {},
): ClusteringSignal {
  const threshold = opts.threshold ?? DEFAULT_AUTO_APPROVAL.minScore;
  const band = opts.band ?? 5;
  const minSample = opts.minSample ?? 20;
  const ratioAlert = opts.ratioAlert ?? 2.5;

  const passing = scores.filter((s) => s > threshold);
  const inBand = passing.filter((s) => s < threshold + band);

  const observedShare = passing.length ? inBand.length / passing.length : 0;
  // An even spread over (threshold, 100] would put band/(100-threshold) here.
  const expectedShare = band / Math.max(1, 100 - threshold);
  const ratio = expectedShare > 0 ? observedShare / expectedShare : 0;

  return {
    unitsInBand: inBand.length,
    unitsTotal: passing.length,
    observedShare,
    expectedShare,
    ratio,
    // Never flag on a small sample — the same honesty rule as the headline average.
    suspicious: passing.length >= minSample && ratio >= ratioAlert,
  };
}
