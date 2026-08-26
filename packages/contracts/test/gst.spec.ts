import {
  resolveTaxSplit,
  vendorToPlatform,
  platformToBuyer,
  stateFromGstin,
  isUnionTerritory,
  stateTaxLabel,
} from '../src/gst';
import { Money } from '../src/money';

/**
 * The three cases from `01_DECISIONS_AND_COMPLIANCE.md` §2.4, plus the two ways
 * this gets implemented wrongly: resolving leg 2 from the billing address, and
 * halving the tax by rounding twice.
 */

const KA = '29';
const MH = '27';
const TN = '33';
const DL = '07';

const AMOUNT = Money.rupees(100_000);
const RATE = 18;

describe('the §2.4 table, row by row', () => {
  it('row 1 — KA vendor, KA platform, MH buyer: leg 1 is CGST+SGST, leg 2 is IGST', () => {
    // The counter-intuitive one. The machine never touches Karnataka, and leg 1
    // is still an intra-Karnataka supply because s.10(1)(b) deems us to have
    // received it at our own principal place of business.
    const leg1 = vendorToPlatform({
      vendorState: KA,
      platformState: KA,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(leg1.interState).toBe(false);
    expect(leg1.igst.toString()).toBe('0.00');
    expect(leg1.cgst.toString()).toBe('9000.00');
    expect(leg1.sgst.toString()).toBe('9000.00');

    const leg2 = platformToBuyer({
      platformState: KA,
      deliveryState: MH,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(leg2.interState).toBe(true);
    expect(leg2.igst.toString()).toBe('18000.00');
    expect(leg2.cgst.toString()).toBe('0.00');
  });

  it('row 2 — MH vendor, KA platform, MH buyer: both legs IGST', () => {
    expect(
      vendorToPlatform({ vendorState: MH, platformState: KA, taxableAmount: AMOUNT, ratePct: RATE })
        .interState,
    ).toBe(true);
    expect(
      platformToBuyer({ platformState: KA, deliveryState: MH, taxableAmount: AMOUNT, ratePct: RATE })
        .interState,
    ).toBe(true);
  });

  it('row 3 — MH vendor, KA platform, TN buyer: both legs IGST', () => {
    expect(
      vendorToPlatform({ vendorState: MH, platformState: KA, taxableAmount: AMOUNT, ratePct: RATE })
        .interState,
    ).toBe(true);
    expect(
      platformToBuyer({ platformState: KA, deliveryState: TN, taxableAmount: AMOUNT, ratePct: RATE })
        .interState,
    ).toBe(true);
  });
});

describe('leg 1 uses OUR state, never the delivery state', () => {
  it('cannot depend on where the goods actually go', () => {
    // The strongest form of this assertion is structural: vendorToPlatform takes
    // no delivery state at all, so there is nothing for a careless caller to
    // reach for. Passing one is a compile error, which is why the check below is
    // the behavioural half rather than the whole of it.
    const split = vendorToPlatform({
      vendorState: KA,
      platformState: KA,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(split.interState).toBe(false);
    expect(Object.keys(split)).not.toContain('deliveryState');
  });

  it('flips to IGST only when the VENDOR moves, not when the buyer does', () => {
    const sameState = vendorToPlatform({
      vendorState: KA,
      platformState: KA,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    const vendorElsewhere = vendorToPlatform({
      vendorState: MH,
      platformState: KA,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(sameState.interState).toBe(false);
    expect(vendorElsewhere.interState).toBe(true);
  });

  it('cites the section it relied on', () => {
    expect(
      vendorToPlatform({ vendorState: KA, platformState: KA, taxableAmount: AMOUNT, ratePct: RATE })
        .basis,
    ).toMatch(/10\(1\)\(b\)/);
  });
});

describe('leg 2 uses the DELIVERY state, never the billing state', () => {
  it('a Delhi-registered buyer taking delivery in Chennai gets IGST', () => {
    // The classic wrong implementation reads the billing address and produces
    // CGST+SGST here, on an invoice that should carry IGST.
    const split = platformToBuyer({
      platformState: DL,
      deliveryState: TN,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(split.interState).toBe(true);
    expect(split.igst.toString()).toBe('18000.00');
  });

  it('a Delhi buyer taking delivery in Delhi gets CGST+SGST', () => {
    const split = platformToBuyer({
      platformState: DL,
      deliveryState: DL,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(split.interState).toBe(false);
    expect(split.cgst.toString()).toBe('9000.00');
  });

  it('cites s.10(1)(a)', () => {
    expect(
      platformToBuyer({ platformState: DL, deliveryState: TN, taxableAmount: AMOUNT, ratePct: RATE })
        .basis,
    ).toMatch(/10\(1\)\(a\)/);
  });
});

describe('the halves always add up', () => {
  it('does not lose a paisa on an odd total', () => {
    // 18% of 1,000.05 is 180.01. Rounding 9% twice gives 90.00 + 90.00 = 180.00
    // and the invoice CHECK rejects the row.
    const split = resolveTaxSplit({
      supplierState: KA,
      placeOfSupply: KA,
      taxableAmount: Money.parse('1000.05'),
      ratePct: 18,
      basis: 'test',
    });
    expect(split.total.toString()).toBe('180.01');
    expect(split.cgst.add(split.sgst).toString()).toBe(split.total.toString());
  });

  it('holds across a sweep of awkward amounts', () => {
    for (let paise = 1; paise <= 400; paise++) {
      const amount = Money.paiseOf(BigInt(paise));
      for (const rate of [5, 12, 18, 28]) {
        const s = resolveTaxSplit({
          supplierState: KA,
          placeOfSupply: KA,
          taxableAmount: amount,
          ratePct: rate,
          basis: 'test',
        });
        expect(s.cgst.add(s.sgst).toString()).toBe(s.total.toString());
      }
    }
  });

  it('puts the whole amount in IGST inter-state, with nothing stranded', () => {
    const s = resolveTaxSplit({
      supplierState: KA,
      placeOfSupply: MH,
      taxableAmount: Money.parse('1000.05'),
      ratePct: 18,
      basis: 'test',
    });
    expect(s.igst.toString()).toBe(s.total.toString());
    expect(s.cgst.toString()).toBe('0.00');
    expect(s.sgst.toString()).toBe('0.00');
  });
});

describe('union territories', () => {
  it('labels the state half UTGST where it is a UT', () => {
    expect(isUnionTerritory(DL)).toBe(true);
    expect(stateTaxLabel(DL)).toBe('UTGST');
    expect(stateTaxLabel(KA)).toBe('SGST');
  });

  it('still carries the amount in the sgst field, because there is no utgst column', () => {
    const s = platformToBuyer({
      platformState: DL,
      deliveryState: DL,
      taxableAmount: AMOUNT,
      ratePct: RATE,
    });
    expect(s.sgst.toString()).toBe('9000.00');
  });
});

describe('stateFromGstin', () => {
  it('reads the leading state code', () => {
    expect(stateFromGstin('29AABCN1234M1Z5')).toBe('29');
  });

  it('returns null rather than guessing on a malformed GSTIN', () => {
    // A wrong state code silently produces the wrong tax head, which is worse
    // than refusing to answer.
    for (const bad of ['', 'nonsense', '29AABCN1234M1Z', 'AA29BCN1234M1Z5', null, undefined]) {
      expect(stateFromGstin(bad)).toBeNull();
    }
  });
});
