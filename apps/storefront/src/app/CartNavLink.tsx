'use client';

import * as React from 'react';
import Link from 'next/link';
import { getCart } from './cart/api';
import { CART_UPDATED, type CartUpdateDetail } from '../lib/cart-state';
import { GUEST_CART_CHANGED, readGuestCart } from '../lib/guest-cart';

/**
 * The header's cart control, with a live line count.
 *
 * The header is a server component and cannot know the count after an add, so
 * this client island reads the buyer's cart and listens for updates from the
 * cart screen and the comparison board hand-off.
 *
 * It renders signed out as well as signed in. A cart that appears only after
 * you have an account tells a first-time visitor there is nowhere to put the
 * machine they are looking at, which is the wrong answer — `/cart` handles the
 * signed-out case itself.
 *
 * THE COUNT HAS TWO SOURCES, ONE PER SESSION STATE
 * ------------------------------------------------
 * **Signed in**, it is the server cart's line count, read once and then kept
 * current by `CART_UPDATED`.
 *
 * **Signed out**, it is the guest cart in this browser (`lib/guest-cart.ts`).
 * A visitor's picks live in `localStorage` until they sign in, and the badge
 * used to ignore them: the control skipped counting altogether when there was
 * no session, so an add on a product page left the top bar saying nothing.
 *
 * The guest count is read through `useSyncExternalStore` rather than an
 * effect. The header is rendered afresh by every page, so this control mounts
 * again on every navigation; an effect would set the count one paint after
 * that, and the badge would blink off and on with each page change. The store
 * hook reads the cart as part of the first client render, and hands the server
 * `null` so the hydrated markup still matches what the server drew. It
 * re-reads on every guest-cart write, and on a `storage` event, which is how
 * an add in another tab arrives.
 *
 * What it still does NOT do signed out is ask the API: there is no session,
 * the answer would be a guaranteed 401 on every page load, and the lines it
 * needs are already on the machine.
 *
 * Both counts are LINES, not units — three of one machine is one line — which
 * is what the accessible name says and what the signed-in badge always showed.
 */

function subscribeToGuestCart(onChange: () => void): () => void {
  window.addEventListener(GUEST_CART_CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(GUEST_CART_CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const guestLineCount = (): number => readGuestCart().length;
/** The server has no `localStorage`; it draws the control with no badge. */
const noCountOnServer = (): null => null;

export function CartNavLink({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [serverCount, setServerCount] = React.useState<number | null>(null);
  const guestCount = React.useSyncExternalStore(
    subscribeToGuestCart,
    guestLineCount,
    noCountOnServer,
  );

  React.useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;

    void (async () => {
      const result = await getCart();
      if (!live) return;
      setServerCount(result.ok ? result.data.itemCount : 0);
    })();

    const onUpdate = (event: Event): void => {
      const detail = (event as CustomEvent<CartUpdateDetail>).detail;
      if (detail) setServerCount(detail.lineCount);
    };
    window.addEventListener(CART_UPDATED, onUpdate);

    return () => {
      live = false;
      window.removeEventListener(CART_UPDATED, onUpdate);
    };
  }, [signedIn]);

  const count = signedIn ? serverCount : guestCount;
  const href = '/cart';

  // Glyph AND word. The icon alone reads for most people, but the label is
  // what makes the target unmistakable, and it costs one word. The accessible
  // name still spells the count out, which the badge only shows as a digit.
  const label = count !== null && count > 0 ? `Cart — ${count} lines` : 'Cart';

  return (
    <Link className="hbtn hcart" href={href} aria-label={label}>
      <span className="hcart-ic">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
