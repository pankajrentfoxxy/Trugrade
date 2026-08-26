import { Money } from '../src/money';
import {
  priceFromNetPayout,
  payoutFromCommission,
  roundUpTo,
  minimumSellingPrice,
  landedPrice,
  type MarginRule,
} from '../src/pricing';

/** The seeded default from procurement.margin_rule. */
const RULE: MarginRule = {
  targetMarginPct: 12,
  floorMarginPct: 4,
  warrantyTopUpMonths: 3,
  reservePctByGrade: { A_PLUS: 0.8, A: 1.2, B: 2.0 },
};

describe('NET_PAYOUT — the vendor names the amount, we derive the price', () => {
  it('gives the vendor exactly what they asked for, whatever else moves', () => {
    const near = priceFromNetPayout({
      vendorNetPayout: Money.rupees(28_000),
      grade: 'A',
      rule: RULE,
      vendorWarrantyMonths: 3,
      logisticsAllowance: Money.rupees(400),
    });
    const far = priceFromNetPayout({
      vendorNetPayout: Money.rupees(28_000),
      grade: 'A',
      rule: RULE,
      vendorWarrantyMonths: 3,
      logisticsAllowance: Money.rupees(1_900),
    });

    // The whole reason for choosing this basis: freight moves, payout does not.
    expect(near.vendorNetPayout.eq(far.vendorNetPayout)).toBe(true);
    expect(far.sellingPrice.gt(near.sellingPrice)).toBe(true);
  });

  it('quotes the commission the vendor will check by hand', () => {
    const b = priceFromNetPayout({
      vendorNetPayout: Money.rupees(28_000),
      grade: 'A',
      rule: RULE,
      vendorWarrantyMonths: 3,
    });

    // 28000 + 12% margin + 1.2%/mo over 3 platform-backed months
    expect(b.sellingPrice.toString()).toBe('32368.00');

    // Stated as a share of what the CUSTOMER pays, not of the payout. A vendor
    // who divides 4368 by 32368 must land on the number we showed them.
    expect(b.commissionPct).toBe(Math.round((4368 / 32368) * 10_000) / 100);
  });

  // Q22: the customer is sold the vendor's term + 3, floored at 6 total.
  it.each([
    [0, 6, 6],
    [1, 6, 5],
    [3, 6, 3],
    [6, 9, 3],
    [12, 15, 3],
  ])(
    'a vendor term of %i months sells %i and leaves us funding %i',
    (vendorWarrantyMonths, total, platformBacked) => {
      const b = priceFromNetPayout({
        vendorNetPayout: Money.rupees(28_000),
        grade: 'B',
        rule: RULE,
        vendorWarrantyMonths,
      });
      expect(b.totalWarrantyMonths).toBe(total);
      expect(b.platformBackedMonths).toBe(platformBacked);
    },
  );

  it('costs less to carry a generous vendor than a stingy one', () => {
    const reserve = (vendorWarrantyMonths: number): Money =>
      priceFromNetPayout({
        vendorNetPayout: Money.rupees(28_000),
        grade: 'B',
        rule: RULE,
        vendorWarrantyMonths,
      }).warrantyReserve;

    // The floor is what makes this true at the bottom: a vendor offering 1 month
    // still has to reach 6, so we fund five of them.
    expect(reserve(1).gt(reserve(3))).toBe(true);
    expect(reserve(6).eq(reserve(3))).toBe(true);
  });

  it('reserves more on a Grade B than on an A+, for the same payout', () => {
    const reserveFor = (grade: 'A_PLUS' | 'A' | 'B'): Money =>
      priceFromNetPayout({
        vendorNetPayout: Money.rupees(28_000),
        grade,
        rule: RULE,
        vendorWarrantyMonths: 3,
      }).warrantyReserve;

    expect(reserveFor('B').gt(reserveFor('A'))).toBe(true);
    expect(reserveFor('A').gt(reserveFor('A_PLUS'))).toBe(true);
  });

  it('never sells a longer term than it has funded', () => {
    for (const vendorWarrantyMonths of [0, 1, 3, 6, 12]) {
      const b = priceFromNetPayout({
        vendorNetPayout: Money.rupees(40_000),
        grade: 'A',
        rule: RULE,
        vendorWarrantyMonths,
      });
      expect(b.platformBackedMonths).toBeGreaterThanOrEqual(0);
      // The invariant chk_warranty_split also enforces in the database.
      expect(vendorWarrantyMonths + b.platformBackedMonths).toBe(b.totalWarrantyMonths);
      expect(b.totalWarrantyMonths).toBeGreaterThanOrEqual(6);
    }
  });

  it('reconciles to the rupee — the parts are the whole', () => {
    const b = priceFromNetPayout({
      vendorNetPayout: Money.parse('28499.50'),
      grade: 'B',
      rule: RULE,
      vendorWarrantyMonths: 1,
      logisticsAllowance: Money.parse('612.35'),
      qcCostAllocation: Money.parse('141.67'),
    });
    const parts = Money.sum([
      b.vendorNetPayout,
      b.marginAmount,
      b.logisticsAllowance,
      b.qcCostAllocation,
      b.warrantyReserve,
    ]);
    expect(parts.eq(b.rawSellingPrice)).toBe(true);
    expect(b.rawSellingPrice.add(b.roundingAdjustment).eq(b.sellingPrice)).toBe(true);
  });

  it('rounds the shelf price up, never down into the margin', () => {
    const b = priceFromNetPayout({
      vendorNetPayout: Money.parse('28499.50'),
      grade: 'A',
      rule: RULE,
      vendorWarrantyMonths: 3,
      roundToNearest: 100,
    });
    expect(b.sellingPrice.paise % 10_000n).toBe(0n);
    expect(b.sellingPrice.gte(b.rawSellingPrice)).toBe(true);
    expect(b.roundingAdjustment.isNegative()).toBe(false);
  });
});

