/**
 * Which of a form's refusals to show while it is still being typed.
 *
 * Every step form knows how to check itself in full — that is what runs on
 * Continue. Between keystrokes only the fields that already hold something are
 * judged: a number with seven digits is told it needs ten, but an address the
 * applicant has not reached yet is not told it is empty. Empty required fields
 * wait for the button, where the whole check runs as it always did.
 */
export function liveErrors(
  found: Record<string, string>,
  filled: (key: string) => boolean,
): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const [key, message] of Object.entries(found)) {
    if (filled(key)) shown[key] = message;
  }
  return shown;
}
