import * as React from 'react';
import { Button, cn } from '@trugrade/ui';
import type { ResumableOnboarding } from '@trugrade/contracts';
import { apiFetch } from '../../../lib/auth';
import { useOnboardingReload } from '../../../lib/vendorOnboarding';

/**
 * Where a finished profile becomes an application.
 *
 * Nothing in the console used to call `POST /api/onboarding/submit`, so a
 * supplier could complete every section and the org stayed REGISTERED for ever
 * — never reviewed, never VERIFIED, with Listings, Orders and Payables padlocked
 * behind a gate that was correct and a button that did not exist.
 *
 * Submittable is the SERVER's answer (`progress.isSubmittable`), not the
 * console's section arithmetic: the two disagree about which steps are required,
 * and a button the server then refuses with 409 is worse than none.
 *
 * `POST /onboarding/submit` is OWNER/ADMIN only, deliberately — submitting KYC is
 * a legal declaration. Other seats are told who can do it; the guard is not
 * widened and the button that would 403 is not drawn.
 */

const CAN_SUBMIT = new Set(['VENDOR_OWNER', 'VENDOR_ADMIN']);
const IN_REVIEW = new Set(['PROFILE_SUBMITTED', 'KYC_SUBMITTED', 'UNDER_REVIEW']);

export type SubmitStage = 'hidden' | 'outstanding' | 'in-review' | 'ask-owner' | 'ready';

/** What this seat should be offered for this application, if anything. */
export function submitStage(
  onboarding: ResumableOnboarding,
  roles: readonly string[],
): SubmitStage {
  const { status } = onboarding;
  if (IN_REVIEW.has(status)) return 'in-review';
  if (status === 'VERIFIED' || status === 'REJECTED') return 'hidden';
  // Not submittable is a sentence, never silence. Rendering nothing here left a
  // supplier at "100% complete" with no button and no idea that the server still
  // counted two steps open — the application simply never arrived for review.
  if (!onboarding.progress.isSubmittable) return 'outstanding';
  return roles.some((r) => CAN_SUBMIT.has(r)) ? 'ready' : 'ask-owner';
}

/** The server's own list of what is still open, by the titles it gave them. */
export function outstandingSteps(onboarding: ResumableOnboarding): string[] {
  return onboarding.progress.steps
    .filter((s) => s.isRequired && s.status !== 'COMPLETE')
    .map((s) => s.title);
}

/** A review deadline, in the supplier's own time zone. */
export const formatReviewDue = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

async function postSubmit(): Promise<
  { ok: true; slaDueAt: string } | { ok: false; message: string }
> {
  try {
    const res = await apiFetch('/api/onboarding/submit', { method: 'POST' });
    const body = (await res.json().catch(() => null)) as {
      slaDueAt?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && body?.slaDueAt) return { ok: true, slaDueAt: body.slaDueAt };
    return {
      ok: false,
      message:
        body?.error?.message ??
        `We could not submit your profile (${res.status}). Nothing was sent — try again.`,
    };
  } catch {
    return {
      ok: false,
      message:
        'We could not reach the server. Nothing was sent — check your connection and try again.',
    };
  }
}

export function SubmitForReview({
  onboarding,
  roles,
  className,
}: {
  onboarding: ResumableOnboarding;
  roles: readonly string[];
  className?: string;
}): React.JSX.Element | null {
  const { reload } = useOnboardingReload();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submittedDue, setSubmittedDue] = React.useState<string | null>(null);

  const stage = submittedDue ? 'in-review' : submitStage(onboarding, roles);
  const due = submittedDue ?? onboarding.slaDueAt;
  const resubmit = onboarding.status === 'INFO_REQUESTED';

  if (stage === 'hidden') return null;

  if (stage === 'outstanding') {
    const open = outstandingSteps(onboarding);
    return (
      <p className={cn('text-body-sm text-ink-2', className)} data-testid="submit-outstanding">
        Not ready to submit yet.{' '}
        {open.length > 0 ? (
          <>
            Still needed: <span className="text-ink">{open.join(', ')}</span>.
          </>
        ) : (
          'The server still counts a required step as unfinished.'
        )}
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
        Every required section is done. Ask your account owner to submit for review.
      </p>
    );
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await postSubmit();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSubmittedDue(result.slaDueAt);
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
