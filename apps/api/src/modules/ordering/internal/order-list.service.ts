import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';
import type { OrderListQueryDto } from '../dto/ordering.dto';

/**
 * Every order the buyer's organisation placed — the board behind T20 — and the
 * handful of aggregates behind T19's dashboard.
 *
 * This is `OrderReadService` widened from one row to many, and it keeps that
 * file's three guarantees rather than restating them:
 *
 * **1. `procurement.purchase_order` is not read here.** Not counted, not joined,
 * not referenced by number. Under the merchant-of-record model our purchase
 * order to a supply point is vendor-and-admin-only (PHASE_06 Task 6), and the
 * way that stays true across every future field somebody adds to this list is
 * for the table to appear nowhere in the file. The absence is the mechanism.
 *
 * **2. Scoping is on the query, not on the caller.** Every statement below
 * carries `buyer_org_id = $org` inside its own `WHERE`, so there is no code path
 * that reaches an order belonging to somebody else and then decides not to
 * return it. A filter applied after the read is a filter somebody eventually
 * forgets.
 *
 * **3. A foreign order is absent, never refused.** The list simply does not
 * contain it, and `byNumber` answers 404 rather than 403 for the same reason:
 * order numbers are sequential, so a route that distinguished "not yours" from
 * "does not exist" would let anyone with an account count our order volume.
 *
 * **What is deliberately not in a row.** No vendor, obviously — but also no
 * dispatch-point count. A count of dispatch points is a count of the warehouses
 * behind an order, and while `Supply Point F · Noida` is safe on the record
 * screen where the machines are named, a bare number on a list column is a
 * running total of suppliers per order with nothing on screen to give it
 * meaning. The board shows machines; the record shows where they leave from.
 */

/* ==========================================================================
 * The buyer-facing shapes. All allow-lists, like OrderReadService's.
 * ======================================================================== */

/** The approval as a list row needs it: is it live, and when does it die. */
export interface OrderListApprovalView {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverName: string;
  /** ISO 8601. The deadline WE imposed on ourselves. */
  expiresAt: string;
}

export interface OrderSummaryView {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  placedAt: string;
  /** The buyer's OWN reference. Null when their organisation gave none. */
  buyerPoNumber: string | null;
  costCentre: string | null;
  grandTotal: string;
  unitsAllocated: number;
  /** The buyer's own delivery site. Their address, not anybody else's. */
  deliverySiteLabel: string | null;
  deliveryCity: string | null;
  /**
   * The serials on this order that matched the search term, when there was one.
   * Empty otherwise — a row has to be able to say WHY it matched a serial
   * search, or the result reads as a mistake.
   */
  matchedSerials: string[];
  approval: OrderListApprovalView | null;
}

/** One option in the rail, with the count it would return. */
export interface OrderFacetOption {
  value: string;
  label: string;
  /** Under every OTHER filter currently applied, but not this group's own. */
  count: number;
}

