'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * SUPPLIER HUB primitives. Rendered only under `data-surface="hub"`; the
 * styling lives in `apps/console/src/shell/vendor-hub.css`.
 */

/* ==========================================================================
 * HubPageHeader
 * ======================================================================== */

export interface HubPageHeaderProps {
  title: React.ReactNode;
  /** One line under the title. A second sentence belongs in an InfoPopover. */
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Page title, optional subtitle, actions right. One primary action per screen.
 *
 * Prefixed because the console's `lib/controls` already exports a `PageHeader`
 * that ~25 admin screens use, and that one takes its body as `children`.
 */
export function HubPageHeader({
  title,
  subtitle,
  actions,
  className,
}: HubPageHeaderProps): React.JSX.Element {
  return (
    <header className={cn('hub-heading', className)}>
      <div className="hub-heading__titles">
        <h1 className="hub-heading__title">{title}</h1>
        {subtitle ? <p className="hub-heading__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="hub-heading__actions">{actions}</div> : null}
    </header>
  );
}

/* ==========================================================================
 * Panel
 * ======================================================================== */

export interface PanelProps {
  title: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/** The card everything hangs from: white sheet, hairline border, soft radius. */
export function Panel({ title, count, actions, children, className }: PanelProps): React.JSX.Element {
  return (
    <section className={cn('hub-panel', className)}>
      <header className="hub-panel__head">
        <h2 className="hub-panel__title">
          {title}
          {count !== undefined && count !== null ? (
            <span className="hub-panel__count font-mono tabular-nums">{count}</span>
          ) : null}
        </h2>
        {actions ? <div className="hub-panel__actions">{actions}</div> : null}
      </header>
      <div className="hub-panel__body">{children}</div>
    </section>
  );
}

/* ==========================================================================
 * LedgerRow
 * ======================================================================== */

export interface LedgerRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  total?: boolean;
  className?: string;
}

/** Label left in --ink-3, mono value right in --ink, hairline between rows. */
export function LedgerRow({ label, value, total, className }: LedgerRowProps): React.JSX.Element {
  return (
    <div className={cn('hub-row', total && 'hub-row--total', className)}>
      <span className="hub-row__label">{label}</span>
      <span className="hub-row__value font-mono tabular-nums">{value}</span>
    </div>
  );
}

/* ==========================================================================
 * HubKpiRow
 * ======================================================================== */

export interface HubKpiCell {
  label: string;
  /** `null` when the figure is not available. Never pre-format that as a string. */
  value: string | null;
  /** One line of denominator. Capped at 40 characters. */
  sub?: string;
}

export interface HubKpiRowProps {
  cells: readonly HubKpiCell[];
  className?: string;
}

export const KPI_SUB_MAX = 40;

/**
 * The metric strip at the top of a hub screen.
 *
 * Named `HubKpiRow` because `KpiRow` is the Archetype E workspace component and
 * the admin console still uses it.
 *
 * `sub` is a short string, not a paragraph: the cap is enforced here so a
 * sentence cannot grow back into the strip one edit at a time.
 *
 * A `null` value reads "Not measured" in `--ink-4`. Every hub metric goes
 * through here, so that is the one place a missing figure can be caught before
 * it reaches a screen wearing the same weight as a real one.
 */
export function HubKpiRow({ cells, className }: HubKpiRowProps): React.JSX.Element {
  return (
    <dl
      data-testid="hub-kpi-row"
      className={cn('hub-strip', className)}
      style={{ ['--hub-cols' as string]: String(Math.max(cells.length, 1)) } as React.CSSProperties}
    >
      {cells.map((cell, i) => {
        const sub = cell.sub && cell.sub.length > KPI_SUB_MAX ? cell.sub.slice(0, KPI_SUB_MAX) : cell.sub;
        return (
          <div key={`${cell.label}-${i}`} className="hub-strip__cell">
            <dt className="hub-strip__label">{cell.label}</dt>
            {cell.value === null ? (
              <dd className="hub-strip__value hub-strip__value--none">Not measured</dd>
            ) : (
              <dd className="hub-strip__value font-mono tabular-nums">{cell.value}</dd>
            )}
            {sub ? <p className="hub-strip__sub">{sub}</p> : null}
          </div>
        );
      })}
    </dl>
  );
}

/* ==========================================================================
 * InfoPopover
 * ======================================================================== */

export interface InfoPopoverProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/** `?` that holds the long explanation. Escape closes; focus returns. */
export function InfoPopover({ label, children, className }: InfoPopoverProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const btn = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="hub-info__btn"
      >
        ?
      </button>
      {open ? (
        <div ref={panel} role="dialog" aria-label={label} className="hub-info__panel">
          {children}
        </div>
      ) : null}
    </span>
  );
}

/* ==========================================================================
 * PermissionGrid
 * ======================================================================== */

export type PermissionMark = 'full' | 'limited' | 'none';

export interface PermissionGridProps {
  rows: readonly { capability: string; marks: readonly PermissionMark[] }[];
  columns: readonly string[];
  /** Wash one column by index. */
  highlightColumn?: number;
  /** Wash one column by its heading. Ignored when it names no column. */
  highlightRole?: string;
  className?: string;
}

const MARK: Record<PermissionMark, string> = {
  full: '●',
  limited: '◐',
  none: '–',
};

export function PermissionGrid({
  rows,
  columns,
  highlightColumn,
  highlightRole,
  className,
}: PermissionGridProps): React.JSX.Element {
  const roleIndex = highlightRole ? columns.indexOf(highlightRole) : -1;
  const highlight = roleIndex >= 0 ? roleIndex : highlightColumn;

  return (
    <div className={cn('hub-table-wrap hub-grid', className)}>
      <table className="hub-table w-full border-collapse">
        <thead>
          <tr>
            <th scope="col">Capability</th>
            {columns.map((col, i) => (
              <th key={col} scope="col" className={cn(highlight === i && 'bg-acc-wash text-acc-ink')}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.capability}>
              <td className="hub-td-ink">{row.capability}</td>
              {row.marks.map((mark, i) => (
                <td
                  key={`${row.capability}-${i}`}
                  className={cn('text-center font-mono text-ink-2', highlight === i && 'bg-acc-wash')}
                >
                  <span aria-label={mark}>{MARK[mark]}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
 * HubAccountMenu
 * ======================================================================== */

export interface HubAccountMenuProps {
  /** Initials in the avatar. Empty draws the neutral person glyph instead. */
  monogram?: string;
  /** Who is signed in, at the head of the open menu. */
  name?: React.ReactNode;
  /** The seat this person holds, under the name. */
  role?: React.ReactNode;
  /** The trigger's accessible name — the menu carries it too. */
  label: string;
  /** The destinations: anything carrying `hub-menu__item` and `role="menuitem"`. */
  children: React.ReactNode;
  className?: string;
}

/**
 * The avatar in the masthead and what it opens.
 *
 * Routing stays with the caller — an app passes its own links as children, so
 * this package never learns the router. Escape closes and returns focus, an
 * outside click closes, the arrows walk the items, and activating one closes
 * the menu rather than leaving it hanging over the screen behind it.
 */
export function HubAccountMenu({
  monogram,
  name,
  role,
  label,
  children,
  className,
}: HubAccountMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const btn = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  /** Whether the arrows opened it, which decides where focus starts. */
  const byArrow = React.useRef(false);

  const itemsIn = (): HTMLElement[] =>
    panel.current
      ? Array.from(
          panel.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
        )
      : [];

  React.useEffect(() => {
    if (!open) return undefined;
    // Only an arrow puts focus on the first item. Doing it on every open rings
    // the top item for somebody who opened the menu with a mouse, which reads
    // as a choice already made rather than as where the keyboard is.
    if (byArrow.current) itemsIn()[0]?.focus();
    byArrow.current = false;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const step = (by: number): void => {
    const list = itemsIn();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? 0 : (at + by + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <div className={cn('hub-menu', className)}>
      <button
        ref={btn}
        type="button"
        className="hub-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            byArrow.current = true;
            setOpen(true);
          }
        }}
      >
        <span className="hub-mast__avatar font-mono" aria-hidden="true">
          {monogram ? monogram : <PersonIcon />}
        </span>
      </button>
      {open ? (
        <div
          ref={panel}
          className="hub-menu__panel"
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(-1);
            }
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false);
          }}
        >
          {name || role ? (
            <div className="hub-menu__who">
              {name ? <span className="hub-menu__name">{name}</span> : null}
              {role ? <span className="hub-menu__role">{role}</span> : null}
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Stands in for initials nobody has given us yet. */
function PersonIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
