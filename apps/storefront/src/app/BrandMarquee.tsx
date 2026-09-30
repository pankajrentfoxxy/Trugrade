import * as React from 'react';

/**
 * "Brands we deal with": one row of logos that runs left to right without
 * stopping, under the promo carousel.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * The six marks under `public/brands/marquee/` are supplied artwork, and the
 * list below is hand-kept to match them — it is a statement of which makers we
 * trade in, not a read of what is in stock today. The `brand` facet on
 * `/search` is the place that says what can be bought right now; a brand can
 * be here with nothing on the shelf this week, and the row does not claim
 * otherwise. Adding a brand is dropping a file in and adding a line.
 *
 * WHY EACH LOGO HAS A SCALE
 * -------------------------
 * The files do not agree on a canvas. Acer, Lenovo and Microsoft are wide
 * wordmarks cropped tight; Apple and Dell are square marks; Asus is a wordmark
 * floating in the middle of a square with empty space above and below. Fitted
 * into one cell as they are, Asus would draw at a third the size of the rest.
 * So each carries a `scale` that brings its ink, not its canvas, to the same
 * visual weight.
 *
 * HOW IT RUNS
 * -----------
 * Pure CSS, no script. The track holds the list four times and slides from
 * `-50%` to `0`, so what leaves on the right is exactly what enters on the
 * left and the loop has no seam. Four copies, not two, because half the track
 * has to be wider than the window, and two copies of six logos are not on a
 * wide monitor. It does not pause on hover — it was asked to run non-stop.
 * Under `prefers-reduced-motion` it does not run at all: the first copy sits
 * still as a centred, wrapping row.
 *
 * The images load up front rather than lazily. A lazy image in a moving row
 * is fetched only as it nears the window, so it would slide in blank; six
 * small files are cheaper than that.
 *
 * Only the first copy is read out. The other three are `aria-hidden` and their
 * images carry no alt text, so a screen reader hears six brands once.
 */
interface Brand {
  name: string;
  src: string;
  /** The file's pixel size, so the browser knows its shape before it loads. */
  width: number;
  height: number;
  /** Brings the ink, not the canvas, to the row's common visual weight. */
  scale: number;
}

const BRANDS: readonly Brand[] = [
  { name: 'Dell', src: '/brands/marquee/dell.svg', width: 300, height: 300, scale: 1.05 },
  { name: 'Lenovo', src: '/brands/marquee/lenovo.png', width: 2400, height: 800, scale: 0.9 },
  { name: 'Apple', src: '/brands/marquee/apple.png', width: 2400, height: 2398, scale: 0.92 },
  { name: 'Asus', src: '/brands/marquee/asus.png', width: 2400, height: 2400, scale: 2.5 },
  { name: 'Microsoft', src: '/brands/marquee/microsoft.png', width: 1530, height: 479, scale: 1.15 },
  { name: 'Acer', src: '/brands/marquee/acer.png', width: 480, height: 150, scale: 0.95 },
];

const COPIES = [0, 1, 2, 3] as const;

export function BrandMarquee(): React.JSX.Element {
  return (
    <section className="bmq" aria-labelledby="bmq-title">
      <h2 id="bmq-title" className="bmq-title">
        Brands we deal with
      </h2>

      <div className="bmq-window">
        <div className="bmq-track">
          {COPIES.map((copy) => (
            <ul className="bmq-set" key={copy} aria-hidden={copy > 0 ? 'true' : undefined}>
              {BRANDS.map((b) => (
                <li className="bmq-cell" key={b.name}>
                  <img
                    src={b.src}
                    alt={copy === 0 ? b.name : ''}
                    width={b.width}
                    height={b.height}
                    decoding="async"
                    style={{ '--s': b.scale } as React.CSSProperties}
                  />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
