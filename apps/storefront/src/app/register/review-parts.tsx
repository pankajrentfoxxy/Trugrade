'use client';

import * as React from 'react';
import { Button, FormSection, StatusPill } from '@trugrade/ui';
import type { StepProgress } from './api';
import { labelFor } from './picklists';

/**
 * The parts of a review screen that are the same whichever flow reached it.
 *
 * A buyer's review and a vendor's review differ in what they list — five steps
 * against seven, addresses against facilities — and in nothing else. What is
 * shared is the grammar: a missing value renders as "Not provided" rather than
 * as a blank, a step block says whether it is finished and whether it has gaps,
 * a reviewer's `blocking_reason` is rendered **verbatim**, and the SLA is shown
 * as the server's due date with the hours counted off it.
 *
 * Written once here so those four properties cannot drift apart between the two
 * flows — the third of them especially. A reviewer wrote that sentence to be
 * read by this applicant, and the fastest way to lose it is a second copy of
 * this file that "tidies" it.
 */

/* ==========================================================================
 * Rows
 * ======================================================================== */

export interface Row {
  label: string;
  /** Empty or undefined renders as "Not provided", never as blank. */
  value?: string;
  required?: boolean;
  /** Rendered in IBM Plex Mono: a GSTIN, a PAN, a number, a code. */
  mono?: boolean;
}

export const str = (source: Record<string, unknown>, key: string): string =>
  typeof source[key] === 'string' ? (source[key] as string).trim() : '';

export const labelOrBlank = (
  options: readonly { value: string; label: string }[],
  value: string,
): string => (value ? labelFor(options, value) : '');

function Value({ row }: { row: Row }): React.JSX.Element {
  if (!row.value) {
    return (
      <dd className="text-body-sm text-ink-4">
        Not provided{row.required ? ' — this step still needs it' : ''}
      </dd>
    );
  }
  return (
    <dd className={row.mono ? 'font-mono text-data tnum text-ink' : 'text-body-sm text-ink'}>
      {row.value}
    </dd>
  );
}

export function Rows({ rows }: { rows: readonly Row[] }): React.JSX.Element {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
          <dt className="text-body-sm text-ink-3 sm:w-[18ch] sm:shrink-0">{row.label}</dt>
          <Value row={row} />
        </div>
      ))}
    </dl>
  );
}

/* ==========================================================================
 * One step's block
 * ======================================================================== */

const STEP_STATUS_LABEL: Record<string, string> = {
  COMPLETE: 'Complete',
  IN_PROGRESS: 'In progress',
  NOT_STARTED: 'Not started',
  NEEDS_FIX: 'Send this again',
  SUBMITTED: 'Submitted',
};

export interface StepBlockProps {
  step: StepProgress;
  /** True when a required row on this step is empty. */
  hasGap: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}

/**
 * One step, as it will reach the reviewer.
 *
 * The link back exists only while the step can actually be changed. A COMPLETE
 * step is locked server-side — `saveDraft` refuses it — so a link into one would
 * be a trip to a form that rejects every save.
 */
export function StepBlock({ step, hasGap, onEdit, children }: StepBlockProps): React.JSX.Element {
  const complete = step.status === 'COMPLETE' && !hasGap;
  const editable = step.status !== 'COMPLETE';
  return (
    <FormSection
      title={step.title}
      status={
        <span className="flex flex-wrap items-center gap-3">
          {/* Neutral for complete: green is reserved for a PASS verdict, and a
              finished form step is not one. Red stays for a step sent back,
              which is a refusal. */}
          <StatusPill
            tone={step.status === 'NEEDS_FIX' ? 'fail' : complete ? 'neutral' : 'warn'}
            label={
              hasGap && step.status === 'COMPLETE'
                ? 'Answers missing'
                : (STEP_STATUS_LABEL[step.status] ?? step.status)
            }
          />
          {!complete && <span className="tnum text-ink-3">{step.completionPct}% answered</span>}
        </span>
      }
    >
      {step.blockingReason && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-fail bg-sheet-2 p-4">
          <span className="font-mono text-label uppercase tracking-[0.13em] text-fail">
            What the reviewer asked for
          </span>
          {/* Verbatim. A reviewer's sentence is the only one that says what to
              change, and summarising it is how an applicant sends the same
              document back a second time. */}
          <blockquote className="text-body-sm text-ink">{step.blockingReason}</blockquote>
        </div>
      )}
      {children}
      {editable && (
        <div className="border-t border-rule-2 pt-3">
          <Button type="button" variant="ghost" onClick={onEdit}>
            Change {step.title.toLowerCase()}
          </Button>
        </div>
      )}
    </FormSection>
  );
}

/** A completed step whose answers the server no longer returns. Said plainly. */
export function unreadable(
  step: StepProgress,
  onEdit: (code: string) => void,
): React.JSX.Element {
  return (
    <StepBlock key={step.stepCode} step={step} hasGap={false} onEdit={() => onEdit(step.stepCode)}>
      <p className="text-body-sm text-ink-4">
        Completed{step.lastSavedAt ? ` on ${formatWhen(step.lastSavedAt)}` : ''}. These answers are
        held with your application and are not shown again here.
      </p>
    </StepBlock>
  );
}

/* ==========================================================================
 * After submission — the application-status screen
 * ======================================================================== */

/** Every status in which the application is with us rather than with them. */
export const WITH_US = ['KYC_SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'];

/** The org status, as a person would say it. Never the raw enum. */
const ORG_STATUS_LABEL: Record<string, string> = {
  KYC_SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Being reviewed',
  INFO_REQUESTED: 'Waiting on you',
  VERIFIED: 'Approved',
  REJECTED: 'Not approved',
};

