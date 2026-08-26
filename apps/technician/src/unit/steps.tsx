import {
  compareSpec,
  normalisePastedSerial,
  QC_AREAS,
  QC_AREA_OUTCOMES,
  SEAL_CODE,
  type QcArea,
  type QcAreaOutcome,
} from '@trugrade/contracts';
import React, { useState } from 'react';
import {
  OPTIONAL_PHOTO_ANGLES,
  PHOTO_GUIDANCE,
  REQUIRED_PHOTO_ANGLES,
  type ManifestUnit,
  type PhotoAngle,
  type UnitDraft,
  type VisitSnapshot,
} from '../domain/model';
import type { UnitAssessment } from '../domain/verdict';
import { Banner, Button, Card, Chip, Choice, Field, H2, Muted, P, Row } from '../ui/kit';
import { PhotoBox, ScanBox } from '../ui/capture';
import { detectedFromCertificate, parseCertificate } from './detected';

/**
 * The seven steps of an inspection, as components.
 *
 * Each takes the draft and a `patch` and does nothing else — no queueing, no
 * persistence, no navigation. The screen owns all three, so there is exactly one
 * place where a draft is written to SQLite and exactly one where it becomes
 * outbox rows.
 */
export interface StepProps {
  draft: UnitDraft;
  unit: ManifestUnit;
  snapshot: VisitSnapshot;
  assessment: UnitAssessment;
  patch: (p: Partial<UnitDraft>) => void;
  addPhoto: (sourceUri: string, angle: PhotoAngle | 'SEAL') => Promise<void>;
}

// ---------------------------------------------------------------------------
// 1. Serial
// ---------------------------------------------------------------------------

/**
 * Scan the serial off the chassis and compare it with the manifest.
 *
 * `serial_matches = FALSE` is an immediate hard stop (QC-012): the label does not
 * belong to the laptop, so nothing measured afterwards describes the machine the
 * vendor listed. The screen says so in those terms rather than "mismatch",
 * because the technician has to decide whether to keep going, and "the sticker is
 * on the wrong machine" is the fact that decides it.
 */
