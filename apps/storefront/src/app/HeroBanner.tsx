import * as React from 'react';
import type { SearchResult } from '../lib/api';
import { storageShortLabel } from './search/storage-label';
import { HeroDeals, type HeroDeal } from './HeroDeals';
import { HeroShowcase, type HeroSlide } from './HeroShowcase';

/**
 * The supplied hero design, ported.
 *
 * It keeps its own warm-black / amber language rather than the product palette.
 * See the `--promo-*` block in `globals.css` for why those constants live there
 * and why nothing outside `.phero` should reach for them.
 *
 * WHAT CHANGED IN THE PORT, AND WHY
 * ---------------------------------
 * **The cards and slides are real machines.** The supplied markup hard-coded
 * four deals — "Dell Latitude 7420, QC 92, ₹38,500" and so on — and four
 * showcase slides to match. A hero naming a model, a score and a price we may
 * not hold is the fabricated-stock case the house rules forbid, so both are fed
 * from the same `SearchResult` list the tiles below render. Same design, true
 * numbers. When the search returns nothing, the left column falls back to the
 * headline copy rather than an empty carousel.
 *
 * **The photos are brand-representative, not unit photos.** The design ships
 * four product renders. They are keyed by brand, so a Dell slide shows the Dell
 * render whatever the model. Brands without a render get the drawn shell the
 * earlier port used. Buyers see the real unit's photographs on the SKU page.
 *
 * **`min-height: 100vh` is gone.** The design was a standalone page; here it
 * sits under a header, and a full viewport would push the catalogue entirely
 * below the fold.
 *
 * **"Sell your laptop" points at the console.** The supplied `#sell` anchor
 * goes nowhere, and supplier registration is a console route.
 *
 * Left exactly as drawn, and worth knowing: the grade plate colour-codes A+
 * amber, A amber-outlined and B grey. `CLAUDE.md` holds that grades are neutral
 * because A+, A and B are all sellable, and a colour ramp turns a position on a
 * scale into a verdict. That is a design call, so it stands.
 */

const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

const CONDITION: Record<string, { condition: string; note: string }> = {
  'A+': { condition: 'Excellent condition', note: 'Like new, fully certified' },
  A: { condition: 'Very good condition', note: 'Minor signs of use' },
  B: { condition: 'Good condition', note: 'Visible wear, fully working' },
};

/** The renders the design ships, by brand. Files live in `public/home/`. */
const PHOTO: Record<string, string> = {
  dell: '/home/laptop-dell.png',
  apple: '/home/laptop-apple.png',
  asus: '/home/laptop-asus.png',
  lenovo: '/home/laptop-lenovo.png',
};

/** Machines drawn with a pale shell rather than graphite. Illustration only. */
const SILVER = new Set(['apple']);

const STEPS = ['Laptop Added', 'Inspected', 'Listed', 'Purchase Easily'] as const;

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function specLine(r: SearchResult): string {
  const parts = [r.cpuLine];
  if (r.ramGb > 0) parts.push(`${r.ramGb} GB`);
  if (r.storageGb > 0) {
    const kind = storageShortLabel(r.storageType);
    parts.push(kind ? `${r.storageGb} GB ${kind}` : `${r.storageGb} GB`);
  }
  return parts.join(' · ');
}

