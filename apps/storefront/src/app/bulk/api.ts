/**
 * The browser half of bulk requirement intake — `POST /api/buyer/requirements`,
 * through the same-origin `/api` rewrite so the `httpOnly` refresh cookie stays
 * first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `RfqIntakeService` (`apps/api/src/modules/ordering/internal/rfq-intake.service.ts`).
 * They are copied rather than imported because the storefront may not import the
 * API. Nothing in this file widens them, and nothing in them carries a vendor: a
 * matched requirement names a catalogue machine and a count, never a source.
 *
 * **Nothing on this path is ever shown to a supplier.** Under the
 * merchant-of-record model, sourcing against a requirement is our job, not a
 * bidding process — see the service header for why that distinction changes who
 * the seller is. This file talks to one endpoint and that endpoint writes an
 * internal lead; there is no vendor-facing arm to reach.
 */
import { call, type ApiResult } from '../register/api';

/* ==========================================================================
 * What the server accepts
 * ======================================================================== */

/**
 * The template's own header, and the canonical column set.
 *
 * `REQUIREMENT_COLUMNS`, the 2,000,000-character cap on the `csv` arm and the
 * 500-row cap on the `rows` arm all live in the API's own DTO file
 * (`apps/api/src/modules/ordering/dto/ordering.dto.ts`), which the storefront
 * cannot import. They are restated here and the duplication is reported rather
 * than hidden — they belong in `@trugrade/contracts` beside every other shared
 * constant, exactly as `CART_NAME_MAX` does.
 */
export const REQUIREMENT_COLUMNS = [
  'model',
  'quantity',
  'grade',
  'target_price',
  'delivery_pincode',
  'needed_by',
] as const;

/** The `csv` arm is `z.string().min(1).max(2_000_000)`. */
export const CSV_MAX_CHARS = 2_000_000;

/** The `rows` arm is `z.array(requirementRowSchema).min(1).max(500)`. */
export const FORM_MAX_ROWS = 500;

/** `A_PLUS` | `A` | `B`, as the grade enum spells it. Neutral: all three sell. */
export type Grade = 'A_PLUS' | 'A' | 'B';

/** One typed line. The same schema validates this and a parsed CSV cell. */
export interface RequirementRow {
  model: string;
  quantity: number;
  grade?: Grade;
  /** Decimal string. Money does not survive a round trip as a float. */
  targetPrice?: string;
  deliveryPincode: string;
  /** `YYYY-MM-DD`. `ordering.rfq.needed_by` is a DATE, so no zone is implied. */
  neededBy?: string;
}

/* ==========================================================================
 * What the server answers
 * ======================================================================== */

/** A requirement we can name a catalogue machine for. */
export interface MatchedRequirement {
  /** 1-based line in the buyer's own file, counting the header. */
  line: number;
  rfqId: string;
  /** `ordering.rfq.rfq_number` — the reference the sales desk quotes back. */
  reference: string;
  skuId: string;
  title: string;
  specSummary: string;
  qtyRequested: number;
  /**
   * Sellable units of this model right now, across every dispatch point and
   * every grade. The service is explicit that it counts across grades, so the
   * screen says so too rather than printing a bare figure.
   */
  unitsAvailableNow: number;
  grade: Grade | null;
  neededBy: string | null;
}

/** A requirement we could not put a catalogue machine against. This is the lead. */
export interface UnmatchedRequirement {
  line: number;
  model: string;
  quantity: number;
  grade: Grade | null;
  deliveryPincode: string;
  neededBy: string | null;
  /** The server's sentence. Rendered verbatim. */
  reason: string;
}

/** A row that did not validate. Reported, never guessed at and never dropped. */
export interface RejectedRow {
  line: number;
  /** Field name to what was wrong with it, straight from the row schema. */
  errors: Record<string, string>;
}

export interface RequirementIntakeResult {
  matched: MatchedRequirement[];
  unmatched: UnmatchedRequirement[];
  rejected: RejectedRow[];
  /**
   * The internal work item raised for the unmatched rows. `null` when everything
   * matched and there was nothing for the sales desk to pick up — which is a
   * different statement from "no reference yet" and is rendered as one.
   */
  salesLeadReference: string | null;
}

