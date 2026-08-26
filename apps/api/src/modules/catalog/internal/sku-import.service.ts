import { Injectable } from '@nestjs/common';
import {
  parseSkuCsv,
  dryRun,
  errorReportCsv,
  type DryRunReport,
  type SkuImportRow,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { ValidationError } from '../../../shared/errors/domain-errors';

/**
 * Bulk SKU import.
 *
 * Two guarantees, and the tests exist for both:
 *
 *   1. **A dry run writes nothing.** It is a read-only classification of every
 *      row against what is already in the catalog. Ops looks at 200 outcomes
 *      before committing anything.
 *   2. **Commit is idempotent on `normalized_key`.** Re-running the same file
 *      updates rather than duplicating, which matters because the realistic
 *      failure is a half-finished run somebody repeats.
 */

export interface ImportResult {
  created: number;
  merged: number;
  skipped: number;
  report: DryRunReport;
  errorReportCsv: string;
}

@Injectable()
export class SkuImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /** Every key already in the catalog, for classification. */
  private async existingKeys(): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ normalized_key: string; sku_code: string }>
    >`SELECT normalized_key, sku_code FROM catalog.sku`;
    return new Map(rows.map((r) => [r.normalized_key, r.sku_code]));
  }

  /** Classify without writing. Safe to call as often as ops likes. */
  async dryRun(csv: string): Promise<DryRunReport> {
    return dryRun(parseSkuCsv(csv), await this.existingKeys());
  }

  /**
   * Commit.
   *
   * Rows that failed validation are skipped, never guessed at — an import that
   * silently drops a third of the file is worse than one that refuses. The
   * report is returned either way so the caller can show what happened.
   */
  async commit(csv: string, actorId: string): Promise<ImportResult> {
    const parsed = parseSkuCsv(csv);
    if (parsed.fileErrors.length > 0) {
      throw new ValidationError(parsed.fileErrors.join(' '), { file: parsed.fileErrors[0]! });
    }

    const report = dryRun(parsed, await this.existingKeys());
    let created = 0;
    let merged = 0;

    for (const row of parsed.rows) {
      if (!row.value) continue;
      const outcome = await this.upsert(row.value, actorId);
      if (outcome === 'created') created++;
      else merged++;
    }

    return {
      created,
      merged,
      skipped: report.errors,
      report,
      errorReportCsv: errorReportCsv(report),
    };
  }

  /**
   * One row, in its own transaction.
   *
   * Per-row rather than one transaction for the file: a 200-row import that
   * rolls back entirely because line 173 has a typo wastes the 172 good rows,
   * and ops then has to edit the file and re-run the whole thing. The dry run is
   * what makes partial application safe to offer — nobody commits without having
   * seen the outcomes first.
   */
  private async upsert(row: SkuImportRow, actorId: string): Promise<'created' | 'merged'> {
    return this.prisma.runInTransaction(async () => {
      const brandId = await this.ensureBrand(row.brand);
      const seriesId = await this.ensureSeries(brandId, row.series);
      const modelId = await this.ensureModel(seriesId, row.model);

      const [existing] = await this.prisma.$queryRaw<Array<{ id: string; sku_code: string }>>`
        SELECT id, sku_code FROM catalog.sku WHERE normalized_key = ${row.normalizedKey}`;

      if (existing) {
        // Merge: refresh the descriptive fields, never the key or the code. The
        // code is on purchase orders and in warehouse conversation, so changing
        // it would break the paper trail for a cosmetic gain.
        await this.prisma.$executeRaw`
          UPDATE catalog.sku
             SET cpu_brand = ${row.cpuBrand}, cpu_family = ${row.cpuFamily},
                 cpu_generation = ${row.cpuGeneration}, gpu_model = ${row.gpuModel},
                 hsn_code = ${row.hsnCode}, updated_at = ${this.clock.now()}
           WHERE id = ${existing.id}::uuid`;

        await this.logChange(existing.id, 'sku', 'UPDATE', 'bulk import', actorId);
        return 'merged';
      }

      const skuCode = row.skuCode ?? (await this.generateSkuCode(row));
      const [inserted] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO catalog.sku
          (model_id, sku_code, normalized_key, cpu_brand, cpu_family, cpu_model,
           cpu_generation, ram_gb, storage_type, storage_gb, gpu_type, gpu_model,
           screen_size_inch, resolution, is_touch, os_supported, hsn_code, created_by)
        VALUES (${modelId}::uuid, ${skuCode}, ${row.normalizedKey}, ${row.cpuBrand},
                ${row.cpuFamily}, ${row.cpuModel}, ${row.cpuGeneration}, ${row.ramGb},
                ${row.storageType}, ${row.storageGb}, ${row.gpuType}, ${row.gpuModel},
                ${row.screenSizeIn}, ${row.resolution}, ${row.isTouch}, ${row.os},
                ${row.hsnCode}, ${actorId}::uuid)
        RETURNING id`;

      await this.logChange(inserted!.id, 'sku', 'CREATE', 'bulk import', actorId);
      return 'created';
    });
  }

  private async logChange(
    entityId: string,
    entityType: string,
    action: string,
    reason: string,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO catalog.catalog_change_log
        (entity_type, entity_id, sku_id, action, field, new_value, reason, changed_by)
      VALUES (${entityType}, ${entityId}::uuid,
              ${entityType === 'sku' ? entityId : null}::uuid,
              ${action}, 'row', 'imported', ${reason}, ${actorId}::uuid)`;
  }

  private slug(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async ensureBrand(name: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO catalog.brand (name, slug) VALUES (${name}, ${this.slug(name)})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    return rows[0]!.id;
  }

  private async ensureSeries(brandId: string, name: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO catalog.series (brand_id, name, slug)
      VALUES (${brandId}::uuid, ${name}, ${this.slug(name)})
      ON CONFLICT (brand_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    return rows[0]!.id;
  }

  private async ensureModel(seriesId: string, name: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO catalog.model (series_id, name)
      VALUES (${seriesId}::uuid, ${name})
      ON CONFLICT (series_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    return rows[0]!.id;
  }

  /**
   * A readable code when the file did not supply one: DEL-LAT5420-I5-16-512.
   * Uniqueness is the database's job; this only has to be legible on a PO.
   */
  private async generateSkuCode(row: SkuImportRow): Promise<string> {
    const part = (s: string, n: number): string =>
      s
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, n);

    const base = [
      part(row.brand, 3),
      part(row.model, 7),
      part(row.cpuModel, 4),
      String(row.ramGb),
      String(row.storageGb),
    ].join('-');

    const [clash] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM catalog.sku WHERE sku_code LIKE ${base + '%'}`;
    const n = Number(clash!.n);
    return n === 0 ? base : `${base}-${n + 1}`;
  }
}
