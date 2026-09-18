/**
 * The three claims, as pills, directly above the hero.
 *
 * **Grades opens on hover into the three it means.** Each one is a real link
 * into `/search?grade=…`, using the facet values the API publishes — `A_PLUS`,
 * `A`, `B` — so the rail on the page it lands on shows that grade already
 * ticked. A pill that expands into nothing would be decoration; these go
 * somewhere.
 *
 * The three links are in the DOM at all times, clipped rather than removed, so
 * the keyboard reaches them: tabbing in fires `:focus-within` and the pill
 * opens the same way hovering does. On a touch screen there is no hover at all,
 * so `@media (hover: none)` leaves it open permanently — a control that only
 * works with a mouse is not a control on a phone.
 *
 * QC and Delivery are links too, into the score and dispatch filters `/search`
 * already carries. Every pill here goes somewhere the rail can show.
 */

/** `facets.grade` on `/public/search` — the values its rail filters on. */
const GRADES: readonly { code: string; label: string }[] = [
  { code: 'A_PLUS', label: 'A+' },
  { code: 'A', label: 'A' },
  { code: 'B', label: 'B' },
];

export function HomePills(): React.JSX.Element {
  return (
    <div className="hpills">
      <ul>
        <li className="hpill hpill-grades">
          <span>Grades</span>
          <span className="hpill-out">
            {GRADES.map((g) => (
              <a key={g.code} className="hpill-grade mono" href={`/search?grade=${g.code}`}>
                {g.label}
              </a>
            ))}
          </span>
        </li>
        {/*
          Both are real filters on `/public/search`: `smin` keeps a result
          only if its score is at least the value, and `ship` keeps it only if
          it dispatches within that many hours. 48 is one of the three limits
          the ship facet publishes (24 / 48 / 72), so the rail on the page this
          lands on shows it ticked rather than an unexplained narrower list.
        */}
        <li>
          <a className="hpill hpill-promo" href="/search?smin=90">
            <span>QC</span>
            <b className="mono">&gt; 90</b>
          </a>
        </li>
        <li>
          <a className="hpill hpill-promo" href="/search?ship=48">
            <span>Delivery</span>
            <b className="mono">48 hr</b>
          </a>
        </li>
      </ul>
    </div>
  );
}
