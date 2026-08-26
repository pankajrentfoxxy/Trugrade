import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { apiPost } from '../src/api/client';
import { routes } from '../src/api/routes';
import { deviceId, getTechnician, setTechnician, setTokens, type Technician } from '../src/session';
import { Banner, Button, Card, Field, H1, Muted, P, Screen } from '../src/ui/kit';

/**
 * Sign in, and bind this installation to the technician.
 *
 * The two are one screen and one request on purpose. Binding is not a separate
 * ceremony the technician can skip — the device id goes with the credentials, and
 * the server either accepts this installation for this technician or refuses the
 * sign-in. One technician's credentials working on two handsets at once is either
 * a shared login or a stolen one, and the point of binding is that the server can
 * see which.
 *
 * The device id is shown on screen because the only way support can help with
 * "it says this device is not registered" is if the technician can read it out.
 */
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  technician: Technician;
}

export default function LoginScreen() {
  const router = useRouter();
  const [device, setDevice] = useState<string | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setDevice(await deviceId());
      // A technician who is already signed in should never see this screen; they
      // are usually opening the app in a car park to check the day's route.
      if (await getTechnician()) router.replace('/route');
    })();
  }, [router]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<LoginResponse>(routes.login, {
        employeeCode: employeeCode.trim().toUpperCase(),
        password,
        deviceId: await deviceId(),
        platform: Platform.OS,
      });
      await setTokens(res.accessToken, res.refreshToken);
      await setTechnician(res.technician);
      router.replace('/route');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Sign in</H1>
      <P tone="muted">
        Signing in registers this handset to you. Inspections you record stay on this device until
        they reach the server, so use your own.
      </P>

      <Field
        label="Employee code"
        value={employeeCode}
        onChangeText={setEmployeeCode}
        placeholder="TRG-QC-0142"
        hint="As printed on your ID card."
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        secureTextEntry
      />

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <Button
        title="Sign in and register this device"
        onPress={() => void submit()}
        busy={busy}
        disabled={employeeCode.length < 3 || password.length < 8}
      />

      <Card>
        <Muted>Device id — read this out if support asks</Muted>
        <P>{device ?? '…'}</P>
      </Card>
    </Screen>
  );
}
