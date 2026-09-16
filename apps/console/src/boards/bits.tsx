import type { ReactNode } from 'react';

/**
 * A status is a coloured dot and one word.
 *
 * Not a pill with a sentence in it. The pill was doing three jobs — colour,
 * label and explanation — and the explanation is the one that does not belong
 * on a row an operator scans a hundred of. The dot carries the state, the word
 * carries the name, and the record carries the reason.
 *
 * The tone map is deliberately small. Green and red are reserved for pass and
 * fail; anything in flight is neutral, because a consignment that is merely
 * moving is not a warning and colouring it amber trains people to ignore amber.
 */

export type Tone = 'ok' | 'warn' | 'fail' | 'idle' | 'live';

const DOT: Record<Tone, string> = {
  ok: 'bg-pass',
  warn: 'bg-warn',
  fail: 'bg-fail',
  idle: 'bg-ink-4',
  live: 'bg-acc',
};

export function StatusDot({ tone, label }: { tone: Tone; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="text-body-sm text-ink-2">{label}</span>
    </span>
  );
}

/** One word from a SCREAMING_SNAKE status, title-cased. */
export const word = (status: string): string => {
  const first = status.split('_')[0] ?? status;
  return first.charAt(0) + first.slice(1).toLowerCase();
};

const FAIL = new Set(['EXCEPTION', 'FAILED', 'RTO', 'CANCELLED', 'REJECTED', 'REFUSED']);
const OK = new Set(['DELIVERED', 'COMPLETED', 'PAID', 'APPROVED', 'RECEIVED', 'VERIFIED']);
const LIVE = new Set(['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'EXECUTING', 'DISPATCHED']);

export const toneOf = (status: string): Tone =>
  FAIL.has(status) ? 'fail' : OK.has(status) ? 'ok' : LIVE.has(status) ? 'live' : 'idle';

/** Identifiers are mono, always. Serials, AWBs, GSTINs, order numbers. */
export function Id({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="mono text-body-sm text-ink">{children}</span>;
}

/**
 * A value that was never measured.
 *
 * "A missing value never renders as a passing one." An empty cell reads as zero
 * and a dash reads as nothing-to-report; both are claims. This says neither.
 */
export function Unmeasured({ label = 'Not measured' }: { label?: string }): React.JSX.Element {
  return <span className="text-body-sm text-ink-4">{label}</span>;
}
