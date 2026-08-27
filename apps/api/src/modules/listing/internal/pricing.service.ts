import { Injectable } from '@nestjs/common';
import {
  Money,
  moneyFromDb,
  computeTds,
  landedPrice,
  minimumSellingPrice,
  payoutFromCommission,
  priceFromNetPayout,
  type Grade,
  type LandedPrice,
  type PriceBreakdown,
  type PricingMode,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { OrgScope, RequestContextService } from '../../../shared/db/org-scope';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import {
  ListingRepository,
  type ListingRow,
  type PublicPricingFacts,
} from './listing.repository';
import { MarginRuleRepository } from './margin-rule.repository';

/**
 * The pricing engine's *edges*: resolution, persistence and guard rails.
 *
 * The arithmetic is not here and must not be copied here. `priceFromNetPayout`,
 * `payoutFromCommission`, `minimumSellingPrice` and `landedPrice` live in
 * `@trugrade/contracts` so the wizard runs the identical constant on every
 * keystroke and the server runs it again on submit (VR-META-01). A second
 * implementation that agrees today is the one that quietly stops agreeing, and
 * the symptom is a vendor being paid a different number from the one the screen
 * promised them.
 *
 * What this file owns:
 *
 *   - **Resolving the inputs.** Which margin rule, which config values, which
 *     of the two pricing modes the vendor is on.
 *   - **Persisting the answer.** `listing.unit_price`, `unit.retail_price`,
 *     `unit.margin_rule_id`, and an append-only `price_history` row carrying the
 *     actor, the reason and the change source.
 *   - **The two guard rails.** A floor margin that blocks activation until ops
 *     overrides it *on the record*, and a price-band check against the trailing
 *     30-day median that **flags and never blocks**.
 *
 * ## The rule that governs every return type in this file
 *
 * **The vendor never sees the retail price.** `VendorPayoutPreview` is
 * hand-written for that reason: it is not `Pick<>` or `Omit<>` of a breakdown,
 * so a field added to `PriceBreakdown` later cannot arrive in a vendor response
 * by inheritance. `PriceBreakdown` itself never leaves this file — the two
 * numbers the preview needs are lifted out by name.
 *
 * The one deliberate exception is `commissionPct`, and it is worth being honest
 * about: our whole charge over the selling price *is* algebraically invertible
 * back to the selling price. PHASE_03 requires it anyway, and requires it for a
 * good reason — the vendor gets the percentage conversation they expect while
 * the contract stays anchored to a fixed rupee amount. What the preview protects
 * is the *itemisation*: the margin amount, the warranty reserve, the QC
 * allocation and the freight allowance are each a separate negotiation we do not
 * want to have per unit, and none of them appears in any vendor-facing type.
 */

/** `listing.price_history.change_source`, which has a CHECK behind it. */
export type PriceChangeSource =
  | 'VENDOR_REPRICE'
  | 'MARGIN_RULE'
  | 'FLOOR_OVERRIDE'
  | 'GRADE_CORRECTION'
  | 'QC_CORRECTION';

/**
 * What the vendor typed, in whichever language their account is set to.
 *
 * Both arms converge on one rupee amount, which is the whole point of the
 * decision recorded in `contracts/pricing.ts`: the conversation may be a
 * percentage, the contract is never one.
 */
export type AskInput =
  | { mode: 'NET_PAYOUT'; vendorNetPayout: Money }
  | { mode: 'COMMISSION'; expectedSalePrice: Money; commissionPct: number };

export interface PayoutDeduction {
  code: 'QC_VISIT_FEE' | 'TDS' | 'PENALTY';
  /** A sentence the vendor can act on. Never carries a retail figure. */
  label: string;
  amount: Money;
}

/**
 * Step 4 of the wizard, live.
 *
 * Every field here is either the vendor's own number or a deduction from it.
 * Nothing derived from our margin is present. See the class comment for the one
 * exception and why it is one.
 */
export interface VendorPayoutPreview {
  pricingMode: PricingMode;
  units: number;
  perUnitPayout: Money;
  grossPayout: Money;
  deductions: PayoutDeduction[];
  totalDeductions: Money;
  netPayout: Money;
  /** Our whole charge as a percentage of the selling price. PHASE_03 Task 5. */
  commissionPct: number;
  vendorWarrantyMonths: number;
  /**
   * What the customer is sold. Shown so the sentence "we sell longer than you
   * offer and carry the difference" is a number on the screen rather than a
   * disclosure somebody makes during a claim — and so the incentive in Task 3
   * step 2 is visible: a longer vendor term is cheaper for us to carry, and the
   * payout moves when they change it.
   */
  customerWarrantyMonths: number;
}

export interface PayoutPreviewInput {
  skuId: string;
  grade: Grade;
  vendorWarrantyMonths: number;
  units: number;
  ask: AskInput;
}

/**
 * The result of pricing a listing. **Internal to the platform.** `sellingPrice`
 * is the number the customer pays; nothing on a vendor route may return this
 * type or any field of it.
 */
export interface PricingOutcome {
  listingId: string;
  sellingPrice: Money;
  marginRuleId: string;
  /** True when only an ops override can take this listing live. */
  belowFloor: boolean;
  floorPrice: Money;
  priceBandFlagged: boolean;
}

type ConfigMap = ReadonlyMap<string, unknown>;

/**
 * Every `platform_config` key this file reads.
 *
 * Listed as a constant so the whole set is fetched in one statement per call —
 * and so that "which knobs move a price" is answerable by reading one array
 * rather than by grepping for string literals.
 */
const CONFIG_KEYS = [
  'price.guardrail_lower_multiple',
  'price.rounding_step_inr',
  'platform.warranty_min_total_months',
  'qc.visit_fee_inr',
  'qc.visit_fee_waived_above',
  'qc.fee_bearer',
  'tax.tds_applicable',
  'tax.tds_vendor_threshold_inr',
  'tax.tds_rate_pct',
  'tax.tds_rate_no_pan_pct',
] as const;

/**
 * The statuses whose `unit_price` is a real retail price.
 *
 * A DRAFT or AWAITING_QC listing still carries the vendor's own ask in that
 * column — the engine has not run on it yet — so including those in the median
 * would drag the comparison down by our entire margin and flag honestly priced
 * listings as suspicious. Anything that has been live at some point has been
 * through this service.
 */
const PRICED_STATUSES = [
  'ACTIVE',
  'PARTIALLY_ACTIVE',
  'PAUSED',
  'OUT_OF_STOCK',
  'SUSPENDED',
  'EXPIRED',
  'DELISTED',
];

/** The reason column has `CHECK (length(btrim(reason)) >= 3)` behind it. */
function requireReason(reason: string, field: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw new ValidationError('Say why, in a few words at least — this goes on the record.', {
      [field]: 'Give a reason of at least 3 characters.',
    });
  }
  return trimmed;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly scope: OrgScope,
    private readonly ctx: RequestContextService,
    private readonly listings: ListingRepository,
    private readonly rules: MarginRuleRepository,
  ) {}

  // -------------------------------------------------------------------------
  // (b) The two pricing modes
  // -------------------------------------------------------------------------

  /**
   * Turn whatever the vendor typed into the one rupee amount we store.
   *
   * In COMMISSION mode the derived payout is **frozen here and now**: what comes
   * back is a fixed amount, and nothing downstream keeps the percentage or
   * re-derives from it. That is the entire guarantee — recomputing the payout
   * later from a rate would make it float with our pricing decisions, which is
   * model B, which PHASE_03 rejected for four separate reasons.
   *
   * A request whose mode disagrees with the vendor's stored preference is
   * refused rather than reconciled. The two disagreeing means a stale screen,
   * and pricing in the other mode hands the vendor a number they never agreed
   * to — which is the one outcome worse than an error message.
   */
  async resolveAsk(ask: AskInput): Promise<{ vendorAskPrice: Money; pricingMode: PricingMode }> {
    const orgId = this.requireOrg();
    const pricingMode = await this.pricingModeOf(orgId);

    if (ask.mode !== pricingMode) {
      throw new ValidationError(
        pricingMode === 'COMMISSION'
          ? 'Your account prices by commission. Enter the sale price you expect and your agreed rate.'
          : 'Your account prices by net payout. Enter the amount you want to receive per unit.',
        { pricingMode: `Expected ${pricingMode}.` },
      );
    }

    return { vendorAskPrice: askAmount(ask), pricingMode };
  }

  // -------------------------------------------------------------------------
  // (a) Vendor payout preview
  // -------------------------------------------------------------------------

  /**
   * What the vendor receives, per unit and for the batch, and what comes off it.
   *
   * Note what is destructured out of the breakdown at the end and what is not.
   * The full `PriceBreakdown` is computed — the commission percentage cannot be
   * known without it — and then two fields are lifted from it by name. It is
   * never spread, and no vendor-facing type is derived from it.
   */
  async previewPayout(input: PayoutPreviewInput): Promise<VendorPayoutPreview> {
    const orgId = this.requireOrg();
    const cfg = await this.config();
    const { vendorAskPrice, pricingMode } = await this.resolveAsk(input.ask);

    const { breakdown } = await this.compute({
      cfg,
      skuId: input.skuId,
      grade: input.grade,
      vendorWarrantyMonths: input.vendorWarrantyMonths,
      vendorAskPrice,
      units: input.units,
    });

    const grossPayout = vendorAskPrice.times(input.units);
    const deductions = await this.deductions(orgId, cfg, input.units, grossPayout);
    const totalDeductions = Money.sum(deductions.map((d) => d.amount));

    return {
      pricingMode,
      units: input.units,
      perUnitPayout: vendorAskPrice,
      grossPayout,
      deductions,
      totalDeductions,
      netPayout: grossPayout.sub(totalDeductions),
      commissionPct: breakdown.commissionPct,
      vendorWarrantyMonths: input.vendorWarrantyMonths,
      customerWarrantyMonths: breakdown.totalWarrantyMonths,
    };
  }

  // -------------------------------------------------------------------------
  // The engine, and (d) the price-band flag, and (e) price history
  // -------------------------------------------------------------------------

  /**
   * Price a listing and write the answer down.
   *
   * One transaction, because four things move together and a partial application
   * is a listing whose `unit_price` disagrees with its own units' `retail_price`
   * — the divergence the Phase 3 migration's closing comment exists to prevent.
   *
   * `price_history` is written only when the number actually moved. An audit
   * trail of no-op reprices is one nobody reads, and the interesting row is then
   * buried under a nightly job's worth of identical entries.
   */
  async priceListing(
    listingId: string,
    opts: { reason: string; changeSource?: PriceChangeSource } = { reason: 'Margin rule applied' },
  ): Promise<PricingOutcome> {
    const reason = requireReason(opts.reason, 'reason');
    const changeSource: PriceChangeSource = opts.changeSource ?? 'MARGIN_RULE';
    const cfg = await this.config();

    return this.prisma.runInTransaction(async () => {
      const listing = await this.requireListing(listingId);
      const vendorAskPrice = this.askOf(listing);

      // The row lock is taken before anything is computed, so two concurrent
      // reprices serialise rather than racing to write the last UPDATE. They
      // would converge anyway — the price is a pure function of (ask, rule,
      // config) — but they would leave two price_history rows describing one
      // change, and an audit trail that double-counts is one you cannot reason
      // about afterwards.
      const locked = await this.prisma.$queryRaw<Array<{ unit_price: unknown }>>`
        SELECT unit_price FROM listing.listing WHERE id = ${listingId}::uuid FOR UPDATE`;
      const oldPrice = moneyFromDb(locked[0]?.unit_price as string | undefined);

      const { breakdown, ruleId, floorPrice } = await this.compute({
        cfg,
        skuId: listing.skuId,
        grade: listing.grade,
        vendorWarrantyMonths: listing.vendorWarrantyMonths,
        vendorAskPrice,
        units: listing.qtyTotal,
      });
      const sellingPrice = breakdown.sellingPrice;

      const band = await this.priceBand(cfg, listing, sellingPrice);

      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET unit_price            = ${sellingPrice.toString()}::numeric,
               price_band_flagged_at = ${band?.flaggedAt ?? null},
               price_band_median     = ${band?.median.toString() ?? null}::numeric,
               price_band_ratio      = ${band?.ratio ?? null}::numeric
         WHERE id = ${listingId}::uuid`;

      // Every unit, including any that already carry a purchase_price. What we
      // charge a customer is ours to change; what we owe the vendor is frozen at
      // the PO and `trg_lock_purchase_price` keeps it that way. Those are two
      // different columns precisely so this statement is safe.
      await this.prisma.$executeRaw`
        UPDATE listing.unit
           SET retail_price   = ${sellingPrice.toString()}::numeric,
               margin_rule_id = ${ruleId}::uuid
         WHERE listing_id = ${listingId}::uuid`;

      if (!oldPrice || !oldPrice.eq(sellingPrice)) {
        await this.recordPriceChange({
          listingId,
          oldPrice,
          newPrice: sellingPrice,
          reason,
          changeSource,
        });
      }

      return {
        listingId,
        sellingPrice,
        marginRuleId: ruleId,
        belowFloor: sellingPrice.lt(floorPrice),
        floorPrice,
        priceBandFlagged: band !== null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // (c) The floor guard
  // -------------------------------------------------------------------------

  /**
   * The gate in front of ACTIVE. Call this before any transition to it.
   *
   * The floor is recomputed from the *stored* price rather than trusted from
   * whatever `priceListing` returned, because a listing can be repriced by hand
   * between pricing and activation and the question at activation is about the
   * number that is actually on the row.
   *
   * A recorded override short-circuits it. That is the whole reason the
   * authorisation is three columns on the listing and not just a history row:
   * re-deriving consent by scanning `price_history` means a scan that picks the
   * wrong row silently re-authorises a listing nobody approved.
   */
  async assertActivatable(listingId: string): Promise<void> {
    const listing = await this.requireListing(listingId);
    if (listing.floorOverrideAt) return;

    const cfg = await this.config();
    const { floorPrice } = await this.compute({
      cfg,
      skuId: listing.skuId,
      grade: listing.grade,
      vendorWarrantyMonths: listing.vendorWarrantyMonths,
      vendorAskPrice: this.askOf(listing),
      units: listing.qtyTotal,
    });

    if (listing.unitPrice.lt(floorPrice)) {
      throw new PreconditionFailedError(
        'This listing earns less than the floor margin, so it cannot go live without an ops override.',
        { listingId, reason: 'below_floor_margin' },
      );
    }
  }

  /**
   * Ops authorises a listing that sits below the floor.
   *
   * Two writes, one transaction: the authorisation itself, and the
   * `price_history` row carrying the justification. `old_price` and `new_price`
   * are the same number on purpose — an override does not change the price, it
   * accepts one — and the row exists so the *decision* is in the same
   * append-only trail as the price it applies to.
   *
   * A vendor cannot override their own floor. The permission check on the route
   * will say so too; this says so where it cannot be forgotten.
   */
  async overrideFloor(listingId: string, justification: string): Promise<void> {
    const reason = requireReason(justification, 'justification');
    const actor = this.ctx.requirePrincipal();
    if (!this.scope.isPlatform) {
      throw new ForbiddenError('Only TrueTech ops can approve a listing below the floor margin.', {
        reason: 'floor_override_requires_platform',
      });
    }

    await this.prisma.runInTransaction(async () => {
      // All three columns together — chk_floor_override_complete allows 0 or 3.
      const rows = await this.prisma.$queryRaw<Array<{ unit_price: unknown }>>`
        UPDATE listing.listing
           SET floor_override_by     = ${actor.userId}::uuid,
               floor_override_at     = ${this.clock.now()},
               floor_override_reason = ${reason}
         WHERE id = ${listingId}::uuid
        RETURNING unit_price`;

      const price = moneyFromDb(rows[0]?.unit_price as string | undefined);
      if (!price) throw new NotFoundError('listing', { listingId });

      await this.recordPriceChange({
        listingId,
        oldPrice: price,
        newPrice: price,
        reason,
        changeSource: 'FLOOR_OVERRIDE',
      });
    });
  }

  // -------------------------------------------------------------------------
  // The buyer's side of the same number
  // -------------------------------------------------------------------------

  /**
   * The landed price for one delivery. **Buyer-facing — never a vendor route.**
   *
   * The state codes come from the caller because who is shipping from where is
   * an `identity` fact and not this module's to look up. `valuationMethod` and
   * `purchasePrice` are not passed: Rule 32(5) margin valuation is per serial,
   * and the specific serial is not known until allocation — the ordering lane
   * calls the same `landedPrice` helper with them at that point.
   *
   * `freight` is REQUIRED here for the same reason it is required on
   * `landedPrice` itself. It was briefly `freight?: Money` coalesced to
   * `Money.ZERO`, which re-introduced one layer up exactly the defect the
   * contracts helper had just removed: a lane nobody could price became a lane
   * that was free, and the difference is a price misrepresentation under CP
   * e-Comm r.6(5) rather than a rounding curiosity. `logistics` models an
   * unquotable lane as a discriminated union with `amount: null` so the caller
   * has to look; a default here is what stops it having to.
   *
   * So the decision sits with the caller, who is the only one who knows whether
   * the lane was quotable. Genuinely free delivery passes `Money.ZERO` on
   * purpose. Not knowing the freight is not a number, and must not render as one.
   */
  async landedPriceForBuyer(
    listingId: string,
    opts: { deliveryStateCode: string; ourStateCode: string; freight: Money },
  ): Promise<LandedPrice> {
    const listing = await this.requireListing(listingId);
    return landedPrice({
      sellingPrice: listing.unitPrice,
      freight: opts.freight,
      gstRatePct: listing.gstRate,
      deliveryStateCode: opts.deliveryStateCode,
      ourStateCode: opts.ourStateCode,
    });
  }

  /**
   * The same number as `landedPriceForBuyer`, for a caller with no principal.
   *
   * `landedPriceForBuyer` reads the listing through the scoped repository, which
   * refuses outright when nobody is signed in — `OrgScope` says in as many words
   * that a public endpoint must come through a public repository method rather
   * than through a scoped one with its guard relaxed. So the comparison board
   * fetches its facts through `publicPricingFacts` and hands them here, and both
   * paths end in the same `landedPrice()` call: one definition of what a buyer
   * pays, reached two ways.
   *
   * `freight` is required for the reason it is required everywhere else. A lane
   * nobody could price is not a lane that is free (CP e-Comm r.6(5)); the caller
   * that could not get a quote must not render a row at all.
   *
   * `valuationMethod` is deliberately NOT passed through to `landedPrice`. Rule
   * 32(5) values a MARGIN supply on (sale - purchase) per serial, and the serial
   * is not known until allocation — so the board quotes tax on the full value,
   * which is the higher figure, and labels the ITC consequence instead. A price
   * that went DOWN at allocation would be the harmless direction; guessing which
   * serial ships would not be.
   */
  landedPriceForPublicOffer(
    facts: PublicPricingFacts,
    opts: { deliveryStateCode: string; ourStateCode: string; freight: Money },
  ): LandedPrice {
    return landedPrice({
      sellingPrice: facts.sellingPrice,
      freight: opts.freight,
      gstRatePct: facts.gstRatePct,
      deliveryStateCode: opts.deliveryStateCode,
      ourStateCode: opts.ourStateCode,
    });
  }

  /**
   * The TOTAL warranty months a buyer is sold, per listing.
   *
   * The split is never returned, and there is deliberately no argument that
   * would produce it: the vendor/platform division is a commercial arrangement
   * between us and the supply point, and a Phase 5 exit criterion is that it
   * appears nowhere in a customer payload.
   *
   * It is computed rather than read because pre-sale there is nothing to read.
   * `platform.warranty` is written when a unit is sold, and `truetech_warranty`
   * on the listing is a band the vendor wizard has never had to set — every
   * seeded listing carries NONE. The term the customer is actually sold is the
   * one the PRICE was built from: `max(vendor months + the rule's top-up, the
   * platform floor)`, which is `priceFromNetPayout`'s own arithmetic. Restating
   * it here would be a second definition, so this asks the same rule the pricing
   * engine asked and applies the same `Math.max`.
   *
   * No rule matching means nobody has decided what we add on top of this vendor
   * — so the answer is the platform floor, which is the term we guarantee on
   * every unit whatever the rule says. Never zero: "we have not decided" must
   * not render as "no warranty".
   */
  async customerWarrantyMonths(
    facts: readonly PublicPricingFacts[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (facts.length === 0) return out;

    const cfg = await this.config();
    const floor = num(cfg, 'platform.warranty_min_total_months');

    for (const f of facts) {
      // ponytail: one rule resolution per listing. Ten listings is ten indexed
      // reads of a table with a few dozen rows, inside a 500 ms budget the
      // freight batch and the quality read dominate. If a board ever carries
      // hundreds of supply points, the fix is a batched `resolveMany`, not a
      // cache that ops edits cannot invalidate.
      const matched = await this.rules.resolveFor(f.skuId, f.grade, f.vendorAskPrice);
      out.set(
        f.listingId,
        Math.max(f.vendorWarrantyMonths + (matched?.rule.warrantyTopUpMonths ?? 0), floor),
      );
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * One call to the engine, with every input resolved.
   *
   * **Rounding is applied here and only here** — `roundToNearest` is handed to
   * `priceFromNetPayout`, which rounds the assembled total once, at the end.
   * Rounding a component (the margin, the reserve, the QC share) and then adding
   * them is how a 500-line order drifts, and PAY-017 is the test that says so.
   */
  private async compute(args: {
    cfg: ConfigMap;
    skuId: string;
    grade: Grade;
    vendorWarrantyMonths: number;
    vendorAskPrice: Money;
    units: number;
  }): Promise<{ breakdown: PriceBreakdown; ruleId: string; floorPrice: Money }> {
    const { cfg, grade, vendorAskPrice, units } = args;

    const matched = await this.rules.resolveFor(args.skuId, grade, vendorAskPrice);
    if (!matched) {
      // Fail closed. No rule means nobody has decided what we charge for this
      // machine at this grade at this price, and a guessed margin is how a
      // listing goes live at a loss.
      throw new PreconditionFailedError(
        'No margin rule covers this machine yet, so we cannot price it. Ops has been told.',
        { skuId: args.skuId, grade, reason: 'no_margin_rule' },
      );
    }

    // Q22 lives in two places by design: the top-up is per margin rule so a
    // category can be tuned, the floor is platform-wide so the term a customer
    // is sold cannot collapse when a vendor offers nothing. The column name
    // `warranty_top_up_months` hides the floor, which has already produced one
    // wrong implementation, so the floor is passed in explicitly every time.
    const qcCostAllocation = this.qcAllocation(cfg, units);
    const breakdown = priceFromNetPayout({
      vendorNetPayout: vendorAskPrice,
      grade,
      rule: {
        ...matched.rule,
        minTotalWarrantyMonths: num(cfg, 'platform.warranty_min_total_months'),
      },
      vendorWarrantyMonths: args.vendorWarrantyMonths,
      // Freight is a Phase 8 rate card keyed on (from pincode, to zone, weight)
      // and there is no destination at listing time. Left at zero rather than
      // guessed: an invented allowance is a real rupee amount in the customer's
      // price defending nothing.
      logisticsAllowance: Money.ZERO,
      qcCostAllocation,
      roundToNearest: num(cfg, 'price.rounding_step_inr'),
    });

    // The floor is a floor on *margin*, so the costs sitting between the payout
    // and the price have to be added back before comparing — otherwise a fat
    // warranty reserve on a Grade B machine reads as healthy margin and the
    // guard never fires. `minimumSellingPrice` supplies the VR-085 half:
    // max(Rs 500, floor% of payout), the absolute term being the one that
    // actually bites, on cheap machines where a percentage earns nothing.
    const floorPrice = minimumSellingPrice({
      vendorNetPayout: vendorAskPrice,
      logisticsAllowance: Money.ZERO,
      minMarginPct: matched.rule.floorMarginPct,
    })
      .add(qcCostAllocation)
      .add(breakdown.warrantyReserve);

    return { breakdown, ruleId: matched.id, floorPrice };
  }

  /**
   * This unit's share of the QC visit.
   *
   * Only where **we** bear the fee. `qc.fee_bearer` is TRUETECH at pilot, so the
   * cost is ours and belongs in the price; where the vendor bears it, it comes
   * off their payout instead and adding it here as well would charge for the
   * same visit twice.
   *
   * The per-unit share rounds half-up, so 25 shares of Rs 1,500 need not re-sum
   * to exactly Rs 1,500. That is a cost allocation and not a customer total —
   * VR-127's per-line rounding is about invoices — and a few paise of
   * allocation slack is not worth a remainder-distribution algorithm.
   */
  private qcAllocation(cfg: ConfigMap, units: number): Money {
    if (units < 1) return Money.ZERO;
    if (units > num(cfg, 'qc.visit_fee_waived_above')) return Money.ZERO;

    const fee = rupees(cfg, 'qc.visit_fee_inr');
    const ourShare = feeShare(str(cfg, 'qc.fee_bearer'), fee, 'TRUETECH');
    return ourShare.isZero() ? Money.ZERO : Money.fromRatio(ourShare, 1n, BigInt(units));
  }

  /**
   * (d) The price-band sanity check. **Flags, never blocks.**
   *
   * `percentile_disc` rather than `percentile_cont`: the continuous form casts
   * to double precision to interpolate, which puts a float in the money path for
   * no benefit here. The discrete form returns an actual `unit_price` from an
   * actual row — exact, and better evidence for the person reviewing the flag,
   * because it is a price somebody really charged.
   *
   * No history for this (sku, grade) means no flag. An absent median is not
   * evidence of a bad price, and flagging on one would put every first listing
   * of every new SKU into the review queue on its first day.
   *
   * Returning null clears the flag. A vendor who corrects a mistyped price has
   * to be able to leave the queue, and with no reviewed-at column the reprice is
   * the only signal there is.
   */
  private async priceBand(
    cfg: ConfigMap,
    listing: ListingRow,
    price: Money,
  ): Promise<{ flaggedAt: Date; median: Money; ratio: number } | null> {
    const since = this.clock.plusDays(-30);

    const rows = await this.prisma.$queryRaw<Array<{ median: unknown }>>`
      SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY l.unit_price) AS median
        FROM listing.listing l
       WHERE l.sku_id = ${listing.skuId}::uuid
         AND l.grade  = ${listing.grade}::public.grade_type
         AND l.id    <> ${listing.id}::uuid
         AND l.created_at >= ${since}
         AND l.status::text = ANY(${PRICED_STATUSES}::text[])`;

    const median = moneyFromDb(rows[0]?.median as string | null | undefined);
    if (!median || !median.isPositive()) return null;

    // A ratio, not an amount — NUMERIC(6,4) on the column, 4 dp here.
    const ratio = Math.round((Number(price.paise) / Number(median.paise)) * 10_000) / 10_000;
    if (ratio >= num(cfg, 'price.guardrail_lower_multiple')) return null;

    return { flaggedAt: this.clock.now(), median, ratio };
  }

  /** (e) The append-only trail. Never UPDATEd, never DELETEd — the grants say so. */
  private async recordPriceChange(input: {
    listingId: string;
    oldPrice: Money | null;
    newPrice: Money;
    reason: string;
    changeSource: PriceChangeSource;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO listing.price_history
        (listing_id, old_price, new_price, changed_by, changed_at, reason, change_source)
      VALUES (${input.listingId}::uuid,
              ${input.oldPrice?.toString() ?? null}::numeric,
              ${input.newPrice.toString()}::numeric,
              ${this.ctx.principal?.userId ?? null}::uuid,
              ${this.clock.now()},
              ${input.reason},
              ${input.changeSource})`;
  }

  /**
   * What comes off the batch before the vendor is paid.
   *
   * Four small indexed lookups, run together. The wizard calls this as the
   * vendor types, so it is worth knowing the ceiling: debounced input on a
   * point-lookup each is fine; a preview on every keystroke would want the
   * whole set memoised for the life of one request.
   */
  private async deductions(
    orgId: string,
    cfg: ConfigMap,
    units: number,
    grossPayout: Money,
  ): Promise<PayoutDeduction[]> {
    const [fyToDate, hasVerifiedPan, penalties] = await Promise.all([
      this.purchasesThisFinancialYear(orgId),
      this.hasVerifiedPan(orgId),
      this.standingPenalties(orgId),
    ]);

    const out: PayoutDeduction[] = [];

    // --- the QC visit -------------------------------------------------------
    const fee = rupees(cfg, 'qc.visit_fee_inr');
    const waivedAbove = num(cfg, 'qc.visit_fee_waived_above');
    const vendorShare = feeShare(str(cfg, 'qc.fee_bearer'), fee, 'VENDOR');
    if (units <= waivedAbove && vendorShare.isPositive()) {
      out.push({
        code: 'QC_VISIT_FEE',
        label: `Inspection visit fee. Waived above ${waivedAbove} units — you have ${units}.`,
        amount: vendorShare,
      });
    }

    // --- TDS ----------------------------------------------------------------
    // The arithmetic lives in `computeTds` in @trugrade/contracts, not here.
    // This preview and the accrual that Phase 7 writes at PO time MUST agree to
    // the paisa: a vendor shown one deduction in the wizard and charged another
    // on the statement will not believe either number again. Two copies of the
    // straddle formula is exactly how they drift apart.
    const tds = computeTds({
      policy: {
        applicable: bool(cfg, 'tax.tds_applicable'),
        thresholdAmount: rupees(cfg, 'tax.tds_vendor_threshold_inr'),
        ratePct: num(cfg, 'tax.tds_rate_pct'),
        noPanRatePct: num(cfg, 'tax.tds_rate_no_pan_pct'),
      },
      cumulativeBefore: fyToDate,
      purchaseValue: grossPayout,
      hasValidPan: hasVerifiedPan,
    });
    if (tds.amount.isPositive()) {
      out.push({
        code: 'TDS',
        label: hasVerifiedPan
          ? `TDS at ${tds.ratePct}% on the part of this batch above your Rs 50 lakh threshold for the year.`
          : `TDS at ${tds.ratePct}% — the higher no-PAN rate. Verify your PAN to bring this down.`,
        amount: tds.amount,
      });
    }

    // --- standing penalties -------------------------------------------------
    if (penalties.isPositive()) {
      out.push({
        code: 'PENALTY',
        label: 'Penalties raised since your last settlement, recovered from this batch.',
        amount: penalties,
      });
    }

    return out;
  }

  /**
   * What we have bought from this vendor this financial year.
   *
   * Reads `procurement.v_vendor_fy_purchases`, which Phase 6 made the single
   * authority. It previously summed `payment.payout.gross` by `paid_at`, which
   * was the only figure available at the time and was documented as a proxy --
   * but it is the wrong basis: s.194Q charges on credit OR payment, WHICHEVER IS
   * EARLIER. Payouts lag purchases by the credit terms, so a vendor could cross
   * Rs 50 lakh in purchases while the paid-out total still read below it and we
   * under-deducted. Under-deduction is our liability, not the vendor's.
   *
   * The ledger accrues when the purchase order is raised, which is the credit
   * event, so this now answers the question the section actually asks.
   */
  private async purchasesThisFinancialYear(orgId: string): Promise<Money> {
    const rows = await this.prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT coalesce(sum(v.gross_to_date), 0) AS total
        FROM procurement.v_vendor_fy_purchases v
       WHERE v.vendor_org_id = ${orgId}::uuid
         AND v.financial_year = ${this.financialYear()}`;
    return moneyFromDb(rows[0]?.total as string | undefined) ?? Money.ZERO;
  }

  /**
   * Unwaived penalties raised since the last settlement actually paid.
   *
   * There is no link from a penalty to the payout that recovered it, so "since
   * the last payment" is the available approximation. It is the right side to
   * err on: showing a penalty the vendor has already had deducted is a support
   * ticket and an argument, and this cannot produce one.
   */
  private async standingPenalties(orgId: string): Promise<Money> {
    const rows = await this.prisma.$queryRaw<Array<{ total: unknown }>>`
      SELECT coalesce(sum(pen.amount), 0) AS total
        FROM payment.penalty pen
       WHERE pen.vendor_org_id = ${orgId}::uuid
         AND pen.waived_by IS NULL
         AND pen.applied_at > coalesce(
               (SELECT max(po.paid_at) FROM payment.payout po
                 WHERE po.vendor_org_id = ${orgId}::uuid AND po.paid_at IS NOT NULL),
               '-infinity'::timestamptz)`;
    return moneyFromDb(rows[0]?.total as string | undefined) ?? Money.ZERO;
  }

  /** 0.1% with a verified PAN, 5% without. A 50x difference — worth the lookup. */
  private async hasVerifiedPan(orgId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ verified: boolean }>>`
      SELECT verified FROM kyc.pan_record WHERE org_id = ${orgId}::uuid`;
    return rows[0]?.verified === true;
  }

  private async pricingModeOf(orgId: string): Promise<PricingMode> {
    const rows = await this.prisma.$queryRaw<Array<{ pricing_mode: string }>>`
      SELECT pricing_mode FROM vendor.vendor_payout_preference WHERE org_id = ${orgId}::uuid`;
    // No preference row at all is the column's own default, not a missing fact.
    return rows[0]?.pricing_mode === 'COMMISSION' ? 'COMMISSION' : 'NET_PAYOUT';
  }

  /**
   * `platform.v_current_config`, read fresh on every call.
   *
   * Deliberately not cached, not even per process. "A margin rule change alters
   * the price of new listings without a deploy" is an exit criterion, and the
   * same reasoning covers the knobs beside it — a cached guardrail multiple is
   * one that ops changed and nothing happened.
   *
   * One statement for the whole set, and only the keys this file uses. The view
   * is the sanctioned reader: `platform_config` itself is effective-dated and
   * reading it directly is how a future-dated row goes live early.
   */
  private async config(): Promise<ConfigMap> {
    const rows = await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
      SELECT key, value_json FROM platform.v_current_config
       WHERE key = ANY(${[...CONFIG_KEYS]}::text[])`;
    return new Map(rows.map((r) => [r.key, r.value_json]));
  }

  /** India's financial year opens on 1 April, reckoned on the IST calendar. */
  private financialYearStartingYear(): number {
    const today = this.clock.todayInIst();
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    return month >= 4 ? year : year - 1;
  }

  /** `2026-27`, the form procurement.tds_ledger stores. */
  private financialYear(): string {
    const start = this.financialYearStartingYear();
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }

  private requireOrg(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError(
        'A payout preview is about a specific vendor, so one must be in context.',
        {
          reason: 'payout_preview_needs_org',
        },
      );
    }
    return orgId;
  }

  private async requireListing(listingId: string): Promise<ListingRow> {
    const listing = await this.listings.findById(listingId);
    if (!listing) throw new NotFoundError('listing', { listingId });
    return listing;
  }

  /**
   * The vendor's ask for this listing.
   *
   * It lives on the units once serials are attached and on the listing before
   * that, and `findById` already resolves which. Re-deriving that here would be
   * a second answer to "where does the ask live", which is exactly the drift
   * that makes one of the two numbers wrong and unread.
   */
  private askOf(listing: ListingRow): Money {
    const ask = listing.vendorAskPrice;
    if (!ask || !ask.isPositive()) {
      throw new PreconditionFailedError(
        'This listing has no vendor payout recorded, so there is nothing to price from.',
        { listingId: listing.id, reason: 'no_vendor_ask' },
      );
    }
    return ask;
  }
}

