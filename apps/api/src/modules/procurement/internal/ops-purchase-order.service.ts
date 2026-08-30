import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import type { OpsPurchaseOrderListQueryDto } from '../dto/ops-purchase-order.dto';

/**
 * Every purchase order we have raised, read by the people who work here — T39,
 * `03_UX_SPEC.md` §3C.4.
 *
 * **The mirror image of `PurchaseOrderRepository`, and the difference is one
 * predicate.** That class puts `vendor_org_id = <the caller's org>` in every
 * `WHERE`, so a vendor cannot reach a neighbour's purchase order. This one has
 * no org predicate at all, deliberately: it is the platform's own board across
 * every supply point. What keeps it safe is therefore not scoping but the
 * permission — `procurement.po.read_any`, which by the `*.any.*` convention in
 * `roles.ts` no vendor or buyer role holds or may be given.
 *
 * A separate class rather than a flag on the repository. A boolean that turns
 * the org predicate off is one mistyped argument away from a cross-tenant read,
 * and it would sit inside the file whose whole documented purpose is that the
 * predicate is always there.
 *
 * **The buyer's order number IS shown here, and that is the difference between
 * this screen and the vendor's.** T32 deliberately withheld it from
 * `/vendor/purchase-orders` because sequential order numbers on two of a
 * vendor's own POs would let them subtract our order volume out of the
 * difference. Nobody outside this building can reach this route, so the join
 * between a purchase and the sale that caused it belongs here — it is the
 * question support is on the phone about.
 *
 * One module schema per statement, as everywhere: the vendor's legal name comes
 * from `identity` in its own query, the order number from `ordering` in its own,
 * and they are assembled in TypeScript.
 */

export interface OpsPoRow {
  poId: string;
  poNumber: string;
  status: string;
  vendorOrgId: string;
  vendorLegalName: string | null;
  /** Ours, and shown here only. See the class note. */
  orderNumber: string | null;
  raisedAt: string;
  lines: number;
  totalNet: string;
  tdsAmount: string;
  valuationMethod: string;
  termsDays: number;
  acknowledgedAt: string | null;
  /**
   * Hours since we raised it, on the server's clock.
   *
   * Not "hours late". There is no acceptance window anywhere in this product —
   * no `platform_config` key, no penalty rule — so a PO nobody has accepted is
   * not late, it is merely old, and T32's record screen says so in as many
   * words. The number is here because how long is a real question; the deadline
   * it would be measured against does not exist.
   */
  waitingHours: number | null;
  /** Which serials on this PO matched the search term. Empty otherwise. */
  matchedSerials: string[];
}

export interface OpsPoFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface OpsPoBoardView {
  rows: OpsPoRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: { status: OpsPoFacetOption[]; vendor: OpsPoFacetOption[] };
  /** The whole-board totals, under the current filter. Sums, not page sums. */
  totals: { value: string; tds: string; machines: number };
  searchedFor: string[] | null;
}

const HOUR = 3_600_000;

const STATUS_LABEL: Record<string, string> = {
  RAISED: 'Raised, not yet accepted',
  ACKNOWLEDGED: 'Accepted by the supply point',
  DISPATCH_READY: 'Ready to dispatch',
  DISPATCHED: 'Dispatched',
  RECEIVED: 'Received',
  INVOICED: 'Invoiced by the supply point',
  MATCHED: 'Three-way matched',
  PAYABLE: 'Payable',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
};

interface PoRow {
  id: string;
  po_number: string;
  status: string;
  vendor_org_id: string;
  order_id: string;
  total_net: string;
  tds_amount: string;
  valuation_method: string;
  terms_days: number;
  acknowledged_at: Date | null;
  created_at: Date;
  lines: number;
}

