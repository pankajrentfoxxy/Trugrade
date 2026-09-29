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

/** One stage of the pipeline, counted over EVERY purchase order, not the page. */
export interface OpsPoStage {
  status: string;
  count: number;
  /** Sum of `total_net` at this stage. */
  value: string;
  /**
   * How many at this stage have waited past the board's threshold for it:
   * RAISED past `ackDays` without acknowledgement, ACKNOWLEDGED past
   * `dispatchDays` without dispatch. Zero for every other stage — no other
   * stage has a wait the board measures.
   */
  late: number;
  lateValue: string;
}

/**
 * The two stuck sets the board's attention strip names, with the facts the
 * sentence needs: the oldest of the unacknowledged and who it is with, and
 * which supply points are sitting on acknowledged-but-undispatched orders.
 */
export interface OpsPoAttention {
  unacknowledged: {
    count: number;
    value: string;
    oldest: { poNumber: string; vendorLegalName: string | null; raisedAt: string } | null;
  };
  undispatched: { count: number; value: string; vendors: string[] };
}

export interface OpsPoBoardView {
  rows: OpsPoRow[];
  /** The whole board before any filter: how many, to how many supply points, worth how much. */
  summary: { pos: number; vendors: number; payable: string };
  stages: OpsPoStage[];
  attention: OpsPoAttention;
  /** The waits `stages[].late` and `attention` are measured against, in days. */
  thresholds: { ackDays: number; dispatchDays: number };
  /**
   * The saved views, with their counts, in the same response as the page.
   *
   * Ordered so the FIRST one is the default, and the default is never All: the
   * only view on this board anybody can act on is Packed, and a board that
   * opens on 1,680 rows has handed the filtering back to the operator.
   */
  views: Array<{ key: string; label: string; count: number }>;
  /** Rows before any filter, so the pager can say how much was narrowed. */
  grandTotal: number;
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
const DAY = 24 * HOUR;

/**
 * The board's two waits, in days.
 *
 * Not deadlines — the row note on `waitingHours` still holds, and nothing here
 * penalises anyone. They are the points past which the board stops calling a
 * purchase order "waiting" and starts calling it "stuck", so an operator sees
 * eleven stuck orders as one line rather than as eleven rows to compare dates
 * on. Echoed to the client in `thresholds` so the copy quotes the same number
 * the count was made with.
 */
export const ACK_STALE_DAYS = 7;
export const DISPATCH_STALE_DAYS = 14;

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
    // A view resolves to a status here rather than in the URL, so the board's
    // vocabulary ("ready") and the table's ("DISPATCH_READY") can diverge
    // without the link somebody bookmarked changing meaning.
    const VIEW_STATUS: Readonly<Record<string, string | null>> = {
      ready: 'DISPATCH_READY',
      partial: 'PARTIAL',
      awaiting: 'RAISED',
      dispatched: 'DISPATCHED',
      received: 'RECEIVED',
      all: null,
    };
    const status = query.status ?? (query.view ? (VIEW_STATUS[query.view] ?? null) : null);
    const vendor = query.vendor ?? null;
    const from = query.from ?? null;
    const to = query.to ?? null;
    const late = query.late ?? null;

    const now = this.clock.now().getTime();
    const ackCutoff = new Date(now - ACK_STALE_DAYS * DAY);
    const dispatchCutoff = new Date(now - DISPATCH_STALE_DAYS * DAY);

    // An order number lives in `ordering` and a serial in `listing`, so each is
    // resolved inside its own module's schema first and handed to this one's
    // query as an array of ids — `no-cross-schema-join` forbids the join that
    // would be one statement. Matched, never parsed: an operator holding
    // "TT-26-00004" and one holding "PO-26-00007" type into the same box.
    const [orderIds, unitIds] =
      like === null
        ? [[] as string[], [] as string[]]
        : await Promise.all([this.ordersMatching(like), this.unitsBySerial(like)]);