export function HeroBanner({
  results,
  sellUrl,
}: {
  results: readonly SearchResult[];
  sellUrl: string;
}): React.JSX.Element {
  const deals: HeroDeal[] = results.slice(0, 4).map((r) => ({
    skuId: r.skuId,
    gradeCode: r.grade,
    grade: GRADE_LABEL[r.grade] ?? r.grade,
    brand: r.brand,
    model: r.model,
    spec: specLine(r),
    qcScore: r.avgQcScore === null ? null : Math.round(r.avgQcScore),
    price: RUPEES.format(r.fromPrice),
    shipHours: r.shipHours,
    photo: PHOTO[r.brand.toLowerCase()] ?? null,
  }));

  // One slide per brand, so the stage never rotates the same machine twice.
  const seen = new Set<string>();
  const slides: HeroSlide[] = [];
  for (const r of results) {
    const key = r.brand.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const grade = GRADE_LABEL[r.grade] ?? r.grade;
    const c = CONDITION[grade];
    slides.push({
      grade,
      condition: c?.condition ?? 'Inspected',
      note: c?.note ?? 'Graded against published bands',
      brand: r.brand,
      model: r.model,
      spec: r.cpuLine,
      tint: slides.length % 6,
      silver: SILVER.has(key),
      photo: PHOTO[key] ?? null,
    });
    if (slides.length === 4) break;
  }

  const brands = [...new Set(results.map((r) => r.brand))].slice(0, 6);

  return (
    <section className="phero">
      <div className="phero-glow phero-glow-a" aria-hidden="true" />
      <div className="phero-glow phero-glow-b" aria-hidden="true" />
      <span className="phero-speck" aria-hidden="true" />
      <span className="phero-speck" aria-hidden="true" />
      <span className="phero-speck" aria-hidden="true" />
      <span className="phero-speck" aria-hidden="true" />

      <div className="phero-top">
        <div className={deals.length > 0 ? 'phero-copy has-deals' : 'phero-copy'}>
          {deals.length > 0 ? (
            <HeroDeals deals={deals} />
          ) : (
            <>
              <p className="phero-tagline">
                <span className="phero-dot" aria-hidden="true" />
                Inspected &middot; Graded &middot; Listed &middot; Ready to go
              </p>
              <h1 className="phero-headline">
                Refurbished laptops.
                <br />
                <span className="phero-alt">Made simple.</span>
              </h1>
              <p className="phero-sub">
                Quality-checked laptops from trusted brands, graded honestly and ready to buy.
              </p>
            </>
          )}

          <div className="phero-cta">
            <a className="phero-btn phero-btn-primary" href="/search">
              Explore laptops
              <span className="phero-arrow" aria-hidden="true">
                &rarr;
              </span>
            </a>
            <a
              className="phero-btn phero-btn-ghost"
              href={sellUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Sell your laptop
            </a>
          </div>

          {brands.length > 0 && (
            <p className="phero-brands">
              {brands.map((brand, i) => (
                <span key={brand}>
                  {i > 0 && ' · '}
                  <b>{brand}</b>
                </span>
              ))}
              {' · and more'}
            </p>
          )}
        </div>

        {slides.length > 0 && <HeroShowcase slides={slides} />}
      </div>

      <div className="phero-process">
        <ol className="phero-chain">
          {STEPS.map((title, i) => (
            <React.Fragment key={title}>
              {i > 0 && (
                <li className="phero-link" aria-hidden="true">
                  <span className="phero-track">
                    <span className="phero-fill" />
                  </span>
                </li>
              )}
              <li className="phero-step">
                <span className="phero-step-icon" aria-hidden="true">
                  <StepIcon step={i} />
                </span>
                <span className="phero-step-copy">
                  <span className="phero-step-title">{title}</span>
                </span>
              </li>
            </React.Fragment>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepIcon({ step }: { step: number }): React.JSX.Element {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (step === 0) {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="11" rx="1.6" />
        <path d="M2 19h20" />
        <path d="M12 13V8.3M9.8 10.4 12 8.2l2.2 2.2" />
      </svg>
    );
  }
  if (step === 1) {
    return (
      <svg {...common}>
        <path d="M12 3.2 5 5.8v5.1c0 4.4 3 8.1 7 9.9 4-1.8 7-5.5 7-9.9V5.8L12 3.2Z" />
        <path d="m9 11.6 2.1 2.1L15.3 9.5" />
      </svg>
    );
  }
  if (step === 2) {
    return (
      <svg {...common}>
        <path d="M4 8.5 5.4 4h13.2L20 8.5" />
        <path d="M4 8.5c0 1.4 1.1 2.6 2.6 2.6S9.3 9.9 9.3 8.5c0 1.4 1.2 2.6 2.7 2.6s2.7-1.2 2.7-2.6c0 1.4 1.1 2.6 2.6 2.6S20 9.9 20 8.5" />
        <path d="M5.5 11v9h13v-9" />
        <path d="M9.5 20v-5h5v5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17.5" cy="20" r="1.4" />
      <path d="M3 3.8h2.6l2.1 12h11l2.3-8.6H6.2" />
    </svg>
  );
}
