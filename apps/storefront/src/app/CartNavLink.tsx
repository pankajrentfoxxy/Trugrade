'use client';

import * as React from 'react';
import Link from 'next/link';
import { listCarts } from './cart/api';
import {
  CART_UPDATED,
  readActiveCartId,
  type CartUpdateDetail,
} from '../lib/cart-state';

/**
 * Signed-in cart control with a live line count.
 *
 * The header is a server component and cannot know the count after an add, so
 * this client island reads the buyer's carts and listens for updates from the
 * cart screen and the comparison board hand-off.
 */
export function CartNavLink(): React.JSX.Element {
  const [count, setCount] = React.useState<number | null>(null);

  const applyCount = React.useCallback((carts: readonly { id: string; lineCount: number }[]) => {
    const active = readActiveCartId();
    const cart = active ? carts.find((c) => c.id === active) : carts[0];
    setCount(cart?.lineCount ?? 0);
  }, []);

  React.useEffect(() => {
    let live = true;

    void (async () => {
      const result = await listCarts();
      if (!live) return;
      if (result.ok) applyCount(result.data);
      else setCount(0);
    })();

    const onUpdate = (event: Event): void => {
      const detail = (event as CustomEvent<CartUpdateDetail>).detail;
      if (detail) setCount(detail.lineCount);
    };
    window.addEventListener(CART_UPDATED, onUpdate);

    return () => {
      live = false;
      window.removeEventListener(CART_UPDATED, onUpdate);
    };
  }, [applyCount]);

  const href = '/cart';

  return (
    <Link className="hbtn hide-sm hcart" href={href}>
      <span>
        <small>Your</small>
        <strong>Cart</strong>
      </span>
      {count !== null && count > 0 && (
        <span className="hcart-badge mono" aria-label={`${count} lines in cart`}>
          {count}
        </span>
      )}
    </Link>
  );
}
