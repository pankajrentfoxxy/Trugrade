import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { EventBus } from '../../../shared/events';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from '../../../shared/errors/domain-errors';
import { OrderTransactionService } from './order-transaction.service';

/**
 * The three steps after the technician has named every machine: ops verifies
 * each one, the buyer pays, and an unpaid order lapses.
 *
 * **Verification is per machine and the order moves on the last one.** Each
 * `order_line_unit` carries `verified_at` and `verified_by`; the buyer's
 * "Device verified" reads that column and nothing else. When the last slot is
 * verified the order becomes payable: `pay_by` is set 24 hours out, the
 * purchase orders are raised so the vendor sees them, and the buyer sees the
 * Pay button. A credit-terms buyer skips the button — their order confirms on
 * verification and is invoiced on the agreed terms.
 *
 * **Payment is recorded, not collected.** There is no gateway in this
 * codebase. `pay()` writes the `payment.payment` row a gateway callback would
 * write, marks the order paid and confirms it. When a gateway arrives it
 * lands in front of this method, not instead of it.
 *
 * **The deadline is real.** A sweep every minute cancels orders whose
 * `pay_by` has passed: the quantity goes back on sale, any named machines go
 * back to the vendor's shelf, and the purchase orders are cancelled with
 * their payables. Nothing is charged.
 */

export const PAY_WINDOW_HOURS = 24;

export interface VerifyResult {
  orderNumber: string;
  status: string;
  verified: number;
  total: number;
  /** ISO 8601 once the order is payable. Null until the last machine is verified. */
  payBy: string | null;
  purchaseOrders: number;
}

export interface PayResult {
  orderNumber: string;
  status: 'CONFIRMED';
  paymentStatus: 'PAID';
  paidAt: string;
  amount: string;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  payment_mode: string;
  payment_status: string;
  buyer_org_id: string;
  grand_total: string;
  pay_by: Date | null;
}

@Injectable()
export class OrderVerificationService {
  private readonly logger = new Logger(OrderVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly events: EventBus,
    private readonly orders: OrderTransactionService,
  ) {}

  /* ------------------------------------------------------------------------
   * Ops: verify
   * --------------------------------------------------------------------- */

