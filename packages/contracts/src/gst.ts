import { Money } from './money';

/**
 * Place of supply and the tax split (Phase 6 Task 1).
 *
 * Goods move vendor -> buyer in one physical movement, but there are two
 * supplies and two invoices. Getting the split wrong does not produce a visible
 * bug: it produces a correct-looking invoice that is wrong, which surfaces
 * months later as a mismatched return and a credit the buyer cannot claim.
 *
 * The whole rule, for either leg, is one comparison:
 *
 *   supplier's state === place of supply  ->  CGST + SGST
 *   otherwise                             ->  IGST
 *
 * What changes between the legs is not the rule but *what the place of supply
 * is*, and that is where the counter-intuitive part lives.
 */

/** A two-character GST state code, e.g. '06' Haryana, '29' Karnataka, '27' Maharashtra. */
export type StateCode = string;

export interface TaxSplit {
  readonly igst: Money;
  readonly cgst: Money;
  readonly sgst: Money;
  readonly total: Money;
  readonly interState: boolean;
  /** The section that decided it, so an invoice can cite its own basis. */
  readonly basis: string;
}

/**
 * Union Territories charge UTGST where a State charges SGST. The rate and the
 * arithmetic are identical and `payment.invoice` has no `utgst` column, so the
 * amount is carried in `sgst` — but the label on a printed invoice must say
 * UTGST, which is why this list exists rather than being an afterthought at
 * render time.
 */
const UNION_TERRITORY_CODES: ReadonlySet<StateCode> = new Set([
  '04', // Chandigarh
  '07', // Delhi
  '25', // Daman and Diu / Dadra and Nagar Haveli (merged, code retained)
  '26', // Dadra and Nagar Haveli and Daman and Diu
  '31', // Lakshadweep
  '34', // Puducherry
  '35', // Andaman and Nicobar Islands
  '38', // Ladakh
  '97', // Other Territory
]);

export function isUnionTerritory(state: StateCode): boolean {
  return UNION_TERRITORY_CODES.has(state.trim());
}

/** What the state-tax half is called on this invoice. */
export function stateTaxLabel(placeOfSupply: StateCode): 'SGST' | 'UTGST' {
  return isUnionTerritory(placeOfSupply) ? 'UTGST' : 'SGST';
}

/**
 * Split a tax amount across the correct heads.
 *
 * The halving is done by subtraction rather than by rounding twice. Rounding
 * each half independently loses a paisa whenever the total is odd — 18% of
 * Rs 1,000.05 is Rs 180.01, and 9% computed twice gives Rs 90.00 + Rs 90.00 =
 * Rs 180.00. On one invoice that is a rounding curiosity; across a 500-line
 * order it is a reconciliation failure, and `payment.invoice` has a CHECK that
 * will reject the row rather than let it through.
 */
export function resolveTaxSplit(input: {
  supplierState: StateCode;
  placeOfSupply: StateCode;
  taxableAmount: Money;
  ratePct: number;
  basis: string;
}): TaxSplit {
  const { supplierState, placeOfSupply, taxableAmount, ratePct, basis } = input;
  const interState = supplierState.trim() !== placeOfSupply.trim();
  const total = Money.percentOf(taxableAmount, ratePct);

  if (interState) {
    return { igst: total, cgst: Money.ZERO, sgst: Money.ZERO, total, interState, basis };
  }
  const cgst = Money.percentOf(taxableAmount, ratePct / 2);
  const sgst = total.sub(cgst);
  return { igst: Money.ZERO, cgst, sgst, total, interState, basis };
}

/**
 * Leg 1 — the vendor invoices us.
 *
 * s.10(1)(b) IGST Act: where goods are delivered to another person on the
 * direction of a third person, that third person is deemed to have received
 * them, and the place of supply is **our** principal place of business —
 * irrespective of where the goods actually go.
 *
 * This is the row that looks wrong and is not. A Karnataka vendor shipping a
 * Karnataka-registered platform's goods to a Maharashtra buyer makes an
 * INTRA-Karnataka supply on leg 1, even though the machine never touches
 * Karnataka. We accumulate CGST+SGST credit in our home state and set it against
 * IGST output. Note the asymmetry that follows: CGST credit can offset IGST, but
 * SGST credit cannot offset CGST — so a home-state-heavy vendor mix selling to
 * out-of-state buyers can strand SGST credit.
 */
export function vendorToPlatform(input: {
  vendorState: StateCode;
  platformState: StateCode;
  taxableAmount: Money;
  ratePct: number;
}): TaxSplit {
  return resolveTaxSplit({
    supplierState: input.vendorState,
    // NOT the delivery state. The deeming fiction fixes it here.
    placeOfSupply: input.platformState,
    taxableAmount: input.taxableAmount,
    ratePct: input.ratePct,
    basis: 's.10(1)(b) IGST Act — bill-to-ship-to, place of supply is the third person',
  });
}

/**
 * Leg 2 — we invoice the buyer.
 *
 * s.10(1)(a): the place of supply is where the movement terminates, which is the
 * buyer's DELIVERY location.
 *
 * The trap this signature exists to prevent: resolving the split from the
 * buyer's BILLING address. A buyer registered in Delhi taking delivery at a
 * Chennai site is an inter-state supply, and billing-address logic would produce
 * CGST+SGST on an invoice that should carry IGST. Phase 6 Task 1 is explicit
 * about it, so `deliveryState` is a required parameter and there is no billing
 * state in scope to reach for by mistake.
 */
export function platformToBuyer(input: {
  platformState: StateCode;
  deliveryState: StateCode;
  taxableAmount: Money;
  ratePct: number;
}): TaxSplit {
  return resolveTaxSplit({
    supplierState: input.platformState,
    placeOfSupply: input.deliveryState,
    taxableAmount: input.taxableAmount,
    ratePct: input.ratePct,
    basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
  });
}

/**
 * The first two characters of a GSTIN are the state code.
 *
 * Returns null rather than guessing on a malformed value: a wrong state code
 * silently produces the wrong tax head, which is worse than refusing to answer.
 */
export function stateFromGstin(gstin: string | null | undefined): StateCode | null {
  const s = (gstin ?? '').trim().toUpperCase();
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][0-9A-Z]$/.test(s) ? s.slice(0, 2) : null;
}
