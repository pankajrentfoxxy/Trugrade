'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useProductCart } from '../../../lib/use-product-cart';

/**
 * A fixed hand-off to the cart after an add on the comparison board.
 * Hidden on `/cart` and when the buyer dismisses it; reappears on the next add.
 */
export function ViewCartDock(): React.JSX.Element | null {
  const pathname = usePathname();
  const { itemCount, cartId, cartDockDismissed, dismissCartDock } = useProductCart();

  if (pathname.startsWith('/cart') || itemCount < 1 || cartDockDismissed) return null;

  const href = cartId ? `/cart?cart=${encodeURIComponent(cartId)}` : '/cart';

  return (
    <div className="cartdock" role="status" aria-live="polite">
      <Link className="cartdock-link pill acc" href={href}>
        View cart
        <span className="cartdock-count mono tnum" aria-label={`${itemCount} in cart`}>
          {itemCount}
        </span>
      </Link>
      <button
        type="button"
        className="cartdock-close"
        aria-label="Dismiss"
        onClick={dismissCartDock}
      >
        ×
      </button>
    </div>
  );
}
