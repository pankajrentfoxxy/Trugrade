import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  qualityHeadline,
  supplyPointLabel,
  type Grade,
  type QualityHeadline,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { EventBus } from '../../../shared/events/event-bus';
import { QcRepository } from './qc.repository';

/**
 * The two numbers the supply-point comparison grid sells on, computed here
 * because this is where the data lives.
 *
 * Everything in this file follows from two rules that matter more than the
 * arithmetic:
 *
 *   1. **Below the sample threshold there is no headline number.** A vendor with
 *      three inspected units gets "New supplier · 3 units inspected", never a
 *      100% accuracy score. That is not politeness — under CP e-Comm r.7(2) the
 *      claim on our storefront is *ours*, not the vendor's, and an
 *      authoritative-looking average computed on two machines is exactly what
 *      the CCPA Misleading Advertisements Guidelines 2022 exist to catch. The
 *      suppression is expressed as a **discriminated union** (`QualityHeadline`
 *      in `@trugrade/contracts`), so a caller cannot render a percentage that is
 *      not there — the type system refuses before the reviewer has to.
 *   2. **Compute, cache, version — never live.** The offers grid has a 500 ms
 *      p95 budget and already touches six tables. These are materialised into
 *      `qc.vendor_sku_quality` / `qc.vendor_quality`, refreshed on
 *      `qc.report.completed` and nightly, and served from there. `computed_at`
 *      is the version stamp: a reader that cares how fresh a number is has it.
 *
 * And one guarantee that is this file's alone: **the vendor's org id does not
 * cross the DTO boundary.** The storage layer is keyed by `vendor_org_id`
 * because that is what the rows are about; everything returned from here is
 * keyed by `supply_point_code` and carries no vendor identifier at any depth.
 * `qc-vendor-quality.spec.ts` asserts it rather than trusting it.
 */

const MIN_SAMPLE_KEY = 'qc.min_sample_for_headline';

/** Seeded value is 10. Used only if the key has been deleted. */
const DEFAULT_MIN_SAMPLE = 10;

/** One row of the read model, as a buyer may see it. No vendor identity, at any depth. */
export interface SupplyPointQuality {
  /** `A`, `B`, ... unique within a city, never across cities. */
  supplyPointCode: string;
  city: string;
  /** `Supply Point A · Gurugram`. */
  label: string;
  /** Null on the vendor-wide rollup. */
  skuId: string | null;
  grade: Grade | null;
  /**
   * SCORE or NEW_SUPPLIER. **The averages exist only inside this**, so there is
   * no path that renders a percentage below the sample threshold.
   */
  headline: QualityHeadline;
  /**
   * Null below the threshold, for the same reason as the headline: a battery
   * range drawn from two machines is a claim about a population of two.
   */
  batteryHealth: { minPct: number; maxPct: number } | null;
  lastInspectedAt: string | null;
  /** The version stamp. Nothing here was computed during this request. */
  computedAt: string;
}

export interface SupplyPointRef {
  code: string;
  city: string;
}

export interface RefreshResult {
  vendorOrgId: string;
  skuRows: number;
  unitsInspected: number;
}

interface ReportFact {
  unitId: string;
  qcScore: number | null;
  batteryHealthPct: number | null;
  completedAt: Date;
}

interface UnitFact {
  vendorOrgId: string;
  skuId: string;
  grade: Grade;
}

interface Bucket {
  scores: number[];
  batteries: number[];
  unitsInspected: number;
  lastInspectedAt: Date | null;
}

@Injectable()
export class VendorQualityService implements OnModuleInit {
  private readonly logger = new Logger(VendorQualityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QcRepository,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    // A full recompute for the vendor, not an increment. Recomputing is
    // idempotent by construction, which is the property that matters when the
    // outbox redelivers — an incremental `units_inspected + 1` would double-count
    // the first time a handler runs twice, and nothing would ever notice.
    this.bus.on('qc.report.completed', 'qc.vendor-quality.refresh', async (event) => {
      await this.refreshVendor(event.payload.vendorOrgId);
    });
  }

