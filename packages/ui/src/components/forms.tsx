'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';
import { StatusPill, type StatusPillProps } from './primitives';

/* ==========================================================================
 * Chip — a filter toggle, or a removable token
 * ======================================================================== */

export interface ChipProps {
  label: string;
  /** How many results carry this value. A facet with no count is a guess. */
  count?: number;
  selected?: boolean;
  onToggle?: () => void;
  /** Renders the token form: a label with its own remove control. */
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

const CHIP_BASE =
  'inline-flex min-h-11 items-center gap-2 rounded-sm border px-3 text-body-sm transition-colors';

/**
 * "Many short values from a known list": brands, RAM sizes, generations, grades.
 *
 * A toggle chip is a `<button aria-pressed>`, not a checkbox wearing a border —
 * `aria-pressed` is what tells a screen reader that pressing it changes the
 * result set rather than submitting something.
 *
 * The **count is not a scarcity device**. It says how many results a facet has;
 * there is no variant of this component that says how many are left to buy.
 */
export function Chip({
  label,
  count,
  selected = false,
  onToggle,
  onRemove,
  disabled,
  className,
}: ChipProps): React.JSX.Element {
  const body = (
    <>
      {label}
      {count !== undefined && (
        <span className={cn('font-mono text-label tnum', selected ? 'text-current' : 'text-ink-3')}>
          {count}
        </span>
      )}
    </>
  );

  if (onRemove) {
    // A remove control nested inside a button is invalid HTML and unreachable
    // by keyboard, so the token form is a span that contains the only button.
    return (
      <span className={cn(CHIP_BASE, 'border-rule bg-sheet-2 text-ink', className)}>
        {body}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove filter: ${label}`}
          className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center text-ink-2 hover:text-ink"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        CHIP_BASE,
        selected
          ? 'border-acc-dk bg-acc-wash font-medium text-acc-ink'
          : 'border-rule bg-sheet text-ink-2 hover:border-ink-3 hover:text-ink',
        disabled && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      {body}
    </button>
  );
}

/* ==========================================================================
 * SelectTile — a multi-select option card (icon, title, description, indicator)
 * ======================================================================== */

export type SelectTileIndicator = 'radio' | 'checkbox';

export interface SelectTileProps {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  /** Radio circle for single-choice rows; square check for multi-select. */
  indicator?: SelectTileIndicator;
  className?: string;
}

function SelectTileIndicator({
  selected,
  indicator,
}: {
  selected: boolean;
  indicator: SelectTileIndicator;
}): React.JSX.Element {
  if (indicator === 'checkbox') {
    return (
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2 transition-colors',
          selected ? 'border-acc bg-acc text-acc-on' : 'border-rule-2 bg-sheet',
        )}
        aria-hidden
      >
        {selected ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2.5 6L5 8.5L9.5 3.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        selected ? 'border-acc bg-acc' : 'border-rule-2 bg-transparent',
      )}
      aria-hidden
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-acc-on" /> : null}
    </span>
  );
}

/**
 * A tappable card for choosing one or many options from a short list.
 *
 * The whole row is the control (`aria-pressed`), with a visible indicator on the
 * right so the pattern reads as "pick these" rather than "navigate somewhere".
 */
export function SelectTile({
  label,
  description,
  icon,
  selected = false,
  onToggle,
  disabled,
  indicator = 'radio',
  className,
}: SelectTileProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'flex min-h-11 w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors',
        selected
          ? 'border-acc-dk bg-acc-wash'
          : 'border-rule bg-sheet hover:border-ink-3',
        disabled && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sheet-2 text-ink-2',
            selected && 'text-acc-ink',
          )}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-body font-medium text-ink">{label}</span>
        {description ? (
          <span className="text-label leading-relaxed text-ink-3">{description}</span>
        ) : null}
      </span>
      <SelectTileIndicator selected={selected} indicator={indicator} />
    </button>
  );
}

/* ==========================================================================
 * Checkbox — and the reason it has no `defaultChecked`
 * ======================================================================== */

export interface CheckboxProps {
  label: React.ReactNode;
  /**
   * Controlled, always, and required.
   *
   * There is deliberately **no `defaultChecked`**. CP e-Comm Rule 4(9) forbids
   * a pre-ticked consent, and the way that ships by accident is an uncontrolled
   * checkbox whose default someone flips "so the flow converts better". Making
   * the caller pass the value on every render means a ticked box is always a
   * line of code someone wrote on purpose, and always visible in a diff.
   */
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * What agreeing actually does, in a sentence. Mandatory in review for any box
   * that changes account behaviour (03_UX_SPEC.md §2.1 #6, Rule 03).
   */
  consequence?: React.ReactNode;
  indeterminate?: boolean;
  error?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  required?: boolean;
  id?: string;
  className?: string;
}

export function Checkbox({
  label,
  checked,
  onChange,
  consequence,
  indeterminate = false,
  error,
  disabled,
  name,
  value,
  required,
  id,
  className,
}: CheckboxProps): React.JSX.Element {
  const generated = React.useId();
  const inputId = id ?? generated;
  const ref = React.useRef<HTMLInputElement>(null);
  const describedBy = [consequence && `${inputId}-consequence`, error && `${inputId}-error`]
    .filter(Boolean)
    .join(' ');

  // `indeterminate` is a DOM property with no HTML attribute, so it has to be
  // set imperatively or the mixed state never reaches the accessibility tree.
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-start gap-3">
        <input
          ref={ref}
          type="checkbox"
          id={inputId}
          name={name}
          value={value}
          checked={checked}
          required={required}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy || undefined}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded-xs border border-rule accent-acc"
        />
        {/* The box is 20px; the *target* is the label, padded out past the 44px
            floor (§1.9.2) and pulled back with a negative margin so the hit area
            grows without the layout moving. The visual size may shrink; the
            target size may not. */}
        <label htmlFor={inputId} className="-my-3 cursor-pointer py-3 text-body-sm text-ink">
          {label}
          {required && (
            <span className="text-fail" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
      </div>

      {consequence && (
        <p id={`${inputId}-consequence`} className="pl-8 text-body-sm text-ink-2">
          {consequence}
        </p>
      )}

      {error && (
        <p id={`${inputId}-error`} className="pl-8 text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * Uploader
 * ======================================================================== */

export type UploadStatus =
  | 'uploading'
  | 'scanning'
  | 'pending-review'
  | 'accepted'
  | 'rejected'
  | 'expired';

export interface UploadedFile {
  id: string;
  name: string;
  sizeBytes: number;
  status: UploadStatus;
  /** 0–100 while `uploading`. Announced at the quartiles only. */
  progressPct?: number;
  /** The actual reason, not "invalid file" (§5.2). */
  rejectionReason?: string;
}

const UPLOAD_TONE: Record<UploadStatus, StatusPillProps['tone']> = {
  uploading: 'processing',
  scanning: 'processing',
  'pending-review': 'info',
  accepted: 'pass',
  rejected: 'fail',
  expired: 'warn',
};

const UPLOAD_LABEL: Record<UploadStatus, string> = {
  uploading: 'Uploading',
  scanning: 'Checking',
  'pending-review': 'With our team',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
};

/** KB/MB, one decimal. A byte count is not something a person reads. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Progress is announced at 0 / 25 / 50 / 75 / 100 and nowhere between.
 *
 * A live region that updates on every tick reads the number aloud forty times
 * and drowns out everything else on the page (§1.9.4).
 */
function progressAnnouncement(file: UploadedFile): string {
  if (file.status !== 'uploading' || file.progressPct === undefined) return '';
  return `Uploading ${file.name}, ${Math.floor(file.progressPct / 25) * 25} percent.`;
}

export interface UploaderProps {
  label: string;
  /** What a good file looks like, in the user's terms, before they pick one. */
  hint?: React.ReactNode;
  accept: string;
  maxSizeMb: number;
  multiple?: boolean;
  files: readonly UploadedFile[];
  onSelect: (files: File[]) => void;
  onRemove?: (id: string) => void;
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * A real `<input type="file">`, always present and always focusable.
 *
 * The drop zone is a decorative enhancement layered around it, never the only
 * path — WCAG 2.2 adds 2.5.7 Dragging Movements precisely because "drag your
 * file here" shipped for a decade as the only affordance.
 *
 * A rejected file stays in the list with its reason attached, so a vendor with
 * six documents in flight never has to remember which one failed.
 */
export function Uploader({
  label,
  hint,
  accept,
  maxSizeMb,
  multiple = false,
  files,
  onSelect,
  onRemove,
  error,
  disabled,
  id,
  className,
}: UploaderProps): React.JSX.Element {
  const generated = React.useId();
  const inputId = id ?? generated;
  const [dragging, setDragging] = React.useState(false);

  const describedBy = [hint && `${inputId}-hint`, `${inputId}-status`, error && `${inputId}-error`]
    .filter(Boolean)
    .join(' ');

  const take = (list: FileList | null) => {
    if (!list || disabled) return;
    onSelect([...list]);
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <label htmlFor={inputId} className="text-body-sm font-medium text-ink-2">
        {label}
      </label>

      {hint && (
        <p id={`${inputId}-hint`} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(event.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col gap-3 rounded-lg border border-dashed p-5 transition-colors',
          dragging ? 'border-acc-dk bg-acc-wash' : 'border-rule bg-sheet-2',
        )}
      >
        <input
          type="file"
          id={inputId}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => take(event.target.files)}
          className="text-body-sm text-ink-2 file:mr-4 file:min-h-11 file:rounded file:border file:border-rule file:bg-sheet file:px-4 file:text-body-sm file:text-ink"
        />
        <p className="text-body-sm text-ink-3">
          Or drop {multiple ? 'files' : 'a file'} here. Up to {maxSizeMb} MB.
        </p>
      </div>

      <p id={`${inputId}-status`} role="status" aria-live="polite" className="sr-only">
        {files.map(progressAnnouncement).filter(Boolean).join(' ')}
      </p>

      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-rule bg-sheet px-4 py-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-sm text-ink">{file.name}</span>
                <span className="font-mono text-label tnum text-ink-2">
                  {formatFileSize(file.sizeBytes)}
                </span>
              </span>

              <span className="flex items-center gap-3">
                <StatusPill tone={UPLOAD_TONE[file.status]} label={UPLOAD_LABEL[file.status]} />
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(file.id)}
                    aria-label={`Remove ${file.name}`}
                    className="min-h-11 min-w-11 text-body-sm text-ink-2 underline underline-offset-4 hover:text-ink"
                  >
                    Remove
                  </button>
                )}
              </span>

              {/* Visible progress, not only announced.
                  `progressAnnouncement` above puts it on an aria-live region,
                  which serves a screen-reader user and nobody else — a sighted
                  person watching a 5 MB scan upload had a pill reading
                  "Uploading" and no way to tell a slow connection from a stalled
                  one. The determinate bar and the number are the same fact the
                  live region already carries, so it is aria-hidden rather than
                  read twice.

                  Amber is correct here under the colour rules: this is a
                  measured value. */}
              {file.status === 'uploading' && file.progressPct !== undefined && (
                <span className="flex w-full items-center gap-3" aria-hidden="true">
                  <span className="h-1 flex-1 overflow-hidden rounded-xs bg-sheet-3">
                    <span
                      className="block h-full bg-acc transition-[width] duration-200"
                      style={{ width: `${Math.max(0, Math.min(100, file.progressPct))}%` }}
                    />
                  </span>
                  <span className="font-mono text-label tnum text-ink-2">
                    {Math.round(file.progressPct)}%
                  </span>
                </span>
              )}

              {file.rejectionReason && (
                <p role="alert" className="w-full text-body-sm text-fail">
                  {file.rejectionReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * OtpInput
 * ======================================================================== */

export interface OtpInputProps {
  /** Controlled. Digits only, shorter than `length` while it is being typed. */
  value: string;
  onChange: (value: string) => void;
  /** Fired once the last box is filled, so the caller does not watch `length`. */
  onComplete?: (value: string) => void;
  length?: number;
  /** What the group is. "Enter the code sent to +91 98xxx xx210". */
  label: string;
  /** The real reason: "That code has expired. We sent a new one." */
  error?: string;
  disabled?: boolean;
  className?: string;
}

const DIGITS_ONLY = /\D/g;

/**
 * Six boxes, one digit each — email and mobile verification, everywhere.
 *
 * Three things make the difference between this and a row of text inputs, and
 * all three are about how a code actually arrives:
 *
 *   - `autocomplete="one-time-code"` on the **first** box only. iOS and Android
 *     offer the SMS code above the keyboard and fill that field; repeating the
 *     attribute on all six makes the platform fill the same digit six times.
 *   - **Paste fills the whole group.** People copy the code out of the message,
 *     and a paste that lands one digit in box 3 is the single most common way
 *     this pattern fails.
 *   - `inputMode="numeric"`, so a phone shows the number pad rather than a
 *     keyboard whose digits are behind a modifier.
 *
 * The value is one string, not six pieces of state: the caller submits a code,
 * not an array, and six independent states is six chances to get the join wrong.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  error,
  disabled,
  className,
}: OtpInputProps): React.JSX.Element {
  const groupId = React.useId();
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.replace(DIGITS_ONLY, '').slice(0, length);

  const commit = (next: string, focusIndex: number) => {
    onChange(next);
    refs.current[Math.min(focusIndex, length - 1)]?.focus();
    if (next.length === length) onComplete?.(next);
  };

  const replaceAt = (index: number, digit: string) =>
    (digits.slice(0, index) + digit + digits.slice(index + 1)).slice(0, length);

  const onBoxChange = (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value.replace(DIGITS_ONLY, '');
    if (!typed) return;
    // A platform autofill drops the entire code into the first box, which is
    // indistinguishable from a paste and is handled the same way.
    if (typed.length > 1) {
      const next = (digits.slice(0, index) + typed).slice(0, length);
      commit(next, next.length);
      return;
    }
    const next = replaceAt(index, typed);
    commit(next, index + 1);
  };

  const onKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      // Backspace on an empty box steps back and clears — the behaviour every
      // other OTP field has, and its absence strands people on box 4.
      const target = digits[index] ? index : Math.max(0, index - 1);
      commit(replaceAt(target, ''), target);
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const onPaste = (index: number) => (event: React.ClipboardEvent) => {
    const pasted = event.clipboardData.getData('text').replace(DIGITS_ONLY, '');
    if (!pasted) return;
    event.preventDefault();
    const next = (digits.slice(0, index) + pasted).slice(0, length);
    commit(next, next.length);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span id={groupId} className="text-body-sm font-medium text-ink-2">
        {label}
      </span>

      <div
        role="group"
        aria-labelledby={groupId}
        aria-describedby={error ? `${groupId}-error` : undefined}
        className="flex flex-wrap gap-2"
        data-testid="otp-input"
      >
        {Array.from({ length }, (_, index) => (
          <input
            key={index}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="text"
            inputMode="numeric"
            // Only the first box. See the note above — six of these is six
            // copies of the same digit on iOS.
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            // Not maxLength=1: a paste or an autofill has to be allowed to
            // arrive whole before it is redistributed.
            aria-label={`Digit ${index + 1} of ${length}`}
            aria-invalid={Boolean(error) || undefined}
            disabled={disabled}
            value={digits[index] ?? ''}
            onChange={onBoxChange(index)}
            onKeyDown={onKeyDown(index)}
            onPaste={onPaste(index)}
            onFocus={(event) => event.target.select()}
            className={cn(
              // 44px minimum target, and mono because a one-time code is data.
              'h-12 w-11 rounded border bg-sheet text-center font-mono text-h3 tnum text-ink',
              error ? 'border-fail' : 'border-rule',
              disabled && 'cursor-not-allowed opacity-45',
            )}
          />
        ))}
      </div>

      {error && (
        <p id={`${groupId}-error`} role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      )}
    </div>
  );
}
