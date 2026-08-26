import { isPermanentStatus, type SendOutcome, type Transport } from '../queue/sync';
import type { OutboxItem } from '../queue/outbox';
import { routes } from './routes';

/**
 * Turning an outbox row into an HTTP request.
 *
 * Kept free of `expo-*` and of `fetch` itself so the whole classification —
 * which failures lose work and which ones wait — is testable without a device.
 * `src/api/client.ts` supplies the two real implementations.
 */

export interface HttpResponse {
  /** `0` means the request never reached a server. Always transient. */
  status: number;
  body: unknown;
}

export interface Http {
  request(input: {
    method: 'GET' | 'POST' | 'PATCH';
    path: string;
    body?: unknown;
    /** Set on every mutating request. Lets the server dedupe our retries. */
    nonce?: string;
  }): Promise<HttpResponse>;
  /** PUT a local file to an absolute pre-signed URL. */
  putSigned(url: string, headers: Record<string, string>, fileUri: string): Promise<HttpResponse>;
  online(): Promise<boolean>;
}

/** What the server tells the technician when it refuses something. */
function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
    if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  }
  return fallback;
}

function classify(res: HttpResponse, fallback: string): SendOutcome {
  if (res.status >= 200 && res.status < 300) return { ok: true };
  return {
    ok: false,
    permanent: isPermanentStatus(res.status),
    error: `${res.status} ${messageOf(res.body, fallback)}`,
  };
}

interface SignedUpload {
  uploadUrl: string;
  headers?: Record<string, string>;
  key: string;
}

/**
 * A photograph is three steps and the middle one is the big transfer.
 *
 * The steps are ordered so a resumed upload cannot produce a second object: the
 * signed URL is derived server-side from the content hash, so the same photo
 * always signs to the same key, and a PUT that already happened simply overwrites
 * identical bytes. Only the final POST creates a row, and it carries the outbox
 * nonce.
 */
async function sendPhoto(http: Http, item: OutboxItem): Promise<SendOutcome> {
  if (!item.fileUri) {
    return { ok: false, permanent: true, error: 'Photograph has no local file.' };
  }

  const signed = await http.request({
    method: 'POST',
    path: routes.signPhoto,
    body: {
      purpose: item.body.purpose,
      visitUnitId: item.body.visitUnitId,
      expenseLocalId: item.body.expenseLocalId,
      angle: item.body.angle,
      sha256: item.body.sha256,
      contentType: item.body.contentType,
      bytes: item.body.bytes,
    },
    nonce: item.nonce,
  });
  if (signed.status < 200 || signed.status >= 300) {
    return classify(signed, 'Could not get an upload URL for this photograph.');
  }

  const grant = signed.body as SignedUpload;
  const put = await http.putSigned(
    grant.uploadUrl,
    { 'content-type': String(item.body.contentType ?? 'image/jpeg'), ...(grant.headers ?? {}) },
    item.fileUri,
  );
  if (put.status < 200 || put.status >= 300) {
    // A pre-signed URL expires. That is a 403 from the object store and would be
    // classified permanent, which is wrong — the fix is a fresh signature, and
    // the next attempt gets one. So the upload leg is always retryable.
    return { ok: false, permanent: false, error: `Upload failed (${put.status}).` };
  }

  return classify(
    await http.request({
      method: 'POST',
      path: routes.photos,
      body: { ...item.body, key: grant.key },
      nonce: item.nonce,
    }),
    'The server refused this photograph.',
  );
}

const PATH_FOR: Record<Exclude<OutboxItem['kind'], 'PHOTO'>, (item: OutboxItem) => string> = {
  CHECK_IN: (i) => routes.checkIn(String(i.body.visitId)),
  TOOL_RUN: () => routes.toolRuns,
  SEAL: () => routes.seals,
  UNIT_RESULT: (i) => routes.unitResult(String(i.body.visitUnitId)),
  ABSENT: (i) => routes.absent(String(i.body.visitUnitId)),
  SIGNOFF: (i) => routes.signoff(String(i.body.visitId)),
  EXPENSE: (i) => routes.expenses(String(i.body.visitId)),
};

export function createTransport(http: Http): Transport {
  return {
    online: () => http.online(),
    async send(item: OutboxItem): Promise<SendOutcome> {
      try {
        if (item.kind === 'PHOTO') return await sendPhoto(http, item);

        const path = PATH_FOR[item.kind](item);
        // The nonce goes with the body *and* as a header. In the body because
        // `qc_tool_run.nonce` is a column the ingestion endpoint reads; as a
        // header because every other endpoint dedupes generically and should not
        // need to know this app's payload shape.
        const res = await http.request({
          method: 'POST',
          path,
          body: { ...item.body, nonce: item.nonce },
          nonce: item.nonce,
        });
        return classify(res, 'The server refused this action.');
      } catch (e) {
        // An exception escaping the HTTP layer is a client bug, a parse failure
        // or a platform error. None of those are a reason to discard the row.
        return { ok: false, permanent: false, error: (e as Error).message };
      }
    },
  };
}
