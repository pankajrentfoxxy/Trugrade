import { GradeBadge } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import Link from 'next/link';
import type { Route } from 'next';
import type { SearchResult } from '../../lib/api';
import { brandPhoto } from '../../lib/brand-photo';
import { DeliveryBy } from '../DeliveryBy';
import { WishlistHeart } from '../WishlistHeart';
import { storageShortLabel } from './storage-label';
import { PLACEHOLDER_RATING, percentOff, placeholderMrp } from './placeholder-market';

/**
 * The list view: one wide card per model — picture, what the machine is,
 * then the price and the way in.
 *
 * Drawn to the supplied design, with three parts left out by direction: the
 * compare checkbox and the Add to cart button. The heart saves the model at
 * this grade to the wishlist, the same control the grid card carries.
 *
 * What is real and what is not is the same as on the grid card: every spec,
 * grade, battery band, unit count and price comes from the search response;
 * the rating, the struck-through new price and the saving are the placeholders
 * in `placeholder-market.ts`. A measurement the inspection did not take says
 * "Not measured" — never a zero, which would read as a failed machine.
 */
const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const GRADES: readonly Grade[] = ['A_PLUS', 'A', 'B'];
const isGrade = (value: string): value is Grade => (GRADES as readonly string[]).includes(value);
const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

const NOT_MEASURED = <span className="notmeasured">Not measured</span>;

function battery(r: SearchResult): React.ReactNode {
  if (r.batteryMin === null || r.batteryMax === null || r.batteryMeasured === 0)
    return NOT_MEASURED;
  const band =
    r.batteryMin === r.batteryMax ? `${r.batteryMin}%` : `${r.batteryMin}–${r.batteryMax}%`;
  return (
    <>
      <span className="mono">{band}</span>{' '}
      <span className="lrow-den mono">
        ({`${r.batteryMeasured} of ${r.unitsAvailable}`} measured)
      </span>
    </>
  );
}

function score(r: SearchResult): React.ReactNode {
  if (r.avgQcScore === null) return NOT_MEASURED;
  return <span className="mono">{Math.round(r.avgQcScore)} / 100</span>;
}

function LaptopShell(): React.JSX.Element {
  return (
    <svg className="lrow-shell" viewBox="0 0 150 80" fill="none" aria-hidden="true">
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

function ListCard({
  r,
  deliveryBy,
}: {
  r: SearchResult;
  deliveryBy: string | null;
}): React.JSX.Element {
  const photo = brandPhoto(r.brand);
  const mrp = placeholderMrp(r.fromPrice);
  const off = percentOff(r.fromPrice, mrp);
  const kind = storageShortLabel(r.storageType);
  const storage = r.storageGb > 0 ? `${r.storageGb} GB${kind ? ` ${kind}` : ''}` : null;
  const memory = r.ramGb > 0 ? `${r.ramGb} GB` : null;
  const config = [r.cpuLine, memory, storage].filter(Boolean).join(' / ');
  const href = `/laptops/${r.skuId}?grade=${r.grade}` as Route;

  return (
    <article className="lrow">
      <WishlistHeart
        skuId={r.skuId}
        grade={r.grade}
        name={`${r.brand} ${r.model}`}
        className="wl-heart lrow-heart"
      />
      <Link className="lrow-media" href={href} tabIndex={-1} aria-hidden="true">
        {isGrade(r.grade) && <GradeBadge grade={r.grade} className="lrow-grade" />}
        {photo ? <img className="lrow-photo" src={photo} alt="" loading="lazy" /> : <LaptopShell />}
      </Link>

      <div className="lrow-body">
        <p className="lrow-brand">{r.brand}</p>
        <h3 className="lrow-name">
          <Link href={href}>
            {r.brand} {r.model}
            {config ? ` (${config})` : ''}
          </Link>
        </h3>
        <p className="lrow-rate">
          <span className="lrow-rate-pill">
            <span className="mono">{PLACEHOLDER_RATING.value.toFixed(1)}</span>
            <StarIcon />
          </span>
          <span>
            <span className="mono">{PLACEHOLDER_RATING.count.toLocaleString('en-IN')}</span> ratings
          </span>
        </p>
        <ul className="lrow-facts">
          {r.cpuLine ? <li>{r.cpuLine} processor</li> : null}
          {memory || storage ? (
            <li>{[memory ? `${memory} RAM` : null, storage].filter(Boolean).join(' · ')}</li>
          ) : null}
          {r.displayLine ? <li>{r.displayLine} display</li> : null}
          <li>
            Grade {GRADE_LABEL[r.grade] ?? r.grade} · battery health {battery(r)} · inspection score{' '}
            {score(r)}
          </li>
          <li>Tested on 12 areas, tamper-sealed, one GST invoice</li>
        </ul>
      </div>

      <div className="lrow-side">
        <p className="lrow-price">
          <span className="lrow-now mono">₹{RUPEES.format(r.fromPrice)}</span>
          <s className="lrow-mrp mono">₹{RUPEES.format(mrp)}</s>
          <span className="lrow-off">
            <span className="mono">{off}%</span> off
          </span>
        </p>
        <p className="lrow-sub">incl. GST · from price</p>
        <DeliveryBy date={deliveryBy} className="lrow-delivery" />
        <p className="lrow-stock">
          <span className="mono">{r.unitsAvailable}</span> sealed unit
          {r.unitsAvailable === 1 ? '' : 's'} · <span className="mono">{r.supplyPoints}</span>{' '}
          supply point{r.supplyPoints === 1 ? '' : 's'}
          {r.cities.length > 0 ? ` · ${r.cities.join(', ')}` : ''}
        </p>
        <Link className="lrow-cta" href={href}>
          View details
        </Link>
      </div>
    </article>
  );
}

export function ResultsList({
  results,
  sortLabel,
  deliveryBy,
}: {
  results: readonly SearchResult[];
  /** Announced with the count: a sort read off a header arrow is invisible. */
  sortLabel: string;
  /** "Sat, 3 Oct" for a result, or null for none. */
  deliveryBy?: (r: SearchResult) => string | null;
}): React.JSX.Element {
  return (
    <section className="lrows" aria-label={`${results.length} models, sorted by ${sortLabel}`}>
      {results.map((r) => (
        <ListCard key={`${r.skuId}-${r.grade}`} r={r} deliveryBy={deliveryBy?.(r) ?? null} />
      ))}
    </section>
  );
}
