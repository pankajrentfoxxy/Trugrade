import * as React from 'react';
import { EmptyState, Skeleton } from '@trugrade/ui';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/useResource';

/**
 * ARCHETYPE E — Workspace. A KPI row, then queues ordered by SLA breach.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup and colours verbatim
 * (`.overview-board`/`.ov-*` in `index.css`, `--admin-*` in `globals.css`) —
 * same arrangement as `CatalogTree.tsx` and `OrderBoard.tsx`. The mock's three
 * risk cards and six-row table were one account's example data, not a fixed
 * shape; what is kept from the codebase rather than the mock:
 *
 * - **"Fix these first" holds queues only, never metrics.** A `OpsMetric` has
 *   no SLA, no oldest-wait and no breach count to put in a card footer, and a
 *   metric's "good" direction is not inferrable from its shape — zero open
 *   tickets is healthy, zero payout runs is not. Guessing would be exactly the
 *   kind of invented number `03_UX_SPEC.md §3C.1` already ruled out for the
 *   tiles below. The three worst-breached queues (same `byBreach` order
 *   `QueueList` used) fill the slot instead, and the section disappears on a
 *   day nothing is breached.
 * - **"Work that's waiting" holds every queue, not the mock's extra PO and
 *   approval rows.** Those two are metrics here (no board exists for either
 *   yet, per the note below), so they render in "System health" with every
 *   other metric instead of being forced into a row shape they don't have the
 *   fields for.
 * - **Every figure is read, not typed.** The mock's "36 payables", its "212
 *   days" of partition runway, its four blind spots are the shape; the
 *   numbers come from `/api/ops/dashboard`, scoped to whatever the signed-in
 *   seat can see.
 *
 * **You see your slice.** The server assembles the payload from the
 * permissions the caller actually holds — a KYC_REVIEWER gets the two
 * application queues and no purchase orders — so an empty section here means
 * "not yours", not "none".
 */

interface OpsMetric {
  key: string;
  label: string;
  /** Null means we could not measure it. */
  value: number | null;
  unit: string;
  hint: string;
  href: string | null;
}

interface OpsQueue {
  key: string;
  label: string;
  href: string;
  description: string;
  count: number;
  /** Null means we do not measure it here — never zero. */
  oldestWaitHours: number | null;
  breachedCount: number | null;
  slaHours: number | null;
}

interface OpsGap {
  label: string;
  reason: string;
}

interface OpsDashboard {
  metrics: OpsMetric[];
  queues: OpsQueue[];
  gaps: OpsGap[];
}

/**
 * Worst first: most breached, then oldest, then largest — the same order
 * `QueueList`'s `byBreach` uses, kept local rather than imported because that
 * one takes `QueueItem`'s `breachedCount?: number` and this screen's own
 * `OpsQueue` is typed `number | null` throughout, to match every other
 * "not measured, never zero" field `/api/ops/dashboard` sends.
 */
function byBreach(a: OpsQueue, b: OpsQueue): number {
  const known = (q: OpsQueue): number => (q.breachedCount === null ? 1 : 0);
  if (known(a) !== known(b)) return known(a) - known(b);
  const breach = (b.breachedCount ?? 0) - (a.breachedCount ?? 0);
  if (breach !== 0) return breach;
  const wait = (b.oldestWaitHours ?? 0) - (a.oldestWaitHours ?? 0);
  if (wait !== 0) return wait;
  return b.count - a.count;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "1 Oct 2026, 11:27 am" — the render instant, not a server timestamp. */
function formatAsOf(d: Date): string {
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?(AM|PM)/i, (m) => m.toLowerCase());
  return `${date}, ${time}`;
}

/**
 * The table's short link text, for the four queues this product currently
 * raises. Falls back to the queue's own label so a new queue the server starts
 * sending is never a dead button.
 */
const OPEN_LABEL: Readonly<Record<string, string>> = {
  'onboarding-vendor': 'Open KYC queue',
  'onboarding-buyer': 'Open KYC queue',
  'grade-corrections': 'Open corrections',
};
const openLabel = (q: OpsQueue): string => OPEN_LABEL[q.key] ?? `Open ${q.label}`;

/** One sentence, built from the numbers rather than written per queue. */
function headline(q: OpsQueue): string {
  if (q.breachedCount === null || q.breachedCount === 0) {
    return `${q.count} ${plural(q.count, 'item is', 'items are')} waiting, with no promise to measure ${q.count === 1 ? 'it' : 'them'} against.`;
  }
  if (q.breachedCount === q.count) {
    return 'Every waiting item is past our promise.';
  }
  return `${q.breachedCount} of ${q.count} waiting items are past our promise.`;
}

/**
 * The table's "how late" bar, normalised against the worst queue in the set —
 * not against an absolute scale, which would make one chronically slow queue
 * fill every bar and say nothing. A queue with no promise gets no multiple at
 * all, never a borrowed one.
 */
