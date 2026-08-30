import { Controller, Get } from '@nestjs/common';
import { Money, moneyFromDb, type Grade } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ClockPort } from '../../shared/clock';
import { PrismaService } from '../../shared/db/prisma.service';
import { MarginRuleRepository, type AdminMarginRule } from './internal/margin-rule.repository';
import {
  analyseRules,
  type Overlap,
  type RuleScope,
} from './internal/margin-rule-overlap';

/**
 * `/admin/pricing/rules` - `03_UX_SPEC.md` §3C.2.
 *
 * ## Why this lives in `listing` and not in `procurement`
 *
 * The table is `procurement.margin_rule`, and the obvious home would be the
 * module that owns the schema. It is the wrong one. `MarginRuleRepository` -
 * which is in THIS module - is the resolver: it decides which rule prices a
 * machine, and it is the only implementation of that decision anywhere. An
 * admin read in `procurement` would either re-implement the predicate walk or
 * reach across the seam for it, and a second answer to "which rule wins" is
 * precisely what this screen exists to prevent somebody discovering in a
 * dispute. So the read sits beside the resolver, and there is one order of
 * precedence in the codebase.
 *
 * ## What is NOT here, and why
 *
 * **There are no writes.** §3C.2 asks for create, edit, an effective date and a
 * simulator. None of that exists in the product: no route mutates
 * `procurement.margin_rule`, nothing writes `approved_by`, and a simulator with
 * nothing to save is a calculator. Building the read first is not a shortcut -
 * before today nobody could see which of five overlapping rules decides what we
 * keep on a machine, and that is the question a write screen would need
 * answered before it could safely offer an edit.
 *
 * **There is no price book.** `procurement.price_book` does not exist in the
 * schema, has no migration, no writer and no consumer. The response says so with
 * `to_regclass` rather than with a constant, so the day somebody adds the table
 * this screen stops claiming it is absent.
 *
 * ## Every rupee on this response is a stored one
 *
 * The live totals per rule are `SUM(listing.unit_price)` and
 * `SUM(unit.vendor_ask_price)` - what we actually charge and actually pay, read
 * off the rows. Nothing is re-priced to produce them. That is deliberate beyond
 * the usual reason: re-running the pricer would show what the rule SAYS, and the
 * gap between what it says and what is on the row is the only thing on this
 * screen worth looking at. A recomputed figure would hide exactly the drift it
 * was put there to reveal.
 */

const PRICED_STATUSES = ['ACTIVE', 'PARTIALLY_ACTIVE'];

/** `platform_config` keys the pricer overlays on top of every rule. */
const CONFIG_KEYS = [
  'platform.warranty_min_total_months',
  'price.rounding_step_inr',
  'price.guardrail_lower_multiple',
  'price.guardrail_upper_multiple',
  'qc.visit_fee_inr',
  'qc.visit_fee_waived_above',
  'qc.fee_bearer',
] as const;

/**
 * `minimumSellingPrice` in contracts defaults `minMarginAbsolute` to Rs 500 and
 * `PricingService` does not pass one, so this is the absolute floor in force.
 * It is a default in a function signature, not a config key - which is worth
 * saying out loud on a screen about what we keep, because it is the term that
 * actually bites on a cheap machine and nobody can tune it without a deploy.
 */
const MIN_MARGIN_ABSOLUTE_INR = 500;

export interface MarginRuleScopeView {
  /** `catalog.model.form_factor`. Null on every seeded rule. */
  category: string | null;
  brandId: string | null;
  /** Resolved through `catalog`, because a UUID is not a scope anyone can read. */
  brandName: string | null;
  grade: Grade | null;
  /** Half-open `[from, to)`, decimal strings. Null at either end is unbounded. */
  valueFrom: string | null;
  valueTo: string | null;
}

