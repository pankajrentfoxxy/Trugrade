import type {
  AutoApprovalPolicy,
  DeclaredSpec,
  DetectedSpec,
  DeviceSureCertificate,
  Grade,
  QcArea,
  QcAreaOutcome,
} from '@trugrade/contracts';

/**
 * What the technician app holds on the device: the visit snapshot pulled at
 * check-in, and the draft of the unit currently in the technician's hands.
 *
 * Both are stored as JSON in SQLite rather than as tables. They are read whole,
 * written whole, and thrown away at the end of the visit; normalising them would
 * be schema to migrate for no query it enables.
 */

// ---------------------------------------------------------------------------
// The twelve inspection areas, and why they are declared here
// ---------------------------------------------------------------------------

/**
 * `qc.qc_area_result.area`, exactly as the CHECK constraint allows it.
 *
 * These are the **functional** subsystems DeviceSure reports, and they are not
 * the twelve areas `QC_AREAS` carries in `@trugrade/contracts` — that constant
 * names a *cosmetic* vocabulary (CHASSIS, LID, PALMREST, TRACKPAD, HINGES…) and
 * writing any of it into `qc_area_result` fails the CHECK on every row.
 *
 * This is the second private copy of this list in the repo — `apps/api`'s QC DTO
 * carries the first — which is the argument for fixing `QC_AREAS` in contracts
 * rather than the argument for a third. Flagged, not worked around: the two
 * vocabularies genuinely do not map onto each other (five cosmetic areas collapse
 * into PHYSICAL; CONNECTIVITY, CAMERA_AUDIO, BIOS_SECURITY and DATA_SECURITY have
 * no cosmetic counterpart), so a translation table would be a lossy invention
 * dressed as a mapping.
 *
 * The consequence for this app, and it is the reason the split is worth living
 * with rather than papering over: the functional results come off the DeviceSure
 * certificate and are judged by `assessCertificate()`, which takes `area` as a
 * plain string and already implements the 07 §3.1 floor rule. The cosmetic
 * results are what the *technician* grades, and they are what
 * `evaluateQcReport()` is typed for. Each contracts function is used for the
 * vocabulary it was written against, and neither list is re-derived here.
 */
export const QC_AREA_CODES = [
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
] as const;
export type QcAreaCode = (typeof QC_AREA_CODES)[number];

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

/**
 * The five `qc_photo.angle` values that are mandatory, in capture order.
 *
 * The sixth required photograph is the seal on the machine, which is **not** a
 * `qc_photo` row — it is `qc_seal.applied_photo_key`, and that column is NOT
 * NULL because there is no seal without a photograph. So "six photographs per
 * unit minimum" is these five plus the seal, and `WORST_DEFECT` is a sixth
 * `qc_photo` angle the technician may add when there is a defect worth showing.
 */
export const REQUIRED_PHOTO_ANGLES = ['LID', 'PALMREST', 'SCREEN_ON', 'PORTS', 'BASE'] as const;
export const OPTIONAL_PHOTO_ANGLES = ['WORST_DEFECT'] as const;
export type PhotoAngle = (typeof REQUIRED_PHOTO_ANGLES)[number] | (typeof OPTIONAL_PHOTO_ANGLES)[number];

/** What each shot has to show. Read out on the capture screen; guided, not free-form. */
export const PHOTO_GUIDANCE: Readonly<Record<PhotoAngle, string>> = Object.freeze({
  LID: 'Lid closed, whole surface in frame, light across it so scratches show.',
  PALMREST: 'Lid open, palmrest and trackpad, straight down.',
  SCREEN_ON: 'Screen on and showing the tool result. Dead pixels and backlight bleed must be visible.',
  PORTS: 'The port side, close enough to read the labels.',
  BASE: 'Base panel, all screws and the service tag in frame.',
  WORST_DEFECT: 'The worst cosmetic defect on this machine, close up, with something for scale.',
});

// ---------------------------------------------------------------------------
// The visit snapshot
// ---------------------------------------------------------------------------

/**
 * Everything the app needs for a whole visit, fetched at check-in while there is
 * still signal and not touched again until the technician leaves.
 *
 * The thresholds and the policy are in here rather than compiled in for the same
 * reason the server reads them from `platform_config`: a grade is a claim under
 * CP e-Comm r.7(5) and has to be reproducible against the rules in force on the
 * day. A number baked into an app binary is a number that cannot be retuned and
 * cannot be defended six months later.
 */