function multipleOf(q: OpsQueue): number | null {
  if (q.oldestWaitHours === null || q.slaHours === null || q.slaHours <= 0) return null;
  return q.oldestWaitHours / q.slaHours;
}

function RiskCard({ queue }: { queue: OpsQueue }): React.JSX.Element {
  const big = queue.breachedCount ?? queue.count;
  const unit =
    queue.breachedCount === null
      ? plural(queue.count, 'item waiting', 'items waiting')
      : `of ${queue.count} past promise`;
  return (
    <article className="ov-risk">
      <span className="ov-risk__label">{queue.label}</span>
      <div className="ov-risk__big">
        <span className="ov-risk__n font-mono tnum">{big}</span>
        <span className="ov-risk__unit">{unit}</span>
      </div>
      <h3 className="ov-risk__title">{headline(queue)}</h3>
      <p className="ov-risk__body">{queue.description}</p>
      <div className="ov-risk__foot">
        <span>
          {queue.oldestWaitHours === null ? 'Oldest not measured' : `Oldest: ${queue.oldestWaitHours} h`}
        </span>
        <Link to={queue.href}>{openLabel(queue)} →</Link>
      </div>
    </article>
  );
}

function QueueRow({ queue, maxMultiple }: { queue: OpsQueue; maxMultiple: number }): React.JSX.Element {
  const multiple = multipleOf(queue);
  const days = queue.oldestWaitHours === null ? null : Math.floor(queue.oldestWaitHours / 24);
  return (
    <tr>
      <td>
        <div className="ov-q__name">{queue.label}</div>
        <div className="ov-q__desc">{queue.description}</div>
      </td>
      <td className="num">
        <div className="ov-count">{queue.count}</div>
        {queue.breachedCount !== null && queue.breachedCount > 0 ? (
          <div className="ov-late">{queue.breachedCount} past promise</div>
        ) : null}
      </td>
      <td>
        {queue.oldestWaitHours === null ? (
          <span className="ov-oldest" style={{ color: 'var(--admin-faint)' }}>
            Not measured
          </span>
        ) : (
          <>
            <span className="ov-oldest">
              {days} {plural(days ?? 0, 'day', 'days')}
            </span>
            <div className="ov-oldest-h">{queue.oldestWaitHours} h</div>
          </>
        )}
      </td>
      <td>
        {queue.slaHours === null ? (
          <span className="ov-none">No deadline set</span>
        ) : (
          <span className="ov-promise">{queue.slaHours} h</span>
        )}
      </td>
      <td>
        {multiple === null ? (
          <div className="ov-over">
            <span className="ov-over__txt ov-over__txt--na">Can&rsquo;t tell without a deadline</span>
          </div>
        ) : (
          <div className="ov-over">
            <span className="ov-over__bar">
              <span style={{ width: `${Math.max(4, Math.min(100, (multiple / maxMultiple) * 100))}%` }} />
            </span>
            <span className="ov-over__txt">about {Math.round(multiple)}× our promise</span>
          </div>
        )}
      </td>
      <td className="num">
        <Link to={queue.href} className="ov-go">
          {openLabel(queue)} →
        </Link>
      </td>
    </tr>
  );
}

function SysItem({ metric }: { metric: OpsMetric }): React.JSX.Element {
  const name = metric.href ? <Link to={metric.href}>{metric.label}</Link> : metric.label;
  return (
    <div className="ov-sys__item">
      <div className="ov-sys__top">
        <span className="ov-sys__name">{name}</span>
        {metric.value === null ? (
          <span className="ov-sys__val" style={{ color: 'var(--admin-faint)' }}>
            Not measured
          </span>
        ) : (
          <span className="ov-sys__val">
            {metric.value}
            <small>{metric.unit}</small>
          </span>
        )}
      </div>
      <p className="ov-sys__note">{metric.hint}</p>
    </div>
  );
}

/**
 * The one guard in this console that is not a permission.
 *
 * `RequirePermission` takes exactly one, and this screen has none: every
 * section of it is gated on a different permission by the server, and there is
 * no string that means "you work here". Gating the whole route on any one of
 * them — `identity.audit.read` was the tempting choice — would hide the screen
 * from a QC_MANAGER and a FINANCE who each have a real slice on it, which is
 * the opposite of §3C.1's "others see their slice".
 *
 * So the route asks the only question that actually applies, and the server
 * asks it again in `OpsController.requirePlatform` — a client-side check is a
 * convenience, never the boundary.
 */
