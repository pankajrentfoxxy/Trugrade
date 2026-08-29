/**
 * ARCHETYPE D — Flow. Step rail + one step + "why we ask" rail.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Checkout. Six steps: review what is held, GSTIN and billing, delivery site,
 * your PO reference, how you are paying, confirm.
 *
 * Five rules shape everything on it.
 *
 * **1. The twenty-minute hold is real, and this screen is where it lives.** The
 * cart says in as many words that "stock is held for 20 minutes when you start
 * checkout, and the hold and its countdown are shown there". Opening this page
 * takes that hold: `ordering.checkout_hold_unit` names exact machines that are
 * genuinely off sale, `qty_available` really drops, and a job releases them when
 * the clock runs out whether or not this tab is open. The countdown reads
 * `expires_at` and nothing else. It is a deadline we imposed and can be checked
 * against the database — not a scarcity device, not manufactured urgency, and it
 * does not reset when the buyer presses F5.
 *
 * **2. The GSTIN decides the invoice; the DELIVERY SITE decides the tax.** The
 * chosen GSTIN fixes the billing entity and the buyer's input-credit position.
 * It does not fix the head: the place of supply under s.10(1)(a) IGST Act is
 * where the movement terminates, so a Haryana-registered buyer taking delivery
 * in Delhi owes IGST. The resolved split is on screen — the heads, the rate, our
 * state, the place of supply and the section that decided it — BEFORE anything
 * is confirmed, so a finance team catches a wrong GSTIN while it is still free
 * to change.
 *
 * **3. Every charge is on one screen, from the first step.** Machines, freight,
 * GST by head and the total, in a `PriceBreakup` that computes its own total
 * from its own lines. Nothing is revealed at the end; revealing charges
 * progressively is a named prohibited practice in the CCPA Dark Patterns
 * Guidelines 2023. When a lane cannot be priced the panel says so and the
 * primary action is refused — a zero standing in for "we could not price it"
 * would be a price misrepresentation under CP e-Comm r.6(5).
 *
 * **4. Nothing arrives pre-agreed.** There is no pre-ticked checkbox anywhere in
 * this flow, and no consent defaulted to true in a schema. Placing the order is
 * the agreement, and the button says which of the two things it does — place the
 * order, or send it for approval.
 *
 * **5. One seller, one invoice, no vendor anywhere.** Machines are grouped by
 * dispatch point because they leave from different warehouses on different days.
 * Internally that splits into sub-orders and purchase orders; none of that
 * vocabulary is on this screen, in this file, or in any response it reads. A
 * dispatch point is `Supply Point A · Gurugram` and carries nothing finer than
 * the city.
 *
 * The screen is a client component: every call is authenticated against the
 * buyer's session cookie, a signed-out visitor is a state it renders rather than
 * a crash, and the hold has to tick.
 */
import type { Metadata } from 'next';
import { CheckoutFlow } from './CheckoutFlow';

/** One person's order in progress. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default function CheckoutPage(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <CheckoutFlow />
      </div>
    </div>
  );
}
