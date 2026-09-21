'use client';

import * as React from 'react';
import { useProductCart } from '../../../lib/use-product-cart';
import type { GuestCartSnapshot } from '../../../lib/guest-cart';

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
 * Both buttons are dark until a pincode makes a landed price real. Before that
 * there is no lowest row to add — the board has not been priced.
 */
export function PanelActions({
  listingId,
  city,
  snapshot,
  disabledReason,
}: {
  /** The lowest-landed offer's listing, or null before the board is priced. */
  listingId: string | null;
  city: string | null;
  /** What a signed-out basket records for this line. Null when unpriced. */
  snapshot: GuestCartSnapshot | null;
  /** Shown in place of the buttons when there is nothing to add. */
  disabledReason?: string;
}): React.JSX.Element {
  const { qtyFor, busyListingId, addListing } = useProductCart();
  const [goingToCart, setGoingToCart] = React.useState(false);

  if (!listingId || !snapshot) {
    return <p className="pv-blocked">{disabledReason ?? 'Enter a delivery pincode to buy.'}</p>;
  }

  const inCart = qtyFor(listingId);
  const busy = busyListingId === listingId || goingToCart;

  const add = (): void => {
    void addListing(listingId, 1, snapshot);
  };

  const buy = (): void => {
    setGoingToCart(true);
    void addListing(listingId, 1, snapshot).then(() => {
      window.location.href = '/cart';
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
        From the lowest landed row{city ? <> · {city}</> : null}. Other supply points are on the
        board below.
      </p>
    </>
  );
}
