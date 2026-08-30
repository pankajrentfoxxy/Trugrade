'use client';

import * as React from 'react';

/**
 * How long an approver has left, against a deadline WE imposed.
 *
 * This is the one countdown on this screen and the only one the task allows:
 * `ordering.order_approval.expires_at` is a real column with a real 24-hour
 * default, the machines behind it are genuinely off sale until then, and a job
 * releases them on expiry whether or not anybody is looking. It is not a
 * scarcity device — nothing here says how many other people are looking, nothing
 * resets on a refresh, and the figure only ever describes a hold we placed on
 * our own stock.
 *
 * It reads in **hours and minutes**, not `mm:ss`. Checkout's twenty-minute hold
 * is a `Countdown` because twenty minutes is a thing a person sits through; a
 * day is not, and rendering it the same way would print `1439:58` and tick it
 * down one second at a time in front of somebody who has gone to find their
 * manager. So it recomputes once a minute, and the absolute instant is beside it
 * because that is the figure you put in a message to the approver.
 *
 * The wall clock, deliberately — the same exception `Countdown` makes. "How long
 * is actually left" is not business time a test should freeze; the server's
 * `ClockPort` decided `expiresAt`, and that is the figure that matters.
 */
export function Deadline({ expiresAt }: { expiresAt: string }): React.JSX.Element {
  const deadline = React.useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [remaining, setRemaining] = React.useState(() => deadline - new Date().getTime());

  React.useEffect(() => {
    setRemaining(deadline - new Date().getTime());
    const id = setInterval(() => setRemaining(deadline - new Date().getTime()), 60_000);
    return () => clearInterval(id);
  }, [deadline]);

  const minutes = Math.floor(remaining / 60_000);
  return (
    <span className="mono" aria-live="polite">
      {minutes <= 0 ? 'the deadline has passed' : left(minutes)}
    </span>
  );
}

/** "about 14 hours" / "about 40 minutes". Rounded, because a signature is not a race. */
function left(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return rest === 0 ? `${h} left` : `${h} ${rest} min left`;
}

/**
 * An instant, in the only timezone this product operates in.
 *
 * IST and labelled IST. A B2B approval deadline read in the wrong zone is a
 * released hold, and a bare "9:28 pm" invites the reader to supply their own.
 */
export const inIst = (iso: string): string =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso)) + ' IST';
