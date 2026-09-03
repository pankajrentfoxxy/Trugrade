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
  label: string;
  isActive: boolean;
  liveListingCount: number;
}

export interface CatalogBoardRow {
  brandId: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  sku: CatalogBoardSku;
}

export interface CatalogBoardPage {
  rows: CatalogBoardRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface RawBoardRow {
  brand_id: string;
  brand_name: string;
  series_name: string;
  model_name: string;
  sku_id: string;
  sku_code: string;
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

/**
 * The console catalog board — flat, filterable, paginated SKUs.
 *
 * The nested tree is kept for callers that still want it; this is what a board
 * with URL state and `LIMIT`/`OFFSET` actually needs.
 */
@Injectable()
export class CatalogBoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listBrands(): Promise<CatalogBrandOption[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string; sku_count: number }>>`
      SELECT b.id, b.name, count(s.id)::int AS sku_count
        FROM catalog.brand b
        JOIN catalog.series se ON se.brand_id = b.id AND se.is_active
        JOIN catalog.model  m  ON m.series_id = se.id AND m.is_active
        JOIN catalog.sku    s  ON s.model_id  = m.id
       WHERE b.is_active
       GROUP BY b.id, b.name
       ORDER BY b.name`;
    return rows.map((r) => ({ id: r.id, name: r.name, skuCount: r.sku_count }));
  }

  async listSkus(
    filter: { q?: string; brandId?: string },
    page: { page: number; pageSize: number },
  ): Promise<CatalogBoardPage> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`b.is_active AND se.is_active AND m.is_active`,
    ];
    if (filter.brandId) {
      conditions.push(Prisma.sql`b.id = ${filter.brandId}::uuid`);
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
        FROM catalog.brand b
        JOIN catalog.series se ON se.brand_id = b.id AND se.is_active
        JOIN catalog.model  m  ON m.series_id = se.id AND m.is_active
        JOIN catalog.sku    s  ON s.model_id  = m.id
      ${where}`;

    const raw = await this.prisma.$queryRaw<RawBoardRow[]>`
      SELECT b.id AS brand_id, b.name AS brand_name,
             se.name AS series_name,
             m.name AS model_name,
             s.id AS sku_id, s.sku_code, s.cpu_model, s.ram_gb, s.storage_gb,
             s.storage_type, s.screen_size_inch, s.resolution, s.is_active
        FROM catalog.brand b
        JOIN catalog.series se ON se.brand_id = b.id AND se.is_active
        JOIN catalog.model  m  ON m.series_id = se.id AND m.is_active
        JOIN catalog.sku    s  ON s.model_id  = m.id
      ${where}
       ORDER BY b.name, se.name, m.name, s.sku_code
       LIMIT ${page.pageSize} OFFSET ${offset}`;

    const live = await this.liveListingCounts();

    return {
      rows: raw.map((r) => ({
        brandId: r.brand_id,
        brandName: r.brand_name,
        seriesName: r.series_name,
        modelName: r.model_name,
        sku: {
          id: r.sku_id,
          skuCode: r.sku_code,
          label: skuLabel(r),
          isActive: r.is_active,
          liveListingCount: live.get(r.sku_id) ?? 0,
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
}
