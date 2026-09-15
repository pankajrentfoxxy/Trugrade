'use client';

import * as React from 'react';
import {
  Button,
  EmptyState,
  HubKpiRow,
  HubPageHeader,
  Skeleton,
  StatusPill,
  useToast,
} from '@trugrade/ui';
import { StepStatutory, BUYER_STATUTORY_COPY } from '../../register/StepStatutory';
import { StepCompany } from '../../register/StepCompany';
import { StepContacts } from '../../register/StepContacts';
import { StepDocuments } from '../../register/StepDocuments';
import { accountHolderFromSession } from '../../register/api';
import { usePortal } from '../shell/PortalContext';
import { SubmitForReview } from './SubmitForReview';
import { AccountSection } from './sections/AccountSection';
import { StepSection } from './sections/StepSection';
import {
  PROFILE_SECTIONS,
  nextIncompleteSection,
  profileCompletionPct,
  sectionBlockingReason,
  sectionIsDone,
  sectionSummary,
  type ProfileSectionId,
} from './sections.config';

/**
 * ARCHETYPE C — Record cards that open Archetype F dialogs.
 *
 * The buyer's profile: the five onboarding steps as cards, each opening the
 * same form the `/register` wizard used, with a completion percentage that
 * carries its denominator and a submit-for-review that appears only when the
 * server says the application is submittable.
 */

/** The org's status in the buyer's words. */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  VERIFIED: 'Verified',
  PROFILE_SUBMITTED: 'In review',
  KYC_SUBMITTED: 'In review',
  UNDER_REVIEW: 'In review',
  INFO_REQUESTED: 'Changes requested',
  REJECTED: 'Not approved',
  SUSPENDED: 'Suspended',
};

/** The GSTINs the statutory step verified, for the contacts step's billing rows. */
function savedGstins(answers: Record<string, Record<string, unknown>>): string[] {
  const rows = answers.STATUTORY?.gstins;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (row as { gstin?: unknown }).gstin)
    .filter((g): g is string => typeof g === 'string' && g.length === 15);
}

