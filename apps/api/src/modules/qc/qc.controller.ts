import { createHash, randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { checkUpload, money, type Grade } from '@trugrade/contracts';
import { CurrentUser, RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../shared/errors/domain-errors';
import { PrismaService } from '../../shared/db/prisma.service';
import type { Principal } from '../../shared/db/org-scope';
import { ClockPort } from '../../shared/clock';
import { ObjectStorePort } from '../../shared/adapters/ports';
import {
  NonceReplayError,
  QcRepository,
  type QcTechnicianRow,
  type QcVisitRow,
  type QcVisitUnitRow,
} from './internal/qc.repository';
import { SchedulingService } from './internal/scheduling.service';
import { VisitClosingService } from './internal/visit-closing.service';
import { SealingService } from './internal/sealing.service';
import { AuditRecheckService } from './internal/audit-recheck.service';
import { GradeCorrectionService } from './internal/grade-correction.service';
import { ToleranceService, cfgBool, cfgNum, istDate, readConfig } from './internal/tolerance.service';
import { VerdictService } from './internal/verdict.service';
import {
  QC_PHOTO_ANGLES,
  applySealSchema,
  absentSchema,
  auditRecheckSchema,
  checkInSchema,
  createVisitSchema,
  disputeRulingSchema,
  expenseSchema,
  fieldMapSchema,
  manualReportSchema,
  photoSignSchema,
  routeQuerySchema,
  samplingRuleSchema,
  scheduleQuerySchema,
  signoffSchema,
  unitResultSchema,
  untestableSchema,
  uuidSchema,
  visitBoardQuerySchema,
  type AbsentDto,
  type ApplySealDto,
  type AuditRecheckDto,
  type CheckInDto,
  type CreateVisitDto,
  type DisputeRulingDto,
  type ExpenseDto,
  type FieldMapDto,
  type ManualReportDto,
  type PhotoSignDto,
  type QcAreaCode,
  type QcPhotoAngle,
  type QcUnitOutcome,
  type QcVerdictValue,
  type QcVisitStatus,
  type RouteQueryDto,
  type SamplingRuleDto,
  type ScheduleQueryDto,
  type SignoffDto,
  type UnitResultDto,
  type UntestableDto,
  type VisitBoardQueryDto,
} from './dto/qc.dto';

/**
 * The QC console's whole API, and the technician app's.
 *
 * `apps/console/src/routes/qc/*` and `apps/technician/src/api/routes.ts` were
 * both written against endpoints that did not exist; those two files are the
 * contract here, down to the spelling of `check-in` and `uphold-dispute`, and
 * where this file and a phase document disagreed the client won.
 *
 * Four things govern every handler below.
 *
 *   1. **Staff-facing, so vendor identity is not redacted.** VR-099 governs
 *      *customer* payloads. A QC manager who cannot see which vendor a visit
 *      belongs to cannot do the job, and `qc-public.controller.ts` remains the
 *      only file in this module that answers an anonymous caller.
 *   2. **The replays must be idempotent.** The technician app has an offline
 *      outbox that resends whatever it queued, so every mutating route it calls
 *      takes a `nonce` and lands on a UNIQUE constraint rather than creating a
 *      second inspection. A replay comes back 200 with the row that already
 *      exists, not a 409 — a 409 is classified permanent by the outbox and the
 *      technician would see their finished unit reported as refused.
 *   3. **Photographs are addressed by content.** The object key is derived from
 *      the SHA-256 of the bytes, which is what lets the app ask for a signed
 *      PUT, lose signal mid-upload, and resume onto the same object instead of
 *      leaving a second copy behind. It also means the unit result can send
 *      hashes and the server can resolve them to keys with no staging table.
 *   4. **Nothing here decides anything.** Grading is `VerdictService`, booking
 *      is `SchedulingService`, closing is `VisitClosingService`. This file
 *      assembles what those return into the shapes the two clients read, which
 *      is the one job neither a repository nor a domain service should have.
 */

// ---------------------------------------------------------------------------
// Wire shapes — `apps/console/src/routes/qc/types.ts`, field for field
// ---------------------------------------------------------------------------

export interface VisitRow {
  id: string;
  visitNumber: string;
  status: QcVisitStatus;
  vendorOrgId: string;
  vendorName: string;
  facilityLabel: string;
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  technicianId: string | null;
  technicianName: string | null;
  unitsRequested: number;
  unitsPresented: number;
  unitsInspected: number;
  unitsPassed: number;
  unitsGradeCorrected: number;
  unitsFailed: number;
  unitsAbsent: number;
  geoVarianceMetres: number | null;
  /** The threshold in force, so the console never hard-codes 500 m. */
  geoVarianceAlertMetres: number;
}

export interface ManifestUnit {
  visitUnitId: string;
  unitId: string;
  sequenceNo: number;
  serialNumber: string;
  listingId: string | null;
  skuLabel: string;
  declaredGrade: Grade | null;
  outcome: QcUnitOutcome;
  absentReason: string | null;
  qcReportId: string | null;
  durationSeconds: number | null;
}

export interface ToolRunRow {
  id: string;
  toolProviderCode: string;
  toolVersion: string;
  toolRunId: string | null;
  parseStatus: string;
  parseError: string | null;
  serialFromTool: string | null;
  serialMatches: boolean | null;
  rawReportHash: string;
  rawReportJson: unknown;
  ingestedAt: string;
}

export interface PhotoRow {
  angle: QcPhotoAngle;
  fileKey: string;
  /** Signed and short-lived. The console never constructs an object-store URL. */
  url: string;
  capturedAt: string | null;
}

export interface SealRow {
  sealCode: string;
  status: string;
  appliedAt: string;
  appliedByName: string;
  appliedPhotoUrl: string;
  verifiedAt: string | null;
  verifiedByName: string | null;
  brokenAt: string | null;
  brokenReason: string | null;
  replacedBySealCode: string | null;
}

export interface VisitDetail extends VisitRow {
  requestedAt: string;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  vendorSignoffAt: string | null;
  vendorSignoffName: string | null;
  visitFee: string | null;
  feeBearer: string | null;
  notes: string | null;
  manifest: ManifestUnit[];
  toolRuns: ToolRunRow[];
  photos: PhotoRow[];
  seals: SealRow[];
}

export interface TechnicianOption {
  id: string;
  name: string;
  employeeCode: string;
  isActive: boolean;
}

export interface ScheduleTechnicianDay {
  date: string;
  availability: 'AVAILABLE' | 'BOOKED' | 'LEAVE' | 'TRAVEL' | 'HOLIDAY' | 'UNSET';
  bookedUnits: number;
  sites: number;
  visits: Array<{ id: string; visitNumber: string; vendorName: string; units: number }>;
}

export interface ScheduleTechnician extends TechnicianOption {
  zones: string[];
  certifiedTools: string[];
  dailyCapacityUnits: number;
  maxSitesPerDay: number;
  days: ScheduleTechnicianDay[];
}

export interface ScheduleWeek {
  from: string;
  to: string;
  dates: string[];
  technicians: ScheduleTechnician[];
  licence: Array<{ providerCode: string; seats: number; seatsUsedPerDate: Record<string, number> }>;
}

export interface GradeCorrectionRow {
  id: string;
  unitId: string;
  serialNumber: string;
  skuLabel: string;
  vendorName: string;
  gradeDeclared: Grade;
  gradeCorrected: Grade;
  reason: string;
  priceBefore: string | null;
  priceSuggested: string | null;
  vendorNotifiedAt: string;
  vendorResponse: string | null;
  vendorRespondedAt: string | null;
  autoAppliedAt: string | null;
  /** Server-computed, negative once the window has passed. See the class header. */
  hoursUntilAutoApply: number;
  countsAgainstAccuracy: boolean;
}

export interface SamplingRuleRow {
  id: string;
  /**
   * Nullable, because `qc_sampling_rule.vendor_tier` is. Every seeded row has
   * one and the writer requires one, so this is the column being honest rather
   * than a case anybody expects — and inventing a tier for a row that has none
   * would be a policy decision made by a mapper.
   */
  vendorTier: string | null;
  minUnitsInspected: number;
  minPassRate: string;
  minGradeAccuracy: string;
  samplePct: string;
  alwaysFullAboveValue: string | null;
  effectiveFrom: string;
  isActive: boolean;
}

export interface AuditRecheckRow {
  id: string;
  serialNumber: string;
  originalTechnicianName: string;
  auditorName: string;
  originalGrade: Grade | null;
  recheckGrade: Grade | null;
  originalScore: number | null;
  recheckScore: number | null;
  divergence: Record<string, { original: unknown; recheck: unknown }>;
  createdAt: string;
}

export interface TechnicianDivergenceRow extends TechnicianOption {
  unitsInspectedTotal: number;
  rechecked: number;
  diverged: number;
  divergenceRate: string;
}

export interface AuditDashboard {
  targetRecheckPct: number;
  divergenceAlertPct: number;
  rechecks: AuditRecheckRow[];
  technicians: TechnicianDivergenceRow[];
}

export interface ToolProviderRow {
  id: string;
  code: string;
  name: string;
  integrationType: string;
  reportFormat: string;
  licenceSeats: number | null;
  supportsWipe: boolean;
  isActive: boolean;
  fieldMapJson: Record<string, string>;
}

export interface UploadedFile {
  fileKey: string;
  url: string;
  /** SHA-256 hex, computed over the stored bytes rather than over a claim. */
  hash: string;
}

export interface SignedUpload {
  uploadUrl: string;
  headers: Record<string, string>;
  key: string;
}

/** What the technician app fetches once, while it still has signal. */
export interface VisitManifest {
  visit: VisitRow;
  units: ManifestUnit[];
  /** The rule set the inspection will be graded under, pinned to today. */
  rules: {
    version: string;
    gradeThresholds: Record<string, { minBatteryHealthPct: number; maxCycleCount: number }>;
    tolerance: Array<{ field: string; comparison: string; value: string | null; severity: string; isBlocking: boolean }>;
  };
  autoApproval: {
    minScore: number;
    blockOnRequiredFail: boolean;
    blockOnRequiredNotMeasured: boolean;
    requireGradeMatch: boolean;
    requireSpecMatch: boolean;
    requireSeal: boolean;
    requireSerialMatch: boolean;
  };
  reportValidityDays: number;
}

// ---------------------------------------------------------------------------

const GEO_VARIANCE_KEY = 'qc.geo_variance_alert_metres';
const RECHECK_PCT_KEY = 'qc.audit_recheck_pct';
const AUTO_APPLY_DAYS_KEY = 'qc.grade_correction_auto_days';
const POLICY_KEYS = [
  'qc.auto_approve_min_score',
  'qc.auto_approve_block_on_fail',
  'qc.auto_approve_block_on_not_measured',
  'qc.auto_approve_require_grade_match',
  'qc.auto_approve_require_spec_match',
  'qc.auto_approve_require_seal',
  'qc.auto_approve_require_serial_match',
  'qc.report_validity_days',
] as const;

/**
 * Above this a technician's disagreement rate is a training problem before it
 * is a fraud problem.
 *
 * A constant rather than a `platform_config` read, because there is no key for
 * it — the same call `AuditRecheckService` makes about `MIN_RECHECKS_FOR_RATE`.
 * If ops ever needs to move it, that is the moment to add the key rather than
 * the moment to discover a literal.
 */
const DIVERGENCE_ALERT_PCT = 10;

/** A visit board is a screen, not an export. Past this, filter. */
const BOARD_LIMIT = 200;

/** Long enough to read a whole visit; short enough that a copied URL is useless. */
const PHOTO_URL_TTL_SECONDS = 900;

const EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

/**
 * Where a photograph lives, derived from what is in it.
 *
 * Content-addressed on purpose: the app asks for a signed PUT before it has
 * uploaded anything, loses signal halfway, retries, and must land on the same
 * object. It also means a unit result can carry hashes and the server can
 * resolve them to keys — no staging table for photographs that arrive before
 * the report they belong to.
 */
function photoKey(sha256: string, contentType: string): string {
  return `qc/photos/${sha256}.${EXTENSION[contentType] ?? 'bin'}`;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** `YYYY-MM-DD`, `days` after `date`, with no timezone left to get wrong. */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** The Monday on or before `date`. The console's week starts there. */
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!));
  return shiftDate(date, -((at.getUTCDay() + 6) % 7));
}

