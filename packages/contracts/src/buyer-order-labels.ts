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
  PAYMENT_PENDING: 'Placed · payment pending',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  DELIVERED: 'Delivered',
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
