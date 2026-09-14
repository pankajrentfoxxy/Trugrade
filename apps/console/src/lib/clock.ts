/**
 * The console's single sanctioned wall-clock read.
 *
 * Mirrors `ClockPort`/`SystemClock` on the API side: `no-restricted-syntax`
 * makes `Date.now()` a lint error everywhere so the time-dependent rules —
 * document expiry, payable age — can be tested without sleeping. The browser
 * has no Nest container to inject a port through, so the indirection is a
 * module boundary instead: tests stub this one function.
 */
export function nowMs(): number {
  // eslint-disable-next-line no-restricted-syntax -- this is the implementation of the clock
  return Date.now();
}

/** Whole days from `iso` to now. Negative when `iso` is in the past. */
export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - nowMs()) / 86_400_000);
}

/** Whole days elapsed since `iso`, floored at zero. */
export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((nowMs() - new Date(iso).getTime()) / 86_400_000));
}
