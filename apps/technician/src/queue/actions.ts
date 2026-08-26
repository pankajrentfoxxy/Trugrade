import { enqueue, type Deps, type OutboxItem } from './outbox';
import type { DraftPhoto, ManifestUnit, UnitDraft } from '../domain/model';
import type { UnitAssessment } from '../domain/verdict';

/**
 * Every action the technician can take, as one function each.
 *
 * The only reason this file exists rather than callers using `enqueue` directly
 * is the **dedupe key**. Getting one wrong is silent and expensive in both
 * directions — too narrow and a double tap becomes two inspections of one
 * machine, too broad and a legitimate re-inspection is swallowed — so the keys
 * are all derived here, next to each other, where they can be read as a set.
 *
 * The rule they follow: the key names the *thing*, never the *moment*. A
 * timestamp in a key means every retry of the UI is a new row.
 */

export interface Geo {
  lat: number;
  lng: number;
  accuracyMetres: number | null;
  capturedAt: number;
}

/** Arrival at the vendor site. `geo_variance_metres` is computed server-side. */
export function queueCheckIn(deps: Deps, visitId: string, geo: Geo): Promise<OutboxItem> {
  return enqueue(deps, {
    kind: 'CHECK_IN',
    // One check-in per visit. A technician who taps Arrive twice has arrived once.
    dedupeKey: `CHECK_IN:${visitId}`,
    visitId,
    body: { visitId, ...geo },
  });
}

/**
 * The DeviceSure certificate, verbatim.
 *
 * `raw` is the payload exactly as the tool produced it — not a parse of it. The
 * server stores it before interpreting anything, because in four months when a
 * buyer disputes a grade the original is the evidence. The app must not be the
 * layer that decided which fields were worth keeping.
 */
export function queueToolRun(
  deps: Deps,
  ctx: { visitId: string; unit: ManifestUnit },
  raw: unknown,
  meta: { certificateId: string; providerCode: string; toolVersion: string; serialMatches: boolean },
): Promise<OutboxItem> {
  const { unit } = ctx;
  return enqueue(deps, {
    kind: 'TOOL_RUN',
    // The certificate id is DeviceSure's own idempotency key and lands in
    // `qc_tool_run.tool_run_id`, where `UNIQUE (tool_provider_id, tool_run_id)`
    // makes a re-send one row and a 200.
    dedupeKey: `TOOL_RUN:${meta.providerCode}:${meta.certificateId}`,
    visitId: ctx.visitId,
    unitId: unit.unitId,
    body: {
      visitUnitId: unit.visitUnitId,
      unitId: unit.unitId,
      toolProviderCode: meta.providerCode,
      toolVersion: meta.toolVersion,
      toolRunId: meta.certificateId,
      serialFromTool: (raw as { device?: { serial?: string } })?.device?.serial ?? null,
      serialMatches: meta.serialMatches,
      payload: raw,
    },
  });
}

/**
 * One photograph. The bytes stay on the device; only the local path is queued.
 *
 * Keyed on the content hash, so re-taking the same shot enqueues a new row and
 * re-submitting an identical file does not. The hash also becomes `qc_photo.hash`
 * and is what the signed-URL request is derived from, which means the S3 object
 * key is stable across retries and a half-finished upload resumes rather than
 * duplicating.
 */
export interface PhotoContext {
  visitId: string;
  /** Null for a photograph that is not about a unit at all — an expense receipt. */
  visitUnitId: string | null;
  unitId: string | null;
  /** Set instead of `visitUnitId` for a receipt, so the row has something to key on. */
  expenseLocalId?: string;
}

/**
 * Where a photograph ends up. Derived from the angle rather than passed
 * alongside it, because two fields that must agree are two fields that can
 * disagree.
 *
 * `SEAL` and `RECEIPT` are not `qc_photo` rows: the seal photograph is
 * `qc_seal.applied_photo_key` and the receipt belongs to `qc_visit_expense`.
 * They travel the same upload road, and the server needs to be told which of the
 * three it is receiving rather than inferring it from a serial-looking id.
 */
export function photoPurpose(angle: DraftPhoto['angle']): 'QC_PHOTO' | 'SEAL' | 'EXPENSE_RECEIPT' {
  if (angle === 'SEAL') return 'SEAL';
  if (angle === 'RECEIPT') return 'EXPENSE_RECEIPT';
  return 'QC_PHOTO';
}

export function queuePhoto(deps: Deps, ctx: PhotoContext, photo: DraftPhoto): Promise<OutboxItem> {
  const scope = ctx.visitUnitId ?? `expense:${ctx.expenseLocalId ?? photo.sha256}`;
  return enqueue(deps, {
    kind: 'PHOTO',
    dedupeKey: `PHOTO:${scope}:${photo.sha256}`,
    visitId: ctx.visitId,
    unitId: ctx.unitId,
    fileUri: photo.uri,
    body: {
      purpose: photoPurpose(photo.angle),
      visitUnitId: ctx.visitUnitId,
      unitId: ctx.unitId,
      expenseLocalId: ctx.expenseLocalId ?? null,
      angle: photo.angle,
      sha256: photo.sha256,
      bytes: photo.bytes,
      capturedAt: photo.capturedAt,
      contentType: 'image/jpeg',
    },
  });
}

