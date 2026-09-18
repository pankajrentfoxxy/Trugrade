import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as AuthModule from './auth';

/**
 * A 401 is never a message.
 *
 * It is not something a person did wrong — it is the fifteen-minute access
 * cookie lapsing, which is routine on forms that take longer than that to fill
 * in. So it is suppressed, the session is restored once, the request is replayed
 * once, and a 401 at either step signs out. Nothing in between reaches a screen.
 *
 * These drive the real `apiFetch` against a mocked `fetch`, so the ordering —
 * original, session, replay, logout — is asserted as the sequence of requests
 * the browser actually makes.
 */

const SESSION = '/api/auth/session';
const LOGOUT = '/api/auth/logout';

const res = (status: number, body: unknown = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
/** The paths requested, in order. */
const calls = (): string[] => fetchMock.mock.calls.map(([url]) => String(url));

async function load(): Promise<typeof AuthModule> {
  vi.resetModules();
  return import('./auth');
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a request that meets a lapsed access cookie', () => {
  it('restores the session and replays it, and the caller never sees the 401', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, { error: { message: 'Please sign in to continue.' } }))
      .mockResolvedValueOnce(res(200, { userId: 'u1' }))
      .mockResolvedValueOnce(res(200, { id: 'saved' }));

    const { apiFetch } = await load();
    const out = await apiFetch('/api/qc/photos', { method: 'POST' });

    expect(out.status).toBe(200);
    expect(calls()).toEqual(['/api/qc/photos', SESSION, '/api/qc/photos']);
  });

  it('sends the credentials on every attempt, so the new cookie is used', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { userId: 'u1' }))
      .mockResolvedValueOnce(res(200));

    const { apiFetch } = await load();
    await apiFetch('/api/qc/visits');

    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).credentials).toBe('include');
    }
  });

  it('spends one rotation for several requests that lapse together', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === SESSION ? res(200, { userId: 'u1' }) : res(401)),
    );
    const { apiFetch } = await load();
    // All four 401 and all four ask for a restore at the same moment.
    await Promise.race([
      Promise.all([
        apiFetch('/api/a'),
        apiFetch('/api/b'),
        apiFetch('/api/c'),
        apiFetch('/api/d'),
      ]),
      // The replays 401 too, so each ends in a sign-out that never settles.
      new Promise((r) => setTimeout(r, 50)),
    ]);

    expect(calls().filter((u) => u === SESSION)).toHaveLength(1);
  });
});

describe('a session that is genuinely gone', () => {
  it('signs out when the restore itself is refused, and never resolves', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHENTICATED' } }))
      .mockResolvedValue(res(204));

    const { apiFetch, setSessionLostHandler } = await load();
    const lost = vi.fn();
    setSessionLostHandler(lost);

    let settled = false;
    void apiFetch('/api/qc/visits').then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));

    // Never resolving is the point: a resolved 401 is a 401 somebody renders.
    expect(settled).toBe(false);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(calls()).toContain(LOGOUT);
  });

  it('signs out when the replay is refused as well', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { userId: 'u1' }))
      .mockResolvedValueOnce(res(401))
      .mockResolvedValue(res(204));

    const { apiFetch, setSessionLostHandler } = await load();
    const lost = vi.fn();
    setSessionLostHandler(lost);

    let settled = false;
    void apiFetch('/api/qc/visits').then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(settled).toBe(false);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual(['/api/qc/visits', SESSION, '/api/qc/visits', LOGOUT]);
  });

  it('signs out once, however many requests discover it at the same moment', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url === LOGOUT ? res(204) : res(401)),
    );

    const { apiFetch, setSessionLostHandler } = await load();
    const lost = vi.fn();
    setSessionLostHandler(lost);

    void apiFetch('/api/a');
    void apiFetch('/api/b');
    void apiFetch('/api/c');
    await new Promise((r) => setTimeout(r, 30));

    expect(lost).toHaveBeenCalledTimes(1);
    expect(calls().filter((u) => u === LOGOUT)).toHaveLength(1);
  });
});

describe('what the policy must not touch', () => {
  it('never refreshes or replays an auth route', async () => {
    // A 401 from a login IS the answer, and a replayed login spends two of the
    // five attempts the rate limiter allows for one thing somebody did once.
    fetchMock.mockResolvedValueOnce(res(401, { error: { message: 'Those details did not match.' } }));

    const { apiFetch } = await load();
    const out = await apiFetch('/api/auth/login', { method: 'POST' });

    expect(out.status).toBe(401);
    expect(calls()).toEqual(['/api/auth/login']);
  });

  it('hands back any other refusal untouched, with no restore attempted', async () => {
    fetchMock.mockResolvedValueOnce(res(422, { error: { message: 'That serial is already inspected.' } }));

    const { apiFetch } = await load();
    const out = await apiFetch('/api/qc/inspections', { method: 'POST' });

    expect(out.status).toBe(422);
    expect(calls()).toEqual(['/api/qc/inspections']);
  });

  it('does not sign anybody out because the network blinked', async () => {
    // A restore that failed to reach the server proves nothing about the
    // session, and signing someone out over it trades a silent failure for a
    // rude one. The caller gets its original refusal to report in its own words.
    fetchMock.mockResolvedValueOnce(res(401)).mockRejectedValueOnce(new TypeError('offline'));

    const { apiFetch, setSessionLostHandler } = await load();
    const lost = vi.fn();
    setSessionLostHandler(lost);

    const out = await apiFetch('/api/qc/visits');

    expect(out.status).toBe(401);
    expect(lost).not.toHaveBeenCalled();
    expect(calls()).not.toContain(LOGOUT);
  });
});
