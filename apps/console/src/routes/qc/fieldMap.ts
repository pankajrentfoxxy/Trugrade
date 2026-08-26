import { DEVICESURE_FIELD_MAP } from '@trugrade/contracts';

/**
 * Validating a `field_map_json` before anybody saves it.
 *
 * A field map is the one piece of configuration in this phase that fails
 * silently. Everything else in QC fails loudly — a bad area code hits a CHECK, a
 * replayed nonce hits a unique index, a serial mismatch stops the unit. A field
 * map with a typo in a path simply parses `undefined` for that field, forever,
 * on every certificate, and the first person to notice is whoever wonders in
 * three months why no battery health was ever recorded. So it is checked here,
 * before it is saved, rather than discovered downstream.
 *
 * Two rules carry most of the weight.
 *
 * **Direction.** The map is `OUR FIELD -> THEIR PATH`: `{"serial": "device.serial"}`.
 * All four seeded providers are written that way. Reversed, it parses to garbage
 * the first time the generic parser is reused across providers, and it looks
 * perfectly reasonable in a diff — so a map whose keys are mostly dotted paths is
 * refused outright rather than warned about.
 *
 * **The known field set is the parser's field set.** A key nothing reads is not a
 * harmless extra; it is a mapping somebody wrote believing it would be used.
 * `DEVICESURE_FIELD_MAP` in `@trugrade/contracts` is that set, reused rather than
 * restated — a second copy of it here is exactly how the console starts accepting
 * a key the parser dropped.
 */

/** Every field the ingestion parser reads. The keys, not the paths. */
export const KNOWN_FIELDS: readonly string[] = Object.freeze(Object.keys(DEVICESURE_FIELD_MAP));

/**
 * Without these there is no ingestion worth having, so they are errors:
 *
 * - `tool_run_id` backs `UNIQUE (tool_provider_id, tool_run_id)`. Missing it, the
 *   same run submitted twice is two rows instead of one and a 200.
 * - `nonce` is what makes a replay rejectable.
 * - `raw_report_hash` is the integrity check on the payload we keep as evidence.
 * - `serial` drives `serial_matches`, and `serial_matches = FALSE` is the hard
 *   stop that says the label does not belong to the laptop.
 */
export const REQUIRED_FIELDS: readonly string[] = Object.freeze([
  'tool_run_id',
  'nonce',
  'raw_report_hash',
  'serial',
]);

/** Missing these produces a working but diminished ingestion. Worth saying so. */
const EXPECTED_FIELDS: readonly string[] = Object.freeze([
  'signature',
  'grade_proposed',
  'qc_score',
  'valid_until',
  'seal_code',
  'photos',
]);

/** `a`, `a.b`, `a.b[0].c` — a path into a JSON document, and nothing else. */
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*(\.[A-Za-z_][A-Za-z0-9_]*(\[\d+\])*)*$/;

export interface FieldMapCheck {
  /** Refuses the save. */
  errors: string[];
  /** Worth reading before saving, never worth refusing over. */
  warnings: string[];
  /** Null whenever `errors` is non-empty. */
  map: Record<string, string> | null;
}

export function validateFieldMap(text: string): FieldMapCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (e) {
    return { errors: [`This is not valid JSON: ${(e as Error).message}`], warnings, map: null };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      errors: ['A field map is a JSON object of our field name to their path.'],
      warnings,
      map: null,
    };
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    return { errors: ['An empty map parses nothing at all.'], warnings, map: null };
  }

  // Direction, before anything else: every other message would be nonsense on a
  // reversed map, and a pile of nonsense messages is how somebody talks
  // themselves into forcing the save.
  const dottedKeys = entries.filter(([k]) => k.includes('.')).length;
  if (dottedKeys > entries.length / 2) {
    return {
      errors: [
        'This map is the wrong way round. It reads their path to our field; it must be our field to their path, as in {"serial": "device.serial"}.',
      ],
      warnings,
      map: null,
    };
  }

  for (const [key, value] of entries) {
    if (typeof value !== 'string') {
      errors.push(`"${key}" maps to ${JSON.stringify(value)}. Every value must be a path string.`);
      continue;
    }
    if (value.trim() === '') {
      errors.push(`"${key}" maps to an empty path, which parses nothing.`);
      continue;
    }
    if (!PATH.test(value)) {
      errors.push(
        `"${key}" maps to "${value}", which is not a path into a JSON document. Expected something like "device.serial" or "photos[0].key".`,
      );
    }
    if (!KNOWN_FIELDS.includes(key)) {
      errors.push(
        `Nothing reads "${key}". The parser only knows ${KNOWN_FIELDS.join(', ')}, so this line would be silently ignored on every certificate.`,
      );
    }
  }

  const present = new Set(entries.map(([k]) => k));
  for (const required of REQUIRED_FIELDS) {
    if (!present.has(required)) errors.push(`"${required}" is missing. ${WHY_REQUIRED[required]}`);
  }
  const missingExpected = EXPECTED_FIELDS.filter((f) => !present.has(f));
  if (missingExpected.length > 0) {
    warnings.push(
      `Not mapped: ${missingExpected.join(', ')}. Ingestion will work, but nothing will ever be recorded for them.`,
    );
  }

  return {
    errors,
    warnings,
    map: errors.length === 0 ? (Object.fromEntries(entries) as Record<string, string>) : null,
  };
}

const WHY_REQUIRED: Readonly<Record<string, string>> = Object.freeze({
  tool_run_id:
    'It is the idempotency key — without it the same run submitted twice becomes two reports.',
  nonce: 'It is what makes a replayed certificate rejectable.',
  raw_report_hash: 'It is the integrity check on the payload we keep as evidence.',
  serial:
    'It drives serial_matches, and a mismatch there is the hard stop that says the label does not belong to the laptop.',
});
