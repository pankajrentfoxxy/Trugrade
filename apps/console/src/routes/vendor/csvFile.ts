/**
 * What a file actually is, and whether it is small enough to upload.
 *
 * Both checks run in the browser, before a byte is sent, because the browser is
 * the only place the BYTES exist — by the time the API sees the upload it is a
 * decoded string, and a zip decoded as UTF-8 is still a string. (The API refuses
 * that too, in `SerialService.looksBinary`; this is the half that can name the
 * file and tell somebody how to fix it.)
 *
 * **The extension and the browser-supplied MIME type are both worthless here.**
 * `accept=".csv"` on the input is a convenience for the file picker, not a
 * check, and every operating system will happily rename `stock.xlsx` to
 * `stock.csv`. A file named `.csv` that begins with the two bytes `PK` is a zip,
 * and handing two megabytes of compressed binary to a CSV parser produces four
 * thousand rows of per-row nonsense instead of one sentence naming the real
 * problem. **A file that is silently misread is worse than one that is refused.**
 *
 * ponytail: this signature table is a second copy of the one in the storefront's
 * bulk-requirement upload (`apps/storefront/src/app/bulk/api.ts`). The two apps
 * cannot import from each other and the shared home is `packages/contracts`,
 * which another session owns this week. Promote it there when a third caller
 * appears; reported as a gap rather than forked silently.
 */

/** VR-080 caps a listing at 5,000 units, so one upload cannot carry more. */
export const MAX_ROWS = 5000;
/** The spec's ceiling. 5,000 serials is ~60 KB, so this is generous by design. */
export const MAX_BYTES = 10 * 1024 * 1024;

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
      `${n} is a PDF. We need one serial number per row, as a spreadsheet saved to CSV.`,
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

/**
 * Read a file, or say why we will not.
 *
 * Size first, because reading a 400 MB file to discover it is too big is the
 * one failure that takes the tab down with it. Then the signature, off the first
 * 8 bytes rather than the whole file. Only then is any of it decoded.
 */
export async function readCsvFile(file: File): Promise<{ csv: string } | { refusal: string }> {
  if (file.size > MAX_BYTES) {
    return {
      refusal: `${file.name} is ${Math.round(file.size / 1024 / 1024)} MB and the limit is ${MAX_BYTES / 1024 / 1024} MB. A list of ${MAX_ROWS} serial numbers is well under 100 KB, so this is almost certainly a workbook with formatting in it — save it as CSV UTF-8.`,
    };
  }
  if (file.size === 0) {
    return { refusal: `${file.name} is empty. Nothing has been read.` };
  }

  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const refusal = refuseByMagicBytes(file.name, head);
  if (refusal) return { refusal };

  return { csv: await file.text() };
}
