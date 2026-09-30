'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { normalisePincode } from '@trugrade/contracts';
import type { FacetGroup } from '../lib/api';

/**
 * The fifteen facets — `09_FRONTEND_LOCKED.md` §6.
 *
 * Four rules drive every decision here.
 *
 * **Every facet state lives in the URL.** A buyer sends a colleague a link and
 * it reproduces exactly what they saw. That is the requirement; the useful side
 * effect is that it removes the need for a state library, because the URL *is*
 * the state. The rail is handed the query string by the server, so what it
 * renders on first paint is already what the URL says.
 *
 * **Counts are live.** Each count arrives computed with every other facet group
 * applied but not its own, so ticking "Acer" leaves the other brands countable
 * and addable rather than collapsing the rail to a column of zeroes.
 *
 * **A zero-count option is disabled and dimmed, never hidden.** Options that
 * vanish make people think the site is broken, and a disabled row still says
 * the dimension exists. A dimension nothing MEASURES is different again: it
 * prints the reason in `--ink-4` rather than a zero, because "not recorded" and
 * "recorded, none found" are different statements.
 *
 * **Battery health, inspection score and inspected grade stay open, above the
 * fold.** No competitor can offer them, because offering them means having
 * opened the machine. They are the product's whole argument expressed as a
 * filter, so they are not buried under Storage.
 */
export interface FilterRailProps {
  facets: Record<string, FacetGroup>;
  /** The live query string, minus the leading `?`. Server-rendered state. */
  query: string;
  /** Result count, so the sheet's close button can say what it will show. */
  total: number;
  /**
   * The same facets with NO filter applied — what the shelf holds before the
   * buyer narrows it. It is what lets the rail tell "your filters left only
   * this option" from "there was only ever this option". Absent when that
   * read failed, in which case nothing is ticked on the buyer's behalf.
   */
  baseline?: Record<string, FacetGroup>;
}