  /**
   * Verify some or every inspected machine on an order.
   *
   * `slotIds` empty means every inspected, unverified slot. A slot that has
   * no serial yet is skipped rather than refused: "verify all" on a half-
   * inspected order verifies the half that can be, and says so in the count.
   */
  async verify(orderNumber: string, slotIds: readonly string[]): Promise<VerifyResult> {
    const actorId = this.ctx.principal?.userId ?? null;
    return this.prisma.runInTransaction(async () => {
      const order = await this.lock(orderNumber);
      if (order.status !== 'AWAITING_VERIFICATION' && order.status !== 'QC_IN_PROGRESS') {
        throw new PreconditionFailedError(
          `Order ${orderNumber} is ${humanise(order.status)}, so there is nothing to verify on it.`,
          { reason: 'order_not_verifiable', status: order.status },
        );
      }
      const now = this.clock.now();

      await this.prisma.$executeRaw`
        UPDATE ordering.order_line_unit olu
           SET verified_at = ${now}, verified_by = ${actorId}::uuid
          FROM ordering.order_line ol
          JOIN ordering.sub_order so ON so.id = ol.sub_order_id
         WHERE ol.id = olu.order_line_id
           AND so.order_id = ${order.id}::uuid
           AND olu.inspected_at IS NOT NULL
           AND olu.verified_at IS NULL
           AND (${slotIds.length === 0} OR olu.id = ANY(${[...slotIds]}::uuid[]))`;

      const [progress] = await this.prisma.$queryRaw<Array<{ total: number; verified: number }>>`
        SELECT count(*)::int AS total, count(olu.verified_at)::int AS verified
          FROM ordering.order_line_unit olu
          JOIN ordering.order_line ol ON ol.id = olu.order_line_id
          JOIN ordering.sub_order so ON so.id = ol.sub_order_id
         WHERE so.order_id = ${order.id}::uuid`;
      const total = progress?.total ?? 0;
      const verified = progress?.verified ?? 0;

      if (verified < total) {
        return {
          orderNumber,
          status: order.status,
          verified,
          total,
          payBy: null,
          purchaseOrders: 0,
        };
      }

      // The last machine. The vendor is committed to, the buyer is asked to pay.
      const raised = await this.orders.raisePurchaseOrdersForVerified(order.id);
      const credit = order.payment_mode === 'CREDIT';
      const status = credit ? 'CONFIRMED' : 'PAYMENT_PENDING';
      const payBy = credit ? null : new Date(now.getTime() + PAY_WINDOW_HOURS * 3_600_000);

      await this.prisma.$executeRaw`
        UPDATE ordering."order"
           SET status = ${status}::public.order_status, verified_at = ${now}, pay_by = ${payBy}
         WHERE id = ${order.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order SET status = ${status}::public.order_status
         WHERE order_id = ${order.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line ol SET status = ${status}::public.order_status
          FROM ordering.sub_order so
         WHERE so.id = ol.sub_order_id AND so.order_id = ${order.id}::uuid`;

      await this.orders.writeEvent(order.id, {
        type: 'order.verified',
        from: order.status,
        to: status,
        note: credit
          ? `Every machine verified. Confirmed on credit terms; the supply points have their purchase orders.`
          : `Every machine verified. Pay by ${payBy!.toISOString()} to confirm the order; after that the machines go back on sale.`,
        occurredAt: now,
        actorId,
      });

      await this.events.publish('order.confirmed', {
        orderId: order.id,
        orderNumber: order.order_number,
        buyerOrgId: order.buyer_org_id,
        totalValue: order.grand_total,
        unitIds: [],
      });

      return {
        orderNumber,
        status,
        verified,
        total,
        payBy: payBy?.toISOString() ?? null,
        purchaseOrders: raised.purchaseOrderIds.length,
      };
    });
  }

  /* ------------------------------------------------------------------------
   * Buyer: pay
   * --------------------------------------------------------------------- */