type Raw = Record<string, unknown>;

/**
 * Everything the two QC clients read, assembled.
 *
 * It lives in this file rather than in `internal/` for the reason
 * `QcPassportService` does: it exists only to serve these routes and has
 * exactly one caller. A service in `internal/` with one consumer, in the same
 * module, is a folder with an extra file in it.
 *
 * The reads that are not on `QcRepository` are here as `$queryRaw`, and every
 * one of them is single-schema. `qc_visit` has no vendor name and no technician
 * name to give, because those live in `identity` and `no-cross-schema-join`
 * makes reaching for them in one statement an error — so the names are a second
 * statement and a `Map`, which is what a join across a future service boundary
 * would have to become anyway.
 */
@Injectable()
export class QcConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: QcRepository,
    private readonly tolerance: ToleranceService,
    private readonly verdicts: VerdictService,
    private readonly corrections: GradeCorrectionService,
    private readonly audits: AuditRecheckService,
    private readonly store: ObjectStorePort,
  ) {}

  // =========================================================================
  // The board and one visit
  // =========================================================================

  async board(filter: VisitBoardQueryDto): Promise<VisitRow[]> {
    const page = await this.repo.findVisits({
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.vendorOrgId ? { vendorOrgId: filter.vendorOrgId } : {}),
      ...(filter.technicianId ? { technicianId: filter.technicianId } : {}),
      ...(filter.from ? { scheduledFrom: filter.from } : {}),
      ...(filter.to ? { scheduledTo: filter.to } : {}),
      page: 1,
      pageSize: BOARD_LIMIT,
    });
    return this.decorate(page.rows);
  }

  async detail(visitId: string): Promise<VisitDetail> {
    const visit = await this.repo.findVisitById(visitId);
    if (!visit) throw new NotFoundError('visit');

    const [row] = await this.decorate([visit]);
    const units = await this.repo.findVisitUnits({ visitId });
    const reports = await this.repo.findReportsByVisit(visitId);
    const reportIds = reports.map((r) => r.id);

    const [manifest, toolRuns, photos, seals] = await Promise.all([
      this.manifestUnits(units),
      this.toolRuns(units.map((u) => u.unitId)),
      this.photos(reportIds),
      this.seals(reportIds),
    ]);

    return {
      ...row!,
      requestedAt: visit.requestedAt.toISOString(),
      arrivedAt: iso(visit.arrivedAt),
      startedAt: iso(visit.startedAt),
      completedAt: iso(visit.completedAt),
      vendorSignoffAt: iso(visit.vendorSignoffAt),
      vendorSignoffName: visit.vendorSignoffName,
      visitFee: visit.visitFee.toJSON(),
      feeBearer: visit.feeBearer,
      notes: visit.notes,
      manifest,
      toolRuns,
      photos,
      seals,
    };
  }

  /**
   * The technician's one round trip.
   *
   * Deliberately one call: it is fetched at the moment they have signal and may
   * be the last one they get for four hours, so a design that needs six calls
   * has five chances to leave them in a warehouse without the grading rules.
   */
  async manifest(visitId: string): Promise<VisitManifest> {
    const visit = await this.repo.findVisitById(visitId);
    if (!visit) throw new NotFoundError('visit');

    const [row] = await this.decorate([visit]);
    const units = await this.repo.findVisitUnits({ visitId });
    const set = await this.tolerance.resolve(this.clock.todayInIst());
    const cfg = await readConfig(this.prisma, POLICY_KEYS);

    return {
      visit: row!,
      units: await this.manifestUnits(units),
      rules: {
        version: set.version,
        gradeThresholds: Object.fromEntries(
          Object.entries(set.gradeThresholds).map(([grade, t]) => [
            grade,
            { minBatteryHealthPct: t.minBatteryHealthPct, maxCycleCount: t.maxCycleCount },
          ]),
        ),
        tolerance: [...set.rules.values()].map((r) => ({
          field: r.field,
          comparison: r.comparison,
          value: r.toleranceValue === null ? null : String(r.toleranceValue),
          severity: r.severity,
          isBlocking: r.isBlocking,
        })),
      },
      autoApproval: {
        minScore: cfgNum(cfg, 'qc.auto_approve_min_score'),
        blockOnRequiredFail: cfgBool(cfg, 'qc.auto_approve_block_on_fail'),
        blockOnRequiredNotMeasured: cfgBool(cfg, 'qc.auto_approve_block_on_not_measured'),
        requireGradeMatch: cfgBool(cfg, 'qc.auto_approve_require_grade_match'),
        requireSpecMatch: cfgBool(cfg, 'qc.auto_approve_require_spec_match'),
        requireSeal: cfgBool(cfg, 'qc.auto_approve_require_seal'),
        requireSerialMatch: cfgBool(cfg, 'qc.auto_approve_require_serial_match'),
      },
      reportValidityDays: cfgNum(cfg, 'qc.report_validity_days'),
    };
  }

  // =========================================================================
  // The calendar
  // =========================================================================

  async scheduleWeek(from?: string): Promise<ScheduleWeek> {
    // The server decides what "this week" means. A laptop with a wrong clock
    // must not be able to move a week that visits are booked against.
    const start = weekStart(from ?? this.clock.todayInIst());
    const end = shiftDate(start, 6);
    const dates = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));

    const technicians = await this.repo.findTechnicians({ activeOnly: false });
    const names = await this.userNames(technicians.map((t) => t.userId));
    const availability = await this.repo.findAvailability({ from: start, to: end });
    const visits = await this.repo.findVisits({
      scheduledFrom: start,
      scheduledTo: end,
      page: 1,
      pageSize: 500,
    });
    const vendors = await this.orgNames(visits.rows.map((v) => v.vendorOrgId));

    const byTech = new Map<string, QcVisitRow[]>();
    for (const visit of visits.rows) {
      if (!visit.technicianId) continue;
      const list = byTech.get(visit.technicianId) ?? [];
      list.push(visit);
      byTech.set(visit.technicianId, list);
    }

    return {
      from: start,
      to: end,
      dates,
      technicians: technicians.map((tech) => ({
        id: tech.id,
        name: names.get(tech.userId) ?? tech.employeeCode,
        employeeCode: tech.employeeCode,
        isActive: tech.isActive,
        zones: tech.zones,
        certifiedTools: tech.certifiedTools,
        dailyCapacityUnits: tech.dailyCapacityUnits,
        maxSitesPerDay: tech.maxSitesPerDay,
        days: dates.map((date) => {
          const dayVisits = (byTech.get(tech.id) ?? []).filter((v) => v.scheduledDate === date);
          const slot = availability.find(
            (a) => a.technicianId === tech.id && a.theDate === date,
          );
          return {
            date,
            // A booked day with no roster row still reads as BOOKED: the visit
            // is the fact, and an empty roster is the absence of one.
            availability: slot?.status ?? (dayVisits.length > 0 ? 'BOOKED' : 'UNSET'),
            bookedUnits: dayVisits.reduce((n, v) => n + v.unitsRequested, 0),
            sites: new Set(dayVisits.map((v) => v.addressId)).size,
            visits: dayVisits.map((v) => ({
              id: v.id,
              visitNumber: v.visitNumber,
              vendorName: vendors.get(v.vendorOrgId) ?? 'Unknown vendor',
              units: v.unitsRequested,
            })),
          };
        }),
      })),
      licence: await this.licenceUsage(dates, visits.rows),
    };
  }

  async technicianOptions(): Promise<TechnicianOption[]> {
    const technicians = await this.repo.findTechnicians({ activeOnly: false });
    const names = await this.userNames(technicians.map((t) => t.userId));
    return technicians.map((t) => ({
      id: t.id,
      name: names.get(t.userId) ?? t.employeeCode,
      employeeCode: t.employeeCode,
      isActive: t.isActive,
    }));
  }

  /**
   * Put units on a visit's manifest.
   *
   * The serial comes off `listing.unit` rather than out of the request: the
   * manifest serial is what the scan is compared against, so a client that
   * could set it could also make a mismatch disappear (QC-012).
   */
  async addManifest(visitId: string, unitIds: readonly string[]): Promise<void> {
    const serials = await this.serials(unitIds);
    if (serials.size !== new Set(unitIds).size) {
      throw new NotFoundError('unit', { missing: unitIds.filter((id) => !serials.has(id)) });
    }
    // `addVisitUnits` is `ON CONFLICT DO NOTHING` on `(visit_id, unit_id)`, so
    // re-sending a manifest is idempotent rather than a 500.
    await this.repo.addVisitUnits(
      visitId,
      [...serials].map(([unitId, serialNumber], i) => ({
        unitId,
        serialNumber,
        sequenceNo: i + 1,
      })),
    );
  }

  /** The `qc_technician` row behind a signed-in user, for the app's own routes. */
  async technicianFor(userId: string): Promise<QcTechnicianRow> {
    const technician = await this.repo.findTechnicianByUserId(userId);
    if (!technician) {
      throw new PreconditionFailedError(
        'This account is not registered as a QC technician.',
        { userId, reason: 'not_a_technician' },
      );
    }
    return technician;
  }

  // =========================================================================
  // The inspection itself
  // =========================================================================

  /**
   * One finished inspection, from either client.
   *
   * The order below is the order `qc-verdict.spec.ts` establishes and is not
   * arbitrary: the seal row goes in **before** `evaluate()`, because
   * `qc.auto_approve_require_seal` is TRUE and a verdict taken without the seal
   * comes back not-approved, which writes the unit to QC_MISMATCH and leaves it
   * in a state `SealingService` will then refuse to seal. Pointing the unit at
   * the seal is the sealing lane's statement and happens afterwards, once the
   * verdict has moved the unit to QC_PASSED.
   *
   * `VerdictService` overwrites the score, both grades and the verdict the
   * client sent. Those are recorded first anyway, as the technician's reading —
   * a disagreement between the form and the engine is a signal worth having,
   * and it is invisible if the form's numbers are dropped on the floor.
   */
  async recordInspection(input: {
    visitUnitId: string;
    unitId: string;
    technicianId: string;
    serialScanned: string;
    serialMatches: boolean;
    startedAt: Date;
    completedAt: Date;
    durationSeconds?: number;
    areas: Array<{ area: QcAreaCode; status: 'PASS' | 'WARN' | 'FAIL'; score: number; maxScore: number; note?: string | null }>;
    hardware?: {
      ramDetectedGb: number;
      ramModules?: number | null;
      storageType?: string | null;
      storageDetectedGb?: number | null;
      smartStatus?: 'OK' | 'WARNING' | 'FAILING' | null;
      batteryHealthPct?: number | null;
      cycleCount?: number | null;
      biosLocked: boolean;
      mdmLocked: boolean;
      computraceActive: boolean;
    };
    photos: Array<{ angle: QcPhotoAngle; fileKey: string; hash: string }>;
    seal: { sealCode: string; photoKey: string } | null;
    qcScore: number | null;
    gradeProposed: Grade | null;
    verdict: QcVerdictValue | null;
    nonce: string;
  }): Promise<{ reportId: string; alreadyRecorded: boolean }> {
    const visitUnit = await this.visitUnit(input.visitUnitId);
    const visit = await this.repo.findVisitById(visitUnit.visitId);
    if (!visit) throw new NotFoundError('visit');

    const technician = await this.repo.findTechnicianById(input.technicianId);
    if (!technician) throw new NotFoundError('technician');

    // Pinned to the day the inspection *started*. Resolving it again at
    // completion against today would quietly re-grade an inspection that began
    // before a rule change, and `VerdictService` refuses a report whose
    // `rules_version` does not match what it re-resolves.
    const set = await this.tolerance.resolve(istDate(input.startedAt));

    let reportId: string;
    try {
      const { report } = await this.repo.supersedeReport(input.unitId, {
        unitId: input.unitId,
        visitId: visit.id,
        technicianId: technician.id,
        // NOT NULL, and a manually entered inspection has no agent behind it. A
        // marker that cannot be mistaken for a certificate id beats inventing
        // something certificate-shaped.
        deviceCertId: technician.deviceCertId ?? `MANUAL:${technician.employeeCode}`,
        agentVersion: 'MANUAL_ENTRY',
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        signature: `MANUAL_ENTRY:${technician.id}`,
        nonce: input.nonce,
        qcScore: input.qcScore,
        gradeProposed: input.gradeProposed,
        verdict: input.verdict,
        rulesVersion: set.version,
        locationType: 'VENDOR_SITE',
        locationAddressId: visit.addressId,
      });
      reportId = report.id;
    } catch (e) {
      if (!(e instanceof NonceReplayError)) throw e;
      // A replay, which for an offline outbox is the normal case rather than an
      // attack: the request already succeeded and the response was lost. Answer
      // with the row that exists so the queue can drop the item.
      const existing = await this.reportIdByNonce(input.nonce);
      if (!existing) throw e;
      return { reportId: existing, alreadyRecorded: true };
    }

    if (input.hardware) {
      await this.repo.upsertHardware(reportId, {
        hwSerial: input.serialScanned,
        ...input.hardware,
      });
    }
    if (input.photos.length > 0) {
      await this.repo.insertPhotos(
        reportId,
        input.photos.map((p) => ({ angle: p.angle, fileKey: p.fileKey, hash: p.hash })),
      );
    }

    let sealId: string | null = null;
    if (input.seal) {
      const seal = await this.repo.applySeal({
        sealCode: input.seal.sealCode,
        unitId: input.unitId,
        qcReportId: reportId,
        appliedBy: technician.id,
        appliedPhotoKey: input.seal.photoKey,
      });
      sealId = seal.id;
    }

    await this.verdicts.evaluate(reportId, {
      areas: input.areas.map((a) => ({
        area: a.area,
        status: a.status,
        score: a.score,
        maxScore: a.maxScore,
        ...(a.note ? { details: { note: a.note } } : {}),
      })),
      serialMatches: input.serialMatches,
      completedAt: input.completedAt,
    });

    if (sealId) await this.pointUnitAtSeal(input.unitId, sealId);

    await this.repo.updateVisitUnit(visitUnit.id, {
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationSeconds:
        input.durationSeconds ??
        Math.max(0, Math.round((input.completedAt.getTime() - input.startedAt.getTime()) / 1000)),
    });
    await this.repo.recountVisit(visit.id);

    return { reportId, alreadyRecorded: false };
  }

  /**
   * A machine that could not be inspected, or was never produced.
   *
   * Both are findings rather than omissions, and both go on the manifest so the
   * summary the vendor signs counts them. `recountVisit` is what keeps that
   * summary equal to the rows behind it.
   */
  async closeUnit(
    visitUnitId: string,
    outcome: Extract<QcUnitOutcome, 'UNTESTABLE' | 'ABSENT'>,
    reason: string,
  ): Promise<void> {
    const visitUnit = await this.visitUnit(visitUnitId);
    await this.repo.updateVisitUnit(visitUnit.id, {
      outcome,
      absentReason: reason,
      completedAt: this.clock.now(),
    });
    await this.repo.recountVisit(visitUnit.visitId);
  }

  /** The keys a technician's photo hashes resolve to, with the uploads verified. */
  async resolvePhotoKeys(
    hashes: readonly { angle: string; sha256: string }[],
  ): Promise<Array<{ angle: QcPhotoAngle; fileKey: string; hash: string }>> {
    const resolved: Array<{ angle: QcPhotoAngle; fileKey: string; hash: string }> = [];
    for (const photo of hashes) {
      // SEAL and RECEIPT travel the same road but are not `qc_photo` rows: the
      // seal photograph is `qc_seal.applied_photo_key` and a receipt belongs to
      // `qc_visit_expense`. Both are handled by their own endpoints.
      if (photo.angle === 'SEAL' || photo.angle === 'RECEIPT') continue;
      if (!QC_PHOTO_ANGLES.includes(photo.angle as QcPhotoAngle)) {
        // `qc_photo_angle_check` would refuse this three frames down as a 500.
        // Refusing here says which angle, and the app can drop the row instead
        // of retrying a payload that will never be accepted.
        throw new ValidationError('That is not a photograph angle we record.', {
          angle: photo.angle,
        });
      }
      const key = photoKey(photo.sha256, 'image/jpeg');
      if (!(await this.store.exists(key))) {
        throw new PreconditionFailedError(
          'One of the photographs has not finished uploading yet.',
          { sha256: photo.sha256, reason: 'photo_not_uploaded' },
        );
      }
      resolved.push({ angle: photo.angle as QcPhotoAngle, fileKey: key, hash: photo.sha256 });
    }
    return resolved;
  }

  // =========================================================================
  // Grade corrections, sampling, audit, tool providers
  // =========================================================================

  /**
   * The queue: corrections the vendor has not settled, and the disputes waiting
   * on a QC manager.
   *
   * `hoursUntilAutoApply` is computed here, from the server's clock and
   * `qc.grade_correction_auto_days`, and goes negative once the window has
   * passed. The console must not derive it — the two-day window is a money
   * deadline and a browser clock must not be able to move it.
   */
  async correctionQueue(): Promise<GradeCorrectionRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT c.id, c.unit_id, c.grade_declared, c.grade_corrected, c.reason,
             c.price_before, c.price_suggested, c.vendor_notified_at, c.vendor_response,
             c.vendor_responded_at, c.auto_applied_at, c.counts_against_accuracy,
             u.serial_number, u.sku_id, u.vendor_org_id
        FROM listing.grade_correction c
        JOIN listing.unit u ON u.id = c.unit_id
       WHERE c.auto_applied_at IS NULL
         AND (c.vendor_response IS NULL OR c.vendor_response = 'DISPUTE')
       ORDER BY c.vendor_notified_at
       LIMIT ${BOARD_LIMIT}`;

    const cfg = await readConfig(this.prisma, [AUTO_APPLY_DAYS_KEY]);
    const windowMs = cfgNum(cfg, AUTO_APPLY_DAYS_KEY) * 86_400_000;
    const now = this.clock.nowMs();

    const [vendors, skus] = await Promise.all([
      this.orgNames(rows.map((r) => r.vendor_org_id as string)),
      this.skuLabels(rows.map((r) => r.sku_id as string)),
    ]);

    return rows.map((r) => {
      const notified = r.vendor_notified_at as Date;
      return {
        id: r.id as string,
        unitId: r.unit_id as string,
        serialNumber: r.serial_number as string,
        skuLabel: skus.get(r.sku_id as string) ?? 'Unknown SKU',
        vendorName: vendors.get(r.vendor_org_id as string) ?? 'Unknown vendor',
        gradeDeclared: r.grade_declared as Grade,
        gradeCorrected: r.grade_corrected as Grade,
        reason: r.reason as string,
        priceBefore: r.price_before === null ? null : money(String(r.price_before)).toJSON(),
        priceSuggested:
          r.price_suggested === null ? null : money(String(r.price_suggested)).toJSON(),
        vendorNotifiedAt: notified.toISOString(),
        vendorResponse: (r.vendor_response as string | null) ?? null,
        vendorRespondedAt: iso(r.vendor_responded_at as Date | null),
        autoAppliedAt: iso(r.auto_applied_at as Date | null),
        hoursUntilAutoApply:
          Math.round(((notified.getTime() + windowMs - now) / 3_600_000) * 10) / 10,
        countsAgainstAccuracy: r.counts_against_accuracy as boolean,
      };
    });
  }

  async samplingRules(): Promise<SamplingRuleRow[]> {
    const rules = await this.repo.findSamplingRules();
    return rules.map((r) => ({
      id: r.id,
      vendorTier: r.vendorTier,
      minUnitsInspected: r.minUnitsInspected,
      minPassRate: (r.minPassRate ?? 0).toFixed(2),
      minGradeAccuracy: (r.minGradeAccuracy ?? 0).toFixed(2),
      samplePct: r.samplePct.toFixed(2),
      alwaysFullAboveValue: r.alwaysFullAboveValue ? r.alwaysFullAboveValue.toJSON() : null,
      effectiveFrom: r.effectiveFrom,
      isActive: r.isActive,
    }));
  }

  async saveSamplingRule(input: SamplingRuleDto): Promise<SamplingRuleRow> {
    const saved = await this.repo.upsertSamplingRule({
      vendorTier: input.vendorTier,
      effectiveFrom: input.effectiveFrom,
      minUnitsInspected: input.minUnitsInspected,
      // `sample_pct` is an INT column; the form renders a two-decimal string
      // because the other two rates are NUMERIC(5,2) and it treats all three
      // alike. Rounding here is the honest reading of a column that cannot
      // hold 12.5.
      samplePct: Math.round(Number(input.samplePct)),
      minPassRate: Number(input.minPassRate),
      minGradeAccuracy: Number(input.minGradeAccuracy),
      alwaysFullAboveValue: input.alwaysFullAboveValue
        ? money(input.alwaysFullAboveValue)
        : null,
    });
    return {
      id: saved.id,
      vendorTier: saved.vendorTier,
      minUnitsInspected: saved.minUnitsInspected,
      minPassRate: (saved.minPassRate ?? 0).toFixed(2),
      minGradeAccuracy: (saved.minGradeAccuracy ?? 0).toFixed(2),
      samplePct: saved.samplePct.toFixed(2),
      alwaysFullAboveValue: saved.alwaysFullAboveValue
        ? saved.alwaysFullAboveValue.toJSON()
        : null,
      effectiveFrom: saved.effectiveFrom,
      isActive: saved.isActive,
    };
  }

  async auditDashboard(): Promise<AuditDashboard> {
    const cfg = await readConfig(this.prisma, [RECHECK_PCT_KEY]);
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT ar.id, ar.divergence_json, ar.auditor_id, ar.created_at,
             orig.technician_id AS original_technician_id,
             orig.unit_id, orig.grade_final AS original_grade, orig.qc_score AS original_score,
             re.grade_final AS recheck_grade, re.qc_score AS recheck_score
        FROM qc.qc_audit_recheck ar
        JOIN qc.qc_report orig ON orig.id = ar.original_report_id
        JOIN qc.qc_report re   ON re.id   = ar.recheck_report_id
       ORDER BY ar.created_at DESC
       LIMIT ${BOARD_LIMIT}`;

    const technicians = await this.repo.findTechnicians({ activeOnly: false });
    const byId = new Map(technicians.map((t) => [t.id, t]));
    const [names, serials] = await Promise.all([
      this.userNames([
        ...technicians.map((t) => t.userId),
        ...rows.map((r) => r.auditor_id as string),
      ]),
      this.serials(rows.map((r) => r.unit_id as string)),
    ]);

    // One statement per technician. The table has dozens of rows, not
    // thousands, and `technicianDivergence` is the definition of the number
    // that appears on the scorecard — a second, grouped copy of it here is the
    // second copy that stops agreeing.
    // ponytail: fan-out, fine at this size; one grouped query if it ever isn't.
    const divergences = await Promise.all(
      technicians.map((t) => this.audits.technicianDivergence(t.id)),
    );

    return {
      targetRecheckPct: cfgNum(cfg, RECHECK_PCT_KEY),
      divergenceAlertPct: DIVERGENCE_ALERT_PCT,
      rechecks: rows.map((r) => {
        const original = byId.get(r.original_technician_id as string);
        return {
          id: r.id as string,
          serialNumber: serials.get(r.unit_id as string) ?? '',
          originalTechnicianName: original
            ? (names.get(original.userId) ?? original.employeeCode)
            : 'Unknown technician',
          auditorName: names.get(r.auditor_id as string) ?? 'Unknown auditor',
          originalGrade: (r.original_grade as Grade | null) ?? null,
          recheckGrade: (r.recheck_grade as Grade | null) ?? null,
          originalScore: r.original_score === null ? null : Number(r.original_score),
          recheckScore: r.recheck_score === null ? null : Number(r.recheck_score),
          divergence: (r.divergence_json ?? {}) as AuditRecheckRow['divergence'],
          createdAt: (r.created_at as Date).toISOString(),
        };
      }),
      technicians: technicians.map((t, i) => ({
        id: t.id,
        name: names.get(t.userId) ?? t.employeeCode,
        employeeCode: t.employeeCode,
        isActive: t.isActive,
        unitsInspectedTotal: t.unitsInspectedTotal,
        rechecked: divergences[i]!.rechecked,
        diverged: divergences[i]!.diverged,
        // NULL below the minimum sample renders as "0.00" nowhere: an unproven
        // rate is sent as an empty string so the console shows a dash rather
        // than a claim of perfection.
        divergenceRate:
          divergences[i]!.divergenceRatePct === null
            ? ''
            : divergences[i]!.divergenceRatePct!.toFixed(2),
      })),
    };
  }

  async toolProviders(): Promise<ToolProviderRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, code, name, integration_type, report_format, licence_seats,
             supports_wipe, is_active, field_map_json
        FROM qc.qc_tool_provider ORDER BY code`;
    return rows.map(toToolProvider);
  }

  /**
   * The field map, edited in place.
   *
   * This is how a DeviceSure payload change is absorbed without a deploy: the
   * parser is generic and the map is data, so a renamed field is a config edit
   * at 2 a.m. rather than a release. Replaced wholesale rather than merged —
   * a merge cannot express "this field is gone", and a stale key that quietly
   * survives an edit is exactly the bug this screen exists to fix.
   */
  async saveFieldMap(id: string, map: Record<string, string>): Promise<ToolProviderRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_tool_provider
         SET field_map_json = ${JSON.stringify(map)}::jsonb
       WHERE id = ${id}::uuid
      RETURNING id, code, name, integration_type, report_format, licence_seats,
                supports_wipe, is_active, field_map_json`;
    if (!rows[0]) throw new NotFoundError('tool provider');
    return toToolProvider(rows[0]);
  }

  // =========================================================================
  // Photographs
  // =========================================================================

  async signPhoto(input: PhotoSignDto): Promise<SignedUpload> {
    const key = photoKey(input.sha256, input.contentType);
    const grant = await this.store.presignUpload(key, input.contentType, input.bytes);
    return { uploadUrl: grant.url, headers: grant.fields ?? {}, key };
  }

  /** The console's direct upload: we hold the bytes, so we hash what we stored. */
  async storePhoto(bytes: Buffer, mime: string, filename: string): Promise<UploadedFile> {
    const check = checkUpload({ bytes, declaredMime: mime, filename });
    if (!check.ok) {
      // `UploadCheck.message` is optional on the type even where `ok` is false,
      // so the fallback is a sentence rather than `undefined` reaching a person.
      const why = check.message ?? 'That file was refused.';
      throw new ValidationError(why, { file: why });
    }

    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = photoKey(hash, mime);
    await this.store.put(key, bytes, mime);
    return { fileKey: key, url: await this.store.presignDownload(key, PHOTO_URL_TTL_SECONDS), hash };
  }

  /** The app's confirmation after its own PUT. Trust the store, not the claim. */
  async confirmPhoto(input: PhotoSignDto): Promise<UploadedFile> {
    const key = photoKey(input.sha256, input.contentType);
    if (!(await this.store.exists(key))) {
      throw new PreconditionFailedError('That photograph did not finish uploading.', {
        sha256: input.sha256,
        reason: 'photo_not_uploaded',
      });
    }
    return {
      fileKey: key,
      url: await this.store.presignDownload(key, PHOTO_URL_TTL_SECONDS),
      hash: input.sha256,
    };
  }

  // =========================================================================
  // The reads `QcRepository` does not have
  // =========================================================================

  /** Adds the names and the alert threshold `qc_visit` cannot carry itself. */
  private async decorate(visits: readonly QcVisitRow[]): Promise<VisitRow[]> {
    if (visits.length === 0) return [];
    const cfg = await readConfig(this.prisma, [GEO_VARIANCE_KEY]);
    const [vendors, labels, technicians] = await Promise.all([
      this.orgNames(visits.map((v) => v.vendorOrgId)),
      this.addressLabels(visits.map((v) => v.addressId)),
      this.technicianNames(visits.map((v) => v.technicianId)),
    ]);

    return visits.map((v) => ({
      id: v.id,
      visitNumber: v.visitNumber,
      status: v.status,
      vendorOrgId: v.vendorOrgId,
      vendorName: vendors.get(v.vendorOrgId) ?? 'Unknown vendor',
      facilityLabel: labels.get(v.addressId) ?? 'Unknown site',
      scheduledDate: v.scheduledDate,
      slotFrom: v.slotFrom,
      slotTo: v.slotTo,
      technicianId: v.technicianId,
      technicianName: v.technicianId ? (technicians.get(v.technicianId) ?? null) : null,
      unitsRequested: v.unitsRequested,
      unitsPresented: v.unitsPresented ?? 0,
      unitsInspected: v.unitsInspected,
      unitsPassed: v.unitsPassed,
      unitsGradeCorrected: v.unitsGradeCorrected,
      unitsFailed: v.unitsFailed,
      unitsAbsent: v.unitsAbsent,
      geoVarianceMetres: v.geoVarianceMetres,
      geoVarianceAlertMetres: cfgNum(cfg, GEO_VARIANCE_KEY),
    }));
  }

  private async manifestUnits(units: readonly QcVisitUnitRow[]): Promise<ManifestUnit[]> {
    if (units.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, sku_id, grade_declared FROM listing.unit
       WHERE id = ANY(${units.map((u) => u.unitId)}::text[]::uuid[])`;
    const declared = new Map(rows.map((r) => [r.id as string, r]));
    const skus = await this.skuLabels(rows.map((r) => r.sku_id as string));

    return units.map((u, i) => {
      const unit = declared.get(u.unitId);
      return {
        visitUnitId: u.id,
        unitId: u.unitId,
        sequenceNo: u.sequenceNo ?? i + 1,
        serialNumber: u.serialNumber,
        listingId: u.listingId,
        skuLabel: unit ? (skus.get(unit.sku_id as string) ?? 'Unknown SKU') : 'Unknown SKU',
        declaredGrade: (unit?.grade_declared as Grade | undefined) ?? null,
        outcome: u.outcome,
        absentReason: u.absentReason,
        qcReportId: u.qcReportId,
        durationSeconds: u.durationSeconds,
      };
    });
  }

  private async toolRuns(unitIds: readonly string[]): Promise<ToolRunRow[]> {
    if (unitIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT r.id, r.tool_version, r.tool_run_id, r.parse_status, r.parse_error,
             r.serial_from_tool, r.serial_matches, r.raw_report_hash, r.raw_report_json,
             r.ingested_at, p.code AS provider_code
        FROM qc.qc_tool_run r
        JOIN qc.qc_tool_provider p ON p.id = r.tool_provider_id
       WHERE r.unit_id = ANY(${[...new Set(unitIds)]}::text[]::uuid[])
       ORDER BY r.ingested_at DESC`;
    return rows.map((r) => ({
      id: r.id as string,
      toolProviderCode: r.provider_code as string,
      toolVersion: r.tool_version as string,
      toolRunId: (r.tool_run_id as string | null) ?? null,
      parseStatus: r.parse_status as string,
      parseError: (r.parse_error as string | null) ?? null,
      serialFromTool: (r.serial_from_tool as string | null) ?? null,
      serialMatches: (r.serial_matches as boolean | null) ?? null,
      rawReportHash: r.raw_report_hash as string,
      // The payload exactly as it arrived. This is the evidence in a dispute
      // four months from now, so it is served whole rather than re-summarised.
      rawReportJson: r.raw_report_json ?? null,
      ingestedAt: (r.ingested_at as Date).toISOString(),
    }));
  }

  private async photos(reportIds: readonly string[]): Promise<PhotoRow[]> {
    if (reportIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT angle, file_key, captured_at FROM qc.qc_photo
       WHERE qc_report_id = ANY(${[...reportIds]}::text[]::uuid[])
       ORDER BY captured_at`;
    return Promise.all(
      rows.map(async (r) => ({
        angle: r.angle as QcPhotoAngle,
        fileKey: r.file_key as string,
        url: await this.store.presignDownload(r.file_key as string, PHOTO_URL_TTL_SECONDS),
        capturedAt: iso(r.captured_at as Date | null),
      })),
    );
  }

  private async seals(reportIds: readonly string[]): Promise<SealRow[]> {
    if (reportIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT s.seal_code, s.status, s.applied_at, s.applied_by, s.applied_photo_key,
             s.verified_at, s.verified_by, s.broken_at, s.broken_reason,
             r.seal_code AS replaced_by_seal_code
        FROM qc.qc_seal s
        LEFT JOIN qc.qc_seal r ON r.id = s.replaced_by_seal_id
       WHERE s.qc_report_id = ANY(${[...reportIds]}::text[]::uuid[])
       ORDER BY s.applied_at`;

    const technicians = await this.technicianNames(rows.map((r) => r.applied_by as string));
    const verifiers = await this.userNames(
      rows.map((r) => r.verified_by as string | null).filter((v): v is string => v !== null),
    );

    return Promise.all(
      rows.map(async (r) => ({
        sealCode: r.seal_code as string,
        status: r.status as string,
        appliedAt: (r.applied_at as Date).toISOString(),
        appliedByName: technicians.get(r.applied_by as string) ?? 'Unknown technician',
        appliedPhotoUrl: await this.store.presignDownload(
          r.applied_photo_key as string,
          PHOTO_URL_TTL_SECONDS,
        ),
        verifiedAt: iso(r.verified_at as Date | null),
        verifiedByName:
          r.verified_by === null ? null : (verifiers.get(r.verified_by as string) ?? null),
        brokenAt: iso(r.broken_at as Date | null),
        brokenReason: (r.broken_reason as string | null) ?? null,
        replacedBySealCode: (r.replaced_by_seal_code as string | null) ?? null,
      })),
    );
  }

  /**
   * The licence ceiling, per provider per day.
   *
   * `licence_seats` is a hard cap on how many technicians can be certifying at
   * once. Scheduling a thirteenth against twelve seats produces a day where
   * somebody's agent simply refuses to run, in a warehouse, with the vendor
   * watching — so the number is on the calendar rather than in a runbook.
   */
  private async licenceUsage(
    dates: readonly string[],
    visits: readonly QcVisitRow[],
  ): Promise<ScheduleWeek['licence']> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, code, licence_seats FROM qc.qc_tool_provider
       WHERE is_active AND licence_seats IS NOT NULL ORDER BY code`;
    return rows.map((p) => ({
      providerCode: p.code as string,
      seats: Number(p.licence_seats),
      seatsUsedPerDate: Object.fromEntries(
        dates.map((date) => [
          date,
          new Set(
            visits
              .filter(
                (v) =>
                  v.scheduledDate === date && v.toolProviderId === p.id && v.technicianId !== null,
              )
              .map((v) => v.technicianId),
          ).size,
        ]),
      ),
    }));
  }

  private async visitUnit(id: string): Promise<QcVisitUnitRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_id, unit_id, serial_number, listing_id, sequence_no, outcome,
             qc_report_id, absent_reason, started_at, completed_at, duration_seconds
        FROM qc.qc_visit_unit WHERE id = ${id}::uuid`;
    const row = rows[0];
    if (!row) throw new NotFoundError('visit unit');
    return {
      id: row.id as string,
      visitId: row.visit_id as string,
      unitId: row.unit_id as string,
      serialNumber: row.serial_number as string,
      listingId: (row.listing_id as string | null) ?? null,
      sequenceNo: row.sequence_no === null ? null : Number(row.sequence_no),
      outcome: row.outcome as QcUnitOutcome,
      qcReportId: (row.qc_report_id as string | null) ?? null,
      absentReason: (row.absent_reason as string | null) ?? null,
      startedAt: (row.started_at as Date | null) ?? null,
      completedAt: (row.completed_at as Date | null) ?? null,
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    };
  }

  private async reportIdByNonce(nonce: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM qc.qc_report WHERE nonce = ${nonce}`;
    return rows[0]?.id ?? null;
  }

  /**
   * `qc_seal` is written before the verdict; the unit points at it afterwards.
   *
   * Written here rather than through `SealingService.applySeal()`, which would
   * insert a second `qc_seal` row for a code that is globally UNIQUE. This is
   * the same single-schema statement that service makes, for the same stated
   * reason: `trg_recompute_sellable` reads `seal_id`, and a unit that passed
   * with a seal on it but no pointer is a machine we cannot sell.
   */
  private async pointUnitAtSeal(unitId: string, sealId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE listing.unit
         SET seal_id = ${sealId}::uuid, sealed_at = ${this.clock.now()}
       WHERE id = ${unitId}::uuid`;
  }

  private async orgNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; legal_name: string }>>`
      SELECT id, legal_name FROM identity.organization
       WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.legal_name]));
  }

  private async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account
       WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }

  /** Technician id -> the person's name, through `qc_technician.user_id`. */
  private async technicianNames(
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; user_id: string; employee_code: string }>>`
      SELECT id, user_id, employee_code FROM qc.qc_technician
       WHERE id = ANY(${unique}::text[]::uuid[])`;
    const names = await this.userNames(rows.map((r) => r.user_id));
    return new Map(rows.map((r) => [r.id, names.get(r.user_id) ?? r.employee_code]));
  }

  private async skuLabels(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; sku_code: string }>>`
      SELECT id, sku_code FROM catalog.sku WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.sku_code]));
  }

  private async serials(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.serial_number]));
  }

  private async addressLabels(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; label: string | null; city: string }>
    >`
      SELECT id, label, city FROM identity.org_address
       WHERE id = ANY(${unique}::text[]::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.label ? `${r.label}, ${r.city}` : r.city]));
  }
}

function toToolProvider(r: Raw): ToolProviderRow {
  return {
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    integrationType: r.integration_type as string,
    reportFormat: r.report_format as string,
    licenceSeats: r.licence_seats === null ? null : Number(r.licence_seats),
    supportsWipe: r.supports_wipe as boolean,
    isActive: r.is_active as boolean,
    fieldMapJson: (r.field_map_json ?? {}) as Record<string, string>,
  };
}

/**
 * `qc_visit.visit_number` is UNIQUE and has no default, so somebody has to
 * mint it. Date plus six characters of a UUID: readable over a phone, sortable
 * by eye, and collision-proof enough that the UNIQUE is a backstop rather than
 * a retry loop.
 */
function visitNumber(today: string): string {
  return `QCV-${today.replace(/-/g, '')}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

