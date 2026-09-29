'use client';

import * as React from 'react';

/**
 * The banner scroller under the hero: supplied artwork, one row, a button to
 * move it along.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * The four files under `public/home/banner-*` are supplied creatives, listed
 * in `BANNERS` below with their pixel sizes. They carry their own offers and
 * claims; nothing on this page reads or repeats them. Swapping one is
 * replacing the file and, if its size changed, the two numbers beside it.
 *
 * THE CARD IS 1059 x 308
 * ----------------------
 * Every card is that size. The four files are about 3:1, a little squarer than
 * the card, so each is scaled to the card's width and trimmed by a few percent
 * at the top and bottom, centred — the eyebrow line and the feature row both
 * sit inside that margin. A file exported at exactly 1059 x 308 shows in full
 * with no code change. The width and height attributes are the file's own
 * pixel size, so the browser knows the picture's shape before it arrives.
 *
 * HOW IT MOVES
 * ------------
 * The track is a real horizontal scroller, so a swipe and a trackpad both work
 * before any script runs. The two buttons scroll it by most of a viewport, and
 * each one shows only while there is somewhere left to go in its direction.
 */
interface Banner {
  src: string;
  /** Pixel size of the file, for the aspect ratio. */
  width: number;
  height: number;
}

const BANNERS: readonly Banner[] = [
  { src: '/home/banner-1.png', width: 2135, height: 737 },
  { src: '/home/banner-2.png', width: 2172, height: 724 },
  { src: '/home/banner-3.png', width: 2171, height: 724 },
  { src: '/home/banner-4.png', width: 2206, height: 713 },
];

export function HomeBanners(): React.JSX.Element {
  const track = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(false);

  // Which buttons apply is read off the scroll position, on scroll and on
  // resize, since a wider window can put the whole row in view at once.
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
  }, []);

  const step = (direction: 1 | -1): void => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section className="hbn" aria-label="Offers">
      {!atStart && (
        <button
          type="button"
          className="hbn-btn prev"
          aria-label="Scroll banners back"
          onClick={() => step(-1)}
        >
          <Chevron flip />
        </button>
      )}

      <div className="hbn-track" ref={track}>
        {BANNERS.map((b, i) => (
          <figure className="hbn-card" key={b.src}>
            {/* alt="" — supplied promotional artwork whose text is baked into
                the picture. Nothing here is the page's only route to anything. */}
            <img
              src={b.src}
              alt=""
              width={b.width}
              height={b.height}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
            />
          </figure>
        ))}
      </div>

      {!atEnd && (
        <button
          type="button"
          className="hbn-btn next"
          aria-label="Scroll banners forward"
          onClick={() => step(1)}
        >
          <Chevron />
        </button>
      )}
    </section>
  );
}

function Chevron({ flip = false }: { flip?: boolean }): React.JSX.Element {
  return (
    <svg
      width="22"
      height="22"
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
