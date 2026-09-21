/**
 * The buyer's tracking timeline, derived rather than stored.
 *
 * `ordering.order_event` is append-only and written by five services in three
 * modules, each in its own vocabulary: `order.placed` from checkout,
 * `PO_VENDOR_RESPONSE` and `PO_DISPATCHED` from procurement, `DELIVERY` from
 * the rider app, `STATUS_CHANGE` from the buyer's own confirmation. A page
 * that rendered those rows verbatim would print "PO_DISPATCHED" and a purchase
 * order number to a buyer, and the note on the dispatch row names the carrier
 * and AWB — internal facts this product does not show.
 *
 * So the timeline is a fixed sequence of buyer-facing stages, and each event
 * row only ever contributes a *timestamp* to one of them. Nothing from the row
 * except `occurred_at` reaches the payload. That is the allow-list.
 *
 * **A stage the data says was reached but never stamped is done with `at:
 * null`, not skipped and not given a neighbour's time.** Seeded orders were
 * written straight to DISPATCHED with a single `order.placed` row, and a real
 * dispatch used to move the purchase order without touching the consignment —
 * either way the machine left, and a timeline that hid the step would say it
 * did not. The page renders a null time as "time not recorded".
 */

export type DeliveryStage =
  | 'PLACED'
  | 'APPROVED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'RECEIVED'
  | 'CANCELLED';

export interface DeliveryStep {
  stage: DeliveryStage;
  /** Buyer words. Never a status enum, never a seller. */
  label: string;
  /** ISO 8601 when the instant is recorded; null when the stage was reached but never stamped. */
  at: string | null;
  /** `done` has happened, `current` is the latest of those, `upcoming` has not. */
  state: 'done' | 'current' | 'upcoming';
}

/** The columns read from `ordering.order_event`. `note` is deliberately absent. */
export interface TimelineEventRow {
  sub_order_id: string | null;
  event_type: string;
  to_status: string | null;
  occurred_at: Date;
}

export interface TimelineInput {
  events: readonly TimelineEventRow[];
  /** The consignment being drawn. Events scoped to another consignment are ignored. */
  subOrderId: string;
  /** `sub_order.status`. */
  consignmentStatus: string;
  /** `order.status` — it outranks the consignment before payment and approval settle. */
  orderStatus: string;
  deliveredAt: Date | null;
  receiptConfirmedAt: Date | null;
}

const LABEL: Readonly<Record<DeliveryStage, string>> = Object.freeze({
  PLACED: 'Order placed',
  APPROVED: 'Approved',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Being prepared at the supply point',
  DISPATCHED: 'On its way',
  DELIVERED: 'Delivered',
  RECEIVED: 'Receipt confirmed',
  CANCELLED: 'Cancelled',
});

/** The forward stages, in the order they happen. `CANCELLED` is a terminal, not a step. */
const FORWARD: readonly DeliveryStage[] = [
  'PLACED',
  'APPROVED',
  'CONFIRMED',
  'PREPARING',
  'DISPATCHED',
  'DELIVERED',
  'RECEIVED',
];

/**
 * Where an `order_status` sits on the buyer's timeline.
 *
 * Covers the whole enum on purpose: a status this map does not know is a
 * status the timeline silently ignores, and the flow contract's own test
 * exists because that once hid every failed delivery on the ops board.
 */
const STATUS_STAGE: Readonly<Record<string, DeliveryStage>> = Object.freeze({
  CREATED: 'PLACED',
  AWAITING_APPROVAL: 'PLACED',
  PAYMENT_PENDING: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  VENDOR_ACCEPTED: 'PREPARING',
  PICKUP_SCHEDULED: 'PREPARING',
  PACKED: 'PREPARING',
  INVOICED: 'PREPARING',
  QC_IN_PROGRESS: 'PREPARING',
  QC_HOLD: 'PREPARING',
  QC_CLEARED: 'PREPARING',
  PICKED_UP: 'DISPATCHED',
  DISPATCHED: 'DISPATCHED',
  AT_HUB: 'DISPATCHED',
  IN_TRANSIT: 'DISPATCHED',
  OUT_FOR_DELIVERY: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  PARTIALLY_FULFILLED: 'DELIVERED',
  COMPLETED: 'DELIVERED',
  RETURN_REQUESTED: 'DELIVERED',
  RETURNED: 'DELIVERED',
  REFUNDED: 'DELIVERED',
  VENDOR_REJECTED: 'CANCELLED',
  RTO: 'CANCELLED',
  CANCELLED: 'CANCELLED',
  // Purchase-order statuses, because `PO_VENDOR_RESPONSE` and `PO_DISPATCHED`
  // write the PO's own vocabulary into `to_status`.
  ACKNOWLEDGED: 'PREPARING',
  PARTIAL: 'PREPARING',
  DISPATCH_READY: 'PREPARING',
});

