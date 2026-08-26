/**
 * Bulk SKU import (Phase 2 Task 7).
 *
 * The whole design turns on one rule: **a dry run writes nothing and reports
 * every row.** Ops is pasting a spreadsheet somebody maintained by hand, and the
 * useful question is not "did it work" but "what is about to happen to my 200
 * rows" — answered before anything is committed, keyed by input row number so a
 * person can find the offending line in their own file.
 *
 * Parsing and validation live here, pure, because they are the part worth
 * exhaustively testing. The key lookup and the commit need a database and stay
 * in the service.
 */

import {
  skuNormalizedKey,
  normaliseCapacityGb,
  canonStorageType,
  canonResolution,
  type SkuKeyParts,
} from './normalise';
import { GRADES } from './rules';

/**
 * The template columns, in order. This array IS the downloadable template
 * header, so the file ops fills in and the parser cannot drift apart.
 */
export const SKU_IMPORT_COLUMNS = Object.freeze([
  'brand',
  'series',
  'model',
  'cpu_brand',
  'cpu_family',
  'cpu_model',
  'cpu_generation',
  'ram_gb',
  'storage_gb',
  'storage_type',
  'gpu_type',
  'gpu_model',
  'screen_size_in',
  'resolution',
  'is_touch',
  'os',
  'hsn_code',
  'sku_code',
] as const);

export type SkuImportColumn = (typeof SKU_IMPORT_COLUMNS)[number];

/** One example row, shipped in the template so the format is unambiguous. */
export const SKU_IMPORT_EXAMPLE: Readonly<Record<SkuImportColumn, string>> = Object.freeze({
  brand: 'Dell',
  series: 'Latitude',
  model: 'Latitude 5420',
  cpu_brand: 'Intel',
  cpu_family: 'Core i5',
  cpu_model: 'i5-1145G7',
  cpu_generation: '11th',
  ram_gb: '16',
  storage_gb: '512',
  storage_type: 'NVME_SSD',
  gpu_type: 'INTEGRATED',
  gpu_model: 'Intel Iris Xe',
  screen_size_in: '14',
  resolution: 'FHD',
  is_touch: 'false',
  os: 'Windows 11 Pro',
  hsn_code: '84713010',
  sku_code: 'DEL-LAT5420-I5-16-512',
});

export function skuImportTemplate(): string {
  const header = SKU_IMPORT_COLUMNS.join(',');
  const example = SKU_IMPORT_COLUMNS.map((c) => csvEscape(SKU_IMPORT_EXAMPLE[c])).join(',');
  return `${header}\n${example}\n`;
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * RFC 4180 parsing, by hand.
 *
 * A `split(',')` breaks on the first model name containing a comma, and this is
 * a file a human maintains — quoted fields and embedded newlines are normal, not
 * exotic. Thirty lines here is cheaper than the support ticket.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Strip a UTF-8 BOM: Excel writes one and it would otherwise become part of
  // the first header name, so every column lookup fails on an invisible byte.
  const s = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export type RowOutcome = 'WILL_CREATE' | 'WILL_MERGE' | 'ERROR';

export interface ParsedRow {
  /** 1-based, counting the header — the number the person sees in their editor. */
  lineNumber: number;
  raw: Record<string, string>;
  /** Present only when the row validated. */
  value?: SkuImportRow;
  errors: string[];
}

export interface SkuImportRow {
  brand: string;
  series: string;
  model: string;
  cpuBrand: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  gpuType: string;
  gpuModel: string | null;
  screenSizeIn: number;
  resolution: string;
  isTouch: boolean;
  os: string;
  hsnCode: string;
  skuCode: string | null;
  normalizedKey: string;
}

const STORAGE_TYPES = ['NVME_SSD', 'SATA_SSD', 'HDD', 'EMMC'];
const RESOLUTIONS = ['HD', 'FHD', 'QHD', '4K', 'RETINA'];
const GPU_TYPES = ['INTEGRATED', 'DISCRETE'];

function bool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0', ''].includes(s)) return false;
  return null;
}

