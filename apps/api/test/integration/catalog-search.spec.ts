/**
 * Catalog search and the filter rail, end to end. Task 8, CAT-009 / CAT-009b / CAT-010.
 *
 * catalog-schema.spec.ts already proves the DDL: the tsvector is GENERATED, the
 * view exists, and pg_attribute lists no vendor column on it. This file is about
 * the service built on top — that ranking puts brand and model first, that a
 * misspelt model is still findable, that the facet counts equal SQL computed
 * independently, and that none of those three paths can be made to say who is
 * selling.
 *
 * The search index is a materialised view, so it is stale by construction:
 * `truncateAll` empties the tables underneath it and leaves the view holding the
 * previous test's rows. Every seed helper below refreshes before it returns, and
 * that is not tidiness — a test that forgets it passes or fails on the last
 * test's data.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { skuNormalizedKey } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { CatalogService } from '../../src/modules/catalog';
import { CatalogSearchService } from '../../src/modules/catalog/internal/catalog-search.service';
import { SkuRepository } from '../../src/modules/catalog/internal/sku.repository';
import { CatalogChangeLogService } from '../../src/modules/catalog/internal/catalog-change-log.service';
import { ConditionImageService } from '../../src/modules/catalog/internal/condition-image.service';
import { SkuImportService } from '../../src/modules/catalog/internal/sku-import.service';
import { SkuRequestService } from '../../src/modules/catalog/internal/sku-request.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeListing, makeOrganization } from '../support/factories';

let moduleRef: TestingModule;
let catalog: CatalogService;
let search: CatalogSearchService;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(new Date('2026-08-26T06:00:00.000Z')) },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      CatalogService,
      CatalogChangeLogService,
      SkuRepository,
      ConditionImageService,
      SkuRequestService,
      SkuImportService,
      CatalogSearchService,
    ],
  }).compile();

  catalog = moduleRef.get(CatalogService);
  search = moduleRef.get(CatalogSearchService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
});

// --- fixtures --------------------------------------------------------------

interface Tree {
  brandId: string;
  seriesId: string;
  modelId: string;
  brandName: string;
  seriesName: string;
  modelName: string;
}

interface Spec {
  cpuFamily?: string;
  cpuModel?: string;
  cpuGeneration?: string;
  ramGb?: number;
  storageGb?: number;
  storageType?: string;
  screenSizeIn?: number;
}

/**
 * A brand → series → model chain. The brand name carries a random suffix because
 * catalog.brand.name is UNIQUE and a test that seeds two trees would otherwise
 * collide on the second.
 */
async function makeTree(brand: string, series: string, model: string): Promise<Tree> {
  const uniq = randomUUID().slice(0, 8);
  const brandName = `${brand} ${uniq}`;
  const brandId = randomUUID();
  const seriesId = randomUUID();
  const modelId = randomUUID();

  await raw.$executeRaw`
    INSERT INTO catalog.brand (id, name, slug)
    VALUES (${brandId}::uuid, ${brandName}, ${'brand-' + uniq})`;
  await raw.$executeRaw`
    INSERT INTO catalog.series (id, brand_id, name, slug)
    VALUES (${seriesId}::uuid, ${brandId}::uuid, ${series}, ${'series-' + uniq})`;
  await raw.$executeRaw`
    INSERT INTO catalog.model (id, series_id, name)
    VALUES (${modelId}::uuid, ${seriesId}::uuid, ${model})`;

  return { brandId, seriesId, modelId, brandName, seriesName: series, modelName: model };
}

/** One SKU under a tree. The key comes from the shared generator, never by hand. */
async function addSku(t: Tree, spec: Spec = {}): Promise<string> {
  const s = {
    cpuFamily: spec.cpuFamily ?? 'Core i5',
    cpuModel: spec.cpuModel ?? 'i5-1145G7',
    cpuGeneration: spec.cpuGeneration ?? '11th',
    ramGb: spec.ramGb ?? 16,
    storageGb: spec.storageGb ?? 512,
    storageType: spec.storageType ?? 'NVME_SSD',
    screenSizeIn: spec.screenSizeIn ?? 13.3,
  };
  const id = randomUUID();
  const normalizedKey = skuNormalizedKey({
    brand: t.brandName,
    model: t.modelName,
    cpuFamily: s.cpuFamily,
    cpuModel: s.cpuModel,
    ramGb: s.ramGb,
    storageGb: s.storageGb,
    storageType: s.storageType,
    screenSizeIn: s.screenSizeIn,
    screenResolution: 'FHD',
    gpu: 'INTEGRATED',
    os: 'Windows 11 Pro',
    isTouch: false,
  });

  await raw.$executeRaw`
    INSERT INTO catalog.sku (id, model_id, sku_code, normalized_key, cpu_brand, cpu_family,
                             cpu_model, cpu_generation, ram_gb, storage_type, storage_gb,
                             gpu_type, screen_size_inch, resolution, is_touch, os_supported,
                             hsn_code, gst_rate)
    VALUES (${id}::uuid, ${t.modelId}::uuid, ${'SKU-' + id.slice(0, 12).toUpperCase()},
            ${normalizedKey},
            'Intel', ${s.cpuFamily}, ${s.cpuModel}, ${s.cpuGeneration},
            ${s.ramGb}, ${s.storageType}, ${s.storageGb},
            'INTEGRATED', ${s.screenSizeIn}, 'FHD', false, 'Windows 11 Pro', '84713010', 18)`;
  return id;
}

