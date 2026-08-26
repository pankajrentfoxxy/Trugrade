import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Money,
  moneyFromDb,
  VERIFICATION_CODE_ALPHABET,
  VERIFICATION_CODE_LENGTH,
  type Grade,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ConflictError } from '../../../shared/errors/domain-errors';
import type {
  AvailabilityStatus,
  EmploymentType,
  MismatchResolution,
  MismatchSeverity,
  ParseStatus,
  QcAreaCode,
  QcAreaStatus,
  QcLocationType,
  QcPhotoAngle,
  QcUnitOutcome,
  QcVerdictValue,
  QcVisitStatus,
  ReverificationMethod,
  ReverificationOutcome,
  ReverificationTrigger,
  SealStatus,
  SmartStatus,
  ToleranceComparison,
  VendorTier,
  VisitFeeBearer,
  WipeVerificationStatus,
} from '../dto/qc.dto';

/**
 * Every statement that touches the nineteen `qc.*` tables and the two `qc.*`
 * views. Five sibling services build on this file, so it exists to make sure
 * none of them re-derives row mapping — five mappers for `qc_report` that agree
 * today is five that disagree after the first schema change.
 *
 * Four jobs are this layer's and nothing else's:
 *
 *   1. **Converting at the boundary.** `visit_fee`, `discount_amount` and
 *      `always_full_above_value` are NUMERIC(14,2) and go through `moneyFromDb`;
 *      `Number(row.visit_fee)` is the float bug this codebase keeps nearly
 *      shipping (VR-126). `Number()` is used only where the column is genuinely
 *      a ratio, a percentage or a coordinate — `score`, `battery_health_pct`,
 *      `divergence_rate`, `arrival_geo_lat`. Nothing above this file sees a
 *      Decimal, and nothing above it sees a Money where a percentage was meant.
 *
 *   2. **Turning constraint violations into answers.** Three UNIQUEs decide how
 *      this phase behaves under retry, and each gets a typed error or a
 *      deliberate non-error rather than a 500. See `NonceReplayError`,
 *      `CurrentReportExistsError` and `insertToolRun`.
 *
 *   3. **Superseding, never overwriting.** `supersedeReport` is one transaction
 *      that closes the old report and opens the new one. History is the evidence
 *      — a re-inspection that UPDATEs the previous row destroys the only record
 *      of what we told a buyer three weeks ago.
 *
 *   4. **Generating the public verification code.** One generator, used by every
 *      caller, because `/qc/verify/:code` is a public URL and an enumerable one
 *      publishes the entire inventory to anyone with a for-loop.
 *
 * DATE and TIME columns are read as `::text`. Prisma hands a bare `date` back as
 * a `Date` at UTC midnight, and every business window in this system is reckoned
 * in Asia/Kolkata (VR-160) — so a `valid_until` of 2026-11-24 becomes the 23rd
 * for anyone reading it locally, and a QC report expires a day early on paper.
 * A `YYYY-MM-DD` string cannot do that.
 *
 * Org scoping is **explicit here, not ambient.** The listing repository welds
 * the caller's org into its `WHERE`; this one takes `vendorOrgId` as a filter
 * instead, because two of the callers have no principal at all — the DeviceSure
 * webhook and the nightly aggregate job — and `OrgScope` throws without one. QC
 * rows are also platform-owned: a visit is our inspection of a vendor's stock,
 * not the vendor's record. Vendor-facing exposure is enforced at the DTO
 * boundary by the lane that owns the endpoint.
 */

// ---------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------

/**
 * A `nonce` that has been seen before, on either `qc_report` or `qc_tool_run`.
 *
 * This is a replay, not a retry: the nonce is inside the signed payload, so the
 * same nonce on a second submission means somebody re-sent a certificate that
 * was already accepted — possibly against a different unit. It is a 409 and an
 * alert, never a silent second row (QC-004).
 */
export class NonceReplayError extends ConflictError {
  constructor(nonce: string) {
    super('This inspection report has already been submitted.', {
      reason: 'nonce_replay',
      nonce,
    });
  }
}

/**
 * `uq_qcrep_current` — exactly one live report per machine.
 *
 * Reaching this means a caller tried to create a second current report instead
 * of superseding the first. That is the bug the index exists to catch, and the
 * fix is `supersedeReport`, never a DELETE.
 */
export class CurrentReportExistsError extends ConflictError {
  constructor(unitId: string) {
    super(
      'This unit already has a live inspection report. A re-inspection supersedes it rather than replacing it.',
      { reason: 'current_report_exists', unitId },
    );
  }
}

/** `qc_seal.seal_code` is UNIQUE across every roll we have ever issued. */
export class SealCodeInUseError extends ConflictError {
  constructor(sealCode: string) {
    super(`Seal ${sealCode} has already been applied to a unit.`, {
      reason: 'seal_code_in_use',
      sealCode,
    });
  }
}

/**
 * Which rule the database refused, from a failed raw statement.
 *
 * Prisma reports a raw-query failure as P2010 with the SQLSTATE in `meta.code`,
 * but not on every driver path, so the message is read as a fallback.
 *
 * The subtlety that matters, and that cost a debugging session: for a unique
 * violation Prisma surfaces Postgres's *detail* line — `Key (nonce)=(abc)
 * already exists.` — and **not** the constraint name. So matching on
 * `constraint "..."` silently never fires and every 23505 falls through as a
 * 500. The key columns are the reliable signal, and they are what this reads.
 * The constraint name is still checked because some driver paths do include it.
 *
 * This distinction is load-bearing rather than cosmetic: `qc_tool_run` carries
 * two UNIQUEs that mean opposite things — a repeated nonce is a replay to
 * refuse, a repeated `(tool_provider_id, tool_run_id)` is an idempotent
 * re-delivery to acknowledge with a 200.
 */
interface PgFailure {
  state: string;
  /** True when the refused rule involves `column`, by key column or by name. */
  involves(column: string): boolean;
}

function pgFailure(e: unknown): PgFailure {
  const meta = (e as { meta?: { code?: string; message?: string } } | undefined)?.meta;
  const text = `${meta?.message ?? ''} ${(e as { message?: string } | undefined)?.message ?? ''}`;
  const name = /constraint "([^"]+)"|index "([^"]+)"/.exec(text)?.slice(1).find(Boolean) ?? '';
  const keyColumns = (/Key \(([^)]+)\)=/.exec(text)?.[1] ?? '')
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);

  return {
    state:
      typeof meta?.code === 'string' ? meta.code : (/\b(23505|23P01|23514)\b/.exec(text)?.[1] ?? ''),
    involves: (column) => keyColumns.includes(column) || name.includes(column),
  };
}

/**
 * The public verification code, from the CSPRNG.
 *
 * One generator for every caller. `VERIFICATION_CODE_ALPHABET` is 32 characters
 * of Crockford base32 — I, L, O and U removed so a person can retype it off a
 * printed certificate — and 32 is a power of two, so masking a random byte with
 * `& 31` is uniform. A `% alphabet.length` on a non-power-of-two alphabet would
 * bias the low characters, which is the classic way a "random" code becomes
 * guessable one character at a time.
 *
 * 14 characters of a 32-symbol alphabet is 70 bits. `chk_verification_code_
 * unguessable` requires at least 12 as a backstop for the day someone reaches
 * for a counter; this is the thing that stops them needing to.
 */
