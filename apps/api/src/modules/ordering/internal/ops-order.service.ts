import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { NotFoundError } from '../../../shared/errors/domain-errors';
import { CatalogLookup } from './catalog-lookup';
import type { OpsOrderListQueryDto } from '../dto/ops-order.dto';

/**
 * Every order on the platform, read by the people who work here — T39,
 * `03_UX_SPEC.md` §3C.4.
 *
 * **This is the opposite screen from `OrderListService`, and the difference is
 * the whole file.** That one is one buyer's own orders and reads
 * `procurement.purchase_order` nowhere, because a buyer may never learn who
 * supplied their machine. This one is ours, so it may show both sides — and
 * §3C.4 says it is the only screen in the product where they ever sit together.
 * The boundary is therefore not a `WHERE` clause here; it is the permission
 * (`ordering.any.read`), which no vendor or buyer role holds and none may be
 * given without breaking the `*.any.*` convention `roles.ts` documents.
 *
 * **One statement per module schema, assembled in TypeScript.** The board's
 * search box takes seven kinds of identifier that live in four schemas — an
 * order number and the buyer's own reference in `ordering`, a serial in
 * `ordering` too, a seal code in `qc`, a legal name in `identity`, a GSTIN in
 * `kyc`, a mobile in `identity` again. `no-cross-schema-join` forbids the join
 * that would be one query, so each identifier is resolved to a set of ids in its
 * own module's schema and the sets are handed to `ordering`'s query as arrays.
 * That is also what makes the box honest: it MATCHES, it never parses. T20
 * settled that for the buyer's board — a person holding a number does not
 * reliably know which kind of number it is — and the same person is on the phone
 * to support here, reading it off a sticker.
 *
 * **A row says why it matched.** A search for a seal code that lands on an order
 * with no visible seal column reads as a mistake, so every non-obvious match
 * carries the value that produced it.
 */

/* ==========================================================================
 * The board
 * ======================================================================== */

/** Why this row is in the result. Absent kinds simply did not match. */
export interface OpsOrderMatch {
  kind: 'serial' | 'seal' | 'buyer' | 'gstin' | 'mobile' | 'buyer_po';
  value: string;
}

/**
 * The buyer, named.
 *
 * Named, and not labelled: this is our own console and the customer is our
 * counterparty, so "Acme Industries Pvt. Ltd." is the correct rendering. The
 * anonymity contract runs the other way — it is the VENDOR who must not reach a
 * buyer, and vice versa, and neither of them can reach this route at all.
 */
export interface OpsOrderPartyView {
  legalName: string;
  tradeName: string | null;
}

export interface OpsOrderApprovalView {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverName: string;
  requestedAt: string;
  expiresAt: string;
  /** Past `expiresAt` on the SERVER's clock, never the browser's. */
  breached: boolean;
}

export interface OpsOrderRow {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  /**
   * `PREPAID` or the credit-terms mode. The board reads it to tell an order
   * that is unpaid because it is on credit from one that is unpaid because
   * nobody has paid — only the second is anybody's problem.
   */
  paymentMode: string;
  placedAt: string;
  buyer: OpsOrderPartyView | null;
  buyerPoNumber: string | null;
  grandTotal: string;
  units: number;
  /**
   * How many purchase orders this order raised.
   *
   * `null` is impossible here — the count is a real count — but **zero is a
   * meaningful and alarming zero** on a DISPATCHED or DELIVERED row: it means we
   * shipped a machine we have no record of buying. The screen says so in words
   * rather than printing a bare 0 in a numeric column.
   */
  purchaseOrders: number;
  approval: OpsOrderApprovalView | null;
  matchedOn: OpsOrderMatch[];
}

export interface OpsFacetOption {
  value: string;
  label: string;
  count: number;
}

/** One order the board's "Needs attention" strip names. */
export interface OpsOrderAttentionItem {
  orderNumber: string;
  status: string;
  buyerName: string | null;
  grandTotal: string;
}

/**
 * What needs somebody in this building today, counted over EVERY order rather
 * than the filtered page: an operator who has narrowed the board to
 * "dispatched" must still be told about the delivered one nobody paid for.
 * Prepaid orders only — an order on credit terms is meant to ship unpaid.
 */
export interface OpsOrderAttentionView {
  /** Delivered, still unpaid. Ours to chase. */
  deliveredUnpaid: OpsOrderAttentionItem[];
  /** The vendor accepted (or dispatched) before the buyer paid. */
  acceptedUnpaid: OpsOrderAttentionItem[];
  /** Verified orders waiting on the buyer's payment, as one line. */
  paymentPending: { count: number; total: string; oldestPlacedAt: string | null };
}

export interface OpsOrderBoardView {
  rows: OpsOrderRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: { status: OpsFacetOption[]; payment: OpsFacetOption[] };
  attention: OpsOrderAttentionView;
  /**
   * What the search term was compared against, whether or not it matched.
   *
   * Printed on the board so nobody concludes the box does not take a seal code
   * because their seal code found nothing.
   */
  searchedFor: string[] | null;
}

/* ==========================================================================
 * The record
 * ======================================================================== */

