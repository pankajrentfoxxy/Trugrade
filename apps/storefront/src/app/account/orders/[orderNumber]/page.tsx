/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * One order, read back: the confirmation the buyer lands on when checkout
 * commits, and the screen they come back to from the email that says their order
 * needs a signature. T16 ends here.
 *
 * Four rules shape it.
 *
 * **1. An order awaiting approval is NOT a confirmed order, and this screen
 * never lets the two blur.** PHASE_06 Task 2: when a policy threshold fires the
 * order sits at `AWAITING_APPROVAL`, **stock is held but nothing is committed** —
 * the exact machines are off sale to everyone else, no purchase order exists,
 * nothing is charged. So the heading over the serials reads "the machines held
 * against this order", never "yours"; the money panel says what the order *would*
 * come to; and the status pill says "Awaiting approval" and nothing that could be
 * read as placed or paid. T16 had to fix that exact phrasing once already.
 *
 * **2. The approval deadline is stated in full, because it is a real one we
 * imposed on ourselves.** `ordering.order_approval.expires_at` is mandatory and
 * defaults to 24 hours, because stock cannot be held out of the market
 * indefinitely waiting for a manager. The panel therefore says all five things
 * without hedging: what is held, for whom, until when, who was asked, and what
 * happens if nobody answers. On `EXPIRED` or `REJECTED` the hold has already
 * released and the screen says so plainly rather than leaving a buyer to guess
 * whether the machines are still theirs. This is the only countdown on the
 * screen; there is no other timer, no scarcity device and no invented urgency.
 *
 * **3. There are three documents and only two of them are the buyer's.**
 * PHASE_06 Task 6: the buyer's own PO reference (their procurement system's
 * number, which prints on our invoice) and our order confirmation to them are
 * theirs to see. **Our purchase order to the supply point is vendor and admin
 * only, never the buyer.** The guarantee is structural rather than a decision
 * taken in this file: no buyer-reachable endpoint reads
 * `procurement.purchase_order` at all, so there is no field on the payload this
 * screen renders and no route below it that would reach one.
 *
 * **4. One seller, one invoice, no vendor anywhere.** Machines are grouped by
 * dispatch point because they leave different warehouses on different days and
 * arrive on different days. Internally that is a sub-order and a purchase order
 * per vendor; none of that vocabulary is on this screen, in this file, or in any
 * response it reads. A dispatch point is `Supply Point F · Noida` and carries
 * nothing finer than the city.
 *
 * **There is deliberately no amber primary action.** Nothing on this screen is a
 * thing the buyer can do yet: payment is Phase 7, cancellation and reorder are
 * T21, and the one action an approval-pending order wants — approving it — is
 * not the requester's to take. A primary control that led nowhere would be worse
 * than none, and "one primary action per screen" is a ceiling, not a quota.
 */
import type { Metadata } from 'next';
import { OrderRecord } from './OrderRecord';

/** One organisation's order. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false, follow: false },
};

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}): Promise<React.JSX.Element> {
  const { orderNumber } = await params;
  return (
    <div className="body">
      <div className="wrap">
        <OrderRecord orderNumber={decodeURIComponent(orderNumber)} />
      </div>
    </div>
  );
}
