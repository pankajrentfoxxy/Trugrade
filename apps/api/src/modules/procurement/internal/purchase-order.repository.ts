import { Injectable } from '@nestjs/common';
import { OrgScope } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';

/**
 * Every read behind the vendor's purchase-order screens, scoped to one org.
 *
 * **The org predicate lives here and nowhere above it** (02_ARCHITECTURE.md
 * §3.2 layer 3, CLAUDE.md "org scoping happens at the repository layer"). No
 * method on this class takes a vendor id, so there is no parameter a caller
 * could get wrong: the org comes off the session, and a purchase order belonging
 * to somebody else is simply not in the result set.
 *
 * **Why the enrichment queries are separate statements.** A purchase-order line
 * carries a `unit_id`, a `sku_id` and a `qc_report_id` — the serial lives in
 * `listing`, the machine's name in `catalog`, the seal in `qc`, and the delivery
 * city in `ordering` and then `identity`. `no-cross-schema-join` forbids the
 * five-schema JOIN that would be one query, and it is right to: that join is the
 * module seam gone. So each statement touches one module schema and the rows are
 * assembled in TypeScript, exactly as `vendor.controller.ts` and
 * `ordering/internal/dispatch-label.ts` already do.
 */

export interface PoHeaderRow {
  id: string;
  po_number: string;
  order_id: string;
  status: string;
  total_net: string;
  tds_rate_pct: string;
  tds_amount: string;
  valuation_method: string;
  terms_days: number;
  expected_dispatch_at: Date | null;
  acknowledged_at: Date | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  line_count: bigint;
}

export interface PoLineRow {
  id: string;
  unit_id: string | null;
  sku_id: string;
  agreed_net_payout: string;
  grade_at_po: string;
  qc_report_id: string | null;
}

export interface AttachableUnitRow {
  id: string;
  serial_number: string;
  status: string;
  qc_report_id: string | null;
  vendor_ask_price: string | null;
}

/** The delivery point, allow-listed. No contact, no label, no instructions. */
export interface ShipToRow {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  landmark: string | null;
}

export interface PoFilter {
  /** A `po_status` value, compared as text so no enum cast is needed. */
  status?: string;
  /** `YYYY-MM-DD`, inclusive at both ends. The caller resolves the timezone. */
  from?: string;
  to?: string;
}

