/**
 * Bulk condition-image upload, and the ordering controls that go with it.
 *
 * Three things are being proved here, and only the first is about convenience:
 *
 *   1. `<model>_<grade>_<view>_<n>.jpg` is read the same way by the preview the
 *      operator approves and by the write that follows it, because both run the
 *      one parser.
 *   2. **Nothing is silently skipped.** A misnamed file, a file for the wrong
 *      machine, a file whose bytes never arrived and a file with no caption each
 *      come back named, with a reason. A bulk tool that quietly drops what it
 *      cannot read produces a coverage grid that looks fuller than the library
 *      is, and the gap is then discovered by a buyer looking at a placeholder.
 *   3. **Every mutation lands in `catalog.catalog_change_log`.** The audit found
 *      the image paths writing nothing while the CSV importer logged every row.
 *      A photograph is a claim about condition under CP e-Comm Rule 7(2), so
 *      "who put this frame on this grade, and when" has to be answerable.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { CatalogChangeLogService } from '../../src/modules/catalog/internal/catalog-change-log.service';
import {
  ConditionImageService,
  type BulkFileInput,
  type BulkFileResult,
} from '../../src/modules/catalog/internal/condition-image.service';
import { CONDITION_FILENAME_CONVENTION } from '../../src/modules/catalog/internal/condition-image-filename';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { ensurePlatformOrg, makeCatalog, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let images: ConditionImageService;
let raw: PrismaClient;

/** `makeCatalog`'s default, and therefore what a well-named file must say. */
const MODEL = 'Latitude 5320';
const CAPTION = 'Grade B lid with fine scratches near the hinge';

let scaffold: { skuId: string; modelId: string; userId: string };

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
      CatalogChangeLogService,
      ConditionImageService,
    ],
  }).compile();

  images = moduleRef.get(ConditionImageService);
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
  const userId = await makeUser(orgId, {}, raw);
  const cat = await makeCatalog({}, raw);
  scaffold = { skuId: cat.skuId, modelId: cat.modelId, userId };
});

/** A file as the console would send it on the commit pass. */
function file(filename: string, over: Partial<BulkFileInput> = {}): BulkFileInput {
  return { filename, s3Key: `catalog/condition/${randomUUID()}.jpg`, altText: CAPTION, ...over };
}

function plan(files: BulkFileInput[], missingKeys: string[] = []) {
  return images.bulkAttach({
    anchor: 'MODEL',
    anchorId: scaffold.modelId,
    files,
    dryRun: true,
    actorId: scaffold.userId,
    missingKeys,
  });
}

function commit(files: BulkFileInput[], missingKeys: string[] = []) {
  return images.bulkAttach({
    anchor: 'MODEL',
    anchorId: scaffold.modelId,
    files,
    dryRun: false,
    actorId: scaffold.userId,
    missingKeys,
  });
}

async function liveRows(): Promise<
  Array<{ id: string; grade: string; view_code: string; sort_order: number; is_primary: boolean }>
> {
  return raw.$queryRaw`
    SELECT id, grade::text AS grade, view_code, sort_order, is_primary
      FROM catalog.condition_image
     WHERE retired_at IS NULL AND model_id = ${scaffold.modelId}::uuid
     ORDER BY view_code, sort_order`;
}

async function imageLog(): Promise<
  Array<{ entity_id: string; action: string; field: string; old_value: string | null; new_value: string | null; reason: string }>
> {
  return raw.$queryRaw`
    SELECT entity_id, action, field, old_value, new_value, reason
      FROM catalog.catalog_change_log
     WHERE entity_type = 'condition_image'
     ORDER BY changed_at, field`;
}

const failed = (files: BulkFileResult[]): BulkFileResult[] => files.filter((f) => !f.ok);

// ---------------------------------------------------------------------------

