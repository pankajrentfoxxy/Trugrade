/**
 * The payout basis.
 *
 * **Decided: the vendor names their net payout and we add our charge.** Not a
 * discount off our listed price. PHASE_03_LISTINGS.md, and the reasoning is
 * worth keeping next to the code because the alternative looks equivalent:
 *
 *   - **Freight varies by destination.** Under a discount model a vendor's
 *     payout would depend on where the buyer happens to be. They will never
 *     accept that.
 *   - **Discounting becomes a negotiation.** Drop a price to win a large order
 *     and either the vendor's payout drops or our margin absorbs all of it.
 *   - **Grade corrections turn into pricing arguments.** Correct A→B and reprice,
 *     and under a discount model the vendor's payout moves because of *our*
 *     decision — so every correction is disputed as a pricing trick rather than
 *     discussed as a finding about the machine.
 *   - **Rule 32(5) needs a fixed purchase price per serial.** A floating payout
 *     makes the margin-scheme position indefensible.
 *
 * The reconciliation, which is what makes this acceptable to vendors: present it
 * in the language they expect. They enter ₹28,000; the wizard shows
 * *"Trugrade commission: 12.8%"* live. The conversation is a percentage; the
 * contract is a fixed rupee amount.
 */

import { Money } from './money';
import type { Grade } from './rules';

export type PricingMode = 'NET_PAYOUT' | 'COMMISSION';

export interface MarginRule {
  targetMarginPct: number;
  floorMarginPct: number;
  /**
   * Q22: the customer is sold **the vendor's term + this, with a floor**.
   *
   * The two halves do different jobs and neither is redundant. The addition is
   * what makes a generous vendor cheaper to carry — offer 6 and we fund 3, offer
   * 1 and we fund 5 — so the reserve, and therefore the price, tracks the real
   * liability. The floor is what stops the term the *customer* sees from
   * collapsing when a vendor offers almost nothing.
   */
  warrantyTopUpMonths: number;
  /** Q22: 6. Not a column yet — ops has never asked to tune it per category. */
  minTotalWarrantyMonths?: number;
  /** % of payout reserved per grade. A Grade B claims materially more than an A+. */
  reservePctByGrade: Partial<Record<Grade, number>>;
}

export interface PriceInputs {
  /** What the vendor wants to receive, net of everything. */
  vendorNetPayout: Money;
  grade: Grade;
  rule: MarginRule;
  /** Estimated freight to the destination zone, at listing time. */
  logisticsAllowance?: Money;
  /** Share of the QC visit cost attributed to this unit. */
  qcCostAllocation?: Money;
  /** What the vendor themselves stands behind. A pricing input, not a note. */
  vendorWarrantyMonths: number;
  /** Round the selling price to the nearest multiple. 0 disables. */
  roundToNearest?: number;
}

export interface PriceBreakdown {
  vendorNetPayout: Money;
  marginAmount: Money;
  logisticsAllowance: Money;
  qcCostAllocation: Money;
  /** Accrued at sale from margin; released to margin on expiry. */
  warrantyReserve: Money;
  /** Before rounding. */
  rawSellingPrice: Money;
  sellingPrice: Money;
  roundingAdjustment: Money;
  /** What the vendor sees: our charge as a percentage of the selling price. */
  commissionPct: number;
  /** Total months the customer is sold. The split never reaches them. */
  totalWarrantyMonths: number;
  platformBackedMonths: number;
}

/** Two decimal places, the way a percentage is spoken. */
function pct(part: Money, whole: Money): number {
  if (whole.isZero()) return 0;
  return Math.round((Number(part.paise) / Number(whole.paise)) * 10_000) / 100;
}

/**
 * NET_PAYOUT: the vendor names the amount, we derive the price.
 *
 * The warranty reserve is not optional. We sell a longer term than the vendor
 * offers, so those extra months are ours to fund — and without a per-unit
 * reserve accrued at sale the longer term is an unpriced liability that grows
 * with every sale.
 */
