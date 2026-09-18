import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What this module owns now that the 401 policy lives in `lib/auth`.
 *
 * It used to carry its own refresh-and-replay, which is why the photograph
 * upload could answer a technician with the API's "Please sign in to continue."
 * in red under the file input. That rule is `apiFetch`'s — and asserted in
 * `lib/session-policy.spec.ts`. What is left here is the part a technician
 * standing in a warehouse depends on: the server's own sentence reaches them,
 * and a write is never quietly sent twice.
 */

const apiFetch = vi.fn();
vi.mock('../../lib/auth', () => ({ apiFetch }));

const { send, uploadPhoto } = await import('./api');

const ok = (body: unknown, status = 200): Response =>
  ({ ok: true, status, json: async () => body }) as Response;

const refused = (status: number, message: string): Response =>
  ({ ok: false, status, json: async () => ({ error: { message } }) }) as Response;

beforeEach(() => apiFetch.mockReset());

describe('uploading a photograph', () => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'lid.jpg', { type: 'image/jpeg' });

  it('posts the bytes as multipart, letting the browser write the boundary', async () => {
    apiFetch.mockResolvedValueOnce(ok({ fileKey: 'qc/photos/abc.jpg', url: 'u', hash: 'abc' }));

    const result = await uploadPhoto<{ hash: string }>(file, 'The photograph did not upload');

    expect(result.hash).toBe('abc');
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe('/api/qc/photos');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    // An explicit content-type here loses the multipart boundary.
    expect(init.headers).toBeUndefined();
  });

  it('refuses in the server’s words, not in a status code', async () => {
    apiFetch.mockResolvedValueOnce(refused(422, 'That file is not an image.'));

    await expect(uploadPhoto(file, 'The photograph did not upload')).rejects.toThrow(
      'That file is not an image.',
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the label and the status when the body is not the envelope', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(uploadPhoto(file, 'The photograph did not upload')).rejects.toThrow(
      'The photograph did not upload (502)',
    );
  });
});

describe('writing an inspection', () => {
  it('sends it once and treats 204 as saved', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    await expect(
      send('/api/qc/visits/v1/inspections', 'POST', { serial: 'X' }, 'Could not save'),
    ).resolves.toBeUndefined();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [, init] = apiFetch.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ serial: 'X' });
  });

  it('never re-sends a write the server refused on its merits', async () => {
    // A duplicate serial answered twice would be the console submitting an
    // inspection the technician never asked it to submit again.
    apiFetch.mockResolvedValueOnce(refused(409, 'That serial is already inspected.'));

    await expect(
      send('/api/qc/visits/v1/inspections', 'POST', {}, 'Could not save'),
    ).rejects.toThrow('That serial is already inspected.');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