export function generateVerificationCode(): string {
  const bytes = randomBytes(VERIFICATION_CODE_LENGTH);
  let out = '';
  for (const b of bytes) out += VERIFICATION_CODE_ALPHABET[b & 31];
  return out;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface QcReportRow {
  id: string;
  unitId: string;
  visitId: string | null;
  toolRunId: string | null;
  technicianId: string;
  deviceCertId: string;
  agentVersion: string;
  startedAt: Date;
  completedAt: Date | null;
  /** 0–100, an integer column. */
  qcScore: number | null;
  verdict: QcVerdictValue | null;
  gradeProposed: Grade | null;
  gradeFinal: Grade | null;
  gradeOverrideReason: string | null;
  reportPdfKey: string | null;
  signature: string;
  nonce: string;
  verificationCode: string | null;
  locationType: QcLocationType;
  locationAddressId: string | null;
  /** `YYYY-MM-DD`. A DATE, deliberately not a Date — see the file header. */
  validUntil: string | null;
  supersededById: string | null;
  isCurrent: boolean;
  rulesVersion: string | null;
  deviceFingerprint: string | null;
}

export interface QcToolRunRow {
  id: string;
  visitUnitId: string | null;
  unitId: string;
  toolProviderId: string;
  toolVersion: string;
  /** The provider's own run id. Nullable — it arrives with the payload. */
  toolRunId: string | null;
  deviceCertId: string;
  rawReportKey: string | null;
  rawReportJson: unknown;
  rawReportHash: string;
  parseStatus: ParseStatus;
  parseError: string | null;
  serialFromTool: string | null;
  serialMatches: boolean | null;
  startedAt: Date | null;
  completedAt: Date | null;
  signature: string | null;
  nonce: string | null;
  ingestedAt: Date;
}

export interface QcAreaResultRow {
  id: string;
  qcReportId: string;
  area: QcAreaCode;
  /** A points score, not money. */
  score: number;
  maxScore: number;
  status: QcAreaStatus;
  detailsJson: unknown;
}

export interface QcHardwareRow {
  qcReportId: string;
  hwSerial: string;
  hwModel: string | null;
  biosVersion: string | null;
  biosDate: string | null;
  cpuDetected: string | null;
  cores: number | null;
  threads: number | null;
  /**
   * What the tool reported, verbatim.
   *
   * On Windows this is `TotalPhysicalMemory`, i.e. memory **usable by the OS** —
   * 15 GB on a 16 GB machine (07 §3.4). It is stored as reported and corrected
   * nowhere in this layer. `compareSpec()` in `@trugrade/contracts` already
   * separates usable from installed and renders "16 GB installed (15 GB
   * usable)". A `+1` here would be a repository quietly correcting its source,
   * and the real fix is in DeviceSure's collector.
   */
  ramDetectedGb: number;
  ramModules: number | null;
  ramType: string | null;
  ramSpeedMhz: number | null;
  storageType: string | null;
  storageDetectedGb: number | null;
  storageModel: string | null;
  smartStatus: SmartStatus | null;
  powerOnHours: number | null;
  tbwGb: number | null;
  gpuDetected: string | null;
  panelId: string | null;
  /** Inches. NUMERIC(4,1) — a measurement, so `Number` is right here. */
  screenSize: number | null;
  batteryDesignWh: number | null;
  batteryFullWh: number | null;
  /** A percentage. `null` means not reported, which is not the same as 0. */
  batteryHealthPct: number | null;
  cycleCount: number | null;
  wifiChip: string | null;
  btPresent: boolean | null;
  tpmVersion: string | null;
  secureBoot: boolean | null;
  biosLocked: boolean;
  mdmLocked: boolean;
  computraceActive: boolean;
  /** The tool's own hardware block, kept whole. Anything the columns cannot hold lives here. */
  rawJson: unknown;
}

export interface QcMismatchRow {
  id: string;
  qcReportId: string;
  field: string;
  declaredValue: string;
  actualValue: string;
  severity: MismatchSeverity;
  resolution: MismatchResolution | null;
  discountAmount: Money | null;
  buyerNotifiedAt: Date;
  buyerDecisionAt: Date | null;
  penaltyId: string | null;
}

export interface QcPhotoRow {
  id: string;
  qcReportId: string;
  angle: QcPhotoAngle;
  fileKey: string;
  hash: string;
  capturedAt: Date;
}

export interface QcSealRow {
  id: string;
  sealCode: string;
  unitId: string;
  qcReportId: string;
  /** A `qc.qc_technician.id`, the same identity as `qc_report.technician_id`. */
  appliedBy: string;
  appliedAt: Date;
  /** NOT NULL in the schema. There is no seal without a photograph. */
  appliedPhotoKey: string;
  status: SealStatus;
  verifiedAt: Date | null;
  /** An `identity.user_account.id`, on purpose: pickup verification is logistics staff. */
  verifiedBy: string | null;
  verifiedPhotoKey: string | null;
  brokenAt: Date | null;
  brokenReason: string | null;
  replacedBySealId: string | null;
}

export interface QcVisitRow {
  id: string;
  visitNumber: string;
  vendorOrgId: string;
  facilityId: string;
  addressId: string;
  requestedBy: string | null;
  requestedAt: Date;
  unitsRequested: number;
  unitsPresented: number | null;
  unitsInspected: number;
  unitsPassed: number;
  unitsGradeCorrected: number;
  unitsFailed: number;
  unitsAbsent: number;
  technicianId: string | null;
  toolProviderId: string | null;
  /** `YYYY-MM-DD`. */
  scheduledDate: string | null;
  /** `HH:MM:SS`. A TIME column, read as text — see the file header. */
  slotFrom: string | null;
  slotTo: string | null;
  status: QcVisitStatus;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Coordinates, not money. */
  arrivalGeoLat: number | null;
  arrivalGeoLng: number | null;
  geoVarianceMetres: number | null;
  vendorContactId: string | null;
  vendorOtpHash: string | null;
  vendorSignoffAt: Date | null;
  vendorSignoffName: string | null;
  /** Money. NUMERIC(14,2). */
  visitFee: Money;
  feeBearer: VisitFeeBearer;
  feeWaiverReason: string | null;
  rescheduleCount: number;
  cancellationReason: string | null;
  notes: string | null;
}

export interface QcVisitUnitRow {
  id: string;
  visitId: string;
  unitId: string;
  /** The serial on the manifest — what `serial_from_tool` is compared against. */
  serialNumber: string;
  listingId: string | null;
  sequenceNo: number | null;
  outcome: QcUnitOutcome;
  qcReportId: string | null;
  absentReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationSeconds: number | null;
}

export interface QcTechnicianRow {
  id: string;
  userId: string;
  employeeCode: string;
  homePincode: string;
  zones: string[];
  certifiedTools: string[];
  deviceCertId: string | null;
  dailyCapacityUnits: number;
  maxSitesPerDay: number;
  employmentType: EmploymentType;
  /** A rate, not money. */
  divergenceRate: number | null;
  unitsInspectedTotal: number;
  isActive: boolean;
  createdAt: Date;
}

export interface TechnicianAvailabilityRow {
  id: string;
  technicianId: string;
  /** `YYYY-MM-DD`. */
  theDate: string;
  /** `HH:MM:SS`. */
  slotFrom: string;
  slotTo: string;
  status: AvailabilityStatus;
  note: string | null;
}

export interface QcSamplingRuleRow {
  id: string;
  vendorTier: VendorTier | null;
  minUnitsInspected: number;
  /** Percentages. */
  minPassRate: number | null;
  minGradeAccuracy: number | null;
  samplePct: number;
  /** Money: full inspection is forced above this consignment value. */
  alwaysFullAboveValue: Money | null;
  effectiveFrom: string;
  isActive: boolean;
}

export interface QcToleranceRuleRow {
  id: string;
  field: string;
  comparison: ToleranceComparison;
  /**
   * Deliberately TEXT in the schema: a tolerance is `2` for GTE, `5` for
   * WITHIN_PCT and a band name for ONE_BAND_DOWN. The engine parses it against
   * `comparison`; the column cannot type it and should not pretend to.
   */
  toleranceValue: string | null;
  severity: MismatchSeverity;
  isBlocking: boolean;
  effectiveFrom: string;
}

export interface QcReverificationRow {
  id: string;
  unitId: string;
  originalReportId: string;
  trigger: ReverificationTrigger;
  method: ReverificationMethod;
  performedBy: string | null;
  performedAt: Date;
  sealCodeScanned: string | null;
  sealIntact: boolean | null;
  serialScanned: string | null;
  serialMatches: boolean | null;
  fingerprintHash: string | null;
  fingerprintMatches: boolean | null;
  outcome: ReverificationOutcome;
  photoKeys: string[];
  notes: string | null;
}

export interface QcAuditRecheckRow {
  id: string;
  originalReportId: string;
  recheckReportId: string;
  divergenceJson: unknown;
  auditorId: string;
  createdAt: Date;
}

export interface WipeCertificateRow {
  id: string;
  unitId: string;
  method: string;
  standard: string;
  passes: number;
  verificationStatus: WipeVerificationStatus;
  certificateKey: string | null;
  hash: string | null;
  issuedAt: Date;
}

export interface VendorSkuQualityRow {
  vendorOrgId: string;
  skuId: string;
  grade: Grade;
  unitsInspected: number;
  /** Scores and percentages. Never money. */
  avgQcScore: number | null;
  medianQcScore: number | null;
  batteryHealthMin: number | null;
  batteryHealthMax: number | null;
  gradeCorrections: number;
  gradeAccuracyPct: number | null;
  lastInspectedAt: Date | null;
  computedAt: Date;
}

export type VendorQualityRow = Omit<VendorSkuQualityRow, 'skuId' | 'grade'>;

export interface QcToolProviderRow {
  id: string;
  code: string;
  name: string;
  vendorCompany: string | null;
  integrationType: string;
  reportFormat: string;
  /**
   * OUR field name -> THEIR payload path, e.g. `{"serial":"device.serial"}`.
   * All four seeded providers use that direction; reversing it parses to
   * garbage the first time the generic parser is reused.
   */
  fieldMapJson: Record<string, unknown>;
  supportsWipe: boolean;
  wipeStandard: string | null;
  licenceExpiry: string | null;
  /** A hard cap on concurrent technicians. NULL is "no cap recorded", never zero. */
  licenceSeats: number | null;
  costPerScanPaise: number | null;
  isActive: boolean;
}

/** `qc.v_expiring_qc`. Carries `legalName` — a vendor identifier that must never reach a buyer response. */
export interface ExpiringQcRow {
  vendorOrgId: string;
  legalName: string;
  listingId: string | null;
  unitsExpiring: number;
  earliestExpiry: string | null;
}

/** `qc.v_visit_economics`. The number that says whether QC-at-source is economic. */
export interface VisitEconomicsRow {
  id: string;
  visitNumber: string;
  vendorOrgId: string;
  scheduledDate: string | null;
  unitsRequested: number;
  unitsInspected: number;
  unitsPassed: number;
  unitsFailed: number;
  totalExpense: Money;
  costPerUnit: Money | null;
  hoursOnSite: number | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** NUMERIC that is genuinely a ratio, a score or a coordinate. Never money. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const int = (v: unknown): number => Number(v ?? 0);

type Raw = Record<string, unknown>;

function toReport(r: Raw): QcReportRow {
  return {
    id: r.id as string,
    unitId: r.unit_id as string,
    visitId: r.visit_id as string | null,
    toolRunId: r.tool_run_id as string | null,
    technicianId: r.technician_id as string,
    deviceCertId: r.device_cert_id as string,
    agentVersion: r.agent_version as string,
    startedAt: r.started_at as Date,
    completedAt: r.completed_at as Date | null,
    qcScore: r.qc_score as number | null,
    verdict: r.verdict as QcVerdictValue | null,
    gradeProposed: r.grade_proposed as Grade | null,
    gradeFinal: r.grade_final as Grade | null,
    gradeOverrideReason: r.grade_override_reason as string | null,
    reportPdfKey: r.report_pdf_key as string | null,
    signature: r.signature as string,
    nonce: r.nonce as string,
    verificationCode: r.verification_code as string | null,
    locationType: r.location_type as QcLocationType,
    locationAddressId: r.location_address_id as string | null,
    validUntil: r.valid_until as string | null,
    supersededById: r.superseded_by_id as string | null,
    isCurrent: r.is_current as boolean,
    rulesVersion: r.rules_version as string | null,
    deviceFingerprint: r.device_fingerprint as string | null,
  };
}

function toToolRun(r: Raw): QcToolRunRow {
  return {
    id: r.id as string,
    visitUnitId: r.visit_unit_id as string | null,
    unitId: r.unit_id as string,
    toolProviderId: r.tool_provider_id as string,
    toolVersion: r.tool_version as string,
    toolRunId: r.tool_run_id as string | null,
    deviceCertId: r.device_cert_id as string,
    rawReportKey: r.raw_report_key as string | null,
    rawReportJson: r.raw_report_json,
    rawReportHash: r.raw_report_hash as string,
    parseStatus: r.parse_status as ParseStatus,
    parseError: r.parse_error as string | null,
    serialFromTool: r.serial_from_tool as string | null,
    serialMatches: r.serial_matches as boolean | null,
    startedAt: r.started_at as Date | null,
    completedAt: r.completed_at as Date | null,
    signature: r.signature as string | null,
    nonce: r.nonce as string | null,
    ingestedAt: r.ingested_at as Date,
  };
}

function toAreaResult(r: Raw): QcAreaResultRow {
  return {
    id: String(r.id),
    qcReportId: r.qc_report_id as string,
    area: r.area as QcAreaCode,
    score: Number(r.score),
    maxScore: Number(r.max_score),
    status: r.status as QcAreaStatus,
    detailsJson: r.details_json,
  };
}

function toHardware(r: Raw): QcHardwareRow {
  return {
    qcReportId: r.qc_report_id as string,
    hwSerial: r.hw_serial as string,
    hwModel: r.hw_model as string | null,
    biosVersion: r.bios_version as string | null,
    biosDate: r.bios_date as string | null,
    cpuDetected: r.cpu_detected as string | null,
    cores: r.cores as number | null,
    threads: r.threads as number | null,
    ramDetectedGb: r.ram_detected_gb as number,
    ramModules: r.ram_modules as number | null,
    ramType: r.ram_type as string | null,
    ramSpeedMhz: r.ram_speed_mhz as number | null,
    storageType: r.storage_type as string | null,
    storageDetectedGb: r.storage_detected_gb as number | null,
    storageModel: r.storage_model as string | null,
    smartStatus: r.smart_status as SmartStatus | null,
    powerOnHours: r.power_on_hours as number | null,
    tbwGb: r.tbw_gb as number | null,
    gpuDetected: r.gpu_detected as string | null,
    panelId: r.panel_id as string | null,
    screenSize: num(r.screen_size),
    batteryDesignWh: r.battery_design_wh as number | null,
    batteryFullWh: r.battery_full_wh as number | null,
    batteryHealthPct: num(r.battery_health_pct),
    cycleCount: r.cycle_count as number | null,
    wifiChip: r.wifi_chip as string | null,
    btPresent: r.bt_present as boolean | null,
    tpmVersion: r.tpm_version as string | null,
    secureBoot: r.secure_boot as boolean | null,
    biosLocked: r.bios_locked as boolean,
    mdmLocked: r.mdm_locked as boolean,
    computraceActive: r.computrace_active as boolean,
    rawJson: r.raw_json,
  };
}

function toMismatch(r: Raw): QcMismatchRow {
  return {
    id: r.id as string,
    qcReportId: r.qc_report_id as string,
    field: r.field as string,
    declaredValue: r.declared_value as string,
    actualValue: r.actual_value as string,
    severity: r.severity as MismatchSeverity,
    resolution: r.resolution as MismatchResolution | null,
    discountAmount: moneyFromDb(r.discount_amount as string | null),
    buyerNotifiedAt: r.buyer_notified_at as Date,
    buyerDecisionAt: r.buyer_decision_at as Date | null,
    penaltyId: r.penalty_id as string | null,
  };
}

function toPhoto(r: Raw): QcPhotoRow {
  return {
    id: String(r.id),
    qcReportId: r.qc_report_id as string,
    angle: r.angle as QcPhotoAngle,
    fileKey: r.file_key as string,
    hash: r.hash as string,
    capturedAt: r.captured_at as Date,
  };
}

function toSeal(r: Raw): QcSealRow {
  return {
    id: r.id as string,
    sealCode: r.seal_code as string,
    unitId: r.unit_id as string,
    qcReportId: r.qc_report_id as string,
    appliedBy: r.applied_by as string,
    appliedAt: r.applied_at as Date,
    appliedPhotoKey: r.applied_photo_key as string,
    status: r.status as SealStatus,
    verifiedAt: r.verified_at as Date | null,
    verifiedBy: r.verified_by as string | null,
    verifiedPhotoKey: r.verified_photo_key as string | null,
    brokenAt: r.broken_at as Date | null,
    brokenReason: r.broken_reason as string | null,
    replacedBySealId: r.replaced_by_seal_id as string | null,
  };
}

function toVisit(r: Raw): QcVisitRow {
  return {
    id: r.id as string,
    visitNumber: r.visit_number as string,
    vendorOrgId: r.vendor_org_id as string,
    facilityId: r.facility_id as string,
    addressId: r.address_id as string,
    requestedBy: r.requested_by as string | null,
    requestedAt: r.requested_at as Date,
    unitsRequested: r.units_requested as number,
    unitsPresented: r.units_presented as number | null,
    unitsInspected: r.units_inspected as number,
    unitsPassed: r.units_passed as number,
    unitsGradeCorrected: r.units_grade_corrected as number,
    unitsFailed: r.units_failed as number,
    unitsAbsent: r.units_absent as number,
    technicianId: r.technician_id as string | null,
    toolProviderId: r.tool_provider_id as string | null,
    scheduledDate: r.scheduled_date as string | null,
    slotFrom: r.slot_from as string | null,
    slotTo: r.slot_to as string | null,
    status: r.status as QcVisitStatus,
    arrivedAt: r.arrived_at as Date | null,
    startedAt: r.started_at as Date | null,
    completedAt: r.completed_at as Date | null,
    arrivalGeoLat: num(r.arrival_geo_lat),
    arrivalGeoLng: num(r.arrival_geo_lng),
    geoVarianceMetres: r.geo_variance_metres as number | null,
    vendorContactId: r.vendor_contact_id as string | null,
    vendorOtpHash: r.vendor_otp_hash as string | null,
    vendorSignoffAt: r.vendor_signoff_at as Date | null,
    vendorSignoffName: r.vendor_signoff_name as string | null,
    visitFee: moneyFromDb(r.visit_fee as string) ?? Money.ZERO,
    feeBearer: r.fee_bearer as VisitFeeBearer,
    feeWaiverReason: r.fee_waiver_reason as string | null,
    rescheduleCount: r.reschedule_count as number,
    cancellationReason: r.cancellation_reason as string | null,
    notes: r.notes as string | null,
  };
}

function toVisitUnit(r: Raw): QcVisitUnitRow {
  return {
    id: r.id as string,
    visitId: r.visit_id as string,
    unitId: r.unit_id as string,
    serialNumber: r.serial_number as string,
    listingId: r.listing_id as string | null,
    sequenceNo: r.sequence_no as number | null,
    outcome: r.outcome as QcUnitOutcome,
    qcReportId: r.qc_report_id as string | null,
    absentReason: r.absent_reason as string | null,
    startedAt: r.started_at as Date | null,
    completedAt: r.completed_at as Date | null,
    durationSeconds: r.duration_seconds as number | null,
  };
}

function toTechnician(r: Raw): QcTechnicianRow {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    employeeCode: r.employee_code as string,
    homePincode: r.home_pincode as string,
    zones: (r.zones as string[] | null) ?? [],
    certifiedTools: (r.certified_tools as string[] | null) ?? [],
    deviceCertId: r.device_cert_id as string | null,
    dailyCapacityUnits: r.daily_capacity_units as number,
    maxSitesPerDay: r.max_sites_per_day as number,
    employmentType: r.employment_type as EmploymentType,
    divergenceRate: num(r.divergence_rate),
    unitsInspectedTotal: r.units_inspected_total as number,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as Date,
  };
}

function toAvailability(r: Raw): TechnicianAvailabilityRow {
  return {
    id: r.id as string,
    technicianId: r.technician_id as string,
    theDate: r.the_date as string,
    slotFrom: r.slot_from as string,
    slotTo: r.slot_to as string,
    status: r.status as AvailabilityStatus,
    note: r.note as string | null,
  };
}

function toSamplingRule(r: Raw): QcSamplingRuleRow {
  return {
    id: r.id as string,
    vendorTier: r.vendor_tier as VendorTier | null,
    minUnitsInspected: r.min_units_inspected as number,
    minPassRate: num(r.min_pass_rate),
    minGradeAccuracy: num(r.min_grade_accuracy),
    samplePct: r.sample_pct as number,
    alwaysFullAboveValue: moneyFromDb(r.always_full_above_value as string | null),
    effectiveFrom: r.effective_from as string,
    isActive: r.is_active as boolean,
  };
}

function toToleranceRule(r: Raw): QcToleranceRuleRow {
  return {
    id: r.id as string,
    field: r.field as string,
    comparison: r.comparison as ToleranceComparison,
    toleranceValue: r.tolerance_value as string | null,
    severity: r.severity as MismatchSeverity,
    isBlocking: r.is_blocking as boolean,
    effectiveFrom: r.effective_from as string,
  };
}

function toReverification(r: Raw): QcReverificationRow {
  return {
    id: r.id as string,
    unitId: r.unit_id as string,
    originalReportId: r.original_report_id as string,
    trigger: r.trigger as ReverificationTrigger,
    method: r.method as ReverificationMethod,
    performedBy: r.performed_by as string | null,
    performedAt: r.performed_at as Date,
    sealCodeScanned: r.seal_code_scanned as string | null,
    sealIntact: r.seal_intact as boolean | null,
    serialScanned: r.serial_scanned as string | null,
    serialMatches: r.serial_matches as boolean | null,
    fingerprintHash: r.fingerprint_hash as string | null,
    fingerprintMatches: r.fingerprint_matches as boolean | null,
    outcome: r.outcome as ReverificationOutcome,
    photoKeys: (r.photo_keys as string[] | null) ?? [],
    notes: r.notes as string | null,
  };
}

function toAuditRecheck(r: Raw): QcAuditRecheckRow {
  return {
    id: r.id as string,
    originalReportId: r.original_report_id as string,
    recheckReportId: r.recheck_report_id as string,
    divergenceJson: r.divergence_json,
    auditorId: r.auditor_id as string,
    createdAt: r.created_at as Date,
  };
}

function toWipeCertificate(r: Raw): WipeCertificateRow {
  return {
    id: r.id as string,
    unitId: r.unit_id as string,
    method: r.method as string,
    standard: r.standard as string,
    passes: r.passes as number,
    verificationStatus: r.verification_status as WipeVerificationStatus,
    certificateKey: r.certificate_key as string | null,
    hash: r.hash as string | null,
    issuedAt: r.issued_at as Date,
  };
}

function toVendorSkuQuality(r: Raw): VendorSkuQualityRow {
  return {
    vendorOrgId: r.vendor_org_id as string,
    skuId: r.sku_id as string,
    grade: r.grade as Grade,
    unitsInspected: r.units_inspected as number,
    avgQcScore: num(r.avg_qc_score),
    medianQcScore: num(r.median_qc_score),
    batteryHealthMin: r.battery_health_min as number | null,
    batteryHealthMax: r.battery_health_max as number | null,
    gradeCorrections: r.grade_corrections as number,
    gradeAccuracyPct: num(r.grade_accuracy_pct),
    lastInspectedAt: r.last_inspected_at as Date | null,
    computedAt: r.computed_at as Date,
  };
}

function toVendorQuality(r: Raw): VendorQualityRow {
  return {
    vendorOrgId: r.vendor_org_id as string,
    unitsInspected: r.units_inspected as number,
    avgQcScore: num(r.avg_qc_score),
    medianQcScore: num(r.median_qc_score),
    batteryHealthMin: r.battery_health_min as number | null,
    batteryHealthMax: r.battery_health_max as number | null,
    gradeCorrections: r.grade_corrections as number,
    gradeAccuracyPct: num(r.grade_accuracy_pct),
    lastInspectedAt: r.last_inspected_at as Date | null,
    computedAt: r.computed_at as Date,
  };
}

function toToolProvider(r: Raw): QcToolProviderRow {
  return {
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    vendorCompany: r.vendor_company as string | null,
    integrationType: r.integration_type as string,
    reportFormat: r.report_format as string,
    fieldMapJson: (r.field_map_json as Record<string, unknown> | null) ?? {},
    supportsWipe: r.supports_wipe as boolean,
    wipeStandard: r.wipe_standard as string | null,
    licenceExpiry: r.licence_expiry as string | null,
    licenceSeats: r.licence_seats as number | null,
    costPerScanPaise: r.cost_per_scan_paise as number | null,
    isActive: r.is_active as boolean,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateReportInput {
  unitId: string;
  technicianId: string;
  deviceCertId: string;
  agentVersion: string;
  startedAt: Date;
  signature: string;
  nonce: string;
  visitId?: string | null;
  toolRunId?: string | null;
  completedAt?: Date | null;
  qcScore?: number | null;
  verdict?: QcVerdictValue | null;
  gradeProposed?: Grade | null;
  gradeFinal?: Grade | null;
  gradeOverrideReason?: string | null;
  reportPdfKey?: string | null;
  locationType?: QcLocationType;
  locationAddressId?: string | null;
  /** `YYYY-MM-DD`. `completed_at + qc.report_validity_days` on a PASS. */
  validUntil?: string | null;
  rulesVersion?: string | null;
  deviceFingerprint?: string | null;
}

export interface InsertToolRunInput {
  unitId: string;
  toolProviderId: string;
  toolVersion: string;
  deviceCertId: string;
  rawReportHash: string;
  visitUnitId?: string | null;
  toolRunId?: string | null;
  rawReportKey?: string | null;
  rawReportJson?: unknown;
  parseStatus?: ParseStatus;
  parseError?: string | null;
  serialFromTool?: string | null;
  serialMatches?: boolean | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  signature?: string | null;
  nonce?: string | null;
}

export interface AreaResultInput {
  area: QcAreaCode;
  score: number;
  maxScore: number;
  status: QcAreaStatus;
  details?: unknown;
}

export interface HardwareInput {
  hwSerial: string;
  ramDetectedGb: number;
  hwModel?: string | null;
  biosVersion?: string | null;
  biosDate?: string | null;
  cpuDetected?: string | null;
  cores?: number | null;
  threads?: number | null;
  ramModules?: number | null;
  ramType?: string | null;
  ramSpeedMhz?: number | null;
  storageType?: string | null;
  storageDetectedGb?: number | null;
  storageModel?: string | null;
  smartStatus?: SmartStatus | null;
  powerOnHours?: number | null;
  tbwGb?: number | null;
  gpuDetected?: string | null;
  panelId?: string | null;
  screenSize?: number | null;
  batteryDesignWh?: number | null;
  batteryFullWh?: number | null;
  batteryHealthPct?: number | null;
  cycleCount?: number | null;
  wifiChip?: string | null;
  btPresent?: boolean | null;
  tpmVersion?: string | null;
  secureBoot?: boolean | null;
  biosLocked?: boolean;
  mdmLocked?: boolean;
  computraceActive?: boolean;
  rawJson?: unknown;
}

export interface MismatchInput {
  field: string;
  declaredValue: string;
  actualValue: string;
  severity: MismatchSeverity;
  discountAmount?: Money | null;
}

export interface PhotoInput {
  angle: QcPhotoAngle;
  fileKey: string;
  hash: string;
  capturedAt?: Date;
}

export interface ApplySealInput {
  sealCode: string;
  unitId: string;
  qcReportId: string;
  /** A `qc.qc_technician.id`. */
  appliedBy: string;
  /** NOT NULL. A seal with no photograph is not a seal. */
  appliedPhotoKey: string;
}

export interface CreateVisitInput {
  visitNumber: string;
  vendorOrgId: string;
  facilityId: string;
  addressId: string;
  unitsRequested: number;
  requestedBy?: string | null;
  technicianId?: string | null;
  toolProviderId?: string | null;
  scheduledDate?: string | null;
  slotFrom?: string | null;
  slotTo?: string | null;
  status?: QcVisitStatus;
  visitFee?: Money;
  feeBearer?: VisitFeeBearer;
  feeWaiverReason?: string | null;
  notes?: string | null;
}

/**
 * A patch. `undefined` means "leave it alone" all the way down to the COALESCE.
 *
 * One consequence worth knowing: a column cannot be cleared back to NULL through
 * this method, because NULL is how "unchanged" is spelt. Clearing a cancellation
 * reason or an OTP hash needs its own statement, and none of the lanes needs one
 * yet.
 */
export interface UpdateVisitInput {
  technicianId?: string;
  toolProviderId?: string;
  scheduledDate?: string;
  slotFrom?: string;
  slotTo?: string;
  status?: QcVisitStatus;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  arrivalGeoLat?: number;
  arrivalGeoLng?: number;
  geoVarianceMetres?: number;
  vendorContactId?: string;
  vendorOtpHash?: string;
  vendorSignoffAt?: Date;
  vendorSignoffName?: string;
  visitFee?: Money;
  feeBearer?: VisitFeeBearer;
  feeWaiverReason?: string;
  rescheduleCount?: number;
  cancellationReason?: string;
  notes?: string;
}

export interface VisitFilter {
  status?: QcVisitStatus;
  vendorOrgId?: string;
  technicianId?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
  page?: number;
  pageSize?: number;
}

export interface VisitUnitInput {
  unitId: string;
  serialNumber: string;
  listingId?: string | null;
  sequenceNo?: number | null;
}

export interface ReverificationInput {
  unitId: string;
  originalReportId: string;
  trigger: ReverificationTrigger;
  method: ReverificationMethod;
  outcome: ReverificationOutcome;
  performedBy?: string | null;
  sealCodeScanned?: string | null;
  sealIntact?: boolean | null;
  serialScanned?: string | null;
  serialMatches?: boolean | null;
  fingerprintHash?: string | null;
  fingerprintMatches?: boolean | null;
  photoKeys?: string[];
  notes?: string | null;
}

export interface WipeCertificateInput {
  unitId: string;
  method: string;
  verificationStatus: WipeVerificationStatus;
  standard?: string;
  passes?: number;
  certificateKey?: string | null;
  hash?: string | null;
}

export interface VendorQualityInput {
  unitsInspected: number;
  avgQcScore?: number | null;
  medianQcScore?: number | null;
  batteryHealthMin?: number | null;
  batteryHealthMax?: number | null;
  gradeCorrections: number;
  gradeAccuracyPct?: number | null;
  lastInspectedAt?: Date | null;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

// The column lists below are written out per query rather than shared in a
// constant. `$queryRaw` is a tagged template — every `${}` becomes a bind
// parameter, so a shared fragment would have to be concatenated into the SQL as
// text, which is how a repository becomes an injection point. Repeated static
// SELECT lists are the cheaper mistake, and the same trade catalog and listing
// already made.

/** Arrays are bound as `text[]` and cast element-wise; see `insertPhotos`. */
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const jsonOrNull = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v);

@Injectable()
export class QcRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  // =========================================================================
  // qc_report
  // =========================================================================

  /**
   * Create the first report for a unit.
   *
   * `verification_code` is generated here for every report, not only for a pass.
   * One report, one code, no caller able to forget it — and the passport route
   * decides what a code is allowed to show. A failed unit never reaches the
   * storefront (rule 1) regardless of whether it has a code.
   *
   * A second current report for the same unit fails on `uq_qcrep_current` and
   * comes back as `CurrentReportExistsError`. That is deliberate: the caller
   * meant `supersedeReport` and should be told so rather than quietly winning a
   * race with the previous inspection.
   */
  async createReport(input: CreateReportInput): Promise<QcReportRow> {
    return this.insertReport(input);
  }

  /**
   * Re-inspect: close the live report and open a new one, in ONE transaction.
   *
   * Three statements, and the order is forced by two constraints that pull in
   * opposite directions:
   *
   *   1. `uq_qcrep_current` is a plain partial unique index, checked per
   *      statement rather than at commit — so the old row must lose
   *      `is_current` BEFORE the new row is inserted, or the insert is refused.
   *   2. `qc_report_superseded_by_id_fkey` is a plain foreign key, also not
   *      deferrable — so `superseded_by_id` cannot be written until the new row
   *      EXISTS. Writing it in step 1, against an id generated up front, fails
   *      with a 23503.
   *
   * There is no two-statement version of this. Deferring either constraint would
   * allow one, and neither is worth a migration for a path that runs once per
   * re-inspection.
   *
   * Nothing is ever overwritten. The prior report keeps its score, its grade,
   * its photographs and its verification code, because it is what we told a
   * buyer at the time and it is the evidence if they dispute it.
   */
  async supersedeReport(
    unitId: string,
    input: CreateReportInput,
  ): Promise<{ report: QcReportRow; supersededId: string | null }> {
    return this.prisma.runInTransaction(async () => {
      const closed = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE qc.qc_report SET is_current = FALSE
         WHERE unit_id = ${unitId}::uuid AND is_current
        RETURNING id`;

      const report = await this.insertReport({ ...input, unitId });

      const supersededId = closed[0]?.id ?? null;
      if (supersededId) {
        await this.prisma.$executeRaw`
          UPDATE qc.qc_report SET superseded_by_id = ${report.id}::uuid
           WHERE id = ${supersededId}::uuid`;
      }
      return { report, supersededId };
    });
  }

  private async insertReport(input: CreateReportInput): Promise<QcReportRow> {
    try {
      const rows = await this.prisma.$queryRaw<Raw[]>`
        INSERT INTO qc.qc_report
          (unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
           started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
           grade_override_reason, report_pdf_key, signature, nonce, verification_code,
           location_type, location_address_id, valid_until, is_current,
           rules_version, device_fingerprint)
        VALUES
          (${input.unitId}::uuid, ${input.visitId ?? null}::uuid,
           ${input.toolRunId ?? null}::uuid, ${input.technicianId}::uuid,
           ${input.deviceCertId}, ${input.agentVersion},
           ${input.startedAt}, ${input.completedAt ?? null}::timestamptz,
           ${input.qcScore ?? null}::int, ${input.verdict ?? null}::public.qc_verdict,
           ${input.gradeProposed ?? null}::public.grade_type,
           ${input.gradeFinal ?? null}::public.grade_type,
           ${input.gradeOverrideReason ?? null}, ${input.reportPdfKey ?? null},
           ${input.signature}, ${input.nonce}, ${generateVerificationCode()},
           ${input.locationType ?? 'VENDOR_SITE'}::public.qc_location_type,
           ${input.locationAddressId ?? null}::uuid,
           ${input.validUntil ?? null}::date, TRUE,
           ${input.rulesVersion ?? null}, ${input.deviceFingerprint ?? null})
        RETURNING id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id,
                  agent_version, started_at, completed_at, qc_score, verdict,
                  grade_proposed, grade_final, grade_override_reason, report_pdf_key,
                  signature, nonce, verification_code, location_type, location_address_id,
                  valid_until::text AS valid_until, superseded_by_id, is_current,
                  rules_version, device_fingerprint`;
      return toReport(rows[0]!);
    } catch (e) {
      const f = pgFailure(e);
      if (f.state === '23505') {
        // `uq_qcrep_current` is a partial unique INDEX on (unit_id), so the only
        // thing the error names is the column. Nothing else on this table is
        // unique by unit_id, so the mapping is unambiguous.
        if (f.involves('unit_id') || f.involves('uq_qcrep_current')) {
          throw new CurrentReportExistsError(input.unitId);
        }
        if (f.involves('nonce')) throw new NonceReplayError(input.nonce);
      }
      throw e;
    }
  }

  async findReportById(id: string): Promise<QcReportRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
             started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
             grade_override_reason, report_pdf_key, signature, nonce, verification_code,
             location_type, location_address_id, valid_until::text AS valid_until,
             superseded_by_id, is_current, rules_version, device_fingerprint
        FROM qc.qc_report WHERE id = ${id}::uuid`;
    return rows[0] ? toReport(rows[0]) : null;
  }

  /** The one live report for a machine, or null. `uq_qcrep_current` guarantees at most one. */
  async findCurrentReportByUnit(unitId: string): Promise<QcReportRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
             started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
             grade_override_reason, report_pdf_key, signature, nonce, verification_code,
             location_type, location_address_id, valid_until::text AS valid_until,
             superseded_by_id, is_current, rules_version, device_fingerprint
        FROM qc.qc_report WHERE unit_id = ${unitId}::uuid AND is_current`;
    return rows[0] ? toReport(rows[0]) : null;
  }

  /** Every report a unit has ever had, newest first. The supersession chain, as history. */
  async findReportsByUnit(unitId: string): Promise<QcReportRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
             started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
             grade_override_reason, report_pdf_key, signature, nonce, verification_code,
             location_type, location_address_id, valid_until::text AS valid_until,
             superseded_by_id, is_current, rules_version, device_fingerprint
        FROM qc.qc_report WHERE unit_id = ${unitId}::uuid
       ORDER BY started_at DESC`;
    return rows.map(toReport);
  }

  /**
   * The public passport lookup. Deliberately does not filter on `is_current`:
   * a printed certificate stays resolvable after a re-inspection, and the page
   * shows the reader that a newer report exists rather than a 404 they cannot
   * interpret while standing next to the machine.
   */
  async findReportByVerificationCode(code: string): Promise<QcReportRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
             started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
             grade_override_reason, report_pdf_key, signature, nonce, verification_code,
             location_type, location_address_id, valid_until::text AS valid_until,
             superseded_by_id, is_current, rules_version, device_fingerprint
        FROM qc.qc_report WHERE verification_code = ${code}`;
    return rows[0] ? toReport(rows[0]) : null;
  }

  async findReportsByVisit(visitId: string): Promise<QcReportRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
             started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
             grade_override_reason, report_pdf_key, signature, nonce, verification_code,
             location_type, location_address_id, valid_until::text AS valid_until,
             superseded_by_id, is_current, rules_version, device_fingerprint
        FROM qc.qc_report WHERE visit_id = ${visitId}::uuid
       ORDER BY started_at`;
    return rows.map(toReport);
  }

  /**
   * Write the verdict onto a report.
   *
   * `chk_override_reason` refuses a proposed grade that differs from the final
   * grade with no written reason, so the caller must supply one — grade is our
   * claim under CP e-Comm r.7(5) and an unexplained override is exactly what a
   * dispute turns on. The CHECK failure is left to surface rather than caught:
   * it is a programming error in the verdict lane, not something a user did.
   */
  async completeReport(
    id: string,
    verdict: {
      verdict: QcVerdictValue;
      qcScore: number;
      gradeProposed: Grade | null;
      gradeFinal: Grade | null;
      gradeOverrideReason?: string | null;
      completedAt: Date;
      validUntil?: string | null;
      reportPdfKey?: string | null;
    },
  ): Promise<QcReportRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_report SET
        verdict               = ${verdict.verdict}::public.qc_verdict,
        qc_score              = ${verdict.qcScore}::int,
        grade_proposed        = ${verdict.gradeProposed}::public.grade_type,
        grade_final           = ${verdict.gradeFinal}::public.grade_type,
        grade_override_reason = COALESCE(${verdict.gradeOverrideReason ?? null}, grade_override_reason),
        completed_at          = ${verdict.completedAt},
        valid_until           = COALESCE(${verdict.validUntil ?? null}::date, valid_until),
        report_pdf_key        = COALESCE(${verdict.reportPdfKey ?? null}, report_pdf_key)
      WHERE id = ${id}::uuid
      RETURNING id, unit_id, visit_id, tool_run_id, technician_id, device_cert_id, agent_version,
                started_at, completed_at, qc_score, verdict, grade_proposed, grade_final,
                grade_override_reason, report_pdf_key, signature, nonce, verification_code,
                location_type, location_address_id, valid_until::text AS valid_until,
                superseded_by_id, is_current, rules_version, device_fingerprint`;
    return rows[0] ? toReport(rows[0]) : null;
  }

  /** Link a report to the tool run it was parsed from, once both exist. */
  async attachToolRun(reportId: string, toolRunId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE qc.qc_report SET tool_run_id = ${toolRunId}::uuid WHERE id = ${reportId}::uuid`;
  }

  // =========================================================================
  // qc_tool_run
  // =========================================================================

  /**
   * Store a tool run. Idempotent on `(tool_provider_id, tool_run_id)`.
   *
   * The same run submitted twice is ONE row and a 200, never a duplicate and
   * never a 500 (QC-001). `ON CONFLICT DO NOTHING` lets Postgres arbitrate,
   * which is the only version of this that is safe against two webhook
   * deliveries landing in the same millisecond; a SELECT-then-INSERT leaves a
   * race exactly that wide, and DeviceSure retries on timeout.
   *
   * Two things this does NOT swallow:
   *   - A repeated `nonce` still raises, and comes back as `NonceReplayError`.
   *     A nonce is inside the signed payload; the same nonce with a *different*
   *     run id is a replay against another unit, not a re-delivery (QC-004).
   *   - A NULL `tool_run_id` never conflicts, because NULLs are distinct in a
   *     UNIQUE index. A provider that does not send a run id therefore gets no
   *     idempotency, which is a property of their payload and not something to
   *     paper over with a synthesised key.
   */
  async insertToolRun(
    input: InsertToolRunInput,
  ): Promise<{ row: QcToolRunRow; alreadyIngested: boolean }> {
    return this.prisma.runInTransaction(async () => {
      let inserted: Raw[];
      try {
        inserted = await this.prisma.$queryRaw<Raw[]>`
          INSERT INTO qc.qc_tool_run
            (visit_unit_id, unit_id, tool_provider_id, tool_version, tool_run_id, device_cert_id,
             raw_report_key, raw_report_json, raw_report_hash, parse_status, parse_error,
             serial_from_tool, serial_matches, started_at, completed_at, signature, nonce,
             ingested_at)
          VALUES
            (${input.visitUnitId ?? null}::uuid, ${input.unitId}::uuid,
             ${input.toolProviderId}::uuid, ${input.toolVersion}, ${input.toolRunId ?? null},
             ${input.deviceCertId}, ${input.rawReportKey ?? null},
             ${jsonOrNull(input.rawReportJson)}::jsonb, ${input.rawReportHash},
             ${input.parseStatus ?? 'PENDING'}, ${input.parseError ?? null},
             ${input.serialFromTool ?? null}, ${input.serialMatches ?? null}::boolean,
             ${input.startedAt ?? null}::timestamptz, ${input.completedAt ?? null}::timestamptz,
             ${input.signature ?? null}, ${input.nonce ?? null}, ${this.clock.now()})
          ON CONFLICT (tool_provider_id, tool_run_id) DO NOTHING
          RETURNING id, visit_unit_id, unit_id, tool_provider_id, tool_version, tool_run_id,
                    device_cert_id, raw_report_key, raw_report_json, raw_report_hash,
                    parse_status, parse_error, serial_from_tool, serial_matches,
                    started_at, completed_at, signature, nonce, ingested_at`;
      } catch (e) {
        const f = pgFailure(e);
        if (f.state === '23505' && f.involves('nonce') && input.nonce) {
          throw new NonceReplayError(input.nonce);
        }
        throw e;
      }

      if (inserted[0]) return { row: toToolRun(inserted[0]), alreadyIngested: false };

      const existing = await this.prisma.$queryRaw<Raw[]>`
        SELECT id, visit_unit_id, unit_id, tool_provider_id, tool_version, tool_run_id,
               device_cert_id, raw_report_key, raw_report_json, raw_report_hash,
               parse_status, parse_error, serial_from_tool, serial_matches,
               started_at, completed_at, signature, nonce, ingested_at
          FROM qc.qc_tool_run
         WHERE tool_provider_id = ${input.toolProviderId}::uuid
           AND tool_run_id = ${input.toolRunId ?? null}`;
      return { row: toToolRun(existing[0]!), alreadyIngested: true };
    });
  }

  async findToolRunById(id: string): Promise<QcToolRunRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_unit_id, unit_id, tool_provider_id, tool_version, tool_run_id,
             device_cert_id, raw_report_key, raw_report_json, raw_report_hash,
             parse_status, parse_error, serial_from_tool, serial_matches,
             started_at, completed_at, signature, nonce, ingested_at
        FROM qc.qc_tool_run WHERE id = ${id}::uuid`;
    return rows[0] ? toToolRun(rows[0]) : null;
  }

  async findToolRunsByUnit(unitId: string): Promise<QcToolRunRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_unit_id, unit_id, tool_provider_id, tool_version, tool_run_id,
             device_cert_id, raw_report_key, raw_report_json, raw_report_hash,
             parse_status, parse_error, serial_from_tool, serial_matches,
             started_at, completed_at, signature, nonce, ingested_at
        FROM qc.qc_tool_run WHERE unit_id = ${unitId}::uuid
       ORDER BY ingested_at DESC`;
    return rows.map(toToolRun);
  }

  /**
   * Record the outcome of parsing. The raw payload is never touched here — it is
   * the evidence, and a parser that edits its own input leaves nothing to
   * re-examine when a grade is disputed four months later.
   */
  async updateToolRunParse(
    id: string,
    patch: {
      parseStatus: ParseStatus;
      parseError?: string | null;
      serialFromTool?: string | null;
      serialMatches?: boolean | null;
    },
  ): Promise<QcToolRunRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_tool_run SET
        parse_status     = ${patch.parseStatus},
        parse_error      = ${patch.parseError ?? null},
        serial_from_tool = COALESCE(${patch.serialFromTool ?? null}, serial_from_tool),
        serial_matches   = COALESCE(${patch.serialMatches ?? null}::boolean, serial_matches)
      WHERE id = ${id}::uuid
      RETURNING id, visit_unit_id, unit_id, tool_provider_id, tool_version, tool_run_id,
                device_cert_id, raw_report_key, raw_report_json, raw_report_hash,
                parse_status, parse_error, serial_from_tool, serial_matches,
                started_at, completed_at, signature, nonce, ingested_at`;
    return rows[0] ? toToolRun(rows[0]) : null;
  }

  // =========================================================================
  // qc_area_result
  // =========================================================================

  /**
   * Write the area results for a report, in one statement.
   *
   * Upsert on `UNIQUE (qc_report_id, area)` so a technician correcting one area
   * on the console does not have to delete and re-insert twelve rows — and so a
   * retried sync cannot produce a duplicate.
   *
   * An area that was **not measured** must be left out entirely. The column's
   * CHECK has no NOT_MEASURED status, and writing PASS for something nobody
   * looked at is the exact failure `never-fabricate` exists to prevent.
   */
  async upsertAreaResults(
    qcReportId: string,
    areas: readonly AreaResultInput[],
  ): Promise<QcAreaResultRow[]> {
    if (areas.length === 0) return [];
    const codes = areas.map((a) => a.area);
    const scores = areas.map((a) => String(a.score));
    const maxScores = areas.map((a) => String(a.maxScore));
    const statuses = areas.map((a) => a.status);
    const details = areas.map((a) => jsonOrNull(a.details));

    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_area_result (qc_report_id, area, score, max_score, status, details_json)
      SELECT ${qcReportId}::uuid, a, s::numeric, m::numeric, st, d::jsonb
        FROM unnest(${codes}::text[], ${scores}::text[], ${maxScores}::text[],
                    ${statuses}::text[], ${details}::text[]) AS t(a, s, m, st, d)
      ON CONFLICT (qc_report_id, area) DO UPDATE SET
        score = EXCLUDED.score, max_score = EXCLUDED.max_score,
        status = EXCLUDED.status, details_json = EXCLUDED.details_json
      RETURNING id, qc_report_id, area, score, max_score, status, details_json`;
    return rows.map(toAreaResult);
  }

  async findAreaResults(qcReportId: string): Promise<QcAreaResultRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, qc_report_id, area, score, max_score, status, details_json
        FROM qc.qc_area_result WHERE qc_report_id = ${qcReportId}::uuid ORDER BY area`;
    return rows.map(toAreaResult);
  }

  // =========================================================================
  // qc_hardware_detected  (PK is qc_report_id — exactly one row per report)
  // =========================================================================

  /**
   * The detected hardware, as the tool reported it.
   *
   * Nothing here corrects the source. If DeviceSure sends 15 GB for a 16 GB
   * machine the 15 is stored (07 §3.4) and `compareSpec()` renders "16 GB
   * installed (15 GB usable)" from it; the fix is in their Windows collector.
   * The one place the tool's own richer view survives is `raw_json`, which is
   * where the installed figure lives until there is a column for it.
   */
  async upsertHardware(qcReportId: string, hw: HardwareInput): Promise<QcHardwareRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_hardware_detected
        (qc_report_id, hw_serial, hw_model, bios_version, bios_date, cpu_detected, cores, threads,
         ram_detected_gb, ram_modules, ram_type, ram_speed_mhz, storage_type, storage_detected_gb,
         storage_model, smart_status, power_on_hours, tbw_gb, gpu_detected, panel_id, screen_size,
         battery_design_wh, battery_full_wh, battery_health_pct, cycle_count, wifi_chip,
         bt_present, tpm_version, secure_boot, bios_locked, mdm_locked, computrace_active, raw_json)
      VALUES
        (${qcReportId}::uuid, ${hw.hwSerial}, ${hw.hwModel ?? null}, ${hw.biosVersion ?? null},
         ${hw.biosDate ?? null}::date, ${hw.cpuDetected ?? null}, ${hw.cores ?? null}::int,
         ${hw.threads ?? null}::int, ${hw.ramDetectedGb}::int, ${hw.ramModules ?? null}::int,
         ${hw.ramType ?? null}, ${hw.ramSpeedMhz ?? null}::int, ${hw.storageType ?? null},
         ${hw.storageDetectedGb ?? null}::int, ${hw.storageModel ?? null},
         ${hw.smartStatus ?? null}, ${hw.powerOnHours ?? null}::int, ${hw.tbwGb ?? null}::int,
         ${hw.gpuDetected ?? null}, ${hw.panelId ?? null},
         ${hw.screenSize === undefined || hw.screenSize === null ? null : String(hw.screenSize)}::numeric,
         ${hw.batteryDesignWh ?? null}::int, ${hw.batteryFullWh ?? null}::int,
         ${hw.batteryHealthPct === undefined || hw.batteryHealthPct === null ? null : String(hw.batteryHealthPct)}::numeric,
         ${hw.cycleCount ?? null}::int, ${hw.wifiChip ?? null}, ${hw.btPresent ?? null}::boolean,
         ${hw.tpmVersion ?? null}, ${hw.secureBoot ?? null}::boolean,
         ${hw.biosLocked ?? false}, ${hw.mdmLocked ?? false}, ${hw.computraceActive ?? false},
         ${jsonOrNull(hw.rawJson)}::jsonb)
      ON CONFLICT (qc_report_id) DO UPDATE SET
        hw_serial = EXCLUDED.hw_serial, hw_model = EXCLUDED.hw_model,
        bios_version = EXCLUDED.bios_version, bios_date = EXCLUDED.bios_date,
        cpu_detected = EXCLUDED.cpu_detected, cores = EXCLUDED.cores, threads = EXCLUDED.threads,
        ram_detected_gb = EXCLUDED.ram_detected_gb, ram_modules = EXCLUDED.ram_modules,
        ram_type = EXCLUDED.ram_type, ram_speed_mhz = EXCLUDED.ram_speed_mhz,
        storage_type = EXCLUDED.storage_type, storage_detected_gb = EXCLUDED.storage_detected_gb,
        storage_model = EXCLUDED.storage_model, smart_status = EXCLUDED.smart_status,
        power_on_hours = EXCLUDED.power_on_hours, tbw_gb = EXCLUDED.tbw_gb,
        gpu_detected = EXCLUDED.gpu_detected, panel_id = EXCLUDED.panel_id,
        screen_size = EXCLUDED.screen_size, battery_design_wh = EXCLUDED.battery_design_wh,
        battery_full_wh = EXCLUDED.battery_full_wh, battery_health_pct = EXCLUDED.battery_health_pct,
        cycle_count = EXCLUDED.cycle_count, wifi_chip = EXCLUDED.wifi_chip,
        bt_present = EXCLUDED.bt_present, tpm_version = EXCLUDED.tpm_version,
        secure_boot = EXCLUDED.secure_boot, bios_locked = EXCLUDED.bios_locked,
        mdm_locked = EXCLUDED.mdm_locked, computrace_active = EXCLUDED.computrace_active,
        raw_json = EXCLUDED.raw_json
      RETURNING qc_report_id, hw_serial, hw_model, bios_version, bios_date::text AS bios_date,
                cpu_detected, cores, threads, ram_detected_gb, ram_modules, ram_type,
                ram_speed_mhz, storage_type, storage_detected_gb, storage_model, smart_status,
                power_on_hours, tbw_gb, gpu_detected, panel_id, screen_size, battery_design_wh,
                battery_full_wh, battery_health_pct, cycle_count, wifi_chip, bt_present,
                tpm_version, secure_boot, bios_locked, mdm_locked, computrace_active, raw_json`;
    return toHardware(rows[0]!);
  }

  async findHardware(qcReportId: string): Promise<QcHardwareRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT qc_report_id, hw_serial, hw_model, bios_version, bios_date::text AS bios_date,
             cpu_detected, cores, threads, ram_detected_gb, ram_modules, ram_type, ram_speed_mhz,
             storage_type, storage_detected_gb, storage_model, smart_status, power_on_hours,
             tbw_gb, gpu_detected, panel_id, screen_size, battery_design_wh, battery_full_wh,
             battery_health_pct, cycle_count, wifi_chip, bt_present, tpm_version, secure_boot,
             bios_locked, mdm_locked, computrace_active, raw_json
        FROM qc.qc_hardware_detected WHERE qc_report_id = ${qcReportId}::uuid`;
    return rows[0] ? toHardware(rows[0]) : null;
  }

  // =========================================================================
  // qc_mismatch
  // =========================================================================

  async insertMismatches(
    qcReportId: string,
    mismatches: readonly MismatchInput[],
  ): Promise<QcMismatchRow[]> {
    if (mismatches.length === 0) return [];
    const fields = mismatches.map((m) => m.field);
    const declared = mismatches.map((m) => m.declaredValue);
    const actual = mismatches.map((m) => m.actualValue);
    const severities = mismatches.map((m) => m.severity);
    const discounts = mismatches.map((m) => m.discountAmount?.toString() ?? null);

    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_mismatch
        (qc_report_id, field, declared_value, actual_value, severity, discount_amount,
         buyer_notified_at)
      SELECT ${qcReportId}::uuid, f, d, a, s, disc::numeric, ${this.clock.now()}
        FROM unnest(${fields}::text[], ${declared}::text[], ${actual}::text[],
                    ${severities}::text[], ${discounts}::text[]) AS t(f, d, a, s, disc)
      RETURNING id, qc_report_id, field, declared_value, actual_value, severity, resolution,
                discount_amount, buyer_notified_at, buyer_decision_at, penalty_id`;
    return rows.map(toMismatch);
  }

  async findMismatches(qcReportId: string): Promise<QcMismatchRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, qc_report_id, field, declared_value, actual_value, severity, resolution,
             discount_amount, buyer_notified_at, buyer_decision_at, penalty_id
        FROM qc.qc_mismatch WHERE qc_report_id = ${qcReportId}::uuid ORDER BY severity, field`;
    return rows.map(toMismatch);
  }

  async resolveMismatch(
    id: string,
    resolution: MismatchResolution,
    discountAmount?: Money | null,
  ): Promise<QcMismatchRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_mismatch SET
        resolution        = ${resolution},
        discount_amount   = COALESCE(${discountAmount?.toString() ?? null}::numeric, discount_amount),
        buyer_decision_at = ${this.clock.now()}
      WHERE id = ${id}::uuid
      RETURNING id, qc_report_id, field, declared_value, actual_value, severity, resolution,
                discount_amount, buyer_notified_at, buyer_decision_at, penalty_id`;
    return rows[0] ? toMismatch(rows[0]) : null;
  }

  // =========================================================================
  // qc_photo
  // =========================================================================

  /**
   * The unit photographs. Six minimum per unit — lid, palmrest, screen on,
   * ports, base, worst defect. The seal photograph is not one of these; it is
   * NOT NULL on `qc_seal` because there is no seal without one.
   *
   * Timestamps go in as ISO text and are cast to `timestamptz[]` inside the
   * statement. Binding a JS `Date[]` through a raw array parameter is the kind
   * of driver-specific behaviour that works on one path and not another; a text
   * array casts identically everywhere.
   */
  async insertPhotos(qcReportId: string, photos: readonly PhotoInput[]): Promise<QcPhotoRow[]> {
    if (photos.length === 0) return [];
    const now = this.clock.now();
    const angles = photos.map((p) => p.angle);
    const keys = photos.map((p) => p.fileKey);
    const hashes = photos.map((p) => p.hash);
    const capturedAt = photos.map((p) => iso(p.capturedAt ?? now)!);

    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_photo (qc_report_id, angle, file_key, hash, captured_at)
      SELECT ${qcReportId}::uuid, a, k, h, c::timestamptz
        FROM unnest(${angles}::text[], ${keys}::text[], ${hashes}::text[],
                    ${capturedAt}::text[]) AS t(a, k, h, c)
      RETURNING id, qc_report_id, angle, file_key, hash, captured_at`;
    return rows.map(toPhoto);
  }

  async findPhotos(qcReportId: string): Promise<QcPhotoRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, qc_report_id, angle, file_key, hash, captured_at
        FROM qc.qc_photo WHERE qc_report_id = ${qcReportId}::uuid ORDER BY captured_at, id`;
    return rows.map(toPhoto);
  }

  // =========================================================================
  // qc_seal
  // =========================================================================

  /**
   * Apply a seal. `applied_photo_key` is NOT NULL in the schema and required
   * here, so there is no code path that produces a seal nobody photographed —
   * the photograph is what makes the seal checkable three weeks later.
   */
  async applySeal(input: ApplySealInput): Promise<QcSealRow> {
    try {
      const rows = await this.prisma.$queryRaw<Raw[]>`
        INSERT INTO qc.qc_seal
          (seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key, status)
        VALUES
          (${input.sealCode}, ${input.unitId}::uuid, ${input.qcReportId}::uuid,
           ${input.appliedBy}::uuid, ${this.clock.now()}, ${input.appliedPhotoKey},
           'APPLIED'::public.seal_status)
        RETURNING id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key,
                  status, verified_at, verified_by, verified_photo_key, broken_at, broken_reason,
                  replaced_by_seal_id`;
      return toSeal(rows[0]!);
    } catch (e) {
      const f = pgFailure(e);
      if (f.state === '23505' && f.involves('seal_code')) {
        throw new SealCodeInUseError(input.sealCode);
      }
      throw e;
    }
  }

  /** The scan at the door. One lookup, by the code printed on the sticker. */
  async findSealByCode(sealCode: string): Promise<QcSealRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key,
             status, verified_at, verified_by, verified_photo_key, broken_at, broken_reason,
             replaced_by_seal_id
        FROM qc.qc_seal WHERE seal_code = ${sealCode}`;
    return rows[0] ? toSeal(rows[0]) : null;
  }

  /** Newest first, so `[0]` is the seal currently on the machine. */
  async findSealsByUnit(unitId: string): Promise<QcSealRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key,
             status, verified_at, verified_by, verified_photo_key, broken_at, broken_reason,
             replaced_by_seal_id
        FROM qc.qc_seal WHERE unit_id = ${unitId}::uuid ORDER BY applied_at DESC`;
    return rows.map(toSeal);
  }

  /**
   * Move a seal along its lifecycle.
   *
   * `verifiedBy` is an `identity.user_account.id` and not a technician id, on
   * purpose: verification happens at pickup, by whoever is at the door — a
   * driver or a hub operator. `appliedBy` is the technician. The two columns
   * point at two different tables and conflating them is how a divergence
   * dashboard ends up measuring nobody.
   *
   * Transition legality (`SEAL_TRANSITIONS` in contracts) is the sealing lane's
   * to enforce; there is no CHECK behind it, so it is a decision, not a rule the
   * database can make.
   */
  async updateSealStatus(
    sealCode: string,
    patch: {
      status: SealStatus;
      verifiedAt?: Date | null;
      verifiedBy?: string | null;
      verifiedPhotoKey?: string | null;
      brokenAt?: Date | null;
      brokenReason?: string | null;
      replacedBySealId?: string | null;
    },
  ): Promise<QcSealRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_seal SET
        status              = ${patch.status}::public.seal_status,
        verified_at         = COALESCE(${iso(patch.verifiedAt)}::timestamptz, verified_at),
        verified_by         = COALESCE(${patch.verifiedBy ?? null}::uuid, verified_by),
        verified_photo_key  = COALESCE(${patch.verifiedPhotoKey ?? null}, verified_photo_key),
        broken_at           = COALESCE(${iso(patch.brokenAt)}::timestamptz, broken_at),
        broken_reason       = COALESCE(${patch.brokenReason ?? null}, broken_reason),
        replaced_by_seal_id = COALESCE(${patch.replacedBySealId ?? null}::uuid, replaced_by_seal_id)
      WHERE seal_code = ${sealCode}
      RETURNING id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key,
                status, verified_at, verified_by, verified_photo_key, broken_at, broken_reason,
                replaced_by_seal_id`;
    return rows[0] ? toSeal(rows[0]) : null;
  }

  // =========================================================================
  // qc_visit
  // =========================================================================

  async createVisit(input: CreateVisitInput): Promise<QcVisitRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_visit
        (visit_number, vendor_org_id, facility_id, address_id, requested_by, requested_at,
         units_requested, technician_id, tool_provider_id, scheduled_date, slot_from, slot_to,
         status, visit_fee, fee_bearer, fee_waiver_reason, notes)
      VALUES
        (${input.visitNumber}, ${input.vendorOrgId}::uuid, ${input.facilityId}::uuid,
         ${input.addressId}::uuid, ${input.requestedBy ?? null}::uuid, ${this.clock.now()},
         ${input.unitsRequested}, ${input.technicianId ?? null}::uuid,
         ${input.toolProviderId ?? null}::uuid, ${input.scheduledDate ?? null}::date,
         ${input.slotFrom ?? null}::time, ${input.slotTo ?? null}::time,
         ${input.status ?? 'REQUESTED'}::public.qc_visit_status,
         ${(input.visitFee ?? Money.ZERO).toString()}::numeric,
         ${input.feeBearer ?? 'TRUETECH'}, ${input.feeWaiverReason ?? null}, ${input.notes ?? null})
      RETURNING id, visit_number, vendor_org_id, facility_id, address_id, requested_by,
                requested_at, units_requested, units_presented, units_inspected, units_passed,
                units_grade_corrected, units_failed, units_absent, technician_id, tool_provider_id,
                scheduled_date::text AS scheduled_date, slot_from::text AS slot_from,
                slot_to::text AS slot_to, status, arrived_at, started_at, completed_at,
                arrival_geo_lat, arrival_geo_lng, geo_variance_metres, vendor_contact_id,
                vendor_otp_hash, vendor_signoff_at, vendor_signoff_name, visit_fee, fee_bearer,
                fee_waiver_reason, reschedule_count, cancellation_reason, notes`;
    return toVisit(rows[0]!);
  }

  async findVisitById(id: string): Promise<QcVisitRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_number, vendor_org_id, facility_id, address_id, requested_by, requested_at,
             units_requested, units_presented, units_inspected, units_passed,
             units_grade_corrected, units_failed, units_absent, technician_id, tool_provider_id,
             scheduled_date::text AS scheduled_date, slot_from::text AS slot_from,
             slot_to::text AS slot_to, status, arrived_at, started_at, completed_at,
             arrival_geo_lat, arrival_geo_lng, geo_variance_metres, vendor_contact_id,
             vendor_otp_hash, vendor_signoff_at, vendor_signoff_name, visit_fee, fee_bearer,
             fee_waiver_reason, reschedule_count, cancellation_reason, notes
        FROM qc.qc_visit WHERE id = ${id}::uuid`;
    return rows[0] ? toVisit(rows[0]) : null;
  }

  async findVisitByNumber(visitNumber: string): Promise<QcVisitRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_number, vendor_org_id, facility_id, address_id, requested_by, requested_at,
             units_requested, units_presented, units_inspected, units_passed,
             units_grade_corrected, units_failed, units_absent, technician_id, tool_provider_id,
             scheduled_date::text AS scheduled_date, slot_from::text AS slot_from,
             slot_to::text AS slot_to, status, arrived_at, started_at, completed_at,
             arrival_geo_lat, arrival_geo_lng, geo_variance_metres, vendor_contact_id,
             vendor_otp_hash, vendor_signoff_at, vendor_signoff_name, visit_fee, fee_bearer,
             fee_waiver_reason, reschedule_count, cancellation_reason, notes
        FROM qc.qc_visit WHERE visit_number = ${visitNumber}`;
    return rows[0] ? toVisit(rows[0]) : null;
  }

  /**
   * The visit board and the technician's route, from one query.
   *
   * Every filter is a nullable bind rather than a concatenated predicate, so the
   * statement is one prepared plan and there is no string-built SQL anywhere on
   * the path.
   */
  async findVisits(filter: VisitFilter = {}): Promise<Page<QcVisitRow>> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 25;
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_number, vendor_org_id, facility_id, address_id, requested_by, requested_at,
             units_requested, units_presented, units_inspected, units_passed,
             units_grade_corrected, units_failed, units_absent, technician_id, tool_provider_id,
             scheduled_date::text AS scheduled_date, slot_from::text AS slot_from,
             slot_to::text AS slot_to, status, arrived_at, started_at, completed_at,
             arrival_geo_lat, arrival_geo_lng, geo_variance_metres, vendor_contact_id,
             vendor_otp_hash, vendor_signoff_at, vendor_signoff_name, visit_fee, fee_bearer,
             fee_waiver_reason, reschedule_count, cancellation_reason, notes,
             count(*) OVER () AS total_count
        FROM qc.qc_visit
       WHERE (${filter.status ?? null}::public.qc_visit_status IS NULL
              OR status = ${filter.status ?? null}::public.qc_visit_status)
         AND (${filter.vendorOrgId ?? null}::uuid IS NULL
              OR vendor_org_id = ${filter.vendorOrgId ?? null}::uuid)
         AND (${filter.technicianId ?? null}::uuid IS NULL
              OR technician_id = ${filter.technicianId ?? null}::uuid)
         AND (${filter.scheduledFrom ?? null}::date IS NULL
              OR scheduled_date >= ${filter.scheduledFrom ?? null}::date)
         AND (${filter.scheduledTo ?? null}::date IS NULL
              OR scheduled_date <= ${filter.scheduledTo ?? null}::date)
       ORDER BY scheduled_date DESC NULLS LAST, requested_at DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    return {
      rows: rows.map(toVisit),
      total: int(rows[0]?.total_count),
      page,
      pageSize,
    };
  }

  /** See `UpdateVisitInput` — `undefined` means unchanged, and nothing here can clear a column. */
  async updateVisit(id: string, patch: UpdateVisitInput): Promise<QcVisitRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_visit v SET
        technician_id       = COALESCE(${patch.technicianId ?? null}::uuid, v.technician_id),
        tool_provider_id    = COALESCE(${patch.toolProviderId ?? null}::uuid, v.tool_provider_id),
        scheduled_date      = COALESCE(${patch.scheduledDate ?? null}::date, v.scheduled_date),
        slot_from           = COALESCE(${patch.slotFrom ?? null}::time, v.slot_from),
        slot_to             = COALESCE(${patch.slotTo ?? null}::time, v.slot_to),
        status              = COALESCE(${patch.status ?? null}::public.qc_visit_status, v.status),
        arrived_at          = COALESCE(${iso(patch.arrivedAt)}::timestamptz, v.arrived_at),
        started_at          = COALESCE(${iso(patch.startedAt)}::timestamptz, v.started_at),
        completed_at        = COALESCE(${iso(patch.completedAt)}::timestamptz, v.completed_at),
        arrival_geo_lat     = COALESCE(${patch.arrivalGeoLat === undefined ? null : String(patch.arrivalGeoLat)}::numeric, v.arrival_geo_lat),
        arrival_geo_lng     = COALESCE(${patch.arrivalGeoLng === undefined ? null : String(patch.arrivalGeoLng)}::numeric, v.arrival_geo_lng),
        geo_variance_metres = COALESCE(${patch.geoVarianceMetres ?? null}::int, v.geo_variance_metres),
        vendor_contact_id   = COALESCE(${patch.vendorContactId ?? null}::uuid, v.vendor_contact_id),
        vendor_otp_hash     = COALESCE(${patch.vendorOtpHash ?? null}, v.vendor_otp_hash),
        vendor_signoff_at   = COALESCE(${iso(patch.vendorSignoffAt)}::timestamptz, v.vendor_signoff_at),
        vendor_signoff_name = COALESCE(${patch.vendorSignoffName ?? null}, v.vendor_signoff_name),
        visit_fee           = COALESCE(${patch.visitFee?.toString() ?? null}::numeric, v.visit_fee),
        fee_bearer          = COALESCE(${patch.feeBearer ?? null}, v.fee_bearer),
        fee_waiver_reason   = COALESCE(${patch.feeWaiverReason ?? null}, v.fee_waiver_reason),
        reschedule_count    = COALESCE(${patch.rescheduleCount ?? null}::int, v.reschedule_count),
        cancellation_reason = COALESCE(${patch.cancellationReason ?? null}, v.cancellation_reason),
        notes               = COALESCE(${patch.notes ?? null}, v.notes)
      WHERE v.id = ${id}::uuid
      RETURNING v.id, v.visit_number, v.vendor_org_id, v.facility_id, v.address_id, v.requested_by,
                v.requested_at, v.units_requested, v.units_presented, v.units_inspected,
                v.units_passed, v.units_grade_corrected, v.units_failed, v.units_absent,
                v.technician_id, v.tool_provider_id, v.scheduled_date::text AS scheduled_date,
                v.slot_from::text AS slot_from, v.slot_to::text AS slot_to, v.status,
                v.arrived_at, v.started_at, v.completed_at, v.arrival_geo_lat, v.arrival_geo_lng,
                v.geo_variance_metres, v.vendor_contact_id, v.vendor_otp_hash,
                v.vendor_signoff_at, v.vendor_signoff_name, v.visit_fee, v.fee_bearer,
                v.fee_waiver_reason, v.reschedule_count, v.cancellation_reason, v.notes`;
    return rows[0] ? toVisit(rows[0]) : null;
  }

  /**
   * Total the visit counters from the manifest rather than incrementing them.
   *
   * A counter that drifts from the rows it counts is how a vendor signs an OTP
   * against a summary that never happened — and this summary is the document
   * that stops "you never told me it failed". So it is derived, every time, the
   * same way `listing.qty_total` is.
   *
   * Two judgements are encoded here and are worth disagreeing with explicitly
   * rather than reverse-engineering:
   *   - UNTESTABLE counts as **failed**. A serial that does not belong to the
   *     laptop means the unit does not proceed and is not listed, which is the
   *     only thing `units_failed` is used to say. `qc_visit` has no untestable
   *     counter, so the alternative is a unit that vanishes from the summary.
   *   - PENDING counts as presented but not inspected, so a visit closed early
   *     shows the gap instead of hiding it.
   */
  async recountVisit(visitId: string): Promise<QcVisitRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_visit v SET
        units_presented       = c.presented,
        units_inspected       = c.inspected,
        units_passed          = c.passed,
        units_grade_corrected = c.grade_corrected,
        units_failed          = c.failed,
        units_absent          = c.absent
      FROM (
        SELECT count(*) FILTER (WHERE outcome <> 'ABSENT')::int AS presented,
               count(*) FILTER (WHERE outcome NOT IN ('PENDING','ABSENT'))::int AS inspected,
               count(*) FILTER (WHERE outcome IN ('PASS','PASS_WITH_NOTE','PASS_GRADE_CORRECTED'))::int AS passed,
               count(*) FILTER (WHERE outcome = 'PASS_GRADE_CORRECTED')::int AS grade_corrected,
               count(*) FILTER (WHERE outcome IN ('FAIL','UNTESTABLE'))::int AS failed,
               count(*) FILTER (WHERE outcome = 'ABSENT')::int AS absent
          FROM qc.qc_visit_unit WHERE visit_id = ${visitId}::uuid
      ) c
      WHERE v.id = ${visitId}::uuid
      RETURNING v.id, v.visit_number, v.vendor_org_id, v.facility_id, v.address_id, v.requested_by,
                v.requested_at, v.units_requested, v.units_presented, v.units_inspected,
                v.units_passed, v.units_grade_corrected, v.units_failed, v.units_absent,
                v.technician_id, v.tool_provider_id, v.scheduled_date::text AS scheduled_date,
                v.slot_from::text AS slot_from, v.slot_to::text AS slot_to, v.status,
                v.arrived_at, v.started_at, v.completed_at, v.arrival_geo_lat, v.arrival_geo_lng,
                v.geo_variance_metres, v.vendor_contact_id, v.vendor_otp_hash,
                v.vendor_signoff_at, v.vendor_signoff_name, v.visit_fee, v.fee_bearer,
                v.fee_waiver_reason, v.reschedule_count, v.cancellation_reason, v.notes`;
    return rows[0] ? toVisit(rows[0]) : null;
  }

  // =========================================================================
  // qc_visit_unit
  // =========================================================================

  /**
   * Put units on a visit manifest. `ON CONFLICT DO NOTHING` against
   * `UNIQUE (visit_id, unit_id)`, so re-sending a manifest is idempotent rather
   * than a 500 — which matters because the technician app syncs offline and
   * replays whatever it queued.
   */
  async addVisitUnits(
    visitId: string,
    units: readonly VisitUnitInput[],
  ): Promise<QcVisitUnitRow[]> {
    if (units.length === 0) return [];
    const unitIds = units.map((u) => u.unitId);
    const serials = units.map((u) => u.serialNumber);
    const listingIds = units.map((u) => u.listingId ?? null);
    const seqs = units.map((u, i) => String(u.sequenceNo ?? i + 1));

    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_visit_unit (visit_id, unit_id, serial_number, listing_id, sequence_no)
      SELECT ${visitId}::uuid, u::uuid, s, l::uuid, n::int
        FROM unnest(${unitIds}::text[], ${serials}::text[], ${listingIds}::text[],
                    ${seqs}::text[]) AS t(u, s, l, n)
      ON CONFLICT (visit_id, unit_id) DO NOTHING
      RETURNING id, visit_id, unit_id, serial_number, listing_id, sequence_no, outcome,
                qc_report_id, absent_reason, started_at, completed_at, duration_seconds`;
    return rows.map(toVisitUnit);
  }

  /** One filter for both directions: the manifest for a visit, or a unit's visits. */
  async findVisitUnits(filter: {
    visitId?: string;
    unitId?: string;
  }): Promise<QcVisitUnitRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_id, unit_id, serial_number, listing_id, sequence_no, outcome,
             qc_report_id, absent_reason, started_at, completed_at, duration_seconds
        FROM qc.qc_visit_unit
       WHERE (${filter.visitId ?? null}::uuid IS NULL OR visit_id = ${filter.visitId ?? null}::uuid)
         AND (${filter.unitId ?? null}::uuid IS NULL OR unit_id = ${filter.unitId ?? null}::uuid)
       ORDER BY sequence_no NULLS LAST, id`;
    return rows.map(toVisitUnit);
  }

  async updateVisitUnit(
    id: string,
    patch: {
      outcome?: QcUnitOutcome;
      qcReportId?: string | null;
      absentReason?: string | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
      durationSeconds?: number | null;
    },
  ): Promise<QcVisitUnitRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_visit_unit SET
        outcome          = COALESCE(${patch.outcome ?? null}::public.qc_unit_outcome, outcome),
        qc_report_id     = COALESCE(${patch.qcReportId ?? null}::uuid, qc_report_id),
        absent_reason    = COALESCE(${patch.absentReason ?? null}, absent_reason),
        started_at       = COALESCE(${iso(patch.startedAt)}::timestamptz, started_at),
        completed_at     = COALESCE(${iso(patch.completedAt)}::timestamptz, completed_at),
        duration_seconds = COALESCE(${patch.durationSeconds ?? null}::int, duration_seconds)
      WHERE id = ${id}::uuid
      RETURNING id, visit_id, unit_id, serial_number, listing_id, sequence_no, outcome,
                qc_report_id, absent_reason, started_at, completed_at, duration_seconds`;
    return rows[0] ? toVisitUnit(rows[0]) : null;
  }

  // =========================================================================
  // qc_technician  /  technician_availability
  // =========================================================================

  async findTechnicianById(id: string): Promise<QcTechnicianRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, user_id, employee_code, home_pincode, zones, certified_tools, device_cert_id,
             daily_capacity_units, max_sites_per_day, employment_type, divergence_rate,
             units_inspected_total, is_active, created_at
        FROM qc.qc_technician WHERE id = ${id}::uuid`;
    return rows[0] ? toTechnician(rows[0]) : null;
  }

  /** The bridge from a login to the inspecting identity. `user_id` is UNIQUE, so it is 1:1. */
  async findTechnicianByUserId(userId: string): Promise<QcTechnicianRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, user_id, employee_code, home_pincode, zones, certified_tools, device_cert_id,
             daily_capacity_units, max_sites_per_day, employment_type, divergence_rate,
             units_inspected_total, is_active, created_at
        FROM qc.qc_technician WHERE user_id = ${userId}::uuid`;
    return rows[0] ? toTechnician(rows[0]) : null;
  }

  /**
   * Candidate technicians for a site.
   *
   * `zones @> ARRAY[zone]` uses `ix_tech_zone`, the partial GIN index on active
   * technicians — the containment operator is what the index answers, so a
   * rewrite to `= ANY(zones)` would silently drop to a sequential scan.
   */
  async findTechnicians(
    filter: { zone?: string; tool?: string; activeOnly?: boolean } = {},
  ): Promise<QcTechnicianRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, user_id, employee_code, home_pincode, zones, certified_tools, device_cert_id,
             daily_capacity_units, max_sites_per_day, employment_type, divergence_rate,
             units_inspected_total, is_active, created_at
        FROM qc.qc_technician
       WHERE (${filter.activeOnly ?? true} = FALSE OR is_active)
         AND (${filter.zone ?? null}::text IS NULL
              OR zones @> ARRAY[${filter.zone ?? ''}]::text[])
         AND (${filter.tool ?? null}::text IS NULL
              OR certified_tools @> ARRAY[${filter.tool ?? ''}]::text[])
       ORDER BY employee_code`;
    return rows.map(toTechnician);
  }

  /**
   * The two counters the audit-recheck loop maintains.
   *
   * `units_inspected_total` is incremented rather than recounted: it spans every
   * visit a technician has ever done, and recomputing it per report would scan
   * the whole report table on the hot path of closing an inspection.
   */
  async updateTechnicianStats(
    id: string,
    patch: { unitsInspectedDelta?: number; divergenceRate?: number | null; isActive?: boolean },
  ): Promise<QcTechnicianRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      UPDATE qc.qc_technician SET
        units_inspected_total = units_inspected_total + ${patch.unitsInspectedDelta ?? 0}::int,
        divergence_rate = COALESCE(${patch.divergenceRate === undefined || patch.divergenceRate === null ? null : String(patch.divergenceRate)}::numeric, divergence_rate),
        is_active = COALESCE(${patch.isActive ?? null}::boolean, is_active)
      WHERE id = ${id}::uuid
      RETURNING id, user_id, employee_code, home_pincode, zones, certified_tools, device_cert_id,
                daily_capacity_units, max_sites_per_day, employment_type, divergence_rate,
                units_inspected_total, is_active, created_at`;
    return rows[0] ? toTechnician(rows[0]) : null;
  }

  /** Upsert on `UNIQUE (technician_id, the_date, slot_from)` — re-publishing a roster is safe. */
  async upsertAvailability(
    technicianId: string,
    slots: readonly { theDate: string; slotFrom: string; slotTo: string; status?: AvailabilityStatus; note?: string | null }[],
  ): Promise<TechnicianAvailabilityRow[]> {
    if (slots.length === 0) return [];
    const dates = slots.map((s) => s.theDate);
    const froms = slots.map((s) => s.slotFrom);
    const tos = slots.map((s) => s.slotTo);
    const statuses = slots.map((s) => s.status ?? 'AVAILABLE');
    const notes = slots.map((s) => s.note ?? null);

    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.technician_availability (technician_id, the_date, slot_from, slot_to, status, note)
      SELECT ${technicianId}::uuid, d::date, f::time, t::time, st, n
        FROM unnest(${dates}::text[], ${froms}::text[], ${tos}::text[],
                    ${statuses}::text[], ${notes}::text[]) AS x(d, f, t, st, n)
      ON CONFLICT (technician_id, the_date, slot_from) DO UPDATE SET
        slot_to = EXCLUDED.slot_to, status = EXCLUDED.status, note = EXCLUDED.note
      RETURNING id, technician_id, the_date::text AS the_date, slot_from::text AS slot_from,
                slot_to::text AS slot_to, status, note`;
    return rows.map(toAvailability);
  }

  async findAvailability(filter: {
    technicianIds?: string[];
    from: string;
    to: string;
    status?: AvailabilityStatus;
  }): Promise<TechnicianAvailabilityRow[]> {
    const ids = filter.technicianIds ?? null;
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, technician_id, the_date::text AS the_date, slot_from::text AS slot_from,
             slot_to::text AS slot_to, status, note
        FROM qc.technician_availability
       WHERE the_date BETWEEN ${filter.from}::date AND ${filter.to}::date
         AND (${ids}::text[] IS NULL OR technician_id = ANY(${ids ?? []}::text[]::uuid[]))
         AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
       ORDER BY the_date, slot_from`;
    return rows.map(toAvailability);
  }

  // =========================================================================
  // qc_sampling_rule  /  qc_tolerance_rule
  // =========================================================================

  /**
   * The one live rule for a tier. A partial unique index on `(vendor_tier)
   * WHERE is_active` makes "one active rule per tier" the database's problem
   * rather than a query that has to guess which of two to believe.
   */
  async findActiveSamplingRule(tier: VendorTier): Promise<QcSamplingRuleRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, vendor_tier, min_units_inspected, min_pass_rate, min_grade_accuracy, sample_pct,
             always_full_above_value, effective_from::text AS effective_from, is_active
        FROM qc.qc_sampling_rule WHERE vendor_tier = ${tier}::public.vendor_tier AND is_active`;
    return rows[0] ? toSamplingRule(rows[0]) : null;
  }

  async findSamplingRules(): Promise<QcSamplingRuleRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, vendor_tier, min_units_inspected, min_pass_rate, min_grade_accuracy, sample_pct,
             always_full_above_value, effective_from::text AS effective_from, is_active
        FROM qc.qc_sampling_rule ORDER BY vendor_tier, effective_from DESC`;
    return rows.map(toSamplingRule);
  }

  /**
   * Publish a rule for a tier from a given date.
   *
   * `UNIQUE (vendor_tier, effective_from)` makes re-publishing the same day an
   * update rather than a second row, and the partial unique on `is_active` means
   * the caller must deactivate the previous rule in the same transaction —
   * which is why this takes the transaction rather than opening its own.
   */
  async upsertSamplingRule(rule: {
    vendorTier: VendorTier;
    effectiveFrom: string;
    minUnitsInspected: number;
    samplePct: number;
    minPassRate?: number | null;
    minGradeAccuracy?: number | null;
    alwaysFullAboveValue?: Money | null;
    isActive?: boolean;
  }): Promise<QcSamplingRuleRow> {
    return this.prisma.runInTransaction(async () => {
      if (rule.isActive !== false) {
        await this.prisma.$executeRaw`
          UPDATE qc.qc_sampling_rule SET is_active = FALSE
           WHERE vendor_tier = ${rule.vendorTier}::public.vendor_tier
             AND is_active
             AND effective_from <> ${rule.effectiveFrom}::date`;
      }
      const rows = await this.prisma.$queryRaw<Raw[]>`
        INSERT INTO qc.qc_sampling_rule
          (vendor_tier, min_units_inspected, min_pass_rate, min_grade_accuracy, sample_pct,
           always_full_above_value, effective_from, is_active)
        VALUES
          (${rule.vendorTier}::public.vendor_tier, ${rule.minUnitsInspected}::int,
           ${rule.minPassRate === undefined || rule.minPassRate === null ? null : String(rule.minPassRate)}::numeric,
           ${rule.minGradeAccuracy === undefined || rule.minGradeAccuracy === null ? null : String(rule.minGradeAccuracy)}::numeric,
           ${rule.samplePct}::int, ${rule.alwaysFullAboveValue?.toString() ?? null}::numeric,
           ${rule.effectiveFrom}::date, ${rule.isActive ?? true})
        ON CONFLICT (vendor_tier, effective_from) DO UPDATE SET
          min_units_inspected = EXCLUDED.min_units_inspected,
          min_pass_rate = EXCLUDED.min_pass_rate,
          min_grade_accuracy = EXCLUDED.min_grade_accuracy,
          sample_pct = EXCLUDED.sample_pct,
          always_full_above_value = EXCLUDED.always_full_above_value,
          is_active = EXCLUDED.is_active
        RETURNING id, vendor_tier, min_units_inspected, min_pass_rate, min_grade_accuracy,
                  sample_pct, always_full_above_value, effective_from::text AS effective_from,
                  is_active`;
      return toSamplingRule(rows[0]!);
    });
  }

  /**
   * The tolerance rules in force **on a given date**, one per field.
   *
   * `DISTINCT ON (field)` with the newest effective row is the whole point:
   * grading is a liability control under CP e-Comm r.7(5) and must be
   * reproducible against the rules that applied on the inspection date, not
   * against today's. Passing the report's own date re-derives an old grade
   * correctly; passing `now` quietly re-grades history.
   */
  async findToleranceRules(onDate: string): Promise<QcToleranceRuleRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT DISTINCT ON (field)
             id, field, comparison, tolerance_value, severity, is_blocking,
             effective_from::text AS effective_from
        FROM qc.qc_tolerance_rule
       WHERE effective_from <= ${onDate}::date
       ORDER BY field, effective_from DESC`;
    return rows.map(toToleranceRule);
  }

  // =========================================================================
  // qc_reverification  /  qc_audit_recheck  /  wipe_certificate
  // =========================================================================

  /** The two minutes at the door that decide whether a unit ships. */
  async insertReverification(input: ReverificationInput): Promise<QcReverificationRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_reverification
        (unit_id, original_report_id, "trigger", method, performed_by, performed_at,
         seal_code_scanned, seal_intact, serial_scanned, serial_matches, fingerprint_hash,
         fingerprint_matches, outcome, photo_keys, notes)
      VALUES
        (${input.unitId}::uuid, ${input.originalReportId}::uuid, ${input.trigger}, ${input.method},
         ${input.performedBy ?? null}::uuid, ${this.clock.now()},
         ${input.sealCodeScanned ?? null}, ${input.sealIntact ?? null}::boolean,
         ${input.serialScanned ?? null}, ${input.serialMatches ?? null}::boolean,
         ${input.fingerprintHash ?? null}, ${input.fingerprintMatches ?? null}::boolean,
         ${input.outcome}, ${input.photoKeys ?? []}::text[], ${input.notes ?? null})
      RETURNING id, unit_id, original_report_id, "trigger", method, performed_by, performed_at,
                seal_code_scanned, seal_intact, serial_scanned, serial_matches, fingerprint_hash,
                fingerprint_matches, outcome, photo_keys, notes`;
    return toReverification(rows[0]!);
  }

  async findReverifications(unitId: string): Promise<QcReverificationRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, original_report_id, "trigger", method, performed_by, performed_at,
             seal_code_scanned, seal_intact, serial_scanned, serial_matches, fingerprint_hash,
             fingerprint_matches, outcome, photo_keys, notes
        FROM qc.qc_reverification WHERE unit_id = ${unitId}::uuid ORDER BY performed_at DESC`;
    return rows.map(toReverification);
  }

  /** The 5% second opinion that feeds `qc_technician.divergence_rate`. */
  async insertAuditRecheck(input: {
    originalReportId: string;
    recheckReportId: string;
    auditorId: string;
    divergence?: unknown;
  }): Promise<QcAuditRecheckRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.qc_audit_recheck
        (original_report_id, recheck_report_id, divergence_json, auditor_id, created_at)
      VALUES
        (${input.originalReportId}::uuid, ${input.recheckReportId}::uuid,
         ${jsonOrNull(input.divergence)}::jsonb, ${input.auditorId}::uuid, ${this.clock.now()})
      RETURNING id, original_report_id, recheck_report_id, divergence_json, auditor_id, created_at`;
    return toAuditRecheck(rows[0]!);
  }

  async findAuditRechecks(reportId: string): Promise<QcAuditRecheckRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, original_report_id, recheck_report_id, divergence_json, auditor_id, created_at
        FROM qc.qc_audit_recheck
       WHERE original_report_id = ${reportId}::uuid OR recheck_report_id = ${reportId}::uuid
       ORDER BY created_at DESC`;
    return rows.map(toAuditRecheck);
  }

  /** What a corporate buyer's data-security policy asks for, per machine. */
  async insertWipeCertificate(input: WipeCertificateInput): Promise<WipeCertificateRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.wipe_certificate
        (unit_id, method, standard, passes, verification_status, certificate_key, hash, issued_at)
      VALUES
        (${input.unitId}::uuid, ${input.method}, ${input.standard ?? 'NIST_800_88_PURGE'},
         ${input.passes ?? 1}::int, ${input.verificationStatus},
         ${input.certificateKey ?? null}, ${input.hash ?? null}, ${this.clock.now()})
      RETURNING id, unit_id, method, standard, passes, verification_status, certificate_key,
                hash, issued_at`;
    return toWipeCertificate(rows[0]!);
  }

  /** Newest first — a re-wipe after a returned unit does not erase the earlier certificate. */
  async findWipeCertificates(unitId: string): Promise<WipeCertificateRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, method, standard, passes, verification_status, certificate_key,
             hash, issued_at
        FROM qc.wipe_certificate WHERE unit_id = ${unitId}::uuid ORDER BY issued_at DESC`;
    return rows.map(toWipeCertificate);
  }

  // =========================================================================
  // vendor_sku_quality  /  vendor_quality
  // =========================================================================

  /**
   * The read model behind the supply-point comparison grid.
   *
   * Computed and cached here rather than in the grid query, which has a 500 ms
   * p95 budget and already touches six tables. The API serves these keyed by
   * `supply_point_code`; `vendor_org_id` never crosses the DTO boundary, and
   * suppressing the headline below the sample threshold is the caller's job —
   * this layer stores the number, it does not decide whether publishing it would
   * be a misrepresentation.
   */
  async upsertVendorSkuQuality(
    key: { vendorOrgId: string; skuId: string; grade: Grade },
    q: VendorQualityInput,
  ): Promise<VendorSkuQualityRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.vendor_sku_quality
        (vendor_org_id, sku_id, grade, units_inspected, avg_qc_score, median_qc_score,
         battery_health_min, battery_health_max, grade_corrections, grade_accuracy_pct,
         last_inspected_at, computed_at)
      VALUES
        (${key.vendorOrgId}::uuid, ${key.skuId}::uuid, ${key.grade}::public.grade_type,
         ${q.unitsInspected}::int,
         ${q.avgQcScore === undefined || q.avgQcScore === null ? null : String(q.avgQcScore)}::numeric,
         ${q.medianQcScore === undefined || q.medianQcScore === null ? null : String(q.medianQcScore)}::numeric,
         ${q.batteryHealthMin ?? null}::int, ${q.batteryHealthMax ?? null}::int,
         ${q.gradeCorrections}::int,
         ${q.gradeAccuracyPct === undefined || q.gradeAccuracyPct === null ? null : String(q.gradeAccuracyPct)}::numeric,
         ${iso(q.lastInspectedAt)}::timestamptz, ${this.clock.now()})
      ON CONFLICT (vendor_org_id, sku_id, grade) DO UPDATE SET
        units_inspected = EXCLUDED.units_inspected, avg_qc_score = EXCLUDED.avg_qc_score,
        median_qc_score = EXCLUDED.median_qc_score,
        battery_health_min = EXCLUDED.battery_health_min,
        battery_health_max = EXCLUDED.battery_health_max,
        grade_corrections = EXCLUDED.grade_corrections,
        grade_accuracy_pct = EXCLUDED.grade_accuracy_pct,
        last_inspected_at = EXCLUDED.last_inspected_at, computed_at = EXCLUDED.computed_at
      RETURNING vendor_org_id, sku_id, grade, units_inspected, avg_qc_score, median_qc_score,
                battery_health_min, battery_health_max, grade_corrections, grade_accuracy_pct,
                last_inspected_at, computed_at`;
    return toVendorSkuQuality(rows[0]!);
  }

  async findVendorSkuQuality(
    vendorOrgId: string,
    skuId?: string,
  ): Promise<VendorSkuQualityRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT vendor_org_id, sku_id, grade, units_inspected, avg_qc_score, median_qc_score,
             battery_health_min, battery_health_max, grade_corrections, grade_accuracy_pct,
             last_inspected_at, computed_at
        FROM qc.vendor_sku_quality
       WHERE vendor_org_id = ${vendorOrgId}::uuid
         AND (${skuId ?? null}::uuid IS NULL OR sku_id = ${skuId ?? null}::uuid)
       ORDER BY sku_id, grade`;
    return rows.map(toVendorSkuQuality);
  }

  async upsertVendorQuality(
    vendorOrgId: string,
    q: VendorQualityInput,
  ): Promise<VendorQualityRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      INSERT INTO qc.vendor_quality
        (vendor_org_id, units_inspected, avg_qc_score, median_qc_score, battery_health_min,
         battery_health_max, grade_corrections, grade_accuracy_pct, last_inspected_at, computed_at)
      VALUES
        (${vendorOrgId}::uuid, ${q.unitsInspected}::int,
         ${q.avgQcScore === undefined || q.avgQcScore === null ? null : String(q.avgQcScore)}::numeric,
         ${q.medianQcScore === undefined || q.medianQcScore === null ? null : String(q.medianQcScore)}::numeric,
         ${q.batteryHealthMin ?? null}::int, ${q.batteryHealthMax ?? null}::int,
         ${q.gradeCorrections}::int,
         ${q.gradeAccuracyPct === undefined || q.gradeAccuracyPct === null ? null : String(q.gradeAccuracyPct)}::numeric,
         ${iso(q.lastInspectedAt)}::timestamptz, ${this.clock.now()})
      ON CONFLICT (vendor_org_id) DO UPDATE SET
        units_inspected = EXCLUDED.units_inspected, avg_qc_score = EXCLUDED.avg_qc_score,
        median_qc_score = EXCLUDED.median_qc_score,
        battery_health_min = EXCLUDED.battery_health_min,
        battery_health_max = EXCLUDED.battery_health_max,
        grade_corrections = EXCLUDED.grade_corrections,
        grade_accuracy_pct = EXCLUDED.grade_accuracy_pct,
        last_inspected_at = EXCLUDED.last_inspected_at, computed_at = EXCLUDED.computed_at
      RETURNING vendor_org_id, units_inspected, avg_qc_score, median_qc_score, battery_health_min,
                battery_health_max, grade_corrections, grade_accuracy_pct, last_inspected_at,
                computed_at`;
    return toVendorQuality(rows[0]!);
  }

  async findVendorQuality(vendorOrgId: string): Promise<VendorQualityRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT vendor_org_id, units_inspected, avg_qc_score, median_qc_score, battery_health_min,
             battery_health_max, grade_corrections, grade_accuracy_pct, last_inspected_at,
             computed_at
        FROM qc.vendor_quality WHERE vendor_org_id = ${vendorOrgId}::uuid`;
    return rows[0] ? toVendorQuality(rows[0]) : null;
  }

  // =========================================================================
  // qc_tool_provider
  // =========================================================================

  /**
   * Not on the required list, but every ingestion path needs the provider id and
   * the field map before it can do anything, and five lanes writing this lookup
   * five times is exactly what this file exists to prevent.
   */
  async findToolProviderByCode(code: string): Promise<QcToolProviderRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, code, name, vendor_company, integration_type, report_format, field_map_json,
             supports_wipe, wipe_standard, licence_expiry::text AS licence_expiry, licence_seats,
             cost_per_scan_paise, is_active
        FROM qc.qc_tool_provider WHERE code = ${code}`;
    return rows[0] ? toToolProvider(rows[0]) : null;
  }

  // =========================================================================
  // Views
  // =========================================================================

  /**
   * Stock whose inspection expires within 14 days.
   *
   * The view carries `legal_name`, which is a vendor identifier. It is fine here
   * — this feeds the ops warning job and the vendor's own dashboard — and it is
   * a P0 defect in anything a buyer sees (VR-099).
   */
  async findExpiringQc(): Promise<ExpiringQcRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT vendor_org_id, legal_name, listing_id, units_expiring,
             earliest_expiry::text AS earliest_expiry
        FROM qc.v_expiring_qc ORDER BY earliest_expiry`;
    return rows.map((r) => ({
      vendorOrgId: r.vendor_org_id as string,
      legalName: r.legal_name as string,
      listingId: r.listing_id as string | null,
      unitsExpiring: int(r.units_expiring),
      earliestExpiry: r.earliest_expiry as string | null,
    }));
  }

  /**
   * Cost per inspected unit and hours on site. Watch this number — it is the one
   * that says whether QC-at-source is economic. The view only reports COMPLETED
   * visits, so an abandoned visit's expenses are absent by design rather than
   * averaged into a per-unit cost for units nobody inspected.
   */
  async findVisitEconomics(visitId?: string): Promise<VisitEconomicsRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, visit_number, vendor_org_id, scheduled_date::text AS scheduled_date,
             units_requested, units_inspected, units_passed, units_failed,
             total_expense, cost_per_unit, hours_on_site
        FROM qc.v_visit_economics
       WHERE (${visitId ?? null}::uuid IS NULL OR id = ${visitId ?? null}::uuid)
       ORDER BY scheduled_date DESC NULLS LAST`;
    return rows.map((r) => ({
      id: r.id as string,
      visitNumber: r.visit_number as string,
      vendorOrgId: r.vendor_org_id as string,
      scheduledDate: r.scheduled_date as string | null,
      unitsRequested: r.units_requested as number,
      unitsInspected: r.units_inspected as number,
      unitsPassed: r.units_passed as number,
      unitsFailed: r.units_failed as number,
      totalExpense: moneyFromDb(r.total_expense as string) ?? Money.ZERO,
      costPerUnit: moneyFromDb(r.cost_per_unit as string | null),
      hoursOnSite: num(r.hours_on_site),
    }));
  }
}
