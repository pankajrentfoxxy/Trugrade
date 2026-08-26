import Constants from 'expo-constants';
import { File, UploadType } from 'expo-file-system';
import * as Network from 'expo-network';
import { getAccessToken, getRefreshToken, setTokens } from '../session';
import { routes } from './routes';
import type { Http, HttpResponse } from './transport';

/**
 * The real HTTP layer: `fetch`, the access token, the network probe and the
 * pre-signed photo PUT.
 *
 * Everything that decides *what to do* about a failure lives in
 * `transport.ts`; this file only reports what happened. That split is why the
 * queue's behaviour is testable on a plain Node with no simulator.
 */

const BASE_URL = String(
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ??
    'http://localhost:4000',
);

/**
 * Anything slower than this on a warehouse connection is not going to finish.
 * The row goes back in the queue with its nonce intact and tries again, which is
 * strictly better than a request hanging until the OS kills the app.
 */
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 90_000;

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time. Six queued items hitting a 401 must not mint six sessions. */
async function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const token = await getRefreshToken();
      if (!token) return false;
      const res = await fetch(`${BASE_URL}${routes.refresh}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      await setTokens(body.accessToken, body.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const http: Http = {
  async online() {
    try {
      const state = await Network.getNetworkStateAsync();
      // `isInternetReachable` is undefined on some Android builds. Treating
      // undefined as offline would park the queue on a working connection, so
      // the connection flag is what decides and a failed request corrects it.
      return Boolean(state.isConnected) && state.isInternetReachable !== false;
    } catch {
      return true;
    }
  },

  async request({ method, path, body, nonce }): Promise<HttpResponse> {
    const send = async (): Promise<Response> =>
      fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(nonce ? { 'idempotency-key': nonce } : {}),
          ...(await authHeader()),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

    try {
      let res = await send();
      if (res.status === 401 && (await refreshOnce())) res = await send();
      return { status: res.status, body: await parse(res) };
    } catch (e) {
      // Status 0 is "never reached a server". `isPermanentStatus` treats it as
      // transient, which is the whole reason a warehouse basement costs nothing.
      return { status: 0, body: { message: (e as Error).message } };
    }
  },

  async putSigned(url, headers, fileUri): Promise<HttpResponse> {
    try {
      const file = new File(fileUri);
      // Streams from disk rather than through the JS heap: forty units is ~240
      // photographs, and buffering each one into a string is how the app is
      // killed for memory halfway through a sync.
      const result = await file.upload(url, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      return { status: result.status, body: result.body };
    } catch (e) {
      return { status: 0, body: { message: (e as Error).message } };
    }
  },
};

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * The sentence the API wrote, or the one the transport wrote.
 *
 * Two shapes reach here and both matter. `DomainExceptionFilter` nests its
 * payload under `error`, so a real refusal reads `error.message`. A request that
 * never left the handset comes back from `http.request` as status 0 with the
 * thrown message at the top level — and that is the one a technician in a
 * basement warehouse sees most, so it must not be lost while fixing the other.
 */
function apiMessage(body: unknown): string | undefined {
  const b = body as { error?: { message?: string }; message?: string } | null;
  return b?.error?.message ?? b?.message;
}

/** Plain reads. These are only ever called while the technician has signal. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await http.request({ method: 'GET', path });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${res.status} ${apiMessage(res.body) ?? 'Request failed'}`,
    );
  }
  return res.body as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await http.request({ method: 'POST', path, body });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${res.status} ${apiMessage(res.body) ?? 'Request failed'}`,
    );
  }
  return res.body as T;
}
