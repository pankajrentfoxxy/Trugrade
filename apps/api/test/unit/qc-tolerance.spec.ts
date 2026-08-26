/**
 * The four tolerance comparisons, on their own.
 *
 * `qc_tolerance_rule` is ops-editable and its `comparison` is per row, so any
 * field can be pointed at any comparison without a deploy. That makes the switch
 * in `ToleranceService.compare()` the thing that has to be right for
 * combinations nobody has seeded yet — which is exactly what a pure test is for.
 *
 * The case that matters most is the one that is neither a pass nor a failure:
 * a value the tool did not report. `07 §3.5` found a cycle count defaulting to
 * `0`, which is indistinguishable from a measurement — so `NOT_REPORTED` has to
 * be its own outcome, and neither of the other two.
 */

import type { GradeThresholds } from '@trugrade/contracts';
import {
  ToleranceService,
  type ToleranceRuleSet,
} from '../../src/modules/qc/internal/tolerance.service';
import type { QcToleranceRuleRow } from '../../src/modules/qc/internal/qc.repository';
import type { ToleranceComparison } from '../../src/modules/qc/dto/qc.dto';

// `check()` touches neither Prisma nor the repository; it is the pure half.
const service = new ToleranceService(undefined as never, undefined as never);

const THRESHOLDS: GradeThresholds = {
  A_PLUS: { minBatteryHealthPct: 85, maxCycleCount: 300 },
  A: { minBatteryHealthPct: 75, maxCycleCount: 700 },
  B: { minBatteryHealthPct: 60, maxCycleCount: 1200 },
};

function ruleSet(...rules: Array<Partial<QcToleranceRuleRow> & { field: string }>): ToleranceRuleSet {
  return {
    onDate: '2026-08-26',
    version: 'tol:2026-08-26/grade:2026-01-01',
    gradeThresholds: THRESHOLDS,
    rules: new Map(
      rules.map((r) => [
        r.field,
        {
          id: r.field,
          comparison: 'EXACT' as ToleranceComparison,
          toleranceValue: null,
          severity: 'MAJOR' as const,
          isBlocking: false,
          effectiveFrom: '2026-08-26',
          ...r,
        },
      ]),
    ),
  };
}

describe('no rule is not a pass', () => {
  it('returns null so the caller keeps its own judgement', () => {
    expect(service.check(ruleSet(), 'gpu_detected', 'INTEGRATED', 'NVIDIA T500')).toBeNull();
  });
});

describe('EXACT', () => {
  const set = ruleSet(
    { field: 'ram_detected_gb', comparison: 'EXACT', severity: 'BLOCKING', isBlocking: true },
    { field: 'smart_status', comparison: 'EXACT', toleranceValue: 'OK', severity: 'BLOCKING' },
  );

  it('with no tolerance value compares against the declaration', () => {
    expect(service.check(set, 'ram_detected_gb', 16, 16)!.outcome).toBe('WITHIN');
    expect(service.check(set, 'ram_detected_gb', 16, 8)!.outcome).toBe('OUTSIDE');
  });

  it('with a tolerance value compares against that literal, whatever was declared', () => {
    // The vendor does not get to declare a failing drive acceptable.
    expect(service.check(set, 'smart_status', 'FAILING', 'FAILING')!.outcome).toBe('OUTSIDE');
    expect(service.check(set, 'smart_status', 'FAILING', 'OK')!.outcome).toBe('WITHIN');
  });

  it('carries the rule severity and blocking flag onto the answer', () => {
    const check = service.check(set, 'ram_detected_gb', 16, 8)!;
    expect(check.severity).toBe('BLOCKING');
    expect(check.isBlocking).toBe(true);
    expect(check.declared).toBe('16');
    expect(check.detected).toBe('8');
  });
});

describe('GTE', () => {
  const set = ruleSet({ field: 'cycle_count', comparison: 'GTE', toleranceValue: '0' });

  it('compares the detected value against the floor', () => {
    expect(service.check(set, 'cycle_count', null, 120)!.outcome).toBe('WITHIN');
    expect(service.check(set, 'cycle_count', null, -1)!.outcome).toBe('OUTSIDE');
  });

  it('a cycle count the collector never reported is NOT_REPORTED, not a mismatch', () => {
    // 07 §3.5. Firing a MINOR difference on every machine whose WMI cannot read
    // this is how a never-fabricate policy becomes noise nobody reads.
    expect(service.check(set, 'cycle_count', null, null)!.outcome).toBe('NOT_REPORTED');
  });
});

