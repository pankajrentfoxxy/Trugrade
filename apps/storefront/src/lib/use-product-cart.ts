'use client';

import * as React from 'react';
import {
  createCart,
  listCarts,
  removeCartLine,
  setCartLine,
  viewCart,
  type CartView,
} from '../app/cart/api';
import {
  publishCartUpdate,
  readActiveCartId,
  rememberActiveCart,
  resolveTargetCartId,
} from './cart-state';

const FIRST_CART_NAME = 'Cart';

type CartLineRef = { qty: number; itemId: string };

export type ProductCartValue = {
  qtyFor: (listingId: string) => number | null;
  busyListingId: string | null;
  addListing: (listingId: string, qty: number) => Promise<void>;
  updateListingQty: (listingId: string, qty: number) => Promise<void>;
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
  const [cartId, setCartId] = React.useState<string | null>(null);
  const [lines, setLines] = React.useState<Map<string, CartLineRef>>(() => new Map());
  const linesRef = React.useRef(lines);
  linesRef.current = lines;
  const [busyListingId, setBusyListingId] = React.useState<string | null>(null);
  const cartIdRef = React.useRef<string | null>(null);
  cartIdRef.current = cartId;

  const applyView = React.useCallback((view: CartView): void => {
    setCartId(view.id);
    rememberActiveCart(view.id);
    setLines(linesFromView(view));
    publishCartUpdate({ cartId: view.id, lineCount: view.itemCount });
  }, []);

  const loadCart = React.useCallback(async (): Promise<void> => {
    const list = await listCarts();
    if (!list.ok) {
      setCartId(null);
      setLines(new Map());
      return;
    }
    const targetId = resolveTargetCartId(list.data, readActiveCartId());
    if (!targetId) {
      setCartId(null);
      setLines(new Map());
      return;
    }
    const view = await viewCart(targetId);
    if (view.ok) applyView(view.data);
  }, [applyView]);

  React.useEffect(() => {
    void loadCart();
  }, [loadCart]);

  const signInRedirect = React.useCallback((): void => {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/sign-in?next=${encodeURIComponent(next)}`;
  }, []);

  const ensureCart = React.useCallback(async (): Promise<string | null> => {
    if (cartIdRef.current) return cartIdRef.current;

    const list = await listCarts();
    if (!list.ok) {
      if (list.status === 401) signInRedirect();
      return null;
    }

    let targetId = resolveTargetCartId(list.data, readActiveCartId());
    if (!targetId) {
      const made = await createCart(FIRST_CART_NAME);
      if (!made.ok) {
        if (made.status === 401) signInRedirect();
        return null;
      }
      targetId = made.data.id;
    }

    setCartId(targetId);
    rememberActiveCart(targetId);
    return targetId;
  }, [signInRedirect]);

  const addListing = React.useCallback(
    async (listingId: string, qty: number): Promise<void> => {
      setBusyListingId(listingId);
      const id = await ensureCart();
      if (!id) {
        setBusyListingId(null);
        return;
      }
      const result = await setCartLine(id, listingId, qty);
      setBusyListingId(null);
      if (result.ok) applyView(result.data);
      else if (result.status === 401) signInRedirect();
    },
    [applyView, ensureCart, signInRedirect],
  );

  const updateListingQty = React.useCallback(
    async (listingId: string, qty: number): Promise<void> => {
      setBusyListingId(listingId);
      const id = cartIdRef.current ?? (await ensureCart());
      if (!id) {
        setBusyListingId(null);
        return;
      }

      if (qty < 1) {
        const line = linesRef.current.get(listingId);
        if (!line) {
          setBusyListingId(null);
          return;
        }
        const result = await removeCartLine(id, line.itemId);
        setBusyListingId(null);
        if (result.ok) applyView(result.data);
        else if (result.status === 401) signInRedirect();
        return;
      }

      const result = await setCartLine(id, listingId, qty);
      setBusyListingId(null);
      if (result.ok) applyView(result.data);
      else if (result.status === 401) signInRedirect();
    },
    [applyView, ensureCart, signInRedirect],
  );

  const qtyFor = React.useCallback(
    (listingId: string): number | null => lines.get(listingId)?.qty ?? null,
    [lines],
  );

  return { qtyFor, busyListingId, addListing, updateListingQty };
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
