import { compareSpec, classifyGpu, type DeclaredSpec } from '../src/spec-match';

/**
 * Two defects in the QC-025 comparison, both of which fail silently and in
 * opposite directions.
 *
 * Neither could bite until Phase 4 wires the QC engine up, which is exactly why
 * they were worth fixing before then: one blocks every listing on the platform,
 * the other lets every wrong screen through, and both look fine in review.
 */

const DECLARED: DeclaredSpec = {
  skuCode: 'DEL-LAT5420-I5-16-512',
  ramGb: 16,
  storageGb: 512,
  storageType: 'NVME_SSD',
  cpuModel: 'i5-1145G7',
  screenSizeIn: 14,
  gpuType: 'INTEGRATED',
};

const CLEAN_DETECTED = {
  ramUsableGb: 15,
  ramModuleCount: 2,
  storageBinaryGb: 477,
  storageType: 'NVME_SSD',
  cpuModel: 'i5-1145G7',
  screenSizeIn: 14,
};

describe('GPU — the check that MAJOR-mismatched every unit', () => {
  it('accepts the chip name a real tool reports against an INTEGRATED SKU', () => {
    // catalog.sku.gpu_type CHECKs ('INTEGRATED','DISCRETE'); a QC tool reports
    // "Intel Iris Xe". Comparing the raw strings made every machine a MAJOR
    // mismatch, and requireSpecMatch in the auto-approval gate then blocked
    // every listing on the platform.
    const r = compareSpec(DECLARED, { ...CLEAN_DETECTED, gpuType: 'Intel Iris Xe Graphics' });
    expect(r.mismatches.find((m) => m.field === 'GPU_TYPE')).toBeUndefined();
    expect(r.notReported).not.toContain('GPU_TYPE');
  });

  it.each([
    'Intel Iris Xe Graphics',
    'Intel UHD Graphics 620',
    'Intel HD Graphics 5500',
    'AMD Radeon Graphics',
    'Apple M2',
    'INTEGRATED',
  ])('classifies %p as integrated', (chip) => {
    expect(classifyGpu(chip)).toBe('INTEGRATED');
  });

  it.each([
    'NVIDIA GeForce MX450',
    'NVIDIA T500',
    'NVIDIA RTX A2000',
    'AMD Radeon RX 6500M',
    'Intel Arc A370M',
    'DISCRETE',
  ])('classifies %p as discrete', (chip) => {
    expect(classifyGpu(chip)).toBe('DISCRETE');
  });

  it('still catches a real mismatch — discrete card on an integrated listing', () => {
    const r = compareSpec(DECLARED, { ...CLEAN_DETECTED, gpuType: 'NVIDIA GeForce MX450' });
    const m = r.mismatches.find((x) => x.field === 'GPU_TYPE');
    expect(m).toBeDefined();
    expect(m!.severity).toBe('MAJOR');
    // The message names the chip the technician saw, not just the class, so the
    // vendor can tell which machine it was.
    expect(m!.message).toContain('NVIDIA GeForce MX450');
  });

  it('sends an unrecognised chip to a human instead of failing the vendor', () => {
    // A vendor who honestly declared integrated graphics on a chip we have not
    // seen should not be blocked by a string we failed to recognise.
    const r = compareSpec(DECLARED, { ...CLEAN_DETECTED, gpuType: 'Moore Threads MTT S80' });
    expect(classifyGpu('Moore Threads MTT S80')).toBeNull();
    expect(r.notReported).toContain('GPU_TYPE');
    expect(r.mismatches.find((m) => m.field === 'GPU_TYPE')).toBeUndefined();
  });

  it('reports not-measured when the tool says nothing about the GPU', () => {
    const r = compareSpec(DECLARED, CLEAN_DETECTED);
    expect(r.notReported).toContain('GPU_TYPE');
  });
});

describe('screen size — the check that passed for everything', () => {
  it('catches a genuinely wrong panel', () => {
    const r = compareSpec(DECLARED, { ...CLEAN_DETECTED, screenSizeIn: 15.6 });
    expect(r.mismatches.find((m) => m.field === 'SCREEN_SIZE_IN')?.severity).toBe('MAJOR');
  });

  it('tolerates the one-decimal reporting difference', () => {
    const r = compareSpec(DECLARED, { ...CLEAN_DETECTED, screenSizeIn: 14.1 });
    expect(r.mismatches.find((m) => m.field === 'SCREEN_SIZE_IN')).toBeUndefined();
  });

  it('still compares when the declared value arrives as a Decimal-like object', () => {
    // This is the defect. screen_size_inch is NUMERIC(4,1), so Prisma returns a
    // Decimal. `Decimal - number` is NaN and `NaN > 0.2` is false, so an
    // uncoerced declared value made this check pass for every machine ever
    // inspected — while the type signature said `number` the whole time.
    const decimalLike = {
      toString: () => '14',
      valueOf: () => '14',
    } as unknown as number;

    const r = compareSpec(
      { ...DECLARED, screenSizeIn: decimalLike },
      { ...CLEAN_DETECTED, screenSizeIn: 15.6 },
    );
    expect(r.mismatches.find((m) => m.field === 'SCREEN_SIZE_IN')?.severity).toBe('MAJOR');
  });

  it('calls an unreadable declared size not-measured rather than a pass', () => {
    const unreadable = { toString: () => 'n/a', valueOf: () => 'n/a' } as unknown as number;
    const r = compareSpec(
      { ...DECLARED, screenSizeIn: unreadable },
      { ...CLEAN_DETECTED, screenSizeIn: 15.6 },
    );
    // Silence here would be indistinguishable from agreement.
    expect(r.notReported).toContain('SCREEN_SIZE_IN');
    expect(r.mismatches.find((m) => m.field === 'SCREEN_SIZE_IN')).toBeUndefined();
  });
});
