'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from './register/api';

function initials(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function AccountMenu({
  fullName,
}: {
  fullName?: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);
  const label = initials(fullName);
  const accountName = fullName?.trim() || 'Your account';

  const handleSignOut = (): void => {
    if (signingOut) return;
    setSigningOut(true);
    void (async () => {
      await logout();
      router.push('/');
      router.refresh();
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
          <Link className="usermenu-item" href="/account" role="menuitem">
            Account
          </Link>
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
