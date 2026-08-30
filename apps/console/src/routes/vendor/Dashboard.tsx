import * as React from 'react';
import { Link } from 'react-router';
import {
  EmptyState,
  KpiRow,
  QueueList,
  Skeleton,
  Stepper,
  type Kpi,
  type QueueItem,
} from '@trugrade/ui';
import { PageHeader } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, NO_DATE, onDate, rupees, type DashboardTiles, type VendorQueue } from './api';

/**
 * ARCHETYPE E — Workspace. A KPI row, then queues ordered by SLA breach.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * The vendor's landing screen: what needs them today.
 *
 * **The queues are the screen, not the tiles.** The first pass of this route was
 * a KPI row and nothing else, which is archetype B's furniture wearing E's name:
 * six counts, no ordering, no promise, nothing saying which to open first. A
 * workspace ranks the work. `QueueList` does that ordering itself — worst first
 * — so this file never sorts.
 *
 * **What is not here, and why.** There is no revenue figure and no retail price,
 * for the same reason there is none in the wizard: what the vendor is owed is
 * theirs, what we sell it for is not their business per unit. There is no
 * scorecard or tier tile, which `03_UX_SPEC.md` §3B.2 asks for, because nothing
 * computes one — `qc.internal.vendor-quality` has no route and no screen. There
 * is no "POs to fulfil today" tile for the same reason: `procurement` has zero
 * internals and zero routes, so a PO exists in the database and nowhere a vendor
 * can reach it. Four honest tiles beat seven with three invented.
 *
 * **A tile links only where a board actually answers it.** Three of the six
 * links on the first pass did not: `/vendor/payables` and `/vendor/qc/corrections`
 * are routes that do not exist, and `?expiring=14` is a parameter the listings
 * board silently ignores — it would have shown the vendor their whole catalogue
 * under the heading "expiring within 14 days". A number with no board beats a
 * link to the wrong one.
 */

/** The three-step guide a vendor with no stock reads instead of a grid of zeroes. */
const FIRST_RUN = [
  'Pick the machine from our catalog and declare its condition. Four steps, and a paste of serial numbers does fifty at once.',
  'We inspect at your site. Nothing goes on sale before it has been inspected and sealed.',
  'Machines that pass go live. You are paid after delivery and after the buyer’s inspection window closes.',
] as const;

const FIRST_RUN_LABELS = ['Declare it', 'We inspect it', 'It goes live'] as const;

/**
 * The server's queue numbers, as `QueueList` wants them.
 *
 * Every one of `oldestWaitHours`, `breachedCount` and `slaHours` is dropped
 * rather than defaulted when the API sends `null`. `QueueItem` treats an absent
 * field as "not measured" and renders it as such; supplying `0` instead would
 * print "Within SLA" under a queue nobody has ever timed, and "0 past SLA"
 * against a promise nobody made. `exactOptionalPropertyTypes` is what forces the
 * spread here rather than letting `undefined` be assigned.
 */
function toQueue(
  key: string,
  label: string,
  href: string,
  description: React.ReactNode,
  q: VendorQueue,
): QueueItem {
  return {
    key,
    label,
    href,
    description,
    count: q.count,
    ...(q.oldestWaitHours === null ? {} : { oldestWaitHours: q.oldestWaitHours }),
    ...(q.breachedCount === null ? {} : { breachedCount: q.breachedCount }),
    ...(q.slaHours === null ? {} : { slaHours: q.slaHours }),
  };
}