// ---------------------------------------------------------------------------

@Controller('qc')
export class QcController {
  constructor(
    private readonly console: QcConsoleService,
    private readonly repo: QcRepository,
    private readonly clock: ClockPort,
    private readonly scheduling: SchedulingService,
    private readonly closing: VisitClosingService,
    private readonly sealing: SealingService,
    private readonly corrections: GradeCorrectionService,
    private readonly audits: AuditRecheckService,
  ) {}

  // ---------------------------------------------------------------- visits --

  @Get('visits')
  @RequirePermissions('qc.visit.read')
  visits(
    @Query(new ZodValidationPipe(visitBoardQuerySchema)) query: VisitBoardQueryDto,
  ): Promise<VisitRow[]> {
    return this.console.board(query);
  }

  /**
   * File a visit, and book it in the same call when the slot is already agreed.
   *
   * Two steps rather than one because they are two decisions with two different
   * failure modes: the visit exists whatever happens to the booking, and a
   * technician who turns out to be over capacity leaves a SCHEDULED visit ops
   * can reassign rather than nothing at all.
   */
  @Post('visits')
  @RequirePermissions('qc.visit.schedule')
  async createVisit(
    @Body(new ZodValidationPipe(createVisitSchema)) body: CreateVisitDto,
    @CurrentUser() user: Principal,
  ): Promise<VisitDetail> {
    const visit = await this.repo.createVisit({
      visitNumber: visitNumber(this.clock.todayInIst()),
      vendorOrgId: body.vendorOrgId,
      facilityId: body.facilityId,
      addressId: body.addressId,
      unitsRequested: body.unitsRequested,
      requestedBy: user.userId,
      ...(body.notes ? { notes: body.notes } : {}),
    });

    if (body.unitIds?.length) await this.console.addManifest(visit.id, body.unitIds);

    if (body.schedule) {
      await this.scheduling.schedule(visit.id, {
        scheduledDate: body.schedule.scheduledDate,
        slotFrom: body.schedule.slotFrom,
        slotTo: body.schedule.slotTo,
        ...(body.schedule.technicianId ? { technicianId: body.schedule.technicianId } : {}),
      });
    }
    return this.console.detail(visit.id);
  }

