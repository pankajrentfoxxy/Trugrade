import { GradeBadge, ScoreRing } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import type { SearchResult } from '../../lib/api';
import { storageShortLabel } from './storage-label';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const GRADES: readonly Grade[] = ['A_PLUS', 'A', 'B'];
const isGrade = (value: string): value is Grade => (GRADES as readonly string[]).includes(value);

function LaptopThumb(): React.JSX.Element {
  return (
    <svg width="112" height="64" viewBox="0 0 150 80" fill="none" aria-hidden="true">
      <rect x="27" y="10" width="96" height="56" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PinIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-4.35 7-10a7 7 0 1 0-14 0c0 5.65 7 10 7 10z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** One labelled spec cell. `null` is said, never left to read as a value. */
function Spec({ label, value }: { label: string; value: React.ReactNode | null }): React.JSX.Element {
  return (
    <li>
      <small>{label}</small>
      {value ?? <span className="ptile-unmeasured">Not published</span>}
    </li>
  );
}

/**
 * One search hit, as a visual product tile.
 *
 * Photo panel, then the two measured numbers, then the specs, then the price —
 * the order a buyer scans a grid in. Three rules shape what it may say:
 *
 *   - **The grade is neutral.** A+, A and B are all sellable, so the ribbon is
 *     `GradeBadge` rather than a green/amber pill. Colouring a position on a
 *     scale as a verdict is the one thing the badge exists to prevent.
 *   - **Nothing unmeasured renders as measured.** `ScoreRing` draws a dashed
 *     ring reading "—" for a null score; an unmeasured battery says so in
 *     `--ink-4` instead of drawing an empty meter that reads as zero.
 *   - **Every percentage carries its denominator.** A battery range is quoted
 *     against how many of the sealed units were actually opened and measured,
 *     because "82–89%" across six machines when one was measured is a
 *     different claim from the same range across all six.
 */
export function SearchResultCard({ r }: { r: SearchResult }): React.JSX.Element {
  const measured = r.batteryMeasured > 0 && r.batteryMin !== null && r.batteryMax !== null;
  const batteryLabel = measured
    ? r.batteryMin === r.batteryMax
      ? `${r.batteryMin}%`
      : `${r.batteryMin}–${r.batteryMax}%`
    : null;
  // The meter's own fill, at the midpoint of the range it is drawn for.
  const batteryFill = measured ? Math.min(100, Math.max(4, (r.batteryMin! + r.batteryMax!) / 2)) : 0;

  const storageShort = storageShortLabel(r.storageType);
  const cities = r.cities.join(', ');

  return (
    <a className="ptile" href={`/laptops/${r.skuId}?grade=${r.grade}`}>
      <div className="ptile-media">
        {isGrade(r.grade) && <GradeBadge grade={r.grade} className="ptile-ribbon" />}
        <span className="ptile-sealed">
          <b className="mono">{r.unitsAvailable}</b> sealed
        </span>
        <LaptopThumb />
      </div>

      <div className="ptile-body">
        <b className="ptile-name">
          {r.brand} {r.model}
        </b>
        <p className="ptile-loc">
          <PinIcon />
          <span>
            <b className="mono">{r.supplyPoints}</b> supply point{r.supplyPoints === 1 ? '' : 's'}
            {cities ? ` · ${cities}` : ''}
          </span>
        </p>

        <div className="ptile-health">
          <ScoreRing value={r.avgQcScore} size={46} label="of 100" />
          <div className="ptile-health-info">
            <small>Battery health</small>
            {batteryLabel === null ? (
              <p className="ptile-unmeasured ptile-batt-none">
                Not measured on any of the {r.unitsAvailable} sealed
              </p>
            ) : (
              <>
                <span className="ptile-batt-track" aria-hidden="true">
                  <i style={{ width: `${batteryFill}%` }} />
                </span>
                <p className="ptile-batt-num">
                  <span className="mono">{batteryLabel}</span>{' '}
                  <span>
                    of original · <span className="mono">{r.batteryMeasured}</span> of{' '}
                    <span className="mono">{r.unitsAvailable}</span> measured
                  </span>
                </p>
              </>
            )}
          </div>
        </div>

        <ul className="ptile-specs">
          <Spec label="RAM" value={r.ramGb > 0 ? <span className="mono">{r.ramGb} GB</span> : null} />
          <Spec
            label="Storage"
            value={
              r.storageGb > 0 && storageShort ? (
                <span className="mono">
                  {r.storageGb} GB {storageShort}
                </span>
              ) : null
            }
          />
          <Spec label="Processor" value={r.cpuLine || null} />
          <Spec label="Display" value={r.displayLine || null} />
        </ul>

        <div className="ptile-cta-row">
          <div className="ptile-price">
            <span className="mono">₹{RUPEES.format(r.fromPrice)}</span>
            <small>from · incl. GST</small>
          </div>
          {/*
            Styled as a button, rendered as a span: the whole tile is already
            the link, and an interactive element nested inside an anchor is both
            invalid and unreachable. Not amber either — a grid of these would be
            twenty-four primary actions on one screen.
          */}
          <span className="ptile-cta">View details</span>
        </div>
      </div>
    </a>
  );
}
