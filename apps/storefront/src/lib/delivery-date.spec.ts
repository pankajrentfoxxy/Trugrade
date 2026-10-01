import { deliveryByLabel } from './delivery-date';

// 1 Oct 2026, 10:00 IST.
const NOW = new Date('2026-10-01T04:30:00Z');

describe('deliveryByLabel', () => {
  it('adds the dispatch days and the transit allowance to today in IST', () => {
    // 48 h dispatch is two days, plus two in transit: Mon 5 Oct.
    expect(deliveryByLabel(48, 2, NOW)).toBe('Mon, 5 Oct');
    expect(deliveryByLabel(24, 0, NOW)).toBe('Fri, 2 Oct');
  });

  it('rounds part of a day of dispatch up, never down', () => {
    // 30 h is two days of dispatch, not one: 1 Oct + 2 + 1 transit.
    expect(deliveryByLabel(30, 1, NOW)).toBe('Sun, 4 Oct');
  });

  it('counts from the India date, not the UTC one, late at night', () => {
    // 1 Oct 23:30 IST is still 1 Oct in IST though it is 1 Oct 18:00 UTC.
    expect(deliveryByLabel(24, 0, new Date('2026-10-01T18:00:00Z'))).toBe('Fri, 2 Oct');
    // 2 Oct 00:30 IST is 1 Oct in UTC; the India date has already moved on.
    expect(deliveryByLabel(24, 0, new Date('2026-10-01T19:00:00Z'))).toBe('Sat, 3 Oct');
  });

  it('gives no date when either fact is missing', () => {
    expect(deliveryByLabel(null, 2, NOW)).toBeNull();
    expect(deliveryByLabel(48, null, NOW)).toBeNull();
    expect(deliveryByLabel(48, undefined, NOW)).toBeNull();
  });
});
