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
  /**
   * The finance manager seat. The clerk work below is split out of it on
   * purpose: a seat that both raises a bill and approves it is a seat where
   * maker-checker means nothing.
   */
  'FINANCE',
  'CONTROLLER',
  'TREASURY',
  'AP_CLERK',
  'AR_CLERK',
  'TAX_MANAGER',
  /**
   * The external chartered accountant. Reads everything finance, exports
   * everything, posts nothing.
   *
   * This seat exists because the alternative — handing the CA a FINANCE login —
   * gives a person outside the company the ability to post to the ledger, and
   * because a read-only seat is what makes the audit trail able to say who
   * pulled which register and when. Their grant is time-boxed: `user_role`
   * already carries `expires_at`, and an engagement that ended is access that
   * ended.
   */
  'CA',
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
  'CONTROLLER',
  'TREASURY',
  // Reads the whole ledger, and is a login held by somebody outside the company.
  'CA',
  'FINANCE',
  'DPO',
  'VENDOR_OWNER',
  'VENDOR_FINANCE',
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
  /** Owner-only team invites and member management, on both sides of the marketplace. */
  'identity.team.manage',
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
  /**
   * The checker half of a payout, and the treasury act that moves the money.
   *
   * Separate from `procurement.payout.run` because they are the two halves of
   * maker-checker: a seat holding both could draft a run and approve its own
   * work, which `ck_payout_maker_is_not_checker` refuses at the database and
   * which no role bundle should be able to attempt. Stage 7 splits the finance
   * seats properly; today only a superadmin holds the checker half.
   */
  'finance.payout.approve',
  'ap.payment.release',
  /** The escrow screen, and the operator who instructs it once a provider signs. */
  'finance.escrow.read',
  'finance.escrow.operate',
  'finance.journal.create',
  'finance.journal.post',
  'finance.journal.reverse',
  'finance.period.prepare',
  'finance.period.close',
  'finance.recon.perform',
  'finance.report.read',
  /**
   * Pulling a register out of the platform.
   *
   * Separate from `ordering.export.run` because an ops manager exporting an
   * order board is not the same grant as a CA exporting the ledger, and every
   * call writes an audit row naming the register, the period and the row count.
   */
  'finance.export.run',
  'finance.creditnote.approve',
  'finance.refund.approve',
  'finance.writeoff.create',
  'finance.writeoff.approve',
  'finance.bank.approve',
  'ap.bill.create',
  'ap.bill.match',
  'ar.invoice.issue',
  'ar.receipt.record',
  'ar.dunning.run',
  'tax.register.read',
  'tax.return.prepare',
  'tax.return.file',
  'tax.ewaybill.generate',
  'tax.einvoice.retry',
  'pricing.override.approve',
  'credit.limit.request',
  'credit.limit.read',
  'logistics.carrier.write',
  'logistics.rider.manage',
  'logistics.task.assign',
  'ordering.export.run',
  /**
   * Narrower than procurement.po.read_own on purpose. UX spec §3B.4 gives
   * /vendor/payables to FINANCE and OWNER only, while po.read_own reaches
   * VENDOR_VIEWER, ADMIN and OPS — so guarding payables with the PO permission
   * would show what we owe, and what we withheld, to roles the spec does not
   * put in that room.
   */
  'procurement.payable.read_own',
  /**
   * What we owe every vendor, across the platform.
   *
   * The own-scoped permission above is the vendor's view of their own payables;
   * this is the finance and audit view of all of them, and it is what a CA
   * reconciling creditors actually needs.
   */
  'procurement.payable.read_any',
  /**
   * Booking a carrier against a packed purchase order.
   *
   * Deliberately not `logistics.shipment.write`: dispatching is a procurement
   * act with a cost attached, and an ops or logistics manager should be able to
   * hold it without holding the rest of the logistics write surface.
   */
  'procurement.po.dispatch',
  // automation
  'automation.rule.read',
  'automation.rule.write',
  'automation.run.retry',
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
    // The checker half only. Holding `review` as well would put both halves of
    // vendor onboarding on one seat again, one level up.
    'kyc.application.approve',
    'catalog.sku.read',
    'listing.any.read',
    'listing.any.write',
    'qc.visit.read',
    'qc.visit.schedule',
    'qc.report.read',
    'ordering.any.read',
    'ordering.any.override',
    'procurement.po.read_any',
    'procurement.po.dispatch',
    'procurement.match.review',
    'payment.invoice.read_any',
    'logistics.shipment.read',
    'logistics.shipment.write',
    'logistics.route.plan',
    'logistics.ndr.action',
    'automation.rule.read',
    'automation.rule.write',
    'automation.run.retry',
    'platform.ticket.read',
    'platform.ticket.write',
    'platform.scorecard.read',
  ),

  /**
   * Reviews an application. Does NOT approve it.
   *
   * This seat held both halves, so one person could onboard a vendor from
   * application to approval with nobody else in the room — the exact thing
   * maker-checker exists to stop, and the separation test now refuses it.
   * OPS_MANAGER approves.
   */
  KYC_REVIEWER: P(
    'kyc.application.read',
    'kyc.application.review',
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
    // Books a packed consignment onto a carrier. See the permission's own note:
    // it is the dispatch act, not the whole logistics write surface.
    'procurement.po.dispatch',
    'automation.rule.read',
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
    'finance.escrow.read',
    'ordering.any.read',
    'identity.audit.read',
  ),

  /**
   * The finance manager. Reviews and closes, and deliberately does not raise
   * the documents the clerks raise.
   */
  CONTROLLER: P(
    'payment.ledger.read',
    'payment.ledger.post',
    'payment.invoice.read_any',
    'finance.report.read',
    'finance.export.run',
    'finance.journal.post',
    'finance.journal.reverse',
    'finance.period.close',
    'finance.recon.perform',
    'finance.payout.approve',
    'finance.creditnote.approve',
    'finance.refund.approve',
    'finance.writeoff.approve',
    'finance.bank.approve',
    'pricing.override.approve',
    'procurement.po.read_any',
    'ordering.any.read',
    'identity.audit.read',
  ),

  /** Moves the money, and decides nothing about what is owed. */
  TREASURY: P(
    'ap.payment.release',
    'payment.ledger.read',
    'finance.escrow.read',
    'finance.escrow.operate',
    'finance.report.read',
    'procurement.po.read_any',
    'ordering.any.read',
  ),

  /** Accounts payable: raises and matches, approves nothing. */
  AP_CLERK: P(
    'ap.bill.create',
    'ap.bill.match',
    'finance.journal.create',
    'finance.writeoff.create',
    'procurement.payout.run',
    'procurement.po.read_any',
    'procurement.match.review',
    'payment.ledger.read',
    'finance.report.read',
  ),

  /** Accounts receivable: issues and chases, approves nothing. */
  AR_CLERK: P(
    'ar.invoice.issue',
    'ar.receipt.record',
    'ar.dunning.run',
    'payment.invoice.read_any',
    'payment.refund.issue',
    'payment.ledger.read',
    'finance.report.read',
    'ordering.any.read',
  ),

  /** Prepares returns. Filing them is the controller's signature, not this seat's. */
  TAX_MANAGER: P(
    'tax.register.read',
    'tax.return.prepare',
    'tax.ewaybill.generate',
    'tax.einvoice.retry',
    'payment.invoice.read_any',
    'payment.ledger.read',
    'finance.report.read',
    'finance.period.prepare',
  ),

  /**
   * The external chartered accountant: reads everything finance, exports
   * everything, posts nothing.
   *
   * `finance.export.run` is the single exception to "no verbs" and it is named
   * in the separation test so the exception is visible rather than assumed. An
   * export is how a CA does their job, and every one writes an audit row.
   */
  CA: P(
    'payment.ledger.read',
    'payment.invoice.read_any',
    'procurement.po.read_any',
    'procurement.payable.read_any',
    'tax.register.read',
    'finance.report.read',
    'finance.export.run',
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
    // Added when Stage 8 shipped the escrow screen and the separation test
    // found that no read-only seat could open it. An auditor who cannot see
    // what the platform says it would be holding cannot audit the claim, and
    // `read` is the whole of the grant — `finance.escrow.operate` is TREASURY's.
    'finance.escrow.read',
    'credit.limit.read',
    'procurement.payable.read_any',
    'finance.report.read',
    'tax.register.read',
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
  /*
   * WHY NO VENDOR ROLE HOLDS qc.visit.read OR qc.report.read
   * -------------------------------------------------------
   * They used to, and it was a cross-tenant read. Both are unscoped console
   * permissions, and the qc console routes behind them take no principal and
   * apply no org predicate — correctly, because they are OPS queues meant to
   * span every vendor. GET /api/qc/grade-corrections returned every vendor's
   * serials, unit ids and resolved vendor NAMES to any vendor account that
   * asked; GET /api/qc/visits/:id did the same for another vendor's manifest.
   *
   * Note the shape of every other vendor grant in this file: listing.own.read,
   * procurement.po.read_own. Vendor-reachable permissions are OWN-scoped by
   * name. These two were not, which is exactly how they slipped through.
   *
   * No vendor screen called either — verified across apps/console and
   * apps/technician before removing them — so this closes a hole rather than
   * removing a capability. When T30 and T31 build the vendor's own QC visit and
   * grade-correction screens, they need qc.visit.read_own / qc.report.read_own
   * alongside routes that scope at the repository layer, NOT these back.
   */
  VENDOR_OWNER: P(
    'listing.own.read',
    'listing.own.write',
    'listing.grade_correction.respond',
    'identity.user.read',
    'identity.user.write',
    'identity.role.assign',
    'identity.team.manage',
    'procurement.po.read_own',
    'procurement.payable.read_own',
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
    'procurement.po.read_own',
    'procurement.payable.read_own',
    'procurement.po.acknowledge',
    'platform.ticket.read',
    'platform.ticket.write',
  ),
  VENDOR_OPS: P(
    'listing.own.read',
    'listing.own.write',
    'listing.grade_correction.respond',
    'procurement.po.read_own',
    'procurement.po.acknowledge',
    'platform.ticket.write',
  ),
  VENDOR_FINANCE: P(
    'listing.own.read',
    'procurement.po.read_own',
    'procurement.payable.read_own',
    'procurement.invoice.upload',
    'platform.ticket.write',
  ),
  VENDOR_VIEWER: P('listing.own.read', 'procurement.po.read_own'),

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
    // The buyer portal's team screen invites colleagues by email, exactly as the
    // supplier hub does, and the invite routes are gated on this one permission.
    'identity.team.manage',
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
    // The spec's BUYER_PROCURER, and the documents route lists them alongside
    // finance, admin and owner. They were the only one of the four without this,
    // so the person who placed the order could not read its tax invoice while
    // three colleagues could. read_own is org-scoped, so this grants sight of
    // their own company's invoices and nobody else's.
    'payment.invoice.read_own',
    'platform.ticket.write',
  ),
  /** VR-123: an approver may never approve their own order. Enforced in the service, not here. */
  CUSTOMER_APPROVER: P('catalog.sku.read', 'ordering.own.read', 'ordering.order.approve'),
  CUSTOMER_FINANCE: P('ordering.own.read', 'payment.invoice.read_own', 'platform.ticket.write'),
  CUSTOMER_VIEWER: P('catalog.sku.read', 'ordering.own.read'),
});

