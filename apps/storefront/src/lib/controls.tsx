import * as React from 'react';
import { cn } from '@trugrade/ui';

/**
 * The one control `@trugrade/ui` does not ship that this app needs: `<select>`.
 *
 * A custom listbox is a keyboard-accessibility project with nothing to show for
 * it — the native element already carries the keyboard behaviour, the mobile
 * picker and the ARIA. It wears `Input`'s exact token classes so a column of
 * mixed controls lines up to the pixel.
 *
 * `apps/console/src/lib/controls.tsx` holds the same pair for the same reason.
 * Two copies is one too many and the fix is `packages/ui`, not a third copy —
 * reported again as a package gap rather than forked into `register/`.
 */

const CONTROL =
  'rounded border border-rule bg-sheet px-4 text-body-sm text-ink placeholder:text-ink-3 transition-colors';

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
  required,
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
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <label htmlFor={selectId} className="text-body-sm font-medium text-ink-2">
        {label}
        {required && (
          <span className="text-fail" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <select
        id={selectId}
        required={required}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={cn(CONTROL, 'h-11 w-full', error && 'border-fail')}
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
      {hint && !error && (
        <p id={`${selectId}-hint`} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${selectId}-error`} className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
