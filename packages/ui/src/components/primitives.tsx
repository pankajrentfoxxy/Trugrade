import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';
import type { Grade } from '@trugrade/contracts';

/* ==========================================================================
 * Button
 * ======================================================================== */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-3 rounded font-medium transition-colors ' +
    'disabled:opacity-45 disabled:cursor-not-allowed aria-disabled:opacity-45',
  {
    variants: {
      variant: {
        /**
         * Amber fill, `--acc-on` text. `09_FRONTEND_LOCKED.md` §5: there is no
         * other primary style.
         *
         * The pairing measures 11.2:1, which is why the text token is near-black
         * rather than white — white on this amber fails outright. The previous
         * palette needed a darkened amber to clear 4.5:1 with white text; this
         * one solves it the other way round and gets a far better ratio.
         */
        primary: 'bg-acc text-acc-on hover:bg-acc-dk active:translate-y-px',
        secondary: 'bg-sheet-2 text-ink border border-rule hover:bg-ground',
        ghost: 'bg-transparent text-ink-2 hover:bg-sheet-2',
        link: 'bg-transparent text-acc-ink underline underline-offset-4 hover:text-acc',
        danger: 'bg-fail text-white hover:opacity-90',
      },
      size: {
        sm: 'h-9 px-4 text-body-sm',
        // 44px minimum touch target (WCAG 2.2 AA target size).
        md: 'h-11 px-5 text-body-sm',
        lg: 'h-12 px-7 text-body',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  /**
   * When a button is disabled for a *reason the user should know*, pass the
   * reason instead of `disabled`. A `disabled` button is unreachable by keyboard
   * and announces nothing; `aria-disabled` keeps it focusable so the reason can
   * be read.
   */
  disabledReason?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    block,
    loading,
    leadingIcon,
    disabledReason,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading || Boolean(disabledReason);
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      // A reason-disabled button stays focusable so a screen reader can reach it.
      disabled={disabledReason ? undefined : isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      title={disabledReason}
      {...props}
    >
      {loading ? (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        leadingIcon
      )}
      {/* The label stays put while loading — a button that changes width under
          the cursor moves the target out from under the pointer. */}
      <span>{children}</span>
    </button>
  );
});

/* ==========================================================================
 * Input — with the verified/rejected states that carry the resolved entity
 * ======================================================================== */

export type VerifyState = 'idle' | 'verifying' | 'verified' | 'rejected';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
  verifyState?: VerifyState;
  /**
   * What the check resolved to. **Never show only a tick** — the resolved entity
   * is what makes the tick trustworthy: GSTIN → legal name + type + state,
   * IFSC → bank + branch, penny-drop → the name the bank actually holds.
   */
  verifyDetail?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    mono,
    verifyState = 'idle',
    verifyDetail,
    className,
    id,
    required,
    ...props
  },
  ref,
) {
  const generated = React.useId();
  const inputId = id ?? generated;
  const describedBy = [
    hint && `${inputId}-hint`,
    error && `${inputId}-error`,
    verifyDetail && `${inputId}-verify`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-body-sm font-medium text-ink-2">
        {label}
        {required && (
          <span className="text-fail" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>

      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={Boolean(error) || verifyState === 'rejected' || undefined}
        aria-describedby={describedBy || undefined}
        readOnly={verifyState === 'verifying' || props.readOnly}
        className={cn(
          // placeholder:text-ink-3 — ink-4 measures 2.53:1, which fails both the
          // text floor and the 3:1 floor for meaningful graphics.
          'h-11 rounded border bg-sheet px-4 text-body-sm text-ink placeholder:text-ink-3',
          'transition-colors',
          // `tnum` and not just `font-mono`. CLAUDE.md: every number is IBM Plex
          // Mono WITH tabular-nums, and this branch is what renders every GSTIN,
          // PAN, CIN, Udyam, TAN, IFSC and pincode the product asks for. Without
          // it a digit changing mid-field shifts the characters after it, which
          // is exactly the jitter tabular figures exist to stop — most visible
          // while someone types a 15-character GSTIN one character at a time.
          mono && 'font-mono tnum uppercase tracking-wide',
          error || verifyState === 'rejected' ? 'border-fail' : 'border-rule',
          verifyState === 'verified' && 'border-pass',
          className,
        )}
        {...props}
      />

      {hint && !error && (
        // --ink-2, not --ink-3: ink-3 measures 4.19:1 on the paper ground, and a
        // hint is as likely to sit on paper as on a sheet.
        <p id={`${inputId}-hint`} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}

      {verifyState === 'verifying' && (
        <p className="text-body-sm text-ink-2" role="status">
          Checking…
        </p>
      )}

      {verifyDetail && verifyState === 'verified' && (
        <p id={`${inputId}-verify`} className="text-body-sm text-pass">
          {verifyDetail}
        </p>
      )}

      {error && (
        <p id={`${inputId}-error`} className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

/* ==========================================================================
 * StatusPill — semantic colour, and never colour alone
 * ======================================================================== */

const pillVariants = cva(
  'inline-flex items-center gap-2 rounded-sm px-3 py-1 text-label font-mono uppercase tracking-[0.13em]',
  {
    variants: {
      tone: {
        neutral: 'bg-sheet-2 text-ink-2 border border-rule',
        info: 'bg-acc-wash text-acc-ink',
        pass: 'bg-sheet-2 text-pass',
        // Rule 4: outlined, never filled. --warn sits close to the accent in
        // hue, and a filled warn chip is confusable with a primary action at a
        // glance. PASS and FAIL fill normally; WARN does not.
        warn: 'bg-transparent text-warn border border-warn',
        fail: 'bg-sheet-2 text-fail',
        processing: 'bg-sheet-2 text-ink-2 border border-rule',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface StatusPillProps extends VariantProps<typeof pillVariants> {
  label: string;
  className?: string;
}

/**
 * Semantic colour is never the only signal — the pill always carries its text.
 * A colourblind buyer must be able to read the comparison grid.
 */
export function StatusPill({ tone, label, className }: StatusPillProps): React.JSX.Element {
  return (
    <span className={cn(pillVariants({ tone }), className)}>
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current',
          tone === 'processing' && 'animate-skeleton',
        )}
      />
      {label}
    </span>
  );
}

/* ==========================================================================
 * GradeBadge — NEUTRAL, never coloured
 * ======================================================================== */

const GRADE_LABEL: Record<Grade, string> = {
  A_PLUS: 'A+',
  A: 'A',
  B: 'B',
};

export interface GradeBadgeProps {
  grade: Grade;
  /** `declared` renders a dashed border: the vendor said it, we have not checked. */
  variant?: 'verified' | 'declared' | 'corrected';
  previousGrade?: Grade;
  className?: string;
}

/**
 * A grade badge is **neutral** — `--sheet-2` ground, `--rule` border, ink text.
 *
 * A+, A and B are all sellable. Colouring them green/amber/red conflates a
 * position on a scale with a verdict, which is the mistake the DeviceSure
 * certificate currently makes (08_BRAND_SYSTEM.md §4 rule 2).
 */
export function GradeBadge({
  grade,
  variant = 'verified',
  previousGrade,
  className,
}: GradeBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-sm border bg-sheet-2 px-3 py-1',
        'font-mono text-data font-semibold text-ink',
        // border-ink-3 rather than ink-4: a dashed border that carries meaning
        // is a meaningful graphic and needs 3:1. ink-4 is 2.53:1.
        variant === 'declared' ? 'border-dashed border-ink-3' : 'border-rule',
        className,
      )}
      data-testid="grade-badge"
    >
      {variant === 'corrected' && previousGrade && (
        <span className="text-ink-3 line-through">{GRADE_LABEL[previousGrade]}</span>
      )}
      <span>{GRADE_LABEL[grade]}</span>
      {variant === 'declared' && (
        <span className="sr-only">declared by the supplier, not yet verified</span>
      )}
    </span>
  );
}

/* ==========================================================================
 * ScoreRing
 * ======================================================================== */

export interface ScoreRingProps {
  /** 0–100, or null when there is no score. A null ring is dashed and reads "—". */
  value: number | null;
  size?: number;
  label?: string;
  className?: string;
}

/** The accent, turning `--warn` below 80. Replaces the old tri-arc ring. */
export function ScoreRing({
  value,
  size = 58,
  label,
  className,
}: ScoreRingProps): React.JSX.Element {
  const stroke = Math.max(3, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const hasScore = value !== null && Number.isFinite(value);
  const pct = hasScore ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div
      className={cn('inline-flex flex-col items-center gap-1', className)}
      role="img"
      aria-label={hasScore ? `Inspection score ${pct} out of 100` : 'No inspection score'}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={stroke}
          strokeDasharray={hasScore ? undefined : '3 4'}
        />
        {hasScore && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={pct < 80 ? 'var(--warn)' : 'var(--acc)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-ink font-mono"
          style={{ fontSize: size / 3.2, fontVariantNumeric: 'tabular-nums' }}
        >
          {hasScore ? pct : '—'}
        </text>
      </svg>
      {label && (
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</span>
      )}
    </div>
  );
}

/* ==========================================================================
 * SealChip
 * ======================================================================== */

export type SealStatus = 'APPLIED' | 'INTACT' | 'BROKEN' | 'MISSING' | 'REPLACED' | 'NOT_APPLIED';

const SEAL_TONE: Record<SealStatus, StatusPillProps['tone']> = {
  APPLIED: 'pass',
  INTACT: 'pass',
  BROKEN: 'fail',
  MISSING: 'fail',
  REPLACED: 'warn',
  NOT_APPLIED: 'neutral',
};

const SEAL_LABEL: Record<SealStatus, string> = {
  APPLIED: 'Sealed',
  INTACT: 'Seal intact',
  BROKEN: 'Seal broken',
  MISSING: 'Seal missing',
  REPLACED: 'Seal replaced',
  NOT_APPLIED: 'No seal',
};

export function SealChip({
  sealCode,
  status,
  className,
}: {
  sealCode?: string;
  status: SealStatus;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <StatusPill tone={SEAL_TONE[status]} label={SEAL_LABEL[status]} />
      {sealCode && <code className="font-mono text-data tnum text-ink-2">{sealCode}</code>}
    </span>
  );
}

/* ==========================================================================
 * EmptyState / Skeleton
 * ======================================================================== */

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 rounded-lg border border-rule bg-sheet p-11 text-center',
        className,
      )}
    >
      <h3 className="font-sans text-h3 text-ink">{title}</h3>
      {body && <p className="max-w-prose text-body-sm text-ink-2">{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({
  className,
  lines = 1,
}: {
  className?: string;
  lines?: number;
}): React.JSX.Element {
  return (
    <span aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={cn('block h-4 animate-skeleton rounded-xs bg-rule-2', className)}
        />
      ))}
    </span>
  );
}

/* ==========================================================================
 * RepresentativeImage — the caption that cannot be forgotten
 * ======================================================================== */

export interface RepresentativeImageProps {
  /** Omit or pass null when nothing resolved — a labelled placeholder renders. */
  src?: string | null;
  alt: string;
  grade: Grade;
  /** Where the buyer can see the *actual* unit's photographs, before purchase. */
  passportHref?: string;
  /**
   * Which level of the catalog the photograph actually came from.
   *
   * A series-level image is a photograph of a **different machine** in the same
   * family. Rendering it identically to a SKU-specific one is the quiet half of
   * the misrepresentation risk, so the caption widens with the anchor.
   */
  match?: 'SKU' | 'MODEL' | 'SERIES' | 'PLACEHOLDER';
  className?: string;
}

/** What the caption has to admit to at each anchor level. */
const MATCH_QUALIFIER: Record<NonNullable<RepresentativeImageProps['match']>, string | null> = {
  SKU: null,
  MODEL: 'This photograph is of another unit of the same model, in this grade.',
  SERIES: 'This photograph is of another model in the same range, in this grade.',
  PLACEHOLDER: null,
};

/**
 * A listing image is a representative image of a grade, not the machine the
 * buyer will receive — and it must say so, visibly and non-dismissibly.
 *
 * The caption is baked into the component precisely so it cannot be omitted by
 * a caller in a hurry. Under CP e-Comm r.7(5) we bear liability for authenticity
 * claims and r.7(2) prohibits misrepresenting quality; a representative image
 * with an honest label and a real per-unit report behind it is fine, and one
 * presented as *the* machine is not.
 *
 * Three renderings, and the third is the one that keeps the other two honest:
 * a SKU-level photograph, a broader one that says whose machine it actually is,
 * and — when nothing resolved — a placeholder that says so in words rather than
 * a grey box the buyer reads as "no photo available yet".
 */
export function RepresentativeImage({
  src,
  alt,
  grade,
  passportHref,
  match = 'SKU',
  className,
}: RepresentativeImageProps): React.JSX.Element {
  const passport = passportHref ? (
    <>
      Your unit&rsquo;s actual inspection report and photographs are on its{' '}
      <a href={passportHref} className="text-acc-ink underline underline-offset-2">
        unit passport
      </a>
      .
    </>
  ) : (
    <>Your unit&rsquo;s actual inspection report and photographs are on the unit passport.</>
  );

  // Nothing resolved. Say that, rather than rendering a broken image or an
  // unlabelled grey box — Task 4 requires the placeholder to be explicit.
  if (!src || match === 'PLACEHOLDER') {
    return (
      <figure className={cn('flex flex-col gap-3', className)} data-testid="representative-image">
        <div
          role="img"
          aria-label={`No photograph available for Grade ${GRADE_LABEL[grade]} condition`}
          className="flex aspect-[3/2] w-full items-center justify-center rounded-lg border border-dashed border-rule bg-sheet-2 px-5 text-center text-body-sm text-ink-2"
        >
          No photograph of Grade {GRADE_LABEL[grade]} condition yet
        </div>
        <figcaption className="text-body-sm text-ink-2">
          We have not photographed this grade for this model yet. {passport}
        </figcaption>
      </figure>
    );
  }

  const qualifier = MATCH_QUALIFIER[match];

  return (
    <figure className={cn('flex flex-col gap-3', className)} data-testid="representative-image">
      <img
        src={src}
        alt={alt}
        className="w-full rounded-lg border border-rule bg-sheet-2 object-cover"
      />
      <figcaption className="text-body-sm text-ink-2">
        Representative image of Grade {GRADE_LABEL[grade]} condition.{' '}
        {qualifier ? `${qualifier} ` : ''}
        {passport}
      </figcaption>
    </figure>
  );
}
