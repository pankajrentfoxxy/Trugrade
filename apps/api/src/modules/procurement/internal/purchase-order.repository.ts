import { Injectable } from '@nestjs/common';
import { FacilityScope, OrgScope } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { OrderPropagationService } from './order-propagation.service';
import {
  ForbiddenError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';

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
  consignment_carrier: string | null;
  consignment_awb: string | null;
  dispatched_at: Date | null;
  created_at: Date;
  line_count: bigint;
  model_count: bigint;
  original_total_net: string;
}

export interface PoLineRow {
  id: string;
  unit_id: string | null;
  sku_id: string;
  agreed_net_payout: string;
  grade_at_po: string;
  qc_report_id: string | null;
  line_status: string;
  rejection_reason: string | null;
}

export interface LineRespondInput {
  lineId: string;
  accept: boolean;
  reason: string | null;
}

export interface PoRespondResult {
  orderId: string;
  poNumber: string;
  previousStatus: string;
  newStatus: string;
  acceptedLineIds: string[];
  rejectedLineIds: string[];
  owedNet: string;
  tdsAmount: string;
  /** What the answer did to the customer's order. See `OrderPropagationService`. */
  orderStatus: string;
  subOrderStatus: string;
  releasedUnits: number;
  opsTaskId: string | null;
}

export interface PoKpiSummary {
  openOrders: number;
  waitingOrders: number;
  waitingMachines: number;
  machinesToPick: number;
  valueAccepted: string;
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
    private readonly facilities: FacilityScope,
    private readonly propagation: OrderPropagationService,
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
    const scopedFacilities = await this.facilities.assignedFacilityIds();
    const facilityFilter =
      scopedFacilities && scopedFacilities.length > 0 ? scopedFacilities : null;

    const rows = await this.prisma.$queryRaw<PoHeaderRow[]>`
      SELECT po.id, po.po_number, po.order_id, po.status::text AS status,
             po.total_net::text AS total_net, po.tds_rate_pct::text AS tds_rate_pct,
             po.tds_amount::text AS tds_amount, po.valuation_method, po.terms_days,
             po.expected_dispatch_at, po.acknowledged_at, po.rejected_at,
             po.rejection_reason, po.cancelled_at,
             po.consignment_carrier, po.consignment_awb, po.dispatched_at,
             po.created_at,
             (SELECT count(*) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS line_count,
             (SELECT count(DISTINCT l.sku_id) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS model_count,
             (SELECT coalesce(sum(l.agreed_net_payout), 0)::text
                FROM procurement.purchase_order_line l WHERE l.po_id = po.id) AS original_total_net
        FROM procurement.purchase_order po
       WHERE po.vendor_org_id = ${orgId}::uuid
         AND (${status}::text IS NULL OR po.status::text = ${status}::text)
         AND (${from}::date IS NULL OR po.created_at >= ${from}::date)
         AND (${to}::date IS NULL OR po.created_at < ${to}::date + 1)
         AND (
           ${facilityFilter}::uuid[] IS NULL
           OR po.fulfillment_facility_id = ANY(${facilityFilter}::uuid[])
         )
       ORDER BY po.created_at DESC, po.po_number DESC
       LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`;

