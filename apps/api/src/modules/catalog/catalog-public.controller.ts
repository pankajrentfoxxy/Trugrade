import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../shared/auth/guards';
import { PrismaService } from '../../shared/db/prisma.service';
import { ListingService } from '../listing';
import { OrderingService } from '../ordering';
import { QcService } from '../qc';

/**
 * The storefront's public read surface.
 *
 * Phase 5 Task 2 item 1 asks for "a live inspection counter (real number from
 * the database, **not** a fake scarcity device; CCPA Dark Patterns Guidelines
 * 2023 prohibit invented urgency)". This is that number, and the reason it is an
 * endpoint rather than a constant in the page: a constant cannot go down, and a
 * counter that only ever goes up is a scarcity device wearing a fact's clothes.
 *
 * Nothing here can carry vendor identity. The counts are aggregates over the
 * whole platform and the brand list is catalogue data, so there is no supply
 * point, org id or price in any response.
 *
 * Every figure that is not catalog's own comes from the owning module's service,
 * not from a join. That is not ceremony: `sellable` is a definition living in
 * `listing.v_sellable_unit` and `DELIVERED` is a state in ordering's machine, and
 * a page that re-states either one in its own SQL is a second definition that
 * drifts from the first without anything failing. The counts are fetched in
 * parallel and assembled here, which is what the JOIN was doing anyway.
 */
