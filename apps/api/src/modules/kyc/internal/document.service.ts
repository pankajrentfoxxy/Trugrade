import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  checkUpload,
  checkDocumentAge,
  sanitiseFilename,
  UPLOAD_ALLOWED_MIME,
  UPLOAD_MAX_BYTES,
  UPLOAD_RULES,
  type AllowedMime,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ObjectStorePort } from '../../../shared/adapters/ports';
import { AuditService } from '../../identity';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/domain-errors';

/**
 * KYC document upload. VR-061 to VR-072.
 *
 * Every rule here is about bytes an applicant chose, so the whole file is
 * written from one assumption: **the client is lying about the file.** The
 * extension, the `Content-Type` header and the `Content-Length` are all filled
 * in by a browser from what it was handed, and all three are trivially forged.
 * Only the bytes we hold are evidence — so `checkUpload` sniffs the leading
 * bytes, the SHA-256 is computed over what was actually stored, and `size_bytes`
 * is `bytes.length` rather than a header.
 *
 * Three things this service does NOT do, and why:
 *
 *   - **It never derives an org id.** Its callers pass one taken from the
 *     session. A parameter is only a parameter, so every query below carries
 *     `org_id` in its WHERE clause rather than trusting the id to have been
 *     checked upstream.
 *   - **It does not decide which documents a flow needs.** That is
 *     `kyc.document_type_rule`, which is data precisely so ops can add a
 *     document type without a release.
 *   - **It does not scan for viruses.** `av_scanned_at` / `av_verdict` are on the
 *     table for when a scanner exists; leaving them NULL is the honest state and
 *     is what lets a review screen show "not scanned" rather than a tick.
 */

/** What a caller may see. Built field by field: `file_key` and the hash are ours. */
export interface KycDocumentView {
  id: string;
  docType: string;
  /** From `document_type_rule`, so two screens cannot spell it differently. */
  label: string;
  originalFilename: string | null;
  mime: string;
  sizeBytes: number;
  status: string;
  documentDate: string | null;
  /**
   * When the EXIF/XMP strip ran. NULL for a PDF, which has no EXIF — and NULL
   * rather than a convenient timestamp, because a missing value must never
   * render as a passing one.
   */
  exifStrippedAt: string | null;
  /** NULL until a scanner exists. See the note above. */
  avVerdict: string | null;
  rejectionReason: string | null;
  reviewNote: string | null;
  expiresOn: string | null;
  uploadedAt: string;
}

/** The checklist a registration step renders. Straight from the rule table. */
export interface DocumentTypeRuleView {
  docType: string;
  label: string;
  /** NULL means the document does not go stale — a GST certificate never does. */
  maxAgeDays: number | null;
  requiresExpiry: boolean;
  maxFiles: number;
  maxBytes: number;
  acceptedMime: readonly string[];
}

export interface UploadedBytes {
  bytes: Buffer;
  /** What the client claimed. Used only to detect a contradiction with the bytes. */
  declaredMime: string;
  filename: string;
  /** `Content-Length`, if sent. A lying header must not win, so it only adds a check. */
  declaredSize?: number;
}

interface DocumentRow {
  id: string;
  doc_type: string;
  original_filename: string | null;
  mime: string;
  size_bytes: bigint;
  status: string;
  document_date: Date | null;
  exif_stripped_at: Date | null;
  av_verdict: string | null;
  rejection_reason: string | null;
  review_note: string | null;
  expires_on: Date | null;
  created_at: Date;
}

/** A document a reviewer has already ruled on is evidence, not a draft. */
/**
 * Why a reviewer may refuse a document. Closed list, and it is the API's, not a
 * screen's.
 *
 * 03_UX_SPEC.md §3C.1: "Rejecting a document **requires** choosing a reason from
 * a controlled list and adds a free-text specific: the buyer/vendor sees exactly
 * that text." The list is served to the console from `GET
 * /api/kyc/document-rejection-reasons` for the same reason the upload rules are
 * — a second copy of these sentences on the client is the copy that drifts, and
 * these particular sentences are read by the applicant.
 *
 * Each `sentence` is a whole sentence rather than a label, because it is
 * prefixed to the reviewer's own specific and the two are read as one paragraph.
 */
