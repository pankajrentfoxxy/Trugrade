'use client';

import * as React from 'react';
import { Button, Checkbox, FormSection, Input, StatusPill, type WhyRailItem } from '@trugrade/ui';
import {
  verifyGstin,
  verifyPan,
  type FieldRequirement,
  type GstinTaxpayer,
  type PanHolder,
  type VerificationOutcomeView,
} from './api';
import {
  gstinPanConflict,
  panHolderType,
  toGstin,
  toPan,
  validateCin,
  validateGstin,
  validatePan,
} from './validation';

/**
 * Step 3 — Statutory.
 *
 * Three ideas, and the whole screen is built around them.
 *
 * **A returned name is worth more than a tick.** The GST portal answers with the
 * legal name it holds against the number, and that name is the only thing on
 * this screen that can catch a buyer pasting a group company's GSTIN. So a PASS
 * never renders as a tick: it renders as the name, and the applicant has to say
 * it is theirs.
 *
 * **`PROVIDER_ERROR` is not `FAIL`.** A GST portal that did not answer is our
 * problem. It consumes none of their five daily attempts, it is never coloured
 * as a failure, it retries itself on a visible countdown, and when the retries
 * run out it offers to carry on and let a reviewer check the number later. The
 * one thing it must never do is dead-end somebody over an outage they did not
 * cause.
 *
 * **The primary GSTIN is a decision, not a field.** It fixes the billing entity
 * on every invoice, whether the supply is IGST or CGST+SGST, and therefore what
 * input credit can be claimed. It is never pre-selected — see `WHY_STATUTORY`
 * for the paragraph the right rail carries.
 */

/* ==========================================================================
 * The retry schedule
 * ======================================================================== */

/**
 * Client-side backoff for a provider that did not answer, in seconds.
 *
 * Deliberately shorter than `PROVIDER_RETRY_SCHEDULE_SECONDS` in
 * `verification.service.ts` (30s / 2m / 10m / 1h): that is the server retrying a
 * provider out of band, this is a person sitting in front of a form. Waiting
 * thirty seconds before the *first* retry, with a countdown on screen, is how a
 * form gets abandoned.
 *
 * ponytail: three tries then hand it to a reviewer. There is nothing to gain
 * from a fourth — if the portal is down it is down, and the "continue anyway"
 * path below is the real answer.
 */
const RETRY_AFTER_SECONDS = [5, 15, 45] as const;

const isProviderProblem = (view: VerificationOutcomeView): boolean =>
  view.willRetryAutomatically || view.outcome === 'PROVIDER_ERROR' || view.outcome === 'TIMEOUT';

/* ==========================================================================
 * The "why we ask" copy this step contributes
 * ======================================================================== */

/**
 * The right-rail copy for step 3.
 *
 * The step's own `purpose_note` comes from the seed and covers the GSTIN. The
 * primary-GSTIN entry is here rather than in the seed because it explains a
 * choice this screen makes the applicant make, and the backlog is explicit that
 * it gets its own explanation rather than a tooltip.
 */
export const WHY_STATUTORY: readonly WhyRailItem[] = [
  {
    term: 'Primary GSTIN',
    explanation: (
      <>
        <span className="block">
          If your business holds more than one registration, the primary one is the entity we
          invoice. It decides three things at once: whose name and address appear on the tax
          invoice, whether we charge IGST or CGST plus SGST, and therefore which of your
          registrations can claim the input credit.
        </span>
        <span className="mt-2 block">
          Pick the registration in the state that actually buys the machines. If the wrong one is
          set, an invoice raised against it is credited to a registration that never took delivery,
          and correcting it means a credit note and a fresh invoice for every order already placed.
        </span>
        <span className="mt-2 block">
          You can add more GSTINs at any time. Changing which one is primary needs a reviewer,
          because it changes how you are invoiced from that point on.
        </span>
      </>
    ),
  },
  {
    term: 'PAN',
    explanation:
      'Characters 3 to 12 of a GSTIN are the PAN it was issued against, so the two have to agree. We check the pair before we ask the portal anything — a mismatch there is almost always a GSTIN copied from a sister company.',
  },
];

/* ==========================================================================
 * Draft shape
 * ======================================================================== */

