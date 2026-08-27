'use client';

import * as React from 'react';
import {
  Button,
  EmptyState,
  Skeleton,
  StatusPill,
  StepRail,
  WhyRail,
  type Step,
  type WhyRailItem,
} from '@trugrade/ui';
import {
  completeStep,
  getOnboarding,
  getSession,
  register,
  saveStep,
  startOnboarding,
  submitForReview,
  type ResumableOnboarding,
  type StepDefinition,
  type StepProgress,
} from './api';
import { Review } from './Review';
import { StepAccount, type AccountValues } from './StepAccount';
import { StepCompany } from './StepCompany';
import { StepContacts, WHY_CONTACTS } from './StepContacts';
import { StepDocuments, WHY_DOCUMENTS } from './StepDocuments';
import { StepStatutory, WHY_STATUTORY } from './StepStatutory';

/**
 * Customer registration — **archetype D, flow**: the step rail on the left, one
 * step in the middle, and the "why we ask" rail on the right.
 *
 * Two things about the shell are load-bearing.
 *
 * **The rail is the API's step list, never a constant here.** It is server-
 * rendered from `GET /onboarding/steps/definitions` before an account exists,
 * and swapped for `GET /onboarding/steps` — the same rows plus this org's
 * status and drafts — the moment one does. A step list in the client is a list
 * that goes stale against the seeded definitions, and the whole point of the
 * generic stepper is that adding a step is a data change.
 *
 * **The resume point comes from the server too.** `progress.resumeAt` is the
 * first required step that is not COMPLETE, including one a reviewer sent back,
 * and it is where a returning applicant lands with their answers already in the
 * fields.
 *
 * **The review screen is not a sixth step.** `?step=REVIEW` is a place in this
 * client, not a row in `onboarding_step_definition`, and the rail is still the
 * five the API defines. Once the application is with a reviewer, every status
 * from KYC_SUBMITTED onwards lands here regardless of `?step`, because there is
 * nothing left to fill in.
 */

/** Not a step code. The client's own place, after the last real step. */
const REVIEW = 'REVIEW';

/** Statuses in which the application is with us and the form is behind us. */
const AFTER_SUBMISSION = [
  'KYC_SUBMITTED',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'VERIFIED',
  'REJECTED',
];

type Phase = 'checking' | 'ready' | 'unreachable' | 'wrong-account';

