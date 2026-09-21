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
 *
 * The clock is a hook and the card is a renderer, so the flow owns the deadline
 * (it decides what "expired" does) and the card only draws it.
 */
export interface Hold {
  /** `mm:ss`, or `00:00` once it has run out. */
  label: string;
  expired: boolean;
  /** Under two minutes. The figure changes colour as well as value. */
  urgent: boolean;
}

export function useHold(expiresAt: string | null, onExpired: () => void): Hold {
  const deadline = React.useMemo(
    () => (expiresAt ? new Date(expiresAt).getTime() : null),
    [expiresAt],
  );
  // The viewer's real wall clock, deliberately — the same exception
  // `LockService` makes for a lock deadline. This is not business time that a
  // test should be able to freeze; it is "how long is actually left", and a
  // frozen clock here would show a deadline that never arrives. The server's
  // `ClockPort` decided `expiresAt`, which is the figure that matters.
  const [remaining, setRemaining] = React.useState<number | null>(() =>
    deadline === null ? null : deadline - new Date().getTime(),
  );
  const fired = React.useRef(false);

  React.useEffect(() => {
    fired.current = false;
    if (deadline === null) {
      setRemaining(null);
      return;
    }
    setRemaining(deadline - new Date().getTime());
    const id = setInterval(() => setRemaining(deadline - new Date().getTime()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  React.useEffect(() => {
    if (remaining === null || remaining > 0 || fired.current) return;
    fired.current = true;
    onExpired();
  }, [remaining, onExpired]);

  if (remaining === null) return { label: '--:--', expired: false, urgent: false };

  const expired = remaining <= 0;
  const seconds = Math.max(0, Math.floor(remaining / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return {
    label: expired ? '00:00' : `${mm}:${ss}`,
    expired,
    urgent: !expired && remaining < 120_000,
  };
}

/** The card in the right rail. */
export function HoldCard({ hold }: { hold: Hold }): React.JSX.Element {
  return (
    <div
      className="ck-hold"
      // Polite, not assertive: a screen reader reading every second would make
      // the rest of the page unusable. It announces on the minute instead.
      aria-live="polite"
      aria-atomic="true"
    >
      <small>{hold.expired ? 'Hold expired' : 'These machines are held for'}</small>
      <div className={`ck-hold-t tnum${hold.expired ? ' expired' : hold.urgent ? ' urgent' : ''}`}>
        {hold.label}
      </div>
      <p>
        {hold.expired
          ? 'They have gone back on sale. Start checkout again to take a fresh hold.'
          : 'Nobody else can buy them until then. Nothing is charged — the hold releases on its own.'}
      </p>
    </div>
  );
}
