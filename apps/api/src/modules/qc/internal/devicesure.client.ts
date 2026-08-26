import { createHash, createPublicKey, verify as verifyEd25519 } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { canonicalise, signablePayload, type DeviceSureCertificate } from '@trugrade/contracts';
import { QcPlatformPort } from '../../../shared/adapters/ports';

/**
 * The inbound half of the DeviceSure integration: is this certificate really
 * from DeviceSure, and is it the document they signed?
 *
 * **The outbound half already exists and is not repeated here.**
 * `QcPlatformPort` in `shared/adapters/ports.ts` is the port for
 * `POST /api/v1/qc/sessions`, licence issue and revoke, and the published public
 * key; `FakeQcPlatform` is the mock behind it; `adapters.module.ts` binds them;
 * and `vendor/internal/licence.service.ts` already listens to `vendor.suspended`
 * and revokes, which is the enforcement mechanism 07 §5.1 asks for. Swapping the
 * mock for the real HTTP client is one line in `adapters.module.ts` — a second
 * client written here would be a second implementation of a port that already
 * has one, and the two would drift.
 *
 * What the port could not carry is this file's one job. A port method that
 * returns "yes it is signed" would put the trust decision inside the thing being
 * trusted; the verification has to happen on our side of the boundary, against a
 * key fetched from a stable published URL rather than by asking DeviceSure
 * whether DeviceSure is telling the truth (07 §3.6).
 *
 * Why this matters more than a hash: once a vendor-run agent produces
 * certificates that set the price we pay and the price a buyer pays, that agent
 * is an untrusted party with a financial interest in the result. SHA-256 proves
 * the document has not changed since it was written. It proves nothing about who
 * wrote it, because anyone can author a payload and compute its hash.
 */
@Injectable()
export class DeviceSureClient {
  private readonly logger = new Logger(DeviceSureClient.name);

  constructor(private readonly platform: QcPlatformPort) {}

  /**
   * The hash we store in `qc_tool_run.raw_report_hash`.
   *
   * Deliberately **our** digest of the payload, not the `certificate.sha256` the
   * sender supplied. A hash we did not compute is a claim, not a check: it
   * matches whatever the sender wanted it to match. Theirs is still compared
   * against this one during ingestion, and a disagreement is recorded rather
   * than resolved — that is a defect in one of the two producers and a human
   * decides which.
   *
   * Caveat worth knowing before someone relies on this for a court: it hashes
   * the *canonical form*, not the wire bytes, because Express has already parsed
   * the body by the time this runs. Byte-exact evidence needs a raw-body
   * middleware on this one route, which is an app-wide change and outside this
   * lane. The canonical form is deterministic, so it is reproducible from the
   * stored `raw_report_json` — which is the property a dispute actually needs.
   */
  hashPayload(payload: unknown): string {
    return createHash('sha256').update(canonicalise(payload), 'utf8').digest('hex');
  }

  /**
   * Verify the Ed25519 signature over `signablePayload(cert)`.
   *
   * Three outcomes, and they are not the same thing:
   *   - `{ verified: true }`             — signed by the published key.
   *   - `{ verified: false, reason }`    — a signature is present and does not
   *     check out. This is worse than no signature at all: somebody produced
   *     something that wants to look signed.
   *   - `{ verified: false, absent: true }` — nothing to verify. Whether that is
   *     fatal is a policy question (production refuses; manual entry does not),
   *     and policy belongs to the service, not here.
   *   - `{ verified: false, keyUnavailable: true }` — we could not read the key.
   *     Kept distinct from a mismatch on purpose: one is a possible forgery, the
   *     other is our own key distribution being broken, and answering a botched
   *     key rotation by declaring every vendor's certificates fraudulent is the
   *     wrong failure. Production still refuses; nothing else has to.
   *
   * Nothing in here throws. A malformed key or a malformed signature is a
   * verification failure, not a 500 — an operator rotating a key badly must not
   * take the ingestion endpoint down with them.
   */
  async verifySignature(
    cert: DeviceSureCertificate,
    keyId = 'default',
  ): Promise<{ verified: boolean; absent?: boolean; keyUnavailable?: boolean; reason?: string }> {
    const signature = cert.certificate.signature;
    if (!signature) return { verified: false, absent: true, reason: 'No signature on the certificate.' };

    let key;
    try {
      key = createPublicKey(toPem(await this.platform.fetchPublicKey(keyId)));
    } catch (e) {
      // Includes the mock's placeholder key, so a dev or test environment lands
      // here rather than pretending to have verified anything.
      this.logger.warn(`DeviceSure public key "${keyId}" is unusable: ${(e as Error).message}`);
      return { verified: false, keyUnavailable: true, reason: `Public key "${keyId}" could not be read.` };
    }

    if (key.asymmetricKeyType !== 'ed25519') {
      return {
        verified: false,
        keyUnavailable: true,
        reason: `Public key "${keyId}" is ${key.asymmetricKeyType}, not ed25519.`,
      };
    }

    try {
      // Ed25519 signs the message itself, so the algorithm argument is null —
      // passing a hash name here is the classic way this call silently fails.
      const ok = verifyEd25519(
        null,
        Buffer.from(signablePayload(cert), 'utf8'),
        key,
        Buffer.from(signature, 'base64'),
      );
      return ok ? { verified: true } : { verified: false, reason: 'Signature does not match the payload.' };
    } catch (e) {
      return { verified: false, reason: `Signature could not be checked: ${(e as Error).message}` };
    }
  }
}

/** Accepts a PEM as-is, or wraps bare base64 SPKI — both forms are published in the wild. */
function toPem(key: string): string {
  const trimmed = key.trim();
  if (trimmed.includes('-----BEGIN')) return trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${trimmed.replace(/\s+/g, '')}\n-----END PUBLIC KEY-----\n`;
}
