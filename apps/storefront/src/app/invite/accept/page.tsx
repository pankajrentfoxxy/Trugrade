import type { Metadata } from 'next';
import { AcceptInvite } from './AcceptInvite';

/**
 * **ARCHETYPE F — Focus.** Where a buyer's team invite lands.
 *
 * The API builds the emailed link against the storefront origin for a buying
 * organisation, so a colleague invited from `/team` arrives here and never at
 * the supplier console.
 */

export const metadata: Metadata = {
  title: 'Join your team',
  robots: { index: false, follow: false },
};

export default function Page(): React.JSX.Element {
  return <AcceptInvite />;
}
