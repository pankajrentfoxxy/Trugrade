/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: comfortable (set on `<html>` in the root layout).
 *
 * The people in the buying organisation — 03_UX_SPEC §3A `/account/team`.
 *
 * Five rules shape it.
 *
 * **1. The role matrix is read from the server, never hard-coded here.** The
 * spec says so of `/account/roles` and the same rule binds this screen, because
 * what a role grants is a row in `identity.role_permission` and a copy in the
 * browser is a copy that goes stale the first time a permission moves. Each role
 * arrives with its permissions and with whether the reader may grant it.
 *
 * **2. Nobody can grant a power they do not hold.** *"Custom roles cannot exceed
 * the creator's own permissions."* Applied to the fixed roles too: an admin who
 * cannot approve orders cannot make somebody an approver. The screen marks those
 * roles unavailable and says why; the server refuses one anyway, and a test
 * attempts it.
 *
 * **3. Deactivation never deletes.** The orders somebody raised keep naming
 * them. Switching an account off suspends it and revokes every live session with
 * it — a deactivation that leaves a thirty-day refresh token alive has
 * deactivated nobody.
 *
 * **4. At least one account owner must remain, and the screen says why before
 * the button is pressed.** An organisation with no owner cannot grant the role
 * back to itself. The last owner's row states that instead of offering a control
 * that would fail.
 *
 * **5. You cannot change your own access here.** Removing your own last
 * permission is how an organisation locks itself out, so your own row carries
 * the reason and no controls.
 *
 * Colour: a role is not a verdict, and a suspended account is not a FAIL. Every
 * chip on this board is neutral. Amber appears once, on the one primary action —
 * saving a change to somebody's roles.
 *
 * **Invitations are not built.** 03_UX_SPEC asks for them and they need a token,
 * an email and an accept route that does not exist; a button that opened a form
 * leading nowhere would be worse than none, so the empty state says how somebody
 * joins today instead of pretending. Reported in the ledger.
 */
import type { Metadata } from 'next';
import { TeamBoard } from './TeamBoard';

/** One organisation's staff. Not cacheable, not indexable. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your team',
  robots: { index: false, follow: false },
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };

  return (
    <div className="body">
      <div className="wrap">
        {/* Board state in the URL, so "the four people who can approve" is a
            link somebody can send. */}
        <TeamBoard role={one('role')} status={one('status')} />
      </div>
    </div>
  );
}
