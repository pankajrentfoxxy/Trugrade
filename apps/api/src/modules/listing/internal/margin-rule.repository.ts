import { Injectable } from '@nestjs/common';
import { GRADES, moneyFromDb, type Grade, type MarginRule, type Money } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';

/**
 * Resolving `procurement.margin_rule`: **first match wins, by priority**.
 *
 * Three properties are this layer's and nothing else's:
 *
 *   1. **Nothing is cached, at any lifetime.** The exit criterion is that ops
 *      changes a margin and the next listing prices differently *without a
 *      deploy*. A process-lifetime cache makes that true only after a restart,
 *      which is the same as false — and worse, it is false intermittently,
 *      because one pod restarts and the other does not. Every call reads the
 *      table. The lookup is one indexed row; there is nothing here worth
 *      trading that criterion for.
 *   2. **A NULL predicate means "don't care".** The same shape as the Phase 8
 *      routing rules, written as `col IS NULL OR col = $n` so the whole
 *      statement is static text and no part of it is assembled from a string.
 *   3. **Effective dating is honoured in the query, on the injected clock's
 *      business date.** A rule that starts tomorrow is scheduled, not current —
 *      the same bug `v_current_config` was fixed for, where a timestamp
 *      compared against `CURRENT_DATE` made a row invisible for its first day.
 *
 * `value_from` / `value_to` are the only monetary columns on the table and this
 * file deliberately never SELECTs them: they are query *bounds*, so the money
 * goes in as a bind parameter and never comes back out as a `Decimal` somebody
 * might reach for `Number()` on. The two percentages that do come back are
 * rates, not amounts, and `Number()` is the right conversion for them — the
 * same call that would be a defect one column over.
 */

/** What the rule predicates are evaluated against. */
export interface MarginRulePredicates {
  /** `catalog.model.form_factor`. NULL on a SKU whose model never declared one. */
  category: string | null;
  brandId: string | null;
  grade: Grade;
  /** The vendor's ask, which is what the `value_from`/`value_to` band brackets. */
  value: Money;
}

export interface ResolvedMarginRule {
  id: string;
  /** Carried so an explanation can say *which* rule priced a listing. */
  priority: number;
  rule: MarginRule;
}

interface RawRule {
  id: string;
  priority: number;
  target_margin_pct: unknown;
  floor_margin_pct: unknown;
  warranty_top_up_months: number;
  reserve_pct_by_grade: unknown;
}

/**
 * `{"A_PLUS":0.8,"A":1.2,"B":2.0}` out of JSONB.
 *
 * Read key by key against the known grades rather than cast wholesale. The
 * column is free-form JSON that ops edits by hand, and a typo'd grade key or a
 * quoted `"1.2"` has to degrade to "no reserve for that grade" — which prices
 * the listing slightly in the buyer's favour — rather than reach
 * `Money.percentOf` as a NaN and take the whole wizard down.
 */
function toReserveBands(v: unknown): Partial<Record<Grade, number>> {
  const out: Partial<Record<Grade, number>> = {};
  if (!v || typeof v !== 'object') return out;
  const obj = v as Record<string, unknown>;
  for (const grade of GRADES) {
    const pct = obj[grade];
    if (typeof pct === 'number' && Number.isFinite(pct)) out[grade] = pct;
  }
  return out;
}

/** One rule as the admin screen needs it: every column, converted once, here. */
export interface AdminMarginRule {
  id: string;
  priority: number;
  category: string | null;
  brandId: string | null;
  grade: Grade | null;
  /** Half-open `[valueFrom, valueTo)`. `null` at either end means unbounded. */
  valueFrom: Money | null;
  valueTo: Money | null;
  targetMarginPct: number;
  floorMarginPct: number;
  warrantyTopUpMonths: number;
  reservePctByGrade: Partial<Record<Grade, number>>;
  /** Nullable on the table. Nobody has ever set it; the screen says so. */
  approvedBy: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: Date;
}

interface RawAdminRule {
  id: string;
  priority: number;
  category: string | null;
  brand_id: string | null;
  grade: string | null;
  value_from: unknown;
  value_to: unknown;
  target_margin_pct: unknown;
  floor_margin_pct: unknown;
  warranty_top_up_months: number;
  reserve_pct_by_grade: unknown;
  approved_by: string | null;
  effective_from: Date;
  effective_to: Date | null;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
export class MarginRuleRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  /** The whole lookup for one listing: derive the predicates, then match. */
  async resolveFor(skuId: string, grade: Grade, value: Money): Promise<ResolvedMarginRule | null> {
    const { category, brandId } = await this.predicatesFor(skuId);
    return this.resolve({ category, brandId, grade, value });
  }