  /**
   * The nightly rebuild.
   *
   * The event-driven refresh is the one that keeps the grid current; this is the
   * one that repairs it. A dead-lettered event, a `grade_correction` resolved
   * outside the QC flow, or a `counts_against_accuracy` flipped after a dispute
   * was upheld all change these numbers without a `qc.report.completed` behind
   * them, and this is what makes that self-healing rather than a ticket.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'vendor-quality-refresh' })
  async refreshAll(): Promise<RefreshResult[]> {
    const vendors = await this.prisma.$queryRaw<Array<{ vendor_org_id: string }>>`
      SELECT DISTINCT vendor_org_id FROM listing.unit WHERE qc_report_id IS NOT NULL`;

    const results: RefreshResult[] = [];
    for (const v of vendors) {
      // ponytail: one pass per vendor rather than one big grouped statement.
      // It is a nightly job over inventory-sized data and the per-vendor shape
      // is the one the event handler already needs. If this ever stops
      // finishing in a maintenance window, the fix is a single grouped query,
      // not a thread pool.
      results.push(await this.refreshVendor(v.vendor_org_id));
    }
    this.logger.log(`Vendor quality refreshed for ${results.length} vendor(s).`);
    return results;
  }

  /**
   * Recompute one vendor's aggregates from the current reports.
   *
   * Only `is_current` reports count. A re-inspection supersedes rather than
   * overwrites, so counting every report would count one machine twice and give
   * a vendor a better sample than they have.
   */
  async refreshVendor(vendorOrgId: string): Promise<RefreshResult> {
    const units = await this.unitFacts(vendorOrgId);
    if (units.size === 0) {
      // Nothing inspected yet. Writing a zero-unit row would put a real
      // `computed_at` on an empty claim; leaving it absent is the honest state,
      // and the read path already treats "no row" as a new supplier.
      return { vendorOrgId, skuRows: 0, unitsInspected: 0 };
    }

    const reports = await this.reportFacts([...units.keys()]);
    const corrections = await this.correctionCounts(vendorOrgId);

    const bySku = new Map<string, Bucket>();
    const overall: Bucket = { scores: [], batteries: [], unitsInspected: 0, lastInspectedAt: null };

    for (const report of reports) {
      const unit = units.get(report.unitId);
      if (!unit) continue;
      const key = `${unit.skuId}|${unit.grade}`;
      const bucket = bySku.get(key) ?? {
        scores: [],
        batteries: [],
        unitsInspected: 0,
        lastInspectedAt: null,
      };
      accumulate(bucket, report);
      accumulate(overall, report);
      bySku.set(key, bucket);
    }

    for (const [key, bucket] of bySku) {
      const [skuId, grade] = key.split('|') as [string, Grade];
      const gradeCorrections = corrections.get(key) ?? 0;
      await this.repo.upsertVendorSkuQuality(
        { vendorOrgId, skuId, grade },
        { ...summarise(bucket), gradeCorrections, ...accuracy(bucket.unitsInspected, gradeCorrections) },
      );
    }

    const totalCorrections = [...corrections.values()].reduce((a, n) => a + n, 0);
    await this.repo.upsertVendorQuality(vendorOrgId, {
      ...summarise(overall),
      gradeCorrections: totalCorrections,
      ...accuracy(overall.unitsInspected, totalCorrections),
    });

    return { vendorOrgId, skuRows: bySku.size, unitsInspected: overall.unitsInspected };
  }

  // -------------------------------------------------------------------------
  // The read path — everything below is what a buyer may see
  // -------------------------------------------------------------------------

