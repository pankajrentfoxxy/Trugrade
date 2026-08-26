/**
 * Roles and permissions. 02_ARCHITECTURE.md §6 names sixteen platform roles;
 * 03_UX_SPEC.md Part 3 names the buyer/vendor/admin role vocabulary the screens
 * are gated on. Both are the same set viewed from two directions — this file is
 * the reconciliation, and it is the one place either is defined.
 */

export const PLATFORM_ROLES = [
  'PLATFORM_SUPERADMIN',
  'OPS_MANAGER',
  'KYC_REVIEWER',
  'CATALOG_ADMIN',
  'PRICING_ADMIN',
  'QC_MANAGER',
  'TECHNICIAN',
  'LOGISTICS_MANAGER',
  'RIDER',
  'FINANCE',
  'SUPPORT',
  'AUDITOR',
  'DPO',
] as const;

export const VENDOR_ROLES = [
  'VENDOR_OWNER',
  'VENDOR_ADMIN',
  'VENDOR_OPS',
  'VENDOR_FINANCE',
  'VENDOR_VIEWER',
] as const;

export const CUSTOMER_ROLES = [
  'CUSTOMER_OWNER',
  'CUSTOMER_ADMIN',
  'CUSTOMER_BUYER',
  'CUSTOMER_APPROVER',
  'CUSTOMER_FINANCE',
  'CUSTOMER_VIEWER',
] as const;

export const ROLES = [...PLATFORM_ROLES, ...VENDOR_ROLES, ...CUSTOMER_ROLES] as const;
export type Role = (typeof ROLES)[number];

/** Which side of the house a role belongs to. Decides which app can even host it. */
export const ROLE_SCOPE: Readonly<Record<Role, 'PLATFORM' | 'VENDOR' | 'CUSTOMER'>> = Object.freeze(
  Object.fromEntries([
    ...PLATFORM_ROLES.map((r) => [r, 'PLATFORM'] as const),
    ...VENDOR_ROLES.map((r) => [r, 'VENDOR'] as const),
    ...CUSTOMER_ROLES.map((r) => [r, 'CUSTOMER'] as const),
  ]) as Record<Role, 'PLATFORM' | 'VENDOR' | 'CUSTOMER'>,
);

/**
 * MFA is mandatory for roles that can move money or change where it goes.
 * VENDOR_OWNER is on this list precisely because that login can change payout
 * bank details (02 §1.3).
 */
export const MFA_REQUIRED_ROLES: readonly Role[] = Object.freeze([
  'PLATFORM_SUPERADMIN',
  'OPS_MANAGER',
  'FINANCE',
  'DPO',
  'VENDOR_OWNER',
]);

/**
 * Permissions are `<module>.<resource>.<action>`. Guards check permissions, never
 * role names — a role is a bundle, and bundles get re-cut without a release.
 */
