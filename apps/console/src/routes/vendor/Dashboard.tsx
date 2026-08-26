import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, Skeleton } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { API, onDate, rupees, type DashboardTiles } from './api';

/**
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

interface Tile {
  label: string;
  value: string;
  to: string;
  /** Why this number matters, in the words the vendor would use. Never a tooltip. */
  note?: string;
  /** Draws the eye only when the number is a problem. Zero is usually good news. */
  urgent?: boolean;
}

function TileCard({ tile }: { tile: Tile }): React.JSX.Element {
  return (
    <Link
      to={tile.to}
      className={[
        'flex flex-col gap-2 rounded-lg border p-5 transition-colors hover:bg-sheet-2',
        tile.urgent ? 'border-warn bg-sheet' : 'border-rule bg-sheet',
      ].join(' ')}
    >
      <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
        {tile.label}
      </span>
      <span className="font-mono text-h1 tnum text-ink">{tile.value}</span>
      {tile.note && <span className="text-body-sm text-ink-2">{tile.note}</span>}
    </Link>
  );
}

export function VendorDashboardRoute(): React.JSX.Element {
  const { data, error } = useResource<DashboardTiles>(API.dashboard, 'Your dashboard is unavailable');

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
      <div>
        <h1 className="text-h1 text-ink">Today</h1>
        {/* Skeletons that keep the box, so the grid does not jump when it lands. */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-lg border border-rule bg-sheet p-5">
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
      <div>
        <h1 className="text-h1 text-ink">List your first stock</h1>
        <ol className="mt-6 flex max-w-prose flex-col gap-4">
          {[
            'Pick the machine from our catalog and declare its condition. Four steps, and a paste of serial numbers does fifty at once.',
            'We inspect at your site. Nothing goes on sale before it has been inspected and sealed.',
            'Machines that pass go live. You are paid after delivery and after the buyer’s inspection window closes.',
          ].map((text, i) => (
            <li key={text} className="flex gap-4 rounded-lg border border-rule bg-sheet p-5">
              <span className="font-mono text-h3 tnum text-acc-ink">{i + 1}</span>
              <span className="text-body-sm text-ink-2">{text}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6">
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
            Start the first listing
          </Link>
        </p>
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      label: 'Awaiting inspection',
      value: String(data.unitsAwaitingQc),
      to: '/vendor/listings?status=AWAITING_QC',
      note: 'Not visible to any buyer until inspected.',
    },
    {
      label: 'Live',
      value: String(data.unitsLive),
      to: '/vendor/listings?status=ACTIVE',
    },
    {
      label: 'Sold this month',
      value: String(data.unitsSoldThisMonth),
      to: '/vendor/listings?status=OUT_OF_STOCK',
    },
    {
      label: 'Inspection expiring',
      value: String(data.unitsQcExpiring14d),
      to: '/vendor/listings?expiring=14',
      note: 'Within 14 days. At zero days they stop being sellable — automatically.',
      urgent: data.unitsQcExpiring14d > 0,
    },
    {
      label: 'Payout due',
      value: rupees(data.payoutsDue),
      to: '/vendor/payables',
      note: data.payoutsDueOn ? `Expected ${onDate(data.payoutsDueOn)}.` : undefined,
    },
    {
      label: 'Grade corrections open',
      value: String(data.openGradeCorrections),
      to: '/vendor/qc/corrections',
      note: 'Each has a response window. No answer applies the default.',
      urgent: data.openGradeCorrections > 0,
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1 text-ink">Today</h1>
        <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings/new">
          List stock
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <TileCard key={t.label} tile={t} />
        ))}
      </div>
    </div>
  );
}
