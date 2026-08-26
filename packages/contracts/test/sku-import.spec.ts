import {
  parseCsv,
  parseSkuCsv,
  validateRow,
  dryRun,
  errorReportCsv,
  skuImportTemplate,
  SKU_IMPORT_COLUMNS,
} from '../src/sku-import';

/**
 * The importer's contract with the person using it.
 *
 * Ops is pasting a spreadsheet somebody maintained by hand. The useful question
 * is never "did it work" — it is "what is about to happen to my 200 rows", and
 * the answer has to arrive before anything is written and be keyed to the line
 * numbers in their own file.
 */

const HEADER = SKU_IMPORT_COLUMNS.join(',');
const GOOD =
  'Dell,Latitude,Latitude 5420,Intel,Core i5,i5-1145G7,11th,16,512,NVME_SSD,INTEGRATED,Intel Iris Xe,14,FHD,false,Windows 11 Pro,84713010,DEL-LAT5420';

describe('CSV parsing that survives a real spreadsheet', () => {
  it('handles a quoted field containing a comma', () => {
    // `split(',')` breaks on the first model name with a comma in it, and this
    // is a file a human maintains.
    const grid = parseCsv('a,b\n"one, two",three\n');
    expect(grid[1]).toEqual(['one, two', 'three']);
  });

  it('handles escaped quotes', () => {
    const grid = parseCsv('a\n"say ""hi"""\n');
    expect(grid[1]).toEqual(['say "hi"']);
  });

  it('handles a newline inside a quoted field', () => {
    const grid = parseCsv('a,b\n"line one\nline two",x\n');
    expect(grid).toHaveLength(2);
    expect(grid[1]![0]).toBe('line one\nline two');
  });

  it('strips the BOM Excel writes, which would corrupt the first header', () => {
    const grid = parseCsv('\uFEFFbrand,model\nDell,X\n');
    // Without this the first column is named "\uFEFFbrand" and every lookup
    // fails on an invisible byte.
    expect(grid[0]![0]).toBe('brand');
  });

  it('tolerates CRLF and a trailing blank line', () => {
    const grid = parseCsv('a,b\r\n1,2\r\n\r\n');
    expect(grid).toHaveLength(2);
  });
});

describe('the template is the parser contract', () => {
  it('round-trips: the shipped template parses as one valid row', () => {
    const parsed = parseSkuCsv(skuImportTemplate());
    expect(parsed.fileErrors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.errors).toEqual([]);
  });

  it('names the missing columns rather than saying "invalid file"', () => {
    const parsed = parseSkuCsv('brand,model\nDell,X\n');
    expect(parsed.fileErrors[0]).toMatch(/missing these columns/);
    // Ops can fix a header in seconds and cannot guess what a parser wanted.
    expect(parsed.fileErrors[0]).toMatch(/ram_gb/);
  });

  it('treats an empty file as a file problem, not zero rows', () => {
    expect(parseSkuCsv('').fileErrors[0]).toMatch(/empty/);
  });
});

