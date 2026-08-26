import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb, type Grade } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { EventBus } from '../../../shared/events/event-bus';
import {
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { QcRepository } from './qc.repository';
import { addDays, cfgNum, istDate, readConfig } from './tolerance.service';

/**
 * `listing.grade_correction` — the two days a vendor has to answer for a grade.
 *
 * Because inspection now happens *before* a buyer exists, a wrong grade is a
 * quiet correction instead of a mid-order dispute. That only works if the vendor
 * finds out immediately and the clock is real: the correction is published to the
 * outbox in the same transaction that raises it, so the vendor's message goes out
 * on commit rather than in a nightly digest. **This is money** — the corrected
 * grade moves the band the unit is priced in.
 *
 * Four answers, and a fifth that is the absence of one:
 *
 *   `ACCEPT_NEW_GRADE`   — the corrected grade stands, priced at its band
 *   `ACCEPT_AND_REPRICE` — the corrected grade stands, at a payout they name
 *   `WITHDRAW_UNIT`      — not listed, back to the vendor
 *   `DISPUTE`            — a QC manager, and a `FULL_RESCAN` re-verification
 *   *(no answer in 2 days)* — the correction auto-applies (QC-031)
 *
 * `counts_against_accuracy` defaults TRUE and feeds the vendor scorecard. It is
 * cleared in exactly one place — `resolveDispute({ upheld: true })` — because a
 * vendor who was right should not carry the mark, and a vendor who was wrong
 * should not be able to clear it by arguing.
 *
 * ## Two seams this file deliberately does not cross
 *
 * **It does not price.** `priceFromNetPayout`, the margin rules and the floor
 * check live in the `listing` module and are reached through its own service, not
 * from here. A second pricing path that agrees today is the one that quietly
 * stops agreeing, and the symptom is a vendor paid a different number from the
 * one the screen promised. What this writes is the vendor's *ask*
 * (`vendor_ask_price`) and the record; recomputing the retail price from it is
 * the listing module's job. See the return notes — that subscription does not
 * exist yet.
 *
 * **It does not join.** `listing.grade_correction` is in the `listing` schema and
 * every `qc` table it relates to is in `qc`. `no-cross-schema-join` makes a join
 * a lint error, so these are separate statements combined in TypeScript.
 */

/** `listing.grade_correction.vendor_response`, exactly as the CHECK allows it. */
export const VENDOR_RESPONSES = Object.freeze([
  'ACCEPT_NEW_GRADE',
  'ACCEPT_AND_REPRICE',
  'WITHDRAW_UNIT',
  'DISPUTE',
] as const);
export type VendorResponse = (typeof VENDOR_RESPONSES)[number];

export interface RaiseCorrectionInput {
  unitId: string;
  listingId: string | null;
  qcReportId: string;
  vendorOrgId: string;
  /** What the vendor listed. */
  gradeDeclared: Grade;
  /** What we are prepared to claim. Must differ — `chk_actually_different`. */
  gradeCorrected: Grade;
  /** Shown to the vendor. The verdict's own message, not a code. */
  reason: string;
  /** The vendor's ask before the correction, as it stood. */
  priceBefore?: Money | string | null;
  priceSuggested?: Money | null;
}

export interface GradeCorrectionRow {
  id: string;
  unitId: string;
  listingId: string | null;
  qcReportId: string;
  gradeDeclared: Grade;
  gradeCorrected: Grade;
  reason: string;
  priceBefore: Money | null;
  priceSuggested: Money | null;
  vendorNotifiedAt: Date;
  vendorResponse: VendorResponse | null;
  vendorRespondedAt: Date | null;
  autoAppliedAt: Date | null;
  countsAgainstAccuracy: boolean;
}

export interface RespondOptions {
  /** `ACCEPT_AND_REPRICE` only: the vendor's new net payout for this unit. */
  vendorAskPrice?: Money;
  /** `DISPUTE` only: what the vendor says is wrong, for the QC manager. */
  note?: string;
}

const CONFIG_KEYS = ['qc.grade_correction_auto_days', 'qc.report_validity_days'] as const;

type Raw = Record<string, unknown>;

@Injectable()
export class GradeCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly repo: QcRepository,
    private readonly bus: EventBus,
  ) {}

  /**
   * Raise a correction and tell the vendor, now.
   *
   * The insert and the outbox row are one transaction, so a correction the vendor
   * was never told about cannot exist — and a message about a correction that
   * rolled back cannot be sent either.
   */
  async raise(input: RaiseCorrectionInput): Promise<string> {
    if (input.gradeDeclared === input.gradeCorrected) {
      // `chk_actually_different` would refuse this as a 23514 from inside a
      // transaction three frames down. Refusing here says which two grades and
      // why, and keeps the caller's own transaction intact.
      throw new ValidationError('A grade correction needs two different grades.', {
        unitId: input.unitId,
        grade: input.gradeDeclared,
        reason: 'grade_correction_not_different',
      });
    }

    const cfg = await readConfig(this.prisma, CONFIG_KEYS);
    const now = this.clock.now();
    const respondBy = this.clock.plusDays(cfgNum(cfg, 'qc.grade_correction_auto_days'));
    const priceBefore = moneyFromDb(input.priceBefore ?? null);

    const [row] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO listing.grade_correction
        (unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
         price_before, price_suggested, vendor_notified_at)
      VALUES
        (${input.unitId}::uuid, ${input.listingId}::uuid, ${input.qcReportId}::uuid,
         ${input.gradeDeclared}::public.grade_type, ${input.gradeCorrected}::public.grade_type,
         ${input.reason},
         ${priceBefore?.toString() ?? null}::numeric,
         ${input.priceSuggested?.toString() ?? null}::numeric,
         ${now})
      RETURNING id`;

    await this.bus.publish('qc.grade_correction.raised', {
      correctionId: row!.id,
      unitId: input.unitId,
      vendorOrgId: input.vendorOrgId,
      gradeDeclared: input.gradeDeclared,
      gradeCorrected: input.gradeCorrected,
      respondByAt: respondBy.toISOString(),
    });

    return row!.id;
  }

  async findById(id: string): Promise<GradeCorrectionRow | null> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
             price_before, price_suggested, vendor_notified_at, vendor_response,
             vendor_responded_at, auto_applied_at, counts_against_accuracy
        FROM listing.grade_correction WHERE id = ${id}::uuid`;
    return rows[0] ? toCorrection(rows[0]) : null;
  }

  async findByUnit(unitId: string): Promise<GradeCorrectionRow[]> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
             price_before, price_suggested, vendor_notified_at, vendor_response,
             vendor_responded_at, auto_applied_at, counts_against_accuracy
        FROM listing.grade_correction
       WHERE unit_id = ${unitId}::uuid ORDER BY vendor_notified_at DESC`;
    return rows.map(toCorrection);
  }

  /**
   * The vendor's answer.
   *
   * One transaction: the answer, its consequence for the unit, and — for a
   * dispute — the re-verification it triggers. A response recorded without its
   * consequence is a unit that stays blocked with a row saying it was resolved.
   */
  async respond(
    correctionId: string,
    response: VendorResponse,
    options: RespondOptions = {},
  ): Promise<GradeCorrectionRow> {
    return this.prisma.runInTransaction(async () => {
      const correction = await this.lock(correctionId);
      if (correction.vendorResponse !== null || correction.autoAppliedAt !== null) {
        throw new PreconditionFailedError('This grade correction has already been settled.', {
          correctionId,
          response: correction.vendorResponse,
          autoApplied: correction.autoAppliedAt !== null,
          reason: 'grade_correction_settled',
        });
      }

      if (response === 'ACCEPT_AND_REPRICE' && !options.vendorAskPrice) {
        throw new ValidationError('Re-pricing needs the new amount you want for this unit.', {
          correctionId,
          reason: 'reprice_needs_price',
        });
      }

      switch (response) {
        case 'ACCEPT_NEW_GRADE':
          await this.applyCorrectedGrade(correction);
          break;

        case 'ACCEPT_AND_REPRICE':
          // The ask is the vendor's own number and is written here. The retail
          // price derived from it is the listing module's; see the file header.
          await this.prisma.$executeRaw`
            UPDATE listing.unit SET vendor_ask_price = ${options.vendorAskPrice!.toString()}::numeric
             WHERE id = ${correction.unitId}::uuid`;
          await this.applyCorrectedGrade(correction);
          break;

        case 'WITHDRAW_UNIT':
          // RETURNED_TO_VENDOR is outside `uq_unit_active_serial`, so the serial
          // is released and the machine can be listed again after a re-inspection
          // rather than being stuck as a duplicate of itself.
          await this.prisma.$executeRaw`
            UPDATE listing.unit SET
              status         = 'RETURNED_TO_VENDOR'::public.unit_status,
              qc_passed_at   = NULL,
              qc_valid_until = NULL
            WHERE id = ${correction.unitId}::uuid`;
          break;

        case 'DISPUTE':
          // A rescan by our own technician is the only thing that settles this,
          // so the row is opened now and closed when it is performed.
          // `performed_at` therefore reads as "escalated at" until then — the
          // column is NOT NULL and there is no separate raised-at.
          await this.repo.insertReverification({
            unitId: correction.unitId,
            originalReportId: correction.qcReportId,
            trigger: 'VENDOR_REQUEST',
            method: 'FULL_RESCAN',
            outcome: 'ESCALATE',
            notes: options.note ?? 'Vendor disputed the corrected grade.',
          });
          break;
      }

      const rows = await this.prisma.$queryRaw<Raw[]>`
        UPDATE listing.grade_correction SET
          vendor_response     = ${response},
          vendor_responded_at = ${this.clock.now()}
        WHERE id = ${correctionId}::uuid
        RETURNING id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
                  price_before, price_suggested, vendor_notified_at, vendor_response,
                  vendor_responded_at, auto_applied_at, counts_against_accuracy`;
      return toCorrection(rows[0]!);
    });
  }

  /**
   * QC-031: no answer inside `qc.grade_correction_auto_days` applies the
   * correction.
   *
   * The window is measured with `ClockPort`, so the test that proves this moves
   * a `FixedClock` forward two days rather than waiting two days.
   *
   * Each correction is settled in its own transaction. One unit whose listing row
   * has gone missing must not roll back the other thirty-nine on the same run —
   * this is a job, and a job that fails whole is a job somebody disables.
   */
  async autoApplyDue(): Promise<{ applied: string[]; failed: string[] }> {
    const cfg = await readConfig(this.prisma, CONFIG_KEYS);
    const cutoff = new Date(
      this.clock.nowMs() - cfgNum(cfg, 'qc.grade_correction_auto_days') * 86_400_000,
    );

    const due = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.grade_correction
       WHERE vendor_response IS NULL
         AND auto_applied_at IS NULL
         AND vendor_notified_at <= ${cutoff}
       ORDER BY vendor_notified_at`;

    const applied: string[] = [];
    const failed: string[] = [];
    for (const { id } of due) {
      try {
        await this.prisma.runInTransaction(async () => {
          const correction = await this.lock(id);
          // Re-checked inside the lock: the vendor may have answered between the
          // scan above and this transaction, and applying over their answer is
          // the one failure mode this job must not have.
          if (correction.vendorResponse !== null || correction.autoAppliedAt !== null) return;

          await this.applyCorrectedGrade(correction);
          await this.prisma.$executeRaw`
            UPDATE listing.grade_correction SET auto_applied_at = ${this.clock.now()}
             WHERE id = ${id}::uuid`;
          applied.push(id);
        });
      } catch {
        failed.push(id);
      }
    }
    return { applied, failed };
  }

  /**
   * A QC manager's ruling on a dispute.
   *
   * `counts_against_accuracy` is cleared only when the vendor is upheld. It feeds
   * `qc.vendor_quality.grade_accuracy_pct`, which feeds the supply-point
   * comparison a buyer sees — so it is a number we publish, and it can only move
   * on a finding, never on a request.
   */
  async resolveDispute(
    correctionId: string,
    ruling: { upheld: boolean; note?: string },
  ): Promise<GradeCorrectionRow> {
    return this.prisma.runInTransaction(async () => {
      const correction = await this.lock(correctionId);
      if (correction.vendorResponse !== 'DISPUTE') {
        throw new PreconditionFailedError('There is no dispute on this grade correction.', {
          correctionId,
          response: correction.vendorResponse,
          reason: 'not_disputed',
        });
      }

      if (!ruling.upheld) {
        // The correction stands, and the vendor's two days are spent.
        await this.applyCorrectedGrade(correction);
      }

      const rows = await this.prisma.$queryRaw<Raw[]>`
        UPDATE listing.grade_correction SET
          counts_against_accuracy = ${!ruling.upheld},
          reason = reason || ${`\n\nQC manager: ${ruling.upheld ? 'dispute upheld' : 'correction stands'}.${ruling.note ? ` ${ruling.note}` : ''}`}
        WHERE id = ${correctionId}::uuid
        RETURNING id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
                  price_before, price_suggested, vendor_notified_at, vendor_response,
                  vendor_responded_at, auto_applied_at, counts_against_accuracy`;
      return toCorrection(rows[0]!);
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Apply the corrected grade to the unit, and release it if nothing else holds
   * it.
   *
   * "Nothing else holds it" is read from the report rather than re-derived: the
   * verdict was MISMATCH (not FAIL) and no `qc_mismatch` row on that report is
   * BLOCKING. Re-running the verdict engine here would be both a circular
   * dependency and a second grading of the same machine — and a unit whose ports
   * failed does not become sellable because the vendor accepted a grade.
   *
   * The 90 days run from the **inspection**, not from the vendor's reply. Two
   * days of thinking about a correction do not make the inspection fresher.
   */
  private async applyCorrectedGrade(correction: GradeCorrectionRow): Promise<void> {
    const report = await this.repo.findReportById(correction.qcReportId);
    if (!report) throw new NotFoundError('qc_report', { qcReportId: correction.qcReportId });

    const blocking = (await this.repo.findMismatches(correction.qcReportId)).some(
      (m) => m.severity === 'BLOCKING',
    );
    const releasable = report.verdict === 'MISMATCH' && !blocking && report.completedAt !== null;

    if (!releasable) {
      // Record our grade; the unit stays where the verdict left it.
      await this.prisma.$executeRaw`
        UPDATE listing.unit
           SET grade_actual = ${correction.gradeCorrected}::public.grade_type
         WHERE id = ${correction.unitId}::uuid`;
      return;
    }

    const cfg = await readConfig(this.prisma, CONFIG_KEYS);
    const validUntil = addDays(
      istDate(report.completedAt!),
      cfgNum(cfg, 'qc.report_validity_days'),
    );

    await this.prisma.$executeRaw`
      UPDATE listing.unit SET
        grade_actual   = ${correction.gradeCorrected}::public.grade_type,
        status         = 'QC_PASSED'::public.unit_status,
        qc_passed_at   = ${report.completedAt},
        qc_valid_until = ${validUntil}::date
      WHERE id = ${correction.unitId}::uuid`;

    await this.prisma.$executeRaw`
      UPDATE qc.qc_report SET valid_until = ${validUntil}::date WHERE id = ${report.id}::uuid`;
  }

  /**
   * `FOR UPDATE` before anything is read off it.
   *
   * The auto-apply job and a vendor pressing "Accept" can arrive at the same
   * correction in the same second, and the loser must see the winner's row rather
   * than both applying. This is the only thing standing between that and a unit
   * whose grade was set twice.
   */
  private async lock(id: string): Promise<GradeCorrectionRow> {
    const rows = await this.prisma.$queryRaw<Raw[]>`
      SELECT id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
             price_before, price_suggested, vendor_notified_at, vendor_response,
             vendor_responded_at, auto_applied_at, counts_against_accuracy
        FROM listing.grade_correction WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new NotFoundError('grade_correction', { correctionId: id });
    return toCorrection(rows[0]);
  }
}

// ---------------------------------------------------------------------------

function toCorrection(r: Raw): GradeCorrectionRow {
  return {
    id: r.id as string,
    unitId: r.unit_id as string,
    listingId: (r.listing_id as string | null) ?? null,
    qcReportId: r.qc_report_id as string,
    gradeDeclared: r.grade_declared as Grade,
    gradeCorrected: r.grade_corrected as Grade,
    reason: r.reason as string,
    // NUMERIC(14,2). `Number()` on either of these is the float bug this
    // codebase keeps nearly shipping (VR-126).
    priceBefore: moneyFromDb(r.price_before as string | null),
    priceSuggested: moneyFromDb(r.price_suggested as string | null),
    vendorNotifiedAt: r.vendor_notified_at as Date,
    vendorResponse: (r.vendor_response as VendorResponse | null) ?? null,
    vendorRespondedAt: (r.vendor_responded_at as Date | null) ?? null,
    autoAppliedAt: (r.auto_applied_at as Date | null) ?? null,
    countsAgainstAccuracy: r.counts_against_accuracy as boolean,
  };
}
