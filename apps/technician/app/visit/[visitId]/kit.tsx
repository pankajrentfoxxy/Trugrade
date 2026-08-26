import { SEAL_CODE } from '@trugrade/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useApp } from '../../../src/app-context';
import { systemClock } from '../../../src/clock';
import { kvGet, kvSet } from '../../../src/db/db';
import type { VisitSnapshot } from '../../../src/domain/model';
import { loadSnapshot } from '../../../src/store';
import { Banner, Button, Card, Field, H1, H2, Muted, P, Screen } from '../../../src/ui/kit';

/**
 * Kit check, before the technician goes through the gate.
 *
 * Everything here is checked now because each of these failures is discovered
 * otherwise at the worst possible moment: the wrong seal roll is found at unit
 * one with a warehouse manager waiting, and a stale agent version is found after
 * forty certificates have been signed under rules that are no longer in force.
 *
 * The seal-roll check is the one that carries real weight. `qc_seal.seal_code` is
 * globally UNIQUE and the roll issued for this visit is a specific numeric range;
 * a technician who picked up the wrong roll will fail every single seal
 * submission at the end of the day, offline, with no way to fix it. Two fields
 * and a comparison here is the whole cost of avoiding that.
 */
export default function KitCheckScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { db } = useApp();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<VisitSnapshot | null>(null);
  const [rollFrom, setRollFrom] = useState('');
  const [rollTo, setRollTo] = useState('');
  const [toolVersion, setToolVersion] = useState('');
  const [certSeen, setCertSeen] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!db || !visitId) return;
      const s = await loadSnapshot(db, visitId);
      setSnapshot(s);
      const saved = await kvGet(db, `kit:${visitId}`);
      if (saved) {
        const k = JSON.parse(saved) as { rollFrom: string; rollTo: string; toolVersion: string };
        setRollFrom(k.rollFrom);
        setRollTo(k.rollTo);
        setToolVersion(k.toolVersion);
        setCertSeen(true);
      }
    })();
  }, [db, visitId]);

  if (!snapshot) {
    return (
      <Screen>
        <Banner tone="warn">This visit is not on the device. Go back and refresh the route.</Banner>
      </Screen>
    );
  }

  const shapeOk = (v: string) => SEAL_CODE.pattern!.test(v.trim().toUpperCase());
  const rollShapeError =
    (rollFrom && !shapeOk(rollFrom)) || (rollTo && !shapeOk(rollTo)) ? SEAL_CODE.message : null;

  // String comparison is correct here because the code shape is fixed-width
  // (`TRG-26HR-0004821`), so lexical order and numeric order are the same order.
  const from = rollFrom.trim().toUpperCase();
  const to = rollTo.trim().toUpperCase();
  const rollInRange =
    !rollShapeError &&
    from >= snapshot.seal.rangeFrom &&
    to <= snapshot.seal.rangeTo &&
    from <= to;

  const versionMatches = toolVersion.trim() === snapshot.tool.version;
  const ready = rollInRange && versionMatches && certSeen;

  async function confirm() {
    if (!db || !visitId) return;
    await kvSet(
      db,
      `kit:${visitId}`,
      JSON.stringify({ rollFrom: from, rollTo: to, toolVersion: toolVersion.trim(), at: systemClock() }),
    );
    router.push(`/visit/${visitId}/checkin`);
  }

  return (
    <Screen>
      <H1>Kit check</H1>
      <Muted>
        {snapshot.visit.vendorName} · {snapshot.visit.visitNumber}
      </Muted>

      <H2>Seal roll</H2>
      <Card>
        <P>
          Issued for this visit: {snapshot.seal.rangeFrom} to {snapshot.seal.rangeTo}
        </P>
        <Muted>Read the first and last code off the roll in your bag, not off this screen.</Muted>
      </Card>
      <Field label="First code on the roll" value={rollFrom} onChangeText={setRollFrom} placeholder="TRG-26HR-0004821" />
      <Field label="Last code on the roll" value={rollTo} onChangeText={setRollTo} placeholder="TRG-26HR-0004870" />
      {rollShapeError ? <Banner tone="bad">{rollShapeError}</Banner> : null}
      {!rollShapeError && rollFrom && rollTo && !rollInRange ? (
        <Banner tone="bad">
          This roll is not the one issued for this visit. Every seal you apply from it will be
          rejected. Do not start — call the QC manager.
        </Banner>
      ) : null}

      <H2>DeviceSure agent</H2>
      <Card>
        <P>Expected version {snapshot.tool.version}</P>
        <Muted>
          Open DeviceSure on the laptop and read the version from its About panel. A different
          version grades against a different rule set, and the certificate says which.
        </Muted>
      </Card>
      <Field
        label="Version shown by the agent"
        value={toolVersion}
        onChangeText={setToolVersion}
        autoCapitalize="none"
        placeholder={snapshot.tool.version}
      />
      {toolVersion && !versionMatches ? (
        <Banner tone="bad">
          The agent is on {toolVersion}, not {snapshot.tool.version}. Update it before you start.
        </Banner>
      ) : null}

      <H2>Device certificate</H2>
      <Card>
        <P>{snapshot.tool.deviceCertId}</P>
        <Muted>
          The agent signs certificates with this identity. If it shows a different one, this laptop
          is not the one licensed for these inspections.
        </Muted>
      </Card>
      <Button
        title={certSeen ? 'Certificate confirmed' : 'I have confirmed this certificate id'}
        tone={certSeen ? 'plain' : 'brand'}
        onPress={() => setCertSeen(true)}
      />

      <Button title="Kit is correct — go to check-in" onPress={() => void confirm()} disabled={!ready} />
    </Screen>
  );
}
