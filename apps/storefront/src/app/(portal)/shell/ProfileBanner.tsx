'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePortal } from './PortalContext';
import { nextIncompleteSection, profileCompletionPct } from '../profile/sections.config';
import { SubmitForReview, submitStage } from '../profile/SubmitForReview';

/**
 * Whether this buyer can order yet, on every portal screen.
 *
 * **The only place the completion percentage is rendered.** It used to appear
 * four times — here, in the profile header pill, in a profile KPI cell and in
 * the home dock — all four calling `profileCompletionPct` and all four saying
 * the same thing in a different shape.
 *
 * It also used to say the wrong thing. "Ordering opens once your profile is
 * verified" was told to everyone, and verification is a human act: a buyer who
 * filled every field and submitted read a sentence that gave them nothing to
 * do. What the server actually decides is two questions, and this says whichever
 * one is outstanding, in the server's own words:
 *
 * - Prepaid ordering is automatic. Until it opens, the missing things are named.
 * - Credit terms are reviewed, and that is said separately once prepaid is open.
 *
 * **It disappears the moment the buyer can order.** A strip that says "you are
 * done" is a strip that stops being read, and it is sitting above every screen.
 *
 * Warn, never fail: outstanding work is not a verdict.
 */

/** Roles that can act on a profile. A buyer or approver seat is only told. */
const CAN_COMPLETE = new Set(['CUSTOMER_OWNER', 'CUSTOMER_ADMIN']);

export function ProfileBanner(): React.JSX.Element | null {
  const { session, onboarding, readiness } = usePortal();
  // No bar on a guess, and no flash of 0%.
  if (!onboarding) return null;

  const canAct = session.roles.some((r) => CAN_COMPLETE.has(r));

  // The server's answer wins wherever it has one. Ordering is open: nothing
  // here is worth a permanent strip, including "credit is still in review" —
  // that belongs on the checkout screen where a mode is actually chosen.
  if (readiness?.prepaid) return null;

  if (readiness?.suspended) {
    return (
      <div className="hub-banner" data-testid="profile-banner">
        <span className="hub-banner__label">Ordering paused</span>
        {/* The server's sentence, verbatim. */}
        <span className="hub-banner__next">{readiness.blockedReason}</span>
      </div>
    );
  }

  const pct = profileCompletionPct(onboarding, session);
  const next = nextIncompleteSection(null, onboarding, session);
  const stage = submitStage(onboarding, session.roles);

  // Everything is captured and the application is with us, or waiting to be
  // sent. The submit control says which, and carries its own deadline.
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
        {/*
          The server's own sentence, verbatim — the same one the refusal at
          checkout uses, so the two cannot drift. Only when the server had no
          answer for us does this fall back to naming the next card.
        */}
        {readiness?.blockedReason ?? (next ? `Next: ${next.title}.` : 'Every section is saved.')}
      </span>
      {canAct ? (
        <Link className="hub-banner__cta" href="/profile">
          Finish profile
        </Link>
      ) : null}
    </div>
  );
}
