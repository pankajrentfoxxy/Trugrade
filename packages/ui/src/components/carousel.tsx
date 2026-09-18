'use client';

// Interactive: refs, state and a ResizeObserver, none of which exist in a
// server component. See the same note on `navigation.tsx`.
import * as React from 'react';
import { cn } from '../lib/cn';

export interface CarouselProps {
  /**
   * Names the region. Required rather than optional: a scroll container with
   * no accessible name is a landmark a screen-reader user cannot identify or
   * skip, and this one holds links.
   */
  label: string;
  children: React.ReactNode;
  /** The outer region. */
  className?: string;
  /** The scrolling track, so the caller owns its gap and padding. */
  trackClassName?: string;
  /**
   * Advance on a timer, looping back to the start at the end. Off by default.
   *
   * It stops while the pointer is over the rail, while focus is inside it, and
   * while the tab is in the background, and it does not start at all under
   * `prefers-reduced-motion`. Those are not polish: a rail that keeps moving
   * under a pointer takes the tile out from under the click, one that moves
   * while a keyboard user is tabbing through it scrolls their focus off screen,
   * and vestibular motion triggers are a real accessibility failure, not a
   * preference. An unpausable auto-carousel is the version that gets turned off.
   */
  autoplay?: boolean;
  /** Milliseconds between advances. */
  autoplayMs?: number;
}

/**
 * A horizontal scroller with previous / next controls.
 *
 * THREE THINGS THAT MAKE IT A CONTROL AND NOT A DECORATION
 * -------------------------------------------------------
 * **It only auto-advances when asked, and stops the moment it would be in the
 * way.** Off by default; see `autoplay` for what suspends it and why. Content
 * that moves on its own is content the reader has to chase, so the timer yields
 * to the reader rather than the other way round.
 *
 * **The arrows tell the truth about what they will do.** They are disabled at
 * the ends and both are hidden outright when the track does not overflow, so an
 * arrow is never offered for a scroll that cannot happen — measured from
 * `scrollWidth`, not assumed from the number of children, because the answer
 * depends on the viewport.
 *
 * **The track scrolls natively.** Overflow plus scroll-snap means a trackpad, a
 * touch swipe, a shift-wheel and the keyboard all work without this component
 * knowing about any of them; the buttons are a convenience over the top, not
 * the only way through.
 */
export function Carousel({
  label,
  children,
  className,
  trackClassName,
  autoplay = false,
  autoplayMs = 3200,
}: CarouselProps): React.JSX.Element {
  const track = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(true);
  const [held, setHeld] = React.useState(false);

  // One pixel of slack: a fractional scrollLeft at the end of a smooth scroll
  // otherwise leaves the arrow enabled with nowhere to go.
  const measure = React.useCallback((): void => {
    const el = track.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  React.useEffect(() => {
    const el = track.current;
    if (!el) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [measure, children]);

  const page = (direction: 1 | -1): void => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const fits = atStart && atEnd;

  // Autoplay. Everything that would make it hostile is a reason not to run:
  // the reader is on it, the reader is in it, the tab is not even visible, the
  // rail does not overflow, or the machine has been told not to animate.
  React.useEffect(() => {
    if (!autoplay || held || fits) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return undefined;

    const tick = (): void => {
      const el = track.current;
      if (!el || document.hidden) return;
      const max = el.scrollWidth - el.clientWidth;
      // Wrap rather than stall at the end, so it reads as a loop and not as a
      // rail that quietly gave up halfway through the second lap.
      const next = el.scrollLeft >= max - 1 ? 0 : el.scrollLeft + Math.round(el.clientWidth * 0.8);
      el.scrollTo({ left: next, behavior: 'smooth' });
    };

    const id = window.setInterval(tick, autoplayMs);
    return () => window.clearInterval(id);
  }, [autoplay, autoplayMs, held, fits]);

  return (
    <div
      className={cn('tg-carousel', className)}
      role="region"
      aria-label={label}
      onMouseEnter={autoplay ? () => setHeld(true) : undefined}
      onMouseLeave={autoplay ? () => setHeld(false) : undefined}
      onFocusCapture={autoplay ? () => setHeld(true) : undefined}
      onBlurCapture={autoplay ? () => setHeld(false) : undefined}
    >
      {!fits && (
        <button
          type="button"
          className="tg-carousel-nav"
          data-dir="prev"
          onClick={() => page(-1)}
          disabled={atStart}
          aria-label={`Scroll ${label} left`}
        >
          <Chevron direction="left" />
        </button>
      )}

      <div className={cn('tg-carousel-track', trackClassName)} ref={track}>
        {children}
      </div>

      {!fits && (
        <button
          type="button"
          className="tg-carousel-nav"
          data-dir="next"
          onClick={() => page(1)}
          disabled={atEnd}
          aria-label={`Scroll ${label} right`}
        >
          <Chevron direction="right" />
        </button>
      )}
    </div>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