/**
 * The documents that need a second signature, and the two permissions that make
 * up each one.
 *
 * This is the source of truth for three things at once: what
 * `ApprovalService.request` records as `required_permission`, what the checker
 * endpoint demands, and what the separation test walks. One table, because a
 * separation rule that lives in a test and a separate rule that lives in a
 * service will agree on the day they are written and never again.
 *
 * **No role may hold both columns of a row.** The test asserts it; three seats
 * failed when it was first written.
 */
export const MAKER_CHECKER: Readonly<
  Record<string, { readonly maker: Permission; readonly checker: Permission }>
> = Object.freeze({
  JOURNAL: { maker: 'finance.journal.create', checker: 'finance.journal.post' },
  PAYOUT_RUN: { maker: 'procurement.payout.run', checker: 'finance.payout.approve' },
  CREDIT_NOTE: { maker: 'payment.refund.issue', checker: 'finance.creditnote.approve' },
  VENDOR_BANK: { maker: 'identity.team.manage', checker: 'finance.bank.approve' },
  PRICE_OVERRIDE: { maker: 'listing.price.override', checker: 'pricing.override.approve' },
  KYC_APPLICATION: { maker: 'kyc.application.review', checker: 'kyc.application.approve' },
  PERIOD_CLOSE: { maker: 'finance.period.prepare', checker: 'finance.period.close' },
  GST_RETURN: { maker: 'tax.return.prepare', checker: 'tax.return.file' },
  WRITE_OFF: { maker: 'finance.writeoff.create', checker: 'finance.writeoff.approve' },
  REFUND: { maker: 'payment.refund.issue', checker: 'finance.refund.approve' },
});

export const APPROVAL_DOC_TYPES = Object.keys(MAKER_CHECKER) as readonly ApprovalDocType[];
export type ApprovalDocType = keyof typeof MAKER_CHECKER;

/**
 * The verbs that mean a seat can change something. Used by the CA test, which
 * is the one seat in the file that must hold none of them.
 */
export const WRITE_ACTIONS: readonly string[] = Object.freeze([
  'write',
  'post',
  'approve',
  'release',
  'issue',
  'execute',
  'run',
]);

/**
 * The single allowed exception to the rule above: pulling a register is how an
 * auditor does their job, and every call writes an audit row naming the
 * register, the period and the row count. Named here so the exception is a line
 * of code somebody can argue with rather than a hole nobody notices.
 */
export const CA_ALLOWED_WRITE_VERB: Permission = 'finance.export.run';

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return out;
}
