import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable } from 'react-native';
import { useApp } from '../../../src/app-context';
import type { ManifestUnit, UnitDraft, VisitSnapshot } from '../../../src/domain/model';
import { submittedUnits, type OutboxStatus } from '../../../src/queue/outbox';
import { listDrafts, loadSnapshot } from '../../../src/store';
import { Banner, Button, Card, Chip, H1, Muted, P, Row, Screen } from '../../../src/ui/kit';

/**
 * The manifest: every unit the vendor said they would present, and where each one
 * has got to.
 *
 * The state of a unit is derived from two places rather than stored a third time —
 * an in-progress draft in `unit_draft`, and a terminal action in the outbox. That
 * matters because the two disagree in exactly the case that has to be visible: a
 * unit submitted an hour ago whose row is stuck. A single `status` column would
 * have been overwritten to "done" and the technician would drive home.
 */
type UnitState = 'TODO' | 'IN_PROGRESS' | 'QUEUED' | 'SENT' | 'STUCK';

const STATE_TONE: Record<UnitState, 'muted' | 'warn' | 'ok' | 'bad' | 'brand'> = {
  TODO: 'muted',
  IN_PROGRESS: 'warn',
  QUEUED: 'brand',
  SENT: 'ok',
  STUCK: 'bad',
};

export default function ManifestScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { db } = useApp();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<VisitSnapshot | null>(null);
  const [drafts, setDrafts] = useState<UnitDraft[]>([]);
  const [submitted, setSubmitted] = useState<
    Map<string, { status: OutboxStatus; kind: string; lastError: string | null }>
  >(new Map());

  // Refetched every time the screen regains focus rather than once on mount:
  // the technician arrives here from a finished unit, and a list that still
  // shows it as outstanding invites doing it twice.
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!db || !visitId) return;
        setSnapshot(await loadSnapshot(db, visitId));
        setDrafts(await listDrafts(db, visitId));
        setSubmitted(await submittedUnits(db, visitId));
      })();
    }, [db, visitId]),
  );

  if (!snapshot) {
    return (
      <Screen>
        <Banner tone="warn">This visit is not on the device.</Banner>
      </Screen>
    );
  }

  const stateOf = (u: ManifestUnit): UnitState => {
    const sub = submitted.get(u.visitUnitId);
    if (sub) {
      if (sub.status === 'BLOCKED') return 'STUCK';
      return sub.status === 'SENT' ? 'SENT' : 'QUEUED';
    }
    return drafts.some((d) => d.visitUnitId === u.visitUnitId) ? 'IN_PROGRESS' : 'TODO';
  };

  const done = snapshot.units.filter((u) => ['QUEUED', 'SENT'].includes(stateOf(u))).length;
  const stuck = snapshot.units.filter((u) => stateOf(u) === 'STUCK').length;

  return (
    <Screen>
      <H1>
        {done} of {snapshot.units.length} done
      </H1>
      <Muted>
        {snapshot.visit.vendorName} · {snapshot.visit.visitNumber}
      </Muted>

      {stuck > 0 ? (
        <Banner tone="bad">
          {stuck} unit{stuck > 1 ? 's' : ''} the server refused. Open Sync — they will not clear on
          their own.
        </Banner>
      ) : null}

      {snapshot.units.map((u) => {
        const state = stateOf(u);
        return (
          <Pressable key={u.visitUnitId} onPress={() => router.push(`/unit/${u.visitUnitId}`)}>
            <Card>
              <Row>
                <P>#{u.sequenceNo}</P>
                <Chip label={state.replace('_', ' ')} tone={STATE_TONE[state]} />
                <Chip label={u.declaredGrade.replace('_PLUS', '+')} />
              </Row>
              <P>{u.serialNumber}</P>
              <Muted>
                {[u.brandName, u.modelName].filter(Boolean).join(' ')} · {u.declaredSpec.ramGb} GB ·{' '}
                {u.declaredSpec.storageGb} GB {u.declaredSpec.storageType}
              </Muted>
            </Card>
          </Pressable>
        );
      })}

      <Button
        title="Expenses"
        tone="plain"
        onPress={() => router.push(`/visit/${visitId}/expenses`)}
      />
      <Button
        title="Close the visit — vendor sign-off"
        onPress={() => router.push(`/visit/${visitId}/signoff`)}
      />
      <Muted>
        Sign-off needs the vendor contact and their OTP. Do it before you leave: it is the document
        that records what was found, and it is what stops “you never told me it failed”.
      </Muted>
    </Screen>
  );
}
