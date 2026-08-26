import {
  assertNoVendorIdentity,
  findForbiddenKeys,
  findVendorIdentityLeaks,
  type VendorIdentity,
} from '@trugrade/contracts';
import {
  present,
  type QualityFacts,
  type SupplyPointQuality,
} from '../../src/modules/qc/internal/vendor-quality.service';

/**
 * The two guarantees Task 11 is actually about, asserted rather than trusted.
 *
 * Both are the kind that hold on the day they are written and quietly stop
 * holding six months later when somebody adds a field — which is why they are
 * tested against the *serialised* payload rather than against a type.
 */

const VENDOR: VendorIdentity = {
  orgId: '7f3c1d2e-9a44-4b71-8e0c-2b6d5a91cc10',
  legalName: 'Shree Balaji Infotech Private Limited',
  tradeName: 'Balaji Infotech',
  gstin: '06AABCS1429B1ZP',
  pan: 'AABCS1429B',
  addressLines: ['Plot 41, Udyog Vihar Phase IV', 'Gurugram 122015'],
  phones: ['+919810011122'],
  emails: ['accounts@balajiinfotech.example'],
  slug: 'shree-balaji-infotech',
};

const POINT = { code: 'A', city: 'Gurugram' };

function facts(over: Partial<QualityFacts> = {}): QualityFacts {
  return {
    unitsInspected: 42,
    avgQcScore: 91.5,
    gradeAccuracyPct: 97.62,
    batteryHealthMin: 78,
    batteryHealthMax: 94,
    lastInspectedAt: new Date('2026-08-20T09:15:00.000Z'),
    computedAt: new Date('2026-08-26T22:30:00.000Z'),
    ...over,
  };
}

describe('vendor quality — the aggregate a buyer sees', () => {
  it('carries no vendor identifier, at any depth', () => {
    const row = present(POINT, 'b2d9c0f1-5e88-4a20-9f31-77c4a1d6e502', 'A', facts(), 10);

    // The value sweep reads the JSON, so it catches an identifier smuggled
    // through an untyped blob, an error string or an object key just as well as
    // one on a declared field.
    expect(findVendorIdentityLeaks(row, VENDOR)).toEqual([]);
    expect(findForbiddenKeys(row)).toEqual([]);
    expect(() => assertNoVendorIdentity(row, VENDOR)).not.toThrow();

    // And the key that is present is the anonymised one.
    expect(row.supplyPointCode).toBe('A');
    expect(row.label).toBe('Supply Point A · Gurugram');
  });

  it('publishes the headline only above the sample threshold', () => {
    const row = present(POINT, null, null, facts(), 10);
    expect(row.headline.kind).toBe('SCORE');
    if (row.headline.kind !== 'SCORE') throw new Error('unreachable');
    expect(row.headline.avgQcScore).toBe(91.5);
    expect(row.headline.gradeAccuracyPct).toBe(97.62);
    expect(row.batteryHealth).toEqual({ minPct: 78, maxPct: 94 });
  });

  /**
   * The claim the CCPA Misleading Advertisements Guidelines 2022 exist to catch,
   * and under CP e-Comm r.7(2) it would be ours, not the vendor's.
   */
  it('shows "New supplier" instead of a percentage on three units', () => {
    const row = present(
      POINT,
      null,
      null,
      facts({ unitsInspected: 3, avgQcScore: 100, gradeAccuracyPct: 100 }),
      10,
    );

    expect(row.headline).toEqual({
      kind: 'NEW_SUPPLIER',
      unitsInspected: 3,
      label: 'New supplier · 3 units inspected',
    });
    // The numbers are not merely hidden from the label — they are not in the
    // payload at all, so no caller can reach past the union and render them.
    expect(JSON.stringify(row)).not.toContain('100');
    expect(row.batteryHealth).toBeNull();
  });

  it('suppresses the headline when a number is missing even above the threshold', () => {
    // Forty units inspected and no correction data is not 100% accuracy; it is
    // an unanswered question, and `qualityHeadline` treats it as one.
    const row = present(POINT, null, null, facts({ gradeAccuracyPct: null }), 10);
    expect(row.headline.kind).toBe('NEW_SUPPLIER');
  });

  it('is a value type — nothing about it is computed at read time', () => {
    const row: SupplyPointQuality = present(POINT, null, null, facts(), 10);
    // `computed_at` is the version stamp; a reader that cares how fresh the
    // number is has it, and the grid never recomputes inside its 500 ms budget.
    expect(row.computedAt).toBe('2026-08-26T22:30:00.000Z');
    expect(row.lastInspectedAt).toBe('2026-08-20T09:15:00.000Z');
  });
});
