'use client';

import * as React from 'react';
import { Button, Checkbox, FormSection, type WhyRailItem } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import { DocumentChecklist, missingDocuments, usable } from './DocumentChecklist';
import type { KycDocument } from './api';
import { BUYER_DOCUMENTS, LANGUAGES, NOTIFICATION_CHANNELS } from './picklists';

/**
 * Step 5 — documents and preferences.
 *
 * The checklist itself is `DocumentChecklist`, shared with the vendor's step 6:
 * the rules, the per-file progress and the server's refusals live there. What
 * belongs to this step is the four codes a *buyer* is asked for and the three
 * preferences underneath.
 *
 * **Not one box on this screen starts ticked.** Notification channels and the
 * PO-required flag are exactly where a pre-ticked default ships, and CP e-Comm
 * Rule 4(9) forbids it.
 */

export const WHY_DOCUMENTS: readonly WhyRailItem[] = [
  {
    term: 'Documents',
    explanation: (
      <>
        <p>
          Every file is checked by its contents rather than its name, stripped of the location and
          device data a phone photo carries, and shown only to the reviewer handling your
          application.
        </p>
        <p className="mt-2">
          We keep them for as long as the tax rules require us to hold the invoice they support.
        </p>
      </>
    ),
  },
  {
    term: 'Purchase order',
    explanation:
      'If your finance team requires a PO number before an invoice can be paid, say so here and we will refuse to raise an invoice without one — rather than discovering it at the end of the month.',
  },
];

/* ==========================================================================
 * Draft shape
 * ======================================================================== */

export interface DocumentsValues {
  /** Channel codes. Empty is the honest starting state, and a valid one to leave. */
  channels: string[];
  language: string;
  poRequired: boolean;
}

const EMPTY: DocumentsValues = { channels: [], language: '', poRequired: false };

export function readDocumentsDraft(answers: Record<string, unknown>): DocumentsValues {
  return {
    channels: Array.isArray(answers.channels)
      ? (answers.channels as unknown[]).filter((c): c is string => typeof c === 'string')
      : EMPTY.channels,
    language: typeof answers.language === 'string' ? answers.language : EMPTY.language,
    poRequired: answers.poRequired === true,
  };
}

/* ==========================================================================
 * The step
 * ======================================================================== */

export interface StepDocumentsProps {
  answers: Record<string, unknown>;
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

export function StepDocuments({
  answers,
  onSaveDraft,
  onContinue,
  busy,
  onFieldFocus,
  blockingReason,
  skipValidation = false,
}: StepDocumentsProps): React.JSX.Element {
  const [values, setValues] = React.useState<DocumentsValues>(() => readDocumentsDraft(answers));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /** Owned here, not in the checklist: it is what validates the step. */
  const [docs, setDocs] = React.useState<readonly KycDocument[]>([]);

  const clearError = React.useCallback(
    (key: string): void =>
      setErrors((e) => {
        const { [key]: _dropped, ...rest } = e;
        return rest;
      }),
    [],
  );

  const save = (next: DocumentsValues): void => {
    setValues(next);
    onSaveDraft({ ...next }, completionOf(next, docs));
  };

  const toggleChannel = (code: string, on: boolean): void => {
    clearError('channels');
    save({
      ...values,
      channels: on ? [...values.channels, code] : values.channels.filter((c) => c !== code),
    });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found: Record<string, string> = {};

    if (!skipValidation) {
      for (const missing of missingDocuments(BUYER_DOCUMENTS, docs))
        found[missing.docType] =
          `Upload the ${missing.docType.replace(/_/g, ' ').toLowerCase()} before you continue.`;
      if (values.channels.length === 0)
        found.channels =
          'Choose at least one way to reach you. We have to be able to send an order confirmation.';
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

      <DocumentChecklist
        wanted={BUYER_DOCUMENTS}
        title="Documents"
        description="Clear photographs are fine — we do not need scans. Each file is checked by its contents, and anything we cannot read we will ask for again."
        errors={errors}
        onClearError={clearError}
        onDocsChange={setDocs}
        onFieldFocus={onFieldFocus}
        whyTerm="Documents"
      />

      {/* ------------------------------------------------------ preferences */}
      <FormSection
        title="How we reach you"
        description="Order confirmations, dispatch notices and invoices. Nothing here is marketing, and none of it is switched on until you switch it on."
      >
        <fieldset
          className="flex flex-col gap-3"
          onFocus={() => onFieldFocus('Documents and preferences')}
        >
          <legend className="mb-1 text-body-sm font-medium text-ink-2">
            Notification channels{' '}
            <span className="text-fail" aria-hidden="true">
              *
            </span>
          </legend>
          {NOTIFICATION_CHANNELS.map((channel) => (
            <Checkbox
              key={channel.code}
              label={channel.label}
              consequence={channel.consequence}
              checked={values.channels.includes(channel.code)}
              onChange={(on) => toggleChannel(channel.code, on)}
            />
          ))}
          {errors.channels && (
            <p role="alert" className="text-body-sm text-fail">
              {errors.channels}
            </p>
          )}
        </fieldset>

        <Select
          label="Language"
          hint="The language we write to you in. Invoices are in English regardless — that is a tax requirement."
          required
          options={LANGUAGES}
          value={values.language}
          onFocus={() => onFieldFocus('Documents and preferences')}
          onChange={(e) => {
            clearError('language');
            save({ ...values, language: e.target.value });
          }}
          error={errors.language}
        />
      </FormSection>

      <FormSection
        title="Purchase orders"
        description="Some finance teams will not settle an invoice that has no PO number against it."
      >
        <Checkbox
          label="We require a purchase order number on every invoice"
          consequence="We will not raise an invoice for this account without a PO number, and checkout will ask for one on every order."
          checked={values.poRequired}
          onChange={(poRequired) => save({ ...values, poRequired })}
        />
      </FormSection>

      <div className="flex flex-wrap items-center gap-4 border-t border-rule-2 pt-5">
        <Button type="submit" variant="primary" loading={busy}>
          Save and continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onSaveDraft({ ...values }, completionOf(values, docs))}
        >
          Save and finish later
        </Button>
      </div>
    </form>
  );
}

/** What `completion_pct` counts: every required document, plus the two answers. */
function completionOf(values: DocumentsValues, docs: readonly KycDocument[]): number {
  const checks = [
    ...BUYER_DOCUMENTS.filter((d) => d.required).map((d) =>
      docs.some((held) => held.docType === d.docType && usable(held)),
    ),
    values.channels.length > 0,
    values.language.length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
