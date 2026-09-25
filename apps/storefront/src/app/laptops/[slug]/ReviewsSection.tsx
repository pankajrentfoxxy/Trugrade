'use client';

import * as React from 'react';
import { Carousel } from '@trugrade/ui';
import { PRODUCT_RATING, SAMPLE_REVIEWS, Stars } from './product-rating';

/**
 * "Ratings and reviews" on the product page.
 *
 * **PLACEHOLDER CONTENT — frontend only, not wired to any database.** The
 * sample data and the one `PRODUCT_RATING` figure this section shows live in
 * `product-rating.tsx`, a plain module with no `'use client'` directive, so
 * the title block at the top of the record column (`page.tsx`, a Server
 * Component) can read the same figure directly rather than through this
 * client component. See that file's header for why the split exists and for
 * the reviews-backend notice.
 *
 * Per the redesign: no star-by-star breakdown bars. Just the headline
 * average and a rail of comment cards.
 *
 * **A rail, not a wall.** Six cards at a time, same shared `Carousel` the
 * "you may also like" rail uses below it, so a buyer scrolls sideways rather
 * than the page growing by one review-height per rating. When there are more
 * than six, the seventh slot in the track is a "view all" tile rather than a
 * seventh card — the count is stated up front instead of discovered by
 * scrolling past the end and finding nothing there.
 */

/** How many cards sit in the track before the "view all" tile replaces a seventh. */
const VISIBLE_COUNT = 6;

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });

function monthOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : MONTH.format(d);
}

export function ReviewsSection(): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);

  const { average, count } = PRODUCT_RATING;
  const hiddenCount = count - VISIBLE_COUNT;
  const shown = expanded ? SAMPLE_REVIEWS : SAMPLE_REVIEWS.slice(0, VISIBLE_COUNT);

  return (
    <section className="rev" aria-labelledby="rev-h" data-testid="reviews">
      <h2 className="sec-t" id="rev-h">
        Ratings and reviews
      </h2>

      <div className="rev-card">
        <div className="rev-sum">
          <span className="mono rev-avg-n">
            {average.toFixed(1)}
            <span className="denom"> / 5</span>
          </span>
          <Stars rating={average} />
          <span className="rev-basis">
            Based on <b className="mono">{count}</b> reviews
          </span>
        </div>

        <Carousel label="Ratings and reviews" className="rev-rail" trackClassName="rev-track">
          {shown.map((r) => (
            <article key={r.id} className="rev-item">
              <div className="rev-item-h">
                <Stars rating={r.rating} />
                <span className="rev-when">{monthOf(r.reviewedOn)}</span>
              </div>
              <p className="rev-text">{r.comment}</p>
              <span className="rev-verified">{r.authorName} · Verified buyer</span>
            </article>
          ))}
          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              className="rev-item rev-more"
              onClick={() => setExpanded(true)}
            >
              <span className="rev-more-count mono">+{hiddenCount}</span>
              <span className="rev-more-label">View all {count} reviews</span>
            </button>
          )}
        </Carousel>
      </div>
    </section>
  );
}
