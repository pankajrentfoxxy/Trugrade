import { evaluateQcReport, type GradeThresholds } from '../src/qc-verdict';
import { GRADE_THRESHOLDS } from '../src/rules';

/**
 * Exit criterion 5: the QC engine reads `catalog.grade_definition`, not a
 * hard-coded constant.
 *
 * The direction of that dependency is the whole point. Rule 7(5) makes the
 * grading claim a liability trigger, and the CCPA Misleading Advertisements
 * Guidelines 2022 test claims against reality — so "Grade A" has to be a
 * threshold a machine either meets or does not, evaluated against a versioned
 * row rather than a number somebody compiled in.
 *
 * The practical consequence: a report written six months ago must be re-readable
 * against the numbers that applied when it was written. A constant cannot do
 * that, because there is only ever one of it.
 */

function report(batteryHealthPct: number, thresholds?: GradeThresholds) {
  return evaluateQcReport({
    declaredGrade: 'B',
    measurements: {
      qcScore: 95,
      areas: [],
      batteryHealthPct,
      serialMatches: true,
    },
    ...(thresholds ? { gradeThresholds: thresholds } : {}),
  });
}

describe('the thresholds come from the caller', () => {
  it('uses the seeded numbers by default — 85 / 75 / 60', () => {
    // TEST_PLAN VR-094/VR-095. Phase 2's prose says 90/80/70; that figure
    // appears nowhere else in the pack and this is the decided set.
    expect(GRADE_THRESHOLDS.A_PLUS.minBatteryHealthPct).toBe(85);
    expect(GRADE_THRESHOLDS.A.minBatteryHealthPct).toBe(75);
    expect(GRADE_THRESHOLDS.B.minBatteryHealthPct).toBe(60);
  });

  it.each([
    [92, 'A_PLUS'],
    [85, 'A_PLUS'],
    [84, 'A'],
    [75, 'A'],
    [74, 'B'],
    [60, 'B'],
  ])('a %i%% battery grades %s under the default thresholds', (pct, expected) => {
    expect(report(pct).gradeFound).toBe(expected);
  });

  it('is not sellable below the B floor', () => {
    // Nothing worse than B is sold, so there is no grade to fall back to.
    expect(report(59).gradeFound).toBeNull();
  });
});

describe('a different table row changes the answer', () => {
  /** What a stricter revision of catalog.grade_definition would look like. */
  const STRICTER: GradeThresholds = Object.freeze({
    A_PLUS: { minBatteryHealthPct: 90, maxCycleCount: 300 },
    A: { minBatteryHealthPct: 80, maxCycleCount: 700 },
    B: { minBatteryHealthPct: 70, maxCycleCount: 1200 },
  });

  it('grades the same machine lower under stricter thresholds', () => {
    // This is the assertion that proves the dependency direction. If the engine
    // still consulted the constant, both calls would return A_PLUS and this
    // would fail — which is exactly what it is here to catch.
    expect(report(87).gradeFound).toBe('A_PLUS');
    expect(report(87, STRICTER).gradeFound).toBe('A');
  });

  it('makes a machine unsellable that the current rules would list', () => {
    expect(report(65).gradeFound).toBe('B');
    expect(report(65, STRICTER).gradeFound).toBeNull();
  });

  it('leaves a machine well inside every band unaffected', () => {
    // A revision must not silently re-grade the whole fleet; only the machines
    // near a boundary move.
    expect(report(95).gradeFound).toBe('A_PLUS');
    expect(report(95, STRICTER).gradeFound).toBe('A_PLUS');
  });

  it('reads a historical row, so an old report stays readable', () => {
    // The row is effective-dated. Passing the thresholds that applied on the
    // report date is what makes a six-month-old certificate defensible.
    const asWrittenInJanuary: GradeThresholds = Object.freeze({
      A_PLUS: { minBatteryHealthPct: 80, maxCycleCount: 400 },
      A: { minBatteryHealthPct: 70, maxCycleCount: 800 },
      B: { minBatteryHealthPct: 55, maxCycleCount: 1400 },
    });
    expect(report(82, asWrittenInJanuary).gradeFound).toBe('A_PLUS');
    // The same machine, graded under today's rules, is only an A.
    expect(report(82).gradeFound).toBe('A');
  });
});

describe('an unmeasured battery is still not a pass', () => {
  it('caps at A whatever the thresholds say', () => {
    const r = evaluateQcReport({
      declaredGrade: 'A',
      measurements: { qcScore: 95, areas: [], serialMatches: true },
    });
    // We would otherwise be certifying A+ on a figure nobody measured.
    expect(r.gradeFound).toBe('A');
    expect(r.cappedBy.some((c) => c.area === 'BATTERY')).toBe(true);
  });
});
