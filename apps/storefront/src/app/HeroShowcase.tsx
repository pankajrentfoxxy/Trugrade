'use client';

import * as React from 'react';

export interface HeroSlide {
  /** `A+`, `A`, `B` — already display-coded by the server. */
  grade: string;
  condition: string;
  note: string;
  brand: string;
  model: string;
  spec: string;
  /** Which of the illustration's screen tints to use. */
  tint: number;
  /** The pale shell, for machines that are silver rather than graphite. */
  silver: boolean;
  /** A brand render under `/home/`, or null — the slide then draws the shell. */
  photo: string | null;
}

/**
 * The rotating product stage from the supplied hero design.
 *
 * Client-side because it owns a timer, a pointer tilt and focus state. The copy
 * and the process chain beside it stay on the server — only this rotates.
 *
 * Every slide is a real machine passed in by the server from the same
 * `SearchResult` list the grid below renders. The supplied markup hard-coded
 * "Dell Latitude / Intel Core i5" and "Fresh stock weekly"; a hero that names a
 * model and a processor we may not have in stock is the fabricated-data case
 * the house rules exist to stop, and it costs nothing to feed it the truth.
 *
 * The timer stops while a pointer is over the stage, while focus is inside it,
 * and while the tab is hidden, and never starts under `prefers-reduced-motion`
 * — where the stage becomes a plain first slide with no controls.
 */
const INTERVAL = 2600;

export function HeroShowcase({ slides }: { slides: readonly HeroSlide[] }): React.JSX.Element {
  const [index, setIndex] = React.useState(0);
  const [held, setHeld] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (held || slides.length < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => (i + 1) % slides.length);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [held, slides.length]);

  // Pointer tilt, fine pointers only — a touch device has no hover to leave.
  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = stage.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(px * 6).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${(py * -6).toFixed(2)}deg`);
  };

  const rest = (): void => {
    const el = stage.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <div className="phero-showcase">
      <div
        className="phero-stage"
        ref={stage}
        aria-live="polite"
        onMouseMove={onMove}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => {
          setHeld(false);
          rest();
        }}
        onFocusCapture={() => setHeld(true)}
        onBlurCapture={() => setHeld(false)}
      >
        {slides.map((s, i) => (
          <figure
            key={`${s.brand}-${s.model}-${s.grade}`}
            className={i === index ? 'phero-slide is-on' : 'phero-slide'}
          >
            <div className="phero-plate">
              <span
                className={`phero-grade phero-grade-${s.grade === 'A+' ? 'aplus' : s.grade.toLowerCase()}`}
              >
                {s.grade}
              </span>
              <span className="phero-condition">
                {s.condition}
                <small>{s.note}</small>
              </span>
            </div>

            <div className="phero-media">
              {s.photo ? (
                <img className="phero-photo" src={s.photo} alt="" />
              ) : (
                <div className={s.silver ? 'phero-laptop is-silver' : 'phero-laptop'}>
                  <div className="phero-lid">
                    <div className="phero-screen" data-tint={s.tint}>
                      <span className="phero-wordmark">{s.brand}</span>
                    </div>
                  </div>
                  <div className="phero-deck" />
                </div>
              )}
            </div>

            <figcaption className="phero-meta">
              <span className="phero-model">
                {s.brand} {s.model}
              </span>
              {s.spec && <span className="phero-chip">{s.spec}</span>}
            </figcaption>
          </figure>
        ))}
      </div>

      {slides.length > 1 && (
        <div className="phero-nav" role="tablist" aria-label="Featured laptops">
          {slides.map((s, i) => (
            <button
              key={`${s.brand}-${s.model}-${s.grade}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show ${s.brand} ${s.model}`}
              className={i === index ? 'is-on' : undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
