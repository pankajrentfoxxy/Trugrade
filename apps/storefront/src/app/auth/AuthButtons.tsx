'use client';

import * as React from 'react';
import Link from 'next/link';
import { BRAND } from '@trugrade/config/brand';
import { AuthModal, type AuthMode } from './AuthModal';

/**
 * The header's signed-out account control: one `Sign in` trigger and the
 * flyout it opens.
 *
 * WHY A FLYOUT AND NOT TWO BUTTONS
 * --------------------------------
 * Registration is not the visitor's job on arrival — buying is — so `Sign up`
 * is one level in rather than sitting beside `Sign in` competing with it. The
 * design system allows exactly one primary action per screen, and on a
 * storefront page that action belongs to the product, not to the chrome.
 *
 * The panel also carries the four utility links (verify, track, help, sell)
 * that used to live in the strip above the header. They are not decoration:
 * `Verify a certificate` and `Track order` are the two things someone who has
 * already bought comes back for, and with the strip switched off this is the
 * only route to them. `AccountMenu` carries the same four for the signed-in
 * case, so neither audience loses them.
 *
 * Open on hover AND on focus, in CSS, matching `.usermenu` — a keyboard user
 * tabbing to the trigger gets the same panel a mouse user gets, with no
 * JavaScript and no timing.
 *
 * The trigger stays a real link underneath: with scripting off, or before
 * hydration, a click still reaches `/sign-in`, which does the same job.
 */
export function AuthButtons({
  /**
   * Resolved on the server. `consoleHomeUrl()` reads `window` when it
   * can, so calling it here would let the client disagree with the server's
   * markup on the first paint.
   */
  sellUrl,
}: {
  sellUrl: string;
}): React.JSX.Element {
  const [mode, setMode] = React.useState<AuthMode | null>(null);

  const openAs =
    (next: AuthMode) =>
    (event: React.MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      setMode(next);
    };

  return (
    <>
      <div className="usermenu authpop">
        <a
          className="hbtn authpop-trigger"
          href="/sign-in"
          onClick={openAs('sign-in')}
          aria-haspopup="true"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.75" />
            <path
              d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          <strong>Sign in</strong>
        </a>

        <div className="usermenu-pop">
          <div className="usermenu-panel">
            <div className="authpop-top">
              <span>New customer?</span>
              <a className="authpop-cta" href="/register" onClick={openAs('register')}>
                Sign up
              </a>
            </div>
            {/* A plain anchor, not `Link`: `/qc/verify` has no page component —
                only `/qc/verify/[code]` — so typed routes reject it. Carried
                over from the utility strip exactly as it stood there, target
                included, rather than quietly repointed at something else. */}
            <a className="usermenu-item" href="/qc/verify">
              Verify a certificate
            </a>
            <Link className="usermenu-item" href="/orders">
              Track order
            </Link>
            <Link className="usermenu-item" href="/legal/grievance">
              Help
            </Link>
            <a className="usermenu-item" href={sellUrl} target="_blank" rel="noopener noreferrer">
              Sell on {BRAND.name} &rarr;
            </a>
          </div>
        </div>
      </div>

      <AuthModal
        open={mode !== null}
        mode={mode ?? 'sign-in'}
        onModeChange={setMode}
        onClose={() => setMode(null)}
      />
    </>
  );
}
