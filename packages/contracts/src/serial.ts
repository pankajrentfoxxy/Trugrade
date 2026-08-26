import { SERIAL_NUMBER, SERIAL_BRAND_PATTERNS } from './rules';
import { normaliseSerial, isPlaceholderSerial } from './normalise';

/**
 * Serial number handling for the listing wizard (Phase 3 Task 3).
 *
 * The governing instruction is one sentence long: **warn, do not block, on an
 * unrecognised pattern** — "you will meet machines whose labels are worn". So a
 * brand-shape mismatch is advisory. The things that DO reject a serial are the
 * ones that are true regardless of brand: it is empty, it is outside VR-076's
 * length band, it carries characters no label ever prints, it is a firmware
 * placeholder (VR-076's blocklist), or the same serial appears twice in one
 * paste.
 *
 * Every pattern and bound here comes from `rules.ts`. Nothing about a serial is
 * re-specified locally. A second copy of a brand pattern is exactly the
 * divergence `rules.meta.spec.ts` exists to catch -- and on the first draft of
 * this file, it caught it.
 *
 * Global uniqueness (`uq_unit_active_serial`) and the blacklist check are
 * deliberately NOT here — they need the database. This module stays pure so the
 * wizard can run it on every keystroke without a round trip.
 */

export type PatternVerdict = 'MATCH' | 'MISMATCH' | 'UNKNOWN';

/** Scanner and spreadsheet artefacts that ride along with a pasted serial. */
const LABEL_PREFIX = /^(?:s\/?n|serial(?:\s*(?:no|number))?|service\s*tag|svc\s*tag)\s*[:.#-]?\s*/i;

/**
 * Clean up a serial as it arrives from a paste, a scan or a spreadsheet cell,
 * then hand it to the canonical normaliser.
 *
 * `normalise.normaliseSerial` (VR-076) owns what a stored serial looks like:
 * upper case, no spaces, no hyphens, no underscores. It does not know about
 * `S/N:` prefixes or the zero-width characters that survive a copy from a web
 * page, because nothing else in the system meets those. So this strips the
 * transport noise and delegates the actual rule — rather than becoming a second
 * definition of "normalised", which is the divergence this codebase keeps
 * producing.
 *
 * Deliberately does NOT "correct" O/0 or I/1 confusion on worn labels. Guessing
 * which one the label meant invents a serial belonging to a different machine —
 * the same failure as guessing that a bare "SSD" means NVMe.
 */
export function normalisePastedSerial(raw: string): string {
  const stripped = raw
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(LABEL_PREFIX, '');
  return normaliseSerial(stripped) ?? '';
}

/**
 * Brand plausibility, VR-078. A brand with no catalogued pattern yields UNKNOWN,
 * which is silent — inventing a pattern would produce confident false warnings
 * on real machines, which is worse than saying nothing.
 */
export function checkSerialPattern(
  serial: string,
  brandName: string | null | undefined,
): { verdict: PatternVerdict; expectedShape?: string } {
  if (!brandName) return { verdict: 'UNKNOWN' };
  const pattern = SERIAL_BRAND_PATTERNS[brandName.trim().toUpperCase()];
  if (!pattern) return { verdict: 'UNKNOWN' };
  return pattern.test(serial)
    ? { verdict: 'MATCH' }
    : { verdict: 'MISMATCH', expectedShape: describeShape(pattern) };
}

/** Turn a catalogued pattern into something a warehouse can act on. */
function describeShape(pattern: RegExp): string {
  const m = /^\^\[A-Z0-9\]\{(\d+)(?:,(\d+))?\}\$$/.exec(pattern.source);
  if (!m) return `the shape ${pattern.source}`;
  const [, lo, hi] = m;
  return hi ? `${lo}–${hi} letters and digits` : `${lo} letters and digits`;
}

export interface SerialIssue {
  /** 1-based, matching what the vendor sees in the textarea or the CSV. */
  readonly line: number;
  readonly serial: string;
  readonly message: string;
}

export interface SerialBatch {
  /** Normalised, de-duplicated, in first-seen order. Safe to insert. */
  readonly accepted: readonly string[];
  /** Blocking. The vendor must fix these before the step can advance. */
  readonly errors: readonly SerialIssue[];
  /** Advisory. The vendor may proceed over these. */
  readonly warnings: readonly SerialIssue[];
}

/**
 * Split a pasted block into candidate serials.
 *
 * The spec says "one per line", but vendors paste from Excel columns, from
 * emails, and from comma-separated exports. VR-076 allows only A–Z and 0–9 in a
 * serial, so splitting on whitespace, commas and semicolons can never cut a
 * valid serial in half — and it saves a support ticket per vendor.
 */
export function splitSerialBlock(text: string): string[] {
  return text.split(/[\s,;]+/).filter((s) => s.length > 0);
}

/**
 * Validate a batch of serials for one brand.
 *
 * `alreadyLive` carries serials the server has reported as active elsewhere (the
 * `uq_unit_active_serial` check) and `blacklisted` the `kyc.blacklist_entry`
 * hits. Passing them in keeps this function pure while still letting one call
 * produce the complete error list — the wizard shows "already listed" before
 * submission, not after.
 */
export function validateSerialBatch(input: {
  serials: readonly string[];
  brandName?: string | null;
  alreadyLive?: readonly string[];
  blacklisted?: readonly string[];
}): SerialBatch {
  const live = new Set((input.alreadyLive ?? []).map(normalisePastedSerial));
  const blocked = new Set((input.blacklisted ?? []).map(normalisePastedSerial));

  const accepted: string[] = [];
  const errors: SerialIssue[] = [];
  const warnings: SerialIssue[] = [];
  const seen = new Map<string, number>();

  input.serials.forEach((raw, i) => {
    const line = i + 1;
    const serial = normalisePastedSerial(raw);

    if (serial.length === 0) {
      errors.push({ line, serial: raw, message: 'Empty serial.' });
      return;
    }
    // VR-076 owns the character set and the length band. Re-stating either here
    // is how the two drift apart.
    if (!SERIAL_NUMBER.pattern!.test(serial)) {
      errors.push({ line, serial, message: SERIAL_NUMBER.message });
      return;
    }
    if (isPlaceholderSerial(serial)) {
      errors.push({
        line,
        serial,
        message:
          'That is a firmware placeholder or a repeated character, not a serial. Read the number printed on the chassis.',
      });
      return;
    }

    const firstSeenAt = seen.get(serial);
    if (firstSeenAt !== undefined) {
      errors.push({
        line,
        serial,
        message: `Duplicate of line ${firstSeenAt} in this batch. One serial is one physical laptop.`,
      });
      return;
    }
    if (blocked.has(serial)) {
      errors.push({ line, serial, message: 'This serial is blocked and cannot be listed.' });
      return;
    }
    if (live.has(serial)) {
      errors.push({
        line,
        serial,
        message: 'Already listed and live elsewhere. A serial can be active in exactly one place.',
      });
      return;
    }

    const { verdict, expectedShape } = checkSerialPattern(serial, input.brandName);
    if (verdict === 'MISMATCH') {
      // Warning, never an error. A worn label is a real machine.
      warnings.push({
        line,
        serial,
        message: `Does not look like a ${input.brandName} serial (expected ${expectedShape}). Check the label, or continue if it is correct.`,
      });
    }

    seen.set(serial, line);
    accepted.push(serial);
  });

  return { accepted, errors, warnings };
}
