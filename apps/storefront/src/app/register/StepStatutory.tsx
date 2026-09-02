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
  hasIdentifierRule,
  panHolderType,
  toGstin,
  toPan,
  validateGstin,
  validateIdentifier,
  validateIncorporationDate,
  validatePan,
} from './validation';
import { ProviderProblem, isProviderProblem, useRetryLadder } from './verification';

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
  /**
   * The registry identifiers, keyed by `field_code`. **Captured, never verified**
   * — see `CapturedFields` below for why that distinction is the whole section.
   */
  captured: Record<string, string>;
  gstins: GstinRow[];
}

/** Everything that differs in wording between the buyer and the vendor flow. */
export interface StatutoryCopy {
  panDescription: string;
  gstinDescription: string;
  confirmConsequence: string;
  primaryTitle: string;
  primaryDescription: string;
  primaryMissing: string;
  primaryNote: string;
}

export const BUYER_STATUTORY_COPY: StatutoryCopy = {
  panDescription:
    'The permanent account number of the entity we invoice. Every GSTIN you add below has to belong to it.',
  gstinDescription:
    'Add every registration you want to buy against. Each one is checked against the GST portal on its own.',
  confirmConsequence:
    'Invoices raised against this GSTIN will carry the name above. Confirming it is what lets us bill you.',
  primaryTitle: 'Which one do we invoice?',
  primaryDescription:
    'The primary registration decides the billing entity on every invoice and whether the tax is IGST or CGST plus SGST. The right-hand rail explains what changes if it is wrong.',
  primaryMissing:
    'Choose which registration we invoice. It sets the billing entity and the tax split on every order.',
  primaryNote:
    'Nothing is chosen for you here. Changing it later needs a reviewer, because it changes how you are invoiced from that point on.',
};

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
  fields: readonly FieldRequirement[] = [],
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
    // Each identifier is stored under its own `field_code` at the top level of
    // the draft, not nested — so `answers.STATUTORY.cin` keeps meaning what it
    // meant before this step learned about the other four.
    captured: Object.fromEntries(fields.map((f) => [f.fieldCode, str(f.fieldCode)])),
    gstins: rows.length > 0 ? rows : [emptyRow()],
  };
}

/** A check that is settled: verified, or knowingly left for a reviewer. */
const rowSettled = (row: GstinRow): boolean =>
  row.deferred || (row.outcome?.outcome === 'PASS' && row.confirmed);

const panSettled = (v: StatutoryValues): boolean =>
  v.panDeferred || v.panOutcome?.outcome === 'PASS';

/**
 * Three things have to be true, and `completion_pct` counts how many are. Every
 * identifier this org's constitution actually requires is one more.
 */
