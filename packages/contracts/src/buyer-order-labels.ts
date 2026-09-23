/**
 * Buyer-facing order status and delivery-site labels.
 *
 * The enum stores SCREAMING_SNAKE; the board and facets show words. One map
 * keeps the API and the storefront agreeing on the phrasing; sentence case
 * keeps the first letter of each ·‑segment capitalised so a fallback never
 * arrives as "delivered".
 */

const BUYER_ORDER_STATUS_LABEL: Record<string, string> = {
  CREATED: 'Not yet placed',
  AWAITING_APPROVAL: 'Awaiting approval',
  PAYMENT_PENDING: 'Payment pending',
  CONFIRMED: 'Confirmed',
  // The dispatch point's answer and the steps to the door, in the buyer's
  // words. The enum names a vendor; a buyer never reads that word.
  VENDOR_ACCEPTED: 'Being prepared',
  VENDOR_REJECTED: 'Cancelled',
  PICKUP_SCHEDULED: 'Being prepared',
  PACKED: 'Being prepared',
  INVOICED: 'Being prepared',
  QC_IN_PROGRESS: 'Being prepared',
  QC_HOLD: 'Being prepared',
  QC_CLEARED: 'Being prepared',
  PICKED_UP: 'On its way',
  DISPATCHED: 'On its way',
  AT_HUB: 'On its way',
  IN_TRANSIT: 'On its way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  PARTIALLY_FULFILLED: 'Delivered',
  COMPLETED: 'Delivered',
  RETURN_REQUESTED: 'Return requested',
  RETURNED: 'Returned',
  REFUNDED: 'Refunded',
  RTO: 'Cancelled',
  CANCELLED: 'Cancelled',
};

/** Capitalise the first letter of each segment separated by ' · '. */
export function sentenceCaseLabel(text: string): string {
  return text
    .split(' · ')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' · ');
}

export function buyerOrderStatusLabel(status: string): string {
  const raw =
    BUYER_ORDER_STATUS_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase();
  return sentenceCaseLabel(raw);
}

export function deliverySiteLabel(label: string): string {
  return sentenceCaseLabel(label);
}
