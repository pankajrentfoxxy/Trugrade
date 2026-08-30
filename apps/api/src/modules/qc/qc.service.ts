import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { QcRepository } from './internal/qc.repository';
import {
  VendorQualityService,
  type SupplyPointQuality,
  type SupplyPointRef,
} from './internal/vendor-quality.service';
import type { Grade } from '@trugrade/contracts';

/** The four things a DeviceSure run can conclude. Matches `qc_verdict`. */
export type QcVerdict = 'PASS' | 'PASS_WITH_NOTE' | 'MISMATCH' | 'FAIL';

/**
 * One inspection, reduced to what a party outside `qc` may be told about it.
 *
 * An allow-list, and every field is nullable for the same reason: **a missing
 * measurement is a fact, not a zero.** A battery that was never read is `null`
 * here and has to render as "Not measured"; a `0` would read as a dead battery
 * and a `100` as a perfect one, and both are inventions. Nothing in this shape
 * identifies a vendor — not the technician, not the visit, not the photo keys.
 */
export interface UnitInspection {
  reportId: string;
  verdict: QcVerdict | null;
  /** `grade_final` — OUR claim, never `grade_proposed`, which is the tool's. */
  grade: Grade | null;
  qcScore: number | null;
  /** `YYYY-MM-DD`, the day of the inspection. Null while a report is open. */
  inspectedOn: string | null;
  batteryHealthPct: number | null;
  seal: { code: string; status: string } | null;
}

/**
 * The public interface of the `qc` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `qc` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: tool providers, technicians, availability, visits, visit units, tool runs,
 * reports, area results, hardware detected, photos, seals, mismatches,
 * re-verifications, sampling rules, wipe certificates, audit rechecks.
 *
 * Deliberately still small. The services that follow — ingestion, the
 * tolerance engine and verdict, grade correction, scheduling, sealing and the
 * aggregates — add to this interface when they land and another module actually
 * needs to call them. A method added here in advance of a caller is a network
 * contract nobody has agreed to; `countCurrentReports` is here because the
 * storefront's public counter asked for it and would otherwise have read
 * `qc.qc_report` from the catalog module.
 *
 * Other modules reach this through `src/modules/qc` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 */
export interface IQcService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * How many units carry a current inspection — the storefront's headline
   * number.
   *
   * `is_current` is the filter that matters and it is qc's own bookkeeping: a
   * re-inspection supersedes its predecessor rather than deleting it, so a
   * caller counting `qc_report` rows would publish the number of inspections
   * ever performed and call it the number of machines checked.
   */
  countCurrentReports(): Promise<number>;

  /**
   * The two numbers the supply-point comparison board sells on, per supply
   * point, served from the cached read model.
   *
   * On the interface because the storefront's product page is a caller in
   * another module and the alternative was reading `qc.vendor_sku_quality` from
   * `listing` — which would put the small-sample suppression, the one thing here
   * with legal consequences under CP e-Comm r.7(2), in two places.
   *
   * Keyed on `(code, city)` and never on the code alone: the code is unique
   * within a city, so "Supply Point F" is a different vendor in Noida than it is
   * in Faridabad.
   */
  qualityForSupplyPoints(
    points: readonly SupplyPointRef[],
    opts?: { skuId?: string; grade?: Grade },
  ): Promise<SupplyPointQuality[]>;

  /**
   * What we said about a set of machines, keyed on the report that was in force
   * when each one was sold.
   *
   * On the interface because the buyer's per-serial order screen is a caller in
   * another module (`ordering` holds `order_line_unit.qc_report_id`, its own
   * column) and the alternative was `ordering` joining `qc.qc_report`,
   * `qc.qc_hardware_detected` and `qc.qc_seal` itself — three tables and the
   * "which seal is the current one" rule, restated in a module that does not own
   * any of them.
   *
   * Addressed by REPORT id rather than by unit: the report on the order line is
   * the inspection the machine was sold against, and a later re-inspection is a
   * different document. A caller resolving "the current report for this unit"
   * would show a buyer a verdict that did not exist when they bought it.
   */
  inspectionsByReport(reportIds: readonly string[]): Promise<UnitInspection[]>;
}

