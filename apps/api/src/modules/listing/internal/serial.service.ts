import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  LISTING_QTY,
  isBlankCsvRow,
  parseCsv,
  splitSerialBlock,
  validateSerialBatch,
  type SerialBatch,
  type SerialIssue,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ListingRepository } from './listing.repository';

/**
 * Serial validation, with the two checks that need a database.
 *
 * The rules themselves live in `@trugrade/contracts` as a pure function, so the
 * wizard can run them on every keystroke without a round trip and the server
 * runs the identical constant (VR-META-01). This service adds only what a pure
 * function cannot know:
 *
 *   - **Global uniqueness** against `uq_unit_active_serial`, across every vendor
 *     nationwide, so the vendor sees "already listed" while typing rather than
 *     after submitting fifty machines.
 *   - **The blacklist**, `kyc.blacklist_entry` on `entity_type = 'SERIAL'`. A
 *     stolen-laptop claim against a machine we sold is a criminal matter, not a
 *     refund.
 *
 * They are two separate queries against two schemas, combined here in
 * TypeScript, because `listing` and `kyc` are different modules and a JOIN
 * across them would break the seam the whole architecture rests on
 * (`no-cross-schema-join`).
 */

/** `kyc.blacklist_entry` stores hashes, never values. */
const BLACKLIST_ENTITY_TYPE = 'SERIAL';

export interface SerialCsvRow {
  /** The line number in the vendor's own file, so they can find it. */
  lineNumber: number;
  serial: string;
  outcome: 'WILL_ADD' | 'WARN' | 'ERROR';
  reason?: string;
}

/**
 * What a file will do, before it does it.
 *
 * **The invariant this whole type exists for: `willAdd + errors === rows.length`,
 * and `willAdd` is the number the commit will actually insert.** It used to be
 * the count of `WILL_ADD` rows only, with `warnings` a third bucket beside it —
 * so a file with 28 warned rows was announced as "412 of 440 rows will be added"
 * while the commit was handed 440 and inserted 440. The screen printed one
 * number and the button printed another, and neither was wrong about anything
 * except what the other one meant. A warned row is an ACCEPTED row: an
 * unrecognised brand shape is a worn label, and the whole point of it being a
 * warning is that it does not stop the machine going in.
 *
 * `warnings` is therefore a subset of `willAdd`, not a sibling of it.
 */
export interface SerialCsvReport {
  rows: SerialCsvRow[];
  /** What the commit will insert. `WILL_ADD` + `WARN`. */
  willAdd: number;
  /** **Of `willAdd`**, how many carry a warning. Never a separate outcome. */
  warnings: number;
  errors: number;
  /** Problems with the file itself rather than with any one row. */
  fileErrors: string[];
  /** The verdicts, keyed by position in the file. Nothing has been written. */
  batch: SerialBatch;
}

/**
 * What the dry run needs to know about the listing it is a dry run FOR.
 *
 * A dry run that does not know its destination cannot promise what the commit
 * will do, and this one did not: `ListingService.addUnits` refuses a listing
 * that is not a DRAFT and refuses a batch that would take it past
 * `LISTING_QTY.max`, **rejecting the entire file in both cases** — while the
 * report cheerfully said 412 rows would be added. Two whole-file refusals the
 * vendor met only after committing.
 */
export interface SerialCsvTarget {
  brandName?: string | null;
  /**
   * How many more machines this listing can take: `LISTING_QTY.max - qty_total`.
   * Rows past it are ERRORs naming the cap, so the promised count stays the
   * count that results rather than becoming zero at the commit.
   */
  capacityLeft?: number;
  /**
   * Why this listing cannot take units at all, in the vendor's words. A
   * file-level refusal, because there is no row-by-row action to take.
   */
  blocked?: string;
}

/** The template header. This constant IS the download, so the two cannot drift. */
export const SERIAL_CSV_COLUMN = 'serial_number';

/** VR-080 caps a listing at 5,000 units, so a file above it cannot be committed. */
export const SERIAL_CSV_MAX_ROWS = 5000;

/** The template the screen offers. One column and one example, nothing to map. */
export function serialCsvTemplate(): string {
  return `${SERIAL_CSV_COLUMN}
7XKQ1P3
8LMR2Q4
`;
}

/**
 * Is this decoded text, or a binary file that was decoded anyway?
 *
 * The magic-byte check happens in the browser, where the BYTES are — by the
 * time a file reaches this service it is a string, and a zip run through UTF-8
 * decoding is a string. It is a string full of NULs and replacement characters,
 * which is a thing no spreadsheet ever wrote, so the server can still refuse it
 * rather than handing 2 MB of decoded nonsense to a CSV parser and reporting
 * four thousand malformed serials. One sentence naming the real problem beats a
 * per-row wall of them, and the API is the trust boundary — a client that is not
 * our screen gets the same refusal.
 */
