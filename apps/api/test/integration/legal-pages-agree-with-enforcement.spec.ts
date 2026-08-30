/**
 * T48 — the two endpoints the published legal pages read must equal the rows
 * that enforce the rules those pages describe.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES, AND WHY IT IS NOT A CONTROLLER TEST
 * ---------------------------------------------------------------------------
 * `/legal/returns-and-refunds` states an inspection window. `ReturnsService`
 * enforces one. If the two ever differ, the customer holds us to the published
 * document and we have manufactured a liability out of prose — which is exactly
 * the class of defect a render test or a snapshot cannot see, because both
 * numbers render perfectly well.
 *
 * The chain has two links and this file is the lower one:
 *
 *   enforcement rows  ──(here)──▶  the public endpoints  ──▶  the rendered page
 *                                                            (t48.spec.tsx)
 *
 * So the assertions below never compare an endpoint against a literal. They
 * compare it against `platform.v_current_config` and `catalog.grade_definition`
 * — read in the same test, from the same database — because a literal in a test
 * file is one more place the number can be wrong.
 *
 * The one place a literal IS asserted is the control case: `48` must be what
 * config actually holds after a seed. Without it, every equality below would
 * pass just as happily against two readers that were both broken in the same
 * way, which is the shape of vacuous test this repo has been bitten by three
 * times.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { GRADE_THRESHOLDS, INSPECTION_WINDOW_HOURS } from '@trugrade/contracts';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { CatalogPublicController } from '../../src/modules/catalog/catalog-public.controller';
import { PlatformPublicController } from '../../src/modules/platform/platform-public.controller';
import { closeTestDb, migrateTestDatabase, seedTestReference, testDatabaseUrl, testDb } from '../support/db';

let moduleRef: TestingModule;
let platform: PlatformPublicController;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  // The grade rows are catalog reference data and `seedReference` does not
  // write them. Seeding here from the same function the real seed calls keeps
  // this suite honest about what a deployed database holds.
  const { seedGradeDefinitions } = await import('../../prisma/seed/catalog-reference');
  await seedGradeDefinitions(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    controllers: [PlatformPublicController],
    providers: [
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
    ],
  }).compile();

  platform = moduleRef.get(PlatformPublicController);
}, 120_000);

afterAll(async () => {
  await moduleRef?.close();
  await closeTestDb();
});

/* ========================================================================== */

