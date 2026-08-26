/**
 * Upload validation. VR-061 to VR-071.
 *
 * The rule that carries the weight: **the file extension and the declared MIME
 * type are both attacker-controlled.** Only the bytes are evidence. So every
 * check here reads the content, and the declared type is used solely to detect a
 * *contradiction* — a PDF that starts with a PNG header is not a naming mistake,
 * it is someone probing what the parser will do.
 */

import {
  MAGIC_BYTES,
  PDF_FORBIDDEN_TOKENS,
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  UPLOAD_RULES,
  type AllowedMime,
} from './rules';

export type UploadRejection =
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'MIME_NOT_ALLOWED'
  | 'MAGIC_MISMATCH'
  | 'ACTIVE_CONTENT'
  | 'BAD_FILENAME';

export interface UploadCheck {
  ok: boolean;
  rejection?: UploadRejection;
  /** What the person uploading reads. */
  message?: string;
  /** What the bytes actually are, regardless of what was claimed. */
  sniffedMime?: AllowedMime | null;
}

/**
 * Identify a file from its leading bytes.
 *
 * WEBP needs both halves — `RIFF` at 0 and `WEBP` at 8 — because `RIFF` alone is
 * also AVI and WAV, and accepting those as images is how a decoder gets handed
 * something it was not written for.
 */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  const startsWith = (sig: readonly number[], offset = 0): boolean =>
    sig.every((b, i) => bytes[offset + i] === b);

  for (const [mime, signatures] of Object.entries(MAGIC_BYTES) as Array<
    [AllowedMime, readonly number[][]]
  >) {
    for (const sig of signatures) {
      if (!startsWith(sig)) continue;
      if (mime === 'image/webp') {
        // RIFF....WEBP — check the second marker at offset 8.
        const webp = [0x57, 0x45, 0x42, 0x50];
        if (!startsWith(webp, 8)) continue;
      }
      return mime;
    }
  }
  return null;
}

/**
 * VR-064. A PDF that carries `/JavaScript`, `/OpenAction` or an embedded file is
 * refused outright rather than sanitised — sanitising a format this complex is a
 * losing arms race, and a KYC document has no legitimate reason to execute.
 *
 * SVG is not in the allow-list at all, for the same reason.
 */
export function pdfHasActiveContent(bytes: Uint8Array): boolean {
  // Only the first 512 KB: the catalog and any OpenAction live near the front,
  // and scanning a 5 MB buffer for every upload is wasted work.
  const window = bytes.subarray(0, Math.min(bytes.length, 512 * 1024));
  const text = Buffer.from(window).toString('latin1');
  return PDF_FORBIDDEN_TOKENS.some((token) => text.includes(token));
}

export function checkUpload(input: {
  bytes: Uint8Array;
  declaredMime: string;
  filename: string;
  /** Content-Length, if the client sent one. A lying header must not win. */
  declaredSize?: number;
}): UploadCheck {
  const { bytes, declaredMime, filename } = input;

  if (bytes.length === 0) {
    return { ok: false, rejection: 'EMPTY', message: 'That file is empty.' };
  }

  // Both the header and the real byte count are checked. The header is checked
  // first so a huge upload can be refused before it is buffered; the byte count
  // is checked because the header is a claim.
  if ((input.declaredSize ?? 0) > UPLOAD_MAX_BYTES || bytes.length > UPLOAD_MAX_BYTES) {
    return { ok: false, rejection: 'TOO_LARGE', message: UPLOAD_RULES.sizeMessage };
  }

  if (!UPLOAD_ALLOWED_MIME.includes(declaredMime as AllowedMime)) {
    return { ok: false, rejection: 'MIME_NOT_ALLOWED', message: UPLOAD_RULES.mimeMessage };
  }

  if (!UPLOAD_RULES.filenamePattern.test(filename)) {
    return { ok: false, rejection: 'BAD_FILENAME', message: UPLOAD_RULES.filenameMessage };
  }

  const sniffed = sniffMime(bytes);
  if (sniffed === null || sniffed !== declaredMime) {
    // The interesting case. A mismatch is quarantined and audit-logged by the
    // caller, not merely rejected — it is the shape of an attack, not a mistake.
    return {
      ok: false,
      rejection: 'MAGIC_MISMATCH',
      message: UPLOAD_RULES.magicMessage,
      sniffedMime: sniffed,
    };
  }

  if (sniffed === 'application/pdf' && pdfHasActiveContent(bytes)) {
    return {
      ok: false,
      rejection: 'ACTIVE_CONTENT',
      message: UPLOAD_RULES.activeContentMessage,
      sniffedMime: sniffed,
    };
  }

  return { ok: true, sniffedMime: sniffed };
}

/**
 * VR-067. Sanitise a filename to something safe to log and to put in a
 * Content-Disposition header. The stored object is keyed by a UUID regardless —
 * this is only for display and for the audit trail.
 */
export function sanitiseFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'file';
}

/**
 * VR-072. Only *some* document types are age-limited: a GST registration
 * certificate does not go stale, a bank statement does.
 *
 * Returns the message verbatim, with the actual date in it, because
 * "document rejected" is the failure this rule set exists to avoid.
 */
export function checkDocumentAge(input: {
  documentDate: Date | null;
  maxAgeDays: number | null;
  today: Date;
  formatDate?: (d: Date) => string;
}): { ok: boolean; message?: string } {
  const { documentDate, maxAgeDays, today } = input;
  const fmt =
    input.formatDate ??
    ((d: Date) =>
      d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));

  if (maxAgeDays === null) return { ok: true };
  if (!documentDate) {
    return {
      ok: false,
      message: 'Tell us the date on this document so we can check it is current.',
    };
  }

  if (documentDate.getTime() > today.getTime()) {
    return { ok: false, message: "The document date can't be in the future." };
  }

  const ageDays = Math.floor((today.getTime() - documentDate.getTime()) / 86_400_000);
  if (ageDays > maxAgeDays) {
    return {
      ok: false,
      message: `This document is dated ${fmt(documentDate)} — we need one issued in the last ${maxAgeDays} days.`,
    };
  }

  return { ok: true };
}
