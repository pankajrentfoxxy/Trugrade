import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { NotFoundError, ValidationError } from '../../../shared/errors/domain-errors';
import { QcRepository, type QcAuditRecheckRow } from './qc.repository';
import type { QcAreaCode, QcAreaStatus } from '../dto/qc.dto';

/**
 * The 5% second opinion.
 *
 * One report in twenty is inspected again by a different technician, and the two
 * are compared. The point is not to catch anybody: **a technician whose
 * divergence rises is a training problem before it is a fraud problem**, and the
 * only way to tell those apart is to have the number early and watch it move.
 * So this service computes and surfaces; it never deactivates a technician, never
 * withholds pay, and has no method that would let a caller do either.
 *
 * Two decisions worth knowing before reading the code:
 *
 *   - **Divergence is measured on the grade, not the score.** Two honest
 *     technicians will differ by a few points on a 0-100 score every time; a
 *     scratch is a judgement call. The *grade* is the number that sets the price
 *     and the number we vouch for under CP e-Comm r.7(5), so a disagreement
 *     there is the only disagreement that costs anything. Score and per-area
 *     deltas are still recorded in `divergence_json` — they are what a training
 *     conversation is actually about — but they do not move the rate.
 *   - **Selection is deterministic, not random.** `Math.random()` at 5% means a
 *     retried ingestion can select a report that was not selected a moment ago,
 *     and nobody can answer "why was this one picked" three months later.
 *     Hashing the report id gives the same answer every time, is uniform, and is
 *     unguessable in advance by the technician being sampled — which is the
 *     property that actually matters.
 */

/** The share of completed reports that get a second technician's opinion. */
const RATE_KEY = 'qc.audit_recheck_pct';

/** Seeded value is 5. Only used if the key has been deleted. */
const DEFAULT_RECHECK_PCT = 5;

/**
 * Below this many rechecks the rate stays NULL.
 *
 * One recheck that diverged is not a 100% divergence rate, it is one data point,
 * and NULL is the column saying so honestly. There is no `platform_config` key
 * for this, so it is a constant rather than a silent hard-coded config read —
 * if ops ever needs to move it, that is the moment to add the key.
 */
const MIN_RECHECKS_FOR_RATE = 5;

export interface RecheckInput {
  originalReportId: string;
  recheckReportId: string;
  /** An `identity.user_account.id` — `qc_audit_recheck.auditor_id` FKs that table. */
  auditorId: string;
}

export interface AreaDivergence {
  area: QcAreaCode;
  original: QcAreaStatus | null;
  recheck: QcAreaStatus | null;
}

export interface Divergence {
  /** The only difference that moves the rate. */
  gradeDiffers: boolean;
  gradeOriginal: string | null;
  gradeRecheck: string | null;
  scoreOriginal: number | null;
  scoreRecheck: number | null;
  /** recheck − original. Null when either side was never scored. */
  scoreDelta: number | null;
  /** Only the areas the two technicians disagreed about, or that one did not measure. */
  areas: AreaDivergence[];
}

export interface RecheckOutcome {
  recheck: QcAuditRecheckRow;
  divergence: Divergence;
  technician: TechnicianDivergence;
}

export interface TechnicianDivergence {
  technicianId: string;
  rechecked: number;
  diverged: number;
  /**
   * A **percentage**, 0-100, not a 0-1 ratio.
   *
   * The column is `divergence_rate` with no `_pct` suffix, which is the one
   * thing about it that could be misread, so it is written down here: every
   * other NUMERIC(5,2) rate in this schema — `grade_accuracy_pct`,
   * `min_pass_rate`, `sample_pct` — is a percentage, and two decimal places on a
   * 0-1 ratio would quantise to whole percent anyway.
   *
   * NULL below `MIN_RECHECKS_FOR_RATE`. Not zero — zero is a claim.
   */
  divergenceRatePct: number | null;
}

@Injectable()
export class AuditRecheckService {
  private readonly logger = new Logger(AuditRecheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
  ) {}

  /**
   * Is this report one of the 5%?
   *
   * Called when a report is completed. The answer is a property of the report
   * id, so asking twice gives the same answer and a re-delivered webhook cannot
   * quietly change whether an inspection is being audited.
   */
  async isSelectedForRecheck(reportId: string): Promise<boolean> {
    const pct = await this.recheckPct();
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    // Four hex digits of SHA-256 give a uniform bucket in [0, 10000), so a
    // fractional percentage like 2.5 is expressible rather than rounded away.
    const bucket = parseInt(createHash('sha256').update(reportId).digest('hex').slice(0, 4), 16);
    return (bucket % 10_000) < Math.round(pct * 100);
  }

