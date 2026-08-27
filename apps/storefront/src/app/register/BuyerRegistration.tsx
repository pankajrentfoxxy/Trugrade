'use client';

import * as React from 'react';
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

/** Step 1's company name, then step 2's legal name, then nothing. */
const legalNameFor = (ctx: StepContext): string =>
  (typeof ctx.allAnswers.BUSINESS_PROFILE?.legalName === 'string'
    ? (ctx.allAnswers.BUSINESS_PROFILE.legalName as string)
    : '') ||
  ctx.typedCompanyName ||
  (typeof ctx.allAnswers.ACCOUNT?.companyName === 'string'
    ? (ctx.allAnswers.ACCOUNT.companyName as string)
    : '');

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
    />
  ),
  BUSINESS_PROFILE: (ctx) => (
    <StepCompany
      answers={ctx.answers}
      fallbackLegalName={
        ctx.typedCompanyName ||
        (typeof ctx.allAnswers.ACCOUNT?.companyName === 'string'
          ? (ctx.allAnswers.ACCOUNT.companyName as string)
          : '')
      }
      busy={ctx.busy}
      blockingReason={ctx.step?.blockingReason}
      onSaveDraft={ctx.saveDraft}
      onContinue={ctx.continueFrom}
      onFieldFocus={ctx.onFieldFocus}
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
    />
  ),
};

const WHY: Record<string, readonly WhyRailItem[]> = {
  STATUTORY: WHY_STATUTORY,
  CONTACTS_ADDRESSES: WHY_CONTACTS,
  DOCUMENTS: WHY_DOCUMENTS,
};

export function BuyerRegistration({
  definitions,
}: {
  definitions: StepDefinition[] | null;
}): React.JSX.Element {
  return (
    <RegisterFlow
      definitions={definitions}
      orgType="BUYER"
      basePath="/register"
      railLabel="Create a buyer account"
      renderers={RENDERERS}
      whyFor={(code) => WHY[code] ?? []}
      wrongAccountBody="This form creates a buyer account. Vendor and staff accounts are managed in the console. Sign out here if you need to register a second organisation."
      review={(ctx) => <Review {...ctx} />}
    />
  );
}
