/**
 * The Phase 2 catalog schema, proved against a real Postgres.
 *
 * Raw SQL only, no service layer. Every assertion here is about a guarantee the
 * database itself makes, so routing it through application code would prove the
 * application, not the constraint — and the whole point of these is that they
 * hold no matter which service is careless.
 *
 * Several of these close defects in the DDL that 02_ARCHITECTURE.md §2.3
 * sketches, which PHASE_02_CATALOG.md says to build "exactly as specified".
 * Copied verbatim it would have shipped a uniqueness constraint that is inert
 * on precisely the rows it is meant to protect.
 */

import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDb,
  truncateAll,
} from '../support/db';
import { ensurePlatformOrg, makeCatalog, makeUser } from '../support/factories';

let db: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  // grade_definition and the HSN master are reference data, seeded from the
  // same functions the CLI uses. They are excluded from truncateAll, so this
  // runs once and survives every test.
  await seedTestReference(db);
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** A brand → series → model chain plus an actor, which every image needs. */
async function anchors(): Promise<{
  brandId: string;
  seriesId: string;
  modelId: string;
  skuId: string;
  userId: string;
}> {
  const orgId = await ensurePlatformOrg(db);
  const userId = await makeUser(orgId, {}, db);
  const cat = await makeCatalog({}, db);
  const [row] = await db.$queryRaw<Array<{ series_id: string; brand_id: string }>>`
    SELECT m.series_id, se.brand_id
    FROM catalog.model m JOIN catalog.series se ON se.id = m.series_id
    WHERE m.id = ${cat.modelId}::uuid`;
  return {
    brandId: row!.brand_id,
    seriesId: row!.series_id,
    modelId: cat.modelId,
    skuId: cat.skuId,
    userId,
  };
}

function image(
  a: Awaited<ReturnType<typeof anchors>>,
  over: Partial<{
    skuId: string | null;
    modelId: string | null;
    seriesId: string | null;
    grade: string;
    viewCode: string;
    s3Key: string;
    altText: string;
    isPrimary: boolean;
    sortOrder: number;
  }> = {},
): Promise<number> {
  const v = {
    skuId: null,
    modelId: a.modelId,
    seriesId: null,
    grade: 'A',
    viewCode: 'LID_TOP',
    s3Key: `k/${randomUUID()}`,
    altText: 'Grade A lid photographed from above, no visible marks',
    isPrimary: false,
    sortOrder: 0,
    ...over,
  };
  return db.$executeRaw`
    INSERT INTO catalog.condition_image
      (sku_id, model_id, series_id, grade, view_code, s3_key, alt_text, is_primary, sort_order, created_by)
    VALUES (${v.skuId}::uuid, ${v.modelId}::uuid, ${v.seriesId}::uuid,
            ${v.grade}::grade_type, ${v.viewCode}, ${v.s3Key}, ${v.altText},
            ${v.isPrimary}, ${v.sortOrder}, ${a.userId}::uuid)`;
}

describe('catalog.condition_image — exactly one anchor', () => {
  it('accepts a model-anchored image', async () => {
    const a = await anchors();
    await expect(image(a)).resolves.toBe(1);
  });

  it('refuses an image anchored to nothing', async () => {
    const a = await anchors();
    // A row with no anchor can never be resolved to anything, so it is a
    // silent gap in the coverage grid rather than a usable image.
    await expect(image(a, { modelId: null })).rejects.toThrow(/chk_condition_one_anchor/);
  });

  it('refuses an image anchored to two levels at once', async () => {
    const a = await anchors();
    // Resolution is sku -> model -> series. A row at two levels has no defined
    // precedence, so the resolver's answer would depend on join order.
    await expect(image(a, { modelId: a.modelId, seriesId: a.seriesId })).rejects.toThrow(
      /chk_condition_one_anchor/,
    );
  });

  it('accepts each of the three anchor levels on its own', async () => {
    const a = await anchors();
    await expect(image(a, { modelId: null, skuId: a.skuId })).resolves.toBe(1);
    await expect(image(a, { modelId: a.modelId })).resolves.toBe(1);
    await expect(image(a, { modelId: null, seriesId: a.seriesId })).resolves.toBe(1);
  });
});

