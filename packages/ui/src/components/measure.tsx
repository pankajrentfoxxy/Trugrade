'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * The two components that render a *measurement*, from
 * `09_FRONTEND_LOCKED.md` §5.
 *
 * Both exist because the platform's whole argument is that the machine was
 * opened and tested. A grade is a claim anyone can make; a QC score and a
 * measured battery percentage are not. So these two are the only places amber
 * and green appear on a product card, and they earn it.
 *
 * The colour rules they obey:
 *   - Amber means a primary action, a **measured value**, or an active state.
 *     `QcChip` is the measured-value case.
 *   - Green and red are reserved for PASS and FAIL. `BatteryBar` uses `--pass`
 *     for the filled portion because a battery reading IS a test result.
 *   - Grades are neutral and live in `GradeBadge`. A position on a scale is not
 *     a verdict, and colouring it would make the QC chip mean less.
 */

export interface QcChipProps {
  /** 0–100, as stored on `qc_report.qc_score`. */
  score: number;
  className?: string;
}

/**
 * `QC 94` — amber fill, near-black text, mono.
 *
 * Deliberately NOT graded by value: a 71 and a 94 render identically. The chip
 * says "this was measured", and the number says how well. Colour-coding it into
 * red/amber/green would turn a measurement into a verdict and collide with the
 * PASS/FAIL semantics, which is the one thing the palette rules forbid.
 */
export function QcChip({ score, className }: QcChipProps): React.JSX.Element {
  const rounded = Math.round(score);
  return (
    <span
      data-testid="qc-chip"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm bg-acc px-2 py-0.5',
        'font-mono text-label font-semibold tabular-nums text-acc-on',
        className,
      )}
    >
      <span className="opacity-70">QC</span>
      <span>{rounded}</span>
      <span className="sr-only">out of 100, measured at inspection</span>
    </span>
  );
}

export interface BatteryBarProps {
  /** Measured health as a percentage of design capacity. */
  healthPct: number;
  /** Cycles, when the tool reported them. Omitted is not zero. */
  cycleCount?: number;
  className?: string;
}

/**
 * Mono label, a thin bar, and the percentage. On every product card.
 *
 * This is the number no competitor can print, because printing it requires
 * having opened the machine — which is why it sits on the card rather than
 * three clicks into a specification table.
 *
 * `cycleCount` absent renders nothing rather than `0 cycles`. A tool that did
 * not report cycles has not told us the battery is new; those are different
 * facts and the second one would be a claim we cannot support.
 */
export function BatteryBar({
  healthPct,
  cycleCount,
  className,
}: BatteryBarProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(healthPct)));
  return (
    <div className={cn('flex items-center gap-2', className)} data-testid="battery-bar">
      <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">Batt</span>
      <span
        className="relative h-1 flex-1 overflow-hidden rounded-xs bg-sheet-3"
        role="img"
        aria-label={
          cycleCount === undefined
            ? `Battery health ${pct} percent, measured`
            : `Battery health ${pct} percent, ${cycleCount} cycles, measured`
        }
      >
        <span
          className="absolute inset-y-0 left-0 rounded-xs bg-pass"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-data tabular-nums text-ink">{pct}%</span>
      {cycleCount !== undefined && (
        <span className="font-mono text-label tabular-nums text-ink-4">{cycleCount}c</span>
      )}
    </div>
  );
}

/**
 * The four QC motifs that are pure presentation get thin React wrappers so a
 * consumer never hand-writes the class names and never puts one on a placeholder.
 *
 * The rule from §4, restated because it is the only rule that matters here: a
 * motif must carry information. A viewfinder bracket means *this unit was
 * captured and identified*. Putting one on a stock photograph is a lie told in
 * visual form, so `ViewfinderFrame` requires the serial it is vouching for.
 */
export interface ViewfinderFrameProps {
  /** The serial actually captured. Required — the brackets assert it exists. */
  serial: string;
  children: React.ReactNode;
  className?: string;
}

export function ViewfinderFrame({
  serial,
  children,
  className,
}: ViewfinderFrameProps): React.JSX.Element {
  return (
    <figure className={cn('relative', className)} data-testid="viewfinder">
      {children}
      <i className="vf tl" aria-hidden="true" />
      <i className="vf tr" aria-hidden="true" />
      <i className="vf bl" aria-hidden="true" />
      <i className="vf br" aria-hidden="true" />
      <figcaption className="mt-1 font-mono text-label tabular-nums text-ink-4">{serial}</figcaption>
    </figure>
  );
}

/** A live inspection feed. The sweep stops under `prefers-reduced-motion`. */
export function ScanBox({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('scanbox', className)} data-testid="scanbox">
      {children}
    </div>
  );
}

/**
 * A barcode strip encoding a seal code, shown beside the code itself.
 *
 * The bar pattern is derived from the code rather than random, so the same seal
 * always renders the same strip — a decorative barcode that changed on every
 * render would be the exact "motif carrying no information" the rules forbid.
 */
export function Barcode({ code, className }: { code: string; className?: string }): React.JSX.Element {
  const bars = React.useMemo(() => {
    const out: Array<{ wide: boolean; short: boolean; accent: boolean }> = [];
    for (let i = 0; i < 44; i++) {
      const c = code.charCodeAt(i % Math.max(1, code.length)) + i;
      out.push({ wide: c % 3 === 0, short: c % 5 === 0, accent: c % 11 === 0 });
    }
    return out;
  }, [code]);

  return (
    <div className={cn('barcode', className)} aria-hidden="true" data-testid="barcode">
      {bars.map((b, i) => (
        <i
          key={i}
          className={cn(b.wide && 'w', b.short && 's', b.accent && 'a')}
        />
      ))}
    </div>
  );
}

/** A live counter or feed header. The pulse stops under `prefers-reduced-motion`. */
export function LiveBlip({ className }: { className?: string }): React.JSX.Element {
  return <i className={cn('blip', className)} aria-hidden="true" data-testid="blip" />;
}

/**
 * Certificate verification.
 *
 * `value` is required and unused in the placeholder geometry on purpose: it is
 * what a real encoder will take, and requiring it now stops a decorative QR
 * being shipped next to something that cannot be verified.
 */
export function QrBlock({ value, className }: { value: string; className?: string }): React.JSX.Element {
  return (
    <span
      className={cn('qr', className)}
      role="img"
      aria-label={`QR code for ${value}`}
      data-value={value}
      data-testid="qr"
    />
  );
}

/** A dark panel ground. Dark surfaces only — it reads as noise on a light one. */
export function GridGround({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cn('grid-bg', className)}>{children}</div>;
}
