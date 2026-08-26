/**
 * Bulk SKU import against a real database.
 *
 * The pure parsing and classification are covered exhaustively in
 * packages/contracts. What can only be proved here are the two promises made to
 * the person running it: a dry run writes nothing at all, and committing the
 * same file twice does not double the catalog.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { SKU_IMPORT_COLUMNS, skuImportTemplate } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { SkuImportService } from '../../src/modules/catalog/internal/sku-import.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { ensurePlatformOrg, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let importer: SkuImportService;
let raw: PrismaClient;
let actorId: string;

const HEADER = SKU_IMPORT_COLUMNS.join(',');

function line(over: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    brand: 'Dell',
    series: 'Latitude',
    model: 'Latitude 5420',
    cpu_brand: 'Intel',
    cpu_family: 'Core i5',
    cpu_model: 'i5-1145G7',
    cpu_generation: '11th',
    ram_gb: '16',
    storage_gb: '512',
    storage_type: 'NVME_SSD',
    gpu_type: 'INTEGRATED',
    gpu_model: 'Intel Iris Xe',
    screen_size_in: '14',
    resolution: 'FHD',
    is_touch: 'false',
    os: 'Windows 11 Pro',
    hsn_code: '84713010',
    sku_code: '',
  };
  const row = { ...base, ...over };
  return SKU_IMPORT_COLUMNS.map((c) => row[c] ?? '').join(',');
}

function file(...lines: string[]): string {
  return `${HEADER}\n${lines.join('\n')}\n`;
}

async function skuCount(): Promise<number> {
  const [r] = await raw.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM catalog.sku`;
  return Number(r!.n);
}

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
      SkuImportService,
    ],
  }).compile();

  importer = moduleRef.get(SkuImportService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  const orgId = await ensurePlatformOrg(raw);
  actorId = await makeUser(orgId, {}, raw);
});

describe('the dry run writes nothing', () => {
  it('classifies rows without creating a single one', async () => {
    const report = await importer.dryRun(file(line(), line({ ram_gb: '32' })));

    expect(report.willCreate).toBe(2);
    // The promise the whole feature rests on. Ops looks at 200 outcomes before
    // anything is committed.
    expect(await skuCount()).toBe(0);
  });

  it('is repeatable — running it twice changes nothing', async () => {
    const csv = file(line());
    const a = await importer.dryRun(csv);
    const b = await importer.dryRun(csv);
    expect(a.willCreate).toBe(b.willCreate);
    expect(await skuCount()).toBe(0);
  });

  it('says WILL_MERGE once the row exists, without touching it', async () => {
    const csv = file(line());
    await importer.commit(csv, actorId);
    const before = await skuCount();

    const report = await importer.dryRun(csv);
    expect(report.willMerge).toBe(1);
    expect(report.willCreate).toBe(0);
    expect(report.rows[0]!.existingSkuCode).toBeTruthy();
    expect(await skuCount()).toBe(before);
  });
});

describe('commit', () => {
  it('creates the brand, series and model tree as it goes', async () => {
    await importer.commit(file(line()), actorId);

    const [row] = await raw.$queryRaw<
      Array<{ brand: string; series: string; model: string; sku_code: string }>
    >`
      SELECT b.name AS brand, se.name AS series, m.name AS model, s.sku_code
      FROM catalog.sku s
      JOIN catalog.model m ON m.id = s.model_id
      JOIN catalog.series se ON se.id = m.series_id
      JOIN catalog.brand b ON b.id = se.brand_id`;

    expect(row!.brand).toBe('Dell');
    expect(row!.series).toBe('Latitude');
    expect(row!.model).toBe('Latitude 5420');
    expect(row!.sku_code).toMatch(/^DEL-LATITUD/);
  });

  it('is idempotent — the same file twice does not double the catalog', async () => {
    const csv = file(line(), line({ ram_gb: '32' }), line({ storage_gb: '1024' }));

    const first = await importer.commit(csv, actorId);
    expect(first.created).toBe(3);
    expect(await skuCount()).toBe(3);

    // The realistic failure is a half-finished run somebody repeats.
    const second = await importer.commit(csv, actorId);
    expect(second.created).toBe(0);
    expect(second.merged).toBe(3);
    expect(await skuCount()).toBe(3);
  });

  it('merges a row written differently, because the key is normalised', async () => {
    await importer.commit(file(line()), actorId);
    // Same machine, spelled the way a vendor export spells it.
    await importer.commit(file(line({ storage_type: 'NVMe', resolution: '1920x1080' })), actorId);
    expect(await skuCount()).toBe(1);
  });

  it('does not reuse one brand row per import line', async () => {
    await importer.commit(
      file(line(), line({ ram_gb: '32' }), line({ model: 'Latitude 5430' })),
      actorId,
    );
    const [b] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM catalog.brand`;
    expect(Number(b!.n)).toBe(1);
  });

  it('applies the good rows and skips the bad ones', async () => {
    const result = await importer.commit(
      file(line(), line({ storage_type: 'BANANA' }), line({ ram_gb: '32' })),
      actorId,
    );

    // An import that silently drops a third of the file is worse than one that
    // refuses; an import that refuses 200 rows over one typo is worse than one
    // that applies 199 and names the last. The dry run is what makes this safe.
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
    expect(await skuCount()).toBe(2);
    expect(result.errorReportCsv).toMatch(/BANANA/);
  });

  it('refuses a file with the wrong header rather than importing nothing quietly', async () => {
    await expect(importer.commit('brand,model\nDell,X\n', actorId)).rejects.toThrow(
      /missing these columns/,
    );
  });

  it('imports the shipped template unchanged', async () => {
    // If the template ever stops importing, the first thing ops does with the
    // feature fails.
    const r = await importer.commit(skuImportTemplate(), actorId);
    expect(r.created).toBe(1);
  });

  it('writes a change-log row with an actor for every SKU it touches', async () => {
    await importer.commit(file(line()), actorId);
    const [log] = await raw.$queryRaw<Array<{ action: string; changed_by: string }>>`
      SELECT action, changed_by FROM catalog.catalog_change_log WHERE entity_type = 'sku'`;
    // Exit criterion 9: every mutation, with an actor.
    expect(log!.action).toBe('CREATE');
    expect(log!.changed_by).toBe(actorId);
  });

  it('records a merge distinctly from a create', async () => {
    const csv = file(line());
    await importer.commit(csv, actorId);
    await importer.commit(csv, actorId);

    const rows = await raw.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM catalog.catalog_change_log WHERE entity_type = 'sku' ORDER BY id`;
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
  });

  it('stores the 8-digit HSN and lets the rate come from the master', async () => {
    await importer.commit(file(line({ hsn_code: '' })), actorId);
    const [row] = await raw.$queryRaw<Array<{ hsn_code: string; rate: string }>>`
      SELECT s.hsn_code, catalog.gst_rate_on(s.hsn_code) AS rate FROM catalog.sku s`;
    expect(row!.hsn_code).toBe('84713010');
    // CAT-008: resolved from the effective-dated table, not a column default.
    expect(Number(row!.rate)).toBe(18);
  });
});
