'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';
import { Skeleton } from './primitives';

/* ==========================================================================
 * DataTable
 * ======================================================================== */

export type SortDirection = 'asc' | 'desc';

export interface Column<Row> {
  /** Stable id, and the sort key the header button reports back to `onSort`. */
  key: string;
  header: React.ReactNode;
  cell: (row: Row) => React.ReactNode;
  /** Right-aligned tabular figures. Ten prices that do not line up is a toy. */
  numeric?: boolean;
  sortable?: boolean;
  /**
   * An action column still needs a real `<th scope="col">` — an empty header
   * cell leaves the column unnamed for a screen reader. This hides the text
   * visually and keeps it in the accessibility tree.
   */
  headerHidden?: boolean;
}

export interface DataTableProps<Row> {
  /**
   * Read before the table and re-announced whenever it changes, so say what is
   * in it **and** how it is ordered: "12 offers, sorted by landed price, lowest
   * first." A sort a sighted user reads off a header arrow is otherwise
   * invisible, and 03_UX_SPEC.md §1.9.4 requires the count to be announced on
   * every re-sort and re-filter.
   */
  caption: string;
  captionVisible?: boolean;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  sort?: { key: string; direction: SortDirection };
  onSort?: (key: string) => void;
  /** A boolean, never a swapped component — the header stays real while it loads. */
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered in place of the rows when there are none. Pass an `EmptyState`. */
  empty?: React.ReactNode;
  stickyHeader?: boolean;
  className?: string;
  id?: string;
}

const SORT_GLYPH: Record<SortDirection, string> = { asc: '▲', desc: '▼' };

/**
 * The table `apps/console` currently hand-rolls in thirteen places.
 *
 * A real `<table>` with real `<th scope="col">` and a real `<caption>`. The
 * stacked-card rendering below `md` is deliberately **not** done here by
 * overriding `role` on a stack of divs — a faked table reads worse than either
 * honest form — so a caller that needs cards below `md` renders cards below
 * `md`. `OfferGrid` is the worked example.
 *
 * Sort, filter and pagination state stays with the caller: the URL is the source
 * of truth for a console board (03_UX_SPEC.md §2.2) and a component that owns
 * sort state fights the router for it.
 */
