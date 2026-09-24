/**
 * "Ratings and reviews" on the product page.
 *
 * **PLACEHOLDER CONTENT — frontend only, not wired to any database.** The
 * reviews backend (`platform.buyer_review` read, per-model attribution) is a
 * later piece of work; ownership: platform team, tracked alongside the QA
 * endpoint. Until that lands, this renders a fixed set of sample reviews so
 * the layout and design can be reviewed and built against. Nothing on this
 * page is read from `platform.buyer_review` and nothing here writes to it.
 * When the real endpoint exists, swap `SAMPLE_REVIEWS` for its response and
 * delete this notice.
 *
 * Per the redesign: no star-by-star breakdown bars. Just the headline
 * average and a grid of comment cards.
 */

export interface SampleReview {
  id: string;
  rating: number;
  authorName: string;
  comment: string;
  /** ISO date, no time: the day is the fact, the clock is noise. */
  reviewedOn: string;
}

/** Placeholder only — see file header. */
const SAMPLE_REVIEWS: SampleReview[] = [
  {
    id: 'r1',
    rating: 5,
    authorName: 'Ankit R.',
    comment:
      'Arrived sealed exactly as the listing described. Battery health was 86%, matching the board, and the keyboard shows no wear at all for a Grade A unit.',
    reviewedOn: '2026-09-10',
  },
  {
    id: 'r2',
    rating: 4,
    authorName: 'Priya S.',
    comment:
      'Good value for the price. One small scuff on the lid corner that was not called out in the photos, but nothing that affects use. Delivery was on time.',
    reviewedOn: '2026-09-02',
  },
  {
    id: 'r3',
    rating: 5,
    authorName: 'Karthik M.',
    comment:
      'Bought three units for our design team. All three passed our own checks on arrival — screens, ports, and battery all matched the certificate.',
    reviewedOn: '2026-08-22',
  },
  {
    id: 'r4',
    rating: 3,
    authorName: 'Fatima A.',
    comment:
      'Machine works fine but the charger brick supplied was bulkier than expected. Would have liked that mentioned on the listing.',
    reviewedOn: '2026-08-11',
  },
  {
    id: 'r5',
    rating: 5,
    authorName: 'Rohit V.',
    comment:
      'Second laptop we have ordered from Trugrade for the office. Invoice and warranty card came through immediately after delivery. No complaints.',
    reviewedOn: '2026-07-29',
  },
  {
    id: 'r6',
    rating: 4,
    authorName: 'Deepa N.',
    comment:
      'Cosmetic grade was accurate — a couple of light scratches on the base, as graded. Performance has been solid for daily spreadsheet and video call use.',
    reviewedOn: '2026-07-15',
  },
];

function Stars({ rating }: { rating: number }): React.JSX.Element {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="rev-stars" role="img" aria-label={`${filled} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : undefined} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });

function monthOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : MONTH.format(d);
}

export function ReviewsSection(): React.JSX.Element {
  const count = SAMPLE_REVIEWS.length;
  const average = SAMPLE_REVIEWS.reduce((sum, r) => sum + r.rating, 0) / count;

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

        <ul className="rev-list">
          {SAMPLE_REVIEWS.map((r) => (
            <li key={r.id} className="rev-item">
              <div className="rev-item-h">
                <Stars rating={r.rating} />
                <span className="rev-when">{monthOf(r.reviewedOn)}</span>
              </div>
              <p className="rev-text">{r.comment}</p>
              <span className="rev-verified">{r.authorName} · Verified buyer</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
