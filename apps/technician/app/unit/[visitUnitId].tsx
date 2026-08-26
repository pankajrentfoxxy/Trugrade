import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../src/app-context';
import { systemClock } from '../../src/clock';
import {
  newDraft,
  UNIT_STEPS,
  type ManifestUnit,
  type PhotoAngle,
  type UnitDraft,
  type UnitStep,
  type VisitSnapshot,
} from '../../src/domain/model';
import { assessDraft } from '../../src/domain/verdict';
import { preparePhoto } from '../../src/photos';
import {
  queueAbsent,
  queuePhoto,
  queueSeal,
  queueToolRun,
  queueUnitResult,
} from '../../src/queue/actions';
import { cachedVisits, deleteDraft, loadDraft, saveDraft } from '../../src/store';
import { Banner, Button, Chip, Field, H1, Muted, Row, Screen } from '../../src/ui/kit';
import {
  ConfirmStep,
  CosmeticStep,
  HardwareStep,
  PhotosStep,
  SealStep,
  SerialStep,
  ToolStep,
} from '../../src/unit/steps';

/**
 * One machine, start to finish.
 *
 * A single screen with seven steps rather than seven routes, because that is how
 * the work is actually done — one laptop is picked up, carried through every
 * step, and put down. Seven routes would mean seven places that could hold a
 * partial draft and seven back-stack states to reason about when the OS reclaims
 * the app mid-inspection.
 *
 * Three responsibilities live here and nowhere else:
 *
 *   **Persistence.** The draft is written to SQLite on every change, not on a
 *   debounce. The failure being guarded against is the OS killing the app while
 *   the camera is open, and a debounce is exactly that window.
 *
 *   **Queueing.** Submitting turns the draft into outbox rows in a fixed order —
 *   certificate, photographs, seal, result — because strict FIFO delivery is what
 *   makes the server see the evidence before the conclusion.
 *
 *   **Nothing else.** No grading. The verdict comes from
 *   `@trugrade/contracts` via `assessDraft`, so this screen and the ingestion
 *   endpoint cannot reach different answers.
 */
