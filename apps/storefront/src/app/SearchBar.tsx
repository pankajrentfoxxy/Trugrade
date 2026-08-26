'use client';

import * as React from 'react';

/**
 * Scoped search with grouped suggestions — `09_FRONTEND_LOCKED.md` §5.
 *
 * Two things here are not cosmetic.
 *
 * **Suggestions are grouped, never a flat list.** `Models`, `Configuration` and
 * `Look up a specific machine` are three different intents, and a flat list
 * makes the reader do the sorting.
 *
 * **A certificate ID routes to the verification page, not to a product.** That
 * is a different intent entirely: someone holding a sealed machine wants the
 * report it shipped with, not something to buy. Treating it as a product search
 * is exactly the small failure that makes people stop trusting a tool.
 */
type Scope = 'all' | 'brand' | 'config' | 'serial' | 'certificate';

const SCOPES: ReadonlyArray<{ value: Scope; label: string }> = [
  { value: 'all', label: 'All laptops' },
  { value: 'brand', label: 'Brand' },
  { value: 'config', label: 'Configuration' },
  { value: 'serial', label: 'Serial / service tag' },
  { value: 'certificate', label: 'Certificate ID' },
];

/** A certificate ID is recognisable, so intent can be inferred before the scope is set. */
const CERT_PATTERN = /^(TG-)?CERT-[A-Z0-9-]{6,}$/i;

interface Suggestion {
  group: 'Models' | 'Configuration' | 'Look up a specific machine';
  badge: string;
  label: string;
  count?: number;
  href: string;
}

export function SearchBar(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [scope, setScope] = React.useState<Scope>('all');
  const [active, setActive] = React.useState(-1);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // Outside click and Escape both close. Escape also returns focus intent to the
  // input, which is what a keyboard user expects.
  React.useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const suggestions = React.useMemo<Suggestion[]>(() => {
    const term = q.trim();
    const lookup: Suggestion[] = [
      {
        group: 'Look up a specific machine',
        badge: 'SERIAL',
        label: term ? `Find serial ${term}` : 'Find by serial or service tag',
        href: term ? `/unit/${encodeURIComponent(term)}` : '/verify',
      },
      {
        group: 'Look up a specific machine',
        badge: 'CERT',
        // Routed to /verify, never to a product. Different intent.
        label: term ? `Verify certificate ${term}` : 'Verify a certificate',
        href: term ? `/verify?q=${encodeURIComponent(term)}` : '/verify',
      },
    ];

    if (!term) return lookup;

    return [
      { group: 'Models', badge: 'MODEL', label: term, href: `/browse?q=${encodeURIComponent(term)}` },
      {
        group: 'Configuration',
        badge: 'SPEC',
        label: `${term} — inspected stock`,
        href: `/browse?q=${encodeURIComponent(term)}&sort=score`,
      },
      ...lookup,
    ];
  }, [q]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    // Intent wins over the selected scope: someone who pastes a certificate ID
    // into "All laptops" still wants the certificate.
    if (scope === 'certificate' || CERT_PATTERN.test(term)) {
      window.location.href = `/verify?q=${encodeURIComponent(term)}`;
      return;
    }
    if (scope === 'serial') {
      window.location.href = `/unit/${encodeURIComponent(term)}`;
      return;
    }
    window.location.href = `/browse?q=${encodeURIComponent(term)}&scope=${scope}`;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      window.location.href = suggestions[active]!.href;
    }
  };

  const groups = ['Models', 'Configuration', 'Look up a specific machine'] as const;
  let index = -1;

  return (
    <div className={open ? 'sbox open' : 'sbox'} ref={boxRef}>
      <form className="srch" onSubmit={submit} role="search">
        <label className="sr-only" htmlFor="sscope">
          Search scope
        </label>
        <select
          id="sscope"
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          aria-label="Search scope"
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="sinput">
          Search
        </label>
        <input
          id="sinput"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Model, configuration, serial or certificate ID"
          role="combobox"
          aria-expanded={open}
          aria-controls="sugg-list"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `sugg-${active}` : undefined}
        />
        <button type="submit">Search</button>
      </form>

      <div className="sugg" id="sugg-list" role="listbox" aria-label="Suggestions">
        {groups.map((g) => {
          const rows = suggestions.filter((s) => s.group === g);
          if (rows.length === 0) return null;
          return (
            <div key={g}>
              <div className="sgh">{g}</div>
              {rows.map((s) => {
                index += 1;
                const i = index;
                return (
                  <a
                    key={s.href + s.badge}
                    id={`sugg-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? 'srow on' : 'srow'}
                    href={s.href}
                  >
                    <span className="sb mono">{s.badge}</span>
                    <span className="sl">{s.label}</span>
                    {s.count !== undefined && <span className="sc mono">{s.count}</span>}
                  </a>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
