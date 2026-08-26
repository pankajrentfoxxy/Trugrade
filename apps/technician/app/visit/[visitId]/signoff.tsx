import { OTP_CODE } from '@trugrade/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useApp } from '../../../src/app-context';
import { systemClock } from '../../../src/clock';
import type { UnitDraft, VisitSnapshot } from '../../../src/domain/model';
import { queueSignoff } from '../../../src/queue/actions';
import { submittedUnits } from '../../../src/queue/outbox';
import { listDrafts, loadSnapshot } from '../../../src/store';
import { Banner, Button, Card, Field, H1, H2, Muted, P, Screen } from '../../../src/ui/kit';

/**
 * The vendor signs off, by OTP, on what was found.
 *
 * This is the document that stops "you never told me it failed", so the screen
 * shows the counts *before* the code is entered. A sign-off on a summary the
 * vendor never saw is worth nothing in the argument it exists to prevent.
 *
 * The OTP is verified server-side against `vendor_otp_hash`, which makes this the
 * one action in the app that genuinely needs a connection. It still goes through
 * the outbox rather than a direct call: a technician who signs off in a basement
 * and walks to the car must not have to remember to do it again, and the vendor
 * has already given their consent by reading out the code.
 */
export default function SignoffScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { db, deps, refresh, syncNow } = useApp();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<VisitSnapshot | null>(null);
  const [drafts, setDrafts] = useState<UnitDraft[]>([]);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [contactName, setContactName] = useState('');
  const [contactId, setContactId] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!db || !visitId) return;
      setSnapshot(await loadSnapshot(db, visitId));
      setDrafts(await listDrafts(db, visitId));
      setSubmittedCount((await submittedUnits(db, visitId)).size);
    })();
  }, [db, visitId]);

  if (!snapshot) {
    return (
      <Screen>
        <Banner tone="warn">This visit is not on the device.</Banner>
      </Screen>
    );
  }

  const total = snapshot.units.length;
  const unstarted = total - submittedCount - drafts.length;
  const otpValid = OTP_CODE.pattern!.test(otp);

  async function sign() {
    if (!deps || !visitId) return;
    setBusy(true);
    try {
      await queueSignoff(deps, visitId, {
        contactId: contactId.trim(),
        contactName: contactName.trim(),
        otp,
        signedAt: systemClock(),
      });
      await refresh();
      void syncNow();
      router.replace('/route');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Sign-off</H1>
      <Muted>
        {snapshot.visit.vendorName} · {snapshot.visit.visitNumber}
      </Muted>

      <H2>Show this to the vendor</H2>
      <Card>
        <P>{total} units on the manifest</P>
        <P>{submittedCount} inspected and recorded</P>
        {drafts.length > 0 ? <P tone="warn">{drafts.length} started but not finished</P> : null}
        {unstarted > 0 ? <P tone="warn">{unstarted} not started</P> : null}
      </Card>

      {drafts.length + unstarted > 0 ? (
        <Banner tone="warn">
          Not every unit is done. Signing off now records the visit as partially completed — which is
          honest, but make sure the vendor knows which machines were not inspected.
        </Banner>
      ) : null}

      <Muted>
        The vendor gets a code on their registered mobile. Ask them to read it out — do not type it
        for them.
      </Muted>

      <Field label="Vendor contact name" value={contactName} onChangeText={setContactName} autoCapitalize="sentences" />
      <Field label="Vendor contact id" value={contactId} onChangeText={setContactId} autoCapitalize="none" hint="From the contact list on the visit sheet." />
      <Field
        label="OTP"
        value={otp}
        onChangeText={setOtp}
        keyboardType="number-pad"
        error={otp.length > 0 && !otpValid ? OTP_CODE.message : null}
      />

      <Button
        title="Close the visit"
        onPress={() => void sign()}
        disabled={!otpValid || contactName.trim().length < 2 || contactId.trim().length < 1}
        busy={busy}
      />
    </Screen>
  );
}