@Injectable()
export class PurchaseOrderRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
  ) {}

  /**
   * The org every query below is about.
   *
   * Platform staff have no org in context and PLATFORM_SUPERADMIN holds every
   * permission, so the refusal is here rather than in the guard: "this vendor's
   * purchase orders" is not a question with an answer when no vendor is signed
   * in. The admin PO board is a different screen on a different route (T39).
   */
  vendorOrgId(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError(
        'These are one vendor’s purchase orders, so one has to be signed in.',
        { reason: 'vendor_route_without_org' },
      );
    }
    return orgId;
  }

  async list(
    filter: PoFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ rows: PoHeaderRow[]; total: number }> {
    const orgId = this.vendorOrgId();
    const status = filter.status ?? null;
    const from = filter.from ?? null;
    const to = filter.to ?? null;

    const rows = await this.prisma.$queryRaw<PoHeaderRow[]>`
      SELECT po.id, po.po_number, po.order_id, po.status::text AS status,
             po.total_net::text AS total_net, po.tds_rate_pct::text AS tds_rate_pct,
             po.tds_amount::text AS tds_amount, po.valuation_method, po.terms_days,
             po.expected_dispatch_at, po.acknowledged_at, po.rejected_at,
             po.rejection_reason, po.cancelled_at, po.created_at,
             (SELECT count(*) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS line_count
        FROM procurement.purchase_order po
       WHERE po.vendor_org_id = ${orgId}::uuid
         AND (${status}::text IS NULL OR po.status::text = ${status}::text)
         AND (${from}::date IS NULL OR po.created_at >= ${from}::date)
         AND (${to}::date IS NULL OR po.created_at < ${to}::date + 1)
       ORDER BY po.created_at DESC, po.po_number DESC
       LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`;

    const [count] = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total
        FROM procurement.purchase_order po
       WHERE po.vendor_org_id = ${orgId}::uuid
         AND (${status}::text IS NULL OR po.status::text = ${status}::text)
         AND (${from}::date IS NULL OR po.created_at >= ${from}::date)
         AND (${to}::date IS NULL OR po.created_at < ${to}::date + 1)`;

    return { rows, total: Number(count?.total ?? 0) };
  }

  /** How the vendor's own POs are distributed, so a filter can show its counts. */
  async statusCounts(): Promise<Map<string, number>> {
    const orgId = this.vendorOrgId();
    const rows = await this.prisma.$queryRaw<Array<{ status: string; n: bigint }>>`
      SELECT status::text AS status, count(*) AS n
        FROM procurement.purchase_order
       WHERE vendor_org_id = ${orgId}::uuid
       GROUP BY 1`;
    return new Map(rows.map((r) => [r.status, Number(r.n)]));
  }

  /**
   * One purchase order, or `null` when it is not this vendor's.
   *
   * Null rather than a thrown `ForbiddenError`: the org predicate is part of the
   * `WHERE`, so from this caller's position the row genuinely does not exist and
   * the caller turns that into a 404. "You may not see this one" would confirm
   * the PO exists — and which vendor a given purchase went to is exactly the
   * fact this platform does not disclose, in either direction.
   */
  async findOne(poId: string): Promise<PoHeaderRow | null> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<PoHeaderRow[]>`
      SELECT po.id, po.po_number, po.order_id, po.status::text AS status,
             po.total_net::text AS total_net, po.tds_rate_pct::text AS tds_rate_pct,
             po.tds_amount::text AS tds_amount, po.valuation_method, po.terms_days,
             po.expected_dispatch_at, po.acknowledged_at, po.rejected_at,
             po.rejection_reason, po.cancelled_at, po.created_at,
             (SELECT count(*) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS line_count
        FROM procurement.purchase_order po
       WHERE po.id = ${poId}::uuid AND po.vendor_org_id = ${orgId}::uuid`;
    return row ?? null;
  }

  /** The lines of one PO. Scoped again on its own terms, not on the caller's care. */
  async linesOf(poId: string): Promise<PoLineRow[]> {
    const orgId = this.vendorOrgId();
    return this.prisma.$queryRaw<PoLineRow[]>`
      SELECT l.id, l.unit_id, l.sku_id, l.agreed_net_payout::text AS agreed_net_payout,
             l.grade_at_po::text AS grade_at_po, l.qc_report_id
        FROM procurement.purchase_order_line l
        JOIN procurement.purchase_order po ON po.id = l.po_id
       WHERE l.po_id = ${poId}::uuid AND po.vendor_org_id = ${orgId}::uuid
       ORDER BY l.created_at`;
  }

  /**
   * Serial numbers for the vendor's own machines.
   *
   * `listing.unit` directly rather than through `IListingService`: a serial is
   * one column with no rule attached to it, so a barrel method would buy a
   * signature and nothing else. The `vendor_org_id` predicate is not redundant
   * with the caller's — it is what makes this statement safe on its own terms,
   * which is the property that matters the first time somebody reuses it.
   */
  /** Units already named on any of this vendor's PO lines. */
  async attachedUnitIds(): Promise<string[]> {
    const orgId = this.vendorOrgId();
    const rows = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT l.unit_id
        FROM procurement.purchase_order_line l
        JOIN procurement.purchase_order po ON po.id = l.po_id
       WHERE po.vendor_org_id = ${orgId}::uuid
         AND l.unit_id IS NOT NULL`;
    return rows.map((r) => r.unit_id);
  }

  /**
   * Machines held for this order. Two statements: the line ids are `ordering`'s,
   * the reserved units are `listing`'s. `order_line_unit.unit_id` is null until
   * attach, so the hold is `listing.unit.order_line_id`.
   */
  async reservedUnitIdsForOrder(orderId: string): Promise<string[]> {
    const lines = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT ol.id
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid`;
    if (lines.length === 0) return [];
    const named = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT olu.unit_id
        FROM ordering.order_line_unit olu
       WHERE olu.order_line_id = ANY(${lines.map((l) => l.id)}::uuid[])
         AND olu.unit_id IS NOT NULL`;
    const held = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.unit
       WHERE order_line_id = ANY(${lines.map((l) => l.id)}::uuid[])`;
    return [...new Set([...named.map((r) => r.unit_id), ...held.map((r) => r.id)])];
  }

  /**
   * Free LISTED stock of this SKU and grade, plus machines already reserved
   * on this order, minus anything already named on a PO.
   */
  async attachableUnits(input: {
    skuId: string;
    grade: string;
    reservedIds: readonly string[];
    takenIds: readonly string[];
  }): Promise<AttachableUnitRow[]> {
    const orgId = this.vendorOrgId();
    const none = '00000000-0000-0000-0000-000000000000';
    const reserved = input.reservedIds.length > 0 ? [...input.reservedIds] : [none];
    const taken = input.takenIds.length > 0 ? [...input.takenIds] : [none];
    return this.prisma.$queryRaw<AttachableUnitRow[]>`
      SELECT u.id, u.serial_number, u.status::text AS status,
             u.qc_report_id, u.vendor_ask_price::text AS vendor_ask_price
        FROM listing.unit u
       WHERE u.vendor_org_id = ${orgId}::uuid
         AND u.sku_id = ${input.skuId}::uuid
         AND COALESCE(u.grade_actual, u.grade_declared)::text = ${input.grade}
         AND u.id <> ALL(${taken}::uuid[])
         AND (u.status = 'LISTED' OR u.id = ANY(${reserved}::uuid[]))
       ORDER BY u.serial_number`;
  }

  async unitForVendor(unitId: string): Promise<AttachableUnitRow & { sku_id: string; grade: string } | null> {
    const orgId = this.vendorOrgId();
    const [row] = await this.prisma.$queryRaw<
      Array<AttachableUnitRow & { sku_id: string; grade: string }>
    >`
      SELECT u.id, u.serial_number, u.status::text AS status, u.qc_report_id,
             u.vendor_ask_price::text AS vendor_ask_price,
             u.sku_id, COALESCE(u.grade_actual, u.grade_declared)::text AS grade
        FROM listing.unit u
       WHERE u.id = ${unitId}::uuid AND u.vendor_org_id = ${orgId}::uuid`;
    return row ?? null;
  }

  async attachToVacantLine(input: {
    poId: string;
    skuId: string;
    grade: string;
    unitId: string;
    serialNumber: string;
    qcReportId: string | null;
    payout: string;
    now: Date;
  }): Promise<boolean> {
    const orgId = this.vendorOrgId();
    const updated = await this.prisma.$executeRaw`
      UPDATE procurement.purchase_order_line l
         SET unit_id = ${input.unitId}::uuid,
             qc_report_id = ${input.qcReportId}::uuid
       WHERE l.id = (
         SELECT l2.id
           FROM procurement.purchase_order_line l2
           JOIN procurement.purchase_order po ON po.id = l2.po_id
          WHERE po.id = ${input.poId}::uuid
            AND po.vendor_org_id = ${orgId}::uuid
            AND po.status = 'ACKNOWLEDGED'
            AND l2.sku_id = ${input.skuId}::uuid
            AND l2.grade_at_po::text = ${input.grade}
            AND l2.unit_id IS NULL
          ORDER BY l2.created_at
          LIMIT 1
       )`;
    if (updated === 0) return false;

    const [po] = await this.prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT order_id FROM procurement.purchase_order
       WHERE id = ${input.poId}::uuid AND vendor_org_id = ${orgId}::uuid`;
    if (po) {
      const bound = await this.prisma.$executeRaw`
        UPDATE ordering.order_line_unit olu
           SET unit_id = ${input.unitId}::uuid,
               serial_number = ${input.serialNumber},
               qc_report_id = ${input.qcReportId}::uuid
         WHERE olu.id = (
           SELECT olu2.id
             FROM ordering.order_line_unit olu2
             JOIN ordering.order_line ol ON ol.id = olu2.order_line_id
             JOIN ordering.sub_order so ON so.id = ol.sub_order_id
            WHERE so.order_id = ${po.order_id}::uuid
              AND ol.sku_id = ${input.skuId}::uuid
              AND ol.grade::text = ${input.grade}
              AND olu2.unit_id IS NULL
            ORDER BY olu2.id
            LIMIT 1
         )`;
      if (bound > 0) {
        const [slot] = await this.prisma.$queryRaw<Array<{ order_line_id: string }>>`
          SELECT order_line_id FROM ordering.order_line_unit
           WHERE unit_id = ${input.unitId}::uuid`;
        if (slot) {
          await this.prisma.$executeRaw`
            UPDATE listing.unit
               SET status = 'RESERVED'::public.unit_status,
                   order_line_id = ${slot.order_line_id}::uuid
             WHERE id = ${input.unitId}::uuid
               AND status = 'LISTED'::public.unit_status`;
        }
      }
    }

    await this.prisma.$executeRaw`
      UPDATE listing.unit
         SET purchase_price = ${input.payout}::numeric
       WHERE id = ${input.unitId}::uuid AND purchase_price IS NULL`;
    return true;
  }

  async serialsOf(unitIds: readonly string[]): Promise<Map<string, string>> {
    if (unitIds.length === 0) return new Map();
    const orgId = this.vendorOrgId();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit
       WHERE id = ANY(${[...unitIds]}::uuid[]) AND vendor_org_id = ${orgId}::uuid`;
    return new Map(rows.map((r) => [r.id, r.serial_number]));
  }

  /**
   * Where the goods go. Read for the pick list and for the delivery city, and
   * for nothing else.
   *
   * Two statements because the order is `ordering`'s and the address is
   * `identity`'s. **Six columns, chosen one at a time.** `contact_name`,
   * `contact_mobile`, `label` and `delivery_instructions` sit on the same row
   * and every one of them names the buyer or one of their people — a label
   * reading "Acme HQ" identifies the customer as surely as a GSTIN does.
   * Anonymity runs both ways, so the allow-list is written out rather than
   * spread.
   */
  async shipToForOrder(orderId: string): Promise<ShipToRow | null> {
    const [order] = await this.prisma.$queryRaw<Array<{ shipping_address_id: string }>>`
      SELECT shipping_address_id FROM ordering."order" WHERE id = ${orderId}::uuid`;
    if (!order) return null;

    const [address] = await this.prisma.$queryRaw<ShipToRow[]>`
      SELECT line1, line2, city, state, pincode, landmark
        FROM identity.org_address WHERE id = ${order.shipping_address_id}::uuid`;
    return address ?? null;
  }

  /**
   * Record the vendor's acknowledgement.
   *
   * `AND status = 'RAISED'` inside the UPDATE rather than a read-then-write: two
   * clicks a second apart would otherwise both pass a check and the second would
   * overwrite the first acknowledgement's timestamp. Returns false when nothing
   * matched, and the caller re-reads the row to say why.
   *
   * No `::po_status` cast, for the reason `order-transaction.service.ts` records
   * at the INSERT: the Phase 6 migration created that enum under whatever
   * `search_path` was current, so a qualified cast would hard-code an accident
   * and an unqualified one fails at runtime. Postgres infers the type from the
   * target column, which stays right if the type is ever moved to where it
   * belongs.
   */
  async acknowledge(poId: string, now: Date): Promise<boolean> {
    const orgId = this.vendorOrgId();
    const updated = await this.prisma.$executeRaw`
      UPDATE procurement.purchase_order
         SET status = 'ACKNOWLEDGED', acknowledged_at = ${now}, updated_at = ${now}
       WHERE id = ${poId}::uuid
         AND vendor_org_id = ${orgId}::uuid
         AND status = 'RAISED'`;
    return updated > 0;
  }
}