export function RequirePlatform({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { principal, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="p-6 text-ink-2">Checking your session…</div>;
  // Same two doors as `RequirePermission`: no session goes to the front door,
  // a session that still owes a factor goes to the one screen that can ask.
  if (!principal) return <Navigate to="/" state={{ from: location.pathname }} replace />;
  if (principal.mfaRequired) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (principal.orgType !== 'PLATFORM') {
    return (
      <div className="mx-auto max-w-container p-6">
        <h1 className="text-h2 text-ink">This is the platform’s own workspace</h1>
        <p className="mt-3 text-body text-ink-2">
          Your own is on your dashboard. Nothing was changed.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function OpsOverviewRoute(): React.JSX.Element {
  const { data, error } = useResource<OpsDashboard>(
    '/api/ops/dashboard',
    'The overview is unavailable',
  );

  if (error) {
    return (
      <EmptyState
        title="The overview did not load"
        body={`${error}. Nothing has been changed — reload to try again, or go straight to the review queue.`}
      />
    );
  }

  if (!data) {
    return (
      <div className="overview-board">
        <div className="ov-head">
          <div>
            <h1 className="ov-title">Operations overview</h1>
            <p className="ov-sub">Loading what needs somebody today.</p>
          </div>
        </div>
        <div className="ov-risks">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="ov-risk">
              <Skeleton lines={4} />
            </div>
          ))}
        </div>
        <div className="ov-card">
          <div style={{ padding: 20 }}>
            <Skeleton lines={5} />
          </div>
        </div>
      </div>
    );
  }

  const orderedQueues = [...data.queues].sort(byBreach);
  const riskQueues = orderedQueues.filter((q) => (q.breachedCount ?? 0) > 0).slice(0, 3);
  const overdueCount = data.queues.filter((q) => (q.breachedCount ?? 0) > 0).length;
  const multiples = data.queues.map(multipleOf).filter((n): n is number => n !== null);
  const maxMultiple = Math.max(1, ...multiples);

  return (
    <div className="overview-board">
      <div className="ov-head">
        <div>
          <h1 className="ov-title">Operations overview</h1>
          <p className="ov-sub">
            What&rsquo;s late, stuck or unmeasured across the platform · as of{' '}
            {formatAsOf(new Date())}
          </p>
        </div>
        {(riskQueues.length > 0 || overdueCount > 0 || data.gaps.length > 0) && (
          <div className="ov-health">
            {riskQueues.length > 0 && (
              <span className="ov-tag ov-tag--bad">
                {riskQueues.length} critical
              </span>
            )}
            {overdueCount > 0 && (
              <span className="ov-tag ov-tag--warn">
                {overdueCount} {plural(overdueCount, 'queue', 'queues')} overdue
              </span>
            )}
            {data.gaps.length > 0 && (
              <span className="ov-tag ov-tag--grey">{data.gaps.length} not measured</span>
            )}
          </div>
        )}
      </div>

      {riskQueues.length > 0 && (
        <section aria-labelledby="ov-r-h">
          <div className="ov-sec-h">
            <h2 id="ov-r-h">Fix these first</h2>
            <p>Each one costs money or trust every day it waits.</p>
          </div>
          <div className="ov-risks">
            {riskQueues.map((q) => (
              <RiskCard key={q.key} queue={q} />
            ))}
          </div>
        </section>
      )}

      {data.queues.length > 0 ? (
        <section aria-labelledby="ov-q-h">
          <div className="ov-sec-h">
            <h2 id="ov-q-h">Work that&rsquo;s waiting</h2>
            <p>Sorted by how far past our promise the oldest item is. Queues with no deadline come last.</p>
          </div>
          <div className="ov-card">
            <div className="ov-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Queue</th>
                    <th scope="col" className="num">
                      Waiting
                    </th>
                    <th scope="col">Oldest</th>
                    <th scope="col">Our promise</th>
                    <th scope="col">How late</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orderedQueues.map((q) => (
                    <QueueRow key={q.key} queue={q} maxMultiple={maxMultiple} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : (
        <EmptyState
          title="No queues in your slice"
          body="Every queue on this screen is gated on the permission of the board behind it, and your account holds none of them. That is a role question, not an empty day — the numbers in System health are the part that is yours. Ask an administrator which section you should be in."
        />
      )}

      {(data.metrics.length > 0 || data.gaps.length > 0) && (
        <div className="ov-split">
          {data.metrics.length > 0 && (
            <section className="ov-panel" aria-labelledby="ov-s-h">
              <h2 id="ov-s-h">System health</h2>
              <p>Things that break quietly if nobody watches them.</p>
              <div className="ov-sys">
                {data.metrics.map((m) => (
                  <SysItem key={m.key} metric={m} />
                ))}
              </div>
            </section>
          )}

          {data.gaps.length > 0 && (
            <section className="ov-panel" aria-labelledby="ov-b-h">
              <h2 id="ov-b-h">Not measured yet</h2>
              <p>
                Exceptions the operations spec asks for that nothing in this product can measure
                yet. Named rather than shown as zero, because a zero here would read as &ldquo;all
                fine&rdquo;.
              </p>
              <div className="ov-blind">
                {data.gaps.map((gap) => (
                  <div key={gap.label} className="ov-blind__item">
                    <span className="ov-blind__name">{gap.label}</span>
                    <span className="ov-blind__why">{gap.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
