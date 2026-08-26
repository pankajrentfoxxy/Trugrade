import type { Grade } from '@trugrade/contracts';

/**
 * The shapes the QC console reads, and the endpoints it reads them from.
 *
 * This file is a **request to the API lanes**, not a description of something
 * that exists yet. Task 8 is built first on purpose — it is the fallback if the
 * mobile app slips — so the console necessarily names its endpoints before they
 * are written. Everything below is one screen's worth of columns off the schema,
 * renamed to camelCase at the DTO boundary and nothing more.
 *
 *   GET  /api/qc/visits?status&vendorOrgId&technicianId&from&to  -> VisitRow[]
 *   GET  /api/qc/visits/:visitId                                 -> VisitDetail
 *   GET  /api/qc/schedule?from                                   -> ScheduleWeek
 *   GET  /api/qc/technicians                                     -> TechnicianOption[]
 *   POST /api/qc/reports/manual                                  -> { reportId }
 *   POST /api/qc/visits/:visitId/units/:visitUnitId/untestable   -> 204
 *   POST /api/qc/photos            (multipart, field `file`)     -> UploadedFile
 *   GET  /api/qc/grade-corrections                               -> GradeCorrectionRow[]
 *   POST /api/qc/grade-corrections/:id/uphold-dispute            -> 204
 *   GET  /api/qc/sampling-rules                                  -> SamplingRuleRow[]
 *   POST /api/qc/sampling-rules                                  -> SamplingRuleRow
 *   GET  /api/qc/audit                                           -> AuditDashboard
 *   GET  /api/qc/tool-providers                                  -> ToolProviderRow[]
 *   PUT  /api/qc/tool-providers/:id/field-map                    -> ToolProviderRow
 *
 * Three conventions the whole file depends on:
 *
 * **Money arrives as a fixed-2dp decimal string** — `Money.toJSON()` — and is
 * rendered through `money(s).format()`. `Number()` on a rupee amount is the
 * float bug this codebase keeps nearly shipping, and a console is exactly where
 * it would go unnoticed.
 *
 * **No clock in the browser.** Anything that is "N hours from now" is computed
 * server-side and sent as a number, because the two-day grade-correction window
 * is a money deadline and a laptop with a wrong clock must not be able to move
 * it. That is also why `ScheduleWeek` carries its own `from`/`to` rather than
 * the console deciding what "this week" means.
 *
 * **No hard-coded thresholds.** Every number that has a `platform_config` key —
 * the geo-variance alert distance, the audit recheck percentage — travels on the
 * DTO that needs it. A console that renders 500 m from a literal is a console
 * that lies the day someone changes the key.
 *
 * Vendor legal names appear here deliberately. The anonymity contract (VR-099)
 * governs **customer-facing** payloads; this console is staff-only, and a QC
 * manager who cannot see which vendor a visit belongs to cannot do the job.
 */

// ---------------------------------------------------------------------------
// The twelve inspection areas
// ---------------------------------------------------------------------------

/**
 * `qc.qc_area_result.area`, exactly as the live CHECK constraint allows it.
 *
 * *** These are NOT the twelve areas `PHASE_04_QC.md` Task 3 lists, and they are
 * NOT `QC_AREAS` in `@trugrade/contracts`. *** Both of those name a cosmetic
 * vocabulary — chassis, lid, palmrest, trackpad, hinges, screen — and posting
 * any of them fails `qc_area_result_area_check` on every row. SQL is the source
 * of truth, so the schema's list wins. The cosmetic vocabulary is real, but it
 * belongs to `catalog.grade_definition`, which decides the *condition* grade;
 * these twelve are functional subsystems, which decide PASS/WARN/FAIL.
 *
 * This is the third hand-written copy of the list in the repo (the API's
 * `qc.dto.ts` holds the second) and it should be the last. `QC_AREAS`/`QcArea`
 * in `packages/contracts/src/rules.ts` need replacing with these codes; that
 * package is owned elsewhere, so this is flagged rather than edited.
 *
 * ponytail: delete this block and import the codes from `@trugrade/contracts`
 * the day that change lands.
 */
export const QC_AREA_CODES = Object.freeze([
  'DISPLAY',
  'KEYBOARD',
  'BATTERY',
  'STORAGE',
  'MEMORY_CPU',
  'PORTS',
  'CONNECTIVITY',
  'CAMERA_AUDIO',
  'THERMAL',
  'BIOS_SECURITY',
  'DATA_SECURITY',
  'PHYSICAL',
] as const);
export type QcAreaCode = (typeof QC_AREA_CODES)[number];

/** What a technician reads on the form. The wire value is always the code. */
export const AREA_LABEL: Readonly<Record<QcAreaCode, string>> = Object.freeze({
  DISPLAY: 'Display',
  KEYBOARD: 'Keyboard',
  BATTERY: 'Battery',
  STORAGE: 'Storage',
  MEMORY_CPU: 'Memory and CPU',
  PORTS: 'Ports',
  CONNECTIVITY: 'Wi-Fi and Bluetooth',
  CAMERA_AUDIO: 'Camera and audio',
  THERMAL: 'Thermals',
  BIOS_SECURITY: 'BIOS and firmware locks',
  DATA_SECURITY: 'Data wipe and MDM',
  PHYSICAL: 'Physical condition',
});

