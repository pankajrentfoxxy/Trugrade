/**
 * The current campaign, in one place: the strip under the search page's
 * header and the offer lines on the product page both read it, so a change of
 * campaign is a change here and the two never disagree.
 */
export const OFFER = {
  title: 'FLEET WEEK',
  /** The volume offer, in the strip's words and the product page's. */
  volume: '₹500 off per machine on 10+',
  volumeDetail: '₹500 off per machine on 10+ units',
  /** The first-order offer, up to the code. */
  firstOrder: 'extra 5% on your first order with',
  firstOrderDetail: 'extra 5% up to ₹2,000 with',
  code: 'TRUFIRST',
  ends: 'ends Sunday',
} as const;
