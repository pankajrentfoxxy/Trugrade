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
  /**
   * Opens only once a reviewer has verified the organisation.
   *
   * These are the screens that only mean something for an account we have
   * actually onboarded. The condition is the server's own `orgStatus`, read
   * from `GET /buyer/order-readiness` — `VERIFIED` is reachable only through a
   * reviewer — `CheckoutService.orderReadiness` says so in its own comment —
   * which is exactly what "verified by an admin" means. It is never recomputed
   * from the profile cards: completeness and verification are different
   * questions, and only one of them is ours to answer.
   */
  needsVerifiedOrg?: true;
}

export const PORTAL_NAV: readonly PortalNavEntry[] = [
  { to: '/home', label: 'Home', group: 'Today' },
  {
    to: '/orders',
    label: 'Orders',
    group: 'Buy',
    permission: 'ordering.own.read',
    needsVerifiedOrg: true,
  },
  {
    to: '/approvals',
    label: 'Approvals',
    group: 'Buy',
    permission: 'ordering.own.read',
    needsVerifiedOrg: true,
  },
  {
    to: '/returns',
    label: 'Returns',
    group: 'After sale',
    permission: 'ordering.own.read',
    needsVerifiedOrg: true,
  },
  {
    to: '/warranty',
    label: 'Warranty',
    group: 'After sale',
    permission: 'ordering.own.read',
    needsVerifiedOrg: true,
  },
  { to: '/addresses', label: 'Addresses', group: 'Account', permission: 'ordering.own.read' },
  // The team list is `identity.user.read` on the server, which a buyer,
  // approver, finance seat and viewer do not hold. The screen handles its own
  // 403 well; the rail now says so before the click rather than after it.
  { to: '/team', label: 'Team', group: 'Account', permission: 'identity.user.read' },
  { to: '/profile', label: 'Profile', group: 'Account' },
];

/**
 * Whether this seat's PERMISSIONS admit it to an entry. An entry with no
 * permission is open to all.
 *
 * The permission question only. An entry can also be shut behind the
 * organisation's verification, which is not a property of the seat — `lockOn`
 * below is the whole answer.
 */
export const mayOpen = (entry: PortalNavEntry, permissions: readonly string[]): boolean =>
  entry.permission === undefined || permissions.includes(entry.permission);

/** Why an entry is shut. Two different facts, so the rail says them differently. */
export type NavLock = { kind: 'permission'; permission: Permission } | { kind: 'unverified' };

/**
 * Why this rail entry is shut, or `null` when it is open.
 *
 * Permission first. "This seat is not admitted" stays true whatever the
 * organisation's status, so telling somebody to wait for a verification that
 * will not open the screen for them anyway would be the wrong sentence.
 *
 * `orgVerified` is `false` when the answer is no AND when we could not read it
 * — an unread verification is not a passing one. The shell holds its skeleton
 * until that read lands, so this is never asked before there is an answer.
 */
export function lockOn(
  entry: PortalNavEntry,
  seat: { permissions: readonly string[]; orgVerified: boolean },
): NavLock | null {
  if (entry.permission !== undefined && !seat.permissions.includes(entry.permission))
    return { kind: 'permission', permission: entry.permission };
  if (entry.needsVerifiedOrg && !seat.orgVerified) return { kind: 'unverified' };
  return null;
}

/** What the rail says about a shut entry, on hover and to a screen reader. */
export const lockLabel = (entry: PortalNavEntry, lock: NavLock): string =>
  lock.kind === 'permission'
    ? `${entry.label} — needs ${lock.permission}`
    : `${entry.label} — opens once we have verified your company details.`;

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