    // The vendor arm is separable so the supply-point facet can be counted
    // WITHOUT it: a dropdown that shrinks to the one option you just chose has
    // stopped being a filter and become a label.
    const whereWith = (withVendor: boolean): Prisma.Sql => {
      const v = withVendor ? vendor : null;
      return Prisma.sql`(${status}::text IS NULL OR po.status::text = ${status})
      AND (${v}::uuid IS NULL OR po.vendor_org_id = ${v}::uuid)
      AND (${late}::text IS NULL
           OR (${late}::text = 'ack' AND po.status::text = 'RAISED'
               AND po.created_at < ${ackCutoff}::timestamptz)
           OR (${late}::text = 'dispatch' AND po.status::text = 'ACKNOWLEDGED'
               AND po.acknowledged_at < ${dispatchCutoff}::timestamptz))
      AND (${from}::date IS NULL OR po.created_at >= ${from}::date)
      AND (${to}::date IS NULL OR po.created_at < ${to}::date + 1)
      AND (${like}::text IS NULL
           OR po.po_number ILIKE ${like}
           OR po.order_id = ANY(${orderIds}::uuid[])
           OR EXISTS (SELECT 1 FROM procurement.purchase_order_line l
                       WHERE l.po_id = po.id AND l.unit_id = ANY(${unitIds}::uuid[])))`;
    };
    const where = whereWith(true);

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
      this.vendorFacet(whereWith(false)),
    ]);

    const [summary, stages, attention] = await Promise.all([
      this.summary(),
      this.stages(ackCutoff, dispatchCutoff),
      this.attention(ackCutoff, dispatchCutoff),
    ]);

    // One scan for every badge. Six separate counts would be six round trips and
    // six answers from six different instants, and a badge that disagrees with
    // what the board renders destroys trust in every other number on the screen.
    const [viewCounts] = await this.prisma.$queryRaw<
      Array<Record<string, bigint>>
    >`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE po.status::text = 'DISPATCH_READY') AS ready,
             count(*) FILTER (WHERE po.status::text = 'PARTIAL') AS partial,
             count(*) FILTER (WHERE po.status::text = 'RAISED') AS awaiting,
             count(*) FILTER (WHERE po.status::text = 'DISPATCHED') AS dispatched,
             count(*) FILTER (WHERE po.status::text = 'RECEIVED') AS received
        FROM procurement.purchase_order po`;
    const n = (k: string): number => Number(viewCounts?.[k] ?? 0);

    return {
      views: [
        { key: 'ready', label: 'Packed · ready', count: n('ready') },
        { key: 'partial', label: 'Partial', count: n('partial') },
        { key: 'awaiting', label: 'Awaiting vendor', count: n('awaiting') },
        { key: 'dispatched', label: 'Dispatched', count: n('dispatched') },
        { key: 'received', label: 'Received', count: n('received') },
        { key: 'all', label: 'All', count: n('all_rows') },
      ],
      grandTotal: n('all_rows'),
      summary,
      stages,
      attention,
      thresholds: { ackDays: ACK_STALE_DAYS, dispatchDays: DISPATCH_STALE_DAYS },
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
          : [
              'a purchase-order number',
              'the order number that caused it',
              'a serial on one of its lines',
            ],
    };
  }

  /* ----------------------------------------------------------------------
   * The parts. One module schema per statement.
   * ------------------------------------------------------------------- */

  /** Every purchase order ever raised, in three numbers. Unfiltered on purpose. */
  private async summary(): Promise<OpsPoBoardView['summary']> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ pos: number; vendors: number; payable: string }>
    >`
      SELECT count(*)::int AS pos,
             count(DISTINCT po.vendor_org_id)::int AS vendors,
             coalesce(sum(po.total_net), 0)::text AS payable
        FROM procurement.purchase_order po`;
    return row ?? { pos: 0, vendors: 0, payable: '0.00' };
  }

  /**
   * The pipeline, one scan.
   *
   * Every stage's count, value and stuck count come out of the same statement
   * so the tiles agree with each other and with the attention strip, which is
   * built from the same two cutoffs.
   */
  private async stages(ackCutoff: Date, dispatchCutoff: Date): Promise<OpsPoStage[]> {
    const stuck = Prisma.sql`(po.status::text = 'RAISED' AND po.created_at < ${ackCutoff}::timestamptz)
      OR (po.status::text = 'ACKNOWLEDGED' AND po.acknowledged_at < ${dispatchCutoff}::timestamptz)`;
    const rows = await this.prisma.$queryRaw<
      Array<{ status: string; count: number; value: string; late: number; late_value: string }>
    >`
      SELECT po.status::text AS status,
             count(*)::int AS count,
             coalesce(sum(po.total_net), 0)::text AS value,
             count(*) FILTER (WHERE ${stuck})::int AS late,
             coalesce(sum(po.total_net) FILTER (WHERE ${stuck}), 0)::text AS late_value
        FROM procurement.purchase_order po
       GROUP BY po.status`;
    return rows.map((r) => ({
      status: r.status,
      count: r.count,
      value: r.value,
      late: r.late,
      lateValue: r.late_value,
    }));
  }

  private async attention(ackCutoff: Date, dispatchCutoff: Date): Promise<OpsPoAttention> {
    const [[unack], oldest, [undis], undispatchedVendors] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: number; value: string }>>`
        SELECT count(*)::int AS count, coalesce(sum(po.total_net), 0)::text AS value
          FROM procurement.purchase_order po
         WHERE po.status::text = 'RAISED' AND po.created_at < ${ackCutoff}::timestamptz`,
      this.prisma.$queryRaw<Array<{ po_number: string; vendor_org_id: string; created_at: Date }>>`
        SELECT po.po_number, po.vendor_org_id, po.created_at
          FROM procurement.purchase_order po
         WHERE po.status::text = 'RAISED' AND po.created_at < ${ackCutoff}::timestamptz
         ORDER BY po.created_at ASC, po.po_number ASC
         LIMIT 1`,
      this.prisma.$queryRaw<Array<{ count: number; value: string }>>`
        SELECT count(*)::int AS count, coalesce(sum(po.total_net), 0)::text AS value
          FROM procurement.purchase_order po
         WHERE po.status::text = 'ACKNOWLEDGED' AND po.acknowledged_at < ${dispatchCutoff}::timestamptz`,
      this.prisma.$queryRaw<Array<{ vendor_org_id: string }>>`
        SELECT DISTINCT po.vendor_org_id
          FROM procurement.purchase_order po
         WHERE po.status::text = 'ACKNOWLEDGED' AND po.acknowledged_at < ${dispatchCutoff}::timestamptz`,
    ]);

    const first = oldest[0];
    const names = await this.vendorNames([
      ...(first ? [first.vendor_org_id] : []),
      ...undispatchedVendors.map((v) => v.vendor_org_id),
    ]);

    return {
      unacknowledged: {
        count: unack?.count ?? 0,
        value: unack?.value ?? '0.00',
        oldest: first
          ? {
              poNumber: first.po_number,
              vendorLegalName: names.get(first.vendor_org_id) ?? null,
              raisedAt: first.created_at.toISOString(),
            }
          : null,
      },
      undispatched: {
        count: undis?.count ?? 0,
        value: undis?.value ?? '0.00',
        vendors: undispatchedVendors
          .map((v) => names.get(v.vendor_org_id) ?? 'A supply point no longer on the platform')
          .sort((a, b) => a.localeCompare(b)),
      },
    };
  }

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
