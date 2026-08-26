import {
  skuNormalizedKey,
  canonStorageType,
  canonResolution,
  normaliseCapacityGb,
  type SkuKeyParts,
} from '../src/normalise';

/**
 * The dedupe guarantee, and the way it used to fail.
 *
 * `catalog.sku.normalized_key` is UNIQUE NOT NULL, so a duplicate SKU is
 * supposed to be physically impossible. That only holds if every code path
 * computes the *same* key for the same machine — otherwise the constraint
 * accepts the duplicate, because the two keys genuinely differ. It fails open,
 * silently, and the catalog is corrupt while every test stays green.
 */

/** What a vendor's form or a CSV column supplies: free text. */
const FROM_FORM: SkuKeyParts = {
  brand: 'Dell',
  model: 'Latitude 5420',
  cpuFamily: 'Core i5',
  cpuModel: 'i5-1145G7',
  ramGb: 16,
  storageGb: 512,
  storageType: 'NVMe',
  screenSizeIn: 14,
  screenResolution: '1920x1080',
  gpu: 'Intel Iris Xe',
  os: 'Windows 11 Pro',
  isTouch: false,
};

/** What reading catalog.sku back gives: the values the CHECK constraints store. */
const FROM_ROW: SkuKeyParts = {
  ...FROM_FORM,
  storageType: 'NVME_SSD',
  screenResolution: 'FHD',
};

describe('the round trip — the assertion that was missing', () => {
  it('gives one key whether the machine came from a form or from the database', () => {
    // This is the whole defect in one line. Before Phase 2 these differed at
    // exactly the two positions the columns constrain to enums.
    expect(skuNormalizedKey(FROM_FORM)).toBe(skuNormalizedKey(FROM_ROW));
  });

  it.each([
    ['NVMe', 'NVME_SSD'],
    ['nvme', 'NVME_SSD'],
    ['M.2 NVMe', 'NVME_SSD'],
    ['PCIe SSD', 'NVME_SSD'],
    ['SATA SSD', 'SATA_SSD'],
    ['sata', 'SATA_SSD'],
    ['HDD', 'HDD'],
    ['hard disk', 'HDD'],
    ['eMMC', 'EMMC'],
  ])('storage %p and the stored %p are one key', (formValue, rowValue) => {
    expect(skuNormalizedKey({ ...FROM_FORM, storageType: formValue })).toBe(
      skuNormalizedKey({ ...FROM_FORM, storageType: rowValue }),
    );
  });

  it.each([
    ['1920x1080', 'FHD'],
    ['1920 x 1080', 'FHD'],
    ['Full HD', 'FHD'],
    ['1366x768', 'HD'],
    ['2560x1440', 'QHD'],
    ['3840x2160', '4K'],
  ])('resolution %p and the stored %p are one key', (formValue, rowValue) => {
    expect(skuNormalizedKey({ ...FROM_FORM, screenResolution: formValue })).toBe(
      skuNormalizedKey({ ...FROM_FORM, screenResolution: rowValue }),
    );
  });

  it('does not guess at a bare "SSD"', () => {
    // Resolving it to SATA_SSD would turn a correct NVMe declaration into a
    // mismatch at QC. Not knowing is the honest answer.
    expect(canonStorageType('SSD')).toBe('ssd');
    expect(canonStorageType('SSD')).not.toBe('sata_ssd');
    expect(canonStorageType('SSD')).not.toBe('nvme_ssd');
  });
});

describe('spelling variants collapse to one key', () => {
  it('survives 200 variants of the same machine', () => {
    const brands = ['Dell', 'DELL', 'dell', ' Dell ', 'dell.'];
    const models = ['Latitude 5420', 'latitude  5420', 'Latitude-5420', 'LATITUDE 5420'];
    const cpus = ['i5-1145G7', 'I5-1145G7', 'i5 1145G7', 'i5_1145g7', 'i5-1145g7 '];
    const storages = ['NVMe', 'NVME_SSD', 'nvme', 'M.2 NVMe', 'PCIe NVMe'];
    const screens = ['1920x1080', 'FHD', 'Full HD', '1920 x 1080'];

    const keys = new Set<string>();
    for (const brand of brands)
      for (const model of models)
        for (const cpuModel of cpus)
          for (const storageType of storages)
            for (const screenResolution of screens)
              keys.add(
                skuNormalizedKey({
                  ...FROM_FORM,
                  brand,
                  model,
                  cpuModel,
                  storageType,
                  screenResolution,
                }),
              );

    expect(brands.length * models.length * cpus.length * storages.length * screens.length).toBe(
      2000,
    );
    expect(keys.size).toBe(1);
  });

  it('treats capacity written any way as the same number', () => {
    expect(normaliseCapacityGb('512GB')).toBe(512);
    expect(normaliseCapacityGb('512 GB')).toBe(512);
    expect(normaliseCapacityGb('0.5TB')).toBe(512);
    expect(normaliseCapacityGb(512)).toBe(512);
  });
});

describe('genuinely different machines get different keys', () => {
  const base = skuNormalizedKey(FROM_FORM);

  it.each([
    ['RAM', { ramGb: 8 }],
    ['storage size', { storageGb: 256 }],
    ['storage type', { storageType: 'SATA SSD' }],
    ['CPU model', { cpuModel: 'i7-1165G7' }],
    ['CPU family', { cpuFamily: 'Core i7' }],
    ['screen size', { screenSizeIn: 15.6 }],
    ['resolution', { screenResolution: 'QHD' }],
    ['GPU', { gpu: 'NVIDIA MX450' }],
    ['OS', { os: 'Ubuntu 22.04' }],
    ['brand', { brand: 'Lenovo' }],
    ['model', { model: 'Latitude 5430' }],
  ])('a different %s is a different SKU', (_label, patch) => {
    expect(skuNormalizedKey({ ...FROM_FORM, ...(patch as Partial<SkuKeyParts>) })).not.toBe(base);
  });

  it('a touch variant is a different SKU, not a note', () => {
    // Legacy 6.3 is explicit about this and Task 2's field list omits it. A
    // Latitude 5420 and a Latitude 5420 Touch are different products at
    // different prices; merging them is unrecoverable once units are listed.
    expect(skuNormalizedKey({ ...FROM_FORM, isTouch: true })).not.toBe(
      skuNormalizedKey({ ...FROM_FORM, isTouch: false }),
    );
  });

  it('treats an absent touch flag as non-touch, so it is stable', () => {
    const { isTouch: _omit, ...withoutFlag } = FROM_FORM;
    expect(skuNormalizedKey(withoutFlag as SkuKeyParts)).toBe(
      skuNormalizedKey({ ...FROM_FORM, isTouch: false }),
    );
  });

  it('does not collide 14 and 14.0', () => {
    expect(skuNormalizedKey({ ...FROM_FORM, screenSizeIn: 14.0 })).toBe(base);
  });
});

describe('canon helpers on their own', () => {
  it('returns empty for nothing, rather than a token that could collide', () => {
    expect(canonStorageType(null)).toBe('');
    expect(canonStorageType(undefined)).toBe('');
    expect(canonStorageType('')).toBe('');
    expect(canonResolution(null)).toBe('');
  });

  it('passes an unrecognised value through canonicalised rather than dropping it', () => {
    // Dropping it would merge two unlike machines; passing it through keeps
    // them distinct and makes the odd value visible in the key.
    expect(canonStorageType('Optane H10')).toBe('optane_h10');
    expect(canonResolution('3200x2000')).toBe('3200x2000');
  });
});
