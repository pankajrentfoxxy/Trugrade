import type { Permission } from '@trugrade/contracts';
import type { Principal } from '../lib/auth';
import { platformRoutes } from '../routes/platform';
import { qcRoutes } from '../routes/qc';

export interface NavEntry {
  to: string;
  label: string;
  /**
   * The permission the API behind this link actually checks.
   *
   * Optional for exactly one entry, and the reason is worth stating: the ops
   * overview has no single permission. Every section of it is gated separately
   * by the server and assembled from whatever the caller holds, so there is no
   * string that means "you may open this". Gating the link on any one of them —
   * `identity.audit.read` being the tempting choice — would hide it from a
   * QC_MANAGER and a FINANCE who each have a real slice on it. Absent means the
   * link is gated on `orgType` alone, which is what that screen genuinely
   * requires; anything else must name its permission.
   */
  permission?: Permission;
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
  /** Which frame renders this entry. Absent means the admin Shell. */
  surface?: 'VENDOR';
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
  // T34. **First in the list, so it is where signing in lands platform staff** —
  // `Landing` redirects to the first entry a principal can see, and the day's
  // exceptions are the right first screen for anyone who works here. No
  // `permission`: see `NavEntry.permission`. `orgType` keeps it off a vendor's
  // rail, where it would 403 on every request behind it.
  { to: '/overview', label: 'Today', group: 'Operations', orgType: 'PLATFORM' },
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
  // T38. `listing.price.override` and not `listing.any.read`: the API guards the
  // route on the former, and a link gated on something the server does not check
  // is how a rail comes to offer a screen that 403s. It is also the narrower of
  // the two — `listing.any.read` reaches OPS_MANAGER, QC_MANAGER, CATALOG_ADMIN
  // and TECHNICIAN, and this screen carries what we keep on every machine.
  {
    to: '/pricing/rules',
    label: 'Margin rules',
    permission: 'listing.price.override',
    group: 'Pricing',
  },
  // T39. Each entry names the permission the API actually checks —
  // `ordering.any.read` on GET /api/ops/orders and `procurement.po.read_any` on
  // GET /api/ops/purchase-orders — and the two are deliberately DIFFERENT:
  // SUPPORT holds the first and not the second, FINANCE and PRICING_ADMIN the
  // second and (for PRICING_ADMIN) not the first, so a single permission over
  // both would offer one of them a screen that 403s. `orgType` on top, as the
  // QC group does: both are `*.any.*` and no tenant role holds either, but a
  // rail is cheap to be sure about.
  {
    to: '/orders',
    label: 'Orders',
    permission: 'ordering.any.read',
    group: 'Orders',
    orgType: 'PLATFORM',
  },
  {
    to: '/procurement/pos',
    label: 'Purchase orders',
    permission: 'procurement.po.read_any',
    group: 'Orders',
    orgType: 'PLATFORM',
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
    group: 'Today',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/listings',
    label: 'Listings',
    permission: 'listing.own.read',
    group: 'Sell',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/listings/new',
    label: 'Create listing',
    permission: 'listing.own.write',
    group: 'Sell',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/sku-request',
    label: 'Request a SKU',
    permission: 'listing.own.write',
    group: 'Sell',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/qc/visits',
    label: 'Inspections',
    permission: 'listing.own.read',
    group: 'Inspect',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/corrections',
    label: 'Grade corrections',
    permission: 'listing.own.read',
    group: 'Inspect',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/orders',
    label: 'Purchase orders',
    permission: 'procurement.po.read_own',
    group: 'Fulfil',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/dispatch',
    label: 'Dispatch',
    permission: 'procurement.po.read_own',
    group: 'Fulfil',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/payables',
    label: 'Payables',
    permission: 'procurement.payable.read_own',
    group: 'Money',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/payouts',
    label: 'Payout history',
    permission: 'procurement.payable.read_own',
    group: 'Money',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/team',
    label: 'Team & access',
    permission: 'listing.own.read',
    group: 'Account',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/facilities',
    label: 'Facilities',
    permission: 'listing.own.read',
    group: 'Account',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/documents',
    label: 'Documents',
    permission: 'listing.own.read',
    group: 'Account',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  {
    to: '/vendor/profile',
    label: 'Profile',
    permission: 'listing.own.read',
    group: 'Account',
    orgType: 'VENDOR',
    surface: 'VENDOR',
  },
  // T40 and T41, derived from their own barrel for the reason the QC entries
  // are: that array already carries the label and the permission, and a second
  // copy of a permission string is the copy that goes stale. `orgType` keeps
  // them off a vendor's rail — no vendor role holds `payment.ledger.read`,
  // `platform.config.write` or `identity.audit.read`, but a link that would 403
  // must not be offered even in principle.
  ...platformRoutes.map((r) => ({
    to: r.path,
    label: r.label,
    permission: r.permission,
    group: r.group,
    orgType: 'PLATFORM' as const,
  })),
];

export const canSee = (n: NavEntry, p: Principal): boolean =>
  (n.permission === undefined || p.permissions.includes(n.permission)) &&
  (n.orgType === undefined || n.orgType === p.orgType);

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