export function ProfileHub(): React.JSX.Element {
  const { session, profile, onboarding, reload, setSession } = usePortal();
  const [open, setOpen] = React.useState<ProfileSectionId | null>(null);
  const toast = useToast();

  const pct = profileCompletionPct(onboarding, session);
  const doneCount = PROFILE_SECTIONS.filter((s) => sectionIsDone(s, onboarding, session)).length;
  const answers = onboarding?.answers ?? {};
  const step = (code: string) => onboarding?.progress.steps.find((s) => s.stepCode === code);

  const handleSaved = (sectionId: ProfileSectionId): void => {
    setOpen(null);
    reload();
    const next = nextIncompleteSection(sectionId, onboarding, session);
    if (next && next.id !== sectionId) {
      window.setTimeout(() => setOpen(next.id), 700);
      return;
    }
    toast({
      tone: 'success',
      title: 'Section saved',
      body: 'Your profile is up to date. Submit it for review from this page once every section is done.',
    });
  };

  if (onboarding === null) {
    return (
      <div className="hub-page">
        <HubPageHeader title="Your profile" />
        {session.roles.some((r) => r === 'CUSTOMER_OWNER' || r === 'CUSTOMER_ADMIN') ? (
          <Skeleton lines={8} />
        ) : (
          <EmptyState
            title="Your account owner completes the profile"
            body="Only an account owner or admin can fill in and submit the organisation's profile. Ask them to finish it — ordering opens once it is verified."
          />
        )}
      </div>
    );
  }

  const status = STATUS_LABEL[onboarding.status] ?? 'Not submitted';

  return (
    <div className="hub-page">
      <HubPageHeader
        title="Your profile"
        subtitle={profile?.legalName && profile.legalName !== 'Pending company details' ? profile.legalName : undefined}
        actions={
          pct >= 100 ? (
            <StatusPill tone="pass" label="Every section done" />
          ) : (
            <StatusPill tone="warn" label={`${pct}% · ${doneCount} of ${PROFILE_SECTIONS.length} sections`} />
          )
        }
      />

      <HubKpiRow
        cells={[
          {
            label: 'Progress',
            value: `${pct}%`,
            sub: `${doneCount} of ${PROFILE_SECTIONS.length} sections done`,
          },
          { label: 'Status', value: status, sub: 'ordering opens after approval' },
        ]}
      />

      <SubmitForReview className="mt-2" />

      <div className="profile-hub-grid mt-6">
        {PROFILE_SECTIONS.map((section, index) => {
          const done = sectionIsDone(section, onboarding, session);
          const sentBack = sectionBlockingReason(section, onboarding);
          return (
            <article
              key={section.id}
              className="profile-hub-card"
              data-done={done ? 'true' : 'false'}
            >
              <div className="profile-hub-card-head">
                <span className="profile-hub-icon">{done ? '✓' : index + 1}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-h3 text-ink">{section.title}</h2>
                  <p className="profile-hub-weight mt-1">{section.weight}% of profile</p>
                </div>
                {sentBack ? (
                  <StatusPill tone="warn" label="Sent back" />
                ) : done ? (
                  <StatusPill tone="pass" label="Done" />
                ) : (
                  <StatusPill tone="neutral" label="Required" />
                )}
              </div>
              <p className="profile-hub-summary">
                {sentBack ?? sectionSummary(section, onboarding, session)}
              </p>
              <Button variant={done ? 'secondary' : 'primary'} onClick={() => setOpen(section.id)}>
                {done ? 'Edit' : 'Fill now'}
              </Button>
            </article>
          );
        })}
      </div>

      <AccountSection
        open={open === 'account'}
        onClose={() => setOpen(null)}
        onSaved={(next) => {
          setSession(next);
          handleSaved('account');
        }}
        session={session}
      />

      <StepSection
        open={open === 'statutory'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('statutory')}
        title="Statutory"
        description="Your GSTIN sets IGST or CGST+SGST on invoices and where input credit applies."
        stepCode="STATUTORY"
      >
        {(ctx) => (
          <StepStatutory
            answers={answers.STATUTORY ?? {}}
            fallbackLegalName={session.fullName ?? ''}
            constitution={onboarding.progress.constitution ?? null}
            fields={step('STATUTORY')?.fields}
            copy={BUYER_STATUTORY_COPY}
            selectPrimaryGstin={false}
            busy={ctx.busy}
            blockingReason={step('STATUTORY')?.blockingReason}
            onSaveDraft={ctx.onSaveDraft}
            onContinue={ctx.onContinue}
            onFieldFocus={ctx.onFieldFocus}
          />
        )}
      </StepSection>

      <StepSection
        open={open === 'company'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('company')}
        title="Company"
        description="Your legal name as it should appear on the tax invoice."
        stepCode="BUSINESS_PROFILE"
      >
        {(ctx) => (
          <StepCompany
            answers={answers.BUSINESS_PROFILE ?? {}}
            statutoryAnswers={answers.STATUTORY}
            fallbackLegalName={session.fullName ?? ''}
            busy={ctx.busy}
            blockingReason={step('BUSINESS_PROFILE')?.blockingReason}
            onSaveDraft={ctx.onSaveDraft}
            onContinue={ctx.onContinue}
            onFieldFocus={ctx.onFieldFocus}
          />
        )}
      </StepSection>

      <StepSection
        open={open === 'contacts'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('contacts')}
        title="Contacts and delivery"
        description="Where machines are delivered, who signs for them, and what hours your dock is open."
        stepCode="CONTACTS_ADDRESSES"
      >
        {(ctx) => (
          <StepContacts
            answers={answers.CONTACTS_ADDRESSES ?? {}}
            gstins={savedGstins(answers)}
            statutoryAnswers={answers.STATUTORY}
            accountHolder={accountHolderFromSession(session)}
            busy={ctx.busy}
            blockingReason={step('CONTACTS_ADDRESSES')?.blockingReason}
            onSaveDraft={ctx.onSaveDraft}
            onContinue={ctx.onContinue}
            onFieldFocus={ctx.onFieldFocus}
          />
        )}
      </StepSection>

      <StepSection
        open={open === 'documents'}
        onClose={() => setOpen(null)}
        onSaved={() => handleSaved('documents')}
        title="Documents and preferences"
        description="Your GST certificate and PAN, plus how you want to be notified."
        stepCode="DOCUMENTS"
      >
        {(ctx) => (
          <StepDocuments
            answers={answers.DOCUMENTS ?? {}}
            busy={ctx.busy}
            blockingReason={step('DOCUMENTS')?.blockingReason}
            onSaveDraft={ctx.onSaveDraft}
            onContinue={ctx.onContinue}
            onFieldFocus={ctx.onFieldFocus}
          />
        )}
      </StepSection>
    </div>
  );
}
