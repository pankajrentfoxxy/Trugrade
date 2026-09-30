import { GradeBadge } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import Link from 'next/link';
import { DealCountdown } from './DealCountdown';
import type { SuggestedItem } from './SuggestedRow';

/**
 * The deal-of-the-day card: one machine, its price, and a clock, in a card of
 * its own between the filter strip and the carousel on the homepage.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * The machine is a real SKU from the same search response the rest of the
 * homepage renders, so the grade, the name, the spec and the price are the
 * ones its own page will show. It is picked by the calendar day in India, so
 * every buyer sees the same one all day and a different one tomorrow.
 *
 * **The clock counts to that change, and says so.** It reads "Next deal in",
 * not "Offer ends in": the API has no deal price and no offer window, so the
 * price on the card is the listing's ordinary price and does not expire at
 * midnight. A clock that implied it did would be the false-urgency pattern the
 * CCPA dark-pattern guidance names. When the API grows a real deal — a price
 * and an end time — read both from it and the wording can change with them.
 *
 * The "% off" is the one placeholder: the API sends no new-machine MRP, so it
 * comes from `search/placeholder-market.ts`, hardcoded by direction, and is
 * the same figure this SKU's card carries on `/search`.
 *
 * The image is the brand-representative render the rest of the homepage uses,
 * never a unit photograph — see `lib/brand-photo.ts`. A brand the design has
 * no render for gets the drawn shell.
 *
 * HOW IT LOOKS
 * ------------
 * Warm black and amber, in both themes: the promo palette's root constants,
 * the same language as the supplied hero design. It is the one surface on the
 * page dressed as an offer, so it is held apart from the product surfaces
 * rather than themed with them. The whole card is one link, so the hit area
 * is the card and the keyboard meets a single stop; "View deal" is drawn as a
 * button but is a label inside that link, not a second one.
 */
const GRADES: readonly Grade[] = ['A_PLUS', 'A', 'B'];
const isGrade = (value: string): value is Grade => (GRADES as readonly string[]).includes(value);

/** India has one time zone and no daylight saving, so the offset is a constant. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which of `count` machines is today's, and the instant it stops being so.
 * `count` must be at least 1.
 */
export function dealOfDaySlot(now: number, count: number): { index: number; endsAt: number } {
  const istDay = Math.floor((now + IST_OFFSET_MS) / DAY_MS);
  return { index: istDay % count, endsAt: (istDay + 1) * DAY_MS - IST_OFFSET_MS };
}

export function DealOfDay({
  item,
  endsAt,
}: {
  item: SuggestedItem;
  /** Epoch milliseconds of the next midnight in India. */
  endsAt: number;
}): React.JSX.Element {
  return (
    <section className="dotd" aria-label="Deal of the day">
      <Link className="dotd-card" href={`/laptops/${item.skuId}?grade=${item.grade}`}>
        <span className="dotd-flag">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
          </svg>
          <span className="dotd-flag-text">
            <span>Deal of</span>
            <span>the day</span>
          </span>
        </span>

        <span className="dotd-media">
          {item.photo ? (
            <img className="dotd-photo" src={item.photo} alt="" decoding="async" />
          ) : (
            <svg className="dotd-shell" viewBox="0 0 150 80" fill="none" aria-hidden="true">
              <rect x="27" y="10" width="96" height="56" rx="3" stroke="currentColor" strokeWidth="2" />
              <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </span>

        <span className="dotd-item">
          <b className="dotd-name">
            {item.brand} {item.model}
          </b>
          <span className="dotd-meta">
            {isGrade(item.grade) && <GradeBadge grade={item.grade} className="dotd-grade" />}
            {item.spec && <span className="dotd-spec mono">{item.spec}</span>}
          </span>
        </span>

        <span className="dotd-price">
          <span className="dotd-price-row">
            <b className="dotd-now mono">₹{item.price}</b>
            <span className="dotd-off">
              <span className="mono">{item.off}%</span> off
            </span>
          </span>
          <small>from · incl. GST</small>
        </span>

        <span className="dotd-timer">
          <span className="dotd-timer-label">Next deal in</span>
          <DealCountdown endsAt={endsAt} />
        </span>

        <span className="dotd-cta">
          <span className="dotd-cta-text">View deal</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </Link>
    </section>
  );
}