export function DataTable<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  loading = false,
  skeletonRows = 5,
  empty,
  stickyHeader = false,
  className,
  id,
}: DataTableProps<Row>): React.JSX.Element {
  const isEmpty = !loading && rows.length === 0;

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      {/* The caption doubles as the live region: re-sorting rewrites it, and a
          polite announcement is the only way the new order reaches a reader who
          cannot see the arrow move. */}
      <div role="status" aria-live="polite" className="sr-only">
        {caption}
      </div>

      <table id={id} className="w-full border-collapse text-body-sm">
        <caption
          className={cn('text-left text-body-sm text-ink-2', captionVisible ? 'pb-3' : 'sr-only')}
        >
          {caption}
        </caption>

        <thead>
          <tr className="border-b border-rule">
            {columns.map((column) => {
              const direction = sort?.key === column.key ? sort.direction : undefined;
              const label = (
                <span className={cn(column.headerHidden && 'sr-only')}>{column.header}</span>
              );
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sortable
                      ? direction === 'asc'
                        ? 'ascending'
                        : direction === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                  className={cn(
                    'tg-cell whitespace-nowrap font-mono text-label uppercase tracking-[0.13em] text-ink-2',
                    column.numeric ? 'text-right' : 'text-left',
                    stickyHeader && 'sticky top-0 z-10 bg-sheet',
                  )}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className="inline-flex min-h-11 items-center gap-2 font-mono text-label uppercase tracking-[0.13em] text-ink-2 hover:text-ink"
                    >
                      {label}
                      <span aria-hidden="true" className={cn(!direction && 'text-ink-3')}>
                        {direction ? SORT_GLYPH[direction] : '↕'}
                      </span>
                    </button>
                  ) : (
                    label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-rule-2">
                {columns.map((column) => (
                  <td key={column.key} className="tg-cell">
                    <Skeleton />
                  </td>
                ))}
              </tr>
            ))}

          {isEmpty && (
            <tr>
              <td colSpan={columns.length} className="tg-cell">
                {empty}
              </td>
            </tr>
          )}

          {!loading &&
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-rule-2 last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'tg-cell align-top text-ink',
                      column.numeric && 'text-right font-mono tnum',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * `DataBoard` is the name the frontend backlog uses for the same component
 * (10_FRONTEND_BACKLOG.md T2: "Tables become the shared `DataBoard`").
 *
 * An alias, not a wrapper. CLAUDE.md: "One DataBoard component, three settings.
 * Writing a second table component means the system has already failed" — and a
 * wrapper that only renames is the first half of a second table.
 */
export { DataTable as DataBoard };

/* ==========================================================================
 * Pagination
 * ======================================================================== */

/**
 * First page, last page, and a run of `radius` either side of the current one.
 * `gap` is where the ellipsis goes.
 *
 * Exported because it is the only part of pagination with a wrong answer, and a
 * unit test on a pure function beats a rendering test on an off-by-one.
 */
export function pageWindow(page: number, pageCount: number, radius = 1): Array<number | 'gap'> {
  if (pageCount <= 1) return pageCount === 1 ? [1] : [];
  const wanted = new Set<number>([1, pageCount]);
  for (let p = page - radius; p <= page + radius; p++) {
    if (p >= 1 && p <= pageCount) wanted.add(p);
  }
  const out: Array<number | 'gap'> = [];
  let previous = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    // A gap of exactly one page is worse than the page itself: "1 … 3" costs the
    // same width as "1 2 3" and hides a destination.
    if (p - previous === 2) out.push(p - 1);
    else if (p - previous > 2) out.push('gap');
    out.push(p);
    previous = p;
  }
  return out;
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPage?: (page: number) => void;
  /**
   * Render real links. Search-result pages are indexed and a crawler does not
   * click buttons; when both are given the href is the markup and `onPage` is
   * the client-side intercept.
   */
  hrefFor?: (page: number) => string;
  label?: string;
  className?: string;
}

const PAGE_BOX = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-3 text-body-sm';
const PAGE_IDLE = 'border-rule text-ink hover:bg-sheet-2';

export function Pagination({
  page,
  pageCount,
  onPage,
  hrefFor,
  label = 'Pagination',
  className,
}: PaginationProps): React.JSX.Element | null {
  // One page is not a pagination; rendering the chrome for it is noise in the
  // tab order.
  if (pageCount <= 1) return null;

  const intercept = (target: number) => (event: React.MouseEvent) => {
    if (!onPage) return;
    event.preventDefault();
    onPage(target);
  };

  const link = (target: number, text: React.ReactNode, ariaLabel?: string) =>
    hrefFor ? (
      <a
        href={hrefFor(target)}
        onClick={intercept(target)}
        aria-label={ariaLabel}
        className={cn(PAGE_BOX, PAGE_IDLE, 'tnum')}
      >
        {text}
      </a>
    ) : (
      <button
        type="button"
        onClick={() => onPage?.(target)}
        aria-label={ariaLabel}
        className={cn(PAGE_BOX, PAGE_IDLE, 'tnum')}
      >
        {text}
      </button>
    );

  const step = (target: number, text: string) =>
    target >= 1 && target <= pageCount ? (
      link(target, text)
    ) : (
      // Kept in the DOM and focusable rather than removed: a control that
      // vanishes at the edge shifts every other target out from under the
      // pointer, and a `disabled` button announces nothing at all.
      <span className={cn(PAGE_BOX, 'border-rule-2 text-ink-3')} aria-disabled="true" tabIndex={0}>
        {text}
      </span>
    );

  return (
    <nav aria-label={label} className={cn('flex flex-wrap items-center gap-4', className)}>
      <p className="sr-only" role="status">
        Page {page} of {pageCount}
      </p>
      <ul className="flex flex-wrap items-center gap-2">
        <li>{step(page - 1, 'Previous')}</li>
        {pageWindow(page, pageCount).map((entry, i) =>
          entry === 'gap' ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-2 text-ink-3">
              …
            </li>
          ) : (
            <li key={entry}>
              {entry === page ? (
                <span
                  aria-current="page"
                  className={cn(PAGE_BOX, 'border-acc-dk bg-acc-wash font-medium tnum text-acc-ink')}
                >
                  {entry}
                </span>
              ) : (
                link(entry, entry, `Page ${entry}`)
              )}
            </li>
          ),
        )}
        <li>{step(page + 1, 'Next')}</li>
      </ul>
    </nav>
  );
}
