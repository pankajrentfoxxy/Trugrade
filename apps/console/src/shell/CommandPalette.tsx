import * as React from 'react';
import { useNavigate } from 'react-router';
import { cn, TickRule } from '@trugrade/ui';
import { useAuth } from '../lib/auth';
import { rupees, UNIT_API, type ConsoleSearch } from '../routes/units/api';
import { visibleGroups, type NavEntry } from './nav';

/**
 * COMPONENT 25 — CommandPalette, `global` variant. T35, `03_UX_SPEC.md` §2.1.
 *
 * §3C: "CommandPalette (⌘K) is the primary navigation for experienced ops
 * staff; the sidebar is the discoverable fallback." This is that palette.
 *
 * ## Why it is not in `packages/ui`
 *
 * CLAUDE.md says a missing component goes in the package, not the app. This one
 * does not, and the reason is the spec's own scoping: §2.1 lists it as
 * `apps/console` only, and every line of it is console knowledge — the nav
 * table, the router, `useAuth`, and the shape of `/api/ops/search`. A component
 * in `packages/ui` that imported three console modules would be a console file
 * with a longer path. `lib/controls.tsx` settled the same question the same way.
 *
 * ponytail: promote it when a second app needs a palette. Reported as a
 * `packages/ui` gap rather than forked.
 *
 * ## What it does not do
 *
 * **It does not filter results client-side.** §2.2: "results the role cannot see
 * are never returned by the API, not filtered client-side." The server searches
 * only the sources the caller's permissions reach and names the ones it skipped,
 * so a role that cannot read orders is told orders were not searched — never
 * that a particular order exists and is out of reach. Confirming that
 * `TT-26-00004` exists is an order-volume oracle on a sequential number.
 *
 * **It does not replace the order board's search box.** That one filters a
 * paginated board with facets, a sort and a shareable URL. This one navigates:
 * six per group, no paging, and it says how many it did not show. Different
 * jobs, and shipping only one would cost the other.
 *
 * ## Keyboard
 *
 * `Ctrl+K` / `⌘K` opens from anywhere; `Escape` closes; `↑` `↓` move; `Enter`
 * opens. §1.9.3's dialog rules come free from a real `<dialog>` opened with
 * `showModal()` — focus is trapped, the background is inert, and focus returns
 * to the invoker on close. `Modal` in `@trugrade/ui` is not reused because it
 * focuses its heading on open by design (so a keystroke in flight cannot fire a
 * destructive confirm), and a palette whose first keystroke does not reach the
 * box is a palette nobody uses twice.
 */

/** §1.9.4's combobox pattern wants a stable id per option. */
const optionId = (index: number): string => `tg-palette-option-${index}`;

/** 200ms, per 09_FRONTEND_LOCKED §5. Long enough to skip a burst, short enough to feel live. */
const DEBOUNCE_MS = 200;

interface Row {
  /** Grouped rows carry their group's heading; only `kind: 'hit'` is selectable. */
  kind: 'heading' | 'hit';
  label: string;
  detail?: string | null;
  amount?: string | null;
  matched?: { field: string; value: string };
  href?: string | null;
  /** Mono, because it is an identifier somebody reads aloud. */
  mono?: boolean;
}

/**
 * Where an empty box points you: the sections you can actually open.
 *
 * §2.1's `open-empty` state is "recent + suggested". There is no recents store
 * in this product and inventing one from `localStorage` would be a second source
 * of truth for what you have looked at — so the palette offers the navigation it
 * can prove you have, drawn from the same `NAV` table the rail renders. A link
 * here can never 403, for the same reason a rail entry cannot.
 */
function navigationRows(entries: readonly NavEntry[]): Row[] {
  return entries.map((n) => ({
    kind: 'hit' as const,
    label: n.label,
    detail: n.group,
    href: n.to,
  }));
}

