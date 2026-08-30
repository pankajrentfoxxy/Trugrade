/**
 * ARCHETYPE D — Flow. One step, with the "why we ask" rail beside it.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Return within the 48-hour inspection window — `03_UX_SPEC.md` §3A.4,
 * `/account/returns/new?order=&units=`.
 *
 * One step rather than a rail of four, for the reason the claim form gives:
 * pick the machines, pick a reason, say what is wrong. Splitting three answers
 * across three screens is ceremony, and somebody standing over a laptop that is
 * not what they paid for is not in the mood for it. The rail on the right does
 * the work a stepper would have done — it says why each answer is asked for.
 *
 * **The countdown is information, not pressure.** §3A.4 is explicit about this
 * and it is the rule most easily broken by accident: no red, no flashing, no
 * "hurry". The hours remaining are amber because they are a **measured value**,
 * one of the accent's three permitted meanings, and the sentence beside them
 * says what happens when the window closes — the machine stays under warranty
 * and a fault found later still costs the buyer nothing. A closed window is
 * neutral ink and a date, and it routes to warranty rather than ending the
 * conversation.
 *
 * **Nothing silently disappears.** A machine that cannot be returned stays on
 * the screen with the sentence saying why — window closed, not delivered, a
 * return already open. A form that quietly omitted it would leave somebody
 * checking the serial on the case and concluding they had typed it wrong.
 *
 * **The window is decided on the server.** `open`, `hoursRemaining` and every
 * `blockedReason` arrive as fields. There is no date arithmetic on this screen
 * at all — the 48 hours are what decides whether a buyer has a remedy, and a
 * laptop clock must never be able to answer that.
 *
 * A return routes to us. There is no path on this screen to a supplier, because
 * under the merchant-of-record model there is nobody else to route to, and Rule
 * 7(4) take-back is ours and non-delegable.
 */
import type { Metadata } from 'next';
import { ReturnForm } from './ReturnForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Send a machine back',
  robots: { index: false, follow: false },
};

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; units?: string | string[]; reason?: string }>;
}): Promise<React.JSX.Element> {
  const { order, units, reason } = await searchParams;
  const preselected = units === undefined ? [] : Array.isArray(units) ? units : units.split(',');

  return (
    <div className="body">
      <div className="wrap">
        <ReturnForm
          initialOrder={order ?? ''}
          initialSerials={preselected.map((s) => s.trim().toUpperCase()).filter(Boolean)}
          initialReason={reason ?? ''}
        />
      </div>
    </div>
  );
}
