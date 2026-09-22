'use client';

import * as React from 'react';
import { Button, cn } from '@trugrade/ui';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { submitForReview } from '../../register/api';
import { usePortal } from '../shell/PortalContext';
import { GATING_SECTIONS, PROFILE_SECTIONS, type ProfileSectionDef } from './sections.config';

/**
 * Where a finished profile becomes an application.
 *
 * Submittable is the SERVER's answer (`progress.isSubmittable`), not this
 * screen's card arithmetic: the two could disagree about which steps are
 * required, and a button the server then refuses with 409 is worse than none.
 *
 * Submitting KYC is a legal declaration, so the route is owner and admin only.
 * Other seats are told who can do it rather than shown a button that 403s.
 */

const CAN_SUBMIT = new Set(['CUSTOMER_OWNER', 'CUSTOMER_ADMIN']);
const IN_REVIEW = new Set(['PROFILE_SUBMITTED', 'KYC_SUBMITTED', 'UNDER_REVIEW']);

export type SubmitStage = 'hidden' | 'waiting-on' | 'in-review' | 'ask-owner' | 'ready';

export function submitStage(
  onboarding: ResumableOnboarding,
  roles: readonly string[],
): SubmitStage {
  const { status } = onboarding;
  if (IN_REVIEW.has(status)) return 'in-review';
  if (status === 'VERIFIED' || status === 'REJECTED') return 'hidden';
  if (!onboarding.progress.isSubmittable) {
    // The server still wants a step. Say so only once every weighted card is
    // done: that is the moment the banner reads 100% and the buyer looks for
    // a button that is not there. Before that, the cards themselves say what
    // is left.
    return outstandingSection(onboarding) &&
      GATING_SECTIONS.every((s) => allStepsDone(s, onboarding))
      ? 'waiting-on'
      : 'hidden';
  }
  return roles.some((r) => CAN_SUBMIT.has(r)) ? 'ready' : 'ask-owner';
}

const allStepsDone = (section: ProfileSectionDef, onboarding: ResumableOnboarding): boolean =>
  section.stepCodes.every(
    (code) => onboarding.progress.steps.find((s) => s.stepCode === code)?.status === 'COMPLETE',
  );

/**
 * The card the server is waiting on, from its own `resumeAt` — the first
 * required step that is not complete. Preferences carries no weight in the
 * completion figure, so a profile can read 100% while the server still
 * requires the DOCUMENTS step behind it; this names the card rather than
 * leaving a full bar and no button.
 */
export function outstandingSection(onboarding: ResumableOnboarding): ProfileSectionDef | null {
  const code = onboarding.progress.resumeAt;
  if (!code) return null;
  return PROFILE_SECTIONS.find((s) => s.stepCodes.includes(code)) ?? null;
}

/** A review deadline, in the buyer's own time zone. */
export const formatReviewDue = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function SubmitForReview({ className }: { className?: string }): React.JSX.Element | null {
  const { session, onboarding, reload } = usePortal();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submittedDue, setSubmittedDue] = React.useState<string | null>(null);

  if (!onboarding) return null;

  const stage = submittedDue ? 'in-review' : submitStage(onboarding, session.roles);
  const due = submittedDue ?? onboarding.slaDueAt;
  const resubmit = onboarding.status === 'INFO_REQUESTED';

  if (stage === 'hidden') return null;

  if (stage === 'waiting-on') {
    const card = outstandingSection(onboarding);
    return (
      <p className={cn('text-body-sm text-ink-2', className)} data-testid="submit-waiting-on">
        One card to go before you can submit for review:{' '}
        <span className="text-ink">{card?.title}</span>. Save it and the button appears here.
      </p>
    );
  }

  if (stage === 'in-review') {
    return (
      <p className={cn('text-body-sm text-ink-2', className)} data-testid="submit-in-review">
        Submitted for review.{' '}
        {due ? (
          <>
            We will decide by{' '}
            <span className="font-mono tnum text-ink">{formatReviewDue(due)}</span>.
          </>
        ) : (
          'We will email you when it is decided.'
        )}
      </p>
    );
  }

  if (stage === 'ask-owner') {
    return (
      <p className={cn('text-body-sm text-ink-2', className)}>
        Every section is done. Ask your account owner to submit the profile for review.
      </p>
    );
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await submitForReview();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSubmittedDue(result.data.slaDueAt);
    reload();
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {resubmit && onboarding.decision?.notes ? (
        <p className="text-body-sm text-ink-2">
          The reviewer asked for changes:{' '}
          <span className="text-ink">{onboarding.decision.notes}</span>
        </p>
      ) : null}
      <div>
        <Button variant="primary" loading={busy} onClick={() => void submit()}>
          {resubmit ? 'Resubmit for review' : 'Submit for review'}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