    const [count] = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total
        FROM procurement.purchase_order po
       WHERE po.vendor_org_id = ${orgId}::uuid
         AND (${status}::text IS NULL OR po.status::text = ${status}::text)
         AND (${from}::date IS NULL OR po.created_at >= ${from}::date)
         AND (${to}::date IS NULL OR po.created_at < ${to}::date + 1)
         AND (
           ${facilityFilter}::uuid[] IS NULL
           OR po.fulfillment_facility_id = ANY(${facilityFilter}::uuid[])
         )`;

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
    const scopedFacilities = await this.facilities.assignedFacilityIds();
    const facilityFilter =
      scopedFacilities && scopedFacilities.length > 0 ? scopedFacilities : null;
    const [row] = await this.prisma.$queryRaw<PoHeaderRow[]>`
      SELECT po.id, po.po_number, po.order_id, po.status::text AS status,
             po.total_net::text AS total_net, po.tds_rate_pct::text AS tds_rate_pct,
             po.tds_amount::text AS tds_amount, po.valuation_method, po.terms_days,
             po.expected_dispatch_at, po.acknowledged_at, po.rejected_at,
             po.rejection_reason, po.cancelled_at,
             po.consignment_carrier, po.consignment_awb, po.dispatched_at,
             po.created_at,
             (SELECT count(*) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS line_count,
             (SELECT count(DISTINCT l.sku_id) FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS model_count,
             (SELECT coalesce(sum(l.agreed_net_payout), 0)::text
                FROM procurement.purchase_order_line l WHERE l.po_id = po.id) AS original_total_net
        FROM procurement.purchase_order po
       WHERE po.id = ${poId}::uuid AND po.vendor_org_id = ${orgId}::uuid
         AND (
           ${facilityFilter}::uuid[] IS NULL
           OR po.fulfillment_facility_id = ANY(${facilityFilter}::uuid[])
         )`;
    return row ?? null;
  }

  /** The lines of one PO. Scoped again on its own terms, not on the caller's care. */
  async linesOf(poId: string): Promise<PoLineRow[]> {
    const orgId = this.vendorOrgId();
    return this.prisma.$queryRaw<PoLineRow[]>`
      SELECT l.id, l.unit_id, l.sku_id, l.agreed_net_payout::text AS agreed_net_payout,
             l.grade_at_po::text AS grade_at_po, l.qc_report_id,
             l.line_status::text AS line_status, l.rejection_reason
        FROM procurement.purchase_order_line l
        JOIN procurement.purchase_order po ON po.id = l.po_id
       WHERE l.po_id = ${poId}::uuid AND po.vendor_org_id = ${orgId}::uuid
       ORDER BY l.created_at`;
  }

  async kpiSummary(): Promise<PoKpiSummary> {
    const orgId = this.vendorOrgId();
    const scopedFacilities = await this.facilities.assignedFacilityIds();
    const facilityFilter =
      scopedFacilities && scopedFacilities.length > 0 ? scopedFacilities : null;

    const [counts] = await this.prisma.$queryRaw<
      Array<{
        open_orders: bigint;
        waiting_orders: bigint;
        waiting_machines: bigint;
        machines_to_pick: bigint;
        value_accepted: string;
      }>
    >`
      SELECT
        count(*) FILTER (WHERE po.status IN ('RAISED', 'ACKNOWLEDGED', 'PARTIAL', 'DISPATCH_READY')) AS open_orders,
        count(*) FILTER (WHERE po.status = 'RAISED') AS waiting_orders,
        coalesce(sum(
          CASE WHEN po.status = 'RAISED' THEN (
            SELECT count(*) FROM procurement.purchase_order_line l WHERE l.po_id = po.id
          ) ELSE 0 END
        ), 0) AS waiting_machines,
        coalesce(sum(
          (SELECT count(*)
             FROM procurement.purchase_order_line l
            WHERE l.po_id = po.id
              AND l.line_status = 'ACCEPTED'
              AND l.unit_id IS NULL)
        ), 0) AS machines_to_pick,
        coalesce(sum(
          (SELECT coalesce(sum(l.agreed_net_payout), 0)
             FROM procurement.purchase_order_line l
            WHERE l.po_id = po.id AND l.line_status = 'ACCEPTED')
        ), 0)::text AS value_accepted
        FROM procurement.purchase_order po
       WHERE po.vendor_org_id = ${orgId}::uuid
         AND (
           ${facilityFilter}::uuid[] IS NULL
           OR po.fulfillment_facility_id = ANY(${facilityFilter}::uuid[])
         )`;

    return {
      openOrders: Number(counts?.open_orders ?? 0),
      waitingOrders: Number(counts?.waiting_orders ?? 0),
      waitingMachines: Number(counts?.waiting_machines ?? 0),
      machinesToPick: Number(counts?.machines_to_pick ?? 0),
      valueAccepted: counts?.value_accepted ?? '0',
    };
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

  async unitForVendor(
    unitId: string,
  ): Promise<(AttachableUnitRow & { sku_id: string; grade: string }) | null> {
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
            AND po.status IN ('ACKNOWLEDGED', 'PARTIAL')
            AND l2.line_status = 'ACCEPTED'::identity.po_line_status
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

  /**
   * Per-line accept/reject in one transaction. Returns null when the PO is not
   * in RAISED — the caller re-reads to say why.
   */
  async respondLines(
    poId: string,
    lines: readonly LineRespondInput[],
    now: Date,
    actorUserId: string,
  ): Promise<PoRespondResult | null> {
    const orgId = this.vendorOrgId();
    return this.prisma.runInTransaction(async () => {
      const [po] = await this.prisma.$queryRaw<
        Array<{
          id: string;
          order_id: string;
          po_number: string;
          status: string;
          tds_rate_pct: string;
          vendor_org_id: string;
        }>
      >`
        SELECT id, order_id, po_number, status::text AS status, tds_rate_pct::text AS tds_rate_pct,
               vendor_org_id
          FROM procurement.purchase_order
         WHERE id = ${poId}::uuid AND vendor_org_id = ${orgId}::uuid
         FOR UPDATE`;
      if (!po || po.status !== 'RAISED') return null;

      const existing = await this.linesOf(poId);
      const existingIds = new Set(existing.map((l) => l.id));
      const inputIds = new Set(lines.map((l) => l.lineId));
      if (existingIds.size !== inputIds.size || ![...existingIds].every((id) => inputIds.has(id))) {
        throw new ValidationError(
          'Send one response for every line on this purchase order — no more, no fewer.',
          { lines: 'Include each line exactly once.' },
        );
      }

      const acceptedLineIds: string[] = [];
      const rejectedLineIds: string[] = [];
      for (const row of lines) {
        if (row.accept) {
          acceptedLineIds.push(row.lineId);
          await this.prisma.$executeRaw`
            UPDATE procurement.purchase_order_line
               SET line_status = 'ACCEPTED'::identity.po_line_status, rejection_reason = NULL
             WHERE id = ${row.lineId}::uuid AND po_id = ${poId}::uuid`;
        } else {
          if (!row.reason) {
            throw new ValidationError('Every rejected line needs a reason.', {
              reason: 'Pick why this line is rejected.',
            });
          }
          rejectedLineIds.push(row.lineId);
          await this.prisma.$executeRaw`
            UPDATE procurement.purchase_order_line
               SET line_status = 'REJECTED'::identity.po_line_status, rejection_reason = ${row.reason}
             WHERE id = ${row.lineId}::uuid AND po_id = ${poId}::uuid`;
        }
      }

      const [totals] = await this.prisma.$queryRaw<
        Array<{ owed: string; rejected: string; total: string }>
      >`
        SELECT
          coalesce(sum(agreed_net_payout) FILTER (WHERE line_status = 'ACCEPTED'), 0)::text AS owed,
          coalesce(sum(agreed_net_payout) FILTER (WHERE line_status = 'REJECTED'), 0)::text AS rejected,
          coalesce(sum(agreed_net_payout), 0)::text AS total
          FROM procurement.purchase_order_line
         WHERE po_id = ${poId}::uuid`;

      const owedNet = totals?.owed ?? '0';
      const tdsRate = Number(po.tds_rate_pct);
      const tdsAmount = ((Number(owedNet) * tdsRate) / 100).toFixed(2);

      let newStatus: string;
      if (acceptedLineIds.length === existing.length) newStatus = 'ACKNOWLEDGED';
      else if (rejectedLineIds.length === existing.length) newStatus = 'REJECTED';
      else newStatus = 'PARTIAL';

      const payableGross = Number(owedNet) > 0 ? owedNet : '0.01';
      await this.prisma.$executeRaw`
        UPDATE procurement.purchase_order
           SET status = ${newStatus}::identity.po_status,
               total_net = CASE
                 WHEN ${Number(owedNet) > 0} THEN ${owedNet}::numeric
                 ELSE total_net
               END,
               tds_amount = ${tdsAmount}::numeric,
               acknowledged_at = CASE WHEN ${acceptedLineIds.length} > 0 THEN ${now} ELSE acknowledged_at END,
               rejected_at = CASE WHEN ${newStatus} = 'REJECTED' THEN ${now} ELSE rejected_at END,
               rejection_reason = CASE
                 WHEN ${newStatus} = 'REJECTED' THEN 'All lines rejected by the vendor.'
                 ELSE rejection_reason
               END,
               updated_at = ${now}
         WHERE id = ${poId}::uuid`;

      await this.prisma.$executeRaw`
        UPDATE procurement.vendor_payable
           SET gross = ${payableGross}::numeric,
               tds = ${tdsAmount}::numeric,
               net_payable = GREATEST((${payableGross}::numeric - ${tdsAmount}::numeric), 0)
         WHERE purchase_order_id = ${poId}::uuid`;

      await this.prisma.$executeRaw`
        INSERT INTO ordering.order_event
          (order_id, event_type, from_status, to_status, note, occurred_at, actor_id)
        VALUES (
          ${po.order_id}::uuid,
          'PO_VENDOR_RESPONSE',
          ${po.status},
          ${newStatus},
          ${`Vendor responded to ${po.po_number}: ${acceptedLineIds.length} accepted, ${rejectedLineIds.length} rejected.`},
          ${now},
          ${actorUserId}::uuid
        )`;

      await this.prisma.db.audit_log.create({
        data: {
          actor_user_id: actorUserId,
          actor_org_id: orgId,
          action: 'procurement.po.responded',
          entity_type: 'purchase_order',
          entity_id: poId,
          before_json: { status: po.status, lineCount: existing.length },
          after_json: {
            status: newStatus,
            acceptedLineIds,
            rejectedLineIds,
            owedNet,
          },
          created_at: now,
        },
      });

      // The customer's order moves HERE, in this transaction, because nothing in
      // this repository subscribes to an event: `events.publish` writes to an
      // outbox with no reader, so an acknowledgement that only published one
      // would still leave the buyer's screen exactly as it was.
      const propagated = await this.propagation.propagate({
        poId,
        orderId: po.order_id,
        vendorOrgId: po.vendor_org_id,
        poNumber: po.po_number,
        tdsRatePct: tdsRate,
        acceptedLineIds,
        rejectedLines: existing
          .filter((l) => rejectedLineIds.includes(l.id))
          .map((l) => ({
            lineId: l.id,
            skuId: l.sku_id,
            grade: l.grade_at_po,
            agreedNetPayout: l.agreed_net_payout,
            reason:
              lines.find((r) => r.lineId === l.id)?.reason ?? 'No reason given by the vendor.',
          })),
        now,
        actorUserId,
      });

      return {
        orderId: po.order_id,
        poNumber: po.po_number,
        previousStatus: po.status,
        newStatus,
        acceptedLineIds,
        rejectedLineIds,
        owedNet,
        tdsAmount,
        orderStatus: propagated.orderStatus,
        subOrderStatus: propagated.subOrderStatus,
        releasedUnits: propagated.releasedUnits,
        opsTaskId: propagated.opsTaskId,
      };
    });
  }

  /**
   * ACKNOWLEDGED or PARTIAL becomes DISPATCH_READY: the vendor has scanned every
   * accepted machine into a sealed box.
   *
   * Guarded on the status rather than on a re-count, so two concurrent attaches
   * of the last two slots produce one transition and one booking.
   */
  async markDispatchReady(poId: string, now: Date): Promise<boolean> {
    const orgId = this.vendorOrgId();
    const updated = await this.prisma.$executeRaw`
      UPDATE procurement.purchase_order
         SET status = 'DISPATCH_READY', updated_at = ${now}
       WHERE id = ${poId}::uuid
         AND vendor_org_id = ${orgId}::uuid
         AND status IN ('ACKNOWLEDGED', 'PARTIAL')`;
    return updated > 0;
  }

  /** Mark consignment dispatched once every accepted line has its serials. */
  async dispatchPo(
    poId: string,
    input: { carrier: string; awb: string; dispatchedAt: Date },
    actorUserId: string,
  ): Promise<{ orderId: string; poNumber: string; previousStatus: string } | null> {
    const orgId = this.vendorOrgId();
    return this.prisma.runInTransaction(async () => {
      const [po] = await this.prisma.$queryRaw<
        Array<{ id: string; order_id: string; po_number: string; status: string }>
      >`
        SELECT id, order_id, po_number, status::text AS status
          FROM procurement.purchase_order
         WHERE id = ${poId}::uuid AND vendor_org_id = ${orgId}::uuid
         FOR UPDATE`;
      // DISPATCH_READY dispatches. Stage 3A advances a purchase order to it as
      // soon as every accepted line carries a machine, which is exactly the
      // state a vendor presses Dispatch from — without this the auto-advance
      // locked the vendor out of their own dispatch endpoint.
      if (!po || !['ACKNOWLEDGED', 'PARTIAL', 'DISPATCH_READY'].includes(po.status)) return null;

      const [missing] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n
          FROM procurement.purchase_order_line
         WHERE po_id = ${poId}::uuid
           AND line_status = 'ACCEPTED'
           AND unit_id IS NULL`;
      if (Number(missing?.n ?? 0) > 0) {
        throw new PreconditionFailedError(
          `${Number(missing?.n ?? 0)} accepted machine(s) still have no serial attached. Attach every accepted line before dispatch.`,
          { reason: 'serials_incomplete', missing: Number(missing?.n ?? 0) },
        );
      }

      const [acceptedCount] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM procurement.purchase_order_line
         WHERE po_id = ${poId}::uuid AND line_status = 'ACCEPTED'`;
      if (Number(acceptedCount?.n ?? 0) === 0) {
        throw new PreconditionFailedError('There are no accepted lines to dispatch.', {
          reason: 'no_accepted_lines',
        });
      }

      await this.prisma.$executeRaw`
        UPDATE procurement.purchase_order
           SET status = 'DISPATCHED'::identity.po_status,
               consignment_carrier = ${input.carrier},
               consignment_awb = ${input.awb},
               dispatched_at = ${input.dispatchedAt},
               updated_at = ${input.dispatchedAt}
         WHERE id = ${poId}::uuid`;

      // The consignment leaves with its purchase order. Until this was written
      // a dispatch moved the PO and left `sub_order.status` at CONFIRMED, so the
      // buyer's tracking page never said "on its way" and their own delivery
      // confirmation refused every consignment as not dispatched. One PO is one
      // consignment (`uq_suborder_order_vendor_pickup`), so the event is scoped
      // to it and the timeline can tell three deliveries apart.
      const moved = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE ordering.sub_order
           SET status = 'DISPATCHED'::public.order_status
         WHERE purchase_order_id = ${poId}::uuid
           AND status <> 'CANCELLED'::public.order_status
        RETURNING id`;

      await this.prisma.$executeRaw`
        INSERT INTO ordering.order_event
          (order_id, sub_order_id, event_type, from_status, to_status, note, occurred_at, actor_id)
        VALUES (
          ${po.order_id}::uuid,
          ${moved[0]?.id ?? null}::uuid,
          'PO_DISPATCHED',
          ${po.status},
          'DISPATCHED',
          ${`${po.po_number} dispatched via ${input.carrier}, AWB ${input.awb}.`},
          ${input.dispatchedAt},
          ${actorUserId}::uuid
        )`;

      // The order follows once every live consignment has left. A partly
      // dispatched order stays where it is: "dispatched" on the board would
      // read as all of it.
      await this.prisma.$executeRaw`
        UPDATE ordering."order" o
           SET status = 'DISPATCHED'::public.order_status
         WHERE o.id = ${po.order_id}::uuid
           AND o.status IN ('CONFIRMED', 'VENDOR_ACCEPTED', 'PICKUP_SCHEDULED', 'PACKED', 'INVOICED')
           AND NOT EXISTS (
             SELECT 1 FROM ordering.sub_order s
              WHERE s.order_id = o.id
                AND s.status NOT IN ('DISPATCHED', 'DELIVERED', 'CANCELLED'))`;

      await this.prisma.db.audit_log.create({
        data: {
          actor_user_id: actorUserId,
          actor_org_id: orgId,
          action: 'procurement.po.dispatched',
          entity_type: 'purchase_order',
          entity_id: poId,
          before_json: { status: po.status },
          after_json: { status: 'DISPATCHED', carrier: input.carrier, awb: input.awb },
          created_at: input.dispatchedAt,
        },
      });

      return { orderId: po.order_id, poNumber: po.po_number, previousStatus: po.status };
    });
  }
}
