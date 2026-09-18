import { LaptopArt } from './LaptopArt';

/**
 * The hero: full-bleed, dark in both themes, one claim and one action.
 *
 * Dark deliberately. The storefront's working surfaces flip with the theme, but
 * a hero that is a bright slab in light mode and a dark slab in dark mode reads
 * as two different products; holding it on the chrome ground makes it part of
 * the brand, like the header and footer, and lets the accent carry.
 *
 * Every number comes from `getStats()`. A figure the API did not return has its
 * whole line dropped rather than printing a zero — "0 units opened & tested"
 * under a claim about inspection is the most expensive fabrication on the site.
 *
 * `09_FRONTEND_LOCKED.md`: one primary action per screen. That is
 * `Browse inspected stock`. The second control is deliberately a quiet one.
 */
export function HomeBanner({
  inspected,
  models,
  brands,
}: {
  inspected: number | null;
  models: number | null;
  brands: number | null;
}): React.JSX.Element {
  const stats = [
    inspected !== null && inspected > 0
      ? { value: inspected.toLocaleString('en-IN'), label: 'units opened & tested' }
      : null,
    models !== null && models > 0
      ? { value: models.toLocaleString('en-IN'), label: 'models catalogued' }
      : null,
    brands !== null && brands > 0
      ? { value: brands.toLocaleString('en-IN'), label: 'brands onboarded' }
      : null,
  ].filter((s): s is { value: string; label: string } => s !== null);

  return (
    <section className="hero2" aria-labelledby="hero2-title">
      <div className="wrap hero2-grid">
        <div className="hero2-copy">
          <p className="hero2-kick">
            <i className="blip" aria-hidden="true" /> Opened &middot; Measured &middot; Sealed
          </p>
          <h1 id="hero2-title">
            Refurbished laptops, bought on <em>evidence</em>.
          </h1>
          <p className="hero2-sub">
            Every machine is physically opened at the supplier&rsquo;s warehouse, measured against
            published bands and sealed before it is listed. One GST invoice from us, serials listed,
            with an inspection window to reject.
          </p>

          <div className="hero2-cta">
            <a className="pill acc" href="/search">
              Browse inspected stock &rarr;
            </a>
            <a className="hero2-quiet" href="/bulk">
              Buying in volume?
            </a>
          </div>

          {stats.length > 0 && (
            <dl className="hero2-stats">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="mono">{s.value}</dt>
                  <dd>{s.label}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="hero2-art" aria-hidden="true">
          <LaptopArt className="la" />
        </div>
      </div>
    </section>
  );
}