export const DOCUMENT_REJECTION_REASONS = [
  { code: 'ILLEGIBLE', sentence: 'We could not read this document.' },
  { code: 'WRONG_DOCUMENT', sentence: 'This is not the document we asked for.' },
  { code: 'INCOMPLETE', sentence: 'Part of this document is missing or cut off.' },
  { code: 'EXPIRED', sentence: 'This document has expired.' },
  { code: 'TOO_OLD', sentence: 'This document is older than we can accept.' },
  {
    code: 'NAME_MISMATCH',
    sentence: 'The name on this document does not match the business name you registered.',
  },
  { code: 'ALTERED', sentence: 'This document appears to have been edited after it was issued.' },
] as const;

export type DocumentRejectionReason = (typeof DOCUMENT_REJECTION_REASONS)[number]['code'];

const SETTLED_STATUSES = ['VERIFIED', 'UNDER_REVIEW'];

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly store: ObjectStorePort,
    private readonly audit: AuditService,
  ) {}

  /** The whole rule table. Fourteen rows, and the registration steps render from it. */
  async types(): Promise<DocumentTypeRuleView[]> {
    const rules = await this.prisma.db.document_type_rule.findMany({
      orderBy: { doc_type: 'asc' },
    });
    return rules.map((r) => ({
      docType: r.doc_type,
      label: r.label,
      maxAgeDays: r.max_age_days,
      requiresExpiry: r.requires_expiry,
      maxFiles: r.max_files,
      // The caps ride along with the list so the client renders OUR numbers
      // rather than its own copy of "5 MB", which is the copy that drifts.
      maxBytes: UPLOAD_MAX_BYTES,
      acceptedMime: UPLOAD_ALLOWED_MIME,
    }));
  }

  async list(orgId: string): Promise<KycDocumentView[]> {
    const [rows, labels] = await Promise.all([
      this.prisma.db.kyc_document.findMany({
        where: { org_id: orgId },
        orderBy: { created_at: 'desc' },
      }),
      this.labels(),
    ]);
    return rows.map((r) => toView(r, labels));
  }

  /**
   * Store one file against the caller's own org.
   *
   * The checks run in order of increasing cost, and the age check sits before
   * the object store deliberately: refusing a three-month-old utility bill after
   * uploading it is a refusal that already cost us the bytes.
   */
  async upload(input: {
    orgId: string;
    uploadedBy: string;
    docType: string;
    documentDate: Date | null;
    file: UploadedBytes;
  }): Promise<KycDocumentView> {
    const rule = await this.rule(input.docType);
    const filename = sanitiseFilename(input.file.filename);

    const mime = this.acceptBytes(input.file, filename);
    this.acceptAge(input.documentDate, rule);
    await this.assertRoomFor(input.orgId, rule);

    const stored = await this.putBytes(input.orgId, input.docType, input.file, mime);

    const row = await this.prisma.db.kyc_document.create({
      data: {
        org_id: input.orgId,
        doc_type: input.docType,
        file_key: stored.key,
        file_hash_sha256: stored.hash,
        mime,
        // The real byte count, never the declared one — and `chk_document_size`
        // checks it a second time at the database, where no new code path can
        // get past it.
        size_bytes: BigInt(stored.bytes.length),
        document_date: input.documentDate,
        original_filename: filename,
        exif_stripped_at: stored.exifStrippedAt,
        uploaded_by: input.uploadedBy,
      },
    });

    await this.audit.record({
      action: 'kyc.document.uploaded',
      entityType: 'kyc_document',
      entityId: row.id,
      after: { docType: input.docType, filename, mime, sha256: stored.hash },
      actorUserId: input.uploadedBy,
      actorOrgId: input.orgId,
    });

    return toView(row, await this.labels());
  }

  /**
   * Replace the bytes behind an existing document, keeping its id.
   *
   * Keeping the id matters: whatever already references this document — a credit
   * application's bank statement, a vendor certification — goes on pointing at
   * the right thing, which a delete-then-upload would silently break.
   */
  async replace(input: {
    orgId: string;
    uploadedBy: string;
    documentId: string;
    documentDate: Date | null;
    file: UploadedBytes;
  }): Promise<KycDocumentView> {
    const existing = await this.own(input.orgId, input.documentId);
    this.assertNotSettled(existing, 'replace');

    const rule = await this.rule(existing.doc_type);
    const filename = sanitiseFilename(input.file.filename);

    const mime = this.acceptBytes(input.file, filename);
    this.acceptAge(input.documentDate, rule);

    const stored = await this.putBytes(input.orgId, existing.doc_type, input.file, mime);

    const row = await this.prisma.db.kyc_document.update({
      where: { id: existing.id },
      data: {
        file_key: stored.key,
        file_hash_sha256: stored.hash,
        mime,
        size_bytes: BigInt(stored.bytes.length),
        document_date: input.documentDate,
        original_filename: filename,
        exif_stripped_at: stored.exifStrippedAt,
        uploaded_by: input.uploadedBy,
        // A replacement answers whatever the rejection said, so the note goes
        // with it. Leaving it would show the applicant a complaint about a file
        // that is no longer there.
        status: 'UPLOADED',
        rejection_reason: null,
        review_note: null,
      },
    });

    // After the row is committed, and best-effort: an orphaned object costs
    // pennies, whereas deleting first and then failing the update loses the
    // document outright.
    if (stored.key !== existing.file_key) {
      await this.store.delete(existing.file_key).catch(() => undefined);
    }

    await this.audit.record({
      action: 'kyc.document.replaced',
      entityType: 'kyc_document',
      entityId: row.id,
      before: { sha256: existing.file_hash_sha256, filename: existing.original_filename },
      after: { sha256: stored.hash, filename },
      actorUserId: input.uploadedBy,
      actorOrgId: input.orgId,
    });

    return toView(row, await this.labels());
  }

  /**
   * A reviewer's verdict on one document.
   *
   * **The rejection sentence is built from a controlled reason plus the
   * reviewer's own specific, and the applicant reads the whole of it verbatim.**
   * That is the difference between "Address proof rejected" — which sends
   * somebody back to a form with no idea what to change — and "This document is
   * older than we can accept. Your electricity bill is dated Jan 2025; we need
   * one from the last three months." The controlled half keeps the categories
   * countable; the free half is the only part that tells the applicant what to
   * do. Neither is optional, which is why both are required here rather than
   * validated on the screen alone.
   *
   * Not org-scoped through `own()` with the caller's org: the caller is platform
   * staff and has no org of their own. The org id comes from the path and is
   * checked against the row, so a document id from another application cannot be
   * settled by pointing this route at the wrong org.
   */
  async review(input: {
    orgId: string;
    documentId: string;
    decision: 'VERIFIED' | 'REJECTED';
    /** One of `DOCUMENT_REJECTION_REASONS`. Required for a rejection. */
    reasonCode?: string;
    /** The reviewer's own sentence about THIS file. Required for a rejection. */
    specific?: string;
    reviewerId: string;
  }): Promise<KycDocumentView> {
    const existing = await this.own(input.orgId, input.documentId);

    let rejectionReason: string | null = null;
    if (input.decision === 'REJECTED') {
      const reason = DOCUMENT_REJECTION_REASONS.find((r) => r.code === input.reasonCode);
      if (!reason) {
        throw new ValidationError(
          'Choose why this document is being rejected. The applicant is shown the reason you pick.',
          { reasonCode: 'Choose one of the listed reasons.' },
        );
      }
      const specific = input.specific?.trim() ?? '';
      if (specific.length < 10) {
        throw new ValidationError(
          'Say what is wrong with this particular file. "Rejected" on its own tells the applicant nothing they can act on.',
          {
            specific:
              'Name what you saw and what you need instead — for example "dated Jan 2025; we need one from the last three months".',
          },
        );
      }
      rejectionReason = `${reason.sentence} ${specific}`;
    }

    const row = await this.prisma.db.kyc_document.update({
      where: { id: existing.id },
      data: {
        status: input.decision,
        rejection_reason: rejectionReason,
        // The code, not the sentence: the sentence is already in
        // `rejection_reason` and a second copy of it is the copy that drifts.
        review_note: input.decision === 'REJECTED' ? (input.reasonCode ?? null) : null,
        reviewed_by: input.reviewerId,
      },
    });

    await this.audit.record({
      action: `kyc.document.${input.decision.toLowerCase()}`,
      entityType: 'kyc_document',
      entityId: existing.id,
      before: { status: existing.status, rejectionReason: existing.rejection_reason },
      after: { status: input.decision, rejectionReason },
      actorUserId: input.reviewerId,
      actorOrgId: input.orgId,
    });

    return toView(row, await this.labels());
  }

  async remove(orgId: string, documentId: string, actorUserId: string): Promise<void> {
    const existing = await this.own(orgId, documentId);
    this.assertNotSettled(existing, 'remove');

    await this.prisma.db.kyc_document.delete({ where: { id: existing.id } });
    await this.store.delete(existing.file_key).catch(() => undefined);

    await this.audit.record({
      action: 'kyc.document.deleted',
      entityType: 'kyc_document',
      entityId: existing.id,
      before: { docType: existing.doc_type, filename: existing.original_filename },
      actorUserId,
      actorOrgId: orgId,
    });
  }

  /** A short-lived link, so the applicant can check what they actually sent us. */
  async downloadUrl(
    orgId: string,
    documentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const existing = await this.own(orgId, documentId);
    return {
      url: await this.store.presignDownload(existing.file_key, UPLOAD_RULES.signedUrlTtlSeconds),
      expiresInSeconds: UPLOAD_RULES.signedUrlTtlSeconds,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The byte-level verdict, and the message a person reads when it is no.
   *
   * The filename is in the message because the screen shows one row per file:
   * "that file was refused" in a list of six is a message nobody can act on.
   */
  private acceptBytes(file: UploadedBytes, filename: string): AllowedMime {
    const check = checkUpload({
      bytes: file.bytes,
      declaredMime: file.declaredMime,
      filename,
      ...(file.declaredSize === undefined ? {} : { declaredSize: file.declaredSize }),
    });
    if (!check.ok || !check.sniffedMime) {
      const why = check.message ?? 'That file was refused.';
      throw new ValidationError(`${filename}: ${why}`, { [filename]: why });
    }
    return check.sniffedMime;
  }

  /** VR-072. `checkDocumentAge` writes the sentence, with the real date in it. */
  private acceptAge(
    documentDate: Date | null,
    rule: { label: string; max_age_days: number | null },
  ): void {
    const age = checkDocumentAge({
      documentDate,
      maxAgeDays: rule.max_age_days,
      today: this.clock.now(),
    });
    if (age.ok) return;
    const why = age.message ?? 'We need a more recent copy of this document.';
    throw new ValidationError(`${rule.label}: ${why}`, { documentDate: why });
  }

  /**
   * **The org boundary, and the only place it is drawn.**
   *
   * `org_id` is in the WHERE clause rather than compared after the read, so a
   * document belonging to somebody else is indistinguishable from one that does
   * not exist — which is the right answer both for the applicant and for anyone
   * walking uuids to find out which ones are real.
   */
  private async own(orgId: string, documentId: string) {
    const row = await this.prisma.db.kyc_document.findFirst({
      where: { id: documentId, org_id: orgId },
    });
    if (!row) throw new NotFoundError('document');
    return row;
  }

  private assertNotSettled(row: { status: string; doc_type: string }, verb: string): void {
    if (!SETTLED_STATUSES.includes(row.status)) return;
    throw new ConflictError(
      row.status === 'VERIFIED'
        ? 'A reviewer has already verified this document, so it cannot be changed. Ask support to reopen it if the details have moved on.'
        : 'A reviewer is looking at this document right now. You can change it once they have finished.',
      { reason: `document_${verb}_after_review`, docType: row.doc_type, status: row.status },
    );
  }

  private async rule(docType: string) {
    const rule = await this.prisma.db.document_type_rule.findUnique({
      where: { doc_type: docType },
    });
    if (!rule) {
      throw new ValidationError(
        `We do not have a document type called "${docType}". Pick one from the list of documents this step asks for.`,
        { docType: 'Unknown document type.' },
      );
    }
    return rule;
  }

  /**
   * VR-069/VR-070. A rejected file does not count towards the cap — the whole
   * point of a rejection is that the applicant sends another one.
   */
  private async assertRoomFor(
    orgId: string,
    rule: { doc_type: string; label: string; max_files: number },
  ): Promise<void> {
    const [ofType, total] = await Promise.all([
      this.prisma.db.kyc_document.count({
        where: { org_id: orgId, doc_type: rule.doc_type, status: { not: 'REJECTED' } },
      }),
      this.prisma.db.kyc_document.count({
        where: { org_id: orgId, status: { not: 'REJECTED' } },
      }),
    ]);

    if (ofType >= rule.max_files) {
      throw new ConflictError(
        `You have already uploaded ${ofType} ${rule.label} ${ofType === 1 ? 'file' : 'files'}, which is the most we accept. Delete one before adding another.`,
        { reason: 'max_files_per_type', docType: rule.doc_type },
      );
    }
    if (total >= UPLOAD_RULES.maxFilesPerOnboarding) {
      throw new ConflictError(
        `This application already has ${total} documents, which is the most we accept. Delete one before adding another.`,
        { reason: 'max_files_per_onboarding' },
      );
    }
  }

  /**
   * Strip, hash, store — in that order, because the hash has to describe what is
   * actually in the bucket. Hashing before the strip would put a digest in the
   * audit trail that matches no file anybody can fetch.
   *
   * The key is the content hash, so re-uploading the same bytes overwrites one
   * object instead of accumulating them and a retry after a dropped connection
   * costs nothing.
   */
  private async putBytes(
    orgId: string,
    docType: string,
    file: UploadedBytes,
    mime: AllowedMime,
  ): Promise<{ key: string; hash: string; bytes: Buffer; exifStrippedAt: Date | null }> {
    const stripped = stripImageMetadata(file.bytes, mime);
    const bytes = stripped ?? file.bytes;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const key = `kyc/${orgId}/${docType}/${hash}.${EXTENSION[mime]}`;

    await this.store.put(key, bytes, mime);
    return { key, hash, bytes, exifStrippedAt: stripped === null ? null : this.clock.now() };
  }

  private async labels(): Promise<Map<string, string>> {
    const rules = await this.prisma.db.document_type_rule.findMany();
    return new Map(rules.map((r) => [r.doc_type, r.label]));
  }
}

// ---------------------------------------------------------------------------
// Wire shaping
// ---------------------------------------------------------------------------

const EXTENSION: Record<AllowedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** `size_bytes` is BIGINT, and `JSON.stringify` throws on a bigint. It converts here. */
function toView(row: DocumentRow, labels: Map<string, string>): KycDocumentView {
  return {
    id: row.id,
    docType: row.doc_type,
    label: labels.get(row.doc_type) ?? row.doc_type,
    originalFilename: row.original_filename,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes),
    status: row.status,
    documentDate: row.document_date ? isoDate(row.document_date) : null,
    exifStrippedAt: row.exif_stripped_at?.toISOString() ?? null,
    avVerdict: row.av_verdict,
    rejectionReason: row.rejection_reason,
    reviewNote: row.review_note,
    expiresOn: row.expires_on ? isoDate(row.expires_on) : null,
    uploadedAt: row.created_at.toISOString(),
  };
}

