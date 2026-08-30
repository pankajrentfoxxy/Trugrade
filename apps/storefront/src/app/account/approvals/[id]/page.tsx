/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * One approval — 03_UX_SPEC §3A `/account/approvals/[id]`. This is where the
 * decision is actually taken, and where the endpoint that did not exist until
 * T25 is called.
 *
 * Five rules shape it.
 *
 * **1. Everything the spec asks to be on screen BEFORE the button is on screen
 * before the button**: the full landed cost with its tax split, the machines by
 * serial, who raised it, where it is going, and the policy clause that made an
 * approval necessary at all. *"Shows the serials that will be allocated, so an
 * approver approves specific machines."* An approve control above the evidence
 * would be a signature given without reading what is being signed.
 *
 * **2. The rejection reason is mandatory and goes to the requester verbatim**,
 * and the field says so above itself rather than after a refusal. The server
 * refuses a short one; the screen says why first, so nobody meets that refusal.
 *
 * **3. There is ONE amber action: Approve.** Declining is a real decision and a
 * destructive one, so it is a secondary control that opens its reason field —
 * two primary buttons on a screen whose whole purpose is a binary choice would
 * make the safer answer and the irreversible one look identical.
 *
 * **4. Green and red are used, deliberately and only here.** An approved or
 * declined order is a verdict, which is the one thing the design system reserves
 * PASS/FAIL colour for. Pending is neutral. Expired is neutral — a deadline that
 * passed is not a decision anybody took, and colouring it red would blame the
 * approver for a clock.
 *
 * **5. The expiry is the server's answer, not the browser's.** A `PENDING` row
 * past its deadline arrives already reported `EXPIRED`, exactly as T17
 * established, and the decision endpoint refuses one against the same clock. The
 * countdown on this page is display; it decides nothing.
 *
 * What the buyer never sees, here as everywhere: our purchase order to the
 * supply point. The order half of this payload is `OrderReadService`'s own
 * allow-list, which does not read `procurement.purchase_order` at all.
 */
import type { Metadata } from 'next';
import { ApprovalRecord } from './ApprovalRecord';

/** One person's pending decision. Not cacheable, not indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Approve an order',
  robots: { index: false, follow: false },
};

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  return (
    <div className="body">
      <div className="wrap">
        <ApprovalRecord approvalId={decodeURIComponent(id)} />
      </div>
    </div>
  );
}
