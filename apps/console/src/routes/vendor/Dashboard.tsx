import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, KpiRow, Skeleton, Stepper, type Kpi } from '@trugrade/ui';
import { PageHeader } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, NO_DATE, onDate, rupees, type DashboardTiles } from './api';

/**
 * ARCHETYPE E — Workspace. A KPI row, then the work it drills into.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * The vendor's landing screen: what needs them today.
 *
 * Every tile is a link to a filtered board, and there is no tile that is not.
 * A number nobody can act on is a vanity metric, and the fastest way to make a
 * dashboard ignored is to fill it with them.
 *
 * There is no revenue figure and no retail price here, for the same reason there
 * is none in the wizard: what the vendor is owed is theirs, what we sell for is
 * not their business per unit.
 */

/** The three-step guide a vendor with no stock reads instead of a grid of zeroes. */
const FIRST_RUN = [
  'Pick the machine from our catalog and declare its condition. Four steps, and a paste of serial numbers does fifty at once.',
  'We inspect at your site. Nothing goes on sale before it has been inspected and sealed.',
  'Machines that pass go live. You are paid after delivery and after the buyer’s inspection window closes.',
] as const;

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
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="tg-card rounded-lg border border-rule bg-sheet">
              <Skeleton lines={3} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const nothingYet =
    data.unitsAwaitingQc === 0 && data.unitsLive === 0 && data.unitsSoldThisMonth === 0;

  if (nothingYet) {
    // First run is a three-step guide, not an empty grid of zeroes. A new vendor
    // reading "0 live" learns nothing about what to do next.
    return (
      <div className="tg-stack">
        <PageHeader title="List your first stock">
          Three steps from a machine on your shelf to a machine a buyer can order.
        </PageHeader>
        <Stepper
          label="Getting started"
          steps={FIRST_RUN.map((summary, i) => ({
            key: String(i),
            label: ['Declare it', 'We inspect it', 'It goes live'][i] ?? '',
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
   * `href` on every tile: a metric with no board behind it is decoration, and
   * `KpiRow` renders the label as the link so the whole `<dl>` stays valid.
   *
   * A count is a count, never a percentage — `KpiPercentage` would demand a
   * denominator, which is exactly why none of these is typed as one.
   */
  const kpis: Kpi[] = [
    {
      key: 'awaiting',
      label: 'Awaiting inspection',
      value: data.unitsAwaitingQc,
      unit: data.unitsAwaitingQc === 1 ? 'machine' : 'machines',
      href: '/vendor/listings?status=AWAITING_QC',
      hint: 'Not visible to any buyer until inspected.',
    },
    {
      key: 'live',
      label: 'Live',
      value: data.unitsLive,
      unit: data.unitsLive === 1 ? 'machine' : 'machines',
      href: '/vendor/listings?status=ACTIVE',
    },
    {
      key: 'sold',
      label: 'Sold this month',
      value: data.unitsSoldThisMonth,
      unit: data.unitsSoldThisMonth === 1 ? 'machine' : 'machines',
      href: '/vendor/listings?status=OUT_OF_STOCK',
    },
    {
      key: 'expiring',
      label: 'Inspection expiring',
      value: data.unitsQcExpiring14d,
      unit: 'within 14 days',
      href: '/vendor/listings?expiring=14',
      hint: 'At zero days they stop being sellable — automatically.',
    },
    {
      key: 'payout',
      label: 'Payout due',
      value: rupees(data.payoutsDue),
      href: '/vendor/payables',
      hint:
        data.payoutsDueOn && onDate(data.payoutsDueOn) !== NO_DATE
          ? `Expected ${onDate(data.payoutsDueOn)}.`
          : // Not a guessed date. The payout cycle decides it and this screen
            // does not know the cycle.
            'No date yet — your payout cycle sets it.',
    },
    {
      key: 'corrections',
      label: 'Grade corrections open',
      value: data.openGradeCorrections,
      unit: data.openGradeCorrections === 1 ? 'correction' : 'corrections',
      href: '/vendor/qc/corrections',
      hint: 'Each has a response window. No answer applies the default.',
    },
  ];

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
        Every number here is a link to the machines behind it.
      </PageHeader>

      <KpiRow label="Your stock right now" items={kpis} />
    </div>
  );
}
