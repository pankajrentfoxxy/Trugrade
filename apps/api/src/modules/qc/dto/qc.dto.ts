import { z } from 'zod';
import {
  gradeSchema,
  moneySchema,
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

// ---------------------------------------------------------------------------
// The QC console and the technician app, over HTTP
// ---------------------------------------------------------------------------

/**
 * A `HH:MM` or `HH:MM:SS` slot boundary.
 *
 * `qc_visit.slot_from` is a `time`, and `SchedulingService.normaliseTime()`
 * already turns both forms into what the column returns. This only refuses the
 * shapes that would reach it as an unparseable bind.
 */
export const slotTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected a time like 09:30.');

/**
 * The technician app's replay key.
 *
 * Every mutating request its outbox sends carries one — in the body and as an
 * `idempotency-key` header — and `qc_report.nonce` / `qc_tool_run.nonce` are
 * UNIQUE, so a replayed row lands on the constraint rather than creating a
 * second inspection. The console does not send one: it is not replaying
 * anything, and a nonce it invented per submit would dedupe nothing.
 */
export const nonceSchema = z.string().min(8).max(128);

/**
 * The visit board's filter, as the **console** spells it.
 *
 * `from`/`to` rather than the `scheduledFrom`/`scheduledTo` of
 * `visitFilterSchema` above, because `apps/console/src/routes/qc/VisitBoard.tsx`
 * builds the query string and the client is the contract. The two mean the same
 * thing, and the rename happens at the call site rather than in the column.
 */
export const visitBoardQuerySchema = z.object({
  status: qcVisitStatusSchema.optional(),
  vendorOrgId: uuidSchema.optional(),
  technicianId: uuidSchema.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type VisitBoardQueryDto = z.infer<typeof visitBoardQuerySchema>;

/** `GET /qc/schedule?from=` — omit `from` for the week containing today. */
export const scheduleQuerySchema = z.object({ from: z.string().date().optional() });
export type ScheduleQueryDto = z.infer<typeof scheduleQuerySchema>;

/** `GET /qc/technician/route?date=` — the signed-in technician's day. */
export const routeQuerySchema = z.object({ date: z.string().date() });
export type RouteQueryDto = z.infer<typeof routeQuerySchema>;

/**
 * Booking a visit: the request and the slot, in one call.
 *
 * `schedule` is nested rather than four sibling optionals because the four
 * fields are one decision — a date with no slot is not a half-booking, it is a
 * row `SchedulingService.schedule()` refuses. Omit the whole object to file a
 * REQUESTED visit that ops will schedule later.
 */
export const createVisitSchema = z.object({
  vendorOrgId: uuidSchema,
  facilityId: uuidSchema,
  addressId: uuidSchema,
  unitsRequested: z.number().int().min(1).max(1000),
  /** The manifest, where it is already known. Units may also be added later. */
  unitIds: z.array(uuidSchema).max(1000).optional(),
  notes: z.string().max(2000).optional(),
  schedule: z
    .object({
      scheduledDate: z.string().date(),
      slotFrom: slotTimeSchema,
      slotTo: slotTimeSchema,
      technicianId: uuidSchema.optional(),
    })
    .optional(),
});
export type CreateVisitDto = z.infer<typeof createVisitSchema>;

/**
 * Arrival at the vendor's site.
 *
 * The technician app also sends `accuracyMetres`, `capturedAt` and its nonce;
 * zod strips what is not declared, and only the coordinates change anything.
 * `capturedAt` is deliberately not honoured — the arrival instant is the
 * server's clock, because a device clock is the one input a technician can set.
 */
export const checkInSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  nonce: nonceSchema.optional(),
});
export type CheckInDto = z.infer<typeof checkInSchema>;

/** Three-valued on purpose: "we did not check" is not "no". */
export const tristateSchema = z.enum(['YES', 'NO', 'UNKNOWN']);

export const manualAreaResultSchema = z.object({
  area: qcAreaCodeSchema,
  status: qcAreaStatusSchema,
  score: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(1).max(100),
  note: z.string().max(500).nullable().optional(),
});

/**
 * What a technician can read off a machine without a tool.
 *
 * Every field is nullable, and null means **not reported** rather than zero — a
 * cycle count of 0 on a worn battery is a form defaulting, not a measurement
 * (07 §2). The hardware row is written only when there is something in it.
 */
export const manualHardwareSchema = z.object({
  ramDetectedGb: z.number().int().min(1).max(512).nullable(),
  ramModules: z.number().int().min(0).max(8).nullable(),
  storageType: z.string().max(32).nullable(),
  storageDetectedGb: z.number().int().min(1).max(65_536).nullable(),
  smartStatus: z.enum(SMART_STATUSES).nullable(),
  batteryHealthPct: z.number().int().min(0).max(100).nullable(),
  cycleCount: z.number().int().min(0).max(10_000).nullable(),
  biosLocked: tristateSchema,
  mdmLocked: tristateSchema,
  computraceActive: tristateSchema,
});

export const manualPhotoSchema = z.object({
  angle: qcPhotoAngleSchema,
  fileKey: fileKeySchema,
  hash: sha256Schema,
});

/**
 * The web console's full manual inspection — the Phase 4 fallback that has to
 * work with no mobile app in the building.
 *
 * It mirrors `ManualInspectionPayload` in `apps/console/src/routes/qc/types.ts`
 * field for field. `qcScore`, the two grades and `verdict` are the technician's
 * reading and are recorded as exactly that; the server re-derives all four
 * through `VerdictService`, and its answer is what the report ends up carrying.
 * Sending them anyway is what makes a disagreement visible instead of invisible.
 */
export const manualReportSchema = z.object({
  visitId: uuidSchema,
  visitUnitId: uuidSchema,
  unitId: uuidSchema,
  technicianId: uuidSchema,
  serialScanned: z.string().min(1).max(64),
  serialMatches: z.boolean(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  areaResults: z.array(manualAreaResultSchema).max(QC_AREA_CODES.length),
  /** Named, so an unmeasured area is a decision on the record and not a gap. */
  areasNotMeasured: z.array(qcAreaCodeSchema).max(QC_AREA_CODES.length),
  hardware: manualHardwareSchema,
  photos: z.array(manualPhotoSchema).max(QC_PHOTO_ANGLES.length),
  seal: z
    .object({ sealCode: sealCodeSchema, photoKey: fileKeySchema, photoHash: sha256Schema })
    .nullable(),
  qcScore: z.number().int().min(0).max(100),
  gradeProposed: gradeSchema.nullable(),
  gradeFinal: gradeSchema.nullable(),
  gradeOverrideReason: z.string().max(1000).nullable(),
  verdict: qcVerdictValueSchema,
  notes: z.string().max(2000).nullable(),
  nonce: nonceSchema.optional(),
});
export type ManualReportDto = z.infer<typeof manualReportSchema>;

/**
 * The technician app's finished unit — the same event arriving from the other
 * client.
 *
 * It differs from `manualReportSchema` in one way that matters: photographs
 * travel as **hashes**, not keys, because the app uploaded them through a
 * pre-signed PUT whose key the server derived from the hash. Resolving the hash
 * back to that key server-side is what makes a resumed upload idempotent.
 */
export const unitResultSchema = z.object({
  unitId: uuidSchema,
  scannedSerial: z.string().min(1).max(64),
  serialMatches: z.boolean(),
  /** Epoch milliseconds, as the device recorded them. */
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  durationSeconds: z.number().int().min(0).optional(),
  areaResults: z.array(manualAreaResultSchema).max(QC_AREA_CODES.length).optional(),
  photoHashes: z.array(z.object({ angle: z.string().max(32), sha256: sha256Schema })).max(16),
  sealCode: sealCodeSchema.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  gradeOverride: gradeSchema.nullable().optional(),
  nonce: nonceSchema,
});
export type UnitResultDto = z.infer<typeof unitResultSchema>;

/** `CHECK (length(btrim(reason)) >= 3)` sits behind every column these land in. */
export const reasonSchema = z.string().trim().min(3).max(500);

export const untestableSchema = z.object({
  reason: reasonSchema,
  serialScanned: z.string().max(64).optional(),
  nonce: nonceSchema.optional(),
});
export type UntestableDto = z.infer<typeof untestableSchema>;

export const absentSchema = z.object({
  absentReason: reasonSchema,
  nonce: nonceSchema.optional(),
});
export type AbsentDto = z.infer<typeof absentSchema>;

/** The seal, applied and photographed. `applied_photo_key` is NOT NULL. */
export const applySealSchema = z.object({
  unitId: uuidSchema,
  sealCode: sealCodeSchema,
  appliedPhotoSha256: sha256Schema,
  nonce: nonceSchema.optional(),
});
export type ApplySealDto = z.infer<typeof applySealSchema>;

export const signoffSchema = z.object({
  otp: z.string().regex(/^\d{4,8}$/, 'Enter the code from the SMS.'),
  contactName: z.string().trim().min(2).max(120),
  nonce: nonceSchema.optional(),
});
export type SignoffDto = z.infer<typeof signoffSchema>;

/**
 * A visit expense. `amountInr` is a decimal **string** all the way down.
 *
 * `qc_visit_expense.amount` feeds `qc.v_visit_economics`, which is the number
 * that decides whether QC-at-source pays for itself. A float that loses a paisa
 * per receipt makes that number quietly wrong.
 */
export const expenseSchema = z.object({
  category: z.enum([
    'TRAVEL',
    'FUEL',
    'TOLL',
    'PARKING',
    'FOOD',
    'ACCOMMODATION',
    'TOOL_LICENCE',
    'OTHER',
  ]),
  amountInr: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Send the amount as a decimal string.'),
  distanceKm: z.number().min(0).max(5000).nullable().optional(),
  receiptSha256: sha256Schema.nullable().optional(),
  note: z.string().max(500).optional(),
  nonce: nonceSchema.optional(),
});
export type ExpenseDto = z.infer<typeof expenseSchema>;

/**
 * A sampling rule, as the console's form posts it.
 *
 * The three percentages arrive as strings because the columns are
 * `NUMERIC(5,2)` and the form renders them straight back; they are converted
 * once, at the call site, rather than at four of them.
 */
export const samplingRuleSchema = z.object({
  vendorTier: vendorTierSchema,
  minUnitsInspected: z.number().int().min(0).max(100_000),
  minPassRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  minGradeAccuracy: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  samplePct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  alwaysFullAboveValue: z
    .string()
    .regex(/^\d{1,12}(\.\d{1,2})?$/)
    .nullable(),
  effectiveFrom: z.string().date(),
});
export type SamplingRuleDto = z.infer<typeof samplingRuleSchema>;

/**
 * The field map, edited in the console: OUR column -> THEIR payload path.
 *
 * Both sides are constrained. A key is a `qc_hardware_detected` column name and
 * a value is a dotted path into the provider's JSON, so neither may be an
 * object — a nested map parses to garbage the first time the generic parser
 * walks it, and the failure surfaces as a hardware row full of nulls rather
 * than as an error anybody sees.
 */
export const fieldMapSchema = z.object({
  fieldMapJson: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Keys are qc_hardware_detected column names.'),
    z.string().min(1).max(256),
  ),
});
export type FieldMapDto = z.infer<typeof fieldMapSchema>;

/** Recording an audit recheck against the report it re-inspected. */
export const auditRecheckSchema = z.object({ recheckReportId: uuidSchema });
export type AuditRecheckDto = z.infer<typeof auditRecheckSchema>;

/**
 * The QC manager's ruling on a disputed grade correction.
 *
 * `upheld` defaults to TRUE because the console's only button says "uphold the
 * dispute" — and because the safe default on an ambiguous body is the one that
 * does *not* silently re-grade a vendor's machine.
 */
export const disputeRulingSchema = z.object({
  upheld: z.boolean().optional(),
  note: z.string().max(1000).optional(),
});
export type DisputeRulingDto = z.infer<typeof disputeRulingSchema>;

/**
 * The vendor's answer to a grade correction. Four answers, and they are peers.
 *
 * The response is required and has no default. A body that arrives without one
 * is not "probably an accept" — accepting re-grades a machine and changes what
 * the vendor is paid for it, and the auto-apply job already exists to make that
 * decision when nobody makes it deliberately.
 *
 * `vendorAskPrice` is refused on the three responses that do not price anything,
 * rather than ignored. A vendor who typed an amount and picked WITHDRAW_UNIT has
 * asked for two different things, and silently honouring one of them is how a
 * machine goes back on the shelf at a number nobody agreed to.
 */
export const vendorCorrectionResponseSchema = z
  .object({
    response: z.enum(['ACCEPT_NEW_GRADE', 'ACCEPT_AND_REPRICE', 'WITHDRAW_UNIT', 'DISPUTE'], {
      message: 'Choose one of the four answers to this correction.',
    }),
    /** `NET_PAYOUT` — what the vendor receives, never a selling price. */
    vendorAskPrice: moneySchema.optional(),
    /** Read by a QC manager on a dispute; kept with the record on the others. */
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.response === 'ACCEPT_AND_REPRICE' && !v.vendorAskPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['vendorAskPrice'],
        message: 'Accepting at a new price needs the amount you want for this machine.',
      });
    }
    if (v.response !== 'ACCEPT_AND_REPRICE' && v.vendorAskPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['vendorAskPrice'],
        message:
          'Only “accept at a new price” changes what you are paid. Pick that answer, or clear the amount.',
      });
    }
  });
export type VendorCorrectionResponseDto = z.infer<typeof vendorCorrectionResponseSchema>;

/**
 * A photograph the technician app is about to PUT.
 *
 * The object key is derived from the content hash, so the sign request and the
 * confirmation that follows it carry the identical facts and a resumed upload
 * cannot produce a second object.
 */
export const photoSignSchema = z.object({
  purpose: z.enum(['QC_PHOTO', 'SEAL', 'EXPENSE_RECEIPT']),
  sha256: sha256Schema,
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().min(1).max(15 * 1024 * 1024),
  angle: z.string().max(32).optional(),
  visitUnitId: uuidSchema.nullable().optional(),
  expenseLocalId: z.string().max(64).nullable().optional(),
  nonce: nonceSchema.optional(),
});
export type PhotoSignDto = z.infer<typeof photoSignSchema>;
