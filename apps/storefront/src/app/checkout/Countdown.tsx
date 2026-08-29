'use client';

import * as React from 'react';

/**
 * The twenty-minute hold, counting down.
 *
 * **This is a real deadline we imposed, not a scarcity device.** It is the
 * sentence the cart screen already makes ("stock is held for 20 minutes when you
 * start checkout, and the hold and its countdown are shown there"), and behind
 * it are rows in `ordering.checkout_hold_unit` naming exact machines that are
 * genuinely off sale until `expiresAt`. When it reaches zero they go back on
 * sale, released by a job, whether or not this tab is open. Nothing about it is
 * invented and nothing about it is urgency theatre: no "3 people are viewing
 * this", no reset on a refresh, and it is stated in minutes rather than
 * flashing.
 *
 * It ticks on a one-second interval against the wall clock rather than
 * decrementing a counter, so a laptop that slept for ten minutes shows the truth
 * when it wakes rather than ten minutes of credit it does not have.
 */
export function Countdown({
  expiresAt,
  onExpired,
}: {
  /** ISO 8601, straight off `checkout_hold.expires_at`. */
  expiresAt: string;
  onExpired: () => void;
}): React.JSX.Element {
  const deadline = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  // The viewer's real wall clock, deliberately — the same exception
  // `LockService` makes for a lock deadline. This is not business time that a
  // test should be able to freeze; it is "how long is actually left", and a
  // frozen clock here would show a deadline that never arrives. The server's
  // `ClockPort` decided `expiresAt`, which is the figure that matters.
  const now = (): number => new Date().getTime();
  const [remaining, setRemaining] = React.useState(() => deadline - now());
  const fired = React.useRef(false);

  React.useEffect(() => {
    fired.current = false;
    setRemaining(deadline - new Date().getTime());
    const id = setInterval(() => setRemaining(deadline - new Date().getTime()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  React.useEffect(() => {
    if (remaining > 0 || fired.current) return;
    fired.current = true;
    onExpired();
  }, [remaining, onExpired]);

  const expired = remaining <= 0;
  const seconds = Math.max(0, Math.floor(remaining / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  // Under two minutes the figure changes colour as well as value, because a
  // number that only gets smaller is easy to stop reading.
  const urgent = !expired && remaining < 120_000;

  return (
    <p
      className="flex flex-col gap-1 rounded border border-rule bg-sheet-2 p-3"
      // Polite, not assertive: a screen reader reading every second would make
      // the rest of the page unusable. It announces on the minute instead.
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
        {expired ? 'Hold expired' : 'These machines are held for'}
      </span>
      <span
        className={
          expired
            ? 'font-mono text-h2 tnum text-ink-4'
            : urgent
              ? 'font-mono text-h2 tnum text-warn'
              : 'font-mono text-h2 tnum text-ink'
        }
      >
        {expired ? '00:00' : `${mm}:${ss}`}
      </span>
      <span className="text-label text-ink-3">
        {expired
          ? 'They have gone back on sale. Start checkout again to take a fresh hold.'
          : 'Nobody else can buy them until then. Nothing is charged, and the hold releases on its own.'}
      </span>
    </p>
  );
}
