/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Seal verification at handover — the buyer's own check.
 * `03_UX_SPEC.md` §3A.3, `/account/orders/[id]/delivery`. The fourth sub-route
 * of the order record; the tab strip that reaches it lives in the record's
 * layout, so this screen grew a tab by adding one line to `OrderNav`.
 *
 * **This is the screen that turns APPLIED into INTACT.** A seal has two facts in
 * it and only one is a verdict: APPLIED means we sealed the machine and nobody
 * has looked since; INTACT means somebody looked and found it unbroken. Most
 * sellable stock is APPLIED, which is exactly why `SealChip` renders it neutral
 * — a green chip on every sealed machine tells the person doing the checking
 * that the check is already done. Every machine here starts amber-free and
 * neutral, and goes green only when this screen's own action has been taken on
 * it.
 *
 * **One refusal on this screen is a safety instruction, not a validation
 * message.** A scanned code that is not on this delivery gets an immediate
 * `role="alert"` carrying the server's own sentence: *"Seal 88-041992 is not on
 * this delivery. Do not accept this machine."* It is not styled as a form error
 * and it is not summarised, because the correct response to it is to keep the
 * machine on the vehicle.
 *
 * **A broken or missing seal blocks receipt and opens the return by itself.**
 * Rule 7(4) take-back is ours and non-delegable, so §3A.3 requires one tap and
 * not a support call. The buyer presses "Seal is broken" and the return number
 * is on the screen before they have put their phone away — nobody has to be
 * persuaded of anything.
 *
 * **The countdown is information, not pressure.** §3A.4 is explicit: no red, no
 * flashing, no "hurry". Hours remaining are a measured value, which is one of
 * amber's three permitted meanings, and the sentence beside them says what
 * happens when the window closes — the machine stays under warranty and a fault
 * found later still costs the buyer nothing. An expired window is neutral ink
 * and a date, never a failure.
 *
 * There is no vendor anywhere. A consignment is `Delivery 2 of 3 · Supply Point
 * A · Gurugram`, addressed by its position, because the internal grouping number
 * carries a word this product never says to a buyer.
 */
import type { Metadata } from 'next';
import { DeliveryCheck } from './DeliveryCheck';

/** One organisation's delivery. Nothing about it is cacheable or indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Check the seals on your delivery',
  robots: { index: false, follow: false },
};

export default async function OrderDeliveryPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}): Promise<React.JSX.Element> {
  const { orderNumber } = await params;
  return (
    <div className="body">
      <div className="wrap">
        <DeliveryCheck orderNumber={decodeURIComponent(orderNumber)} />
      </div>
    </div>
  );
}
