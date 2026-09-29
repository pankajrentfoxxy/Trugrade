import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
 * **The attention strip is counted over every open visit, not the page.** Which
 * visits are overdue, which have nobody assigned, and which could be one trip
 * are facts about the whole queue; a strip built from the page's rows would
 * change its mind when the reader changed the filter.
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
  /**
   * Days past `scheduledDate` for a visit that is still open, on the server's
   * calendar. Zero on the day itself; null when not scheduled or already closed.
   */
  daysOverdue: number | null;
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

/** What the queue needs somebody to do, counted over every open visit. */
export interface InspectionAttention {
  /** Scheduled or on site, with a date that has passed. */
  overdue: {
    count: number;
    /** How many of the board's scheduled+on-site visits that is. */
    ofOpen: number;
    machines: number;
    machinesInspected: number;
    /** `YYYY-MM-DD` — the earliest and latest date among them. */
    from: string | null;
    to: string | null;
  };
  /** Open visits with no technician on them. */
  unassigned: { count: number; oldest: InspectionRow | null };
  /** The supply point with the most open visits, when it has more than one. */
  cluster: { vendorName: string; visits: number; machines: number } | null;
  /** The technician carrying the most open machines, when there is one. */
  load: { technicianName: string; visits: number; machines: number } | null;
}

export interface InspectionBoard extends BoardEnvelope<InspectionRow> {
  /** Overdue visits per view key, for the badge on the chip. */
  late: Record<string, number>;
  /** Under the current view and filters: machines still to be inspected. */
  totals: { machinesWaiting: number };
  attention: InspectionAttention;
}

export interface InspectionQuery extends BoardQuery {
  /** `facet.late=1` — only visits whose scheduled date has passed. */
  late?: boolean;
}

type Counts = Record<string, bigint | number>;
const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/** The unassigned option's facet value. Not a uuid, so it is handled by name. */
const UNASSIGNED = 'none';

const OPEN_STATUSES = ['REQUESTED', 'QUOTED', 'SCHEDULED', 'TECH_ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'];
const DATED_STATUSES = ['SCHEDULED', 'TECH_ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'];

interface RawVisit {
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
}

const VISIT_COLUMNS = Prisma.sql`
  v.id, v.visit_number, v.status::text AS status, v.vendor_org_id, v.technician_id,
  v.scheduled_date, v.slot_from, v.requested_at, v.units_requested,
  v.units_inspected, v.units_passed, v.units_failed, v.units_grade_corrected`;