/** A DATE column, so it goes on the wire as a date rather than a midnight-UTC instant. */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// EXIF / XMP removal
// ---------------------------------------------------------------------------

/**
 * VR-066. Strip the metadata blocks out of an image.
 *
 * **A photograph of a GST certificate taken on a phone carries the GPS
 * coordinates of the room it was taken in**, plus the device serial and often
 * the owner's name. We show these files to reviewers and keep them for seven
 * years; none of that is anything we asked for or want to hold.
 *
 * A byte walk rather than an image library, because that is genuinely all it
 * takes: metadata lives in discrete, self-describing containers in all three
 * formats, and dropping a container needs no decoder. Re-encoding through a
 * library would also be lossy, which is the wrong thing to do to a document
 * somebody has to read.
 *
 * Returns `null` for a format with no metadata container (PDF), which is what
 * leaves `exif_stripped_at` NULL rather than stamping a strip that never ran.
 * A malformed file returns its bytes unchanged — `checkUpload` has already
 * agreed the magic bytes are right, and a parser that gives up mid-file must
 * hand back what it was given rather than a truncation.
 */
export function stripImageMetadata(bytes: Buffer, mime: AllowedMime): Buffer | null {
  if (mime === 'image/jpeg') return stripJpeg(bytes);
  if (mime === 'image/png') return stripPng(bytes);
  if (mime === 'image/webp') return stripWebp(bytes);
  return null;
}

