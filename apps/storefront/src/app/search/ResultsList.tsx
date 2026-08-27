'use client';

import * as React from 'react';
import { DataBoard, GradeBadge, type Column } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import type { SearchResult } from '../../lib/api';

/**
 * List view — the same results as the grid, in the one table component.
 *
 * `DataBoard` is `packages/ui`'s table under the name the backlog uses; row
 * height comes from `data-density` on the app root, not from a prop here.
 * Writing a second table for the storefront is the failure the density rule
 * exists to prevent.
 *
 * Every measurement that is missing renders as "Not measured" in `--ink-4`.
 * Never a zero: a machine whose battery we did not open the report on must not
 * sit in a column reading 0% beside one that genuinely measured 0%.
 */
const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const NOT_MEASURED = <span className="notmeasured">Not measured</span>;

export function ResultsList({
  results,
  sortLabel,
}: {
  results: readonly SearchResult[];
  /** Announced with the count: a sort read off a header arrow is invisible. */
  sortLabel: string;
}): React.JSX.Element {
  /*
   * Seven columns, not ten.
   *
   * Storefront density is comfortable — 20px of padding either side of every
   * cell — so each extra column costs 40px before it holds anything. Ten
   * columns pushed the landed price off the right edge behind a scrollbar,
   * which is the one column nobody should have to go looking for. Dispatch and
   * the supply point moved into the cells they qualify rather than being
   * dropped: they are facts, and a fact is not deleted to make a table fit.
   */
  const columns: ReadonlyArray<Column<SearchResult>> = [
    {
      key: 'model',
      header: 'Model',
      cell: (r) => (
        <span className="lmodel">
          <b>
            {r.brand} {r.model}
          </b>
          <span className="mono">{r.spec}</span>
          <span className="lmeta mono">
            {r.shipHours === null ? (
              <span className="notmeasured">Dispatch time not set</span>
            ) : (
              <>Ships in {r.shipHours} h</>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'grade',
      header: 'Inspected grade',
      cell: (r) => <GradeBadge grade={r.grade as Grade} />,
    },
    {
      key: 'score',
      header: 'Score',
      numeric: true,
      cell: (r) =>
        r.avgQcScore === null ? (
          NOT_MEASURED
        ) : (
          <span className="mono">
            {r.avgQcScore}
            <span className="denom"> / 100</span>
          </span>
        ),
    },
    {
      key: 'battery',
      header: 'Battery health',
      numeric: true,
      // The percentage carries its denominator, always: "88–95% · 8 of 8" is a
      // fact; "88–95%" is a claim about units we may not have opened.
      cell: (r) =>
        r.batteryMeasured === 0 || r.batteryMin === null || r.batteryMax === null ? (
          NOT_MEASURED
        ) : (
          <span className="mono">
            {r.batteryMin === r.batteryMax ? `${r.batteryMin}%` : `${r.batteryMin}–${r.batteryMax}%`}
            <span className="denom">
              {' '}
              · {r.batteryMeasured} of {r.unitsAvailable}
            </span>
          </span>
        ),
    },
    {
      key: 'units',
      header: 'Sealed units',
      numeric: true,
      // A stock count is a fact. It is never dressed as urgency.
      cell: (r) => (
        <span className="lunits mono">
          {r.unitsAvailable}
          <span className="denom">
            {r.supplyPoints} supply point{r.supplyPoints === 1 ? '' : 's'}
          </span>
          <span className="denom">{r.cities.join(', ')}</span>
        </span>
      ),
    },
    {
      key: 'price',
      header: 'From',
      numeric: true,
      cell: (r) => (
        <span className="money">
          ₹{RUPEES.format(r.fromPrice)}
          <small>incl. GST</small>
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Compare',
      headerHidden: true,
      // The canonical product route. It is built in T12; until then this is the
      // one forward link on the screen, and it points where the model will live
      // rather than at an invented substitute.
      cell: (r) => (
        <a className="sel gh" href={`/laptops/${r.skuId}?grade=${r.grade}`}>
          Compare
        </a>
      ),
    },
  ];

  return (
    <div className="tbl lview">
      <DataBoard
        caption={`${results.length} model${results.length === 1 ? '' : 's'} on this page, sorted by ${sortLabel}.`}
        columns={columns}
        rows={results}
        rowKey={(r) => `${r.skuId}-${r.grade}`}
      />
    </div>
  );
}
