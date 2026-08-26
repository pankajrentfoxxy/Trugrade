import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/app-context';
import { C } from '../src/ui/kit';
import { PendingBadge } from '../src/ui/pending-badge';

/**
 * One stack, one provider, and the pending-sync badge in the header of every
 * screen in the app.
 *
 * `headerRight` is set here rather than per screen deliberately. The requirement
 * is that the technician can see how much work has not reached the server *at
 * all times*, and the only way to guarantee that is for it to be impossible to
 * add a screen without it.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerRight: () => <PendingBadge />,
            headerTintColor: C.ink,
            headerStyle: { backgroundColor: C.bg },
            headerTitleStyle: { fontSize: 16, fontWeight: '700' },
            contentStyle: { backgroundColor: C.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Trugrade QC' }} />
          <Stack.Screen name="route" options={{ title: "Today's route", headerBackVisible: false }} />
          <Stack.Screen name="sync" options={{ title: 'Sync' }} />
          <Stack.Screen name="visit/[visitId]/kit" options={{ title: 'Kit check' }} />
          <Stack.Screen name="visit/[visitId]/checkin" options={{ title: 'Check in' }} />
          <Stack.Screen name="visit/[visitId]/manifest" options={{ title: 'Units' }} />
          <Stack.Screen name="visit/[visitId]/signoff" options={{ title: 'Vendor sign-off' }} />
          <Stack.Screen name="visit/[visitId]/expenses" options={{ title: 'Expenses' }} />
          <Stack.Screen name="unit/[visitUnitId]" options={{ title: 'Inspection' }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
