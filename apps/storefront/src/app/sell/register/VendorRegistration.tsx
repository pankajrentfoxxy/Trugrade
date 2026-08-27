'use client';

import * as React from 'react';
import type { WhyRailItem } from '@trugrade/ui';
import type { FieldRequirement, StepDefinition } from '../../register/api';
import { RegisterFlow, type StepContext } from '../../register/RegisterFlow';
import { StepStatutory, type StatutoryCopy } from '../../register/StepStatutory';
import { StepCapability } from './StepCapability';
import { StepFacility } from './StepFacility';
import { StepVendorBusiness } from './StepVendorBusiness';
import { StepVendorContact } from './StepVendorContact';

/**
 * The vendor half of registration: which component renders which of the seven
 * seeded step codes, and the copy the seed has no room for.
 *
 * Steps 6 and 7 — DOCUMENTS_BANK and AGREEMENT — have no entry here yet and are
 * T9. They still appear in the rail, because the rail is the API's step list
 * rather than this map, and the shell renders "not built yet" for a code it has
 * no renderer for. Adding one is a line in `renderers`.
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

const WHY_CAPABILITY: readonly WhyRailItem[] = [
  {
    term: 'Dispatching direct',
    explanation: (
      <>
        <span className="block">
          We are the seller on the invoice, but we never hold your stock. When a customer orders a
          machine we buy that exact serial from you and sell it on our own invoice, and the machine
          travels from your dock to theirs — it never comes to us.
        </span>
        <span className="mt-2 block">
          So whether you can dispatch to a third party is not a detail. A supplier who cannot is a
          materially different supplier: we would have to take the goods in first, which is a
          different cost base and a different legal posture. Answer it either way — a “no” is a real
          answer that changes what happens next, not a failure.
        </span>
      </>
    ),
  },
  {
    term: 'Grade mix',
    explanation:
      'A+, A and B are all sellable — the grade is a position on a scale, not a verdict. What the mix tells us is which buyers to put you in front of: a fleet refresh wants A+ and a training lab wants B. It has to add to 100% of what you move in a month, because the part that does not add up is stock nobody has described.',
  },
  {
    term: 'Serial numbers',
    explanation:
      'Every machine we sell is listed by its own serial, with its own inspection report and its own certificate. If you can send serials with the offer, your stock is listed unit by unit and a buyer can read the passport of the exact machine before ordering it. If you cannot, it still sells — as a pool, with the serial attached at dispatch.',
  },
];

const WHY_FACILITY: readonly WhyRailItem[] = [
  {
    term: 'Dispatch address',
    explanation: (
      <>
        <span className="block">
          The address you name here is printed as <span className="text-ink">Dispatch From</span> on
          the e-way bill for every consignment that leaves that site — for as long as you supply us.
        </span>
        <span className="mt-2 block">
          A registered office and a loading dock are frequently different buildings, and a
          consignment whose e-way bill starts at the wrong one can be detained, with the penalty
          measured against the invoice value. That is why nothing is chosen for you here: correcting
          it later means a fresh e-way bill for every consignment already in transit.
        </span>
      </>
    ),
  },
  {
    term: 'Operating hours',
    explanation:
      'A pick-up booked for a shut dock is a machine that does not move and a slot nobody else could use. A day you are closed is an answer — tick it, and we simply will not offer that day.',
  },
  {
    term: 'WhatsApp and language',
    explanation:
      'Optional, both of them. A dispatch window on WhatsApp reaches a warehouse supervisor faster than an email nobody opens until Monday, and we write in the language the contact chooses. Leave either blank and we will not invent one — we default to email, in English, and say so.',
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
  /**
   * The catalogue's own grades, server-rendered, for step 4's mix. Null when the
   * API did not answer — the step then stands the question down rather than
   * splitting stock across a list this app invented.
   */
  grades: { grade: string; customerDescription: string }[] | null;
}

/** Step 1's answer, read back so step 4 does not ask for brands from scratch. */
const listFrom = (answers: Record<string, unknown> | undefined, key: string): string[] =>
  Array.isArray(answers?.[key]) ? (answers[key] as string[]) : [];

export function VendorRegistration({
  definitions,
  brands,
  grades,
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
      CAPABILITY: (ctx) => (
        <StepCapability
          answers={ctx.answers}
          brands={brands ?? []}
          grades={grades ?? []}
          brandsFromStepOne={listFrom(ctx.allAnswers.ACCOUNT, 'brands')}
          otherBrandsFromStepOne={
            typeof ctx.allAnswers.ACCOUNT?.otherBrands === 'string'
              ? (ctx.allAnswers.ACCOUNT.otherBrands as string)
              : ''
          }
          busy={ctx.busy}
          blockingReason={ctx.step?.blockingReason}
          onSaveDraft={ctx.saveDraft}
          onContinue={ctx.continueFrom}
          onFieldFocus={ctx.onFieldFocus}
        />
      ),
      FACILITY_CONTACTS: (ctx) => (
        <StepFacility
          answers={ctx.answers}
          busy={ctx.busy}
          blockingReason={ctx.step?.blockingReason}
          onSaveDraft={ctx.saveDraft}
          onContinue={ctx.continueFrom}
          onFieldFocus={ctx.onFieldFocus}
        />
      ),
    }),
    [brands, grades],
  );

  const whyFor = (code: string): readonly WhyRailItem[] => {
    if (code === 'STATUTORY') return WHY_VENDOR_STATUTORY;
    if (code === 'CAPABILITY') return WHY_CAPABILITY;
    if (code === 'FACILITY_CONTACTS') return WHY_FACILITY;
    return [];
  };

  return (
    <RegisterFlow
      definitions={definitions}
      orgType="VENDOR"
      railLabel="Become a Trugrade supplier"
      renderers={renderers}
      whyFor={whyFor}
      wrongAccountBody="This form registers a supplier. You are signed in on a buyer account — sign out here if you also want to sell to us, and register the selling entity separately."
    />
  );
}
