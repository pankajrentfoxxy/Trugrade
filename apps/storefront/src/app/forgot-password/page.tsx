import type { Metadata } from 'next';

import { AuthShell } from '../AuthShell';
import { ForgotPassword } from './ForgotPassword';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * Forgotten password, and the reset that follows it.
 *
 * This route did not exist. `ForgotPassword.tsx` sat in this folder with no
 * `page.tsx` beside it and was mounted only by the supplier console, so the
 * "Forgotten your password?" link on the buyer sign-in screen was a 404 — and
 * it compounds: a buyer who registered with a mobile has no password at all, so
 * the password tab cannot succeed for them and its one way out went nowhere.
 * This is also the route such a buyer uses to set a first password, once their
 * work email is verified on the profile.
 *
 * The same `AuthShell` as `/sign-in`, because the component itself renders only
 * the form — the console supplies its own chrome, and without an equivalent
 * here the screen would render headless.
 */

export const metadata: Metadata = {
  title: 'Forgotten password',
  description: 'Reset the password on your Trugrade account with a code to your work email.',
  // Same reasoning as /sign-in: nothing here is indexable, and a credential form
  // in search results is only ever somebody else's phishing landing page.
  robots: { index: false, follow: false },
};

export default function Page(): React.JSX.Element {
  return (
    <AuthShell
      title="Reset your password"
      lede="We email a six-digit code to the work email on your account. Registered with just a mobile? Verify a work email on your profile first, then set a password here."
    >
      <ForgotPassword signInPath="/sign-in" />
    </AuthShell>
  );
}
