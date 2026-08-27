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
import { getSearch, type SearchResult } from '../../lib/api';
import { CategoryStrip } from '../CategoryStrip';
import { FilterRail } from '../FilterRail';
import { Pager } from './Pager';
import { ResultBar } from './ResultBar';
import { SORTS } from './sorts';
import { ResultsList } from './ResultsList';

export const metadata: Metadata = {
  title: 'Search inspected laptops',
  description:
    'Filter refurbished laptops on the grade we found, the battery health we measured and the inspection score we recorded.',
};

/** Board state is per-request by definition; a cached board is another board. */
export const dynamic = 'force-dynamic';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

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
                  <div className="pgrid">
                    {data.results.map((r) => (
                      <Card key={`${r.skuId}-${r.grade}`} r={r} />
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

/**
 * One result card — the reference's `.pc`, with its measurements.
 *
 * The viewfinder brackets assert THIS UNIT WAS CAPTURED AND IDENTIFIED, so they
 * are drawn around a real serial we hold. The QC chip is amber because a
 * measured value is one of the three things amber is allowed to mean; the grade
 * chip is neutral because A+, A and B are all sellable and a position on a scale
 * is not a verdict.
 */
function Card({ r }: { r: SearchResult }): React.JSX.Element {
  const measured = r.batteryMeasured > 0 && r.batteryMin !== null && r.batteryMax !== null;
  return (
    <div className="pc">
      <div className="im">
        <span className="vf tl" />
        <span className="vf tr" />
        <span className="vf bl" />
        <span className="vf br" />
        <span className="gr mono">{GRADE_LABEL[r.grade] ?? r.grade}</span>
        {/* No score means no chip. A chip reading "QC 0" says we inspected it and
            it scored nothing; the truth would be that we have no number. */}
        {r.avgQcScore !== null && <span className="qc mono">QC {r.avgQcScore}</span>}
        <span className="sn mono">{r.sampleSerial}</span>
        <svg
          width="84"
          height="48"
          viewBox="0 0 150 80"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="27" y="10" width="96" height="56" rx="3" />
          <path d="M12 70 h126 l-8 -4 H20 z" />
        </svg>
      </div>
      <div className="bd">
        <b>
          {r.brand} {r.model}
        </b>
        <span className="spec mono">{r.spec}</span>
        {measured ? (
          <span className="bat mono">
            BAT{' '}
            <i>
              <b style={{ width: `${r.batteryMin}%` }} />
            </i>{' '}
            {r.batteryMin === r.batteryMax ? `${r.batteryMin}%` : `${r.batteryMin}–${r.batteryMax}%`}
            <span className="denom">
              {' '}
              · {r.batteryMeasured} of {r.unitsAvailable}
            </span>
          </span>
        ) : (
          <span className="bat notmeasured">Battery not measured</span>
        )}
        <div className="pr mono">
          ₹{RUPEES.format(r.fromPrice)} <small>from · incl. GST</small>
        </div>
        <div className="meta">
          <span>
            <b className="mono">{r.supplyPoints}</b> supply point{r.supplyPoints === 1 ? '' : 's'} ·{' '}
            {r.cities.join(', ')}
          </span>
          {/* A stock count is a fact. It is never dressed as urgency — no
              "only 2 left", no countdown (CCPA Dark Patterns 2023). */}
          <b className="mono">{r.unitsAvailable} sealed</b>
        </div>
      </div>
      <a className="cta" href={`/laptops/${r.skuId}?grade=${r.grade}`}>
        Compare suppliers
      </a>
    </div>
  );
}