  /**
   * The grid's call. Supply points in, quality out, and no vendor anywhere.
   *
   * `(city, code)` is the key, not `code` alone: `listing.supply_point` is unique
   * on `(vendor_org_id, city)` and on `(city, code)`, so "Supply Point A" means
   * two different vendors in two different cities. Keying on the code alone would
   * silently attribute one vendor's quality record to another.
   *
   * Pass `skuId` for the per-SKU row a comparison grid shows; omit it for the
   * vendor-wide rollup a supply-point page shows.
   */
  async qualityForSupplyPoints(
    points: readonly SupplyPointRef[],
    opts: { skuId?: string; grade?: Grade } = {},
  ): Promise<SupplyPointQuality[]> {
    if (points.length === 0) return [];

    const minSample = await this.minSampleForHeadline();
    const resolved = await this.resolveSupplyPoints(points);

    const out: SupplyPointQuality[] = [];
    for (const point of resolved) {
      if (opts.skuId) {
        const rows = await this.repo.findVendorSkuQuality(point.vendorOrgId, opts.skuId);
        for (const row of rows) {
          if (opts.grade && row.grade !== opts.grade) continue;
          out.push(
            present(point, row.skuId, row.grade, row, minSample),
          );
        }
      } else {
        const row = await this.repo.findVendorQuality(point.vendorOrgId);
        if (row) out.push(present(point, null, null, row, minSample));
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------

  /**
   * `(vendor_org_id, sku_id, grade)` for every unit this vendor has had
   * inspected. `listing` schema only — the reports are read separately and
   * joined in TypeScript, because a JOIN across `qc` and `listing` welds two
   * modules together somewhere no type system would show it.
   *
   * The grade is the one the machine is *sold* at: `grade_actual` once QC has
   * ruled, falling back to what the vendor declared. That is what the buyer is
   * filtering on, so it is what the quality row must be keyed by.
   */
  private async unitFacts(vendorOrgId: string): Promise<Map<string, UnitFact>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; sku_id: string; grade: Grade }>
    >`
      SELECT id, sku_id, COALESCE(grade_actual, grade_declared) AS grade
        FROM listing.unit
       WHERE vendor_org_id = ${vendorOrgId}::uuid AND qc_report_id IS NOT NULL`;
    return new Map(
      rows.map((r) => [r.id, { vendorOrgId, skuId: r.sku_id, grade: r.grade }]),
    );
  }

  /**
   * Scores and battery health from the authoritative rows, not from the copies
   * denormalised onto `listing.unit`. Those copies exist for the storefront's
   * read path; deriving an aggregate from a denormalisation means the aggregate
   * is wrong in exactly the cases where the denormalisation is stale, which are
   * the cases somebody is investigating when they look at it.
   */
  private async reportFacts(unitIds: readonly string[]): Promise<ReportFact[]> {
    if (unitIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{
        unit_id: string;
        qc_score: number | null;
        battery_health_pct: unknown;
        completed_at: Date;
      }>
    >`
      SELECT r.unit_id, r.qc_score, h.battery_health_pct, r.completed_at
        FROM qc.qc_report r
        LEFT JOIN qc.qc_hardware_detected h ON h.qc_report_id = r.id
       WHERE r.is_current
         AND r.completed_at IS NOT NULL
         AND r.unit_id = ANY(${[...unitIds]}::uuid[])`;

    return rows.map((r) => ({
      unitId: r.unit_id,
      qcScore: r.qc_score,
      // A percentage, not money — `Number` is right here, and null stays null
      // because "not reported" is not zero (never-fabricate, 07 §2).
      batteryHealthPct: r.battery_health_pct === null ? null : Number(r.battery_health_pct),
      completedAt: r.completed_at,
    }));
  }

  /**
   * Corrections per `(sku, grade)`, keyed the same way the buckets are.
   *
   * `counts_against_accuracy` is the whole filter: it defaults TRUE and is set
   * FALSE only when a vendor's dispute was upheld, which is precisely the case
   * where the correction was ours and not theirs. Both tables are in `listing`,
   * so this one is a legitimate join.
   */
  private async correctionCounts(vendorOrgId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ sku_id: string; grade: Grade; corrections: bigint }>
    >`
      SELECT u.sku_id,
             COALESCE(u.grade_actual, u.grade_declared) AS grade,
             count(*)::bigint AS corrections
        FROM listing.grade_correction gc
        JOIN listing.unit u ON u.id = gc.unit_id
       WHERE u.vendor_org_id = ${vendorOrgId}::uuid AND gc.counts_against_accuracy
       GROUP BY u.sku_id, COALESCE(u.grade_actual, u.grade_declared)`;
    return new Map(rows.map((r) => [`${r.sku_id}|${r.grade}`, Number(r.corrections)]));
  }

  /**
   * `(city, code)` to vendor, server-side and one way only.
   *
   * This is the single place the mapping exists, and the org id it produces goes
   * no further than the repository lookup on the next line.
   */
  private async resolveSupplyPoints(
    points: readonly SupplyPointRef[],
  ): Promise<Array<SupplyPointRef & { vendorOrgId: string }>> {
    const codes = points.map((p) => p.code.trim().toUpperCase());
    const cities = points.map((p) => p.city.trim());
    const rows = await this.prisma.$queryRaw<
      Array<{ vendor_org_id: string; code: string; city: string }>
    >`
      SELECT vendor_org_id, code, city
        FROM listing.supply_point
       WHERE (city, code) IN (
         SELECT * FROM unnest(${cities}::text[], ${codes}::text[])
       )`;
    return rows.map((r) => ({ vendorOrgId: r.vendor_org_id, code: r.code, city: r.city }));
  }

  /** See `QcExpiryService.warningDays` for why this reads the view, not the table. */
  private async minSampleForHeadline(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${MIN_SAMPLE_KEY}`;
    const value = rows[0]?.value_json;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    // Falling back *upwards* on purpose: if the threshold is unreadable, the safe
    // failure is to publish fewer headline numbers, not more.
    this.logger.warn(`${MIN_SAMPLE_KEY} is unset or malformed; using ${DEFAULT_MIN_SAMPLE}.`);
    return DEFAULT_MIN_SAMPLE;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers. Exported so the anonymity assertion can be a unit test with no
// database behind it — the guarantee is in this shape, so this shape is what a
// test has to be able to hold.
// ---------------------------------------------------------------------------

function accumulate(bucket: Bucket, report: ReportFact): void {
  bucket.unitsInspected += 1;
  if (report.qcScore !== null) bucket.scores.push(report.qcScore);
  if (report.batteryHealthPct !== null) bucket.batteries.push(report.batteryHealthPct);
  if (!bucket.lastInspectedAt || report.completedAt > bucket.lastInspectedAt) {
    bucket.lastInspectedAt = report.completedAt;
  }
}

function summarise(bucket: Bucket): {
  unitsInspected: number;
  avgQcScore: number | null;
  medianQcScore: number | null;
  batteryHealthMin: number | null;
  batteryHealthMax: number | null;
  lastInspectedAt: Date | null;
} {
  return {
    unitsInspected: bucket.unitsInspected,
    avgQcScore: mean(bucket.scores),
    medianQcScore: median(bucket.scores),
    // The columns are INT. Rounding outwards keeps the advertised range from
    // being narrower than the machines actually are.
    batteryHealthMin: bucket.batteries.length ? Math.floor(Math.min(...bucket.batteries)) : null,
    batteryHealthMax: bucket.batteries.length ? Math.ceil(Math.max(...bucket.batteries)) : null,
    lastInspectedAt: bucket.lastInspectedAt,
  };
}

/**
 * `1 − (corrections ÷ units inspected)`, as a percentage.
 *
 * Clamped to [0, 100] because one machine can be corrected more than once — a
 * re-inspection after a dispute writes a second `grade_correction` row — and an
 * unclamped ratio would then read as a negative accuracy, which is not a thing.
 * Null on a zero denominator: no inspections is not 100% accurate.
 */
function accuracy(unitsInspected: number, corrections: number): { gradeAccuracyPct: number | null } {
  if (unitsInspected <= 0) return { gradeAccuracyPct: null };
  const pct = (1 - corrections / unitsInspected) * 100;
  return { gradeAccuracyPct: Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100 };
}

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(value * 100) / 100;
}

/** What a stored row looks like to the presenter. Both quality tables satisfy it. */
export interface QualityFacts {
  unitsInspected: number;
  avgQcScore: number | null;
  gradeAccuracyPct: number | null;
  batteryHealthMin: number | null;
  batteryHealthMax: number | null;
  lastInspectedAt: Date | null;
  computedAt: Date;
}

/**
 * Stored row plus supply point in, buyer-facing row out.
 *
 * The only function that produces a `SupplyPointQuality`, so it is the only
 * place the vendor's org id could leak — and it does not take one. That is not
 * an accident of the signature; it is the guarantee, written as a parameter list.
 */
export function present(
  point: SupplyPointRef,
  skuId: string | null,
  grade: Grade | null,
  facts: QualityFacts,
  minSampleForHeadline: number,
): SupplyPointQuality {
  const headline = qualityHeadline({
    unitsInspected: facts.unitsInspected,
    avgQcScore: facts.avgQcScore,
    gradeAccuracyPct: facts.gradeAccuracyPct,
    minSampleForHeadline,
  });

  return {
    supplyPointCode: point.code,
    city: point.city,
    label: supplyPointLabel(point.code, point.city),
    skuId,
    grade,
    headline,
    batteryHealth:
      headline.kind === 'SCORE' &&
      facts.batteryHealthMin !== null &&
      facts.batteryHealthMax !== null
        ? { minPct: facts.batteryHealthMin, maxPct: facts.batteryHealthMax }
        : null,
    lastInspectedAt: facts.lastInspectedAt ? facts.lastInspectedAt.toISOString() : null,
    computedAt: facts.computedAt.toISOString(),
  };
}