/** ISO → "27 Aug 2026, 05:31". Absolute, because "2 minutes ago" needs a clock. */
function formatSaved(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function railStatus(step: StepProgress, currentCode: string): Step['status'] {
  if (step.stepCode === currentCode) return 'current';
  if (step.status === 'COMPLETE') return 'complete';
  if (step.status === 'NEEDS_FIX') return 'blocked';
  return 'upcoming';
}

/** Definitions and progress differ only in what progress adds. */
const asProgress = (d: StepDefinition): StepProgress => ({
  ...d,
  isRequired: true,
  status: 'NOT_STARTED',
  completionPct: 0,
  blockingReason: null,
  lastSavedAt: null,
  fields: [],
});

export interface RegisterFlowProps {
  /** Server-rendered so the rail is drawn on first paint, not after a fetch. */
  definitions: StepDefinition[] | null;
}

export function RegisterFlow({ definitions }: RegisterFlowProps): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>(definitions ? 'checking' : 'unreachable');
  const [steps, setSteps] = React.useState<StepProgress[]>(() =>
    (definitions ?? []).map(asProgress),
  );
  const [currentCode, setCurrentCode] = React.useState<string>(
    () => definitions?.[0]?.stepCode ?? 'ACCOUNT',
  );
  const [answers, setAnswers] = React.useState<Record<string, Record<string, unknown>>>({});
  const [registered, setRegistered] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [saveFailure, setSaveFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeTerm, setActiveTerm] = React.useState<string | undefined>();
  /** Carries step 1's company name into step 2 before any draft exists. */
  const [typedCompanyName, setTypedCompanyName] = React.useState('');
  /**
   * `constitution_type`, taken from the org rather than from a draft. Step 2's
   * answers are cleared the moment it completes, so by step 3 this is the only
   * place the constitution still exists — and step 3 needs it to be able to say
   * "this PAN belongs to an individual, but you told us private limited".
   */
  const [constitution, setConstitution] = React.useState<string | null>(null);
  /** The org's own status, which decides whether there is still a form to fill. */
  const [orgStatus, setOrgStatus] = React.useState('REGISTERED');
  const [slaDueAt, setSlaDueAt] = React.useState<string | null>(null);
  const [slaBreached, setSlaBreached] = React.useState(false);
  const [isSubmittable, setIsSubmittable] = React.useState(false);

  // The rail collapses below the width at which it stops being a rail — the
  // same 1024px where the grid drops to one column. A `<details>` cannot be
  // open at one width and closed at another in CSS alone, and rendering it
  // twice under two media queries would duplicate its landmark and its ids.
  const [wide, setWide] = React.useState(true);
  React.useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = (): void => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const applyOnboarding = React.useCallback(
    (data: ResumableOnboarding, landOn?: string): void => {
      const loaded = data.progress;
      setSteps(loaded.steps);
      // **Merged, not replaced.** `completeStep` clears a step's draft, so the
      // server stops returning the answers to a step the moment it is finished.
      // Dropping them here would empty the review screen one step at a time.
      setAnswers((held) => ({ ...held, ...data.answers }));
      setConstitution(loaded.constitution ?? null);
      setOrgStatus(data.status);
      setSlaDueAt(data.slaDueAt);
      setSlaBreached(data.slaBreached);
      setIsSubmittable(loaded.isSubmittable);
      const wanted = landOn ?? loaded.resumeAt ?? loaded.steps[0]?.stepCode;
      if (wanted) setCurrentCode(wanted);
      // ISO strings sort chronologically, so the newest save is the last one.
      const saves = loaded.steps.map((s) => s.lastSavedAt).filter((v): v is string => Boolean(v));
      setSavedAt([...saves].sort().pop() ?? null);
    },
    [],
  );

  const reload = React.useCallback(
    async (landOn?: string): Promise<void> => {
      const onboarding = await getOnboarding();
      if (!onboarding.ok) {
        setSaveFailure(onboarding.message);
        return;
      }
      applyOnboarding(onboarding.data, landOn);
    },
    [applyOnboarding],
  );

  /* Mount: is this a returning applicant? */
  React.useEffect(() => {
    if (!definitions) return;
    let cancelled = false;

    void (async () => {
      const session = await getSession();
      if (cancelled) return;

      if (!session.ok) {
        // 401 is the normal case here, not an error: nobody has registered yet.
        setPhase('ready');
        return;
      }
      if (session.data.orgType !== 'BUYER' || !session.data.orgId) {
        setPhase('wrong-account');
        return;
      }

      setRegistered(true);
      // Idempotent, and safe on every mount — which is how it is meant to be
      // called. The client should not have to know whether registration or a
      // constitution change already materialised these rows.
      await startOnboarding();
      if (cancelled) return;

      const onboarding = await getOnboarding();
      if (cancelled) return;
      if (!onboarding.ok) {
        setPhase('unreachable');
        return;
      }

      const wanted = new URLSearchParams(window.location.search).get('step');
      const valid =
        wanted === REVIEW ||
        (wanted && onboarding.data.progress.steps.some((s) => s.stepCode === wanted));
      applyOnboarding(onboarding.data, valid && wanted ? wanted : undefined);
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [definitions, applyOnboarding]);

  /** The step lives in the URL, so a reload and a rail link land in one place. */
  const goTo = React.useCallback((code: string): void => {
    setCurrentCode(code);
    setSaveFailure(null);
    const url = new URL(window.location.href);
    url.searchParams.set('step', code);
    window.history.replaceState(null, '', url);
  }, []);

  const current = steps.find((s) => s.stepCode === currentCode);

  /**
   * The GSTINs step 3 verified, for step 4's billing addresses.
   *
   * Read, never asked for again. Once step 4 has a draft of its own it carries
   * its own copy — which is what survives step 3 being marked COMPLETE and its
   * draft cleared server-side.
   */
  const savedGstins = React.useMemo<string[]>(() => {
    const rows = answers.STATUTORY?.gstins;
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => (row as { gstin?: unknown }).gstin)
      .filter((g): g is string => typeof g === 'string' && g.length === 15);
  }, [answers.STATUTORY]);

  /* ---------------------------------------------------------------- step 1 */

  const continueFromAccount = async (
    values: AccountValues,
  ): Promise<Record<string, string> | null> => {
    setBusy(true);
    setSaveFailure(null);
    try {
      if (!registered) {
        const created = await register({
          companyName: values.companyName,
          fullName: values.fullName,
          email: values.email,
          mobile: values.mobile,
          password: values.password,
        });
        if (!created.ok) {
          // The server names the field when it can — an address already in use,
          // a password that fails composition. Everything else is a banner, and
          // nothing typed is thrown away either way.
          if (Object.keys(created.fields).length === 0) setSaveFailure(created.message);
          return Object.keys(created.fields).length > 0
            ? created.fields
            : { password: created.message };
        }
        setRegistered(true);
        await startOnboarding();
      }

      setTypedCompanyName(values.companyName);

      const draft = {
        fullName: values.fullName,
        companyName: values.companyName,
        email: values.email,
        mobile: values.mobile,
        heardFrom: values.heardFrom,
        emailVerified: true,
        mobileVerified: true,
      };
      const saved = await saveStep('ACCOUNT', draft, 100);
      if (!saved.ok) {
        setSaveFailure(saved.message);
        return null;
      }
      // Held locally as well: completing the step clears the server's copy, and
      // the review screen has nowhere else to read it back from.
      setAnswers((a) => ({ ...a, ACCOUNT: draft }));

      if (current?.status !== 'COMPLETE') {
        const done = await completeStep('ACCOUNT');
        if (!done.ok) {
          setSaveFailure(done.message);
          return null;
        }
      }

      await reload('BUSINESS_PROFILE');
      goTo('BUSINESS_PROFILE');
      return null;
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------------- step 2 */

  /**
   * One save and one continue for every draft step, taking the code as an
   * argument. Steps 2 and 3 do the same three things — write the draft, mark the
   * step complete, move on — and a second copy per step is how the two drift
   * into disagreeing about what a failed save does to what was typed.
   */
  const saveDraft = async (
    stepCode: string,
    values: Record<string, unknown>,
    completionPct: number,
  ): Promise<boolean> => {
    if (!registered) return false;
    const saved = await saveStep(stepCode, values, completionPct);
    if (!saved.ok) {
      // The banner stays until the next successful save. The form keeps every
      // value — a failed save must never be a silent loss.
      setSaveFailure(saved.message);
      return false;
    }
    setSaveFailure(null);
    setAnswers((a) => ({ ...a, [stepCode]: values }));
    setSavedAt(new Date().toISOString());
    return true;
  };

  const continueFrom = async (
    stepCode: string,
    values: Record<string, unknown>,
    completionPct: number,
  ): Promise<Record<string, string> | null> => {
    setBusy(true);
    try {
      if (!(await saveDraft(stepCode, values, completionPct))) return null;
      if (current?.status !== 'COMPLETE') {
        const done = await completeStep(stepCode);
        if (!done.ok) {
          setSaveFailure(done.message);
          return null;
        }
      }
      await reload();
      // After the last step there is no next one — the review screen is where
      // the flow goes, and it is a place in this client rather than a step.
      const next = steps.find((s) => s.stepOrder === (current?.stepOrder ?? 0) + 1);
      goTo(next ? next.stepCode : REVIEW);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------------ rail */

  const railSteps: Step[] = steps.map((s) => ({
    key: s.stepCode,
    label: s.title,
    status: railStatus(s, currentCode),
    // Only a completed step is a link back, and only once there is an account
    // to load it against. `Stepper` renders a real anchor, so this is a page
    // load — correct here, since the flow re-reads its state on mount anyway.
    href: registered && s.status === 'COMPLETE' ? `/register?step=${s.stepCode}` : undefined,
    blockers: s.blockingReason ? [s.blockingReason] : undefined,
  }));

  const whyItems: WhyRailItem[] = [
    ...steps
      .filter((s) => s.purposeNote)
      .map((s) => ({ term: s.title, explanation: s.purposeNote })),
    // The step's own `purpose_note` is one sentence. The primary GSTIN decides
    // how this buyer is invoiced from here on, so step 3 adds the paragraph the
    // seed has no room for — and only while step 3 is the step on screen.
    ...(currentCode === 'STATUTORY' ? WHY_STATUTORY : []),
    ...(currentCode === 'CONTACTS_ADDRESSES' ? WHY_CONTACTS : []),
    ...(currentCode === 'DOCUMENTS' ? WHY_DOCUMENTS : []),
  ];

  const rail = (
    <StepRail
      steps={railSteps}
      label="Create a buyer account"
      savedAt={savedAt ? formatSaved(savedAt) : undefined}
      className={wide ? undefined : 'static max-h-none'}
    />
  );

  /* ----------------------------------------------------------- shell state */

  if (phase === 'unreachable') {
    return (
      <EmptyState
        title="We could not load the registration steps"
        body="The steps come from our onboarding service, and it did not answer. Nothing you may have started is lost — reload and it picks up where it was."
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (phase === 'wrong-account') {
    return (
      <EmptyState
        title="You are already signed in, on a different kind of account"
        body="This form creates a buyer account. Vendor and staff accounts are managed in the console. Sign out here if you need to register a second organisation."
        action={
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Back to the shop
          </Button>
        }
      />
    );
  }

  const stepIndex = steps.findIndex((s) => s.stepCode === currentCode);
  /**
   * The form is behind them once the application is with us. Every status from
   * KYC_SUBMITTED on lands on the review screen whatever `?step` says — a form
   * that still accepts edits after submission is a lie about what happens next.
   */
  const withUs = AFTER_SUBMISSION.includes(orgStatus);
  const reviewing = currentCode === REVIEW || withUs;

  const submit = async (): Promise<string | null> => {
    const result = await submitForReview();
    // A 409 names the steps that are not finished. It is the most useful
    // sentence on the screen, so it is shown as written.
    if (!result.ok) return result.message;
    await reload(REVIEW);
    return null;
  };

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      {wide ? (
        rail
      ) : (
        <details className="rounded-lg border border-rule bg-sheet">
          <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-body-sm font-medium text-ink">
            {/* The step title is the page heading immediately below, so the
                collapsed rail says only where you are in the sequence. */}
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              {/* On the review screen there is no current step, and "step 0 of
                  5" is a position nobody is in. */}
              {reviewing ? (
                <>
                  <span className="tnum">{steps.filter((s) => s.status === 'COMPLETE').length}</span>{' '}
                  of <span className="tnum">{steps.length}</span> steps done
                </>
              ) : (
                <>
                  Step <span className="tnum">{stepIndex + 1}</span> of{' '}
                  <span className="tnum">{steps.length}</span>
                </>
              )}
            </span>
            <span className="ml-auto text-body-sm text-acc-ink">All steps</span>
          </summary>
          <div className="border-t border-rule-2 p-4">{rail}</div>
        </details>
      )}

      <main className="flex flex-col gap-5 lg:max-w-[70ch]">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            {reviewing ? (
              <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                <span className="tnum">{steps.filter((s) => s.status === 'COMPLETE').length}</span>{' '}
                of <span className="tnum">{steps.length}</span> steps done
              </span>
            ) : (
              <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                Step <span className="tnum">{Math.max(stepIndex + 1, 1)}</span> of{' '}
                <span className="tnum">{steps.length}</span>
              </span>
            )}
            <h1 className="text-h1 text-ink">
              {/* Nothing is left to check or submit once it is with a reviewer,
                  and a heading that says otherwise is an instruction nobody can
                  follow. */}
              {withUs
                ? 'Your application'
                : reviewing
                  ? 'Check and submit'
                  : (current?.title ?? 'Create an account')}
            </h1>
            {!reviewing &&
              (current?.estimatedMinutes ? (
                <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                  about <span className="tnum">{current.estimatedMinutes}</span> min
                </span>
              ) : (
                <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">
                  Duration not measured
                </span>
              ))}
            {registered && <StatusPill tone="neutral" label="Signed in" />}
          </div>
          {!reviewing && current?.purposeNote && <p className="max-w-[62ch]">{current.purposeNote}</p>}
        </header>

        {saveFailure && (
          <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
            {saveFailure} Everything you have typed is still on this screen.
          </p>
        )}

        {reviewing ? (
          <Review
            steps={steps}
            answers={answers}
            orgStatus={orgStatus}
            slaDueAt={slaDueAt}
            slaBreached={slaBreached}
            isSubmittable={isSubmittable}
            onEdit={goTo}
            onSubmit={submit}
          />
        ) : phase === 'checking' ? (
          <div className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5">
            <Skeleton lines={6} />
            <p className="text-body-sm text-ink-3" role="status">
              Checking whether you already have an application in progress…
            </p>
          </div>
        ) : currentCode === 'ACCOUNT' ? (
          <StepAccount
            answers={answers.ACCOUNT ?? {}}
            registered={registered}
            busy={busy}
            onContinue={continueFromAccount}
            onFieldFocus={setActiveTerm}
          />
        ) : currentCode === 'BUSINESS_PROFILE' ? (
          <StepCompany
            answers={answers.BUSINESS_PROFILE ?? {}}
            fallbackLegalName={
              typedCompanyName ||
              (typeof answers.ACCOUNT?.companyName === 'string'
                ? (answers.ACCOUNT.companyName as string)
                : '')
            }
            busy={busy}
            blockingReason={current?.blockingReason}
            onSaveDraft={(values, pct) => void saveDraft('BUSINESS_PROFILE', values, pct)}
            onContinue={(values, pct) => continueFrom('BUSINESS_PROFILE', values, pct)}
            onFieldFocus={setActiveTerm}
          />
        ) : currentCode === 'STATUTORY' ? (
          <StepStatutory
            answers={answers.STATUTORY ?? {}}
            fallbackLegalName={
              (typeof answers.BUSINESS_PROFILE?.legalName === 'string'
                ? (answers.BUSINESS_PROFILE.legalName as string)
                : '') ||
              typedCompanyName ||
              (typeof answers.ACCOUNT?.companyName === 'string'
                ? (answers.ACCOUNT.companyName as string)
                : '')
            }
            constitution={constitution}
            fields={current?.fields}
            busy={busy}
            blockingReason={current?.blockingReason}
            onSaveDraft={(values, pct) => void saveDraft('STATUTORY', values, pct)}
            onContinue={(values, pct) => continueFrom('STATUTORY', values, pct)}
            onFieldFocus={setActiveTerm}
          />
        ) : currentCode === 'CONTACTS_ADDRESSES' ? (
          <StepContacts
            answers={answers.CONTACTS_ADDRESSES ?? {}}
            gstins={savedGstins}
            busy={busy}
            blockingReason={current?.blockingReason}
            onSaveDraft={(values, pct) => void saveDraft('CONTACTS_ADDRESSES', values, pct)}
            onContinue={(values, pct) => continueFrom('CONTACTS_ADDRESSES', values, pct)}
            onFieldFocus={setActiveTerm}
          />
        ) : currentCode === 'DOCUMENTS' ? (
          <StepDocuments
            answers={answers.DOCUMENTS ?? {}}
            busy={busy}
            blockingReason={current?.blockingReason}
            onSaveDraft={(values, pct) => void saveDraft('DOCUMENTS', values, pct)}
            onContinue={(values, pct) => continueFrom('DOCUMENTS', values, pct)}
            onFieldFocus={setActiveTerm}
          />
        ) : (
          <EmptyState
            title={`${current?.title ?? 'This step'} is not built yet`}
            body="Your answers so far are saved and this application is waiting for you. This step opens shortly; nothing you have entered is lost in the meantime."
            action={
              <Button variant="secondary" onClick={() => window.location.assign('/')}>
                Back to the shop
              </Button>
            }
          />
        )}
      </main>

      {/* The right rail is the API's own `purpose_note` for every step, never
          copy written next to the field. Below 1280px it moves under the form
          rather than squeezing the form into a column too narrow to fill in. */}
      {whyItems.length > 0 && (
        <WhyRail
          items={whyItems}
          activeTerm={activeTerm ?? current?.title}
          className="max-xl:static max-xl:max-h-none lg:col-span-2 xl:col-span-1"
        />
      )}
    </div>
  );
}
