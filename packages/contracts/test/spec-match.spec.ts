/**
 * QC-025 — declared configuration vs detected hardware.
 *
 * Two things are being proved here, and the second is the one that would have
 * cost a week of "why is every unit failing":
 *
 *   1. A real specification lie is caught and blocked.
 *   2. A machine that reports 15 GB because Windows counts *usable* memory is
 *      NOT a lie, and must not be treated as one (`07 §3.4`).
 */

import { compareSpec, type DeclaredSpec, type DetectedSpec } from '../src/spec-match';
import { evaluateQcReport, DEFAULT_AUTO_APPROVAL } from '../src/qc-verdict';
import { QC_AREAS } from '../src/rules';

const declared: DeclaredSpec = {
  skuCode: 'DEL-LAT5320-I5-16-512',
  ramGb: 16,
  storageGb: 512,
  storageType: 'NVME_SSD',
  cpuModel: 'i5-1145G7',
  screenSizeIn: 13.3,
  gpuType: 'INTEGRATED',
};

/** An honest machine, reporting the way a real machine reports. */
const honest: DetectedSpec = {
  ramUsableGb: 15,
  ramModuleCount: 2,
  storageBinaryGb: 477,
  storageType: 'NVMe',
  cpuModel: 'Intel(R) Core(TM) i5-1145G7',
  screenSizeIn: 13.3,
  gpuType: 'Integrated',
  biosLocked: false,
  mdmLocked: false,
  computraceActive: false,
  smartStatus: 'OK',
};

// ---------------------------------------------------------------------------

describe('07 §3.4 — the false mismatch that would fire on every unit', () => {
  it('16 GB declared against 15 GB usable is a MATCH, not a lie', () => {
    const r = compareSpec(declared, honest);
    expect(r.matches).toBe(true);
    expect(r.mismatches).toEqual([]);
  });

  it('512 GB declared against 477 GiB measured is a MATCH', () => {
    expect(compareSpec(declared, honest).matches).toBe(true);
  });

  it('reports BOTH numbers, so the correction is visible rather than hidden', () => {
    const r = compareSpec(declared, honest);
    expect(r.display.ram).toBe('16 GB installed (15 GB usable) · 2 modules');
    expect(r.display.storage).toBe('512 GB (477 GiB usable)');
  });

  it('prefers the installed figure when the tool reports it directly', () => {
    const r = compareSpec(declared, { ...honest, ramInstalledGb: 16, ramUsableGb: 15 });
    expect(r.matches).toBe(true);
    expect(r.display.ram).toBe('16 GB installed (15 GB usable) · 2 modules');
  });

  it('does not round a genuinely different capacity up to the declared one', () => {
    // 12 GB is a real configuration. It must not be nudged to 16.
    const r = compareSpec(declared, { ...honest, ramUsableGb: 11.8 });
    expect(r.matches).toBe(false);
    expect(r.mismatches[0]!.detectedNormalised).toBe('12 GB');
  });

  it('tolerates the vendor prefix and trademark noise in a CPU string', () => {
    for (const cpu of [
      'Intel(R) Core(TM) i5-1145G7',
      'Intel Core i5-1145G7 CPU',
      'i5-1145G7',
      '  Intel®  Core™  i5-1145G7  ',
    ]) {
      expect(compareSpec(declared, { ...honest, cpuModel: cpu }).matches).toBe(true);
    }
  });

  it('accepts the storage-type spellings a tool actually emits', () => {
    for (const t of ['NVMe', 'NVME', 'nvme_ssd', 'NVMe SSD']) {
      expect(compareSpec(declared, { ...honest, storageType: t }).matches).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe('QC-025 — the real lie is caught', () => {
  it('declare 16 GB, present an 8 GB machine', () => {
    const r = compareSpec(declared, { ...honest, ramUsableGb: 7.6 });

    expect(r.matches).toBe(false);
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]).toMatchObject({
      field: 'RAM_GB',
      severity: 'BLOCKING',
      declared: '16 GB',
      detectedNormalised: '8 GB',
    });
    expect(r.mismatches[0]!.message).toMatch(/You listed this as 16 GB/);
    expect(r.mismatches[0]!.message).toMatch(/found 8 GB installed/);
  });

  it('declare 512 GB, present a 256 GB drive', () => {
    const r = compareSpec(declared, { ...honest, storageBinaryGb: 238 });
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]).toMatchObject({ field: 'STORAGE_GB', detectedNormalised: '256 GB' });
  });

  it('declare NVMe, present SATA — a buyer paying for one and getting the other', () => {
    const r = compareSpec(declared, { ...honest, storageType: 'SATA' });
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]!.message).toMatch(/return we cannot refuse/);
  });

  it('declare an i5, present an i3', () => {
    const r = compareSpec(declared, { ...honest, cpuModel: 'Intel Core i3-1115G4' });
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]!.field).toBe('CPU_MODEL');
  });

  it('collects every difference, not just the first', () => {
    const r = compareSpec(declared, {
      ...honest,
      ramUsableGb: 7.6,
      storageBinaryGb: 238,
      cpuModel: 'Intel Core i3-1115G4',
    });
    expect(r.mismatches.map((m) => m.field).sort()).toEqual(['CPU_MODEL', 'RAM_GB', 'STORAGE_GB']);
  });
});

// ---------------------------------------------------------------------------

