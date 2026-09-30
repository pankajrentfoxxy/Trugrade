'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { getAddresses, type OrgAddress } from '../../(portal)/api';
import { useProductCart } from '../../../lib/use-product-cart';
import { readLocation } from '../../../lib/location';

/**
 * The reader's pincode, filled in for them.
 *
 * The board is priced to a pincode and the pincode lives in the URL, so a
 * reader arriving without one sees unit prices and a box to fill. Two things
 * can spare them the typing, in this order:
 *
 *   1. **A signed-in buyer's default delivery site.** Its pincode is the one
 *      they would type. Once the session probe says they are signed in, the
 *      site is read and the page is re-opened with its pincode.
 *   2. **The location saved in this browser** by the header's picker
 *      (`lib/location.ts`) — for a guest, or for a signed-in buyer with no
 *      open site yet. That is the pincode they told us to deliver to, so it
 *      is the pincode the price is landed to.
 *
 * Either way it goes through the URL, as a typed one would, so the link they
 * then copy carries it.
 *
 * Three things it will not do. It never overrides a pincode already in the
 * URL: a typed one, or one in a link a colleague sent, is a choice. It runs
 * once per page, so the reader can clear the box afterwards without being
 * refilled. And it does nothing while the session is still unknown, so the
 * guest route cannot fire for a buyer whose site is about to be read.
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
    if (signedIn === null || done.current) return;
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('pin')) return;

    const open = (pincode: string): void => {
      // Re-read: the reader may have typed one while the site was being read.
      const now = new URLSearchParams(window.location.search);
      if (now.get('pin')) return;
      now.set('pin', pincode);
      router.replace(`${window.location.pathname}?${now.toString()}` as Route);
    };

    const fromBrowser = (): void => {
      const saved = readLocation();
      if (saved) open(saved.pincode);
    };

    if (signedIn === false) {
      fromBrowser();
      return;
    }

    let live = true;
    void getAddresses().then((book) => {
      if (!live) return;
      const pincode = book.ok ? defaultDeliveryPincode(book.data.delivery) : null;
      if (pincode) open(pincode);
      else fromBrowser();
    });
    return () => {
      live = false;
    };
  }, [router, signedIn]);

  return null;
}
