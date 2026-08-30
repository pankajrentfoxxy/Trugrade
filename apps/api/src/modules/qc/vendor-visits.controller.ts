import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { money, type Grade } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { NotFoundError } from '../../shared/errors/domain-errors';
import { ZodValidationPipe } from '../../shared/http/http';
import { QcService, type UnitInspection } from './qc.service';
import { VISIT_TRANSITIONS } from './internal/scheduling.service';
import { SchedulingService } from './internal/scheduling.service';
import { cfgNum, readConfig } from './internal/tolerance.service';
import {
  VendorVisitRepository,
  type FacilityCalendar,
  type VendorVisitRow,
} from './internal/vendor-visit.repository';
import {
  uuidSchema,
  vendorVisitCancelSchema,
  type QcUnitOutcome,
  type QcVisitStatus,
  type VendorVisitCancelDto,
  type VisitFeeBearer,
} from './dto/qc.dto';

/**
 * The vendor's side of an inspection — the visit they asked for, the day it is
 * booked, and what we found.
 *
 * **This is not the QC console's board and must never become it.**
 * `GET /api/qc/visits` and `/qc/visits/:id` span every vendor by design: they
 * take no principal, apply no org predicate, and resolve a vendor's legal name
 * and a technician's real name onto every row. Four vendor roles used to hold
 * the `qc.visit.read` that guarded them, which meant any vendor could open a
 * competitor's visit by id and read their serials. Those grants were removed
 * (see the comment above `VENDOR_OWNER` in `roles.ts`), and
 * `qc-console-is-not-vendor-reachable.spec.ts` fails if either comes back.
 *
 * So the vendor gets its own routes, over `VendorVisitRepository`, where the
 * caller's org is a `WHERE` clause rather than an argument any caller could
 * forget. Every payload below is assembled field by field.
 *
 * **The permissions are ones the vendor already holds.** Reading what we found
 * on your own machines is reading your own stock: `listing.own.read`. Calling
 * off an inspection of your own stock is `listing.own.write`, which VENDOR_OWNER,
 * VENDOR_ADMIN and VENDOR_OPS hold and VENDOR_FINANCE and VENDOR_VIEWER do not —
 * which is exactly §3B's "VENDOR_OPS+". Nothing here needs a `qc.*` grant, and
 * that matters: a vendor token must carry none at all.
 *
 * ## Three things this deliberately does not send
 *
 * **The technician's name.** §3B: "The technician is identified as `TECH-0142`,
 * not by name, until arrival." Only `qc_technician.employee_code` crosses the
 * wire, at any status — a name that appears on arrival would need the screen to
 * hold both, and the visit record has no use for one.
 *
 * **A verdict where there is no report.** `result` is `null` until a report
 * exists, and every field inside it is independently nullable. A machine nobody
 * has opened has no score, and a zero score is a measurement.
 *
 * **A bare zero fee.** See `feeView()`.
 */

/** `platform_config`, effective-dated. The batch above which we stop charging. */
const FEE_WAIVED_ABOVE_KEY = 'qc.visit_fee_waived_above';
/** The standard charge, so the screen can say what was waived rather than that it was. */
const FEE_STANDARD_KEY = 'qc.visit_fee_inr';

/**
 * The visit fee, with everything needed to explain it and nothing needed to
 * compute it twice.
 *
 * A visit fee is money a vendor may owe, so `₹0` on its own is the one rendering
 * that is never acceptable: it reads as "nothing to pay" whether the truth is
 * "we are bearing it", "your batch was big enough" or "nobody has priced this
 * yet", and those are three different conversations. The fields below let the
 * screen say which, and `waivedAboveUnits` is `null` — not zero — when the key
 * could not be read, because "we cannot tell you the threshold" is not "there is
 * no threshold".
 */
export interface VisitFeeView {
  /** `qc_visit.visit_fee`, as recorded. A decimal string, never a number. */
  amount: string;
  bearer: VisitFeeBearer;
  waiverReason: string | null;
  waivedAboveUnits: number | null;
  standardFee: string | null;
}

export interface VendorVisitView {
  id: string;
  visitNumber: string;
  status: QcVisitStatus;
  /** The vendor's own address label. Their site, so their words. */
  siteLabel: string;
  requestedAt: string;
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  /** `TECH-0142`, never a name. */
  technicianCode: string | null;
  unitsRequested: number;
  unitsPresented: number | null;
  unitsInspected: number;
  unitsPassed: number;
  unitsGradeCorrected: number;
  unitsFailed: number;
  unitsAbsent: number;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  vendorSignoffAt: string | null;
  vendorSignoffName: string | null;
  rescheduleCount: number;
  cancellationReason: string | null;
  notes: string | null;
  fee: VisitFeeView;
  /**
   * Whether calling it off is still a legal move, decided from the same
   * transition map `SchedulingService` enforces rather than from a second copy
   * of it. A screen that offers a button the service will refuse is a screen
   * that lies twice — once by offering and once by failing.
   */
  cancellable: boolean;
}

