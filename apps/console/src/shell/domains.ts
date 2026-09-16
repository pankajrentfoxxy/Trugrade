import type { Permission } from '@trugrade/contracts';
import type { Principal } from '../lib/auth';

/**
 * The ops console: seven domains, each with its own tabs.
 *
 * **The rail is places and the tabs are places. Neither is ever a verb.** You
 * dispatch a purchase order from the purchase order record, so "Dispatch" is
 * not a rail item — it is a button on a record. That rule is what collapses an
 * earlier prototype's 22-item flat rail, about 1,950px and taller than any
 * laptop screen, into seven items that fit with room to spare.
 *
 * This lives beside `nav.ts` rather than replacing it. `NAV` still drives the
 * supplier hub's rail and the vendor surface entirely, and folding two
 * different information architectures into one list is how the vendor rail
 * ended up with four screens on it that are steps inside another screen's job.
 */

export interface OpsTab {
  to: string;
  /** 1–3 words. No verb, no article. */
  label: string;
  /**
   * The permission the API behind this tab actually checks.
   *
   * A tab gated on something the server does not check is how a rail comes to
   * offer a screen that 403s — which has happened here twice, both times
   * because the nav named a permission that was not in `ROLE_PERMISSIONS` at
   * all. There is a test that walks every one of these against `PERMISSIONS`.
   */
  permission?: Permission;
  /** Where the tab's count comes from, when it has one. A number is the cheapest sentence. */
  countKey?: string;
}

export interface OpsDomain {
  key: string;
  label: string;
  tabs: readonly OpsTab[];
}

export const OPS_DOMAINS: readonly OpsDomain[] = [
  {
    key: 'onboarding',
    label: 'Onboarding',
    tabs: [
      { to: '/kyc', label: 'KYC queue', permission: 'kyc.application.read', countKey: 'kyc' },
    ],
  },
  {
    key: 'catalog',
    label: 'Catalog',
    tabs: [
      { to: '/catalog', label: 'Catalog', permission: 'catalog.sku.read' },
      {
        to: '/catalog/condition-images',
        label: 'Image coverage',
        permission: 'catalog.condition_image.write',
      },
      {
        to: '/catalog/sku-requests',
        label: 'SKU requests',
        permission: 'catalog.sku_request.review',
      },
      { to: '/pricing/rules', label: 'Margin rules', permission: 'listing.price.override' },
    ],
  },
  {
    key: 'demand',
    label: 'Demand',
    tabs: [
      { to: '/orders', label: 'Orders', permission: 'ordering.any.read', countKey: 'orders' },
      { to: '/demand/credit', label: 'Credit', permission: 'credit.limit.read' },
    ],
  },
  {
    key: 'fulfilment',
    label: 'Fulfilment',
    tabs: [
      {
        to: '/procurement/pos',
        label: 'Purchase orders',
        permission: 'procurement.po.read_any',
        countKey: 'pos',
      },
      {
        to: '/fulfilment/shipments',
        label: 'Shipments',
        permission: 'logistics.shipment.read',
        countKey: 'shipments',
      },
      { to: '/fulfilment/pickups', label: 'Pickups', permission: 'logistics.shipment.read' },
      { to: '/fulfilment/riders', label: 'Riders', permission: 'logistics.rider.manage' },
      { to: '/fulfilment/carriers', label: 'Carriers', permission: 'logistics.shipment.read' },
      { to: '/fulfilment/ndr', label: 'NDR', permission: 'logistics.ndr.action', countKey: 'ndr' },
    ],
  },
  {
    key: 'quality',
    label: 'Quality',
    tabs: [
      // Inspections first: it is the queue where the next move is ours, and the
      // visit board beside it is the detailed view of the same work.
      {
        to: '/supply/inspections',
        label: 'Inspections',
        permission: 'qc.visit.read',
        countKey: 'inspections',
      },
      { to: '/qc/visits', label: 'Visits', permission: 'qc.visit.read' },
      { to: '/qc/schedule', label: 'Schedule', permission: 'qc.visit.schedule' },
      { to: '/qc/grade-corrections', label: 'Corrections', permission: 'qc.report.read' },
      { to: '/qc/sampling-rules', label: 'Sampling', permission: 'qc.sampling.write' },
      { to: '/qc/tool-providers', label: 'Tools', permission: 'qc.tolerance.write' },
      { to: '/qc/audit-recheck', label: 'Rechecks', permission: 'qc.audit.recheck' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    tabs: [
      { to: '/finance', label: 'Overview', permission: 'payment.ledger.read' },
      {
        to: '/finance/payables',
        label: 'Payables',
        permission: 'procurement.payable.read_any',
        countKey: 'payables',
      },
      { to: '/finance/payouts', label: 'Payouts', permission: 'procurement.payout.run' },
      { to: '/finance/escrow', label: 'Escrow', permission: 'finance.escrow.read' },
      { to: '/finance/exports', label: 'Registers', permission: 'finance.export.run' },
    ],
  },
  {
    key: 'platform',
    label: 'Platform',
    tabs: [
      {
        to: '/platform/approvals',
        label: 'Approvals',
        permission: 'identity.audit.read',
        countKey: 'approvals',
      },
      { to: '/platform/automation', label: 'Automation', permission: 'automation.rule.read' },
      { to: '/platform/users', label: 'People', permission: 'identity.user.read' },
      { to: '/platform/config', label: 'Config', permission: 'platform.config.write' },
      { to: '/platform/flags', label: 'Flags', permission: 'platform.feature_flag.write' },
      { to: '/platform/audit-log', label: 'Audit log', permission: 'identity.audit.read' },
    ],
  },
];

/** The home screen, and deliberately not a domain: it is where signing in lands. */
export const OPS_HOME = { to: '/overview', label: 'Today' };

export const canOpen = (tab: OpsTab, principal: Principal | null): boolean => {
  if (!principal || principal.orgType !== 'PLATFORM') return false;
  return !tab.permission || principal.permissions.includes(tab.permission);
};

/** Domains with at least one tab this seat can open. A walled domain disappears. */
export function visibleDomains(principal: Principal | null): OpsDomain[] {
  return OPS_DOMAINS.map((d) => ({ ...d, tabs: d.tabs.filter((t) => canOpen(t, principal)) })).filter(
    (d) => d.tabs.length > 0,
  );
}

/**
 * Longest prefix wins, so a detail screen keeps its section lit.
 *
 * `/catalog/condition-images` is matched by both `/catalog` and itself; lighting
 * Catalog while you are on Image coverage is the bug this sorts around.
 */
export function activeTab(pathname: string, domains: readonly OpsDomain[]): {
  domain: OpsDomain;
  tab: OpsTab;
} | null {
  const all = domains.flatMap((domain) => domain.tabs.map((tab) => ({ domain, tab })));
  const matches = all
    .filter(({ tab }) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))
    .sort((a, b) => b.tab.to.length - a.tab.to.length);
  return matches[0] ?? null;
}
