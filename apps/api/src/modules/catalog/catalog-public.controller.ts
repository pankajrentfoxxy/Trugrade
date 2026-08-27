import { Controller, Get, Header, Query } from '@nestjs/common';
import { Public } from '../../shared/auth/guards';
import { PrismaService } from '../../shared/db/prisma.service';
import { ListingService } from '../listing';
import { OrderingService } from '../ordering';
import { QcService } from '../qc';
import {
  runSearch,
  SORTS,
  type CatalogRow,
  type SearchQuery,
  type SearchResponse,
  type SearchRow,
  type SortKey,
} from './internal/search-facets';

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

  /**
   * Faceted search — the whole of `09_FRONTEND_LOCKED.md` §6 in one response.
   *
   * Results AND facet counts come back together because they are one answer: a
   * count computed by a second request is a count from a different instant, and
   * a rail that disagrees with the grid beside it is worse than no counts.
   *
   * Composed from two reads rather than one join, for the reason `brands` and
   * `offers` above give: what a machine IS belongs to catalog and what was
   * MEASURED belongs to listing, and a query spanning both would be a third
   * definition of a SKU living in a controller.
   */
  @Get('search')
  @Public()
  @Header('Cache-Control', 'public, max-age=30')
  async search(@Query() query: Record<string, string | string[]>): Promise<SearchResponse> {
    const q = parseSearchQuery(query);
    const [units, catalog] = await Promise.all([this.listings.sellableUnitFacts(), this.skuSpecs()]);

    const bySku = new Map(catalog.map((c) => [c.skuId, c]));
    const rows: SearchRow[] = units.flatMap((u) => {
      const c = bySku.get(u.skuId);
      // A unit whose SKU went inactive between the two reads is dropped rather
      // than rendered as a nameless card. There is no honest way to show it.
      if (!c) return [];
      return [
        {
          ...c,
          skuId: u.skuId,
          grade: u.grade,
          price: Number(u.retailPrice),
          battery: u.batteryHealthPct,
          score: u.qcScore,
          supplyPointCode: u.supplyPointCode,
          city: u.city,
          shipHours: u.dispatchSlaHours,
          warrantyMonths: u.warrantyMonths,
          serial: u.serialNumber,
        },
      ];
    });

    const answer = runSearch(rows, catalog, q);

    // Two dimensions the rail must show and that nothing measures yet. They come
    // back as an explicit "not recorded" rather than as rows of zeroes: "we did
    // not measure this" and "we measured and found none" are different
    // statements, and printing the second when the first is true is the exact
    // failure the design system spends a paragraph on.
    answer.facets.cycles = {
      key: 'cycles',
      options: [],
      unavailable: 'Battery cycle count is not recorded at inspection yet.',
    };
    answer.facets.charger = {
      key: 'charger',
      options: [],
      unavailable: 'Whether a charger is included is not recorded at inspection yet.',
    };
    return answer;
  }

  /**
   * Every active SKU's specification — the source of facet OPTIONS.
   *
   * The whole catalogue, not the part with stock: an option that disappears the
   * moment it hits zero makes people think the site is broken, so "Dell — 0,
   * disabled" has to be renderable, and that needs Dell to be in the list.
   */
  private async skuSpecs(): Promise<CatalogRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        brand_slug: string;
        brand_name: string;
        series_name: string;
        model_name: string;
        cpu_family: string;
        cpu_model: string;
        cpu_generation: string;
        ram_gb: number;
        storage_gb: number;
        storage_type: string;
        screen: unknown;
        resolution: string;
        is_touch: boolean;
        backlit_keyboard: boolean | null;
        fingerprint_reader: boolean | null;
        ports_json: unknown;
      }>
    >`
      SELECT s.id, b.slug AS brand_slug, b.name AS brand_name, se.name AS series_name,
             m.name AS model_name, s.cpu_family, s.cpu_model, s.cpu_generation,
             s.ram_gb, s.storage_gb, s.storage_type::text AS storage_type,
             s.screen_size_inch AS screen, s.resolution, s.is_touch,
             s.backlit_keyboard, s.fingerprint_reader, s.ports_json
        FROM catalog.sku s
        JOIN catalog.model m   ON m.id = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand b   ON b.id = se.brand_id
       WHERE s.is_active`;

    return rows.map((r) => ({
      skuId: r.id,
      brandSlug: r.brand_slug,
      brandName: r.brand_name,
      seriesName: r.series_name,
      modelName: r.model_name,
      cpuFamily: r.cpu_family,
      cpuModel: r.cpu_model,
      cpuGeneration: r.cpu_generation,
      ramGb: Number(r.ram_gb),
      storageGb: Number(r.storage_gb),
      storageType: r.storage_type,
      screenInch: Number(r.screen),
      resolution: r.resolution,
      isTouch: r.is_touch,
      backlit: r.backlit_keyboard === true,
      fingerprint: r.fingerprint_reader === true,
      thunderbolt: Array.isArray(r.ports_json)
        ? r.ports_json.some((port) => typeof port === 'string' && /thunderbolt/i.test(port))
        : false,
    }));
  }
}

/* ==========================================================================
 * Query parsing — the URL is the state
 * ======================================================================== */

const asArray = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v.filter((s) => s !== '') : v === '' ? [] : [v];

const asNumbers = (v: string | string[] | undefined): number[] =>
  asArray(v)
    .map(Number)
    .filter((n) => Number.isFinite(n));

/** A malformed number is absent, never zero: `?bmin=abc` must not mean 0%. */
const asNumber = (v: string | string[] | undefined, min: number, max: number): number | null => {
  const raw = asArray(v)[0];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : null;
};

const PER_PAGE = [4, 12, 24, 48];

export function parseSearchQuery(query: Record<string, string | string[]>): SearchQuery {
  const sort = asArray(query.sort)[0];
  const per = asNumber(query.per, 1, 48);
  return {
    q: asArray(query.q)[0] ?? '',
    brand: asArray(query.brand),
    series: asArray(query.series),
    cpu: asArray(query.cpu),
    gen: asArray(query.gen),
    ram: asNumbers(query.ram),
    sgb: asNumbers(query.sgb),
    stype: asArray(query.stype),
    grade: asArray(query.grade).filter((g) => g === 'A_PLUS' || g === 'A' || g === 'B'),
    bmin: asNumber(query.bmin, 0, 100),
    bmax: asNumber(query.bmax, 0, 100),
    smin: asNumber(query.smin, 0, 100),
    pmin: asNumber(query.pmin, 0, Number.MAX_SAFE_INTEGER),
    pmax: asNumber(query.pmax, 0, Number.MAX_SAFE_INTEGER),
    screen: asNumbers(query.screen),
    res: asArray(query.res).filter((r) => r === 'fhd' || r === 'touch'),
    ship: asNumbers(query.ship),
    city: asArray(query.city),
    qty: asNumber(query.qty, 1, 1000),
    feat: asArray(query.feat),
    warr: asNumbers(query.warr),
    sort: (SORTS.some((s) => s.value === sort) ? sort : 'price') as SortKey,
    page: asNumber(query.page, 1, 10000) ?? 1,
    per: per !== null && PER_PAGE.includes(per) ? per : 12,
  };
}
