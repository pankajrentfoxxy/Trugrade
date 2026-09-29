import {
  GRADES,
  GRADE_CAP_RULES,
  QC_AREA_SCORE,
  SEAL_CODE,
  normalisePastedSerial,
  type Grade,
} from '@trugrade/contracts';
import {
  PHOTO_ANGLES,
  PHOTO_LABEL,
  QC_AREA_CODES,
  AREA_LABEL,
  type AreaStatus,
  type ManifestUnit,
  type ManualInspectionPayload,
  type PhotoAngle,
  type QcAreaCode,
  type Tristate,
  type UploadedFile,
  type Verdict,
} from './types';
import type { OrderInspectionSlot } from './order-inspection-types';

/**
 * Everything the manual inspection form refuses to submit, and why.
 *
 * This is a pure function on purpose. It is the only part of Task 8 that decides
 * anything, the screen around it is layout, and a rule that can only be exercised
 * by rendering a form and clicking through it is a rule nobody will exercise.
 *
 * The checks fall into three groups, and it is worth being explicit about which
 * is which because they fail for different reasons:
 *
 *   1. **Constraints the database will enforce anyway.** `chk_override_reason`,
 *      `qc_seal.applied_photo_key NOT NULL`, the area CHECK. Catching these here
 *      buys a sentence instead of a 500 — the constraint is still the control.
 *   2. **Never-fabricate.** An unmeasured area is not a passing area, and a cycle
 *      count of zero is not a cycle count. The form has to make the honest answer
 *      available, or the dishonest one gets typed.
 *   3. **The grade is our legal claim, not the tool's.** `07 section 3.1` found
 *      DeviceSure issuing a certificate graded A+ with a failed USB port, and we
 *      reject that certificate on ingestion. A manual form that can produce the
 *      same self-contradicting record by hand would make that rejection
 *      decorative, so the cap rules apply identically here. This is the group
 *      that would be easy to leave out and expensive to leave out.
 */

export type AreaChoice = AreaStatus | 'NOT_MEASURED' | '';

export interface AreaEntry {
  status: AreaChoice;
  /** Kept as typed text so an empty box is distinguishable from a zero. */
  score: string;
  note: string;
}

export interface HardwareEntry {
  ramDetectedGb: string;
  ramModules: string;
  storageType: string;
  storageDetectedGb: string;
  smartStatus: '' | 'OK' | 'WARNING' | 'FAILING';
  batteryHealthPct: string;
  cycleCount: string;
  /** The §3.5 defect, as a control: zero is a measurement, not-reported is the truth. */
  cycleCountNotReported: boolean;
  biosLocked: Tristate;
  mdmLocked: Tristate;
  computraceActive: Tristate;
}

export interface InspectionState {
  /**
   * A manifest line chosen by hand. Normally empty: the serial finds the line
   * (`resolveUnit`). Set only from the hard-stop box, to say which manifest
   * unit carried a label that matched nothing, so it can be closed UNTESTABLE.
   */
  visitUnitId: string;
  /** On an order visit: the vacant slot the typed serial will name. */
  slotId: string;
  technicianId: string;
  serialScanned: string;
  startedAt: string;
  completedAt: string;
  areas: Record<QcAreaCode, AreaEntry>;
  hardware: HardwareEntry;
  photos: Partial<Record<PhotoAngle, UploadedFile>>;
  sealCode: string;
  sealPhoto: UploadedFile | null;
  qcScore: string;
  gradeProposed: Grade | '';
  gradeFinal: Grade | '';
  gradeOverrideReason: string;
  verdict: Verdict;
  notes: string;
}

