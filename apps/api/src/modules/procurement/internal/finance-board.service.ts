import { Injectable } from '@nestjs/common';
import {
  boardSlice,
  boardSort,
  type BoardEnvelope,
  type BoardFacetOption,
  type BoardQuery,
  type BoardViewCount,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * The finance boards: payables and payout runs.
 *
 * **Payables open on Due now**, not on All. The question this screen exists to
 * answer is "what can we pay today", and a board that opens on every payable
 * ever accrued answers it by making somebody filter — which is the thing that
 * stops working the week there are four hundred of them.
 *
 * The deduction stack is read off each row rather than recomputed. `tds` is the
 * figure `computeTds` produced inside the transaction that raised that purchase
 * order, against that day's cumulative purchases and that day's configured
 * rate. Recomputing it on a screen produces a second number for the same
 * obligation, and this repository has already had to fix one of those.
 */

export interface PayableRow {
  id: string;
  vendorOrgId: string;
  vendorName: string | null;
  purchaseOrderId: string;
  poNumber: string | null;
  gross: string;
  tds: string;
  penalties: string;
  qcFee: string;
  netPayable: string;
  status: string;
  holdReason: string | null;
  eligibleAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PayoutRunRow {
  id: string;
  runNumber: string;
  cycle: string;
  status: string;
  totalNet: string;
  vendorCount: number;
  lines: number;
  createdBy: string | null;
  createdByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  releasedBy: string | null;
  createdAt: string;
  releasedAt: string | null;
}

type Counts = Record<string, bigint | number>;
const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class FinanceBoardService {
  constructor(private readonly prisma: PrismaService) {}

  async payables(query: BoardQuery): Promise<BoardEnvelope<PayableRow>> {
    const view = query.view ?? 'due';
    const like = likeOf(query.q);
    const vendor = query.facet?.vendor ?? null;

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE p.status::text = 'ACCRUED' AND p.hold_reason IS NULL
                                AND p.eligible_at IS NOT NULL AND p.eligible_at <= now()) AS due,
             count(*) FILTER (WHERE p.status::text = 'ACCRUED' AND p.hold_reason IS NULL
                                AND (p.eligible_at IS NULL OR p.eligible_at > now())) AS waiting,
             count(*) FILTER (WHERE p.hold_reason IS NOT NULL) AS held,
             count(*) FILTER (WHERE p.status::text = 'PAID') AS paid
        FROM procurement.vendor_payable p
       WHERE (${vendor}::uuid IS NULL OR p.vendor_org_id = ${vendor}::uuid)
         AND (${like}::text IS NULL OR p.id::text = ${query.q ?? null})`;

    const views: BoardViewCount[] = [
      { key: 'due', label: 'Due now', count: num(counts?.due) },
      { key: 'waiting', label: 'Return window', count: num(counts?.waiting) },
      { key: 'held', label: 'On hold', count: num(counts?.held) },
      { key: 'paid', label: 'Paid', count: num(counts?.paid) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);
    const sort = boardSort(PAYABLE_SORTS, 'created', query.sort, query.dir);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        vendor_org_id: string;
        purchase_order_id: string;
        gross: string;
        tds: string;
        penalties: string;
        qc_fee: string;
        net_payable: string;
        status: string;
        hold_reason: string | null;
        eligible_at: Date | null;
        paid_at: Date | null;
        created_at: Date;
      }>
    >(
      `SELECT p.id, p.vendor_org_id, p.purchase_order_id, p.gross::text AS gross,
              p.tds::text AS tds, p.penalties::text AS penalties, p.qc_fee::text AS qc_fee,
              p.net_payable::text AS net_payable, p.status::text AS status, p.hold_reason,
              p.eligible_at, p.paid_at, p.created_at
         FROM procurement.vendor_payable p
        WHERE ($1::uuid IS NULL OR p.vendor_org_id = $1::uuid)
          AND ($2::text IS NULL OR p.id::text = $3)
          AND ${PAYABLE_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY ${sort.column} ${sort.dir} NULLS LAST, p.id
        LIMIT $4 OFFSET $5`,
      vendor,
      like,
      query.q ?? null,
      per,
      offset,
    );

    const [sums] = await this.prisma.$queryRawUnsafe<Array<{ net: string; tds: string }>>(
      `SELECT coalesce(sum(p.net_payable), 0)::text AS net, coalesce(sum(p.tds), 0)::text AS tds
         FROM procurement.vendor_payable p
        WHERE ($1::uuid IS NULL OR p.vendor_org_id = $1::uuid)
          AND ${PAYABLE_VIEW_SQL[view] ?? 'TRUE'}`,
      vendor,
    );

    const vendors = await this.vendorNames(rows.map((r) => r.vendor_org_id));
    const pos = await this.poNumbers(rows.map((r) => r.purchase_order_id));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        vendorOrgId: r.vendor_org_id,
        vendorName: vendors.get(r.vendor_org_id) ?? null,
        purchaseOrderId: r.purchase_order_id,
        poNumber: pos.get(r.purchase_order_id) ?? null,
        gross: r.gross,
        tds: r.tds,
        penalties: r.penalties,
        qcFee: r.qc_fee,
        netPayable: r.net_payable,
        status: r.status,
        holdReason: r.hold_reason,
        eligibleAt: iso(r.eligible_at),
        paidAt: iso(r.paid_at),
        createdAt: r.created_at.toISOString(),
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: { vendor: await this.vendorFacet() },
      // Whole-board sums under the current view, not page sums: a page total on
      // a filtered board is a number nobody asked for and everybody misreads.
      totals: { net: sums?.net ?? '0', tds: sums?.tds ?? '0' },
    };
  }

  async payoutRuns(query: BoardQuery): Promise<BoardEnvelope<PayoutRunRow>> {
    const view = query.view ?? 'open';
    const like = likeOf(query.q);

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE r.status::text IN ('DRAFT','APPROVED','EXECUTING')) AS open,
             count(*) FILTER (WHERE r.status::text = 'DRAFT') AS draft,
             count(*) FILTER (WHERE r.status::text = 'COMPLETED') AS done
        FROM procurement.payout_run r
       WHERE (${like}::text IS NULL OR r.run_number ILIKE ${like})`;

    const views: BoardViewCount[] = [
      { key: 'open', label: 'Open', count: num(counts?.open) },
      { key: 'draft', label: 'Awaiting approval', count: num(counts?.draft) },
      { key: 'done', label: 'Completed', count: num(counts?.done) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];
    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        run_number: string;
        cycle: string;
        status: string;
        total_net: string;
        vendor_count: number;
        lines: bigint;
        created_by: string | null;
        approved_by: string | null;
        released_by: string | null;
        created_at: Date;
        released_at: Date | null;
      }>
    >(
      `SELECT r.id, r.run_number, r.cycle::text AS cycle, r.status::text AS status,
              r.total_net::text AS total_net, r.vendor_count,
              (SELECT count(*) FROM procurement.payout_line l WHERE l.run_id = r.id) AS lines,
              r.created_by, r.approved_by, r.released_by, r.created_at, r.released_at
         FROM procurement.payout_run r
        WHERE ($1::text IS NULL OR r.run_number ILIKE $1)
          AND ${RUN_VIEW_SQL[view] ?? 'TRUE'}
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3`,
      like,
      per,
      offset,
    );

    // Maker and checker by name: "who approved this" is the question an auditor
    // asks first, and a uuid is not an answer to it.
    const names = await this.userNames(
      rows.flatMap((r) => [r.created_by, r.approved_by].filter((v): v is string => v !== null)),
    );

    return {
      rows: rows.map((r) => ({
        id: r.id,
        runNumber: r.run_number,
        cycle: r.cycle,
        status: r.status,
        totalNet: r.total_net,
        vendorCount: r.vendor_count,
        lines: num(r.lines),
        createdBy: r.created_by,
        createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
        approvedBy: r.approved_by,
        approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
        releasedBy: r.released_by,
        createdAt: r.created_at.toISOString(),
        releasedAt: iso(r.released_at),
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: {},
    };
  }

  private async vendorNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
      SELECT id, legal_name FROM identity.organization WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.legal_name]));
  }

  private async vendorFacet(): Promise<BoardFacetOption[]> {
    const counts = await this.prisma.$queryRaw<Array<{ vendor_org_id: string; n: bigint }>>`
      SELECT vendor_org_id, count(*) AS n FROM procurement.vendor_payable GROUP BY 1`;
    const names = await this.vendorNames(counts.map((c) => c.vendor_org_id));
    return counts
      .map((c) => ({
        value: c.vendor_org_id,
        label: names.get(c.vendor_org_id) ?? c.vendor_org_id.slice(0, 8),
        count: num(c.n),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private async poNumbers(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; po_number: string }>>`
      SELECT id, po_number FROM procurement.purchase_order
       WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.po_number]));
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }
}

const likeOf = (q?: string): string | null =>
  q && q.trim() ? `%${q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;

const PAYABLE_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  due: `p.status::text = 'ACCRUED' AND p.hold_reason IS NULL AND p.eligible_at IS NOT NULL AND p.eligible_at <= now()`,
  waiting: `p.status::text = 'ACCRUED' AND p.hold_reason IS NULL AND (p.eligible_at IS NULL OR p.eligible_at > now())`,
  held: 'p.hold_reason IS NOT NULL',
  paid: `p.status::text = 'PAID'`,
  all: 'TRUE',
});

const RUN_VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  open: `r.status::text IN ('DRAFT','APPROVED','EXECUTING')`,
  draft: `r.status::text = 'DRAFT'`,
  done: `r.status::text = 'COMPLETED'`,
  all: 'TRUE',
});

const PAYABLE_SORTS = Object.freeze({
  created: 'p.created_at',
  eligible: 'p.eligible_at',
  net: 'p.net_payable',
  gross: 'p.gross',
});
