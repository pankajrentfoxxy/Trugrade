import * as React from 'react';
import { cn } from '../lib/cn';

export interface ToleranceBandProps {
  /** e.g. "Battery · Grade A band" */
  label: string;
  /** Start of the permitted band, as a 0–100 position on the scale. */
  bandMin: number;
  bandMax: number;
  /** Hollow tick — omit when nothing was declared. */
  declared?: number;
  /**
   * Solid dot — **omit entirely when not measured**. Passing 0 here would render
   * a measurement at the bottom of the scale, which is exactly the lie this
   * component exists to prevent.
   */
  found?: number;
  /** "Found 91%" | "Not measured" */
  foundLabel: string;
  outOfTolerance?: boolean;
  className?: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * The tolerance band — the signature component (08_BRAND_SYSTEM.md §6).
 *
 * The mark scaled up into something that carries information. It shows three
 * things at once: the band a grade permits, the value the vendor **declared**,
 * and the value we **measured**.
 *
 * Three states, and the third is the one that matters:
 *
 *   within tolerance   signal-blue dot inside the wash band. Calm.
 *   out of tolerance   fail-red dot outside the band. The gap is the loudest
 *                      thing on screen — correct, because that gap is the business.
 *   NOT MEASURED       **no dot at all**, band at 45% opacity, label in ink-3.
 *
 * A missing value must never render as a passing one. That is the rule
 * DeviceSure's `never-fabricate.md` gets right, made visible in the UI, and it
 * is the single control that keeps a grade defensible under CP e-Comm r.7(5).
 */
export function ToleranceBand({
  label,
  bandMin,
  bandMax,
  declared,
  found,
  foundLabel,
  outOfTolerance = false,
  className,
}: ToleranceBandProps): React.JSX.Element {
  const measured = found !== undefined && found !== null && Number.isFinite(found);
  const left = clamp(Math.min(bandMin, bandMax));
  const width = clamp(Math.abs(bandMax - bandMin));

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="tolerance-band">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</span>
        <span
          className={cn(
            'font-mono text-data tnum',
            !measured && 'text-ink-3',
            measured && outOfTolerance && 'text-fail',
            measured && !outOfTolerance && 'text-ink-2',
          )}
        >
          {foundLabel}
        </span>
      </div>

      <div
        className={cn('relative h-3 w-full', !measured && 'opacity-45')}
        role="img"
        aria-label={
          measured
            ? `${label}: permitted band ${bandMin} to ${bandMax}, ${foundLabel}${outOfTolerance ? ', outside tolerance' : ''}`
            : `${label}: permitted band ${bandMin} to ${bandMax}, not measured`
        }
      >
        {/* the rail */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />
        {/* end ticks */}
        <div className="absolute left-0 top-0 h-3 w-px bg-rule" />
        <div className="absolute right-0 top-0 h-3 w-px bg-rule" />

        {/* the band a grade permits */}
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-xs bg-signal-wash"
          style={{ left: `${left}%`, width: `${width}%` }}
        />

        {/* declared: a hollow tick */}
        {declared !== undefined && (
          <div
            className="absolute top-0 h-3 w-0.5 -translate-x-1/2 bg-ink-4"
            style={{ left: `${clamp(declared)}%` }}
            data-testid="tolerance-declared"
          />
        )}

        {/* found: a solid dot — rendered ONLY when there is a measurement */}
        {measured && (
          <div
            className={cn(
              'absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
              outOfTolerance ? 'bg-fail' : 'bg-signal',
            )}
            style={{ left: `${clamp(found)}%` }}
            data-testid="tolerance-found"
          />
        )}
      </div>
    </div>
  );
}
