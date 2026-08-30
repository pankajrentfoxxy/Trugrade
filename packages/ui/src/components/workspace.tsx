import * as React from 'react';
import { cn } from '../lib/cn';
import { TickRule } from './measure';

/**
 * Archetype E — **Workspace**: a KPI row, then queues ordered by SLA breach.
 *
 * The ordering is the archetype. An ops dashboard that lists its queues
 * alphabetically is a list of links; one that puts the breached queue at the
 * top is a work instruction, and the difference is whether the 48-hour
 * onboarding SLA gets met.
 */

/* ==========================================================================
 * KpiRow
 * ======================================================================== */

interface KpiCommon {
  key: string;
  label: string;
  /** Where the number came from, or what it excludes. Rendered under the value. */
  hint?: React.ReactNode;
  /** The board this metric drills into. A KPI nobody can act on is decoration. */
  href?: string;
}

/**
 * A count, an amount, a duration. `null` means we do not have it.
 *
 * `unit` is rendered in `--ink-4` beside the value: "42 orders", "₹12.4 L".
 */
export interface KpiCount extends KpiCommon {
  value: number | string | null;
  unit?: string;
  pct?: never;
  denominator?: never;
}

/**
 * A percentage. `denominator` and `denominatorLabel` are **required** — the
 * type is what stops "98%" reaching a screen without "of 412 units" behind it
 * (09_FRONTEND_LOCKED.md; 08_BRAND_SYSTEM.md §8 rule 1). A percentage without
 * its sample size is a claim, not a measurement.
 */
export interface KpiPercentage extends KpiCommon {
  pct: number | null;
  denominator: number;
  denominatorLabel: string;
  value?: never;
  unit?: never;
}

export type Kpi = KpiCount | KpiPercentage;

export interface KpiRowProps {
  items: readonly Kpi[];
  /** Names the group. "Today", "This week", "Open work". */
  label: string;
  className?: string;
}

function isPercentage(item: Kpi): item is KpiPercentage {
  return 'pct' in item && item.pct !== undefined;
}

/**
 * The metric row at the top of a workspace.
 *
 * A `<dl>`: every tile is a term and its value, and that is the only markup
 * that reads correctly when the tiles wrap onto three rows.
 *
 * **A metric we have not measured renders the words "Not measured" in
 * `--ink-4`, never a zero.** Zero deliveries and no delivery data are different
 * facts, and a dashboard that renders them identically is one nobody can act
 * on.
 */