export interface OpsOrderMachineView {
  /** The `order_line_unit` row. Stable before a serial exists. */
  slotId: string;
  /** Null until the technician names the machine at the supply point. */
  serialNumber: string | null;
  title: string | null;
  grade: string;
  unitPrice: string;
  /** What we agreed to pay the supply point for this exact serial. Null: no PO. */
  purchaseCost: string | null;
  status: string;
  inspectedAt: string | null;
  verifiedAt: string | null;
}

/** One technician visit raised for this order. `qc` only, its own statement. */
export interface OpsOrderVisitView {
  visitId: string;
  visitNumber: string;
  status: string;
  technicianName: string | null;
  /** `YYYY-MM-DD`, and `HH:MM` — the day and slot the visit is booked into, or null. */
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  unitsRequested: number;
  unitsInspected: number;
}

export interface OpsSubOrderView {
  subOrderNumber: string;
  /** The supply point's real legal name. Admin-only screen; see the class note. */
  vendorLegalName: string | null;
  status: string;
  subtotal: string;
  dispatchSlaDueAt: string | null;
  deliveredAt: string | null;
  machines: OpsOrderMachineView[];
}

export interface OpsPurchaseOrderView {
  poId: string;
  poNumber: string;
  status: string;
  vendorLegalName: string | null;
  totalNet: string;
  tdsAmount: string;
  lines: number;
  raisedAt: string;
  acknowledgedAt: string | null;
  /**
   * The consignment, as the supply point recorded it at dispatch. Verbatim:
   * the screen decides whether what was typed is a usable tracking number,
   * and says so, rather than this layer silently tidying it.
   */
  carrier: string | null;
  awb: string | null;
  dispatchedAt: string | null;
}

/**
 * The two sides and the difference between them.
 *
 * `null` when the purchase orders do not cover every allocated machine — which
 * is not hypothetical: three orders on this database have machines and no
 * purchase order at all, two of them delivered. A margin computed over partial
 * cover would read as the real margin and be wrong by whatever we paid for the
 * machines nobody raised a PO for, so it is refused with the reason instead.
 */
export interface OpsMarginView {
  /** Ex-GST, ex-freight. What the buyer is charged for the machines themselves. */
  soldFor: string;
  /** The sum of every purchase order's net value on this order. */
  paid: string;
  amount: string;
  /** Carries its denominator: this many rupees on `soldFor` rupees. */
  pct: string;
}

export interface OpsTimelineEventView {
  at: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  note: string | null;
}

export interface OpsAddressView {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
}

export interface OpsOrderRecordView {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMode: string;
  placedAt: string;
  buyer: OpsOrderPartyView | null;
  /** From `kyc.gst_profile` via `order.billing_gst_profile_id`. Null if unset. */
  buyerGstin: string | null;
  placedByName: string | null;
  placedByMobile: string | null;
  buyerPoNumber: string | null;
  costCentre: string | null;
  shipTo: OpsAddressView | null;
  money: {
    subtotal: string;
    freight: string;
    gstTotal: string;
    tcs: string;
    grandTotal: string;
  };
  subOrders: OpsSubOrderView[];
  purchaseOrders: OpsPurchaseOrderView[];
  margin: OpsMarginView | null;
  /** Why the margin could not be stated. Null exactly when `margin` is present. */
  marginUnavailable: string | null;
  approval: OpsOrderApprovalView | null;
  timeline: OpsTimelineEventView[];
  /** The inspection: who was sent, and how far along each machine is. */
  inspection: {
    visits: OpsOrderVisitView[];
    machines: number;
    inspected: number;
    verified: number;
  };
  verifiedAt: string | null;
  /** The buyer's 24-hour payment deadline. Null until verified, or on credit terms. */
  payBy: string | null;
  paidAt: string | null;
}

/* ========================================================================== */

/** Words an operator reads, for the machine words the enum stores. */
const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Not yet placed',
  AWAITING_APPROVAL: 'Awaiting the buyer’s approver',
  AWAITING_INSPECTION: 'Placed · assign a technician',
  QC_IN_PROGRESS: 'Inspection in progress',
  AWAITING_VERIFICATION: 'Inspected · verify the machines',
  PAYMENT_PENDING: 'Verified · payment pending',
  CONFIRMED: 'Confirmed',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const PAYMENT_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  PARTIAL: 'Part paid',
  REFUNDED: 'Refunded',
  FAILED: 'Failed',
};

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  payment_mode: string;
  buyer_org_id: string;
  buyer_user_id: string;
  buyer_po_number: string | null;
  grand_total: string;
  placed_at: Date;
}

