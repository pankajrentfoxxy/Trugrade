'use client';

import * as React from 'react';

/**
 * The promotional banner carousel under the filter strip.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * The slides are supplied creatives, not a database read: six banner images
 * handed over with the design, listed in `HOME_BANNERS` below. They carry no
 * figure, count or price of ours — a banner that named a stock number would be
 * the fabricated-data case the house rules forbid, and these do not. Swapping
 * a creative is editing that list; nothing else on the page reads it.
 *
 * HOW IT MOVES
 * ------------
 * The track is a real horizontal scroller with snap points, so a swipe on a
 * phone and a wheel on a trackpad both work before any script runs. There are
 * no arrow buttons: the row advances on its own, and the dots and the timer
 * only ever call `scrollTo` on it. The active index is read back off the
 * scroll position rather than kept as a second source of truth, which is what
 * keeps a swipe and a dot from disagreeing about which slide is up.
 *
 * The timer stops while a pointer is over the block, while focus is inside it,
 * and while the tab is hidden, and never starts under `prefers-reduced-motion`.
 * It also never starts with fewer than two slides.
 *
 * A slide whose image fails to load is dropped from the row rather than drawn
 * as an empty frame; with every image gone the block renders nothing at all.
 */
const INTERVAL = 4500;

export interface HomeBanner {
  /** The creative's address, at the CDN's own width. */
  src: string;
  /** What the banner says, for anyone who cannot see it. */
  alt: string;
}

export const HOME_BANNERS: readonly HomeBanner[] = [
  {
    src: 'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/50bf1c77c3ff8d8a.jpg?q=80',
    alt: 'Promotional banner 1 of 6',
  },
  {
    src: 'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/1312x640-19f82h-1790582516559.png?q=80',
    alt: 'Promotional banner 2 of 6',
  },
  {
    src: 'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/1312x640-19f82h-1790605081645.png?q=80',
    alt: 'Promotional banner 3 of 6',
  },
  {
    src: 'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/1312x640-19f82h-1790341138320.png?q=80',
    alt: 'Promotional banner 4 of 6',
  },
  {
    src: 'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/1312x640-19f82h-1790596349203.png?q=80',
    alt: 'Promotional banner 5 of 6',
  },
  {
    src: 'https://rukminim2.flixcart.com/fk-p-flap/1600/780/image/1312x640-19f82h-1790603953049.png?q=80',
    alt: 'Promotional banner 6 of 6',
  },
];

export function HomeCarousel({
  banners = HOME_BANNERS,
}: {
  banners?: readonly HomeBanner[];
}): React.JSX.Element | null {
  const [broken, setBroken] = React.useState<ReadonlySet<string>>(() => new Set());
  const [index, setIndex] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const track = React.useRef<HTMLDivElement>(null);

  const slides = React.useMemo(() => banners.filter((b) => !broken.has(b.src)), [banners, broken]);
  const count = slides.length;

  // Scroll so that slide `i` sits at the track's left edge. The track's own
  // right padding is what lets the last slide get there.
  const goTo = React.useCallback((i: number): void => {
    const el = track.current;
    const slide = el?.children[i];
    if (!el || !(slide instanceof HTMLElement)) return;
    const left = slide.offsetLeft;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  // The index follows the scroll position: whichever slide's left edge is
  // nearest the track's left edge is the one that is up.
  React.useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const edge = el.scrollLeft;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      Array.from(el.children).forEach((child, i) => {
        if (!(child instanceof HTMLElement)) return;
        const dist = Math.abs(child.offsetLeft - edge);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setIndex(best);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [count]);

  React.useEffect(() => {
    if (held || count < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      goTo((index + 1) % count);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [held, count, index, goTo]);

  if (count === 0) return null;

  return (
    <section
      className="hcarousel"
      aria-roledescription="carousel"
      aria-label="Offers"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="hcarousel-track" ref={track}>
        {slides.map((b, i) => (
          <figure
            className="hcarousel-slide"
            key={b.src}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
          >
            <img
              src={b.src}
              alt={b.alt}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setBroken((prev) => new Set(prev).add(b.src))}
            />
          </figure>
        ))}
      </div>

      {count > 1 && (
        <ol className="hcarousel-dots">
          {slides.map((b, i) => (
            <li key={b.src}>
              <button
                type="button"
                className="hcarousel-dot"
                aria-label={`Banner ${i + 1} of ${count}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => goTo(i)}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

