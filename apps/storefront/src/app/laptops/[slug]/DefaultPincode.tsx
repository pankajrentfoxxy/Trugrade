'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { getAddresses, type OrgAddress } from '../../(portal)/api';
import { useProductCart } from '../../../lib/use-product-cart';

/**
 * A signed-in buyer's pincode, filled in for them.
 *
 * The board is priced to a pincode and the pincode lives in the URL, so a
 * buyer arriving without one sees unit prices and a box to fill. A buyer we
 * already know has a default delivery site, and its pincode is the one they
 * would type. So once the session probe says they are signed in, the site is
 * read and the page is re-opened with its pincode — through the URL, as a
 * typed one would be, so the link they then copy carries it.
 *
 * Three things it will not do. It never overrides a pincode already in the
 * URL: a typed one, or one in a link a colleague sent, is a choice. It runs
 * once per page, so the buyer can clear the box afterwards without being
 * refilled. And it does nothing for a guest — there is no site to read, and
 * the box asks them as before.
 */

/** The site the buyer would name: the default one, else the first still open. */
export function defaultDeliveryPincode(delivery: readonly OrgAddress[]): string | null {
  const open = delivery.filter((a) => a.isActive);
  const site = open.find((a) => a.isDefault) ?? open[0] ?? null;
  return site?.pincode ?? null;
}

export function DefaultPincode(): null {
  const { signedIn } = useProductCart();
  const router = useRouter();
  const done = React.useRef(false);

  React.useEffect(() => {
    if (signedIn !== true || done.current) return;
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('pin')) return;
    let live = true;
    void getAddresses().then((book) => {
      if (!live || !book.ok) return;
      const pincode = defaultDeliveryPincode(book.data.delivery);
      if (!pincode) return;
      // Re-read: the buyer may have typed one while the site was being read.
      const now = new URLSearchParams(window.location.search);
      if (now.get('pin')) return;
      now.set('pin', pincode);
      router.replace(`${window.location.pathname}?${now.toString()}` as Route);
    });
    return () => {
      live = false;
    };
  }, [router, signedIn]);

  return null;
}