/** Params that are not filters: they must not appear as an applied chip. */
const NOT_A_FILTER = new Set(['sort', 'page', 'per', 'view']);

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function FilterRail({ facets, query, total, baseline }: FilterRailProps): React.JSX.Element {
  const router = useRouter();
  const params = React.useMemo(() => new URLSearchParams(query), [query]);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pincodeError, setPincodeError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  /**
   * Write through to the URL. `push`, not `replace`: a filter is a place a buyer
   * navigated to, and back must undo it. Page resets, because page 4 of a
   * different result set is not the page they were looking at.
   *
   * The push itself is wrapped in `startTransition`. Without it, every tick of
   * a checkbox re-suspends the whole `/search` segment and Next swaps in
   * `loading.tsx` — rail and grid both vanish behind a skeleton and come back
   * a moment later, which reads as the page reloading rather than a filter
   * applying. Inside a transition, React keeps this render on screen, fully
   * interactive, until the new one is ready, then swaps once.
   */
  const commit = React.useCallback(
    (next: URLSearchParams): void => {
      next.delete('page');
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      // The cast is on the ONE line that builds it, not on the router.
      const href = (qs ? `/search?${qs}` : '/search') as Route;
      startTransition(() => {
        router.push(href, { scroll: false });
      });
    },
    [router],
  );

  const toggle = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    const all = next.getAll(key);
    next.delete(key);
    for (const v of all) if (v !== value) next.append(key, v);
    if (!all.includes(value)) next.append(key, value);
    commit(next);
  };

  const setValue = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    commit(next);
  };

  /** A radio-style pill group: picking the active one clears it. */
  const pick = (key: string, value: string): void =>
    setValue(key, params.get(key) === value ? '' : value);

  const applied = [...params.entries()].filter(([k, v]) => !NOT_A_FILTER.has(k) && v !== '');

  /**
   * The option a group is left with because of filters set in OTHER groups.
   *
   * Tick "MacBook Air" under Series and every result is an Apple, an M1, an
   * 8 GB machine: those follow from the choice, and the rail shows them ticked
   * so the buyer can see what their one click narrowed the shelf to, instead
   * of three groups of greyed-out rows with one live row they have to notice.
   *
   * Three conditions, all of them needed:
   *   - **A filter is applied somewhere.** Nothing is ticked on arrival.
   *   - **The group has no choice of its own and exactly one option with
   *     stock.** Two live options is a choice still to make, not a consequence.
   *   - **Unfiltered, the group had at least two.** That is what makes it a
   *     consequence of the buyer's filters. Every machine we hold might be an
   *     NVMe SSD; ticking that the moment a brand is picked would credit the
   *     buyer with a decision the catalogue made.
   *
   * It is a readout, not a filter: it is not in the URL, it is not counted in
   * "applied", and it has no chip. Removing the choice that caused it clears it.
   */
  const impliedIn = (key: string): string | null => {
    if (applied.length === 0) return null;
    const group = facets[key];
    const before = baseline?.[key];
    if (!group || !before || group.unavailable) return null;
    if (group.options.some((o) => o.selected)) return null;
    const live = group.options.filter((o) => o.count > 0);
    const [only] = live;
    if (live.length !== 1 || !only) return null;
    if (before.options.filter((o) => o.count > 0).length < 2) return null;
    return only.value;
  };

  /** Whether the URL's price bounds are exactly this band's. */
  const inBand = (b: { min: string; max: string }): boolean =>
    (params.get('pmin') ?? '') === b.min && (params.get('pmax') ?? '') === b.max;

  return (
    <div className="railzone">
      {/* Under 900px the rail is a full-screen sheet behind this button. It is
          `hidden` on desktop by CSS, never by a media query in JavaScript — a
          layout that depends on a resize listener flickers on first paint. */}
      <button
        type="button"
        className="fsheetbtn"
        onClick={() => setSheetOpen(true)}
        aria-expanded={sheetOpen}
        aria-controls="filter-rail"
      >
        Filters {applied.length > 0 && <span className="mono">({applied.length})</span>}
      </button>

      <aside
        id="filter-rail"
        className={sheetOpen ? 'filters open' : 'filters'}
        aria-label="Filters"
        aria-busy={isPending}
      >
        <div className="fhead">
          <b>Filters</b>
          <span className="n mono">{applied.length} applied</span>
          <button
            type="button"
            className="clr"
            onClick={() => commit(new URLSearchParams())}
            disabled={applied.length === 0}
          >
            Clear all
          </button>
          <button type="button" className="fclose" onClick={() => setSheetOpen(false)}>
            <span aria-hidden="true">&times;</span>
            <span className="sr-only">Close filters</span>
          </button>
        </div>

        <div className="fsearch">
          <label className="sr-only" htmlFor="fwithin">
            Search within results
          </label>
          <Debounced
            id="fwithin"
            type="text"
            placeholder="Search within results"
            value={params.get('q') ?? ''}
            onCommit={(v) => setValue('q', v)}
          />
        </div>

        {applied.length > 0 && (
          <div className="applied">
            {applied.map(([k, v]) => (
              <button
                key={`${k}=${v}`}
                type="button"
                className="ftag"
                onClick={() => (isMulti(k) ? toggle(k, v) : setValue(k, ''))}
              >
                {chipLabel(facets, k, v)} <i aria-hidden="true">&times;</i>
                <span className="sr-only">Remove filter</span>
              </button>
            ))}
          </div>
        )}

        {/* 1 */}
        <Facet name="Brand" open>
          <Options
            group={facets.brand}
            implied={impliedIn('brand')}
            onToggle={(v) => toggle('brand', v)}
          />
        </Facet>

        {/* 2 */}
        <Facet name="Series" open>
          <Options
            group={facets.series}
            implied={impliedIn('series')}
            onToggle={(v) => toggle('series', v)}
          />
        </Facet>

        {/* 3 */}
        <Facet name="Processor" open>
          <SubHead>Family</SubHead>
          <Options
            group={facets.cpu}
            implied={impliedIn('cpu')}
            onToggle={(v) => toggle('cpu', v)}
          />
          <div className="fsub">
            <SubHead>Generation</SubHead>
            <Options
              group={facets.gen}
              implied={impliedIn('gen')}
              onToggle={(v) => toggle('gen', v)}
            />
          </div>
        </Facet>

        {/* 4 */}
        <Facet name="Memory" open>
          <Options
            group={facets.ram}
            implied={impliedIn('ram')}
            onToggle={(v) => toggle('ram', v)}
          />
        </Facet>

        {/* 5 */}
        <Facet name="Storage">
          <SubHead>Capacity</SubHead>
          <Options
            group={facets.sgb}
            implied={impliedIn('sgb')}
            onToggle={(v) => toggle('sgb', v)}
          />
          <div className="fsub">
            <SubHead>Type</SubHead>
            <Options
              group={facets.stype}
              implied={impliedIn('stype')}
              onToggle={(v) => toggle('stype', v)}
            />
          </div>
        </Facet>

        {/* 6 — the argument, open and above the fold */}
        <Facet name="Inspected grade" open>
          <Options
            group={facets.grade}
            implied={impliedIn('grade')}
            onToggle={(v) => toggle('grade', v)}
          />
        </Facet>

        {/* 7 — the argument */}
        <Facet name="Battery health" open>
          <Band
            from={params.get('bmin')}
            to={params.get('bmax')}
            min={0}
            max={100}
            suffix="%"
            fromLabel="Minimum measured battery health, percent"
            toLabel="Maximum measured battery health, percent"
            onCommit={(lo, hi) => {
              const next = new URLSearchParams(params);
              if (lo) next.set('bmin', lo);
              else next.delete('bmin');
              if (hi) next.set('bmax', hi);
              else next.delete('bmax');
              commit(next);
            }}
          />
        </Facet>

        {/* 8 — the argument */}
        <Facet name="Inspection score" open>
          <Band
            from={params.get('smin')}
            to={null}
            min={0}
            max={100}
            fromLabel="Minimum inspection score, out of 100"
            toLabel="Maximum inspection score, out of 100"
            onCommit={(lo) => setValue('smin', lo)}
          />
          <div className="fsub">
            <Checks
              items={SCORE_FLOORS.map((floor) => ({
                key: floor,
                label: <span className="mono">{floor}+</span>,
                checked: params.get('smin') === floor,
              }))}
              onToggle={(floor) => pick('smin', floor)}
            />
          </div>
        </Facet>

        {/* 9 */}
        <Facet name="Landed price" open>
          <Band
            from={params.get('pmin')}
            to={params.get('pmax')}
            min={0}
            max={500000}
            prefix="₹"
            fromLabel="Minimum landed price in rupees"
            toLabel="Maximum landed price in rupees"
            track={false}
            onCommit={(lo, hi) => {
              const next = new URLSearchParams(params);
              if (lo) next.set('pmin', lo);
              else next.delete('pmin');
              if (hi) next.set('pmax', hi);
              else next.delete('pmax');
              commit(next);
            }}
          />
          <div className="fsub">
            <Checks
              items={PRICE_BANDS.map((b) => ({
                key: b.label,
                label: <span className="mono">{b.label}</span>,
                checked: inBand(b),
              }))}
              onToggle={(label) => {
                const band = PRICE_BANDS.find((b) => b.label === label);
                if (!band) return;
                // One band at a time: it is a pair of bounds, not a set, so
                // ticking the one that is on clears it and ticking another
                // replaces it.
                const next = new URLSearchParams(params);
                next.delete('pmin');
                next.delete('pmax');
                if (!inBand(band)) {
                  if (band.min) next.set('pmin', band.min);
                  if (band.max) next.set('pmax', band.max);
                }
                commit(next);
              }}
            />
          </div>
        </Facet>

        {/* 10 */}
        <Facet name="Screen">
          <SubHead>Size</SubHead>
          <Options
            group={facets.screen}
            implied={impliedIn('screen')}
            onToggle={(v) => toggle('screen', v)}
          />
          <div className="fsub">
            <SubHead>Resolution</SubHead>
            <Options
              group={facets.res}
              implied={impliedIn('res')}
              onToggle={(v) => toggle('res', v)}
            />
          </div>
        </Facet>

        {/* 11 */}
        <Facet name="Delivery">
          <Options
            group={facets.ship}
            implied={impliedIn('ship')}
            onToggle={(v) => toggle('ship', v)}
          />
          <div className="range">
            <label className="sr-only" htmlFor="fpin">
              Delivery pincode
            </label>
            <Debounced
              id="fpin"
              type="text"
              inputMode="numeric"
              className="mono"
              placeholder="Delivery pincode"
              value={params.get('pin') ?? ''}
              onCommit={(v) => {
                // Six digits, first not zero. The message names what is wrong
                // and what a right one looks like; "Invalid input" would not.
                const normalised = v === '' ? null : normalisePincode(v);
                if (v !== '' && !normalised) {
                  setPincodeError(
                    `${v} is not an Indian pincode. It is six digits and does not start with a zero — for example 122002.`,
                  );
                  return;
                }
                setPincodeError(null);
                setValue('pin', normalised ?? '');
              }}
            />
          </div>
          {pincodeError !== null && (
            <p className="ferr" role="alert">
              {pincodeError}
            </p>
          )}
        </Facet>

        {/* 12 */}
        <Facet name="Supply point city">
          <Options
            group={facets.city}
            implied={impliedIn('city')}
            onToggle={(v) => toggle('city', v)}
          />
        </Facet>

        {/* 13 */}
        <Facet name="Quantity available">
          {/* One floor at a time, so ticking the one that is on clears it. */}
          <Options group={facets.qty} implied={impliedIn('qty')} onToggle={(v) => pick('qty', v)} />
        </Facet>

        {/* 14 */}
        <Facet name="Features">
          <Options
            group={facets.feat}
            implied={impliedIn('feat')}
            onToggle={(v) => toggle('feat', v)}
          />
        </Facet>

        {/* 15 */}
        <Facet name="Warranty">
          <Options
            group={facets.warr}
            implied={impliedIn('warr')}
            onToggle={(v) => toggle('warr', v)}
          />
        </Facet>

        <div className="fdone">
          <button type="button" onClick={() => setSheetOpen(false)}>
            Show <span className="mono">{total}</span> unit{total === 1 ? '' : 's'}
          </button>
        </div>
      </aside>

      {sheetOpen && (
        <button
          type="button"
          className="fscrim"
          onClick={() => setSheetOpen(false)}
          aria-label="Close filters"
        />
      )}
    </div>
  );
}

