/**
 * The board envelope.
 *
 * Thirteen screens in this console are a list of records, and at a week's volume
 * — 1,284 orders, 1,680 purchase orders, 1,573 shipments — a list is unusable.
 * There is one board component, and this is the shape every list endpoint hands
 * it. A fourteenth list must not mean a fourteenth response shape any more than
 * it means a fourteenth table.
 *
 * **The view counts travel with the page.** Every saved view's count is computed
 * in the same statement as the page — `count(*) FILTER (WHERE ...)` — because
 * six segments fetched separately is six round trips, and worse, six answers
 * from six different instants. A badge that disagrees with what the board renders
 * when you click it destroys trust in every other number on the screen.
 */

export interface BoardViewCount {
  /** URL value: `?view=needs_action`. */
  key: string;
  /** 1–3 words, no verb, no article. */
  label: string;
  count: number;
}

export interface BoardFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface BoardEnvelope<Row> {
  rows: Row[];
  page: number;
  per: number;
  /** Rows matching the current view and filters. */
  total: number;
  pages: number;
  /**
   * Rows in the resource before any filter.
   *
   * Rendered beside the pager as `1–40 of 128 · 1,680 total` so an operator can
   * see how much they narrowed. Without it a filtered board looks like an empty
   * platform.
   */
  grandTotal: number;
  views: BoardViewCount[];
  facets: Record<string, BoardFacetOption[]>;
  /** Whole-board sums under the current filter, pre-formatted. Page sums lie. */
  totals?: Record<string, string | number>;
}

/** 40 rows. Enough to fill a laptop screen at compact density, not enough to stall one. */
export const BOARD_PAGE_SIZE = 40;

export interface BoardQuery {
  view?: string;
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  per?: number;
  facet?: Record<string, string>;
}

/**
 * Clamp a page request to something the database should be asked for.
 *
 * `?page=99999` on an empty board is not an error worth a 400 — it is a stale
 * bookmark — so it resolves to the last page instead of a failure or an empty
 * render with a pager that says 40 of 0.
 */
export function boardSlice(
  total: number,
  page = 1,
  per = BOARD_PAGE_SIZE,
): { page: number; per: number; pages: number; offset: number } {
  const size = Math.min(Math.max(Math.trunc(per) || BOARD_PAGE_SIZE, 1), 200);
  const pages = Math.max(1, Math.ceil(total / size));
  const wanted = Math.trunc(page) || 1;
  const current = Math.min(Math.max(wanted, 1), pages);
  return { page: current, per: size, pages, offset: (current - 1) * size };
}

/**
 * Sort whitelisting.
 *
 * `?sort=` names a column, and a column name cannot be a bound parameter — it is
 * interpolated into SQL. So it is resolved against a map the endpoint owns and
 * anything unrecognised falls back to the default. There is no path by which a
 * caller's string reaches a query.
 */
export function boardSort<K extends string>(
  columns: Readonly<Record<K, string>>,
  fallback: K,
  sort?: string,
  dir?: string,
): { column: string; dir: 'ASC' | 'DESC'; key: K } {
  const key = (sort && sort in columns ? sort : fallback) as K;
  return {
    column: columns[key],
    dir: dir?.toLowerCase() === 'asc' ? 'ASC' : 'DESC',
    key,
  };
}
