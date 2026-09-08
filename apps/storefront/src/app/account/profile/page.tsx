/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The organisation's registration particulars — name, email, company, GSTIN and
 * PAN as collected at sign-up and verified before the account went live.
 */
import type { Metadata } from 'next';
import { ProfileBoard } from './ProfileBoard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false, follow: false },
};

export default function ProfilePage(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <ProfileBoard />
      </div>
    </div>
  );
}
