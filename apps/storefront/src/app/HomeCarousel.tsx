'use client';

import * as React from 'react';

/**
 * The promotional banner carousel on the homepage.
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
 * only ever call `scrollTo` on it. The position is read back off the scroll
 * offset rather than kept as a second source of truth, which is what keeps a
 * swipe and a dot from disagreeing about which slide is up.
 *
 * IT LOOPS, AND HOW
 * -----------------
 * The active slide sits at the left edge with the next ones showing to its
 * right, so a row that simply stopped at the last banner would end with that
 * banner alone and blank space beside it. Instead the list is rendered more
 * than once: after the last banner comes a copy of the first, then the second,
 * and so on, so there is always something to the right. The timer walks
 * forward into the copies, and the moment the row comes to rest on a copy it
 * is moved back, without animation, to the same banner in the first set. The
 * two positions look identical, so nothing is seen to happen, and the row can
 * go round for ever.
 *
 * The copies are for the eye only. They are `aria-hidden` with empty alt text,
 * so a screen reader meets each banner once, and the dots count the real
 * banners, not the copies.
 *
 * The timer stops while a pointer is over the block, while focus is inside it,
 * and while the tab is hidden, and never starts under `prefers-reduced-motion`.
 * It also never starts with fewer than two slides.
 *
 * A slide whose image fails to load is dropped from the row — every copy of
 * it — rather than drawn as an empty frame; with every image gone the block
 * renders nothing at all.
 */
const INTERVAL = 4500;

/**
 * How long the row must sit still before it counts as having come to rest.
 * Only used where the browser has no `scrollend` event.
 */
const REST_MS = 140;

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
  /** Which child of the track is at the left edge — a real slide or a copy. */
  const [pos, setPos] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const track = React.useRef<HTMLDivElement>(null);

  const slides = React.useMemo(() => banners.filter((b) => !broken.has(b.src)), [banners, broken]);
  const count = slides.length;

  // Enough sets that a full window of banners always follows the first copy.
  // Two is plenty for six banners; a short list is repeated more times so a
  // wide screen still has something to the right of the slide it rests on.
  const sets = count < 2 ? 1 : Math.max(2, Math.ceil(8 / count) + 1);
  const copies = React.useMemo(() => Array.from({ length: sets }, (_, i) => i), [sets]);

  const leftOf = React.useCallback((i: number): number | null => {
    const slide = track.current?.children[i];
    return slide instanceof HTMLElement ? slide.offsetLeft : null;
  }, []);

  // Scroll so that child `i` sits at the track's left edge.
  const goTo = React.useCallback(
    (i: number): void => {
      const el = track.current;
      const left = leftOf(i);
      if (!el || left === null) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
    },
    [leftOf],
  );

  React.useEffect(() => {
    const el = track.current;
    if (!el || count === 0) return undefined;
    let frame = 0;
    let rest = 0;

    const nearest = (): number => {
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
      return best;
    };

    const measure = (): void => {
      frame = 0;
      setPos(nearest());
    };

    // At rest on a copy: move, unanimated, to the same banner in the first
    // set. The two positions look the same, so the loop has no visible seam.
    const settle = (): void => {
      const at = nearest();
      if (at < count) return;
      const left = leftOf(at % count);
      if (left !== null) el.scrollTo({ left, behavior: 'auto' });
    };

    // Where the browser supports it the property exists (as null); where it
    // does not, it is undefined and the timer below stands in for the event.
    const hasScrollEnd = (window as { onscrollend?: unknown }).onscrollend !== undefined;

    const onScroll = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
      if (!hasScrollEnd) {
        window.clearTimeout(rest);
        rest = window.setTimeout(settle, REST_MS);
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', settle);
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', settle);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.clearTimeout(rest);
    };
  }, [count, leftOf]);

  React.useEffect(() => {
    if (held || count < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      // Forward into the copies, never back to the start: coming to rest on a
      // copy is what resets the row.
      goTo(pos + 1);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [held, count, pos, goTo]);

  if (count === 0) return null;

  const active = pos % count;

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
        {copies.map((copy) =>
          slides.map((b, i) => (
            <figure
              className="hcarousel-slide"
              key={`${copy}-${b.src}`}
              role={copy === 0 ? 'group' : undefined}
              aria-roledescription={copy === 0 ? 'slide' : undefined}
              aria-label={copy === 0 ? `${i + 1} of ${count}` : undefined}
              aria-hidden={copy === 0 ? undefined : 'true'}
            >
              <img
                src={b.src}
                alt={copy === 0 ? b.alt : ''}
                loading={copy === 0 && i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setBroken((prev) => new Set(prev).add(b.src))}
              />
            </figure>
          )),
        )}
      </div>

      {count > 1 && (
        <ol className="hcarousel-dots">
          {slides.map((b, i) => (
            <li key={b.src}>
              <button
                type="button"
                className="hcarousel-dot"
                aria-label={`Banner ${i + 1} of ${count}`}
                aria-current={i === active ? 'true' : undefined}
                onClick={() => goTo(i)}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
