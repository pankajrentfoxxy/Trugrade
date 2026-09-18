'use client';

import * as React from 'react';
import Link from 'next/link';
import { listCarts } from './cart/api';
import { CART_UPDATED, readActiveCartId, type CartUpdateDetail } from '../lib/cart-state';

/**
 * The header's cart control, with a live line count.
 *
 * The header is a server component and cannot know the count after an add, so
 * this client island reads the buyer's carts and listens for updates from the
 * cart screen and the comparison board hand-off.
 *
 * It renders signed out as well as signed in. A cart that appears only after
 * you have an account tells a first-time visitor there is nowhere to put the
 * machine they are looking at, which is the wrong answer — `/cart` handles the
 * signed-out case itself. What it does NOT do signed out is ask the API for a
 * count: there is no session, the answer would be a guaranteed 401 on every
 * page load, and a count nobody can have is not worth a request.
 */
export function CartNavLink({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [count, setCount] = React.useState<number | null>(null);

  const applyCount = React.useCallback((carts: readonly { id: string; lineCount: number }[]) => {
    const active = readActiveCartId();
    const cart = active ? carts.find((c) => c.id === active) : carts[0];
    setCount(cart?.lineCount ?? 0);
  }, []);

  React.useEffect(() => {
    if (!signedIn) return undefined;
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
  }, [applyCount, signedIn]);

  const href = '/cart';

  // Glyph AND word. The icon alone reads for most people, but the label is
  // what makes the target unmistakable, and it costs one word. The accessible
  // name still spells the count out, which the badge only shows as a digit.
  const label = count !== null && count > 0 ? `Cart — ${count} lines` : 'Cart';

  return (
    <Link className="hbtn hcart" href={href} aria-label={label}>
      <span className="hcart-ic">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 4h2.2l2.4 10.4a1.6 1.6 0 0 0 1.6 1.2h7.9a1.6 1.6 0 0 0 1.6-1.2L20.5 7H6.2"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="19.4" r="1.4" fill="currentColor" />
          <circle cx="17" cy="19.4" r="1.4" fill="currentColor" />
        </svg>
        {count !== null && count > 0 && (
          <span className="hcart-badge mono" aria-hidden="true">
            {count}
          </span>
        )}
      </span>
      <strong>Cart</strong>
    </Link>
  );
}
