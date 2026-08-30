/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The organisation's address book — 03_UX_SPEC §3A `/account/addresses`.
 *
 * A record and not a board: this is one organisation's own particulars, there is
 * nothing to filter, nothing to sort and nothing to page. The evidence panel is
 * the sites themselves; the side panel is the one action, which is adding
 * another.
 *
 * Four rules shape it.
 *
 * **1. A billing address cannot be edited here, and the reason is on the card.**
 * It is bound to a GSTIN and it is what every invoice we raise carries, so
 * changing it changes the jurisdiction the tax is charged in. 03_UX_SPEC: *"a
 * change requires a `profile_change_request` with proof."* The server refuses it
 * by address type rather than by trusting a flag the browser was handed — a test
 * PATCHes one anyway and asserts the stored state is unchanged.
 *
 * **2. A delivery site is what a rider reads, so it asks for what a rider
 * needs.** Contact name, mobile, landmark and the gate or security instruction,
 * which is shown to the driver verbatim. Every one of those exists as a column.
 *
 * **3. Receiving hours are asked for by the spec and there is no column for
 * them.** So the form does not offer a field that would silently discard what
 * somebody typed, and every card says *"Not recorded"* in `--ink-4` rather than
 * drawing hours we never collected. A delivery outside invented hours is a
 * failed delivery made on our own promise.
 *
 * **4. Nothing is deleted.** Retiring a site sets `is_active = false`, and the
 * orders that went there keep pointing at it. The last active site cannot be
 * retired at all, because checkout needs somewhere to send machines — and the
 * screen says that before the button is pressed, not after.
 *
 * One amber action on the screen: **Save this site**. Setting a default and
 * retiring a site are secondary controls on the card they belong to.
 */
import type { Metadata } from 'next';
import { AddressBook } from './AddressBook';

/** One organisation's own particulars. Not cacheable, not indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your addresses',
  robots: { index: false, follow: false },
};

export default function AddressesPage(): React.JSX.Element {
  return (
    <div className="body">
      <div className="wrap">
        <AddressBook />
      </div>
    </div>
  );
}