export function priceFromNetPayout(input: PriceInputs): PriceBreakdown {
  const {
    vendorNetPayout,
    grade,
    rule,
    vendorWarrantyMonths,
    logisticsAllowance = Money.ZERO,
    qcCostAllocation = Money.ZERO,
    roundToNearest = 0,
  } = input;

  const marginAmount = Money.percentOf(vendorNetPayout, rule.targetMarginPct);

  // A vendor offering 6 months costs us 3 to top up; one offering 1 costs us 5,
  // because the floor carries it the rest of the way. The reserve reflects what
  // we are actually carrying, not a flat assumption.
  const totalWarrantyMonths = Math.max(
    vendorWarrantyMonths + rule.warrantyTopUpMonths,
    rule.minTotalWarrantyMonths ?? 6,
  );
  const platformBackedMonths = totalWarrantyMonths - vendorWarrantyMonths;

  const reservePctPerMonth = rule.reservePctByGrade[grade] ?? 0;
  const warrantyReserve = Money.percentOf(
    vendorNetPayout,
    reservePctPerMonth * platformBackedMonths,
  );

  const rawSellingPrice = vendorNetPayout
    .add(marginAmount)
    .add(logisticsAllowance)
    .add(qcCostAllocation)
    .add(warrantyReserve);

  const sellingPrice =
    roundToNearest > 0 ? roundUpTo(rawSellingPrice, roundToNearest) : rawSellingPrice;

  return {
    vendorNetPayout,
    marginAmount,
    logisticsAllowance,
    qcCostAllocation,
    warrantyReserve,
    rawSellingPrice,
    sellingPrice,
    roundingAdjustment: sellingPrice.sub(rawSellingPrice),
    // The number the vendor sees. Our whole charge over the price the customer
    // pays — not the margin percentage, which would understate it and invite
    // an argument the first time they work it out themselves.
    commissionPct: pct(sellingPrice.sub(vendorNetPayout), sellingPrice),
    totalWarrantyMonths,
    platformBackedMonths,
  };
}

/**
 * COMMISSION: the vendor names an expected sale price and a rate; the system
 * derives the net payout and **freezes it immediately**.
 *
 * This is a presentation layer over the same contract — both modes converge on
 * one stored rupee value. It exists because vendors think in percentages, and
 * refusing them that vocabulary loses the conversation rather than winning it.
 */
export function payoutFromCommission(input: { expectedSalePrice: Money; commissionPct: number }): {
  vendorNetPayout: Money;
  commissionAmount: Money;
} {
  const commissionAmount = Money.percentOf(input.expectedSalePrice, input.commissionPct);
  return {
    vendorNetPayout: input.expectedSalePrice.sub(commissionAmount),
    commissionAmount,
  };
}

/** Round a price up to the nearest multiple of `step` rupees. */
export function roundUpTo(amount: Money, stepRupees: number): Money {
  if (stepRupees <= 0) return amount;
  const step = BigInt(stepRupees) * 100n;
  const remainder = amount.paise % step;
  return remainder === 0n ? amount : Money.paiseOf(amount.paise + (step - remainder));
}

/**
 * VR-085. The floor below which a listing cannot go live without an ops override.
 * `min_margin = max(₹500, 4% of payout)`.
 */
export function minimumSellingPrice(input: {
  vendorNetPayout: Money;
  logisticsAllowance?: Money;
  minMarginAbsolute?: Money;
  minMarginPct?: number;
}): Money {
  const {
    vendorNetPayout,
    logisticsAllowance = Money.ZERO,
    minMarginAbsolute = Money.rupees(500),
    minMarginPct = 4,
  } = input;

  const minMargin = Money.max(minMarginAbsolute, Money.percentOf(vendorNetPayout, minMarginPct));
  return vendorNetPayout.add(logisticsAllowance).add(minMargin);
}

/**
 * The landed price a buyer sees: our price plus freight plus GST.
 *
 * One figure with the break-up one click away. Never revealed progressively —
 * drip pricing is a named prohibited practice in the CCPA Dark Patterns
 * Guidelines 2023.
 */
export interface LandedPrice {
  sellingPrice: Money;
  freight: Money;
  taxableValue: Money;
  igst: Money;
  cgst: Money;
  sgst: Money;
  total: Money;
  isInterState: boolean;
}

export function landedPrice(input: {
  sellingPrice: Money;
  freight?: Money;
  gstRatePct: number;
  /** Place of supply under s.10(1)(a) IGST Act: where the movement terminates. */
  deliveryStateCode: string;
  ourStateCode: string;
  /** MARGIN units are taxed on (sale − purchase), not on the full value. */
  valuationMethod?: 'REGULAR' | 'MARGIN';
  purchasePrice?: Money;
}): LandedPrice {
  const { sellingPrice, freight = Money.ZERO, gstRatePct } = input;
  const isInterState = input.deliveryStateCode !== input.ourStateCode;

  const gross = sellingPrice.add(freight);

  // Rule 32(5): taxable value is the margin, and a negative margin is ignored.
  const taxableValue =
    input.valuationMethod === 'MARGIN' && input.purchasePrice
      ? Money.max(gross.sub(input.purchasePrice), Money.ZERO)
      : gross;

  const igst = isInterState ? Money.percentOf(taxableValue, gstRatePct) : Money.ZERO;
  const half = isInterState ? Money.ZERO : Money.percentOf(taxableValue, gstRatePct / 2);

  return {
    sellingPrice,
    freight,
    taxableValue,
    igst,
    cgst: half,
    sgst: half,
    // The halves are stored and the total derived from them, never the reverse:
    // an invoice that disagrees with itself between the screen and the PDF is a
    // support ticket and, eventually, a GST notice.
    total: gross.add(igst).add(half).add(half),
    isInterState,
  };
}
