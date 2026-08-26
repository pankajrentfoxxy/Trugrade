/**
 * Normalisers. Every one of these runs before validation, on both the client and
 * the server, so a value that is legitimate but differently typed ("+91 98765 43210",
 * "512 GB", "5cd1234abc") is accepted instead of rejected for cosmetics.
 *
 * The rule that matters: normalise, then validate. Never validate raw input and
 * never normalise after storing.
 */

import { GSTIN, SERIAL_PLACEHOLDER_BLOCKLIST } from './rules';

/**
 * VR-030. Accepts 10 digits, 0-prefixed, 91-prefixed, +91-prefixed, with any
 * spacing or dashes. Returns E.164 or null when it cannot be made into one.
 */
export function normaliseMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[^\d]/g, '');
  // Strip any trunk/IDD zero padding first ("0", "00", "0091"), then decide.
  // Checking the bare 10-digit case before the 91-prefix case matters: 9199999999
  // is a real subscriber number, not a country code plus eight digits.
  const bare = digits.replace(/^0+/, '');
  let ten: string;
  if (bare.length === 10) ten = bare;
  else if (bare.length === 12 && bare.startsWith('91')) ten = bare.slice(2);
  else return null;
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
}

/** VR-032/VR-033: uniqueness is case-insensitive, so storage is lower-cased. */
export function normaliseEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  const at = trimmed.lastIndexOf('@');
  if (at < 1) return null;
  return trimmed.slice(0, at) + '@' + trimmed.slice(at + 1).toLowerCase();
}

/** VR-076: upper-case, strip spaces and hyphens. Applied before the uniqueness check. */
export function normaliseSerial(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input)
    .toUpperCase()
    .replace(/[\s\-_]/g, '');
  return s.length ? s : null;
}

/**
 * VR-076: a serial that is a firmware placeholder, or a single repeated character,
 * is not an identity. Rejecting these is what stops a whole vendor batch arriving
 * as `TOBEFILLEDBYOEM`.
 */
export function isPlaceholderSerial(serial: string): boolean {
  const s = normaliseSerial(serial) ?? '';
  if (!s) return true;
  if (SERIAL_PLACEHOLDER_BLOCKLIST.includes(s)) return true;
  if (/^(.)\1+$/.test(s)) return true;
  return false;
}

export function normaliseGstin(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).toUpperCase().replace(/\s/g, '');
  return s.length ? s : null;
}

/**
 * VR-002 — the GSTIN check digit. Base-36 weighted alternately 1,2 across the
 * first 14 characters; the check digit is `36 - (sum mod 36)` mod 36.
 *
 * Worth doing client-side: it turns a 30-second round trip to the GST portal into
 * an instant "you mistyped a character", which is the difference between a form
 * people finish and a form they abandon.
 */
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinCheckDigit(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = B36.indexOf(first14[i]!);
    if (v < 0) return null;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = v * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return B36[(36 - (sum % 36)) % 36]!;
}

export function isValidGstin(input: string): boolean {
  const g = normaliseGstin(input);
  if (!g || !GSTIN.pattern!.test(g)) return false;
  return gstinCheckDigit(g.slice(0, 14)) === g[14];
}

/** VR-006: characters 3–12 of a GSTIN are the holder's PAN. */
export function panFromGstin(gstin: string): string | null {
  const g = normaliseGstin(gstin);
  return g && g.length === 15 ? g.slice(2, 12) : null;
}

/** VR-003: state code is the first two characters. */
export function stateCodeFromGstin(gstin: string): string | null {
  const g = normaliseGstin(gstin);
  return g && g.length >= 2 ? g.slice(0, 2) : null;
}

/**
 * The SKU dedupe key (Phase 2 Task 2). Written once, here, and used on ingest, on
 * vendor listing creation, on CSV import and on the SKU-request path. Two code
 * paths generating different keys for the same machine is how a catalog rots.
 */
export interface SkuKeyParts {
  brand: string;
  model: string;
  cpuFamily?: string | null;
  cpuModel?: string | null;
  ramGb: number;
  storageGb: number;
  /** Free text or the stored enum value — both canonicalise to the same token. */
  storageType: string;
  screenSizeIn?: number | null;
  screenResolution?: string | null;
  gpu?: string | null;
  os?: string | null;
  /** Legacy 6.3: "a touch variant is a different SKU, not a note." */
  isTouch?: boolean | null;
}

const canon = (s: string | null | undefined): string =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** `512GB`, `512 GB`, `0.5TB`, `512gb` all become 512. */
export function normaliseCapacityGb(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Math.round(input);
  const s = String(input).toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^([\d.]+)(tb|gb|mb)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? 'gb';
  if (unit === 'tb') return Math.round(n * 1024);
  if (unit === 'mb') return Math.round(n / 1024);
  return Math.round(n);
}

/**
 * `canon` turns every run of punctuation into `_`, so "M.2" becomes "m_2" and
 * "1920 x 1080" becomes "1920_x_1080". Both are the same value as "m2" and
 * "1920x1080" and must not produce a different key, so the separators are
 * collapsed before matching rather than enumerated in every pattern.
 */