@Injectable()
export class InspectionBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  async visits(query: InspectionQuery): Promise<InspectionBoard> {
    const view = query.view ?? 'unscheduled';
    const like = query.q?.trim() ? `%${query.q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
    const technician = query.facet?.technician ?? null;
    const techId = technician && technician !== UNASSIGNED ? technician : null;
    const unassignedOnly = technician === UNASSIGNED;
    const lateOnly = query.late === true || query.facet?.late === '1';
    const now = this.clock.now();
    const today = this.clock.todayInIst();

    // A supply point's name lives in `identity`; matched there first and handed
    // to this schema's query as ids.
    const vendorIds = like === null ? [] : await this.vendorsMatching(like);

    const filters = Prisma.sql`(${like}::text IS NULL
           OR v.visit_number ILIKE ${like}
           OR v.vendor_org_id = ANY(${vendorIds}::uuid[]))
      AND (${techId}::uuid IS NULL OR v.technician_id = ${techId}::uuid)
      AND (NOT ${unassignedOnly}::boolean OR v.technician_id IS NULL)
      AND (NOT ${lateOnly}::boolean
           OR (v.scheduled_date < ${today}::date AND v.status::text = ANY(${DATED_STATUSES}::text[])))`;

    const [counts] = await this.prisma.$queryRaw<Counts[]>`
      SELECT count(*) AS all_rows,
             count(*) FILTER (WHERE v.technician_id IS NULL
                                AND v.status::text IN ('REQUESTED', 'QUOTED')) AS unscheduled,
             count(*) FILTER (WHERE v.status::text IN ('SCHEDULED', 'TECH_ASSIGNED')) AS scheduled,
             count(*) FILTER (WHERE v.status::text IN ('IN_PROGRESS', 'EN_ROUTE')) AS onsite,
             count(*) FILTER (WHERE v.status::text = 'PARTIALLY_COMPLETED') AS partial,
             count(*) FILTER (WHERE v.status::text = 'COMPLETED') AS done,
             count(*) FILTER (WHERE v.status::text IN ('SCHEDULED', 'TECH_ASSIGNED')
                                AND v.scheduled_date < ${today}::date) AS scheduled_late,
             count(*) FILTER (WHERE v.status::text IN ('IN_PROGRESS', 'EN_ROUTE')
                                AND v.scheduled_date < ${today}::date) AS onsite_late
        FROM qc.qc_visit v
       WHERE ${filters}`;

    const views: BoardViewCount[] = [
      { key: 'unscheduled', label: 'Unscheduled', count: num(counts?.unscheduled) },
      { key: 'scheduled', label: 'Scheduled', count: num(counts?.scheduled) },
      { key: 'onsite', label: 'On site', count: num(counts?.onsite) },
      { key: 'partial', label: 'Partly done', count: num(counts?.partial) },
      { key: 'done', label: 'Completed', count: num(counts?.done) },
      { key: 'all', label: 'All', count: num(counts?.all_rows) },
    ];
    const late: Record<string, number> = {
      scheduled: num(counts?.scheduled_late),
      onsite: num(counts?.onsite_late),
      all: num(counts?.scheduled_late) + num(counts?.onsite_late),
    };

    const total = views.find((v) => v.key === view)?.count ?? num(counts?.all_rows);
    const { page, per, pages, offset } = boardSlice(total, query.page, query.per);
    const viewSql = Prisma.raw(VIEW_SQL[view] ?? 'TRUE');

    const [rows, [waiting]] = await Promise.all([
      this.prisma.$queryRaw<RawVisit[]>`
        SELECT ${VISIT_COLUMNS}
          FROM qc.qc_visit v
         WHERE ${filters} AND ${viewSql}
         -- Oldest request first on every view. The vendor who has waited longest
         -- is the one to serve next, and a board sorted by creation date descending
         -- buries them.
         ORDER BY v.requested_at ASC
         LIMIT ${per} OFFSET ${offset}`,
      this.prisma.$queryRaw<Array<{ machines: number }>>`
        SELECT coalesce(sum(GREATEST(v.units_requested - coalesce(v.units_inspected, 0), 0)), 0)::int AS machines
          FROM qc.qc_visit v
         WHERE ${filters} AND ${viewSql}
           AND v.status::text = ANY(${OPEN_STATUSES}::text[])`,
    ]);

    const [mapped, attention, technicianFacet] = await Promise.all([
      this.toRows(rows, now, today),
      this.attention(now, today),
      this.technicianFacet(),
    ]);

    return {
      rows: mapped,
      page,
      per,
      total,
      pages,
      grandTotal: num(counts?.all_rows),
      views,
      facets: { technician: technicianFacet },
      late,
      totals: { machinesWaiting: waiting?.machines ?? 0 },
      attention,
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

  /* ---------------------------------------------------------------------- */

  private async toRows(rows: RawVisit[], now: Date, today: string): Promise<InspectionRow[]> {
    const vendors = await this.orgNames(rows.map((r) => r.vendor_org_id));
    const techs = await this.technicianNames(
      rows.map((r) => r.technician_id).filter((v): v is string => v !== null),
    );
    const listings = await this.listingsForVisits(rows.map((r) => r.id));
    const todayMs = Date.parse(`${today}T00:00:00Z`);

    return rows.map((r) => {
      const scheduled = r.scheduled_date ? r.scheduled_date.toISOString().slice(0, 10) : null;
      const open = DATED_STATUSES.includes(r.status);
      const overdue =
        scheduled && open
          ? Math.floor((todayMs - Date.parse(`${scheduled}T00:00:00Z`)) / 86_400_000)
          : null;
      return {
        id: r.id,
        visitNumber: r.visit_number,
        status: r.status,
        vendorOrgId: r.vendor_org_id,
        vendorName: vendors.get(r.vendor_org_id) ?? null,
        technicianId: r.technician_id,
        technicianName: r.technician_id ? (techs.get(r.technician_id) ?? null) : null,
        scheduledDate: scheduled,
        slotFrom: r.slot_from ? r.slot_from.toISOString() : null,
        requestedAt: r.requested_at.toISOString(),
        waitingDays: Math.max(
          0,
          Math.floor((now.getTime() - r.requested_at.getTime()) / 86_400_000),
        ),
        daysOverdue: overdue !== null && overdue > 0 ? overdue : overdue === 0 ? 0 : null,
        unitsRequested: r.units_requested,
        unitsInspected: r.units_inspected ?? 0,
        unitsPassed: r.units_passed ?? 0,
        unitsFailed: r.units_failed ?? 0,
        unitsGradeCorrected: r.units_grade_corrected ?? 0,
        listingIds: listings.get(r.id) ?? [],
      };
    });
  }

  /**
   * The strip, over every open visit.
   *
   * Four statements, one instant, all unfiltered: the overdue set with its date
   * range, the unassigned set with its oldest member as a full row (so the
   * screen can open it straight into the assignment dialog), and the two
   * clusters — the supply point with the most open visits and the technician
   * holding the most open machines.
   */
  private async attention(now: Date, today: string): Promise<InspectionAttention> {
    const [[overdue], oldest, [cluster], [load]] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ count: number; of_open: number; machines: number; inspected: number; from: Date | null; to: Date | null }>
      >`
        SELECT count(*) FILTER (WHERE v.scheduled_date < ${today}::date)::int AS count,
               count(*)::int AS of_open,
               coalesce(sum(v.units_requested) FILTER (WHERE v.scheduled_date < ${today}::date), 0)::int AS machines,
               coalesce(sum(coalesce(v.units_inspected, 0)) FILTER (WHERE v.scheduled_date < ${today}::date), 0)::int AS inspected,
               min(v.scheduled_date) FILTER (WHERE v.scheduled_date < ${today}::date) AS from,
               max(v.scheduled_date) FILTER (WHERE v.scheduled_date < ${today}::date) AS to
          FROM qc.qc_visit v
         WHERE v.status::text = ANY(${DATED_STATUSES}::text[])`,
      this.prisma.$queryRaw<RawVisit[]>`
        SELECT ${VISIT_COLUMNS}
          FROM qc.qc_visit v
         WHERE v.technician_id IS NULL AND v.status::text = ANY(${OPEN_STATUSES}::text[])
         ORDER BY v.requested_at ASC
         LIMIT 1`,
      this.prisma.$queryRaw<Array<{ vendor_org_id: string; visits: number; machines: number }>>`
        SELECT v.vendor_org_id, count(*)::int AS visits, coalesce(sum(v.units_requested), 0)::int AS machines
          FROM qc.qc_visit v
         WHERE v.status::text = ANY(${OPEN_STATUSES}::text[])
         GROUP BY v.vendor_org_id
        HAVING count(*) > 1
         ORDER BY count(*) DESC, sum(v.units_requested) DESC
         LIMIT 1`,
      this.prisma.$queryRaw<Array<{ technician_id: string; visits: number; machines: number }>>`
        SELECT v.technician_id, count(*)::int AS visits, coalesce(sum(v.units_requested), 0)::int AS machines
          FROM qc.qc_visit v
         WHERE v.technician_id IS NOT NULL AND v.status::text = ANY(${OPEN_STATUSES}::text[])
         GROUP BY v.technician_id
         ORDER BY sum(v.units_requested) DESC, count(*) DESC
         LIMIT 1`,
    ]);

    const [unassignedCount] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM qc.qc_visit v
       WHERE v.technician_id IS NULL AND v.status::text = ANY(${OPEN_STATUSES}::text[])`;

