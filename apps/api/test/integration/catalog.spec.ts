/**
 * The catalog service: image resolution end to end, and the SKU-request flow.
 *
 * The schema guarantees are proved in catalog-schema.spec.ts. This file is about
 * the behaviour built on top of them — in particular the two things a buyer's
 * trust rests on: that the photographs shown match the grade being sold, and
 * that two units of the same SKU resolve identically every time.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { CatalogService } from '../../src/modules/catalog';
import { SkuRepository } from '../../src/modules/catalog/internal/sku.repository';
import { ConditionImageService } from '../../src/modules/catalog/internal/condition-image.service';
import { SkuRequestService } from '../../src/modules/catalog/internal/sku-request.service';
import { CatalogSearchService } from '../../src/modules/catalog/internal/catalog-search.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { ensurePlatformOrg, makeCatalog, makeOrganization, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let catalog: CatalogService;
let images: ConditionImageService;
let requests: SkuRequestService;
let skus: SkuRepository;
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
      SkuRepository,
      ConditionImageService,
      SkuRequestService,
      CatalogSearchService,
    ],
  }).compile();

  catalog = moduleRef.get(CatalogService);
  images = moduleRef.get(ConditionImageService);
  requests = moduleRef.get(SkuRequestService);
  skus = moduleRef.get(SkuRepository);
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

async function scaffold(): Promise<{
  skuId: string;
  modelId: string;
  seriesId: string;
  userId: string;
}> {
  const orgId = await ensurePlatformOrg(raw);
  const userId = await makeUser(orgId, {}, raw);
  const cat = await makeCatalog({}, raw);
  const [t] = await raw.$queryRaw<Array<{ series_id: string }>>`
    SELECT series_id FROM catalog.model WHERE id = ${cat.modelId}::uuid`;
  return { skuId: cat.skuId, modelId: cat.modelId, seriesId: t!.series_id, userId };
}

async function put(
  s: Awaited<ReturnType<typeof scaffold>>,
  anchor: 'SKU' | 'MODEL' | 'SERIES',
  grade: 'A_PLUS' | 'A' | 'B',
  viewCode: string,
  over: { isPrimary?: boolean; sortOrder?: number } = {},
): Promise<string> {
  const anchorId = anchor === 'SKU' ? s.skuId : anchor === 'MODEL' ? s.modelId : s.seriesId;
  const r = await images.upload({
    anchor,
    anchorId,
    grade,
    viewCode,
    s3Key: `k/${anchor}/${grade}/${viewCode}/${randomUUID().slice(0, 8)}`,
    altText: `Grade ${grade} ${viewCode.toLowerCase().replace('_', ' ')}, photographed square on`,
    createdBy: s.userId,
    ...over,
  });
  return r.id;
}

describe('resolving images through the real chain', () => {
  it('prefers the SKU set', async () => {
    const s = await scaffold();
    await put(s, 'SERIES', 'B', 'LID_TOP');
    await put(s, 'MODEL', 'B', 'LID_TOP');
    await put(s, 'SKU', 'B', 'LID_TOP');

    const r = await catalog.resolveImages(s.skuId, 'B');
    expect(r.match).toBe('SKU');
    expect(r.isGeneric).toBe(false);
  });

  it('falls back model then series then placeholder', async () => {
    const s = await scaffold();
    expect((await catalog.resolveImages(s.skuId, 'B')).match).toBe('PLACEHOLDER');

    await put(s, 'SERIES', 'B', 'LID_TOP');
    expect((await catalog.resolveImages(s.skuId, 'B')).match).toBe('SERIES');

    await put(s, 'MODEL', 'B', 'LID_TOP');
    expect((await catalog.resolveImages(s.skuId, 'B')).match).toBe('MODEL');

    await put(s, 'SKU', 'B', 'LID_TOP');
    expect((await catalog.resolveImages(s.skuId, 'B')).match).toBe('SKU');
  });

  it('never serves another grade — the Rule 7(2) case', async () => {
    const s = await scaffold();
    await put(s, 'SKU', 'A_PLUS', 'LID_TOP');
    await put(s, 'MODEL', 'A', 'LID_TOP');

    // Grade B has nothing. A+ and A images exist and look perfectly good.
    const r = await catalog.resolveImages(s.skuId, 'B');
    expect(r.match).toBe('PLACEHOLDER');
    expect(r.images).toHaveLength(0);
  });

  it('CAT-005 — two identical requests return a byte-identical ordered set', async () => {
    const s = await scaffold();
    await put(s, 'MODEL', 'B', 'BASE', { sortOrder: 2 });
    await put(s, 'MODEL', 'B', 'KEYBOARD', { sortOrder: 1 });
    await put(s, 'MODEL', 'B', 'LID_TOP', { sortOrder: 0, isPrimary: true });

    const a = await catalog.resolveImages(s.skuId, 'B');
    const b = await catalog.resolveImages(s.skuId, 'B');
    expect(a.images.map((i) => i.s3Key)).toEqual(b.images.map((i) => i.s3Key));
    // Deterministic *and* correct: the primary leads.
    expect(a.images[0]!.viewCode).toBe('LID_TOP');
  });

  it('ignores a retired image, so a replacement is what buyers see', async () => {
    const s = await scaffold();
    const id = await put(s, 'MODEL', 'B', 'LID_TOP');
    await images.replace({
      imageId: id,
      s3Key: 'k/replacement',
      altText: 'Grade B lid, reshot under better light',
      actorId: s.userId,
    });

    const r = await catalog.resolveImages(s.skuId, 'B');
    expect(r.images).toHaveLength(1);
    expect(r.images[0]!.s3Key).toBe('k/replacement');

    // The old row survives — that is what answers "what did the buyer see".
    const [n] = await raw.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total FROM catalog.condition_image`;
    expect(Number(n!.total)).toBe(2);
  });
});

describe('uploading', () => {
  it('refuses a view code outside the ten, before it reaches the database', async () => {
    const s = await scaffold();
    await expect(
      images.upload({
        anchor: 'MODEL',
        anchorId: s.modelId,
        grade: 'A',
        viewCode: 'SELFIE',
        s3Key: 'k/x',
        altText: 'a perfectly fine description',
        createdBy: s.userId,
      }),
    ).rejects.toThrow(/not one of the ten view codes/);
  });

  it('refuses alt text that describes nothing', async () => {
    const s = await scaffold();
    await expect(
      images.upload({
        anchor: 'MODEL',
        anchorId: s.modelId,
        grade: 'A',
        viewCode: 'LID_TOP',
        s3Key: 'k/x',
        altText: 'lid',
        createdBy: s.userId,
      }),
    ).rejects.toThrow(/Describe what the photograph shows/);
  });
});

describe('coverage and the publish gate', () => {
  it('names every gap for a model', async () => {
    const s = await scaffold();
    await put(s, 'MODEL', 'B', 'LID_TOP');
    const gaps = await images.coverageForModel(s.modelId);
    // Three grades x six required views, minus the one just added.
    expect(gaps).toHaveLength(3 * 6 - 1);
  });

  it('will not publish Grade B on a set that hides its worst wear', async () => {
    const s = await scaffold();
    for (const v of ['LID_TOP', 'PALMREST', 'KEYBOARD', 'SCREEN_ON', 'PORTS_LEFT', 'BASE']) {
      await put(s, 'MODEL', 'B', v, { isPrimary: v === 'LID_TOP' });
    }
    const check = await images.publishCheck(s.modelId, 'B');
    expect(check.publishable).toBe(false);
    expect(check.reasons.join(' ')).toMatch(/worst wear/);
  });

  it('publishes Grade B once a wear frame is there', async () => {
    const s = await scaffold();
    for (const v of ['LID_TOP', 'PALMREST', 'KEYBOARD', 'SCREEN_ON', 'PORTS_LEFT', 'BASE']) {
      await put(s, 'MODEL', 'B', v, { isPrimary: v === 'LID_TOP' });
    }
    await put(s, 'MODEL', 'B', 'CORNER_WEAR');
    const check = await images.publishCheck(s.modelId, 'B');
    expect(check.publishable).toBe(true);
  });
});

describe('SKU requests — the duplicate is surfaced before submission', () => {
  async function vendor(): Promise<string> {
    return makeOrganization({ org_type: 'VENDOR' }, raw);
  }

  it('finds the existing SKU when the vendor describes it differently', async () => {
    const s = await scaffold();
    const sku = await skus.findById(s.skuId);
    const vendorOrgId = await vendor();

    // The catalog stores NVME_SSD and FHD; the vendor types what is on the box.
    const matches = await requests.nearMatches({
      vendorOrgId,
      rawBrand: sku!.brandName,
      rawModel: sku!.modelName,
      rawConfig: '16GB / 512GB NVMe',
      spec: {
        cpuFamily: sku!.cpuFamily,
        cpuModel: sku!.cpuModel,
        ramGb: sku!.ramGb,
        storageGb: sku!.storageGb,
        storageType: 'NVMe',
        screenSizeIn: sku!.screenSizeIn,
        resolution: '1920x1080',
        gpuType: sku!.gpuType,
        osSupported: sku!.osSupported,
        isTouch: sku!.isTouch,
      },
    });

    // This is the whole point of one shared key: a differently-worded machine
    // is recognised as the same machine.
    const exact = matches.find((m) => m.exact);
    expect(exact).toBeDefined();
    expect(exact!.skuCode).toBe(sku!.skuCode);
    expect(exact!.similarity).toBe(1);
  });

  it('finds a near match through a typo the key could never match', async () => {
    const s = await scaffold();
    const sku = await skus.findById(s.skuId);
    const vendorOrgId = await vendor();

    const typo = sku!.modelName.replace('Latitude', 'Latitide');
    const matches = await requests.nearMatches({
      vendorOrgId,
      rawBrand: sku!.brandName,
      rawModel: typo,
      rawConfig: 'whatever',
    });

    // The key is built from the typo, so only trigram similarity can catch it.
    expect(matches.map((m) => m.skuCode)).toContain(sku!.skuCode);
    expect(matches[0]!.exact).toBe(false);
  });

  it('records the request and returns the matches with it', async () => {
    const s = await scaffold();
    const sku = await skus.findById(s.skuId);
    const vendorOrgId = await vendor();

    const r = await requests.submit({
      vendorOrgId,
      rawBrand: sku!.brandName,
      rawModel: sku!.modelName,
      rawConfig: '32GB / 1TB',
    });

    expect(r.id).toBeTruthy();
    // Submitting is still allowed: the vendor may genuinely have a variant we
    // do not carry, and blocking them is the support-email failure mode this
    // queue exists to replace.
    expect(r.nearMatches.length).toBeGreaterThan(0);
  });

  it('refuses a request with no model named', async () => {
    const vendorOrgId = await vendor();
    await expect(
      requests.submit({ vendorOrgId, rawBrand: 'Dell', rawModel: '  ', rawConfig: 'x' }),
    ).rejects.toThrow(/brand and model/);
  });

  it('distinguishes mapped from new, because the ratio says whether search works', async () => {
    const s = await scaffold();
    const vendorOrgId = await vendor();
    const r = await requests.submit({
      vendorOrgId,
      rawBrand: 'Dell',
      rawModel: 'Latitude 5999',
      rawConfig: 'x',
    });

    await requests.mapToExisting({
      requestId: r.id,
      skuId: s.skuId,
      resolvedBy: s.userId,
    });

    const [row] = await raw.$queryRaw<Array<{ status: string; resolved_sku_id: string }>>`
      SELECT status, resolved_sku_id FROM catalog.sku_request WHERE id = ${r.id}::uuid`;
    expect(row!.status).toBe('RESOLVED_MAPPED');
    expect(row!.resolved_sku_id).toBe(s.skuId);
  });

  it('refuses to decide a request twice', async () => {
    const s = await scaffold();
    const vendorOrgId = await vendor();
    const r = await requests.submit({
      vendorOrgId,
      rawBrand: 'Dell',
      rawModel: 'Latitude 5999',
      rawConfig: 'x',
    });
    await requests.mapToExisting({ requestId: r.id, skuId: s.skuId, resolvedBy: s.userId });

    await expect(
      requests.mapToExisting({ requestId: r.id, skuId: s.skuId, resolvedBy: s.userId }),
    ).rejects.toThrow(/already been decided/);
  });

  it('refuses a rejection with no reason the vendor can act on', async () => {
    const s = await scaffold();
    const vendorOrgId = await vendor();
    const r = await requests.submit({
      vendorOrgId,
      rawBrand: 'Dell',
      rawModel: 'Latitude 5999',
      rawConfig: 'x',
    });
    await expect(
      requests.reject({ requestId: r.id, resolvedBy: s.userId, reason: '   ' }),
    ).rejects.toThrow(/Give a reason/);
  });

  it('queues oldest first, with an age the SLA can be read from', async () => {
    const vendorOrgId = await vendor();
    await requests.submit({ vendorOrgId, rawBrand: 'Dell', rawModel: 'A', rawConfig: 'x' });
    await requests.submit({ vendorOrgId, rawBrand: 'Dell', rawModel: 'B', rawConfig: 'x' });

    const q = await requests.queue();
    expect(q).toHaveLength(2);
    expect(q[0]!.createdAt.getTime()).toBeLessThanOrEqual(q[1]!.createdAt.getTime());
    expect(typeof q[0]!.ageHours).toBe('number');
  });
});

describe('the repository converts at the boundary', () => {
  it('returns screen size as a number, not a Decimal', async () => {
    const s = await scaffold();
    const sku = await skus.findById(s.skuId);
    // A Decimal here makes `Math.abs(detected - declared)` NaN, and
    // `NaN > tolerance` is false — so the QC screen check passes for every
    // machine. The conversion belongs here, once, not at each call site.
    expect(typeof sku!.screenSizeIn).toBe('number');
    expect(Number.isFinite(sku!.screenSizeIn)).toBe(true);
  });

  it('builds the key from the catalog tree, not from what the caller typed', async () => {
    const s = await scaffold();
    const sku = await skus.findById(s.skuId);

    const key = await skus.keyFor({
      modelId: s.modelId,
      cpuBrand: sku!.cpuBrand,
      cpuFamily: sku!.cpuFamily,
      cpuModel: sku!.cpuModel,
      cpuGeneration: sku!.cpuGeneration,
      ramGb: sku!.ramGb,
      storageGb: sku!.storageGb,
      // Free text, as a CSV or a form would supply it.
      storageType: 'NVMe',
      gpuType: sku!.gpuType,
      screenSizeIn: sku!.screenSizeIn,
      resolution: 'FHD',
      isTouch: sku!.isTouch,
      osSupported: sku!.osSupported,
    });

    // The round trip that used to fail open: the key computed from a form and
    // the key stored on the row must be the same string.
    expect(key).toBe(sku!.normalizedKey);
  });
});

describe('selfCheck', () => {
  it('fails when nothing is gradeable, rather than reporting healthy', async () => {
    expect(await catalog.selfCheck()).toEqual({ ok: true });

    await raw.$executeRaw`DELETE FROM catalog.grade_definition`;
    const bad = await catalog.selfCheck();
    expect(bad.ok).toBe(false);
    expect(bad.detail).toMatch(/grade definitions/);

    // Restore: grade_definition is reference data and survives truncateAll.
    const { seedGradeDefinitions } = await import('../../prisma/seed/catalog-reference');
    await seedGradeDefinitions(raw);
  });
});
