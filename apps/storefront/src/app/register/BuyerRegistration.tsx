'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { WhyRailItem } from '@trugrade/ui';
import type { StepDefinition } from './api';
import { RegisterFlow, type StepContext } from './RegisterFlow';
import { Review } from './Review';
import { StepAccount } from './StepAccount';
import { StepCompany } from './StepCompany';
import { StepContacts, WHY_CONTACTS } from './StepContacts';
import { StepDocuments, WHY_DOCUMENTS } from './StepDocuments';
import { StepStatutory, WHY_STATUTORY, BUYER_STATUTORY_COPY } from './StepStatutory';

/**
 * The buyer half of registration: which component renders which of the five
 * seeded step codes, and the copy the seed has no room for.
 *
 * A client component rather than props on `page.tsx` because these are
 * *functions*, and a function does not cross the server-component boundary. The
 * page still server-renders the definitions, so the rail is in the first paint.
 */

/** Step 2's legal name, then nothing. */
const legalNameFor = (ctx: StepContext): string =>
  typeof ctx.allAnswers.BUSINESS_PROFILE?.legalName === 'string'
    ? (ctx.allAnswers.BUSINESS_PROFILE.legalName as string)
    : '';

/**
 * The GSTINs step 3 verified, for step 4's billing addresses.
 *
 * Read, never asked for again. Once step 4 has a draft of its own it carries its
 * own copy — which is what survives step 3 being marked COMPLETE and its draft
 * cleared server-side.
 */
function savedGstins(ctx: StepContext): string[] {
  const rows = ctx.allAnswers.STATUTORY?.gstins;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (row as { gstin?: unknown }).gstin)
    .filter((g): g is string => typeof g === 'string' && g.length === 15);
}

const RENDERERS: Record<string, (ctx: StepContext) => React.ReactNode> = {
  ACCOUNT: (ctx) => (
    <StepAccount
      answers={ctx.answers}
      registered={ctx.registered}
      busy={ctx.busy}
      onContinue={(values) => ctx.continueFromAccount(values)}
      onFieldFocus={ctx.onFieldFocus}
      skipValidation={ctx.skipValidation}
    />
  ),
  BUSINESS_PROFILE: (ctx) => (
    <StepCompany
      answers={ctx.answers}
      busy={ctx.busy}
      blockingReason={ctx.step?.blockingReason}
      onSaveDraft={ctx.saveDraft}
      onContinue={ctx.continueFrom}
      onFieldFocus={ctx.onFieldFocus}
      skipValidation={ctx.skipValidation}
    />
  ),
  STATUTORY: (ctx) => (
    <StepStatutory
      answers={ctx.answers}
      fallbackLegalName={legalNameFor(ctx)}
      constitution={ctx.constitution}
      fields={ctx.step?.fields}
      copy={BUYER_STATUTORY_COPY}
      busy={ctx.busy}
      blockingReason={ctx.step?.blockingReason}
      onSaveDraft={ctx.saveDraft}
      onContinue={ctx.continueFrom}
      onFieldFocus={ctx.onFieldFocus}
      skipValidation={ctx.skipValidation}
    />
  ),
  CONTACTS_ADDRESSES: (ctx) => (
    <StepContacts
      answers={ctx.answers}
      gstins={savedGstins(ctx)}
      busy={ctx.busy}
      blockingReason={ctx.step?.blockingReason}
      onSaveDraft={ctx.saveDraft}
      onContinue={ctx.continueFrom}
      onFieldFocus={ctx.onFieldFocus}
      skipValidation={ctx.skipValidation}
    />
  ),
  DOCUMENTS: (ctx) => (
    <StepDocuments
      answers={ctx.answers}
      busy={ctx.busy}
      blockingReason={ctx.step?.blockingReason}
      onSaveDraft={ctx.saveDraft}
      onContinue={ctx.continueFrom}
      onFieldFocus={ctx.onFieldFocus}
      skipValidation={ctx.skipValidation}
    />
  ),
};

const WHY: Record<string, readonly WhyRailItem[]> = {
  STATUTORY: WHY_STATUTORY,
  CONTACTS_ADDRESSES: WHY_CONTACTS,
  DOCUMENTS: WHY_DOCUMENTS,
};

/** Module scope — an inline object here re-runs RegisterFlow's mount effect every render. */
const PURPOSE_NOTES: Record<string, string> = {
  STATUTORY: 'Your GSTIN sets IGST or CGST+SGST on invoices and where input credit applies.',
};

export function BuyerRegistration({
  definitions,
}: {
  definitions: StepDefinition[] | null;
}): React.JSX.Element {
  const router = useRouter();
  const onSessionEstablished = React.useCallback((): void => {
    router.refresh();
  }, [router]);

  return (
    <RegisterFlow
      definitions={definitions}
      orgType="BUYER"
      basePath="/register"
      railLabel="Create a buyer account"
      renderers={RENDERERS}
      purposeNotes={PURPOSE_NOTES}
      whyFor={(code) => WHY[code] ?? []}
      wrongAccountBody="This form creates a buyer account. Vendor and staff accounts are managed in the console. Sign out here if you need to register a second organisation."
      review={(ctx) => <Review {...ctx} />}
      onSessionEstablished={onSessionEstablished}
    />
  );
}
