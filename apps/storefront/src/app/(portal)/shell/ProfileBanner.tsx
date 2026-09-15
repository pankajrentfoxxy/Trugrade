'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePortal } from './PortalContext';
import { nextIncompleteSection, profileCompletionPct } from '../profile/sections.config';
import { SubmitForReview, submitStage } from '../profile/SubmitForReview';

/**
 * Profile completion, on every portal screen rather than only on Home.
 *
 * A buyer does not finish their profile on the profile page — they finish it
 * when they discover, at checkout, that an unverified organisation cannot
 * order. The bar has to be where they are.
 *
 * Warn, never fail: an incomplete profile is work outstanding, not a verdict.
 */

/** Roles that can act on a profile. A buyer or approver seat is only told. */
const CAN_COMPLETE = new Set(['CUSTOMER_OWNER', 'CUSTOMER_ADMIN']);

export function ProfileBanner(): React.JSX.Element | null {
  const { session, onboarding } = usePortal();
  // No bar on a guess, and no flash of 0%.
  if (!onboarding) return null;

  const pct = profileCompletionPct(onboarding, session);
  const next = nextIncompleteSection(null, onboarding, session);
  const canAct = session.roles.some((r) => CAN_COMPLETE.has(r));
  const verified = onboarding.status === 'VERIFIED';
  const stage = submitStage(onboarding, session.roles);

  // Once the organisation is verified the bar is noise for everyone.
  if (verified) return null;

  // Complete is not verified. A finished profile waiting on the buyer to submit
  // it, or on us to review it, says so here.
  if (stage !== 'hidden') {
    return (
      <div className="hub-banner" data-testid="profile-banner">
        <span className="hub-banner__label">Profile completion</span>
        <span className="hub-banner__pill font-mono tnum">{pct}%</span>
        <SubmitForReview className="hub-banner__next" />
      </div>
    );
  }

  return (
    <div className="hub-banner" data-testid="profile-banner">
      <span className="hub-banner__label">Profile completion</span>
      <span className="hub-banner__pill font-mono tnum">{pct}%</span>
      <span
        className="hub-banner__track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile completion"
      >
        <span className="hub-banner__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="hub-banner__next">
        {next
          ? `Next: ${next.title}. Ordering opens once your profile is verified.`
          : 'Every section is saved.'}
      </span>
      {canAct && next ? (
        <Link className="hub-banner__cta" href="/profile">
          Finish profile
        </Link>
      ) : null}
    </div>
  );
}
