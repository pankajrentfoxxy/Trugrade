import * as React from 'react';
import { cn } from '../lib/cn';

export interface EvidenceProps {
  /** The headline figure, e.g. 98 */
  value: number | string;
  /** Render the value as a percentage. */
  pct?: boolean;
  /** The sample size the value was computed over. */
  denominator: number;
  /** What the denominator counts, e.g. "units". */
  denominatorLabel?: string;
  /**
   * Below this, no headline number is shown at all — `New supplier · 3 units
   * inspected` instead. Publishing an authoritative-looking average computed on
   * two machines is exactly the claim the CCPA Misleading Advertisements
   * Guidelines 2022 exist to catch, and under CP e-Comm r.7(2) it is OUR claim,
   * not the vendor's.
   */
  minSample?: number;
  smallSampleLabel?: string;
  className?: string;
}

/**
 * Every number carries its denominator (08_BRAND_SYSTEM.md §8 rule 1).
 *
 *   98% grade accuracy · 412 units      not      98% accurate
 *
 * A percentage without a sample size is a claim, not evidence.
 */
export function Evidence({
  value,
  pct = false,
  denominator,
  denominatorLabel = 'units',
  minSample = 10,
  smallSampleLabel = 'New supplier',
  className,
}: EvidenceProps): React.JSX.Element {
  if (denominator < minSample) {
    return (
      <span
        className={cn('flex flex-col leading-tight', className)}
        data-testid="evidence-small-sample"
      >
        <span className="text-body-sm text-ink-2">{smallSampleLabel}</span>
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
          {denominator} {denominatorLabel} inspected
        </span>
      </span>
    );
  }

  return (
    <span className={cn('flex flex-col leading-tight', className)} data-testid="evidence">
      <span className="font-mono text-h3 tnum text-ink">
        {value}
        {pct ? '%' : ''}
      </span>
      <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
        {denominator.toLocaleString('en-IN')} {denominatorLabel}
      </span>
    </span>
  );
}
