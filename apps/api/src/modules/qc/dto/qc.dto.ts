import { z } from 'zod';
import {
  gradeSchema,
  paginationSchema,
  sealCodeSchema,
  uuidSchema,
  verificationCodeSchema,
} from '@trugrade/contracts';

/**
 * The QC module's shared vocabulary and request shapes.
 *
 * Six lanes build on this file, so it has one job above all others: **be the
 * database's vocabulary, not the phase document's.** Every enum below was read
 * off a live CHECK or a CREATE TYPE, because a value that only exists in a doc
 * reaches Postgres as `qc_area_result_area_check` and a 500, and the lane that
 * wrote it finds out on the first inserted row rather than at compile time.
 *
 * Where a value already has a schema in `@trugrade/contracts` it is re-exported
 * rather than restated — `sealCodeSchema`, `verificationCodeSchema`,
 * `gradeSchema`. A second copy that agrees today is a second copy that drifts.
 */

// ---------------------------------------------------------------------------
// The twelve inspection areas
// ---------------------------------------------------------------------------

/**
 * `qc.qc_area_result.area`, exactly as the CHECK constraint allows it.
 *
 * *** These are NOT the twelve areas PHASE_04_QC.md Task 3 lists, and they are
 * not `QC_AREAS` in `@trugrade/contracts`. *** Both of those name a cosmetic
 * vocabulary — chassis, lid, palmrest, trackpad, hinges, screen — and writing
 * any of them here fails `qc_area_result_area_check` on every single row.
 *
 * SQL is the source of truth, so the schema's list wins. The cosmetic
 * vocabulary is real, but it belongs to `catalog.grade_definition`
 * (`allowed_defects_json`), which is what decides the *condition* grade. These
 * twelve are functional subsystems, which is what decides PASS/WARN/FAIL.
 *
 * Consequence the verdict lane must know about: `evaluateQcReport()` in
 * `@trugrade/contracts` types its `AreaResult.area` as the contracts `QcArea`,
 * i.e. the cosmetic list. The two vocabularies do not map onto one another —
 * CHASSIS, LID, PALMREST, TRACKPAD and HINGES all collapse into PHYSICAL, and
 * CONNECTIVITY, CAMERA_AUDIO, BIOS_SECURITY and DATA_SECURITY have no cosmetic
 * counterpart at all. No translation table is provided here on purpose: one
 * would be a lossy invention dressed up as a mapping, and rule 3 of this phase
 * is that we do not paper over a defect in a layer that cannot see it. The fix
 * belongs in `@trugrade/contracts`; it is flagged, not worked around.
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

/**
 * `qc_area_result.status`. Three values, not four.
 *
 * There is no NOT_MEASURED here, and that is a real gap rather than an
 * oversight: never-fabricate (07 §2) says a missing value is not a passing
 * value, and `QC_AREA_OUTCOMES` in contracts carries the fourth outcome. The
 * column cannot hold it. Until the CHECK is widened, an unmeasured area is
 * recorded as an **absent row** — never written as PASS — and the verdict
 * engine's `blockOnRequiredNotMeasured` reads the absence.
 */
export const QC_AREA_STATUSES = Object.freeze(['PASS', 'WARN', 'FAIL'] as const);
export type QcAreaStatus = (typeof QC_AREA_STATUSES)[number];

// ---------------------------------------------------------------------------
// Everything else the database will refuse if we guess
// ---------------------------------------------------------------------------

/** `public.qc_verdict`. */
export const QC_VERDICT_VALUES = Object.freeze([
  'PASS',
  'PASS_WITH_NOTE',
  'MISMATCH',
  'FAIL',
] as const);
export type QcVerdictValue = (typeof QC_VERDICT_VALUES)[number];