export function CommandPalette(): React.JSX.Element | null {
  const { principal } = useAuth();
  const navigate = useNavigate();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [q, setQ] = React.useState('');
  const [data, setData] = React.useState<ConsoleSearch | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);

  const sections = React.useMemo(
    () => (principal ? visibleGroups(principal).flatMap(([, entries]) => entries) : []),
    [principal],
  );

  // ⌘K / Ctrl+K from anywhere. §1.9.3: no keyboard shortcut is a single
  // unmodified character outside an open palette, which is why this is the only
  // global binding in the console.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      // jsdom implements `<dialog>` markup and not `showModal()`, so the
      // attribute fallback keeps this testable rather than mocking the thing
      // under test. Same reasoning as `Modal` in `@trugrade/ui`.
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      inputRef.current?.focus();
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      // A closed palette forgets its term. Reopening onto a stale result set is
      // how somebody opens the wrong record from a list they did not re-read.
      setTyped('');
      setQ('');
      setData(null);
      setError(null);
    }
  }, [open]);

  React.useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed]);

  React.useEffect(() => {
    // Two characters, matching the server's own floor. A one-character `%a%`
    // over five schemas is a table scan that returns everything and helps nobody.
    if (q.length < 2) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(UNIT_API.search(q), { credentials: 'include' });
        if (!res.ok) throw new Error(`Search is unavailable (${res.status})`);
        const body = (await res.json()) as ConsoleSearch;
        if (cancelled) return;
        setData(body);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  const rows: Row[] = React.useMemo(() => {
    if (q.length < 2) {
      return [{ kind: 'heading', label: 'Go to' }, ...navigationRows(sections)];
    }
    if (!data) return [];
    const out: Row[] = [];
    for (const group of data.groups) {
      if (group.hits.length === 0) continue;
      out.push({
        kind: 'heading',
        // The cap, said out loud on the heading rather than left as a silent
        // truncation. Six results that look like all six is the lie.
        label:
          group.more > 0
            ? `${group.label} — ${group.more} more not shown, use the boards`
            : group.label,
      });
      for (const hit of group.hits) {
        out.push({
          kind: 'hit',
          label: hit.id,
          detail: hit.detail,
          amount: hit.amount,
          matched: hit.matchedOn,
          href: hit.href,
          mono: true,
        });
      }
    }
    return out;
  }, [q, data, sections]);

  const selectable = rows.filter((r) => r.kind === 'hit');

  React.useEffect(() => setCursor(0), [q, open]);

  /**
   * T45. Keep the active option inside the scrolling list.
   *
   * `aria-activedescendant` moves the announcement without moving DOM focus, so
   * the browser does nothing about visibility — and the list is
   * `max-h-[46vh] overflow-y-auto`. A search that fills five groups is well past
   * that, so arrowing down walked the highlight off the bottom of the box: a
   * screen reader read out the row the user could no longer see, and Enter
   * opened a record nothing on screen had named. `block: 'nearest'` scrolls only
   * when it has to and never moves the page behind the dialog.
   *
   * Called optionally for the same reason `showModal` is guarded above: jsdom
   * implements neither, and mocking a layout method is mocking the thing under
   * test. A browser has it; a test environment without it simply does not scroll.
   */
  React.useEffect(() => {
    if (!open) return;
    const el = document.getElementById(
      optionId(Math.min(cursor, Math.max(0, selectable.length - 1))),
    );
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor, open, selectable.length]);

  if (!principal) return null;

  const go = (row: Row | undefined): void => {
    if (!row?.href) return;
    setOpen(false);
    navigate(row.href);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, selectable.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      go(selectable[cursor]);
    }
  };

  // The index a selectable row occupies among the selectable ones, so the
  // headings between them do not shift the cursor.
  let hitIndex = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          'flex h-[38px] min-w-0 items-center gap-2 rounded border border-chrome-line-2 px-3',
          'text-body-sm text-on-chrome-2 transition-colors hover:bg-chrome-2 hover:text-on-chrome',
        )}
      >
        <span aria-hidden="true">⌕</span>
        <span className="hidden sm:inline">Search</span>
        {/* Not amber. This is a control that opens a search box, not the primary
            action of any screen it sits over. */}
        <kbd className="hidden font-mono text-label tracking-[0.08em] text-on-chrome-3 md:inline">
          Ctrl K
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Search everything"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => {
          // The backdrop is the dialog element itself; a click that lands on it
          // rather than on the card is a click outside.
          if (e.target === dialogRef.current) setOpen(false);
        }}
        // `mt-[10vh] mb-auto` rather than the browser's default centring: a
        // palette that opens under your eyes rather than in the middle of the
        // page is the difference between reading the first result and hunting
        // for it. `max-h` keeps it inside a 600px-tall phone.
        className="mx-auto mb-auto mt-[10vh] w-[calc(100vw-32px)] max-w-[680px] rounded-lg border border-rule bg-sheet p-0 text-ink shadow-3"
      >
        <div className="flex flex-col" onKeyDown={onKeyDown}>
          <div className="border-b border-rule px-4 py-3">
            <label htmlFor="tg-palette-input" className="sr-only">
              Search orders, machines, purchase orders and organisations
            </label>
            <input
              id="tg-palette-input"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              role="combobox"
              aria-expanded={selectable.length > 0}
              aria-controls="tg-palette-list"
              aria-activedescendant={
                selectable.length > 0 ? optionId(Math.min(cursor, selectable.length - 1)) : undefined
              }
              autoComplete="off"
              placeholder="A serial, a seal code, an order number, a GSTIN…"
              className="h-11 w-full bg-transparent font-mono text-body text-ink outline-none placeholder:font-sans placeholder:text-ink-4"
            />
          </div>

          <ul
            id="tg-palette-list"
            role="listbox"
            aria-label="Results"
            className="max-h-[46vh] overflow-y-auto py-2"
          >
            {rows.map((row, i) => {
              if (row.kind === 'heading') {
                return (
                  <li
                    key={`h-${row.label}-${i}`}
                    role="presentation"
                    className="px-4 pb-1 pt-3 font-mono text-label uppercase tracking-[0.13em] text-ink-3"
                  >
                    {row.label}
                  </li>
                );
              }
              hitIndex += 1;
              const index = hitIndex;
              const active = index === Math.min(cursor, selectable.length - 1);
              return (
                <li
                  key={`${row.label}-${index}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(row)}
                  className={cn(
                    'flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2',
                    // Amber as an ACTIVE STATE — rule 1's third meaning, and the
                    // only amber in this dialog.
                    active ? 'bg-acc-wash text-acc-ink' : 'text-ink-2',
                  )}
                >
                  <span
                    className={cn(
                      'text-body-sm',
                      row.mono ? 'font-mono tnum tracking-[0.06em]' : '',
                      active ? 'text-acc-ink' : 'text-ink',
                    )}
                  >
                    {row.label}
                  </span>
                  {row.detail && <span className="text-body-sm text-ink-3">{row.detail}</span>}
                  {/* Grouped, tabular and mono, like every other number in this
                      product. `₹63305.82` in a sentence is the one shape a
                      price must never take. */}
                  {row.amount && (
                    <span className="font-mono tnum text-body-sm text-ink-3">
                      {rupees(row.amount)}
                    </span>
                  )}
                  {/* Why this row is in the result. Without it a seal-code search
                      landing on a serial reads as a mistake. */}
                  {row.matched && row.matched.value !== row.label && (
                    <span className="ml-auto whitespace-nowrap text-body-sm text-ink-4">
                      matched {row.matched.field}{' '}
                      <span className="font-mono tnum">{row.matched.value}</span>
                    </span>
                  )}
                </li>
              );
            })}

            {q.length >= 2 && loading && !data && (
              <li role="presentation" className="px-4 py-3 text-body-sm text-ink-3">
                Searching…
              </li>
            )}

            {error && (
              <li role="presentation" className="px-4 py-3">
                <p className="text-body-sm text-ink">Search did not answer.</p>
                <p className="mt-1 text-body-sm text-ink-3">
                  {error}. Nothing has been changed — the boards in the rail still work.
                </p>
              </li>
            )}

            {q.length >= 2 && !loading && !error && data && selectable.length === 0 && (
              <li role="presentation" className="px-4 py-3">
                <p className="text-body-sm text-ink">
                  Nothing on this platform carries{' '}
                  <span className="font-mono tnum">{data.q}</span>.
                </p>
                <p className="mt-1 max-w-prose text-body-sm text-ink-3">
                  It was compared against every field listed below, anywhere inside the value — so a
                  partial serial does find its machine, and a wrong character does not.
                </p>
              </li>
            )}
          </ul>

          {/* --------------------------------------------------------------
              What was compared, and what was not. Printed on every state that
              ran a search, hit or miss: T39's rule, and the reason nobody
              concludes the box does not take seal codes because theirs found
              nothing. The unavailable list names SOURCES and never records.
             -------------------------------------------------------------- */}
          {data && (
            <div className="border-t border-rule bg-sheet-2 px-4 py-3">
              <TickRule />
              {/* Flattened to one sentence rather than one line per group. The
                  fact that matters is WHICH FIELDS were compared, not which
                  group each belongs to — six lines of that was a wall over the
                  results it was meant to explain. */}
              <p className="mt-2 text-body-sm text-ink-4">
                Compared against{' '}
                {[...new Set(data.groups.flatMap((g) => g.comparedWith))].join(', ')}.
              </p>
              {data.unavailable.length > 0 && (
                <p className="mt-1 text-body-sm text-ink-4">
                  Not searched:{' '}
                  {data.unavailable.map((u, i) => (
                    <React.Fragment key={u.label}>
                      {i > 0 && ', '}
                      {/* The reason lives in `title` and in the screen-reader
                          text, exactly as `NotMeasured` does it — it is an
                          explanation somebody wants once, not on every keystroke. */}
                      <span className="text-ink-3" title={u.reason}>
                        {u.label}
                        <span className="sr-only"> — {u.reason}</span>
                      </span>
                    </React.Fragment>
                  ))}
                  . None of them is a record we are hiding from you — they are
                  sources this role does not reach, or that have no screen yet.
                </p>
              )}
            </div>
          )}

          {q.length < 2 && (
            <div className="border-t border-rule bg-sheet-2 px-4 py-3 text-body-sm text-ink-3">
              Type at least two characters. One box over a serial, a seal code, an order number, a
              buyer’s own PO reference, a purchase-order number, a legal or trade name and a GSTIN —
              it matches, it never guesses which kind you have.
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
