/**
 * Which machine is the deal of the day, and when it stops being so.
 *
 * The strip's clock is only honest if it counts to the instant the machine
 * really changes, so the two halves are tested together: the index flips at
 * midnight in India, and `endsAt` is that same midnight.
 */
import { dealOfDaySlot } from './DealOfDay';

const at = (iso: string): number => new Date(iso).getTime();

describe('the deal-of-the-day slot', () => {
  it('ends at the next midnight in India, not in UTC', () => {
    // 11:34 IST on 30 September.
    const { endsAt } = dealOfDaySlot(at('2026-09-30T06:04:00Z'), 24);
    expect(new Date(endsAt).toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('keeps one machine for the whole Indian day', () => {
    const justAfterMidnight = dealOfDaySlot(at('2026-09-29T18:30:00Z'), 24);
    const justBeforeMidnight = dealOfDaySlot(at('2026-09-30T18:29:59Z'), 24);
    expect(justBeforeMidnight.index).toBe(justAfterMidnight.index);
    expect(justBeforeMidnight.endsAt).toBe(justAfterMidnight.endsAt);
  });

  it('moves to the next machine at the instant the clock reaches zero', () => {
    const today = dealOfDaySlot(at('2026-09-30T06:04:00Z'), 24);
    const tomorrow = dealOfDaySlot(today.endsAt, 24);
    expect(tomorrow.index).toBe((today.index + 1) % 24);
    expect(tomorrow.endsAt - today.endsAt).toBe(24 * 60 * 60 * 1000);
  });

  it('always points inside the list, however short it is', () => {
    for (const count of [1, 2, 7, 24]) {
      const { index } = dealOfDaySlot(at('2026-09-30T06:04:00Z'), count);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
    }
  });
});
