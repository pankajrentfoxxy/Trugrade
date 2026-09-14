import * as React from 'react';
import { Link } from 'react-router';
import type { ResumableOnboarding } from '@trugrade/contracts';
import {
  nextIncompleteSection,
  profileCompletionPct,
} from '../routes/vendor/profile/sections.config';

/**
 * Profile completion, on every screen rather than only on Home.
 *
 * The five required sections weigh exactly 100 between them, so "100%" means
 * one thing and one thing only: you can sell. A percentage that stopped at 90
 * with listing already open would be the screen disagreeing with the API.
 *
 * It sits in the shell because the vendor does not finish onboarding on the
 * onboarding screen — they finish it when they discover, three screens deep,
 * that listing is locked. The bar has to be where they are.
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
  const done = next === null;
  const canAct = roles.some((r) => CAN_COMPLETE.has(r));

  // A member who cannot complete a profile is told about it only while it is
  // still blocking them. Once it is done the bar is noise on every screen.
  if (done && !canAct) return null;

  return (
    <div className={done ? 'hub-banner hub-banner--done' : 'hub-banner'} data-testid="profile-banner">
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
        {done ? 'Your profile is complete. Listing is open.' : `Next: ${next.title}`}
      </span>
      {canAct ? (
        <Link className="hub-banner__cta" to="/vendor/profile">
          {done ? 'View profile' : 'Complete profile'}
        </Link>
      ) : null}
    </div>
  );
}
