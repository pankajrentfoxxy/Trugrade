import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
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

export interface SerialCsvReport {
  rows: SerialCsvRow[];
  willAdd: number;
  warnings: number;
  errors: number;
  /** Problems with the file itself rather than with any one row. */
  fileErrors: string[];
  /** The verdicts, keyed by position in the file. Nothing has been written. */
  batch: SerialBatch;
}

/** The template header. This constant IS the download, so the two cannot drift. */
export const SERIAL_CSV_COLUMN = 'serial_number';

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
   * The CSV path, following the SKU importer's dry-run contract: **it writes
   * nothing and reports every row**, keyed by the line number in the vendor's
   * own file. The RFC 4180 parser is `parseCsv` from contracts — a `split(',')`
   * breaks on the first quoted field, and this is a file a human maintains.
   *
   * `dryRun()` itself is not reused: it is typed to SKU rows and classifies
   * against the catalog. Its shape is what matters here, and that is copied
   * exactly — per-row outcomes, a count of each, and a downloadable error report
   * a person can open next to their own spreadsheet.
   */
  async dryRunCsv(csv: string, brandName?: string | null): Promise<SerialCsvReport> {
    const grid = parseCsv(csv);
    if (grid.length === 0) {
      return {
        rows: [],
        willAdd: 0,
        warnings: 0,
        errors: 0,
        fileErrors: ['The file is empty.'],
        batch: { accepted: [], errors: [], warnings: [] },
      };
    }

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
    // Blank rows are dropped HERE, not by the parser, and the file line each
    // surviving row came from is carried with it. `parseCsv` used to filter
    // blanks itself, which shifted every line number after a blank row — a
    // vendor told "line 47" would look at a line that was fine. The parser
    // returns what is in the file; deciding what an empty row means is ours.
    const dataRows = (hasHeader ? grid.slice(1) : grid)
      .map((row, i) => ({ row, fileLine: i + 1 }))
      .filter((r) => !isBlankCsvRow(r.row));

    if (!hasHeader && grid[0]!.length > 1) {
      return {
        rows: [],
        willAdd: 0,
        warnings: 0,
        errors: 0,
        fileErrors: [
          `This file has several columns and none of them is called "${SERIAL_CSV_COLUMN}". Rename the column holding the serial numbers, or upload a file with just that one column.`,
        ],
        batch: { accepted: [], errors: [], warnings: [] },
      };
    }

    const serials = dataRows.map((r) => (r.row[index] ?? '').trim());
    // The line the vendor sees in their editor: the header is line 1.
    const fileLineOf = (batchLine: number): number => batchLine + (hasHeader ? 1 : 0);

    const batch = await this.validate(serials, brandName);

    const byLine = new Map<number, SerialIssue & { outcome: 'ERROR' | 'WARN' }>();
    for (const w of batch.warnings) byLine.set(w.line, { ...w, outcome: 'WARN' });
    // An error on a line supersedes a warning on it — the vendor has to fix it
    // either way, and showing both makes the count meaningless.
    for (const e of batch.errors) byLine.set(e.line, { ...e, outcome: 'ERROR' });

    const rows: SerialCsvRow[] = serials.map((serial, i) => {
      const issue = byLine.get(i + 1);
      return issue
        ? {
            lineNumber: fileLineOf(dataRows[i]!.fileLine),
            serial: issue.serial,
            outcome: issue.outcome,
            reason: issue.message,
          }
        : { lineNumber: fileLineOf(dataRows[i]!.fileLine), serial, outcome: 'WILL_ADD' };
    });

    return {
      rows,
      willAdd: rows.filter((r) => r.outcome === 'WILL_ADD').length,
      warnings: rows.filter((r) => r.outcome === 'WARN').length,
      errors: rows.filter((r) => r.outcome === 'ERROR').length,
      fileErrors: [],
      batch,
    };
  }

  /** The report the vendor downloads, keyed by their own line numbers. */
  errorReportCsv(report: SerialCsvReport): string {
    const lines = ['line_number,serial_number,outcome,reason'];
    for (const r of report.rows) {
      if (r.outcome === 'WILL_ADD') continue;
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
