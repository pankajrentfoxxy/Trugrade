import * as React from 'react';
import {
  EmptyState,
  KpiRow,
  QueueList,
  Skeleton,
  type Kpi,
  type QueueItem,
} from '@trugrade/ui';
import { Navigate, useLocation } from 'react-router';
import { PageHeader, Section } from '../lib/controls';
import { useAuth } from '../lib/auth';
import { useResource } from '../lib/useResource';

/**
 * ARCHETYPE E — Workspace. A KPI row, then queues ordered by SLA breach.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * The day's exceptions, and nothing else (03_UX_SPEC.md §3C.1).
 *
 * **Every number on this screen came out of a row.** That is the whole risk of
 * this archetype: a KPI row has slots, slots want filling, and this build has
 * already had to strip `98% of 412 units inspected` off a homepage with zero
 * units on it. So the server sends exactly the metrics it can source, this file
 * renders exactly what it is sent, and there is no placeholder, no target and no
 * "—" anywhere. Four tiles §3C.1 asks for have no source in this product at all;
 * they are printed at the bottom **by name, with the reason**, because a
 * dashboard that silently omits a risk is worse than one that admits it.
 *
 * **The queues are the screen, not the tiles.** `QueueList` does the worst-first
 * ordering itself, so this file never sorts. And a queue is here only if a board
 * answers it — purchase orders, order approvals, payables and tickets are counts
 * on the KPI row instead, because T26's ledger entry settled that a number with
 * no board beats a link to the wrong one, and their boards are T39's.
 *
 * **You see your slice.** The server assembles the payload from the permissions
 * the caller actually holds — a KYC_REVIEWER gets the two application queues and
 * no purchase orders — so an empty section here means "not yours", not "none".
 */

interface OpsMetric {
  key: string;
  label: string;
  /** Null means we could not measure it. `KpiRow` prints "Not measured". */
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
 * A count is a count, never a percentage.
 *
 * `KpiPercentage` would demand a denominator, which is exactly why none of these
 * is typed as one: "15 of 18 applications" is a count with its own denominator
 * written into the unit, and turning it into "83%" would be a claim the ops
 * manager cannot act on.
 */
const toKpi = (m: OpsMetric): Kpi => ({
  key: m.key,
  label: m.label,
  value: m.value,
  unit: m.unit,
  hint: m.hint,
  // Dropped rather than defaulted: `exactOptionalPropertyTypes` forbids
  // assigning undefined, and a `href: ''` would render a link to this page.
  ...(m.href === null ? {} : { href: m.href }),
});

/**
 * The server's queue numbers, as `QueueItem` wants them.
 *
 * Every one of `oldestWaitHours`, `breachedCount` and `slaHours` is **dropped
 * rather than defaulted** when the API sends null. `QueueItem` treats an absent
 * field as "not measured" and renders it as such; supplying `0` instead would
 * print "Within SLA" under a queue nobody has ever timed, and "0 past SLA"
 * against a promise nobody made.
 */
const toQueue = (q: OpsQueue): QueueItem => ({
  key: q.key,
  label: q.label,
  href: q.href,
  description: q.description,
  count: q.count,
  ...(q.oldestWaitHours === null ? {} : { oldestWaitHours: q.oldestWaitHours }),
  ...(q.breachedCount === null ? {} : { breachedCount: q.breachedCount }),
  ...(q.slaHours === null ? {} : { slaHours: q.slaHours }),
});

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
  if (!principal || principal.mfaRequired) {
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
      <div className="tg-stack">
        <PageHeader title="Today">Loading what needs somebody today.</PageHeader>
        {/* Skeletons that keep the box, so nothing jumps when the numbers land. */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="tg-card rounded-lg border border-rule bg-sheet">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="tg-card rounded-lg border border-rule bg-sheet">
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const breached = data.queues.reduce((n, q) => n + (q.breachedCount ?? 0), 0);
  const unmeasured = data.queues.filter((q) => q.breachedCount === null).length;

  return (
    <div className="tg-stack">
      <PageHeader title="Today">
        {breached > 0 ? (
          <>
            {/* Ours, in our own words. "Breaching applications" would read as a
                fact about the applicants; they submitted and waited. */}
            We are past a promise we made on{' '}
            <span className="font-mono tnum text-ink">{breached}</span>{' '}
            {breached === 1 ? 'item' : 'items'}.
          </>
        ) : (
          'Nothing here is past a promise we made.'
        )}{' '}
        {unmeasured > 0 && (
          <>
            {/* Said out loud rather than left to the queue rows: a workspace
                that looks green because half of it is untimed is the same
                defect as a missing value rendering as a passing one. */}
            <span className="font-mono tnum text-ink">{unmeasured}</span> of the{' '}
            <span className="font-mono tnum text-ink">{data.queues.length}</span> queues below{' '}
            {unmeasured === 1 ? 'carries' : 'carry'} no promise at all, so nothing in{' '}
            {unmeasured === 1 ? 'it' : 'them'} can be shown as late.
          </>
        )}
      </PageHeader>

      {data.metrics.length > 0 && <KpiRow label="Today" items={data.metrics.map(toKpi)} />}

      {data.queues.length > 0 ? (
        <QueueList label="What is stuck" items={data.queues.map(toQueue)} />
      ) : (
        <EmptyState
          title="No queues in your slice"
          body="Every queue on this screen is gated on the permission of the board behind it, and your account holds none of them. That is a role question, not an empty day — the numbers above are the part that is yours. Ask an administrator which section you should be in."
        />
      )}

      {data.gaps.length > 0 && (
        <Section
          title="Not on this screen, and why"
          subtitle="Exceptions the operations spec asks for that nothing in this product can measure yet. Named rather than shown as zero, because a zero here would read as “nothing is wrong”."
        >
          <dl className="flex flex-col gap-4">
            {data.gaps.map((gap) => (
              <div key={gap.label} className="border-b border-rule-2 pb-4 last:border-b-0 last:pb-0">
                <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                  {gap.label}
                </dt>
                <dd className="mt-1 max-w-prose text-body-sm text-ink-2">{gap.reason}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}
    </div>
  );
}
