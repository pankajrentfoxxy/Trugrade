'use client';

import * as React from 'react';
import { call, type ApiResult } from '../app/register/api';

/**
 * The wishlist, as the browser holds it: one store every heart and the header
 * read from, so a save on a card shows in the header the moment it happens.
 *
 * TWO HOMES, ONE PER SESSION STATE — THE SAME RULE AS THE CART
 * ------------------------------------------------------------
 * **Signed out**, saves live in this browser's `localStorage`. There is no
 * account to own them, and inventing one is the hole the cart refused to dig.
 *
 * **Signed in**, they live in `ordering.wishlist_item`, read and written through
 * `/api/buyer/wishlist`. On the first signed-in read, whatever this browser
 * saved while signed out is sent to `/merge` and the local copy is cleared,
 * so signing in never loses a save and never shows one twice.
 *
 * Who is signed in is told to the store by the header (`initWishlist`), which
 * already knows from the server; a heart drawn before that is a guest heart.
 *
 * A save is a model at a grade — the thing a card is. What it costs now and
 * whether it is still for sale are read when the list is drawn, never stored.
 */

export type WishlistGrade = 'A_PLUS' | 'A' | 'B';

export interface WishlistKey {
  skuId: string;
  grade: WishlistGrade;
}

export interface WishlistEntry extends WishlistKey {
  addedAt: string;
}

interface State {
  /** null until the header has said who is signed in. */
  signedIn: boolean | null;
  items: readonly WishlistEntry[];
  /** True while the signed-in list is being read for the first time. */
  loading: boolean;
  /** The last failure, in words, for the header to show. Cleared on read. */
  error: string | null;
}

const KEY = 'tg-wishlist';
/** At most this many go to the server in one merge, as the API allows. */
const MERGE_MAX = 200;

let state: State = { signedIn: null, items: [], loading: false, error: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const wishlistKey = (k: WishlistKey): string => `${k.skuId}:${k.grade}`;

const GRADES: readonly string[] = ['A_PLUS', 'A', 'B'];

/** Storage can throw or hold anything; a list that throws on read is worse than an empty one. */
function readLocal(): WishlistEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is WishlistEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as WishlistEntry).skuId === 'string' &&
        GRADES.includes((e as WishlistEntry).grade) &&
        typeof (e as WishlistEntry).addedAt === 'string',
    );
  } catch {
    return [];
  }
}

function writeLocal(items: readonly WishlistEntry[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Kept for this page; it will not be there next time.
  }
}

interface ServerView {
  items: WishlistEntry[];
}

const getServer = (): Promise<ApiResult<ServerView>> =>
  call<ServerView>('/api/buyer/wishlist', { method: 'GET' });
const addServer = (k: WishlistKey): Promise<ApiResult<ServerView>> =>
  call<ServerView>('/api/buyer/wishlist/items', { method: 'POST', body: JSON.stringify(k) });
const removeServer = (k: WishlistKey): Promise<ApiResult<ServerView>> =>
  call<ServerView>('/api/buyer/wishlist/items/remove', {
    method: 'POST',
    body: JSON.stringify(k),
  });
const mergeServer = (items: readonly WishlistKey[]): Promise<ApiResult<ServerView>> =>
  call<ServerView>('/api/buyer/wishlist/merge', {
    method: 'POST',
    body: JSON.stringify({ items: items.map(({ skuId, grade }) => ({ skuId, grade })) }),
  });

/**
 * Told by the header who is signed in. Signed in: bring this browser's saves
 * into the account, then read the account's list. Signed out: read this
 * browser's. Idempotent for the same answer, so every header mount can call it.
 */
export function initWishlist(signedIn: boolean): void {
  if (state.signedIn === signedIn) return;
  if (!signedIn) {
    set({ signedIn: false, items: readLocal(), loading: false });
    return;
  }
  set({ signedIn: true, items: [], loading: true });
  void (async () => {
    const local = readLocal();
    if (local.length > 0) {
      const merged = await mergeServer(local.slice(0, MERGE_MAX));
      // Only a merge the server took clears the browser's copy.
      if (merged.ok) writeLocal(local.slice(MERGE_MAX));
    }
    const result = await getServer();
    if (state.signedIn !== true) return;
    if (result.ok) set({ items: result.data.items, loading: false });
    else set({ loading: false, error: `We could not load your wishlist. ${result.message}` });
  })();
}

/** Save it if it is not saved, unsave it if it is. */
export function toggleWishlist(k: WishlistKey): void {
  const id = wishlistKey(k);
  const had = state.items.some((e) => wishlistKey(e) === id);
  const before = state.items;
  const after = had
    ? before.filter((e) => wishlistKey(e) !== id)
    : [{ ...k, addedAt: new Date().toISOString() }, ...before];

  if (state.signedIn !== true) {
    set({ items: after });
    writeLocal(after);
    return;
  }

  // Shown at once, put back if the server says no.
  set({ items: after });
  void (had ? removeServer(k) : addServer(k)).then((result) => {
    if (result.ok) {
      set({ items: result.data.items });
      return;
    }
    set({
      items: before,
      error: had
        ? `That was not removed from your wishlist. ${result.message}`
        : `That was not saved to your wishlist. ${result.message}`,
    });
  });
}

export function clearWishlistError(): void {
  if (state.error) set({ error: null });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  // A save in another tab of a signed-out browser arrives as a storage event.
  const onStorage = (e: StorageEvent): void => {
    if (e.key === KEY && state.signedIn !== true) set({ items: readLocal() });
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

const EMPTY: State = { signedIn: null, items: [], loading: false, error: null };

/** The whole store. The server render sees an empty list, so markup matches on hydration. */
export function useWishlist(): State {
  return React.useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/** Whether one model at one grade is saved. */
export function useWishlisted(k: WishlistKey): boolean {
  const id = wishlistKey(k);
  return React.useSyncExternalStore(
    subscribe,
    () => state.items.some((e) => wishlistKey(e) === id),
    () => false,
  );
}