/** The inspection-score floors offered as one-click choices. */
const SCORE_FLOORS = ['90', '80', '70'] as const;

const PRICE_BANDS: ReadonlyArray<{ label: string; min: string; max: string }> = [
  { label: 'Under ₹25,000', min: '', max: '25000' },
  { label: '₹25–35,000', min: '25000', max: '35000' },
  { label: '₹35–50,000', min: '35000', max: '50000' },
  { label: '₹50,000+', min: '50000', max: '' },
];

/** Keys that hold several values at once, so a chip removes one rather than all. */
const MULTI = new Set([
  'brand',
  'series',
  'cpu',
  'gen',
  'ram',
  'sgb',
  'stype',
  'grade',
  'screen',
  'res',
  'ship',
  'city',
  'feat',
  'warr',
]);
const isMulti = (key: string): boolean => MULTI.has(key);

/** What an applied chip says. A chip reading `bmin=85` is a chip nobody can read. */
function chipLabel(facets: Record<string, FacetGroup>, key: string, value: string): string {
  const fromFacet = facets[key]?.options.find((o) => o.value === value)?.label;
  if (fromFacet !== undefined) return fromFacet;
  if (key === 'q') return `“${value}”`;
  if (key === 'bmin') return `Battery ${value}%+`;
  if (key === 'bmax') return `Battery up to ${value}%`;
  if (key === 'smin') return `Score ${value}+`;
  if (key === 'pmin') return `From ₹${RUPEES.format(Number(value))}`;
  if (key === 'pmax') return `Up to ₹${RUPEES.format(Number(value))}`;
  if (key === 'qty') return `${value}+ at one supply point`;
  if (key === 'pin') return `Delivering to ${value}`;
  return value;
}

