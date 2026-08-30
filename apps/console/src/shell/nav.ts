import type { Permission } from '@trugrade/contracts';
import type { Principal } from '../lib/auth';
import { qcRoutes } from '../routes/qc';

export interface NavEntry {
  to: string;
  label: string;
  permission: Permission;
  /** The heading this link sits under. Links are ordered by group already. */
  group: string;
  /**
   * Restricts the link to one kind of organisation, on top of the permission.
   *
   * Permission alone is not enough for the QC group: a VENDOR_ADMIN genuinely
   * holds `qc.visit.read` and `qc.report.read` — for *their own* visits — but
   * these screens are the platform's board (`/api/qc/technicians`,
   * `/api/qc/sampling-rules`), and every request behind them would 403. Showing
   * a vendor a section that cannot open is the bug this field closes.
   */
  orgType?: Principal['orgType'];
}

/**
 * Every section in the console, and — because `Landing` reads the same list —
 * every place signing in can put you.
 *
 * The QC entries are derived from `routes/qc`'s own barrel rather than restated
 * here: that array already carries the label and the permission for each screen,
 * and a second copy of a permission string is the copy that goes stale. Only the
 * entries with a `label` belong in navigation, which is how the two QC detail
 * routes and the inspection form stay out of it.
 *
 * The vendor portal contributes its two by hand because `routes/vendor` has no
 * labels. Two and not one: the single entry that used to be here was labelled
 * "My listings" and pointed at `/vendor`, which is the dashboard — so the only
 * link a vendor had named a screen it did not open, and the board it did name
 * was reachable only by clicking a tile. The other four vendor screens are
 * genuinely reached from these two and stay out of the rail.
 */
export const NAV: readonly NavEntry[] = [
  // `kyc.application.read` is the permission the API actually gates
  // GET /api/kyc/review-queue on. The entry previously said 'kyc.review', which
  // is not in ROLE_PERMISSIONS — so no principal matched it and the KYC section
  // was invisible to the reviewers it exists for.
  //
  // The '/vendors' entry that sat here is gone: it was gated on 'vendor.read'
  // (also not a permission) and pointed at a path with no <Route> behind it.
  { to: '/kyc', label: 'KYC queue', permission: 'kyc.application.read', group: 'Onboarding' },
  { to: '/catalog', label: 'Catalog', permission: 'catalog.sku.read', group: 'Catalog' },
  {
    to: '/catalog/condition-images',
    label: 'Image coverage',
    permission: 'catalog.condition_image.write',
    group: 'Catalog',
  },
  {
    to: '/catalog/sku-requests',
    label: 'SKU requests',
    permission: 'catalog.sku_request.review',
    group: 'Catalog',
  },
  ...qcRoutes.flatMap((r) =>
    r.label === undefined
      ? []
      : [
          {
            to: r.path,
            label: r.label,
            permission: r.permission,
            group: 'Quality',
            orgType: 'PLATFORM' as const,
          },
        ],
  ),
  {
    to: '/vendor',
    label: 'Today',
    permission: 'listing.own.read',
    group: 'Vendor',
    orgType: 'VENDOR',
  },
  {
    to: '/vendor/listings',
    label: 'My listings',
    permission: 'listing.own.read',
    group: 'Vendor',
    orgType: 'VENDOR',
  },
  // Its own entry rather than a tile alone: a correction is on a two-day clock
  // and auto-applies, so it must be reachable without first noticing a queue on
  // the dashboard. `listing.own.read` and not the respond permission — a
  // VENDOR_VIEWER may read what was corrected on their own stock.
  {
    to: '/vendor/corrections',
    label: 'Grade corrections',
    permission: 'listing.own.read',
    group: 'Vendor',
    orgType: 'VENDOR',
  },
];

export const canSee = (n: NavEntry, p: Principal): boolean =>
  p.permissions.includes(n.permission) && (n.orgType === undefined || n.orgType === p.orgType);

/**
 * The visible links, run-length grouped so the chrome reads as sections.
 *
 * `NAV` is already in group order, so adjacency is the grouping — no map, no
 * sort, and a group whose every link was filtered away simply never appears.
 */
export function visibleGroups(principal: Principal): [string, NavEntry[]][] {
  const out: [string, NavEntry[]][] = [];
  for (const n of NAV) {
    if (!canSee(n, principal)) continue;
    const last = out[out.length - 1];
    if (last && last[0] === n.group) last[1].push(n);
    else out.push([n.group, [n]]);
  }
  return out;
}

/**
 * The entry the current URL is inside, longest path first.
 *
 * Longest-match rather than react-router's `isActive`, because `/catalog` and
 * `/catalog/sku-requests` are both prefixes of the second URL and only one of
 * them is the screen you are on. It also keeps `/kyc` lit while you read
 * `/kyc/:orgId`, and `/vendor` lit across all six vendor screens — neither of
 * which has a nav entry of its own.
 */
export function activeEntry(pathname: string, entries: readonly NavEntry[]): NavEntry | undefined {
  return entries
    .filter((n) => pathname === n.to || pathname.startsWith(`${n.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

/**
 * The two-letter monogram the rail shows when it is collapsed.
 *
 * A single initial is not enough: "Scheduling" and "Sampling rules" sit in the
 * same section and would both read "S", which is a navigation that lies. Word
 * initials first, falling back to the first two letters of a one-word label.
 */
export function monogram(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0] ?? '').join('');
  return (initials.length > 1 ? initials.slice(0, 2) : label.slice(0, 2)).toUpperCase();
}
