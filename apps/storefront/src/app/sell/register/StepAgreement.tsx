'use client';

import * as React from 'react';
import {
  Button,
  Checkbox,
  FormSection,
  Input,
  StatusPill,
  type WhyRailItem,
} from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import { Choice } from '../../register/Choice';
import {
  CYCLE_UNTIL_EARNED,
  LANGUAGES,
  MIN_PAYOUT_THRESHOLD_INR,
  PAYOUT_CYCLES,
  PRICING_MODES,
  VENDOR_AGREEMENTS,
  VENDOR_NOTIFICATION_CHANNELS,
} from '../../register/picklists';
import { validateCommissionRate, validatePayoutThreshold } from '../../register/validation';

/**
 * Vendor step 7 — AGREEMENT.
 *
 * **Nothing on this screen is e-signed, and it says so.** There is no e-sign
 * adapter anywhere in `apps/api/src/shared/adapters`; `AADHAAR_ESIGN` exists as
 * a string in a union and nothing implements it. What actually happens when a
 * supplier ticks a box here is that an acceptance is recorded — who, which
 * version, when. That is a real and useful record, and it is not a signature, so
 * the screen calls it what it is. A tick that claimed a legal signature had
 * occurred would be the exact failure this system is built to refuse.
 *
 * **Not one box starts ticked.** Four agreements and three notification
 * channels: seven checkboxes, and seven is precisely where a pre-ticked default
 * ships. An agreement that arrives pre-accepted is not an agreement, and
 * CP e-Comm Rule 4(9) says so as well.
 *
 * **A cycle a tier has not earned is said out loud.** Q6 makes T+2 the platform
 * default *once earned*, granted by tier — and every applicant on this screen is
 * brand new. Silently granting it would be a promise we break in three weeks;
 * silently refusing it would be a form that ignores what was asked. So the
 * request is recorded, and the screen says what will actually happen in the
 * meantime.
 */

export const WHY_AGREEMENT: readonly WhyRailItem[] = [
  {
    term: 'Agreements',
    explanation: (
      <>
        <span className="block">
          Four documents, and each one has teeth. The supplier agreement is what makes us the seller
          of record on your stock; the grading policy is what stops a disputed grade becoming an
          argument; the data-wipe undertaking is what lets a buyer&rsquo;s IT team accept a machine
          at all; and the returns policy is what happens when one comes back.
        </span>
        <span className="mt-2 block">
          We record your acceptance against the version you were shown. We do not have an e-signature
          provider connected, so nothing here is a digital signature — a reviewer checks your
          acceptance against the signed copy in your document pack.
        </span>
      </>
    ),
  },
  {
    term: 'How you are paid',
    explanation: (
      <>
        <span className="block">
          You can either name the amount you want per machine and let us price on top of it, or name
          the sale price you expect and the commission you are happy with.
        </span>
        <span className="mt-2 block">
          They come to the same rupee figure. The difference is which number you control — and
          whichever you pick, the payout is frozen the moment the purchase order is raised. Nothing
          that happens to the shelf price afterwards, a promotion included, changes what we owe you.
        </span>
      </>
    ),
  },
  {
    term: 'Payout cycle',
    explanation: (
      <>
        <span className="block">
          Every supplier starts on the weekly run. Faster settlement is earned rather than chosen —
          it is granted once a few consignments have been delivered and inspected without a claim,
          because a two-day cycle means paying you before the buyer&rsquo;s inspection window has
          closed.
        </span>
        <span className="mt-2 block">
          Ask for it here anyway. The request is recorded against your application and we write to
          you on the day it changes.
        </span>
      </>
    ),
  },
];

/* ==========================================================================
 * Draft shape
 * ======================================================================== */

export interface AgreementValues {
  /** Agreement code → accepted. A code that is absent has not been answered. */
  accepted: Record<string, boolean>;
  /** Who is accepting. Carried from step 1, editable — they may not be the signatory. */
  signatoryName: string;
  pricingMode: string | null;
  /** Only when `pricingMode` is COMMISSION. Percent. */
  commissionRate: string;
  payoutCycle: string | null;
  payoutThreshold: string;
  invoiceUploadRequired: boolean | null;
  channels: string[];
  language: string;
}

const EMPTY: AgreementValues = {
  accepted: {},
  signatoryName: '',
  pricingMode: null,
  commissionRate: '',
  payoutCycle: null,
  payoutThreshold: String(MIN_PAYOUT_THRESHOLD_INR),
  invoiceUploadRequired: null,
  channels: [],
  language: '',
};

