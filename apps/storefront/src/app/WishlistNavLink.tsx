'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Modal } from '@trugrade/ui';
import type { SearchResponse, SearchResult } from '../lib/api';
import { brandPhoto } from '../lib/brand-photo';
import {
  clearWishlistError,
  initWishlist,
  toggleWishlist,
  useWishlist,
  wishlistKey,
  type WishlistEntry,
} from '../lib/wishlist';
import { HeartIcon } from './WishlistHeart';

/**
 * The header's wishlist control, and the list it opens.
 *
 * The list is a dialog, not a page: a buyer checking what they saved does not
 * leave what they were looking at. It names each save from the live search,
 * so its price and stock are today's; a save whose model is not for sale any
 * more is still listed, said so plainly, and can be removed — never dropped
 * silently, and never shown with a price nobody can buy at.
 *
 * It is also where a failed save is reported: the header is on every page,
 * so a heart that could not save says why here, in the server's words.
 */
const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };
/** The search answers 48 models a page; this many pages covers the shelf. */
const MAX_PAGES = 10;

async function liveFacts(): Promise<Map<string, SearchResult> | null> {
  const out = new Map<string, SearchResult>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let body: SearchResponse;
    try {
      const res = await fetch(`/api/public/search?per=48&page=${page}`);
      if (!res.ok) return null;
      body = (await res.json()) as SearchResponse;
    } catch {
      return null;
    }
    for (const r of body.results) out.set(`${r.skuId}:${r.grade}`, r);
    const pages = (body as SearchResponse & { pages?: number }).pages ?? 1;
    if (page >= pages) break;
  }
  return out;
}

export function WishlistNavLink({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { items, loading, error } = useWishlist();
  const [open, setOpen] = React.useState(false);
  const [facts, setFacts] = React.useState<Map<string, SearchResult> | null | 'loading'>('loading');

  React.useEffect(() => {
    initWishlist(signedIn);
  }, [signedIn]);

  // Read the live shelf each time the list opens, so a price is today's.
  React.useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setFacts('loading');
    void liveFacts().then((m) => {
      if (live) setFacts(m);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // A failure note stays long enough to read, then goes.
  React.useEffect(() => {
    if (!error) return undefined;
    const t = window.setTimeout(clearWishlistError, 6000);
    return () => window.clearTimeout(t);
  }, [error]);

  const count = items.length;
  const label = count > 0 ? `Wishlist — ${count} saved` : 'Wishlist';

  return (
    <>
      <button
        type="button"
        className="hbtn hwish"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="hcart-ic">
          <HeartIcon />
          {count > 0 ? (
            <span className="hcart-badge mono" aria-hidden="true">
              {count}
            </span>
          ) : null}
        </span>
        <strong>Wishlist</strong>
      </button>

      {error ? (
        <p className="hwish-note" role="alert">
          {error}
        </p>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Your wishlist"
        description={
          count === 0
            ? undefined
            : `${count} saved ${count === 1 ? 'machine' : 'machines'}${signedIn ? '' : ' in this browser — sign in to keep them on your account'}`
        }
        size="lg"
        dismissOnBackdrop
      >
        {loading ? (
          <p className="wl-empty">Loading your wishlist…</p>
        ) : count === 0 ? (
          <div className="wl-empty">
            <HeartIcon />
            <p>Nothing saved yet. Tap the heart on any laptop to keep it here.</p>
            <Link className="wl-browse" href="/search" onClick={() => setOpen(false)}>
              Browse laptops
            </Link>
          </div>
        ) : (
          <>
            {facts === null ? (
              <p className="wl-note" role="alert">
                We could not load today&rsquo;s prices. That is on our side, not yours — your saves
                are safe. Close this and open it again in a moment.
              </p>
            ) : null}
            <ul className="wl-list">
              {items.map((e) => (
                <WishlistRow
                  key={wishlistKey(e)}
                  entry={e}
                  facts={facts}
                  onGo={() => setOpen(false)}
                />
              ))}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}

function WishlistRow({
  entry,
  facts,
  onGo,
}: {
  entry: WishlistEntry;
  facts: Map<string, SearchResult> | null | 'loading';
  onGo: () => void;
}): React.JSX.Element {
  const r = facts instanceof Map ? facts.get(`${entry.skuId}:${entry.grade}`) : undefined;
  const grade = GRADE_LABEL[entry.grade] ?? entry.grade;
  const href = `/laptops/${entry.skuId}?grade=${entry.grade}` as Route;
  const name = r ? `${r.brand} ${r.model}` : 'Saved laptop';
  const photo = r ? brandPhoto(r.brand) : null;

  return (
    <li className="wl-row">
      <span className="wl-media">
        {photo ? <img src={photo} alt="" loading="lazy" /> : <HeartIcon />}
      </span>
      <span className="wl-main">
        {facts === 'loading' ? (
          <span className="wl-name">Loading…</span>
        ) : (
          <>
            <Link className="wl-name" href={href} onClick={onGo}>
              {name}
            </Link>
            <span className="wl-spec">
              Grade {grade}
              {r?.cpuLine ? ` · ${r.cpuLine}` : ''}
              {r && r.ramGb > 0 ? ` · ${r.ramGb} GB` : ''}
              {r && r.storageGb > 0 ? ` · ${r.storageGb} GB` : ''}
            </span>
            {r ? (
              <span className="wl-price">
                <b className="mono">₹{RUPEES.format(r.fromPrice)}</b> from · incl. GST ·{' '}
                <span className="mono">{r.unitsAvailable}</span> sealed unit
                {r.unitsAvailable === 1 ? '' : 's'}
              </span>
            ) : facts instanceof Map ? (
              <span className="wl-gone">Not for sale right now</span>
            ) : null}
          </>
        )}
      </span>
      <button
        type="button"
        className="wl-remove"
        aria-label={`Remove ${name} from wishlist`}
        onClick={() => toggleWishlist(entry)}
      >
        Remove
      </button>
    </li>
  );
}