  @Get('visits/:visitId')
  @RequirePermissions('qc.visit.read')
  visit(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
  ): Promise<VisitDetail> {
    return this.console.detail(visitId);
  }

  /**
   * The technician's whole visit, in one round trip. See `manifest()`.
   */
  @Get('visits/:visitId/manifest')
  @RequirePermissions('qc.visit.execute')
  manifest(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
  ): Promise<VisitManifest> {
    return this.console.manifest(visitId);
  }

  /**
   * Arrival, with the coordinates that make `geo_variance_metres` mean
   * something.
   *
   * 200 rather than 201: the technician app replays this from its offline
   * outbox keyed on the visit, and a second arrival at the same warehouse is
   * the same arrival. `SchedulingService.checkIn()` warns above the threshold
   * and continues — a technician locked out of the app at a vendor's site has
   * no recourse, and a genuine second gate 600 m down the road is more likely
   * than fraud.
   */
  @Post('visits/:visitId/check-in')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  checkIn(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
    @Body(new ZodValidationPipe(checkInSchema)) body: CheckInDto,
  ): Promise<{ geoVarianceMetres: number | null; alerted: boolean }> {
    return this.scheduling
      .checkIn(visitId, { latitude: body.latitude, longitude: body.longitude })
      .then((r) => ({ geoVarianceMetres: r.geoVarianceMetres, alerted: r.alerted }));
  }

