import { Injectable } from '@nestjs/common';
import type { Grade } from '@trugrade/contracts';
import { OrgScope } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';
import type { QcUnitOutcome, QcVisitStatus, VisitFeeBearer } from '../dto/qc.dto';

/**
 * The vendor's own QC visits, and nobody else's.
 *
 * **Why this exists rather than a caller-org branch in `QcConsoleService`.**
 * `board()` and `detail()` are the OPS console's queues: they take no principal,
 * apply no org predicate, and resolve a vendor NAME and a technician's real name
 * onto every row — correctly, because a QC manager's board spans every vendor.
 * Four vendor roles used to hold the `qc.visit.read` that guarded them, so any
 * vendor could open `GET /api/qc/visits/:id` on a competitor's visit and read
 * their manifest. The grants were removed (see the comment above `VENDOR_OWNER`
 * in `roles.ts`, and `qc-console-is-not-vendor-reachable.spec.ts`); adding an
 * `if (caller.orgId)` to the console query would have put the two audiences back
 * on one code path, where the next person to add a column has to work out which
 * half of the branch they are standing in.
 *
 * So the vendor's rows come from here, where the org predicate is not optional
 * and is not a parameter. 02_ARCHITECTURE §3.2 layer 3: a missing `where` in a
 * service must not be able to leak another org's rows, so it lives at this layer
 * and every controller above has nothing to forget.
 *
 * **Ownership is `qc_visit.vendor_org_id`**, which is NOT NULL — every visit has
 * exactly one answer to "whose is this", and it is written by the same INSERT
 * that raises the visit when a listing is submitted.
 *
 * **Every statement is single-schema.** A visit screen wants `qc`, `listing`,
 * `vendor`, `identity` and `catalog` facts at once and `no-cross-schema-join` is
 * an error, so the facts are fetched separately and joined in TypeScript. That
 * is the rule working rather than a workaround: the day `vendor` becomes its own
 * service this file turns four queries into four calls and nothing else.
 */

export interface VendorVisitRow {
  id: string;
  visitNumber: string;
  status: QcVisitStatus;
  facilityId: string;
  addressId: string;
  requestedAt: Date;
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  /** The employee code, never a name. See `VendorVisitsController`. */
  technicianCode: string | null;
  unitsRequested: number;
  unitsPresented: number | null;
  unitsInspected: number;
  unitsPassed: number;
  unitsGradeCorrected: number;
  unitsFailed: number;
  unitsAbsent: number;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  vendorSignoffAt: Date | null;
  vendorSignoffName: string | null;
  /** NUMERIC(14,2) as a string. `money()` at the boundary, never `Number()`. */
  visitFee: string;
  feeBearer: VisitFeeBearer;
  feeWaiverReason: string | null;
  rescheduleCount: number;
  cancellationReason: string | null;
  notes: string | null;
}

export interface VendorManifestRow {
  visitUnitId: string;
  unitId: string;
  sequenceNo: number | null;
  serialNumber: string;
  outcome: QcUnitOutcome;
  absentReason: string | null;
  qcReportId: string | null;
  completedAt: Date | null;
}

/**
 * One area the inspection actually marked down, with the number it marked down to.
 *
 * This is what makes a failed machine's row say *why*. 03_UX_SPEC §3B: "Every
 * failed unit states the measured reason — 'Battery health 71%, below the 80%
 * floor for grade A' — never 'failed inspection'." A verdict with no measurement
 * behind it is not something a vendor can argue with or act on, and arguing with
 * it is the whole point of the grade-correction window.
 */
export interface VendorFindingRow {
  reportId: string;
  area: string;
  score: number;
  maxScore: number;
}

/** One unit as the vendor declared it, for the manifest's "declared" column. */
export interface VendorUnitFacts {
  unitId: string;
  skuId: string;
  gradeDeclared: Grade | null;
}

/** What the site said it does on each weekday, plus the days it is shut. */
export interface FacilityCalendar {
  hours: Array<{
    dayOfWeek: number;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  }>;
  holidays: Array<{ date: string; reason: string | null }>;
}

type Raw = Record<string, unknown>;

/** A vendor's whole inspection history. The busiest seeded supply point has six. */
const LIMIT = 200;

