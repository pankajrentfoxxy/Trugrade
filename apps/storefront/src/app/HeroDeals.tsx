'use client';

import * as React from 'react';

export interface HeroDeal {
  skuId: string;
  /** `A_PLUS` / `A` / `B` — the API code, for the link back into the SKU. */
  gradeCode: string;
  /** `A+`, `A`, `B` — already display-coded by the server. */
  grade: string;
  brand: string;
  model: string;
  /** `Core i5-1135G7 · 16 GB · 512 GB SSD`, assembled by the server. */
  spec: string;
  /** Rounded, 0–100, or null when no unit behind the SKU has been scored. */
  qcScore: number | null;
  /** Formatted rupees, `38,500`. */
  price: string;
  shipHours: number | null;
  /** A brand photo under `/home/`, or none — the card then draws the shell. */
  photo: string | null;
}

/**
 * The 9:16 deal-card carousel from the supplied hero design.
 *
 * Client-side because it owns a timer. One card is active, its neighbours sit
 * scaled back either side, and the rest are hidden. Every card is a real SKU
 * from the same search response the tiles below render, so the price, score
 * and dispatch time on the card are the ones the SKU page will show.
 *
 * The timer stops while a pointer or focus is inside, while the tab is hidden,
 * and never starts under `prefers-reduced-motion`, where only the first card
 * is shown. Cards that are not active are hidden from assistive technology and
 * their link is taken out of the tab order, so a keyboard user reaches one
 * link, the visible one.
 */
const INTERVAL = 3200;

type Position = 'is-prev' | 'is-active' | 'is-next';

export function HeroDeals({ deals }: { deals: readonly HeroDeal[] }): React.JSX.Element {
  const [index, setIndex] = React.useState(0);
  const [held, setHeld] = React.useState(false);

  React.useEffect(() => {
    if (held || deals.length < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => (i + 1) % deals.length);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [held, deals.length]);

  const position = (i: number): Position | null => {
    const rel = (i - index + deals.length) % deals.length;
    if (rel === 0) return 'is-active';
    if (deals.length === 2) return rel === 1 ? 'is-next' : null;
    if (rel === 1) return 'is-next';
    if (rel === deals.length - 1) return 'is-prev';
    return null;
  };

  return (
    <div
      className="phero-deals"
      aria-label="Live deals"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      {deals.map((d, i) => {
        const pos = position(i);
        const active = pos === 'is-active';
        return (
          <article
            key={`${d.skuId}-${d.gradeCode}`}
            className={pos ? `phero-deal ${pos}` : 'phero-deal'}
            aria-hidden={!active}
          >
            <div className="phero-deal-photo">
              <span
                className={`phero-dgrade phero-grade-${d.grade === 'A+' ? 'aplus' : d.grade.toLowerCase()}`}
              >
                {d.grade}
              </span>
              {d.shipHours !== null && (
                <span className="phero-deal-ship">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
                  </svg>
                  <span className="mono">{d.shipHours} hr</span>
                </span>
              )}
              {d.photo ? (
                <img className="phero-deal-img" src={d.photo} alt="" />
              ) : (
                <div className="phero-laptop phero-deal-shell" aria-hidden="true">
                  <div className="phero-lid">
                    <div className="phero-screen" data-tint={i % 6}>
                      <span className="phero-wordmark">{d.brand}</span>
                    </div>
                  </div>
                  <div className="phero-deck" />
                </div>
              )}
            </div>
            <div className="phero-deal-body">
              <h3 className="phero-deal-name">
                {d.brand} {d.model}
              </h3>
              <p className="phero-deal-sub">{d.spec}</p>
              <div className="phero-deal-qc">
                <span className="phero-deal-qc-label">
                  <span>QC score</span>
                  {d.qcScore !== null ? (
                    <b className="mono">
                      {d.qcScore}
                      <i> /100</i>
                    </b>
                  ) : (
                    <i className="phero-deal-missing">Not measured</i>
                  )}
                </span>
                <span className="phero-deal-track">
                  {d.qcScore !== null && (
                    <span className="phero-deal-fill" style={{ width: `${d.qcScore}%` }} />
                  )}
                </span>
              </div>
              <div className="phero-deal-price">
                <span className="mono">&#8377;{d.price}</span>
                <small>from &middot; incl. GST</small>
              </div>
              <a
                className="phero-deal-buy"
                href={`/laptops/${d.skuId}?grade=${d.gradeCode}`}
                tabIndex={active ? undefined : -1}
              >
                Buy now
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}