    const [oldestRow] = oldest.length ? await this.toRows(oldest, now, today) : [];
    const vendorName = cluster ? (await this.orgNames([cluster.vendor_org_id])).get(cluster.vendor_org_id) : null;
    const techName = load ? (await this.technicianNames([load.technician_id])).get(load.technician_id) : null;

    return {
      overdue: {
        count: overdue?.count ?? 0,
        ofOpen: overdue?.of_open ?? 0,
        machines: overdue?.machines ?? 0,
        machinesInspected: overdue?.inspected ?? 0,
        from: overdue?.from ? overdue.from.toISOString().slice(0, 10) : null,
        to: overdue?.to ? overdue.to.toISOString().slice(0, 10) : null,
      },
      unassigned: { count: unassignedCount?.n ?? 0, oldest: oldestRow ?? null },
      cluster:
        cluster && vendorName
          ? { vendorName, visits: cluster.visits, machines: cluster.machines }
          : null,
      load: load && techName ? { technicianName: techName, visits: load.visits, machines: load.machines } : null,
    };
  }

  /** Legal name → org ids. `identity` only. */
  private async vendorsMatching(like: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.organization WHERE legal_name ILIKE ${like} LIMIT 200`;
    return rows.map((r) => r.id);
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

  /**
   * Technician id -> the person's name.
   *
   * `qc_visit.technician_id` is a `qc.qc_technician.id`, not a user id. Looked
   * up straight in `identity.user_account` it matched nothing, so every assigned
   * visit came back `technicianName: null` and the board printed "Unassigned"
   * against a row whose status already said the technician was booked. The hop
   * through `qc_technician.user_id` is the one `technicianFacet()` has always
   * made. A technician whose account has no name still has an employee code,
   * and a code beats a blank that reads as nobody.
   */
  private async technicianNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const techs = await this.prisma.$queryRaw<
      Array<{ id: string; user_id: string; employee_code: string }>
    >`
      SELECT id, user_id, employee_code FROM qc.qc_technician
       WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    const names = await this.userNames(techs.map((t) => t.user_id));
    return new Map(techs.map((t) => [t.id, names.get(t.user_id) ?? t.employee_code]));
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

  /** Every technician with visits, then the one option that is not a person. */
  private async technicianFacet(): Promise<BoardFacetOption[]> {
    const counts = await this.prisma.$queryRaw<Array<{ technician_id: string | null; n: bigint }>>`
      SELECT technician_id, count(*) AS n FROM qc.qc_visit GROUP BY 1`;
    const techs = await this.prisma.$queryRaw<Array<{ id: string; user_id: string }>>`
      SELECT id, user_id FROM qc.qc_technician`;
    const byTech = new Map(techs.map((t) => [t.id, t.user_id]));
    const names = await this.userNames(techs.map((t) => t.user_id));
    const people = counts
      .filter((c): c is { technician_id: string; n: bigint } => c.technician_id !== null)
      .map((c) => ({
        value: c.technician_id,
        label: names.get(byTech.get(c.technician_id) ?? '') ?? c.technician_id.slice(0, 8),
        count: num(c.n),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const nobody = counts.find((c) => c.technician_id === null);
    return [...people, { value: UNASSIGNED, label: 'Unassigned', count: num(nobody?.n) }];
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