describe('the dry run', () => {
  it('reads the grade, the view and the frame number off each name', async () => {
    const result = await plan([
      file(`${MODEL}_B_LID_TOP_1.jpg`),
      file(`${MODEL}_A+_SCREEN_DEFECT_2.png`),
    ]);

    expect(result.files[0]).toMatchObject({ ok: true, grade: 'B', viewCode: 'LID_TOP', sortOrder: 1 });
    expect(result.files[1]).toMatchObject({
      ok: true,
      grade: 'A_PLUS',
      viewCode: 'SCREEN_DEFECT',
      sortOrder: 2,
    });
    expect(result.modelName).toBe(MODEL);
  });

  it('writes nothing at all, which is the entire point of previewing', async () => {
    await plan([file(`${MODEL}_B_LID_TOP_1.jpg`)]);
    expect(await liveRows()).toHaveLength(0);
    expect(await imageLog()).toHaveLength(0);
  });

  it('reports a name it cannot read, with what was expected, and keeps the rest', async () => {
    const result = await plan([file(`${MODEL}_B_LID_TOP_1.jpg`), file('IMG_2938.jpg')]);

    expect(result.rejected).toBe(1);
    expect(result.files[0]!.ok).toBe(true);
    expect(result.files[1]).toMatchObject({
      filename: 'IMG_2938.jpg',
      ok: false,
      expected: CONDITION_FILENAME_CONVENTION,
    });
    // The message has to be actionable on its own — the operator is looking at a
    // list of sixty rows, not at the documentation.
    expect(result.files[1]!.error).toContain('LID_TOP');
  });

  it('refuses a folder shot for a different machine', async () => {
    // The single most likely bulk mistake, and the reason the convention carries
    // the model at all: a Latitude's scratches on a ThinkPad's product page is a
    // Rule 7(2) misrepresentation that looks perfectly fine on screen.
    const result = await plan([file(`ThinkPad T14 Gen 2_B_LID_TOP_1.jpg`)]);
    expect(result.files[0]!.ok).toBe(false);
    expect(result.files[0]!.error).toContain(MODEL);
  });

  it('checks the name against the model a SKU belongs to, when the anchor is a SKU', async () => {
    const result = await images.bulkAttach({
      anchor: 'SKU',
      anchorId: scaffold.skuId,
      files: [file(`${MODEL}_B_BASE_1.jpg`), file('ThinkPad T14_B_HINGE_1.jpg')],
      dryRun: true,
      actorId: scaffold.userId,
    });
    expect(result.files[0]!.ok).toBe(true);
    expect(result.files[1]!.ok).toBe(false);
  });
});

describe('the commit', () => {
  it('attaches every file that parsed and reports the one that did not', async () => {
    const result = await commit([
      file(`${MODEL}_B_LID_TOP_1.jpg`),
      file(`${MODEL}_B_PALMREST_1.jpg`),
      file('IMG_2938.jpg'),
    ]);

    expect(result).toMatchObject({ attached: 2, rejected: 1 });
    expect(await liveRows()).toHaveLength(2);
    // Withholding two correct frames because a third was misnamed means renaming
    // one file and re-uploading the whole shoot.
    expect(result.files.filter((f) => f.ok).every((f) => f.imageId)).toBe(true);
  });

  it('cannot store a photograph with no caption', async () => {
    // Phase 5 exit criterion, on the side of the seam that can actually enforce
    // it. `alt_text` is what a screen reader announces and what a search engine
    // reads, and the column's CHECK demands ten characters — a batch must not be
    // able to slip past it by leaving the field out.
    const result = await commit([
      file(`${MODEL}_B_LID_TOP_1.jpg`, { altText: '' }),
      file(`${MODEL}_B_PALMREST_1.jpg`, { altText: 'lid' }),
      file(`${MODEL}_B_KEYBOARD_1.jpg`),
    ]);

    expect(result).toMatchObject({ attached: 1, rejected: 2 });
    expect(failed(result.files).every((f) => f.error?.includes('caption'))).toBe(true);
    const rows = await liveRows();
    expect(rows.map((r) => r.view_code)).toEqual(['KEYBOARD']);
  });

  it('reports a file whose bytes never reached storage rather than writing a dead row', async () => {
    const orphan = file(`${MODEL}_B_BASE_1.jpg`);
    const result = await commit([orphan], [orphan.s3Key!]);

    expect(result).toMatchObject({ attached: 0, rejected: 1 });
    expect(result.files[0]!.error).toContain('Upload it again');
    expect(await liveRows()).toHaveLength(0);
  });

  it('refuses a slot that is already filled instead of failing the whole batch', async () => {
    const names = [`${MODEL}_B_LID_TOP_1.jpg`, `${MODEL}_B_PALMREST_1.jpg`];
    await commit(names.map((n) => file(n)));

    // The same folder dropped twice — which is what happens the moment anybody
    // is unsure whether the first upload worked.
    const second = await commit(names.map((n) => file(n)));
    expect(second).toMatchObject({ attached: 0, rejected: 2 });
    expect(second.files[0]!.error).toContain('already filled');
    expect(await liveRows()).toHaveLength(2);
  });

  it('catches a duplicate inside one batch before the database has to', async () => {
    const result = await commit([
      file(`${MODEL}_B_LID_TOP_1.jpg`),
      file(`${MODEL}_b_lid-top_1.JPG`),
    ]);
    expect(result).toMatchObject({ attached: 1, rejected: 1 });
  });

  it('records every frame it creates, naming the file it came from', async () => {
    await commit([file(`${MODEL}_B_LID_TOP_1.jpg`), file(`${MODEL}_A_BASE_2.jpg`)]);

    const log = await imageLog();
    expect(log).toHaveLength(2);
    expect(log.every((l) => l.action === 'CREATE')).toBe(true);
    expect(log.map((l) => l.field).sort()).toEqual(['A/BASE', 'B/LID_TOP']);
    // The filename is the only link back to the shoot the frame came from.
    expect(log.some((l) => l.reason.includes(`${MODEL}_B_LID_TOP_1.jpg`))).toBe(true);
  });

  it('logs nothing for the files it rejected', async () => {
    await commit([file(`${MODEL}_B_LID_TOP_1.jpg`), file('IMG_2938.jpg')]);
    expect(await imageLog()).toHaveLength(1);
  });
});

