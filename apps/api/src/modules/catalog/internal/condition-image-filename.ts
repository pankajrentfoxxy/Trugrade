import { CONDITION_VIEW_CODES, GRADES, type ConditionViewCode, type Grade } from '@trugrade/contracts';

/**
 * `<model>_<grade>_<view>_<n>.jpg`, parsed.
 *
 * Phase 2 Task 4 asks for bulk upload that assigns `view_code` from the
 * filename. The parsing lives here — a pure function with no Nest, no Prisma and
 * no DOM — for one reason: **the console and the API must agree about what a
 * name means.** The console shows the operator "this file becomes Grade B ·
 * LID_TOP · 1" before a byte is uploaded, and the API decides what actually gets
 * written. If those were two implementations, the screen would be a preview of
 * something else, and the mismatch would surface as a Grade A photograph on a
 * Grade B listing — the one failure this whole feature exists to prevent.
 *
 * So there is exactly one parser, it runs on the server, and the console calls
 * it through the bulk endpoint's dry run rather than reimplementing it.
 *
 * The convention looks like a four-way split on `_`, and is not. Six of the ten
 * view codes contain an underscore (`LID_TOP`, `SCREEN_ON`, `PORTS_LEFT`,
 * `PORTS_RIGHT`, `CORNER_WEAR`, `SCREEN_DEFECT`), and a model name may contain
 * several. `'a_b_c_d'.split('_')` is therefore wrong on the majority of real
 * filenames, which is why this is anchored on the *known* grade and view
 * vocabularies instead of on separator position.
 */

export const CONDITION_FILENAME_CONVENTION = '<model>_<grade>_<view>_<n>.jpg';

/** What the presign route already accepts. HEIC off a phone is not one of them. */
const EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp'] as const);

/**
 * How a grade may be spelled in a filename.
 *
 * `A_PLUS` is the database's enum label and `A+` is what everyone types. Both
 * are accepted, along with `APLUS`, because a bulk upload rejected over the
 * punctuation of a grade everybody agrees on is a rejection that teaches the
 * operator nothing.
 */
const GRADE_TOKEN: Readonly<Record<string, Grade>> = Object.freeze({
  'A+': 'A_PLUS',
  A_PLUS: 'A_PLUS',
  APLUS: 'A_PLUS',
  A: 'A',
  B: 'B',
});

/** Longest first, so `A_PLUS` is never consumed as `A` followed by junk. */
const alternation = (tokens: readonly string[]): string =>
  [...tokens]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[+]/g, String.raw`\+`))
    .join('|');

/**
 * Built from the shared constants, never from a hand-written list. A view code
 * added to `CONDITION_VIEW_CODES` is immediately uploadable; a list restated
 * here would be the second definition that silently rejects it.
 */
const PATTERN = new RegExp(
  String.raw`^(?<model>.+?)_(?<grade>${alternation(Object.keys(GRADE_TOKEN))})` +
    String.raw`_(?<view>${alternation(CONDITION_VIEW_CODES)})_(?<n>\d{1,2})$`,
);

export interface ParsedConditionFilename {
  /** The model token as written, normalised for comparison — never for display. */
  modelToken: string;
  grade: Grade;
  viewCode: ConditionViewCode;
  /** `<n>` becomes `sort_order`: it is the frame's position within its slot. */
  sortOrder: number;
}

export type FilenameParse =
  | ({ ok: true } & ParsedConditionFilename)
  /** `expected` is the convention itself, so the report can state it per file. */
  | { ok: false; error: string; expected: string };

/**
 * Fold a name fragment down to the form the pattern is written against:
 * upper case, one underscore per run of separators, `+` preserved because it is
 * half of a grade.
 *
 * This is also what makes the model check work across the ways a photographer's
 * folder actually names things — `Latitude 5320`, `latitude-5320` and
 * `LATITUDE_5320` are the same machine and must not be three different answers.
 */
export function normaliseFilenameToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9+]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Does the normalised stem contain `token` as a whole underscore-delimited run? */
const hasToken = (stem: string, token: string): boolean =>
  `_${stem}_`.includes(`_${token}_`);

export function parseConditionImageFilename(filename: string): FilenameParse {
  const expected = CONDITION_FILENAME_CONVENTION;
  // Browsers hand back a bare name, but a directory drop carries a relative
  // path. The folder is not part of the convention.
  const base = filename.replace(new RegExp(String.raw`^.*[/\\]`), '').trim();

  const dot = base.lastIndexOf('.');
  const extension = dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
  if (!(EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      expected,
      error: `"${base}" is not a photograph we can store. Expected ${EXTENSIONS.join(', ')}.`,
    };
  }

  const stem = normaliseFilenameToken(base.slice(0, dot));
  const m = PATTERN.exec(stem);
  if (!m?.groups) {
    // Three cheap checks, so the message names the part that is wrong rather
    // than restating the convention and leaving the operator to diff it by eye
    // across sixty files.
    //
    // Whole tokens, not substrings. `'LATITUDE_5320_C_...'.includes('A')` is
    // true, which would let a Grade C folder — a grade we do not sell at all —
    // fall through to the generic "does not match the pattern" message and lose
    // the one sentence the operator needed to read.
    if (!CONDITION_VIEW_CODES.some((v) => hasToken(stem, v))) {
      return {
        ok: false,
        expected,
        error: `"${base}" names no view. Expected one of ${CONDITION_VIEW_CODES.join(', ')}.`,
      };
    }
    if (!Object.keys(GRADE_TOKEN).some((g) => hasToken(stem, g))) {
      return {
        ok: false,
        expected,
        error: `"${base}" names no grade. Expected A+, A or B — nothing below B is sold.`,
      };
    }
    return {
      ok: false,
      expected,
      error: `"${base}" does not match ${expected}. The trailing number is the frame's position, e.g. Latitude 5320_B_LID_TOP_1.jpg.`,
    };
  }

  return {
    ok: true,
    modelToken: m.groups['model']!,
    grade: GRADE_TOKEN[m.groups['grade']!]!,
    viewCode: m.groups['view'] as ConditionViewCode,
    sortOrder: Number(m.groups['n']),
  };
}

/**
 * An example of the convention for a real model, for the empty drop zone.
 *
 * Shown rather than described: nobody reads `<model>_<grade>_<view>_<n>.jpg` and
 * correctly guesses that the model may contain spaces and the view may not.
 */
export function conditionFilenameExample(modelName: string): string {
  return `${modelName}_${GRADES[GRADES.length - 1]}_${CONDITION_VIEW_CODES[0]}_1.jpg`;
}
