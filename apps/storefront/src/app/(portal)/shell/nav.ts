import type { Permission } from '@trugrade/contracts';

/**
 * The buyer portal's places.
 *
 * Eight rail items, one per screen the portal has. The list is the same list
 * the old `/account` tab strip drew, moved to the top level and into a rail:
 * `Home` is where signing in lands, `Profile` is where the account is finished,
 * and the other six are the boards the organisation works from.
 *
 * **Only routes that exist are listed.** A link to a screen before it is built
 * is a control that leads to a 404, which is the same defect as a missing
 * measurement drawn as a tick.
 */

export interface PortalNavEntry {
  to: string;
  label: string;
  /** The heading this link sits under. Entries are already in group order. */
  group: string;
  /**
   * What a seat needs to open this screen, when it needs anything.
   *
   * Absent means every signed-in buyer may open it. Present means the rail
   * shows it **dimmed with a lock**, never hidden: somebody who cannot find a
   * screen files a ticket, and somebody who can see it exists and is not theirs
   * does not. Typed against `Permission`, so a string the union does not carry
   * is a compile error rather than a rail entry nothing ever satisfies.
   */
  permission?: Permission;
}

export const PORTAL_NAV: readonly PortalNavEntry[] = [
  { to: '/home', label: 'Home', group: 'Today' },
  { to: '/orders', label: 'Orders', group: 'Buy', permission: 'ordering.own.read' },
  { to: '/approvals', label: 'Approvals', group: 'Buy', permission: 'ordering.own.read' },
  { to: '/returns', label: 'Returns', group: 'After sale', permission: 'ordering.own.read' },
  { to: '/warranty', label: 'Warranty', group: 'After sale', permission: 'ordering.own.read' },
  { to: '/addresses', label: 'Addresses', group: 'Account', permission: 'ordering.own.read' },
  // The team list is `identity.user.read` on the server, which a buyer,
  // approver, finance seat and viewer do not hold. The screen handles its own
  // 403 well; the rail now says so before the click rather than after it.
  { to: '/team', label: 'Team', group: 'Account', permission: 'identity.user.read' },
  { to: '/profile', label: 'Profile', group: 'Account' },
];

/** Whether this seat may open an entry. An entry with no permission is open to all. */
export const mayOpen = (entry: PortalNavEntry, permissions: readonly string[]): boolean =>
  entry.permission === undefined || permissions.includes(entry.permission);

/** Run-length grouped, so the rail reads as sections. */
export function portalGroups(): [string, PortalNavEntry[]][] {
  const out: [string, PortalNavEntry[]][] = [];
  for (const n of PORTAL_NAV) {
    const last = out[out.length - 1];
    if (last && last[0] === n.group) last[1].push(n);
    else out.push([n.group, [n]]);
  }
  return out;
}

/**
 * The entry the current URL is inside, longest path first — `/orders` stays
 * lit on `/orders/TT-26-00004/units`.
 */
export function activePortalEntry(pathname: string): PortalNavEntry | undefined {
  return PORTAL_NAV.filter((n) => pathname === n.to || pathname.startsWith(`${n.to}/`)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
}

/** Whether a path is inside the portal frame at all. The root layout's footer gate reads this. */
export const isPortalPath = (pathname: string): boolean =>
  activePortalEntry(pathname) !== undefined;
