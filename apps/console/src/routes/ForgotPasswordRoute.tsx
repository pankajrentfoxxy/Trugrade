import { AuthShell } from '../AuthShell';
import { ForgotPassword } from '../../../storefront/src/app/forgot-password/ForgotPassword';

/**
 * **ARCHETYPE F — Focus.** One task, centred, no navigation.
 *
 * Staff and suppliers reset here on the console origin so cookies and the
 * `/api` proxy stay first-party — same reason vendor registration lives here.
 */

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000';

export function ForgotPasswordRoute(): React.JSX.Element {
  return (
    <AuthShell
      title="Reset your password"
      lede="We email a six-digit code to the address the account was opened with."
      brandHref={STOREFRONT_URL}
    >
      <ForgotPassword signInPath="/login" />
    </AuthShell>
  );
}