  /**
   * The first rule, by priority, whose every non-NULL predicate holds today.
   *
   * The value band is half-open — `[value_from, value_to)`. Ops entering
   * 0–25000 and 25000–50000 gets exactly one match at 25000, which is the
   * boundary a closed range double-matches and an exclusive one drops through.
   * Both of those are worse than the arithmetic reading slightly oddly once.
   *
   * A NULL predicate on the *rule* matches anything; a NULL value on the
   * *listing* (a SKU whose model has no form factor) matches only a rule that
   * does not name a category, because `category = NULL` is NULL and the row
   * falls out. That is the wanted answer: a rule written for workstations must
   * not price a machine we cannot show is one.
   */
  async resolve(p: MarginRulePredicates): Promise<ResolvedMarginRule | null> {
    // VR-160: effective dating is a business window, so it is reckoned on the
    // IST calendar date rather than on a UTC instant. A rule effective from the
    // 1st is live at midnight in Delhi, not at 05:30.
    const today = this.clock.todayInIst();
    const value = p.value.toString();

    const rows = await this.prisma.$queryRaw<RawRule[]>`
      SELECT id, priority, target_margin_pct, floor_margin_pct,
             warranty_top_up_months, reserve_pct_by_grade
        FROM procurement.margin_rule
       WHERE is_active
         AND effective_from <= ${today}::date
         AND (effective_to IS NULL OR effective_to > ${today}::date)
         AND (category   IS NULL OR category   = ${p.category})
         AND (brand_id   IS NULL OR brand_id   = ${p.brandId}::uuid)
         AND (grade      IS NULL OR grade      = ${p.grade}::public.grade_type)
         AND (value_from IS NULL OR value_from <= ${value}::numeric)
         AND (value_to   IS NULL OR value_to   >  ${value}::numeric)
       ORDER BY priority, created_at, id
       LIMIT 1`;

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      priority: row.priority,
      rule: {
        // NUMERIC(6,3) percentages. Rates, not amounts.
        targetMarginPct: Number(row.target_margin_pct),
        floorMarginPct: Number(row.floor_margin_pct),
        warrantyTopUpMonths: row.warranty_top_up_months,
        reservePctByGrade: toReserveBands(row.reserve_pct_by_grade),
        // minTotalWarrantyMonths is deliberately absent. It is not a column on
        // this table — it is `platform.warranty_min_total_months` — and the
        // pricing service overlays it from config. A default invented here
        // would be a second place the customer's warranty floor gets decided,
        // and the floor is the half of Q22 that the column name already hides.
      },
    };
  }

  /**
   * Every rule, in the resolver's own walk order. **The admin read.**
   *
   * Two things about this method that the resolver above deliberately does not
   * do, and both are about the screen rather than about pricing.
   *
   * **It selects `value_from` and `value_to`.** The class comment says the
   * resolver never does, and the reason is real: they are query bounds, so the
   * money goes in as a bind parameter and never comes back as a `Decimal` that
   * somebody reaches for `Number()` on. Ops still has to be able to READ the
   * band, so this one selects them - and converts through `moneyFromDb`, never
   * through `Number`. The hazard was the conversion, not the projection.
   *
   * **It ignores the clock and `is_active`.** A rule that starts next month and
   * a rule somebody switched off are both things ops has to be able to see; the
   * resolver's job is to exclude them, and this one's is to show them with their
   * state on the row. A screen that silently hid a scheduled rule would be a
   * screen that hides the change about to move every price.
   */
  async all(): Promise<AdminMarginRule[]> {
    const rows = await this.prisma.$queryRaw<RawAdminRule[]>`
      SELECT id, priority, category, brand_id, grade::text AS grade,
             value_from, value_to, target_margin_pct, floor_margin_pct,
             warranty_top_up_months, reserve_pct_by_grade, approved_by,
             effective_from, effective_to, is_active, created_at
        FROM procurement.margin_rule
       ORDER BY priority, created_at, id`;

    return rows.map((r) => ({
      id: r.id,
      priority: r.priority,
      category: r.category,
      brandId: r.brand_id,
      grade: (r.grade as Grade | null) ?? null,
      valueFrom: moneyFromDb(r.value_from as string | null),
      valueTo: moneyFromDb(r.value_to as string | null),
      targetMarginPct: Number(r.target_margin_pct),
      floorMarginPct: Number(r.floor_margin_pct),
      warrantyTopUpMonths: r.warranty_top_up_months,
      reservePctByGrade: toReserveBands(r.reserve_pct_by_grade),
      approvedBy: r.approved_by,
      // DATE columns. Sliced rather than formatted: an effective date is a
      // business day on the IST calendar and putting it through a timezone
      // conversion is how a rule starts a day early in one place.
      effectiveFrom: r.effective_from.toISOString().slice(0, 10),
      effectiveTo: r.effective_to === null ? null : r.effective_to.toISOString().slice(0, 10),
      isActive: r.is_active,
      createdAt: r.created_at,
    }));
  }

  /**
   * The SKU's brand and category, for the rule predicates.
   *
   * `catalog` is another module, so this is its own single-schema statement and
   * not a join onto `procurement.margin_rule`. `no-cross-schema-join` exists
   * because a JOIN across the seam binds two modules exactly as tightly as an
   * import does. `CatalogService.getSku()` would be the right call, but it
   * returns `brandName` and `margin_rule.brand_id` is a UUID FK; when catalog
   * publishes the id on its barrel, this should call that instead.
   *
   * `model.form_factor` is read as the category. `margin_rule.category` is free
   * TEXT with no CHECK, and the form factor is the only column in the database
   * that answers "what kind of machine is this" — which is what ops is reaching
   * for when they write a rule for workstations.
   */
  private async predicatesFor(
    skuId: string,
  ): Promise<{ category: string | null; brandId: string | null }> {
    const rows = await this.prisma.$queryRaw<Array<{ brand_id: string; category: string | null }>>`
      SELECT b.id AS brand_id, m.form_factor AS category
        FROM catalog.sku s
        JOIN catalog.model m ON m.id = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand b ON b.id = se.brand_id
       WHERE s.id = ${skuId}::uuid`;

    const row = rows[0];
    // A missing SKU is not this file's error to raise. It resolves to "nothing
    // matched", the pricing service refuses to price, and the caller gets one
    // refusal rather than two different ones for the same cause.
    return { category: row?.category ?? null, brandId: row?.brand_id ?? null };
  }
}