describe('row validation', () => {
  function row(over: Record<string, string> = {}) {
    const base: Record<string, string> = {};
    HEADER.split(',').forEach((h, i) => {
      base[h] = GOOD.split(',')[i]!;
    });
    return validateRow({ ...base, ...over }, 2);
  }

  it('accepts a good row and computes its key', () => {
    const r = row();
    expect(r.errors).toEqual([]);
    expect(r.value!.normalizedKey).toContain('dell|latitude_5420');
  });

  it('accepts capacity written any way', () => {
    expect(row({ storage_gb: '0.5TB' }).value!.storageGb).toBe(512);
    expect(row({ storage_gb: '512 GB' }).value!.storageGb).toBe(512);
  });

  it('names the offending value, not just the field', () => {
    const r = row({ ram_gb: 'sixteen' });
    expect(r.errors[0]).toContain('sixteen');
  });

  it.each([
    ['storage_type', 'Optane'],
    ['resolution', '3200x2000'],
    ['gpu_type', 'MAYBE'],
  ])('rejects an unrecognised %s and lists what is allowed', (col, bad) => {
    const r = row({ [col]: bad });
    expect(r.errors.join(' ')).toContain(bad);
    expect(r.errors.join(' ')).toMatch(/must be/);
  });

  it.each([
    ['storage_type', 'NVMe', 'NVME_SSD'],
    ['storage_type', 'M.2 NVMe', 'NVME_SSD'],
    ['storage_type', 'SATA SSD', 'SATA_SSD'],
  ])('accepts %s written as %p and stores %p', (_col, written, stored) => {
    // The importer must not be stricter than the dedupe key: a vendor export
    // saying "NVMe" describes a machine we can identify perfectly well, and two
    // components disagreeing about what counts as the same machine is the exact
    // divergence this phase removes.
    expect(row({ storage_type: written }).value!.storageType).toBe(stored);
  });

  it.each([
    ['1920x1080', 'FHD'],
    ['Full HD', 'FHD'],
    ['1366x768', 'HD'],
    ['3840x2160', '4K'],
  ])('accepts resolution written as %p and stores %p', (written, stored) => {
    expect(row({ resolution: written }).value!.resolution).toBe(stored);
  });

  it('defaults the HSN rather than letting a blank through', () => {
    expect(row({ hsn_code: '' }).value!.hsnCode).toBe('84713010');
  });

  it('rejects a 4-digit HSN — VR-098, and Delhivery rejects it too', () => {
    const r = row({ hsn_code: '8471' });
    expect(r.errors.join(' ')).toMatch(/8 digits/);
  });

  it('reads yes/no however it is written', () => {
    for (const yes of ['true', 'TRUE', 'yes', 'Y', '1']) {
      expect(row({ is_touch: yes }).value!.isTouch).toBe(true);
    }
    for (const no of ['false', 'no', 'N', '0', '']) {
      expect(row({ is_touch: no }).value!.isTouch).toBe(false);
    }
  });

  it('rejects a yes/no it cannot read, rather than guessing false', () => {
    // Guessing here would silently merge a touch SKU into the non-touch one.
    expect(row({ is_touch: 'maybe' }).errors.join(' ')).toMatch(/yes\/no/);
  });

  it('reports every problem at once, not the first', () => {
    const r = row({ ram_gb: 'x', storage_type: 'x', resolution: 'x' });
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('gives a touch variant a different key from its non-touch twin', () => {
    expect(row({ is_touch: 'true' }).value!.normalizedKey).not.toBe(
      row({ is_touch: 'false' }).value!.normalizedKey,
    );
  });
});

describe('duplicates within the file', () => {
  it('rejects the second occurrence and names the first line', () => {
    const csv = `${HEADER}\n${GOOD}\n${GOOD}\n`;
    const parsed = parseSkuCsv(csv);
    expect(parsed.rows[0]!.errors).toEqual([]);
    // Importing one of them silently would make the run depend on row order.
    expect(parsed.rows[1]!.errors.join(' ')).toMatch(/Same machine as line 2/);
  });

  it('catches a duplicate written differently, because the key is normalised', () => {
    const variant = GOOD.replace('NVME_SSD', 'NVMe').replace(',FHD,', ',1920x1080,');
    const parsed = parseSkuCsv(`${HEADER}\n${GOOD}\n${variant}\n`);
    expect(parsed.rows[1]!.errors.join(' ')).toMatch(/Same machine/);
  });
});

describe('the dry run writes nothing and explains everything', () => {
  it('classifies create, merge and error in one pass', () => {
    const other = GOOD.replace(',16,', ',32,').replace('DEL-LAT5420', 'DEL-LAT5420-32');
    const bad = GOOD.replace(',NVME_SSD,', ',BANANA,');
    const parsed = parseSkuCsv(`${HEADER}\n${GOOD}\n${other}\n${bad}\n`);

    const existing = new Map([[parsed.rows[0]!.value!.normalizedKey, 'DEL-LAT5420-EXISTING']]);
    const report = dryRun(parsed, existing);

    expect(report.willMerge).toBe(1);
    expect(report.willCreate).toBe(1);
    expect(report.errors).toBe(1);
    // The merge names the SKU it would merge into, so ops can check it is right.
    expect(report.rows[0]!.existingSkuCode).toBe('DEL-LAT5420-EXISTING');
  });

  it("keys every outcome to the line number in the operator's own file", () => {
    const parsed = parseSkuCsv(`${HEADER}\n${GOOD}\n`);
    const report = dryRun(parsed, new Map());
    // Header is line 1, so the first data row is line 2 — what their editor says.
    expect(report.rows[0]!.lineNumber).toBe(2);
  });

  it('surfaces a file-level problem instead of pretending there are zero rows', () => {
    const report = dryRun(parseSkuCsv('brand\nDell\n'), new Map());
    expect(report.fileErrors.length).toBeGreaterThan(0);
    expect(report.rows).toEqual([]);
  });

  it('produces a downloadable error report with only the failures', () => {
    const bad = GOOD.replace(',NVME_SSD,', ',BANANA,');
    const report = dryRun(parseSkuCsv(`${HEADER}\n${GOOD}\n${bad}\n`), new Map());
    const csv = errorReportCsv(report);

    expect(csv.split('\n')[0]).toBe('line_number,outcome,reason');
    // Only the bad line, and it carries the reason.
    expect(csv).toContain('3,ERROR');
    expect(csv).not.toContain('2,ERROR');
    expect(csv).toMatch(/BANANA/);
  });

  it('escapes a reason containing a comma, so the report is itself valid CSV', () => {
    const bad = GOOD.replace(',NVME_SSD,', ',x,').replace(',FHD,', ',y,');
    const report = dryRun(parseSkuCsv(`${HEADER}\n${bad}\n`), new Map());
    const line = errorReportCsv(report).split('\n')[1]!;
    // Two errors are joined with "; " and the whole reason is quoted.
    expect(line).toMatch(/^2,ERROR,"/);
  });
});