describe('catalog.condition_image — the slot uniqueness that §2.3 got wrong', () => {
  it('refuses a duplicate live slot on a model', async () => {
    const a = await anchors();
    await image(a);
    await expect(image(a)).rejects.toThrow(/Key \(model_id, grade, view_code, sort_order\)/);
  });

  it('refuses a duplicate live slot on a SKU — the case the original UNIQUE missed', async () => {
    const a = await anchors();
    await image(a, { modelId: null, skuId: a.skuId });
    // §2.3's `UNIQUE (model_id, grade, view_code, sort_order)` is INERT here:
    // model_id is NULL on a SKU-anchored row and Postgres treats NULLs as
    // distinct, so the constraint never fires on the rows that override a model.
    await expect(image(a, { modelId: null, skuId: a.skuId })).rejects.toThrow(
      /Key \(sku_id, grade, view_code, sort_order\)/,
    );
  });

  it('refuses a duplicate live slot on a series — the other NULL hole', async () => {
    const a = await anchors();
    await image(a, { modelId: null, seriesId: a.seriesId });
    await expect(image(a, { modelId: null, seriesId: a.seriesId })).rejects.toThrow(
      /Key \(series_id, grade, view_code, sort_order\)/,
    );
  });

  it('lets the same slot exist at different anchor levels, which is the whole point', async () => {
    const a = await anchors();
    await expect(image(a, { modelId: null, skuId: a.skuId })).resolves.toBe(1);
    await expect(image(a, { modelId: a.modelId })).resolves.toBe(1);
    await expect(image(a, { modelId: null, seriesId: a.seriesId })).resolves.toBe(1);
  });

  it('keeps grades apart — a Grade A slot does not block Grade B', async () => {
    const a = await anchors();
    await image(a, { grade: 'A' });
    await expect(image(a, { grade: 'B' })).resolves.toBe(1);
  });
});

describe('catalog.condition_image — retire, never overwrite', () => {
  it('frees the slot when a row is retired, so a replacement fits', async () => {
    const a = await anchors();
    await image(a, { s3Key: 'v1' });
    await expect(image(a, { s3Key: 'v2' })).rejects.toThrow(
      /Key \(model_id, grade, view_code, sort_order\)/,
    );

    await db.$executeRaw`
      UPDATE catalog.condition_image SET retired_at = now(), retired_by = ${a.userId}::uuid
      WHERE s3_key = 'v1'`;

    // The partial index is what makes retire-then-replace possible at all.
    await expect(image(a, { s3Key: 'v2' })).resolves.toBe(1);

    const [n] = await db.$queryRaw<Array<{ live: bigint; total: bigint }>>`
      SELECT count(*) FILTER (WHERE retired_at IS NULL)::bigint AS live,
             count(*)::bigint AS total
      FROM catalog.condition_image`;
    // Both rows survive. "What did the buyer see on 12 August" is a Rule 7(5)
    // question, and a mutated row cannot answer it.
    expect(Number(n!.live)).toBe(1);
    expect(Number(n!.total)).toBe(2);
  });

  it('allows only one live primary per anchor and grade', async () => {
    const a = await anchors();
    await image(a, { isPrimary: true });
    await expect(image(a, { viewCode: 'PALMREST', isPrimary: true })).rejects.toThrow(
      /Key \(model_id, grade\)/,
    );
  });

  it('allows a new primary once the old one is retired', async () => {
    const a = await anchors();
    await image(a, { s3Key: 'p1', isPrimary: true });
    await db.$executeRaw`
      UPDATE catalog.condition_image SET retired_at = now(), retired_by = ${a.userId}::uuid
      WHERE s3_key = 'p1'`;
    await expect(image(a, { s3Key: 'p2', isPrimary: true })).resolves.toBe(1);
  });

  it('allows a live primary at series level — the COALESCE version could not', async () => {
    const a = await anchors();
    // §2.3 indexed `COALESCE(sku_id, model_id)`, which is NULL for a series row,
    // and a NULL is not constrained — so it permitted unlimited orphan primaries.
    await image(a, { modelId: null, seriesId: a.seriesId, isPrimary: true });
    await expect(
      image(a, { modelId: null, seriesId: a.seriesId, viewCode: 'BASE', isPrimary: true }),
    ).rejects.toThrow(/Key \(series_id, grade\)/);
  });
});