export interface GstinRow {
  /** Stable across a re-render and across a resume. Not shown. */
  key: string;
  gstin: string;
  isPrimary: boolean;
  /** The last outcome from the portal. `null` means never checked. */
  outcome: VerificationOutcomeView | null;
  /** The applicant has read the returned legal name and says it is theirs. */
  confirmed: boolean;
  /** The portal never answered and a reviewer will check this one by hand. */
  deferred: boolean;
}

export interface StatutoryValues {
  legalName: string;
  pan: string;
  panOutcome: VerificationOutcomeView | null;
  panDeferred: boolean;
  cin: string;
  gstins: GstinRow[];
}

let keySeed = 0;
const nextKey = (): string => {
  keySeed += 1;
  return `g${keySeed}`;
};

const emptyRow = (): GstinRow => ({
  key: nextKey(),
  gstin: '',
  isPrimary: false,
  outcome: null,
  confirmed: false,
  deferred: false,
});

export function readStatutoryDraft(
  answers: Record<string, unknown>,
  fallbackLegalName = '',
): StatutoryValues {
  const str = (key: string): string =>
    typeof answers[key] === 'string' ? (answers[key] as string) : '';
  const saved = Array.isArray(answers.gstins) ? (answers.gstins as GstinRow[]) : [];
  const rows = saved
    .filter((r): r is GstinRow => Boolean(r) && typeof r.gstin === 'string')
    // A resumed row keeps its recorded outcome, so a returning applicant sees
    // what was already verified rather than a blank form and a second round of
    // portal calls against their daily budget.
    .map((r) => ({ ...emptyRow(), ...r, key: nextKey() }));

  return {
    legalName: str('legalName') || fallbackLegalName,
    pan: str('pan'),
    panOutcome:
      (answers.panOutcome as VerificationOutcomeView | null | undefined) ?? null,
    panDeferred: answers.panDeferred === true,
    cin: str('cin'),
    gstins: rows.length > 0 ? rows : [emptyRow()],
  };
}

/** A check that is settled: verified, or knowingly left for a reviewer. */
const rowSettled = (row: GstinRow): boolean =>
  row.deferred || (row.outcome?.outcome === 'PASS' && row.confirmed);

const panSettled = (v: StatutoryValues): boolean =>
  v.panDeferred || v.panOutcome?.outcome === 'PASS';

/**
 * Four things have to be true, and `completion_pct` counts how many are.
 * CIN is a fifth only when this org's constitution actually requires one.
 */
