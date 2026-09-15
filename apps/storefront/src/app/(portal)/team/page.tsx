/**
 * ARCHETYPE B — Board. Data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The people in the buying organisation — the same shape as the supplier
 * hub's team screen: a members register, the invites still out, and the
 * capability matrix that says what each role can do.
 *
 * Five rules shape it.
 *
 * **1. The role matrix is read from the server, never hard-coded here.** Each
 * role arrives with its permissions and with whether the reader may grant it.
 * The capability grid is derived from the same `ROLE_PERMISSIONS` the guards
 * enforce, so the screen cannot promise a power that then 403s.
 *
 * **2. Nobody can grant a power they do not hold.** An admin who cannot
 * approve orders cannot make somebody an approver. The screen marks those
 * roles unavailable and says why; the server refuses one anyway.
 *
 * **3. Deactivation never deletes.** The orders somebody raised keep naming
 * them. Switching an account off suspends it and revokes every live session.
 *
 * **4. At least one account owner must remain**, and the last owner's row says
 * so instead of offering a control that would fail.
 *
 * **5. You cannot change your own access here.**
 *
 * Invites are single-use links sent by email, and the invitee signs in with a
 * code — there is no password anywhere on the buyer side.
 */
import type { Metadata } from 'next';
import { TeamBoard } from './TeamBoard';

/** One organisation's staff. Not cacheable, not indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your team',
  robots: { index: false, follow: false },
};

export default function TeamPage(): React.JSX.Element {
  return <TeamBoard />;
}
