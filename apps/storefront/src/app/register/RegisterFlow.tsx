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
  accountHolderFromSession,
  completeStep,
  getOnboarding,
  getSession,
  register,
  requestMfaCode,
  saveStep,
  startOnboarding,
  submitForReview,
  type AccountHolderDetails,
  type ResumableOnboarding,
  type ReviewDecision,
  type StepDefinition,
  type StepProgress,
} from './api';
import { MfaGate } from './MfaGate';
import type { AccountValues } from './StepAccount';
import { constitutionFromVerifiedGst } from './gst-company-prefill';

/**
 * Registration — **archetype D, flow**: the step rail on the left, one step in
 * the middle, and the "why we ask" rail on the right.
 *
 * **One shell, two flows.** A buyer has five steps and a vendor has seven, but
 * the first three share their codes (ACCOUNT, BUSINESS_PROFILE, STATUTORY), the
 * same save-and-resume, the same verification outcomes and the same rail. The
 * difference between them is almost entirely *data* — the seeded definitions,
 * the `purpose_note` copy, and which constitution-gated fields
 * `onboarding_field_requirement` returns. What genuinely differs is which
 * component renders a given step code, so that is the one thing the caller
 * supplies: a map from step code to renderer. Everything else here is shared,
 * because a second copy of this file is how the two flows drift into disagreeing
 * about what a failed save does to what was typed.
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

/** Weighted across required steps: complete ones count as 100%, the rest as drafted. */
function onboardingCompletionPct(steps: readonly StepProgress[]): number {
  const required = steps.filter((s) => s.isRequired);
  if (required.length === 0) return 0;
  return Math.round(
    required.reduce((sum, s) => sum + (s.status === 'COMPLETE' ? 100 : s.completionPct), 0) /
      required.length,
  );
}

/** Step 1's draft is cleared on complete — merge session with saved ACCOUNT answers. */
function mergeAccountHolder(
  session: AccountHolderDetails,
  allAnswers: Record<string, Record<string, unknown>>,
): AccountHolderDetails {
  const account = allAnswers.ACCOUNT ?? {};
  const fromAccount = {
    fullName: typeof account.fullName === 'string' ? account.fullName : '',
    email: typeof account.email === 'string' ? account.email : '',
    mobile: typeof account.mobile === 'string' ? account.mobile : '',
  };
  return {
    fullName: session.fullName || fromAccount.fullName,
    email: session.email || fromAccount.email,
    mobile: session.mobile || fromAccount.mobile,
  };
}

/**
 * Everything a step needs from the shell, in one object.
 *
 * Passed rather than each step reaching for its own copy of the draft: the shell
 * owns the merge of "what the server returned" with "what this session typed",
 * and a step that reads around it sees the wrong half of that after a completion
 * clears a draft server-side.
 */
export interface StepContext {
  /** This step's answers, server-side draft merged with what was typed here. */
  answers: Record<string, unknown>;
  /** Every step's, for a step that reads one before it. */
  allAnswers: Record<string, Record<string, unknown>>;
  step: StepProgress | undefined;
  /** `constitution_type` from the org itself; step 2's draft may be gone. */
  constitution: string | null;
  registered: boolean;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  saveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  continueFrom: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  /**
   * ACCOUNT only. Creates the organisation if it does not exist yet, then saves
   * and completes the step. `extras` are the fields this flow asks on step 1
   * that the other does not — a buyer's lead source, a vendor's monthly volume.
   */
  continueFromAccount: (
    values: AccountValues,
    extras?: Record<string, unknown>,
  ) => Promise<Record<string, string> | null>;
  /**
   * When true, the step does not run its own checks. Typed as `false` in the
   * shell input. The API still refuses a bad save — this only unblocks Continue.
   */
  skipValidation: boolean;
  /**
   * The registering account's name, email and mobile. Step 1's draft is cleared
   * on complete, so later steps read this from the session instead.
   */
  accountHolder: AccountHolderDetails;
}

/** What the shell hands a review screen. `Review` in the buyer flow matches it. */
export interface ReviewContext {
  steps: readonly StepProgress[];
  answers: Record<string, Record<string, unknown>>;
  orgStatus: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  /** The reviewer's own words on the latest decision. Null while it is with us. */
  decision: ReviewDecision | null;
  isSubmittable: boolean;
  onEdit: (stepCode: string) => void;
  onSubmit: () => Promise<string | null>;
}

