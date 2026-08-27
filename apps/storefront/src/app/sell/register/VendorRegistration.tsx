'use client';

import * as React from 'react';
import type { WhyRailItem } from '@trugrade/ui';
import type { FieldRequirement, StepDefinition } from '../../register/api';
import { RegisterFlow, type StepContext } from '../../register/RegisterFlow';
import { StepStatutory, type StatutoryCopy } from '../../register/StepStatutory';
import { StepVendorBusiness } from './StepVendorBusiness';
import { StepVendorContact } from './StepVendorContact';

/**
 * The vendor half of registration: which component renders which of the seven
 * seeded step codes, and the copy the seed has no room for.
 *
 * Steps 4 to 7 — CAPABILITY, FACILITY_CONTACTS, DOCUMENTS_BANK and AGREEMENT —
 * have no entry here yet and are T8 and T9. They still appear in the rail,
 * because the rail is the API's step list rather than this map, and the shell
 * renders "not built yet" for a code it has no renderer for. Adding one is a
 * line in `RENDERERS`.
 */

/**
 * TAN, which no `onboarding_field_requirement` row asks for.
 *
 * The task asks for it and the platform genuinely needs it — we deduct TDS on
 * every payout under section 194Q and the vendor's TAN is what a deduction
 * certificate is issued against — but there is no seeded rule for it, so it
 * cannot arrive with the other four. It is declared here, in the shape the
 * endpoint uses, so it renders and validates exactly like the seeded ones and so
 * the day a row is added this constant is what gets deleted.
 *
 * It is optional, because a supplier below the deduction threshold has no TAN
 * and refusing them one they do not hold would be a wall in front of a real
 * vendor.
 */
const TAN_FIELD: FieldRequirement = {
  fieldCode: 'tan',
  label: 'TAN',
  required: false,
  helpText:
    'Optional. Ten characters, e.g. DELT12345E. We use it on the TDS certificate that goes with your payout.',
};

/**
 * `incorporation_date` is seeded as a STATUTORY field requirement, and step 2
 * asks for it.
 *
 * Both are defensible — it is constitution-gated like the CIN, and it is also a
 * plain fact about the business — but asking for it twice is not, and step 2 is
 * where the backlog puts it and where the applicant has the certificate open. So
 * it is dropped from step 3's list here rather than being removed from the seed,
 * which is the other session's file and is right for a flow that does not ask on
 * step 2. Reported: the seeded rule and the step that actually asks should agree.
 */
const ASKED_EARLIER = ['incorporation_date'];

const VENDOR_STATUTORY_COPY: StatutoryCopy = {
  panDescription:
    'The permanent account number of the entity we pay. TDS on every payout is deducted against it, so it has to be the entity that raises the invoice — not a director’s personal PAN.',
  gstinDescription:
    'Add every registration you will supply from. Each one is checked against the GST portal on its own, and the state it was issued in is where an e-way bill for that stock starts.',
  confirmConsequence:
    'Purchase orders raised against this GSTIN will carry the name above, and so will the payout advice. Confirming it is what lets us buy from you.',
  primaryTitle: 'Which registration do we buy from?',
  primaryDescription:
    'The primary registration is the entity on every purchase order and every payout. It also decides whether our purchase from you is IGST or CGST plus SGST, which is what your own input credit turns on.',
  primaryMissing:
    'Choose which registration we buy from. It sets the entity on every purchase order and every payout.',
  primaryNote:
    'Nothing is chosen for you here. Changing it later needs a reviewer, because it changes who we pay from that point on.',
};

const WHY_VENDOR_STATUTORY: readonly WhyRailItem[] = [
  {
    term: 'Primary GSTIN',
    explanation: (
      <>
        <span className="block">
          If you hold more than one registration, the primary one is the entity we buy from. It
          decides three things at once: whose name and address appear on our purchase order,
          whether the purchase is IGST or CGST plus SGST, and which of your registrations the
          payment and the TDS certificate land against.
        </span>
        <span className="mt-2 block">
          Pick the registration that actually holds the stock. A purchase order raised against a
          registration that never dispatched anything is an e-way bill that does not match the
          invoice behind it, and correcting that means a credit note on both sides.
        </span>
      </>
    ),
  },
  {
    term: 'PAN',
    explanation:
      'Characters 3 to 12 of a GSTIN are the PAN it was issued against, so the two have to agree. We check the pair before we ask the portal anything — a mismatch there is almost always a GSTIN copied from a sister company.',
  },
  {
    term: 'Registry numbers',
    explanation:
      'CIN, LLPIN, Udyam and TAN are recorded, not verified. There is no registry look-up behind any of them on our side, so we check the format and a reviewer confirms the rest against the certificates you upload on step 6. Nothing here will ever show you a tick we have not earned.',
  },
];

/** Step 1's company name, then step 2's legal name, then nothing. */
const legalNameFor = (ctx: StepContext): string =>
  (typeof ctx.allAnswers.BUSINESS_PROFILE?.legalName === 'string'
    ? (ctx.allAnswers.BUSINESS_PROFILE.legalName as string)
    : '') ||
  ctx.typedCompanyName ||
  (typeof ctx.allAnswers.ACCOUNT?.companyName === 'string'
    ? (ctx.allAnswers.ACCOUNT.companyName as string)
    : '');

export interface VendorRegistrationProps {
  definitions: StepDefinition[] | null;
  /** The catalogue's own brands, server-rendered. Null when the API did not answer. */
  brands: string[] | null;
}

export function VendorRegistration({
  definitions,
  brands,
}: VendorRegistrationProps): React.JSX.Element {
  const renderers = React.useMemo<Record<string, (ctx: StepContext) => React.ReactNode>>(
    () => ({
      ACCOUNT: (ctx) => (
        <StepVendorContact
          answers={ctx.answers}
          registered={ctx.registered}
          busy={ctx.busy}
          brands={brands ?? []}
          onContinue={(values, extras) => ctx.continueFromAccount(values, extras)}
          onFieldFocus={ctx.onFieldFocus}
        />
      ),
      BUSINESS_PROFILE: (ctx) => (
        <StepVendorBusiness
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
          // The seeded rules first, in the order the API returns them, then the
          // one the API has no row for.
          fields={[
            ...(ctx.step?.fields ?? []).filter((f) => !ASKED_EARLIER.includes(f.fieldCode)),
            TAN_FIELD,
          ]}
          copy={VENDOR_STATUTORY_COPY}
          busy={ctx.busy}
          blockingReason={ctx.step?.blockingReason}
          onSaveDraft={ctx.saveDraft}
          onContinue={ctx.continueFrom}
          onFieldFocus={ctx.onFieldFocus}
        />
      ),
    }),
    [brands],
  );

  return (
    <RegisterFlow
      definitions={definitions}
      orgType="VENDOR"
      railLabel="Become a Trugrade supplier"
      renderers={renderers}
      whyFor={(code) => (code === 'STATUTORY' ? WHY_VENDOR_STATUTORY : [])}
      wrongAccountBody="This form registers a supplier. You are signed in on a buyer account — sign out here if you also want to sell to us, and register the selling entity separately."
    />
  );
}