  async pay(orderNumber: string): Promise<PayResult> {
    const principal = this.ctx.requirePrincipal();
    if (!principal.orgId || principal.orgType !== 'BUYER') {
      throw new ForbiddenError('Orders are paid from a buyer account.', { reason: 'not_a_buyer' });
    }
    const orgId = principal.orgId;

    return this.prisma.runInTransaction(async () => {
      const order = await this.lock(orderNumber);
      if (order.buyer_org_id !== orgId) {
        throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });
      }
      const now = this.clock.now();
      if (order.status !== 'PAYMENT_PENDING') {
        throw new PreconditionFailedError(
          order.payment_status === 'PAID'
            ? 'This order is already paid.'
            : `This order is ${humanise(order.status)} and is not waiting for payment.`,
          { reason: 'order_not_payable', status: order.status },
        );
      }
      if (order.pay_by && order.pay_by.getTime() <= now.getTime()) {
        throw new PreconditionFailedError(
          'The 24-hour payment window for this order has closed and the machines have gone back on sale. Place the order again to have them inspected afresh.',
          { reason: 'pay_window_closed' },
        );
      }

      await this.prisma.$executeRaw`
        INSERT INTO payment.payment
          (id, order_id, buyer_org_id, gateway, gateway_ref, method, amount, status, captured_at, created_at)
        VALUES (${randomUUID()}::uuid, ${order.id}::uuid, ${orgId}::uuid, 'MANUAL', ${randomUUID()},
                'MANUAL', ${order.grand_total}::numeric, 'PAID'::public.payment_status, ${now}, ${now})`;

      await this.prisma.$executeRaw`
        UPDATE ordering."order"
           SET status = 'CONFIRMED'::public.order_status,
               payment_status = 'PAID'::public.payment_status,
               paid_at = ${now}
         WHERE id = ${order.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order SET status = 'CONFIRMED'::public.order_status
         WHERE order_id = ${order.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line ol SET status = 'CONFIRMED'::public.order_status
          FROM ordering.sub_order so
         WHERE so.id = ol.sub_order_id AND so.order_id = ${order.id}::uuid`;

      await this.orders.writeEvent(order.id, {
        type: 'order.paid',
        from: 'PAYMENT_PENDING',
        to: 'CONFIRMED',
        note: `Paid in full. The supply points are dispatching your verified machines.`,
        occurredAt: now,
        actorId: principal.userId,
      });

      return {
        orderNumber,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paidAt: now.toISOString(),
        amount: order.grand_total,
      };
    });
  }

  /* ------------------------------------------------------------------------
   * The deadline
   * --------------------------------------------------------------------- */

  @Cron(CronExpression.EVERY_MINUTE, { name: 'unpaid-order-expiry' })
  async expireUnpaid(): Promise<{ cancelled: number }> {
    const due = await this.prisma.$queryRaw<Array<{ order_number: string }>>`
      SELECT order_number FROM ordering."order"
       WHERE status = 'PAYMENT_PENDING'::public.order_status
         AND pay_by IS NOT NULL AND pay_by <= ${this.clock.now()}
       ORDER BY pay_by
       LIMIT 100
         FOR UPDATE SKIP LOCKED`;
    let cancelled = 0;
    for (const row of due) {
      try {
        await this.cancelUnpaid(row.order_number);
        cancelled += 1;
      } catch (e) {
        this.logger.error(`Cancelling unpaid order ${row.order_number} failed: ${(e as Error).message}`);
      }
    }
    if (cancelled > 0) this.logger.log(`Cancelled ${cancelled} order(s) unpaid past their deadline.`);
    return { cancelled };
  }

  private async cancelUnpaid(orderNumber: string): Promise<void> {
    await this.prisma.runInTransaction(async () => {
      const order = await this.lock(orderNumber);
      if (order.status !== 'PAYMENT_PENDING') return;
      const now = this.clock.now();

      const released = await this.orders.releaseOrderStock(
        order.id,
        'The 24-hour payment window closed and the order was cancelled.',
      );

      await this.prisma.$executeRaw`
        UPDATE procurement.purchase_order
           SET status = 'CANCELLED', cancelled_at = ${now}, updated_at = ${now}
         WHERE order_id = ${order.id}::uuid AND status IN ('RAISED', 'ACKNOWLEDGED', 'PARTIAL')`;
      await this.prisma.$executeRaw`
        UPDATE procurement.vendor_payable vp
           SET status = 'CANCELLED'
          FROM procurement.purchase_order po
         WHERE po.id = vp.purchase_order_id AND po.order_id = ${order.id}::uuid
           AND vp.status IN ('ACCRUED', 'ELIGIBLE', 'ON_HOLD')`;

      await this.prisma.$executeRaw`
        UPDATE ordering."order" SET status = 'CANCELLED'::public.order_status
         WHERE id = ${order.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order SET status = 'CANCELLED'::public.order_status
         WHERE order_id = ${order.id}::uuid`;
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line ol SET status = 'CANCELLED'::public.order_status
          FROM ordering.sub_order so
         WHERE so.id = ol.sub_order_id AND so.order_id = ${order.id}::uuid`;

      await this.orders.writeEvent(order.id, {
        type: 'order.payment_lapsed',
        from: 'PAYMENT_PENDING',
        to: 'CANCELLED',
        note: `Not paid within 24 hours of verification. ${released} ${released === 1 ? 'machine' : 'machines'} went back on sale and nothing was charged.`,
        occurredAt: now,
        actorId: null,
      });
    });
  }

  private async lock(orderNumber: string): Promise<OrderRow> {
    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status, payment_mode::text AS payment_mode,
             payment_status::text AS payment_status, buyer_org_id,
             grand_total::text AS grand_total, pay_by
        FROM ordering."order" WHERE order_number = ${orderNumber} FOR UPDATE`;
    if (!order) throw new NotFoundError('order', { orderNumber });
    return order;
  }
}

const humanise = (status: string): string => status.toLowerCase().replaceAll('_', ' ');
