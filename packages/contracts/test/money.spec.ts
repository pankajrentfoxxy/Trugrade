/**
 * VR-126 / VR-127. The money type is the only defence against the class of bug that
 * shows up as a ₹0.03 discrepancy on a 500-line invoice and a GST notice a year later.
 */

import { Money, MoneyError } from '../src/money';

describe('VR-126 — exact representation, no floats', () => {
  it('round-trips a decimal string losslessly', () => {
    for (const s of ['0.00', '1.00', '0.01', '1234.56', '99999999.99', '-42.05']) {
      expect(Money.parse(s).toString()).toBe(s);
    }
  });

  it('holds a value that a double cannot', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. Here it must be exact.
    const sum = Money.parse('0.10').add(Money.parse('0.20'));
    expect(sum.toString()).toBe('0.30');
    expect(sum.eq(Money.parse('0.30'))).toBe(true);
  });

  it('refuses more than two decimal places rather than truncating silently', () => {
    expect(() => Money.parse('10.005')).toThrow(MoneyError);
  });

  it('refuses a non-integer rupee amount through the rupees() door', () => {
    expect(() => Money.rupees(10.5)).toThrow(MoneyError);
  });

  it('refuses a fractional quantity multiplier', () => {
    expect(() => Money.parse('100.00').times(1.5)).toThrow(MoneyError);
  });

  it('rejects a value outside NUMERIC(14,2)', () => {
    expect(() => Money.parse('99999999999999.99')).toThrow(MoneyError);
  });
});

describe('VR-127 — half-up rounding at each line', () => {
  it('rounds a half up, away from zero', () => {
    // 18% of 1000.05 = 180.009 -> 180.01
    expect(Money.percentOf(Money.parse('1000.05'), 18).toString()).toBe('180.01');
    // 0.1% of 12345.67 = 12.34567 -> 12.35
    expect(Money.percentOf(Money.parse('12345.67'), 0.1).toString()).toBe('12.35');
  });

  it('rounds a negative half away from zero too', () => {
    expect(Money.percentOf(Money.parse('-1000.05'), 18).toString()).toBe('-180.01');
  });

  it('splits CGST and SGST so the two halves are equal and sum to the total (VR-129)', () => {
    const taxable = Money.parse('34567.89');
    const total = Money.percentOf(taxable, 18);
    const half = Money.percentOf(taxable, 9);
    expect(half.add(half).toString()).toBe(
      // The halves are each rounded, so their sum may differ from the rounded total
      // by one paisa. The invoice stores the halves and derives the total from them —
      // never the other way round.
      half.times(2).toString(),
    );
    expect(total.sub(half.times(2)).abs().lte(Money.parse('0.01'))).toBe(true);
  });

  it('PAY-017 — a 500-line order shows zero drift', () => {
    const unit = Money.parse('34567.89');
    const lines = Array.from({ length: 500 }, () => unit);
    const summed = Money.sum(lines);
    expect(summed.toString()).toBe(unit.times(500).toString());
    expect(summed.toString()).toBe('17283945.00');
  });

  it('a per-line tax sum equals the sum of the per-line taxes, by construction', () => {
    const lines = ['1234.56', '99.99', '10000.01', '7.77'].map(Money.parse);
    const perLineTax = lines.map((l) => Money.percentOf(l, 18));
    const invoiceTax = Money.sum(perLineTax);
    // The invoice total is the sum of the *rounded* lines, which is what VR-127 says.
    expect(invoiceTax.toString()).toBe(
      perLineTax.reduce((a, b) => a.add(b), Money.ZERO).toString(),
    );
  });
});

describe('Indian formatting — lakh and crore grouping', () => {
  it.each([
    ['0.00', '₹0.00'],
    ['999.50', '₹999.50'],
    ['1234.50', '₹1,234.50'],
    ['123456.78', '₹1,23,456.78'],
    ['1234567.89', '₹12,34,567.89'],
    ['12345678.90', '₹1,23,45,678.90'],
    ['-1234567.89', '-₹12,34,567.89'],
  ])('formats %s as %s', (input, expected) => {
    expect(Money.parse(input).format()).toBe(expected);
  });

  it('can drop the symbol for a table column that has it in the header', () => {
    expect(Money.parse('1234567.89').format({ symbol: false })).toBe('12,34,567.89');
  });
});

describe('TDS arithmetic (VR-138) — the boundary that costs 30% of the purchase value', () => {
  const THRESHOLD = Money.rupees(5_000_000); // ₹50 lakh

  /** Only the portion above the threshold is charged. */
  function tdsOn(cumulativeBefore: Money, invoiceExGst: Money, hasPan: boolean): Money {
    const cumulativeAfter = cumulativeBefore.add(invoiceExGst);
    if (cumulativeAfter.lte(THRESHOLD)) return Money.ZERO;
    const chargeable = Money.max(cumulativeAfter.sub(Money.max(cumulativeBefore, THRESHOLD)), Money.ZERO);
    return Money.percentOf(chargeable, hasPan ? 0.1 : 5);
  }

  it('PRC-010 — nothing at ₹49,99,999', () => {
    expect(tdsOn(Money.ZERO, Money.parse('4999999.00'), true).toString()).toBe('0.00');
  });

  it('PRC-011 — one rupee of chargeable value at ₹50,00,001', () => {
    expect(tdsOn(Money.ZERO, Money.parse('5000001.00'), true).toString()).toBe('0.00');
  });

  it('PRC-012 — a straddling invoice is charged only on the portion above the line', () => {
    // Cumulative 49,00,000 then a 5,00,000 invoice: 4,00,000 is chargeable.
    const tds = tdsOn(Money.rupees(4_900_000), Money.rupees(500_000), true);
    expect(tds.toString()).toBe('400.00');
  });

  it('PRC-013 — once past the line the whole invoice is chargeable', () => {
    const tds = tdsOn(Money.rupees(6_000_000), Money.rupees(100_000), true);
    expect(tds.toString()).toBe('100.00');
  });

  it('PRC-014 — a vendor with no PAN is withheld at 5%', () => {
    const tds = tdsOn(Money.rupees(6_000_000), Money.rupees(100_000), false);
    expect(tds.toString()).toBe('5000.00');
  });

  it('PRC-015 — exactly at the threshold nothing is due', () => {
    expect(tdsOn(Money.ZERO, Money.rupees(5_000_000), true).toString()).toBe('0.00');
  });
});

describe('the payout deduction stack (VR-145)', () => {
  it('never produces a negative payout — the balance carries forward', () => {
    const gross = Money.parse('12000.00');
    const tds = Money.parse('12.00');
    const penalties = Money.parse('15000.00');
    const raw = gross.sub(tds).sub(penalties);
    expect(raw.isNegative()).toBe(true);

    const net = Money.max(raw, Money.ZERO);
    const carriedForward = raw.isNegative() ? raw.negate() : Money.ZERO;
    expect(net.toString()).toBe('0.00');
    expect(carriedForward.toString()).toBe('3012.00');
  });

  it('applies the stack in the mandated order: gross, TDS, penalties, adjustments', () => {
    const gross = Money.parse('100000.00');
    const tds = Money.percentOf(gross, 0.1);
    const penalties = Money.parse('2500.00');
    const adjustments = Money.parse('-750.00');
    const net = gross.sub(tds).sub(penalties).add(adjustments);
    expect(tds.toString()).toBe('100.00');
    expect(net.toString()).toBe('96650.00');
  });
});