describe('catalog.condition_image — the honest-rendering constraints', () => {
  it('refuses a view code outside the ten', async () => {
    const a = await anchors();
    // The ten codes were a comment in §2.3, not a CHECK, so a typo became a
    // view nothing renders and nobody notices.
    await expect(image(a, { viewCode: 'SELFIE' })).rejects.toThrow(/chk_condition_view_code/);
  });

  it.each([
    'LID_TOP',
    'PALMREST',
    'KEYBOARD',
    'SCREEN_ON',
    'PORTS_LEFT',
    'PORTS_RIGHT',
    'BASE',
    'HINGE',
    'CORNER_WEAR',
    'SCREEN_DEFECT',
  ])('accepts the documented view code %s', async (viewCode) => {
    const a = await anchors();
    await expect(image(a, { viewCode })).resolves.toBe(1);
  });

  it('refuses alt text too short to describe anything', async () => {
    const a = await anchors();
    // Alt text is an accessibility requirement and what a search engine reads.
    // "lid" satisfies NOT NULL and describes nothing.
    await expect(image(a, { altText: 'lid' })).rejects.toThrow(/alt_text/);
  });
});

describe('catalog.grade_definition', () => {
  it('is seeded with the thresholds the validation catalogue specifies', async () => {
    const rows = await db.$queryRaw<
      Array<{ grade: string; min_battery_health_pct: number; max_cycle_count: number }>
    >`SELECT grade, min_battery_health_pct, max_cycle_count
      FROM catalog.v_current_grade_definition ORDER BY min_battery_health_pct DESC`;

    // VR-094 / VR-095. Phase 2's prose says 90/80/70; that figure appears
    // nowhere else and both rules.ts and a passing test say otherwise.
    expect(rows.map((r) => [r.grade, r.min_battery_health_pct, r.max_cycle_count])).toEqual([
      ['A_PLUS', 85, 300],
      ['A', 75, 700],
      ['B', 60, 1200],
    ]);
  });

  it('refuses two definitions of one grade covering the same day', async () => {
    // A machine that meets two different definitions of Grade A has no grade.
    await expect(
      db.$executeRaw`
        INSERT INTO catalog.grade_definition
          (grade, effective_from, display_name, customer_description,
           min_battery_health_pct, min_cosmetic_score)
        VALUES ('A'::grade_type, CURRENT_DATE, 'A dup', 'dup', 70, 70)`,
    ).rejects.toThrow(/ex_grade_def_no_overlap/);
  });

  it('will not open a future revision while the current one is still open-ended', async () => {
    // The seeded row runs [2026-01-01, ∞), so a future revision overlaps it.
    // Refusing that is the point: two live definitions of Grade A means a
    // machine can meet both, and then it has no grade at all.
    await expect(
      db.$executeRaw`
        INSERT INTO catalog.grade_definition
          (grade, effective_from, display_name, customer_description,
           min_battery_health_pct, min_cosmetic_score)
        VALUES ('A'::grade_type, CURRENT_DATE + 365, 'A · 2027', 'stricter', 80, 70)`,
    ).rejects.toThrow(/ex_grade_def_no_overlap/);
  });

  it('accepts a future revision once the current one is closed', async () => {
    // Close, then open. This is the actual ops workflow for effective-dated
    // reference data, and the constraint is what forces it to be done properly.
    await db.$executeRaw`
      UPDATE catalog.grade_definition SET effective_to = CURRENT_DATE + 365
      WHERE grade = 'A' AND effective_to IS NULL`;

    await expect(
      db.$executeRaw`
        INSERT INTO catalog.grade_definition
          (grade, effective_from, display_name, customer_description,
           min_battery_health_pct, min_cosmetic_score)
        VALUES ('A'::grade_type, CURRENT_DATE + 365, 'A · 2027', 'stricter', 80, 70)`,
    ).resolves.toBe(1);

    // Today still reads today's rule. A report written now stays readable
    // against the numbers that applied when it was written.
    const [now] = await db.$queryRaw<Array<{ min_battery_health_pct: number }>>`
      SELECT min_battery_health_pct FROM catalog.v_current_grade_definition WHERE grade = 'A'`;
    expect(now!.min_battery_health_pct).toBe(75);

    // Restore, so this test does not leak into the next run: grade_definition
    // is reference data and survives truncateAll.
    await db.$executeRaw`DELETE FROM catalog.grade_definition WHERE display_name = 'A · 2027'`;
    await db.$executeRaw`
      UPDATE catalog.grade_definition SET effective_to = NULL
      WHERE grade = 'A' AND effective_to = CURRENT_DATE + 365`;
  });
});