describe('WITHIN_PCT', () => {
  it('is a percentage of the declared value, not an absolute', () => {
    const set = ruleSet({ field: 'screen_size', comparison: 'WITHIN_PCT', toleranceValue: '2' });
    expect(service.check(set, 'screen_size', 13.3, 13.5)!.outcome).toBe('WITHIN');
    expect(service.check(set, 'screen_size', 13.3, 15.6)!.outcome).toBe('OUTSIDE');
  });

  it('a zero tolerance means exact', () => {
    const set = ruleSet({ field: 'screen_size', comparison: 'WITHIN_PCT', toleranceValue: '0' });
    expect(service.check(set, 'screen_size', 13.3, 13.3)!.outcome).toBe('WITHIN');
    expect(service.check(set, 'screen_size', 13.3, 13.4)!.outcome).toBe('OUTSIDE');
  });
});

describe('ONE_BAND_DOWN', () => {
  const set = ruleSet(
    { field: 'grade', comparison: 'ONE_BAND_DOWN', toleranceValue: '1' },
    { field: 'battery_health_pct', comparison: 'ONE_BAND_DOWN', toleranceValue: '1' },
  );

  it('takes grade labels', () => {
    expect(service.check(set, 'grade', 'A_PLUS', 'A')!.outcome).toBe('WITHIN');
    expect(service.check(set, 'grade', 'A_PLUS', 'B')!.outcome).toBe('OUTSIDE');
    // Better than declared is never a mismatch.
    expect(service.check(set, 'grade', 'B', 'A_PLUS')!.outcome).toBe('WITHIN');
  });

  it('bands a battery percentage through the same effective-dated thresholds', () => {
    // Declared A+ (>=85). 80% is band A — one down, allowed. 62% is band B — two.
    expect(service.check(set, 'battery_health_pct', 'A_PLUS', 80)!.outcome).toBe('WITHIN');
    expect(service.check(set, 'battery_health_pct', 'A_PLUS', 62)!.outcome).toBe('OUTSIDE');
    // Below the B floor is off the scale entirely.
    expect(service.check(set, 'battery_health_pct', 'A', 40)!.outcome).toBe('OUTSIDE');
  });

  it('an unreported battery is NOT_REPORTED', () => {
    expect(service.check(set, 'battery_health_pct', 'A', null)!.outcome).toBe('NOT_REPORTED');
  });
});

describe('WITHIN_BAND', () => {
  it('raises rather than reading as within tolerance', () => {
    // Legal in the CHECK, never seeded, not implemented. A comparison the engine
    // cannot make is not a comparison that passed.
    const set = ruleSet({ field: 'screen_size', comparison: 'WITHIN_BAND', toleranceValue: '1' });
    expect(() => service.check(set, 'screen_size', 13.3, 15.6)).toThrow(/WITHIN_BAND/);
  });
});

describe('severityFor', () => {
  it('lets the versioned rule override the constant, and falls back to it', () => {
    const set = ruleSet({ field: 'cpu_detected', comparison: 'EXACT', severity: 'MINOR' });
    expect(service.severityFor(set, 'cpu_detected', 'BLOCKING')).toBe('MINOR');
    expect(service.severityFor(set, 'storage_type', 'BLOCKING')).toBe('BLOCKING');
  });
});

describe('specPolicy', () => {
  const cfg = new Map<string, unknown>([
    ['qc.spec_match_screen_tolerance_in', 0.2],
    ['qc.spec_match_cpu_blocking', true],
  ]);

  it('converts a percentage rule into inches against the declared panel', () => {
    const set = ruleSet({ field: 'screen_size', comparison: 'WITHIN_PCT', toleranceValue: '2' });
    expect(service.specPolicy(set, cfg, 13.3).screenToleranceIn).toBeCloseTo(0.266, 3);
    expect(service.specPolicy(set, cfg, 17.3).screenToleranceIn).toBeCloseTo(0.346, 3);
  });

  it('falls back to config where no rule covers the field', () => {
    const policy = service.specPolicy(ruleSet(), cfg, 13.3);
    expect(policy.screenToleranceIn).toBe(0.2);
    expect(policy.cpuBlocking).toBe(true);
  });

  it('takes the CPU blocking flag from the rule when there is one', () => {
    const set = ruleSet({ field: 'cpu_detected', comparison: 'EXACT', isBlocking: false });
    expect(service.specPolicy(set, cfg, 13.3).cpuBlocking).toBe(false);
  });
});
