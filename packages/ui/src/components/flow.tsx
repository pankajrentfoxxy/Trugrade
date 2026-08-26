'use client';

// Interactive: this module uses React state, refs or context, none of which
// exist in a server component. The storefront is a Next App Router app, so
// without this directive importing anything from the package barrel drags a
// client-only API into an RSC render and fails at request time rather than at
// build time.
import * as React from 'react';
import { cn } from '../lib/cn';
import { Stepper, type Step } from './navigation';
import { TickRule } from './measure';

/**
 * Archetype D — **Flow**: step rail + one step + a "why we ask" rail.
 *
 * Three components, and the middle one is the whole archetype: a flow shows
 * exactly one step at a time, with the rail on the left saying where you are
 * and the rail on the right saying why the question is being asked at all.
 *
 * Vendor registration is seven steps and asks for a GSTIN, a PAN, a CIN, a
 * cancelled cheque and a board resolution. A form that asks for those with no
 * explanation is abandoned, and the explanation belongs beside the field rather
 * than in a help centre nobody opens (03_UX_SPEC.md §2.1).
 */

/* ==========================================================================
 * StepRail
 * ======================================================================== */

export interface StepRailProps {
  steps: readonly Step[];
  /** Names the rail. Two flows on one screen would otherwise be identical. */
  label: string;
  /**
   * When the draft was last written to `kyc.onboarding_progress.draft_json`,
   * already formatted for a human: "2 minutes ago", "Yesterday 18:04".
   *
   * Omitted means **nothing has been saved yet**, and the rail says so. A
   * save-and-resume flow that shows no save state is one a vendor does not dare
   * close the tab on, which is how a seven-step application becomes a one-step
   * one.
   */
  savedAt?: string;
  /** Shown with the save state so the applicant knows the draft is reachable. */
  resumeHref?: string;
  className?: string;
}

/**
 * The left rail of a flow: numbered steps, current / done / locked, and the
 * save-and-resume state underneath.
 *
 * It composes `Stepper` rather than restating it — the markup rules there (a
 * future step is never a disabled `<button>`; the position is announced in
 * words, not geometry) are the same rules here, and having them in two places
 * is how one of the two drifts.
 *
 * Sticky, because on step 6 of 7 the rail is the only thing that says how much
 * is left and it must not have scrolled away.
 */
export function StepRail({
  steps,
  label,
  savedAt,
  resumeHref,
  className,
}: StepRailProps): React.JSX.Element {
  const done = steps.filter((s) => s.status === 'complete').length;

  return (
    <aside
      className={cn(
        'tg-card sticky top-5 flex max-h-[calc(100vh-40px)] flex-col gap-5 overflow-y-auto',
        'rounded-lg border border-rule bg-sheet',
        className,
      )}
      data-testid="step-rail"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 text-ink">{label}</h2>
        <p className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
          <span className="tnum">{done}</span> of <span className="tnum">{steps.length}</span> done
        </p>
        <TickRule />
      </div>

      <Stepper steps={steps} label={label} />

      <p className="border-t border-rule-2 pt-4 text-body-sm text-ink-2">
        {savedAt ? (
          <>
            Saved {savedAt}. Close this and come back — nothing is lost.
            {resumeHref ? (
              <>
                {' '}
                <a href={resumeHref} className="text-acc-ink underline underline-offset-4">
                  Resume link
                </a>
              </>
            ) : null}
          </>
        ) : (
          // Not "Saved just now", and not a blank line. Nothing has been written
          // yet, and saying otherwise is the failure this rail exists to prevent.
          <span className="text-ink-4">Nothing saved yet. Finish a step to save a draft.</span>
        )}
      </p>
    </aside>
  );
}

/* ==========================================================================
 * FormSection
 * ======================================================================== */

export interface FormSectionProps {
  title: string;
  /** One sentence on what this group of fields is for. Optional, usually absent. */
  description?: React.ReactNode;
  /**
   * A progress note for the group, e.g. "3 of 4 complete". Mono, because it is
   * a number. Omitted renders nothing rather than a zero.
   */
  status?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * A titled group of fields, with the tick rule under the heading.
 *
 * `<fieldset>` + `<legend>`, not `<section>` + `<h3>`: a screen reader
 * announces the legend again on every field inside the group, which is exactly
 * what "Registered address" has to do when there are three addresses on one
 * page. The heading styling is applied to the legend so it still reads as a
 * heading visually.
 */
export function FormSection({
  title,
  description,
  status,
  children,
  className,
}: FormSectionProps): React.JSX.Element {
  return (
    <fieldset className={cn('flex flex-col gap-5', className)} data-testid="form-section">
      <legend className="w-full">
        <span className="flex flex-wrap items-baseline gap-3">
          <span className="text-h3 text-ink">{title}</span>
          {status ? (
            <span className="font-mono text-label uppercase tracking-[0.13em] tnum text-ink-3">
              {status}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-1 block text-body-sm text-ink-2">{description}</span>
        ) : null}
        <TickRule />
      </legend>
      {children}
    </fieldset>
  );
}

/* ==========================================================================
 * WhyRail
 * ======================================================================== */

export interface WhyRailItem {
  /** The field this explains, worded exactly as its label is. */
  term: string;
  /** Why we ask, in plain words — what it does for them, not the legal basis. */
  explanation: React.ReactNode;
}

export interface WhyRailProps {
  items: readonly WhyRailItem[];
  title?: string;
  /** The term whose field currently has focus. Marks that entry as active. */
  activeTerm?: string;
  className?: string;
}

/**
 * The right rail of a flow: what each field is for, in the applicant's words.
 *
 * A `<dl>` rather than a list of cards, because that is what this is — terms
 * and their definitions — and the pairing is what lets a screen reader read
 * "Primary GSTIN" followed by its explanation instead of two unrelated runs of
 * text.
 *
 * `activeTerm` moves an amber marker, which is the third legitimate use of the
 * accent: an active state. It is a 2px marker and never a background wash, and
 * the active entry also changes ink weight so colour is not the only channel.
 */
export function WhyRail({
  items,
  title = 'Why we ask',
  activeTerm,
  className,
}: WhyRailProps): React.JSX.Element {
  const headingId = React.useId();

  return (
    <aside
      aria-labelledby={headingId}
      className={cn(
        'tg-card sticky top-5 flex flex-col gap-4 rounded-lg border border-rule bg-sheet-2',
        className,
      )}
      data-testid="why-rail"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-h3 text-ink">
          {title}
        </h2>
        <TickRule />
      </div>

      <dl className="flex flex-col gap-4">
        {items.map((item) => {
          const active = item.term === activeTerm;
          return (
            <div
              key={item.term}
              className={cn('border-l-2 pl-4', active ? 'border-acc' : 'border-rule')}
            >
              <dt
                className={cn(
                  'text-body-sm font-medium',
                  active ? 'text-ink' : 'text-ink-2',
                )}
              >
                {item.term}
              </dt>
              <dd className="mt-1 text-body-sm text-ink-2">{item.explanation}</dd>
            </div>
          );
        })}
      </dl>
    </aside>
  );
}