const post = (body: unknown): Promise<ApiResult<RequirementIntakeResult>> =>
  call<RequirementIntakeResult>('/api/buyer/requirements', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const submitCsv = (csv: string): Promise<ApiResult<RequirementIntakeResult>> => post({ csv });

export const submitRows = (
  rows: readonly RequirementRow[],
): Promise<ApiResult<RequirementIntakeResult>> => post({ rows });

/* ==========================================================================
 * Reading the file
 * ======================================================================== */

/**
 * What the first bytes of a file say it actually is.
 *
 * **The extension and the browser-supplied `type` are both attacker-controlled**
 * and neither is consulted: `accept` on the input is a convenience for the file
 * picker, not a check. A file named `.csv` that begins with the two bytes `PK`
 * is a zip, and handing two megabytes of compressed binary to a CSV parser
 * produces a wall of per-row nonsense instead of one sentence naming the real
 * problem.
 *
 * Every entry names the fix, because "unsupported file type" tells a procurement
 * head nothing they can act on.
 */
const SIGNATURES: ReadonlyArray<{ bytes: readonly number[]; reason: (name: string) => string }> = [
  {
    // XLSX, ODS, and every other OOXML container.
    bytes: [0x50, 0x4b, 0x03, 0x04],
    reason: (n) =>
      `${n} is an Excel workbook, not a CSV. Open it and choose File, Save As, CSV UTF-8 — then upload that file.`,
  },
  {
    // The pre-2007 OLE compound document: .xls, .doc.
    bytes: [0xd0, 0xcf, 0x11, 0xe0],
    reason: (n) =>
      `${n} is an older Excel workbook (.xls). Open it and choose File, Save As, CSV UTF-8 — then upload that file.`,
  },
  {
    bytes: [0x25, 0x50, 0x44, 0x46],
    reason: (n) =>
      `${n} is a PDF. We need the list as a spreadsheet — one machine per row, with a quantity and a delivery pincode.`,
  },
  {
    bytes: [0x89, 0x50, 0x4e, 0x47],
    reason: (n) => `${n} is a PNG image. A photograph of a list is not a list we can read.`,
  },
  {
    bytes: [0xff, 0xd8, 0xff],
    reason: (n) => `${n} is a JPEG image. A photograph of a list is not a list we can read.`,
  },
  {
    bytes: [0x47, 0x49, 0x46, 0x38],
    reason: (n) => `${n} is a GIF image. A photograph of a list is not a list we can read.`,
  },
  {
    bytes: [0x1f, 0x8b],
    reason: (n) => `${n} is a gzip archive. Unpack it and upload the CSV inside.`,
  },
  {
    bytes: [0x52, 0x61, 0x72, 0x21],
    reason: (n) => `${n} is a RAR archive. Unpack it and upload the CSV inside.`,
  },
  {
    bytes: [0x4d, 0x5a],
    reason: (n) => `${n} is a Windows program, not a spreadsheet. We have not opened it.`,
  },
  {
    bytes: [0x7f, 0x45, 0x4c, 0x46],
    reason: (n) => `${n} is a program, not a spreadsheet. We have not opened it.`,
  },
];

const startsWith = (head: Uint8Array, bytes: readonly number[]): boolean =>
  bytes.every((b, i) => head[i] === b);

/** The signature check. Exported so a test can attempt the forbidden thing. */
export function refuseByMagicBytes(name: string, head: Uint8Array): string | undefined {
  const hit = SIGNATURES.find((s) => startsWith(head, s.bytes));
  if (hit) return hit.reason(name);
  // No known signature, but a NUL byte in the first block means this is not text
  // in any encoding a spreadsheet writes.
  if (head.includes(0x00))
    return `${name} is not a text file — it carries binary data. Save the list as CSV UTF-8 and upload that.`;
  return undefined;
}

export type FileRead =
  | { ok: true; text: string }
  /** Names the file and says why. Never "invalid file". */
  | { ok: false; reason: string };

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * One file, checked and decoded.
 *
 * Read once as bytes: the signature check and the decode need the same buffer,
 * and `File.text()` would turn binary into replacement characters before
 * anything got a chance to look at it.
 *
 * `TextDecoder(..., { fatal: true })` is the second half of the check. A
 * spreadsheet saved as "CSV" rather than "CSV UTF-8" is cp1252, and a rupee sign
 * or an accented name in it is invalid UTF-8 — which happens to real files, so
 * it gets its own sentence and its own fix rather than arriving at the parser as
 * mojibake.
 *
 * **This is not the trust boundary.** The server takes a string, caps it, and
 * reports every row it could not read; nothing here decides what is acceptable.
 * It exists so that the person holding the file gets one sentence about the file
 * instead of two hundred about its rows.
 */
export function readRequirementFile(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<FileRead> {
  if (file.size === 0)
    return Promise.resolve({ ok: false, reason: `${file.name} is empty — it has no bytes in it.` });

  if (file.size > MAX_BYTES)
    return Promise.resolve({
      ok: false,
      reason: `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. We can read a requirement list up to 2.0 MB — split it and upload the halves.`,
    });

  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    reader.onerror = () =>
      resolve({
        ok: false,
        reason: `We could not read ${file.name} from your device. Nothing was sent — try choosing it again.`,
      });

    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      const refusal = refuseByMagicBytes(file.name, bytes.subarray(0, 512));
      if (refusal) {
        resolve({ ok: false, reason: refusal });
        return;
      }

      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        resolve({
          ok: false,
          reason: `${file.name} is not UTF-8 text, so some characters in it would arrive wrong. In Excel choose File, Save As, CSV UTF-8 — then upload that file.`,
        });
        return;
      }

      if (text.length > CSV_MAX_CHARS) {
        resolve({
          ok: false,
          reason: `${file.name} holds more characters than we accept in one list. Split it and upload the halves.`,
        });
        return;
      }

      onProgress?.(100);
      resolve({ ok: true, text });
    };

    reader.readAsArrayBuffer(file);
  });
}