export function emptyInspection(technicianId = ''): InspectionState {
  return {
    visitUnitId: '',
    slotId: '',
    technicianId,
    serialScanned: '',
    startedAt: '',
    completedAt: '',
    areas: Object.fromEntries(
      QC_AREA_CODES.map((a) => [a, { status: '', score: '', note: '' }]),
    ) as Record<QcAreaCode, AreaEntry>,
    hardware: {
      ramDetectedGb: '',
      ramModules: '',
      storageType: '',
      storageDetectedGb: '',
      smartStatus: '',
      batteryHealthPct: '',
      cycleCount: '',
      cycleCountNotReported: false,
      biosLocked: 'UNKNOWN',
      mdmLocked: 'UNKNOWN',
      computraceActive: 'UNKNOWN',
    },
    photos: {},
    sealCode: '',
    sealPhoto: null,
    qcScore: '',
    gradeProposed: '',
    gradeFinal: '',
    gradeOverrideReason: '',
    verdict: 'PASS',
    notes: '',
  };
}

export interface Blocker {
  /** Stable id, so the screen can anchor the message to the control that caused it. */
  field: string;
  message: string;
}

export interface InspectionCheck {
  blockers: Blocker[];
  /** Advisory. Worth reading, never worth refusing over. */
  notices: string[];
  /**
   * The serial on the label does not belong to this laptop (QC-012). Nothing is
   * graded, nothing is sealed, nothing is listed — the only action left is to
   * record the unit UNTESTABLE and raise it to the QC manager.
   */
  hardStop: boolean;
  /** What the scan normalises to, VR-076, and what gets compared and stored. */
  normalisedSerial: string;
}

const gradeRank = (g: Grade): number => GRADES.indexOf(g);

/**
 * An ordered machine has no manifest line until its serial names one of these:
 * the order's slots that no serial has filled yet.
 */
export interface OrderTarget {
  openSlots: readonly OrderInspectionSlot[];
  /** False while the order's slots are still on their way (or failed to come). Defaults to true. */
  loaded?: boolean;
}

/** One model still open on the order, and the slots a serial of it can fill. */
export interface OrderModel {
  key: string;
  title: string | null;
  specSummary: string | null;
  grade: string;
  slotIds: string[];
}

/** The distinct models among the open slots, in order-line order. */
export function modelsOf(openSlots: readonly OrderInspectionSlot[]): OrderModel[] {
  const out = new Map<string, OrderModel>();
  for (const s of openSlots) {
    const key = `${s.title ?? ''}|${s.grade}`;
    const m = out.get(key) ?? { key, title: s.title, specSummary: s.specSummary, grade: s.grade, slotIds: [] };
    m.slotIds.push(s.slotId);
    out.set(key, m);
  }
  return [...out.values()];
}

/**
 * The manifest line the form is about. The serial finds it — there is no
 * dropdown to pick a machine from, because the machine in the technician's
 * hands is the one whose sticker they are reading. A line chosen by hand
 * (`visitUnitId`) wins, so a wrong label can still be closed against the unit
 * it was on.
 */
export function resolveUnit(state: InspectionState, manifest: readonly ManifestUnit[]): ManifestUnit | undefined {
  const chosen = manifest.find((m) => m.visitUnitId === state.visitUnitId);
  if (chosen) return chosen;
  const serial = normalisePastedSerial(state.serialScanned);
  return serial === '' ? undefined : manifest.find((m) => normalisePastedSerial(m.serialNumber) === serial);
}

/**
 * The grade ceiling the area results impose, per `GRADE_CAP_RULES`.
 *
 * A weighted mean cannot express "one critical component failed" — eleven areas
 * at 10 and one at 3 averages to something that still reads as excellent. So the
 * mean never decides alone, and this is the floor rule that stops it.
 *
 * `criticalFail` is absent from the branch list deliberately: `qc_area_result`'s
 * CHECK allows PASS, WARN and FAIL only, so there is no way to record a critical
 * failure distinctly and no honest way to infer one.
 */
