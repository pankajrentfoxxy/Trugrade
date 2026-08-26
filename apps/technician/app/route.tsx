import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { apiGet } from '../src/api/client';
import { routes } from '../src/api/routes';
import { useApp } from '../src/app-context';
import { systemClock, todayInIndia } from '../src/clock';
import type { VisitSnapshot } from '../src/domain/model';
import { cachedVisits, saveSnapshot } from '../src/store';
import { Banner, Button, Card, Chip, H1, Muted, P, Row, Screen } from '../src/ui/kit';

/**
 * The day's visits.
 *
 * Fetches the route **and the full snapshot for every visit on it**, then writes
 * both to SQLite. That is more data than the screen shows, and it is fetched
 * here rather than at check-in because this screen is the last moment the app can
 * count on signal: the technician opens it over breakfast or in a car park, and
 * the next reliable connection may be six hours later.
 *
 * When the fetch fails, the cached snapshots are the screen. No spinner, no
 * error state that blocks the day — an offline technician with yesterday's route
 * on the device is in a much better position than one looking at a retry button.
 */
export default function RouteScreen() {
  const { db, refresh } = useApp();
  const router = useRouter();
  const [visits, setVisits] = useState<VisitSnapshot[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!db) return;
    setBusy(true);
    try {
      const today = todayInIndia(systemClock);
      const fresh = await apiGet<VisitSnapshot[]>(routes.route(today));
      for (const v of fresh) await saveSnapshot(db, v);
      setVisits(fresh);
      setStale(false);
    } catch {
      setVisits(await cachedVisits(db));
      setStale(true);
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [db, refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <H1>{todayInIndia(systemClock)}</H1>

      {stale ? (
        <Banner tone="warn">
          Showing what is stored on this device. Pull the route again when you have signal — the
          tolerance rules and the seal roll come with it.
        </Banner>
      ) : null}

      {visits.length === 0 && !busy ? (
        <Card>
          <P>No visits on this device.</P>
          <Muted>
            If you are expecting one, find signal and refresh. The app cannot invent a manifest.
          </Muted>
        </Card>
      ) : null}

      {visits.map((v) => (
        <Pressable key={v.visit.id} onPress={() => router.push(`/visit/${v.visit.id}/kit`)}>
          <Card>
            <Row>
              <P>{v.visit.visitNumber}</P>
              <Chip label={`${v.units.length} units`} tone="brand" />
              {v.visit.slotFrom ? (
                <Chip label={`${v.visit.slotFrom}–${v.visit.slotTo ?? ''}`} />
              ) : null}
            </Row>
            <P>{v.visit.vendorName}</P>
            <Muted>
              {v.visit.facilityLabel} · {v.visit.addressLine}
            </Muted>
          </Card>
        </Pressable>
      ))}

      <Button title="Refresh route" tone="plain" onPress={() => void load()} busy={busy} />
    </Screen>
  );
}
