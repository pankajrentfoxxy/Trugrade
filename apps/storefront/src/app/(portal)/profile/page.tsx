/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The buyer's profile as cards. Each card is one seeded BUYER onboarding step
 * — the same five the old `/register` wizard walked through in order — and
 * opens the same form in a dialog, so the profile is finished whenever suits
 * rather than in one sitting before the first order.
 *
 * The completion percentage on this screen carries its denominator, and the
 * "Submit for review" action appears only when the server's own
 * `isSubmittable` says the application is complete.
 */
import type { Metadata } from 'next';
import { ProfileHub } from './ProfileHub';

/** One organisation's particulars. Not cacheable, not indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false, follow: false },
};

export default function ProfilePage(): React.JSX.Element {
  return <ProfileHub />;
}
