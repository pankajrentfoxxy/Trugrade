import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A lapsed access cookie must not look like a lost session.
 *
 * An inspection is twelve areas, detected hardware, six photographs and a seal.
 * It outlasts the fifteen-minute access cookie by a wide margin, and every read
 * that drew the screen happened at the top of that window — so the technician's
 * first WRITE was the request that met the lapse. It answered 401 and the screen
 * printed the API's own sentence, "Please sign in to continue.", in red under
 * the file input, while the refresh cookie sat in the jar still good for weeks.
 *
 * These assert the recovery on both writers, and — just as important — that the
 * refresh is spent once and only on a 401. Retrying a POST that the server
 * refused for any other reason would be the console re-submitting an inspection
 * behind the technician's back.
 */

const refreshSession = vi.fn(async () => ({}) as unknown);
vi.mock('../../lib/auth', () => ({ refreshSession }));

const { send, uploadPhoto } = await import('./api');

const ok = (body: unknown, status = 200): Response =>
  ({ ok: true, status, json: async () => body }) as Response;

const refused = (status: number, message: string): Response =>
  ({ ok: false, status, json: async () => ({ error: { message } }) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshSession.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploading a photograph after the access cookie has lapsed', () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'lid.jpg', { type: 'image/jpeg' });

  it('spends the refresh cookie and uploads, rather than asking for a sign-in', async () => {
    fetchMock
      .mockResolvedValueOnce(refused(401, 'Please sign in to continue.'))
      .mockResolvedValueOnce(ok({ fileKey: 'qc/photos/abc.jpg', url: 'u', hash: 'abc' }));

    const result = await uploadPhoto<{ hash: string }>(file, 'The photograph did not upload');

    expect(result.hash).toBe('abc');
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('posts the same bytes the second time', async () => {
    fetchMock
      .mockResolvedValueOnce(refused(401, 'Please sign in to continue.'))
      .mockResolvedValueOnce(ok({ fileKey: 'k', url: 'u', hash: 'abc' }));

    await uploadPhoto(file, 'The photograph did not upload');

    // The retry must carry the photograph, not an empty body — and no explicit
    // content-type, so the browser keeps writing the multipart boundary.
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBe(file);
      expect(init.headers).toBeUndefined();
    }
  });

  it('gives up after one refresh rather than looping', async () => {
    fetchMock.mockResolvedValue(refused(401, 'Please sign in to continue.'));

    await expect(uploadPhoto(file, 'The photograph did not upload')).rejects.toThrow(
      'Please sign in to continue.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('leaves every other refusal alone, with the server’s own sentence', async () => {
    fetchMock.mockResolvedValueOnce(refused(422, 'That file is not an image.'));

    await expect(uploadPhoto(file, 'The photograph did not upload')).rejects.toThrow(
      'That file is not an image.',
    );
    expect(refreshSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('writing an inspection after the access cookie has lapsed', () => {
  it('recovers the submit too — a twelve-minute inspection is not lost to a 401', async () => {
    fetchMock
      .mockResolvedValueOnce(refused(401, 'Please sign in to continue.'))
      .mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    await send('/api/qc/visits/v1/inspections', 'POST', { serial: 'X' }, 'Could not save');

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never re-sends a write the server refused on its merits', async () => {
    // A duplicate serial answered twice would be the console submitting an
    // inspection the technician never asked it to submit again.
    fetchMock.mockResolvedValueOnce(refused(409, 'That serial is already inspected.'));

    await expect(
      send('/api/qc/visits/v1/inspections', 'POST', {}, 'Could not save'),
    ).rejects.toThrow('That serial is already inspected.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