export function completionOf(values: StatutoryValues, cinRequired: boolean): number {
  const checks = [
    panSettled(values),
    values.gstins.some(rowSettled),
    values.gstins.some((r) => r.isPrimary),
    ...(cinRequired ? [validateCin(values.cin, true) === undefined] : []),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/** Only what the API should keep. The React key is regenerated on read. */
const toDraft = (values: StatutoryValues): Record<string, unknown> => ({
  legalName: values.legalName,
  pan: values.pan,
  panOutcome: values.panOutcome,
  panDeferred: values.panDeferred,
  cin: values.cin,
  gstins: values.gstins.map(({ key: _key, ...row }) => row),
  primaryGstin: values.gstins.find((r) => r.isPrimary)?.gstin ?? null,
});

/* ==========================================================================
 * One check's result — the same panel for a GSTIN and for the PAN
 * ======================================================================== */

const resolvedGstin = (view: VerificationOutcomeView): GstinTaxpayer =>
  (view.resolved ?? {}) as GstinTaxpayer;

/** `2019-07-01` → `1 Jul 2019`. The portal's format is not a person's. */
function formatPortalDate(iso: string | undefined): string {
  if (!iso) return 'Not returned';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface CheckOutcomeProps {
  view: VerificationOutcomeView | null;
  checking: boolean;
  /** Named, because "checking" without saying with whom is a spinner. */
  provider: string;
  /** Seconds until the automatic retry, when one is pending. */
  retryIn?: number;
  retryAttempt?: number;
  /** True once the automatic retries are spent and it is still unreachable. */
  exhausted?: boolean;
  onRetryNow?: () => void;
  onDefer?: () => void;
  deferred?: boolean;
  /** What the applicant typed, to sit beside what the portal returned. */
  claimedName?: string;
  children?: React.ReactNode;
}

/**
 * Five outcomes, five different things on screen. The branch is the component.
 *
 * The rule the whole file exists for is the last two arms: a portal that did
 * not answer is never coloured `--fail`, never says "check your details", and
 * always says out loud that it cost the applicant nothing.
 */
function CheckOutcome({
  view,
  checking,
  provider,
  retryIn,
  retryAttempt,
  exhausted,
  onRetryNow,
  onDefer,
  deferred,
  claimedName,
  children,
}: CheckOutcomeProps): React.JSX.Element {
  if (checking) {
    return (
      <div
        className="flex flex-col gap-2 rounded border border-rule bg-sheet-2 p-4"
        role="status"
        aria-live="polite"
      >
        <StatusPill className="self-start" tone="processing" label="Checking" />
        <p className="text-body-sm text-ink-2">
          Asking {provider} for the registration behind this number. It usually answers in a few
          seconds.
        </p>
      </div>
    );
  }

  if (deferred) {
    return (
      <div className="flex flex-col gap-2 rounded border border-warn bg-sheet-2 p-4">
        <StatusPill className="self-start" tone="warn" label="Reviewer will check" />
        <p className="text-body-sm text-ink-2">
          We could not reach {provider}, so nobody has checked this number yet. Your application
          carries on and one of our reviewers verifies it by hand — you do not need to come back to
          this.
        </p>
      </div>
    );
  }

  if (!view) {
    // A missing value never renders as a passing one.
    return (
      <p className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">Not verified</p>
    );
  }

  /* ------------------------------------------------- our problem, not theirs */
  if (isProviderProblem(view)) {
    return (
      <div className="flex flex-col gap-3 rounded border border-warn bg-sheet-2 p-4">
        <StatusPill className="self-start" tone="warn" label={`${provider} did not answer`} />
        <p className="text-body-sm text-ink-2" role="status" aria-live="polite">
          {view.message}
        </p>
        {/* Said in as many words, because the fear this screen creates is
            "have I just burnt one of my tries on their outage". */}
        <p className="text-body-sm text-ink-2">
          This has not used any of your checks. You still have{' '}
          <span className="tnum text-ink">{view.attemptsRemaining}</span> of{' '}
          <span className="tnum text-ink">5</span> today.
        </p>
        {exhausted ? (
          <>
            <p className="text-body-sm text-ink-2">
              We tried <span className="tnum text-ink">{RETRY_AFTER_SECONDS.length}</span> more
              times and it is still not answering. That is not something you can fix from here.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" onClick={onRetryNow}>
                Try once more
              </Button>
              <Button type="button" variant="ghost" onClick={onDefer}>
                Continue — let a reviewer verify it
              </Button>
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

  /* ------------------------------------------------------------ their problem */
  if (view.outcome === 'FAIL') {
    return (
      <div className="flex flex-col gap-2 rounded border border-fail bg-sheet-2 p-4">
        <StatusPill className="self-start" tone="fail" label="Refused" />
        <p className="text-body-sm text-fail" role="alert">
          {view.message}
        </p>
        <p className="text-body-sm text-ink-2">
          Correct the number and check it again, or remove it.{' '}
          <span className="tnum text-ink">{view.attemptsRemaining}</span> of{' '}
          <span className="tnum text-ink">5</span> checks left today.
        </p>
      </div>
    );
  }

  if (view.outcome === 'MISMATCH') {
    const taxpayer = resolvedGstin(view);
    return (
      <div className="flex flex-col gap-3 rounded border border-warn bg-sheet-2 p-4">
        <StatusPill className="self-start" tone="warn" label="Registered to a different name" />
        <p className="text-body-sm text-ink-2" role="alert">
          {view.message}
        </p>
        <dl className="flex flex-col gap-2 border-t border-rule-2 pt-3 text-body-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">On the portal</dt>
            <dd className="text-ink">{taxpayer.legalName ?? 'Not returned'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">What you entered</dt>
            <dd className="text-ink">{claimedName || 'Nothing to compare against'}</dd>
          </div>
        </dl>
        <p className="text-body-sm text-ink-2">
          One of the two is wrong. If the portal is right, correct your legal name on the previous
          step; if the number belongs to another company, use your own.
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------------- PASS */
  return (
    <div className="flex flex-col gap-3 rounded border border-pass bg-sheet-2 p-4">
      <StatusPill className="self-start" tone="pass" label="Verified" />
      {children}
    </div>
  );
}

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepStatutoryProps {
  answers: Record<string, unknown>;
  /** Carried from step 2 so the portal's answer has something to disagree with. */
  fallbackLegalName?: string;
  /** `constitution_type` from the org itself; step 2's draft is gone by now. */
  constitution?: string | null;
  /** Already gated by constitution — CIN for a company, nothing for a proprietor. */
  fields?: readonly FieldRequirement[];
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  blockingReason?: string | null;
}

export function StepStatutory({
  answers,
  fallbackLegalName = '',
  constitution,
  fields = [],
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
}: StepStatutoryProps): React.JSX.Element {
  const [values, setValues] = React.useState<StatutoryValues>(() =>
    readStatutoryDraft(answers, fallbackLegalName),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /** Keys currently in flight. `pan` is a key here too. */
  const [checking, setChecking] = React.useState<readonly string[]>([]);
  /**
   * A refusal that belongs to the application rather than to one field.
   *
   * The verification service pauses an application that has been shown three
   * different values for the same check (`checkForValueShopping`) and rate-limits
   * five attempts a day. Neither is "that box is wrong" — rendering either as a
   * red line under an input tells someone to correct a GSTIN that is already
   * correct, when what has actually happened is that their application is on
   * hold and a human is going to call them.
   */
  const [refusal, setRefusal] = React.useState<string | null>(null);
  /** Key → the pending automatic retry. One interval drives all of them. */
  const [retries, setRetries] = React.useState<
    Record<string, { attempt: number; secondsLeft: number }>
  >({});
  /**
   * How many automatic retries each key has already had. A ref, not state: the
   * interval removes the key from `retries` at the moment it fires, so the
   * count cannot be read back out of it — and a counter that resets on every
   * retry is a retry loop that never ends.
   */
  const retriesUsed = React.useRef<Record<string, number>>({});

  const cinRule = fields.find((f) => f.fieldCode === 'cin');
  const cinRequired = cinRule?.required ?? false;

  const isChecking = (key: string): boolean => checking.includes(key);

  const setError = (key: string, message?: string): void =>
    setErrors((e) => {
      const { [key]: _dropped, ...rest } = e;
      return message ? { ...rest, [key]: message } : rest;
    });

  /* ------------------------------------------------------------- verifying */

  // The latest values, readable from a timer callback that closed over an older
  // render. A retry that fires against a stale GSTIN checks the wrong number.
  const latest = React.useRef(values);
  latest.current = values;

  /**
   * The one place the draft is written.
   *
   * A verification writes it too, not only a blur: an applicant who checks two
   * GSTINs and closes the tab must come back to two verified GSTINs, and a draft
   * saved only on blur loses whichever answer the portal returned last.
   */
  const persist = (next: StatutoryValues): void => {
    latest.current = next;
    onSaveDraft(toDraft(next), completionOf(next, cinRequired));
  };

  const runCheck = async (key: string): Promise<void> => {
    const current = latest.current;
    const row = key === 'pan' ? null : current.gstins.find((r) => r.key === key);
    if (key !== 'pan' && !row) return;

    setChecking((c) => (c.includes(key) ? c : [...c, key]));
    setError(key, undefined);

    const result =
      key === 'pan'
        ? await verifyPan({
            pan: toPan(current.pan),
            expectedName: current.legalName || undefined,
            // VR-008: the 4th character of a PAN encodes the holder type, and
            // the server refuses a PAN that contradicts the constitution —
            // naming both, which is the message worth having.
            entityType: constitution ?? undefined,
          })
        : await verifyGstin({
            gstin: toGstin(row?.gstin ?? ''),
            expectedLegalName: current.legalName || undefined,
            expectedPan: toPan(current.pan) || undefined,
          });

    setChecking((c) => c.filter((k) => k !== key));

    if (!result.ok) {
      // A 400 from the server names the field. A 409 or a 429 is about the
      // application, not the value, and goes to the banner. Everything else is
      // still a sentence — never a status code on its own.
      if (result.status === 409 || result.status === 429) setRefusal(result.message);
      else setError(key, result.fields[key === 'pan' ? 'pan' : 'gstin'] ?? result.message);
      return;
    }

    setRefusal(null);

    const view = result.data;

    const next: StatutoryValues =
      key === 'pan'
        ? { ...current, panOutcome: view, panDeferred: false }
        : {
            ...current,
            gstins: current.gstins.map((r) =>
              r.key === key
                ? // A fresh outcome invalidates a confirmation of the old one.
                  { ...r, outcome: view, confirmed: false, deferred: false }
                : r,
            ),
          };
    setValues(next);
    persist(next);

    const used = retriesUsed.current[key] ?? 0;
    const wait = isProviderProblem(view) ? RETRY_AFTER_SECONDS[used] : undefined;
    // Out of retries: the panel switches to "continue anyway" rather than
    // looping forever against a portal that is plainly down.
    if (wait !== undefined) retriesUsed.current[key] = used + 1;
    setRetries((r) => {
      const { [key]: _pending, ...rest } = r;
      return wait === undefined
        ? rest
        : { ...rest, [key]: { attempt: used + 1, secondsLeft: wait } };
    });
  };

  const runCheckRef = React.useRef(runCheck);
  runCheckRef.current = runCheck;

  /**
   * The countdown, and the retry it ends in.
   *
   * One effect with two arms rather than an interval that fires checks from
   * inside a state updater: a `setState` updater has to be pure, and calling a
   * verification from one is how a retry ends up running twice or not at all.
   * Each pass either dispatches the checks that have reached zero or schedules
   * one more second — and it counts down **on screen**, because an automatic
   * retry the applicant cannot see is indistinguishable from nothing happening,
   * which is what makes people re-submit and burn their own attempts.
   */
  React.useEffect(() => {
    const due = Object.entries(retries)
      .filter(([, pending]) => pending.secondsLeft <= 0)
      .map(([key]) => key);

    if (due.length > 0) {
      setRetries((current) => {
        const next = { ...current };
        for (const key of due) delete next[key];
        return next;
      });
      // Re-added by `runCheck` if the portal is still down, which is what
      // advances the attempt counter towards the "continue anyway" arm.
      for (const key of due) void runCheckRef.current(key);
      return undefined;
    }

    if (Object.keys(retries).length === 0) return undefined;
    const id = setTimeout(
      () =>
        setRetries((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, pending]) => [
              key,
              { ...pending, secondsLeft: pending.secondsLeft - 1 },
            ]),
          ),
        ),
      1000,
    );
    return () => clearTimeout(id);
  }, [retries]);

  /** Whether this key has spent its automatic retries and is still unreachable. */
  const exhausted = (key: string, view: VerificationOutcomeView | null): boolean =>
    Boolean(view && isProviderProblem(view)) && !retries[key] && !isChecking(key);

  /* ---------------------------------------------------------------- editing */

  const saveOnBlur = (): void => persist(values);

  const setRow = (key: string, patch: Partial<GstinRow>): void =>
    setValues((v) => ({
      ...v,
      gstins: v.gstins.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    }));

  const editGstin = (key: string, raw: string): void => {
    setError(key, undefined);
    // Editing the number throws away the answer that belonged to the old one.
    setRow(key, { gstin: raw.toUpperCase(), outcome: null, confirmed: false, deferred: false });
    retriesUsed.current[key] = 0;
    setRetries((r) => {
      const { [key]: _dropped, ...rest } = r;
      return rest;
    });
  };

  const addGstin = (): void =>
    setValues((v) => ({ ...v, gstins: [...v.gstins, emptyRow()] }));

  const removeGstin = (key: string): void => {
    const rows = values.gstins.filter((r) => r.key !== key);
    const next = { ...values, gstins: rows.length > 0 ? rows : [emptyRow()] };
    setValues(next);
    // Written through, not left to the next blur: a removed registration that
    // comes back on reload is the same broken promise as a lost answer.
    persist(next);
  };

  /** Exactly one primary, and never one nobody chose. */
  const makePrimary = (key: string): void => {
    const next = {
      ...values,
      gstins: values.gstins.map((r) => ({ ...r, isPrimary: r.key === key })),
    };
    setValues(next);
    setError('primary', undefined);
    persist(next);
  };

  /* -------------------------------------------------------------- verifying */

  /** The pre-flight. Nothing reaches the portal that cannot be a GSTIN. */
  const checkGstinLocally = (row: GstinRow): string | undefined =>
    validateGstin(row.gstin) ?? gstinPanConflict(row.gstin, values.pan);

  const verifyRow = (row: GstinRow): void => {
    const local = checkGstinLocally(row);
    if (local) {
      setError(row.key, local);
      return;
    }
    void runCheck(row.key);
  };

  const verifyThePan = (): void => {
    const local = validatePan(values.pan);
    if (local) {
      setError('pan', local);
      return;
    }
    void runCheck('pan');
  };

  /* ----------------------------------------------------------------- submit */

  const check = (): Record<string, string> => {
    const found: Record<string, string> = {};

    const panShape = validatePan(values.pan);
    if (panShape) found.pan = panShape;
    else if (!panSettled(values))
      found.pan = 'Verify this PAN before you continue — it takes a few seconds.';

    for (const row of values.gstins) {
      const local = checkGstinLocally(row);
      if (local) found[row.key] = local;
      else if (row.outcome?.outcome === 'FAIL')
        found[row.key] = 'The portal refused this GSTIN. Correct it or remove it.';
      else if (row.outcome?.outcome === 'MISMATCH')
        found[row.key] =
          'This GSTIN is registered to a different name. Correct the number, or your legal name on the previous step.';
      else if (row.outcome?.outcome === 'PASS' && !row.confirmed)
        // Verified is not the same as unanswered. Saying "verify this" about a
        // GSTIN the portal has already confirmed sends them to the wrong button.
        found[row.key] =
          'Confirm that the name the GST portal returned above is your business.';
      else if (!rowSettled(row)) found[row.key] = 'Verify this GSTIN before you continue.';
    }

    if (!values.gstins.some((r) => r.isPrimary))
      found.primary =
        'Choose which registration we invoice. It sets the billing entity and the tax split on every order.';

    if (cinRule) {
      const cin = validateCin(values.cin, cinRequired);
      if (cin) found.cin = cin;
    }

    return found;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = check();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const refusal = await onContinue(toDraft(values), 100);
    if (refusal) setErrors(refusal);
  };

  /* ------------------------------------------------------------------ render */

  const settledCount = values.gstins.filter(rowSettled).length;
  const panType = panHolderType(values.pan);

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      )}

      {refusal && (
        <div role="alert" className="flex flex-col gap-2 rounded border border-warn bg-sheet-2 p-4">
          <StatusPill className="self-start" tone="warn" label="Checks paused" />
          <p className="text-body-sm text-ink-2">{refusal}</p>
          <p className="text-body-sm text-ink-2">
            Nothing you have entered is lost, and the answers already verified stay verified.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- PAN */}
      <FormSection
        title="PAN"
        description="The permanent account number of the entity we invoice. Every GSTIN you add below has to belong to it."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <Input
              className="w-full"
              label="PAN"
              mono
              maxLength={10}
              autoComplete="off"
              required
              hint={
                panType
                  ? `The fourth character says this PAN belongs to a ${panType.toLowerCase().replace(/_/g, ' ')}.`
                  : 'Ten characters, as printed on the card — five letters, four digits, one letter.'
              }
              value={values.pan}
              onFocus={() => onFieldFocus('PAN')}
              onBlur={() => saveOnBlur()}
              onChange={(e) => {
                setError('pan', undefined);
                retriesUsed.current.pan = 0;
                setValues((v) => ({
                  ...v,
                  pan: e.target.value.toUpperCase(),
                  panOutcome: null,
                  panDeferred: false,
                }));
              }}
              error={errors.pan}
              // Not `verifyState="verifying"`: `Input` renders its own
              // "Checking…" line, and the panel below already names the provider
              // and says how long it usually takes. `readOnly` is the half of
              // that state worth keeping — the value must not change mid-check.
              readOnly={isChecking('pan')}
              verifyState={values.panOutcome?.outcome === 'PASS' ? 'verified' : 'idle'}
            />
          </div>
          {values.panOutcome?.outcome !== 'PASS' && !values.panDeferred && (
            <Button
              type="button"
              variant="secondary"
              className="sm:mt-7"
              loading={isChecking('pan')}
              onClick={verifyThePan}
            >
              Verify PAN
            </Button>
          )}
        </div>

        <CheckOutcome
          view={values.panOutcome}
          checking={isChecking('pan')}
          provider="the income-tax PAN service"
          deferred={values.panDeferred}
          retryIn={retries.pan?.secondsLeft}
          retryAttempt={retries.pan?.attempt}
          exhausted={exhausted('pan', values.panOutcome)}
          onRetryNow={() => void runCheck('pan')}
          onDefer={() => {
            const next = { ...values, panDeferred: true };
            setValues(next);
            persist(next);
          }}
          claimedName={values.legalName}
        >
          <dl className="flex flex-col gap-2 text-body-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-3">Held by</dt>
              <dd className="text-ink">
                {(values.panOutcome?.resolved as PanHolder | undefined)?.name ?? 'Not returned'}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-3">Type</dt>
              <dd className="text-ink">
                {(values.panOutcome?.resolved as PanHolder | undefined)?.holderType ??
                  'Not returned'}
              </dd>
            </div>
          </dl>
        </CheckOutcome>
      </FormSection>

      {/* ----------------------------------------------------------- GSTINs */}
      <FormSection
        title="GST registrations"
        description="Add every registration you want to buy against. Each one is checked against the GST portal on its own."
        status={
          <>
            <span className="tnum">{settledCount}</span> of{' '}
            <span className="tnum">{values.gstins.length}</span> confirmed
          </>
        }
      >
        {values.gstins.map((row, index) => {
          const taxpayer = row.outcome ? resolvedGstin(row.outcome) : {};
          const passed = row.outcome?.outcome === 'PASS';
          return (
            <div
              key={row.key}
              data-testid="gstin-row"
              className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <Input
                    className="w-full"
                    label={`GSTIN ${index + 1}`}
                    mono
                    maxLength={15}
                    autoComplete="off"
                    required
                    hint="Fifteen characters from your registration certificate, e.g. 06ABCCE1234F6Z1."
                    value={row.gstin}
                    onFocus={() => onFieldFocus('Statutory')}
                    onBlur={() => saveOnBlur()}
                    onChange={(e) => editGstin(row.key, e.target.value)}
                    error={errors[row.key]}
                    readOnly={isChecking(row.key)}
                    verifyState={passed ? 'verified' : 'idle'}
                  />
                </div>
                {!passed && !row.deferred && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="sm:mt-7"
                    loading={isChecking(row.key)}
                    onClick={() => verifyRow(row)}
                  >
                    Verify
                  </Button>
                )}
                {values.gstins.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="sm:mt-7"
                    onClick={() => removeGstin(row.key)}
                  >
                    Remove
                  </Button>
                )}
              </div>

              <CheckOutcome
                view={row.outcome}
                checking={isChecking(row.key)}
                provider="the GST portal"
                deferred={row.deferred}
                retryIn={retries[row.key]?.secondsLeft}
                retryAttempt={retries[row.key]?.attempt}
                exhausted={exhausted(row.key, row.outcome)}
                onRetryNow={() => void runCheck(row.key)}
                onDefer={() => {
                  const next = {
                    ...values,
                    gstins: values.gstins.map((r) =>
                      r.key === row.key ? { ...r, deferred: true } : r,
                    ),
                  };
                  setValues(next);
                  persist(next);
                  setRetries((r) => {
                    const { [row.key]: _dropped, ...rest } = r;
                    return rest;
                  });
                }}
                claimedName={values.legalName}
              >
                {/* The name is the point. It is the largest thing in the panel
                    because it is what the applicant is being asked to read. */}
                <p className="text-h3 text-ink">{taxpayer.legalName ?? 'Name not returned'}</p>
                <dl className="flex flex-col gap-2 text-body-sm">
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-ink-3">Trade name</dt>
                    <dd className="text-ink">{taxpayer.tradeName ?? 'Not returned'}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-ink-3">Status</dt>
                    <dd className="text-ink">{taxpayer.status ?? 'Not returned'}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-ink-3">State code</dt>
                    <dd className="tnum text-ink">{taxpayer.stateCode ?? 'Not returned'}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-ink-3">Registered since</dt>
                    <dd className="tnum text-ink">
                      {formatPortalDate(taxpayer.registrationDate)}
                    </dd>
                  </div>
                  {taxpayer.principalAddress && (
                    <div className="flex flex-col gap-1">
                      <dt className="text-ink-3">Principal place of business</dt>
                      <dd className="text-ink">{taxpayer.principalAddress}</dd>
                    </div>
                  )}
                </dl>
                <Checkbox
                  label="Yes, this is our business"
                  consequence="Invoices raised against this GSTIN will carry the name above. Confirming it is what lets us bill you."
                  checked={row.confirmed}
                  onChange={(confirmed) => {
                    setRow(row.key, { confirmed });
                    setError(row.key, undefined);
                  }}
                />
              </CheckOutcome>
            </div>
          );
        })}

        <div>
          <Button type="button" variant="ghost" onClick={addGstin}>
            Add another GSTIN
          </Button>
        </div>
      </FormSection>

      {/* ---------------------------------------------------------- primary */}
      <FormSection
        title="Which one do we invoice?"
        description="The primary registration decides the billing entity on every invoice and whether the tax is IGST or CGST plus SGST. The right-hand rail explains what changes if it is wrong."
      >
        <fieldset
          className="flex flex-col gap-2"
          onFocus={() => onFieldFocus('Primary GSTIN')}
          aria-describedby={errors.primary ? 'primary-gstin-error' : undefined}
        >
          <legend className="sr-only">Primary GSTIN</legend>
          {values.gstins.map((row) => {
            const usable = validateGstin(row.gstin) === undefined;
            return (
              <label
                key={row.key}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded border-l-2 px-4 py-2 ${
                  // The amber marker is an active state, which is one of the
                  // three things the accent is allowed to mean.
                  row.isPrimary ? 'border-acc bg-sheet-2' : 'border-rule'
                }`}
              >
                <input
                  type="radio"
                  name="primary-gstin"
                  className="h-4 w-4 accent-acc"
                  value={row.gstin}
                  checked={row.isPrimary}
                  onChange={() => makePrimary(row.key)}
                  disabled={!usable}
                />
                <span className="font-mono tnum text-body-sm text-ink">
                  {toGstin(row.gstin) || 'Not entered yet'}
                </span>
                {row.outcome?.outcome === 'PASS' ? (
                  <span className="text-body-sm text-ink-2">
                    {resolvedGstin(row.outcome).legalName ?? ''}
                  </span>
                ) : (
                  usable && <span className="text-body-sm text-ink-4">Not verified</span>
                )}
              </label>
            );
          })}
          {errors.primary && (
            <p id="primary-gstin-error" className="text-body-sm text-fail" role="alert">
              {errors.primary}
            </p>
          )}
          <p className="text-body-sm text-ink-2">
            Nothing is chosen for you here. Changing it later needs a reviewer, because it changes
            how you are invoiced from that point on.
          </p>
        </fieldset>
      </FormSection>

      {/* -------------------------------------------- constitution-gated fields */}
      {cinRule && (
        <FormSection title="Incorporation">
          <Input
            label={cinRule.label}
            mono
            maxLength={21}
            required={cinRequired}
            hint={cinRule.helpText ?? '21 characters, from your certificate of incorporation.'}
            value={values.cin}
            onFocus={() => onFieldFocus('Statutory')}
            onBlur={() => saveOnBlur()}
            onChange={(e) => {
              setError('cin', undefined);
              setValues((v) => ({ ...v, cin: e.target.value.toUpperCase() }));
            }}
            error={errors.cin}
          />
        </FormSection>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Save and continue
        </Button>
        <Button type="button" variant="ghost" onClick={saveOnBlur}>
          Save and finish later
        </Button>
      </div>
    </form>
  );
}
