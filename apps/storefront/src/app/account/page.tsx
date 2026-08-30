/**
 * ARCHETYPE E — Workspace. A KPI row, then queues ordered by SLA breach.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The buyer's dashboard. It is the first screen of the customer portal
 * (03_UX_SPEC.md §3A) and the destination of the header's "Account" button,
 * which until now led nowhere.
 *
 * **Every number on this screen came from the API.** There is no derived
 * counter, no ratio computed in the browser and no gauge that exists to fill a
 * gap in the row. `GET /api/buyer/orders/summary` returns six figures and the
 * queue behind them; the screen renders those and stops. This build has already
 * had to strip fabricated counters off the homepage once, and a dashboard is
 * where that failure is most tempting and least visible.
 *
 * **The archetype's rule is "queues ordered by SLA breach", and this product
 * has exactly one SLA a buyer is on the receiving end of.** An order at
 * `AWAITING_APPROVAL` holds specific machines off sale, and
 * `ordering.order_approval.expires_at` — a real column with a real default of 24
 * hours — is when that hold releases on its own whether or not anybody is
 * looking. That is a promise we made to ourselves about somebody else's stock,
 * so it is genuinely the thing closest to being broken, and it goes at the top.
 *
 * Nothing else here has a deadline and none is invented for it. In particular
 * `order.stock_hold_expires_at` on a placed order is the spent twenty-minute
 * checkout hold — an instant already in the past — and an unpaid order has no
 * due date because we have never set one. Both are absent rather than dressed
 * up as clocks.
 *
 * **There is deliberately no primary action.** The one thing a pending approval
 * wants is a decision, and nothing in this product can take one yet: there is no
 * approve/reject endpoint, and the decision is not the requester's to make in
 * any case. So the screen says what is happening and who was asked, and offers
 * no button that would do nothing. "One primary action per screen" is a ceiling,
 * not a quota.
 */
import type { Metadata } from 'next';
import { Dashboard } from './Dashboard';

/** One organisation's working state. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

export default function AccountPage(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <Dashboard />
      </div>
    </div>
  );
}