function Facet({
  name,
  open = false,
  children,
}: {
  name: string;
  open?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details open={open}>
      <summary>{name}</summary>
      <div className="fbody">{children}</div>
    </details>
  );
}

/** What an implied tick says about itself. */
const IMPLIED_HINT = 'Follows from your other filters';

/**
 * How many checkboxes a group shows before "Show more".
 *
 * One number for every group in the rail. A rail whose groups each open to a
 * different length is a rail nobody can scan; four rows is enough to see what
 * a group is about, and the rest are one click away.
 */
const FIRST = 4;

interface Check {
  key: string;
  label: React.ReactNode;
  /** How many results the option would leave. Omitted for a fixed choice. */
  count?: number;
  checked: boolean;
  disabled?: boolean;
  /** Ticked as a consequence of filters elsewhere, not by the buyer. */
  implied?: boolean;
}

/**
 * The one control the rail offers a choice with: a list of checkboxes, four
 * showing, the rest behind "Show more".
 *
 * Every group is drawn with this — the ones that used to be rows of pill
 * buttons included. A pill and a checkbox did the same job in two shapes, and
 * a reader had to work out that a grey lozenge with a number in it was a
 * filter at all; a checkbox says so by being one.
 *
 * A ticked option is never folded away. Collapsed, the list is the first four
 * plus anything ticked further down — a filter that is on but out of sight is
 * the one a buyer cannot find to turn off.
 *
 * An IMPLIED option is drawn ticked and cannot be un-ticked here: it is ticked
 * because of a choice in another group, and the way to clear it is to clear
 * that choice. It says so to a pointer and to a screen reader.
 */
