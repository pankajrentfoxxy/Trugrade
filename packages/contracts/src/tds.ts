import { Money } from './money';

/**
 * TDS on purchases (Phase 7 Task 3).
 *
 * Provision: **s.393(1), Table Sl. No. 8(ii) of the Income-tax Act 2025**, the
 * re-enactment of the former s.194Q. Statutory position as at August 2026:
 *
 *   applies if   our turnover exceeded Rs 10 crore in the immediately preceding
 *                tax year  (the client has confirmed it did, FY 2025-26)
 *   threshold    purchases from THAT vendor above Rs 50 lakh in the tax year
 *   rate         0.1% on the amount ABOVE the threshold; 5% with no valid PAN
 *   timing       at credit to the vendor's account OR payment, whichever is
 *                EARLIER -- which is why the ledger accrues at PO time
 *   base         value EXCLUDING GST, where GST is shown separately
 *   failure      30% of the purchase value disallowed as expenditure
 *
 * Deliberately NOT implemented here, and it must stay that way: s.206C(1H)
 * seller TCS, s.206AB and s.206CCA non-filer rates were all **omitted with
 * effect from 1 April 2025**, and GST TCS u/s 52 binds marketplace facilitators,
 * which the merchant-of-record model means we are not.
 */

export interface TdsPolicy {
  /**
   * Whether the provision applies to us at all.
   *
   * This is a gate, not a rate of zero. If our turnover did not cross Rs 10
   * crore there is no obligation to deduct, and deducting anyway takes money
   * from a vendor we have no authority to withhold.
   */
  readonly applicable: boolean;
  readonly thresholdAmount: Money;
  readonly ratePct: number;
  readonly noPanRatePct: number;
}

export interface TdsResult {
  /** The slice of THIS purchase that sits above the threshold. */
  readonly taxableAmount: Money;
  readonly ratePct: number;
  readonly amount: Money;
  /** True when this purchase is the one that crosses the line. */
  readonly crossesThreshold: boolean;
  /** Year-to-date purchases after this one, for the ledger. */
  readonly cumulativeAfter: Money;
  readonly reason: string;
}

/**
 * Compute the deduction for one purchase.
 *
 * The arithmetic that matters is the straddling case. On the invoice that
 * crosses Rs 50 lakh, TDS is due on the portion above the line only — not on the
 * whole invoice, and not on nothing. Expressing it as
 *
 *   above(before + this) − above(before)
 *
 * gets all three regimes right with no branching: entirely below the threshold
 * gives zero, entirely above gives the full invoice, and a straddle gives
 * exactly the part that crossed. Branching on `before < threshold` is how the
 * boundary gets implemented wrongly, because there are three cases and it is
 * easy to write two.
 */
export function computeTds(input: {
  policy: TdsPolicy;
  /** Purchases from this vendor, this tax year, before this one. Excluding GST. */
  cumulativeBefore: Money;
  /** This purchase, EXCLUDING GST. */
  purchaseValue: Money;
  hasValidPan: boolean;
}): TdsResult {
  const { policy, cumulativeBefore, purchaseValue, hasValidPan } = input;
  const cumulativeAfter = cumulativeBefore.add(purchaseValue);

  if (!policy.applicable) {
    return {
      taxableAmount: Money.ZERO,
      ratePct: 0,
      amount: Money.ZERO,
      crossesThreshold: false,
      cumulativeAfter,
      reason:
        'Not applicable: our turnover did not exceed Rs 10 crore in the preceding tax year, so there is no obligation to deduct.',
    };
  }

  const above = (m: Money) => Money.max(m.sub(policy.thresholdAmount), Money.ZERO);
  const taxableAmount = above(cumulativeAfter).sub(above(cumulativeBefore));

  if (!taxableAmount.isPositive()) {
    return {
      taxableAmount: Money.ZERO,
      ratePct: 0,
      amount: Money.ZERO,
      crossesThreshold: false,
      cumulativeAfter,
      reason: `Below the ${policy.thresholdAmount.format()} threshold for this vendor this tax year.`,
    };
  }

  const ratePct = hasValidPan ? policy.ratePct : policy.noPanRatePct;
  // "Crosses" means this purchase is the one that took the vendor over the line:
  // they were at or below it before, and there is now something taxable.
  const crossesThreshold = cumulativeBefore.lte(policy.thresholdAmount);

  return {
    taxableAmount,
    ratePct,
    amount: Money.percentOf(taxableAmount, ratePct),
    crossesThreshold,
    cumulativeAfter,
    reason: hasValidPan
      ? `${ratePct}% on ${taxableAmount.format()}, the part of this purchase above the ${policy.thresholdAmount.format()} threshold.`
      : `${ratePct}% on ${taxableAmount.format()} — the higher no-PAN rate. A valid PAN brings this down.`,
  };
}

/**
 * The Indian tax year a date falls in, as `2026-27`.
 *
 * Stored on the ledger rather than derived at read time, so a late adjustment
 * lands in the year it belongs to rather than the year somebody entered it.
 */
export function financialYearOf(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Rule 32(5), the margin scheme
// ---------------------------------------------------------------------------

/**
 * Taxable value for a second-hand good sold under Rule 32(5) CGST Rules.
 *
 * Per serial, never pooled: weighted-average costing breaks the scheme outright
 * because the margin has to be attributable to a specific unit.
 *
 * A negative margin is ignored rather than carried. A loss-making resale
 * contributes zero taxable value; letting it go negative would offset another
 * serial's margin and understate the tax across the invoice.
 */
export function marginTaxableValue(salePrice: Money, purchasePrice: Money): Money {
  return Money.max(salePrice.sub(purchasePrice), Money.ZERO);
}

/** Mandatory on the face of every MARGIN-channel invoice. */
export const RULE_32_5_NARRATION =
  'Value determined under Rule 32(5) of the CGST Rules, 2017. No input tax credit availed on purchase.';

/**
 * What a buyer must be told before they buy, not at invoice time.
 *
 * A procurement head who discovers at invoicing that their input credit is
 * thinner than expected will not buy again, so the storefront labels MARGIN
 * stock and links an explainer (Phase 5 Task 5).
 */
export const MARGIN_ITC_LABEL = 'GST charged on margin · limited input credit';