/**
 * `qc_area_result.status`. Three values, not four.
 *
 * The column's CHECK has no NOT_MEASURED, so an unmeasured area is recorded as
 * an **absent row** — never as PASS. A missing value is not a passing value
 * (07 section 2), and the form says exactly that where the choice is made.
 */
export const AREA_STATUSES = Object.freeze(['PASS', 'WARN', 'FAIL'] as const);
export type AreaStatus = (typeof AREA_STATUSES)[number];

export const VISIT_STATUSES = Object.freeze([
  'REQUESTED',
  'QUOTED',
  'SCHEDULED',
  'TECH_ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
  'NO_SHOW_VENDOR',
  'NO_SHOW_TECH',
  'RESCHEDULED',
] as const);
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export type UnitOutcome =
  | 'PENDING'
  | 'PASS'
  | 'PASS_GRADE_CORRECTED'
  | 'PASS_WITH_NOTE'
  | 'FAIL'
  | 'UNTESTABLE'
  | 'ABSENT';

export type Verdict = 'PASS' | 'PASS_WITH_NOTE' | 'MISMATCH' | 'FAIL';

/** `qc_photo.angle`. The seal photograph is not one of these — it is on `qc_seal`. */
export const PHOTO_ANGLES = Object.freeze([
  'LID',
  'PALMREST',
  'SCREEN_ON',
  'BASE',
  'PORTS',
  'WORST_DEFECT',
] as const);
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];

export const PHOTO_LABEL: Readonly<Record<PhotoAngle, string>> = Object.freeze({
  LID: 'Lid, closed',
  PALMREST: 'Palmrest and keyboard',
  SCREEN_ON: 'Screen, powered on',
  BASE: 'Base',
  PORTS: 'Ports',
  WORST_DEFECT: 'Worst defect on the machine',
});

export type SealState = 'APPLIED' | 'INTACT' | 'BROKEN' | 'MISSING' | 'REPLACED';

// ---------------------------------------------------------------------------
// The visit board and the calendar
// ---------------------------------------------------------------------------

export interface VisitRow {
  id: string;
  visitNumber: string;
  status: VisitStatus;
  vendorOrgId: string;
  vendorName: string;
  facilityLabel: string;
  /** `YYYY-MM-DD`. A visit is one technician, one site, one day — never an instant. */
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
  /** Null until check-in. Above `qc.geo_variance_alert_metres` this is an alert. */
  geoVarianceMetres: number | null;
  /** The threshold in force, so the console never hard-codes 500 m. */
  geoVarianceAlertMetres: number;
}

export interface VisitBoardFilters {
  status?: VisitStatus;
  technicianId?: string;
  vendorOrgId?: string;
  from?: string;
  to?: string;
}

export interface ScheduleTechnicianDay {
  date: string;
  availability: 'AVAILABLE' | 'BOOKED' | 'LEAVE' | 'TRAVEL' | 'HOLIDAY' | 'UNSET';
  /** Units already committed on this date across every visit assigned. */
  bookedUnits: number;
  sites: number;
  visits: Array<{ id: string; visitNumber: string; vendorName: string; units: number }>;
}

export interface ScheduleTechnician {
  id: string;
  name: string;
  employeeCode: string;
  zones: string[];
  certifiedTools: string[];
  dailyCapacityUnits: number;
  maxSitesPerDay: number;
  days: ScheduleTechnicianDay[];
}

export interface ScheduleWeek {
  /** Both `YYYY-MM-DD`. The server decides what "this week" is; see the header. */
  from: string;
  to: string;
  dates: string[];
  technicians: ScheduleTechnician[];
  /**
   * `qc_tool_provider.licence_seats` — a hard cap on how many technicians can be
   * certifying at once. Scheduling a thirteenth technician against twelve seats
   * produces a day where somebody's agent simply refuses to run, in a warehouse,
   * with the vendor watching.
   */
  licence: Array<{ providerCode: string; seats: number; seatsUsedPerDate: Record<string, number> }>;
}

// ---------------------------------------------------------------------------
// One visit, in full
// ---------------------------------------------------------------------------

export interface ManifestUnit {
  visitUnitId: string;
  unitId: string;
  sequenceNo: number;
  /** As declared on the listing. The inspection compares the scan against this. */
  serialNumber: string;
  listingId: string | null;
  skuLabel: string;
  declaredGrade: Grade | null;
  outcome: UnitOutcome;
  absentReason: string | null;
  qcReportId: string | null;
  durationSeconds: number | null;
}