/** One machine on the manifest, with what happened to it if anything has. */
export interface VendorManifestUnitView {
  visitUnitId: string;
  unitId: string;
  sequenceNo: number | null;
  serialNumber: string;
  /** Empty when the catalog entry could not be read. The screen says so. */
  skuCode: string;
  gradeDeclared: Grade | null;
  outcome: QcUnitOutcome;
  absentReason: string | null;
  /** `null` means not inspected. It never means a zero score or a pass. */
  result: VendorUnitResultView | null;
}

export interface VendorUnitResultView {
  verdict: string | null;
  /** `grade_final` — our claim. Neutral: A+, A and B are all sellable. */
  grade: Grade | null;
  qcScore: number | null;
  inspectedOn: string | null;
  batteryHealthPct: number | null;
  seal: { code: string; status: string } | null;
  /** The areas marked down, worst first. What "failed" actually means here. */
  findings: Array<{ area: string; score: number; maxScore: number }>;
}

/**
 * The site's calendar, sent with the visit rather than discovered by a rejection.
 *
 * §3B: "Facility hours drive QC visit scheduling and pickup windows — the screen
 * states that a closed day cannot be booked." `SchedulingService.assertSiteOpen`
 * already refuses a holiday and a closed weekday; a vendor learning that from a
 * 412 after choosing a date has been told the rule by being tripped over it.
 *
 * `hours` empty means the site never published a calendar, which the scheduler
 * treats as "no constraint recorded" rather than "closed" — so the screen has to
 * say that too, and not draw an empty week as a shut warehouse.
 */
