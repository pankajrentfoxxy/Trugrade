import { describe, it, expect } from 'vitest';
import { checkInspection, emptyInspection, toPayload, type InspectionState } from './inspection';
import { PHOTO_ANGLES, QC_AREA_CODES, type ManifestUnit } from './types';

const UNIT: ManifestUnit = {
  visitUnitId: 'vu-1',
  unitId: 'u-1',
  sequenceNo: 1,
  serialNumber: 'CND4233328',
  listingId: 'l-1',
  skuLabel: 'HP Victus 16 · i7 · 16 GB · 512 GB NVMe',
  declaredGrade: 'A',
  outcome: 'PENDING',
  absentReason: null,
  qcReportId: null,
  durationSeconds: null,
};

const MANIFEST = [UNIT];

/** A complete, submittable inspection. Every test below breaks exactly one thing. */
function good(over: Partial<InspectionState> = {}): InspectionState {
  const base = emptyInspection('tech-1');
  return {
    ...base,
    visitUnitId: 'vu-1',
    serialScanned: 'CND4233328',
    startedAt: '2026-08-26T09:00',
    completedAt: '2026-08-26T09:12',
    areas: Object.fromEntries(
      QC_AREA_CODES.map((a) => [a, { status: 'PASS', score: '10', note: '' }]),
    ) as InspectionState['areas'],
    photos: Object.fromEntries(
      PHOTO_ANGLES.map((a) => [a, { fileKey: `k/${a}`, url: `/f/${a}`, hash: 'a'.repeat(64) }]),
    ),
    sealCode: 'TRG-26HR-0004821',
    sealPhoto: { fileKey: 'k/seal', url: '/f/seal', hash: 'b'.repeat(64) },
    qcScore: '96',
    gradeProposed: 'A_PLUS',
    gradeFinal: 'A_PLUS',
    verdict: 'PASS',
    ...over,
  };
}

const messages = (s: InspectionState): string =>
  checkInspection(s, MANIFEST)
    .blockers.map((b) => b.message)
    .join(' | ');

describe('a complete inspection', () => {
  it('has nothing blocking it', () => {
    const check = checkInspection(good(), MANIFEST);
    expect(check.blockers).toEqual([]);
    expect(check.hardStop).toBe(false);
  });
});

describe('the serial is the hard stop (QC-012)', () => {
  it('refuses to grade a machine whose label is not the one on the manifest', () => {
    const check = checkInspection(good({ serialScanned: 'CND9999999' }), MANIFEST);

    expect(check.hardStop).toBe(true);
    // Not a soft warning and not a data-quality note: the label does not belong
    // to the laptop, so nothing downstream may happen to it.
    expect(messages(good({ serialScanned: 'CND9999999' }))).toMatch(
      /does not belong to this laptop/,
    );
    expect(messages(good({ serialScanned: 'CND9999999' }))).toMatch(/UNTESTABLE/);
  });

  it('accepts a scan that only differs by transport noise', () => {
    // Scanners and spreadsheets add `S/N:`, spaces and hyphens. Normalisation is
    // VR-076's job and this screen must not re-implement it.
    const check = checkInspection(good({ serialScanned: ' s/n: cnd-4233328 ' }), MANIFEST);
    expect(check.hardStop).toBe(false);
    expect(check.normalisedSerial).toBe('CND4233328');
  });

  it('does not guess at a worn label', () => {
    // O for 0 on a rubbed sticker is a different machine, not a typo to fix.
    expect(checkInspection(good({ serialScanned: 'CNDO233328' }), MANIFEST).hardStop).toBe(true);
  });
});

describe('the grade may not contradict the area results (07 section 3.1)', () => {
  it('refuses A+ over a failed area, the way we refuse the certificate that does it', () => {
    const state = good();
    state.areas.PORTS = { status: 'FAIL', score: '3', note: 'Left USB-A dead' };

    const m = messages(state);
    expect(m).toMatch(/Ports failed/);
    expect(m).toMatch(/caps this machine at B/);
    // The reason the check exists at all, stated where it will be read.
    expect(m).toMatch(/we do not get to type one in by hand/);
  });

  it('refuses A+ when an area was not measured', () => {
    const state = good();
    state.areas.THERMAL = { status: 'NOT_MEASURED', score: '', note: 'No sensor exposed' };
    expect(messages(state)).toMatch(/caps this machine at A/);
  });

  it('allows the graded value once it is at or below the cap', () => {
    const state = good({ gradeProposed: 'B', gradeFinal: 'B' });
    state.areas.PORTS = { status: 'FAIL', score: '3', note: 'Left USB-A dead' };
    expect(checkInspection(state, MANIFEST).blockers).toEqual([]);
  });

  it('leaves a clean machine uncapped', () => {
    const state = good();
    expect(messages(state)).not.toMatch(/caps this machine/);
  });
});