describe('locks and drive health — unusable whatever the listing says', () => {
  it('a BIOS-locked machine is blocked, and the vendor is told who has to clear it', () => {
    const r = compareSpec(declared, { ...honest, biosLocked: true });
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]!.message).toMatch(/BIOS or supervisor password/);
  });

  it('an MDM-enrolled machine is blocked — the previous owner must release it', () => {
    const r = compareSpec(declared, { ...honest, mdmLocked: true });
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]!.message).toMatch(/released?|release it from their MDM tenant/);
  });

  it('active Computrace is blocked', () => {
    expect(compareSpec(declared, { ...honest, computraceActive: true }).blocking).toBe(true);
  });

  it('a failing drive is blocked', () => {
    const r = compareSpec(declared, { ...honest, smartStatus: 'Pred Fail' });
    expect(r.blocking).toBe(true);
    expect(r.mismatches[0]!.message).toMatch(/replace it and re-run/);
  });
});

// ---------------------------------------------------------------------------

describe('not reported is not a mismatch', () => {
  it('an unread field is an unknown, never a lie', () => {
    const r = compareSpec(declared, {
      ramUsableGb: 15,
      storageBinaryGb: 477,
      storageType: 'NVMe',
      cpuModel: 'i5-1145G7',
    });
    expect(r.matches).toBe(true);
    expect(r.notReported).toEqual(
      expect.arrayContaining([
        'SCREEN_SIZE_IN',
        'GPU_TYPE',
        'BIOS_LOCK',
        'MDM_LOCK',
        'COMPUTRACE',
        'SMART_STATUS',
      ]),
    );
  });

  it('a tool that reports nothing produces no mismatches and no false confidence', () => {
    const r = compareSpec(declared, {});
    expect(r.matches).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.notReported.length).toBeGreaterThan(5);
  });

  it('biosLocked: false is a measurement — the machine is confirmed unlocked', () => {
    const r = compareSpec(declared, { ...honest, biosLocked: false });
    expect(r.notReported).not.toContain('BIOS_LOCK');
  });
});

// ---------------------------------------------------------------------------

describe('the screen tolerance', () => {
  it('accepts a tenth of an inch of panel-reporting noise', () => {
    expect(compareSpec(declared, { ...honest, screenSizeIn: 13.4 }).matches).toBe(true);
  });

  it('rejects a genuinely different panel, as MAJOR rather than BLOCKING', () => {
    const r = compareSpec(declared, { ...honest, screenSizeIn: 15.6 });
    expect(r.matches).toBe(false);
    expect(r.blocking).toBe(false);
    expect(r.mismatches[0]!.severity).toBe('MAJOR');
  });
});

// ---------------------------------------------------------------------------

describe('the verdict engine honours the spec check', () => {
  const clean = {
    qcScore: 96,
    areas: QC_AREAS.map((area) => ({ area, outcome: 'PASS' as const, score: 10 })),
    batteryHealthPct: 91,
    serialMatches: true,
  };
  const seal = { code: 'TRG-26HR-0004821', photoKey: 'qc/seals/a.jpg' };

  it('a perfect score does not save a machine that is not the one listed', () => {
    const r = evaluateQcReport({
      declaredGrade: 'A_PLUS',
      measurements: clean,
      declaredSpec: declared,
      detectedSpec: { ...honest, ramUsableGb: 7.6 },
      seal,
    });

    expect(r.scorePassed).toBe(true); // 96 > 75
    expect(r.autoApproved).toBe(false);
    expect(r.verdict).toBe('FAIL');
    expect(r.gradeFound).toBeNull(); // blocking: not listable at any grade
    expect(r.blockedBy[0]).toBe('SPEC_MISMATCH');
    expect(r.vendorMessage).toMatch(/You listed this as 16 GB/);
  });

  it('the honest 15 GB machine auto-approves, which is the whole point', () => {
    const r = evaluateQcReport({
      declaredGrade: 'A_PLUS',
      measurements: clean,
      declaredSpec: declared,
      detectedSpec: honest,
      seal,
    });
    expect(r.autoApproved).toBe(true);
    expect(r.specMatch?.matches).toBe(true);
  });

  it('mentions how many other differences there are without listing all of them', () => {
    const r = evaluateQcReport({
      declaredGrade: 'A_PLUS',
      measurements: clean,
      declaredSpec: declared,
      detectedSpec: { ...honest, ramUsableGb: 7.6, storageBinaryGb: 238 },
      seal,
    });
    expect(r.vendorMessage).toMatch(/1 other difference/);
  });

  it('a MAJOR-only difference is a MISMATCH rather than an outright FAIL', () => {
    const r = evaluateQcReport({
      declaredGrade: 'A_PLUS',
      measurements: clean,
      declaredSpec: declared,
      detectedSpec: { ...honest, screenSizeIn: 15.6 },
      seal,
    });
    expect(r.verdict).toBe('MISMATCH');
    expect(r.gradeFound).toBe('A_PLUS'); // still gradeable; the listing is wrong, not the machine
    expect(r.autoApproved).toBe(false);
  });

  it('the gate can be switched off, and then only the blocking case still stops it', () => {
    const policy = { ...DEFAULT_AUTO_APPROVAL, requireSpecMatch: false };

    const major = evaluateQcReport({
      declaredGrade: 'A_PLUS',
      measurements: clean,
      declaredSpec: declared,
      detectedSpec: { ...honest, screenSizeIn: 15.6 },
      seal,
      policy,
    });
    expect(major.autoApproved).toBe(true);

    // A blocking difference is not a policy question: it is not that machine.
    const blocking = evaluateQcReport({
      declaredGrade: 'A_PLUS',
      measurements: clean,
      declaredSpec: declared,
      detectedSpec: { ...honest, ramUsableGb: 7.6 },
      seal,
      policy,
    });
    expect(blocking.autoApproved).toBe(false);
    expect(blocking.gradeFound).toBeNull();
  });

  it('skips the check entirely when no SKU was supplied', () => {
    const r = evaluateQcReport({ declaredGrade: 'A_PLUS', measurements: clean, seal });
    expect(r.specMatch).toBeUndefined();
    expect(r.autoApproved).toBe(true);
  });
});
