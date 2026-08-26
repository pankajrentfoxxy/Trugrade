import {
  assessCertificate,
  evaluateQcReport,
  normalisePastedSerial,
  type IngestionVerdict,
  type QcArea,
  type VerdictResult,
} from '@trugrade/contracts';
import { REQUIRED_PHOTO_ANGLES, type ManifestUnit, type UnitDraft, type VisitSnapshot } from './model';

/**
 * The app's read of a unit, computed entirely from `@trugrade/contracts`.
 *
 * This file contains no grading rule of its own, and that is the point. The
 * technician standing in the warehouse, the QC console reviewing the visit and
 * the ingestion endpoint writing `qc_report` must reach the same conclusion from
 * the same inputs, and the only way three clients agree is if none of them owns
 * the arithmetic. Everything below is arrangement: pull the inputs out of the
 * draft, hand them to the pure functions, present the answer.
 *
 * A technician seeing "this will not list" *before* they seal the machine and
 * move on is the whole value of running the check locally. It is a preview, not
 * an authority — the server re-evaluates on ingestion and its answer wins.
 */

export interface UnitAssessment {
  /** `assessCertificate` over DeviceSure's own functional area results (07 §3.1). */
  certificate: IngestionVerdict | null;
  /** `evaluateQcReport` over the technician's cosmetic grading and the measurements. */
  verdict: VerdictResult | null;
  /** True when the scanned serial does not match the manifest. Stops everything. */
  serialMismatch: boolean;
  /** Photographs still to take, in capture order. */
  missingPhotos: string[];
  /** Everything that stops this unit being submitted at all, in plain words. */
  blockers: string[];
  /** Ready to enqueue. Not the same as "will list" — see `verdict.autoApproved`. */
  submittable: boolean;
}

/**
 * Evaluate the draft in the technician's hands.
 *
 * Order matters and mirrors the server's: a serial mismatch short-circuits,
 * because at that point nobody knows which machine the numbers describe.
 */
export function assessDraft(
  draft: UnitDraft,
  unit: ManifestUnit,
  snapshot: VisitSnapshot,
): UnitAssessment {
  const blockers: string[] = [];

  const scanned = draft.scannedSerial ? normalisePastedSerial(draft.scannedSerial) : null;
  const expected = normalisePastedSerial(unit.serialNumber);
  const serialMismatch = scanned !== null && scanned !== expected;

  if (scanned === null) blockers.push('Scan the serial on the chassis.');
  if (serialMismatch) {
    // QC-012. Do not grade it, do not seal it, do not list it. The submission is
    // still allowed — as an UNTESTABLE outcome — because a QC manager has to be
    // told, and silently abandoning the unit tells nobody.
    blockers.push(
      `The serial you scanned (${scanned}) is not the serial on the manifest (${expected}). Do not seal this machine. Record it and move on — the QC manager is notified.`,
    );
  }

  const cert = draft.certificate;
  const certificate = cert
    ? assessCertificate(cert, {
        expectedSerial: unit.serialNumber,
        // The desktop agent signs server-side at certification; an unsigned
        // certificate on site means the agent is misconfigured, and accepting it
        // would put an unattributable grade on our own invoice.
        requireSignature: true,
      })
    : null;

  if (!cert) blockers.push('Run DeviceSure on this machine and import the certificate.');
  if (certificate && !certificate.accept) {
    for (const d of certificate.defects.filter((x) => x.disposition === 'REJECT')) {
      blockers.push(d.message);
    }
  }

  const missingPhotos = REQUIRED_PHOTO_ANGLES.filter(
    (a) => !draft.photos.some((p) => p.angle === a),
  ) as string[];
  if (missingPhotos.length > 0) {
    blockers.push(`${missingPhotos.length} of the required photographs are still to take.`);
  }

  const verdict =
    cert && !serialMismatch
      ? evaluateQcReport({
          declaredGrade: unit.declaredGrade,
          measurements: {
            qcScore: cert.score ?? 0,
            // The technician's cosmetic grading. An area the technician has not
            // reached yet is simply absent — never defaulted to PASS, because a
            // missing value is not a passing value (07 §2).
            areas: Object.entries(draft.cosmetic).map(([area, outcome]) => ({
              area: area as QcArea,
              outcome: outcome!,
            })),
            batteryHealthPct: cert.battery?.healthPct,
            batteryCycleCount: cert.battery?.cycleCount,
            serialMatches: !serialMismatch,
            toolGrade: cert.grade,
          },
          declaredSpec: unit.declaredSpec,
          detectedSpec: draft.detectedSpec ?? undefined,
          seal: draft.seal
            ? {
                code: draft.seal.code,
                // The seal photograph is held locally until it syncs, so its
                // object key does not exist yet. Presence of the local file is
                // what satisfies the rule here; the server checks the key.
                photoKey: draft.photos.some((p) => p.angle === 'SEAL') ? 'local' : null,
              }
            : undefined,
          policy: snapshot.policy,
          gradeThresholds: snapshot.gradeThresholds,
        })
      : null;

  if (draft.seal && !draft.photos.some((p) => p.angle === 'SEAL')) {
    blockers.push('Photograph the seal on the machine. There is no seal without a photograph.');
  }

  return {
    certificate,
    verdict,
    serialMismatch,
    missingPhotos,
    blockers,
    // A serial mismatch is submittable *because* it must be reported. Everything
    // else has to be resolved before the unit leaves the technician's hands.
    submittable: serialMismatch || blockers.length === 0,
  };
}

/**
 * Should a seal be applied at all?
 *
 * A seal is applied on a pass and only on a pass. Sealing a unit that will not
 * list wastes a numbered seal and, worse, puts a tamper seal on a machine we are
 * about to tell the vendor to fix — which is exactly the state a broken seal is
 * supposed to signal.
 */
export function shouldSeal(assessment: UnitAssessment): boolean {
  if (assessment.serialMismatch) return false;
  const v = assessment.verdict;
  return v !== null && v.gradeFound !== null && v.scorePassed;
}