const str = (a: Record<string, unknown>, key: string, fallback: string): string =>
  typeof a[key] === 'string' ? (a[key] as string) : fallback;

export function readAgreementDraft(answers: Record<string, unknown>): AgreementValues {
  const accepted =
    typeof answers.accepted === 'object' && answers.accepted !== null
      ? (answers.accepted as Record<string, boolean>)
      : {};
  return {
    // Read back as booleans, and only `true` counts. A truthy string in a draft
    // must never become an acceptance.
    accepted: Object.fromEntries(
      VENDOR_AGREEMENTS.map((a) => [a.code, accepted[a.code] === true]).filter(([, on]) => on),
    ) as Record<string, boolean>,
    signatoryName: str(answers, 'signatoryName', ''),
    pricingMode: typeof answers.pricingMode === 'string' ? answers.pricingMode : null,
    commissionRate: str(answers, 'commissionRate', ''),
    payoutCycle: typeof answers.payoutCycle === 'string' ? answers.payoutCycle : null,
    payoutThreshold: str(answers, 'payoutThreshold', EMPTY.payoutThreshold),
    invoiceUploadRequired:
      typeof answers.invoiceUploadRequired === 'boolean' ? answers.invoiceUploadRequired : null,
    channels: Array.isArray(answers.channels)
      ? (answers.channels as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    language: str(answers, 'language', ''),
  };
}

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepAgreementProps {
  answers: Record<string, unknown>;
  /** Step 1's contact name, as the default signatory. Editable. */
  fallbackSignatory: string;
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

export function StepAgreement({
  answers,
  fallbackSignatory,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepAgreementProps): React.JSX.Element {
  const [values, setValues] = React.useState<AgreementValues>(() => {
    const draft = readAgreementDraft(answers);
    return draft.signatoryName ? draft : { ...draft, signatoryName: fallbackSignatory };
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = (next: AgreementValues): void => {
    setValues(next);
    onSaveDraft({ ...next }, completionOf(next));
  };

  const clearError = (key: string): void =>
    setErrors((e) => {
      const { [key]: _dropped, ...rest } = e;
      return rest;
    });

  const acceptedCount = VENDOR_AGREEMENTS.filter((a) => values.accepted[a.code] === true).length;
  const commission = values.pricingMode === 'COMMISSION';

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};

    if (!skipValidation) {
      for (const agreement of VENDOR_AGREEMENTS) {
        if (values.accepted[agreement.code] !== true)
          found[agreement.code] =
            `We cannot buy from you without the ${agreement.label.toLowerCase()}. Read it and accept it, or tell us which part you cannot agree to.`;
      }
      if (!values.signatoryName.trim())
        found.signatoryName = 'Name the person accepting these. It goes on the record with the time.';
      if (!values.pricingMode) found.pricingMode = 'Choose how you want your price to be set.';
      if (commission) {
        const rate = validateCommissionRate(values.commissionRate);
        if (rate) found.commissionRate = rate;
      }
      if (!values.payoutCycle) found.payoutCycle = 'Choose how often you want to be paid.';
      const threshold = validatePayoutThreshold(values.payoutThreshold, MIN_PAYOUT_THRESHOLD_INR);
      if (threshold) found.payoutThreshold = threshold;
      if (values.invoiceUploadRequired === null)
        found.invoiceUploadRequired =
          'Tell us whether you raise your own invoice or want us to self-bill. Both are real answers.';
      if (values.channels.length === 0)
        found.channels =
          'Choose at least one way to reach you. We have to be able to send a purchase order.';
      if (!values.language) found.language = 'Choose the language for messages we send you.';
    }

    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    const refusal = await onContinue({ ...values }, 100);
    if (refusal) setErrors(refusal);
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => void submit(e)} noValidate>
      {blockingReason && (
        <p role="alert" className="rounded border border-fail bg-sheet-2 p-4 text-body-sm text-fail">
          {blockingReason}
        </p>
      )}

      {/* ------------------------------------------------------- agreements */}
      <FormSection
        title="What you are agreeing to"
        description="Four documents. Each one is a summary of what it commits you to — read them, and accept each one separately."
        status={
          <>
            <span className="tnum">{acceptedCount}</span> of{' '}
            <span className="tnum">{VENDOR_AGREEMENTS.length}</span> accepted
          </>
        }
      >
        {/* Said before the boxes, not in small print under them. */}
        <div className="flex flex-col gap-2 rounded border border-rule bg-sheet-2 p-4">
          <StatusPill className="self-start" tone="neutral" label="Recorded, not signed" />
          <p className="text-body-sm text-ink-2">
            We have no electronic-signature provider connected, so ticking a box here is not a
            digital signature and this screen will never tell you it was one. What we record is your
            name, the version shown above each document, and the moment you accepted it. A reviewer
            checks that record against the signed copy in your document pack before your first
            purchase order.
          </p>
        </div>

        <div className="flex flex-col gap-4" onFocus={() => onFieldFocus('Agreements')}>
          {VENDOR_AGREEMENTS.map((agreement) => (
            <div
              key={agreement.code}
              className="flex flex-col gap-3 rounded border border-rule bg-sheet p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-h3 text-ink">{agreement.label}</h3>
                <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                  Version <span className="tnum">{agreement.version}</span>
                </span>
              </div>
              <p className="text-body-sm text-ink-2">{agreement.summary}</p>
              <Checkbox
                label={`I accept the ${agreement.label.toLowerCase()}, version ${agreement.version}`}
                consequence="Your acceptance is recorded against this version with your name and the time."
                checked={values.accepted[agreement.code] === true}
                onChange={(on) => {
                  clearError(agreement.code);
                  save({
                    ...values,
                    accepted: { ...values.accepted, [agreement.code]: on },
                  });
                }}
              />
              {/* Never a tick and never a blank while nothing has been done. */}
              {values.accepted[agreement.code] !== true && !errors[agreement.code] && (
                <p className="text-body-sm text-ink-4">Not accepted yet.</p>
              )}
              {errors[agreement.code] && (
                <p role="alert" className="text-body-sm text-fail">
                  {errors[agreement.code]}
                </p>
              )}
            </div>
          ))}
        </div>

        <Input
          label="Accepted by"
          required
          hint="The person taking responsibility for these on behalf of the business. It is recorded with the acceptance and a reviewer will match it against the signatory ID on step 6."
          value={values.signatoryName}
          onFocus={() => onFieldFocus('Agreements')}
          onChange={(e) => {
            clearError('signatoryName');
            save({ ...values, signatoryName: e.target.value });
          }}
          error={errors.signatoryName}
        />
      </FormSection>

      {/* ------------------------------------------------------------ price */}
      <FormSection
        title="How your price is set"
        description="Both answers reach the same rupee figure. The difference is which of the two numbers you control."
      >
        <Choice
          legend="How do you want to quote?"
          name="pricing-mode"
          required
          options={PRICING_MODES.map((mode) => ({
            value: mode.value,
            label: mode.label,
            consequence: mode.consequence,
          }))}
          value={values.pricingMode}
          onChange={(pricingMode) => {
            clearError('pricingMode');
            save({ ...values, pricingMode });
          }}
          onFocus={() => onFieldFocus('How you are paid')}
          error={errors.pricingMode}
          unansweredNote="Not answered yet. Nothing is chosen for you — the two are genuinely different ways to work."
        />

        {commission && (
          <Input
            label="Commission rate you expect, in percent"
            mono
            required
            inputMode="decimal"
            hint="What you are content for us to take of the sale price. It is a starting point for the conversation, not a rate we lock in today — the actual rate is a margin rule a reviewer sets per category."
            value={values.commissionRate}
            onFocus={() => onFieldFocus('How you are paid')}
            onChange={(e) => {
              clearError('commissionRate');
              save({ ...values, commissionRate: e.target.value });
            }}
            error={errors.commissionRate}
          />
        )}
      </FormSection>

      {/* ----------------------------------------------------------- payout */}
      <FormSection
        title="When you are paid"
        description="Settlement runs against consignments that have been delivered and are past the buyer's 48-hour inspection window."
      >
        <Choice
          legend="How often do you want the money?"
          name="payout-cycle"
          required
          options={PAYOUT_CYCLES.map((cycle) => ({
            value: cycle.value,
            label: cycle.label,
            consequence: cycle.consequence,
            // The honest half. A cycle earned by tier is neither granted here
            // nor refused here — the request is recorded and what happens in the
            // meantime is stated.
            ...(cycle.earned
              ? {
                  note: (
                    <div className="flex flex-col gap-2 rounded border border-warn bg-sheet-2 p-4">
                      <StatusPill
                        className="self-start"
                        tone="warn"
                        label="Requested, not granted"
                      />
                      <p className="text-body-sm text-ink-2">
                        Your request is recorded on this application. Until it is granted you will
                        be paid on the{' '}
                        <span className="text-ink">{CYCLE_UNTIL_EARNED.toLowerCase()}</span> run,
                        and we write to you on the day it changes. Nobody has to chase us for it.
                      </p>
                    </div>
                  ),
                }
              : {}),
          }))}
          value={values.payoutCycle}
          onChange={(payoutCycle) => {
            clearError('payoutCycle');
            save({ ...values, payoutCycle });
          }}
          onFocus={() => onFieldFocus('Payout cycle')}
          error={errors.payoutCycle}
        />

        <Input
          label="Smallest amount worth paying you, in rupees"
          mono
          required
          inputMode="numeric"
          hint={`Below this the balance rolls into the next run instead of moving as a tiny transfer. Our own floor is ₹${MIN_PAYOUT_THRESHOLD_INR.toLocaleString('en-IN')}, so anything under that would not be honoured.`}
          value={values.payoutThreshold}
          onFocus={() => onFieldFocus('Payout cycle')}
          onChange={(e) => {
            clearError('payoutThreshold');
            save({ ...values, payoutThreshold: e.target.value });
          }}
          error={errors.payoutThreshold}
        />

        <Choice
          legend="Who raises the invoice for our purchase?"
          name="invoice-upload"
          required
          description="We are buying from you, so somebody has to raise a tax invoice on us. Either is fine and neither is faster."
          options={[
            {
              value: 'VENDOR',
              label: 'We raise our own invoice and upload it',
              consequence:
                'Your payout waits on the invoice reaching us. It also means the document a tax officer sees is one you wrote.',
            },
            {
              value: 'SELF_BILL',
              label: 'Raise it for us — self-billed',
              consequence:
                'We generate the purchase invoice on your behalf and send you a copy. Faster, and it means the numbers cannot disagree with the purchase order.',
            },
          ]}
          value={
            values.invoiceUploadRequired === null
              ? null
              : values.invoiceUploadRequired
                ? 'VENDOR'
                : 'SELF_BILL'
          }
          onChange={(choice) => {
            clearError('invoiceUploadRequired');
            save({ ...values, invoiceUploadRequired: choice === 'VENDOR' });
          }}
          onFocus={() => onFieldFocus('How you are paid')}
          error={errors.invoiceUploadRequired}
        />
      </FormSection>

      {/* ---------------------------------------------------- notifications */}
      <FormSection
        title="How we reach you"
        description="Purchase orders, pick-up windows and payout advice. Nothing here is marketing, and none of it is switched on until you switch it on."
      >
        <fieldset className="flex flex-col gap-3" onFocus={() => onFieldFocus('Agreements')}>
          <legend className="mb-1 text-body-sm font-medium text-ink-2">
            Notification channels{' '}
            <span className="text-fail" aria-hidden="true">
              *
            </span>
          </legend>
          {VENDOR_NOTIFICATION_CHANNELS.map((channel) => (
            <Checkbox
              key={channel.code}
              label={channel.label}
              consequence={channel.consequence}
              checked={values.channels.includes(channel.code)}
              onChange={(on) => {
                clearError('channels');
                save({
                  ...values,
                  channels: on
                    ? [...values.channels, channel.code]
                    : values.channels.filter((c) => c !== channel.code),
                });
              }}
            />
          ))}
          {values.channels.length === 0 && !errors.channels && (
            <p className="text-body-sm text-ink-4">Nothing chosen yet.</p>
          )}
          {errors.channels && (
            <p role="alert" className="text-body-sm text-fail">
              {errors.channels}
            </p>
          )}
        </fieldset>

        <Select
          label="Language"
          hint="The language we write to you in. Purchase orders and invoices are in English regardless — that is a tax requirement."
          required
          options={LANGUAGES}
          value={values.language}
          onFocus={() => onFieldFocus('Agreements')}
          onChange={(e) => {
            clearError('language');
            save({ ...values, language: e.target.value });
          }}
          error={errors.language}
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Accept and continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSaveDraft({ ...values }, completionOf(values))}
        >
          Save and finish later
        </Button>
      </div>
    </form>
  );
}

/** What `completion_pct` counts: each agreement, and each commercial answer. */
function completionOf(values: AgreementValues): number {
  const checks = [
    ...VENDOR_AGREEMENTS.map((a) => values.accepted[a.code] === true),
    values.signatoryName.trim().length > 0,
    values.pricingMode !== null,
    values.payoutCycle !== null,
    values.payoutThreshold.trim().length > 0,
    values.invoiceUploadRequired !== null,
    values.channels.length > 0,
    values.language.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