export interface StatusCopy {
  title: string;
  body: string;
  tone: 'pass' | 'fail' | 'info';
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface ApplicationStatusProps {
  orgStatus: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  needsFix: readonly StepProgress[];
  onEdit: (code: string) => void;
  /** Per-status wording. Buyer and vendor say different things about approval. */
  copy: Record<string, StatusCopy>;
  /** Per-step state, so the applicant can see where every one of them stands. */
  steps: readonly StepProgress[];
  /** What to offer once the account is open. Nothing, until it is. */
  approved?: React.ReactNode;
}

const STATE_TONE: Record<string, 'neutral' | 'warn' | 'fail' | 'info'> = {
  COMPLETE: 'neutral',
  SUBMITTED: 'info',
  NEEDS_FIX: 'fail',
  IN_PROGRESS: 'warn',
  NOT_STARTED: 'warn',
};

/**
 * The application-status screen: where every step stands, and what a reviewer
 * said about the ones they sent back.
 */
export function ApplicationStatus({
  orgStatus,
  slaDueAt,
  slaBreached,
  needsFix,
  onEdit,
  copy,
  steps,
  approved,
}: ApplicationStatusProps): React.JSX.Element {
  /**
   * A step sent back is the applicant's turn, whatever `organization.status`
   * says.
   *
   * `requestFix` writes `onboarding_progress.status = NEEDS_FIX` and never
   * touches the org, so an application with a step sent back is still
   * KYC_SUBMITTED — and the headline would read "nothing more is needed from you
   * right now" directly above a panel asking for a document. Reported as an API
   * gap; the screen refuses to say it in the meantime.
   */
  const effective =
    needsFix.length > 0 && orgStatus !== 'REJECTED' && orgStatus !== 'VERIFIED'
      ? 'INFO_REQUESTED'
      : orgStatus;
  const outcome = copy[effective] ?? copy.KYC_SUBMITTED!;
  const hoursLeft =
    slaDueAt === null
      ? null
      : Math.round(((new Date(slaDueAt).getTime() - new Date().getTime()) / 3_600_000) * 10) / 10;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            tone={outcome.tone}
            label={ORG_STATUS_LABEL[effective] ?? effective.replace(/_/g, ' ')}
          />
        </div>
        <h2 className="text-h2 text-ink">{outcome.title}</h2>
        <p className="max-w-[62ch]">{outcome.body}</p>

        {/* The promise, as a measured value — which is one of the three things
            the accent is allowed to mean. */}
        <dl className="flex flex-col gap-3 border-t border-rule-2 pt-4 sm:flex-row sm:gap-8">
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Decision due by
            </dt>
            <dd className="font-mono text-data tnum text-ink">
              {slaDueAt ? formatWhen(slaDueAt) : <span className="text-ink-4">Not recorded</span>}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Time remaining
            </dt>
            <dd
              className={
                slaBreached
                  ? 'font-mono text-data tnum text-fail'
                  : 'font-mono text-data tnum text-acc-ink'
              }
            >
              {hoursLeft === null ? (
                <span className="text-ink-4">Not measured</span>
              ) : slaBreached ? (
                `${Math.abs(hoursLeft)} hours past due`
              ) : (
                `${hoursLeft} hours`
              )}
            </dd>
          </div>
        </dl>

        {slaBreached && (
          <p role="status" className="text-body-sm text-fail">
            We are past the time we promised you a decision. That is on us — your application has
            not been forgotten, and it is at the front of the queue.
          </p>
        )}
      </div>

      {/* Per-step state. The backlog asks for it by name: an applicant waiting
          on a decision should be able to see which step is holding it up. */}
      <div className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-5">
        <h3 className="text-h3 text-ink">Where each step stands</h3>
        <ul className="flex flex-col">
          {steps.map((step) => (
            <li
              key={step.stepCode}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-2 py-3 last:border-b-0"
            >
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="font-mono text-label tnum text-ink-3">
                  {String(step.stepOrder).padStart(2, '0')}
                </span>
                <span className="truncate text-body-sm text-ink">{step.title}</span>
              </span>
              <span className="flex items-center gap-3">
                {step.status !== 'COMPLETE' && (
                  <span className="font-mono text-label tnum text-ink-3">
                    {step.completionPct}% answered
                  </span>
                )}
                <StatusPill
                  tone={STATE_TONE[step.status] ?? 'neutral'}
                  label={STEP_STATUS_LABEL[step.status] ?? step.status}
                />
              </span>
              {/* A step sent back gets its own panel below, with the reviewer's
                  sentence and the way back into it. Repeating the sentence here
                  would print it twice; a reason on a step that is NOT sent back
                  has no panel, so this is where it is read. */}
              {step.blockingReason && step.status !== 'NEEDS_FIX' && (
                <blockquote className="w-full text-body-sm text-ink-2">
                  {step.blockingReason}
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      </div>

      {needsFix.map((step, index) => (
        <div
          key={step.stepCode}
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-fail bg-sheet p-5"
        >
          <span className="font-mono text-label uppercase tracking-[0.13em] text-fail">
            {step.title} — sent back
          </span>
          {/* Verbatim, and it is the whole point of this panel. */}
          <blockquote className="text-body text-ink">
            {step.blockingReason ?? 'No reason was recorded. Please contact us before resending.'}
          </blockquote>
          <div>
            {/* One primary action per screen: the first step sent back is the
                one to open, the rest wait their turn. */}
            <Button
              type="button"
              variant={index === 0 ? 'primary' : 'secondary'}
              onClick={() => onEdit(step.stepCode)}
            >
              Open {step.title}
            </Button>
          </div>
        </div>
      ))}

      {needsFix.length === 0 && orgStatus === 'VERIFIED' && approved}
    </div>
  );
}
