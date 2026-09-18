'use client';

import * as React from 'react';
import type { SearchResult } from '../lib/api';
import { storageShortLabel } from './search/storage-label';

/**
 * Real machines, one at a time, with their measurements animating in.
 *
 * THE DATA IS THE POINT
 * ---------------------
 * Every figure here is the same `SearchResult` the grid below renders — same
 * endpoint, same numbers. Nothing is illustrative. A showcase carousel is
 * exactly where a storefront is tempted to put a beautiful invented spec sheet,
 * and a spec sheet that does not describe a machine you can actually buy is the
 * most expensive kind of lie a marketplace can tell.
 *
 * That constraint shapes the display. A value we did not measure renders as
 * "Not measured" in `--ink-4`, never as a blank and never as a zero. Battery
 * carries its denominator — `82–89% · 6 of 8 measured` — because a range
 * measured on six of eight units is a different claim from one measured on all
 * eight. The grade chip is neutral: A+, A and B are all sellable, and colouring
 * them turns a position on a scale into a verdict.
 *
 * MOTION
 * ------
 * Rows stagger in on each change, and the panel advances on a timer. The timer
 * stops while the pointer is over the panel, while focus is inside it, and while
 * the tab is hidden, and it never starts under `prefers-reduced-motion` — in
 * which case the panel is a plain, static, fully usable spec sheet with working
 * manual controls. Same reasoning as the brand rail: the timer yields to the
 * reader, not the other way round.
 */

const ADVANCE_MS = 5000;

/** How many machines the panel will cycle. Beyond this the dots stop being countable. */
const MAX = 5;

function money(paise: number): string {
  return `₹${Math.round(paise).toLocaleString('en-IN')}`;
}

/** A measurement we do not have. Never a blank, never a zero. */
function Missing(): React.JSX.Element {
  return <span className="sspec-missing">Not measured</span>;
}

export function SpecShowcase({
  items,
}: {
  items: readonly SearchResult[];
}): React.JSX.Element | null {
  const list = React.useMemo(() => {
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const r of items) {
      const key = `${r.brand} ${r.model}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length === MAX) break;
    }
    return out;
  }, [items]);
  const [index, setIndex] = React.useState(0);
  const [held, setHeld] = React.useState(false);

  React.useEffect(() => {
    if (held || list.length < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => (i + 1) % list.length);
    }, ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [held, list.length]);

  if (list.length === 0) return null;
  const r = list[index]!;

  const battery =
    r.batteryMin !== null && r.batteryMax !== null && r.batteryMeasured > 0 ? (
      <>
        <span className="mono">
          {r.batteryMin}&ndash;{r.batteryMax}%
        </span>{' '}
        <span className="sspec-den">
          · <span className="mono">{r.batteryMeasured}</span> of{' '}
          <span className="mono">{r.unitsAvailable}</span> measured
        </span>
      </>
    ) : (
      <Missing />
    );

  const rows: ReadonlyArray<{ k: string; label: string; value: React.ReactNode }> = [
    { k: 'cpu', label: 'Processor', value: r.cpuLine || <Missing /> },
    {
      k: 'ram',
      label: 'Memory',
      value: r.ramGb > 0 ? <span className="mono">{r.ramGb} GB</span> : <Missing />,
    },
    {
      k: 'ssd',
      label: 'Storage',
      value:
        r.storageGb > 0 ? (
          <>
            <span className="mono">{r.storageGb} GB</span> {storageShortLabel(r.storageType) ?? ''}
          </>
        ) : (
          <Missing />
        ),
    },
    { k: 'disp', label: 'Display', value: r.displayLine || <Missing /> },
    { k: 'batt', label: 'Battery health', value: battery },
    {
      k: 'qc',
      label: 'Inspection score',
      value:
        r.avgQcScore !== null ? (
          <span className="mono">
            {Math.round(r.avgQcScore)}
            <span className="sspec-den">/100</span>
          </span>
        ) : (
          <Missing />
        ),
    },
  ];

  return (
    <section
      className="showcase"
      aria-labelledby="showcase-title"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div className="wrap">
        <div className="showcase-head">
          <h2 id="showcase-title">What we measured</h2>
          <p>
            Live from the catalogue below &mdash; the same numbers, on the same machines you can buy
            right now.
          </p>
        </div>

        {/*
          `key` restarts the stagger on every change. `aria-live="polite"`
          announces the new machine instead of silently swapping the numbers
          under a screen-reader user mid-read.
        */}
        <div className="showcase-panel" key={r.skuId + r.grade} aria-live="polite">
          <div className="showcase-id">
            <span className="showcase-grade">Grade {r.grade}</span>
            <h3>
              {r.brand} {r.model}
            </h3>
            <p className="showcase-spec">{r.spec}</p>
            <p className="showcase-price mono">
              {money(r.fromPrice)} <span className="sspec-den">from · incl. GST</span>
            </p>
          </div>

          <dl className="sspec">
            {rows.map((row, i) => (
              <div key={row.k} className="sspec-row" style={{ '--i': i } as React.CSSProperties}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {list.length > 1 && (
          <div className="showcase-dots" role="tablist" aria-label="Choose a machine">
            {list.map((item, i) => (
              <button
                key={item.skuId + item.grade}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${item.brand} ${item.model}`}
                className={i === index ? 'showcase-dot on' : 'showcase-dot'}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