export function completionOf(
  values: StatutoryValues,
  fields: readonly FieldRequirement[],
  today: Date,
): number {
  const checks = [
    panSettled(values),
    values.gstins.some(rowSettled),
    values.gstins.some((r) => r.isPrimary),
    ...fields
      .filter((f) => f.required)
      .map((f) => capturedError(f, values.captured[f.fieldCode] ?? '', today) === undefined),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/** Only what the API should keep. The React key is regenerated on read. */
const toDraft = (values: StatutoryValues): Record<string, unknown> => ({
  legalName: values.legalName,
  pan: values.pan,
  panOutcome: values.panOutcome,
  panDeferred: values.panDeferred,
  ...values.captured,
  gstins: values.gstins.map(({ key: _key, ...row }) => row),
  primaryGstin: values.gstins.find((r) => r.isPrimary)?.gstin ?? null,
});

/* ==========================================================================
 * The registry identifiers — captured, and honestly not verified
 * ======================================================================== */

/**
 * `incorporation_date` is a date; everything else is a fixed-shape code.
 *
 * The list is `onboarding_field_requirement` data, so this only has to say how
 * to *render* a code, not which ones exist. A field seeded there tomorrow gets a
 * labelled text box and the same "captured" treatment without a release.
 */
const isDateField = (fieldCode: string): boolean => fieldCode.endsWith('_date');

function capturedError(
  field: FieldRequirement,
  value: string,
  today: Date,
): string | undefined {
  return isDateField(field.fieldCode)
    ? validateIncorporationDate(value, field.required, today)
    : validateIdentifier(field.fieldCode, value, field.required, field.label);
}

interface CapturedFieldsProps {
  fields: readonly FieldRequirement[];
  values: Record<string, string>;
  errors: Record<string, string>;
  onChange: (fieldCode: string, value: string) => void;
  onBlur: () => void;
  onFocus: () => void;
}

/**
 * **Nothing in this section is verified, and it says so once, at the top.**
 *
 * `CheckType` in `verification.service.ts` names UDYAM and CIN, but no route
 * exposes either and TAN is not in the union at all — so there is no answer this
 * screen could get back from a registry, and a tick beside one of these numbers
 * would mean "you typed something the right shape". A missing check renders as a
 * missing check: the shape is confirmed, the ownership is a reviewer's job, and
 * the sentence saying which is which sits above the fields rather than being
 * left for the applicant to infer from an absent tick.
 */
function CapturedFields({
  fields,
  values,
  errors,
  onChange,
  onBlur,
  onFocus,
}: CapturedFieldsProps): React.JSX.Element {
  return (
    <>
      <div className="flex flex-col gap-2 rounded border border-rule bg-sheet-2 p-4">
        <StatusPill className="self-start" tone="neutral" label="Recorded, not checked" />
        <p className="text-body-sm text-ink-2">
          We check the format of each number below, and nothing more. There is no registry
          look-up behind any of them yet, so none of them will show as verified — one of our
          reviewers confirms them against the certificate you upload later.
        </p>
      </div>

      {fields.map((field) => {
        const value = values[field.fieldCode] ?? '';
        const coded = hasIdentifierRule(field.fieldCode);
        return (
          <div key={field.fieldCode} className="flex flex-col gap-2">
            <Input
              label={field.label}
              required={field.required}
              mono={coded}
              type={isDateField(field.fieldCode) ? 'date' : 'text'}
              maxLength={coded ? 21 : undefined}
              autoComplete="off"
              hint={field.helpText ?? undefined}
              value={value}
              onFocus={onFocus}
              onBlur={onBlur}
              onChange={(e) =>
                onChange(field.fieldCode, coded ? e.target.value.toUpperCase() : e.target.value)
              }
              error={errors[field.fieldCode]}
            />
            {/* A missing value never renders as a passing one — and neither does
                an unverifiable one. This is the line that would otherwise be a
                tick. */}
            <p className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">
              {value.trim().length > 0 ? 'Captured — not verified' : 'Not provided'}
            </p>
          </div>
        );
      })}
    </>
  );
}

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
      <ProviderProblem
        view={view}
        provider={provider}
        {...(retryIn === undefined ? {} : { retryIn })}
        {...(retryAttempt === undefined ? {} : { retryAttempt })}
        exhausted={exhausted ?? false}
        onRetryNow={onRetryNow ?? (() => {})}
        {...(onDefer ? { onDefer } : {})}
      />
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
  /**
   * Already gated by constitution — CIN for a company, nothing for a proprietor.
   * Rendered as given: the server decides which apply and which are required.
   */
  fields?: readonly FieldRequirement[];
  /** Buyer or vendor wording. Everything else on this screen is identical. */
  copy: StatutoryCopy;
  onSaveDraft: (values: Record<string, unknown>, completionPct: number) => void;
  onContinue: (
    values: Record<string, unknown>,
    completionPct: number,
  ) => Promise<Record<string, string> | null>;
  busy: boolean;
  onFieldFocus: (term: string) => void;
  blockingReason?: string | null;
  skipValidation?: boolean;
}

export function StepStatutory({
  answers,
  fallbackLegalName = '',
  constitution,
  fields = [],
  copy,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepStatutoryProps): React.JSX.Element {
  const [values, setValues] = React.useState<StatutoryValues>(() =>
    readStatutoryDraft(answers, fallbackLegalName, fields),
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
  /**
   * The visible backoff, shared with step 6's penny-drop. One interval drives
   * every key — `pan` and one per GSTIN row.
   */
  /**
   * The latest `runCheck`, callable from the retry timer. Seeded empty and
   * assigned below on every render: the ladder is declared before the function
   * it fires, because the panel it drives is rendered before it too.
   */
  const runCheckRef = React.useRef<(key: string) => Promise<void>>(async () => {});
  const retry = useRetryLadder((key) => void runCheckRef.current(key));

  // Read once and passed in, so the date rule can be tested at a year boundary
  // rather than against whatever the clock says at the moment it runs.
  const today = React.useMemo(() => new Date(), []);

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
    onSaveDraft(toDraft(next), completionOf(next, fields, today));
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

    retry.note(key, view);
  };

  runCheckRef.current = runCheck;

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
    retry.clear(key);
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
      found.primary = copy.primaryMissing;

    for (const field of fields) {
      const problem = capturedError(field, values.captured[field.fieldCode] ?? '', today);
      if (problem) found[field.fieldCode] = problem;
    }

    return found;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = skipValidation ? {} : check();
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
        description={copy.panDescription}
      >
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
            retry.clear('pan');
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
          action={
            values.panOutcome?.outcome !== 'PASS' && !values.panDeferred ? (
              <Button
                type="button"
                variant="secondary"
                loading={isChecking('pan')}
                onClick={verifyThePan}
              >
                Verify PAN
              </Button>
            ) : undefined
          }
        />

        <CheckOutcome
          view={values.panOutcome}
          checking={isChecking('pan')}
          provider="the income-tax PAN service"
          deferred={values.panDeferred}
          retryIn={retry.pending.pan?.secondsLeft}
          retryAttempt={retry.pending.pan?.attempt}
          exhausted={retry.exhausted('pan', values.panOutcome, isChecking('pan'))}
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
        description={copy.gstinDescription}
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
                action={
                  !passed && !row.deferred || values.gstins.length > 1 ? (
                    <>
                      {!passed && !row.deferred && (
                        <Button
                          type="button"
                          variant="secondary"
                          loading={isChecking(row.key)}
                          onClick={() => verifyRow(row)}
                        >
                          Verify
                        </Button>
                      )}
                      {values.gstins.length > 1 && (
                        <Button type="button" variant="ghost" onClick={() => removeGstin(row.key)}>
                          Remove
                        </Button>
                      )}
                    </>
                  ) : undefined
                }
              />

              <CheckOutcome
                view={row.outcome}
                checking={isChecking(row.key)}
                provider="the GST portal"
                deferred={row.deferred}
                retryIn={retry.pending[row.key]?.secondsLeft}
                retryAttempt={retry.pending[row.key]?.attempt}
                exhausted={retry.exhausted(row.key, row.outcome, isChecking(row.key))}
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
                  retry.clear(row.key);
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
                  consequence={copy.confirmConsequence}
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
        title={copy.primaryTitle}
        description={copy.primaryDescription}
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
          <p className="text-body-sm text-ink-2">{copy.primaryNote}</p>
        </fieldset>
      </FormSection>

      {/* -------------------------------------------- constitution-gated fields */}
      {fields.length > 0 && (
        <FormSection
          title="Registry numbers"
          description="Which of these you are asked for depends on your constitution — a proprietorship is never asked for a CIN."
          status={
            <>
              <span className="tnum">
                {fields.filter((f) => (values.captured[f.fieldCode] ?? '').trim().length > 0).length}
              </span>{' '}
              of <span className="tnum">{fields.length}</span> provided
            </>
          }
        >
          <CapturedFields
            fields={fields}
            values={values.captured}
            errors={errors}
            onFocus={() => onFieldFocus('Registry numbers')}
            onBlur={saveOnBlur}
            onChange={(fieldCode, value) => {
              setError(fieldCode, undefined);
              setValues((v) => ({ ...v, captured: { ...v.captured, [fieldCode]: value } }));
            }}
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