export function SerialStep({ draft, unit, patch }: StepProps) {
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState(draft.scannedSerial ?? '');

  const normalised = normalisePastedSerial(typed);
  const expected = normalisePastedSerial(unit.serialNumber);
  const mismatch = normalised.length > 0 && normalised !== expected;

  if (scanning) {
    return (
      <ScanBox
        label="Point at the service tag or the barcode on the base."
        onScan={(v) => {
          setTyped(normalisePastedSerial(v));
          patch({ scannedSerial: normalisePastedSerial(v) });
          setScanning(false);
        }}
        onCancel={() => setScanning(false)}
      />
    );
  }

  return (
    <>
      <H2>Serial</H2>
      <Card>
        <Muted>On the manifest</Muted>
        <P>{unit.serialNumber}</P>
      </Card>

      <Button title="Scan the serial" onPress={() => setScanning(true)} />
      <Field
        label="…or type what is printed on the machine"
        value={typed}
        onChangeText={(v) => {
          setTyped(v);
          patch({ scannedSerial: normalisePastedSerial(v) });
        }}
        hint="Read it off the chassis, not off the box."
      />

      {mismatch ? (
        <Banner tone="bad">
          This is not the machine on the manifest. Do not grade it and do not seal it. Record it and
          move on — it goes to the QC manager as untestable, and someone has to find out which
          laptop this label belongs to.
        </Banner>
      ) : null}
      {!mismatch && normalised.length > 0 ? <Banner tone="ok">Matches the manifest.</Banner> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Tool run
// ---------------------------------------------------------------------------

/**
 * Take the certificate off the DeviceSure agent.
 *
 * The handover is local — a QR the agent renders, or a paste — because the
 * warehouse has no signal and an inspection that needs one is an inspection that
 * does not happen. The payload is stored **verbatim**: the app never keeps only
 * its own reading of it, because when a buyer disputes a grade in four months the
 * original is the evidence.
 */
export function ToolStep({ draft, patch }: StepProps) {
  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);

  function accept(raw: string) {
    try {
      const cert = parseCertificate(raw);
      patch({ certificate: cert, detectedSpec: detectedFromCertificate(cert) });
      setError(null);
      setScanning(false);
    } catch (e) {
      setError((e as Error).message);
      setScanning(false);
    }
  }

  if (scanning) {
    return <ScanBox label="Scan the handover code on the agent screen." onScan={accept} onCancel={() => setScanning(false)} />;
  }

  return (
    <>
      <H2>Run DeviceSure</H2>
      <Muted>
        Run a full session on the laptop, then hand the certificate over. Nothing here edits it.
      </Muted>

      {draft.certificate ? (
        <Card>
          <Row>
            <Chip label={draft.certificate.grade ?? 'no grade'} tone="brand" />
            <Chip label={`score ${draft.certificate.score ?? '—'}`} />
            {draft.certificate.certificate.signature ? null : <Chip label="unsigned" tone="bad" />}
          </Row>
          <Muted>Certificate {draft.certificate.certificate.id}</Muted>
          <P>Serial read by the tool: {draft.certificate.device.serial}</P>
        </Card>
      ) : null}

      <Button title="Scan the handover code" onPress={() => setScanning(true)} />
      <Field
        label="…or paste the certificate JSON"
        value={pasted}
        onChangeText={setPasted}
        autoCapitalize="none"
        hint="Only needed if the agent cannot render the code."
      />
      {pasted.length > 20 ? <Button title="Use this payload" tone="plain" onPress={() => accept(pasted)} /> : null}
      {error ? <Banner tone="bad">{error}</Banner> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Detected hardware
// ---------------------------------------------------------------------------

/**
 * Declared against detected.
 *
 * Every number on this screen comes from `compareSpec`, including the wording. It
 * is the function that already knows a 16 GB machine reports 15 GB usable and a
 * 512 GB drive measures 477 GiB, and it renders both figures — "16 GB installed
 * (15 GB usable)". Re-deriving any of that here would produce a screen that
 * disagrees with the certificate the buyer eventually reads.
 */
export function HardwareStep({ draft, unit }: StepProps) {
  if (!draft.certificate || !draft.detectedSpec) {
    return <Banner tone="warn">Import the certificate first.</Banner>;
  }

  const match = compareSpec(unit.declaredSpec, draft.detectedSpec, {
    screenToleranceIn: 0.2,
    cpuBlocking: true,
  });

  return (
    <>
      <H2>What the tool found</H2>

      <Card>
        <P>{match.display.ram ?? 'RAM not reported'}</P>
        <P>{match.display.storage ?? 'Storage not reported'}</P>
        <Muted>Declared: {unit.declaredSpec.ramGb} GB · {unit.declaredSpec.storageGb} GB {unit.declaredSpec.storageType} · {unit.declaredSpec.cpuModel}</Muted>
      </Card>

      {match.mismatches.length === 0 ? (
        <Banner tone="ok">The machine matches what was listed.</Banner>
      ) : (
        match.mismatches.map((m) => (
          <Banner key={m.field} tone={m.severity === 'BLOCKING' ? 'bad' : 'warn'}>
            {m.message}
          </Banner>
        ))
      )}

      {match.notReported.length > 0 ? (
        <Card>
          <Muted>
            Not reported by the tool: {match.notReported.join(', ').toLowerCase().replace(/_/g, ' ')}.
            Not measured is not a pass — it will show on the certificate as unmeasured.
          </Muted>
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Cosmetic grading
// ---------------------------------------------------------------------------

const OUTCOME_TONE = (o: QcAreaOutcome) =>
  o === 'PASS' ? 'ok' : o === 'WARN' ? 'warn' : o === 'FAIL' ? 'bad' : 'muted';

/**
 * The technician's own judgement, area by area.
 *
 * `NOT_MEASURED` is a real option and not a synonym for skipping: a hinge that
 * cannot be assessed because the machine will not open is a finding, and the
 * verdict engine caps the grade for it. An area left untouched is simply absent
 * from the draft, which is a different thing again — it means the technician has
 * not got there yet, and the step is not complete.
 */
export function CosmeticStep({ draft, patch }: StepProps) {
  const set = (area: QcArea, outcome: QcAreaOutcome) =>
    patch({ cosmetic: { ...draft.cosmetic, [area]: outcome } });

  const graded = Object.keys(draft.cosmetic).length;

  return (
    <>
      <H2>
        Condition — {graded} of {QC_AREAS.length}
      </H2>
      <Muted>
        Grade what you can see. Do not guess: an area you cannot assess is NOT MEASURED, and that is
        recorded honestly rather than scored as a pass.
      </Muted>

      {QC_AREAS.map((area) => (
        <Card key={area}>
          <Row>
            <P>{area.replace(/_/g, ' ')}</P>
            {draft.cosmetic[area] ? (
              <Chip label={draft.cosmetic[area]!.replace('_', ' ')} tone={OUTCOME_TONE(draft.cosmetic[area]!)} />
            ) : null}
          </Row>
          <Choice
            options={QC_AREA_OUTCOMES}
            value={draft.cosmetic[area]}
            onChange={(v) => set(area, v)}
            toneFor={OUTCOME_TONE}
          />
        </Card>
      ))}

      <Field
        label="Notes"
        value={draft.notes}
        onChangeText={(v) => patch({ notes: v })}
        autoCapitalize="sentences"
        hint="Anything a buyer would want to know that the areas above do not capture."
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Photographs
// ---------------------------------------------------------------------------

/**
 * Five guided photographs, plus an optional shot of the worst defect.
 *
 * Guided rather than free-form because the six photographs on the unit passport
 * are what makes the platform's representative listing images honest, and a set
 * where every unit was shot from a different angle is a set nobody can compare.
 * The guidance text is read out on the capture screen, over the viewfinder.
 */
export function PhotosStep({ draft, addPhoto }: StepProps) {
  const [shooting, setShooting] = useState<PhotoAngle | null>(null);

  if (shooting) {
    return (
      <PhotoBox
        guidance={PHOTO_GUIDANCE[shooting]}
        onCapture={(uri) => {
          void addPhoto(uri, shooting);
          setShooting(null);
        }}
        onCancel={() => setShooting(null)}
      />
    );
  }

  const angles = [...REQUIRED_PHOTO_ANGLES, ...OPTIONAL_PHOTO_ANGLES];

  return (
    <>
      <H2>Photographs</H2>
      <Muted>
        Five required, plus the seal after you apply it. These go on the public unit passport, so a
        buyer will look at them next to the machine.
      </Muted>

      {angles.map((angle) => {
        const taken = draft.photos.find((p) => p.angle === angle);
        const required = (REQUIRED_PHOTO_ANGLES as readonly string[]).includes(angle);
        return (
          <Card key={angle}>
            <Row>
              <P>{angle.replace(/_/g, ' ')}</P>
              {taken ? <Chip label={`${Math.round(taken.bytes / 1024)} KB`} tone="ok" /> : null}
              {!taken && !required ? <Chip label="optional" /> : null}
            </Row>
            <Muted>{PHOTO_GUIDANCE[angle]}</Muted>
            <Button
              title={taken ? 'Retake' : 'Take it'}
              tone={taken ? 'plain' : 'brand'}
              onPress={() => setShooting(angle)}
            />
          </Card>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. Seal
// ---------------------------------------------------------------------------

/**
 * Apply the seal and photograph it on the machine.
 *
 * The photograph is not optional and there is no path through this screen that
 * produces a seal without one — `qc_seal.applied_photo_key` is NOT NULL, and the
 * seal is what makes a twelve-minute inspection mean anything three weeks later
 * when the machine has been sitting at the vendor's premises.
 *
 * The code is checked against the roll issued for this visit before it is
 * accepted. A code from the wrong roll fails server-side hours after the
 * technician has left, which is the worst place to find out.
 */
export function SealStep({ draft, snapshot, assessment, patch, addPhoto }: StepProps) {
  const [code, setCode] = useState(draft.seal?.code ?? '');
  const [shooting, setShooting] = useState(false);

  const normalised = code.trim().toUpperCase();
  const shapeOk = SEAL_CODE.pattern!.test(normalised);
  const inRoll = shapeOk && normalised >= snapshot.seal.rangeFrom && normalised <= snapshot.seal.rangeTo;
  const sealPhoto = draft.photos.find((p) => p.angle === 'SEAL');

  if (shooting) {
    return (
      <PhotoBox
        guidance="The seal on the machine, close enough to read its code, with the chassis edge in frame."
        onCapture={(uri) => {
          void addPhoto(uri, 'SEAL');
          setShooting(false);
        }}
        onCancel={() => setShooting(false)}
      />
    );
  }

  if (assessment.serialMismatch) {
    return (
      <Banner tone="bad">
        Do not seal this machine. The serial does not match the manifest, so we do not know what we
        would be sealing. Go to Confirm and record it as untestable.
      </Banner>
    );
  }

  return (
    <>
      <H2>Seal</H2>
      <Muted>
        Roll issued for this visit: {snapshot.seal.rangeFrom} to {snapshot.seal.rangeTo}
      </Muted>

      <Field
        label="Seal code"
        value={code}
        onChangeText={(v) => {
          setCode(v);
          const n = v.trim().toUpperCase();
          patch({ seal: SEAL_CODE.pattern!.test(n) ? { code: n } : null });
        }}
        placeholder="TRG-26HR-0004821"
        error={code && !shapeOk ? SEAL_CODE.message : null}
      />

      {shapeOk && !inRoll ? (
        <Banner tone="bad">
          That code is not on the roll issued for this visit. Use a seal from your own roll — this one
          will be refused.
        </Banner>
      ) : null}

      <Button
        title={sealPhoto ? 'Retake the seal photograph' : 'Photograph the seal on the machine'}
        tone={sealPhoto ? 'plain' : 'brand'}
        onPress={() => setShooting(true)}
        disabled={!inRoll}
      />

      {draft.seal && !sealPhoto ? (
        <Banner tone="bad">There is no seal without a photograph. Take it before you move on.</Banner>
      ) : null}
      {sealPhoto ? <Banner tone="ok">Seal {draft.seal?.code} photographed.</Banner> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// 7. Confirm
// ---------------------------------------------------------------------------

const GRADE_LABEL: Record<string, string> = { A_PLUS: 'A+', A: 'A', B: 'B' };

/**
 * What will happen to this unit, and the last chance to disagree with it.
 *
 * The verdict shown here is `evaluateQcReport` from `@trugrade/contracts` — the
 * same function the ingestion endpoint runs — so a technician who sees "this
 * will not list" is seeing the server's answer, not an approximation of it. That
 * is the entire reason the grading logic is pure and lives in a shared package.
 *
 * An override demands a written reason, collected here rather than discovered
 * later: `qc_report` carries `CHECK (grade_proposed = grade_final OR
 * grade_override_reason IS NOT NULL)`, so an override without one is a row the
 * database refuses, hours after the technician has gone home.
 */
export function ConfirmStep({
  draft,
  unit,
  assessment,
  patch,
  onSubmit,
  busy,
}: StepProps & { onSubmit: () => void; busy: boolean }) {
  const v = assessment.verdict;
  const [reason, setReason] = useState(draft.gradeOverride?.reason ?? '');

  return (
    <>
      <H2>Confirm</H2>

      {assessment.serialMismatch ? (
        <Banner tone="bad">
          Recording this as untestable. The serial does not match, so no grade is claimed and no seal
          is applied. The QC manager is notified.
        </Banner>
      ) : v ? (
        <Card>
          <Row>
            <Chip
              label={v.gradeFound ? GRADE_LABEL[v.gradeFound]! : 'not listable'}
              tone={v.gradeFound ? 'ok' : 'bad'}
            />
            <Chip label={v.verdict.replace(/_/g, ' ')} tone={v.autoApproved ? 'ok' : 'warn'} />
            <Chip label={`declared ${GRADE_LABEL[unit.declaredGrade]}`} />
          </Row>
          <P tone={v.autoApproved ? 'ok' : 'warn'}>{v.vendorMessage}</P>
        </Card>
      ) : null}

      {assessment.blockers.map((b) => (
        <Banner key={b} tone="bad">
          {b}
        </Banner>
      ))}

      {v && v.gradeFound ? (
        <Card>
          <Muted>If you disagree with the grade, say so and say why.</Muted>
          <Choice
            options={['A_PLUS', 'A', 'B'] as const}
            value={draft.gradeOverride?.grade}
            onChange={(g) => patch({ gradeOverride: { grade: g, reason } })}
          />
          {draft.gradeOverride ? (
            <Field
              label="Why"
              value={reason}
              onChangeText={(t) => {
                setReason(t);
                patch({ gradeOverride: { grade: draft.gradeOverride!.grade, reason: t } });
              }}
              autoCapitalize="sentences"
              hint="Recorded on the report and read by the vendor. Be specific."
              error={reason.trim().length < 10 ? 'A written reason is required for an override.' : null}
            />
          ) : null}
        </Card>
      ) : null}

      <Button
        title="Submit this unit"
        onPress={onSubmit}
        busy={busy}
        disabled={
          !assessment.submittable ||
          (draft.gradeOverride !== null && draft.gradeOverride.reason.trim().length < 10)
        }
      />
      <Muted>
        Submitting queues the certificate, the photographs, the seal and the result on this device.
        They upload in that order when there is signal — you do not need to wait here.
      </Muted>
    </>
  );
}
