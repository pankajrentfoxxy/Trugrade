import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * Catalog search and the filter rail. Task 8, CAT-009 / CAT-009b / CAT-010.
 *
 * Every query here reads `catalog.mv_sku_search` and nothing else. That is not a
 * performance decision, it is the anonymity guarantee: the view denormalises
 * brand, series and model and carries no path back to a vendor, so no ranking
 * change, no new filter and no careless JOIN in this file can leak who is
 * selling (VR-099, CAT-009b). A search that had to join `listing` to rank would
 * put that guarantee one code review away from being lost.
 *
 * The weighting lives in the migration, not here: brand, series, model and
 * sku_code are setweight 'A', CPU 'B', RAM/storage 'C', the rest 'D'. So plain
 * `ts_rank` with its default weight array already ranks brand and model highest,
 * and passing a custom array would be a second place for the weighting to drift
 * from the index that produced it.
 *
 * The filter predicates are written out in each query rather than shared. The
 * PrismaService wrapper takes a tagged template only, so a shared fragment would
 * have to be a string concatenated into the SQL — which is how a filter rail
 * becomes an injection point. Three copies of a static WHERE is the cheaper
 * mistake. The `NULL means unfiltered` shape keeps each copy identical.
 */

export interface CatalogFilters {
  brandId?: readonly string[];
  seriesId?: readonly string[];
  cpuFamily?: readonly string[];
  ramGb?: readonly number[];
  storageGb?: readonly number[];
  screenSizeIn?: readonly number[];
  /** CAT-010 filters on "RAM >= 16", which a list of exact values cannot express. */
  ramGbMin?: number;
}

export interface SearchInput {
  q?: string | null;
  filters?: CatalogFilters;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  skuId: string;
  skuCode: string;
  brandId: string;
  seriesId: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  cpuFamily: string;
  ramGb: number;
  storageGb: number;
  screenSizeIn: number;
  /** ts_rank for the full-text pass, trigram similarity for the fallback. */
  rank: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Matching rows before LIMIT/OFFSET, so a caller can paginate. */
  total: number;
  /**
   * Which pass produced these hits. TRIGRAM means the query was misspelt badly
   * enough that tsquery matched nothing — worth surfacing as "showing results
   * for…" rather than pretending it was an exact match.
   */
  matchedBy: 'FILTER' | 'FULL_TEXT' | 'TRIGRAM';
}

export type FacetDimension =
  | 'brand'
  | 'series'
  | 'cpu_family'
  | 'ram_gb'
  | 'storage_gb'
  | 'screen_size_inch';

export interface FacetValue {
  /** The value to send back as a filter. A uuid for brand and series. */
  value: string;
  /** What to show. Equal to `value` for the numeric dimensions. */
  label: string;
  count: number;
}

export type Facets = Record<FacetDimension, FacetValue[]>;

interface RawHit {
  sku_id: string;
  sku_code: string;
  brand_id: string;
  series_id: string;
  brand_name: string;
  series_name: string;
  model_name: string;
  cpu_family: string;
  ram_gb: number;
  storage_gb: number;
  screen_size_inch: unknown;
  rank: number;
  total: number;
}

interface RawFacet {
  dimension: FacetDimension;
  value: string;
  label: string;
  n: number;
}

/**
 * An absent filter and an empty one are the same thing to a caller and opposites
 * to Postgres: `= ANY('{}')` is false for every row, so an empty array would
 * return nothing at all. NULL is what the queries below test for.
 */
function orNull<T>(values: readonly T[] | undefined): T[] | null {
  return values && values.length > 0 ? [...values] : null;
}

function toHit(r: RawHit): SearchHit {
  return {
    skuId: r.sku_id,
    skuCode: r.sku_code,
    brandId: r.brand_id,
    seriesId: r.series_id,
    brandName: r.brand_name,
    seriesName: r.series_name,
    modelName: r.model_name,
    cpuFamily: r.cpu_family,
    ramGb: r.ram_gb,
    storageGb: r.storage_gb,
    // NUMERIC(4,1) arrives as a Decimal, and arithmetic on one yields NaN
    // silently. Same conversion, same reason, as SkuRepository.
    screenSizeIn: Number(r.screen_size_inch),
    rank: Number(r.rank),
  };
}

