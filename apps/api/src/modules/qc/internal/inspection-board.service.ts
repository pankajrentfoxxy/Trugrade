import { Injectable } from '@nestjs/common';
import {
  boardSlice,
  type BoardEnvelope,
  type BoardFacetOption,
  type BoardQuery,
  type BoardViewCount,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';

/**
 * The inspections board — Stage 9's Supply › Inspections screen.
 *
 * **It opens on Unscheduled.** A visit nobody has assigned a technician to is a
 * vendor whose listing cannot go live and who is, right now, waiting on us. That
 * is the only view on this board where the next action is ours, so it is the one
 * the board opens on; everything else is watching work already in flight.
 *
 * Technician workload is on the same response as the page, for the same reason
 * the view counts are: assigning somebody a fourth visit on a day they already
 * have three is the mistake this screen exists to prevent, and a number fetched
 * separately is a number from a different moment.
 */

export interface InspectionRow {
  id: string;
  visitNumber: string;
  status: string;
  vendorOrgId: string;
  vendorName: string | null;
  technicianId: string | null;
  technicianName: string | null;
  scheduledDate: string | null;
  slotFrom: string | null;
  requestedAt: string;
  /** Days since the vendor asked. The number that says who has been waiting longest. */
  waitingDays: number;
  unitsRequested: number;
  unitsInspected: number;
  unitsPassed: number;
  unitsFailed: number;
  unitsGradeCorrected: number;
  listingIds: string[];
}

export interface TechnicianLoad {
  technicianId: string;
  name: string | null;
  /** Visits per day for the next fortnight, `YYYY-MM-DD` → count. */
  byDay: Record<string, number>;
  openVisits: number;
}

type Counts = Record<string, bigint | number>;
const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);

@Injectable()
export class InspectionBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  async visits(query: BoardQuery): Promise<BoardEnvelope<InspectionRow>> {
    const view = query.view ?? 'unscheduled';
    const like = query.q?.trim() ? `%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
    const technician = query.facet?.technician ?? null;
    const now = this.clock.now();

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE v.technician_id IS NULL
                                AND v.status::text IN ('REQUESTED', 'QUOTED')) AS unscheduled,
             count(*) FILTER (WHERE v.status::text IN ('SCHEDULED', 'TECH_ASSIGNED')) AS scheduled,
             count(*) FILTER (WHERE v.status::text IN ('IN_PROGRESS', 'EN_ROUTE')) AS onsite,
             count(*) FILTER (WHERE v.status::text = 'PARTIALLY_COMPLETED') AS partial,
             count(*) FILTER (WHERE v.status::text = 'COMPLETED') AS done
        FROM qc.qc_visit v
       WHERE (${like}::text IS NULL OR v.visit_number ILIKE ${like})
         AND (${technician}::uuid IS NULL OR v.technician_id = ${technician}::uuid)`;

    const views: BoardViewCount[] = [
      { key: 'unscheduled', label: 'Unscheduled', count: num(counts?.unscheduled) },
      { key: 'scheduled', label: 'Scheduled', count: num(counts?.scheduled) },
      { key: 'onsite', label: 'On site', count: num(counts?.onsite) },
      { key: 'partial', label: 'Partial', count: num(counts?.partial) },
      { key: 'done', label: 'Completed', count: num(counts?.done) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];

    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        visit_number: string;
        status: string;
        vendor_org_id: string;
        technician_id: string | null;
        scheduled_date: Date | null;
        slot_from: Date | null;
        requested_at: Date;
        units_requested: number;
        units_inspected: number | null;
        units_passed: number | null;
        units_failed: number | null;
        units_grade_corrected: number | null;
      }>
    >(
      `SELECT v.id, v.visit_number, v.status::text AS status, v.vendor_org_id, v.technician_id,
              v.scheduled_date, v.slot_from, v.requested_at, v.units_requested,
              v.units_inspected, v.units_passed, v.units_failed, v.units_grade_corrected
         FROM qc.qc_visit v
        WHERE ($1::text IS NULL OR v.visit_number ILIKE $1)
          AND ($2::uuid IS NULL OR v.technician_id = $2::uuid)
          AND ${VIEW_SQL[view] ?? 'TRUE'}
        -- Oldest request first on every view. The vendor who has waited longest
        -- is the one to serve next, and a board sorted by creation date descending
        -- buries them.
        ORDER BY v.requested_at ASC
        LIMIT $3 OFFSET $4`,
      like,
      technician,
      per,
      offset,
    );

    const vendors = await this.orgNames(rows.map((r) => r.vendor_org_id));
    const techs = await this.userNames(
      rows.map((r) => r.technician_id).filter((v): v is string => v !== null),
    );
    const listings = await this.listingsForVisits(rows.map((r) => r.id));

