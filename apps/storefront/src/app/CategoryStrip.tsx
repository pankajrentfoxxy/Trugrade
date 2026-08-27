/**
 * Block 3 of `09_FRONTEND_LOCKED.md` §7 — the category strip, lifted out of the
 * homepage so `/` and `/search` carry one strip rather than two near-copies.
 *
 * **Every entry resolves to a real filter on `/search`.** The strip used to
 * carry marketing groupings — "Business", "Mobile workstations" — pointing at
 * `/browse?c=Business`, a route that does not exist and a grouping nothing in
 * the database records. A nav item that 404s is worse than one fewer nav item,
 * and one that promises a category we cannot compute is a fabricated screen.
 */
const ENTRIES: ReadonlyArray<{ label: string; href: string; match: string }> = [
  { label: 'All laptops', href: '/search', match: '' },
  { label: 'Ready in 24 h', href: '/search?ship=24', match: 'ship=24' },
  { label: 'Grade A+', href: '/search?grade=A_PLUS', match: 'grade=A_PLUS' },
  { label: 'Battery 90%+', href: '/search?bmin=90', match: 'bmin=90' },
  { label: 'Inspection score 90+', href: '/search?smin=90', match: 'smin=90' },
  { label: '16 GB or more', href: '/search?ram=16&ram=32&ram=64', match: 'ram=16' },
];

export function CategoryStrip({
  /** The live query string on `/search`, so the active entry is the true one. */
  query = null,
}: {
  query?: string | null;
}): React.JSX.Element {
  return (
    <div className="cats">
      <div className="wrap">
        {ENTRIES.map((e) => {
          const on =
            query === null
              ? false
              : e.match === ''
                ? query === ''
                : query.includes(e.match);
          return (
            <a key={e.label} href={e.href} className={on ? 'on' : undefined}>
              {e.label}
            </a>
          );
        })}
        {/* Non-interactive on purpose: the ambition reads without promising
            stock that does not exist. */}
        <span className="soon">
          Desktops, monitors &amp; parts <b>SOON</b>
        </span>
      </div>
    </div>
  );
}
