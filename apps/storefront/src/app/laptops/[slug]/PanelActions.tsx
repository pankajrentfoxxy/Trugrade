'use client';

import * as React from 'react';
import { useProductCart } from '../../../lib/use-product-cart';
import type { GuestCartSnapshot } from '../../../lib/guest-cart';
import { demandPincode } from './pincode-demand';
import { checkoutDestination } from '../../cart/checkout-entry';

/**
 * The sticky panel's two buttons.
 *
 * **They buy from a named supply point, not from "the product".** There is no
 * such thing as adding a Latitude 5420 to the cart here — two supply points
 * hold it at two landed prices, and the row is what the order line is against.
 * So the panel acts on the lowest-landed offer and says which city that is; a
 * buyer who wants a different source uses the board, where every row has its
 * own control.
 *
 * Both buttons stay live before a pincode, but neither adds anything until
 * one is set: a click without it sends the buyer to the pincode box, which
 * says why. A landed price is what goes in the cart, and the pincode is what
 * lands it.
 */
export function PanelActions({
  listingId,
  city,
  pincode,
  snapshot,
  blocked,
}: {
  /** The lowest-landed offer's listing, or null before the board is priced. */
  listingId: string | null;
  city: string | null;
  /** The delivery pincode the board is priced to, or null before one is given. */
  pincode: string | null;
  /** What a signed-out basket records for this line. Null when unpriced. */
  snapshot: GuestCartSnapshot | null;
  /**
   * Why nothing can be added yet, or null when something can: no pincode, an
   * unserviceable one, or no stock at this grade. The buttons stay on screen,
   * shut, with the sentence under them — a panel with no buttons at all read
   * as a machine that could not be bought.
   */
  blocked: { reason: string; needsPincode: boolean } | null;
}): React.JSX.Element | null {
  const { qtyFor, busyListingId, addListing, signedIn } = useProductCart();
  const [goingToCart, setGoingToCart] = React.useState(false);

  if (!listingId || !snapshot) {
    if (!blocked) return null;
    // `aria-disabled` rather than `disabled`: a disabled button is skipped by
    // the keyboard and announces nothing, so the reason could never be read.
    // On the pincode case a click goes to the box that unblocks it.
    const shut = (label: string, className: string): React.JSX.Element => (
      <button
        type="button"
        className={className}
        aria-disabled="true"
        aria-describedby="pv-blocked"
        onClick={blocked.needsPincode ? demandPincode : undefined}
      >
        {label}
      </button>
    );
    return (
      <>
        <div className="pv-actions" data-blocked="true">
          {shut('Add to cart', 'pvbtn pvbtn-cart')}
          {shut('Buy now', 'pvbtn pvbtn-buy')}
        </div>
        <p id="pv-blocked" className="pv-from" data-testid="pv-blocked">
          {blocked.reason}
        </p>
      </>
    );
  }

  const inCart = qtyFor(listingId);
  const busy = busyListingId === listingId || goingToCart;

  const add = (): void => {
    if (!pincode) {
      demandPincode();
      return;
    }
    void addListing(listingId, 1, snapshot);
  };

  /**
   * Straight to checkout, not to the cart. Checkout is opened on a cart id,
   * which only a signed-in buyer's cart has: a guest's line is written to
   * their basket and they go to sign in with the cart as the way back, where
   * the basket merges and "Continue to checkout" is one click on.
   */
  const buy = (): void => {
    if (!pincode) {
      demandPincode();
      return;
    }
    setGoingToCart(true);
    void addListing(listingId, 1, snapshot).then(async (cartId) => {
      if (cartId === null) {
        if (signedIn === false) {
          window.location.href = `/sign-in?next=${encodeURIComponent('/cart')}`;
        } else {
          // The add did not land and the hook has already said why (a lost
          // session redirects; anything else leaves the panel to try again).
          setGoingToCart(false);
        }
        return;
      }
      window.location.href = await checkoutDestination(cartId);
    });
  };

  return (
    <>
      <div className="pv-actions">
        <button type="button" className="pvbtn pvbtn-cart" onClick={add} disabled={busy}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="20" r="1.4" />
            <circle cx="17.5" cy="20" r="1.4" />
            <path d="M3 3.8h2.6l2.1 12h11l2.3-8.6H6.2" />
          </svg>
          {inCart ? `In cart · ${inCart}` : 'Add to cart'}
        </button>
        <button type="button" className="pvbtn pvbtn-buy" onClick={buy} disabled={busy}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
          </svg>
          Buy now
        </button>
      </div>
      {/* Which source the two buttons act on. Without this the panel is
          buying from an unnamed one of several. */}
      <p className="pv-from">
        From the lowest-priced row{city ? <> · {city}</> : null}. Other supply points are on the
        board below.
      </p>
    </>
  );
}
