/** Which cart receives the next add-from-board hand-off. */
export const ACTIVE_CART_KEY = 'tg-active-cart';

export const CART_UPDATED = 'trugrade:cart-updated';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CartUpdateDetail {
  cartId: string;
  lineCount: number;
}

export function readActiveCartId(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = sessionStorage.getItem(ACTIVE_CART_KEY);
  return stored && UUID.test(stored) ? stored : null;
}

export function rememberActiveCart(id: string): void {
  sessionStorage.setItem(ACTIVE_CART_KEY, id);
}

export function publishCartUpdate(detail: CartUpdateDetail): void {
  rememberActiveCart(detail.cartId);
  window.dispatchEvent(new CustomEvent<CartUpdateDetail>(CART_UPDATED, { detail }));
}

/** The cart route the comparison board hands off to. */
export function buildCartAddUrl(listingId: string, qty: number): string {
  const params = new URLSearchParams({
    listing: listingId,
    qty: String(qty),
  });
  const cartId = readActiveCartId();
  if (cartId) params.set('cart', cartId);
  return `/cart?${params.toString()}`;
}

export function resolveTargetCartId(
  carts: readonly { id: string }[],
  urlCartId: string | null,
): string | null {
  if (urlCartId && carts.some((c) => c.id === urlCartId)) return urlCartId;
  const remembered = readActiveCartId();
  if (remembered && carts.some((c) => c.id === remembered)) return remembered;
  return carts[0]?.id ?? null;
}