function collapseSeparators(s: string): string {
  return (
    s
      // "1920_x_1080" -> "1920x1080"
      .replace(/(\d)_x_(\d)/g, '$1x$2')
      // "m_2_nvme" -> "m2_nvme". No \b after the digit: `_` is a word character,
      // so \bm_2\b never matches inside a canonicalised token.
      .replace(/(^|_)m_2(?=_|$)/g, '$1m2')
  );
}

/**
 * Map a storage description onto the four values `catalog.sku.storage_type`
 * permits, so a form that says `NVMe` and the row read back saying `NVME_SSD`
 * produce one key rather than two.
 *
 * Without this the dedupe guarantee fails **open**. `UNIQUE (normalized_key)`
 * accepts the duplicate happily, because the two keys genuinely differ — the
 * constraint is doing its job on inputs that were never made comparable. At 200
 * SKUs the catalog is quietly corrupt with every test still green.
 *
 * A bare `SSD` is deliberately not guessed at. Resolving it to SATA_SSD would
 * turn a correct declaration of an NVMe drive into a mismatch, so it stays
 * `ssd` — stable, and honest about not knowing.
 */
export function canonStorageType(input: string | null | undefined): string {
  const s = collapseSeparators(canon(input));
  if (!s) return '';
  if (/^(nvme|nvme_ssd|m2_nvme|nvme_m2|pcie_ssd|pcie_nvme|ssd_nvme)$/.test(s)) return 'nvme_ssd';
  if (/^(sata_ssd|sata|ssd_sata|m2_sata|sata3_ssd)$/.test(s)) return 'sata_ssd';
  if (/^(hdd|sata_hdd|hard_disk|hard_drive|spinning)$/.test(s)) return 'hdd';
  if (/^(emmc|e_mmc)$/.test(s)) return 'emmc';
  return s;
}

/**
 * Map a display description onto the five values `catalog.sku.resolution`
 * permits. `1920x1080`, `1920 x 1080`, `FHD` and `Full HD` are one panel.
 */
export function canonResolution(input: string | null | undefined): string {
  const s = collapseSeparators(canon(input));
  if (!s) return '';
  if (/^(hd|1366x768|1280x720)$/.test(s)) return 'hd';
  if (/^(fhd|full_hd|fullhd|1920x1080|1920x1200)$/.test(s)) return 'fhd';
  if (/^(qhd|2560x1440|2560x1600|wqxga)$/.test(s)) return 'qhd';
  if (/^(4k|uhd|3840x2160|3840x2400)$/.test(s)) return '4k';
  if (/^retina$/.test(s)) return 'retina';
  return s;
}

/**
 * The dedupe key.
 *
 * Two rules hold this together and both were broken before Phase 2:
 *
 *   1. **One code path.** Anything that needs a key calls this — ingest, CSV
 *      import, the SKU-request near-match check, the test factories. A second
 *      implementation that agrees today drifts tomorrow.
 *   2. **One vocabulary.** Inputs are canonicalised to the values the columns
 *      actually store before they are joined, so a key computed from a form and
 *      a key computed from the row read back are byte-identical. They were not:
 *      the free text `NVMe`/`1920x1080` a form supplies and the `NVME_SSD`/`FHD`
 *      the CHECK constraints store produced two different keys for one machine.
 */
export function skuNormalizedKey(parts: SkuKeyParts): string {
  return [
    canon(parts.brand),
    canon(parts.model),
    canon(parts.cpuFamily),
    canon(parts.cpuModel),
    String(parts.ramGb),
    String(parts.storageGb),
    canonStorageType(parts.storageType),
    parts.screenSizeIn != null ? String(Number(parts.screenSizeIn)) : '',
    canonResolution(parts.screenResolution),
    canon(parts.gpu),
    canon(parts.os),
    // Not in Task 2's list, and it has to be: a Latitude 5420 and a Latitude
    // 5420 Touch are different products at different prices. Omitting it merges
    // them under one key and the merge is unrecoverable once units are listed.
    parts.isTouch ? 'touch' : 'nontouch',
  ].join('|');
}

/**
 * 07 §3.4 — Windows `TotalPhysicalMemory` reports memory *usable by the OS*, so a
 * 16 GB machine with integrated graphics reports 15 GB. Snapping the detected value
 * to the nearest standard module total is what stops the grade-correction engine
 * firing a false mismatch on every single unit.
 *
 * This is a *reporting* correction with both numbers preserved, not a parser
 * quietly fixing its source — the raw value stays on `qc_hardware_detected`.
 */
const STANDARD_RAM_GB = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128];

export function installedRamFromUsable(usableGb: number): number {
  for (const std of STANDARD_RAM_GB) {
    // Firmware + iGPU reservation is at most ~1.5 GB on the machines we grade.
    if (usableGb <= std && std - usableGb <= 1.75) return std;
  }
  return Math.round(usableGb);
}

/** 07 §3.4 — a 512 GB drive measures 477 GiB. The buyer was promised 512. */
export function nominalStorageFromBinary(gibibytes: number): number {
  const nominal = [128, 256, 320, 500, 512, 640, 750, 1000, 1024, 2000, 2048, 4000, 4096];
  const bytes = gibibytes * 1024 ** 3;
  let best = Math.round(gibibytes);
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const n of nominal) {
    const delta = Math.abs(n * 1000 ** 3 - bytes) / (n * 1000 ** 3);
    if (delta < bestDelta && delta < 0.06) {
      bestDelta = delta;
      best = n;
    }
  }
  return best;
}
