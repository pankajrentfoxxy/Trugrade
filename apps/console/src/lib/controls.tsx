import * as React from 'react';
import { cn, TickRule } from '@trugrade/ui';

/**
 * The four things every console screen needs that `@trugrade/ui` does not ship.
 *
 * Three of them are native form elements. `@trugrade/ui` has `Input`; it has no
 * `<select>` and no `<textarea>`, and a custom listbox is a keyboard-accessibility
 * project with nothing to show for it — the native control already carries the
 * keyboard behaviour, the mobile picker and the ARIA. They wear `Input`'s exact
 * token classes so a row of mixed controls lines up.
 *
 * They live here rather than in `routes/qc` and `routes/vendor/wizard`, where
 * two separate copies of `Select` had already grown. One console, one control.
 *
 * ponytail: promote `Select`, `Textarea` and `Section` to `@trugrade/ui` when a
 * second app needs them. One app does — reported as a T3 gap instead of forked.
 */

const CONTROL =
  'rounded border border-rule bg-sheet px-4 text-body-sm text-ink placeholder:text-ink-3 transition-colors';

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="text-body-sm font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function Select({
  label,
  hint,
  error,
  options,
  className,
  id,
  ...props
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  options: readonly Option[];
} & React.SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  const generated = React.useId();
  const selectId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId} className={className}>
      <select
        id={selectId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={cn(CONTROL, 'h-11', error && 'border-fail')}
        {...props}
      >
        {options.map((o) => (
          // `o.value || o.label`: a "choose one" placeholder has an empty value,
          // and React reads an empty-string key as no key at all.
          <option key={o.value || o.label} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({
  label,
  hint,
  error,
  className,
  id,
  ...props
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  const generated = React.useId();
  const areaId = id ?? generated;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={areaId} className={className}>
      <textarea
        id={areaId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${areaId}-error` : hint ? `${areaId}-hint` : undefined}
        className={cn(CONTROL, 'py-3', error && 'border-fail')}
        {...props}
      />
    </Field>
  );
}

/**
 * A date field, which is a `<select>`-shaped hole of its own.
 *
 * `<input type="date">` is the native platform feature and needs a border and a
 * mono face, not a datepicker library. Mono because a date is a number.
 */
export function DateField({
  label,
  hint,
  className,
  id,
  ...props
}: {
  label: string;
  hint?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  const generated = React.useId();
  const fieldId = id ?? generated;
  return (
    <Field label={label} hint={hint} htmlFor={fieldId} className={className}>
      <input
        id={fieldId}
        type="date"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className={cn(CONTROL, 'h-11 font-mono tnum')}
        {...props}
      />
    </Field>
  );
}

/**
 * The page heading of an archetype B or E screen.
 *
 * Archetype C has `RecordHeader` in `@trugrade/ui` and uses it. A board has no
 * identity to declare — a title, one sentence and the tick rule that
 * 09_FRONTEND_LOCKED.md §4 puts under every section heading.
 */
export function PageHeader({
  title,
  children,
  action,
  className,
}: {
  title: string;
  /** One sentence on what this board is for. Body copy, so `--ink-2`. */
  children?: React.ReactNode;
  /** At most one control, and only the screen's single primary may be amber. */
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <header className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-h1 text-ink">{title}</h1>
        {action && <div className="ml-auto flex flex-wrap items-center gap-3">{action}</div>}
      </div>
      {children && <p className="max-w-prose text-body-sm text-ink-2">{children}</p>}
      <TickRule />
    </header>
  );
}

/**
 * The panel a board's table sits in.
 *
 * `docs/reference/homepage.html` puts every table inside `.tbl` — a `--sheet`
 * card with a `--rule` border and a 7px radius — with an optional `.tbh` bar
 * above it carrying the count and the filter chips. A bare `<table>` on the
 * `--ground` is the single clearest way the console read "unstyled" next to the
 * reference, and this is that container.
 *
 * The `min-width` is the reference's too (`table{min-width:940px}`): a board
 * squeezed into 1100px wraps every cell to three lines, and the honest answer is
 * a horizontal scroll, which `DataTable` already provides on its wrapper.
 *
 * This belongs on `DataBoard` in `@trugrade/ui`; it lives here because T2 does
 * not own that package. Reported as a gap.
 */
export function Board({
  toolbar,
  children,
  className,
  tableMinWidth = 940,
}: {
  /** The count and the filter chips. Rendered in the card's own header bar. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * The floor below which the table scrolls instead of wrapping.
   *
   * 940 is the reference's, and it is right for a board that owns the full page
   * width. It is wrong inside an archetype-C record, where the evidence column
   * is roughly 700px next to a 380px side panel: the last two columns fall off
   * the right and the vendor's payout is invisible until somebody thinks to
   * scroll sideways. T32's purchase order was the first screen to hit that.
   */
  tableMinWidth?: number;
}): React.JSX.Element {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-rule bg-sheet', className)}>
      {toolbar && (
        <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-sheet-2 px-4 py-3">
          {toolbar}
        </div>
      )}
      {/* An inline `min-width` rather than a Tailwind class: the value is a prop,
          and a class built by interpolation is a class Tailwind never sees and
          therefore never generates. */}
      <div style={{ ['--tg-table-min' as string]: `${tableMinWidth}px` }}>
        <div className="[&_table]:min-w-[var(--tg-table-min)]">{children}</div>
      </div>
    </div>
  );
}

/** A titled block of a long screen. Every QC and vendor screen is a long screen. */
export function Section({
  title,
  subtitle,
  aside,
  id,
  children,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section
      id={id}
      className={cn('tg-card mt-5 rounded-lg border border-rule bg-sheet', className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-h3 text-ink">{title}</h2>
        {aside}
      </header>
      <TickRule />
      {subtitle && <p className="mt-2 max-w-prose text-body-sm text-ink-2">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A key/value line. Used everywhere a record is read rather than edited. */
export function Datum({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-rule-2 py-3">
      <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</span>
      <span className="text-body-sm text-ink">{children}</span>
    </div>
  );
}

/**
 * What a value we do not have looks like.
 *
 * **Never an em dash and never a zero.** 09_FRONTEND_LOCKED.md: a missing value
 * never renders as a passing one, and a dash in a column of results reads as a
 * result — "nothing wrong here" — which is exactly the reading it must not get.
 * Words, in `--ink-4`, with the reason available to a screen reader.
 */
export function NotMeasured({ why, label = 'Not measured' }: { why: string; label?: string }): React.JSX.Element {
  return (
    // `font-sans` explicitly: `DataTable` puts a numeric column in mono and
    // tabular figures, and these are words. A sentence in IBM Plex Mono in the
    // middle of a price column reads as data that failed to parse.
    <span className="whitespace-nowrap font-sans text-body-sm text-ink-4" title={why}>
      {label}
      <span className="sr-only"> — {why}</span>
    </span>
  );
}