export function gradeCap(areas: Record<QcAreaCode, AreaEntry>): { cap: Grade; reason: string } | null {
  const entries = Object.entries(areas) as Array<[QcAreaCode, AreaEntry]>;
  const failed = entries.filter(([, e]) => e.status === 'FAIL');
  if (failed.length > 0) {
    return {
      cap: GRADE_CAP_RULES.failOnRequired,
      reason: `${failed.map(([a]) => AREA_LABEL[a]).join(', ')} failed.`,
    };
  }
  const notMeasured = entries.filter(([, e]) => e.status === 'NOT_MEASURED');
  if (notMeasured.length > 0) {
    return {
      cap: GRADE_CAP_RULES.notMeasuredOnRequired,
      reason: `${notMeasured.map(([a]) => AREA_LABEL[a]).join(', ')} not measured.`,
    };
  }
  const warned = entries.filter(([, e]) => e.status === 'WARN');
  if (warned.length > 0) {
    return {
      cap: GRADE_CAP_RULES.warnOnRequired,
      reason: `${warned.map(([a]) => AREA_LABEL[a]).join(', ')} carry a warning.`,
    };
  }
  return null;
}

/**
 * A `datetime-local` value (`2026-09-29T10:00`, the technician's own clock, no
 * zone) as the ISO instant the API's `z.string().datetime()` accepts. The
 * browser is in the room with the machine, so its zone is the right one.
 */
export const toInstant = (local: string): string => {
  const ms = new Date(local).getTime();
  return Number.isNaN(ms) ? local : new Date(ms).toISOString();
};

