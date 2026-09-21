import { consignmentTimeline, type TimelineEventRow } from './delivery-timeline';

const SUB = 'c176bb55-8027-41f5-bb92-b45e75b4fe22';
const OTHER = '0509e756-2790-445b-a775-36587e869d26';

const t = (iso: string): Date => new Date(iso);
const ev = (
  event_type: string,
  to_status: string | null,
  occurred_at: string,
  sub_order_id: string | null = null,
): TimelineEventRow => ({ event_type, to_status, occurred_at: t(occurred_at), sub_order_id });

const base = {
  subOrderId: SUB,
  consignmentStatus: 'CONFIRMED',
  orderStatus: 'CONFIRMED',
  deliveredAt: null,
  receiptConfirmedAt: null,
};

describe('consignmentTimeline', () => {
  it('a freshly placed prepaid order is placed and confirmed at the same instant, with the rest upcoming', () => {
    const steps = consignmentTimeline({
      ...base,
      events: [ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z')],
    });
    expect(steps.map((s) => [s.stage, s.state, s.at])).toEqual([
      ['PLACED', 'done', '2026-09-14T06:33:31.685Z'],
      ['CONFIRMED', 'current', '2026-09-14T06:33:31.685Z'],
      ['PREPARING', 'upcoming', null],
      ['DISPATCHED', 'upcoming', null],
      ['DELIVERED', 'upcoming', null],
      ['RECEIVED', 'upcoming', null],
    ]);
  });

  it('the vendor acknowledging the purchase order is "being prepared", even when the consignment row was never moved', () => {
    // TT-26-00028 on the dev database: PO acknowledged, sub_order still CONFIRMED.
    const steps = consignmentTimeline({
      ...base,
      events: [
        ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z'),
        ev('PO_VENDOR_RESPONSE', 'ACKNOWLEDGED', '2026-09-14T13:06:54.595Z'),
      ],
    });
    const preparing = steps.find((s) => s.stage === 'PREPARING')!;
    expect(preparing).toMatchObject({ state: 'current', at: '2026-09-14T13:06:54.595Z' });
    expect(steps.find((s) => s.stage === 'DISPATCHED')!.state).toBe('upcoming');
  });

  it('a stage the status says was reached but nothing stamped is done with a null time, never skipped', () => {
    const steps = consignmentTimeline({
      ...base,
      consignmentStatus: 'DISPATCHED',
      events: [ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z')],
    });
    expect(steps.find((s) => s.stage === 'PREPARING')).toMatchObject({ state: 'done', at: null });
    expect(steps.find((s) => s.stage === 'DISPATCHED')).toMatchObject({ state: 'current', at: null });
  });

  it('a seeded placement straight into DISPATCHED stamps dispatch from the landing status', () => {
    const steps = consignmentTimeline({
      ...base,
      consignmentStatus: 'DISPATCHED',
      events: [ev('order.placed', 'DISPATCHED', '2026-09-01T09:00:00.000Z')],
    });
    expect(steps.find((s) => s.stage === 'DISPATCHED')).toMatchObject({
      state: 'current',
      at: '2026-09-01T09:00:00.000Z',
    });
  });

  it('delivery and receipt come from the consignment columns, and receipt is the current state once signed', () => {
    const steps = consignmentTimeline({
      ...base,
      consignmentStatus: 'DELIVERED',
      deliveredAt: t('2026-09-16T10:00:00.000Z'),
      receiptConfirmedAt: t('2026-09-16T10:20:00.000Z'),
      events: [
        ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z'),
        ev('PO_DISPATCHED', 'DISPATCHED', '2026-09-15T08:00:00.000Z', SUB),
      ],
    });
    expect(steps.map((s) => [s.stage, s.state])).toEqual([
      ['PLACED', 'done'],
      ['CONFIRMED', 'done'],
      ['PREPARING', 'done'],
      ['DISPATCHED', 'done'],
      ['DELIVERED', 'done'],
      ['RECEIVED', 'current'],
    ]);
    expect(steps.find((s) => s.stage === 'DELIVERED')!.at).toBe('2026-09-16T10:00:00.000Z');
  });

  it('an event scoped to another consignment does not stamp this one', () => {
    const steps = consignmentTimeline({
      ...base,
      events: [
        ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z'),
        ev('PO_DISPATCHED', 'DISPATCHED', '2026-09-15T08:00:00.000Z', OTHER),
      ],
    });
    expect(steps.find((s) => s.stage === 'DISPATCHED')!.state).toBe('upcoming');
    expect(steps.find((s) => s.stage === 'CONFIRMED')!.state).toBe('current');
  });

  it('an order sent for approval shows the approval step, and the order status outranks the consignment default', () => {
    const steps = consignmentTimeline({
      ...base,
      orderStatus: 'AWAITING_APPROVAL',
      events: [ev('order.approval_requested', 'AWAITING_APPROVAL', '2026-09-14T06:33:31.685Z')],
    });
    expect(steps.map((s) => [s.stage, s.state])).toEqual([
      ['PLACED', 'current'],
      ['APPROVED', 'upcoming'],
      ['CONFIRMED', 'upcoming'],
      ['PREPARING', 'upcoming'],
      ['DISPATCHED', 'upcoming'],
      ['DELIVERED', 'upcoming'],
      ['RECEIVED', 'upcoming'],
    ]);
  });

  it('an approved order stamps approval and confirmation separately', () => {
    const steps = consignmentTimeline({
      ...base,
      events: [
        ev('order.approval_requested', 'AWAITING_APPROVAL', '2026-09-14T06:33:31.685Z'),
        ev('order.approved', 'CONFIRMED', '2026-09-14T09:00:00.000Z'),
      ],
    });
    expect(steps.find((s) => s.stage === 'APPROVED')).toMatchObject({
      state: 'done',
      at: '2026-09-14T09:00:00.000Z',
    });
    expect(steps.find((s) => s.stage === 'CONFIRMED')).toMatchObject({
      state: 'current',
      at: '2026-09-14T09:00:00.000Z',
    });
  });

  it('a cancelled order keeps what happened, drops what would have, and ends on the cancellation', () => {
    const steps = consignmentTimeline({
      ...base,
      orderStatus: 'CANCELLED',
      events: [
        ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z'),
        ev('ORDER_STATUS', 'CANCELLED', '2026-09-14T12:00:00.000Z'),
      ],
    });
    expect(steps.map((s) => [s.stage, s.state])).toEqual([
      ['PLACED', 'done'],
      ['CONFIRMED', 'done'],
      ['CANCELLED', 'current'],
    ]);
    expect(steps.at(-1)!.at).toBe('2026-09-14T12:00:00.000Z');
  });

  it('never lets a status enum, a purchase order number or a carrier into the payload', () => {
    const steps = consignmentTimeline({
      ...base,
      events: [
        ev('order.placed', 'CONFIRMED', '2026-09-14T06:33:31.685Z'),
        ev('PO_DISPATCHED', 'DISPATCHED', '2026-09-15T08:00:00.000Z', SUB),
      ],
    });
    const text = JSON.stringify(steps);
    expect(text).not.toMatch(/PO_|VENDOR|AWB|_STATUS/);
    for (const step of steps) expect(Object.keys(step).sort()).toEqual(['at', 'label', 'stage', 'state']);
  });
});
