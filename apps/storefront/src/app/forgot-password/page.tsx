import type { Metadata } from 'next';

import { AuthShell } from '../AuthShell';
import { ForgotPassword } from './ForgotPassword';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 */

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Set a new Trugrade password with a code sent to your work email.',
  robots: { index: false, follow: false },
};

export default function Page(): React.JSX.Element {
  return (
    <AuthShell
      title="Reset your password"
      lede="We email a six-digit code to the address the account was opened with."
    >
      <ForgotPassword />
    </AuthShell>
  );
}
