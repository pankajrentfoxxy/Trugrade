'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FacetGroup, FacetOption } from '../lib/api';

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
}

/** Params that are not filters: they must not appear as an applied chip. */
const NOT_A_FILTER = new Set(['sort', 'page', 'per', 'view']);

const GRADE_NOTE =
  'Counts read the inspected grade — what the technician found, never what the supplier declared. Nothing below B is listed.';

const RUPEES = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function FilterRail({ facets, query, total }: FilterRailProps): React.JSX.Element {
  const router = useRouter();
  const params = React.useMemo(() => new URLSearchParams(query), [query]);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pincodeError, setPincodeError] = React.useState<string | null>(null);

  /**
   * Write through to the URL. `push`, not `replace`: a filter is a place a buyer
   * navigated to, and back must undo it. Page resets, because page 4 of a
   * different result set is not the page they were looking at.
   */
  const commit = React.useCallback(
    (next: URLSearchParams): void => {
      next.delete('page');
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      // The cast is on the ONE line that builds it, not on the router.
      router.push((qs ? `/search?${qs}` : '/search') as Route, { scroll: false });
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
          <Options group={facets.brand} onToggle={(v) => toggle('brand', v)} showFirst={5} />
        </Facet>

        {/* 2 */}
        <Facet name="Series" open>
          <Options group={facets.series} onToggle={(v) => toggle('series', v)} showFirst={5} />
        </Facet>

        {/* 3 */}
        <Facet name="Processor" open>
          <Pills group={facets.cpu} onPick={(v) => toggle('cpu', v)} />
          <div className="fsub">
            <Options group={facets.gen} onToggle={(v) => toggle('gen', v)} />
          </div>
        </Facet>

        {/* 4 */}
        <Facet name="Memory" open>
          <Options group={facets.ram} onToggle={(v) => toggle('ram', v)} />
        </Facet>

        {/* 5 */}
        <Facet name="Storage">
          <Pills group={facets.sgb} onPick={(v) => toggle('sgb', v)} />
          <div className="fsub">
            <Options group={facets.stype} onToggle={(v) => toggle('stype', v)} />
          </div>
        </Facet>

        {/* 6 — the argument, open and above the fold */}
        <Facet name="Inspected grade" open>
          <Options group={facets.grade} onToggle={(v) => toggle('grade', v)} />
          <p className="fnote">{GRADE_NOTE}</p>
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
          <p className="fnote">Measured at inspection on a charged battery, never estimated from age.</p>
          <Unavailable group={facets.cycles} />
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
          <div className="pillrow">
            {['90', '80', '70'].map((s) => (
              <button
                key={s}
                type="button"
                className={params.get('smin') === s ? 'fpill on' : 'fpill'}
                aria-pressed={params.get('smin') === s}
                onClick={() => pick('smin', s)}
              >
                <span className="mono">{s}+</span>
              </button>
            ))}
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
          <div className="pillrow">
            {PRICE_BANDS.map((b) => {
              const on = (params.get('pmin') ?? '') === b.min && (params.get('pmax') ?? '') === b.max;
              return (
                <button
                  key={b.label}
                  type="button"
                  className={on ? 'fpill on' : 'fpill'}
                  aria-pressed={on}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('pmin');
                    next.delete('pmax');
                    if (!on) {
                      if (b.min) next.set('pmin', b.min);
                      if (b.max) next.set('pmax', b.max);
                    }
                    commit(next);
                  }}
                >
                  <span className="mono">{b.label}</span>
                </button>
              );
            })}
          </div>
          <p className="fnote">Includes GST and freight to the delivery pincode below.</p>
        </Facet>

        {/* 10 */}
        <Facet name="Screen">
          <Pills group={facets.screen} onPick={(v) => toggle('screen', v)} />
          <div className="fsub">
            <Options group={facets.res} onToggle={(v) => toggle('res', v)} />
          </div>
        </Facet>

        {/* 11 */}
        <Facet name="Delivery">
          <Options group={facets.ship} onToggle={(v) => toggle('ship', v)} />
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
                if (v !== '' && !/^[1-9][0-9]{5}$/.test(v)) {
                  setPincodeError(
                    `${v} is not an Indian pincode. It is six digits and does not start with a zero — for example 122002.`,
                  );
                  return;
                }
                setPincodeError(null);
                setValue('pin', v);
              }}
            />
          </div>
          {pincodeError !== null && (
            <p className="ferr" role="alert">
              {pincodeError}
            </p>
          )}
          <p className="fnote">
            The pincode sets the freight in every landed price on this page. It does not remove
            anything from the results.
          </p>
        </Facet>

        {/* 12 */}
        <Facet name="Supply point city">
          <Options group={facets.city} onToggle={(v) => toggle('city', v)} showFirst={5} />
          <p className="fnote">
            A supply point is a dispatch city, shown as{' '}
            <span className="mono">Supply Point A · Gurugram</span>. Who is behind it is not part of
            the offer.
          </p>
        </Facet>

        {/* 13 */}
        <Facet name="Quantity available">
          <Pills group={facets.qty} onPick={(v) => pick('qty', v)} labelOf={(o) => o.value + '+'} />
          <p className="fnote">
            Counts units of one model at one supply point, so a quantity here is one dispatch rather
            than four part-shipments.
          </p>
        </Facet>

        {/* 14 */}
        <Facet name="Features">
          <Options group={facets.feat} onToggle={(v) => toggle('feat', v)} />
          <Unavailable group={facets.charger} />
        </Facet>

        {/* 15 */}
        <Facet name="Warranty">
          <Options group={facets.warr} onToggle={(v) => toggle('warr', v)} />
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