@Controller('public')
export class CatalogPublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingService,
    private readonly qc: QcService,
    private readonly ordering: OrderingService,
  ) {}

  /**
   * What we can honestly say about the platform right now.
   *
   * Every figure comes back with the denominator it was computed over, because
   * the storefront's `Evidence` component suppresses a headline number below its
   * sample threshold — and it can only do that if it is told the sample size.
   * On a new platform that means the page says "0 units inspected" rather than
   * an impressive percentage, which is the correct thing for it to say.
   */
  @Get('stats')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  async stats(): Promise<{
    unitsInspected: number;
    unitsSellable: number;
    skusCatalogued: number;
    brandsCatalogued: number;
    ordersDelivered: number;
    unitsReturned: number;
  }> {
    const [catalogCounts, stock, unitsInspected, ordersDelivered] = await Promise.all([
      this.prisma.$queryRaw<Array<{ skus: bigint; brands: bigint }>>`
        SELECT (SELECT count(*) FROM catalog.sku WHERE is_active) AS skus,
               (SELECT count(*) FROM catalog.brand)               AS brands`,
      this.listings.publicStockCounts(),
      this.qc.countCurrentReports(),
      this.ordering.countDelivered(),
    ]);

    const c = catalogCounts[0];
    return {
      unitsInspected,
      unitsSellable: stock.sellable,
      skusCatalogued: Number(c?.skus ?? 0),
      brandsCatalogued: Number(c?.brands ?? 0),
      ordersDelivered,
      unitsReturned: stock.returnedToVendor,
    };
  }

  /**
   * Shop-by-brand, with real counts.
   *
   * Counts sellable units, not catalogue entries: a brand tile promising stock
   * that turns out to be an empty search is the same broken promise as a fake
   * scarcity badge, just quieter.
   */
  @Get('brands')
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  async brands(): Promise<Array<{ name: string; slug: string; skuCount: number; inStock: number }>> {
    // The brand of a SKU is catalog's fact; the stock behind it is listing's.
    // Neither half can be read from the other's schema, so the two are fetched
    // in parallel and summed here on `sku_id` — the same key the JOIN used.
    const [rows, sellableBySku] = await Promise.all([
      // Inner join throughout, so a brand with no active SKU produces no row and
      // therefore no tile — a tile leading to an empty search is the same broken
      // promise this endpoint exists to avoid.
      this.prisma.$queryRaw<Array<{ name: string; slug: string; sku_id: string }>>`
        SELECT b.name, b.slug, s.id AS sku_id
          FROM catalog.brand b
          JOIN catalog.series se ON se.brand_id = b.id
          JOIN catalog.model m   ON m.series_id = se.id
          JOIN catalog.sku s     ON s.model_id = m.id AND s.is_active
         ORDER BY b.name`,
      this.listings.countSellableBySku(),
    ]);

    // A Set per brand, because a SKU reachable through more than one row must be
    // counted once — the `DISTINCT s.id` the JOIN used to do.
    const byBrand = new Map<string, { name: string; slug: string; skuIds: Set<string> }>();
    for (const r of rows) {
      const brand = byBrand.get(r.slug) ?? { name: r.name, slug: r.slug, skuIds: new Set() };
      brand.skuIds.add(r.sku_id);
      byBrand.set(r.slug, brand);
    }

    return [...byBrand.values()].map((b) => ({
      name: b.name,
      slug: b.slug,
      skuCount: b.skuIds.size,
      inStock: [...b.skuIds].reduce((n, id) => n + (sellableBySku.get(id) ?? 0), 0),
    }));
  }

  /**
   * The offer grid: one row per (SKU, inspected grade), from sellable units only.
   *
   * Aggregated rather than listed serial by serial, because the buyer's first
   * decision is which machine and the second is which supply point. Aggregating
   * is also what keeps the row anonymous: it carries a price RANGE and a COUNT
   * of supply points, never a vendor.
   */
  @Get('offers')
  @Public()
  @Header('Cache-Control', 'public, max-age=30')
  async offers(): Promise<unknown> {
    // Two halves, composed on sku_id, exactly as `brands` above does it.
    // Stock is listing's fact and the model behind a SKU is catalog's, and a
    // JOIN across the two would be a second definition of a SKU living in a
    // page query — which is what no-cross-schema-join exists to stop.
    const stock = await this.listings.publicOffers(24);
    if (stock.length === 0) return [];

    const ids = [...new Set(stock.map((o) => o.skuId))];
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        brand: string;
        model: string;
        cpu: string | null;
        ram_gb: number | null;
        storage_gb: number | null;
        storage_type: string | null;
        screen: unknown;
      }>
    >`
      SELECT s.id, b.name AS brand, m.name AS model, s.cpu_model AS cpu,
             s.ram_gb, s.storage_gb, s.storage_type::text AS storage_type,
             s.screen_size_inch AS screen
        FROM catalog.sku s
        JOIN catalog.model m   ON m.id = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand b   ON b.id = se.brand_id
       WHERE s.id = ANY(${ids}::uuid[])`;

    const bySku = new Map(rows.map((r) => [r.id, r]));

    return stock.flatMap((o) => {
      const c = bySku.get(o.skuId);
      // A SKU that vanished between the two reads is dropped rather than
      // rendered as a nameless card. There is no honest way to show it.
      if (!c) return [];
      return [
        {
          ...o,
          brand: c.brand,
          model: c.model,
          spec: [
            c.cpu,
            c.ram_gb ? `${c.ram_gb} GB` : null,
            c.storage_gb
              ? `${c.storage_gb} GB ${(c.storage_type ?? '').replace('_', ' ').toUpperCase()}`.trim()
              : null,
            c.screen ? `${Number(c.screen)}"` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        },
      ];
    });
  }

  /**
   * The grade bands, straight from `catalog.grade_definition`.
   *
   * Pulled from the database rather than written into the page so the marketing
   * copy cannot drift from what QC actually enforces — which is the whole point
   * of Phase 5 Task 2 item 7, and a r.7(5) exposure if it drifts.
   */
  @Get('grades')
  @Public()
  @Header('Cache-Control', 'public, max-age=300')
  async grades(): Promise<
    Array<{ grade: string; customerDescription: string; minBatteryHealthPct: number | null }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ grade: string; customer_description: string; min_battery_health_pct: unknown }>
    >`
      SELECT grade::text AS grade, customer_description, min_battery_health_pct
        FROM catalog.grade_definition
       WHERE effective_to IS NULL
       ORDER BY CASE grade::text WHEN 'A_PLUS' THEN 1 WHEN 'A' THEN 2 ELSE 3 END`;

    return rows.map((r) => ({
      grade: r.grade,
      customerDescription: r.customer_description,
      minBatteryHealthPct:
        r.min_battery_health_pct === null ? null : Number(r.min_battery_health_pct),
    }));
  }
}
