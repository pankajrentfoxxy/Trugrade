'use client';

import * as React from 'react';
import { AuthModal, type AuthMode } from './AuthModal';

/**
 * The header's signed-out pair. Each opens the auth dialog in its own mode;
 * the dialog is mounted here, once, beside the buttons that own it.
 *
 * They stay real links underneath: with scripting off, or before hydration,
 * a click still reaches the page that does the same job.
 */
export function AuthButtons(): React.JSX.Element {
  const [mode, setMode] = React.useState<AuthMode | null>(null);

  const openAs =
    (next: AuthMode) =>
    (event: React.MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      setMode(next);
    };

  return (
    <>
      <a className="hbtn" href="/sign-in" onClick={openAs('sign-in')}>
        <span>
          <small>Returning?</small>
          <strong>Sign in</strong>
        </span>
      </a>
      <a className="hbtn solid" href="/register" onClick={openAs('register')}>
        <span className="hbtn-long">Create account</span>
        <span className="hbtn-short">Register</span>
      </a>
      <AuthModal
        open={mode !== null}
        mode={mode ?? 'sign-in'}
        onModeChange={setMode}
        onClose={() => setMode(null)}
      />
    </>
  );
}