@Injectable()
export class VendorVisitRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
  ) {}

  /**
   * The caller's visits, soonest-scheduled first, optionally one by id.
   *
   * A visit belonging to another vendor comes back as an empty result rather
   * than as a row the caller is then refused: they learn nothing about whether
   * the id names anything, which is the same answer a typo gets.
   *
   * DATE and TIME are read as `::text`. Prisma hands a bare `date` back as a
   * `Date` at UTC midnight and every business window here is Asia/Kolkata
   * (VR-160), so a visit scheduled on the 3rd would read as the 2nd to anybody
   * west of us.
   */
  async findForVendor(id: string | null = null): Promise<VendorVisitRow[]> {
    const orgId = this.requireVendorOrg();
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT v.id, v.visit_number, v.status, v.facility_id, v.address_id, v.requested_at,
             v.scheduled_date::text AS scheduled_date,
             v.slot_from::text AS slot_from, v.slot_to::text AS slot_to,
             t.employee_code,
             v.units_requested, v.units_presented, v.units_inspected, v.units_passed,
             v.units_grade_corrected, v.units_failed, v.units_absent,
             v.arrived_at, v.started_at, v.completed_at,
             v.vendor_signoff_at, v.vendor_signoff_name,
             v.visit_fee, v.fee_bearer, v.fee_waiver_reason,
             v.reschedule_count, v.cancellation_reason, v.notes
        FROM qc.qc_visit v
        LEFT JOIN qc.qc_technician t ON t.id = v.technician_id
       WHERE v.vendor_org_id = ${orgId}::uuid
         AND (${id}::uuid IS NULL OR v.id = ${id}::uuid)
       ORDER BY v.scheduled_date NULLS LAST, v.requested_at DESC
       LIMIT ${LIMIT}`;
    return rows.map(toVisit);
  }

  /**
   * The manifest, which is the list of serials a technician is coming for.
   *
   * Scoped by the same org predicate rather than by the visit id alone: a
   * manifest read that trusts an id the caller supplied is the leak the visit
   * read was closed for, one table further down.
   */
  async manifest(visitId: string): Promise<VendorManifestRow[]> {
    const orgId = this.requireVendorOrg();
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT vu.id, vu.unit_id, vu.sequence_no, vu.serial_number, vu.outcome,
             vu.absent_reason, vu.qc_report_id, vu.completed_at
        FROM qc.qc_visit_unit vu
        JOIN qc.qc_visit v ON v.id = vu.visit_id
       WHERE v.id = ${visitId}::uuid
         AND v.vendor_org_id = ${orgId}::uuid
       ORDER BY vu.sequence_no NULLS LAST, vu.serial_number`;
    return rows.map(toManifest);
  }

  /**
   * The areas an inspection marked down, per report.
   *
   * The verdict, grade, score, battery reading and seal come from
   * `QcService.inspectionsByReport` — the module's own published shape, already
   * built for `ordering` in T21 — rather than from a second query here. Two
   * implementations of "what did this report say" agree until the day they do
   * not, and the day they do not, one screen tells a vendor a machine passed and
   * another tells a buyer it did not.
   *
   * What that shape does not carry is *why*, so this adds it and nothing else.
   * Only `status <> 'PASS'` rows: an area that scored full marks is not a
   * finding, and a list of twelve areas of which two matter buries the two.
   */
  async findings(reportIds: readonly string[]): Promise<VendorFindingRow[]> {
    const ids = [...new Set(reportIds)];
    if (ids.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT qc_report_id, area, score, max_score
        FROM qc.qc_area_result
       WHERE qc_report_id = ANY(${ids}::text[]::uuid[])
         AND status <> 'PASS'
       ORDER BY score ASC, area`;
    return rows.map((r) => ({
      reportId: r.qc_report_id as string,
      area: r.area as string,
      // NUMERIC(5,2) and a genuine ratio out of `max_score`, not money.
      score: Number(r.score),
      maxScore: Number(r.max_score),
    }));
  }

  /**
   * What the vendor declared for each machine, from `listing`.
   *
   * A separate statement because `listing.unit` is another module's schema. The
   * org is re-asserted here too: these ids came off a manifest this caller owns,
   * and re-stating the predicate costs one index lookup and removes the need to
   * reason about whether the previous query was the scoped one.
   */
  async unitFacts(unitIds: readonly string[]): Promise<Map<string, VendorUnitFacts>> {
    const ids = [...new Set(unitIds)];
    if (ids.length === 0) return new Map();
    const orgId = this.requireVendorOrg();
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, sku_id, grade_declared
        FROM listing.unit
       WHERE id = ANY(${ids}::text[]::uuid[])
         AND vendor_org_id = ${orgId}::uuid`;
    return new Map(
      rows.map((r) => [
        r.id as string,
        {
          unitId: r.id as string,
          skuId: r.sku_id as string,
          gradeDeclared: (r.grade_declared as Grade | null) ?? null,
        },
      ]),
    );
  }

  /** The SKU code, as a separate statement: `catalog` is another schema again. */
  async skuCodes(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; sku_code: string }>>`
      SELECT id, sku_code FROM catalog.sku WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.sku_code]));
  }

  /**
   * The site's own address label. `identity`, and reached by `qc_visit.address_id`
   * rather than through `vendor.vendor_facility` — one hop instead of two, and
   * one schema instead of two.
   */
  async addressLabels(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, label, city, pincode FROM identity.org_address
       WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(
      rows.map((r) => [r.id as string, [r.label, r.city, r.pincode].filter(Boolean).join(' · ')]),
    );
  }

  /**
   * The opening hours and holidays that decide which days can be booked.
   *
   * 03_UX_SPEC §3B: "Facility hours drive QC visit scheduling — the screen states
   * that a closed day cannot be booked." So the screen has to be given the
   * calendar rather than left to discover it from a rejected date.
   *
   * `vendor.facility_hours` and `vendor.facility_holiday` are one schema, and
   * the facility is re-checked against the caller's org because a facility id is
   * as guessable as any other uuid.
   */
  async calendar(facilityId: string, fromDate: string): Promise<FacilityCalendar> {
    const orgId = this.requireVendorOrg();
    const hours = await this.prisma.$queryRaw<Raw[]>`
      SELECT h.day_of_week, h.open_time::text AS open_time, h.close_time::text AS close_time,
             h.is_closed
        FROM vendor.facility_hours h
        JOIN vendor.vendor_facility f ON f.id = h.facility_id
       WHERE f.id = ${facilityId}::uuid
         AND f.org_id = ${orgId}::uuid
       ORDER BY h.day_of_week`;
    const holidays = await this.prisma.$queryRaw<Raw[]>`
      SELECT d.holiday_date::text AS holiday_date, d.reason
        FROM vendor.facility_holiday d
        JOIN vendor.vendor_facility f ON f.id = d.facility_id
       WHERE f.id = ${facilityId}::uuid
         AND f.org_id = ${orgId}::uuid
         AND d.holiday_date >= ${fromDate}::date
       ORDER BY d.holiday_date
       LIMIT 40`;
    return {
      hours: hours.map((h) => ({
        dayOfWeek: h.day_of_week as number,
        openTime: (h.open_time as string | null) ?? null,
        closeTime: (h.close_time as string | null) ?? null,
        isClosed: h.is_closed as boolean,
      })),
      holidays: holidays.map((d) => ({
        date: d.holiday_date as string,
        reason: (d.reason as string | null) ?? null,
      })),
    };
  }

  /**
   * Platform staff have no org in context, and PLATFORM_SUPERADMIN holds every
   * permission — so the refusal is here rather than in the guard. "Your QC
   * visits" is not a question that has an answer without a vendor, and the ops
   * console has its own cross-vendor board for the other one.
   */
  private requireVendorOrg(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError('This screen is about one vendor, so one has to be signed in.', {
        reason: 'vendor_route_without_org',
      });
    }
    return orgId;
  }
}

function toVisit(r: Raw): VendorVisitRow {
  return {
    id: r.id as string,
    visitNumber: r.visit_number as string,
    status: r.status as QcVisitStatus,
    facilityId: r.facility_id as string,
    addressId: r.address_id as string,
    requestedAt: r.requested_at as Date,
    scheduledDate: (r.scheduled_date as string | null) ?? null,
    slotFrom: (r.slot_from as string | null) ?? null,
    slotTo: (r.slot_to as string | null) ?? null,
    technicianCode: (r.employee_code as string | null) ?? null,
    unitsRequested: r.units_requested as number,
    unitsPresented: (r.units_presented as number | null) ?? null,
    unitsInspected: r.units_inspected as number,
    unitsPassed: r.units_passed as number,
    unitsGradeCorrected: r.units_grade_corrected as number,
    unitsFailed: r.units_failed as number,
    unitsAbsent: r.units_absent as number,
    arrivedAt: (r.arrived_at as Date | null) ?? null,
    startedAt: (r.started_at as Date | null) ?? null,
    completedAt: (r.completed_at as Date | null) ?? null,
    vendorSignoffAt: (r.vendor_signoff_at as Date | null) ?? null,
    vendorSignoffName: (r.vendor_signoff_name as string | null) ?? null,
    // NUMERIC(14,2) arrives as a Decimal. `String()` here, `money()` at the
    // boundary above; `Number()` is the float bug the money path exists to stop.
    visitFee: String(r.visit_fee),
    feeBearer: r.fee_bearer as VisitFeeBearer,
    feeWaiverReason: (r.fee_waiver_reason as string | null) ?? null,
    rescheduleCount: r.reschedule_count as number,
    cancellationReason: (r.cancellation_reason as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

function toManifest(r: Raw): VendorManifestRow {
  return {
    visitUnitId: r.id as string,
    unitId: r.unit_id as string,
    sequenceNo: (r.sequence_no as number | null) ?? null,
    serialNumber: r.serial_number as string,
    outcome: r.outcome as QcUnitOutcome,
    absentReason: (r.absent_reason as string | null) ?? null,
    qcReportId: (r.qc_report_id as string | null) ?? null,
    completedAt: (r.completed_at as Date | null) ?? null,
  };
}