function looksBinary(csv: string): boolean {
  const head = csv.slice(0, 4096);
  if (head.includes('\u0000')) return true;
  // ponytail: a ratio, not a parser. U+FFFD is what a decoder emits for bytes it
  // could not read; one is a stray character in a model name, fifty is a zip.
  const replacements = (head.match(/\uFFFD/g) ?? []).length;
  return replacements > Math.max(4, head.length * 0.01);
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

@Injectable()
export class SerialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly listings: ListingRepository,
  ) {}

  /**
   * Validate a batch and return a verdict per serial.
   *
   * `validateSerialBatch` runs twice, and deliberately. It is pure — the caller
   * supplies the live and blacklisted sets — so the first pass is what tells us
   * the normalised, de-duplicated serials worth asking the database about, and
   * the second folds the answers back in at the right line numbers. Normalising
   * separately here to save the first pass would put a second implementation of
   * "what a serial looks like" in the codebase, which is the divergence the
   * shared function exists to prevent.
   */
  async validate(serials: readonly string[], brandName?: string | null): Promise<SerialBatch> {
    const firstPass = validateSerialBatch({ serials, brandName });
    const candidates = firstPass.accepted;

    const [alreadyLive, blacklisted] = await Promise.all([
      this.listings.findLiveSerials(candidates),
      this.blacklisted(candidates),
    ]);

    return validateSerialBatch({ serials, brandName, alreadyLive, blacklisted });
  }

  /** The pasted-block path: one per line, or whatever a spreadsheet produced. */
  validateBlock(text: string, brandName?: string | null): Promise<SerialBatch> {
    return this.validate(splitSerialBlock(text), brandName);
  }

  /**
   * The CSV path: **it writes nothing, reports every row, and the counts it
   * promises are the counts the commit produces.**
   *
   * Line numbers are the line numbers in the vendor's own file. `parseCsv`
   * deliberately returns blank rows rather than filtering them, because every
   * caller numbers rows by position and dropping one silently shifts every
   * number after it — a vendor told "line 47" looks at line 47, corrects a line
   * that was fine, and the real problem stays. Blanks are skipped HERE, with the
   * file line each surviving row came from carried alongside it.
   *
   * The three whole-file refusals below all exist because the commit has them
   * and the report did not: a listing that is not a DRAFT, a batch that would
   * take the listing past its cap, and a file with more rows than one request
   * may carry. Each of those rejects the ENTIRE upload at commit time, so
   * reporting 412 happy rows first is not an optimistic estimate — it is a
   * promise that is about to be broken in full.
   */
  async dryRunCsv(csv: string, target: SerialCsvTarget = {}): Promise<SerialCsvReport> {
    const refuse = (...fileErrors: string[]): SerialCsvReport => ({
      rows: [],
      willAdd: 0,
      warnings: 0,
      errors: 0,
      fileErrors,
      batch: { accepted: [], errors: [], warnings: [] },
    });

    // Before anything is parsed: there is no point telling somebody which rows
    // are good when none of them can be written.
    if (target.blocked) return refuse(target.blocked);
    if (looksBinary(csv)) {
      return refuse(
        'This is not a text file — it carries binary data. If it came out of Excel, open it and choose File, Save As, CSV UTF-8, then upload that.',
      );
    }

    const grid = parseCsv(csv);
    if (grid.length === 0) return refuse('The file is empty.');

    const header = grid[0]!.map((h) => h.trim().toLowerCase());
    // Forgiving on the header word, strict on everything after it: "serial",
    // "serials", "Serial No" and the template's own name all mean the same
    // column, and a vendor should not have to edit a file to say so.
    const column = header.findIndex((h) => /^serials?[ _]?(no|number)?$/.test(h));
    // A one-column export out of a warehouse tool has no header at all, and
    // rejecting it would send the vendor to a text editor to add a word. If the
    // first row is not a header, it is a serial like every other row.
    const hasHeader = column >= 0;
    const index = hasHeader ? column : 0;

    if (!hasHeader && grid[0]!.length > 1) {
      return refuse(
        `This file has several columns and none of them is called "${SERIAL_CSV_COLUMN}". Rename the column holding the serial numbers, or upload a file with just that one column.`,
      );
    }

    // Blank rows are dropped HERE, not by the parser, and the file line each
    // surviving row came from is carried with it.
    const dataRows = (hasHeader ? grid.slice(1) : grid)
      .map((row, i) => ({ row, fileLine: i + 1 }))
      .filter((r) => !isBlankCsvRow(r.row));

    // `addUnitsSchema` bounds one request at 5,000 serials, so a bigger file is
    // refused whole at the commit with a schema message. Refusing it here says
    // the number and what to do about it instead.
    if (dataRows.length > SERIAL_CSV_MAX_ROWS) {
      return refuse(
        `This file has ${dataRows.length} serial numbers and one upload can carry ${SERIAL_CSV_MAX_ROWS}. Split it and upload the parts — nothing has been read.`,
      );
    }

    const serials = dataRows.map((r) => (r.row[index] ?? '').trim());
    // The line the vendor sees in their editor: the header is line 1.
    const fileLineOf = (batchLine: number): number => batchLine + (hasHeader ? 1 : 0);

    const batch = await this.validate(serials, target.brandName);

    const byLine = new Map<number, SerialIssue & { outcome: 'ERROR' | 'WARN' }>();
    for (const w of batch.warnings) byLine.set(w.line, { ...w, outcome: 'WARN' });
    // An error on a line supersedes a warning on it — the vendor has to fix it
    // either way, and showing both makes the count meaningless.
    for (const e of batch.errors) byLine.set(e.line, { ...e, outcome: 'ERROR' });

    /**
     * The line numbers INSIDE a message have to be translated too.
     *
     * `validateSerialBatch` is shared with the paste box, where the batch line
     * and the displayed line are the same number, so it writes "Duplicate of
     * line 2" meaning the second serial it was given. Here they are not the
     * same: the row's own `lineNumber` was remapped to the file, and the number
     * in the prose was not — so a file whose third line is blank reported
     * "Duplicate of line 1", which is the header.
     *
     * That is the same defect as misnumbering a row, arriving by a different
     * door: a vendor told line 1 opens line 1, finds a column heading, and
     * concludes our validation is broken. They would be half right.
     *
     * Out-of-range indices are left alone rather than guessed at — a message
     * that ever says "line 0" should read oddly rather than point somewhere.
     */
    const toFileLine = (message: string): string =>
      message.replace(/\bline (\d+)\b/g, (whole, n: string) => {
        const row = dataRows[Number(n) - 1];
        return row ? `line ${fileLineOf(row.fileLine)}` : whole;
      });

    const rows: SerialCsvRow[] = serials.map((serial, i) => {
      const issue = byLine.get(i + 1);
      return issue
        ? {
            lineNumber: fileLineOf(dataRows[i]!.fileLine),
            serial: issue.serial,
            outcome: issue.outcome,
            reason: toFileLine(issue.message),
          }
        : { lineNumber: fileLineOf(dataRows[i]!.fileLine), serial, outcome: 'WILL_ADD' };
    });

    // Capacity, applied in file order to the rows that would otherwise go in.
    //
    // The commit refuses the WHOLE batch when it would take the listing past
    // VR-080, so without this the report promises 5,000 rows and the vendor gets
    // zero and one sentence about a quantity. Marking the overflow instead keeps
    // the promise true and tells them exactly which lines to delete.
    if (target.capacityLeft !== undefined) {
      let room = Math.max(0, target.capacityLeft);
      for (const row of rows) {
        if (row.outcome === 'ERROR') continue;
        if (room > 0) {
          room -= 1;
          continue;
        }
        row.outcome = 'ERROR';
        row.reason =
          target.capacityLeft === 0
            ? `This listing already holds the most machines one listing may carry (${LISTING_QTY.max}). Start another listing for these.`
            : `Over the limit: this listing has room for ${target.capacityLeft} more ${target.capacityLeft === 1 ? 'machine' : 'machines'} and no listing may hold more than ${LISTING_QTY.max}. Delete this line and the ones after it, or start another listing.`;
      }
    }

    const errors = rows.filter((r) => r.outcome === 'ERROR').length;
    return {
      rows,
      // Not `outcome === 'WILL_ADD'`. A warned row is an accepted row, and this
      // number is what the commit inserts — see `SerialCsvReport`.
      willAdd: rows.length - errors,
      warnings: rows.filter((r) => r.outcome === 'WARN').length,
      errors,
      fileErrors: [],
      batch,
    };
  }

  /**
   * The rows the vendor has to fix, keyed by their own line numbers.
   *
   * ERRORs only, and warnings deliberately not. This file exists to be opened
   * beside the spreadsheet and worked through; a warned row needs no work — it
   * is going in — and padding the download with rows that require nothing makes
   * the count on the link disagree with the count in the file.
   */
  errorReportCsv(report: SerialCsvReport): string {
    const lines = ['line_number,serial_number,outcome,reason'];
    for (const r of report.rows) {
      if (r.outcome !== 'ERROR') continue;
      lines.push(
        `${r.lineNumber},${csvEscape(r.serial)},${r.outcome},${csvEscape(r.reason ?? '')}`,
      );
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Which of these serials are blacklisted.
   *
   * The table holds hashes, never values, so the comparison happens in hash
   * space — the same shape `kyc` screens PAN and bank accounts in. The digest
   * has to agree with the one `kyc` writes or the check silently matches
   * nothing: it is SHA-256 of the uppercased, trimmed value, and the serials
   * arriving here have already been through `normaliseSerial`, which uppercases
   * and trims. If `kyc` ever publishes its hash function on its barrel, this
   * should call that instead of restating it.
   */
  private async blacklisted(serials: readonly string[]): Promise<string[]> {
    if (serials.length === 0) return [];

    const byHash = new Map(serials.map((s) => [createHash('sha256').update(s).digest('hex'), s]));

    const rows = await this.prisma.$queryRaw<Array<{ value_hash: string }>>`
      SELECT value_hash FROM kyc.blacklist_entry
       WHERE entity_type = ${BLACKLIST_ENTITY_TYPE}
         AND active
         AND (expires_at IS NULL OR expires_at > ${this.clock.now()})
         AND value_hash = ANY(${[...byHash.keys()]}::text[])`;

    return rows.map((r) => byHash.get(r.value_hash)).filter((s): s is string => Boolean(s));
  }
}
