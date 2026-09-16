import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';

/**
 * A return stops the vendor's money, and closing it starts the clock again.
 *
 * **Do not pay a vendor for a machine that is in transit back to them.** That is
 * the whole rule, and it has to happen in the same transaction as the return
 * being raised, because nothing in this repository consumes events — an outbox
 * row here would leave a window in which a return is open and a payout run can
 * still select the payable.
 *
 * `procurement` owns `vendor_payable` and this module may not import it, so the
 * dependency is inverted into this port exactly as `listing` does for QC visits
 * (`QcVisitPort`). The implementation writes one schema per statement; when
 * procurement grows a service of its own, the provider registration swaps and
 * nothing on this side changes.
 */
export abstract class PayableHoldPort {
  /** Hold every payable behind the order these machines were bought on. */
  abstract holdForReturn(orderNumber: string, reason: string): Promise<number>;

  /**
   * Re-arm the window after a return is finished with.
   *
   * A refused return means the machines are staying with the buyer, so the
   * vendor is owed — and the clock restarts from now rather than from the
   * original delivery, because the goods were in dispute in between.
   */
  abstract releaseHold(orderNumber: string, windowHours: number): Promise<number>;
}

@Injectable()
export class LocalPayableHoldPort extends PayableHoldPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {
    super();
  }

  async holdForReturn(orderNumber: string, reason: string): Promise<number> {
    const poIds = await this.purchaseOrdersFor(orderNumber);
    if (poIds.length === 0) return 0;

    // `eligible_at` goes back to null as well as the status changing. A held
    // payable that kept its date would re-appear in a payout run the moment
    // somebody cleared the hold for an unrelated reason.
    return Number(
      await this.prisma.$executeRaw`
        UPDATE procurement.vendor_payable
           SET status = 'ON_HOLD', hold_reason = ${reason}, eligible_at = NULL
         WHERE purchase_order_id = ANY(${poIds}::uuid[])
           AND status NOT IN ('PAID', 'CANCELLED')`,
    );
  }

  async releaseHold(orderNumber: string, windowHours: number): Promise<number> {
    const poIds = await this.purchaseOrdersFor(orderNumber);
    if (poIds.length === 0) return 0;

    const eligibleAt = new Date(this.clock.nowMs() + windowHours * 3_600_000);
    return Number(
      await this.prisma.$executeRaw`
        UPDATE procurement.vendor_payable
           SET status = 'ACCRUED', hold_reason = NULL, eligible_at = ${eligibleAt}
         WHERE purchase_order_id = ANY(${poIds}::uuid[])
           AND status = 'ON_HOLD'`,
    );
  }

  /** The purchase orders behind an order, one statement per schema. */
  private async purchaseOrdersFor(orderNumber: string): Promise<string[]> {
    const [order] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering."order" WHERE order_number = ${orderNumber}`;
    if (!order) return [];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM procurement.purchase_order WHERE order_id = ${order.id}::uuid`;
    return rows.map((r) => r.id);
  }
}
