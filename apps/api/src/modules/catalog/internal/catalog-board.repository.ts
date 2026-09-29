import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/db/prisma.service';

export interface CatalogBrandOption {
  id: string;
  name: string;
  skuCount: number;
}

export interface CatalogBoardSku {
  id: string;
  skuCode: string;
  /** The whole configuration on one line — kept for callers that print it as one. */
  label: string;
  isActive: boolean;
  liveListingCount: number;
  /** The same configuration as columns, for a board that shows one per cell. */
  cpuFamily: string;
  cpuModel: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  screenSizeInch: number;
  resolution: string;
}

export interface CatalogBoardRow {
  brandId: string;
  brandName: string;
  seriesName: string;
  modelId: string;
  modelName: string;
  /** Every configuration the model has — the whole model, whatever the page's filter. */
  modelSkuCount: number;
  /** Live listings across every one of the model's configurations, likewise. */
  modelLiveListingCount: number;
  sku: CatalogBoardSku;
}

export interface CatalogBoardPage {
  rows: CatalogBoardRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** The two selects on the board: what the catalog actually contains, not a hardcoded list. */
export interface CatalogBoardFacets {
  cpuFamilies: string[];
  ramGb: number[];
}

export interface CatalogBoardFilter {
  q?: string;
  brandId?: string;
  modelId?: string;
  cpuFamily?: string;
  ramGb?: number;
  /** Only SKUs with at least one live listing. */
  liveOnly?: boolean;
}

interface RawBoardRow {
  brand_id: string;
  brand_name: string;
  series_name: string;
  model_id: string;
  model_name: string;
  model_sku_count: number;
  sku_id: string;
  sku_code: string;
  cpu_family: string;
  cpu_model: string;
  ram_gb: number;
  storage_gb: number;
  storage_type: string;
  screen_size_inch: unknown;
  resolution: string;
  is_active: boolean;
}

/** One configuration line — same join the tree endpoint uses. */
function skuLabel(r: RawBoardRow): string {
  return [
    r.cpu_model,
    `${r.ram_gb} GB`,
    `${r.storage_gb} GB ${r.storage_type}`,
    `${Number(r.screen_size_inch)}" ${r.resolution}`,
  ].join(' · ');
}

/** The active brand → series → model → SKU join every query here starts from. */
const FROM_ACTIVE_CATALOG = Prisma.sql`
  FROM catalog.brand b
  JOIN catalog.series se ON se.brand_id = b.id AND se.is_active
  JOIN catalog.model  m  ON m.series_id = se.id AND m.is_active
  JOIN catalog.sku    s  ON s.model_id  = m.id`;

/**
 * The console catalog board — flat, filterable, paginated SKUs.
 *
 * The nested tree is kept for callers that still want it; this is what a board
 * with URL state and `LIMIT`/`OFFSET` actually needs.
 *
 * Live-listing figures come from `listing.listing` in their own single-schema
 * queries and are folded in here rather than JOINed — the module rule is no
 * cross-schema JOINs, and the "only live" filter therefore resolves the SKU ids
 * first and filters on them, rather than joining across.
 */
@Injectable()
export class CatalogBoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listBrands(): Promise<CatalogBrandOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; sku_count: number }>>`
      SELECT b.id, b.name, count(s.id)::int AS sku_count
      ${FROM_ACTIVE_CATALOG}
       WHERE b.is_active
       GROUP BY b.id, b.name
       ORDER BY b.name`;
    return rows.map((r) => ({ id: r.id, name: r.name, skuCount: r.sku_count }));
  }

  async listFacets(): Promise<CatalogBoardFacets> {
    const [cpu, ram] = await Promise.all([
      this.prisma.$queryRaw<Array<{ cpu_family: string }>>`
        SELECT DISTINCT s.cpu_family
        ${FROM_ACTIVE_CATALOG}
         WHERE b.is_active
         ORDER BY s.cpu_family`,
      this.prisma.$queryRaw<Array<{ ram_gb: number }>>`
        SELECT DISTINCT s.ram_gb
        ${FROM_ACTIVE_CATALOG}
         WHERE b.is_active
         ORDER BY s.ram_gb`,
    ]);
    return {
      cpuFamilies: cpu.map((r) => r.cpu_family),
      ramGb: ram.map((r) => r.ram_gb),
    };
  }

  async listSkus(
    filter: CatalogBoardFilter,
    page: { page: number; pageSize: number },
  ): Promise<CatalogBoardPage> {
    const live = await this.liveListingCounts();

    const conditions: Prisma.Sql[] = [
      Prisma.sql`b.is_active AND se.is_active AND m.is_active`,
    ];
    if (filter.brandId) {
      conditions.push(Prisma.sql`b.id = ${filter.brandId}::uuid`);
    }
    if (filter.modelId) {
      conditions.push(Prisma.sql`m.id = ${filter.modelId}::uuid`);
    }
    if (filter.cpuFamily) {
      conditions.push(Prisma.sql`s.cpu_family = ${filter.cpuFamily}`);
    }
    if (filter.ramGb !== undefined) {
      conditions.push(Prisma.sql`s.ram_gb = ${filter.ramGb}`);
    }
    if (filter.liveOnly) {
      const ids = [...live.keys()];
      conditions.push(
        ids.length === 0
          ? Prisma.sql`FALSE`
          : Prisma.sql`s.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`,
      );
    }
    const q = filter.q?.trim().toLowerCase();
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(Prisma.sql`(
        lower(
          b.name || ' ' || se.name || ' ' || m.name || ' ' || s.sku_code || ' ' ||
          s.cpu_model || ' ' || s.ram_gb::text || ' ' || s.storage_gb::text || ' ' ||
          s.storage_type || ' ' || s.resolution
        ) LIKE ${pattern}
      )`);
    }
    const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const offset = (page.page - 1) * page.pageSize;

    const [{ count: total } = { count: 0 }] = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      ${FROM_ACTIVE_CATALOG}
      ${where}`;

    const raw = await this.prisma.$queryRaw<RawBoardRow[]>`
      SELECT b.id AS brand_id, b.name AS brand_name,
             se.name AS series_name,
             m.id AS model_id, m.name AS model_name,
             (SELECT count(*)::int FROM catalog.sku s2 WHERE s2.model_id = m.id) AS model_sku_count,
             s.id AS sku_id, s.sku_code, s.cpu_family, s.cpu_model, s.ram_gb, s.storage_gb,
             s.storage_type, s.screen_size_inch, s.resolution, s.is_active
      ${FROM_ACTIVE_CATALOG}
      ${where}
       ORDER BY b.name, se.name, m.name, s.sku_code
       LIMIT ${page.pageSize} OFFSET ${offset}`;

    const modelLive = await this.liveListingCountsByModel(
      [...new Set(raw.map((r) => r.model_id))],
      live,
    );

    return {
      rows: raw.map((r) => ({
        brandId: r.brand_id,
        brandName: r.brand_name,
        seriesName: r.series_name,
        modelId: r.model_id,
        modelName: r.model_name,
        modelSkuCount: r.model_sku_count,
        modelLiveListingCount: modelLive.get(r.model_id) ?? 0,
        sku: {
          id: r.sku_id,
          skuCode: r.sku_code,
          label: skuLabel(r),
          isActive: r.is_active,
          liveListingCount: live.get(r.sku_id) ?? 0,
          cpuFamily: r.cpu_family,
          cpuModel: r.cpu_model,
          ramGb: r.ram_gb,
          storageGb: r.storage_gb,
          storageType: r.storage_type,
          screenSizeInch: Number(r.screen_size_inch),
          resolution: r.resolution,
        },
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  private async liveListingCounts(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<Array<{ sku_id: string; n: number }>>`
      SELECT sku_id, count(*)::int AS n
        FROM listing.listing
       WHERE status IN ('ACTIVE', 'PARTIALLY_ACTIVE')
       GROUP BY sku_id`;
    return new Map(rows.map((r) => [r.sku_id, r.n]));
  }

  /**
   * Live listings per model, across ALL of the model's SKUs — not only the ones
   * on this page, which is what summing the page's rows would have said. A
   * model header that reads "1 live listing" has to mean the model.
   */
  private async liveListingCountsByModel(
    modelIds: string[],
    liveBySku: Map<string, number>,
  ): Promise<Map<string, number>> {
    if (modelIds.length === 0) return new Map();
    const skus = await this.prisma.$queryRaw<Array<{ id: string; model_id: string }>>`
      SELECT id, model_id
        FROM catalog.sku
       WHERE model_id IN (${Prisma.join(modelIds.map((id) => Prisma.sql`${id}::uuid`))})`;
    const out = new Map<string, number>();
    for (const s of skus) {
      const n = liveBySku.get(s.id) ?? 0;
      if (n > 0) out.set(s.model_id, (out.get(s.model_id) ?? 0) + n);
    }
    return out;
  }
}
