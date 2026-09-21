/**
 * The browser half of the cart — `/api/buyer/cart`, through the same-origin
 * rewrite so the `httpOnly` refresh cookie stays first-party.
 *
 * One cart per buyer. The session identifies it, so no call here carries a cart
 * id: the first read makes the cart, and after an order converts it the next
 * read makes the next one.
 *
 * These are authenticated buyer routes, so every call can come back 401. That
 * is not an error state on this screen: it is a signed-out visitor, and the
 * screen has a path for them. `call` already returns the refusal as a value
 * rather than throwing, which is what lets the page branch on `status === 401`
 * instead of catching.
 *
 * **The types below are the server's response types, copied field for field**
 * from `CartService` (`apps/api/src/modules/ordering/internal/cart.service.ts`)
 * with `Date` narrowed to the ISO string JSON actually delivers. They are copied
 * rather than imported because the storefront may not import the API — and they
 * are allow-lists on that side, which is what guarantees no vendor identifier
 * exists to render here. Nothing in this file widens them.
 */
import { call, type ApiResult } from '../register/api';

export interface CartLine {
  itemId: string;
  /** The offer's id. A listing UUID identifies an offer, never its source. */
  offerId: string;
  title: string;
  specSummary: string;
  /** `A_PLUS` | `A` | `B`, as the grade enum spells it. */
  grade: string;
  qtyRequested: number;
  /** Sellable at the moment of the call that returned this line. */
  qtyAvailable: number;
  /** The server's sentence — "3 of the 5 units you selected are still available." */
  availability: string;
  unitPrice: string;
  lineTotal: string;
  priceChangedSinceAdded: boolean;
  dispatch: string;
}

/**
 * Lines that leave from one place.
 *
 * `label` is `Supply Point F · Noida` and carries nothing finer than the city.
 * This is a dispatch point, not a seller and not a "sub-order": there is one
 * seller on this order and one invoice.
 */
export interface DispatchGroup {
  label: string;
  lines: CartLine[];
}

export interface CartView {
  id: string;
  dispatchGroups: DispatchGroup[];
  itemCount: number;
  /**
   * Goods value of what can ship right now — **not** the landed figure. GST and
   * freight need a delivery pincode the cart has no field for; the screen says
   * so in words rather than letting a smaller number read as the total.
   */
  goodsTotal: string;
  /** At least one line cannot be filled in full. */
  needsAttention: boolean;
  updatedAt: string;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** The re-check. There is no second "revalidate" route: reading the cart is it. */
export const getCart = (): Promise<ApiResult<CartView>> =>
  call<CartView>('/api/buyer/cart', json('GET'));

/**
 * Add or re-quantify one offer. The quantity **replaces**, so sending the same
 * request twice is not the same as ordering twice — which is what makes the
 * `?listing=&qty=` hand-off from the comparison board safe to replay on reload.
 */
export const setCartLine = (listingId: string, qty: number): Promise<ApiResult<CartView>> =>
  call<CartView>('/api/buyer/cart/items', json('POST', { listingId, qty }));

export const removeCartLine = (itemId: string): Promise<ApiResult<CartView>> =>
  call<CartView>(`/api/buyer/cart/items/${itemId}`, json('DELETE'));
