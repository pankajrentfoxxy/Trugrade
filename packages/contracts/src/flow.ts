/**
 * The order lifecycle, declared once.
 *
 * Every board, every chain strip and every automation rule reads this array. A
 * status that is not in it does not exist — which is the point: the lifecycle
 * was previously spread across seven tables' status columns, so "what is stuck
 * where" could only be answered by a person who knew all seven.
 *
 * `who` is not decoration. It is the answer to "whose move is it", which is the
 * question an operator actually asks of a stalled order, and it is what the
 * pipeline columns are headed with.
 */
export const ORDER_FLOW = [
  { k: 'AWAITING_APPROVAL', label: 'Awaiting approval', who: 'Customer' },
  { k: 'PO_RAISED', label: 'PO with vendor', who: 'Vendor' },
  { k: 'ACKNOWLEDGED', label: 'Acknowledged', who: 'Vendor' },
  { k: 'PACKED', label: 'Packed', who: 'Vendor' },
  { k: 'DISPATCHED', label: 'Picked up', who: 'Carrier' },
  { k: 'IN_TRANSIT', label: 'In transit', who: 'Carrier' },
  { k: 'DELIVERED', label: 'Delivered', who: '—' },
  { k: 'RETURN_WINDOW', label: 'Return window', who: 'Customer' },
  { k: 'CLOSED', label: 'Closed', who: '—' },
] as const;

export type FlowStage = (typeof ORDER_FLOW)[number]['k'];

/** Positions an order can occupy that are not a step forward. */
export const FLOW_EXCEPTIONS = ['PARTIALLY_CONFIRMED', 'NDR', 'RETURN_OPEN', 'CANCELLED'] as const;

export type FlowException = (typeof FLOW_EXCEPTIONS)[number];

/** `ORDER_FLOW` as a lookup, so a stage's position is one read. */
export const FLOW_INDEX: Readonly<Record<FlowStage, number>> = Object.freeze(
  Object.fromEntries(ORDER_FLOW.map((s, i) => [s.k, i])) as Record<FlowStage, number>,
);

/**
 * Where an exception sits in the flow.
 *
 * **An exception state is a position in the flow, not an escape from it.** The
 * reference build's own data generator compared `FLOW_INDEX[status] >=
 * FLOW_INDEX.DELIVERED` and quietly produced nothing for every failed delivery,
 * because `NDR` has no index and `undefined >= 6` is false. Anything comparing
 * positions has to map the exception first, so this table exists and
 * `flowPosition` below is the only way to ask.
 */
const EXCEPTION_POSITION: Readonly<Record<FlowException, FlowStage>> = Object.freeze({
  /** Some consignments answered, some did not. The order is still with vendors. */
  PARTIALLY_CONFIRMED: 'ACKNOWLEDGED',
  /** A delivery was attempted and failed. It is still out with the carrier. */
  NDR: 'OUT_FOR_DELIVERY' as FlowStage,
  /** Delivered, and now going back. */
  RETURN_OPEN: 'RETURN_WINDOW',
  /** Over, wherever it stopped. */
  CANCELLED: 'CLOSED',
});

/**
 * Every `ordering.order_status` this platform writes, mapped onto the flow.
 *
 * The database enum has 24 members and carries states this lifecycle does not
 * distinguish — `PICKUP_SCHEDULED` and `PICKED_UP` are both "picked up" to an
 * operator. Mapping them here rather than renaming them in the database keeps
 * one vocabulary on the screen without rewriting history.
 */
const STATUS_TO_STAGE: Readonly<Record<string, FlowStage | FlowException>> = Object.freeze({
  CREATED: 'PO_RAISED',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  PAYMENT_PENDING: 'PO_RAISED',
  CONFIRMED: 'PO_RAISED',
  PARTIALLY_CONFIRMED: 'PARTIALLY_CONFIRMED',
  VENDOR_ACCEPTED: 'ACKNOWLEDGED',
  VENDOR_REJECTED: 'CANCELLED',
  PICKUP_SCHEDULED: 'PACKED',
  PACKED: 'PACKED',
  PICKED_UP: 'DISPATCHED',
  DISPATCHED: 'DISPATCHED',
  AT_HUB: 'IN_TRANSIT',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'IN_TRANSIT',
  QC_IN_PROGRESS: 'IN_TRANSIT',
  QC_HOLD: 'IN_TRANSIT',
  QC_CLEARED: 'IN_TRANSIT',
  INVOICED: 'DELIVERED',
  DELIVERED: 'DELIVERED',
  RETURN_REQUESTED: 'RETURN_OPEN',
  RETURNED: 'RETURN_OPEN',
  REFUNDED: 'CLOSED',
  RTO: 'CANCELLED',
  PARTIALLY_FULFILLED: 'DELIVERED',
  COMPLETED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  // The exception vocabulary itself. A board filters on "NDR" and "RETURN_OPEN"
  // as though they were statuses, so asking for their position has to work —
  // that is what makes an exception a position in the flow rather than an
  // escape from it.
  NDR: 'NDR',
  RETURN_OPEN: 'RETURN_OPEN',
});

/**
 * The flow position of any status, exception states included.
 *
 * Returns null for a status nothing has mapped, which is a bug to fix rather
 * than a row to hide — the board test walks every status in the data and fails
 * on a null.
 */
export function flowPosition(status: string): number | null {
  const stage = STATUS_TO_STAGE[status];
  if (!stage) return null;
  if ((FLOW_EXCEPTIONS as readonly string[]).includes(stage)) {
    const mapped = EXCEPTION_POSITION[stage as FlowException];
    // NDR sits between dispatch and delivery; it has no ORDER_FLOW member of its
    // own, so it borrows the transit position rather than falling off the end.
    return FLOW_INDEX[mapped] ?? FLOW_INDEX.IN_TRANSIT;
  }
  return FLOW_INDEX[stage as FlowStage] ?? null;
}

/** True when the order has reached or passed a stage. Never compares raw statuses. */
export function hasReached(status: string, stage: FlowStage): boolean {
  const at = flowPosition(status);
  return at !== null && at >= FLOW_INDEX[stage];
}

/** Every status this platform can write, for the test that asserts none escapes. */
export const MAPPED_ORDER_STATUSES: readonly string[] = Object.freeze(Object.keys(STATUS_TO_STAGE));
