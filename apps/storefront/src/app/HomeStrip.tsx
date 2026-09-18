import fs from 'node:fs';
import path from 'node:path';

/**
 * The image strip under the hero: four curved cards, supplied artwork.
 *
 * `public/home/bench-1.png` … `bench-4.png`, in order. Whichever exist are
 * rendered; a missing one falls back to its number rather than a broken-image
 * icon, so the row is always four complete cards. The directory is read once at
 * module load — it does not change while the server runs — which does mean a
 * newly dropped file needs a server restart to appear.
 *
 * The cards are 2:3 to match the source images, so `cover` crops essentially
 * nothing. That matters here: three of these are self-contained posters whose
 * headings and calls to action sit hard against the top and bottom edges, and a
 * 3:4 card cut them off.
 *
 * There is no caption under each card. These carry their own messaging, and the
 * four process steps this section first held are already stated further down
 * the page — one source for them, not two that can drift apart.
 *
 * NOTE ON THE ARTWORK, recorded rather than argued: three of these are stock
 * templates still carrying placeholder contact details for domains we do not
 * own and commercial claims nothing here honours — a 40% and a 45% discount no
 * pricing path applies, and a blanket "1-Year Warranty Included" that
 * contradicts `SearchResult.warrantyMonths`, which is per-SKU and nullable.
 * That was raised and the decision was to publish them. Replacing a file needs
 * no code change.
 */

const SLOTS = [1, 2, 3, 4] as const;

/** Files present on disk, in slot order. Read once; see the note above. */
const PHOTOS: ReadonlyArray<string | null> = (() => {
  let present: string[] = [];
  try {
    present = fs.readdirSync(path.join(process.cwd(), 'public', 'home'));
  } catch {
    present = [];
  }
  return SLOTS.map((n) => present.find((f) => f.startsWith(`bench-${n}.`)) ?? null);
})();

export function HomeStrip(): React.JSX.Element {
  return (
    <section className="strip2" aria-labelledby="strip2-title">
      <div className="wrap">
        <h2 id="strip2-title" className="sr-only">
          Featured
        </h2>

        <ul className="strip2-grid">
          {SLOTS.map((n, i) => {
            const photo = PHOTOS[i];
            return (
              <li
                key={n}
                className={photo ? 'strip2-card' : 'strip2-card is-blank'}
                style={{ '--i': i } as React.CSSProperties}
              >
                {photo ? (
                  /* alt="" — these are decorative promotional artwork, and the
                     text baked into them is not text a screen reader can read
                     anyway. Nothing here is the page's only route to anything. */
                  <img src={`/home/${photo}`} alt="" loading="lazy" />
                ) : (
                  <span className="strip2-num mono" aria-hidden="true">
                    {String(n).padStart(2, '0')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