  /** The vendor's OTP sign-off on the summary. Cannot complete offline. */
  @Post('visits/:visitId/signoff')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  async signoff(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
    @Body(new ZodValidationPipe(signoffSchema)) body: SignoffDto,
  ): Promise<{ signedAt: string | null; signedName: string | null }> {
    const visit = await this.closing.signOff(visitId, {
      code: body.otp,
      signedName: body.contactName,
    });
    return { signedAt: iso(visit.vendorSignoffAt), signedName: visit.vendorSignoffName };
  }

  @Post('visits/:visitId/expenses')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  async expense(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
    @Body(new ZodValidationPipe(expenseSchema)) body: ExpenseDto,
  ): Promise<{ id: string; amount: string }> {
    const row = await this.closing.recordExpense(visitId, {
      expenseType: body.category,
      amount: money(body.amountInr),
      ...(body.distanceKm === undefined ? {} : { distanceKm: body.distanceKm }),
      ...(body.receiptSha256
        ? { receiptKey: `qc/photos/${body.receiptSha256}.jpg` }
        : {}),
    });
    return { id: row.id, amount: row.amount.toJSON() };
  }

  /**
   * Total the counters, move the units, publish the listings, close the visit.
   *
   * Refused without a vendor sign-off and refused over a PENDING unit, both by
   * `VisitClosingService` — a close that left a machine as neither inspected
   * nor absent would contradict a summary the vendor has already signed.
   */
  @Post('visits/:visitId/close')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  close(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
  ): Promise<{ unitsListed: number; unitsFailed: number }> {
    return this.closing
      .close(visitId)
      .then((r) => ({ unitsListed: r.unitsListed, unitsFailed: r.unitsFailed }));
  }

