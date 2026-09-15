import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { resolveConsoleBaseUrl } from '../../lib/console-url';
import { OtpSignIn } from './OtpSignIn';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * Signing in, for the customer side: a mobile number or a work email, and a
 * code. The same screen as `/register` in its sign-in mode.
 */

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Trugrade with a code to your mobile number or work email.',
  // Nothing behind this page is indexable, and a sign-in form in search results
  // is only ever somebody else's phishing landing page.
  robots: { index: false, follow: false },
};

export default async function Page(): Promise<React.JSX.Element> {
  const h = await headers();
  const consoleBase = resolveConsoleBaseUrl(h.get('host'), h.get('x-forwarded-proto') ?? undefined);

  return <OtpSignIn mode="sign-in" sellerRegisterUrl={`${consoleBase}/sell/register`} />;
}