describe('the hero frame', () => {
  async function twoFrames(): Promise<Array<{ id: string; view_code: string }>> {
    await commit([file(`${MODEL}_B_LID_TOP_1.jpg`), file(`${MODEL}_B_PALMREST_1.jpg`)]);
    return liveRows();
  }

  it('moves the primary, leaving exactly one for the grade', async () => {
    const [lid, palmrest] = await twoFrames();
    await images.setPrimary(lid!.id, scaffold.userId);
    await images.setPrimary(palmrest!.id, scaffold.userId);

    const rows = await liveRows();
    expect(rows.filter((r) => r.is_primary).map((r) => r.id)).toEqual([palmrest!.id]);
  });

  it('records the change, because the hero frame is what the listing card shows', async () => {
    const [lid, palmrest] = await twoFrames();
    await images.setPrimary(lid!.id, scaffold.userId);
    await images.setPrimary(palmrest!.id, scaffold.userId, 'better lighting');

    const log = (await imageLog()).filter((l) => l.field === 'B/primary');
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({
      entity_id: palmrest!.id,
      old_value: 'LID_TOP',
      new_value: 'PALMREST',
      reason: 'better lighting',
    });
  });

  it('is a no-op on the frame that already is primary, and logs nothing', async () => {
    const [lid] = await twoFrames();
    await images.setPrimary(lid!.id, scaffold.userId);
    const again = await images.setPrimary(lid!.id, scaffold.userId);

    expect(again.changed).toBe(false);
    // A trail entry describing a change that did not happen is worse than none:
    // it is the entry somebody later reads as evidence of a decision.
    expect((await imageLog()).filter((l) => l.field === 'B/primary')).toHaveLength(1);
  });
});

describe('reordering', () => {
  /** Two frames of the *same* view, which is the only case that can collide. */
  async function twoLids(): Promise<string[]> {
    await commit([file(`${MODEL}_B_LID_TOP_0.jpg`), file(`${MODEL}_B_LID_TOP_1.jpg`)]);
    return (await liveRows()).map((r) => r.id);
  }

  it('swaps two frames of one view without colliding on the slot index', async () => {
    // `uq_condition_slot_model` is a plain unique index, enforced row by row, so
    // writing the final positions directly fails halfway through a swap. This is
    // the regression test for the park-then-place pass.
    const [first, second] = await twoLids();
    await images.reorder({ imageIds: [second!, first!], actorId: scaffold.userId });

    const rows = await liveRows();
    expect(rows.find((r) => r.id === second)!.sort_order).toBe(0);
    expect(rows.find((r) => r.id === first)!.sort_order).toBe(1);
  });

  it('logs only the frames that actually moved', async () => {
    const [first, second] = await twoLids();
    await images.reorder({ imageIds: [second!, first!], actorId: scaffold.userId });

    const moves = (await imageLog()).filter((l) => l.field.endsWith('/sort_order'));
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => [m.old_value, m.new_value]).sort()).toEqual([
      ['0', '1'],
      ['1', '0'],
    ]);

    // Ordering it the way it already is writes no entries at all.
    await images.reorder({ imageIds: [second!, first!], actorId: scaffold.userId });
    expect((await imageLog()).filter((l) => l.field.endsWith('/sort_order'))).toHaveLength(2);
  });

  it('refuses a partial list rather than colliding on the positions left behind', async () => {
    const [first] = await twoLids();
    await expect(
      images.reorder({ imageIds: [first!], actorId: scaffold.userId }),
    ).rejects.toThrow(/every live frame/);
  });

  it('refuses a list that repeats an id', async () => {
    const [first] = await twoLids();
    await expect(
      images.reorder({ imageIds: [first!, first!], actorId: scaffold.userId }),
    ).rejects.toThrow(/exactly once/);
  });
});