@Injectable()
export class QcService implements IQcService {
  constructor(
    private readonly repo: QcRepository,
    private readonly clock: ClockPort,
    private readonly prisma: PrismaService,
    private readonly quality: VendorQualityService,
  ) {}

  /**
   * Two things that fail silently rather than loudly, which is why they are
   * worth a health check.
   *
   * An empty `qc_tolerance_rule` makes every declared-versus-detected comparison
   * a no-op: nothing throws, no mismatch is ever raised, and every machine
   * passes its spec check. That is the QC-025 test quietly inverted, and it is
   * indistinguishable from a clean run until a buyer opens an 8 GB laptop they
   * paid for as a 16 GB one.
   *
   * An inactive DEVICESURE provider row means ingestion has nowhere to attribute
   * a certificate, and the webhook starts refusing deliveries for inspections a
   * vendor has already carried out.
   */
  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    const [rules, provider] = await Promise.all([
      this.repo.findToleranceRules(this.clock.todayInIst()),
      this.repo.findToolProviderByCode('DEVICESURE'),
    ]);

    if (rules.length === 0) {
      return {
        ok: false,
        detail: 'No QC tolerance rules are in effect — every spec check would pass.',
      };
    }
    if (!provider?.isActive) {
      return { ok: false, detail: 'The DEVICESURE tool provider is missing or inactive.' };
    }
    return { ok: true };
  }

  async countCurrentReports(): Promise<number> {
    return this.prisma.db.qc_report.count({ where: { is_current: true } });
  }

  /** Delegated verbatim: the aggregates and their suppression live in one file. */
  qualityForSupplyPoints(
    points: readonly SupplyPointRef[],
    opts: { skuId?: string; grade?: Grade } = {},
  ): Promise<SupplyPointQuality[]> {
    return this.quality.qualityForSupplyPoints(points, opts);
  }

  /**
   * One statement per report, built field by field. Never a row.
   *
   * The seal comes through a `LATERAL` taking the newest one because a seal can
   * be replaced — a machine re-sealed after a warranty repair carries two rows, and
   * the one that matters at a buyer's door is the one currently on the lid.
   * `LEFT JOIN` on both sides: an inspection with no hardware capture and one
   * with no seal are both real states, and an INNER JOIN would silently drop the
   * machine off the buyer's asset register rather than saying what is missing.
   *
   * **`battery_health_pct` is cast to `float8` and that cast is load bearing.**
   * The column is `NUMERIC`, and `$queryRaw` hands a NUMERIC back as a *string*.
   * A caller averaging a column of those concatenates them — 87 and 92 average
   * to `"8792" / 2` — and the type on this interface would be a lie. This is the
   * only place it can be made true.
   */
  async inspectionsByReport(reportIds: readonly string[]): Promise<UnitInspection[]> {
    if (reportIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        verdict: string | null;
        grade_final: string | null;
        qc_score: number | null;
        completed_at: Date | null;
        battery_health_pct: number | null;
        seal_code: string | null;
        seal_status: string | null;
      }>
    >`
      SELECT r.id, r.verdict::text AS verdict, r.grade_final::text AS grade_final,
             r.qc_score, r.completed_at,
             h.battery_health_pct::float8 AS battery_health_pct,
             s.seal_code, s.status::text AS seal_status
        FROM qc.qc_report r
        LEFT JOIN qc.qc_hardware_detected h ON h.qc_report_id = r.id
        LEFT JOIN LATERAL (
          SELECT seal_code, status FROM qc.qc_seal
           WHERE qc_report_id = r.id
           ORDER BY applied_at DESC
           LIMIT 1
        ) s ON TRUE
       WHERE r.id = ANY(${[...reportIds]}::uuid[])`;

    return rows.map((r) => ({
      reportId: r.id,
      verdict: (r.verdict as QcVerdict | null) ?? null,
      grade: (r.grade_final as Grade | null) ?? null,
      qcScore: r.qc_score,
      inspectedOn: r.completed_at ? r.completed_at.toISOString().slice(0, 10) : null,
      batteryHealthPct: r.battery_health_pct,
      seal: r.seal_code && r.seal_status ? { code: r.seal_code, status: r.seal_status } : null,
    }));
  }
}