/**
 * APP1 carries both EXIF and XMP, APP13 carries the Photoshop/IPTC block, and
 * COM is a free-text comment. Every other APPn is left alone on purpose: APP0 is
 * the JFIF density header and APP14 tells a decoder whether a three-channel
 * image is YCbCr or RGB, and dropping either changes how the file renders.
 */
function stripJpeg(bytes: Buffer): Buffer {
  const DROP = new Set([0xe1, 0xed, 0xfe]);
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let i = 2;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1] as number;

    // Standalone markers carry no length word.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      kept.push(bytes.subarray(i, i + 2));
      i += 2;
      continue;
    }
    // Start of scan: the entropy-coded data runs to the end of the file.
    if (marker === 0xda) {
      kept.push(bytes.subarray(i));
      return Buffer.concat(kept);
    }

    const length = bytes.readUInt16BE(i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) return bytes;
    if (!DROP.has(marker)) kept.push(bytes.subarray(i, end));
    i = end;
  }
  return Buffer.concat(kept);
}

/** Ancillary text and timestamp chunks. Everything critical to the image survives. */
function stripPng(bytes: Buffer): Buffer {
  const DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let i = 8;

  while (i + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(i);
    const type = bytes.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + length;
    if (end > bytes.length) return bytes;
    if (!DROP.has(type)) kept.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(kept);
}

/**
 * RIFF chunks, little-endian, each padded to an even length.
 *
 * The VP8X flag byte is cleared alongside rather than left behind: it advertises
 * which optional chunks the file contains, and a file still claiming an EXIF
 * chunk that is no longer there is one a strict decoder is entitled to reject.
 */
function stripWebp(bytes: Buffer): Buffer {
  if (bytes.length < 12) return bytes;
  const DROP = new Set(['EXIF', 'XMP ']);
  const kept: Buffer[] = [];
  let dropped = false;
  let i = 12;

  while (i + 8 <= bytes.length) {
    const fourcc = bytes.subarray(i, i + 4).toString('latin1');
    const size = bytes.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > bytes.length) return bytes;

    if (DROP.has(fourcc)) {
      dropped = true;
    } else {
      const chunk = Buffer.from(bytes.subarray(i, end));
      // VP8X: 4 bytes of flags then 6 of canvas size. Bit 3 is EXIF, bit 2 XMP.
      if (fourcc === 'VP8X' && size >= 4) chunk[8] = (chunk[8] as number) & ~0x0c;
      kept.push(chunk);
    }
    i = end;
  }
  if (!dropped) return bytes;

  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}
