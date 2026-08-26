import type { PrismaClient } from '@prisma/client';
import { GRADES, GRADE_THRESHOLDS } from '@trugrade/contracts';

/**
 * Grade definitions, seeded from the single source in `packages/contracts`.
 *
 * The numbers are NOT retyped here. `GRADE_THRESHOLDS` is the one place they
 * live, and this function projects them into the table the Phase 4 QC engine
 * reads — so the constant is the seed input, never a second live source of
 * truth competing with the database.
 *
 * That direction matters: Task 5's whole argument is that a grade must be a
 * threshold a machine either meets or does not, evaluated against a versioned
 * row rather than a technician's opinion or a constant someone edited.
 *
 * Thresholds are 85/75/60 per TEST_PLAN VR-094/VR-095. Phase 2's prose says
 * 90/80/70; that figure appears nowhere else in the pack.
 */

interface GradeCopy {
  displayName: string;
  customerDescription: string;
  minCosmeticScore: number;
  screenDefectsAllowed: boolean;
  allowedDefects: Record<string, unknown>;
}

const COPY: Record<(typeof GRADES)[number], GradeCopy> = {
  A_PLUS: {
    displayName: 'A+ · Near-new',
    customerDescription:
      'Indistinguishable from new at arm’s length. No scratches, dents or discolouration on any surface. Screen is flawless.',
    minCosmeticScore: 90,
    screenDefectsAllowed: false,
    // Shapes, not prose: the Phase 4 engine evaluates these numerically.
    allowedDefects: { scratches: { maxCount: 0, maxLengthMm: 0 }, dents: { maxCount: 0 } },
  },
  A: {
    displayName: 'A · Excellent',
    customerDescription:
      'Light use, visible only on close inspection. Up to two faint surface scratches under 10 mm. No dents, no screen defects.',
    minCosmeticScore: 75,
    screenDefectsAllowed: false,
    allowedDefects: { scratches: { maxCount: 2, maxLengthMm: 10 }, dents: { maxCount: 0 } },
  },
  B: {
    displayName: 'B · Good',
    customerDescription:
      'Honest working condition with cosmetic wear you will notice. Up to three scratches under 10 mm and light edge wear. Fully functional and inspected to the same standard as every other grade.',
    minCosmeticScore: 60,
    screenDefectsAllowed: false,
    allowedDefects: {
      scratches: { maxCount: 3, maxLengthMm: 10 },
      dents: { maxCount: 1, maxDepthMm: 1 },
      edgeWear: { allowed: true },
    },
  },
};

export const GRADE_DEFINITION_COUNT = GRADES.length;

export async function seedGradeDefinitions(prisma: PrismaClient): Promise<number> {
  let written = 0;
  for (const grade of GRADES) {
    const t = GRADE_THRESHOLDS[grade];
    const c = COPY[grade];
    // Idempotent on the natural key. Re-running never creates a second
    // definition for the same day — the EXCLUDE constraint would reject it
    // anyway, and a seed that cannot be re-run is a seed nobody runs.
    const n = await prisma.$executeRaw`
      INSERT INTO catalog.grade_definition
        (grade, effective_from, display_name, customer_description,
         min_battery_health_pct, max_cycle_count, min_cosmetic_score,
         allowed_defects_json, screen_defects_allowed)
      VALUES (${grade}::grade_type, DATE '2026-01-01', ${c.displayName}, ${c.customerDescription},
              ${t.minBatteryHealthPct}::int, ${t.maxCycleCount}::int, ${c.minCosmeticScore}::int,
              ${JSON.stringify(c.allowedDefects)}::jsonb, ${c.screenDefectsAllowed})
      ON CONFLICT (grade, effective_from) DO UPDATE
        SET display_name           = EXCLUDED.display_name,
            customer_description   = EXCLUDED.customer_description,
            min_battery_health_pct = EXCLUDED.min_battery_health_pct,
            max_cycle_count        = EXCLUDED.max_cycle_count,
            min_cosmetic_score     = EXCLUDED.min_cosmetic_score,
            allowed_defects_json   = EXCLUDED.allowed_defects_json,
            screen_defects_allowed = EXCLUDED.screen_defects_allowed`;
    written += n;
  }
  return written;
}

/**
 * The HSN master and its effective-dated GST rates.
 *
 * VR-131 says "no hard-coded 18 in code" and CAT-008 requires the rate to be
 * resolved from this table. The migration inserts the laptop row so a freshly
 * migrated database is usable; this repeats it idempotently so a seed run on a
 * database whose reference rows were cleared restores them.
 */
export async function seedHsnAndGst(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO catalog.hsn_code (code, description) VALUES
      ('84713010', 'Portable digital automatic data processing machines, weighing not more than 10 kg'),
      ('84713090', 'Other digital automatic data processing machines'),
      ('84718000', 'Other units of automatic data processing machines'),
      ('85044030', 'Static converters — laptop power adapters')
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description`;

  for (const code of ['84713010', '84713090', '84718000', '85044030']) {
    await prisma.$executeRaw`
      INSERT INTO catalog.gst_rate (hsn_code, rate_pct, effective_from, notification)
      SELECT ${code}, 18.00, DATE '2017-07-01',
             'Notification 1/2017-Central Tax (Rate), Schedule III'
      WHERE NOT EXISTS (
        SELECT 1 FROM catalog.gst_rate
        WHERE hsn_code = ${code} AND effective_from = DATE '2017-07-01')`;
  }
}

export async function seedCatalogReference(
  prisma: PrismaClient,
  log: (msg: string) => void = () => undefined,
): Promise<void> {
  await seedHsnAndGst(prisma);
  const grades = await seedGradeDefinitions(prisma);
  log(`  catalog: 4 HSN codes with rates, ${grades} grade definition(s)`);
}