    return {
      rows: rows.map((r) => ({
        id: r.id,
        visitNumber: r.visit_number,
        status: r.status,
        vendorOrgId: r.vendor_org_id,
        vendorName: vendors.get(r.vendor_org_id) ?? null,
        technicianId: r.technician_id,
        technicianName: r.technician_id ? (techs.get(r.technician_id) ?? null) : null,
        scheduledDate: r.scheduled_date ? r.scheduled_date.toISOString().slice(0, 10) : null,
        slotFrom: r.slot_from ? r.slot_from.toISOString() : null,
        requestedAt: r.requested_at.toISOString(),
        waitingDays: Math.max(
          0,
          Math.floor((now.getTime() - r.requested_at.getTime()) / 86_400_000),
        ),
        unitsRequested: r.units_requested,
        unitsInspected: r.units_inspected ?? 0,
        unitsPassed: r.units_passed ?? 0,
        unitsFailed: r.units_failed ?? 0,
        unitsGradeCorrected: r.units_grade_corrected ?? 0,
        listingIds: listings.get(r.id) ?? [],
      })),
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: { technician: await this.technicianFacet() },
    };
  }

  /**
   * Who is free, and when.
   *
   * A fortnight forward only. A workload chart that runs to the horizon is a
   * chart nobody reads; the assignment decision is always about this week or
   * next, and `SchedulingService` refuses a day over capacity anyway — this is
   * what stops an operator reaching that refusal by surprise.
   */
  async workload(): Promise<TechnicianLoad[]> {
    const today = this.clock.now();
    const horizon = new Date(today.getTime() + 14 * 86_400_000);

    const techs = await this.prisma.$queryRaw<Array<{ id: string; user_id: string }>>`
      SELECT id, user_id FROM qc.qc_technician WHERE is_active = TRUE`;
    if (!techs.length) return [];

    const rows = await this.prisma.$queryRaw<
      Array<{ technician_id: string; day: Date; n: bigint }>
    >`
      SELECT technician_id, scheduled_date AS day, count(*)::bigint AS n
        FROM qc.qc_visit
       WHERE technician_id IS NOT NULL
         AND scheduled_date BETWEEN ${today}::date AND ${horizon}::date
         AND status::text NOT IN ('CANCELLED', 'COMPLETED')
       GROUP BY 1, 2`;

    const open = await this.prisma.$queryRaw<Array<{ technician_id: string; n: bigint }>>`
      SELECT technician_id, count(*)::bigint AS n
        FROM qc.qc_visit
       WHERE technician_id IS NOT NULL
         AND status::text IN ('SCHEDULED', 'TECH_ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
       GROUP BY 1`;

    const names = await this.userNames(techs.map((t) => t.user_id));
    const openBy = new Map(open.map((o) => [o.technician_id, num(o.n)]));

    return techs.map((tech) => {
      const byDay: Record<string, number> = {};
      for (const row of rows.filter((r) => r.technician_id === tech.id)) {
        byDay[row.day.toISOString().slice(0, 10)] = num(row.n);
      }
      return {
        technicianId: tech.id,
        name: names.get(tech.user_id) ?? null,
        byDay,
        openVisits: openBy.get(tech.id) ?? 0,
      };
    });
  }

  private async orgNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
      SELECT id, legal_name FROM identity.organization WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.legal_name]));
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  /** Which listings a visit is holding up. One statement, `listing` schema only. */
  private async listingsForVisits(visitIds: string[]): Promise<Map<string, string[]>> {
    if (!visitIds.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ qc_visit_id: string; id: string }>>`
      SELECT qc_visit_id, id FROM listing.listing
       WHERE qc_visit_id = ANY(${visitIds}::uuid[])`;
    const out = new Map<string, string[]>();
    for (const row of rows) {
      out.set(row.qc_visit_id, [...(out.get(row.qc_visit_id) ?? []), row.id]);
    }
    return out;
  }

  private async technicianFacet(): Promise<BoardFacetOption[]> {
    const counts = await this.prisma.$queryRaw<Array<{ technician_id: string; n: bigint }>>`
      SELECT technician_id, count(*) AS n FROM qc.qc_visit
       WHERE technician_id IS NOT NULL GROUP BY 1`;
    const techs = await this.prisma.$queryRaw<Array<{ id: string; user_id: string }>>`
      SELECT id, user_id FROM qc.qc_technician`;
    const byTech = new Map(techs.map((t) => [t.id, t.user_id]));
    const names = await this.userNames(techs.map((t) => t.user_id));
    return counts
      .map((c) => ({
        value: c.technician_id,
        label: names.get(byTech.get(c.technician_id) ?? '') ?? c.technician_id.slice(0, 8),
        count: num(c.n),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

const VIEW_SQL: Readonly<Record<string, string>> = Object.freeze({
  unscheduled: `v.technician_id IS NULL AND v.status::text IN ('REQUESTED', 'QUOTED')`,
  scheduled: `v.status::text IN ('SCHEDULED', 'TECH_ASSIGNED')`,
  onsite: `v.status::text IN ('IN_PROGRESS', 'EN_ROUTE')`,
  partial: `v.status::text = 'PARTIALLY_COMPLETED'`,
  done: `v.status::text = 'COMPLETED'`,
  all: 'TRUE',
});
