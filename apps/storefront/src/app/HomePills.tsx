'use client';

import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
/**
 * The claims above the hero — each one a filter into `/search`.
 *
 * **Every pill goes somewhere the rail can show.** The hrefs are the query
 * params `/public/search` actually reads, and each value is one the rail
 * publishes, so the page a buyer lands on has that filter ticked rather than
 * an unexplained, narrower list:
 *
 *   - `grade` — `A_PLUS`, `A`, `B`, the grade facet's own values.
 *   - `smin` / `bmin` — score and battery floors, "at least this".
 *   - `ship` — dispatch within N hours; 24 is one of the three limits the ship
 *     facet publishes (24 / 48 / 72).
 *   - `ram` — matched by exact value, not as a floor, so "16 GB and more" is
 *     16 and 32 together: every size the RAM facet lists from 16 upwards.
 *   - `stype` — both SSD kinds together, so "SSD" excludes eMMC and hard disk
 *     rather than one of the two SSD buses.
 *   - `pmax`, `qty`, `warr`, `res`, `feat` — the price, quantity, warranty,
 *     screen and feature facets, each at one value the rail lists.
 *
 * Nothing here filters on a value that comes from live stock (brand, series,
 * generation): the strip is static, and a brand pill goes dead the day that
 * brand's stock reaches zero. Nothing here filters on a dimension the rail
 * shows as "not measured" (battery cycles, charger included) either.
 *
 * **Grades opens on hover into the three it means.** The links are in the DOM
 * at all times, clipped rather than removed, so tabbing reaches them and
 * `:focus-within` opens the pill the same way hovering does. On a touch screen
 * there is no hover at all, so `@media (hover: none)` leaves it open — a
 * control that only works with a mouse is not a control on a phone.
 *
 * **The strip follows the header, and gets out of the way.** It is sticky
 * under the masthead. Scrolling down slides it up behind the masthead, so the
 * chrome shrinks to one row while a buyer reads; scrolling back up brings it
 * back, because moving up is reaching for navigation. The direction test is
 * what runs on scroll; the movement itself is a CSS transition on
 * `data-hidden`, so a reduced-motion preference can turn it off in one place.
 *
 * Numbers are mono with tabular figures, like every other number in the
 * product.
 */

/** `facets.grade` on `/public/search` — the values its rail filters on. */
const GRADES: readonly { code: string; label: string }[] = [
  { code: 'A_PLUS', label: 'A+' },
  { code: 'A', label: 'A' },
  { code: 'B', label: 'B' },
];

/** A run of pill text; `mono` marks the part that is a number. */
type Part = { text: string; mono?: boolean };

const FILTERS: readonly { key: string; href: string; parts: readonly Part[] }[] = [
  {
    key: 'qc',
    href: '/search?smin=90',
    parts: [{ text: 'QC' }, { text: '90+', mono: true }],
  },
  {
    key: 'battery',
    href: '/search?bmin=90',
    parts: [{ text: 'Battery' }, { text: '90+', mono: true }],
  },
  {
    key: 'ready',
    href: '/search?ship=24',
    parts: [{ text: 'Ready in' }, { text: '24 hr', mono: true }],
  },
  {
    key: 'price',
    href: '/search?pmax=35000',
    parts: [{ text: 'Under' }, { text: '₹35,000', mono: true }],
  },
  {
    key: 'ram',
    href: '/search?ram=16&ram=32',
    parts: [{ text: '16 GB', mono: true }, { text: 'and more' }],
  },
  {
    key: 'ssd',
    href: '/search?stype=NVME_SSD&stype=SATA_SSD',
    parts: [{ text: 'SSD' }],
  },
  {
    key: 'fhd',
    href: '/search?res=fhd',
    parts: [{ text: 'Full HD' }],
  },
  {
    key: 'touch',
    href: '/search?res=touch',
    parts: [{ text: 'Touchscreen' }],
  },
  {
    key: 'backlit',
    href: '/search?feat=backlit',
    parts: [{ text: 'Backlit keyboard' }],
  },
  {
    key: 'bulk',
    href: '/search?qty=25',
    parts: [{ text: '25+', mono: true }, { text: 'units' }],
  },
  {
    key: 'warranty',
    href: '/search?warr=12',
    parts: [{ text: '12-month', mono: true }, { text: 'warranty' }],
  },
];

/**
 * Below this many pixels of scroll the strip is always shown: it is still in,
 * or a hair under, its natural place, and hiding it there flickers.
 */
const REVEAL_ABOVE_PX = 72;

export function HomePills(): React.JSX.Element {
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        // A couple of pixels of jitter from a trackpad is not a direction.
        if (Math.abs(y - lastY) < 3) return;
        setHidden(y > lastY && y > REVEAL_ABOVE_PX);
        lastY = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="hpills" data-hidden={hidden ? '' : undefined}>
      <ul>
        <li className="hpill hpill-promo hpill-grades">
          <span>Grades</span>
          <span className="hpill-out">
            {GRADES.map((g) => (
              <Link key={g.code} className="hpill-grade mono" href={`/search?grade=${g.code}`}>
                {g.label}
              </Link>
            ))}
          </span>
        </li>
        {FILTERS.map((f) => (
          <li key={f.key}>
            <Link className="hpill hpill-promo" href={f.href as Route}>
              {f.parts.map((p) =>
                p.mono ? (
                  <b key={p.text} className="mono">
                    {p.text}
                  </b>
                ) : (
                  <span key={p.text}>{p.text}</span>
                ),
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