  // ----------------------------------------------------------- inspections --

  /**
   * The web console's manual inspection — the fallback that must work with no
   * mobile app in the building, and a Phase 4 exit criterion.
   *
   * 200 and not 201 for the same reason `POST /qc/tool-runs` is: a re-submitted
   * inspection is one report, and `alreadyRecorded` says which happened rather
   * than making the status code carry the answer.
   */
  @Post('reports/manual')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  manualReport(
    @Body(new ZodValidationPipe(manualReportSchema)) body: ManualReportDto,
  ): Promise<{ reportId: string; alreadyRecorded: boolean }> {
    const hw = body.hardware;
    return this.console.recordInspection({
      visitUnitId: body.visitUnitId,
      unitId: body.unitId,
      technicianId: body.technicianId,
      serialScanned: body.serialScanned,
      serialMatches: body.serialMatches,
      startedAt: new Date(body.startedAt),
      completedAt: new Date(body.completedAt),
      areas: body.areaResults.map((a) => ({
        area: a.area,
        status: a.status,
        score: a.score,
        maxScore: a.maxScore,
        note: a.note ?? null,
      })),
      // Written only when RAM was actually read. `ram_detected_gb` is the one
      // hardware column with no honest null, so a form that measured nothing
      // records no hardware row rather than a row that claims 0 GB.
      ...(hw.ramDetectedGb === null
        ? {}
        : {
            hardware: {
              ramDetectedGb: hw.ramDetectedGb,
              ramModules: hw.ramModules,
              storageType: hw.storageType,
              storageDetectedGb: hw.storageDetectedGb,
              smartStatus: hw.smartStatus,
              batteryHealthPct: hw.batteryHealthPct,
              cycleCount: hw.cycleCount,
              // Tristate collapses to the boolean the column holds, and only
              // YES is a lock. UNKNOWN is "nobody looked", which is not "locked".
              biosLocked: hw.biosLocked === 'YES',
              mdmLocked: hw.mdmLocked === 'YES',
              computraceActive: hw.computraceActive === 'YES',
            },
          }),
      photos: body.photos,
      seal: body.seal ? { sealCode: body.seal.sealCode, photoKey: body.seal.photoKey } : null,
      qcScore: body.qcScore,
      gradeProposed: body.gradeProposed,
      verdict: body.verdict,
      nonce: body.nonce ?? randomUUID(),
    });
  }