export interface RegisterFlowProps {
  /** Server-rendered so the rail is drawn on first paint, not after a fetch. */
  definitions: StepDefinition[] | null;
  /** Decides the owner role at registration and which session may resume here. */
  orgType: 'BUYER' | 'VENDOR';
  /** The rail's accessible name. "Create a buyer account", "Become a supplier". */
  railLabel: string;
  /**
   * Where this flow lives. The rail links a completed step back to
   * `${basePath}?step=CODE`, and a hard-coded '/register' here sent every
   * supplier who clicked a finished step into the *buyer* form.
   */
  basePath: string;
  /** Step code → its component. A code with no entry renders as not built yet. */
  renderers: Record<string, (ctx: StepContext) => React.ReactNode>;
  /**
   * Step code → a `purpose_note` that replaces the seeded one, everywhere it is
   * read: the page header and the "why we ask" rail both.
   *
   * This exists for exactly one reason and should shrink rather than grow. A
   * seeded note that describes something the platform does not do — step 7's
   * says the agreements are "e-signed", and no e-sign provider is connected —
   * is a false claim on the applicant's screen, and it is a *seed* fix. Until
   * the seed agrees, the screen must not repeat it.
   */
  purposeNotes?: Record<string, string>;
  /**
   * Copy the step's own `purpose_note` has no room for, per step code. The rail
   * is otherwise the API's own text and nothing is written beside a field.
   */
  whyFor?: (stepCode: string) => readonly WhyRailItem[];
  /** Shown when the signed-in session belongs to the other kind of account. */
  wrongAccountBody: string;
  /** Where the wrong-account empty state sends the applicant. Defaults to the shop. */
  wrongAccountAction?: { href: string; label: string };
  /** Absent until a flow has a review screen; the last step then has no next. */
  review?: (ctx: ReviewContext) => React.ReactNode;
  /**
   * Called once a session exists — storefront passes `router.refresh()` so
   * `SiteHeader` re-reads cookies; the console omits it.
   */
  onSessionEstablished?: () => void;
}

