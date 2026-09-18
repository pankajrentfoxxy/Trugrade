/**
 * A slot ends after it starts, refused at the edge.
 *
 * `SchedulingService.schedule()` has always checked this, and still does — but
 * it is the layer that writes the row, not the contract. Declaring it on the
 * shared `schedule` object is what makes both `POST /qc/visits` and
 * `POST /qc/visits/:id/schedule` answer the same way, with the field named,
 * before any of the six scheduling checks are spent on a slot that is not one.
 *
 * The case worth a test on its own is the mixed notation: `slotTimeSchema`
 * accepts `HH:MM` and `HH:MM:SS`, and comparing those as raw strings makes
 * 09:30 to 09:30:00 look like a valid slot rather than the zero minutes it is.
 */

import { createVisitSchema, scheduleVisitSchema } from '../../src/modules/qc/dto/qc.dto';

const VISIT = {
  vendorOrgId: '11111111-1111-4111-8111-111111111111',
  facilityId: '22222222-2222-4222-8222-222222222222',
  addressId: '33333333-3333-4333-8333-333333333333',
  unitsRequested: 10,
};

const slot = (slotFrom: string, slotTo: string) => ({
  scheduledDate: '2026-09-22',
  slotFrom,
  slotTo,
});

/** The first issue's path and message, or null when the parse succeeded. */
function refusal(schema: typeof scheduleVisitSchema, value: unknown): [string, string] | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0]!;
  return [issue.path.join('.'), issue.message];
}

describe('POST /qc/visits/:id/schedule', () => {
  it('accepts a slot that ends after it starts', () => {
    expect(scheduleVisitSchema.safeParse(slot('09:30', '12:45')).success).toBe(true);
  });

  it('refuses an end before the start, and blames slotTo', () => {
    expect(refusal(scheduleVisitSchema, slot('14:00', '11:00'))).toEqual([
      'slotTo',
      'End time must be later than the start time.',
    ]);
  });

  it('refuses a zero-length slot, which is not a visit anybody can attend', () => {
    expect(refusal(scheduleVisitSchema, slot('10:00', '10:00'))).toEqual([
      'slotTo',
      'End time must be later than the start time.',
    ]);
  });

  it('refuses a zero-length slot written in the two notations it accepts', () => {
    // '09:30' < '09:30:00' as raw strings, so an unpadded comparison passes this.
    expect(refusal(scheduleVisitSchema, slot('09:30', '09:30:00'))).toEqual([
      'slotTo',
      'End time must be later than the start time.',
    ]);
    expect(scheduleVisitSchema.safeParse(slot('09:30:00', '09:30')).success).toBe(false);
  });

  it('still refuses a time that is not one, before comparing anything', () => {
    expect(refusal(scheduleVisitSchema, slot('2026-09-22T10:00:00.000Z', '13:00'))).toEqual([
      'slotFrom',
      'Expected a time like 09:30.',
    ]);
  });
});

describe('POST /qc/visits, booking in the same call', () => {
  it('applies the same rule to the nested schedule block', () => {
    const parsed = createVisitSchema.safeParse({ ...VISIT, schedule: slot('16:00', '09:00') });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]!.path).toEqual(['schedule', 'slotTo']);
  });

  it('leaves a visit filed with no schedule block alone', () => {
    expect(createVisitSchema.safeParse(VISIT).success).toBe(true);
  });
});