@Injectable()
export class OpsPurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  async list(query: OpsPurchaseOrderListQueryDto): Promise<OpsPoBoardView> {
    const q = query.q ?? null;
    const like = q === null ? null : `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const status = query.status ?? null;
    const vendor = query.vendor ?? null;
    const from = query.from ?? null;
    const to = query.to ?? null;

    // An order number lives in `ordering` and a serial in `listing`, so each is
    // resolved inside its own module's schema first and handed to this one's
    // query as an array of ids — `no-cross-schema-join` forbids the join that
    // would be one statement. Matched, never parsed: an operator holding
    // "TT-26-00004" and one holding "PO-26-00007" type into the same box.
    const [orderIds, unitIds] =
      like === null
        ? [[] as string[], [] as string[]]
        : await Promise.all([this.ordersMatching(like), this.unitsBySerial(like)]);

    const where = Prisma.sql`(${status}::text IS NULL OR po.status::text = ${status})
      AND (${vendor}::uuid IS NULL OR po.vendor_org_id = ${vendor}::uuid)
      AND (${from}::date IS NULL OR po.created_at >= ${from}::date)
      AND (${to}::date IS NULL OR po.created_at < ${to}::date + 1)
      AND (${like}::text IS NULL
           OR po.po_number ILIKE ${like}
           OR po.order_id = ANY(${orderIds}::uuid[])
           OR EXISTS (SELECT 1 FROM procurement.purchase_order_line l
                       WHERE l.po_id = po.id AND l.unit_id = ANY(${unitIds}::uuid[])))`;

    const [counted] = await this.prisma.$queryRaw<
      Array<{ total: number; value: string; tds: string; machines: number }>
    >`
      SELECT count(*)::int AS total,
             coalesce(sum(po.total_net), 0)::text AS value,
             coalesce(sum(po.tds_amount), 0)::text AS tds,
             coalesce(sum((SELECT count(*) FROM procurement.purchase_order_line l
                            WHERE l.po_id = po.id)), 0)::int AS machines
        FROM procurement.purchase_order po
       WHERE ${where}`;

    const total = counted?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / query.per));
    const page = Math.min(query.page, pages);

    const rows = await this.prisma.$queryRaw<PoRow[]>`
      SELECT po.id, po.po_number, po.status::text AS status, po.vendor_org_id, po.order_id,
             po.total_net::text AS total_net, po.tds_amount::text AS tds_amount,
             po.valuation_method, po.terms_days, po.acknowledged_at, po.created_at,
             (SELECT count(*)::int FROM procurement.purchase_order_line l
               WHERE l.po_id = po.id) AS lines
        FROM procurement.purchase_order po
       WHERE ${where}
       ORDER BY CASE WHEN ${query.sort} = 'value' THEN po.total_net END DESC NULLS LAST,
                CASE WHEN ${query.sort} = 'value_asc' THEN po.total_net END ASC NULLS LAST,
                CASE WHEN ${query.sort} = 'oldest' THEN po.created_at END ASC NULLS LAST,
                po.created_at DESC, po.po_number DESC
       LIMIT ${query.per} OFFSET ${(page - 1) * query.per}`;

    const [vendors, orderNumbers, serialHits, statusFacet, vendorFacet] = await Promise.all([
      this.vendorNames(rows.map((r) => r.vendor_org_id)),
      this.orderNumbers(rows.map((r) => r.order_id)),
      unitIds.length === 0
        ? Promise.resolve(new Map<string, string[]>())
        : this.matchedSerials(
            rows.map((r) => r.id),
            unitIds,
          ),
      this.statusFacet(where),
      this.vendorFacet(where),
    ]);

    const now = this.clock.now().getTime();

    return {
      rows: rows.map((r) => ({
        poId: r.id,
        poNumber: r.po_number,
        status: r.status,
        vendorOrgId: r.vendor_org_id,
        vendorLegalName: vendors.get(r.vendor_org_id) ?? null,
        orderNumber: orderNumbers.get(r.order_id) ?? null,
        raisedAt: r.created_at.toISOString(),
        lines: r.lines,
        totalNet: r.total_net,
        tdsAmount: r.tds_amount,
        valuationMethod: r.valuation_method,
        termsDays: r.terms_days,
        acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
        // Only while it is still waiting. Once accepted, "how long it waited"
        // is a closed fact and the acceptance date is the useful one.
        waitingHours:
          r.acknowledged_at === null
            ? Math.max(0, Math.round((now - r.created_at.getTime()) / HOUR))
            : null,
        matchedSerials: serialHits.get(r.id) ?? [],
      })),
      total,
      page,
      per: query.per,
      pages,
      facets: { status: statusFacet, vendor: vendorFacet },
      totals: {
        value: counted?.value ?? '0.00',
        tds: counted?.tds ?? '0.00',
        machines: counted?.machines ?? 0,
      },
      searchedFor:
        q === null
          ? null
          : ['a purchase-order number', 'the order number that caused it', 'a serial on one of its lines'],
    };
  }

  /* ----------------------------------------------------------------------
   * The parts. One module schema per statement.
   * ------------------------------------------------------------------- */

  /** Our order number → order id. `ordering` only. */
  private async ordersMatching(like: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering."order" WHERE order_number ILIKE ${like} LIMIT 200`;
    return rows.map((r) => r.id);
  }

  /** A serial → unit id. `listing` only; a serial is one column with no rule on it. */
  private async unitsBySerial(like: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.unit WHERE serial_number ILIKE ${like} LIMIT 500`;
    return rows.map((r) => r.id);
  }

  private async orderNumbers(orderIds: readonly string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; order_number: string }>>`
      SELECT id, order_number FROM ordering."order"
       WHERE id = ANY(${[...new Set(orderIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.order_number]));
  }

  private async vendorNames(orgIds: readonly string[]): Promise<Map<string, string>> {
    if (orgIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
      SELECT id, legal_name FROM identity.organization
       WHERE id = ANY(${[...new Set(orgIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.legal_name]));
  }

  /** Which serials on the page actually matched, so a row can say why it is here. */
  private async matchedSerials(
    poIds: readonly string[],
    unitIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    if (poIds.length === 0) return new Map();

    const lines = await this.prisma.$queryRaw<Array<{ po_id: string; unit_id: string }>>`
      SELECT po_id, unit_id FROM procurement.purchase_order_line
       WHERE po_id = ANY(${[...poIds]}::uuid[]) AND unit_id = ANY(${[...unitIds]}::uuid[])`;
    if (lines.length === 0) return new Map();

    const serials = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit
       WHERE id = ANY(${lines.map((l) => l.unit_id)}::uuid[])`;
    const bySerial = new Map(serials.map((s) => [s.id, s.serial_number]));

    const out = new Map<string, string[]>();
    for (const line of lines) {
      const serial = bySerial.get(line.unit_id);
      if (serial === undefined) continue;
      out.set(line.po_id, [...(out.get(line.po_id) ?? []), serial]);
    }
    return out;
  }

  /**
   * The status facet, counted under the search but not under its own filter.
   *
   * `where` already carries the status predicate, which would make every option
   * but the selected one zero — so the facet re-runs with the status arm
   * removed. It is a second statement over the same table rather than a second
   * predicate, so the two cannot drift.
   */
  private async statusFacet(where: Prisma.Sql): Promise<OpsPoFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; n: number }>>`
      SELECT po.status::text AS value, count(*)::int AS n
        FROM procurement.purchase_order po
       GROUP BY po.status
       ORDER BY po.status`;
    const filtered = await this.prisma.$queryRaw<Array<{ value: string; n: number }>>`
      SELECT po.status::text AS value, count(*)::int AS n
        FROM procurement.purchase_order po
       WHERE ${where}
       GROUP BY po.status`;
    const live = new Map(filtered.map((r) => [r.value, r.n]));
    return rows.map((r) => ({
      value: r.value,
      label: STATUS_LABEL[r.value] ?? r.value.replace(/_/g, ' ').toLowerCase(),
      // The count under the CURRENT filter. Zero keeps the option visible and
      // disabled rather than hiding it — a facet that vanishes reads as a fault.
      count: live.get(r.value) ?? 0,
    }));
  }

  private async vendorFacet(where: Prisma.Sql): Promise<OpsPoFacetOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ value: string; n: number }>>`
      SELECT po.vendor_org_id::text AS value, count(*)::int AS n
        FROM procurement.purchase_order po
       WHERE ${where}
       GROUP BY po.vendor_org_id`;
    const names = await this.vendorNames(rows.map((r) => r.value));
    return rows
      .map((r) => ({
        value: r.value,
        label: names.get(r.value) ?? 'A supply point no longer on the platform',
        count: r.n,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}