/** Before payment and approval settle, `sub_order.status` defaults to CONFIRMED and lies. */
const ORDER_OUTRANKS = new Set(['CREATED', 'AWAITING_APPROVAL', 'PAYMENT_PENDING', 'CANCELLED']);

/** The stage an event row stamps, or null when the row is not a buyer-visible step. */
function stageOf(event: TimelineEventRow): DeliveryStage | null {
  switch (event.event_type) {
    case 'order.placed':
    case 'order.approval_requested':
      return 'PLACED';
    case 'order.approved':
      return 'APPROVED';
    default:
      return event.to_status ? (STATUS_STAGE[event.to_status] ?? null) : null;
  }
}

export function consignmentTimeline(input: TimelineInput): DeliveryStep[] {
  const stamped = new Map<DeliveryStage, Date>();
  const stamp = (stage: DeliveryStage, at: Date): void => {
    const known = stamped.get(stage);
    if (!known || at < known) stamped.set(stage, at);
  };

  let approvalRequested = false;
  for (const event of input.events) {
    if (event.sub_order_id !== null && event.sub_order_id !== input.subOrderId) continue;
    if (event.event_type === 'order.approval_requested') approvalRequested = true;
    const stage = stageOf(event);
    if (stage) stamp(stage, event.occurred_at);
    // Placement and approval also stamp the status they landed in: an approval
    // is the instant the order became CONFIRMED, and a seeded placement straight
    // into DISPATCHED is the instant it left.
    if (
      (event.event_type === 'order.placed' || event.event_type === 'order.approved') &&
      event.to_status
    ) {
      const landed = STATUS_STAGE[event.to_status];
      if (landed && landed !== 'CANCELLED') stamp(landed, event.occurred_at);
    }
  }
  if (input.deliveredAt) stamp('DELIVERED', input.deliveredAt);
  if (input.receiptConfirmedAt) stamp('RECEIVED', input.receiptConfirmedAt);

  const cancelled =
    input.orderStatus === 'CANCELLED' ||
    STATUS_STAGE[input.consignmentStatus] === 'CANCELLED' ||
    stamped.has('CANCELLED');

  // The furthest forward stage the status columns say was reached, so a stage
  // nothing stamped still appears — done, with no time.
  const ranked = ORDER_OUTRANKS.has(input.orderStatus)
    ? input.orderStatus
    : input.consignmentStatus;
  const statusStage = STATUS_STAGE[ranked];
  let reachedIndex =
    statusStage && statusStage !== 'CANCELLED' ? FORWARD.indexOf(statusStage) : 0;
  for (const stage of stamped.keys()) {
    if (stage !== 'CANCELLED') reachedIndex = Math.max(reachedIndex, FORWARD.indexOf(stage));
  }

  const sequence = FORWARD.filter((s) => s !== 'APPROVED' || approvalRequested);
  const steps: DeliveryStep[] = [];
  let lastDone = -1;
  sequence.forEach((stage) => {
    const done = FORWARD.indexOf(stage) <= reachedIndex;
    if (done) lastDone = steps.length;
    steps.push({
      stage,
      label: LABEL[stage],
      at: stamped.get(stage)?.toISOString() ?? null,
      state: done ? 'done' : 'upcoming',
    });
  });

  if (cancelled) {
    // Over, wherever it stopped: what happened stays, what would have happened
    // goes, and the cancellation is the current state.
    const kept = steps.filter((s) => s.state === 'done');
    kept.push({
      stage: 'CANCELLED',
      label: LABEL.CANCELLED,
      at: stamped.get('CANCELLED')?.toISOString() ?? null,
      state: 'current',
    });
    return kept;
  }

  if (lastDone >= 0) steps[lastDone]!.state = 'current';
  return steps;
}