/**
 * Validate one row and compute its key.
 *
 * The key is computed here, from the same generator every other path uses, so a
 * CSV import cannot introduce a duplicate that the UNIQUE constraint then fails
 * to catch — which is what happens when two code paths canonicalise differently.
 */
export function validateRow(raw: Record<string, string>, lineNumber: number): ParsedRow {
  const errors: string[] = [];
  const get = (c: SkuImportColumn): string => (raw[c] ?? '').trim();

  for (const c of ['brand', 'series', 'model', 'cpu_model', 'os'] as SkuImportColumn[]) {
    if (!get(c)) errors.push(`${c} is required`);
  }

  const ramGb = normaliseCapacityGb(get('ram_gb'));
  if (ramGb === null || ramGb <= 0) errors.push(`ram_gb "${get('ram_gb')}" is not a capacity`);

  const storageGb = normaliseCapacityGb(get('storage_gb'));
  if (storageGb === null || storageGb <= 0)
    errors.push(`storage_gb "${get('storage_gb')}" is not a capacity`);

  // Canonicalised through the SAME helpers the key generator uses, not compared
  // against the enum directly. A vendor export that says "NVMe" or "1920x1080"
  // is describing a machine we can identify perfectly well, and rejecting it
  // would make the importer stricter than the dedupe key — two components
  // disagreeing about what counts as the same machine is the exact class of
  // divergence this phase exists to remove.
  const storageType = canonStorageType(get('storage_type')).toUpperCase();
  if (!STORAGE_TYPES.includes(storageType))
    errors.push(`storage_type "${get('storage_type')}" must be one of ${STORAGE_TYPES.join(', ')}`);

  const resolution = canonResolution(get('resolution')).toUpperCase();
  if (!RESOLUTIONS.includes(resolution))
    errors.push(`resolution "${get('resolution')}" must be one of ${RESOLUTIONS.join(', ')}`);

  const gpuType = get('gpu_type').toUpperCase();
  if (!GPU_TYPES.includes(gpuType))
    errors.push(`gpu_type "${get('gpu_type')}" must be INTEGRATED or DISCRETE`);

  const screenSizeIn = Number(get('screen_size_in'));
  if (!Number.isFinite(screenSizeIn) || screenSizeIn <= 0 || screenSizeIn > 30)
    errors.push(`screen_size_in "${get('screen_size_in')}" is not a screen size`);

  const isTouch = bool(get('is_touch'));
  if (isTouch === null) errors.push(`is_touch "${get('is_touch')}" is not a yes/no`);

  // VR-098. A four-digit heading is a chapter, not a commodity code, and it is
  // rejected on the e-way bill payload — so it fails here rather than on a
  // shipment months later.
  const hsnCode = get('hsn_code') || '84713010';
  if (!/^[0-9]{8}$/.test(hsnCode)) errors.push(`hsn_code "${hsnCode}" must be 8 digits`);

  if (errors.length > 0) return { lineNumber, raw, errors };

  const parts: SkuKeyParts = {
    brand: get('brand'),
    model: get('model'),
    cpuFamily: get('cpu_family'),
    cpuModel: get('cpu_model'),
    ramGb: ramGb!,
    storageGb: storageGb!,
    storageType,
    screenSizeIn,
    screenResolution: resolution,
    gpu: gpuType,
    os: get('os'),
    isTouch: isTouch!,
  };

  return {
    lineNumber,
    raw,
    errors: [],
    value: {
      brand: get('brand'),
      series: get('series'),
      model: get('model'),
      cpuBrand: get('cpu_brand') || 'Intel',
      cpuFamily: get('cpu_family'),
      cpuModel: get('cpu_model'),
      cpuGeneration: get('cpu_generation'),
      ramGb: ramGb!,
      storageGb: storageGb!,
      storageType,
      gpuType,
      gpuModel: get('gpu_model') || null,
      screenSizeIn,
      resolution,
      isTouch: isTouch!,
      os: get('os'),
      hsnCode,
      skuCode: get('sku_code') || null,
      normalizedKey: skuNormalizedKey(parts),
    },
  };
}