export function RegisterFlow({
  definitions,
  orgType,
  railLabel,
  basePath,
  renderers,
  purposeNotes,
  whyFor,
  wrongAccountBody,
  wrongAccountAction = { href: '/', label: 'Back to the shop' },
  review,
  onSessionEstablished,
}: RegisterFlowProps): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>(definitions ? 'checking' : 'unreachable');
  const [steps, setSteps] = React.useState<StepProgress[]>(() =>
    (definitions ?? []).map(asProgress).map((s) =>
      purposeNotes && s.stepCode in purposeNotes
        ? { ...s, purposeNote: purposeNotes[s.stepCode]! }
        : s,
    ),
  );
  const [currentCode, setCurrentCode] = React.useState<string>(
    () => definitions?.[0]?.stepCode ?? 'ACCOUNT',
  );
  const [answers, setAnswers] = React.useState<Record<string, Record<string, unknown>>>({});
  const [accountHolder, setAccountHolder] = React.useState<AccountHolderDetails>({
    fullName: '',
    email: '',
    mobile: '',
  });
  const [registered, setRegistered] = React.useState(false);

  /** Resume and first sign-in both flip this; only a *new* session refreshes chrome. */
  const markSignedIn = React.useCallback((): void => {
    setRegistered(true);
  }, []);

  const notifySessionEstablished = React.useCallback((): void => {
    onSessionEstablished?.();
  }, [onSessionEstablished]);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [saveFailure, setSaveFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** True while re-fetching answers before opening a completed step from the rail. */
  const [stepLoading, setStepLoading] = React.useState(false);
  const [activeTerm, setActiveTerm] = React.useState<string | undefined>();
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
  const [decision, setDecision] = React.useState<ReviewDecision | null>(null);
  const [isSubmittable, setIsSubmittable] = React.useState(false);
  /**
   * Type `true` (default) to keep every step check; type `false` to skip them.
   * Held in sessionStorage so a reload does not flip it back on mid-walkthrough.
   */
  const [validateInput, setValidateInput] = React.useState('true');
  const skipValidation = validateInput.trim().toLowerCase() === 'false';
  const skipValidationRef = React.useRef(skipValidation);
  skipValidationRef.current = skipValidation;
  React.useEffect(() => {
    try {
      const stored = sessionStorage.getItem('tg-register-validate');
      if (stored !== null) setValidateInput(stored);
    } catch {
      // A private window cannot remember the switch. The default stays `true`.
    }
  }, []);
  /**
   * The masked address a second-factor code went to, while one is outstanding.
   *
   * `MFA_REQUIRED_ROLES` covers VENDOR_OWNER, so a supplier account meets the
   * guard the instant it is created and every onboarding call 403s until a code
   * lands. Held here rather than inside step 1 because it also happens on a
   * *resumed* session, where there is no step 1 in flight to own it.
   */
  const [mfaSentTo, setMfaSentTo] = React.useState<string | null>(null);
  /** What to finish once the factor lands. Null on a resume: there is nothing pending. */
  const pendingAccount = React.useRef<{
    values: AccountValues;
    extras: Record<string, unknown>;
  } | null>(null);

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

  const reword = React.useCallback(
    (list: StepProgress[]): StepProgress[] =>
      purposeNotes
        ? list.map((s) =>
            s.stepCode in purposeNotes
              ? { ...s, purposeNote: purposeNotes[s.stepCode]! }
              : s,
          )
        : list,
    [purposeNotes],
  );

  const applyOnboarding = React.useCallback(
    (data: ResumableOnboarding, landOn?: string): void => {
      const loaded = data.progress;
      setSteps(reword(loaded.steps));
      // **Merged, not replaced.** A completed step's snapshot lives server-side;
      // dropping a step here would empty the review screen one completion at a time.
      setAnswers((held) => ({ ...held, ...data.answers }));
      setAccountHolder((prev) => mergeAccountHolder(prev, data.answers));
      setConstitution(loaded.constitution ?? null);
      setOrgStatus(data.status);
      setSlaDueAt(data.slaDueAt);
      setSlaBreached(data.slaBreached);
      setDecision(data.decision);
      setIsSubmittable(loaded.isSubmittable);
      const wanted = landOn ?? loaded.resumeAt ?? loaded.steps[0]?.stepCode;
      if (wanted) {
        setCurrentCode(wanted);
        if (landOn) {
          const url = new URL(window.location.href);
          url.searchParams.set('step', wanted);
          window.history.replaceState(null, '', url);
        }
      }
      // ISO strings sort chronologically, so the newest save is the last one.
      const saves = loaded.steps.map((s) => s.lastSavedAt).filter((v): v is string => Boolean(v));
      setSavedAt([...saves].sort().pop() ?? null);
    },
    [reword],
  );

  const applyOnboardingRef = React.useRef(applyOnboarding);
  applyOnboardingRef.current = applyOnboarding;

  const reload = React.useCallback(async (landOn?: string): Promise<void> => {
    if (landOn) setStepLoading(true);
    try {
      const onboarding = await getOnboarding();
      if (!onboarding.ok) {
        setSaveFailure(onboarding.message);
        return;
      }
      applyOnboardingRef.current(onboarding.data, landOn);
    } finally {
      if (landOn) setStepLoading(false);
    }
  }, []);

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
      if (session.data.orgType !== orgType || !session.data.orgId) {
        setPhase('wrong-account');
        return;
      }

      markSignedIn();
      setAccountHolder(accountHolderFromSession(session.data));
      // Idempotent, and safe on every mount — which is how it is meant to be
      // called. The client should not have to know whether registration or a
      // constitution change already materialised these rows.
      const started = await startOnboarding();
      if (cancelled) return;

      // A 403 here is `AuthGuard` holding an outstanding second factor, not an
      // outage: `GET /auth/session` reports `mfaRequired: false` for a session
      // whose token says otherwise, so the refusal is the only honest signal a
      // returning vendor gives us. Rendering "we could not load the steps" would
      // be wrong about a problem they can fix in ten seconds.
      if (!started.ok && started.status === 403) {
        await openMfa();
        if (cancelled) return;
        setPhase('ready');
        return;
      }

      const onboarding = await getOnboarding();
      if (cancelled) return;
      if (!onboarding.ok) {
        setPhase(onboarding.status === 403 ? 'ready' : 'unreachable');
        if (onboarding.status === 403) await openMfa();
        return;
      }

      const wanted = new URLSearchParams(window.location.search).get('step');
      const valid =
        wanted === REVIEW ||
        (wanted && onboarding.data.progress.steps.some((s) => s.stepCode === wanted));
      applyOnboardingRef.current(onboarding.data, valid && wanted ? wanted : undefined);
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
    };
    // Mount once per definitions/orgType — not when copy callbacks are recreated.
  }, [definitions, orgType]);

  /** The step lives in the URL, so a reload and a rail link land in one place. */
  const goTo = React.useCallback(
    (code: string): void => {
      setSaveFailure(null);
      const url = new URL(window.location.href);
      url.searchParams.set('step', code);
      window.history.replaceState(null, '', url);
      const target = steps.find((s) => s.stepCode === code);
      // Completed and sent-back steps read a snapshot from the server; reload
      // lands on the step and merges answers before the form remounts.
      if (
        registered &&
        (target?.status === 'COMPLETE' || target?.status === 'NEEDS_FIX')
      ) {
        setCurrentCode(code);
        void reload(code);
        return;
      }
      setCurrentCode(code);
    },
    [registered, reload, steps],
  );

  /** First step after ACCOUNT — from the seeded order, not a hard-coded code. */
  const firstStepAfterAccount = React.useCallback((): string => {
    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const accountIdx = sorted.findIndex((s) => s.stepCode === 'ACCOUNT');
    return sorted[accountIdx + 1]?.stepCode ?? 'BUSINESS_PROFILE';
  }, [steps]);

  const mainRef = React.useRef<HTMLElement>(null);

  const scrollPageTop = React.useCallback((): void => {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      // jsdom does not implement scrollTo.
    }
  }, []);

  // A long step leaves the viewport scrolled to the button. Only scroll when the
  // step actually changes — a failed validation or save keeps the viewport where
  // the error is, next to the field or the button they just clicked.
  React.useEffect(() => {
    scrollPageTop();
  }, [currentCode, scrollPageTop]);

  const current = steps.find((s) => s.stepCode === currentCode);
  const withUs = AFTER_SUBMISSION.includes(orgStatus);
  const reviewing = Boolean(review) && (currentCode === REVIEW || withUs);

  /* --------------------------------------------------------- second factor */

  /**
   * Ask for a code and put the gate on screen. Never called speculatively — only
   * when the server has actually refused, or said it is about to.
   */
  const openMfa = async (): Promise<void> => {
    const sent = await requestMfaCode();
    if (!sent.ok) {
      setSaveFailure(sent.message);
      return;
    }
    setMfaSentTo(sent.data.sentTo);
  };

  /* ---------------------------------------------------------------- step 1 */

  const continueFromAccount = async (
    values: AccountValues,
    extras: Record<string, unknown> = {},
  ): Promise<Record<string, string> | null> => {
    setBusy(true);
    setSaveFailure(null);
    const skip = skipValidationRef.current;
    const refused = (
      fields: Record<string, string> | null,
    ): Record<string, string> | null => {
      if (!skip) return fields;
      setSaveFailure(null);
      goTo(firstStepAfterAccount());
      return null;
    };
    try {
      if (!registered) {
        const created = await register(orgType, {
          fullName: values.fullName,
          email: values.email,
          mobile: values.mobile,
          password: values.password,
        });
        if (created.ok) setAccountHolder(accountHolderFromSession(created.data));
        if (!created.ok) {
          // The server names the field when it can — an address already in use,
          // a password that fails composition. Everything else is a banner, and
          // nothing typed is thrown away either way.
          if (Object.keys(created.fields).length === 0) setSaveFailure(created.message);
          return refused(
            Object.keys(created.fields).length > 0
              ? created.fields
              : { password: created.message },
          );
        }
        markSignedIn();
        if (created.data.mfaRequired) {
          // Not an error and not a step: the account exists, and the answers on
          // screen are held until the factor lands rather than being written to
          // an endpoint that is about to refuse them.
          pendingAccount.current = { values, extras };
          await openMfa();
          return null;
        }
        notifySessionEstablished();
        await startOnboarding();
      }

      const draft = {
        ...extras,
        fullName: values.fullName,
        email: values.email,
        mobile: values.mobile,
        heardFrom: values.heardFrom,
        emailVerified: true,
        mobileVerified: true,
      };
      const saved = await saveStep('ACCOUNT', draft, 100);
      if (!saved.ok) {
        setSaveFailure(saved.message);
        return refused(null);
      }
      // Held locally as well: completing the step clears the server's copy, and
      // the review screen has nowhere else to read it back from.
      setAnswers((a) => ({ ...a, ACCOUNT: draft }));
      setAccountHolder({
        fullName: values.fullName,
        email: values.email,
        mobile: values.mobile,
      });

      if (current?.status !== 'COMPLETE') {
        const done = await completeStep('ACCOUNT');
        if (!done.ok) {
          setSaveFailure(done.message);
          return refused(null);
        }
      }

      const nextStep = firstStepAfterAccount();
      await reload(nextStep);
      goTo(nextStep);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /**
   * The code was accepted and the session has been rotated with `mfa: true`.
   *
   * `startOnboarding` first in both arms: it is idempotent, and it is the call
   * that was refused a moment ago, so nothing this org has can be read or
   * written until it has actually run once.
   */
  const afterMfa = async (): Promise<void> => {
    setMfaSentTo(null);
    const pending = pendingAccount.current;
    pendingAccount.current = null;
    await startOnboarding();
    notifySessionEstablished();
    if (pending) {
      await continueFromAccount(pending.values, pending.extras);
      return;
    }
    await reload();
    setPhase('ready');
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
    setSteps((prev) =>
      prev.map((s) =>
        s.stepCode === stepCode
          ? {
              ...s,
              status: s.status === 'NOT_STARTED' ? 'IN_PROGRESS' : s.status,
              completionPct,
              lastSavedAt: new Date().toISOString(),
            }
          : s,
      ),
    );
    setSavedAt(new Date().toISOString());
    return true;
  };

  const continueFrom = async (
    stepCode: string,
    values: Record<string, unknown>,
    completionPct: number,
  ): Promise<Record<string, string> | null> => {
    setBusy(true);
    const next = steps.find((s) => s.stepOrder === (current?.stepOrder ?? 0) + 1);
    const nextCode = next ? next.stepCode : REVIEW;
    try {
      if (!(await saveDraft(stepCode, values, completionPct))) {
        if (skipValidationRef.current) {
          setAnswers((held) => ({ ...held, [stepCode]: values }));
          setSaveFailure(null);
          goTo(nextCode);
        }
        return null;
      }
      const done = await completeStep(stepCode);
      if (!done.ok) {
        setSaveFailure(done.message);
        if (skipValidationRef.current) {
          setSaveFailure(null);
          goTo(nextCode);
        }
        return null;
      }
      setSteps((prev) =>
        prev.map((s) =>
          s.stepCode === stepCode
            ? { ...s, status: 'COMPLETE', completionPct: 100, lastSavedAt: new Date().toISOString() }
            : s,
        ),
      );
      await reload(nextCode);
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
    // Only a completed step is reachable from the rail, and only once there is
    // an account to load it against. In-place navigation reloads answers first
    // so the form remounts with what was submitted, not an empty draft.
    onNavigate:
      registered && s.status === 'COMPLETE' ? (code: string) => goTo(code) : undefined,
    href: registered && s.status === 'COMPLETE' ? `${basePath}?step=${s.stepCode}` : undefined,
    blockers: s.blockingReason ? [s.blockingReason] : undefined,
  }));

  const whyItems: WhyRailItem[] = reviewing
    ? []
    : [
        ...(current?.purposeNote
          ? [{ term: current.title, explanation: current.purposeNote }]
          : []),
        // The step's own `purpose_note` is one sentence. Where a step makes the
        // applicant take a decision the seed has no room to explain — the primary
        // GSTIN, say — the flow contributes the paragraph, and only while that step
        // is the one on screen.
        ...(whyFor?.(currentCode) ?? []),
      ];

  const rail = (
    <StepRail
      steps={railSteps}
      label={railLabel}
      completionPct={onboardingCompletionPct(steps)}
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
        body={wrongAccountBody}
        action={
          <Button
            variant="secondary"
            onClick={() => window.location.assign(wrongAccountAction.href)}
          >
            {wrongAccountAction.label}
          </Button>
        }
      />
    );
  }

  const submit = async (): Promise<string | null> => {
    const result = await submitForReview();
    // A 409 names the steps that are not finished. It is the most useful
    // sentence on the screen, so it is shown as written.
    if (!result.ok) return result.message;
    await reload(REVIEW);
    return null;
  };

  /** Bound to the step on screen, so a renderer never passes its own code back. */
  const stepContext: StepContext = {
    answers: answers[currentCode] ?? {},
    allAnswers: answers,
    step: current,
    // The org's own value when promoted; until then the company step draft, or
    // the constitution the primary verified GSTIN returned on statutory.
    constitution:
      constitution ??
      (typeof answers.BUSINESS_PROFILE?.constitution === 'string'
        ? (answers.BUSINESS_PROFILE.constitution as string)
        : null) ??
      constitutionFromVerifiedGst(answers.STATUTORY),
    registered,
    busy,
    onFieldFocus: setActiveTerm,
    saveDraft: (values, pct) => void saveDraft(currentCode, values, pct),
    continueFrom: (values, pct) => continueFrom(currentCode, values, pct),
    continueFromAccount,
    skipValidation,
    accountHolder: mergeAccountHolder(accountHolder, answers),
  };

  return (
    <div className="regflow min-w-0">
      {wide ? (
        rail
      ) : (
        <details className="min-w-0 rounded-lg border border-rule bg-sheet">
          <summary className="flex min-h-11 cursor-pointer list-none items-center p-4 text-body-sm font-medium text-acc-ink [&::-webkit-details-marker]:hidden">
            All steps
          </summary>
          <div className="border-t border-rule-2 p-4">{rail}</div>
        </details>
      )}

      <main ref={mainRef} className="regflow-main flex min-w-0 flex-col gap-4 sm:gap-5">
        <header className="flex flex-col gap-3">
          <details className="rounded border border-rule-2 bg-sheet-2 px-4 py-3">
            <summary className="cursor-pointer text-label font-mono uppercase tracking-[0.13em] text-ink-3">
              Validate (dev)
            </summary>
            <label className="mt-3 flex flex-col gap-2 text-label text-ink-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
              <input
                className="h-8 w-full max-w-[5.5rem] rounded-sm border border-rule bg-sheet px-2 font-mono text-body-sm text-ink"
                value={validateInput}
                onChange={(event) => {
                  const next = event.target.value;
                  setValidateInput(next);
                  try {
                    sessionStorage.setItem('tg-register-validate', next);
                  } catch {
                    // A private window cannot remember the switch.
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="tg-register-validate-hint"
              />
              <span id="tg-register-validate-hint" className="text-ink-4 sm:max-w-[42ch]">
                Type true to check every step, or false to skip those checks.
              </span>
            </label>
          </details>
          {(reviewing || registered) && (
            <div className="flex flex-wrap items-baseline gap-3">
              {reviewing && (
                <h1 className="text-h1 text-ink">
                  {withUs ? 'Your application' : 'Check and submit'}
                </h1>
              )}
              {registered && <StatusPill tone="neutral" label="Signed in" />}
            </div>
          )}
        </header>

        {saveFailure && (
          <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
            {saveFailure} Everything you have typed is still on this screen.
          </p>
        )}

        {mfaSentTo ? (
          <MfaGate sentTo={mfaSentTo} onVerified={afterMfa} />
        ) : reviewing && review ? (
          review({
            steps,
            answers,
            orgStatus,
            slaDueAt,
            slaBreached,
            decision,
            isSubmittable,
            onEdit: goTo,
            onSubmit: submit,
          })
        ) : phase === 'checking' || stepLoading ? (
          <div className="flex flex-col gap-4 rounded-lg border border-rule bg-sheet p-5">
            <Skeleton lines={6} />
            <p className="text-body-sm text-ink-3" role="status">
              {stepLoading
                ? 'Loading what you submitted on this step…'
                : 'Checking whether you already have an application in progress…'}
            </p>
          </div>
        ) : (
          <div key={currentCode}>
            {renderers[currentCode]?.(stepContext) ?? (
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
          </div>
        )}

      </main>

      {/* The right rail shows only the step on screen: its `purpose_note` plus
          any extra entries the flow supplies for that step. Below 1280px it moves
          under the form rather than squeezing the form into a column too narrow
          to fill in. */}
      {whyItems.length > 0 && (
        <WhyRail
          items={whyItems}
          activeTerm={activeTerm ?? current?.title}
          className={wide ? undefined : 'static max-h-none top-auto'}
        />
      )}
    </div>
  );
}
