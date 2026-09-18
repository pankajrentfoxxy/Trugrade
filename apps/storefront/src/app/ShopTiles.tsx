import type { SearchResult } from '../lib/api';

/**
 * The four ways into the catalogue, under the hero.
 *
 * Each tile is a real, executable filter on `/search` — not a marketing
 * grouping. The earlier category strip carried entries like "Business" that
 * pointed at routes and groupings nothing in the database records; a tile that
 * promises a category we cannot compute is a fabricated screen.
 *
 * Each also carries how much stock stands behind it, counted from the same
 * results the page already has. A tile whose count is zero is not rendered: an
 * entry point onto an empty board is worse than one fewer entry point.
 */
export function ShopTiles({
  results,
}: {
  results: readonly SearchResult[];
}): React.JSX.Element | null {
  const count = (fn: (r: SearchResult) => boolean): number => results.filter(fn).length;

  const tiles = [
    {
      href: '/search?grade=A_PLUS',
      title: 'Top grade',
      body: 'A+ only — the cosmetic band with the fewest marks.',
      n: count((r) => r.grade === 'A_PLUS'),
    },
    {
      href: '/search?smin=90',
      title: 'Inspection score 90+',
      body: 'Machines that scored 90 or better on the bench.',
      n: count((r) => r.avgQcScore !== null && r.avgQcScore >= 90),
    },
    {
      href: '/search?bmin=90',
      title: 'Battery 90%+',
      body: 'Measured battery health, not the seller’s estimate.',
      n: count((r) => r.batteryMin !== null && r.batteryMin >= 90),
    },
    {
      href: '/search?ship=24',
      title: 'Ready in 24 hours',
      body: 'Sealed, in stock and dispatchable tomorrow.',
      n: count((r) => r.shipHours !== null && r.shipHours <= 24),
    },
  ].filter((t) => t.n > 0);

  if (tiles.length === 0) return null;

  return (
    <section className="shoptiles" aria-labelledby="shoptiles-title">
      <div className="wrap">
        <h2 id="shoptiles-title" className="sr-only">
          Ways to shop
        </h2>
        <div className="shoptiles-grid">
          {tiles.map((t) => (
            <a key={t.href} className="shoptile" href={t.href}>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              <span className="shoptile-n">
                <b className="mono">{t.n}</b> {t.n === 1 ? 'model' : 'models'} &rarr;
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
