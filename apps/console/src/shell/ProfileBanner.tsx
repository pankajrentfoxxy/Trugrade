import * as React from 'react';
import { Link } from 'react-router';
import type { ResumableOnboarding } from '@trugrade/contracts';
import {
  nextIncompleteSection,
  profileCompletionPct,
} from '../routes/vendor/profile/sections.config';
import { SubmitForReview, submitStage } from '../routes/vendor/profile/SubmitForReview';

/**
 * Profile completion, on every screen rather than only on Home.
 *
 * The seven required sections weigh exactly 100 between them, so "100%" means
 * one thing and one thing only: you can sell. A percentage that stopped at 90
 * with listing already open would be the screen disagreeing with the API.
 *
 * It sits in the shell because the vendor does not finish onboarding on the
 * onboarding screen — they finish it when they discover, three screens deep,
 * that listing is locked. The bar has to be where they are.
 *
 * **It disappears the moment the profile leaves the supplier's hands** — sent
 * for review, or approved. It is a prompt, not a status line, and a prompt with
 * nothing to prompt is a strip above every screen that people learn to skip.
 */

/** Roles that can actually act on a profile. Warehouse and Finance cannot. */
const CAN_COMPLETE = new Set(['VENDOR_OWNER', 'VENDOR_ADMIN']);

export function ProfileBanner({
  onboarding,
  roles,
}: {
  /** `null` while in flight — no bar on a guess, and no flash of 0%. */
  onboarding: ResumableOnboarding | null;
  roles: readonly string[];
}): React.JSX.Element | null {
  if (!onboarding) return null;

  const pct = profileCompletionPct(onboarding);
  const next = nextIncompleteSection(null, onboarding);
  const canAct = roles.some((r) => CAN_COMPLETE.has(r));
  const stage = submitStage(onboarding, roles);

  // Nothing is left for this supplier to do: the application is with us, or it
  // has already been approved. The bar exists to get an unfinished profile
  // finished, so once it is out of their hands it is a strip above every screen
  // saying "you are done" — which is a strip that stops being read. The review
  // deadline and the approval both still live on the profile screen. The buyer
  // portal's bar has always disappeared the moment ordering opens; this matches
  // it. A submission still waiting to be SENT keeps the bar: that is the one
  // case where the supplier is the one holding it up.
  if (onboarding.status === 'VERIFIED' || stage === 'in-review') return null;

  // Complete is not the same as submitted. A finished profile that is waiting on
  // the supplier to press the button says so here — the bar used to read
  // "Listing is open" while every listing screen was still padlocked.
  // 'outstanding' keeps the bar: "Next: Pickup address" is the better guide here,
  // and the hub already spells out what the server still wants.
  if (stage !== 'hidden' && stage !== 'outstanding') {
    return (
      <div className="hub-banner" data-testid="profile-banner">
        <span className="hub-banner__label">Profile completion</span>
        <span className="hub-banner__pill font-mono tnum">{pct}%</span>
        <SubmitForReview className="hub-banner__next" onboarding={onboarding} roles={roles} />
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
          "Listing is open" used to live here. It can no longer be true: a
          verified supplier has no bar at all now, so every profile that reaches
          this line still has something open — a server step the cards do not
          cover, or a decision that went against them.
        */}
        {next
          ? `Next: ${next.title}`
          : 'Every section is filled in — the profile screen says where it stands.'}
      </span>
      {canAct ? (
        <Link className="hub-banner__cta" to="/vendor/profile">
          {next ? 'Complete profile' : 'View profile'}
        </Link>
      ) : null}
    </div>
  );
}
