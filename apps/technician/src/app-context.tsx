import * as Crypto from 'expo-crypto';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createTransport } from './api/transport';
import { http } from './api/client';
import { systemClock, type Clock } from './clock';
import { openDb } from './db/expo-db';
import type { Db } from './db/db';
import { counts, pruneSent, type Deps, type OutboxCounts } from './queue/outbox';
import { drain } from './queue/sync';

/**
 * One provider, holding the database handle, the outbox counts and the sync
 * loop.
 *
 * There is no state library here and there does not need to be one. The app has
 * exactly one piece of global state — how much work has not reached the server —
 * and SQLite is already the store of record for everything else. A reducer over
 * the top would be a second copy of the truth that can disagree with the first.
 */

interface AppValue {
  db: Db | null;
  deps: Deps | null;
  counts: OutboxCounts;
  /** Last drain attempt found no usable connection. */
  offline: boolean;
  syncing: boolean;
  /** Re-read the counts. Call after enqueueing anything. */
  refresh(): Promise<void>;
  /** Drain now — the sync screen's button, and what a reconnect triggers. */
  syncNow(): Promise<void>;
}

const EMPTY: OutboxCounts = {
  pending: 0,
  blocked: 0,
  sent: 0,
  outstanding: 0,
  pendingPhotos: 0,
  oldestPendingAt: null,
};

const Ctx = createContext<AppValue>({
  db: null,
  deps: null,
  counts: EMPTY,
  offline: false,
  syncing: false,
  refresh: async () => {},
  syncNow: async () => {},
});

export const useApp = () => useContext(Ctx);

/**
 * How often the queue tries on its own.
 *
 * Thirty seconds, not five. Every attempt while there is no signal costs radio
 * power, and a technician's phone has to last a full day of camera use. The
 * cases that actually matter — the app coming to the foreground, and finishing a
 * unit — are handled by explicit triggers rather than by polling faster.
 */
const SYNC_INTERVAL_MS = 30_000;

export function AppProvider({
  children,
  clock = systemClock,
}: {
  children: React.ReactNode;
  clock?: Clock;
}) {
  const [db, setDb] = useState<Db | null>(null);
  const [c, setC] = useState<OutboxCounts>(EMPTY);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // One drain at a time. Two overlapping passes would both read the same head
  // and send it twice — harmless because of the nonce, wasteful over a bad link.
  const running = useRef(false);

  const transport = useMemo(() => createTransport(http), []);

  const deps = useMemo<Deps | null>(
    () => (db ? { db, now: clock, newNonce: () => Crypto.randomUUID() } : null),
    [db, clock],
  );

  const refresh = useCallback(async () => {
    if (!db) return;
    setC(await counts(db));
  }, [db]);

  const syncNow = useCallback(async () => {
    if (!db || running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      const report = await drain({ db, now: clock, transport });
      setOffline(report.offline);
    } finally {
      running.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [db, clock, transport, refresh]);

  useEffect(() => {
    void (async () => {
      const opened = await openDb();
      await pruneSent(opened, clock());
      setDb(opened);
    })();
  }, [clock]);

  useEffect(() => {
    if (!db) return;
    void refresh();
    void syncNow();

    const timer = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    // Coming back to the foreground is the strongest signal that the technician
    // has walked out of the shed and into a bar of signal.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [db, refresh, syncNow]);

  const value = useMemo<AppValue>(
    () => ({ db, deps, counts: c, offline, syncing, refresh, syncNow }),
    [db, deps, c, offline, syncing, refresh, syncNow],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