function Checks({
  items,
  onToggle,
}: {
  items: readonly Check[];
  onToggle: (key: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded
    ? items
    : items.filter((item, i) => i < FIRST || item.checked || item.implied);
  const hidden = items.length - visible.length;

  return (
    <>
      {visible.map((item) => (
        <label
          key={item.key}
          className={item.implied ? 'fopt implied' : item.disabled ? 'fopt off' : 'fopt'}
          title={item.implied ? IMPLIED_HINT : undefined}
        >
          <input
            type="checkbox"
            checked={item.checked || item.implied === true}
            disabled={item.disabled || item.implied}
            onChange={() => onToggle(item.key)}
          />
          {item.label}
          {item.implied && <span className="sr-only">, {IMPLIED_HINT}</span>}
          {item.count !== undefined && <span className="c mono">{item.count}</span>}
        </label>
      ))}
      {(hidden > 0 || (expanded && items.length > FIRST)) && (
        <button
          type="button"
          className="fmore"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            'Show less'
          ) : (
            <>
              Show <span className="mono">{hidden}</span> more
            </>
          )}
        </button>
      )}
    </>
  );
}

/**
 * A facet from the API as a checkbox list. A zero-count option is DISABLED and
 * dimmed, never removed — §6 is explicit that disappearing options make people
 * think the site is broken.
 *
 * A selected option is never disabled even at zero, or a filter that returns
 * nothing could not be un-ticked.
 */
