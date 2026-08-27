import type { Metadata } from 'next';

import { SignIn } from './SignIn';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * The frame is inside `SignIn` rather than here, because the width depends on
 * the stage: a credential form wants one narrow column beside the claim, and an
 * application status wants the whole page.
 */

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Trugrade with a code or a password.',
  // Nothing behind this page is indexable, and a sign-in form in search results
  // is only ever somebody else's phishing landing page.
  robots: { index: false, follow: false },
};

export default function Page(): React.JSX.Element {
  return <SignIn />;
}
