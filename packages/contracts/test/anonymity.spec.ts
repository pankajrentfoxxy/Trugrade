import {
  findVendorIdentityLeaks,
  assertNoVendorIdentity,
  findForbiddenKeys,
  supplyPointLabel,
  compareOffers,
  qualityHeadline,
  FORBIDDEN_CUSTOMER_KEYS,
} from '../src/anonymity';
import type { VendorIdentity, SortableOffer } from '../src/anonymity';

/**
 * The anonymity guarantee, tested the way it actually fails.
 *
 * Nobody leaks a vendor by writing `vendorLegalName` into a DTO. They leak one
 * through an S3 key, a PDF filename, an error message, a tracking reference, or
 * an untyped metadata blob — which is why the sweep reads the serialised payload
 * rather than walking typed properties.
 */

const VENDOR: VendorIdentity = {
  orgId: 'f2bfbad5-8427-4f1f-a1d9-65c1ca2232a6',
  legalName: 'Nexus IT Recyclers Private Limited',
  tradeName: 'Nexus IT Recyclers',
  gstin: '06AABCN1234M1Z5',
  pan: 'AABCN1234M',
  addressLines: ['Plot 42, Udyog Vihar Phase IV'],
  phones: ['+91-98100-11122'],
  emails: ['ops@nexusitrecyclers.in'],
  slug: 'nexus-it-recyclers',
};

describe('the leaks that are not the obvious field', () => {
  it('catches a vendor slug hidden in an S3 key', () => {
    const payload = {
      images: [{ url: 'https://cdn.trugrade.in/vendors/nexus-it-recyclers/unit-1.jpg' }],
    };
    const leaks = findVendorIdentityLeaks(payload, VENDOR);
    expect(leaks.map((l) => l.field)).toContain('slug');
  });

  it('catches a vendor name in a PDF filename', () => {
    const payload = { invoicePdf: 'INV-2026-08-Nexus IT Recyclers-0042.pdf' };
    expect(findVendorIdentityLeaks(payload, VENDOR).map((l) => l.field)).toContain('tradeName');
  });

  it('catches an org id echoed by an error message', () => {
    const payload = {
      error: `No listing for org ${VENDOR.orgId}`,
    };
    expect(findVendorIdentityLeaks(payload, VENDOR).map((l) => l.field)).toContain('orgId');
  });

  it('catches identity buried in an untyped metadata blob at depth', () => {
    // No type system sees this one. It is the whole reason the sweep is a string
    // scan and not a property walk.
    const payload = {
      offers: [{ supplyPoint: 'A', meta: { source: { audit: { gstin: VENDOR.gstin } } } }],
    };
    expect(findVendorIdentityLeaks(payload, VENDOR).map((l) => l.field)).toContain('gstin');
  });

  it('catches a phone number that was reformatted on the way out', () => {
    const payload = { carrierRef: 'PICKUP-9810011122' };
    const fields = findVendorIdentityLeaks(payload, VENDOR).map((l) => l.field);
    expect(fields).toContain('phones[0].local');
  });

  it('reports the surrounding context so the failure is actionable', () => {
    const leaks = findVendorIdentityLeaks({ note: `shipped by ${VENDOR.legalName} today` }, VENDOR);
    expect(leaks[0]?.context).toMatch(/shipped by/);
  });

  it('passes a clean anonymised payload', () => {
    const payload = {
      supplyPoint: supplyPointLabel('A', 'Gurugram'),
      landedPrice: '32100.00',
      avgQcScore: 94,
      totalWarrantyMonths: 6,
      unitsAvailable: 12,
    };
    expect(findVendorIdentityLeaks(payload, VENDOR)).toEqual([]);
    expect(() => assertNoVendorIdentity(payload, VENDOR)).not.toThrow();
  });

  it('throws with every leak named, not just the first', () => {
    const payload = { a: VENDOR.gstin, b: VENDOR.legalName };
    expect(() => assertNoVendorIdentity(payload, VENDOR)).toThrow(/gstin/);
    expect(() => assertNoVendorIdentity(payload, VENDOR)).toThrow(/legalName/);
  });

  it('does not false-positive on a needle too short to be evidence', () => {
    // A two-character trade name matches half the payload. Short identifiers are
    // the allow-list's job at the controller, not the sweep's.
    const tiny: VendorIdentity = { orgId: VENDOR.orgId, legalName: 'IT' };
    expect(findVendorIdentityLeaks({ text: 'IT equipment' }, tiny)).toEqual([]);
  });
});

