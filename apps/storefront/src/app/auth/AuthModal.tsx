'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@trugrade/ui';
import { consoleSellRegisterUrl } from '../../lib/console-url';
import { OtpSignIn } from '../sign-in/OtpSignIn';
import { AuthArt } from './AuthArt';

/**
 * Signing in, or signing up, without leaving the page.
 *
 * The header's two buttons open this over whatever the visitor was looking
 * at: the art on the left, the same passwordless form as `/sign-in` and
 * `/register` on the right, and a link between the two that flips the form
 * in place. A returning buyer stays exactly where they were once the code
 * lands — the header simply re-reads the cookie — while a brand-new
 * organisation goes to its portal home, because there is nothing on the
 * shop it can do yet.
 *
 * The two routes still exist for bookmarks and for the portal's protected
 * redirect, which has no page to show a dialog over.
 */

export type AuthMode = 'register' | 'sign-in';

export function AuthModal({
  open,
  mode,
  onModeChange,
  onClose,
}: {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const [sellerUrl, setSellerUrl] = React.useState('/sell/register');
  // The console origin depends on the host the page is served from, which is
  // only known in the browser; the placeholder is the storefront's own
  // redirect to the same place, so the link is never wrong, only indirect.
  React.useEffect(() => setSellerUrl(consoleSellRegisterUrl()), []);

  const onSignedIn = (url: string, outcome: { created: boolean }): void => {
    if (outcome.created) {
      window.location.replace('/home');
      return;
    }
    onClose();
    // The server-rendered header decides who is signed in from the cookie the
    // code just set; a refresh is what makes it look again.
    router.refresh();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Kept for `aria-labelledby` and drawn for screen readers only. The form
      // underneath already says which of the two it is, in its own controls.
      title={mode === 'register' ? 'Create a buyer account' : 'Sign in'}
      titleHidden
      description={
        mode === 'register'
          ? 'Your mobile number and a code. Your name, work email and company details come later, from your account.'
          : undefined
      }
      size="lg"
      className="authmodal"
      // Nothing here is lost by closing: the form is two fields deep and the
      // header button reopens it in the state it started. Clicking the page
      // behind it means 'not now', and the dialog should take the hint.
      dismissOnBackdrop

    >
      <div className="authmodal__grid">
        <AuthArt />
        {open ? (
          <OtpSignIn
            key={mode}
            mode={mode}
            frame="bare"
            sellerRegisterUrl={sellerUrl}
            onModeChange={onModeChange}
            onSignedIn={onSignedIn}
          />
        ) : null}
      </div>
    </Modal>
  );
}
