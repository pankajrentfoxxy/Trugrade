'use client';

import * as React from 'react';
import { Button, StatusPill } from '@trugrade/ui';
import type { VerificationOutcomeView } from './api';

/**
 * The three-outcome ladder every external check on this flow shares.
 *
 * Step 3 (GSTIN and PAN) built it first; step 6's penny-drop is the same
 * problem with a different provider, so the ladder lives here rather than in
 * either step. What is genuinely shared is the *policy*: which outcomes are the
 * applicant's problem, how long we wait before retrying one that is ours, and
 * the panel that says out loud that an outage cost them nothing. What is not
 * shared is the PASS and MISMATCH arms — a GST portal returns a legal name and a
 * bank returns an account holder, and the whole value of those two panels is
 * that they print the specific thing that came back. Each step renders its own.
 */

/**
 * Client-side backoff for a provider that did not answer, in seconds.
 *
 * Deliberately shorter than `PROVIDER_RETRY_SCHEDULE_SECONDS` in
 * `verification.service.ts`: that ladder is a server retrying out of band, this
 * one is a person sitting in front of a form. Copying the server's first step of
 * thirty seconds before the *first* retry, with a countdown on screen, is how a
 * form teaches people to hammer the button and burn their own attempts.
 */
export const RETRY_AFTER_SECONDS = [5, 15, 45] as const;

/**
 * Ours to fix, not theirs to correct.
 *
 * `willRetryAutomatically` is the server's own answer to "is this ours", so it
 * is what the branch reads; the two outcome strings are checked as well because
 * a `PROVIDER_ERROR` that arrived with the flag unset is still not a refusal.
 */
export const isProviderProblem = (view: VerificationOutcomeView): boolean =>
  view.willRetryAutomatically || view.outcome === 'PROVIDER_ERROR' || view.outcome === 'TIMEOUT';

export interface ProviderProblemProps {
  view: VerificationOutcomeView;
  /** "the GST portal", "the bank". Named, because a person can ring one of them. */
  provider: string;
  /** Seconds until the next automatic attempt. Undefined once they are spent. */
  retryIn?: number;
  retryAttempt?: number;
  /** Every automatic retry used and the provider is still silent. */
  exhausted: boolean;
  onRetryNow: () => void;
  /** Absent when carrying on without this check is not something we allow. */
  onDefer?: () => void;
  deferLabel?: string;
}

/**
 * A provider that did not answer.
 *
 * Never `--fail`, never "check your details", and it always says in as many
 * words that no attempt was spent — because the fear this screen creates is
 * "have I just burnt one of my five tries on their outage".
 */
