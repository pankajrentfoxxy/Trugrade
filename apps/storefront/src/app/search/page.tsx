/**
 * ARCHETYPE B — Board. Filter rail + results + row actions.
 * DENSITY: comfortable (set on `<html>` in `layout.tsx`).
 *
 * Search results, built to `09_FRONTEND_LOCKED.md` §6 against
 * `docs/reference/homepage.html`, whose rail, result bar and product grid this
 * page reuses class for class rather than re-approximating.
 *
 * **The whole of the board's state is in the URL** — every facet, the sort, the
 * view, the page and the page size. There is no state library and no client
 * store, because a buyer must be able to send a colleague a link that
 * reproduces exactly what they saw, and once that is true a store has nothing
 * left to hold.
 *
 * Rendered on the server for the same reason: the results ARE the page, and a
 * grid that arrives after a client fetch is a grid no crawler and no slow
 * connection ever sees.
 */
import type { Metadata } from 'next';
import { getSearch } from '../../lib/api';
import { CategoryStrip } from '../CategoryStrip';
import { FilterRail } from '../FilterRail';
import { Pager } from './Pager';
import { ResultBar } from './ResultBar';
import { SORTS } from './sorts';
import { ResultsList } from './ResultsList';
import { SearchResultCard } from './SearchResultCard';

export const metadata: Metadata = {
  title: 'Search inspected laptops',
  description:
    'Filter refurbished laptops on the grade we found, the battery health we measured and the inspection score we recorded.',
};

/** Board state is per-request by definition; a cached board is another board. */
export const dynamic = 'force-dynamic';

/** Params the API does not read, so they never reach it as a filter. */
const CLIENT_ONLY = new Set(['view', 'pin']);

function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) if (v !== '') qs.append(key, v);
  }
  return qs.toString();
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const query = toQueryString(params);

  const apiQuery = new URLSearchParams(query);
  for (const key of CLIENT_ONLY) apiQuery.delete(key);

  const data = await getSearch(apiQuery.toString());

  const view = params.view === 'list' ? 'list' : 'grid';
  const pincode = typeof params.pin === 'string' && params.pin !== '' ? params.pin : null;
  const sort = typeof params.sort === 'string' ? params.sort : 'price';
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? SORTS[0]!.label;

  return (
    <>
      <CategoryStrip query={query} />

      <div className="body">
        <div className="wrap">
          {/*
            The error state. A search that cannot reach the API renders this and
            not an empty grid: "nothing matched your filters" would be a
            statement about the stock, and what actually happened is a statement
            about us.
          */}
          {data === null ? (
            <div className="empty err">
              <h3>We could not run that search</h3>
              <p>
                The catalogue did not answer. Nothing is wrong with your filters — this is our
                problem, not yours. Reload the page; if it keeps happening, the stock is still
                there and{' '}
                <a className="ulink" href="/help">
                  our team can pull it for you
                </a>
                .
              </p>
              <p className="retry">
                <a className="pill acc" href={`/search${query ? `?${query}` : ''}`}>
                  Try again
                </a>
              </p>
            </div>
          ) : (
            <div className="cols">
              <FilterRail facets={data.facets} query={query} total={data.total} />

              <main>
                <ResultBar
                  query={query}
                  total={data.total}
                  models={data.models}
                  pincode={pincode}
                  sort={sort}
                  view={view}
                />

                {data.results.length === 0 ? (
                  <div className="empty">
                    <h3>No sealed unit matches all of those filters</h3>
                    <p>
                      Every option in the rail still shows how many units it would return on its
                      own, so the one that took the count to zero is the one reading{' '}
                      <span className="mono">0</span>. Remove it, or clear all filters and start
                      again.
                    </p>
                    <p className="retry">
                      <a className="pill acc" href="/search">
                        Clear all filters
                      </a>
                    </p>
                  </div>
                ) : view === 'list' ? (
                  <ResultsList results={data.results} sortLabel={sortLabel} />
                ) : (
                  <div className="pcclist">
                    {data.results.map((r) => (
                      <SearchResultCard key={`${r.skuId}-${r.grade}`} r={r} />
                    ))}
                  </div>
                )}

                {/* No rows, no board footer: the empty state already says
                    everything there is to say about a result set of zero. */}
                {data.results.length > 0 && (
                  <Pager
                    query={query}
                    page={data.page}
                    pages={data.pages}
                    per={data.per}
                    shown={data.results.length}
                    models={data.models}
                  />
                )}
              </main>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