/**
 * The seal, applied and photographed.
 *
 * Keyed on the seal code because `qc_seal.seal_code` is globally UNIQUE — one
 * numbered seal is one physical sticker on one machine, and a second row for the
 * same code is always a mistake.
 */
export function queueSeal(
  deps: Deps,
  ctx: { visitId: string; visitUnitId: string; unitId: string },
  seal: { code: string; photoSha256: string },
): Promise<OutboxItem> {
  return enqueue(deps, {
    kind: 'SEAL',
    dedupeKey: `SEAL:${seal.code}`,
    visitId: ctx.visitId,
    unitId: ctx.unitId,
    body: {
      visitUnitId: ctx.visitUnitId,
      unitId: ctx.unitId,
      sealCode: seal.code,
      // The photograph is a separate PHOTO row enqueued *before* this one, so it
      // is already on the server when this arrives and the server can resolve the
      // hash to the object key it stored. `applied_photo_key` is NOT NULL and
      // there is deliberately no path here that satisfies it without a file.
      appliedPhotoSha256: seal.photoSha256,
    },
  });
}

/**
 * The finished inspection.
 *
 * Enqueued last, after the tool run, every photograph and the seal, so that
 * strict FIFO delivery means the server has the evidence before it has the
 * conclusion.
 *
 * `localVerdict` is sent for cross-checking, not for authority. The server
 * re-runs `evaluateQcReport` on ingestion and its answer is the one written to
 * `qc_report` — but a disagreement between the two is a signal worth having,
 * because it means the app was working from a stale snapshot of the thresholds.
 */
export function queueUnitResult(
  deps: Deps,
  draft: UnitDraft,
  assessment: UnitAssessment,
  completedAt: number,
): Promise<OutboxItem> {
  return enqueue(deps, {
    kind: 'UNIT_RESULT',
    // `startedAt` belongs to the draft, not to the tap — a double tap on Confirm
    // shares it, and restarting the unit from scratch creates a new draft with a
    // new one, which is exactly when a second submission is legitimate.
    dedupeKey: `UNIT_RESULT:${draft.visitUnitId}:${draft.startedAt}`,
    visitId: draft.visitId,
    unitId: draft.unitId,
    body: {
      visitUnitId: draft.visitUnitId,
      unitId: draft.unitId,
      scannedSerial: draft.scannedSerial,
      serialMatches: !assessment.serialMismatch,
      cosmetic: draft.cosmetic,
      photoHashes: draft.photos.map((p) => ({ angle: p.angle, sha256: p.sha256 })),
      sealCode: draft.seal?.code ?? null,
      notes: draft.notes,
      gradeOverride: draft.gradeOverride,
      startedAt: draft.startedAt,
      completedAt,
      durationSeconds: Math.max(0, Math.round((completedAt - draft.startedAt) / 1000)),
      localVerdict: assessment.verdict
        ? {
            verdict: assessment.verdict.verdict,
            gradeFound: assessment.verdict.gradeFound,
            autoApproved: assessment.verdict.autoApproved,
            blockedBy: assessment.verdict.blockedBy,
          }
        : null,
    },
  });
}

/** The vendor could not produce the machine. A finding, not an omission. */
export function queueAbsent(
  deps: Deps,
  ctx: { visitId: string; visitUnitId: string; unitId: string },
  reason: string,
): Promise<OutboxItem> {
  return enqueue(deps, {
    kind: 'ABSENT',
    dedupeKey: `ABSENT:${ctx.visitUnitId}`,
    visitId: ctx.visitId,
    unitId: ctx.unitId,
    body: { visitUnitId: ctx.visitUnitId, unitId: ctx.unitId, absentReason: reason },
  });
}

/**
 * The vendor's OTP sign-off on what was found.
 *
 * The OTP itself is verified server-side against `vendor_otp_hash`, which means
 * this is one action that genuinely cannot complete offline. It still goes
 * through the queue rather than a direct call: a technician who signs off in a
 * basement and walks to the car must not have to remember to do it again.
 */
export function queueSignoff(
  deps: Deps,
  visitId: string,
  signoff: { contactId: string; contactName: string; otp: string; signedAt: number },
): Promise<OutboxItem> {
  return enqueue(deps, {
    kind: 'SIGNOFF',
    dedupeKey: `SIGNOFF:${visitId}`,
    visitId,
    body: { visitId, ...signoff },
  });
}

export interface ExpenseInput {
  /** Generated on the device so the row is addressable before it has a server id. */
  localId: string;
  category: string;
  amountInr: string;
  note: string;
  receiptSha256: string | null;
}

/**
 * A visit expense. Amounts travel as strings.
 *
 * `qc_visit_expense.amount` is NUMERIC and feeds `qc.v_visit_economics`, which is
 * the number that decides whether QC-at-source is economic at all. A float that
 * loses a paisa per receipt makes that number quietly wrong, so nothing in the
 * money path here is ever a JavaScript `number`.
 */
export function queueExpense(deps: Deps, visitId: string, expense: ExpenseInput): Promise<OutboxItem> {
  return enqueue(deps, {
    kind: 'EXPENSE',
    dedupeKey: `EXPENSE:${visitId}:${expense.localId}`,
    visitId,
    body: { visitId, ...expense },
  });
}
