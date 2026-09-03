'use client';

import * as React from 'react';
import { Button, FormSection, Input, StatusPill, type WhyRailItem } from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import {
  commitBankAccount,
  pennyDrop,
  type BankAccountHolder,
  type FieldRequirement,
  type KycDocument,
  type VerificationOutcomeView,
} from '../../register/api';
import { DocumentChecklist, missingDocuments } from '../../register/DocumentChecklist';
import { ACCOUNT_TYPES, VENDOR_DOCUMENTS } from '../../register/picklists';
import {
  toAccountNumber,
  toIfsc,
  validateAccountHolderName,
  validateAccountNumber,
  validateIfsc,
} from '../../register/validation';
import { ProviderProblem, isProviderProblem, useRetryLadder } from '../../register/verification';

/**
 * Vendor step 6 — DOCUMENTS_BANK.
 *
 * Two halves that belong on one screen because they check each other: the
 * cancelled cheque above carries the account number, the IFSC and the holder
 * name, and the penny-drop below asks the bank whether that is really the
 * account. A reviewer compares the two.
 *
 * **The checklist is `DocumentChecklist`**, the same component the buyer's step
 * 5 uses. Nine document types where a buyer has four, and that is the only
 * difference — every rule about each of them is `document_type_rule` data.
 *
 * **The penny-drop is the same three-outcome problem as the GSTIN check**, and
 * it is answered the same way: a PASS shows the name the *bank* returned, which
 * is the only thing on this screen that can catch a supplier pasting their
 * brother-in-law's account; a MISMATCH is never rendered as a pass, because a
 * name that is not theirs is the most useful signal here; and a bank that did
 * not answer is our problem — it costs them no attempt, it retries on a visible
 * countdown, and it never says "check your details".
 *
 * **Committing the account is a separate act, and the screen says what it
 * does.** `POST /onboarding/bank-account` writes the account, starts a payout
 * freeze and alerts the org's owner on every channel they hold. That is an
 * anti-account-takeover control rather than processing time, and a supplier
 * surprised by it rings support — so it is stated before they press the button
 * and confirmed with the real instant afterwards.
 */

export const WHY_DOCUMENTS_BANK: readonly WhyRailItem[] = [
  {
    term: 'Documents',
    explanation:
      'Checked by contents, not filename. Shown only to your reviewer and kept for the tax retention period.',
  },
  {
    term: 'The payout account',
    explanation:
      'We send one rupee and the bank returns the account holder name. Payouts only go to an account in your business name.',
  },
  {
    term: 'The payout freeze',
    explanation:
      'New or changed accounts are frozen briefly and the organisation owner is notified — an anti-takeover control, not a processing delay.',
  },
];

/* ==========================================================================
 * Draft shape
 * ======================================================================== */

export interface BankValues {
  accountHolderName: string;
  /**
   * **Last four digits only.** The draft is a JSON column a reviewer and a
   * support agent can both read; a full account number written there is a
   * plaintext copy of the thing `bank_account.account_number_enc` exists to
   * encrypt. The number itself lives in this component's state for as long as
   * the applicant is on the step, and nowhere else.
   */
  accountLast4: string;
  ifsc: string;
  accountType: string;
  /** The outcome of the check, kept so a resumed step does not re-run it. */
  pennyDropOutcome: string | null;
  /** The name the bank returned. What makes a tick trustworthy. */
  bankHolderName: string;
  bankName: string;
  /** Set once the account is committed. Until then nothing has been written. */
  bankAccountId: string | null;
  frozenUntil: string | null;
  alertedVia: string[];
}

const EMPTY: BankValues = {
  accountHolderName: '',
  accountLast4: '',
  ifsc: '',
  accountType: 'CURRENT',
  pennyDropOutcome: null,
  bankHolderName: '',
  bankName: '',
  bankAccountId: null,
  frozenUntil: null,
  alertedVia: [],
};

const str = (a: Record<string, unknown>, key: string, fallback: string): string =>
  typeof a[key] === 'string' ? (a[key] as string) : fallback;

