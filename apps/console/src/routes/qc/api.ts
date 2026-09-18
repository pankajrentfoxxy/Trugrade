import { refreshSession } from '../../lib/auth';

/**
 * The two things the QC console does that the catalog screens never had to:
 * write, and upload.
 *
 * `useResource` in `../../lib` already owns reading, and nothing here duplicates
 * it. What is missing is a mutation path, and the failure it has to handle well
 * is specific: a technician standing in a warehouse presses Submit, the request
 * fails, and the only acceptable outcomes are "it saved" or "it did not save and
 * you can see why". A thrown `Error` with the server's own message is the whole
 * mechanism — no optimistic state, nothing that could leave the screen claiming
 * an inspection was recorded when it was not.
 *
 * The one retry here is not about flakiness. See `withFreshSession`.
 */

/**
 * Whatever the API said went wrong, preferring its message over the status.
 *
 * `DomainExceptionFilter` nests the payload under `error`, so `error.message` is
 * where the sentence written for a human lives. A reader that looks at the top
 * level finds nothing and falls through to the status every single time, which
 * is the difference between "this serial belongs to another vendor" and
 * "Could not save (422)" for the technician holding the machine.
 */
async function failure(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    const m = body.error?.message;
    if (m) return new Error(m);
  } catch {
    // A non-JSON body from a proxy or a gateway. The status is all there is.
  }
  return new Error(`${fallback} (${res.status})`);
}

/**
 * Send it; on a 401, spend the refresh cookie once and send it again.
 *
 * An inspection is twelve areas, detected hardware, six photographs and a seal.
 * It takes far longer than the fifteen-minute access cookie, and the reads that
 * drew the screen all happened at the top of that. So the technician's FIRST
 * write — usually choosing a photograph — was the request that met the lapse,
 * and it answered with the API's own "Please sign in to continue." in red under
 * the file input while the refresh cookie sat in the jar, still good for weeks,
 * and the chrome went on drawing a signed-in session. Every read on this screen
 * already recovers itself this way (`useResource`); the two writers did not.
 *
 * `refreshSession` is single-flight, so six photographs picked in a row spend
 * one rotation between them rather than six.
 */
async function withFreshSession(go: () => Promise<Response>): Promise<Response> {
  const res = await go();
  if (res.status !== 401) return res;
  await refreshSession();
  return go();
}

export async function send<T>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown,
  failureLabel: string,
): Promise<T> {
  const res = await withFreshSession(() =>
    fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) throw await failure(res, failureLabel);
  // 204 on the action endpoints; callers that expect nothing type T as void.
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * One photograph, to the object store, via the API.
 *
 * Multipart rather than a signed PUT from the browser, because the server has to
 * see the bytes anyway: `checkUpload` sniffs the leading bytes (a declared MIME
 * type is attacker-controlled), EXIF is stripped server-side, and the SHA-256 on
 * `qc_photo.hash` must be computed over what was actually stored rather than
 * over what a client claimed it sent.
 */
export async function uploadPhoto<T>(file: File, failureLabel: string): Promise<T> {
  // Built once and sent up to twice: `FormData` is serialised per request, not
  // consumed like a stream, so the retry posts the same bytes.
  const form = new FormData();
  form.append('file', file);
  // No `content-type` — the browser sets it, with the multipart boundary.
  const res = await withFreshSession(() =>
    fetch('/api/qc/photos', { method: 'POST', credentials: 'include', body: form }),
  );
  if (!res.ok) throw await failure(res, failureLabel);
  return (await res.json()) as T;
}

/** Query string with the empty filters dropped, so the URL is a stable cache key. */
export function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== '' && v !== null,
  );
  return entries.length === 0 ? '' : `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}`;
}
