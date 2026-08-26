import * as React from 'react';
import { cn } from '@trugrade/ui';

/**
 * Native form controls in the Workbench palette, local to the QC lane.
 *
 * These are deliberately **not** new design-system primitives. `@trugrade/ui`
 * ships `Input`, and a `<select>` and a `<textarea>` are native elements that
 * need a border and a font, not a component library — a custom listbox would be
 * a keyboard-accessibility project with nothing to show for it. They live here,
 * next to the only screens that use them, wearing `Input`'s exact classes so a
 * row of mixed controls lines up.
 *
 * ponytail: promote to `@trugrade/ui` if a second app needs them. One app does.
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
          <option key={o.value} value={o.value}>
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

/** A titled section of a long screen. Every QC screen is a long screen. */
export function Panel({
  title,
  subtitle,
  aside,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="mt-5 rounded-lg border border-rule bg-sheet p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-h3 text-ink">{title}</h2>
        {aside}
      </header>
      {subtitle && <p className="mt-2 text-body-sm text-ink-2">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A key/value line. Used everywhere a record is being read rather than edited. */
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

export const TH =
  'px-3 py-2 text-left font-mono text-label uppercase tracking-[0.13em] text-ink-2 whitespace-nowrap';
export const TD = 'px-3 py-3 align-top text-body-sm text-ink';

/** `—`, and the reason it is a dash, for anything the record does not carry. */
export function Blank({ why }: { why: string }): React.JSX.Element {
  return (
    <span className="text-ink-3" title={why}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{why}</span>
    </span>
  );
}