  /**
   * Record a completed recheck and refresh the original technician's rate.
   *
   * The recheck is a full second report in its own right — it superseded the
   * first through `supersedeReport`, so both survive. This only writes the
   * *comparison*, which is the thing neither report can carry on its own.
   */
  async recordRecheck(input: RecheckInput): Promise<RecheckOutcome> {
    if (input.originalReportId === input.recheckReportId) {
      throw new ValidationError('A report cannot be its own audit recheck.', {
        recheckReportId: 'Pick the second technician’s report, not the first.',
      });
    }

    const [original, recheck] = await Promise.all([
      this.repo.findReportById(input.originalReportId),
      this.repo.findReportById(input.recheckReportId),
    ]);
    if (!original) throw new NotFoundError('qc_report', { id: input.originalReportId });
    if (!recheck) throw new NotFoundError('qc_report', { id: input.recheckReportId });
    if (original.unitId !== recheck.unitId) {
      // Comparing two different machines would produce a divergence number that
      // means nothing and would be indistinguishable from a real one afterwards.
      throw new ValidationError('An audit recheck must be of the same unit.', {
        recheckReportId: 'These two reports are about different machines.',
      });
    }

    const divergence = await this.compare(input.originalReportId, input.recheckReportId, {
      gradeOriginal: original.gradeFinal,
      gradeRecheck: recheck.gradeFinal,
      scoreOriginal: original.qcScore,
      scoreRecheck: recheck.qcScore,
    });

    const row = await this.repo.insertAuditRecheck({ ...input, divergence });
    const technician = await this.refreshTechnicianDivergence(original.technicianId);

    if (divergence.gradeDiffers) {
      this.logger.log(
        `Audit recheck of ${input.originalReportId}: grade ${divergence.gradeOriginal} -> ${divergence.gradeRecheck}. ` +
          `Technician ${original.technicianId} now ${technician.divergenceRatePct ?? '—'}% over ${technician.rechecked} recheck(s).`,
      );
    }

    return { recheck: row, divergence, technician };
  }

  /**
   * The number the divergence dashboard shows. Read-only: this is the whole
   * intervention. What happens next is a conversation, not a status change.
   */
  async technicianDivergence(technicianId: string): Promise<TechnicianDivergence> {
    const rows = await this.prisma.$queryRaw<Array<{ rechecked: bigint; diverged: bigint }>>`
      SELECT count(*)::bigint AS rechecked,
             count(*) FILTER (
               WHERE orig.grade_final IS DISTINCT FROM re.grade_final
             )::bigint AS diverged
        FROM qc.qc_audit_recheck ar
        JOIN qc.qc_report orig ON orig.id = ar.original_report_id
        JOIN qc.qc_report re   ON re.id   = ar.recheck_report_id
       WHERE orig.technician_id = ${technicianId}::uuid`;

    const rechecked = Number(rows[0]?.rechecked ?? 0);
    const diverged = Number(rows[0]?.diverged ?? 0);
    return {
      technicianId,
      rechecked,
      diverged,
      divergenceRatePct:
        rechecked >= MIN_RECHECKS_FOR_RATE
          ? Math.round((diverged / rechecked) * 10_000) / 100
          : null,
    };
  }

  // -------------------------------------------------------------------------

  private async refreshTechnicianDivergence(technicianId: string): Promise<TechnicianDivergence> {
    const d = await this.technicianDivergence(technicianId);
    // `unitsInspectedDelta` is deliberately absent: a recheck is not an extra
    // inspection by this technician, and adding one here would inflate the very
    // denominator the rate is measured against.
    await this.repo.updateTechnicianStats(technicianId, { divergenceRate: d.divergenceRatePct });
    return d;
  }

  private async compare(
    originalReportId: string,
    recheckReportId: string,
    grades: {
      gradeOriginal: string | null;
      gradeRecheck: string | null;
      scoreOriginal: number | null;
      scoreRecheck: number | null;
    },
  ): Promise<Divergence> {
    const [originalAreas, recheckAreas] = await Promise.all([
      this.repo.findAreaResults(originalReportId),
      this.repo.findAreaResults(recheckReportId),
    ]);

    const byArea = new Map<QcAreaCode, AreaDivergence>();
    for (const a of originalAreas) {
      byArea.set(a.area, { area: a.area, original: a.status, recheck: null });
    }
    for (const a of recheckAreas) {
      const existing = byArea.get(a.area);
      if (existing) existing.recheck = a.status;
      else byArea.set(a.area, { area: a.area, original: null, recheck: a.status });
    }

    return {
      // IS DISTINCT FROM semantics, in TypeScript: one report grading and the
      // other leaving it null is a disagreement, not a match.
      gradeDiffers: grades.gradeOriginal !== grades.gradeRecheck,
      ...grades,
      // Null when either side was never scored — a delta against a missing
      // measurement is a number that reads as agreement and is not one.
      scoreDelta:
        grades.scoreOriginal === null || grades.scoreRecheck === null
          ? null
          : grades.scoreRecheck - grades.scoreOriginal,
      // An area present on one report and absent on the other is kept, not
      // dropped: `qc_area_result.status` has no NOT_MEASURED, so an unmeasured
      // area *is* an absent row (never-fabricate, 07 §2), and "one of them did
      // not test the battery" is exactly what a training review needs to see.
      areas: [...byArea.values()].filter((a) => a.original !== a.recheck),
    };
  }

  /** See `QcExpiryService.warningDays` for why this reads the view, not the table. */
  private async recheckPct(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${RATE_KEY}`;
    const value = rows[0]?.value_json;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    this.logger.warn(`${RATE_KEY} is unset or malformed; using ${DEFAULT_RECHECK_PCT}%.`);
    return DEFAULT_RECHECK_PCT;
  }
}
