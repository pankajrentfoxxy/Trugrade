/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The approval inbox — 03_UX_SPEC §3A `/account/approvals`, and the screen that
 * closes this build's oldest reachability gap.
 *
 * PHASE_06 Task 2 built the approval policy, the `ordering.order_approval` row
 * and the twenty-four-hour deadline. The order transaction writes the row. And
 * until now **nothing in the product could decide one**: `APPROVED` and
 * `REJECTED` were states the database allowed and no person could reach, so
 * orders sat at `AWAITING_APPROVAL` with specific machines held off sale until
 * their deadline lapsed. T19's dashboard deliberately rendered no approve
 * button for exactly that reason. This screen and
 * `POST /api/buyer/approvals/:id/decision` are the pair that makes it real.
 *
 * Four rules shape it.
 *
 * **1. The row is not where a decision is taken.** A row action opens the
 * approval; approving happens on the record, where the serials, the delivery
 * site, the tax split and the policy clause are all on screen. 03_UX_SPEC asks
 * for exactly that — *"Approving shows the full landed cost, the PO number, the
 * requester and which policy rule triggered the approval, before the button"* —
 * and a one-click approve in a table row is a signature given without reading
 * what is being signed. **The spec's "bulk approve" is deliberately not built**
 * for the same reason; it is noted in the ledger rather than shipped.
 *
 * **2. Green and red appear here, and only here on a buyer's screens.** An
 * approved or rejected order is a verdict — the one thing the design system
 * reserves PASS/FAIL colour for. A *pending* approval is not a verdict and gets
 * a neutral pill; neither does an expired one, which is a deadline that passed
 * rather than a decision that was taken.
 *
 * **3. The clock is the server's.** A `PENDING` row past `expires_at` arrives
 * already reported as `EXPIRED` — T17 established that the server decides this,
 * because a browser clock must not be able to move a money deadline. Nothing on
 * this screen compares a date to `Date.now()` to decide a status; the countdown
 * is display only, and the row it sits on has already been classified.
 *
 * **4. Empty is calm, not a nag.** 03_UX_SPEC calls the empty state
 * "success-terminal": *"Nothing waiting on you."* No red, no count of things
 * somebody else owes, no call to action.
 */
import type { Metadata } from 'next';
import { ApprovalsBoard } from './ApprovalsBoard';

/** One person's outstanding decisions. Not cacheable, not indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Approvals',
  robots: { index: false, follow: false },
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  // The board's whole state comes off the URL and is handed down as the exact
  // query string the API is asked for, so the address bar and the request
  // cannot disagree. Unknown keys are dropped by the server's schema.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const one = Array.isArray(value) ? value[0] : value;
    if (one) query.set(key, one);
  }

  return (
    <div className="body">
      <div className="wrap">
        <ApprovalsBoard query={query.toString()} />
      </div>
    </div>
  );
}