export function ProviderProblem({
  view,
  provider,
  retryIn,
  retryAttempt,
  exhausted,
  onRetryNow,
  onDefer,
  deferLabel = 'Continue — let a reviewer verify it',
}: ProviderProblemProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded border border-warn bg-sheet-2 p-4">
      <StatusPill className="self-start" tone="warn" label={`${provider} did not answer`} />
      <p className="text-body-sm text-ink-2" role="status" aria-live="polite">
        {view.message}
      </p>
      <p className="text-body-sm text-ink-2">
        This has not used any of your checks. You still have{' '}
        <span className="tnum text-ink">{view.attemptsRemaining}</span> of{' '}
        <span className="tnum text-ink">5</span> today.
      </p>
      {exhausted ? (
        <>
          <p className="text-body-sm text-ink-2">
            We tried <span className="tnum text-ink">{RETRY_AFTER_SECONDS.length}</span> more times
            and it is still not answering. That is not something you can fix from here.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={onRetryNow}>
              Try once more
            </Button>
            {onDefer && (
              <Button type="button" variant="ghost" onClick={onDefer}>
                {deferLabel}
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body-sm text-ink-2">
            Retrying automatically in <span className="tnum text-ink">{retryIn ?? 0}</span>{' '}
            {retryIn === 1 ? 'second' : 'seconds'} — attempt{' '}
            <span className="tnum text-ink">{retryAttempt ?? 1}</span> of{' '}
            <span className="tnum text-ink">{RETRY_AFTER_SECONDS.length}</span>.
          </p>
          <Button type="button" variant="ghost" onClick={onRetryNow}>
            Retry now
          </Button>
        </div>
      )}
    </div>
  );
}

/** One pending automatic retry. */
export interface PendingRetry {
  attempt: number;
  secondsLeft: number;
}

export interface RetryLadder {
  /** Key → the countdown currently on screen for it. */
  pending: Record<string, PendingRetry>;
  /**
   * Feed every outcome through this. A provider problem schedules the next
   * automatic attempt; anything else clears whatever was scheduled.
   */
  note: (key: string, view: VerificationOutcomeView) => void;
  /** This key has spent its automatic retries and is still unreachable. */
  exhausted: (key: string, view: VerificationOutcomeView | null, checking: boolean) => boolean;
  /**
   * The value under this key changed: cancel any scheduled retry and forget how
   * many were spent. A new number gets its own three attempts.
   */
  clear: (key: string) => void;
}

/**
 * The countdown, and the retry it ends in.
 *
 * One effect with two arms rather than an interval that fires checks from inside
 * a state updater: a `setState` updater has to be pure, and calling a
 * verification from one is how a retry ends up running twice or not at all. Each
 * pass either dispatches the checks that have reached zero or schedules one more
 * second — and it counts down **on screen**, because an automatic retry the
 * applicant cannot see is indistinguishable from nothing happening, which is
 * what makes people re-submit and burn their own attempts.
 */
export function useRetryLadder(run: (key: string) => void): RetryLadder {
  const [pending, setPending] = React.useState<Record<string, PendingRetry>>({});
  /**
   * How many automatic retries each key has already had. A ref, not state: the
   * effect removes the key from `pending` at the moment it fires, so the count
   * cannot be read back out of it — and a counter that resets on every retry is
   * a retry loop that never ends.
   */
  const used = React.useRef<Record<string, number>>({});

  const runRef = React.useRef(run);
  runRef.current = run;

  React.useEffect(() => {
    const due = Object.entries(pending)
      .filter(([, row]) => row.secondsLeft <= 0)
      .map(([key]) => key);

    if (due.length > 0) {
      setPending((current) => {
        const next = { ...current };
        for (const key of due) delete next[key];
        return next;
      });
      // Re-added by `note` if the provider is still down, which is what advances
      // the attempt counter towards the "continue anyway" arm.
      for (const key of due) runRef.current(key);
      return undefined;
    }

    if (Object.keys(pending).length === 0) return undefined;
    const id = setTimeout(
      () =>
        setPending((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, row]) => [
              key,
              { ...row, secondsLeft: row.secondsLeft - 1 },
            ]),
          ),
        ),
      1000,
    );
    return () => clearTimeout(id);
  }, [pending]);

  const clear = React.useCallback((key: string): void => {
    used.current[key] = 0;
    setPending((current) => {
      const { [key]: _dropped, ...rest } = current;
      return rest;
    });
  }, []);

  const note = React.useCallback((key: string, view: VerificationOutcomeView): void => {
    const spent = used.current[key] ?? 0;
    const wait = isProviderProblem(view) ? RETRY_AFTER_SECONDS[spent] : undefined;
    // Out of retries: the panel switches to "continue anyway" rather than
    // looping forever against a provider that is plainly down.
    if (wait !== undefined) used.current[key] = spent + 1;
    setPending((current) => {
      const { [key]: _dropped, ...rest } = current;
      return wait === undefined ? rest : { ...rest, [key]: { attempt: spent + 1, secondsLeft: wait } };
    });
  }, []);

  const exhausted = React.useCallback(
    (key: string, view: VerificationOutcomeView | null, checking: boolean): boolean =>
      Boolean(view && isProviderProblem(view)) && !pending[key] && !checking,
    [pending],
  );

  return { pending, note, exhausted, clear };
}
