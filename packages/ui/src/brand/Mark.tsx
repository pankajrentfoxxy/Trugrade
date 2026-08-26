import * as React from 'react';
import { BRAND } from '@trugrade/config/brand';
import { cn } from '../lib/cn';

export interface MarkProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * The mark: a **tolerance gauge**. Two end ticks, a rail, a pale tick where the
 * grade was *declared*, a solid dot where it was *found*.
 *
 * It is a picture of the product mechanism, and it reduces to a dot on a line at
 * 16 px. 08_BRAND_SYSTEM.md §3.
 *
 * The one rule: the dot is always the accent, and the accent never appears
 * anywhere that does not mean *this was measured*.
 */
export function Mark({ size = 46, className, title = BRAND.name }: MarkProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 46 46"
      role="img"
      aria-label={title}
      className={cn('text-ink', className)}
    >
      <line x1="6" y1="23" x2="40" y2="23" stroke="currentColor" strokeWidth="2" opacity=".28" />
      <line x1="6" y1="15" x2="6" y2="31" stroke="currentColor" strokeWidth="2" opacity=".28" />
      <line x1="40" y1="15" x2="40" y2="31" stroke="currentColor" strokeWidth="2" opacity=".28" />
      <line x1="18" y1="17" x2="18" y2="29" stroke="currentColor" strokeWidth="2.5" opacity=".55" />
      <circle cx="30" cy="23" r="5.5" fill="var(--acc)" />
    </svg>
  );
}

/**
 * The lockup. `tru` in ink, `grade` in the accent — and the brand string comes
 * from the token, never a literal, so the rename that already happened once can
 * happen again for the price of one edit.
 */
export function Wordmark({ className }: { className?: string }): React.JSX.Element {
  const name = BRAND.nameLower;
  const split = Math.min(3, name.length);
  return (
    <span className={cn('font-sans text-h2 font-bold tracking-[-0.045em] lowercase', className)}>
      <span className="text-ink">{name.slice(0, split)}</span>
      <span className="text-acc">{name.slice(split)}</span>
    </span>
  );
}

export function Logo({ className, size = 28 }: MarkProps): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <Mark size={size} />
      <Wordmark />
    </span>
  );
}
