import {
  computeTds,
  financialYearOf,
  marginTaxableValue,
  RULE_32_5_NARRATION,
} from '../src/tds';
import type { TdsPolicy } from '../src/tds';
import { Money } from '../src/money';

/**
 * PRC-010…PRC-015 — the s.194Q boundary.
 *
 * The phase brief names three cases and they are the whole test: Rs 49,99,999,
 * Rs 50,00,001, and an invoice that straddles the line. The straddle is the one
 * that gets implemented wrongly, because a naive reading charges the whole
 * invoice and a cautious one charges nothing.
 */

const THRESHOLD = Money.rupees(5_000_000); // Rs 50 lakh

const POLICY: TdsPolicy = {
  applicable: true, // client confirmed turnover above Rs 10 crore in FY 2025-26
  thresholdAmount: THRESHOLD,
  ratePct: 0.1,
  noPanRatePct: 5,
};

const run = (before: number, purchase: number, hasValidPan = true, policy = POLICY) =>
  computeTds({
    policy,
    cumulativeBefore: Money.rupees(before),
    purchaseValue: Money.rupees(purchase),
    hasValidPan,
  });

describe('the threshold boundary', () => {
  it('PRC-010: nothing is due at Rs 49,99,999 cumulative', () => {
    const r = run(0, 4_999_999);
    expect(r.amount.toString()).toBe('0.00');
    expect(r.taxableAmount.toString()).toBe('0.00');
    expect(r.crossesThreshold).toBe(false);
    expect(r.cumulativeAfter.toString()).toBe('4999999.00');
  });

  it('PRC-011: exactly Rs 50,00,000 is still nothing — the section says ABOVE', () => {
    const r = run(0, 5_000_000);
    expect(r.amount.toString()).toBe('0.00');
    expect(r.crossesThreshold).toBe(false);
  });

  it('PRC-012: Rs 50,00,001 is due on one rupee, not on fifty lakh', () => {
    const r = run(0, 5_000_001);
    expect(r.taxableAmount.toString()).toBe('1.00');
    // 0.1% of Rs 1 is 0.1 paise, which rounds half-up to 0 paise.
    expect(r.amount.toString()).toBe('0.00');
    expect(r.crossesThreshold).toBe(true);
  });

  it('PRC-013: a straddling invoice is taxed only on the part above the line', () => {
    // Rs 45 lakh already bought, a Rs 10 lakh invoice arrives. Rs 5 lakh of it
    // sits above the threshold.
    const r = run(4_500_000, 1_000_000);
    expect(r.taxableAmount.toString()).toBe('500000.00');
    expect(r.amount.toString()).toBe('500.00');
    expect(r.crossesThreshold).toBe(true);
    expect(r.reason).toMatch(/part of this purchase above/i);
  });

  it('PRC-014: once past the line, the whole of the next invoice is taxable', () => {
    const r = run(6_000_000, 1_000_000);
    expect(r.taxableAmount.toString()).toBe('1000000.00');
    expect(r.amount.toString()).toBe('1000.00');
    // Not the crossing invoice: they were already over.
    expect(r.crossesThreshold).toBe(false);
  });

  it('PRC-015: no valid PAN is withheld at the 5% penalty rate', () => {
    const r = run(4_500_000, 1_000_000, false);
    expect(r.ratePct).toBe(5);
    expect(r.taxableAmount.toString()).toBe('500000.00');
    expect(r.amount.toString()).toBe('25000.00');
    expect(r.reason).toMatch(/no-PAN rate/i);
  });
});

describe('the straddle identity holds across the whole range', () => {
  it('charging invoice by invoice equals charging the total in one go', () => {
    // The property that proves the formula: however a vendor's year is sliced
    // into invoices, the tax collected is the same. A branching implementation
    // that mishandles the crossing invoice breaks exactly this.
    const slices = [900_000, 1_100_000, 2_000_000, 1_500_000, 3_000_000];
    let before = Money.ZERO;
    let collected = Money.ZERO;
    for (const s of slices) {
      const r = computeTds({
        policy: POLICY,
        cumulativeBefore: before,
        purchaseValue: Money.rupees(s),
        hasValidPan: true,
      });
      collected = collected.add(r.amount);
      before = r.cumulativeAfter;
    }
    const total = slices.reduce((a, b) => a + b, 0);
    const oneGo = computeTds({
      policy: POLICY,
      cumulativeBefore: Money.ZERO,
      purchaseValue: Money.rupees(total),
      hasValidPan: true,
    });
    expect(collected.toString()).toBe(oneGo.amount.toString());
  });
});

describe('the applicability gate', () => {
  it('deducts nothing at all when our turnover did not cross Rs 10 crore', () => {
    // A gate, not a zero rate. Withholding from a vendor we have no authority to
    // withhold from is taking their money.
    const r = run(10_000_000, 1_000_000, true, { ...POLICY, applicable: false });
    expect(r.amount.toString()).toBe('0.00');
    expect(r.ratePct).toBe(0);
    expect(r.reason).toMatch(/not applicable/i);
  });

  it('still reports the running cumulative so the ledger stays correct', () => {
    // The obligation may begin next year; the year-to-date figure must not have
    // a hole in it when it does.
    const r = run(10_000_000, 1_000_000, true, { ...POLICY, applicable: false });
    expect(r.cumulativeAfter.toString()).toBe('11000000.00');
  });
});

describe('financial-year rollover', () => {
  it('runs April to March', () => {
    expect(financialYearOf('2026-04-01')).toBe('2026-27');
    expect(financialYearOf('2027-03-31')).toBe('2026-27');
    expect(financialYearOf('2027-04-01')).toBe('2027-28');
    expect(financialYearOf('2026-03-31')).toBe('2025-26');
  });

  it('pads the trailing year across a century boundary', () => {
    expect(financialYearOf('2099-05-01')).toBe('2099-00');
  });

  it('resets the cumulative — a new year starts from zero', () => {
    // Modelled by the caller passing the new year's cumulative, which is why the
    // ledger stores financial_year rather than deriving it at read time.
    const r = run(0, 1_000_000);
    expect(r.amount.toString()).toBe('0.00');
  });
});

describe('Rule 32(5) margin value', () => {
  it('is sale minus purchase, per serial', () => {
    expect(marginTaxableValue(Money.rupees(32_100), Money.rupees(28_000)).toString()).toBe(
      '4100.00',
    );
  });

  it('ignores a negative margin rather than carrying it', () => {
    // A loss-making resale contributes zero. Carried negative it would offset
    // another serial's margin and understate the tax across the invoice.
    expect(marginTaxableValue(Money.rupees(25_000), Money.rupees(28_000)).toString()).toBe('0.00');
  });

  it('never lets one serial subsidise another', () => {
    const lines = [
      marginTaxableValue(Money.rupees(32_100), Money.rupees(28_000)),
      marginTaxableValue(Money.rupees(25_000), Money.rupees(28_000)),
    ];
    expect(Money.sum(lines).toString()).toBe('4100.00');
  });

  it('carries the mandatory narration', () => {
    expect(RULE_32_5_NARRATION).toMatch(/Rule 32\(5\)/);
    expect(RULE_32_5_NARRATION).toMatch(/No input tax credit availed/i);
  });
});