  /**
   * The technician app's finished unit.
   *
   * The same event as `reports/manual` from the other client, so it goes
   * through the same method — one inspection-recording path, not two that agree
   * today. Photographs arrive as hashes and are resolved to the keys the app
   * PUT them under.
   */
  @Post('visit-units/:visitUnitId/result')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  async unitResult(
    @Param('visitUnitId', new ZodValidationPipe(uuidSchema)) visitUnitId: string,
    @Body(new ZodValidationPipe(unitResultSchema)) body: UnitResultDto,
    @CurrentUser() user: Principal,
  ): Promise<{ reportId: string; alreadyRecorded: boolean }> {
    const technician = await this.console.technicianFor(user.userId);
    return this.console.recordInspection({
      visitUnitId,
      unitId: body.unitId,
      technicianId: technician.id,
      serialScanned: body.scannedSerial,
      serialMatches: body.serialMatches,
      startedAt: new Date(body.startedAt),
      completedAt: new Date(body.completedAt),
      ...(body.durationSeconds === undefined ? {} : { durationSeconds: body.durationSeconds }),
      areas: (body.areaResults ?? []).map((a) => ({
        area: a.area,
        status: a.status,
        score: a.score,
        maxScore: a.maxScore,
        note: a.note ?? null,
      })),
      photos: await this.console.resolvePhotoKeys(body.photoHashes),
      seal: body.sealCode ? { sealCode: body.sealCode, photoKey: sealPhotoKey(body) } : null,
      // The app's own verdict is not sent as ours. It re-runs the same rules
      // offline for the technician's benefit; the server grades from the areas.
      qcScore: null,
      gradeProposed: body.gradeOverride ?? null,
      verdict: null,
      nonce: body.nonce,
    });
  }

