import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Tokens and device binding.
 *
 * Tokens are in the OS keystore, not in the app's SQLite file. The database on
 * this device holds a day's inspections and travels in a jacket pocket through
 * warehouses; a refresh token sitting in it is a refresh token that leaves with
 * the phone. SecureStore is Keychain on iOS and EncryptedSharedPreferences on
 * Android, and `WHEN_UNLOCKED` means a lost device does not hand its session to
 * whoever picks it up.
 */

const ACCESS = 'trugrade.access';
const REFRESH = 'trugrade.refresh';
const DEVICE = 'trugrade.device';
const TECHNICIAN = 'trugrade.technician';

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface Technician {
  id: string;
  employeeCode: string;
  fullName: string;
  certifiedTools: string[];
  deviceCertId: string | null;
}

/**
 * This installation's identity, minted once and kept for the life of the app.
 *
 * The point is not authentication — the token does that. It is that one
 * technician's credentials working on two devices at once is either a shared
 * login or a stolen one, and both are things the server should be able to see.
 */
export async function deviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE, OPTS);
  if (existing) return existing;
  const fresh = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE, fresh, OPTS);
  return fresh;
}

export const getAccessToken = () => SecureStore.getItemAsync(ACCESS, OPTS);
export const getRefreshToken = () => SecureStore.getItemAsync(REFRESH, OPTS);

export async function setTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS, access, OPTS);
  await SecureStore.setItemAsync(REFRESH, refresh, OPTS);
}

export async function setTechnician(t: Technician): Promise<void> {
  await SecureStore.setItemAsync(TECHNICIAN, JSON.stringify(t), OPTS);
}

export async function getTechnician(): Promise<Technician | null> {
  const raw = await SecureStore.getItemAsync(TECHNICIAN, OPTS);
  return raw ? (JSON.parse(raw) as Technician) : null;
}

/**
 * Sign out.
 *
 * Deliberately does **not** touch the SQLite file. A technician signing out with
 * thirty units still in the outbox has not abandoned them — they sign back in and
 * the queue drains. Clearing local work on sign-out is how a day disappears
 * because someone tapped the wrong thing on a bus.
 */
export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS, OPTS);
  await SecureStore.deleteItemAsync(REFRESH, OPTS);
}
