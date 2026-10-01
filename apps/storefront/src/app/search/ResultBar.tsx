'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { SORTS } from './sorts';

/**
 * The head of the results: a title with what is showing, then a row of sort
 * tabs and the grid / list switch.
 *
 * Laid out to the supplied design — "Refurbished laptops · Showing 1–12 of 12
 * models · 212 sealed units", then "Sort by" and the orders as tabs. The design
 * also listed Popularity, Discount and Newest first; the search has no data
 * behind any of them (no order history, no real MRP, no listing date on a
 * result), so the tabs are the orders it can actually keep: price both ways,
 * inspection score, battery health, fastest dispatch and most stock.
 *
 * Every number here comes from the response: the page and page size the API
 * answered with, the model count and the unit count. The sort and the view
 * live in the URL, so a sorted grid is a link a colleague can open.
 */
export interface ResultBarProps {
  query: string;
  /** Sealed units across every match — null when the API did not say. */
  units: number | null;
  models: number;
  /** The page the API answered with, and its size, for "Showing 1–12". */
  page: number;
  per: number;
  sort: string;
  view: 'grid' | 'list';
}

const COUNT = new Intl.NumberFormat('en-IN');

export function ResultBar({
  query,
  units,
  models,
  page,
  per,
  sort,
  view,
}: ResultBarProps): React.JSX.Element {
  const router = useRouter();

  const go = (key: string, value: string): void => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    // Sorting a board does not move you to page 1 of the old order.
    next.delete('page');
    const qs = next.toString();
    router.push(`/search${qs ? `?${qs}` : ''}` as Route, { scroll: false });
  };

  const first = models === 0 ? 0 : (page - 1) * per + 1;
  const last = Math.min(page * per, models);

  return (
    <div className="rbar">
      <div className="rbar-head">
        <h1>Refurbished laptops</h1>
        <p className="cnt">
          {models === 0 ? (
            'No models match'
          ) : (
            <>
              Showing{' '}
              <span className="mono">
                {COUNT.format(first)}–{COUNT.format(last)}
              </span>{' '}
              of <span className="mono">{COUNT.format(models)}</span> model{models === 1 ? '' : 's'}
            </>
          )}{' '}
          {units !== null ? (
            <>
              · <span className="mono">{COUNT.format(units)}</span> sealed unit
              {units === 1 ? '' : 's'}
            </>
          ) : null}
        </p>
      </div>

      <div className="rbar-row">
        <span className="rbar-label" id="rbar-sort">
          Sort by
        </span>
        <div className="rbar-sorts" role="group" aria-labelledby="rbar-sort">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={sort === s.value ? 'on' : undefined}
              aria-pressed={sort === s.value}
              onClick={() => go('sort', s.value === 'price' ? '' : s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="vtog" role="group" aria-label="Result layout">
          {(['grid', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'on' : undefined}
              aria-pressed={view === v}
              aria-label={v === 'grid' ? 'Grid' : 'List'}
              title={v === 'grid' ? 'Grid' : 'List'}
              onClick={() => go('view', v === 'grid' ? '' : v)}
            >
              {v === 'grid' ? <GridIcon /> : <ListIcon />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const ICON = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function GridIcon(): React.JSX.Element {
  return (
    <svg {...ICON}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </svg>
  );
}

function ListIcon(): React.JSX.Element {
  return (
    <svg {...ICON}>
      <rect x="4" y="4.5" width="4" height="4" rx="1" />
      <rect x="4" y="13.5" width="4" height="4" rx="1" />
      <path d="M11.5 5.5h8.5M11.5 8h5M11.5 14.5h8.5M11.5 17h5" />
    </svg>
  );
}
