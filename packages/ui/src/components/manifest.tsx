'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/* ==========================================================================
 * ClauseHeading
 * ======================================================================== */

export interface ClauseHeadingProps {
  n: string;
  title: React.ReactNode;
  /** Small mono line above the title. Defaults to nothing besides `n`. */
  kicker?: string;
  /** Date / status, right of the title, left of actions. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** MANIFEST page title: kicker, display face, double rule. */
export function ClauseHeading({
  n,
  title,
  kicker,
  meta,
  actions,
  className,
}: ClauseHeadingProps): React.JSX.Element {
  return (
    <header className={cn('vl-heading', className)}>
      <div className="vl-heading__row">
        <div className="vl-heading__titles">
          <p className="vl-heading__kicker">
            <span className="vl-heading__n">{n}</span>
            {kicker ? <span>{kicker}</span> : null}
          </p>
          <h1 className="vl-heading__title">{title}</h1>
        </div>
        {meta || actions ? (
          <div className="vl-heading__aside">
            {meta ? <div className="vl-heading__meta">{meta}</div> : null}
            {actions ? <div className="vl-heading__actions">{actions}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="vl-heading__rule" aria-hidden="true" />
    </header>
  );
}

/* ==========================================================================
 * LedgerSection
 * ======================================================================== */

export interface LedgerSectionProps {
  n: string;
  title: React.ReactNode;
  count?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/** Numbered clause over a hairline — the section that tables hang from. */
export function LedgerSection({
  n,
  title,
  count,
  aside,
  children,
  className,
}: LedgerSectionProps): React.JSX.Element {
  return (
    <section className={cn('vl-section', className)}>
      <header className="vl-section__head">
        <h2 className="vl-section__title">
          <span className="vl-section__n">{n}</span>
          {title}
          {count !== undefined && count !== null ? (
            <span className="vl-section__count">{count}</span>
          ) : null}
        </h2>
        {aside ? <div className="vl-section__aside">{aside}</div> : null}
      </header>
      {children}
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

/** Label left, dotted leader, mono value right. */
export function LedgerRow({ label, value, total, className }: LedgerRowProps): React.JSX.Element {
  return (
    <div className={cn('vl-row', total && 'vl-row--total', className)}>
      <span className="vl-row__label">{label}</span>
      <span className="vl-row__leader" aria-hidden="true" />
      <span className="vl-row__value font-mono tabular-nums">{value}</span>
    </div>
  );
}

/* ==========================================================================
 * RegisterStrip
 * ======================================================================== */

export interface RegisterCell {
  label: string;
  value: string;
  /** One line of denominator. Capped at 40 characters. */
  sub?: string;
}

export interface RegisterStripProps {
  cells: readonly RegisterCell[];
  className?: string;
}

export const REGISTER_SUB_MAX = 40;

/** MANIFEST KPI strip. A paragraph is a type error: `sub` is a short string. */
export function RegisterStrip({ cells, className }: RegisterStripProps): React.JSX.Element {
  return (
    <dl
      data-testid="register-strip"
      className={cn('vl-strip', className)}
      style={{ ['--vl-cols' as string]: String(Math.max(cells.length, 1)) } as React.CSSProperties}
    >
      {cells.map((cell, i) => {
        const sub = cell.sub && cell.sub.length > REGISTER_SUB_MAX ? cell.sub.slice(0, REGISTER_SUB_MAX) : cell.sub;
        return (
          <div key={`${cell.label}-${i}`} className="vl-strip__cell">
            <dt className="vl-strip__label font-mono">{cell.label}</dt>
            <dd className="vl-strip__value font-mono tabular-nums">{cell.value}</dd>
            {sub ? <p className="vl-strip__sub">{sub}</p> : null}
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
        className="inline-flex h-3.5 w-3.5 items-center justify-center border border-ink font-mono text-[10px] text-ink-3 hover:text-ink"
      >
        ?
      </button>
      {open ? (
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-5 z-40 max-w-[320px] border border-ink bg-sheet p-3 text-[12px] leading-snug text-ink-2 shadow-none"
        >
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
  highlightColumn?: number;
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
  className,
}: PermissionGridProps): React.JSX.Element {
  return (
    <div className={cn('vl-table-wrap vl-grid', className)}>
      <table className="vl-table w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col">Capability</th>
            {columns.map((col, i) => (
              <th
                key={col}
                scope="col"
                className={cn(highlightColumn === i && 'bg-acc-wash text-acc-ink')}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.capability}>
              <td className="vl-td-ink">{row.capability}</td>
              {row.marks.map((mark, i) => (
                <td
                  key={`${row.capability}-${i}`}
                  className={cn(
                    'text-center font-mono text-ink-2',
                    highlightColumn === i && 'bg-acc-wash',
                  )}
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
