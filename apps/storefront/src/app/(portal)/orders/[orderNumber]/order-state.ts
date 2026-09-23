import { Money, buyerOrderStatusLabel, hasReached, type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../../../register/api';
import type { OrderRecord as Order } from './api';

/**
 * What one order is at, read once and shared by every panel on it.
 *
 * The chrome above the tabs (header, progress, next step) and the record's own
 * body both need the same handful of answers — is stock held, is it paid, has it
 * left — and computing them twice is how two panels on one screen come to
 * disagree. Nothing here is decided that the API does not already state;
 * `standing` only reads the payload.
 */

export const rupees = (decimal: string): string => Money.parse(decimal).format();

export const isGrade = (g: string): g is Grade => g === 'A_PLUS' || g === 'A' || g === 'B';

/** "23 Sep, 3:09 pm" — the step strip has room for the day and the time, no more. */
export const shortIst = (iso: string): string =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

/**
 * What went wrong, in the server's words where it had any.
 *
 * `call`'s fallback for `UNKNOWN` and `NETWORK` describes a registration form,
 * and a refusal that describes the wrong screen is worse than a plain one.
 */
export const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your order just now. That is our problem, not yours — the order itself is unaffected.'
    : failure.message;

export type OrderPhase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  /** No such order on this account. Deliberately the same screen either way. */
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; order: Order };

/**
 * The statuses under which the order is over without having been delivered.
 * `VENDOR_REJECTED` is the database's word for every dispatch point refusing;
 * it never reaches the screen, which says "Cancelled" from the label map.
 */
const OVER = new Set(['CANCELLED', 'VENDOR_REJECTED', 'RTO']);

export interface Standing {
  /** Stock is held for an approver's answer. Nothing is committed. */
  held: boolean;
  /** The approval was declined or ran out. The hold is gone. */
  released: boolean;
  /** Placed: the approval (if any) went through, and the order is live or done. */
  placed: boolean;
  over: boolean;
  paid: boolean;
  /** Every dispatch point has answered, or the order has moved past that point. */
  stockConfirmed: boolean;
  shipped: boolean;
  delivered: boolean;
  /** Something is owed and this buyer is the one to pay it. */
  payable: boolean;
}

export function standing(order: Order): Standing {
  const held = order.approval !== null && order.approval.status === 'PENDING';
  const released =
    order.approval !== null &&
    (order.approval.status === 'EXPIRED' || order.approval.status === 'REJECTED');
  const placed = !held && !released;
  const over = OVER.has(order.status);
  const shipped = placed && hasReached(order.status, 'DISPATCHED');
  const delivered = placed && hasReached(order.status, 'DELIVERED');
  const answered = order.supply.filter((l) => l.qtyAvailable !== null).length;
  const stockConfirmed =
    placed &&
    (shipped ||
      (order.supply.length > 0
        ? answered === order.supply.length
        : hasReached(order.status, 'ACKNOWLEDGED')));
  const paid = order.paymentStatus === 'PAID' || order.paymentMode === 'CREDIT';
  const payable =
    placed &&
    !over &&
    order.paymentMode !== 'CREDIT' &&
    (order.paymentStatus === 'PENDING' ||
      order.paymentStatus === 'FAILED' ||
      order.paymentStatus === 'PARTIALLY_PAID');
  return { held, released, placed, over, paid, stockConfirmed, shipped, delivered, payable };
}

/**
 * The pill.
 *
 * `warn` on a live approval and on an unpaid order, because each is a genuine
 * hold-up somebody has to act on. Neutral everywhere else: green and red are
 * PASS and FAIL, and an order state is neither a pass nor a failure. In
 * particular an order awaiting a signature never carries a word suggesting it
 * is confirmed or paid.
 */
export function statusOf(order: Order): { tone: 'neutral' | 'warn'; label: string } {
  const approval = order.approval;
  if (approval?.status === 'PENDING') return { tone: 'warn', label: 'Awaiting approval' };
  if (approval?.status === 'REJECTED') return { tone: 'neutral', label: 'Approval declined' };
  if (approval?.status === 'EXPIRED') return { tone: 'neutral', label: 'Approval expired' };
  if (order.status === 'PAYMENT_PENDING') return { tone: 'warn', label: 'Payment pending' };
  return { tone: 'neutral', label: buyerOrderStatusLabel(order.status) };
}