const isPass = (v: Verdict): boolean => v === 'PASS' || v === 'PASS_WITH_NOTE';

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function checkInspection(
  state: InspectionState,
  manifest: readonly ManifestUnit[],
  /** Given on an order visit, where the serial names a slot instead of matching a line. */
  order?: OrderTarget,
): InspectionCheck {
  const blockers: Blocker[] = [];
  const notices: string[] = [];
  const unit = order ? undefined : resolveUnit(state, manifest);
  const normalisedSerial = normalisePastedSerial(state.serialScanned);

  if (order) {
    if (order.loaded === false) {
      blockers.push({ field: 'slotId.pending', message: 'The order’s machines have not loaded yet, so there is nothing to name the serial against.' });
    } else if (order.openSlots.length === 0) {
      blockers.push({
        field: 'slotId',
        message: 'Every machine on this order has already been recorded. There is nothing left to inspect on this visit.',
      });
    } else if (!order.openSlots.some((s) => s.slotId === state.slotId)) {
      blockers.push({ field: 'slotId', message: 'Say which ordered machine this is.' });
    }
  }
  if (!state.technicianId) {
    blockers.push({ field: 'technicianId', message: 'Record which technician did the inspection.' });
  }

  // ---- The serial, and the hard stop -------------------------------------
  let hardStop = false;
  if (normalisedSerial === '') {
    blockers.push({ field: 'serialScanned', message: 'Scan or type the serial off the machine.' });
  } else if (!order && !unit) {
    hardStop = true;
    blockers.push({
      field: 'serialScanned',
      message:
        `The machine reads ${normalisedSerial}, and no unit on this visit's manifest carries that serial. ` +
        'The label does not belong to any laptop we were sent to see. Do not grade it, do not seal it — ' +
        'record it UNTESTABLE against the unit it was on and raise it to the QC manager.',
    });
  } else if (unit && normalisedSerial !== normalisePastedSerial(unit.serialNumber)) {
    hardStop = true;
    blockers.push({
      field: 'serialScanned',
      message:
        `The machine reads ${normalisedSerial}, the manifest says ${unit.serialNumber}. ` +
        'The label does not belong to this laptop. Do not grade it, do not seal it — ' +
        'record it UNTESTABLE and raise it to the QC manager.',
    });
  }

  // ---- Timing. Lexical compare is exact for `YYYY-MM-DDTHH:mm`. ----------
  if (!state.startedAt) blockers.push({ field: 'startedAt', message: 'Record when you started.' });
  if (!state.completedAt) {
    blockers.push({ field: 'completedAt', message: 'Record when you finished.' });
  }
  if (state.startedAt && state.completedAt && state.completedAt < state.startedAt) {
    blockers.push({
      field: 'completedAt',
      message: 'The inspection cannot finish before it started.',
    });
  }

  // ---- The twelve areas ---------------------------------------------------
  const undecided = QC_AREA_CODES.filter((a) => state.areas[a].status === '');
  if (undecided.length > 0) {
    blockers.push({
      field: 'areas',
      message:
        `${undecided.map((a) => AREA_LABEL[a]).join(', ')} ` +
        `${undecided.length === 1 ? 'has' : 'have'} no result yet. ` +
        'Every area needs an answer, and "not measured" is one of them.',
    });
  }
  for (const area of QC_AREA_CODES) {
    const entry = state.areas[area];
    if (entry.status === '' || entry.status === 'NOT_MEASURED') continue;
    const score = num(entry.score);
    if (score === null || score < QC_AREA_SCORE.min || score > QC_AREA_SCORE.max) {
      blockers.push({
        field: `area.${area}`,
        message: `${AREA_LABEL[area]} needs a score from ${QC_AREA_SCORE.min} to ${QC_AREA_SCORE.max}.`,
      });
    }
  }
  const notMeasured = QC_AREA_CODES.filter((a) => state.areas[a].status === 'NOT_MEASURED');
  if (notMeasured.length > 0) {
    notices.push(
      `${notMeasured.map((a) => AREA_LABEL[a]).join(', ')} will be recorded as not measured — ` +
        'no row is written for them, and the report prints "not measured" on its face. ' +
        'A missing value is never stored as a pass.',
    );
  }

  // ---- Photographs. Six minimum, and the six are named. ------------------
  const missingPhotos = PHOTO_ANGLES.filter((a) => !state.photos[a]);
  if (missingPhotos.length > 0) {
    blockers.push({
      field: 'photos',
      message: `Still to photograph: ${missingPhotos.map((a) => PHOTO_LABEL[a]).join(', ')}.`,
    });
  }

  // ---- The seal ----------------------------------------------------------
  if (isPass(state.verdict)) {
    if (!SEAL_CODE.pattern.test(state.sealCode.trim().toUpperCase())) {
      blockers.push({ field: 'sealCode', message: SEAL_CODE.message });
    }
    if (!state.sealPhoto) {
      blockers.push({
        field: 'sealPhoto',
        message:
          'Photograph the seal on the machine. There is no seal without a photograph — ' +
          'the column is NOT NULL, and the photograph is what makes the seal mean anything ' +
          'three weeks later.',
      });
    }
  } else if (state.sealCode.trim() !== '') {
    blockers.push({
      field: 'sealCode',
      message: 'A unit that did not pass is not sealed. Clear the seal code.',
    });
  }

  // ---- Score and grade ---------------------------------------------------
  const score = num(state.qcScore);
  if (score === null || score < 0 || score > 100) {
    blockers.push({ field: 'qcScore', message: 'Give the inspection a score from 0 to 100.' });
  }

  if (state.verdict !== 'FAIL' && state.gradeFinal === '') {
    blockers.push({
      field: 'gradeFinal',
      message: 'A unit that is going to be listed needs a final grade.',
    });
  }
  // `chk_override_reason` — proposed may differ from final only in writing.
  if (
    state.gradeProposed !== '' &&
    state.gradeFinal !== '' &&
    state.gradeProposed !== state.gradeFinal &&
    state.gradeOverrideReason.trim() === ''
  ) {
    blockers.push({
      field: 'gradeOverrideReason',
      message:
        `You are overriding ${state.gradeProposed.replace('_PLUS', '+')} to ` +
        `${state.gradeFinal.replace('_PLUS', '+')}. Write down why — the grade is our claim ` +
        'under CP e-Comm r.7(5) and an unexplained override is indefensible.',
    });
  }

  // ---- The floor rule: the grade may not contradict the areas ------------
  const cap = gradeCap(state.areas);
  if (cap && state.gradeFinal !== '' && gradeRank(state.gradeFinal) < gradeRank(cap.cap)) {
    blockers.push({
      field: 'gradeFinal',
      message:
        `${cap.reason} That caps this machine at ${cap.cap.replace('_PLUS', '+')}, and you have ` +
        `graded it ${state.gradeFinal.replace('_PLUS', '+')}. We refuse a DeviceSure certificate ` +
        'that grades A+ over a failed component; we do not get to type one in by hand instead.',
    });
  }

  return { blockers, notices, hardStop, normalisedSerial };
}

