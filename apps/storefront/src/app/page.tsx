import { BRAND } from '@trugrade/config/brand';
import { getSearch, getStats } from '../lib/api';
import { toApiQueryString } from './search/query';
import { BrandRail } from './BrandRail';
import { HomeBanner } from './HomeBanner';
import { HomeStrip } from './HomeStrip';
import { ShopTiles } from './ShopTiles';
import { SpecShowcase } from './SpecShowcase';
import { SearchResultCard } from './search/SearchResultCard';
import { SiteHeader } from './SiteHeader';

/**
 * The homepage, built to the block structure in `09_FRONTEND_LOCKED.md` §7
 * against `docs/reference/homepage.html`.
 *
 * The class names are the reference's own and `storefront.css` is that file's
 * CSS ported across, so this page IS the reference rather than an
 * approximation of it.
 *
 * TWO DELIBERATE DEPARTURES FROM THE REFERENCE
 * --------------------------------------------
 * **The data.** That file is a design mock, and its product cards and facet
 * counts are illustrative. Ours are read from the database, which currently
 * holds 200 catalogued SKUs and zero inspected units — so the grid and the
 * board render honest empty states rather than the mock's sample stock. That is
 * not a shortfall: a motif must carry information, and a product card promising
 * 91 units that do not exist is a scarcity device.
 *
 * A banner and a spec showcase were added back at the top after the original
 * blocks came out. Both are homepage-only and both are fed from the API: the
 * banner drops any figure `getStats()` did not return rather than printing a
 * zero, and the showcase cycles the same `SearchResult`s the grid renders, so
 * there is no second source of truth for a machine's specification.
 *
 * **Blocks 3, 4a, 4b, 5 and 8 are gone**, and so is the filter rail — the
 * category strip (removed across the whole storefront, not just here), the hero
 * (claim, two calls to action, live inspection feed), the result bar (result
 * count, sort control), the supply board and the supplier band. The page runs
 * header → grid → utility strip → process → footer.
 *
 * Filtering is `/search`'s job now and that page is untouched: it still renders
 * the same `FilterRail` and `ResultBar`, driven by the URL. This page keeps
 * calling the same search endpoint, so the grid is still the real, filterable
 * catalogue — there is simply no control on the homepage that narrows it.
 *
 * "Apply to supply" went with the band. The only remaining route to supplier
 * registration from the storefront is `Sell on Trugrade →` in the header's
 * account flyout — worth knowing before that one is removed too.
 *
 * Two consequences worth knowing rather than rediscovering. The page is
 * archetype B (Board) now, not archetype A (Landing) — "claim, one control,
 * then real inventory" — because it has neither a claim nor a control. And
 * `?sort=` still reaches the API through `toApiQueryString(params)`, so a sorted
 * link a buyer was sent keeps working; there is simply no longer a control on
 * this page that sets it. `/search` keeps its own result bar untouched.
 *
 * The hero's CSS is intentionally still in `storefront.css` —
 * `one-design-system.spec.ts` asserts on `.hero .pill.wire`, so those rules are
 * load-bearing for that test even with no markup using them.
 */
export const dynamic = 'force-dynamic';

const PROCESS = [
  [
    'Sourced',
    'From corporate buybacks, lease returns and audited traders. Every unit has a declared origin.',
  ],
  [
    'Opened & tested',
    `A technician runs ${BRAND.qcProduct} at the supplier's warehouse. Memory, storage, battery, thermals, ports.`,
  ],
  [
    'Graded & sealed',
    'Graded against published bands, then a numbered tamper seal goes on and is photographed.',
  ],
  [
    'Delivered on our invoice',
    'One GST invoice from us, serials listed, with an inspection window to reject.',
  ],
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;

  const apiQuery = new URLSearchParams(toApiQueryString(params));
  if (!apiQuery.has('per')) apiQuery.set('per', '24');

  // The rail is fed from the same endpoint that feeds `/search`, so the counts
  // beside each option on the homepage are the counts the results page will
  // honour. Two sources for one rail is how a facet starts promising stock that
  // the search behind it does not return.
  const [stats, search] = await Promise.all([getStats(), getSearch(apiQuery.toString())]);

  const inspected = stats?.unitsInspected ?? 0;
  const results = search?.results ?? [];

  return (
    <>
      <SiteHeader inspected={stats ? inspected : null} />

      {/* Brands, straight under the chrome. Homepage only — it is a way IN to
          the catalogue, and every other page is already inside it. */}
      <BrandRail brands={search?.facets?.brand} />

      {/* The banner, then the same machines the grid holds, one at a time,
          with their measurements. Both are homepage-only: this is the way in. */}
      <HomeBanner
        inspected={stats ? inspected : null}
        models={stats?.skusCatalogued ?? null}
        brands={stats?.brandsCatalogued ?? null}
      />

      <HomeStrip />

      <ShopTiles results={results} />

      {results.length > 0 && <SpecShowcase items={results} />}

      {/* 4 — BODY: the grid, full width. No rail — filtering is `/search`'s
          job, and that page still carries the rail and the result bar. */}
      <div className="body">
        <div className="wrap">
          <main>
            {results.length > 0 ? (
              <div className="pcclist">
                {results.map((r) => (
                  <SearchResultCard key={`${r.skuId}-${r.grade}`} r={r} />
                ))}
              </div>
            ) : (
              <div className="empty">
                <h3>No inspected stock yet</h3>
                <p>
                  {stats?.skusCatalogued ?? 0} models are catalogued and{' '}
                  {stats?.brandsCatalogued ?? 0} brands are onboarded. A laptop appears here once it
                  has been opened, tested, graded and sealed — never before, and never on the
                  strength of a supplier&rsquo;s description.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* 6 — UTILITY STRIP: verify a certificate, and bulk requirement.
          `.wrap.strip` is one box: the wrap centres it, the strip grid puts
          the two cards side by side. A nested wrap used to be the only child
          of the grid, so they stacked. */}
      <div className="wrap strip">
        <div className="sbx">
          <div className="qr" role="img" aria-label="Certificate QR" />
          <div>
            <h3>Verify a certificate</h3>
            <p>
              Holding a machine with a seal on it? Enter the certificate ID or the serial and read
              the report it shipped with.
            </p>
            <form className="qform" action="/verify">
              <label className="sr-only" htmlFor="cert">
                Certificate ID or serial
              </label>
              <input id="cert" name="q" className="mono" placeholder="TG-CERT-… or serial" />
              <button type="submit">Verify</button>
            </form>
          </div>
        </div>
        <div className="sbx">
          <div>
            <h3>Have a requirement list?</h3>
            <p>
              Send the specification, quantity and grade. We tell you what is available now, at a
              landed price for your pincode, and source the rest.
            </p>
            <form className="qform" action="/bulk">
              <label className="sr-only" htmlFor="req">
                Requirement
              </label>
              <input id="req" name="q" placeholder="e.g. 40 × i5 / 16 GB / Grade A" />
              <button type="submit">Start</button>
            </form>
          </div>
        </div>
      </div>

      {/* 7 — PROCESS. `.wrap.proc` is the centred four-column rail; a nested
          wrap used to be the only grid child, so the steps stacked. */}
      <div className="wrap proc">
        {PROCESS.map(([title, body], i) => (
          <div className="pstep" key={title}>
            <div className="pstep-mark">
              <span className="n mono">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </>
  );
}