export interface ToolRunRow {
  id: string;
  toolProviderCode: string;
  toolVersion: string;
  /** Null when the provider's payload carried none — then there is no idempotency. */
  toolRunId: string | null;
  parseStatus: 'PENDING' | 'PARSED' | 'PARSE_FAILED' | 'MANUAL_ENTRY';
  parseError: string | null;
  serialFromTool: string | null;
  serialMatches: boolean | null;
  rawReportHash: string;
  /** The payload exactly as it arrived. Stored before parsing; this is the evidence. */
  rawReportJson: unknown;
  ingestedAt: string;
}

export interface PhotoRow {
  angle: PhotoAngle;
  fileKey: string;
  /** Signed and short-lived. The console never constructs an object-store URL. */
  url: string;
  capturedAt: string | null;
}

export interface SealRow {
  sealCode: string;
  status: SealState;
  appliedAt: string;
  appliedByName: string;
  /** NOT NULL in the schema. There is no seal without a photograph. */
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
  /** Decimal string. */
  visitFee: string | null;
  feeBearer: 'TRUETECH' | 'VENDOR' | 'SPLIT' | 'WAIVED' | null;
  notes: string | null;
  manifest: ManifestUnit[];
  toolRuns: ToolRunRow[];
  photos: PhotoRow[];
  seals: SealRow[];
}

// ---------------------------------------------------------------------------
// The manual inspection
// ---------------------------------------------------------------------------

export interface UploadedFile {
  fileKey: string;
  url: string;
  /** SHA-256 hex, computed server-side over the stored bytes. */
  hash: string;
}

export interface TechnicianOption {
  id: string;
  name: string;
  employeeCode: string;
  isActive: boolean;
}

/** Three-valued on purpose: "we did not check" is not "no". */
export type Tristate = 'YES' | 'NO' | 'UNKNOWN';

export interface ManualInspectionPayload {
  visitId: string;
  visitUnitId: string;
  unitId: string;
  technicianId: string;
  serialScanned: string;
  serialMatches: boolean;
  startedAt: string;
  completedAt: string;
  areaResults: Array<{
    area: QcAreaCode;
    status: AreaStatus;
    score: number;
    maxScore: number;
    note: string | null;
  }>;
  /** Areas deliberately not measured, so the absence is a decision and not a gap. */
  areasNotMeasured: QcAreaCode[];
  hardware: {
    ramDetectedGb: number | null;
    ramModules: number | null;
    storageType: string | null;
    storageDetectedGb: number | null;
    smartStatus: 'OK' | 'WARNING' | 'FAILING' | null;
    batteryHealthPct: number | null;
    /** Null means "not reported by this system". Zero would be a measurement. */
    cycleCount: number | null;
    biosLocked: Tristate;
    mdmLocked: Tristate;
    computraceActive: Tristate;
  };
  photos: Array<{ angle: PhotoAngle; fileKey: string; hash: string }>;
  seal: { sealCode: string; photoKey: string; photoHash: string } | null;
  qcScore: number;
  gradeProposed: Grade | null;
  gradeFinal: Grade | null;
  gradeOverrideReason: string | null;
  verdict: Verdict;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Grade corrections, sampling, audit, tool providers
// ---------------------------------------------------------------------------

export interface GradeCorrectionRow {
  id: string;
  unitId: string;
  serialNumber: string;
  skuLabel: string;
  vendorName: string;
  gradeDeclared: Grade;
  gradeCorrected: Grade;
  reason: string;
  /** Decimal strings, or null where the listing carried no price yet. */
  priceBefore: string | null;
  priceSuggested: string | null;
  vendorNotifiedAt: string;
  vendorResponse: 'ACCEPT_NEW_GRADE' | 'ACCEPT_AND_REPRICE' | 'WITHDRAW_UNIT' | 'DISPUTE' | null;
  vendorRespondedAt: string | null;
  autoAppliedAt: string | null;
  /**
   * Server-computed, negative once the window has passed. The console must not
   * derive this from a browser clock — see the header.
   */
  hoursUntilAutoApply: number;
  countsAgainstAccuracy: boolean;
}

export interface SamplingRuleRow {
  id: string;
  vendorTier: 'WATCHLIST' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
  minUnitsInspected: number;
  /** Percentages, 0–100, as decimal strings so the DB scale survives the trip. */
  minPassRate: string;
  minGradeAccuracy: string;
  samplePct: string;
  /** Decimal string, or null for "no full-inspection threshold". */
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
  /** Whatever the two reports disagreed about, field by field. */
  divergence: Record<string, { original: unknown; recheck: unknown }>;
  createdAt: string;
}

export interface TechnicianDivergenceRow {
  technicianId: string;
  name: string;
  employeeCode: string;
  unitsInspectedTotal: number;
  rechecked: number;
  diverged: number;
  /** Percentage, 0–100, as stored on `qc_technician.divergence_rate`. */
  divergenceRate: string;
  isActive: boolean;
}

export interface AuditDashboard {
  /** `qc.audit_recheck_pct` in force, so the console never hard-codes 5. */
  targetRecheckPct: number;
  /** Above this a technician is a training problem before it is a fraud problem. */
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
  /** OUR FIELD -> THEIR PATH. Every seeded provider uses that direction. */
  fieldMapJson: Record<string, string>;
}
