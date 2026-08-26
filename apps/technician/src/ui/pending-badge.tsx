import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../app-context';
import { C } from './kit';

/**
 * How many actions have not reached the server, on every screen, always.
 *
 * This is a requirement, not decoration. A silent queue is how a day's work gets
 * lost: the technician finishes forty units, drives home, and finds out the next
 * morning that the app stopped uploading at unit nine. So the count lives in the
 * navigation header — not on a settings screen, not behind a menu — and it is
 * the same component on every route.
 *
 * Three states, in increasing order of how much the technician should care:
 *
 *   **0 outstanding, online** — a quiet tick. Everything is on the server.
 *   **n pending** — the count, plain. Normal during a visit.
 *   **anything blocked** — red, and it stays red. A blocked item needs a human
 *   and will not clear on its own, so it must never look like ordinary backlog.
 *
 * Tapping opens the sync screen, because a number nobody can act on is only
 * anxiety.
 */
export function PendingBadge() {
  const { counts, offline, syncing } = useApp();
  const router = useRouter();

  const blocked = counts.blocked > 0;
  const tone = blocked ? C.bad : counts.outstanding > 0 ? C.warn : C.ok;
  const label = blocked
    ? `${counts.blocked} stuck`
    : counts.outstanding > 0
      ? `${counts.outstanding} to send`
      : offline
        ? 'offline'
        : 'all sent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${label}. Tap for detail.`}
      onPress={() => router.push('/sync')}
      style={s.wrap}
      hitSlop={12}
    >
      <View style={[s.dot, { backgroundColor: tone }]} />
      <Text style={[s.text, { color: tone }]}>{label}</Text>
      {syncing ? <ActivityIndicator size="small" color={tone} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { fontSize: 13, fontWeight: '700' },
});