describe('COMMISSION — the same contract, spoken as a percentage', () => {
  it('is the inverse of what the vendor was quoted', () => {
    const quoted = priceFromNetPayout({
      vendorNetPayout: Money.rupees(28_000),
      grade: 'A',
      rule: RULE,
      vendorWarrantyMonths: 3,
    });
    const back = payoutFromCommission({
      expectedSalePrice: quoted.sellingPrice,
      commissionPct: quoted.commissionPct,
    });
    // Both modes land on one stored rupee value, within the rounding of a 2-dp
    // percentage. Anything wider and the two screens disagree with each other.
    expect(Number(back.vendorNetPayout.sub(quoted.vendorNetPayout).abs().paise)).toBeLessThan(500);
  });
});

describe('roundUpTo', () => {
  it('leaves an exact multiple alone', () => {
    expect(roundUpTo(Money.rupees(32_400), 100).toString()).toBe('32400.00');
  });
  it('is a no-op when disabled', () => {
    expect(roundUpTo(Money.parse('32368.45'), 0).toString()).toBe('32368.45');
  });
});

describe('VR-085 — the margin floor', () => {
  it('uses the absolute floor on a cheap unit and the percentage on a dear one', () => {
    // 4% of 8,000 = 320, below the 500 absolute floor.
    expect(minimumSellingPrice({ vendorNetPayout: Money.rupees(8_000) }).toString()).toBe(
      '8500.00',
    );
    // 4% of 80,000 = 3,200, above it.
    expect(minimumSellingPrice({ vendorNetPayout: Money.rupees(80_000) }).toString()).toBe(
      '83200.00',
    );
  });

  it('sits below what the margin rule actually quotes', () => {
    const payout = Money.rupees(28_000);
    const quoted = priceFromNetPayout({
      vendorNetPayout: payout,
      grade: 'A',
      rule: RULE,
      vendorWarrantyMonths: 3,
    });
    expect(quoted.sellingPrice.gt(minimumSellingPrice({ vendorNetPayout: payout }))).toBe(true);
  });
});

describe('landed price', () => {
  it('splits into CGST+SGST within the state and IGST across it', () => {
    const within = landedPrice({
      sellingPrice: Money.rupees(32_400),
      freight: Money.rupees(600),
      gstRatePct: 18,
      deliveryStateCode: '06',
      ourStateCode: '06',
    });
    expect(within.isInterState).toBe(false);
    expect(within.igst.isZero()).toBe(true);
    expect(within.cgst.eq(within.sgst)).toBe(true);
    expect(within.total.toString()).toBe('38940.00');

    const across = landedPrice({
      sellingPrice: Money.rupees(32_400),
      freight: Money.rupees(600),
      gstRatePct: 18,
      deliveryStateCode: '29',
      ourStateCode: '06',
    });
    expect(across.isInterState).toBe(true);
    expect(across.cgst.isZero()).toBe(true);
    // Same money to the customer either way; only the heads differ.
    expect(across.total.eq(within.total)).toBe(true);
  });

  it('taxes a margin-scheme unit on the margin, not the full value', () => {
    const margin = landedPrice({
      sellingPrice: Money.rupees(32_400),
      gstRatePct: 18,
      deliveryStateCode: '29',
      ourStateCode: '06',
      valuationMethod: 'MARGIN',
      purchasePrice: Money.rupees(28_000),
    });
    expect(margin.taxableValue.toString()).toBe('4400.00');
    expect(margin.igst.toString()).toBe('792.00');
  });

  it('ignores a negative margin rather than emitting a credit', () => {
    const underwater = landedPrice({
      sellingPrice: Money.rupees(26_000),
      gstRatePct: 18,
      deliveryStateCode: '29',
      ourStateCode: '06',
      valuationMethod: 'MARGIN',
      purchasePrice: Money.rupees(28_000),
    });
    expect(underwater.taxableValue.isZero()).toBe(true);
    expect(underwater.igst.isZero()).toBe(true);
  });

  it('keeps the invoice self-consistent — the total is the sum of its own heads', () => {
    for (const deliveryStateCode of ['06', '29']) {
      const l = landedPrice({
        sellingPrice: Money.parse('32368.45'),
        freight: Money.parse('617.30'),
        gstRatePct: 18,
        deliveryStateCode,
        ourStateCode: '06',
      });
      const rebuilt = Money.sum([l.sellingPrice, l.freight, l.igst, l.cgst, l.sgst]);
      expect(rebuilt.eq(l.total)).toBe(true);
    }
  });
});