export interface OrderListView {
  orders: OrderSummaryView[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: {
    status: OrderFacetOption[];
    site: OrderFacetOption[];
  };
}

/**
 * One order waiting on somebody's signature.
 *
 * `slaHours` is measured off the row — `expires_at - requested_at` — rather than
 * read from a constant. The 24 hours is a default on the column, not a law, and
 * a dashboard that printed 24 against a row we actually gave 48 would be
 * reporting our promise wrongly.
 */
export interface PendingApprovalView {
  orderNumber: string;
  approverName: string;
  requestedByName: string;
  requestedAt: string;
  expiresAt: string;
  orderValue: string;
  unitsHeld: number;
  slaHours: number;
  /** Past `expires_at` on the server's own clock. The hold is gone. */
  breached: boolean;
}

/**
 * The dashboard's numbers. Every one of them is a count or a sum this service
 * ran; there is no field here a screen may fill in for itself.
 */
export interface OrderDashboardView {
  orders: number;
  machines: number;
  awaitingApproval: { orders: number; value: string };
  awaitingPayment: { orders: number; value: string };
  approvals: PendingApprovalView[];
  /** Hours the longest-waiting pending approval has been waiting. Null if none. */
  oldestApprovalWaitHours: number | null;
  /** The longest promise outstanding, in hours. Null when nothing is pending. */
  approvalSlaHours: number | null;
}

/* ========================================================================== */

interface OrderListRow {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  buyer_po_number: string | null;
  cost_centre: string | null;
  grand_total: string;
  placed_at: Date;
  shipping_address_id: string;
}

/** Words a buyer reads, for the machine words the enum stores. */
const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Not yet placed',
  AWAITING_APPROVAL: 'Awaiting approval',
  PAYMENT_PENDING: 'Placed · payment pending',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

const HOUR = 3_600_000;

@Injectable()
export class OrderListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
  ) {}

  /* ----------------------------------------------------------------------
   * T20 — the board
   * ------------------------------------------------------------------- */

  async list(query: OrderListQueryDto): Promise<OrderListView> {
    const orgId = this.buyerOrgId();
    const q = query.q ?? null;
    // Matched, not parsed: the same box takes an order number, the buyer's own
    // PO reference and a serial, and a person holding one of the three does not
    // reliably know which.
    const like = q === null ? null : `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const status = query.status ?? null;
    const site = query.site ?? null;

    const [counted] = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total
        FROM ordering."order" o
       WHERE o.buyer_org_id = ${orgId}::uuid
         AND (${status}::text IS NULL OR o.status::text = ${status})
         AND (${site}::uuid IS NULL OR o.shipping_address_id = ${site}::uuid)
         AND (${like}::text IS NULL
              OR o.order_number ILIKE ${like}
              OR o.buyer_po_number ILIKE ${like}
              OR EXISTS (SELECT 1
                           FROM ordering.order_line_unit olu
                           JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                           JOIN ordering.sub_order so ON so.id = ol.sub_order_id
                          WHERE so.order_id = o.id AND olu.serial_number ILIKE ${like}))`;

    const total = counted?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / query.per));
    // A kept link to page 4 of a board that is now two pages long lands on the
    // last page rather than on an empty one — the rows moved, the link did not.
    const page = Math.min(query.page, pages);

    const rows = await this.prisma.$queryRaw<OrderListRow[]>`
      SELECT o.id, o.order_number, o.status::text AS status,
             o.payment_status::text AS payment_status, o.buyer_po_number, o.cost_centre,
             o.grand_total::text AS grand_total, o.placed_at, o.shipping_address_id
        FROM ordering."order" o
       WHERE o.buyer_org_id = ${orgId}::uuid
         AND (${status}::text IS NULL OR o.status::text = ${status})
         AND (${site}::uuid IS NULL OR o.shipping_address_id = ${site}::uuid)
         AND (${like}::text IS NULL
              OR o.order_number ILIKE ${like}
              OR o.buyer_po_number ILIKE ${like}
              OR EXISTS (SELECT 1
                           FROM ordering.order_line_unit olu
                           JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                           JOIN ordering.sub_order so ON so.id = ol.sub_order_id
                          WHERE so.order_id = o.id AND olu.serial_number ILIKE ${like}))
       -- ORDER BY cannot take a parameter, and the alternative is string
       -- interpolation into SQL. Four CASE keys over a validated enum keep the
       -- statement one parameterised template: for any given sort three of them
       -- are NULL on every row, so they tie and the trailing key decides.
       ORDER BY CASE WHEN ${query.sort} = 'value' THEN o.grand_total END DESC NULLS LAST,
                CASE WHEN ${query.sort} = 'value_asc' THEN o.grand_total END ASC NULLS LAST,
                CASE WHEN ${query.sort} = 'oldest' THEN o.placed_at END ASC NULLS LAST,
                o.placed_at DESC
       LIMIT ${query.per} OFFSET ${(page - 1) * query.per}`;

    const ids = rows.map((r) => r.id);
    const [units, serials, sites, statusFacet, siteFacet, approvals] = await Promise.all([
      this.unitCounts(ids),
      like === null ? Promise.resolve(new Map<string, string[]>()) : this.matchedSerials(ids, like),
      this.siteLabels(rows.map((r) => r.shipping_address_id)),
      this.statusFacet(orgId, like, site),
      this.siteFacet(orgId, like, status),
      this.approvals(ids),
    ]);

    return {
      orders: rows.map((row) => {
        const address = sites.get(row.shipping_address_id) ?? null;
        return {
          orderNumber: row.order_number,
          status: row.status,
          paymentStatus: row.payment_status,
          placedAt: row.placed_at.toISOString(),
          // An empty string is what a form posts when nobody typed anything; it
          // is not a reference, and drawing it as one puts a blank on a screen
          // that reads as a recorded value.
          buyerPoNumber: row.buyer_po_number?.trim() || null,
          costCentre: row.cost_centre?.trim() || null,
          grandTotal: row.grand_total,
          unitsAllocated: units.get(row.id) ?? 0,
          deliverySiteLabel: address?.label ?? null,
          deliveryCity: address?.city ?? null,
          matchedSerials: serials.get(row.id) ?? [],
          approval: approvals.get(row.id) ?? null,
        };
      }),
      total,
      page,
      per: query.per,
      pages,
      facets: { status: statusFacet, site: siteFacet },
    };
  }

  /* ----------------------------------------------------------------------
   * T19 — the dashboard
   * ------------------------------------------------------------------- */

  /**
   * The four figures a buyer's dashboard is entitled to show, and the one real
   * queue behind them.
   *
   * There is deliberately nothing else. The only deadline this product has
   * imposed on a buyer is `order_approval.expires_at`, so that is the only
   * thing here with an SLA; `order.stock_hold_expires_at` on a placed order is
   * the spent twenty-minute checkout hold and means nothing after the fact, and
   * an unpaid order has no due date because we have not set one. A dashboard
   * padded out with gauges nothing measures is worse than a short one.
   */
  async summary(): Promise<OrderDashboardView> {
    const orgId = this.buyerOrgId();
    const now = this.clock.now().getTime();

    const [totals] = await this.prisma.$queryRaw<
      Array<{
        orders: number;
        approval_orders: number;
        payment_orders: number;
        approval_value: string;
        payment_value: string;
      }>
    >`
      SELECT count(*)::int AS orders,
             count(*) FILTER (WHERE o.status = 'AWAITING_APPROVAL')::int AS approval_orders,
             count(*) FILTER (WHERE o.status = 'PAYMENT_PENDING')::int AS payment_orders,
             coalesce(sum(o.grand_total) FILTER (WHERE o.status = 'AWAITING_APPROVAL'), 0)::text
               AS approval_value,
             coalesce(sum(o.grand_total) FILTER (WHERE o.status = 'PAYMENT_PENDING'), 0)::text
               AS payment_value
        FROM ordering."order" o
       WHERE o.buyer_org_id = ${orgId}::uuid`;

    const [machines] = await this.prisma.$queryRaw<Array<{ machines: number }>>`
      SELECT count(*)::int AS machines
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
        JOIN ordering."order" o ON o.id = so.order_id
       WHERE o.buyer_org_id = ${orgId}::uuid`;

    const pending = await this.prisma.$queryRaw<
      Array<{
        order_number: string;
        order_value: string;
        requested_at: Date;
        expires_at: Date;
        approver_user_id: string;
        requested_by: string;
        units: number;
      }>
    >`
      SELECT o.order_number, a.order_value::text AS order_value, a.requested_at, a.expires_at,
             a.approver_user_id, a.requested_by,
             (SELECT count(*)::int
                FROM ordering.order_line_unit olu
                JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                JOIN ordering.sub_order so ON so.id = ol.sub_order_id
               WHERE so.order_id = o.id) AS units
        FROM ordering.order_approval a
        JOIN ordering."order" o ON o.id = a.order_id
       WHERE o.buyer_org_id = ${orgId}::uuid AND a.status = 'PENDING'
       ORDER BY a.expires_at ASC`;

    const names = await this.names(
      pending.flatMap((r) => [r.approver_user_id, r.requested_by]),
    );

    const approvals: PendingApprovalView[] = pending.map((r) => ({
      orderNumber: r.order_number,
      approverName: names.get(r.approver_user_id) ?? 'the approver named on this order',
      requestedByName: names.get(r.requested_by) ?? 'the person who placed it',
      requestedAt: r.requested_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      orderValue: r.order_value,
      unitsHeld: r.units,
      slaHours: Math.round((r.expires_at.getTime() - r.requested_at.getTime()) / HOUR),
      breached: r.expires_at.getTime() <= now,
    }));

    return {
      orders: totals?.orders ?? 0,
      machines: machines?.machines ?? 0,
      awaitingApproval: {
        orders: totals?.approval_orders ?? 0,
        value: totals?.approval_value ?? '0.00',
      },
      awaitingPayment: {
        orders: totals?.payment_orders ?? 0,
        value: totals?.payment_value ?? '0.00',
      },
      approvals,
      oldestApprovalWaitHours: approvals.length
        ? Math.max(
            ...pending.map((r) => Math.floor((now - r.requested_at.getTime()) / HOUR)),
          )
        : null,
      approvalSlaHours: approvals.length ? Math.max(...approvals.map((a) => a.slaHours)) : null,
    };
  }

  /* ----------------------------------------------------------------------
   * The parts
   * ------------------------------------------------------------------- */

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Orders belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }

  /** Machines per order. Inside `ordering` only — no cross-schema JOIN. */
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

  /** Which serials on the page actually matched, so a row can say why it is here. */
  private async matchedSerials(
    orderIds: readonly string[],
    like: string,
  ): Promise<Map<string, string[]>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ order_id: string; serial_number: string }>
    >`
      SELECT so.order_id, olu.serial_number
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ANY(${[...orderIds]}::uuid[]) AND olu.serial_number ILIKE ${like}
       ORDER BY olu.serial_number`;
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.order_id, [...(out.get(r.order_id) ?? []), r.serial_number]);
    return out;
  }

  /**
   * The live approval per order on the page.
   *
   * A `PENDING` row past its own `expires_at` is reported `EXPIRED`, exactly as
   * `OrderReadService` does it: the release job runs on a schedule, and a board
   * reading the raw status would tell a buyer their order was still with their
   * manager an hour after the deadline we set had gone.
   */
  private async approvals(
    orderIds: readonly string[],
  ): Promise<Map<string, OrderListApprovalView>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ order_id: string; status: string; expires_at: Date; approver_user_id: string }>
    >`
      SELECT DISTINCT ON (a.order_id)
             a.order_id, a.status, a.expires_at, a.approver_user_id
        FROM ordering.order_approval a
       WHERE a.order_id = ANY(${[...orderIds]}::uuid[])
       ORDER BY a.order_id, a.requested_at DESC`;
    if (rows.length === 0) return new Map();

    const names = await this.names(rows.map((r) => r.approver_user_id));
    const now = this.clock.now().getTime();
    return new Map(
      rows.map((r) => [
        r.order_id,
        {
          status:
            r.status === 'PENDING' && r.expires_at.getTime() <= now
              ? 'EXPIRED'
              : (r.status as OrderListApprovalView['status']),
          approverName: names.get(r.approver_user_id) ?? 'the approver named on this order',
          expiresAt: r.expires_at.toISOString(),
        },
      ]),
    );
  }

  /** The buyer's own delivery sites. Their addresses; nobody else's. */
  private async siteLabels(
    addressIds: readonly string[],
  ): Promise<Map<string, { label: string | null; city: string }>> {
    if (addressIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; label: string | null; city: string }>
    >`
      SELECT id, label, city FROM identity.org_address
       WHERE id = ANY(${[...new Set(addressIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, { label: r.label, city: r.city }]));
  }

  /**
   * The status facet.
   *
   * One statement, two numbers: the options are every status the organisation's
   * orders have ever been in, and the count beside each is what it would return
   * under every OTHER filter currently applied. That is what makes a zero
   * meaningful — the option stays visible and disabled at `--ink-4` rather than
   * disappearing, because options that vanish make people think the site is
   * broken (09_FRONTEND_LOCKED.md §6).
   */
  private async statusFacet(
    orgId: string,
    like: string | null,
    site: string | null,
  ): Promise<OrderFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT o.status::text AS value,
             count(*) FILTER (
               WHERE (${site}::uuid IS NULL OR o.shipping_address_id = ${site}::uuid)
                 AND (${like}::text IS NULL
                      OR o.order_number ILIKE ${like}
                      OR o.buyer_po_number ILIKE ${like}
                      OR EXISTS (SELECT 1
                                   FROM ordering.order_line_unit olu
                                   JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                                   JOIN ordering.sub_order so ON so.id = ol.sub_order_id
                                  WHERE so.order_id = o.id AND olu.serial_number ILIKE ${like}))
             )::int AS count
        FROM ordering."order" o
       WHERE o.buyer_org_id = ${orgId}::uuid
       GROUP BY o.status
       ORDER BY o.status`;
    return rows.map((r) => ({
      value: r.value,
      label: STATUS_LABEL[r.value] ?? r.value.replace(/_/g, ' ').toLowerCase(),
      count: r.count,
    }));
  }

  /** The delivery-site facet, on the same principle as the status one. */
  private async siteFacet(
    orgId: string,
    like: string | null,
    status: string | null,
  ): Promise<OrderFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT o.shipping_address_id::text AS value,
             count(*) FILTER (
               WHERE (${status}::text IS NULL OR o.status::text = ${status})
                 AND (${like}::text IS NULL
                      OR o.order_number ILIKE ${like}
                      OR o.buyer_po_number ILIKE ${like}
                      OR EXISTS (SELECT 1
                                   FROM ordering.order_line_unit olu
                                   JOIN ordering.order_line ol ON ol.id = olu.order_line_id
                                   JOIN ordering.sub_order so ON so.id = ol.sub_order_id
                                  WHERE so.order_id = o.id AND olu.serial_number ILIKE ${like}))
             )::int AS count
        FROM ordering."order" o
       WHERE o.buyer_org_id = ${orgId}::uuid
       GROUP BY o.shipping_address_id`;
    const labels = await this.siteLabels(rows.map((r) => r.value));
    return rows
      .map((r) => {
        const address = labels.get(r.value);
        return {
          value: r.value,
          label: address ? (address.label ?? address.city) : 'Site no longer on your account',
          count: r.count,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private async names(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account
       WHERE id = ANY(${[...new Set(userIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }
}
