/**
 * Reading an onboarding draft.
 *
 * `onboarding_progress.draft_json` is whatever the wizard last saved, which
 * makes it the one place in the API where the shape is genuinely unknown: a
 * draft written by yesterday's build is still sitting in the table today. So
 * every read is a *question* — "is there a string here" — and a draft that
 * cannot answer it yields the empty answer rather than a `TypeError` five frames
 * inside a promotion.
 *
 * Deliberately not Zod. A schema would refuse a whole step because one optional
 * field is a number where it used to be a string, and refusing a step means an
 * applicant who cannot finish their application. Promotion validates what it is
 * about to *write* — the CHECK constraints and the NOT NULLs — and is
 * indifferent to everything else in the draft.
 */
export type Draft = Record<string, unknown>;

export const str = (draft: Draft, key: string): string =>
  typeof draft[key] === 'string' ? (draft[key] as string).trim() : '';

/** `null` for absent or unparseable — never 0, which is a real answer. */
export function int(draft: Draft, key: string): number | null {
  const raw = draft[key];
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.trunc(raw) : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function decimal(draft: Draft, key: string): number | null {
  const raw = draft[key];
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `null` means NOT ANSWERED, and callers must keep that distinction.
 * `can_dropship` and `can_provide_serials_upfront` both default TRUE in the
 * database, so collapsing an unanswered question to `false` — or to the default
 * — asserts a commercial position on a supplier's behalf.
 */
export const bool = (draft: Draft, key: string): boolean | null =>
  typeof draft[key] === 'boolean' ? (draft[key] as boolean) : null;

export const strings = (draft: Draft, key: string): string[] =>
  Array.isArray(draft[key])
    ? (draft[key] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

export const objects = (draft: Draft, key: string): Draft[] =>
  Array.isArray(draft[key])
    ? (draft[key] as unknown[]).filter(
        (v): v is Draft => typeof v === 'object' && v !== null && !Array.isArray(v),
      )
    : [];

export const nested = (draft: Draft, key: string): Draft =>
  typeof draft[key] === 'object' && draft[key] !== null && !Array.isArray(draft[key])
    ? (draft[key] as Draft)
    : {};

/** `HH:MM` or `HH:MM:SS` as a `TIME` value, or null. Postgres wants a Date. */
export function timeOfDay(value: string): Date | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value)) return null;
  const [h, m] = value.split(':');
  return new Date(Date.UTC(1970, 0, 1, Number(h), Number(m)));
}

/** A `YYYY-MM-DD` that is also a real date. `2026-02-31` parses and is not one. */
export function dateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value) ? null : parsed;
}
