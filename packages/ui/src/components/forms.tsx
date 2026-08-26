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
