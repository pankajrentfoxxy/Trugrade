'use client';

import * as React from 'react';
import { GradeBadge } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import Link from 'next/link';
import { DeliveryBy } from './DeliveryBy';
import { WishlistHeart } from './WishlistHeart';

export interface SuggestedItem {
  skuId: string;
  /** `A_PLUS` / `A` / `B` — the API code, for the badge and the link. */
  grade: string;
  brand: string;
  model: string;
  /** `i5-1135G7 · 16/512 · 14″`, assembled by the server from what exists. */
  spec: string;
  /** Formatted rupees, `28,000`. */
  price: string;
  /** Formatted rupees for the struck-through new-machine price — a placeholder, see below. */
  mrp: string;
  /** Whole-number percentage under the placeholder MRP — see below. */
  off: number;
  /** A brand render under `/home/`, or null — the card then draws the shell. */
  photo: string | null;
  /** "Sat, 3 Oct", or null when there is no date to promise. */
  deliveryBy: string | null;
}

const GRADES: readonly Grade[] = ['A_PLUS', 'A', 'B'];
const isGrade = (value: string): value is Grade => (GRADES as readonly string[]).includes(value);

/**
 * "Suggested for you": one scrolling row of product cards above the banner
 * row, with a pair of round buttons in the heading to move it along.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * Every card is a real SKU from the same search response the hero renders, so
 * the grade, the name, the spec and the price are the ones the SKU page will
 * show. The struck-through price and the "% off" beside it are the exception:
 * the API does not send a new-machine MRP yet, so both come from
 * `placeholder-market.ts`, hardcoded by direction and already on every card of
 * `/search`. They are derived from our own price and are not facts about the
 * machine. The two are one claim — the percentage is the gap between the
 * price and the figure struck out beside it — so they are drawn together.
 *
 * There is no stock count on the card by direction. `unitsAvailable` is still
 * on the result; it is simply not drawn here.
 *
 * The image is the brand-representative render the rest of the home page
 * uses, never a unit photograph — those carry captions and live on the SKU
 * page. A brand the design has no render for gets the drawn shell.
 *
 * HOW IT MOVES
 * ------------
 * The track is a real horizontal scroller with snap points, so a swipe and a
 * trackpad both work before any script runs. The buttons scroll it by most of
 * a viewport, and each is disabled, not hidden, when there is nowhere left to
 * go — a pair that changes shape as you press it is harder to aim at.
 */
export function SuggestedRow({ items }: { items: readonly SuggestedItem[] }): React.JSX.Element {
  const track = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(false);

  React.useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    const measure = (): void => {
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [items.length]);

  const step = (direction: 1 | -1): void => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section className="sug" aria-labelledby="sug-title">
      <div className="sug-head">
        <h2 id="sug-title">Suggested for you</h2>
        <p>inspected stock · from-prices incl. GST</p>
        <div className="sug-nav">
          <button
            type="button"
            className="sug-btn"
            aria-label="Scroll suggestions back"
            disabled={atStart}
            onClick={() => step(-1)}
          >
            <Chevron flip />
          </button>
          <button
            type="button"
            className="sug-btn"
            aria-label="Scroll suggestions forward"
            disabled={atEnd}
            onClick={() => step(1)}
          >
            <Chevron />
          </button>
        </div>
      </div>

      <div className="sug-track" ref={track}>
        {items.map((it) => (
          <div className="sug-wrap" key={`${it.skuId}-${it.grade}`}>
            <WishlistHeart
              skuId={it.skuId}
              grade={it.grade}
              name={`${it.brand} ${it.model}`}
              className="wl-heart sug-heart"
            />
            <Link className="sug-card" href={`/laptops/${it.skuId}?grade=${it.grade}`}>
              <div className="sug-media">
                {isGrade(it.grade) && <GradeBadge grade={it.grade} className="sug-grade" />}
                {it.photo ? (
                  <img
                    className="sug-photo"
                    src={it.photo}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <svg className="sug-shell" viewBox="0 0 150 80" fill="none" aria-hidden="true">
                    <rect
                      x="27"
                      y="10"
                      width="96"
                      height="56"
                      rx="3"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path d="M12 70 h126 l-8 -4 H20 z" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </div>
              <div className="sug-body">
                <h3 className="sug-name">
                  {it.brand} {it.model}
                </h3>
                {it.spec ? (
                  <p className="sug-spec mono">{it.spec}</p>
                ) : (
                  <p className="sug-spec sug-unpublished">Specification not published</p>
                )}
                <p className="sug-price">
                  <span className="sug-price-now mono">₹{it.price}</span>
                  <s className="sug-price-mrp mono">
                    <span className="sr-only">New price </span>₹{it.mrp}
                  </s>
                  <span className="sug-price-off">
                    <span className="mono">{it.off}%</span> off
                  </span>
                </p>
                <DeliveryBy date={it.deliveryBy} className="sug-delivery" />
              </div>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function Chevron({ flip = false }: { flip?: boolean }): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
