import { BRAND } from '@trugrade/config/brand';
import { getSearch, getStats } from '../lib/api';
import { consoleSellRegisterUrlFromRequest } from '../lib/console-url.server';
import { toApiQueryString } from './search/query';
import { BrandRail } from './BrandRail';
import { BuyerReviews } from './BuyerReviews';
import { HeroBanner } from './HeroBanner';
import { HomePills } from './HomePills';
import { HomeStrip } from './HomeStrip';
import { SpecShowcase } from './SpecShowcase';
import { SiteHeader } from './SiteHeader';
import { WhyTrugrade } from './WhyTrugrade';

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
 * header → grid → why Trugrade → buyer reviews → utility strip → process →
 * footer.
 *
 * `WhyTrugrade` is new: a five-row comparison against buying new and a
 * grey-market dealer, beside a bulk-order poster — the differentiator the
 * supply board used to carry, restated as the reasons already given in this
 * page's own copy rather than a second thing to keep in sync with it.
 *
 * `BuyerReviews`, right after it, is also new: a masonry wall of sample
 * quotes. **Placeholder content, not a database read** — see that file's own
 * header for exactly what is real and what is not, the same notice
 * `laptops/[slug]/product-rating.tsx` already carries for the per-product
 * review rail.
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

/**
 * The brand rail is parked, not deleted.
 *
 * Switched off at the homepage's request and switched off is all it is: the
 * component, its logo files in `public/brands/` and the facet that feeds it are
 * all untouched, and flipping this back to `true` restores the row exactly as
 * it was. A flag rather than commented-out JSX so the markup stays type-checked
 * and linted while it is dark — the same treatment the utility strip gets in
 * `SiteHeader`.
 */
const SHOW_BRAND_RAIL = false;

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
  const [stats, search, sellUrl] = await Promise.all([
    getStats(),
    getSearch(apiQuery.toString()),
    consoleSellRegisterUrlFromRequest(),
  ]);

  const inspected = stats?.unitsInspected ?? 0;
  const results = search?.results ?? [];

  return (
    <>
      <SiteHeader inspected={stats ? inspected : null} />

      {/* Brands, straight under the chrome. Homepage only — it is a way IN to
          the catalogue, and every other page is already inside it. */}
      {SHOW_BRAND_RAIL && <BrandRail brands={search?.facets?.brand} />}

      {/*
        Everything under the header sits on `.home`, which redefines `--ground`
        as the near-white `--sheet-2` for this page only. The sections below
        paint `var(--ground)` themselves, so they all lighten from this one
        override — and every other page keeps the standard ground.
      */}
      <div className="home">
        {/* The claims, centred, before the banner says anything else. */}
        <HomePills />

        {/* The banner, then the same machines the grid holds, one at a time,
          with their measurements. Both are homepage-only: this is the way in. */}
        <HeroBanner results={results} sellUrl={sellUrl} />

        <HomeStrip />

        {/*
          The "ways to shop" tiles are gone from this page.

          They were four filters into `/search` — top grade, score 90+, battery
          90%+, ready in 24 h — which is the same four the claim pills above the
          hero now carry, pointing at the same query strings. Two rows of the
          same links is one row too many, and the pills are the ones a reader
          meets first. `ShopTiles` itself is untouched and still counts its own
          stock, so it can go back anywhere that does not already have the pills.
        */}

        {results.length > 0 && <SpecShowcase items={results} />}

        {/* Why Trugrade — the comparison table and bulk-order poster. Sits
          between the machines the reader has just seen measured and the
          mechanics of buying one (verify a certificate, then the process). */}
        <WhyTrugrade />

        {/* Buyer reviews — placeholder content, see the file's own header. */}
        <BuyerReviews />

        {/*
        The product grid is gone from this page.

        `/search` owns the catalogue and carries the rail, the result bar and
        the sort control that make a grid of it usable; repeating the cards here
        was a second, unfilterable copy of that page. The search call stays —
        the banner, the shop tiles and the spec showcase are all fed from the
        same `results`, so this page still renders real stock, just not as a
        grid of cards.

        The "No inspected stock yet" empty state went with it. It belonged to
        the grid, and an empty state for a block that no longer exists is a
        sentence about nothing.
      */}

        {/* 6 — UTILITY STRIP: verify a certificate.
          The requirement-list card that used to sit beside it is gone; `/bulk`
          is still reachable from the header and the footer. `id="verify"` is
          what every "Verify a certificate" link in the chrome points at —
          `/qc/verify` has no page of its own, only `/qc/verify/[code]`, so the
          form here is the way in. */}
        <div className="wrap strip">
          <section className="sbx" id="verify">
            <div className="sbx-head">
              <span className="sbx-ic">
                <span className="qr" role="img" aria-label="Certificate QR" />
              </span>
              <div>
                <h3>Verify a certificate</h3>
                <p>
                  Holding a machine with a seal on it? Enter the certificate ID or the serial and
                  read the report it shipped with.
                </p>
              </div>
            </div>
            <form className="qform" action="/verify">
              <label className="sr-only" htmlFor="cert">
                Certificate ID or serial
              </label>
              <input id="cert" name="q" className="mono" placeholder="TG-CERT-… or serial" />
              <button type="submit">Verify</button>
            </form>
          </section>
        </div>

        {/* 7 — PROCESS. `.wrap.proc` is the centred four-column rail; a nested
          wrap used to be the only grid child, so the steps stacked. */}
        <ol className="wrap proc">
          {PROCESS.map(([title, body], i) => (
            <li className="pstep" key={title}>
              <div className="pstep-mark">
                <span className="n mono">{String(i + 1).padStart(2, '0')}</span>
                {/* The rail to the next step. Its fill is the `<i>`, which
                    draws left to right as the sequence reaches this step. */}
                <span className="pline" aria-hidden="true">
                  <i />
                </span>
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