describe('catalog.sku — the HSN defect', () => {
  it('defaults to the 8-digit laptop HSN, not the 4-digit heading', async () => {
    const [row] = await db.$queryRaw<Array<{ column_default: string }>>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema='catalog' AND table_name='sku' AND column_name='hsn_code'`;
    // Was '8471'. VR-098 requires ^[0-9]{8}$ and Delhivery rejects a 4-digit
    // heading on the e-way bill payload, so every SKU created without an
    // explicit HSN carried an invalid code onto an invoice line.
    expect(row!.column_default).toContain('84713010');
  });

  it('refuses a 4-digit HSN outright', async () => {
    const a = await anchors();
    await expect(
      db.$executeRaw`UPDATE catalog.sku SET hsn_code = '8471' WHERE id = ${a.skuId}::uuid`,
    ).rejects.toThrow(/chk_sku_hsn_8_digits/);
  });

  it('refuses an 8-digit HSN that is not in the master', async () => {
    const a = await anchors();
    // VR-098: "must exist in the seeded HSN master with a GST rate".
    await expect(
      db.$executeRaw`UPDATE catalog.sku SET hsn_code = '99999999' WHERE id = ${a.skuId}::uuid`,
    ).rejects.toThrow(/fk_sku_hsn/);
  });
});

describe('catalog.gst_rate — effective-dated, never hard-coded', () => {
  it('resolves 18% for laptops today', async () => {
    const [row] = await db.$queryRaw<Array<{ rate: string }>>`
      SELECT catalog.gst_rate_on('84713010') AS rate`;
    expect(Number(row!.rate)).toBe(18);
  });

  it('answers for a past date with the rate that applied then', async () => {
    // A throwaway HSN, not the real laptop one. hsn_code and gst_rate are
    // reference data excluded from truncateAll, so a test that mutates them
    // poisons every later run — which is exactly what happened the first time
    // this was written against '84713010'.
    const hsn = `9${String(Date.parse('2026-01-01')).slice(0, 7)}`.slice(0, 8);
    await db.$executeRaw`
      INSERT INTO catalog.hsn_code (code, description) VALUES (${hsn}, 'Test commodity')
      ON CONFLICT (code) DO NOTHING`;
    await db.$executeRaw`DELETE FROM catalog.gst_rate WHERE hsn_code = ${hsn}`;
    await db.$executeRaw`
      INSERT INTO catalog.gst_rate (hsn_code, rate_pct, effective_from, effective_to)
      VALUES (${hsn}, 18.00, DATE '2017-07-01', DATE '2030-01-01')`;
    await db.$executeRaw`
      INSERT INTO catalog.gst_rate (hsn_code, rate_pct, effective_from)
      VALUES (${hsn}, 12.00, DATE '2030-01-01')`;

    const [then] = await db.$queryRaw<Array<{ rate: string }>>`
      SELECT catalog.gst_rate_on(${hsn}, DATE '2026-06-01') AS rate`;
    const [later] = await db.$queryRaw<Array<{ rate: string }>>`
      SELECT catalog.gst_rate_on(${hsn}, DATE '2030-06-01') AS rate`;

    // A reprint of a 2026 invoice must still say 18, whatever the rate becomes.
    expect(Number(then!.rate)).toBe(18);
    expect(Number(later!.rate)).toBe(12);
  });

  it('refuses two rates covering the same day for one HSN', async () => {
    await expect(
      db.$executeRaw`
        INSERT INTO catalog.gst_rate (hsn_code, rate_pct, effective_from)
        VALUES ('84713010', 5.00, DATE '2020-01-01')`,
    ).rejects.toThrow(/ex_gst_rate_no_overlap/);
  });
});

describe('catalog.catalog_change_log — every mutation, with an actor', () => {
  it('can log an edit to a brand, which the old shape could not hold', async () => {
    const a = await anchors();
    // sku_id was NOT NULL and was the only anchor, so a brand, series or model
    // edit was physically unloggable.
    await expect(
      db.$executeRaw`
        INSERT INTO catalog.catalog_change_log
          (entity_type, entity_id, action, field, old_value, new_value, reason, changed_by)
        VALUES ('brand', ${a.brandId}::uuid, 'UPDATE', 'name', 'Dell', 'Dell Inc.',
                'Legal name correction', ${a.userId}::uuid)`,
    ).resolves.toBe(1);
  });

  it('refuses an actorless mutation', async () => {
    const a = await anchors();
    // Exit criterion 9 is "every mutation with an actor". changed_by was
    // nullable, so an anonymous row was legal.
    // Postgres reports 23502 without naming the column in Prisma's message, so
    // match the SQLSTATE rather than a column name that is not there.
    await expect(
      db.$executeRaw`
        INSERT INTO catalog.catalog_change_log
          (entity_type, entity_id, action, field, new_value, changed_by)
        VALUES ('sku', ${a.skuId}::uuid, 'UPDATE', 'ram_gb', '32', NULL)`,
    ).rejects.toThrow(/23502/);
  });

  it('refuses an entity type nothing in the catalog has', async () => {
    const a = await anchors();
    await expect(
      db.$executeRaw`
        INSERT INTO catalog.catalog_change_log
          (entity_type, entity_id, action, field, new_value, changed_by)
        VALUES ('invoice', ${a.skuId}::uuid, 'UPDATE', 'x', 'y', ${a.userId}::uuid)`,
    ).rejects.toThrow(/chk_change_log_entity/);
  });
});

describe('search', () => {
  it('indexes catalog terms and no vendor column — CAT-009b', async () => {
    await anchors();
    await db.$executeRaw`REFRESH MATERIALIZED VIEW catalog.mv_sku_search`;

    // pg_attribute, not information_schema.columns: a materialised view is
    // relkind 'm' and does not appear in information_schema at all, so the
    // catalogue view silently returns an empty set rather than an error.
    const cols = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT a.attname AS column_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'catalog' AND c.relname = 'mv_sku_search'
        AND a.attnum > 0 AND NOT a.attisdropped`;
    const names = cols.map((c) => c.column_name);
    expect(names.length).toBeGreaterThan(0);

    // Vendor anonymity (VR-099) has to hold through search ranking too, and the
    // cheapest way to guarantee that is for no vendor column to be reachable.
    expect(names.some((n) => /vendor|org|supplier/i.test(n))).toBe(false);
    expect(names).toContain('brand_name');
    expect(names).toContain('model_name');
  });

  it('finds a seeded SKU by its brand and model', async () => {
    const a = await anchors();
    await db.$executeRaw`REFRESH MATERIALIZED VIEW catalog.mv_sku_search`;
    const [row] = await db.$queryRaw<Array<{ brand_name: string; model_name: string }>>`
      SELECT brand_name, model_name FROM catalog.mv_sku_search WHERE sku_id = ${a.skuId}::uuid`;

    const hits = await db.$queryRaw<Array<{ sku_id: string }>>`
      SELECT sku_id FROM catalog.mv_sku_search
      WHERE search_tsv @@ plainto_tsquery('simple', ${row!.model_name})`;
    expect(hits.map((h) => h.sku_id)).toContain(a.skuId);
  });
});