export function KpiRow({ items, label, className }: KpiRowProps): React.JSX.Element {
  const headingId = React.useId();

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)}>
      <h2 id={headingId} className="sr-only">
        {label}
      </h2>
      <dl
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]"
        data-testid="kpi-row"
      >
        {items.map((item) => {
          const percentage = isPercentage(item);
          const missing = percentage ? item.pct === null : item.value === null;

          return (
            // A `<div>` wrapper, not an `<a>`: a `<dl>` may only directly
            // contain dt/dd groups or divs, so the link lives on the term.
            <div
              key={item.key}
              className="tg-card flex flex-col rounded-lg border border-rule bg-sheet"
            >
              <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                {item.href ? (
                  <a href={item.href} className="underline underline-offset-4 hover:text-ink">
                    {item.label}
                  </a>
                ) : (
                  item.label
                )}
              </dt>
              <dd className="mt-2 flex flex-col gap-1">
                {missing ? (
                  <span className="text-body-sm text-ink-4">Not measured</span>
                ) : (
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-h1 tnum text-ink">
                      {percentage ? `${item.pct}%` : item.value}
                    </span>
                    {!percentage && item.unit ? (
                      <span className="text-body-sm text-ink-4">{item.unit}</span>
                    ) : null}
                  </span>
                )}

                {percentage ? (
                  // The denominator rides with the value whether or not the
                  // value exists: "no reading over 412 units" is itself useful.
                  <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
                    {item.denominator.toLocaleString('en-IN')} {item.denominatorLabel}
                  </span>
                ) : null}

                {item.hint ? <span className="text-body-sm text-ink-2">{item.hint}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/* ==========================================================================
 * QueueList
 * ======================================================================== */

export interface QueueItem {
  key: string;
  /** "Onboarding review", "Grade corrections awaiting vendor". */
  label: string;
  href: string;
  /** How many items are waiting. */
  count: number;
  /**
   * How many of those are already past the promise. Absent means we have not
   * measured it, which sorts **last** and renders as "Not measured" — never as
   * a reassuring zero.
   */
  breachedCount?: number;
  /** Hours the oldest waiting item has been waiting. */
  oldestWaitHours?: number;
  /**
   * The promise, in hours. 48 for onboarding review.
   *
   * Optional because not every queue has one, and a queue with no promise must
   * not be handed a borrowed default — printing "SLA 24 h" beside a number
   * nobody committed to is the same failure as rendering an unmeasured value as
   * a passing one. Absent means the clause is not shown at all.
   */
  slaHours?: number;
  /** One line on what the queue is for. Optional. */
  description?: React.ReactNode;
}

/**
 * Worst first: most breached, then oldest, then largest.
 *
 * A queue whose breach count we do not hold sorts to the bottom rather than
 * being treated as zero — an unmeasured queue is not a healthy one, but nor is
 * it evidence of a breach, and promoting it would bury a queue we know is on
 * fire.
 *
 * Exported and pure because the ordering is the part of this component with a
 * wrong answer, and a unit test on a comparator beats a rendering test on it.
 */
export function byBreach(a: QueueItem, b: QueueItem): number {
  const known = (q: QueueItem) => (q.breachedCount === undefined ? 1 : 0);
  if (known(a) !== known(b)) return known(a) - known(b);
  const breach = (b.breachedCount ?? 0) - (a.breachedCount ?? 0);
  if (breach !== 0) return breach;
  const wait = (b.oldestWaitHours ?? 0) - (a.oldestWaitHours ?? 0);
  if (wait !== 0) return wait;
  return b.count - a.count;
}

export interface QueueListProps {
  items: readonly QueueItem[];
  /** Names the list. "Queues", "What is stuck". */
  label: string;
  className?: string;
}

/**
 * The queues under a workspace's KPI row, ordered by SLA breach.
 *
 * The sort happens **here**, not in the caller: "ordered by SLA breach" is the
 * archetype's rule, and a rule every caller re-implements is a rule one caller
 * gets wrong.
 *
 * Breach is stated in words and carried by a `--warn` rule down the left edge,
 * never by colour alone — an ops screen read by a colourblind operator has to
 * work, and it is read all day.
 *
 * WARN, NOT FAIL. A breached queue is a promise WE missed, not a verdict on
 * anything in it. The row this paints says "Buyer applications", so red there is
 * a red mark against a stack of applicants for the crime of us being slow. T28's
 * colour sweep reached the same conclusion on ReviewQueue and moved it to warn;
 * this is the shared component that sweep could not reach. Green and red stay
 * PASS and FAIL.
 */
export function QueueList({ items, label, className }: QueueListProps): React.JSX.Element {
  const headingId = React.useId();
  const ordered = React.useMemo(() => [...items].sort(byBreach), [items]);

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-h3 text-ink">
          {label}
        </h2>
        <TickRule />
      </div>

      <ul className="flex flex-col gap-2" data-testid="queue-list">
        {ordered.map((item) => {
          const breached = (item.breachedCount ?? 0) > 0;
          return (
            <li key={item.key}>
              <a
                href={item.href}
                data-breached={breached || undefined}
                className={cn(
                  'tg-card flex flex-wrap items-center gap-4 rounded-lg border border-l-4 bg-sheet',
                  breached ? 'border-rule border-l-warn' : 'border-rule border-l-rule',
                  'hover:border-ink-3',
                )}
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-body-sm font-medium text-ink">{item.label}</span>
                  {item.description ? (
                    <span className="text-body-sm text-ink-2">{item.description}</span>
                  ) : null}
                  <span className="text-body-sm text-ink-2">
                    {item.oldestWaitHours === undefined ? (
                      <span className="text-ink-4">Oldest not measured</span>
                    ) : (
                      <>
                        Oldest{' '}
                        <span className="font-mono text-data tnum text-ink">
                          {item.oldestWaitHours} h
                        </span>
                      </>
                    )}
                    {item.slaHours !== undefined && (
                      <>
                        <span aria-hidden="true" className="px-2 text-ink-4">
                          ·
                        </span>
                        SLA <span className="font-mono text-data tnum">{item.slaHours} h</span>
                      </>
                    )}
                  </span>
                </span>

                <span className="ml-auto flex flex-col items-end gap-1">
                  <span className="font-mono text-h2 tnum text-ink">{item.count}</span>
                  {item.breachedCount === undefined ? (
                    <span className="text-body-sm text-ink-4">Breaches not measured</span>
                  ) : breached ? (
                    <span className="text-body-sm font-medium text-warn">
                      <span className="font-mono tnum">{item.breachedCount}</span> past SLA
                    </span>
                  ) : (
                    <span className="text-body-sm text-ink-2">Within SLA</span>
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