/**
 * Two brands, three models, six SKUs — enough for ranking, filtering and facets
 * to have something to be wrong about.
 */
async function seedTwoBrands(): Promise<{
  dell: Tree;
  lenovo: Tree;
  dellLatitude16: string;
  dellLatitude32: string;
  lenovoI5: string;
}> {
  const dell = await makeTree('Dell', 'Latitude', 'Latitude 5420');
  const lenovo = await makeTree('Lenovo', 'ThinkPad', 'ThinkPad T14');

  const dellLatitude16 = await addSku(dell, { ramGb: 16, storageGb: 512 });
  const dellLatitude32 = await addSku(dell, {
    ramGb: 32,
    storageGb: 1024,
    cpuFamily: 'Core i7',
    cpuModel: 'i7-1185G7',
  });
  const lenovoI5 = await addSku(lenovo, { ramGb: 8, storageGb: 256, screenSizeIn: 14 });

  await search.refreshSearchIndex();
  return { dell, lenovo, dellLatitude16, dellLatitude32, lenovoI5 };
}

// --- CAT-009 ---------------------------------------------------------------

describe('full-text search over the materialised view — CAT-009', () => {
  it('finds a SKU by the model name the buyer actually types', async () => {
    const f = await seedTwoBrands();

    const r = await search.search({ q: 'Latitude 5420' });
    expect(r.matchedBy).toBe('FULL_TEXT');
    expect(r.hits.map((h) => h.skuId).sort()).toEqual([f.dellLatitude16, f.dellLatitude32].sort());
  });

  it('finds a SKU by a specification term when no model name is typed', async () => {
    const f = await seedTwoBrands();

    // The vector carries cpu_family at weight B, so a buyer who knows only the
    // processor still lands on the right machine.
    const r = await search.search({ q: 'Core i7' });
    expect(r.hits.map((h) => h.skuId)).toEqual([f.dellLatitude32]);
  });

  it('ranks a brand-and-model match above a specification-only match', async () => {
    const f = await seedTwoBrands();

    // "or" is websearch_to_tsquery syntax, so both rows match: the Dell on
    // model name (weight A) and CPU family, the Lenovo on CPU family alone.
    const r = await search.search({ q: 'Latitude or Core' });
    expect(r.hits.length).toBeGreaterThan(1);

    // Catches the weighting being inverted, or ts_rank being replaced by a
    // constant — both of which leave the search "working" and useless.
    expect(r.hits[0]!.skuId).not.toBe(f.lenovoI5);
    const lenovo = r.hits.find((h) => h.skuId === f.lenovoI5)!;
    expect(r.hits[0]!.rank).toBeGreaterThan(lenovo.rank);
  });

  it('reports the unpaginated total so a caller can page through', async () => {
    const f = await seedTwoBrands();

    const r = await search.search({ filters: { brandId: [f.dell.brandId] }, limit: 1 });
    // total is count(*) OVER (), not hits.length. Returning the page size here
    // is the bug that makes a result grid claim one page of results forever.
    expect(r.hits).toHaveLength(1);
    expect(r.total).toBe(2);
  });

  it('falls back to trigram similarity for a typo tsquery can never match', async () => {
    const f = await seedTwoBrands();

    // "latitide" is not a lexeme in any vector, so the full-text pass returns
    // nothing at all — this result can only come from the trigram index.
    const r = await search.search({ q: 'latitide 5420' });
    expect(r.matchedBy).toBe('TRIGRAM');
    expect(r.hits.map((h) => h.skuId).sort()).toEqual([f.dellLatitude16, f.dellLatitude32].sort());
  });

  it('does not answer a page past the end of a result set with typo results', async () => {
    await seedTwoBrands();

    // The full-text pass returns nothing at offset 50 because there are only
    // two matches, not because anything was misspelt. Falling back here would
    // replace the end of a good result set with fuzzy matches for a query that
    // was spelt correctly.
    const r = await search.search({ q: 'Latitude 5420', limit: 10, offset: 50 });
    expect(r.hits).toHaveLength(0);
    expect(r.matchedBy).toBe('FULL_TEXT');
  });

  it('does not reach for trigram when full text already answered', async () => {
    await seedTwoBrands();
    const r = await search.search({ q: 'ThinkPad T14' });
    // The fallback is the expensive path; firing it on a successful search is a
    // silent performance regression nothing else would catch.
    expect(r.matchedBy).toBe('FULL_TEXT');
  });

  it('returns nothing rather than everything for a query matching no machine', async () => {
    await seedTwoBrands();
    const r = await search.search({ q: 'Commodore 64' });
    expect(r.hits).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});

// --- CAT-009b --------------------------------------------------------------

describe('the search path cannot leak vendor identity — CAT-009b', () => {
  it('exposes no vendor column on the view search reads', async () => {
    await seedTwoBrands();

    // pg_attribute, not information_schema.columns: a materialised view is
    // relkind 'm' and information_schema does not list it at all, so the
    // catalogue view returns an empty set and the assertion passes vacuously.
    const cols = await raw.$queryRaw<Array<{ column_name: string }>>`
      SELECT a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'catalog' AND c.relname = 'mv_sku_search'
        AND a.attnum > 0 AND NOT a.attisdropped`;

    const names = cols.map((c) => c.column_name);
    expect(names).toContain('brand_name');
    expect(names.some((x) => /vendor|org|seller|supplier/i.test(x))).toBe(false);
  });

  it('does not find a SKU by the legal name of the vendor selling it', async () => {
    const f = await seedTwoBrands();

    const vendorOrgId = await makeOrganization(
      { org_type: 'VENDOR', legal_name: 'Zenith Refurb Distributors Pvt Ltd' },
      raw,
    );
    const pickupAddressId = await makeAddress(vendorOrgId, {}, raw);
    await makeListing({ vendorOrgId, skuId: f.dellLatitude16, pickupAddressId }, raw);
    await search.refreshSearchIndex();

    // VR-099. A live listing exists for this SKU and the vendor is still not a
    // search term — not through tsquery and not through the trigram fallback,
    // which is the path that would match a name approximately.
    const byName = await search.search({ q: 'Zenith Refurb Distributors' });
    expect(byName.hits).toHaveLength(0);

    // And the hit itself carries nothing a caller could render as a seller.
    const hit = (await search.search({ q: 'Latitude 5420' })).hits[0]!;
    expect(Object.keys(hit).some((k) => /vendor|org|seller|supplier/i.test(k))).toBe(false);
  });
});

// --- CAT-010 ---------------------------------------------------------------

describe('faceted filtering — CAT-010', () => {
  it('returns exactly the set an independently written SQL query returns', async () => {
    const f = await seedTwoBrands();

    const expected = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT s.id
      FROM catalog.sku s
      JOIN catalog.model  m  ON m.id  = s.model_id
      JOIN catalog.series se ON se.id = m.series_id
      JOIN catalog.brand  b  ON b.id  = se.brand_id
      WHERE s.is_active
        AND b.id = ${f.dell.brandId}::uuid
        AND s.ram_gb >= 16`;

    const r = await search.search({
      filters: { brandId: [f.dell.brandId], ramGbMin: 16 },
      limit: 100,
    });

    // The ground truth is computed from the base tables; the service reads the
    // materialised view. They agreeing is the whole assertion — a stale or
    // wrongly-joined view shows up here and nowhere else.
    expect(r.hits.map((h) => h.skuId).sort()).toEqual(expected.map((e) => e.id).sort());
    expect(r.total).toBe(expected.length);
  });

  it('counts every rail dimension, and the counts match SQL computed independently', async () => {
    const f = await seedTwoBrands();

    const facets = await search.facets({});

    const dimensions = await raw.$queryRaw<
      Array<{ brand_id: string; ram_gb: number; storage_gb: number; cpu_family: string }>
    >`
      SELECT se.brand_id, s.ram_gb, s.storage_gb, s.cpu_family
      FROM catalog.sku s
      JOIN catalog.model  m  ON m.id  = s.model_id
      JOIN catalog.series se ON se.id = m.series_id
      WHERE s.is_active`;

    const countBy = <T>(pick: (row: (typeof dimensions)[number]) => T): Map<string, number> => {
      const out = new Map<string, number>();
      for (const row of dimensions) {
        const k = String(pick(row));
        out.set(k, (out.get(k) ?? 0) + 1);
      }
      return out;
    };

    const asMap = (values: Array<{ value: string; count: number }>): Map<string, number> =>
      new Map(values.map((v) => [v.value, v.count]));

    expect(asMap(facets.brand)).toEqual(countBy((r) => r.brand_id));
    expect(asMap(facets.ram_gb)).toEqual(countBy((r) => r.ram_gb));
    expect(asMap(facets.storage_gb)).toEqual(countBy((r) => r.storage_gb));
    expect(asMap(facets.cpu_family)).toEqual(countBy((r) => r.cpu_family));

    // Brand and series values are uuids, so the rail needs a label with them or
    // it renders a column of identifiers.
    expect(facets.brand.find((v) => v.value === f.dell.brandId)!.label).toBe(f.dell.brandName);
    expect(facets.series).toHaveLength(2);
    expect(facets.screen_size_inch.length).toBeGreaterThan(0);
  });

  it('narrows the other dimensions once a filter is applied', async () => {
    const f = await seedTwoBrands();

    const all = await search.facets({});
    const dellOnly = await search.facets({ brandId: [f.dell.brandId] });

    expect(all.ram_gb.length).toBe(3);
    // 8 GB belongs only to the Lenovo, so filtering to Dell must retire that
    // bucket entirely rather than leaving a rail option that returns nothing.
    expect(dellOnly.ram_gb.map((v) => v.value).sort()).toEqual(['16', '32']);
  });

  it('treats an empty filter array as no filter, not as "match nothing"', async () => {
    await seedTwoBrands();
    // = ANY('{}') is false for every row, so an empty array reaching the SQL
    // would silently empty the catalog for anyone who cleared their filters.
    const r = await search.search({ filters: { brandId: [], ramGb: [] }, limit: 100 });
    expect(r.total).toBe(3);
  });
});

// --- the view is only as fresh as the last refresh --------------------------

describe('refreshSearchIndex', () => {
  it('makes a newly created SKU findable, and it is not findable before', async () => {
    const f = await seedTwoBrands();
    const added = await addSku(f.lenovo, { ramGb: 64, cpuModel: 'i9-11950H' });

    // The staleness is the contract, not a defect: the importer and the SKU
    // request approval both have to call the refresh, and a test that did not
    // pin this down would let someone quietly drop those calls.
    const before = await search.search({ q: 'i9-11950H' });
    expect(before.hits).toHaveLength(0);

    await catalog.refreshSearchIndex();

    const after = await search.search({ q: 'ThinkPad T14', filters: { ramGb: [64] } });
    expect(after.hits.map((h) => h.skuId)).toEqual([added]);
  });
});

// --- exit criterion 8 -------------------------------------------------------

describe('search latency baseline — exit criterion 8', () => {
  it('records a p95 for the seeded catalog without asserting a threshold', async () => {
    const dell = await makeTree('Dell', 'Latitude', 'Latitude 5420');
    const lenovo = await makeTree('Lenovo', 'ThinkPad', 'ThinkPad T14');
    const hp = await makeTree('HP', 'EliteBook', 'EliteBook 840 G8');
    const trees = [dell, lenovo, hp];

    const rams = [8, 16, 32];
    const storages = [256, 512, 1024];
    const cpus = ['Core i3', 'Core i5', 'Core i7'];
    for (let i = 0; i < 120; i++) {
      await addSku(trees[i % 3]!, {
        ramGb: rams[i % 3]!,
        storageGb: storages[Math.floor(i / 3) % 3]!,
        cpuFamily: cpus[Math.floor(i / 9) % 3]!,
        cpuModel: `cpu-${i}`,
        screenSizeIn: 13 + (i % 4) / 10,
      });
    }
    await search.refreshSearchIndex();

    const p95 = await search.benchmarkSearch({ q: 'Latitude', limit: 24 }, 30);

    // Deliberately no threshold. Phase 5's budget is p95 < 300 ms and this
    // measures single-digit milliseconds on a GIN index over a few hundred
    // rows, so an assertion here would only ever fire on a loaded CI box —
    // a flaky test that tells nobody anything. The number is the deliverable.
    console.log(`[baseline] catalog search p95 over 30 runs: ${p95.toFixed(2)} ms`);
    expect(Number.isFinite(p95)).toBe(true);
    expect(p95).toBeGreaterThan(0);
  }, 60_000);
});