export interface ManifestUnit {
  visitUnitId: string;
  unitId: string;
  listingId: string | null;
  sequenceNo: number;
  /** The serial on the manifest. What a scan is compared against (QC-012). */
  serialNumber: string;
  declaredGrade: Grade;
  declaredSpec: DeclaredSpec;
  brandName: string | null;
  modelName: string | null;
}

export interface VisitSnapshot {
  visit: {
    id: string;
    visitNumber: string;
    vendorName: string;
    facilityLabel: string;
    addressLine: string;
    /** The registered facility location. `geo_variance_metres` is measured to this. */
    lat: number | null;
    lng: number | null;
    scheduledDate: string;
    slotFrom: string | null;
    slotTo: string | null;
    unitsRequested: number;
  };
  units: ManifestUnit[];
  /** `qc.qc_tolerance_rule` as at the visit date. Shown, not re-implemented. */
  toleranceRules: Array<{
    field: string;
    comparison: string;
    toleranceValue: string | null;
    severity: string;
    isBlocking: boolean;
  }>;
  /** `catalog.grade_definition` as at the visit date. Passed to `evaluateQcReport`. */
  gradeThresholds: Record<Grade, { minBatteryHealthPct: number; maxCycleCount: number }>;
  policy: AutoApprovalPolicy;
  /** The seal roll issued for this visit. Kit check verifies the physical roll matches. */
  seal: { rangeFrom: string; rangeTo: string };
  tool: { providerCode: string; version: string; deviceCertId: string };
  config: { geoVarianceAlertMetres: number; reportValidityDays: number };
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// The unit draft
// ---------------------------------------------------------------------------

export const UNIT_STEPS = [
  'SERIAL',
  'TOOL',
  'HARDWARE',
  'COSMETIC',
  'PHOTOS',
  'SEAL',
  'CONFIRM',
] as const;
export type UnitStep = (typeof UNIT_STEPS)[number];

/**
 * `SEAL` and `RECEIPT` are not `qc_photo` angles. The seal photograph belongs to
 * `qc_seal.applied_photo_key` and the receipt to `qc_visit_expense`, but all
 * three travel the same road — compressed, hashed, queued, uploaded to a signed
 * URL — so they share the row shape rather than gaining two near-copies of it.
 */
export interface DraftPhoto {
  angle: PhotoAngle | 'SEAL' | 'RECEIPT';
  /** Local file, after client-side compression. Uploaded to a signed URL at sync. */
  uri: string;
  /** SHA-256 of the compressed bytes. Goes to `qc_photo.hash` and keys the upload. */
  sha256: string;
  bytes: number;
  capturedAt: number;
}

export interface UnitDraft {
  visitUnitId: string;
  visitId: string;
  unitId: string;
  step: UnitStep;
  startedAt: number;
  /** As scanned or typed, after `normalisePastedSerial`. */
  scannedSerial: string | null;
  /** The DeviceSure certificate, verbatim. Never edited, never corrected here. */
  certificate: DeviceSureCertificate | null;
  /** Parsed out of the certificate for `compareSpec`. Absent fields are unknowns. */
  detectedSpec: DetectedSpec | null;
  /** The technician's own cosmetic judgement, in the contracts vocabulary. */
  cosmetic: Partial<Record<QcArea, QcAreaOutcome>>;
  photos: DraftPhoto[];
  seal: { code: string } | null;
  notes: string;
  /**
   * A technician disagreeing with the computed grade, and why.
   *
   * `qc_report` carries `CHECK (grade_proposed = grade_final OR
   * grade_override_reason IS NOT NULL)`, so an override without a written reason
   * is rejected by the database. The app collects the reason at the point of the
   * override rather than letting the row fail three hours later in the queue.
   */
  gradeOverride: { grade: Grade; reason: string } | null;
  /** Set instead of everything above when the vendor cannot produce the machine. */
  absentReason: string | null;
}

export function newDraft(unit: ManifestUnit, visitId: string, startedAt: number): UnitDraft {
  return {
    visitUnitId: unit.visitUnitId,
    visitId,
    unitId: unit.unitId,
    step: 'SERIAL',
    startedAt,
    scannedSerial: null,
    certificate: null,
    detectedSpec: null,
    cosmetic: {},
    photos: [],
    seal: null,
    notes: '',
    gradeOverride: null,
    absentReason: null,
  };
}
