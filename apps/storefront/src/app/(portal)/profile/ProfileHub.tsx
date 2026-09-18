'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, EmptyState, HubPageHeader, Skeleton, StatusPill, useToast } from '@trugrade/ui';
import { usePortal } from '../shell/PortalContext';
import { SubmitForReview } from './SubmitForReview';
import { ProfileFlow } from './ProfileFlow';
import {
  PROFILE_SECTIONS,
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

export function ProfileHub(): React.JSX.Element {
  const { session, profile, onboarding, readiness, reload } = usePortal();
  const [open, setOpen] = React.useState<ProfileSectionId | null>(null);
  const toast = useToast();
  // The cart sends an unfinished profile here; say why, rather than leaving
  // somebody who pressed "Continue to checkout" wondering how they got here.
  const fromCheckout = useSearchParams().get('reason') === 'checkout';
  const finished = (): void => {
    setOpen(null);
    toast({
      tone: 'success',
      title: 'Profile saved',
      body: 'Every section is saved. Submit it for review from this page once every section is done.',
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
      {/*
        No percentage here.

        It used to be rendered three times on this one screen — the shell
        banner, a header pill and a KPI cell — and a fourth time on Home. The
        banner above every portal screen is the one that stays.
      */}
      <HubPageHeader
        title="Your profile"
        subtitle={
          profile?.legalName && profile.legalName !== 'Pending company details'
            ? profile.legalName
            : undefined
        }
        actions={<StatusPill tone={status === 'Verified' ? 'pass' : 'neutral'} label={status} />}
      />

      <SubmitForReview className="mt-2" />

      {!onboarding.editable ? (
        <p
          className="mt-4 rounded border border-rule bg-sheet-2 px-4 py-3 text-body-sm text-ink-2"
          data-testid="profile-locked"
        >
          {onboarding.status === 'VERIFIED'
            ? 'Your profile is approved, so these details are locked. To change anything, contact support.'
            : 'Your profile is with our review team, so it cannot be changed until they decide. If something needs correcting, contact support.'}
        </p>
      ) : null}

      {/* The cart sent them here because the SERVER refused, so ask the server. */}
      {fromCheckout && readiness && !readiness.prepaid ? (
        <p className="mt-4 text-body text-ink" role="status" data-testid="checkout-reason">
          Checkout needs a finished profile: we invoice a registered business and deliver to a site
          you have named. Fill in the cards below and your cart is where you left it.
        </p>
      ) : null}

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
              {onboarding.editable ? (
                <Button
                  className="profile-hub-action"
                  variant={done ? 'secondary' : 'primary'}
                  onClick={() => setOpen(section.id)}
                >
                  {done ? 'Edit' : 'Fill now'}
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>

      <ProfileFlow
        start={open}
        onClose={() => setOpen(null)}
        onStepSaved={() => reload()}
        onFinished={finished}
      />
    </div>
  );
}
