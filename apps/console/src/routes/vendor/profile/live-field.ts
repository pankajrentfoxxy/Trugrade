export type LiveFieldKey = string;

/** Surfaces validation once focused and the user has typed. */
export function liveFieldError(
  key: LiveFieldKey,
  value: string,
  validate: (value: string) => string | undefined,
  focused: LiveFieldKey | null,
  active: Partial<Record<LiveFieldKey, boolean>>,
): string | undefined {
  const engaged = focused === key || active[key];
  if (!engaged) return undefined;
  if (!active[key] && value.length === 0) return undefined;
  return validate(value);
}