describe('/public/legal-terms equals the config the enforcement reads', () => {
  /** The view `ReturnsService`, `PayableService` and `WarrantyService` all read. */
  async function configured(key: string): Promise<unknown> {
    const rows = await raw.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${key}`;
    return rows[0]?.value_json ?? null;
  }

  it('publishes the inspection window that is actually configured', async () => {
    const published = await platform.legalTerms();
    expect(published.inspectionWindowHours).toBe(await configured('ordering.inspection_window_hours'));
  });

  /**
   * The control. If the seeded value were something other than 48, the equality
   * above would still pass and the test would be proving nothing about the
   * number a customer is shown — so the fact under test is pinned once, here,
   * against the constant the seed is built from.
   */
  it('and that window is the 48 hours the commercial model is built on', async () => {
    expect(await configured('ordering.inspection_window_hours')).toBe(INSPECTION_WINDOW_HOURS);
    expect(INSPECTION_WINDOW_HOURS).toBe(48);
  });

  it('publishes the warranty top-up and floor the warranty service computes from', async () => {
    const published = await platform.legalTerms();
    expect(published.warrantyTopUpMonths).toBe(await configured('platform.warranty_top_up_months'));
    expect(published.warrantyMinTotalMonths).toBe(
      await configured('platform.warranty_min_total_months'),
    );
    // A floor below the top-up would make the max() rule the page describes
    // meaningless, and the page would be describing arithmetic nobody does.
    expect(published.warrantyMinTotalMonths!).toBeGreaterThanOrEqual(
      published.warrantyTopUpMonths!,
    );
  });

  it('publishes the r.4(5) clocks, which until now nothing read at all', async () => {
    const published = await platform.legalTerms();
    expect(published.grievanceAckHours).toBe(await configured('platform.grievance_ack_hours'));
    expect(published.grievanceRedressDays).toBe(
      await configured('platform.grievance_redress_days'),
    );
    // r.4(4)-(5) set the outer limits. A configured value beyond either would
    // put the published policy outside the rule it cites.
    expect(published.grievanceAckHours!).toBeLessThanOrEqual(48);
    expect(published.grievanceRedressDays!).toBeLessThanOrEqual(31);
  });

  /**
   * Attempt the forbidden thing rather than assert a guard exists.
   *
   * `v_current_config` selects the newest row whose `effective_from` has passed,
   * so pushing that date into the future is how a key stops being in effect —
   * which is exactly what an ops mistake, or a key that was never seeded, looks
   * like from the endpoint's side. The published page must then say the term is
   * unstated. Falling back to 48 would put a number on a legal document that
   * nobody in the business had set.
   */
  it('answers null rather than a default when the key is not in effect', async () => {
    const key = 'ordering.inspection_window_hours';
    await raw.$executeRaw`
      UPDATE platform.platform_config SET effective_from = now() + interval '10 years'
       WHERE key = ${key}`;
    try {
      expect(await configured(key)).toBeNull();
      expect((await platform.legalTerms()).inspectionWindowHours).toBeNull();
    } finally {
      await raw.$executeRaw`
        UPDATE platform.platform_config SET effective_from = now() - interval '10 years'
         WHERE key = ${key}`;
    }
    // And it comes back, so the rest of the suite is not left looking at a
    // database this test broke.
    expect((await platform.legalTerms()).inspectionWindowHours).toBe(INSPECTION_WINDOW_HOURS);
  });

  /**
   * The other half of that guard. A key holding a string is not a number of
   * hours, and printing `"forty-eight"` where a duration belongs would be a
   * published term nobody can compute against.
   */
  it('answers null rather than printing a value that is not a number', async () => {
    const key = 'platform.grievance_ack_hours';
    await raw.$executeRaw`
      INSERT INTO platform.platform_config (key, value_json, effective_from, description)
      VALUES (${key}, '"thirty-six"'::jsonb, now() + interval '1 second', 'T48 guard probe')`;
    try {
      // The new row is the current one a second later.
      await new Promise((r) => setTimeout(r, 1200));
      expect((await platform.legalTerms()).grievanceAckHours).toBeNull();
    } finally {
      await raw.$executeRaw`
        DELETE FROM platform.platform_config WHERE description = 'T48 guard probe'`;
    }
  });
});

/* ========================================================================== */

describe('/public/grades equals catalog.grade_definition — the r.7(5) exposure', () => {
  interface Row {
    grade: string;
    min_battery_health_pct: number | null;
    max_cycle_count: number | null;
    min_cosmetic_score: number | null;
    screen_defects_allowed: boolean;
    customer_description: string;
    display_name: string;
  }

  /**
   * `grades()` reads Prisma and nothing else — the listing, QC and ordering
   * services on the constructor belong to `stats`, `offers` and `search`. So the
   * controller is built directly with the three it does not touch left absent,
   * rather than standing up half the application to exercise one SELECT. If the
   * endpoint ever grows a second dependency, this throws rather than passing.
   */
  function catalogController(): CatalogPublicController {
    return new CatalogPublicController(moduleRef.get(PrismaService), undefined!, undefined!, undefined!);
  }

  async function rows(): Promise<Row[]> {
    return raw.$queryRaw<Row[]>`
      SELECT grade::text AS grade, display_name, customer_description,
             min_battery_health_pct::int AS min_battery_health_pct,
             max_cycle_count::int AS max_cycle_count,
             min_cosmetic_score::int AS min_cosmetic_score,
             screen_defects_allowed
        FROM catalog.grade_definition
       WHERE effective_to IS NULL
       ORDER BY CASE grade::text WHEN 'A_PLUS' THEN 1 WHEN 'A' THEN 2 ELSE 3 END`;
  }

  it('publishes every floor on every current row, unchanged', async () => {
    const published = await catalogController().grades();
    const actual = await rows();

    expect(published).toHaveLength(actual.length);
    expect(actual).toHaveLength(3);

    published.forEach((p, i) => {
      const row = actual[i]!;
      expect(p.grade).toBe(row.grade);
      expect(p.displayName).toBe(row.display_name);
      expect(p.customerDescription).toBe(row.customer_description);
      expect(p.minBatteryHealthPct).toBe(row.min_battery_health_pct);
      expect(p.maxCycleCount).toBe(row.max_cycle_count);
      expect(p.minCosmeticScore).toBe(row.min_cosmetic_score);
      expect(p.screenDefectsAllowed).toBe(row.screen_defects_allowed);
    });
  });

  /**
   * The control again. The equality above holds if both sides are empty, and a
   * `/legal/grading` page rendering an empty table would be a r.7(5) failure
   * that every assertion so far reports as a pass.
   */
  it('and those rows carry the thresholds the QC engine grades against', async () => {
    const actual = await rows();
    for (const row of actual) {
      const threshold = GRADE_THRESHOLDS[row.grade as keyof typeof GRADE_THRESHOLDS];
      expect(threshold).toBeDefined();
      expect(row.min_battery_health_pct).toBe(threshold.minBatteryHealthPct);
      expect(row.max_cycle_count).toBe(threshold.maxCycleCount);
    }
  });

  it('publishes a cosmetic floor for every grade, because the page states one', async () => {
    // `/legal/grading` prints three floors per grade. A null cosmetic score
    // renders as "Not set", which is honest but is also a document that has
    // stopped defining the grade — worth failing over rather than shipping.
    const published = await catalogController().grades();
    for (const g of published) {
      expect(g.minCosmeticScore).not.toBeNull();
      expect(g.minBatteryHealthPct).not.toBeNull();
      expect(g.maxCycleCount).not.toBeNull();
    }
  });

  it('orders the grades A+, A, B so the published table reads down the scale', async () => {
    const published = await catalogController().grades();
    expect(published.map((g) => g.grade)).toEqual(['A_PLUS', 'A', 'B']);
    // Monotonic, which is what makes the table a scale rather than a list.
    for (let i = 1; i < published.length; i += 1) {
      expect(published[i]!.minBatteryHealthPct!).toBeLessThan(
        published[i - 1]!.minBatteryHealthPct!,
      );
      expect(published[i]!.maxCycleCount!).toBeGreaterThan(published[i - 1]!.maxCycleCount!);
    }
  });
});