/** COMMISSION mode's derivation, frozen the moment it is taken. */
function askAmount(ask: AskInput): Money {
  return ask.mode === 'NET_PAYOUT'
    ? ask.vendorNetPayout
    : payoutFromCommission({
        expectedSalePrice: ask.expectedSalePrice,
        commissionPct: ask.commissionPct,
      }).vendorNetPayout;
}

/** `qc.fee_bearer` is TRUETECH | VENDOR | SPLIT | WAIVED. SPLIT means half each. */
function feeShare(bearer: string, fee: Money, side: 'TRUETECH' | 'VENDOR'): Money {
  if (bearer === 'SPLIT') return Money.fromRatio(fee, 1n, 2n);
  return bearer === side ? fee : Money.ZERO;
}

/**
 * A config value that must exist.
 *
 * Missing keys throw rather than fall back to a number compiled into the build.
 * A silent default is how "ops changed the guardrail and nothing happened" gets
 * diagnosed three weeks later as a caching bug — the same failure mode the
 * `v_current_config` migration was written to close.
 *
 * `price.rounding_step_inr` is the one key with a defined absence: it has never
 * been seeded, and 0 means "do not round", which is the behaviour the engine has
 * had all along. Seed the key and rounding starts, with no deploy.
 */
function raw(cfg: ConfigMap, key: string): unknown {
  const value = cfg.get(key);
  if (value === undefined) {
    if (key === 'price.rounding_step_inr') return 0;
    throw new PreconditionFailedError(
      `Pricing configuration "${key}" is not set, so prices cannot be computed.`,
      { key, reason: 'missing_platform_config' },
    );
  }
  return value;
}

function num(cfg: ConfigMap, key: string): number {
  const value = raw(cfg, key);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PreconditionFailedError(`Pricing configuration "${key}" is not a number.`, { key });
  }
  return value;
}

/** A whole-rupee config amount. `Money.rupees` refuses a fraction, on purpose. */
function rupees(cfg: ConfigMap, key: string): Money {
  const value = num(cfg, key);
  return Number.isInteger(value) ? Money.rupees(value) : Money.parse(value.toFixed(2));
}

function str(cfg: ConfigMap, key: string): string {
  const value = raw(cfg, key);
  if (typeof value !== 'string') {
    throw new PreconditionFailedError(`Pricing configuration "${key}" is not a string.`, { key });
  }
  return value;
}

function bool(cfg: ConfigMap, key: string): boolean {
  const value = raw(cfg, key);
  if (typeof value !== 'boolean') {
    throw new PreconditionFailedError(`Pricing configuration "${key}" is not a boolean.`, { key });
  }
  return value;
}