export default function UnitScreen() {
  const { visitUnitId } = useLocalSearchParams<{ visitUnitId: string }>();
  const { db, deps, refresh, syncNow } = useApp();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<VisitSnapshot | null>(null);
  const [unit, setUnit] = useState<ManifestUnit | null>(null);
  const [draft, setDraft] = useState<UnitDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [absentReason, setAbsentReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!db || !visitUnitId) return;
      // The unit knows its visit only through the snapshots on the device, so
      // this is a scan across them rather than a lookup. At most a handful of
      // visits are ever cached.
      const visits = await cachedVisits(db);
      for (const v of visits) {
        const u = v.units.find((x) => x.visitUnitId === visitUnitId);
        if (!u) continue;
        setSnapshot(v);
        setUnit(u);
        setDraft((await loadDraft(db, visitUnitId)) ?? newDraft(u, v.visit.id, systemClock()));
        return;
      }
    })();
  }, [db, visitUnitId]);

  const patch = useCallback(
    (p: Partial<UnitDraft>) => {
      setDraft((current) => {
        if (!current) return current;
        const next = { ...current, ...p };
        if (db) void saveDraft(db, next, systemClock());
        return next;
      });
    },
    [db],
  );

  const addPhoto = useCallback(
    async (sourceUri: string, angle: PhotoAngle | 'SEAL') => {
      const prepared = await preparePhoto(sourceUri, angle, systemClock());
      setDraft((current) => {
        if (!current) return current;
        // Retaking replaces rather than appends: two photographs of the same
        // angle would both upload, and the passport would show a duplicate.
        const next = {
          ...current,
          photos: [...current.photos.filter((p) => p.angle !== angle), prepared],
        };
        if (db) void saveDraft(db, next, systemClock());
        return next;
      });
    },
    [db],
  );

  const assessment = useMemo(
    () => (draft && unit && snapshot ? assessDraft(draft, unit, snapshot) : null),
    [draft, unit, snapshot],
  );

  if (!draft || !unit || !snapshot || !assessment) {
    return (
      <Screen>
        <Banner tone="warn">This unit is not on the device. Go back and refresh the route.</Banner>
      </Screen>
    );
  }

  const stepIndex = UNIT_STEPS.indexOf(draft.step);
  const go = (step: UnitStep) => patch({ step });

  /**
   * Turn the draft into outbox rows.
   *
   * The order is the contract. Photographs before the seal, because the seal row
   * names the hash of its photograph; the seal before the result, because the
   * result asserts one was applied. Every row carries a nonce minted here and
   * never regenerated, so a retry three hours later on a train is the same
   * request and lands as one row.
   */
  async function submit() {
    if (!deps || !db || !draft || !unit || !snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const completedAt = systemClock();

      if (draft.certificate) {
        await queueToolRun(
          deps,
          { visitId: draft.visitId, unit },
          draft.certificate,
          {
            certificateId: draft.certificate.certificate.id,
            providerCode: snapshot.tool.providerCode,
            toolVersion: snapshot.tool.version,
            serialMatches: !assessment!.serialMismatch,
          },
        );
      }

      const ctx = { visitId: draft.visitId, visitUnitId: draft.visitUnitId, unitId: draft.unitId };
      for (const photo of draft.photos) await queuePhoto(deps, ctx, photo);

      const sealPhoto = draft.photos.find((p) => p.angle === 'SEAL');
      if (draft.seal && sealPhoto) {
        await queueSeal(deps, ctx, { code: draft.seal.code, photoSha256: sealPhoto.sha256 });
      }

      await queueUnitResult(deps, draft, assessment!, completedAt);

      // Only now: the outbox owns the photographs by path and the result by row,
      // so the draft is redundant. Deleting it first would lose the unit.
      await deleteDraft(db, draft.visitUnitId);
      await refresh();
      void syncNow();
      router.replace(`/visit/${draft.visitId}/manifest`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function markAbsent() {
    if (!deps || !db || !draft) return;
    setBusy(true);
    try {
      await queueAbsent(
        deps,
        { visitId: draft.visitId, visitUnitId: draft.visitUnitId, unitId: draft.unitId },
        absentReason.trim(),
      );
      await deleteDraft(db, draft.visitUnitId);
      await refresh();
      router.replace(`/visit/${draft.visitId}/manifest`);
    } finally {
      setBusy(false);
    }
  }

  const stepProps = { draft, unit, snapshot, assessment, patch, addPhoto };

  return (
    <Screen>
      <H1>#{unit.sequenceNo} · {unit.serialNumber}</H1>
      <Row>
        {UNIT_STEPS.map((step, i) => (
          <Chip
            key={step}
            label={step[0]!}
            tone={i === stepIndex ? 'brand' : i < stepIndex ? 'ok' : 'muted'}
          />
        ))}
      </Row>
      <Muted>
        Step {stepIndex + 1} of {UNIT_STEPS.length} — {draft.step.replace('_', ' ').toLowerCase()}
      </Muted>

      {draft.step === 'SERIAL' ? <SerialStep {...stepProps} /> : null}
      {draft.step === 'TOOL' ? <ToolStep {...stepProps} /> : null}
      {draft.step === 'HARDWARE' ? <HardwareStep {...stepProps} /> : null}
      {draft.step === 'COSMETIC' ? <CosmeticStep {...stepProps} /> : null}
      {draft.step === 'PHOTOS' ? <PhotosStep {...stepProps} /> : null}
      {draft.step === 'SEAL' ? <SealStep {...stepProps} /> : null}
      {draft.step === 'CONFIRM' ? (
        <ConfirmStep {...stepProps} onSubmit={() => void submit()} busy={busy} />
      ) : null}

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <Row>
        {stepIndex > 0 ? (
          <Button title="Back" tone="plain" onPress={() => go(UNIT_STEPS[stepIndex - 1]!)} />
        ) : null}
        {stepIndex < UNIT_STEPS.length - 1 ? (
          <Button title="Next" onPress={() => go(UNIT_STEPS[stepIndex + 1]!)} />
        ) : null}
      </Row>

      {draft.step === 'SERIAL' ? (
        <>
          <Field
            label="Or: the vendor could not produce this machine"
            value={absentReason}
            onChangeText={setAbsentReason}
            autoCapitalize="sentences"
            hint="It counts as absent on the visit, and the vendor signs off on that."
          />
          <Button
            title="Record as absent"
            tone="plain"
            onPress={() => void markAbsent()}
            disabled={absentReason.trim().length < 4}
            busy={busy}
          />
        </>
      ) : null}
    </Screen>
  );
}