/**
 * A checkbox list. A zero-count option is DISABLED and dimmed, never removed —
 * §6 is explicit that disappearing options make people think the site is broken.
 *
 * A selected option is never disabled even at zero, or a filter that returns
 * nothing could not be un-ticked.
 */
function Options({
  group,
  onToggle,
  showFirst,
}: {
  group: FacetGroup | undefined;
  onToggle: (value: string) => void;
  showFirst?: number;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false);
  if (!group) return null;
  if (group.unavailable) return <Unavailable group={group} />;

  const limit = showFirst ?? group.options.length;
  const hidden = Math.max(0, group.options.length - limit);
  const shown = expanded ? group.options : group.options.slice(0, limit);

  return (
    <>
      {shown.map((o) => {
        const empty = o.count === 0 && !o.selected;
        return (
          <label key={o.value} className={empty ? 'fopt off' : 'fopt'}>
            <input
              type="checkbox"
              checked={o.selected}
              disabled={empty}
              onChange={() => onToggle(o.value)}
            />
            {o.label}
            <span className="c mono">{o.count}</span>
          </label>
        );
      })}
      {hidden > 0 && !expanded && (
        <button type="button" className="fmore" onClick={() => setExpanded(true)}>
          Show <span className="mono">{hidden}</span> more
        </button>
      )}
    </>
  );
}

/** The same options as pills. Zero is disabled here too, for the same reason. */
function Pills({
  group,
  onPick,
  labelOf,
}: {
  group: FacetGroup | undefined;
  onPick: (value: string) => void;
  labelOf?: (o: FacetOption) => string;
}): React.JSX.Element | null {
  if (!group) return null;
  return (
    <div className="pillrow">
      {group.options.map((o) => {
        const empty = o.count === 0 && !o.selected;
        return (
          <button
            key={o.value}
            type="button"
            className={o.selected ? 'fpill on' : empty ? 'fpill off' : 'fpill'}
            aria-pressed={o.selected}
            disabled={empty}
            onClick={() => onPick(o.value)}
          >
            {labelOf ? labelOf(o) : o.label}{' '}
            <span className="c mono">{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A dimension nothing measures. Prints why, in `--ink-4`, instead of zeroes. */
function Unavailable({ group }: { group: FacetGroup | undefined }): React.JSX.Element | null {
  if (!group?.unavailable) return null;
  return <p className="fnote off">{group.unavailable}</p>;
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
