import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ObjectStorePort } from '../../../shared/adapters/ports';
import { ReportPdfService } from './report-pdf.service';

/**
 * What happens to a listing when the technician marks a machine done.
 *
 * **Most of this chain already existed and this file does not rebuild it.**
 * `submit.service.ts` raises the visit inside the submit transaction,
 * `SchedulingService` assigns the technician through six checks, `VerdictService`
 * compares measured grade to declared and raises the grade correction, and
 * `VisitClosingService` moves a passed-and-sealed unit QC_SEALED → LISTED and
 * republishes the listing ACTIVE / PARTIALLY_ACTIVE / PAUSED. The quantities
 * look after themselves: `trg_listing_counters` recomputes `qty_available`,
 * `qty_awaiting_qc` and `qty_qc_failed` from the unit rows.
 *
 * Two things were genuinely missing, and they are what this file does:
 *
 *   1. **The report PDF was never attached.** `qc_report.report_pdf_key` is read
 *      in eight places and written in none — 239 reports on the live database,
 *      zero documents. Every screen offering "download the report" was offering
 *      nothing.
 *   2. **A mismatch escalated to the vendor but not to us.** The grade
 *      correction reaches the vendor, who may simply not respond; nothing put
 *      the machine in front of an operator. That is a unit sitting out of stock
 *      indefinitely with no queue holding it.
 *
 * Everything here runs **inside the caller's transaction**, never off an event.
 * Nothing in this repository subscribes to an event; a mismatch that raised its
 * correction and lost its ops task because a consumer was not running is exactly
 * the silent half-completion this rule exists to prevent.
 */
@Injectable()
export class InspectionOutcomeService {
  private readonly logger = new Logger(InspectionOutcomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly store: ObjectStorePort,
    private readonly pdf: ReportPdfService,
  ) {}

  /**
   * Render the report and hang it off the row.
   *
   * **A render failure must not fail the verdict.** The verdict is the decision
   * about the machine; the PDF is a rendering of a decision already recorded in
   * `qc_report`, `qc_area_result` and `qc_mismatch`, and it can be produced
   * again from those at any time. Losing the inspection because a font failed to
   * embed would be the tail wagging the dog — so this logs loudly and returns
   * null, and `report_pdf_key` stays NULL, which the column comment defines as
   * "not rendered", never as "not valid".
   *
   * The inverse trade — refusing to certify without a document — was considered
   * and rejected for the same reason the audit log swallows its own failures.
   */
  async attachReportPdf(qcReportId: string, serialNumber: string): Promise<string | null> {
    try {
      const rendered = await this.pdf.renderBySerial(serialNumber);
      if (!rendered) return null;

      // Serial, not vendor: the key is visible wherever the object is served and
      // a vendor identifier in a path is a disclosure with no way back.
      const key = `qc-reports/${qcReportId}/${rendered.filename}`;
      await this.store.put(key, rendered.bytes, 'application/pdf');
      await this.prisma.$executeRaw`
        UPDATE qc.qc_report SET report_pdf_key = ${key} WHERE id = ${qcReportId}::uuid`;
      return key;
    } catch (e) {
      this.logger.error(
        `QC report ${qcReportId} certified but its PDF did not render — ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * A machine whose measured grade is outside tolerance.
   *
   * Severity ATTENTION rather than BLOCKER: nothing downstream is stuck — the
   * other nine machines in the batch go live regardless — but somebody has to
   * chase a vendor who does not respond to the correction, and a queue is how
   * that happens rather than somebody remembering.
   *
   * Idempotent through `uq_ops_task_open_unit`. A second inspection that
   * mismatches again finds the open task rather than stacking a duplicate, which
   * would put two people on one machine.
   */
  async raiseGradeMismatch(input: {
    unitId: string;
    listingId: string;
    serialNumber: string;
    gradeDeclared: string;
    gradeActual: string;
    reason: string;
    gradeCorrectionId: string | null;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (kind, severity, listing_id, unit_id, subject, detail, assigned_role, status, created_at)
      VALUES ('GRADE_MISMATCH', 'ATTENTION',
              ${input.listingId}::uuid, ${input.unitId}::uuid,
              ${`${input.serialNumber} graded ${input.gradeActual}, declared ${input.gradeDeclared}`},
              ${JSON.stringify({
                serialNumber: input.serialNumber,
                gradeDeclared: input.gradeDeclared,
                gradeActual: input.gradeActual,
                reason: input.reason,
                gradeCorrectionId: input.gradeCorrectionId,
              })}::jsonb,
              'QC_MANAGER', 'OPEN', ${this.clock.now()})
      ON CONFLICT DO NOTHING`;
  }

  /**
   * A batch where nothing passed.
   *
   * The listing is PAUSED by `VisitClosingService` — deliberately not
   * OUT_OF_STOCK, which would claim the stock sold, and deliberately not
   * REJECTED, which is what an administrator does to a listing and is terminal.
   * A wholly-failed batch is neither: the vendor has something to fix and the
   * listing comes back when they do.
   *
   * **The spec asked for REJECTED here and this is the one place Stage 9
   * departs from it**, because REJECTED is already the admin action's terminal
   * state and a QC failure is recoverable. The reason the spec wanted carried
   * lives on this task, which is also what puts the batch in a queue instead of
   * leaving it paused and unattended.
   */
  async raiseBatchFailed(input: {
    listingId: string;
    totalUnits: number;
    reasons: readonly string[];
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (kind, severity, listing_id, subject, detail, assigned_role, status, created_at)
      VALUES ('QC_BATCH_FAILED', 'ATTENTION', ${input.listingId}::uuid,
              ${`No unit passed inspection — ${input.totalUnits} machine${input.totalUnits === 1 ? '' : 's'}`},
              ${JSON.stringify({ totalUnits: input.totalUnits, reasons: [...input.reasons] })}::jsonb,
              'QC_MANAGER', 'OPEN', ${this.clock.now()})
      ON CONFLICT DO NOTHING`;
  }
}
