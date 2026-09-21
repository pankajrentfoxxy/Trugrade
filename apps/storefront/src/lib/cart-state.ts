/**
 * What the cart tells the rest of the storefront.
 *
 * One cart per buyer, identified by the session, so there is nothing to
 * remember about *which* cart — only how many lines it holds, which the header
 * badge shows and the product page's dock repeats.
 */
export const CART_UPDATED = 'trugrade:cart-updated';

export interface CartUpdateDetail {
  lineCount: number;
}

export function publishCartUpdate(detail: CartUpdateDetail): void {
  window.dispatchEvent(new CustomEvent<CartUpdateDetail>(CART_UPDATED, { detail }));
}

/** The cart route the comparison board hands off to. */
export function buildCartAddUrl(listingId: string, qty: number): string {
  const params = new URLSearchParams({ listing: listingId, qty: String(qty) });
  return `/cart?${params.toString()}`;
}
