'use client';

import * as React from 'react';
import type { BrandSummary, GradeDefinition } from '../lib/api';

/**
 * The fifteen facets — `09_FRONTEND_LOCKED.md` §6.
 *
 * Three rules drive every decision here.
 *
 * **Every facet state lives in the URL.** A buyer sends a colleague a link and
 * it reproduces exactly what they saw. That is the requirement; the useful side
 * effect is that it removes most of the need for a state library, because the
 * URL *is* the state.
 *
 * **A zero-result facet is disabled and dimmed, never hidden.** Options that
 * vanish make people think the site is broken, and a disabled row still tells
 * you the dimension exists.
 *
 * **Battery health, inspection score and inspected grade stay open and above
 * the fold.** No competitor can offer them, because offering them requires
 * having opened the machine. They are the product's whole argument expressed as
 * a filter, so they are not buried under Storage.
 */
export interface FilterRailProps {
  brands: readonly BrandSummary[];
  grades: readonly GradeDefinition[];
}

/** Open by default: the eight §6 names, three of which are the argument. */
const OPEN = new Set([
  'Brand',
  'Series',
  'Processor',
  'Memory',
  'Inspected grade',
  'Battery health',
  'Inspection score',
  'Landed price',
]);

const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

export function FilterRail({ brands, grades }: FilterRailProps): React.JSX.Element {
  const [params, setParams] = React.useState<URLSearchParams>(() =>
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search),
  );

  /**
   * Write through to the URL without a navigation.
   *
   * `replaceState` rather than `push` so that filtering does not fill the back
   * button with every checkbox the reader tried — back should leave the page,
   * not undo one facet at a time.
   */
  const commit = React.useCallback((next: URLSearchParams): void => {
    setParams(new URLSearchParams(next));
    const qs = next.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, []);

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

  const applied = [...params.entries()].filter(([, v]) => v !== '');
  const has = (key: string, value: string): boolean => params.getAll(key).includes(value);

  return (
    <aside className="filters" aria-label="Filters">
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
      </div>

      <div className="fsearch">
        <label className="sr-only" htmlFor="fwithin">
          Search within results
        </label>
        <input
          id="fwithin"
          type="text"
          placeholder="Search within results"
          defaultValue={params.get('q') ?? ''}
          onChange={(e) => setValue('q', e.target.value)}
        />
      </div>

      {applied.length > 0 && (
        <div className="applied">
          {applied.map(([k, v]) => (
            <button key={`${k}=${v}`} type="button" className="ftag" onClick={() => toggle(k, v)}>
              {v} <i aria-hidden="true">&times;</i>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
        </div>
      )}

      <Facet name="Brand">
        {brands.map((b) => (
          <Opt
            key={b.slug}
            label={b.name}
            // Sellable stock, not catalogue entries: a facet promising units
            // that are not there is the same broken promise as a fake badge.
            count={b.inStock}
            checked={has('brand', b.slug)}
            onChange={() => toggle('brand', b.slug)}
          />
        ))}
      </Facet>

      <Facet name="Series">
        <Muted>Series appear once a brand is selected.</Muted>
      </Facet>

      <Facet name="Processor">
        <Pills
          values={['i3', 'i5', 'i7', 'i9', 'Ryzen 5', 'Ryzen 7', 'Apple M']}
          active={params.getAll('cpu')}
          onPick={(v) => toggle('cpu', v)}
        />
      </Facet>

      <Facet name="Memory">
        {['8 GB', '16 GB', '32 GB', '64 GB'].map((m) => (
          <Opt key={m} label={m} count={0} checked={has('ram', m)} onChange={() => toggle('ram', m)} />
        ))}
      </Facet>

      <Facet name="Storage">
        <Pills
          values={['256 GB', '512 GB', '1 TB', '2 TB']}
          active={params.getAll('ssd')}
          onPick={(v) => toggle('ssd', v)}
        />
      </Facet>

      <Facet name="Inspected grade">
        {grades.map((g) => (
          <Opt
            key={g.grade}
            label={`Grade ${GRADE_LABEL[g.grade] ?? g.grade}`}
            count={0}
            checked={has('grade', g.grade)}
            onChange={() => toggle('grade', g.grade)}
          />
        ))}
        {/* The inspected grade, never the supplier's declared one. */}
        <Muted>Counts read the inspected grade. Nothing below B is listed.</Muted>
      </Facet>

      <Facet name="Battery health">
        <Range
          label="Minimum measured health"
          suffix="%"
          value={params.get('batt') ?? ''}
          onCommit={(v) => setValue('batt', v)}
        />
        <Muted>Measured at inspection, not estimated from age.</Muted>
      </Facet>

      <Facet name="Inspection score">
        <Pills
          values={['90+', '80+', '70+']}
          active={params.getAll('score')}
          onPick={(v) => toggle('score', v)}
        />
      </Facet>

      <Facet name="Landed price">
        <Range
          label="Maximum landed price"
          prefix="₹"
          value={params.get('max') ?? ''}
          onCommit={(v) => setValue('max', v)}
        />
        <Muted>Includes GST and freight to your pincode.</Muted>
      </Facet>

      <Facet name="Screen">
        <Pills
          values={['13"', '14"', '15.6"', '16"']}
          active={params.getAll('screen')}
          onPick={(v) => toggle('screen', v)}
        />
      </Facet>

      <Facet name="Delivery">
        <label className="fopt">
          <input type="text" placeholder="Delivery pincode" className="mono"
            defaultValue={params.get('pin') ?? ''}
            onChange={(e) => setValue('pin', e.target.value)} />
        </label>
      </Facet>

      <Facet name="Supply point city">
        <Muted>Cities appear as stock is inspected.</Muted>
      </Facet>

      <Facet name="Quantity available">
        <Pills
          values={['10+', '25+', '50+', '100+']}
          active={params.getAll('qty')}
          onPick={(v) => toggle('qty', v)}
        />
      </Facet>

      <Facet name="Features">
        {['Backlit keyboard', 'Fingerprint', 'Thunderbolt', 'Charger included'].map((f) => (
          <Opt key={f} label={f} count={0} checked={has('feat', f)} onChange={() => toggle('feat', f)} />
        ))}
      </Facet>

      <Facet name="Warranty">
        {['6 months', '12 months'].map((w) => (
          <Opt key={w} label={w} count={0} checked={has('warr', w)} onChange={() => toggle('warr', w)} />
        ))}
      </Facet>
    </aside>
  );
}

function Facet({ name, children }: { name: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <details open={OPEN.has(name)}>
      <summary>{name}</summary>
      <div className="fbody">{children}</div>
    </details>
  );
}

/**
 * A zero-count option is DISABLED and dimmed, never removed. Options that
 * disappear make people think the site is broken.
 */
function Opt({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}): React.JSX.Element {
  const empty = count === 0 && !checked;
  return (
    <label className={empty ? 'fopt off' : 'fopt'}>
      <input type="checkbox" checked={checked} disabled={empty} onChange={onChange} />
      {label}
      <span className="c mono">{count}</span>
    </label>
  );
}

function Pills({
  values,
  active,
  onPick,
}: {
  values: readonly string[];
  active: readonly string[];
  onPick: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className="pillrow">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className={active.includes(v) ? 'fpill on' : 'fpill'}
          aria-pressed={active.includes(v)}
          onClick={() => onPick(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/** Range inputs debounce at 300ms; checkboxes apply immediately. */
function Range({
  label,
  value,
  prefix,
  suffix,
  onCommit,
}: {
  label: string;
  value: string;
  prefix?: string;
  suffix?: string;
  onCommit: (v: string) => void;
}): React.JSX.Element {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onCommit(local);
    }, 300);
    return () => clearTimeout(t);
  }, [local, value, onCommit]);

  return (
    <div className="range">
      <label className="sr-only" htmlFor={`r-${label}`}>
        {label}
      </label>
      {prefix && <span className="mono">{prefix}</span>}
      <input
        id={`r-${label}`}
        type="number"
        inputMode="numeric"
        className="mono"
        placeholder={label}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
      {suffix && <span className="mono">{suffix}</span>}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="fnote">{children}</p>;
}
