import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useApp } from '../../../src/app-context';
import { systemClock } from '../../../src/clock';
import { kvGet } from '../../../src/db/db';
import type { VisitSnapshot } from '../../../src/domain/model';
import { distanceMetres, isPlausibleIndianFix } from '../../../src/geo';
import { queueCheckIn } from '../../../src/queue/actions';
import { loadSnapshot } from '../../../src/store';
import { Banner, Button, Card, H1, H2, Muted, P, Screen } from '../../../src/ui/kit';

/**
 * Arrival at the vendor site, with the location captured.
 *
 * The variance against the registered facility address is computed and shown
 * **before** the technician commits, which is the only useful moment for it. An
 * alert that fires in an ops queue on Monday tells somebody that a check-in was
 * odd; a number on this screen tells the technician they are at the wrong gate
 * while they can still walk to the right one.
 *
 * A high variance does not block. There are honest reasons for one — a warehouse
 * whose registered address is the corporate office, a fix taken inside a steel
 * shed — and blocking would mean a technician who cannot start work. It is
 * recorded, it is flagged, and a human decides.
 */
export default function CheckInScreen() {
  const { visitId } = useLocalSearchParams<{ visitId: string }>();
  const { db, deps, refresh } = useApp();
  const router = useRouter();

  const [snapshot, setSnapshot] = useState<VisitSnapshot | null>(null);
  const [kitDone, setKitDone] = useState(false);
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!db || !visitId) return;
      setSnapshot(await loadSnapshot(db, visitId));
      setKitDone(Boolean(await kvGet(db, `kit:${visitId}`)));
    })();
  }, [db, visitId]);

  async function capture() {
    setBusy(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError('Location permission is required to check in. It is the visit’s anti-fraud record.');
        return;
      }
      // Highest accuracy the handset can manage: the alert threshold is 500 m
      // and a coarse network fix can be wrong by more than that on its own.
      setFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return (
      <Screen>
        <Banner tone="warn">This visit is not on the device.</Banner>
      </Screen>
    );
  }

  const facility =
    snapshot.visit.lat !== null && snapshot.visit.lng !== null
      ? { lat: snapshot.visit.lat, lng: snapshot.visit.lng }
      : null;
  const here = fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  const variance = here && facility ? distanceMetres(here, facility) : null;
  const overThreshold = variance !== null && variance > snapshot.config.geoVarianceAlertMetres;
  const outsideIndia = here !== null && !isPlausibleIndianFix(here);

  async function checkIn() {
    if (!deps || !here || !fix || !visitId) return;
    setBusy(true);
    try {
      await queueCheckIn(deps, visitId, {
        lat: here.lat,
        lng: here.lng,
        accuracyMetres: fix.coords.accuracy ?? null,
        capturedAt: systemClock(),
      });
      await refresh();
      router.replace(`/visit/${visitId}/manifest`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>{snapshot.visit.vendorName}</H1>
      <Muted>
        {snapshot.visit.facilityLabel} · {snapshot.visit.addressLine}
      </Muted>

      {!kitDone ? (
        <Banner tone="warn">Do the kit check first — the seal roll has to be the right one.</Banner>
      ) : null}

      <H2>Location</H2>
      <Button
        title={fix ? 'Take the location again' : 'Capture location'}
        tone={fix ? 'plain' : 'brand'}
        onPress={() => void capture()}
        busy={busy}
      />

      {error ? <Banner tone="bad">{error}</Banner> : null}

      {here ? (
        <Card>
          <P>
            {here.lat.toFixed(5)}, {here.lng.toFixed(5)}
          </P>
          <Muted>Accuracy ±{Math.round(fix?.coords.accuracy ?? 0)} m</Muted>
          {variance === null ? (
            <Muted>
              This facility has no registered coordinates, so no variance can be computed. The fix is
              still recorded.
            </Muted>
          ) : (
            <P tone={overThreshold ? 'bad' : 'ok'}>{variance} m from the registered address</P>
          )}
        </Card>
      ) : null}

      {outsideIndia ? (
        <Banner tone="bad">
          That fix is outside India. Something is wrong with the location — turn location off and on,
          step outside, and take it again before checking in.
        </Banner>
      ) : null}

      {overThreshold ? (
        <Banner tone="warn">
          More than {snapshot.config.geoVarianceAlertMetres} m from the address on file. Check you are
          at the right gate. If you are, carry on — this is recorded and reviewed, not blocked.
        </Banner>
      ) : null}

      <Button
        title="Check in and open the manifest"
        onPress={() => void checkIn()}
        disabled={!here || !kitDone || outsideIndia}
        busy={busy}
      />

      <Muted>
        Check-in is queued on the device. If there is no signal here it goes up when there is, with
        the time you actually arrived.
      </Muted>
    </Screen>
  );
}
