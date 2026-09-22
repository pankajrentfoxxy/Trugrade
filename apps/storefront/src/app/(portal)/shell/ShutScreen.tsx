'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button, EmptyState, HubPageHeader } from '@trugrade/ui';
import { usePortal } from './PortalContext';
import { submitStage } from '../profile/SubmitForReview';
import { lockOn, type NavLock, type PortalNavEntry } from './nav';

/**
 * What a locked rail entry shows when its URL is typed in anyway.
 *
 * The rail dimmed an entry and swallowed the click, and the address bar walked
 * straight past it: `/orders` typed by hand rendered the board for an
 * organisation nobody had verified, and `/team` rendered for a viewer up to
 * the moment its own request 403'd. A lock that only holds the handle is not a
 * lock. This is the same decision as the rail's — `lockOn`, the same two
 * inputs — applied to the screen, so the padlock and the page cannot disagree.
 *
 * It replaces the page rather than redirecting away from it. A bounce to Home
 * loses the address the buyer meant to reach and says nothing about why; a
 * screen at that address that names what is outstanding is the same honesty
 * the rail's hover text already has, at the place the buyer actually arrived.
 *
 * Two reasons, two sentences, as on the rail. A permission is about the seat
 * and will not change on its own. Verification is about the organisation and
 * is somebody else's outstanding work — and for an owner or admin, work they
 * can go and finish, so that seat gets the one control that moves it along.
 */

/** Roles that can act on a profile. A buyer or approver seat is only told. */
const CAN_COMPLETE = new Set(['CUSTOMER_OWNER', 'CUSTOMER_ADMIN']);

/**
 * The lock on the screen at this URL, or `null` when it is open. `Frame` asks
 * this once per navigation; exported so the gate can be tested as a decision
 * rather than through the whole shell.
 */
export const screenLock = (
  entry: PortalNavEntry | undefined,
  seat: { permissions: readonly string[]; orgVerified: boolean },
): NavLock | null => (entry ? lockOn(entry, seat) : null);

export function ShutScreen({
  entry,
  lock,
}: {
  entry: PortalNavEntry;
  lock: NavLock;
}): React.JSX.Element {
  const { session, onboarding, readiness, reload } = usePortal();

  if (lock.kind === 'permission') {
    return (
      <div className="hub-page" data-testid="shut-screen" data-lock="permission">
        <HubPageHeader title={entry.label} />
        <EmptyState
          title={`${entry.label} is not on this seat`}
          body="Your role on this account does not include this screen. Ask your account owner if you need a change made."
        />
      </div>
    );
  }

  // The verification read failed or was refused, so we do not know the answer.
  // Said as such, with the one thing that might change it — never dressed up
  // as "not verified", which is a different fact.
  if (!readiness) {
    return (
      <div className="hub-page" data-testid="shut-screen" data-lock="unverified">
        <HubPageHeader title={entry.label} />
        <EmptyState
          title="We could not read your account’s status"
          body={`${entry.label} opens once we have verified your company details, and that check did not come back just now.`}
          action={
            <Button variant="secondary" onClick={reload}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const canAct = session.roles.some((r) => CAN_COMPLETE.has(r));
  const stage = onboarding ? submitStage(onboarding, session.roles) : 'hidden';
  // With us for review: nothing on the buyer's side will open this sooner.
  const inReview = stage === 'in-review';

  return (
    <div className="hub-page" data-testid="shut-screen" data-lock="unverified">
      <HubPageHeader title={entry.label} />
      <EmptyState
        title={`${entry.label} opens once we have verified your company details`}
        body={
          inReview
            ? 'Your profile is with us for review. This screen opens when a reviewer has verified your company.'
            : // The server's sentence, verbatim — the same one the banner above
              // and the checkout refusal use, so the three cannot drift.
              readiness.blockedReason ??
              'A reviewer checks every buying organisation before its first order.'
        }
        action={
          canAct && !inReview ? (
            // A link, not the primary button: the banner above this screen
            // already carries "Finish profile" as the one primary action, and a
            // second amber control on the same screen would be a second answer
            // to the same question.
            <Link className="hub-link" href="/profile">
              Finish your profile
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
