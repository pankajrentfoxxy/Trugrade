import fs from 'node:fs';
import path from 'node:path';
import { Carousel } from '@trugrade/ui';
import type { FacetGroup } from '../lib/api';

/**
 * The brand rail under the header, on the homepage only.
 *
 * The brands are not a hard-coded list dressed up as data: they come from the
 * same `brand` facet that drives the rail on `/search`, and each tile links to
 * that brand's real filter. A brand the catalogue does not hold gets no tile.
 *
 * THE LOGO FILES
 * --------------
 * `public/brands/` holds one file per brand slug. Dell, Apple, Microsoft and
 * Asus are the real marks, supplied by the operator. The rest are placeholder
 * wordmarks authored here until real artwork is licensed for them.
 *
 * The extension is resolved from disk rather than hard-coded, because the two
 * kinds of file do not agree on one: the supplied marks are `.png`, the
 * placeholders are `.svg`, and a later drop could be either. Read once at
 * module load — this directory does not change while the server is running, and
 * a `readdir` per tile per request would be absurd.
 *
 * Logos sit on a white plate (`--plate`), not on the tile surface. Every one of
 * these marks is dark-on-transparent: Apple's grey and Microsoft's grey
 * wordmark are close to invisible on a near-black tile, and the next logo
 * dropped in will have its own palette we cannot predict. A constant white
 * plate is what every marketplace does with third-party marks, and it means a
 * logo can never vanish into the theme.
 */

/** slug -> the file that actually exists for it, e.g. `dell` -> `dell.png`. */
const LOGO_FILES: ReadonlyMap<string, string> = (() => {
  const dir = path.join(process.cwd(), 'public', 'brands');
  const map = new Map<string, string>();
  try {
    for (const name of fs.readdirSync(dir)) {
      const base = name.replace(/.[^.]+$/, '');
      // First match wins, so a real .png beats a leftover .svg placeholder.
      if (!map.has(base)) map.set(base, name);
    }
  } catch {
    // No directory in this environment: every tile falls back to its name.
  }
  return map;
})();

/**
 * Display order. The catalogue orders brands by stock, which reshuffles the
 * rail whenever a shipment lands — and a nav whose items move is a nav people
 * stop using. Anything the API returns that is not named here still appears,
 * appended, so a newly stocked brand is never silently dropped.
 */
const ORDER = ['Dell', 'HP', 'Asus', 'Apple', 'Acer', 'Lenovo', 'Microsoft', 'MSI'] as const;

const slug = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function BrandRail({
  brands,
}: {
  brands: FacetGroup | undefined;
}): React.JSX.Element | null {
  const options = brands?.options ?? [];
  if (options.length === 0) return null;

  const rank = (label: string): number => {
    const i = ORDER.indexOf(label as (typeof ORDER)[number]);
    return i === -1 ? ORDER.length : i;
  };
  const ordered = [...options].sort((a, b) => rank(a.label) - rank(b.label));

  return (
    <div className="brandrail">
      <div className="wrap">
        <Carousel label="Brands" trackClassName="brandrail-track" autoplay>
          {ordered.map((b) => {
            const file = LOGO_FILES.get(slug(b.label));
            return (
              <a
                key={b.value}
                className="brandtile"
                href={`/search?brand=${encodeURIComponent(b.value)}`}
                data-brand={slug(b.label)}
              >
                <span className="brandtile-plate">
                  {file ? (
                    /*
                      The brand name is the alt text, not "logo" — the name is
                      what the image conveys, and with the count gone it is the
                      only thing on the tile a screen reader has to go on.
                    */
                    <img
                      className="brandtile-logo"
                      src={`/brands/${file}`}
                      alt={b.label}
                      width={120}
                      height={44}
                      loading="lazy"
                    />
                  ) : (
                    // No file for this brand: its name, rather than a broken
                    // image icon or an empty tile.
                    <span className="brandtile-fallback">{b.label}</span>
                  )}
                </span>
              </a>
            );
          })}
        </Carousel>
      </div>
    </div>
  );
}
