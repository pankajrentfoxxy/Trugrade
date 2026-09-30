'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * The clock on the deal-of-the-day card: hours, minutes and seconds until the
 * featured machine changes, one box each.
 *
 * It measures a real event. `endsAt` is the instant the server will pick a
 * different machine, so when it reaches zero the route is refreshed and the
 * card really does change — the timer is not a number that resets itself
 * while the offer behind it stays put.
 *
 * Nothing is drawn from the clock until after mount. The server and the
 * browser read the clock a moment apart, so a server-rendered "05:42:13"
 * would hydrate against "05:42:12" and React would throw the markup away. The
 * placeholder fills the same three boxes, so the card does not shift when the
 * digits arrive.
 */
const two = (n: number): string => String(n).padStart(2, '0');

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

export function DealCountdown({ endsAt }: { endsAt: number }): React.JSX.Element {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);
  // The `endsAt` a refresh was already requested for. Without it, a browser
  // clock running ahead of the server's would refresh every second: the new
  // `endsAt` it gets back is still in its past.
  const refreshedFor = React.useRef<number | null>(null);

  React.useEffect(() => {
    // The viewer's real wall clock, deliberately — the same exception the
    // checkout `Countdown` makes. "How long is actually left" is not business
    // time a test should freeze; the server decided `endsAt`, and that is the
    // figure that matters. Recomputed from the clock each tick rather than
    // decremented, so a laptop that slept shows the truth when it wakes.
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((endsAt - new Date().getTime()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && refreshedFor.current !== endsAt) {
        refreshedFor.current = endsAt;
        router.refresh();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt, router]);

  const hours = secondsLeft === null ? null : Math.floor(secondsLeft / 3600);
  const minutes = secondsLeft === null ? null : Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft === null ? null : secondsLeft % 60;

  return (
    <span
      className="dotd-clock"
      role="timer"
      // `aria-live="off"`: a screen reader that announced every second would
      // make the rest of the page unreadable. The figure is there when asked
      // for, as one sentence rather than six digits and two colons.
      aria-live="off"
      aria-label={
        hours === null || minutes === null || seconds === null
          ? undefined
          : `${plural(hours, 'hour')} ${plural(minutes, 'minute')} ${plural(seconds, 'second')}`
      }
    >
      <Segment value={hours} unit="hrs" />
      <i className="dotd-colon" aria-hidden="true">
        :
      </i>
      <Segment value={minutes} unit="min" />
      <i className="dotd-colon" aria-hidden="true">
        :
      </i>
      <Segment value={seconds} unit="sec" />
    </span>
  );
}

function Segment({ value, unit }: { value: number | null; unit: string }): React.JSX.Element {
  return (
    <span className="dotd-seg" aria-hidden="true">
      <b className="mono">{value === null ? '--' : two(value)}</b>
      <i>{unit}</i>
    </span>
  );
}
