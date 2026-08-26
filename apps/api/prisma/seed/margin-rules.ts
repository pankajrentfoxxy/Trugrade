import type { PrismaClient } from '@prisma/client';

/**
 * Default margin rules (Phase 3 Task 5).
 *
 * These are STARTING VALUES, not decided business numbers. The phase brief says
 * "Ops tunes margins without a code release", and an exit criterion requires a
 * rule change to move the price of new listings with no deploy — so the seed's
 * only job is to make sure the resolver always finds a rule. Every percentage
 * below is a placeholder awaiting the client's real margin policy.
 *
 * Resolution is first-match-wins by `priority`, and a NULL predicate column
 * means "don't care". The ordering below therefore reads: a cheap machine first
 * (a thin absolute margin needs a fatter percentage to cover fixed QC and
 * freight cost), then by grade, then a catch-all.
 *
 * The IDs are fixed rather than generated, and the insert is ON CONFLICT DO
 * NOTHING rather than DO UPDATE. Re-running the seed must never stomp a value
 * ops has tuned in production — that would silently reprice live inventory,
 * which is the exact failure the "without a deploy" requirement is guarding
 * against.
 */
const MARGIN_RULES = [
  {
    id: '9f1b0001-0000-4000-8000-000000000001',
    priority: 5,
    grade: null,
    valueFrom: '0',
    valueTo: '25000',
    target: '20.00',
    floor: '13.00',
    note: 'Sub-₹25k: fixed QC and freight cost eats a thin absolute margin.',
  },
  {
    id: '9f1b0001-0000-4000-8000-000000000002',
    priority: 10,
    grade: 'B',
    valueFrom: null,
    valueTo: null,
    target: '18.00',
    floor: '11.00',
    note: 'Grade B claims most often, so it carries the largest warranty reserve.',
  },
  {
    id: '9f1b0001-0000-4000-8000-000000000003',
    priority: 20,
    grade: 'A',
    valueFrom: null,
    valueTo: null,
    target: '15.00',
    floor: '9.00',
    note: 'Grade A: the volume case.',
  },
  {
    id: '9f1b0001-0000-4000-8000-000000000004',
    priority: 30,
    grade: 'A_PLUS',
    valueFrom: null,
    valueTo: null,
    target: '13.00',
    floor: '8.00',
    note: 'Grade A+ sells fastest and claims least, so it can carry the thinnest margin.',
  },
  {
    id: '9f1b0001-0000-4000-8000-000000000005',
    priority: 100,
    grade: null,
    valueFrom: null,
    valueTo: null,
    target: '15.00',
    floor: '9.00',
    // The three grade rules above already cover every current enum value, so
    // this never fires today. It exists so that adding a grade to the enum
    // cannot leave the resolver with no rule and no price.
    note: 'Catch-all. Unreachable while A_PLUS/A/B are the only grades — deliberately so.',
  },
] as const;

/**
 * Warranty reserve as a percentage of selling price, banded by grade.
 *
 * We sell a longer total term than the vendor offers (`max(vendorMonths + 3, 6)`)
 * and fund months the vendor does not cover out of margin. A Grade B machine
 * claims more often than an A+, so it reserves more. Phase 9 releases the
 * reserve on expiry and draws it on claims.
 */
const RESERVE_PCT_BY_GRADE = { A_PLUS: 1.5, A: 2.5, B: 4.0 };

/** Every rule tops the vendor's term up by 3 months — see the warranty rule above. */
const WARRANTY_TOP_UP_MONTHS = 3;

export async function seedMarginRules(prisma: PrismaClient): Promise<number> {
  let added = 0;
  for (const r of MARGIN_RULES) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO procurement.margin_rule
        (id, priority, category, brand_id, grade, value_from, value_to,
         target_margin_pct, floor_margin_pct, warranty_top_up_months,
         reserve_pct_by_grade, effective_from, effective_to, is_active)
      VALUES (
        ${r.id}::uuid,
        ${r.priority},
        NULL,
        NULL,
        ${r.grade}::public.grade_type,
        ${r.valueFrom}::numeric,
        ${r.valueTo}::numeric,
        ${r.target}::numeric,
        ${r.floor}::numeric,
        ${WARRANTY_TOP_UP_MONTHS},
        ${JSON.stringify(RESERVE_PCT_BY_GRADE)}::jsonb,
        DATE '2020-01-01',
        NULL,
        TRUE
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id`;
    added += rows.length;
  }
  return added;
}

export const MARGIN_RULE_COUNT = MARGIN_RULES.length;