/** `public.qc_visit_status`. */
export const QC_VISIT_STATUSES = Object.freeze([
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
export type QcVisitStatus = (typeof QC_VISIT_STATUSES)[number];

/** `public.qc_unit_outcome`. UNTESTABLE is where a serial mismatch lands (QC-012). */
export const QC_UNIT_OUTCOMES = Object.freeze([
  'PENDING',
  'PASS',
  'PASS_GRADE_CORRECTED',
  'PASS_WITH_NOTE',
  'FAIL',
  'UNTESTABLE',
  'ABSENT',
] as const);
export type QcUnitOutcome = (typeof QC_UNIT_OUTCOMES)[number];

/**
 * `public.seal_status`. Five values.
 *
 * `SEAL_TRANSITIONS` in `@trugrade/contracts` also lists VOID, which this enum
 * does not have — so it fails as an enum cast rather than as a CHECK, which is
 * even more obscure. Use MISSING or BROKEN.
 */
export const SEAL_STATUSES = Object.freeze([
  'APPLIED',
  'INTACT',
  'BROKEN',
  'MISSING',
  'REPLACED',
] as const);
export type SealStatus = (typeof SEAL_STATUSES)[number];

/** `public.qc_location_type`. */
export const QC_LOCATION_TYPES = Object.freeze([
  'VENDOR_SITE',
  'HUB',
  'BUYER_SITE',
  'THIRD_PARTY_LAB',
] as const);
export type QcLocationType = (typeof QC_LOCATION_TYPES)[number];

/** `qc_tool_run.parse_status`. */
export const PARSE_STATUSES = Object.freeze([
  'PENDING',
  'PARSED',
  'PARSE_FAILED',
  'MANUAL_ENTRY',
] as const);
export type ParseStatus = (typeof PARSE_STATUSES)[number];

/**
 * `qc_photo.angle`. Six angles — and the seal photograph is **not** one of them.
 * It lives on `qc_seal.applied_photo_key`, which is NOT NULL, because there is
 * no seal without a photograph.
 */
export const QC_PHOTO_ANGLES = Object.freeze([
  'LID',
  'PALMREST',
  'SCREEN_ON',
  'BASE',
  'PORTS',
  'WORST_DEFECT',
] as const);
export type QcPhotoAngle = (typeof QC_PHOTO_ANGLES)[number];

/** `qc_mismatch.severity` and `qc_tolerance_rule.severity` share this list. */
export const MISMATCH_SEVERITIES = Object.freeze(['BLOCKING', 'MAJOR', 'MINOR'] as const);
export type MismatchSeverity = (typeof MISMATCH_SEVERITIES)[number];

/** `qc_mismatch.resolution`. */
export const MISMATCH_RESOLUTIONS = Object.freeze([
  'DISCOUNT',
  'SWAP',
  'CANCEL',
  'ACCEPT_AS_IS',
] as const);
export type MismatchResolution = (typeof MISMATCH_RESOLUTIONS)[number];

/**
 * `qc_tolerance_rule.comparison`. The CHECK allows five; only four are seeded.
 * WITHIN_BAND is legal but unused today — do not read the seeded set as the
 * allowed set when writing the tolerance engine.
 */
export const TOLERANCE_COMPARISONS = Object.freeze([
  'EXACT',
  'GTE',
  'WITHIN_PCT',
  'WITHIN_BAND',
  'ONE_BAND_DOWN',
] as const);
export type ToleranceComparison = (typeof TOLERANCE_COMPARISONS)[number];

/** `qc_reverification.trigger`. */
export const REVERIFICATION_TRIGGERS = Object.freeze([
  'DISPATCH_PICKUP',
  'SEAL_BROKEN',
  'QC_EXPIRED',
  'RANDOM_AUDIT',
  'BUYER_DISPUTE',
  'VENDOR_REQUEST',
] as const);
export type ReverificationTrigger = (typeof REVERIFICATION_TRIGGERS)[number];

/** `qc_reverification.method`. */
export const REVERIFICATION_METHODS = Object.freeze([
  'SEAL_CHECK',
  'QUICK_SCAN',
  'FULL_RESCAN',
] as const);
export type ReverificationMethod = (typeof REVERIFICATION_METHODS)[number];

/** `qc_reverification.outcome`. */
export const REVERIFICATION_OUTCOMES = Object.freeze([
  'PASS',
  'FAIL_RESEND_TO_QC',
  'FAIL_REJECT',
  'ESCALATE',
] as const);
export type ReverificationOutcome = (typeof REVERIFICATION_OUTCOMES)[number];

/** `qc_hardware_detected.smart_status`. */
export const SMART_STATUSES = Object.freeze(['OK', 'WARNING', 'FAILING'] as const);
export type SmartStatus = (typeof SMART_STATUSES)[number];

/**
 * `qc_visit.fee_bearer`. TRUETECH is the platform, under the pre-rename
 * spelling the CHECK still carries. Writing 'PLATFORM' fails the constraint.
 */
export const VISIT_FEE_BEARERS = Object.freeze(['TRUETECH', 'VENDOR', 'SPLIT', 'WAIVED'] as const);
export type VisitFeeBearer = (typeof VISIT_FEE_BEARERS)[number];

/** `qc_technician.employment_type`. */
export const EMPLOYMENT_TYPES = Object.freeze(['INHOUSE', 'CONTRACT', 'PARTNER'] as const);
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** `technician_availability.status`. */
export const AVAILABILITY_STATUSES = Object.freeze([
  'AVAILABLE',
  'BOOKED',
  'LEAVE',
  'TRAVEL',
  'HOLIDAY',
] as const);
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/** `public.vendor_tier` — the key `qc_sampling_rule` is looked up by. */
export const VENDOR_TIERS = Object.freeze([
  'WATCHLIST',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
] as const);
export type VendorTier = (typeof VENDOR_TIERS)[number];

/** `wipe_certificate.verification_status`. */
export const WIPE_VERIFICATION_STATUSES = Object.freeze(['VERIFIED', 'FAILED'] as const);
export type WipeVerificationStatus = (typeof WIPE_VERIFICATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Zod mirrors, for the endpoints the other lanes will add
// ---------------------------------------------------------------------------

export const qcAreaCodeSchema = z.enum(QC_AREA_CODES);
export const qcAreaStatusSchema = z.enum(QC_AREA_STATUSES);
export const qcVerdictValueSchema = z.enum(QC_VERDICT_VALUES);
export const qcVisitStatusSchema = z.enum(QC_VISIT_STATUSES);
export const qcUnitOutcomeSchema = z.enum(QC_UNIT_OUTCOMES);
export const sealStatusSchema = z.enum(SEAL_STATUSES);
export const parseStatusSchema = z.enum(PARSE_STATUSES);
export const qcPhotoAngleSchema = z.enum(QC_PHOTO_ANGLES);
export const mismatchSeveritySchema = z.enum(MISMATCH_SEVERITIES);
export const mismatchResolutionSchema = z.enum(MISMATCH_RESOLUTIONS);
export const reverificationTriggerSchema = z.enum(REVERIFICATION_TRIGGERS);
export const reverificationMethodSchema = z.enum(REVERIFICATION_METHODS);
export const reverificationOutcomeSchema = z.enum(REVERIFICATION_OUTCOMES);
export const vendorTierSchema = z.enum(VENDOR_TIERS);

/** An object-store key, as a completed upload hands it back. */
export const fileKeySchema = z.string().min(1).max(512);

/** SHA-256 hex. Photograph hashes, and `qc_tool_run.raw_report_hash`. */
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a SHA-256 hex digest.');

/**
 * Re-exported so the public verification route, the seal scanner and the
 * generator in the repository cannot drift from the rules that back them.
 */
export { sealCodeSchema, verificationCodeSchema, gradeSchema, uuidSchema, paginationSchema };

/**
 * The visit board's filter, shared by the QC console and the technician's route.
 *
 * `scheduledFrom`/`scheduledTo` are dates, not instants, because `qc_visit` is
 * one technician, one site, one **day** — a timestamp here would invite a
 * timezone bug on a column that has none.
 */
export const visitFilterSchema = paginationSchema.extend({
  status: qcVisitStatusSchema.optional(),
  vendorOrgId: uuidSchema.optional(),
  technicianId: uuidSchema.optional(),
  scheduledFrom: z.string().date().optional(),
  scheduledTo: z.string().date().optional(),
});
export type VisitFilterDto = z.infer<typeof visitFilterSchema>;
