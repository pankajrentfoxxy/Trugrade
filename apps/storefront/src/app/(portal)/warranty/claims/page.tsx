/**
 * ARCHETYPE B — Board. Every warranty claim, including the settled ones.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The warranty board counts claims it could not open: its register query
 * excludes CLOSED and REJECTED by design, and the only link it drew was the
 * open claim on a machine. "2 of 11 raised" meant nine claims with no route.
 */
import type { Metadata } from 'next';
import { ClaimsBoard } from './ClaimsBoard';

/** One organisation's claims. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your warranty claims',
  robots: { index: false, follow: false },
};

export default function WarrantyClaimsPage(): React.JSX.Element {
  return (
    <div className="hub-page">
      <ClaimsBoard />
    </div>
  );
}