export const PERMISSIONS = [
  // identity / kyc
  'identity.user.read',
  'identity.user.write',
  'identity.role.assign',
  'identity.audit.read',
  'kyc.application.read',
  'kyc.application.review',
  'kyc.application.approve',
  'kyc.document.read',
  'kyc.blacklist.write',
  // catalog
  'catalog.sku.read',
  'catalog.sku.write',
  'catalog.condition_image.write',
  'catalog.grade_definition.write',
  'catalog.sku_request.review',
  // listing
  'listing.own.read',
  'listing.own.write',
  'listing.any.read',
  'listing.any.write',
  'listing.price.override',
  'listing.grade_correction.respond',
  // qc
  'qc.visit.read',
  'qc.visit.schedule',
  'qc.visit.execute',
  'qc.report.read',
  'qc.report.ingest',
  'qc.tolerance.write',
  'qc.sampling.write',
  'qc.audit.recheck',
  // ordering
  'ordering.cart.write',
  'ordering.order.create',
  'ordering.order.approve',
  'ordering.own.read',
  'ordering.any.read',
  'ordering.any.override',
  // procurement
  'procurement.po.read_own',
  'procurement.po.read_any',
  'procurement.po.acknowledge',
  'procurement.invoice.upload',
  'procurement.match.review',
  'procurement.payout.run',
  // payment
  'payment.invoice.read_own',
  'payment.invoice.read_any',
  'payment.invoice.issue',
  'payment.ledger.read',
  'payment.ledger.post',
  'payment.refund.issue',
  'payment.credit_limit.write',
  // logistics
  'logistics.shipment.read',
  'logistics.shipment.write',
  'logistics.route.plan',
  'logistics.delivery.execute',
  'logistics.ndr.action',
  'logistics.rate_card.write',
  // platform
  'platform.ticket.read',
  'platform.ticket.write',
  'platform.claim.triage',
  'platform.return.approve',
  'platform.dispute.resolve',
  'platform.config.write',
  'platform.feature_flag.write',
  'platform.dsr.handle',
  'platform.scorecard.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const P = <T extends readonly Permission[]>(...p: T) => p;

/**
 * The role → permission matrix. Seeded into `identity.role_permission`.
 * 04_TEST_PLAN.md §3.1.2 walks this as a test matrix — a role gaining a permission
 * without a matrix update fails the test, which is the point.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  PLATFORM_SUPERADMIN: PERMISSIONS,

  OPS_MANAGER: P(
    'identity.user.read',
    'identity.audit.read',
    'kyc.application.read',
    'kyc.application.review',
    'catalog.sku.read',
    'listing.any.read',
    'listing.any.write',
    'qc.visit.read',
    'qc.visit.schedule',
    'qc.report.read',
    'ordering.any.read',
    'ordering.any.override',
    'procurement.po.read_any',
    'procurement.match.review',
    'payment.invoice.read_any',
    'logistics.shipment.read',
    'logistics.shipment.write',
    'logistics.route.plan',
    'logistics.ndr.action',
    'platform.ticket.read',
    'platform.ticket.write',
    'platform.scorecard.read',
  ),

  KYC_REVIEWER: P(
    'kyc.application.read',
    'kyc.application.review',
    'kyc.application.approve',
    'kyc.document.read',
    'kyc.blacklist.write',
    'identity.user.read',
    'identity.audit.read',
  ),

  CATALOG_ADMIN: P(
    'catalog.sku.read',
    'catalog.sku.write',
    'catalog.condition_image.write',
    'catalog.grade_definition.write',
    'catalog.sku_request.review',
    'listing.any.read',
  ),

  PRICING_ADMIN: P(
    'catalog.sku.read',
    'listing.any.read',
    'listing.any.write',
    'listing.price.override',
    'procurement.po.read_any',
  ),

  QC_MANAGER: P(
    'qc.visit.read',
    'qc.visit.schedule',
    'qc.visit.execute',
    'qc.report.read',
    'qc.report.ingest',
    'qc.tolerance.write',
    'qc.sampling.write',
    'qc.audit.recheck',
    'catalog.grade_definition.write',
    'listing.any.read',
    'listing.any.write',
    'platform.scorecard.read',
  ),

  TECHNICIAN: P('qc.visit.read', 'qc.visit.execute', 'qc.report.read', 'listing.any.read'),

  LOGISTICS_MANAGER: P(
    'logistics.shipment.read',
    'logistics.shipment.write',
    'logistics.route.plan',
    'logistics.ndr.action',
    'logistics.rate_card.write',
    'ordering.any.read',
  ),

  RIDER: P('logistics.shipment.read', 'logistics.delivery.execute'),

  FINANCE: P(
    'payment.invoice.read_any',
    'payment.invoice.issue',
    'payment.ledger.read',
    'payment.ledger.post',
    'payment.refund.issue',
    'payment.credit_limit.write',
    'procurement.po.read_any',
    'procurement.match.review',
    'procurement.payout.run',
    'ordering.any.read',
    'identity.audit.read',
  ),

  SUPPORT: P(
    'platform.ticket.read',
    'platform.ticket.write',
    'platform.claim.triage',
    'platform.return.approve',
    'ordering.any.read',
    'logistics.shipment.read',
    'qc.report.read',
    'payment.invoice.read_any',
  ),

  /** Read-only, everywhere, including the audit log. Never a write permission. */
  AUDITOR: P(
    'identity.audit.read',
    'kyc.application.read',
    'kyc.document.read',
    'catalog.sku.read',
    'listing.any.read',
    'qc.report.read',
    'ordering.any.read',
    'procurement.po.read_any',
    'payment.invoice.read_any',
    'payment.ledger.read',
    'logistics.shipment.read',
    'platform.ticket.read',
    'platform.scorecard.read',
  ),

  DPO: P('platform.dsr.handle', 'identity.user.read', 'identity.audit.read', 'kyc.document.read'),

  // --- vendor side. Never `*.any.*` — the org scope is enforced at the repository. ---
  VENDOR_OWNER: P(
    'listing.own.read',
    'listing.own.write',
    'listing.grade_correction.respond',
    'identity.user.read',
    'identity.user.write',
    'identity.role.assign',
    'qc.visit.read',
    'qc.report.read',
    'procurement.po.read_own',
    'procurement.po.acknowledge',
    'procurement.invoice.upload',
    'platform.ticket.read',
    'platform.ticket.write',
  ),
  VENDOR_ADMIN: P(
    'listing.own.read',
    'listing.own.write',
    'listing.grade_correction.respond',
    'identity.user.read',
    'identity.user.write',
    'qc.visit.read',
    'qc.report.read',
    'procurement.po.read_own',
    'procurement.po.acknowledge',
    'platform.ticket.read',
    'platform.ticket.write',
  ),
  VENDOR_OPS: P(
    'listing.own.read',
    'listing.own.write',
    'listing.grade_correction.respond',
    'qc.visit.read',
    'qc.report.read',
    'procurement.po.read_own',
    'procurement.po.acknowledge',
    'platform.ticket.write',
  ),
  VENDOR_FINANCE: P(
    'listing.own.read',
    'procurement.po.read_own',
    'procurement.invoice.upload',
    'platform.ticket.write',
  ),
  VENDOR_VIEWER: P('listing.own.read', 'qc.report.read', 'procurement.po.read_own'),

  // --- customer side ---
  CUSTOMER_OWNER: P(
    'catalog.sku.read',
    'ordering.cart.write',
    'ordering.order.create',
    'ordering.order.approve',
    'ordering.own.read',
    'identity.user.read',
    'identity.user.write',
    'identity.role.assign',
    'payment.invoice.read_own',
    'platform.ticket.read',
    'platform.ticket.write',
  ),
  CUSTOMER_ADMIN: P(
    'catalog.sku.read',
    'ordering.cart.write',
    'ordering.order.create',
    'ordering.own.read',
    'identity.user.read',
    'identity.user.write',
    'payment.invoice.read_own',
    'platform.ticket.read',
    'platform.ticket.write',
  ),
  CUSTOMER_BUYER: P(
    'catalog.sku.read',
    'ordering.cart.write',
    'ordering.order.create',
    'ordering.own.read',
    'platform.ticket.write',
  ),
  /** VR-123: an approver may never approve their own order. Enforced in the service, not here. */
  CUSTOMER_APPROVER: P('catalog.sku.read', 'ordering.own.read', 'ordering.order.approve'),
  CUSTOMER_FINANCE: P('ordering.own.read', 'payment.invoice.read_own', 'platform.ticket.write'),
  CUSTOMER_VIEWER: P('catalog.sku.read', 'ordering.own.read'),
});

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return out;
}