/** What this rule is currently pricing, in money that is already on the rows. */
export interface MarginRuleLiveView {
  listings: number;
  units: number;
  vendorPayout: string;
  sellingPrice: string;
  margin: string;
  /**
   * The margin as a percentage OF THE VENDOR PAYOUT, because that is the
   * denominator `target_margin_pct` uses (`Money.percentOf(payout, pct)`). The
   * commission a vendor is quoted is over the SELLING price and is a different
   * number; carrying both without their denominators is how two true
   * percentages get read as a contradiction.
   */
  marginPctOfPayout: number;
}

export interface MarginRuleView {
  id: string;
  priority: number;
  /** Position in the resolver's walk, 1-based. Ordering here is the answer. */
  order: number;
  scope: MarginRuleScopeView;
  targetMarginPct: number;
  floorMarginPct: number;
  /**
   * Always null, and not because no ceiling has been entered: **there is no
   * ceiling column on `procurement.margin_rule`.** §3C.2 describes a rule as
   * having one. A screen that rendered an absent column as 0 would be telling
   * ops we cap margin at nothing.
   */
  ceilingMarginPct: null;
  warrantyTopUpMonths: number;
  /** Per PLATFORM-BACKED MONTH, not a flat percentage. See `priceFromNetPayout`. */
  reservePctByGrade: Partial<Record<Grade, number>>;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  /** Active AND inside its effective window on today's IST business date. */
  inForceToday: boolean;
  /** Nullable on the table and null on all five rows. Nothing writes it. */
  approvedBy: string | null;
  overlaps: Overlap[];
  unreachableBecause: string[];
  /** Null when this rule prices nothing live - never a row of zeroes. */
  live: MarginRuleLiveView | null;
}

export interface PricingRulesView {
  /** The IST business date the resolver is reckoning effective dates on. */
  asAt: string;
  rules: MarginRuleView[];
  platform: {
    warrantyMinTotalMonths: number | null;
    roundingStepInr: number | null;
    guardrailLowerMultiple: number | null;
    /**
     * Set to 3.0 in the baseline migration and read by **nothing**:
     * `PricingService.priceBand` flags only the lower side, and no other file in
     * the API mentions the key. A configured knob that moves nothing is the same
     * failure as `reserve_pct_by_grade`, and the screen names it rather than
     * printing it beside the one that works as though they were a pair.
     */
    guardrailUpperMultiple: number | null;
    qcVisitFeeInr: string | null;
    qcVisitFeeWaivedAbove: number | null;
    qcFeeBearer: string | null;
    minMarginAbsoluteInr: number;
  };
  /**
   * Whether anything consumes `reserve_pct_by_grade`. T23 found that nothing
   * does. Two counts rather than a claim, so the screen states a fact it was
   * given rather than one somebody typed.
   */
  reserve: { warranties: number; withReserveAmount: number };
  /**
   * Whether any unit records the rule that priced it.
   *
   * `listing.unit.margin_rule_id` exists and `PricingService.priceListing`
   * writes it — so the platform CAN answer "which rule priced this serial". It
   * is NULL on every unit in this database, because the demo listings were
   * written by the seed at a flat commission rather than run through the engine.
   * Until it is populated, the per-rule totals below are a re-resolution against
   * today's rules and today's date, not a record of what happened, and the
   * screen has to say which of the two it is showing.
   */
  attribution: { unitsWithRetailPrice: number; unitsWithRuleRecorded: number };
  /** `procurement.price_book`, asked of the catalog rather than assumed. */
  priceBook: { tableExists: boolean };
  /** Live listings no rule matches at all. `compute()` refuses to price these. */
  unmatched: { listings: number; units: number };
}

interface ConfigRow {
  key: string;
  value_json: unknown;
}

/** One distinct combination of the four things a rule is resolved against. */
interface LiveCombination {
  skuId: string;
  grade: Grade;
  ask: Money;
  unitPrice: Money;
  listings: number;
  units: number;
}

