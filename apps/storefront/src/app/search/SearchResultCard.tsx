import { GradeBadge } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import type { SearchResult } from '../../lib/api';
import { brandPhoto } from '../../lib/brand-photo';
import { storageShortLabel } from './storage-label';
import { PLACEHOLDER_RATING, percentOff, placeholderMrp } from './placeholder-market';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const GRADES: readonly Grade[] = ['A_PLUS', 'A', 'B'];
const isGrade = (value: string): value is Grade => (GRADES as readonly string[]).includes(value);

/** The line-drawn shell, for a brand the design ships no render for. */
function LaptopShell(): React.JSX.Element {
  return (
    <svg className="ptile-shell" viewBox="0 0 150 80" fill="none" aria-hidden="true">
      <rect x="27" y="10" width="96" height="56" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function StarIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.6 14.9 8.7l6.6.8-4.9 4.6 1.3 6.5L12 17.4l-5.9 3.2 1.3-6.5L2.5 9.5l6.6-.8L12 2.6z" />
    </svg>
  );
}

/**
 * One search hit, as a visual product tile.
 *
 * Built to the supplied listing-card design, "one shared stage" variant. The
 * stage owns most of the card, then the brand and name, the rating, one spec
 * line, the price and the action — the order a buyer scans a shelf in. Battery
 * health is not on the card by direction; the buyer meets it on the SKU page.
 *
 *   - **The grade is neutral.** A+, A and B are all sellable, so the ribbon is
 *     `GradeBadge` rather than the design's amber pill. Colouring a position
 *     on a scale as a verdict is the one thing the badge exists to prevent.
 *   - **Nothing unpublished renders as published.** A missing spec part is
 *     left out; a SKU with no spec at all says so in `--ink-4`.
 *
 * The buyer rating, the struck-through MRP and the "% off" are PLACEHOLDERS,
 * hardcoded by direction in `placeholder-market.ts`: the search API does not
 * send them yet. They are the one thing on this card that is not a fact from
 * the API, and they come from a single file so they can be replaced in one
 * move when it does.
 *
 * The image is the brand-representative render the home page already uses,
 * never a unit photograph — those carry captions and live on the SKU page.
 */
export function SearchResultCard({ r }: { r: SearchResult }): React.JSX.Element {
  const storageShort = storageShortLabel(r.storageType);
  const cities = r.cities.join(', ');
  const photo = brandPhoto(r.brand);
  const mrp = placeholderMrp(r.fromPrice);
  const off = percentOff(r.fromPrice, mrp);

  // One line, the design's `i5-1135G7 · 16 GB · 512 GB SSD · 14″ FHD`. Only
  // the parts we actually have; a missing part is left out, not filled in.
  const specParts: React.ReactNode[] = [];
  if (r.cpuLine) specParts.push(<b key="cpu">{r.cpuLine}</b>);
  if (r.ramGb > 0) {
    specParts.push(
      <span key="ram" className="mono">
        {r.ramGb} GB
      </span>,
    );
  }
  if (r.storageGb > 0) {
    specParts.push(
      <span key="ssd" className="mono">
        {r.storageGb} GB{storageShort ? ` ${storageShort}` : ''}
      </span>,
    );
  }
  if (r.displayLine) specParts.push(<span key="disp">{r.displayLine}</span>);

  return (
    <a className="ptile" href={`/laptops/${r.skuId}?grade=${r.grade}`}>
      <div className="ptile-media">
        {isGrade(r.grade) && <GradeBadge grade={r.grade} className="ptile-ribbon" />}
        <span className="ptile-sealed">
          <b className="mono">{r.unitsAvailable}</b> sealed
        </span>
        {photo ? <img className="ptile-photo" src={photo} alt="" loading="lazy" /> : <LaptopShell />}
      </div>

      <div className="ptile-body">
        <p className="ptile-brandline">
          <b>{r.brand}</b>
          <span>
            <span className="mono">{r.supplyPoints}</span> supply point
            {r.supplyPoints === 1 ? '' : 's'}
            {cities ? ` · ${cities}` : ''}
          </span>
        </p>
        <h3 className="ptile-name">
          {r.brand} {r.model}
        </h3>

        <p className="ptile-rate">
          <span className="ptile-rate-pill">
            <span className="mono">{PLACEHOLDER_RATING.value.toFixed(1)}</span>
            <StarIcon />
          </span>
          <span>
            <span className="mono">{PLACEHOLDER_RATING.count.toLocaleString('en-IN')}</span> buyer
            ratings
          </span>
        </p>

        {specParts.length > 0 ? (
          <p className="ptile-spec">
            {specParts.map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part}
              </span>
            ))}
          </p>
        ) : (
          <p className="ptile-spec">
            <span className="ptile-unmeasured">Specification not published</span>
          </p>
        )}

        <div className="ptile-price-row">
          <span className="ptile-price-now mono">₹{RUPEES.format(r.fromPrice)}</span>
          <s className="ptile-price-mrp mono">₹{RUPEES.format(mrp)} new</s>
          <span className="ptile-price-off">
            <span className="mono">{off}%</span> off
          </span>
          <span className="ptile-price-sub">from · incl. GST</span>
        </div>
        {/*
          Styled as a button, rendered as a span: the whole tile is already
          the link, and an interactive element nested inside an anchor is both
          invalid and unreachable. Full width, one per tile — the primary
          action for exactly the one product this card is about.
        */}
        <span className="ptile-cta">View details</span>
      </div>
    </a>
  );
}
