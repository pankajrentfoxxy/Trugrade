import * as React from 'react';
import Link from 'next/link';

/**
 * The photo hero: the first thing under the filter strip, above the carousel.
 *
 * THE PICTURE DECIDES THE LAYOUT AND THE PALETTE
 * ----------------------------------------------
 * `public/home/hero.jpg` is a studio shot on a flat sky blue: a man holding a
 * laptop, thumb up, in the right-hand 40% of the frame, and nothing at all in
 * the left 60%. So the copy sits on the left, over the empty blue, and the
 * picture is anchored to its right edge so a narrower banner crops sky and
 * never the man.
 *
 * The colours are read off that blue (`--hero-*` in `globals.css`):
 *   - **Deep navy** for the headline and body. It is the one ink that clears
 *     contrast on the sky — white on this blue is about 2.3:1 and fails even
 *     for large text, so white never sits on the sky bare.
 *   - **White on a navy block** for the second headline line: the inverse of
 *     the first, which is where the "different colours" come from without
 *     putting an unreadable colour on the photograph.
 *   - **Navy on a yellow marker** for the rotating promise. Yellow is the
 *     complement of this blue, so it is the loudest thing in the frame, and it
 *     carries its own ink rather than being text itself.
 *
 * MOTION
 * ------
 * Each line rises in on load, staggered by `--i`. The marker line then cycles
 * through three promises by sliding a column of them up one line at a time; a
 * copy of the first is appended so the loop has no jump. Under
 * `prefers-reduced-motion` nothing moves and the first promise stays.
 *
 * The cycling line is decoration to a screen reader: it is `aria-hidden`, and
 * the paragraph carries all three promises once as its accessible name.
 *
 * THE CLAIMS
 * ----------
 * The copy here is marketing, written to direction, not a database read. No
 * count, price or stock figure appears in it. Two of the perks — round-the-
 * clock support and free repair — are promises about the service, and they
 * are only as true as the support desk and the warranty terms make them; the
 * footer's customer-care hours and `SearchResult.warrantyMonths` are the
 * places that say what is actually offered today.
 */

const PROMISES = ['Just order & chill.', 'The rest is up to us.', 'Tested. Sealed. Delivered.'] as const;

const PERKS: readonly { key: string; label: string; icon: React.JSX.Element }[] = [
  {
    key: 'support',
    label: '24x7 support',
    icon: (
      <path d="M5 13v-1a7 7 0 0 1 14 0v1M5 13a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h1v-5H5Zm14 0a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1v-5h1Zm-1 5v.5A2.5 2.5 0 0 1 15.5 21H13" />
    ),
  },
  {
    key: 'repair',
    label: 'Free repair',
    icon: (
      <path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8.5 8.5a2.1 2.1 0 0 1-3-3L18 10M14.5 6.5 17 4a4 4 0 0 0-5.5 5.5l-8 8a2.1 2.1 0 0 0 3 3" />
    ),
  },
  {
    key: 'delivery',
    label: 'Doorstep delivery',
    icon: (
      <>
        <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
        <circle cx="7" cy="17.5" r="1.8" />
        <circle cx="17" cy="17.5" r="1.8" />
      </>
    ),
  },
  {
    key: 'gst',
    label: 'GST invoice',
    icon: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6" />,
  },
];

/** `--i` is the line's place in the rise-in stagger. */
const at = (i: number): React.CSSProperties => ({ '--i': i }) as React.CSSProperties;

export function HomeHero(): React.JSX.Element {
  return (
    <section className="hhero" aria-labelledby="hhero-title">
      {/* alt="" — the picture is set dressing for the copy beside it, and
          everything it says is said in that copy. */}
      <img
        className="hhero-img"
        src="/home/hero.jpg"
        alt=""
        width={2400}
        height={961}
        fetchPriority="high"
        decoding="async"
      />

      <div className="hhero-copy">
        <p className="hhero-eyebrow" style={at(0)}>
          Refurbished &middot; Inspected &middot; Sealed
        </p>

        <h1 id="hhero-title" className="hhero-title">
          <span className="hhero-line" style={at(1)}>
            Refurbished laptops
          </span>
          <span className="hhero-line" style={at(2)}>
            <span className="hhero-inv">at your doorstep.</span>
          </span>
        </h1>

        <p className="hhero-rot" style={at(3)} aria-label={PROMISES.join(' ')}>
          <span className="hhero-rot-col" aria-hidden="true">
            {[...PROMISES, PROMISES[0]].map((text, i) => (
              <span className="hhero-rot-row" key={i}>
                <span className="hhero-mark">{text}</span>
              </span>
            ))}
          </span>
        </p>

        <p className="hhero-sub" style={at(4)}>
          Pick a machine, place the order and relax. We open it, test it, seal it and bring it to
          your door on one GST invoice.
        </p>

        <ul className="hhero-perks" style={at(5)}>
          {PERKS.map((p) => (
            <li key={p.key}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {p.icon}
              </svg>
              {p.label}
            </li>
          ))}
        </ul>

        <div className="hhero-cta" style={at(6)}>
          <Link className="hhero-btn is-primary" href="/search">
            Shop laptops
            <span className="hhero-arrow" aria-hidden="true">
              &rarr;
            </span>
          </Link>
          <Link className="hhero-btn is-ghost" href="/bulk">
            Bulk order
          </Link>
        </div>
      </div>
    </section>
  );
}