export interface ParsedCsv {
  rows: ParsedRow[];
  /** Problems with the file itself, not with any one row. */
  fileErrors: string[];
}

export function parseSkuCsv(text: string): ParsedCsv {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], fileErrors: ['The file is empty.'] };

  const header = grid[0]!.map((h) => h.trim().toLowerCase());
  const missing = SKU_IMPORT_COLUMNS.filter(
    (c) => !header.includes(c) && !['gpu_model', 'sku_code', 'hsn_code'].includes(c),
  );
  if (missing.length > 0) {
    // Naming the columns beats "invalid file": ops can fix a header in seconds
    // and cannot guess what a parser wanted.
    return {
      rows: [],
      fileErrors: [
        `The file is missing these columns: ${missing.join(', ')}. Download the template to see the expected header.`,
      ],
    };
  }

  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i]!;
    const raw: Record<string, string> = {};
    header.forEach((h, j) => {
      raw[h] = cells[j] ?? '';
    });

    // +1 because the header is line 1 and the person counts from there.
    const parsed = validateRow(raw, i + 1);

    if (parsed.value) {
      const first = seen.get(parsed.value.normalizedKey);
      if (first !== undefined) {
        // A duplicate WITHIN the file. Silently importing one of them would
        // make the run non-deterministic in the row's own file order.
        parsed.errors.push(`Same machine as line ${first}.`);
        delete parsed.value;
      } else {
        seen.set(parsed.value.normalizedKey, parsed.lineNumber);
      }
    }
    rows.push(parsed);
  }

  return { rows, fileErrors: [] };
}

export interface DryRunRow {
  lineNumber: number;
  outcome: RowOutcome;
  /** For WILL_MERGE: the sku_code the row would merge into. */
  existingSkuCode?: string;
  reason?: string;
  key?: string;
}

export interface DryRunReport {
  rows: DryRunRow[];
  willCreate: number;
  willMerge: number;
  errors: number;
  fileErrors: string[];
}

/**
 * Classify every row against what is already in the catalog.
 *
 * `existingByKey` is supplied by the caller so this stays pure and the whole
 * report can be tested without a database.
 */
export function dryRun(
  parsed: ParsedCsv,
  existingByKey: ReadonlyMap<string, string>,
): DryRunReport {
  const rows: DryRunRow[] = parsed.rows.map((r) => {
    if (!r.value) {
      return { lineNumber: r.lineNumber, outcome: 'ERROR', reason: r.errors.join('; ') };
    }
    const existing = existingByKey.get(r.value.normalizedKey);
    return existing
      ? {
          lineNumber: r.lineNumber,
          outcome: 'WILL_MERGE',
          existingSkuCode: existing,
          key: r.value.normalizedKey,
        }
      : { lineNumber: r.lineNumber, outcome: 'WILL_CREATE', key: r.value.normalizedKey };
  });

  return {
    rows,
    willCreate: rows.filter((r) => r.outcome === 'WILL_CREATE').length,
    willMerge: rows.filter((r) => r.outcome === 'WILL_MERGE').length,
    errors: rows.filter((r) => r.outcome === 'ERROR').length,
    fileErrors: parsed.fileErrors,
  };
}

/** The error report ops downloads, keyed by their own line numbers. */
export function errorReportCsv(report: DryRunReport): string {
  const lines = ['line_number,outcome,reason'];
  for (const r of report.rows) {
    if (r.outcome !== 'ERROR') continue;
    lines.push(`${r.lineNumber},${r.outcome},${csvEscape(r.reason ?? '')}`);
  }
  return lines.join('\n') + '\n';
}

/** Grades are referenced by the condition-image importer; re-exported for it. */
export const IMPORTABLE_GRADES = GRADES;
