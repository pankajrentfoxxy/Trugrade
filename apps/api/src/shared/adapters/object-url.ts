import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfig } from '../config';
import { ClockPort } from '../clock';

/**
 * The browser-facing name of an object in storage.
 *
 * WHY THIS IS NOT A PRESIGNED S3 URL. A presigned URL publishes the key: it is
 * the path component of the thing the browser fetches. Our keys are not public
 * identifiers — `qc/photos/…`, `kyc/<org>/…`, and the key a supplier's document
 * lands under can carry a GSTIN or a vendor slug, which is precisely the leak
 * PHASE_05 Task 1 asks to be tested for (and which `qc-report-pdf.spec.ts`
 * plants a GSTIN in an object key to prove). So the reference a customer
 * receives is the key ENCRYPTED, not the key signed: AES-256-GCM over
 * `<expiry>:<key>`, base64url. It carries its own expiry, it cannot be read, it
 * cannot be altered without failing the auth tag, and it cannot be walked —
 * there is no ordering to increment.
 *
 * The same shape works against real object storage: the adapter mints one of
 * these instead of a provider presign, and `GET /api/objects/:token` reads the
 * bytes through `ObjectStorePort.get`. That is deliberately one indirection more
 * than S3 offers, and it is the indirection that keeps the key private.
 *
 * ponytail: the key is process-lifetime random, so tokens die on restart and a
 * second API instance cannot verify the first's. That is correct for one
 * process and wrong for a fleet; the upgrade is an `OBJECT_URL_SECRET` in the
 * environment, read here instead of generated, and nothing else changes.
 */
@Injectable()
export class ObjectUrlSigner {
  private readonly secret = randomBytes(32);

  constructor(
    private readonly config: AppConfig,
    private readonly clock: ClockPort,
  ) {}

  /** An absolute URL a browser can fetch, valid for `ttlSeconds`. */
  sign(key: string, ttlSeconds: number): string {
    const expiresAt = Math.floor(this.clock.nowMs() / 1000) + ttlSeconds;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.secret, iv);
    const body = Buffer.concat([cipher.update(`${expiresAt}:${key}`, 'utf8'), cipher.final()]);
    const token = Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
    // `/api` is `setGlobalPrefix` in main.ts. Named here because this string is
    // built outside the request and so cannot be derived from one.
    return `${this.config.get('API_PUBLIC_URL')}/api/objects/${token}`;
  }

  /** The key a token names, or null if it is forged, altered or expired. */
  verify(token: string): string | null {
    let plaintext: string;
    try {
      const raw = Buffer.from(token, 'base64url');
      if (raw.length < 12 + 16 + 1) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.secret, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      plaintext = Buffer.concat([
        decipher.update(raw.subarray(12, raw.length - 16)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // A failed auth tag is the whole point of the tag: an altered token is
      // indistinguishable from a random one, and both are "no".
      return null;
    }

    const colon = plaintext.indexOf(':');
    if (colon < 1) return null;
    const expiresAt = Number(plaintext.slice(0, colon));
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 < this.clock.nowMs()) return null;
    return plaintext.slice(colon + 1);
  }
}
