/**
 * ARCHETYPE D — Flow. One step, with the "why we ask" rail beside it.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * Raise a warranty claim — `03_UX_SPEC.md` §3A.4, `/account/warranty/claims/new`.
 *
 * One step rather than a rail of four, deliberately. The spec's flow is: pick a
 * serial, pick a fault category, describe it, attach evidence. Splitting four
 * fields across four screens is ceremony, and a person whose laptop has stopped
 * working is not in the mood for it. The rail on the right does the work a
 * stepper would have done — it says why each answer is asked for.
 *
 * **The refusals are the feature.** A claim can be refused for three different
 * reasons and each one has a different next step, so none of them is a red
 * border with no message:
 *
 *   - the serial is not on this account → we name what we searched;
 *   - the machine has not been delivered → cover has not started, and that is
 *     our record to correct, not the buyer's problem;
 *   - the cover has ended → the exact date, plus the paid-repair route, because
 *     §4.6 requires an expiry to be a fact with a way forward beside it and not
 *     a dead end.
 *
 * **A claim routes to us.** There is no path on this screen to a supplier,
 * because under the merchant-of-record model there is nobody else to route to.
 * Nothing on it names one.
 */
import type { Metadata } from 'next';
import { ClaimForm } from './ClaimForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Start a warranty claim',
  robots: { index: false, follow: false },
};

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ serial?: string }>;
}): Promise<React.JSX.Element> {
  const { serial } = await searchParams;
  return (
    <div className="body">
      <div className="wrap">
        <ClaimForm initialSerial={serial ?? ''} />
      </div>
    </div>
  );
}
