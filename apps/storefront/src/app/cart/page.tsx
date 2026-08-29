/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The cart. One named cart is one record: the header is its identity, the lines
 * grouped by dispatch point are the evidence, and the panel on the right is
 * where the money and the one action live. It is not archetype B — there is no
 * filter rail, nothing to sort, and the rows are the record's contents rather
 * than a result set — but the lines themselves are `DataBoard`, the same table
 * every other screen uses, at the storefront's comfortable density.
 *
 * Four rules shape everything on it.
 *
 * **1. One seller, one invoice.** Lines are grouped by dispatch point because
 * machines physically leave from different warehouses on different days and a
 * buyer planning a rollout needs to know that. What they are NOT is separate
 * orders: internally Phase 6 splits this into sub-orders and purchase orders,
 * and none of that vocabulary is on this screen, in this file, or in any
 * response it reads. We are the merchant of record. There is one seller and one
 * invoice from TrueTech Services Pvt. Ltd., and the screen says so out loud.
 *
 * **2. Nothing here is reserved, and the screen says that too.** The backlog
 * line for this task asks for "a 20-minute hold with a visible timer". The hold
 * is real but it belongs to checkout (PHASE_05 Task 6, and `CartService`'s own
 * note): a cart is an intention, and a hold that is not released by the code
 * that took it leaks inventory. So there is no countdown here. A timer counting
 * down against nothing is a scarcity device wearing a clock, and it would be the
 * first dishonest pixel on this site. What the panel does instead is say when
 * the hold happens and where the buyer will see it.
 *
 * **3. Availability is re-read every time the screen opens.** `GET
 * /api/buyer/carts/:id` counts through `v_sellable_unit` at the moment of the
 * call, so "3 of the 5 units you selected are still available" is measured, not
 * remembered. A buyer must never reach checkout believing they hold units that
 * are gone — and when a line is short, the fix is one click and checkout stays
 * shut until it is taken.
 *
 * **4. No drip pricing.** Every charge is named on this one screen: our price
 * per machine, the line totals, the goods value, and — by name and by rate —
 * the freight and the GST that follow the delivery address. The cart has no
 * pincode to land them against, so it says which two are outstanding and where
 * they resolve, rather than showing a smaller number that behaves like a total.
 * Revealing charges progressively is a named prohibited practice in the CCPA
 * Dark Patterns Guidelines 2023 (PHASE_05 Task 5).
 *
 * The screen itself is a client component: every call it makes is authenticated
 * against the buyer's session cookie, and a signed-out visitor is a state it
 * renders rather than a crash.
 */
import type { Metadata } from 'next';
import { CategoryStrip } from '../CategoryStrip';
import { CartScreen } from './CartScreen';

/** A cart is one person's. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your cart',
  robots: { index: false, follow: false },
};

export default function CartPage(): React.JSX.Element {
  return (
    <>
      <CategoryStrip />
      <div className="body">
        <div className="wrap cartpage">
          <CartScreen />
        </div>
      </div>
    </>
  );
}
