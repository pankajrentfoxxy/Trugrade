/**
 * The auto-approval gate.
 *
 * The first block is the one that matters: it reproduces the DeviceSure v0.1.0
 * defect (`07 §3.1` — a certificate graded A+ with a failed USB port) and shows
 * that a score threshold alone lets it through, while the gate as built does not.
 *
 * Everything else here is a liability control under CP e-Comm r.7(2) or r.7(5),
 * expressed as a test rather than as a paragraph.
 */

import {
  DEFAULT_AUTO_APPROVAL,
  detectScoreClustering,
  evaluateQcReport,
  mapToolGrade,
  type AreaResult,
  type QcMeasurements,
} from '../src/qc-verdict';
import { QC_AREAS, type Grade } from '../src/rules';

/** Twelve areas, all passing at 10. The baseline a good machine produces. */
const allPass = (): AreaResult[] =>
  QC_AREAS.map((area) => ({ area, outcome: 'PASS' as const, score: 10 }));

const measurements = (over: Partial<QcMeasurements> = {}): QcMeasurements => ({
  qcScore: 96,
  areas: allPass(),
  batteryHealthPct: 91,
  batteryCycleCount: 148,
  serialMatches: true,
  ...over,
});

const sealed = { code: 'TRG-26HR-0004821', photoKey: 'qc/seals/abc.jpg' };

const evaluate = (over: Partial<Parameters<typeof evaluateQcReport>[0]> = {}) =>
  evaluateQcReport({
    declaredGrade: 'A_PLUS',
    measurements: measurements(),
    seal: sealed,
    ...over,
  });

// ---------------------------------------------------------------------------

describe('the happy path', () => {
  it('auto-approves a clean A+ machine', () => {
    const r = evaluate();
    expect(r.verdict).toBe('PASS');
    expect(r.gradeFound).toBe('A_PLUS');
    expect(r.autoApproved).toBe(true);
    expect(r.blockedBy).toEqual([]);
    expect(r.vendorMessage).toMatch(/Passed at grade A\+, score 96/);
  });
});

// ---------------------------------------------------------------------------

describe('07 §3.1 — the A+ with a dead USB port', () => {
  /**
   * The exact certificate from the DeviceSure review: eleven components at 100,
   * ports at 30, thermal unmeasured, aggregate 98.24, graded A+.
   */
  const defectiveCertificate = measurements({
    qcScore: 98,
    areas: allPass().map((a) =>
      a.area === 'PORTS'
        ? { ...a, outcome: 'FAIL' as const, score: 3, note: 'ports.manual FAIL' }
        : a.area === 'THERMALS'
          ? { ...a, outcome: 'NOT_MEASURED' as const, score: undefined }
          : a,
    ),
  });

  it('a score threshold ON ITS OWN would let it through — this is the whole concern', () => {
    // Score 98 > 75. If the score were the only rule, this ships.
    expect(defectiveCertificate.qcScore > DEFAULT_AUTO_APPROVAL.minScore).toBe(true);

    const scoreOnly = evaluate({
      measurements: defectiveCertificate,
      policy: {
        ...DEFAULT_AUTO_APPROVAL,
        blockOnRequiredFail: false,
        blockOnRequiredNotMeasured: false,
        requireGradeMatch: false,
      },
    });
    expect(scoreOnly.autoApproved).toBe(true);
  });

  it('the gate as built blocks it, and names the port', () => {
    const r = evaluate({ measurements: defectiveCertificate });

    expect(r.autoApproved).toBe(false);
    expect(r.scorePassed).toBe(true); // the score was never the problem
    expect(r.blockedBy).toContain('REQUIRED_AREA_FAILED');
    expect(r.vendorMessage).toMatch(/failure on the ports/);
    expect(r.vendorMessage).toMatch(/whatever its overall score/);
  });

  it('and it is not graded A+ either — a failed required area caps at B', () => {
    const r = evaluate({ measurements: defectiveCertificate });
    expect(r.gradeFound).toBe('B');
    expect(r.cappedBy).toContainEqual({ area: 'PORTS', outcome: 'FAIL' });
    expect(r.cappedBy).toContainEqual({ area: 'THERMALS', outcome: 'NOT_MEASURED' });
  });
});

