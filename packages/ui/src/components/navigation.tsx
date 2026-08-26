'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';

/* ==========================================================================
 * Breadcrumb
 * ======================================================================== */

export interface Crumb {
  label: string;
  /** Omit on the last crumb. The page you are on is not a link to itself. */
  href?: string;
}

/**
 * `nav > ol`, with the current page as plain text carrying `aria-current`.
 *
 * The separator is `aria-hidden`: a screen reader announcing "slash" between
 * every level is the noise that makes people turn breadcrumbs off.
 */
export function Breadcrumb({
  items,
  label = 'Breadcrumb',
  className,
}: {
  items: readonly Crumb[];
  label?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-2 text-body-sm text-ink-2">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-2">
              {item.href && !last ? (
                <a href={item.href} className="underline underline-offset-4 hover:text-ink">
                  {item.label}
                </a>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-ink')}>
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-ink-3">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ==========================================================================
 * Tabs
 * ======================================================================== */

export interface TabItem {
  key: string;
  label: React.ReactNode;
  panel: React.ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onChange: (key: string) => void;
  /** Names the tab list. Two tab groups on one page are otherwise identical. */
  label: string;
  className?: string;
}

const ARROW: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

/**
 * The APG tab pattern: one tab stop for the whole list, arrows move within it.
 *
 * Automatic activation — the arrow key both moves focus and selects — because
 * every panel here is already-loaded local content. Manual activation exists for
 * panels that cost a fetch, and none of ours do.
 *
 * A tab is **not** the right component for a step of a wizard: each of those is
 * a real route with its own URL and back-button behaviour, which is `Stepper`.
 */
export function Tabs({ items, value, onChange, label, className }: TabsProps): React.JSX.Element {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    items.findIndex((item) => item.key === value),
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta = ARROW[event.key];
    const target =
      delta !== undefined
        ? (index + delta + items.length) % items.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : null;
    if (target === null) return;
    event.preventDefault();
    const next = items[target];
    if (!next) return;
    onChange(next.key);
    tabRefs.current[target]?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-rule">
        {items.map((item, i) => {
          const selected = i === index;
          return (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[i] = node;
              }}
              type="button"
              role="tab"
              id={`tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`panel-${item.key}`}
              // Roving tabindex: the group is one tab stop (§1.9.3).
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.key)}
              onKeyDown={onKeyDown}
              className={cn(
                'min-h-11 rounded-t px-5 text-body-sm transition-colors',
                // The selected tab carries a 2px rule as well as its ink weight;
                // colour is never the only channel.
                selected
                  ? '-mb-px border-b-2 border-acc-dk font-medium text-ink'
                  : 'text-ink-2 hover:bg-sheet-2 hover:text-ink',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item, i) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`panel-${item.key}`}
          aria-labelledby={`tab-${item.key}`}
          hidden={i !== index}
          // A panel with no focusable content of its own is unreachable by
          // keyboard unless the panel itself takes focus.
          tabIndex={0}
          className="pt-5"
        >
          {item.panel}
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
 * Stepper
 * ======================================================================== */

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'blocked';

export interface Step {
  key: string;
  label: string;
  status: StepStatus;
  /** Completed steps are links back. An upcoming step has nowhere to go yet. */
  href?: string;
  /**
   * What a completed step established — two or three facts, PII masked
   * (`+91 98••• ••210`). 03_UX_SPEC.md §2.2.
   */
  summary?: React.ReactNode;
  /** Why a blocked step is blocked. Rendered once, as an alert. */
  blockers?: readonly string[];
}

const STATUS_PREFIX: Record<StepStatus, string> = {
  complete: 'completed',
  current: 'current',
  upcoming: 'not started',
  blocked: 'blocked',
};

/**
 * Registration, the listing wizard, checkout.
 *
 * `nav > ol`, **not** `role="tablist"` (§1.9.4): every step is a real route with
 * its own URL, its own server state and its own back-button behaviour, and
 * calling it a tab throws all three away.
 *
 * Two deliberate markup choices, both from the spec:
 *   - a future step is a `<span aria-disabled="true">`, never a disabled
 *     `<button>` — a disabled button drops out of the accessibility tree in some
 *     screen-reader/browser pairs, so the step silently stops existing
 *   - the position is announced in words inside each item ("Step 2 of 5,
 *     current:"), because a visual rail communicates position by geometry and
 *     geometry does not survive a screen reader
 */
export function Stepper({
  steps,
  label,
  orientation = 'vertical',
  className,
}: {
  steps: readonly Step[];
  label: string;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}): React.JSX.Element {
  const currentIndex = steps.findIndex((s) => s.status === 'current');
  const current = currentIndex >= 0 ? steps[currentIndex] : undefined;

  return (
    <nav aria-label={label} className={className}>
      <ol className={cn('flex gap-4', orientation === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        {steps.map((step, i) => {
          const position = `Step ${i + 1} of ${steps.length}, ${STATUS_PREFIX[step.status]}:`;
          const blockerId = step.blockers?.length ? `step-${step.key}-blockers` : undefined;

          const body = (
            <>
              <span className="sr-only">{position}</span>
              <span aria-hidden="true" className="font-mono text-label tnum text-ink-3">
                {String(i + 1).padStart(2, '0')}
              </span>{' '}
              {step.label}
              {step.status === 'complete' && (
                <span aria-hidden="true" className="text-pass">
                  {' '}
                  ✓
                </span>
              )}
            </>
          );

          return (
            <li key={step.key} className="flex flex-col gap-1">
              {step.status === 'complete' && step.href ? (
                <a
                  href={step.href}
                  className="text-body-sm text-ink underline underline-offset-4"
                  aria-describedby={blockerId}
                >
                  {body}
                </a>
              ) : step.status === 'current' ? (
                <span
                  aria-current="step"
                  aria-describedby={blockerId}
                  className="text-body-sm font-medium text-ink"
                >
                  {body}
                </span>
              ) : (
                <span
                  aria-disabled="true"
                  aria-describedby={blockerId}
                  className="text-body-sm text-ink-3"
                >
                  {body}
                </span>
              )}

              {step.summary && (
                <span className="text-body-sm text-ink-2">{step.summary}</span>
              )}

              {step.blockers?.length ? (
                <p id={blockerId} role="alert" className="text-body-sm text-fail">
                  {step.blockers.join(' ')}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Advancing a step announces politely. Focus moving to the new step's
          heading is the route's job — this component does not own the page. */}
      <p role="status" aria-live="polite" className="sr-only">
        {current ? `Step ${currentIndex + 1} of ${steps.length}. ${current.label}.` : ''}
      </p>
    </nav>
  );
}
