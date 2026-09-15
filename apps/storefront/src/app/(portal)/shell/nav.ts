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
}

export const PORTAL_NAV: readonly PortalNavEntry[] = [
  { to: '/home', label: 'Home', group: 'Today' },
  { to: '/orders', label: 'Orders', group: 'Buy' },
  { to: '/approvals', label: 'Approvals', group: 'Buy' },
  { to: '/returns', label: 'Returns', group: 'After sale' },
  { to: '/warranty', label: 'Warranty', group: 'After sale' },
  { to: '/addresses', label: 'Addresses', group: 'Account' },
  { to: '/team', label: 'Team', group: 'Account' },
  { to: '/profile', label: 'Profile', group: 'Account' },
];

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
