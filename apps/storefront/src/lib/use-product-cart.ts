'use client';

import * as React from 'react';
import { getCart, removeCartLine, setCartLine, type CartView } from '../app/cart/api';
import { getSession } from '../app/register/api';
import {
  addGuestLine,
  readGuestCart,
  setGuestQty,
  type GuestCartLine,
  type GuestCartSnapshot,
} from './guest-cart';
import { mergeGuestCart } from './merge-guest-cart';
import { publishCartUpdate } from './cart-state';

type CartLineRef = { qty: number; itemId: string };

export type ProductCartValue = {
  qtyFor: (listingId: string) => number | null;
  busyListingId: string | null;
  itemCount: number;
  cartDockDismissed: boolean;
  /**
   * The snapshot is what lets a SIGNED-OUT visitor have a cart: there is no
   * authenticated endpoint that can turn a listing id back into a title and a
   * price for them, so the details on screen at the moment of the click are
   * written down with it. A signed-in buyer's add ignores it — the server
   * prices the line.
   */
  addListing: (listingId: string, qty: number, snapshot: GuestCartSnapshot) => Promise<void>;
  updateListingQty: (listingId: string, qty: number) => Promise<void>;
  dismissCartDock: () => void;
  /** `null` until the session probe answers. */
  signedIn: boolean | null;
};

const ProductCartContext = React.createContext<ProductCartValue | null>(null);

function linesFromView(view: CartView): Map<string, CartLineRef> {
  const map = new Map<string, CartLineRef>();
  for (const group of view.dispatchGroups) {
    for (const line of group.lines) {
      map.set(line.offerId, { qty: line.qtyRequested, itemId: line.itemId });
    }
  }
  return map;
}

function useProductCartState(): ProductCartValue {
  const [itemCount, setItemCount] = React.useState(0);
  const [lines, setLines] = React.useState<Map<string, CartLineRef>>(() => new Map());
  const linesRef = React.useRef(lines);
  linesRef.current = lines;
  const [busyListingId, setBusyListingId] = React.useState<string | null>(null);
  const [cartDockDismissed, setCartDockDismissed] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null);
  const [guestLines, setGuestLines] = React.useState<readonly GuestCartLine[]>([]);

  const applyView = React.useCallback((view: CartView): void => {
    setItemCount(view.itemCount);
    setLines(linesFromView(view));
    publishCartUpdate({ lineCount: view.itemCount });
  }, []);

  /**
   * One cart per buyer, and the session names it — so reading it is the whole
   * of "which cart": no list to pick from, none to create.
   */
  const loadCart = React.useCallback(async (): Promise<void> => {
    const view = await getCart();
    if (view.ok) applyView(view.data);
    else {
      setItemCount(0);
      setLines(new Map());
    }
  }, [applyView]);

  const mergeGuest = React.useCallback(async (): Promise<void> => {
    await mergeGuestCart(applyView);
    setGuestLines(readGuestCart());
  }, [applyView]);

  /**
   * The session is asked FIRST, and nothing else runs until it answers.
   *
   * `getCart()` on a signed-out visitor 401s, `withSessionRestore` then probes
   * `/auth/session`, that 401s too, and `sessionLost()` deliberately never
   * resolves — which is right inside the portal, where a shell gate moves them
   * to sign-in, and a hang on a public product page, where there is no such
   * gate. `/auth/session` is on `NEVER_RETRY`, so this probe is the one call
   * that cannot hang.
   */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getSession();
      if (cancelled) return;
      setSignedIn(session.ok);
      if (!session.ok) {
        setGuestLines(readGuestCart());
        return;
      }
      await mergeGuest();
      if (!cancelled) await loadCart();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCart, mergeGuest]);

  const signInRedirect = React.useCallback((): void => {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/sign-in?next=${encodeURIComponent(next)}`;
  }, []);

  const addListing = React.useCallback(
    async (listingId: string, qty: number, snapshot: GuestCartSnapshot): Promise<void> => {
      // Signed out: the basket is theirs and it stays on their machine. No
      // request is made, so there is no 401 to hang on and no sign-in wall
      // between a buyer and a decision they have already made.
      if (signedIn === false) {
        setGuestLines(addGuestLine(snapshot, qty));
        setCartDockDismissed(false);
        return;
      }
      setBusyListingId(listingId);
      const result = await setCartLine(listingId, qty);
      setBusyListingId(null);
      if (result.ok) {
        applyView(result.data);
        setCartDockDismissed(false);
      } else if (result.status === 401) signInRedirect();
    },
    [applyView, signInRedirect, signedIn],
  );

  const updateListingQty = React.useCallback(
    async (listingId: string, qty: number): Promise<void> => {
      if (signedIn === false) {
        setGuestLines(setGuestQty(listingId, qty));
        return;
      }
      setBusyListingId(listingId);

      if (qty < 1) {
        const line = linesRef.current.get(listingId);
        if (!line) {
          setBusyListingId(null);
          return;
        }
        const result = await removeCartLine(line.itemId);
        setBusyListingId(null);
        if (result.ok) applyView(result.data);
        else if (result.status === 401) signInRedirect();
        return;
      }

      const result = await setCartLine(listingId, qty);
      setBusyListingId(null);
      if (result.ok) applyView(result.data);
      else if (result.status === 401) signInRedirect();
    },
    [applyView, signInRedirect, signedIn],
  );

  const qtyFor = React.useCallback(
    (listingId: string): number | null => {
      if (signedIn === false) {
        return guestLines.find((l) => l.listingId === listingId)?.qty ?? null;
      }
      return lines.get(listingId)?.qty ?? null;
    },
    [guestLines, lines, signedIn],
  );

  const guestCount = guestLines.reduce((n, l) => n + l.qty, 0);

  const dismissCartDock = React.useCallback((): void => {
    setCartDockDismissed(true);
  }, []);

  return {
    qtyFor,
    busyListingId,
    itemCount: signedIn === false ? guestCount : itemCount,
    cartDockDismissed,
    addListing,
    updateListingQty,
    dismissCartDock,
    signedIn,
  };
}

/** One cart scope for every comparison board on the product page. */
export function ProductCartProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const value = useProductCartState();
  return React.createElement(ProductCartContext.Provider, { value }, children);
}

export function useProductCart(): ProductCartValue {
  const value = React.useContext(ProductCartContext);
  if (!value) {
    throw new Error('useProductCart must be used within ProductCartProvider');
  }
  return value;
}