/**
 * Form state to wire payload.
 *
 * Only the areas with a real result become rows. `areasNotMeasured` carries the
 * rest by name so the absence is a recorded decision rather than an omission
 * nobody can tell apart from a technician who ran out of time.
 */
/** What the report is recorded against: a manifest line, or the ordered slot the serial names. */
export type PayloadTarget = { unit: ManifestUnit } | { slotId: string };

export function toPayload(
  state: InspectionState,
  visitId: string,
  normalisedSerial: string,
  target: PayloadTarget,
): ManualInspectionPayload {
  const h = state.hardware;
  return {
    visitId,
    ...('unit' in target
      ? {
          visitUnitId: target.unit.visitUnitId,
          unitId: target.unit.unitId,
          serialMatches: normalisedSerial === normalisePastedSerial(target.unit.serialNumber),
        }
      : // The serial is the identity: there is no earlier claim for it to match.
        { slotId: target.slotId, serialMatches: true }),
    technicianId: state.technicianId,
    serialScanned: normalisedSerial,
    startedAt: toInstant(state.startedAt),
    completedAt: toInstant(state.completedAt),
    areaResults: QC_AREA_CODES.filter(
      (a) => state.areas[a].status !== '' && state.areas[a].status !== 'NOT_MEASURED',
    ).map((a) => ({
      area: a,
      status: state.areas[a].status as AreaStatus,
      score: num(state.areas[a].score) ?? 0,
      maxScore: QC_AREA_SCORE.max,
      note: state.areas[a].note.trim() || null,
    })),
    areasNotMeasured: QC_AREA_CODES.filter((a) => state.areas[a].status === 'NOT_MEASURED'),
    hardware: {
      ramDetectedGb: num(h.ramDetectedGb),
      ramModules: num(h.ramModules),
      storageType: h.storageType.trim() || null,
      storageDetectedGb: num(h.storageDetectedGb),
      smartStatus: h.smartStatus === '' ? null : h.smartStatus,
      batteryHealthPct: num(h.batteryHealthPct),
      // Not reported wins over anything left in the box: a stale 0 in a disabled
      // field is exactly the zero-default this control exists to prevent.
      cycleCount: h.cycleCountNotReported ? null : num(h.cycleCount),
      biosLocked: h.biosLocked,
      mdmLocked: h.mdmLocked,
      computraceActive: h.computraceActive,
    },
    photos: PHOTO_ANGLES.flatMap((angle) => {
      const f = state.photos[angle];
      return f ? [{ angle, fileKey: f.fileKey, hash: f.hash }] : [];
    }),
    seal:
      isPass(state.verdict) && state.sealPhoto
        ? {
            sealCode: state.sealCode.trim().toUpperCase(),
            photoKey: state.sealPhoto.fileKey,
            photoHash: state.sealPhoto.hash,
          }
        : null,
    qcScore: num(state.qcScore) ?? 0,
    gradeProposed: state.gradeProposed === '' ? null : state.gradeProposed,
    gradeFinal: state.gradeFinal === '' ? null : state.gradeFinal,
    gradeOverrideReason: state.gradeOverrideReason.trim() || null,
    verdict: state.verdict,
    notes: state.notes.trim() || null,
  };
}