export function readBankDraft(answers: Record<string, unknown>): BankValues {
  return {
    accountHolderName: str(answers, 'accountHolderName', ''),
    accountLast4: str(answers, 'accountLast4', ''),
    ifsc: str(answers, 'ifsc', ''),
    accountType: str(answers, 'accountType', EMPTY.accountType),
    pennyDropOutcome:
      typeof answers.pennyDropOutcome === 'string' ? answers.pennyDropOutcome : null,
    bankHolderName: str(answers, 'bankHolderName', ''),
    bankName: str(answers, 'bankName', ''),
    bankAccountId: typeof answers.bankAccountId === 'string' ? answers.bankAccountId : null,
    frozenUntil: typeof answers.frozenUntil === 'string' ? answers.frozenUntil : null,
    alertedVia: Array.isArray(answers.alertedVia)
      ? (answers.alertedVia as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
  };
}

/** The resolved account, as far as this screen reads it. */
const holderFrom = (view: VerificationOutcomeView | null): BankAccountHolder =>
  (view?.resolved as BankAccountHolder | undefined) ?? {};

const formatWhen = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The one key the retry ladder needs: there is one account on this step. */
const BANK = 'bank';

const labelNote = (text: string, note: string): React.ReactNode => (
  <>
    {text}{' '}
    <span className="text-label font-normal text-ink-3">({note})</span>
  </>
);

/* ==========================================================================
 * The outcome panel
 * ======================================================================== */

interface BankOutcomeProps {
  view: VerificationOutcomeView | null;
  checking: boolean;
  claimedName: string;
  retryIn?: number;
  retryAttempt?: number;
  exhausted: boolean;
  onRetryNow: () => void;
}

function BankOutcome({
  view,
  checking,
  claimedName,
  retryIn,
  retryAttempt,
  exhausted,
  onRetryNow,
}: BankOutcomeProps): React.JSX.Element {
  if (checking) {
    return (
      <div
        className="flex flex-col gap-2 rounded border border-rule bg-sheet-2 p-4"
        role="status"
        aria-live="polite"
      >
        <StatusPill className="self-start" tone="processing" label="Checking" />
        <p className="text-body-sm text-ink-2">One-rupee check with your bank. Usually a few seconds.</p>
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
        provider="The bank"
        {...(retryIn === undefined ? {} : { retryIn })}
        {...(retryAttempt === undefined ? {} : { retryAttempt })}
        exhausted={exhausted}
        onRetryNow={onRetryNow}
      />
    );
  }

  const holder = holderFrom(view);

  /* ------------------------------------------------------------ their problem */
  if (view.outcome === 'FAIL') {
    return (
      <div className="flex flex-col gap-3 rounded border border-fail bg-sheet-2 p-4">
        <StatusPill className="self-start" tone="fail" label="Refused" />
        <p className="text-body-sm text-fail" role="alert">
          {view.message}
        </p>
        {holder.beneficiaryName && (
          <dl className="flex flex-col gap-2 border-t border-rule-2 pt-3 text-body-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-3">The bank holds it as</dt>
              <dd className="text-ink">{holder.beneficiaryName}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-3">What you entered</dt>
              <dd className="text-ink">{claimedName || 'Nothing to compare against'}</dd>
            </div>
          </dl>
        )}
        <p className="text-body-sm text-ink-2">
          Correct the details and check again.{' '}
          <span className="tnum text-ink">{view.attemptsRemaining}</span> of{' '}
          <span className="tnum text-ink">5</span> checks left today.
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------ MISMATCH */
  if (view.outcome === 'MISMATCH') {
    return (
      <div className="flex flex-col gap-3 rounded border border-warn bg-sheet-2 p-4">
        {/* Never "Verified", never a tick, and never green. The two names are
            close but not the same, and that is exactly the case a pass would
            hide. */}
        <StatusPill className="self-start" tone="warn" label="Held in a different name" />
        <p className="text-body-sm text-ink-2" role="alert">
          {view.message}
        </p>
        <dl className="flex flex-col gap-2 border-t border-rule-2 pt-3 text-body-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">The bank holds it as</dt>
            <dd className="text-ink">{holder.beneficiaryName ?? 'Not returned'}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">What you entered</dt>
            <dd className="text-ink">{claimedName || 'Nothing to compare against'}</dd>
          </div>
          {view.matchScore !== undefined && (
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-3">How close</dt>
              <dd className="font-mono text-data tnum text-ink">
                {Math.round(view.matchScore * 100)}% of a full match — we need{' '}
                <span className="tnum">90%</span>
              </dd>
            </div>
          )}
        </dl>
        <p className="text-body-sm text-ink-2">
          Enter the name exactly as the bank holds it, or use an account in your business name.
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------------- PASS */
  return (
    <div className="flex flex-col gap-3 rounded border border-pass bg-sheet-2 p-4">
      <StatusPill className="self-start" tone="pass" label="Verified" />
      {/* The name is the point. It is the largest thing in the panel because it
          is what the applicant is being asked to read. */}
      <p className="text-h3 text-ink">{holder.beneficiaryName ?? 'Name not returned'}</p>
      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex flex-wrap gap-2">
          <dt className="text-ink-3">Bank</dt>
          <dd className="text-ink">
            {holder.bankName ?? <span className="text-ink-4">Not returned</span>}
            {holder.branch ? ` — ${holder.branch}` : ''}
          </dd>
        </div>
        {holder.creditReference && (
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-3">Credit reference</dt>
            <dd className="font-mono text-data tnum text-ink">{holder.creditReference}</dd>
          </div>
        )}
      </dl>
      <p className="text-body-sm text-ink-2">Every payout goes to this account.</p>
    </div>
  );
}

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepDocumentsBankProps {
  answers: Record<string, unknown>;
  /** The legal name the penny-drop is scored against, carried from step 2. */
  legalName: string;
  /** `onboarding_field_requirement` for this step. Today: `board_resolution`. */
  fields?: readonly FieldRequirement[];
  /**
   * The org's constitution, or step 2's answer where the org has none.
   *
   * The seed gates `board_resolution` to PVT_LTD and LTD, and the gate reads
   * `organization.constitution` — which no step promotion has ever written, so
   * it is null and the rule comes back optional for a company that plainly needs
   * one. Where the applicant has told us on step 2, that answer is used.
   */
  constitution?: string | null;
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

export function StepDocumentsBank({
  answers,
  legalName,
  fields = [],
  constitution,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepDocumentsBankProps): React.JSX.Element {
  const [values, setValues] = React.useState<BankValues>(() => {
    const draft = readBankDraft(answers);
    return draft.accountHolderName ? draft : { ...draft, accountHolderName: legalName };
  });
  /** Never in the draft, never saved. See `BankValues.accountLast4`. */
  const [accountNumber, setAccountNumber] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [docs, setDocs] = React.useState<readonly KycDocument[]>([]);
  const [outcome, setOutcome] = React.useState<VerificationOutcomeView | null>(null);
  const [checking, setChecking] = React.useState(false);
  /** A refusal about the application rather than about a field. */
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [committing, setCommitting] = React.useState(false);

  const runCheckRef = React.useRef<(key: string) => Promise<void>>(async () => {});
  const retry = useRetryLadder((key) => void runCheckRef.current(key));

  /**
   * `board_resolution` is seeded on this step and gated to PVT_LTD and LTD.
   *
   * The server's answer would be authoritative if it could see the constitution
   * — but no step promotion has ever written `organization.constitution`, so the
   * gate is evaluated against null and returns "optional" for a private limited
   * company that plainly needs one. Step 2's answer is the same fact and is what
   * this org actually told us, so it wins while the promotion is missing. When
   * one lands, `rule.required` is right again and this fallback deletes itself.
   */
  const wanted = React.useMemo(() => {
    const rule = fields.find((f) => f.fieldCode === 'board_resolution');
    // The seed's own gate: a company signs by resolution, a proprietor does not.
    const byConstitution = constitution ? ['PVT_LTD', 'LTD'].includes(constitution) : undefined;
    const required = byConstitution ?? rule?.required;
    if (required === undefined) return VENDOR_DOCUMENTS;
    return VENDOR_DOCUMENTS.map((d) =>
      d.docType === 'BOARD_RESOLUTION' ? { ...d, required } : d,
    );
  }, [fields, constitution]);

  const clearError = React.useCallback(
    (key: string): void =>
      setErrors((e) => {
        const { [key]: _dropped, ...rest } = e;
        return rest;
      }),
    [],
  );

  const persist = React.useCallback(
    (next: BankValues, held: readonly KycDocument[]): void => {
      onSaveDraft({ ...next }, completionOf(next, wanted, held));
    },
    [onSaveDraft, wanted],
  );

  /**
   * Anything about the account changing throws away the answer that belonged to
   * the old one — and the commitment, if there was one, is stale too.
   */
  const invalidate = (patch: Partial<BankValues>): void => {
    setOutcome(null);
    retry.clear(BANK);
    setRefusal(null);
    setValues((v) => ({
      ...v,
      ...patch,
      pennyDropOutcome: null,
      bankHolderName: '',
      bankName: '',
    }));
  };

  /* ----------------------------------------------------------- the check */

  const runCheck = async (): Promise<void> => {
    const found: Record<string, string> = {};
    const nameProblem = validateAccountHolderName(values.accountHolderName);
    const numberProblem = validateAccountNumber(accountNumber);
    const ifscProblem = validateIfsc(values.ifsc);
    if (nameProblem) found.accountHolderName = nameProblem;
    if (numberProblem) found.accountNumber = numberProblem;
    if (ifscProblem) found.ifsc = ifscProblem;
    if (Object.keys(found).length > 0) {
      setErrors((e) => ({ ...e, ...found }));
      return;
    }

    setErrors({});
    setChecking(true);
    const result = await pennyDrop({
      accountNumber: toAccountNumber(accountNumber),
      ifsc: toIfsc(values.ifsc),
      expectedName: values.accountHolderName.trim(),
    });
    setChecking(false);

    if (!result.ok) {
      // A 409 or a 429 is about the application, not about the number typed
      // into a box — value-shopping on a payout account pauses the application,
      // and a red line under a field would tell somebody to correct an account
      // number that is already correct.
      if (result.status === 409 || result.status === 429) setRefusal(result.message);
      else
        setErrors((e) => ({
          ...e,
          accountNumber: result.fields.accountNumber ?? result.message,
        }));
      return;
    }

    setRefusal(null);
    const view = result.data;
    setOutcome(view);
    const holder = holderFrom(view);
    const next: BankValues = {
      ...values,
      accountLast4: toAccountNumber(accountNumber).slice(-4),
      pennyDropOutcome: view.outcome,
      bankHolderName: holder.beneficiaryName ?? '',
      bankName: holder.bankName ?? '',
    };
    setValues(next);
    persist(next, docs);
    retry.note(BANK, view);
  };

  runCheckRef.current = async () => {
    await runCheck();
  };

  /* -------------------------------------------------------------- continue */

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};

    if (!skipValidation) {
      for (const missing of missingDocuments(wanted, docs))
        found[missing.docType] =
          `Upload the ${missing.docType.replace(/_/g, ' ').toLowerCase()} before you continue.`;

      if (outcome?.outcome !== 'PASS')
        found.bank =
          outcome === null
            ? 'Check the payout account before you continue. We send one rupee and the bank tells us whose account it is.'
            : 'We can only take an account the bank confirms is yours. Correct it and check again.';
    }

    if (Object.keys(found).length > 0) {
      setErrors((e) => ({ ...e, ...found }));
      return;
    }

    if (skipValidation) {
      const refused = await onContinue({ ...values }, 100);
      if (refused) setErrors(refused);
      return;
    }

    // Committing runs its own penny-drop server-side, so it spends a second of
    // the five daily attempts against this account. That is the price of the
    // freeze and the owner alert being one atomic act, and it is the API's
    // decision rather than this screen's.
    setCommitting(true);
    const committed = await commitBankAccount({
      accountNumber: toAccountNumber(accountNumber),
      ifsc: toIfsc(values.ifsc),
      accountHolderName: values.accountHolderName.trim(),
      accountType: values.accountType as 'CURRENT' | 'SAVINGS' | 'CC' | 'OD',
    });
    setCommitting(false);

    if (!committed.ok) {
      setRefusal(committed.message);
      return;
    }
    if (committed.data.verification.outcome !== 'PASS' || !committed.data.accountId) {
      // The server re-checked and got a different answer. Whatever it says is
      // what is true now, so the panel is replaced rather than argued with.
      setOutcome(committed.data.verification);
      setErrors((e) => ({
        ...e,
        bank: 'The bank answered differently on the second check. Read what it said and try again.',
      }));
      return;
    }

    const next: BankValues = {
      ...values,
      accountLast4: toAccountNumber(accountNumber).slice(-4),
      pennyDropOutcome: 'PASS',
      bankAccountId: committed.data.accountId,
      frozenUntil: committed.data.frozenUntil,
      alertedVia: committed.data.alertedVia,
    };
    setValues(next);

    const refused = await onContinue({ ...next }, 100);
    if (refused) setErrors(refused);
  };

  /* ------------------------------------------------------------------ view */

  const verified = outcome?.outcome === 'PASS';

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      )}

      <DocumentChecklist
        wanted={wanted}
        title="Documents"
        description=""
        compactHints
        errors={errors}
        onClearError={clearError}
        onDocsChange={setDocs}
        onFieldFocus={onFieldFocus}
        whyTerm="Documents"
      />

      <FormSection
        title="The account we pay into"
        status={
          verified ? (
            <StatusPill tone="pass" label="Bank confirmed" />
          ) : (
            <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">
              Not verified
            </span>
          )
        }
      >
        <div className="flex flex-col gap-4" onFocus={() => onFieldFocus('The payout account')}>
          <Input
            label={labelNote('Account holder name', 'as the bank holds it')}
            required
            value={values.accountHolderName}
            onChange={(e) => {
              clearError('accountHolderName');
              invalidate({ accountHolderName: e.target.value });
            }}
            onBlur={() => persist(values, docs)}
            error={errors.accountHolderName}
          />

          <Input
            label="Account number"
            mono
            required
            inputMode="numeric"
            autoComplete="off"
            value={accountNumber}
            onChange={(e) => {
              clearError('accountNumber');
              setAccountNumber(e.target.value);
              invalidate({ accountLast4: '' });
            }}
            error={errors.accountNumber}
          />

          <Input
            label={labelNote('IFSC', '11 characters, fifth is zero')}
            mono
            required
            value={values.ifsc}
            onChange={(e) => {
              clearError('ifsc');
              invalidate({ ifsc: e.target.value.toUpperCase() });
            }}
            onBlur={() => persist(values, docs)}
            error={errors.ifsc}
          />

          <Select
            label="Account type"
            required
            options={ACCOUNT_TYPES}
            value={values.accountType}
            onChange={(e) => {
              const next = { ...values, accountType: e.target.value };
              setValues(next);
              persist(next, docs);
            }}
          />

          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="secondary"
              loading={checking}
              onClick={() => void runCheck()}
            >
              {outcome ? 'Check again' : 'Check this account'}
            </Button>
          </div>

          <BankOutcome
            view={outcome}
            checking={checking}
            claimedName={values.accountHolderName}
            {...(retry.pending[BANK]
              ? {
                  retryIn: retry.pending[BANK].secondsLeft,
                  retryAttempt: retry.pending[BANK].attempt,
                }
              : {})}
            exhausted={retry.exhausted(BANK, outcome, checking)}
            onRetryNow={() => void runCheck()}
          />

          {errors.bank && (
            <p role="alert" className="text-body-sm text-fail">
              {errors.bank}
            </p>
          )}
        </div>
      </FormSection>

      {/* Said before the button is pressed, not after. A supplier who discovers
          the freeze from a payout that did not arrive rings support. */}
      <p className="text-body-sm text-ink-3">
        Save and continue re-checks the account, sets it for payouts, freezes it briefly, and
        notifies the organisation owner.
      </p>

      {values.frozenUntil && (
        <div className="flex flex-col gap-3 rounded border border-warn bg-sheet-2 p-4">
          <StatusPill className="self-start" tone="warn" label="Payouts frozen" />
          <dl className="flex flex-col gap-2 text-body-sm sm:flex-row sm:gap-8">
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                Frozen until
              </dt>
              <dd className="font-mono text-data tnum text-ink">
                {formatWhen(values.frozenUntil)}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                Owner told by
              </dt>
              <dd className="text-body-sm text-ink">
                {values.alertedVia.length > 0 ? (
                  values.alertedVia.join(', ').toLowerCase()
                ) : (
                  <span className="text-ink-4">Not recorded</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {refusal && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {refusal}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy || committing}>
          Save account and continue
        </Button>
        <Button type="button" variant="ghost" onClick={() => persist(values, docs)}>
          Save and finish later
        </Button>
      </div>
    </form>
  );
}

/** What `completion_pct` counts: every required document, plus a verified account. */
function completionOf(
  values: BankValues,
  wanted: readonly { docType: string; required: boolean }[],
  docs: readonly KycDocument[],
): number {
  const checks = [
    ...missingDocumentChecks(wanted, docs),
    values.accountHolderName.trim().length > 0,
    values.ifsc.trim().length > 0,
    values.pennyDropOutcome === 'PASS',
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

const missingDocumentChecks = (
  wanted: readonly { docType: string; required: boolean }[],
  docs: readonly KycDocument[],
): boolean[] =>
  wanted
    .filter((w) => w.required)
    .map((w) => docs.some((d) => d.docType === w.docType && d.status !== 'REJECTED'));
