'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { SORTS } from './sorts';

export type ResultBarBasePath = '/' | '/search';

/**
 * Block 4b — the result bar. Match count, sort, and the grid/list toggle.
 *
 * Sort and view are URL state like every facet, so this pushes the router
 * rather than holding state: a colleague opening the link gets the same
 * ordering in the same view, which is the whole point of §6's URL rule.
 */
export interface ResultBarProps {
  query: string;
  /** Sellable units behind the results — the number a buyer can actually buy. */
  total: number;
  models: number;
  pincode: string | null;
  sort: string;
  view: 'grid' | 'list';
  /** Where sort/view updates navigate. Default `/search`. */
  basePath?: ResultBarBasePath;
  /** Home uses "inspected laptops"; search uses the sealed-units match line. */
  variant?: 'search' | 'home';
  /** Hide grid/list toggle — home shows grid only. */
  showViewToggle?: boolean;
}

export function ResultBar({
  query,
  total,
  models,
  pincode,
  sort,
  view,
  basePath = '/search',
  variant = 'search',
  showViewToggle = true,
}: ResultBarProps): React.JSX.Element {
  const router = useRouter();

  const go = (key: string, value: string): void => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    // Sorting a board does not move you to page 1 of the old order.
    next.delete('page');
    const qs = next.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ''}` as Route, { scroll: false });
  };

  return (
    <div className="rbar">
      {variant === 'home' ? (
        <span>
          <b className="mono">{total.toLocaleString('en-IN')}</b> inspected laptops
        </span>
      ) : (
        <span className="cnt">
          <b className="mono">{total.toLocaleString('en-IN')}</b> sealed unit{total === 1 ? '' : 's'}{' '}
          match &middot; <b className="mono">{models.toLocaleString('en-IN')}</b> model
          {models === 1 ? '' : 's'}
          {pincode === null ? (
            <>
              {' '}
              &middot; <span className="ink4">add a pincode for landed prices</span>
            </>
          ) : (
            <>
              {' '}
              &middot; landed to <b className="mono">{pincode}</b>
            </>
          )}
        </span>
      )}
      <div className="r">
        <label htmlFor="srt">Sort</label>
        <select id="srt" value={sort} onChange={(e) => go('sort', e.target.value)}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {showViewToggle ? (
          <div className="vtog" role="group" aria-label="Result layout">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? 'on' : undefined}
                aria-pressed={view === v}
                onClick={() => go('view', v === 'grid' ? '' : v)}
              >
                {v === 'grid' ? 'Grid' : 'List'}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
