/**
 * PLACEHOLDER DATA — hardcoded in the front end by direction.
 *
 * The search API does not yet send a buyer rating, a ratings count or the
 * new-machine MRP. These stand in for them on the product card so the design
 * can be seen whole. Every card shows the same rating, and the MRP is derived
 * from our own price, so none of it is a fact about the machine.
 *
 * When the API grows these fields, delete this file and read them off
 * `SearchResult` instead; the card takes them as plain values.
 */

/** The reference design's rating: 4.5 stars from 132 buyers. */
export const PLACEHOLDER_RATING = { value: 4.5, count: 132 } as const;

/**
 * The new-machine MRP to strike through, from our price. Roughly double, then
 * rounded to end in 999 the way a retail list price does.
 */
export function placeholderMrp(fromPrice: number): number {
  return Math.max(fromPrice + 1, Math.round((fromPrice * 2) / 1000) * 1000 - 1);
}

/** Whole-number percentage off the MRP. */
export function percentOff(price: number, mrp: number): number {
  return Math.round((1 - price / mrp) * 100);
}
