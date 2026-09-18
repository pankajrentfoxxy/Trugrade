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
 *   - `ship` — dispatch within N hours; 24 and 48 are two of the three limits
 *     the ship facet publishes (24 / 48 / 72).
 *   - `ram` — matched by exact value, not as a floor, so "16 GB and more" is
 *     16 and 32 together: every size the RAM facet lists from 16 upwards.
 *
 * **Grades opens on hover into the three it means.** The links are in the DOM
 * at all times, clipped rather than removed, so tabbing reaches them and
 * `:focus-within` opens the pill the same way hovering does. On a touch screen
 * there is no hover at all, so `@media (hover: none)` leaves it open — a
 * control that only works with a mouse is not a control on a phone.
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
    parts: [{ text: 'QC' }, { text: '> 90', mono: true }],
  },
  {
    key: 'delivery',
    href: '/search?ship=48',
    parts: [{ text: 'Delivery' }, { text: '48 hr', mono: true }],
  },
  {
    key: 'ram',
    href: '/search?ram=16&ram=32',
    parts: [{ text: '16 GB', mono: true }, { text: 'and more' }],
  },
  {
    key: 'ready',
    href: '/search?ship=24',
    parts: [{ text: 'Ready in' }, { text: '24 hr', mono: true }],
  },
  {
    key: 'battery',
    href: '/search?bmin=90',
    parts: [{ text: 'Battery' }, { text: '90+', mono: true }],
  },
];

export function HomePills(): React.JSX.Element {
  return (
    <div className="hpills">
      <ul>
        <li className="hpill hpill-promo hpill-grades">
          <span>Grades</span>
          <span className="hpill-out">
            {GRADES.map((g) => (
              <a key={g.code} className="hpill-grade mono" href={`/search?grade=${g.code}`}>
                {g.label}
              </a>
            ))}
          </span>
        </li>
        {FILTERS.map((f) => (
          <li key={f.key}>
            <a className="hpill hpill-promo" href={f.href}>
              {f.parts.map((p) =>
                p.mono ? (
                  <b key={p.text} className="mono">
                    {p.text}
                  </b>
                ) : (
                  <span key={p.text}>{p.text}</span>
                ),
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