describe('never-fabricate', () => {
  it('will not let an area be left undecided, and offers "not measured" as the honest answer', () => {
    const state = good();
    state.areas.CAMERA_AUDIO = { status: '', score: '', note: '' };
    expect(messages(state)).toMatch(/Camera and audio has no result yet/);
    expect(messages(state)).toMatch(/"not measured" is one of them/);
  });

  it('writes no row for an unmeasured area, and records the absence by name', () => {
    const state = good({ gradeProposed: 'A', gradeFinal: 'A' });
    state.areas.THERMAL = { status: 'NOT_MEASURED', score: '', note: 'No sensor' };

    const payload = toPayload(state, 'visit-1', UNIT, 'CND4233328');

    // The column's CHECK has no NOT_MEASURED, so the only truthful record of it
    // is an absent row plus the explicit list. A PASS row here would be a lie
    // that survives into a legal document.
    expect(payload.areaResults.map((a) => a.area)).not.toContain('THERMAL');
    expect(payload.areaResults).toHaveLength(QC_AREA_CODES.length - 1);
    expect(payload.areasNotMeasured).toEqual(['THERMAL']);
  });

  it('says so on screen rather than silently dropping the row', () => {
    const state = good({ gradeProposed: 'A', gradeFinal: 'A' });
    state.areas.THERMAL = { status: 'NOT_MEASURED', score: '', note: '' };
    expect(checkInspection(state, MANIFEST).notices.join(' ')).toMatch(
      /never stored as a pass/,
    );
  });

  it('sends a null cycle count rather than a zero when the system did not report one', () => {
    // 07 section 3.5: a zero-value default is indistinguishable from a
    // measurement, and it is the one way a never-fabricate policy leaks.
    const state = good();
    state.hardware.cycleCount = '0';
    state.hardware.cycleCountNotReported = true;
    expect(toPayload(state, 'visit-1', UNIT, 'CND4233328').hardware.cycleCount).toBeNull();
  });

  it('keeps a real cycle count when there is one', () => {
    const state = good();
    state.hardware.cycleCount = '412';
    expect(toPayload(state, 'visit-1', UNIT, 'CND4233328').hardware.cycleCount).toBe(412);
  });

  it('defaults the three lock checks to "not checked" rather than to "no"', () => {
    const p = toPayload(good(), 'visit-1', UNIT, 'CND4233328');
    expect(p.hardware.biosLocked).toBe('UNKNOWN');
    expect(p.hardware.mdmLocked).toBe('UNKNOWN');
    expect(p.hardware.computraceActive).toBe('UNKNOWN');
  });
});

describe('the seal', () => {
  it('will not record a pass without a seal photograph', () => {
    expect(messages(good({ sealPhoto: null }))).toMatch(/no seal without a photograph/);
  });

  it('rejects a seal code that is not the printed shape', () => {
    expect(messages(good({ sealCode: 'TRG-8841' }))).toMatch(/exactly as printed/);
  });

  it('refuses a seal on a unit that did not pass', () => {
    expect(messages(good({ verdict: 'FAIL', gradeFinal: '', gradeProposed: '' }))).toMatch(
      /did not pass is not sealed/,
    );
  });

  it('sends no seal at all on a failed unit', () => {
    const state = good({ verdict: 'FAIL', sealCode: '', sealPhoto: null, gradeFinal: '' });
    expect(toPayload(state, 'visit-1', UNIT, 'CND4233328').seal).toBeNull();
  });
});

describe('photographs', () => {
  it('names the ones still missing rather than saying the form is incomplete', () => {
    const photos = { ...good().photos };
    delete photos.SCREEN_ON;
    delete photos.BASE;
    expect(messages(good({ photos }))).toMatch(/Still to photograph: Screen, powered on, Base/);
  });
});

describe('the override reason (chk_override_reason)', () => {
  it('is required the moment the final grade differs from the proposed one', () => {
    const m = messages(good({ gradeProposed: 'A_PLUS', gradeFinal: 'A' }));
    expect(m).toMatch(/overriding A\+ to A/);
    expect(m).toMatch(/r\.7\(5\)/);
  });

  it('is satisfied by an actual sentence', () => {
    const state = good({
      gradeProposed: 'A_PLUS',
      gradeFinal: 'A',
      gradeOverrideReason: 'Lid has a 4 cm scratch the score did not weight.',
    });
    expect(checkInspection(state, MANIFEST).blockers).toEqual([]);
  });
});

describe('the rest of the record', () => {
  it('will not accept a score outside 0 to 100', () => {
    expect(messages(good({ qcScore: '104' }))).toMatch(/score from 0 to 100/);
  });

  it('will not accept an area score outside 0 to 10', () => {
    const state = good();
    state.areas.DISPLAY = { status: 'PASS', score: '11', note: '' };
    expect(messages(state)).toMatch(/Display needs a score from 0 to 10/);
  });

  it('will not let an inspection finish before it started', () => {
    expect(messages(good({ completedAt: '2026-08-26T08:00' }))).toMatch(
      /cannot finish before it started/,
    );
  });

  it('requires a final grade on anything that is going to be listed', () => {
    expect(messages(good({ gradeProposed: '', gradeFinal: '' }))).toMatch(/needs a final grade/);
  });

  it('carries the twelve schema area codes, not the cosmetic ones', () => {
    const payload = toPayload(good(), 'visit-1', UNIT, 'CND4233328');
    // Writing CHASSIS or PALMREST here fails qc_area_result_area_check on every
    // row, and the doc and @trugrade/contracts both still name that vocabulary.
    expect(payload.areaResults.map((a) => a.area).sort()).toEqual([...QC_AREA_CODES].sort());
    expect(payload.areaResults.map((a) => a.area)).not.toContain('CHASSIS');
  });

  it('records whether the serial matched, alongside the normalised value', () => {
    const p = toPayload(good({ serialScanned: 's/n: cnd-4233328' }), 'v', UNIT, 'CND4233328');
    expect(p.serialMatches).toBe(true);
    expect(p.serialScanned).toBe('CND4233328');
  });
});