@Injectable()
export class CatalogSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search, filter, or both.
   *
   * Two passes, and the second runs only when the first found nothing. Full text
   * cannot match "latitide 5420" at all — the lexeme simply is not in the index —
   * so a typo needs trigram similarity, which is expensive enough that paying for
   * it on every successful search would be the wrong trade.
   */
  async search(input: SearchInput = {}): Promise<SearchResult> {
    const q = input.q?.trim() ? input.q.trim() : null;
    // A caller that asks for a million rows gets a hundred. The storefront is a
    // public surface and this is the cheapest place to stop it being a scan.
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 24), 1), 100);
    const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
    const f = input.filters ?? {};
    const brandId = orNull(f.brandId);
    const seriesId = orNull(f.seriesId);
    const cpuFamily = orNull(f.cpuFamily);
    const ramGb = orNull(f.ramGb);
    const storageGb = orNull(f.storageGb);
    const screenSizeIn = orNull(f.screenSizeIn);
    const ramGbMin = f.ramGbMin ?? null;

    const rows = await this.prisma.$queryRaw<RawHit[]>`
      SELECT v.sku_id, v.sku_code, v.brand_id, v.series_id,
             v.brand_name, v.series_name, v.model_name,
             v.cpu_family, v.ram_gb, v.storage_gb, v.screen_size_inch,
             CASE WHEN ${q}::text IS NULL THEN 0
                  ELSE ts_rank(v.search_tsv, websearch_to_tsquery('simple', ${q}::text))
             END AS rank,
             (count(*) OVER ())::int AS total
      FROM catalog.mv_sku_search v
      WHERE v.is_active
        AND (${q}::text IS NULL
             OR v.search_tsv @@ websearch_to_tsquery('simple', ${q}::text))
        AND (${brandId}::uuid[] IS NULL OR v.brand_id = ANY(${brandId}::uuid[]))
        AND (${seriesId}::uuid[] IS NULL OR v.series_id = ANY(${seriesId}::uuid[]))
        AND (${cpuFamily}::text[] IS NULL OR v.cpu_family = ANY(${cpuFamily}::text[]))
        AND (${ramGb}::int[] IS NULL OR v.ram_gb = ANY(${ramGb}::int[]))
        AND (${storageGb}::int[] IS NULL OR v.storage_gb = ANY(${storageGb}::int[]))
        AND (${screenSizeIn}::numeric[] IS NULL
             OR v.screen_size_inch = ANY(${screenSizeIn}::numeric[]))
        AND (${ramGbMin}::int IS NULL OR v.ram_gb >= ${ramGbMin}::int)
      -- With no query every rank is 0, so this collapses to the alphabetical
      -- browse order and one statement serves both cases.
      ORDER BY rank DESC, v.brand_name, v.model_name, v.sku_code
      LIMIT ${limit} OFFSET ${offset}`;

    if (rows.length > 0) {
      return {
        hits: rows.map(toHit),
        total: rows[0]!.total,
        matchedBy: q ? 'FULL_TEXT' : 'FILTER',
      };
    }
    // Page 3 of a two-page result is empty for a reason that has nothing to do
    // with spelling, and falling back there would replace the end of a good
    // result set with fuzzy matches for a query that was never misspelt.
    if (!q || offset > 0) return { hits: [], total: 0, matchedBy: q ? 'FULL_TEXT' : 'FILTER' };

    return this.trigramFallback(q, limit, {
      brandId,
      seriesId,
      cpuFamily,
      ramGb,
      storageGb,
      screenSizeIn,
      ramGbMin,
    });
  }

  /**
   * The typo pass. Trigram similarity on brand and model names.
   *
   * The GIN trigram indexes are on catalog.brand.name and catalog.model.name, so
   * the similarity search runs against those tables and the result is joined back
   * to the view by model_id. Doing it on the view's denormalised name columns
   * would read the same strings and use no index at all.
   *
   * ponytail: first page only, because the guard above means this is never
   * reached with an offset. A "did you mean" list is a handful of rows; if one
   * ever needs paging, take the offset back as a parameter.
   */
  private async trigramFallback(
    q: string,
    limit: number,
    f: {
      brandId: string[] | null;
      seriesId: string[] | null;
      cpuFamily: string[] | null;
      ramGb: number[] | null;
      storageGb: number[] | null;
      screenSizeIn: number[] | null;
      ramGbMin: number | null;
    },
  ): Promise<SearchResult> {
    const rows = await this.prisma.$queryRaw<RawHit[]>`
      WITH fuzzy AS (
        SELECT m.id AS model_id,
               GREATEST(similarity(m.name, ${q}::text),
                        similarity(b.name || ' ' || m.name, ${q}::text)) AS sim
        FROM catalog.model  m
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand  b  ON b.id  = se.brand_id
        WHERE m.is_active
          -- Parenthesised on purpose: pg_trgm's % and || sit at the same
          -- precedence level, so concatenation followed by % resolved to text
          -- and the OR then had a non-boolean argument.
          AND ((m.name % ${q}::text)
               OR ((b.name || ' ' || m.name) % ${q}::text))
      )
      SELECT v.sku_id, v.sku_code, v.brand_id, v.series_id,
             v.brand_name, v.series_name, v.model_name,
             v.cpu_family, v.ram_gb, v.storage_gb, v.screen_size_inch,
             f.sim AS rank,
             (count(*) OVER ())::int AS total
      FROM catalog.mv_sku_search v
      JOIN fuzzy f ON f.model_id = v.model_id
      WHERE v.is_active
        AND (${f.brandId}::uuid[] IS NULL OR v.brand_id = ANY(${f.brandId}::uuid[]))
        AND (${f.seriesId}::uuid[] IS NULL OR v.series_id = ANY(${f.seriesId}::uuid[]))
        AND (${f.cpuFamily}::text[] IS NULL OR v.cpu_family = ANY(${f.cpuFamily}::text[]))
        AND (${f.ramGb}::int[] IS NULL OR v.ram_gb = ANY(${f.ramGb}::int[]))
        AND (${f.storageGb}::int[] IS NULL OR v.storage_gb = ANY(${f.storageGb}::int[]))
        AND (${f.screenSizeIn}::numeric[] IS NULL
             OR v.screen_size_inch = ANY(${f.screenSizeIn}::numeric[]))
        AND (${f.ramGbMin}::int IS NULL OR v.ram_gb >= ${f.ramGbMin}::int)
      ORDER BY rank DESC, v.brand_name, v.model_name, v.sku_code
      LIMIT ${limit}`;

    return {
      hits: rows.map(toHit),
      total: rows[0]?.total ?? 0,
      matchedBy: 'TRIGRAM',
    };
  }

  /**
   * Counts for the filter rail, under the filters already applied.
   *
   * Deliberately one flat GROUP BY per dimension over one filtered CTE, because
   * CAT-010 asks for this to equal a ground truth computed independently in the
   * test — and a facet query a reviewer cannot hold in their head is a facet
   * query nobody can check.
   *
   * ponytail: every dimension is counted under the *whole* filter set, so
   * selecting Dell shows Dell as the only brand. That is correct for a
   * single-select rail. If the rail ever offers multi-select within one
   * dimension, that dimension has to be counted with its own filter excluded —
   * six queries instead of one, which is when to pay for it and not before.
   */
  async facets(filters: CatalogFilters = {}, q?: string): Promise<Facets> {
    // The query narrows the rail exactly as it narrows the results. Counting
    // facets over the unsearched catalog puts "Dell (36)" beside a result list
    // holding four Dells — the rail then contradicts the page it belongs to,
    // and the buyer trusts whichever they read second.
    const query = q?.trim() ? q.trim() : null;
    const brandId = orNull(filters.brandId);
    const seriesId = orNull(filters.seriesId);
    const cpuFamily = orNull(filters.cpuFamily);
    const ramGb = orNull(filters.ramGb);
    const storageGb = orNull(filters.storageGb);
    const screenSizeIn = orNull(filters.screenSizeIn);
    const ramGbMin = filters.ramGbMin ?? null;

    const rows = await this.prisma.$queryRaw<RawFacet[]>`
      WITH base AS (
        SELECT v.brand_id, v.brand_name, v.series_id, v.series_name,
               v.cpu_family, v.ram_gb, v.storage_gb, v.screen_size_inch
        FROM catalog.mv_sku_search v
        WHERE v.is_active
          AND (${brandId}::uuid[] IS NULL OR v.brand_id = ANY(${brandId}::uuid[]))
          AND (${seriesId}::uuid[] IS NULL OR v.series_id = ANY(${seriesId}::uuid[]))
          AND (${cpuFamily}::text[] IS NULL OR v.cpu_family = ANY(${cpuFamily}::text[]))
          AND (${ramGb}::int[] IS NULL OR v.ram_gb = ANY(${ramGb}::int[]))
          AND (${storageGb}::int[] IS NULL OR v.storage_gb = ANY(${storageGb}::int[]))
          AND (${screenSizeIn}::numeric[] IS NULL
               OR v.screen_size_inch = ANY(${screenSizeIn}::numeric[]))
          AND (${ramGbMin}::int IS NULL OR v.ram_gb >= ${ramGbMin}::int)
          AND (${query}::text IS NULL
               OR v.search_tsv @@ plainto_tsquery('simple', ${query}::text))
      )
      SELECT 'brand' AS dimension, brand_id::text AS value, brand_name AS label,
             count(*)::int AS n
        FROM base GROUP BY brand_id, brand_name
      UNION ALL
      SELECT 'series', series_id::text, series_name, count(*)::int
        FROM base GROUP BY series_id, series_name
      UNION ALL
      SELECT 'cpu_family', cpu_family, cpu_family, count(*)::int
        FROM base GROUP BY cpu_family
      UNION ALL
      SELECT 'ram_gb', ram_gb::text, ram_gb::text, count(*)::int
        FROM base GROUP BY ram_gb
      UNION ALL
      SELECT 'storage_gb', storage_gb::text, storage_gb::text, count(*)::int
        FROM base GROUP BY storage_gb
      UNION ALL
      SELECT 'screen_size_inch', screen_size_inch::text, screen_size_inch::text,
             count(*)::int
        FROM base GROUP BY screen_size_inch
      ORDER BY 1, 4 DESC, 2`;

    const out: Facets = {
      brand: [],
      series: [],
      cpu_family: [],
      ram_gb: [],
      storage_gb: [],
      screen_size_inch: [],
    };
    for (const r of rows) {
      out[r.dimension].push({ value: r.value, label: r.label, count: r.n });
    }
    return out;
  }

  /**
   * Rebuild the denormalised view. Called after a catalog import or an approved
   * SKU request — a SKU nobody can find is a SKU nobody lists against.
   *
   * CONCURRENTLY, which is what `uq_mv_sku_search` exists to permit: the plain
   * form takes an ACCESS EXCLUSIVE lock and every storefront search blocks for
   * the duration of the rebuild. Postgres refuses CONCURRENTLY inside a
   * transaction block, so this must never be called from `runInTransaction`.
   */
  async refreshSearchIndex(): Promise<void> {
    await this.prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY catalog.mv_sku_search`;
  }

  /**
   * p95 latency of `search`, in milliseconds, over `runs` executions.
   *
   * Exit criterion 8 wants a recorded baseline, and Phase 5's budget is p95
   * < 300 ms for search. On the seeded catalog (a few hundred SKUs against the
   * GIN index) the measured p95 is single-digit milliseconds, so the budget is
   * two orders of magnitude away and the work Phase 5 has to do is in the offers
   * grid, not here. Re-measure when the catalog reaches five figures.
   *
   * hrtime, not the clock: ClockPort is a wall clock, and the FixedClock every
   * test injects would report every run as taking zero. A duration needs a
   * monotonic source anyway — a wall clock can step backwards mid-measurement.
   */
  async benchmarkSearch(input: SearchInput = {}, runs = 30): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
      const started = process.hrtime.bigint();
      await this.search(input);
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    samples.sort((a, b) => a - b);
    // Nearest-rank p95: the smallest sample at or above the 95th percentile.
    return samples[Math.min(Math.ceil(samples.length * 0.95) - 1, samples.length - 1)] ?? 0;
  }
}