@Controller('admin/pricing')
export class PricingAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: MarginRuleRepository,
    private readonly clock: ClockPort,
  ) {}

  /**
   * Every margin rule, in resolution order, with what it collides with and what
   * it is currently pricing.
   *
   * **Guarded on `listing.price.override`, and no new permission was invented.**
   * §3C.2 gives this screen to ADMIN_PRICING and ADMIN_SUPER, and that grant is
   * held by exactly PRICING_ADMIN and PLATFORM_SUPERADMIN. The obvious
   * alternative, `listing.any.read`, is also held by OPS_MANAGER, QC_MANAGER,
   * CATALOG_ADMIN and TECHNICIAN - four roles the spec does not put in this
   * room, and the room contains what we keep on every machine. It is a write
   * permission guarding a read, which is unusual and is the narrower of the two
   * honest choices.
   */
  @Get('margin-rules')
  @RequirePermissions('listing.price.override')
  async marginRules(): Promise<PricingRulesView> {
    const asAt = this.clock.todayInIst();
    const rules = await this.rules.all();

    const [brands, cfg, reserve, priceBookExists, attribution, combinations] = await Promise.all([
      this.brandNames(rules),
      this.config(),
      this.reserveEvidence(),
      this.priceBookExists(),
      this.attributionEvidence(),
      this.liveCombinations(),
    ]);

    const analysis = analyseRules(rules.map(toScope));
    const live = await this.liveByRule(combinations);

    return {
      asAt,
      rules: rules.map((rule) => {
        const found = analysis.find((a) => a.ruleId === rule.id);
        return {
          id: rule.id,
          priority: rule.priority,
          order: found?.order ?? 0,
          scope: {
            category: rule.category,
            brandId: rule.brandId,
            brandName: rule.brandId === null ? null : (brands.get(rule.brandId) ?? null),
            grade: rule.grade,
            valueFrom: rule.valueFrom?.toString() ?? null,
            valueTo: rule.valueTo?.toString() ?? null,
          },
          targetMarginPct: rule.targetMarginPct,
          floorMarginPct: rule.floorMarginPct,
          ceilingMarginPct: null,
          warrantyTopUpMonths: rule.warrantyTopUpMonths,
          reservePctByGrade: rule.reservePctByGrade,
          effectiveFrom: rule.effectiveFrom,
          effectiveTo: rule.effectiveTo,
          isActive: rule.isActive,
          // The same three conditions the resolver's WHERE applies, so "in force"
          // on this screen means what "in force" means to the pricer.
          inForceToday:
            rule.isActive &&
            rule.effectiveFrom <= asAt &&
            (rule.effectiveTo === null || rule.effectiveTo > asAt),
          approvedBy: rule.approvedBy,
          overlaps: found?.overlaps ?? [],
          unreachableBecause: found?.unreachableBecause ?? [],
          live: live.get(rule.id) ?? null,
        };
      }),
      platform: {
        warrantyMinTotalMonths: num(cfg, 'platform.warranty_min_total_months'),
        roundingStepInr: num(cfg, 'price.rounding_step_inr'),
          guardrailLowerMultiple: num(cfg, 'price.guardrail_lower_multiple'),
        guardrailUpperMultiple: num(cfg, 'price.guardrail_upper_multiple'),
        qcVisitFeeInr: str(cfg, 'qc.visit_fee_inr'),
        qcVisitFeeWaivedAbove: num(cfg, 'qc.visit_fee_waived_above'),
        qcFeeBearer: str(cfg, 'qc.fee_bearer'),
        minMarginAbsoluteInr: MIN_MARGIN_ABSOLUTE_INR,
      },
      reserve,
      attribution,
      priceBook: { tableExists: priceBookExists },
      unmatched: live.get(UNMATCHED)
        ? { listings: live.get(UNMATCHED)!.listings, units: live.get(UNMATCHED)!.units }
        : { listings: 0, units: 0 },
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The brand behind `margin_rule.brand_id`.
   *
   * A single-schema statement rather than a JOIN onto `procurement.margin_rule`,
   * for the reason the repository gives about the seam: a cross-schema join
   * binds two modules as tightly as an import does. `brand_id` is NULL on every
   * seeded rule, so this usually returns nothing and costs a round trip -
   * skipped entirely when it would.
   */
  private async brandNames(rules: readonly AdminMarginRule[]): Promise<Map<string, string>> {
    const ids = [...new Set(rules.map((r) => r.brandId).filter((b): b is string => b !== null))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM catalog.brand WHERE id = ANY(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async config(): Promise<Map<string, unknown>> {
    const rows = await this.prisma.$queryRaw<ConfigRow[]>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[...CONFIG_KEYS]}::text[])`;
    return new Map(rows.map((r) => [r.key, r.value_json]));
  }

  /**
   * How many warranty terms exist, and how many carry a reserve.
   *
   * The second number is the whole point. `reserve_pct_by_grade` is on every
   * rule and moves every price - a Grade B machine reserves 4% of payout per
   * platform-backed month - and `platform.warranty.reserve_amount` is NULL on
   * every row ever written, because nothing puts the accrual there. Counted
   * rather than asserted, so the screen cannot say it after somebody fixes it.
   */
  private async reserveEvidence(): Promise<{ warranties: number; withReserveAmount: number }> {
    const rows = await this.prisma.$queryRaw<Array<{ total: number; with_reserve: number }>>`
      SELECT count(*)::int AS total,
             count(reserve_amount)::int AS with_reserve
        FROM platform.warranty`;
    return {
      warranties: rows[0]?.total ?? 0,
      withReserveAmount: rows[0]?.with_reserve ?? 0,
    };
  }

  /**
   * How many units carry a price, and how many say which rule set it.
   *
   * Counted rather than asserted, for the reason the reserve is: the moment a
   * listing goes through `priceListing` the second number starts moving, and a
   * screen carrying a hard-coded "nothing records this" would then be lying in
   * the more dangerous direction.
   */
  private async attributionEvidence(): Promise<{
    unitsWithRetailPrice: number;
    unitsWithRuleRecorded: number;
  }> {
    const rows = await this.prisma.$queryRaw<Array<{ priced: number; attributed: number }>>`
      SELECT count(retail_price)::int AS priced,
             count(margin_rule_id)::int AS attributed
        FROM listing.unit`;
    return {
      unitsWithRetailPrice: rows[0]?.priced ?? 0,
      unitsWithRuleRecorded: rows[0]?.attributed ?? 0,
    };
  }

  /** Asked of the catalog. `to_regclass` is NULL for a relation that is not there. */
  private async priceBookExists(): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass('procurement.price_book') IS NOT NULL AS present`;
    return rows[0]?.present ?? false;
  }

  /**
   * Every distinct (SKU, grade, payout, price) on sale, with its unit count.
   *
   * Grouped in SQL rather than fetched per unit: 191 units collapse to ~34
   * combinations, and each combination costs one resolver call below. Only
   * LISTED units, because a RESERVED or DELIVERED one is no longer something a
   * rule change could reprice - and `unit.purchase_price` is frozen by
   * `trg_lock_purchase_price` the moment a purchase order names the serial, so
   * counting a sold machine here would imply a rule change reaches money that is
   * settled.
   *
   * One schema, no join across the seam.
   */
  private async liveCombinations(): Promise<LiveCombination[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        sku_id: string;
        grade: string;
        vendor_ask_price: unknown;
        unit_price: unknown;
        listings: number;
        units: number;
      }>
    >`
      SELECT l.sku_id, l.grade::text AS grade, u.vendor_ask_price, l.unit_price,
             count(DISTINCT l.id)::int AS listings, count(*)::int AS units
        FROM listing.listing l
        JOIN listing.unit u ON u.listing_id = l.id
       WHERE l.status::text = ANY(${PRICED_STATUSES}::text[])
         AND u.status::text = 'LISTED'
         AND u.vendor_ask_price IS NOT NULL
       GROUP BY l.sku_id, l.grade, u.vendor_ask_price, l.unit_price`;

    return rows.flatMap((r) => {
      const ask = moneyFromDb(r.vendor_ask_price as string | null);
      const unitPrice = moneyFromDb(r.unit_price as string | null);
      // A unit with no ask cannot be resolved against a value band, and guessing
      // one would put it under a rule it may not belong to.
      if (!ask || !unitPrice) return [];
      return [
        {
          skuId: r.sku_id,
          grade: r.grade as Grade,
          ask,
          unitPrice,
          listings: r.listings,
          units: r.units,
        },
      ];
    });
  }

  /**
   * Which rule prices each live combination, and what that adds up to.
   *
   * `resolveFor` is the pricer's own lookup, called once per combination - about
   * thirty-four calls today, two indexed queries each.
   *
   * ponytail: linear in distinct (SKU, grade, payout) combinations. If the live
   * catalogue reaches thousands, resolve once per (category, brand, grade, band)
   * instead - the predicates are what the answer depends on, not the SKU.
   *
   * **This says which rule WOULD price the machine today, not which one DID.**
   * `listing.unit.margin_rule_id` is the column that would answer the second
   * question and `PricingService.priceListing` writes it — but it is NULL on
   * every unit here, because the demo listings were written by the seed at a
   * flat commission and never went through the engine. So this is a
   * re-resolution against today's rules and today's date; where a rule has since
   * been edited or expired, the row on the screen was priced by something else.
   * `attribution` on the response carries both counts so the screen can say so.
   */
  private async liveByRule(
    combinations: readonly LiveCombination[],
  ): Promise<Map<string, MarginRuleLiveView>> {
    const totals = new Map<
      string,
      { listings: number; units: number; payout: Money; price: Money }
    >();

    for (const c of combinations) {
      const matched = await this.rules.resolveFor(c.skuId, c.grade, c.ask);
      const key = matched?.id ?? UNMATCHED;
      const running = totals.get(key) ?? {
        listings: 0,
        units: 0,
        payout: Money.ZERO,
        price: Money.ZERO,
      };
      totals.set(key, {
        listings: running.listings + c.listings,
        units: running.units + c.units,
        // Per unit, multiplied by the count — the stored figures, never re-priced.
        payout: running.payout.add(Money.paiseOf(c.ask.paise * BigInt(c.units))),
        price: running.price.add(Money.paiseOf(c.unitPrice.paise * BigInt(c.units))),
      });
    }

    return new Map(
      [...totals].map(([ruleId, t]) => {
        const margin = t.price.sub(t.payout);
        return [
          ruleId,
          {
            listings: t.listings,
            units: t.units,
            vendorPayout: t.payout.toString(),
            sellingPrice: t.price.toString(),
            margin: margin.toString(),
            marginPctOfPayout: t.payout.isZero()
              ? 0
              : Math.round((Number(margin.paise) / Number(t.payout.paise)) * 1000) / 10,
          },
        ];
      }),
    );
  }
}

/** The bucket for live stock no rule matches. Not a rule id, and never one. */
const UNMATCHED = 'unmatched';

const toScope = (r: AdminMarginRule): RuleScope => ({
  id: r.id,
  priority: r.priority,
  createdAt: r.createdAt,
  category: r.category,
  brandId: r.brandId,
  grade: r.grade,
  valueFrom: r.valueFrom,
  valueTo: r.valueTo,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  isActive: r.isActive,
});

/** A missing config key is null, never a default. Nobody decided a default here. */
function num(cfg: Map<string, unknown>, key: string): number | null {
  const raw = cfg.get(key);
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(cfg: Map<string, unknown>, key: string): string | null {
  const raw = cfg.get(key);
  return typeof raw === 'string' ? raw : raw === undefined || raw === null ? null : String(raw);
}