export function VendorDashboardRoute(): React.JSX.Element {
  const { data, error } = useResource<DashboardTiles>(
    API.dashboard,
    'Your dashboard is unavailable',
  );

  if (error) {
    return (
      <EmptyState
        title="Your dashboard did not load"
        body={`${error}. Nothing has been changed — reload to try again, or go straight to your listings.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
            Open your listings
          </Link>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="tg-stack">
        <PageHeader title="Today">Loading what needs you.</PageHeader>
        {/* Skeletons that keep the box, so the grid does not jump when it lands. */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="tg-card rounded-lg border border-rule bg-sheet">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="tg-card rounded-lg border border-rule bg-sheet">
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.unitsEverListed === 0) {
    // First run is a three-step guide, not an empty grid of zeroes. A new vendor
    // reading "0 live" learns nothing about what to do next.
    //
    // `unitsEverListed` and not `live + awaiting + sold`: those are all zero for
    // a vendor whose entire first batch failed inspection, and telling them to
    // list their first stock is both wrong and insulting.
    return (
      <div className="tg-stack">
        <PageHeader title="List your first stock">
          Three steps from a machine on your shelf to a machine a buyer can order.
        </PageHeader>
        <Stepper
          label="Getting started"
          steps={FIRST_RUN.map((summary, i) => ({
            key: String(i),
            label: FIRST_RUN_LABELS[i] ?? '',
            status: i === 0 ? 'current' : 'upcoming',
            summary,
          }))}
        />
        <p>
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
            Start the first listing
          </Link>
        </p>
      </div>
    );
  }

  /**
   * A count is a count, never a percentage — `KpiPercentage` would demand a
   * denominator, which is exactly why none of these is typed as one.
   */
  const kpis: Kpi[] = [
    {
      key: 'live',
      label: 'Live',
      value: data.unitsLive,
      unit: data.unitsLive === 1 ? 'machine' : 'machines',
      href: '/vendor/listings?status=ACTIVE',
      hint: 'Inspected, sealed and orderable right now.',
    },
    {
      key: 'sold',
      label: 'Sold this month',
      value: data.unitsSoldThisMonth,
      unit: data.unitsSoldThisMonth === 1 ? 'machine' : 'machines',
      // No link: this counts deliveries, and no board filters by the month a
      // machine was delivered. `?status=OUT_OF_STOCK` was standing in for it and
      // is a different set of listings entirely.
      hint: 'Delivered to a buyer since the 1st.',
    },
    {
      key: 'expiring',
      label: 'Inspection expiring',
      value: data.unitsQcExpiring14d,
      unit: 'within 14 days',
      // No link: the board filters listings by status and grade, and this counts
      // units by `qc_valid_until`. There is no query that reproduces it.
      hint: 'At zero days they stop being sellable — automatically.',
    },
    {
      key: 'payout',
      label: 'Payout due',
      value: rupees(data.payoutsDue),
      // No link: `/vendor/payables` does not exist. The figure is real —
      // `procurement.vendor_payable`, written when we raise the purchase order —
      // but the statement screen behind it is not built.
      hint:
        data.payoutsDueOn && onDate(data.payoutsDueOn) !== NO_DATE
          ? `Expected ${onDate(data.payoutsDueOn)}.`
          : // Not a guessed date. The payout cycle decides it and this screen
            // does not know the cycle.
            'No date yet — your payout cycle sets it.',
    },
  ];

  /**
   * Two queues, and only two, because two are all that have a vendor waiting at
   * the end of them.
   *
   * One carries a real promise and one carries none, and that asymmetry is the
   * point: `qc.grade_correction_auto_days` is configured, so the corrections
   * queue prints its SLA and its breaches; nothing commits us to an inspection
   * date, so the inspection queue prints neither rather than borrowing a 24 or a
   * 48 from a queue that does have one.
   */
  const queues: QueueItem[] = [
    // `/vendor/corrections`, not `/vendor/listings?corrected=1`. The board of
    // LISTINGS with an open correction is a real board and stays, but until T31
    // it was the only destination and nothing on it could answer anything — a
    // queue titled "awaiting your answer" that landed you somewhere you could not
    // give one. Both read the same predicate (`needsAnswer`), so the count here
    // and the rows there cannot disagree.
    toQueue(
      'corrections',
      'Grade corrections awaiting your answer',
      '/vendor/corrections',
      'When the window closes the corrected grade applies on its own, and reprices the listing.',
      data.queues.gradeCorrections,
    ),
    toQueue(
      'awaiting-qc',
      'Machines awaiting inspection',
      '/vendor/listings?status=AWAITING_QC',
      'Declared but not yet inspected. No buyer can see these.',
      data.queues.awaitingInspection,
    ),
  ].filter((q) => q.count > 0);

  return (
    <div className="tg-stack">
      <PageHeader
        title="Today"
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
            List stock
          </Link>
        }
      >
        Your stock, then what is waiting on you — worst first.
      </PageHeader>

      <KpiRow label="Your stock right now" items={kpis} />

      {queues.length > 0 ? (
        <QueueList label="Waiting on you" items={queues} />
      ) : (
        // Not an empty queue list with two zeroes in it. "Nothing is waiting" is
        // a fact worth one line; two rows reading 0 are furniture.
        <p className="text-body-sm text-ink-2">
          Nothing is waiting on you. No inspections outstanding and no grade corrections open.
        </p>
      )}
    </div>
  );
}