describe('forbidden keys catch what a null value hides', () => {
  it('finds a forbidden key even when the fixture value is null', () => {
    // The value sweep cannot see this: there is no value to find.
    expect(findForbiddenKeys({ offers: [{ vendorOrgId: null }] })).toEqual(['vendorOrgId']);
  });

  it('finds our own commercial fields, not just the vendor identity ones', () => {
    expect(findForbiddenKeys({ marginPct: 12.8 })).toEqual(['marginPct']);
    expect(findForbiddenKeys({ line: { vendor_ask_price: '28000.00' } })).toEqual([
      'vendor_ask_price',
    ]);
  });

  it('forbids the warranty split, because the customer is told only the total', () => {
    expect(FORBIDDEN_CUSTOMER_KEYS).toContain('vendorWarrantyMonths');
    expect(FORBIDDEN_CUSTOMER_KEYS).toContain('platformBackedMonths');
    expect(findForbiddenKeys({ warranty: { totalMonths: 6, vendorBackedMonths: 3 } })).toEqual([
      'vendorBackedMonths',
    ]);
  });

  it('accepts a payload carrying only the total', () => {
    expect(findForbiddenKeys({ warranty: { totalMonths: 6 } })).toEqual([]);
  });
});

describe('supplyPointLabel', () => {
  it('renders city, and nothing finer', () => {
    expect(supplyPointLabel('a', ' Gurugram ')).toBe('Supply Point A · Gurugram');
  });
});

describe('a sort order that does not leak', () => {
  const offer = (id: string, paise: bigint, hours = 24): SortableOffer => ({
    id,
    landedPaise: paise,
    dispatchHours: hours,
  });

  it('sorts by landed price ascending', () => {
    const sorted = [offer('a', 3_300_000n), offer('b', 3_100_000n)].sort(compareOffers);
    expect(sorted.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('breaks a price tie by dispatch speed', () => {
    const sorted = [offer('a', 3_100_000n, 48), offer('b', 3_100_000n, 24)].sort(compareOffers);
    expect(sorted.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('is deterministic when price and dispatch both tie', () => {
    // Stability matters for pagination: a reader must not see the page reshuffle
    // underneath them between requests.
    const ids = ['u1', 'u2', 'u3', 'u4', 'u5'];
    const build = () => ids.map((i) => offer(i, 3_100_000n)).sort(compareOffers);
    expect(build().map((o) => o.id)).toEqual(build().map((o) => o.id));
  });

  it('does not order ties by id, which would track creation order', () => {
    // Row ids ascend with insertion, so ordering by them ranks vendors by how
    // long they have been onboarded — a stable ranking a competitor can watch.
    // Twenty-six of them: a hash order that happened to match insertion order by
    // chance would be a 1-in-26! coincidence, so this is a real assertion rather
    // than a lucky one.
    const ids = Array.from({ length: 26 }, (_, i) => `unit-${String(i).padStart(2, '0')}`);
    const got = ids.map((i) => offer(i, 3_100_000n)).sort(compareOffers).map((o) => o.id);
    expect(got).not.toEqual(ids);
    // Nothing is lost or duplicated by the reordering.
    expect([...got].sort()).toEqual([...ids].sort());
  });

  it('is a total order — equal ids compare equal', () => {
    expect(compareOffers(offer('u1', 1n), offer('u1', 1n))).toBe(0);
  });

  it('compares money as bigint, so a large price never loses precision', () => {
    const big = 9_007_199_254_740_993n; // beyond Number.MAX_SAFE_INTEGER
    const sorted = [offer('a', big + 1n), offer('b', big)].sort(compareOffers);
    expect(sorted.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('small samples do not get a headline number', () => {
  it('suppresses the average below the threshold', () => {
    const h = qualityHeadline({
      unitsInspected: 3,
      avgQcScore: 100,
      gradeAccuracyPct: 100,
      minSampleForHeadline: 10,
    });
    expect(h.kind).toBe('NEW_SUPPLIER');
    // Discriminated union: there is no percentage to render by accident.
    expect(h).not.toHaveProperty('avgQcScore');
    if (h.kind === 'NEW_SUPPLIER') expect(h.label).toBe('New supplier · 3 units inspected');
  });

  it('gets the singular right, because "1 units" reads as a bug', () => {
    const h = qualityHeadline({
      unitsInspected: 1,
      avgQcScore: 90,
      gradeAccuracyPct: 100,
      minSampleForHeadline: 10,
    });
    if (h.kind === 'NEW_SUPPLIER') expect(h.label).toBe('New supplier · 1 unit inspected');
  });

  it('publishes the numbers at or above the threshold', () => {
    const h = qualityHeadline({
      unitsInspected: 412,
      avgQcScore: 94.2,
      gradeAccuracyPct: 98,
      minSampleForHeadline: 10,
    });
    expect(h.kind).toBe('SCORE');
    // The denominator travels with the number: "98% · 412 units". A percentage
    // with no denominator is not evidence.
    if (h.kind === 'SCORE') expect(h.unitsInspected).toBe(412);
  });

  it('suppresses when the sample is large but the aggregate has not been computed', () => {
    const h = qualityHeadline({
      unitsInspected: 400,
      avgQcScore: null,
      gradeAccuracyPct: null,
      minSampleForHeadline: 10,
    });
    expect(h.kind).toBe('NEW_SUPPLIER');
  });
});
