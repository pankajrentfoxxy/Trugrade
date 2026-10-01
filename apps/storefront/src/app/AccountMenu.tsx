'use client';

import * as React from 'react';
import Link from 'next/link';
import { BRAND } from '@trugrade/config/brand';
import { logout } from './register/api';

/** The name the header greets by: the first word, or "Account" with no name on file. */
function firstNameOf(fullName: string | null | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || 'Account';
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
  const firstName = firstNameOf(fullName);
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
        className="hbtn uacct"
        aria-haspopup="menu"
        aria-label={`${accountName} — account menu`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M6.3 18.4c1.2-2 3.3-3.2 5.7-3.2s4.5 1.2 5.7 3.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <strong className="uacct-name">{firstName}</strong>
        <svg
          className="uacct-chev"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="usermenu-pop" role="menu" aria-label="Account">
        <div className="usermenu-panel">
          <Link className="usermenu-item" href="/home" role="menuitem">
            Account
          </Link>
          {/* See the note on the same link in `AuthButtons`. */}
          <Link className="usermenu-item" href="/#verify" role="menuitem">
            Verify a certificate
          </Link>
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
