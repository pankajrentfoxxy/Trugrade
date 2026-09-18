'use client';

import * as React from 'react';
import Link from 'next/link';
import { BRAND } from '@trugrade/config/brand';
import { logout } from './register/api';

function initials(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * The signed-in account control and its menu.
 *
 * It carries the same four utility links as the signed-out flyout in
 * `AuthButtons`. They used to live in the strip above the header; with that
 * strip switched off, putting them only in the signed-out panel would mean a
 * buyer who signs in loses the route to `Track order` and `Help` — which are
 * exactly the two a signed-in buyer needs most.
 */
export function AccountMenu({
  fullName,
  /** Resolved on the server — see the same prop on `AuthButtons`. */
  sellUrl,
}: {
  fullName?: string | null;
  sellUrl: string;
}): React.JSX.Element {
  const [signingOut, setSigningOut] = React.useState(false);
  const label = initials(fullName);
  const accountName = fullName?.trim() || 'Your account';

  const handleSignOut = (): void => {
    if (signingOut) return;
    setSigningOut(true);
    void (async () => {
      await logout();
      window.location.assign('/');
    })();
  };

  return (
    <div className="usermenu">
      <button
        type="button"
        className="uavatar"
        aria-haspopup="menu"
        aria-label={`${accountName} — account menu`}
      >
        {label ? (
          <span className="mono" aria-hidden="true">
            {label}
          </span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
            <path
              d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>
      <div className="usermenu-pop" role="menu" aria-label="Account">
        <div className="usermenu-panel">
          <Link className="usermenu-item" href="/home" role="menuitem">
            Account
          </Link>
          {/* See the note on the same link in `AuthButtons`. */}
          <a className="usermenu-item" href="/qc/verify" role="menuitem">
            Verify a certificate
          </a>
          <Link className="usermenu-item" href="/orders" role="menuitem">
            Track order
          </Link>
          <Link className="usermenu-item" href="/legal/grievance" role="menuitem">
            Help
          </Link>
          <a
            className="usermenu-item"
            href={sellUrl}
            role="menuitem"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sell on {BRAND.name} &rarr;
          </a>
          <div className="usermenu-sep" />
          <button
            type="button"
            className="usermenu-item"
            role="menuitem"
            disabled={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