function Options({
  group,
  implied,
  onToggle,
}: {
  group: FacetGroup | undefined;
  /** The value ticked as a consequence of filters elsewhere, if any. */
  implied?: string | null;
  onToggle: (value: string) => void;
}): React.JSX.Element | null {
  if (!group) return null;
  // A dimension nothing measures draws nothing: no sentence, and above all no
  // row of zeroes, which would read as "we checked and found none".
  if (group.unavailable) return null;

  // With four rows showing, which four matters. The API sends a group in its
  // own order — alphabetical, mostly — so the first four of "Processor" were
  // three families with nothing in stock ahead of the one with the most. The
  // options a buyer can act on go first: anything ticked or with stock, in the
  // API's order, then the empty ones, in the API's order. Nothing is dropped;
  // the empty ones are still there, disabled, under "Show more".
  const usable = group.options.filter((o) => o.selected || o.count > 0);
  const empty = group.options.filter((o) => !o.selected && o.count === 0);

  return (
    <Checks
      items={[...usable, ...empty].map((o) => ({
        key: o.value,
        label: o.label,
        count: o.count,
        checked: o.selected,
        disabled: o.count === 0 && !o.selected,
        implied: implied === o.value,
      }))}
      onToggle={onToggle}
    />
  );
}

/** Names one of two lists that share a group: "Family" over "Generation". */
function SubHead({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="fsubh">{children}</p>;
}

/**
 * Two numeric bounds with a track that draws the band they describe.
 *
 * Range inputs debounce at 300ms (§6); checkboxes apply immediately. The track
 * is `aria-hidden` because it is a readout of the two inputs beside it, not a
 * second control — the reference draws it the same way.
 */
function Band({
  from,
  to,
  min,
  max,
  prefix,
  suffix,
  fromLabel,
  toLabel,
  track = true,
  onCommit,
}: {
  from: string | null;
  to: string | null;
  min: number;
  max: number;
  prefix?: string;
  suffix?: string;
  fromLabel: string;
  toLabel: string;
  track?: boolean;
  onCommit: (from: string, to: string) => void;
}): React.JSX.Element {
  const lo = from ?? '';
  const hi = to ?? '';
  const pct = (v: string, fallback: number): number =>
    v === '' ? fallback : Math.min(100, Math.max(0, ((Number(v) - min) / (max - min)) * 100));
  const left = pct(lo, 0);
  const right = pct(hi, 100);

  return (
    <>
      {track && (
        <>
          {/* Amber is an ACTIVE state. With neither bound set the facet is not
              active, so the track is drawn in `--rule` — a full amber bar on an
              untouched filter claims a filter is applied. */}
          <div className={lo === '' && hi === '' ? 'slider idle' : 'slider'} aria-hidden="true">
            <i style={{ left: `${left}%`, right: `${100 - right}%` }} />
            <b style={{ left: `${left}%` }} />
            <b style={{ left: `${right}%` }} />
          </div>
          <div className="sclab mono" aria-hidden="true">
            <span>
              {prefix}
              {lo === '' ? min : lo}
              {suffix}
            </span>
            <span>
              {prefix}
              {hi === '' ? max : hi}
              {suffix}
            </span>
          </div>
        </>
      )}
      <div className="range">
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <Debounced
          type="number"
          inputMode="numeric"
          className="mono"
          aria-label={fromLabel}
          placeholder={`Min${suffix ?? ''}`}
          value={lo}
          onCommit={(v) => onCommit(v, hi)}
        />
        <span aria-hidden="true">to</span>
        <Debounced
          type="number"
          inputMode="numeric"
          className="mono"
          aria-label={toLabel}
          placeholder={`Max${suffix ?? ''}`}
          value={hi}
          onCommit={(v) => onCommit(lo, v)}
        />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </div>
    </>
  );
}

/**
 * A text input that commits 300ms after typing stops.
 *
 * Keyed on the committed value so that a navigation which changes it — clearing
 * all filters, following a shared link — replaces what is in the box, while
 * typing is never interrupted mid-word by a round trip.
 */
function Debounced({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): React.JSX.Element {
  const [local, setLocal] = React.useState(value);
  const committed = React.useRef(value);

  React.useEffect(() => {
    committed.current = value;
    setLocal(value);
  }, [value]);

  React.useEffect(() => {
    if (local === committed.current) return;
    const t = setTimeout(() => onCommit(local), 300);
    return () => clearTimeout(t);
  }, [local, onCommit]);

  return <input {...rest} value={local} onChange={(e) => setLocal(e.target.value)} />;
}
