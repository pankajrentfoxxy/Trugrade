'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Pagination } from '@trugrade/ui';

/**
 * Server-paginated, and the page number is in the URL like every other piece of
 * board state. `hrefFor` gives every page a real address a colleague can be
 * sent; `onPage` intercepts the click so the same address is reached without a
 * full document load.
 *
 * The per-page control lives here rather than in the result bar so the bar
 * keeps one job — what matched and how it is ordered.
 */
const PER_PAGE = [4, 12, 24, 48] as const;

export function Pager({
  query,
  page,
  pages,
  per,
  shown,
  models,
}: {
  query: string;
  page: number;
  pages: number;
  per: number;
  /** Models on this page, and the total behind the filters. */
  shown: number;
  models: number;
}): React.JSX.Element {
  const router = useRouter();

  const href = (key: string, value: string): Route => {
    const next = new URLSearchParams(query);
    next.set(key, value);
    if (key === 'per') next.delete('page');
    // Built at runtime, so `typedRoutes` cannot check it; asserted once, here.
    return `/search?${next.toString()}` as Route;
  };

  return (
    <div className="pager">
      {/* `Pagination` renders nothing for a single page — one page is not a
          pagination. The count takes its place so the bar is never an empty
          box, and it is a fact rather than filler. */}
      {pages <= 1 ? (
        <p className="shown">
          Showing {shown === 1 ? 'the only' : 'all'} <b className="mono">{shown}</b> model
          {shown === 1 ? ' that matches' : 's that match'}
        </p>
      ) : (
        <p className="shown">
          Page <b className="mono">{page}</b> of <b className="mono">{pages}</b> ·{' '}
          <b className="mono">{models}</b> models
        </p>
      )}
      <Pagination
        page={page}
        pageCount={pages}
        hrefFor={(target) => href('page', String(target))}
        onPage={(target) => router.push(href('page', String(target)))}
        label="Search results pages"
      />
      <div className="perpage">
        <label htmlFor="per">Per page</label>
        <select
          id="per"
          value={String(per)}
          onChange={(e) => router.push(href('per', e.target.value), { scroll: false })}
        >
          {PER_PAGE.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
