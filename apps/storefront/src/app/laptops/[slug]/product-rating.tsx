/**
 * The placeholder review data and the one rating figure derived from it, in
 * a plain module rather than inside `ReviewsSection.tsx`.
 *
 * `ReviewsSection.tsx` is a Client Component (`'use client'`, it owns the
 * "view all" toggle); `page.tsx` — the SKU page — is a Server Component. A
 * Server Component can render a Client Component's JSX, but it cannot read a
 * plain exported VALUE like `PRODUCT_RATING.average` back out of a
 * `'use client'` module — every export of a client module becomes an opaque
 * client reference at the server/client boundary, not the real object, and
 * reading a property off it throws during render. This file has no
 * `'use client'` directive, so both sides import the same values directly,
 * with no boundary between them to cross.
 *
 * **PLACEHOLDER CONTENT — frontend only, not wired to any database.** The
 * reviews backend (`platform.buyer_review` read, per-model attribution) is a
 * later piece of work; ownership: platform team, tracked alongside the QA
 * endpoint. Nothing here is read from `platform.buyer_review` and nothing
 * here writes to it. When the real endpoint exists, this file's contents
 * come from it instead, and this notice comes out.
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
export const SAMPLE_REVIEWS: SampleReview[] = [
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
  {
    id: 'r7',
    rating: 5,
    authorName: 'Sandeep V.',
    comment:
      "Ordered for a new hire's onboarding kit. Setup was quick and the unit had none of the sticker residue or dust the last refurb vendor we tried left behind.",
    reviewedOn: '2026-07-02',
  },
  {
    id: 'r8',
    rating: 4,
    authorName: 'Meera J.',
    comment:
      'Screen colour is slightly warmer than a new unit but well within what the grade promised. Would buy from Trugrade again for a bulk order.',
    reviewedOn: '2026-06-20',
  },
];

/**
 * The one rating for this SKU — average and count over `SAMPLE_REVIEWS` —
 * read by both the title block at the top of the record column and the
 * "Ratings and reviews" section further down, so the page states one
 * placeholder figure, not two that could disagree.
 */
export const PRODUCT_RATING = {
  average: SAMPLE_REVIEWS.reduce((sum, r) => sum + r.rating, 0) / SAMPLE_REVIEWS.length,
  count: SAMPLE_REVIEWS.length,
};

/** Five star glyphs, `rating` of them filled. No hooks, no browser API — safe from a Server Component. */
export function Stars({ rating }: { rating: number }): React.JSX.Element {
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