// ---------------------------------------------------------------------------

describe('the score threshold, as given (Q15)', () => {
  it('above 75 passes the score check', () => {
    expect(evaluate({ measurements: measurements({ qcScore: 76 }) }).scorePassed).toBe(true);
  });

  it('exactly 75 does not — the rule is "greater than 75"', () => {
    const r = evaluate({ measurements: measurements({ qcScore: 75 }) });
    expect(r.scorePassed).toBe(false);
    expect(r.blockedBy).toContain('SCORE_BELOW_THRESHOLD');
    expect(r.verdict).toBe('FAIL');
  });

  it('tells the vendor the score and the bar, so they know how far off they are', () => {
    const r = evaluate({ measurements: measurements({ qcScore: 62 }) });
    expect(r.vendorMessage).toMatch(/scored 62/);
    expect(r.vendorMessage).toMatch(/above 75/);
    expect(r.vendorMessage).toMatch(/run it again/);
  });

  it('the threshold is configurable without a deploy', () => {
    const strict = evaluate({
      measurements: measurements({ qcScore: 80 }),
      policy: { ...DEFAULT_AUTO_APPROVAL, minScore: 85 },
    });
    expect(strict.scorePassed).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('QC-012 — serial mismatch is an immediate hard stop', () => {
  it('stops before grading, whatever the score says', () => {
    const r = evaluate({
      measurements: measurements({ serialMatches: false, qcScore: 99 }),
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.gradeFound).toBeNull();
    expect(r.blockedBy).toEqual(['SERIAL_MISMATCH']);
    expect(r.cappedBy).toEqual([]); // nothing else was even evaluated
  });

  it('says something a vendor can act on rather than "inspection failed"', () => {
    const r = evaluate({ measurements: measurements({ serialMatches: false }) });
    expect(r.vendorMessage).toMatch(/does not match the serial declared/);
    expect(r.vendorMessage).toMatch(/confirm which machine was tested/);
  });
});

// ---------------------------------------------------------------------------

describe('a missing value is never a passing value', () => {
  it('an unmeasured required area caps the grade at A, never A+', () => {
    const r = evaluate({
      measurements: measurements({
        areas: allPass().map((a) =>
          a.area === 'THERMALS' ? { ...a, outcome: 'NOT_MEASURED' as const, score: undefined } : a,
        ),
      }),
    });
    expect(r.gradeFound).toBe('A');
    expect(r.blockedBy).toContain('REQUIRED_AREA_NOT_MEASURED');
    expect(r.vendorMessage).toMatch(/could not measure the thermals/);
    expect(r.vendorMessage).toMatch(/will not certify a component nobody measured/);
  });

  it('an unreported battery caps at A rather than certifying A+ on a figure nobody measured', () => {
    const r = evaluate({ measurements: measurements({ batteryHealthPct: undefined }) });
    expect(r.gradeFound).toBe('A');
    expect(r.cappedBy).toContainEqual({ area: 'BATTERY', outcome: 'NOT_MEASURED' });
  });

  it('a battery reported at 0% is a MEASUREMENT, and a failing one — not the same as absent', () => {
    const measured = evaluate({ measurements: measurements({ batteryHealthPct: 0 }) });
    expect(measured.gradeFound).toBeNull();
    expect(measured.blockedBy).toContain('BELOW_MINIMUM_GRADE');

    const absent = evaluate({ measurements: measurements({ batteryHealthPct: undefined }) });
    expect(absent.gradeFound).toBe('A');
  });

  it('names every unmeasured area, not just the first', () => {
    const r = evaluate({
      measurements: measurements({
        areas: allPass().map((a) =>
          a.area === 'THERMALS' || a.area === 'MEMORY'
            ? { ...a, outcome: 'NOT_MEASURED' as const, score: undefined }
            : a,
        ),
      }),
    });
    expect(r.vendorMessage).toMatch(/memory and thermals|thermals and memory/);
  });
});

// ---------------------------------------------------------------------------

describe('battery thresholds map to grades from catalog.grade_definition', () => {
  it.each<[number, Grade | null]>([
    [95, 'A_PLUS'],
    [85, 'A_PLUS'],
    [84, 'A'],
    [75, 'A'],
    [74, 'B'],
    [60, 'B'],
    [59, null],
  ])('battery %i%% grades as %s', (pct, expected) => {
    const r = evaluate({
      declaredGrade: expected ?? 'B',
      measurements: measurements({ batteryHealthPct: pct }),
    });
    expect(r.gradeFound).toBe(expected);
  });

  it('below the B floor the unit is not sellable at any grade', () => {
    const r = evaluate({ measurements: measurements({ batteryHealthPct: 54 }) });
    expect(r.gradeFound).toBeNull();
    expect(r.blockedBy).toContain('BELOW_MINIMUM_GRADE');
    expect(r.vendorMessage).toMatch(/does not reach grade B/);
  });
});

// ---------------------------------------------------------------------------

describe('grade correction', () => {
  it('a declared A+ that inspects as A is a MISMATCH, not a pass', () => {
    const r = evaluate({
      declaredGrade: 'A_PLUS',
      measurements: measurements({ batteryHealthPct: 80 }),
    });
    expect(r.verdict).toBe('MISMATCH');
    expect(r.gradeFound).toBe('A');
    expect(r.requiresGradeCorrection).toBe(true);
    expect(r.autoApproved).toBe(false);
    expect(r.blockedBy).toContain('GRADE_MISMATCH');
  });

  it("spells out the vendor's three options and the 2-day auto-apply", () => {
    const r = evaluate({
      declaredGrade: 'A_PLUS',
      measurements: measurements({ batteryHealthPct: 80 }),
    });
    expect(r.vendorMessage).toMatch(/You declared grade A\+; the inspection found grade A/);
    expect(r.vendorMessage).toMatch(/Accept the corrected grade, re-price it, or dispute it/);
    expect(r.vendorMessage).toMatch(/2 days/);
  });

  it('a declaration that matches what was found is a plain pass', () => {
    const r = evaluate({
      declaredGrade: 'A',
      measurements: measurements({ batteryHealthPct: 80 }),
    });
    expect(r.requiresGradeCorrection).toBe(false);
    expect(r.autoApproved).toBe(true);
  });

  it('an honest under-declaration is still a mismatch — the grade must be the found one', () => {
    // Declaring B on an A+ machine is not a favour; the listing must say A+.
    const r = evaluate({ declaredGrade: 'B', measurements: measurements() });
    expect(r.gradeFound).toBe('A_PLUS');
    expect(r.requiresGradeCorrection).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('07 §4 item 8 — the DeviceSure grade scale is mapped explicitly', () => {
  it.each([
    ['A+', 'A_PLUS'],
    ['A_PLUS', 'A_PLUS'],
    ['A', 'A'],
    ['B', 'B'],
  ])('maps %s to %s', (tool, expected) => {
    expect(mapToolGrade(tool)).toBe(expected);
  });

  it.each(['C', 'D', 'FAIL', '', undefined])('maps %s to not-listable', (tool) => {
    expect(mapToolGrade(tool as string)).toBeNull();
  });

  it('a C-graded certificate never reaches the storefront', () => {
    const r = evaluate({ measurements: measurements({ toolGrade: 'C' }) });
    expect(r.gradeFound).toBeNull();
    expect(r.blockedBy).toContain('NOT_LISTABLE_TOOL_GRADE');
    expect(r.vendorMessage).toMatch(/We list A\+, A and B only/);
  });
});

// ---------------------------------------------------------------------------

describe('the seal', () => {
  it('no seal blocks the listing', () => {
    const r = evaluate({ seal: undefined });
    expect(r.autoApproved).toBe(false);
    expect(r.blockedBy).toContain('NO_SEAL');
  });

  it('a seal without a photograph blocks it too — there is no seal without a photograph', () => {
    const r = evaluate({ seal: { code: 'TRG-26HR-0004821', photoKey: null } });
    expect(r.autoApproved).toBe(false);
    expect(r.blockedBy).toContain('SEAL_NOT_PHOTOGRAPHED');
    expect(r.vendorMessage).toMatch(/no seal without a photograph/);
  });
});

// ---------------------------------------------------------------------------

describe('the vendor is told the most-blocking thing first', () => {
  it('a failed component outranks a grade mismatch', () => {
    const r = evaluate({
      declaredGrade: 'A_PLUS',
      measurements: measurements({
        batteryHealthPct: 80,
        areas: allPass().map((a) => (a.area === 'PORTS' ? { ...a, outcome: 'FAIL' as const } : a)),
      }),
    });
    expect(r.blockedBy[0]).toBe('REQUIRED_AREA_FAILED');
  });

  it('not reaching grade B outranks everything except a serial mismatch', () => {
    const r = evaluate({
      measurements: measurements({ batteryHealthPct: 30, qcScore: 40 }),
      seal: undefined,
    });
    expect(r.blockedBy[0]).toBe('BELOW_MINIMUM_GRADE');
  });
});

// ---------------------------------------------------------------------------

describe('every gate can be switched off individually', () => {
  it('the client can run score-only if they choose to, and the flags say so', () => {
    const r = evaluate({
      declaredGrade: 'A_PLUS',
      measurements: measurements({
        qcScore: 90,
        batteryHealthPct: 70,
        areas: allPass().map((a) => (a.area === 'PORTS' ? { ...a, outcome: 'FAIL' as const } : a)),
      }),
      policy: {
        minScore: 75,
        blockOnRequiredFail: false,
        blockOnRequiredNotMeasured: false,
        requireGradeMatch: false,
        requireSeal: false,
        requireSerialMatch: false,
      },
    });
    expect(r.autoApproved).toBe(true);
    // The grade is still corrected — the gate is off, the arithmetic is not.
    expect(r.gradeFound).toBe('B');
    expect(r.requiresGradeCorrection).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('score-distribution monitoring — the threshold creates an incentive', () => {
  it('flags a vendor whose scores cluster just above the cut-off', () => {
    // 40 units, 32 of them landing in 76-79. Nobody inspects like that.
    const gamed = [
      ...Array.from({ length: 32 }, (_, i) => 76 + (i % 4)),
      ...Array.from({ length: 8 }, (_, i) => 85 + i),
    ];
    const signal = detectScoreClustering(gamed);

    expect(signal.suspicious).toBe(true);
    expect(signal.ratio).toBeGreaterThan(2.5);
    expect(signal.unitsInBand).toBe(32);
  });

  it('does not flag an honest spread', () => {
    const honest = Array.from({ length: 40 }, (_, i) => 76 + Math.floor((i / 40) * 24));
    expect(detectScoreClustering(honest).suspicious).toBe(false);
  });

  it('never flags on a small sample — the same honesty rule as the headline average', () => {
    const tiny = [76, 76, 77, 78];
    const signal = detectScoreClustering(tiny);
    expect(signal.ratio).toBeGreaterThan(2.5); // the shape is there...
    expect(signal.suspicious).toBe(false); // ...but four units prove nothing
  });

  it('ignores units that never passed the threshold', () => {
    const withFailures = [...Array.from({ length: 30 }, () => 40), 90, 92, 95];
    const signal = detectScoreClustering(withFailures);
    expect(signal.unitsTotal).toBe(3);
    expect(signal.suspicious).toBe(false);
  });

  it('handles an empty history without dividing by zero', () => {
    const signal = detectScoreClustering([]);
    expect(signal.ratio).toBe(0);
    expect(signal.suspicious).toBe(false);
  });
});