  /**
   * A serial on the machine that is not the serial on the manifest.
   *
   * UNTESTABLE rather than FAIL, because we have not inspected anything — we
   * have found a bookkeeping problem, and `recountVisit` counts it against the
   * visit so the vendor's summary shows the gap (QC-012).
   */
  @Post('visits/:visitId/units/:visitUnitId/untestable')
  @HttpCode(204)
  @RequirePermissions('qc.visit.execute')
  async untestable(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) _visitId: string,
    @Param('visitUnitId', new ZodValidationPipe(uuidSchema)) visitUnitId: string,
    @Body(new ZodValidationPipe(untestableSchema)) body: UntestableDto,
  ): Promise<void> {
    await this.console.closeUnit(visitUnitId, 'UNTESTABLE', body.reason);
  }

  /** The vendor could not produce the machine. A finding, not an omission. */
  @Post('visit-units/:visitUnitId/absent')
  @HttpCode(204)
  @RequirePermissions('qc.visit.execute')
  async absent(
    @Param('visitUnitId', new ZodValidationPipe(uuidSchema)) visitUnitId: string,
    @Body(new ZodValidationPipe(absentSchema)) body: AbsentDto,
  ): Promise<void> {
    await this.console.closeUnit(visitUnitId, 'ABSENT', body.absentReason);
  }

  /**
   * The seal, applied and photographed.
   *
   * Delegated to `SealingService` unchanged, including its refusal to seal a
   * machine that has not passed. The manual-inspection path writes its seal
   * inside the same call as the report because the verdict needs it to already
   * be there; this endpoint is the standalone case, where a report already
   * exists and the seal is going on afterwards.
   */
  @Post('seals')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  async seal(
    @Body(new ZodValidationPipe(applySealSchema)) body: ApplySealDto,
    @CurrentUser() user: Principal,
  ): Promise<{ sealCode: string; status: string }> {
    const technician = await this.console.technicianFor(user.userId);
    const report = await this.repo.findCurrentReportByUnit(body.unitId);
    if (!report) {
      throw new PreconditionFailedError(
        'This machine has no inspection to seal against yet.',
        { unitId: body.unitId, reason: 'no_current_report' },
      );
    }
    const seal = await this.sealing.applySeal({
      sealCode: body.sealCode,
      unitId: body.unitId,
      qcReportId: report.id,
      appliedBy: technician.id,
      appliedPhotoKey: `qc/photos/${body.appliedPhotoSha256}.jpg`,
    });
    return { sealCode: seal.sealCode, status: seal.status };
  }

  // ---------------------------------------------------------- photographs --

  /** A pre-signed PUT, keyed on the content hash so a retry resumes. */
  @Post('photos/sign')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  signPhoto(
    @Body(new ZodValidationPipe(photoSignSchema)) body: PhotoSignDto,
  ): Promise<SignedUpload> {
    return this.console.signPhoto(body);
  }

  /**
   * One photograph, two callers.
   *
   * The console posts the bytes as multipart, because the server has to see
   * them anyway: the declared MIME type is attacker-controlled, so `checkUpload`
   * sniffs the leading bytes, and the SHA-256 has to be computed over what was
   * actually stored rather than over what a client claimed it sent. The
   * technician app has already PUT its bytes to the signed URL and posts JSON to
   * confirm — which is checked against the object store, not believed.
   */
  @Post('photos')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @RequirePermissions('qc.visit.execute')
  photo(
    @UploadedFile() file: MultipartFile | undefined,
    @Body() body: unknown,
  ): Promise<UploadedFile> {
    if (file) {
      return this.console.storePhoto(file.buffer, file.mimetype, file.originalname);
    }
    return this.console.confirmPhoto(photoSignSchema.parse(body));
  }

  // --------------------------------------------- schedule and technicians --

  @Get('schedule')
  @RequirePermissions('qc.visit.read')
  schedule(
    @Query(new ZodValidationPipe(scheduleQuerySchema)) query: ScheduleQueryDto,
  ): Promise<ScheduleWeek> {
    return this.console.scheduleWeek(query.from);
  }

  @Get('technicians')
  @RequirePermissions('qc.visit.read')
  technicians(): Promise<TechnicianOption[]> {
    return this.console.technicianOptions();
  }

  /** The signed-in technician's own day. Their identity comes from the session. */
  @Get('technician/route')
  @RequirePermissions('qc.visit.read')
  async route(
    @Query(new ZodValidationPipe(routeQuerySchema)) query: RouteQueryDto,
    @CurrentUser() user: Principal,
  ): Promise<VisitRow[]> {
    const technician = await this.console.technicianFor(user.userId);
    return this.console.board({ technicianId: technician.id, from: query.date, to: query.date });
  }

  // ------------------------------------------------------ grade corrections --

  @Get('grade-corrections')
  @RequirePermissions('qc.report.read')
  gradeCorrections(): Promise<GradeCorrectionRow[]> {
    return this.console.correctionQueue();
  }

  /**
   * The QC manager's ruling on a disputed correction.
   *
   * Upholding the dispute is the only button the console has, and it is the
   * expensive direction: the correction is withdrawn and it stops counting
   * against the vendor's grade accuracy — a number we publish, which is why it
   * may only move on a finding and never on a request.
   */
  @Post('grade-corrections/:id/uphold-dispute')
  @HttpCode(204)
  @RequirePermissions('qc.audit.recheck')
  async upholdDispute(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(disputeRulingSchema)) body: DisputeRulingDto,
  ): Promise<void> {
    await this.corrections.resolveDispute(id, {
      upheld: body.upheld ?? true,
      ...(body.note ? { note: body.note } : {}),
    });
  }

  // ---------------------------------------------------------- sampling admin --

  /**
   * Read as well as write carries `qc.sampling.write`, deliberately.
   *
   * The rule table says how little of a GOLD vendor's stock we look at.
   * `qc.report.read` — which every vendor role holds — would put that in the
   * hands of the people it is a control on.
   */
  @Get('sampling-rules')
  @RequirePermissions('qc.sampling.write')
  samplingRules(): Promise<SamplingRuleRow[]> {
    return this.console.samplingRules();
  }

  @Post('sampling-rules')
  @HttpCode(200)
  @RequirePermissions('qc.sampling.write')
  saveSamplingRule(
    @Body(new ZodValidationPipe(samplingRuleSchema)) body: SamplingRuleDto,
  ): Promise<SamplingRuleRow> {
    return this.console.saveSamplingRule(body);
  }

  // ------------------------------------------------------------ audit queue --

  @Get('audit')
  @RequirePermissions('qc.audit.recheck')
  audit(): Promise<AuditDashboard> {
    return this.console.auditDashboard();
  }

  /**
   * Record a completed recheck against the report it re-inspected.
   *
   * The auditor is the signed-in user, never a field in the body — the whole
   * point of the number this produces is that somebody other than the original
   * technician looked, and a client-supplied auditor id would make that
   * unprovable.
   */
  @Post('audit/:reportId')
  @HttpCode(200)
  @RequirePermissions('qc.audit.recheck')
  async recordRecheck(
    @Param('reportId', new ZodValidationPipe(uuidSchema)) reportId: string,
    @Body(new ZodValidationPipe(auditRecheckSchema)) body: AuditRecheckDto,
    @CurrentUser() user: Principal,
  ): Promise<{ gradeDiffers: boolean; divergenceRatePct: number | null }> {
    const outcome = await this.audits.recordRecheck({
      originalReportId: reportId,
      recheckReportId: body.recheckReportId,
      auditorId: user.userId,
    });
    return {
      gradeDiffers: outcome.divergence.gradeDiffers,
      divergenceRatePct: outcome.technician.divergenceRatePct,
    };
  }

  // -------------------------------------------------------- tool providers --

  @Get('tool-providers')
  @RequirePermissions('qc.report.ingest')
  toolProviders(): Promise<ToolProviderRow[]> {
    return this.console.toolProviders();
  }

  @Put('tool-providers/:id/field-map')
  @RequirePermissions('qc.report.ingest')
  saveFieldMap(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(fieldMapSchema)) body: FieldMapDto,
  ): Promise<ToolProviderRow> {
    return this.console.saveFieldMap(id, body.fieldMapJson);
  }

}

/**
 * The seal's photograph, out of the photographs the app already uploaded.
 *
 * `qc_seal.applied_photo_key` is NOT NULL, and deliberately: there is no seal
 * without a photograph of it on the machine. A sealed unit whose seal shot went
 * missing is refused here rather than written with an empty key that resolves
 * to nothing the day somebody disputes the grade.
 */
function sealPhotoKey(body: UnitResultDto): string {
  const shot = body.photoHashes.find((p) => p.angle === 'SEAL');
  if (!shot) {
    throw new ValidationError('A seal needs a photograph of it on the machine.', {
      sealCode: 'Photograph the seal before recording it.',
    });
  }
  return `qc/photos/${shot.sha256}.jpg`;
}

/**
 * What multer hands us, narrowed to the four fields this file reads.
 *
 * `@types/multer` is not a dependency, so `Express.Multer.File` does not exist
 * in this project's ambient types. Declaring the shape we actually use beats
 * adding a types package to describe a value we touch in one method.
 */
interface MultipartFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