export interface VendorVisitDetailView extends VendorVisitView {
  manifest: VendorManifestUnitView[];
  calendar: FacilityCalendar;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

@Controller('vendor/qc')
export class VendorVisitsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: VendorVisitRepository,
    private readonly qc: QcService,
    private readonly scheduling: SchedulingService,
  ) {}

  @Get('visits')
  @RequirePermissions('listing.own.read')
  async list(): Promise<VendorVisitView[]> {
    const rows = await this.repo.findForVendor();
    return this.rowsToViews(rows);
  }

  @Get('visits/:id')
  @RequirePermissions('listing.own.read')
  async one(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<VendorVisitDetailView> {
    const [row] = await this.repo.findForVendor(id);
    // 404 and not 403, for the reason T17 gives about order numbers: a 403
    // confirms the id names a real visit belonging to somebody, and whose
    // machines we are inspecting this week is a fact about a competitor.
    if (!row) throw new NotFoundError('qc_visit', { visitId: id });

    const [view] = await this.rowsToViews([row]);
    const [manifest, calendar] = await Promise.all([
      this.manifestView(id),
      this.repo.calendar(row.facilityId, this.clock.todayInIst()),
    ]);
    return { ...view!, manifest, calendar };
  }

  /**
   * Call it off.
   *
   * Ownership is established here, before `SchedulingService` is reached:
   * `advance()` deliberately takes no principal — it is also the QC manager's
   * and the technician app's path — and putting a session check inside it would
   * make two callers that have no session pass a fake one. So the row is fetched
   * through the org-scoped repository first, and a visit at another vendor's
   * warehouse is simply not there.
   *
   * The reason is required by `advance()` and that requirement is right: a
   * cancellation with no reason is a row nobody can explain to the technician
   * whose day it was, or to the vendor when the fee is discussed.
   *
   * 200 rather than 204: the screen needs the visit back to show what the
   * cancellation did to the fee, and re-reading through the scoped query means
   * what it shows is what the database holds rather than what we hoped.
   */
  @Post('visits/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('listing.own.write')
  async cancel(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(vendorVisitCancelSchema)) body: VendorVisitCancelDto,
  ): Promise<VendorVisitDetailView> {
    const [mine] = await this.repo.findForVendor(id);
    if (!mine) throw new NotFoundError('qc_visit', { visitId: id });

    await this.scheduling.advance(id, 'CANCELLED', { reason: body.reason });
    return this.one(id);
  }

  // -------------------------------------------------------------------------

  private async rowsToViews(rows: readonly VendorVisitRow[]): Promise<VendorVisitView[]> {
    if (rows.length === 0) return [];
    const [labels, fee] = await Promise.all([
      this.repo.addressLabels(rows.map((r) => r.addressId)),
      this.feeConfig(),
    ]);

    return rows.map((r) => ({
      id: r.id,
      visitNumber: r.visitNumber,
      status: r.status,
      // Not "Unknown site" quietly standing in for an address: an address that
      // has gone missing is a fact the screen says out loud.
      siteLabel: labels.get(r.addressId) ?? '',
      requestedAt: r.requestedAt.toISOString(),
      scheduledDate: r.scheduledDate,
      slotFrom: r.slotFrom,
      slotTo: r.slotTo,
      technicianCode: r.technicianCode,
      unitsRequested: r.unitsRequested,
      unitsPresented: r.unitsPresented,
      unitsInspected: r.unitsInspected,
      unitsPassed: r.unitsPassed,
      unitsGradeCorrected: r.unitsGradeCorrected,
      unitsFailed: r.unitsFailed,
      unitsAbsent: r.unitsAbsent,
      arrivedAt: iso(r.arrivedAt),
      startedAt: iso(r.startedAt),
      completedAt: iso(r.completedAt),
      vendorSignoffAt: iso(r.vendorSignoffAt),
      vendorSignoffName: r.vendorSignoffName,
      rescheduleCount: r.rescheduleCount,
      cancellationReason: r.cancellationReason,
      notes: r.notes,
      fee: {
        amount: money(r.visitFee).toJSON(),
        bearer: r.feeBearer,
        waiverReason: r.feeWaiverReason,
        waivedAboveUnits: fee.waivedAboveUnits,
        standardFee: fee.standardFee,
      },
      cancellable: VISIT_TRANSITIONS[r.status].includes('CANCELLED'),
    }));
  }

  private async manifestView(visitId: string): Promise<VendorManifestUnitView[]> {
    const rows = await this.repo.manifest(visitId);
    if (rows.length === 0) return [];

    const units = await this.repo.unitFacts(rows.map((r) => r.unitId));
    const [skus, inspections, findings] = await Promise.all([
      this.repo.skuCodes([...units.values()].map((u) => u.skuId)),
      // The module's own published shape, built for `ordering` in T21. A second
      // query answering "what did this report say" is a second answer.
      this.qc.inspectionsByReport(rows.flatMap((r) => (r.qcReportId ? [r.qcReportId] : []))),
      this.repo.findings(rows.flatMap((r) => (r.qcReportId ? [r.qcReportId] : []))),
    ]);

    const byReport = new Map<string, UnitInspection>(inspections.map((i) => [i.reportId, i]));

    return rows.map((r) => {
      const unit = units.get(r.unitId);
      const inspection = r.qcReportId ? byReport.get(r.qcReportId) : undefined;
      return {
        visitUnitId: r.visitUnitId,
        unitId: r.unitId,
        sequenceNo: r.sequenceNo,
        serialNumber: r.serialNumber,
        skuCode: unit ? (skus.get(unit.skuId) ?? '') : '',
        gradeDeclared: unit?.gradeDeclared ?? null,
        outcome: r.outcome,
        absentReason: r.absentReason,
        result: inspection
          ? {
              verdict: inspection.verdict,
              grade: inspection.grade,
              qcScore: inspection.qcScore,
              inspectedOn: inspection.inspectedOn,
              batteryHealthPct: inspection.batteryHealthPct,
              seal: inspection.seal,
              findings: findings
                .filter((f) => f.reportId === r.qcReportId)
                .map((f) => ({ area: f.area, score: f.score, maxScore: f.maxScore })),
            }
          : null,
      };
    });
  }

  /**
   * The two configured numbers behind the fee.
   *
   * `cfgNum` throws a 412 on a key that is missing or not a number, which is the
   * right answer for a job that must not guess and the wrong one for a screen —
   * it would take the whole visit board down over a footnote. A threshold we
   * cannot read is reported as unmeasured, never as zero, which would paint
   * every batch as too small to qualify.
   */
  private async feeConfig(): Promise<{
    waivedAboveUnits: number | null;
    standardFee: string | null;
  }> {
    const cfg = await readConfig(this.prisma, [FEE_WAIVED_ABOVE_KEY, FEE_STANDARD_KEY]);
    const read = (key: string): number | null => {
      try {
        return cfgNum(cfg, key);
      } catch {
        return null;
      }
    };
    const standard = read(FEE_STANDARD_KEY);
    return {
      waivedAboveUnits: read(FEE_WAIVED_ABOVE_KEY),
      standardFee: standard === null ? null : money(standard).toJSON(),
    };
  }
}
