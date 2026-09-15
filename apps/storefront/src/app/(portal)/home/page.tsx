/**
 * ARCHETYPE E — Workspace. A KPI row, then queues ordered by SLA breach.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The buyer's home — the first screen of the portal, where signing in lands,
 * and the destination of the header's "Account" item.
 *
 * **Every number on this screen came from the API.** `GET /api/buyer/orders/summary`
 * returns six figures and the queue behind them; the screen renders those and
 * stops. The profile completion percentage is the one figure computed here,
 * and it carries its denominator — sections done out of sections there are.
 *
 * **The one SLA a buyer is on the receiving end of** is an approval hold:
 * `order_approval.expires_at` is when held stock releases on its own. It is the
 * thing closest to being broken, so it is the queue at the top.
 *
 * The screen's one primary action is "Start purchasing", which goes back to the
 * shop: this portal is where an organisation looks after its buying, and the
 * shop is where the buying happens.
 */
import type { Metadata } from 'next';
import { Home } from './Home';

/** One organisation's working state. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Home',
  robots: { index: false, follow: false },
};

export default function HomePage(): React.JSX.Element {
  return <Home />;
}