@Injectable()
export class OpsOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly catalog: CatalogLookup,
  ) {}

  /* ----------------------------------------------------------------------
   * The board
   * ------------------------------------------------------------------- */

  async list(query: OpsOrderListQueryDto): Promise<OpsOrderBoardView> {
    const q = query.q ?? null;
    const like = q === null ? null : `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const status = query.status ?? null;
    const payment = query.payment ?? null;
    // `approval=pending` is what the ops dashboard's tile links to. It is a
    // filter and not a status, because an order awaiting an approver can be at
    // AWAITING_APPROVAL *or* have been placed and later held — the approval row
    // is the fact, and the order status is a consequence of it. `approved` and
    // `none` are the board's other two cuts of the same fact. One fragment,
    // interpolated into every statement that must agree on the count.
    const approvalWhere =
      query.approval === 'pending'
        ? Prisma.sql`EXISTS (SELECT 1 FROM ordering.order_approval a
                              WHERE a.order_id = o.id AND a.status = 'PENDING')`
        : query.approval === 'approved'
          ? Prisma.sql`EXISTS (SELECT 1 FROM ordering.order_approval a
                                WHERE a.order_id = o.id AND a.status = 'APPROVED')`
          : query.approval === 'none'
            ? Prisma.sql`NOT EXISTS (SELECT 1 FROM ordering.order_approval a
                                      WHERE a.order_id = o.id)`
            : Prisma.sql`TRUE`;

    // Each identifier resolved inside its own module's schema first, then
    // handed to ordering's statement as an array of ids. One schema per
    // statement; the assembly is TypeScript's job.
    const [sealUnits, orgIds, userIds] = like === null
      ? [new Map<string, string>(), new Map<string, OpsOrderMatch>(), new Map<string, string>()]
      : await Promise.all([this.unitsBySeal(like), this.orgsMatching(like), this.usersByMobile(like)]);

    const sealUnitIds = [...sealUnits.keys()];
    const matchedOrgIds = [...orgIds.keys()];
    const matchedUserIds = [...userIds.keys()];

    const where = this.whereFragment(like, sealUnitIds, matchedOrgIds, matchedUserIds);

    const [counted] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total
        FROM ordering."order" o
       WHERE (${status}::text IS NULL OR o.status::text = ${status})
         AND (${payment}::text IS NULL OR o.payment_status::text = ${payment})
         AND ${approvalWhere}
         AND ${where}`;

    const total = counted?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / query.per));
    const page = Math.min(query.page, pages);

    const rows = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT o.id, o.order_number, o.status::text AS status,
             o.payment_status::text AS payment_status, o.payment_mode::text AS payment_mode,
             o.buyer_org_id, o.buyer_user_id,
             o.buyer_po_number, o.grand_total::text AS grand_total, o.placed_at
        FROM ordering."order" o
       WHERE (${status}::text IS NULL OR o.status::text = ${status})
         AND (${payment}::text IS NULL OR o.payment_status::text = ${payment})
         AND ${approvalWhere}
         AND ${where}
       -- Four CASE keys over a validated enum rather than interpolating a column
       -- name into SQL. For any given sort three are NULL on every row, so they
       -- tie and the trailing key decides. OrderListService does the same.
       ORDER BY CASE WHEN ${query.sort} = 'value' THEN o.grand_total END DESC NULLS LAST,
                CASE WHEN ${query.sort} = 'value_asc' THEN o.grand_total END ASC NULLS LAST,
                CASE WHEN ${query.sort} = 'oldest' THEN o.placed_at END ASC NULLS LAST,
                o.placed_at DESC
       LIMIT ${query.per} OFFSET ${(page - 1) * query.per}`;

    const ids = rows.map((r) => r.id);
    const [
      units,
      poCounts,
      approvals,
      parties,
      serialHits,
      sealHits,
      statusFacet,
      paymentFacet,
      attention,
    ] = await Promise.all([
      this.unitCounts(ids),
      this.poCounts(ids),
      this.approvals(ids),
      this.parties(rows.map((r) => r.buyer_org_id)),
      like === null ? Promise.resolve(new Map<string, string[]>()) : this.matchedSerials(ids, like),
      sealUnitIds.length === 0
        ? Promise.resolve(new Map<string, string[]>())
        : this.ordersHoldingUnits(ids, sealUnitIds, sealUnits),
      this.statusFacet(where, payment, approvalWhere),
      this.paymentFacet(where, status, approvalWhere),
      this.attention(),
    ]);

    return {
      rows: rows.map((row) => {
        const matchedOn: OpsOrderMatch[] = [];
        for (const serial of serialHits.get(row.id) ?? []) {
          matchedOn.push({ kind: 'serial', value: serial });
        }
        for (const seal of sealHits.get(row.id) ?? []) {
          matchedOn.push({ kind: 'seal', value: seal });
        }
        const orgMatch = orgIds.get(row.buyer_org_id);
        if (orgMatch !== undefined) matchedOn.push(orgMatch);
        const mobile = userIds.get(row.buyer_user_id);
        if (mobile !== undefined) matchedOn.push({ kind: 'mobile', value: mobile });
        if (like !== null && row.buyer_po_number && matchesLike(row.buyer_po_number, q)) {
          matchedOn.push({ kind: 'buyer_po', value: row.buyer_po_number });
        }
        return {
          orderNumber: row.order_number,
          status: row.status,
          paymentStatus: row.payment_status,
          paymentMode: row.payment_mode,
          placedAt: row.placed_at.toISOString(),
          buyer: parties.get(row.buyer_org_id) ?? null,
          // An empty string is what a form posts when nobody typed anything. It
          // is not a reference, and drawing it as one puts a blank on screen
          // that reads as a recorded value.
          buyerPoNumber: row.buyer_po_number?.trim() || null,
          grandTotal: row.grand_total,
          units: units.get(row.id) ?? 0,
          purchaseOrders: poCounts.get(row.id) ?? 0,
          approval: approvals.get(row.id) ?? null,
          matchedOn,
        };
      }),
      total,
      page,
      per: query.per,
      pages,
      facets: { status: statusFacet, payment: paymentFacet },
      attention,
      searchedFor:
        q === null
          ? null
          : [
              'our order number',
              'the buyer’s own PO reference',
              'a serial',
              'a seal code',
              'the buyer’s legal or trade name',
              'their GSTIN',
              'the mobile the order was placed from',
            ],
    };
  }

  /* ----------------------------------------------------------------------
   * The record — §3C.4's "the only place the two sides ever sit together"
   * ------------------------------------------------------------------- */

  async record(orderNumber: string): Promise<OpsOrderRecordView> {
    const [order] = await this.prisma.$queryRaw<
      Array<
        OrderRow & {
          payment_mode: string;
          cost_centre: string | null;
          subtotal: string;
          gst_total: string;
          freight_total: string;
          tcs_amount: string;
          billing_gst_profile_id: string | null;
          shipping_address_id: string;
          verified_at: Date | null;
          pay_by: Date | null;
          paid_at: Date | null;
        }
      >
    >`
      SELECT o.id, o.order_number, o.status::text AS status,
             o.payment_status::text AS payment_status, o.payment_mode::text AS payment_mode,
             o.buyer_org_id, o.buyer_user_id, o.buyer_po_number, o.cost_centre,
             o.subtotal::text AS subtotal, o.gst_total::text AS gst_total,
             o.freight_total::text AS freight_total, o.tcs_amount::text AS tcs_amount,
             o.grand_total::text AS grand_total, o.placed_at,
             o.billing_gst_profile_id, o.shipping_address_id,
             o.verified_at, o.pay_by, o.paid_at
        FROM ordering."order" o
       WHERE o.order_number = ${orderNumber}`;

    if (!order) {
      throw new NotFoundError('There is no order with that number.', {
        reason: 'ops_order_not_found',
      });
    }

    const [parties, gstin, placedBy, shipTo, subOrders, pos, approvals, timeline, visits] =
      await Promise.all([
        this.parties([order.buyer_org_id]),
        order.billing_gst_profile_id === null
          ? Promise.resolve(null)
          : this.gstinOf(order.billing_gst_profile_id),
        this.userOf(order.buyer_user_id),
        this.addressOf(order.shipping_address_id),
        this.subOrdersOf(order.id),
        this.purchaseOrdersOf(order.id),
        this.approvals([order.id]),
        this.timelineOf(order.id),
        this.visitsOf(order.id),
      ]);

    const allMachines = subOrders.flatMap((s) => s.machines);
    const machineCount = allMachines.length;
    const covered = allMachines.filter((m) => m.purchaseCost !== null).length;

    return {
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMode: order.payment_mode,
      placedAt: order.placed_at.toISOString(),
      buyer: parties.get(order.buyer_org_id) ?? null,
      buyerGstin: gstin,
      placedByName: placedBy?.fullName ?? null,
      placedByMobile: placedBy?.mobile ?? null,
      buyerPoNumber: order.buyer_po_number?.trim() || null,
      costCentre: order.cost_centre?.trim() || null,
      shipTo,
      money: {
        subtotal: order.subtotal,
        freight: order.freight_total,
        gstTotal: order.gst_total,
        tcs: order.tcs_amount,
        grandTotal: order.grand_total,
      },
      subOrders,
      purchaseOrders: pos,
      ...this.margin(order.subtotal, pos, machineCount, covered),
      approval: approvals.get(order.id) ?? null,
      timeline,
      inspection: {
        visits,
        machines: machineCount,
        inspected: allMachines.filter((m) => m.inspectedAt !== null).length,
        verified: allMachines.filter((m) => m.verifiedAt !== null).length,
      },
      verifiedAt: order.verified_at?.toISOString() ?? null,
      payBy: order.pay_by?.toISOString() ?? null,
      paidAt: order.paid_at?.toISOString() ?? null,
    };
  }

  /** The technician visits raised for this order. `qc` and `identity`, one statement each. */
  private async visitsOf(orderId: string): Promise<OpsOrderVisitView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        visit_number: string;
        status: string;
        technician_id: string | null;
        scheduled_date: string | null;
        slot_from: string | null;
        slot_to: string | null;
        units_requested: number;
        units_inspected: number;
      }>
    >`
      SELECT id, visit_number, status::text AS status, technician_id,
             to_char(scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
             to_char(slot_from, 'HH24:MI') AS slot_from,
             to_char(slot_to, 'HH24:MI') AS slot_to,
             units_requested, units_inspected
        FROM qc.qc_visit WHERE order_id = ${orderId}::uuid ORDER BY requested_at`;
    if (rows.length === 0) return [];
    const techIds = rows.flatMap((r) => (r.technician_id ? [r.technician_id] : []));
    const techUsers =
      techIds.length === 0
        ? []
        : await this.prisma.$queryRaw<Array<{ id: string; user_id: string }>>`
            SELECT id, user_id FROM qc.qc_technician WHERE id = ANY(${techIds}::uuid[])`;
    const names = await this.names(techUsers.map((t) => t.user_id));
    const userOf = new Map(techUsers.map((t) => [t.id, t.user_id]));
    return rows.map((r) => ({
      visitId: r.id,
      visitNumber: r.visit_number,
      status: r.status,
      technicianName: r.technician_id
        ? (names.get(userOf.get(r.technician_id) ?? '') ?? null)
        : null,
      scheduledDate: r.scheduled_date,
      slotFrom: r.slot_from,
      slotTo: r.slot_to,
      unitsRequested: r.units_requested,
      unitsInspected: r.units_inspected,
    }));
  }

  /**
   * The difference between the two sides, or the reason it cannot be stated.
   *
   * Refused rather than approximated whenever a machine on the order has no
   * purchase-order line behind it. A margin over partial cover is wrong by
   * whatever those machines cost and looks exactly like a correct one.
   */
  private margin(
    subtotal: string,
    pos: OpsPurchaseOrderView[],
    machines: number,
    covered: number,
  ): { margin: OpsMarginView | null; marginUnavailable: string | null } {
    if (machines === 0) {
      return {
        margin: null,
        marginUnavailable: 'No machine has been allocated to this order yet.',
      };
    }
    if (pos.length === 0) {
      return {
        margin: null,
        marginUnavailable: `No purchase order was ever raised for this order, so what we paid for its ${machines} ${machines === 1 ? 'machine' : 'machines'} is not recorded anywhere. The margin cannot be stated.`,
      };
    }
    if (covered < machines) {
      return {
        margin: null,
        marginUnavailable: `Purchase orders cover ${covered} of the ${machines} machines on this order. A margin over part of an order reads as the whole one, so it is not shown.`,
      };
    }
    // Paise, in integers, all the way. Floating point on money is the defect
    // that shows a 1-paisa margin discrepancy nobody can reconcile.
    const sold = toPaise(subtotal);
    const paid = pos.reduce((n, po) => n + toPaise(po.totalNet), 0);
    const amount = sold - paid;
    return {
      margin: {
        soldFor: fromPaise(sold),
        paid: fromPaise(paid),
        amount: fromPaise(amount),
        pct: sold === 0 ? '0.0' : ((amount / sold) * 100).toFixed(1),
      },
      marginUnavailable: null,
    };
  }

  /* ----------------------------------------------------------------------
   * The parts. One module schema per statement, without exception.
   * ------------------------------------------------------------------- */

  /**
   * The whole `WHERE` for the search term, as one reusable fragment.
   *
   * A fragment rather than three copies of the predicate, because the board, its
   * count and both facets have to agree exactly — T28 found a queue saying "3
   * need you" landing on a board of nine, and that was two copies of one
   * predicate drifting apart.
   */
  private whereFragment(
    like: string | null,
    sealUnitIds: readonly string[],
    orgIds: readonly string[],
    userIds: readonly string[],
  ) {
    return Prisma.sql`(${like}::text IS NULL
      OR o.order_number ILIKE ${like}
      OR o.buyer_po_number ILIKE ${like}
      OR o.buyer_org_id = ANY(${[...orgIds]}::uuid[])
      OR o.buyer_user_id = ANY(${[...userIds]}::uuid[])
      OR EXISTS (SELECT 1
                   FROM ordering.order_line_unit olu
                   JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                   JOIN ordering.sub_order so ON so.id = ol.sub_order_id
                  WHERE so.order_id = o.id
                    AND (olu.serial_number ILIKE ${like}
                         OR olu.unit_id = ANY(${[...sealUnitIds]}::uuid[]))))`;
  }

  /** Seal code → unit id. `qc` only; `qc` owns what a seal code means. */
  private async unitsBySeal(like: string): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ unit_id: string; seal_code: string }>>`
      SELECT unit_id, seal_code FROM qc.qc_seal WHERE seal_code ILIKE ${like} LIMIT 200`;
    return new Map(rows.map((r) => [r.unit_id, r.seal_code]));
  }

  /**
   * Buyer name or GSTIN → org id, with which of the two matched.
   *
   * Two statements, two schemas — `identity.organization` for the names and
   * `kyc.gst_profile` for the registration — merged here. The value is recorded
   * so a row can say "matched on GSTIN" rather than leaving an operator to guess
   * why an order with no visible GSTIN column is in their results.
   */
  private async orgsMatching(like: string): Promise<Map<string, OpsOrderMatch>> {
    const [byName, byGstin] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
        SELECT id, legal_name FROM identity.organization
         WHERE org_type = 'BUYER' AND (legal_name ILIKE ${like} OR trade_name ILIKE ${like})
         LIMIT 200`,
      this.prisma.$queryRaw<Array<{ org_id: string; gstin: string }>>`
        SELECT org_id, gstin FROM kyc.gst_profile WHERE gstin ILIKE ${like} LIMIT 200`,
    ]);
    const out = new Map<string, OpsOrderMatch>();
    // The matched VALUE, not the name of the field it matched: "matched on
    // GSTIN" leaves an operator to guess which one, and the whole reason a row
    // carries this is so it does not have to be guessed.
    for (const r of byName) out.set(r.id, { kind: 'buyer', value: r.legal_name });
    // GSTIN wins where both matched: it is the more specific claim, and it is
    // the one an operator typed on purpose.
    for (const r of byGstin) out.set(r.org_id, { kind: 'gstin', value: r.gstin });
    return out;
  }

  /** A mobile → the user accounts carrying it. `identity` only. */
  private async usersByMobile(like: string): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; mobile: string }>>`
      SELECT id, mobile FROM identity.user_account WHERE mobile ILIKE ${like} LIMIT 200`;
    return new Map(rows.map((r) => [r.id, r.mobile]));
  }

  private async unitCounts(orderIds: readonly string[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ order_id: string; units: number }>>`
      SELECT so.order_id, count(*)::int AS units
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ANY(${[...orderIds]}::uuid[])
       GROUP BY so.order_id`;
    return new Map(rows.map((r) => [r.order_id, r.units]));
  }

  /** How many POs each order raised. `procurement` only, its own statement. */
  private async poCounts(orderIds: readonly string[]): Promise<Map<string, number>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ order_id: string; n: number }>>`
      SELECT order_id, count(*)::int AS n
        FROM procurement.purchase_order
       WHERE order_id = ANY(${[...orderIds]}::uuid[])
       GROUP BY order_id`;
    return new Map(rows.map((r) => [r.order_id, r.n]));
  }

  private async matchedSerials(
    orderIds: readonly string[],
    like: string,
  ): Promise<Map<string, string[]>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ order_id: string; serial_number: string }>>`
      SELECT so.order_id, olu.serial_number
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ANY(${[...orderIds]}::uuid[]) AND olu.serial_number ILIKE ${like}
       ORDER BY olu.serial_number`;
    return group(rows.map((r) => [r.order_id, r.serial_number] as const));
  }

  /** Which orders on the page hold a unit whose seal matched, and which code. */
  private async ordersHoldingUnits(
    orderIds: readonly string[],
    unitIds: readonly string[],
    seals: ReadonlyMap<string, string>,
  ): Promise<Map<string, string[]>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ order_id: string; unit_id: string }>>`
      SELECT so.order_id, olu.unit_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ANY(${[...orderIds]}::uuid[])
         AND olu.unit_id = ANY(${[...unitIds]}::uuid[])`;
    return group(
      rows.flatMap((r) => {
        const code = seals.get(r.unit_id);
        return code === undefined ? [] : [[r.order_id, code] as const];
      }),
    );
  }

  private async approvals(
    orderIds: readonly string[],
  ): Promise<Map<string, OpsOrderApprovalView>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        order_id: string;
        status: string;
        requested_at: Date;
        expires_at: Date;
        approver_user_id: string;
      }>
    >`
      SELECT DISTINCT ON (a.order_id)
             a.order_id, a.status, a.requested_at, a.expires_at, a.approver_user_id
        FROM ordering.order_approval a
       WHERE a.order_id = ANY(${[...orderIds]}::uuid[])
       ORDER BY a.order_id, a.requested_at DESC`;
    if (rows.length === 0) return new Map();

    const names = await this.names(rows.map((r) => r.approver_user_id));
    // The server's clock, never the caller's. Four defects of exactly this shape
    // were fixed in one day on this build; the last would have shown an
    // applicant overdue on the strength of a reviewer's laptop clock.
    const now = this.clock.now().getTime();
    return new Map(
      rows.map((r) => [
        r.order_id,
        {
          status:
            r.status === 'PENDING' && r.expires_at.getTime() <= now
              ? ('EXPIRED' as const)
              : (r.status as OpsOrderApprovalView['status']),
          approverName: names.get(r.approver_user_id) ?? 'the approver named on this order',
          requestedAt: r.requested_at.toISOString(),
          expiresAt: r.expires_at.toISOString(),
          breached: r.status === 'PENDING' && r.expires_at.getTime() <= now,
        },
      ]),
    );
  }

  private async parties(orgIds: readonly string[]): Promise<Map<string, OpsOrderPartyView>> {
    if (orgIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; legal_name: string; trade_name: string | null }>
    >`
      SELECT id, legal_name, trade_name FROM identity.organization
       WHERE id = ANY(${[...new Set(orgIds)]}::uuid[])`;
    return new Map(
      rows.map((r) => [r.id, { legalName: r.legal_name, tradeName: r.trade_name }]),
    );
  }

  private async gstinOf(profileId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ gstin: string }>>`
      SELECT gstin FROM kyc.gst_profile WHERE id = ${profileId}::uuid`;
    return row?.gstin ?? null;
  }

  private async userOf(
    userId: string,
  ): Promise<{ fullName: string; mobile: string | null } | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ full_name: string; mobile: string | null }>
    >`
      SELECT full_name, mobile FROM identity.user_account WHERE id = ${userId}::uuid`;
    return row ? { fullName: row.full_name, mobile: row.mobile } : null;
  }

  private async addressOf(addressId: string): Promise<OpsAddressView | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        label: string | null;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
      }>
    >`
      SELECT label, line1, line2, city, state, pincode, contact_name, contact_mobile
        FROM identity.org_address WHERE id = ${addressId}::uuid`;
    if (!row) return null;
    return {
      label: row.label,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      contactName: row.contact_name,
      contactMobile: row.contact_mobile,
    };
  }

  /**
   * The consignments, with the machines on each.
   *
   * `purchaseCost` per serial comes from `procurement.purchase_order_line` in
   * its own statement — that is the number that makes this the only screen where
   * both sides sit together, and it is per unit rather than per order so a
   * partly-covered order is visible as such rather than averaged away.
   */
  private async subOrdersOf(orderId: string): Promise<OpsSubOrderView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sub_order_number: string;
        vendor_org_id: string;
        status: string;
        subtotal: string;
        dispatch_sla_due_at: Date | null;
        delivered_at: Date | null;
      }>
    >`
      SELECT id, sub_order_number, vendor_org_id, status::text AS status,
             subtotal::text AS subtotal, dispatch_sla_due_at, delivered_at
        FROM ordering.sub_order WHERE order_id = ${orderId}::uuid
       ORDER BY sub_order_number`;

    const machineRows = await this.prisma.$queryRaw<
      Array<{
        slot_id: string;
        sub_order_id: string;
        unit_id: string | null;
        serial_number: string | null;
        status: string;
        sku_id: string;
        grade: string;
        unit_price: string;
        inspected_at: Date | null;
        verified_at: Date | null;
      }>
    >`
      SELECT olu.id AS slot_id, ol.sub_order_id, olu.unit_id, olu.serial_number,
             olu.status::text AS status, ol.sku_id, ol.grade::text AS grade,
             ol.unit_price::text AS unit_price, olu.inspected_at, olu.verified_at
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
       WHERE ol.sub_order_id = ANY(${rows.map((r) => r.id)}::uuid[])
       ORDER BY olu.inspected_at NULLS LAST, olu.serial_number, olu.id`;

    const [costs, vendors, titles] = await Promise.all([
      this.purchaseCosts(machineRows.flatMap((m) => (m.unit_id ? [m.unit_id] : []))),
      this.parties(rows.map((r) => r.vendor_org_id)),
      this.titles(machineRows.map((m) => m.sku_id)),
    ]);

    return rows.map((r) => ({
      subOrderNumber: r.sub_order_number,
      vendorLegalName: vendors.get(r.vendor_org_id)?.legalName ?? null,
      status: r.status,
      subtotal: r.subtotal,
      dispatchSlaDueAt: r.dispatch_sla_due_at?.toISOString() ?? null,
      deliveredAt: r.delivered_at?.toISOString() ?? null,
      machines: machineRows
        .filter((m) => m.sub_order_id === r.id)
        .map((m) => ({
          slotId: m.slot_id,
          serialNumber: m.serial_number,
          title: titles.get(m.sku_id) ?? null,
          grade: m.grade,
          unitPrice: m.unit_price,
          purchaseCost: m.unit_id ? (costs.get(m.unit_id) ?? null) : null,
          status: m.status,
          inspectedAt: m.inspected_at?.toISOString() ?? null,
          verifiedAt: m.verified_at?.toISOString() ?? null,
        })),
    }));
  }

  /** What we agreed to pay, per serial. `procurement` only. */
  private async purchaseCosts(unitIds: readonly string[]): Promise<Map<string, string>> {
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ unit_id: string; agreed_net_payout: string }>
    >`
      SELECT unit_id, agreed_net_payout::text AS agreed_net_payout
        FROM procurement.purchase_order_line
       WHERE unit_id = ANY(${[...unitIds]}::uuid[])`;
    return new Map(rows.map((r) => [r.unit_id, r.agreed_net_payout]));
  }

  private async purchaseOrdersOf(orderId: string): Promise<OpsPurchaseOrderView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        po_number: string;
        status: string;
        vendor_org_id: string;
        total_net: string;
        tds_amount: string;
        created_at: Date;
        acknowledged_at: Date | null;
        consignment_carrier: string | null;
        consignment_awb: string | null;
        dispatched_at: Date | null;
        lines: number;
      }>
    >`
      SELECT po.id, po.po_number, po.status::text AS status, po.vendor_org_id,
             po.total_net::text AS total_net, po.tds_amount::text AS tds_amount,
             po.created_at, po.acknowledged_at,
             po.consignment_carrier, po.consignment_awb, po.dispatched_at,
             (SELECT count(*)::int FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS lines
        FROM procurement.purchase_order po
       WHERE po.order_id = ${orderId}::uuid
       ORDER BY po.po_number`;

    const vendors = await this.parties(rows.map((r) => r.vendor_org_id));
    return rows.map((r) => ({
      poId: r.id,
      poNumber: r.po_number,
      status: r.status,
      vendorLegalName: vendors.get(r.vendor_org_id)?.legalName ?? null,
      totalNet: r.total_net,
      tdsAmount: r.tds_amount,
      lines: r.lines,
      raisedAt: r.created_at.toISOString(),
      acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
      carrier: r.consignment_carrier?.trim() || null,
      awb: r.consignment_awb?.trim() || null,
      dispatchedAt: r.dispatched_at?.toISOString() ?? null,
    }));
  }

  /**
   * Every event on the order, with the actor named.
   *
   * §3C.4: "Full timeline with actor on every event." An actor that cannot be
   * resolved is reported as null and rendered "Not recorded" — a system event
   * genuinely has no person behind it, and inventing "System" for a row where we
   * simply lost the id would make the two indistinguishable.
   */
  private async timelineOf(orderId: string): Promise<OpsTimelineEventView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        occurred_at: Date;
        event_type: string;
        from_status: string | null;
        to_status: string | null;
        actor_id: string | null;
        note: string | null;
      }>
    >`
      SELECT occurred_at, event_type::text AS event_type, from_status, to_status, actor_id, note
        FROM ordering.order_event
       WHERE order_id = ${orderId}::uuid
       ORDER BY occurred_at DESC`;

    const names = await this.names(rows.flatMap((r) => (r.actor_id ? [r.actor_id] : [])));
    return rows.map((r) => ({
      at: r.occurred_at.toISOString(),
      type: r.event_type,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actorName: r.actor_id === null ? null : (names.get(r.actor_id) ?? null),
      note: r.note,
    }));
  }

  private async titles(skuIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    // Through the barrel, because "what this machine is called" is a rule
    // catalog owns — brand plus model, resolved the one way.
    await Promise.all(
      [...new Set(skuIds)].map(async (id) => {
        const sku = await this.catalog.describe(id);
        if (sku) out.set(id, sku.title);
      }),
    );
    return out;
  }

  private async names(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account
       WHERE id = ANY(${[...new Set(userIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  /**
   * The board's "Needs attention" strip, over every order rather than the
   * filtered page. Prepaid only: an order on credit terms is meant to ship
   * before it is paid, and naming it here would be a false alarm every time.
   * Two statements in `ordering`'s own schema, and the buyer's name through
   * the same `parties()` the rows use, so the strip and the row agree.
   */
  private async attention(): Promise<OpsOrderAttentionView> {
    const exceptions = await this.prisma.$queryRaw<
      Array<{ order_number: string; status: string; buyer_org_id: string; grand_total: string }>
    >`
      SELECT o.order_number, o.status::text AS status, o.buyer_org_id,
             o.grand_total::text AS grand_total
        FROM ordering."order" o
       WHERE o.payment_mode::text = 'PREPAID'
         AND o.payment_status::text <> 'PAID'
         AND o.status::text IN ('VENDOR_ACCEPTED', 'DISPATCHED', 'DELIVERED')
       ORDER BY o.placed_at`;
    const [pending] = await this.prisma.$queryRaw<
      Array<{ n: number; total: string; oldest: Date | null }>
    >`
      SELECT count(*)::int AS n,
             coalesce(sum(o.grand_total), 0)::text AS total,
             min(o.placed_at) AS oldest
        FROM ordering."order" o
       WHERE o.status::text = 'PAYMENT_PENDING'`;
    const parties = await this.parties(exceptions.map((e) => e.buyer_org_id));
    const item = (e: (typeof exceptions)[number]): OpsOrderAttentionItem => ({
      orderNumber: e.order_number,
      status: e.status,
      buyerName: parties.get(e.buyer_org_id)?.legalName ?? null,
      grandTotal: e.grand_total,
    });
    return {
      deliveredUnpaid: exceptions.filter((e) => e.status === 'DELIVERED').map(item),
      acceptedUnpaid: exceptions.filter((e) => e.status !== 'DELIVERED').map(item),
      paymentPending: {
        count: pending?.n ?? 0,
        total: pending?.total ?? '0',
        oldestPlacedAt: pending?.oldest?.toISOString() ?? null,
      },
    };
  }

  /**
   * The two facets, each counted under every OTHER filter but not its own.
   *
   * That is what makes a zero meaningful: the option stays visible and disabled
   * at `--ink-4` rather than disappearing, because options that vanish make
   * people think the tool is broken (09_FRONTEND_LOCKED §6).
   */
  private async statusFacet(
    where: Prisma.Sql,
    payment: string | null,
    approval: Prisma.Sql,
  ): Promise<OpsFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT o.status::text AS value,
             count(*) FILTER (
               WHERE (${payment}::text IS NULL OR o.payment_status::text = ${payment})
                 AND ${approval}
             )::int AS count
        FROM ordering."order" o
       WHERE ${where}
       GROUP BY o.status
       ORDER BY o.status`;
    return rows.map((r) => ({
      value: r.value,
      label: STATUS_LABEL[r.value] ?? r.value.replace(/_/g, ' ').toLowerCase(),
      count: r.count,
    }));
  }

  private async paymentFacet(
    where: Prisma.Sql,
    status: string | null,
    approval: Prisma.Sql,
  ): Promise<OpsFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT o.payment_status::text AS value,
             count(*) FILTER (
               WHERE (${status}::text IS NULL OR o.status::text = ${status})
                 AND ${approval}
             )::int AS count
        FROM ordering."order" o
       WHERE ${where}
       GROUP BY o.payment_status
       ORDER BY o.payment_status`;
    return rows.map((r) => ({
      value: r.value,
      label: PAYMENT_LABEL[r.value] ?? r.value.replace(/_/g, ' ').toLowerCase(),
      count: r.count,
    }));
  }
}

/* -------------------------------------------------------------------------- */

/** `%term%` semantics, decided in one place so the row and the query agree. */
function matchesLike(haystack: string, needle: string | null): boolean {
  return needle !== null && haystack.toLowerCase().includes(needle.toLowerCase());
}

function group<K, V>(pairs: ReadonlyArray<readonly [K, V]>): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const [k, v] of pairs) out.set(k, [...(out.get(k) ?? []), v]);
  return out;
}

/** Money in paise, as an integer. Never a float — a margin is money. */
function toPaise(amount: string): number {
  return Math.round(Number(amount) * 100);
}

function fromPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}
