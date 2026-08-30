import { Injectable } from '@nestjs/common';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { NotFoundError, PreconditionFailedError } from '../../../shared/errors/domain-errors';
import { PlatformService } from '../../platform';

/**
 * The writer that marks an order delivered — T23/T24.
 *
 * **This is the event that did not exist, and two features were waiting on it.**
 * A warranty starts when the buyer takes the machine; the 48-hour inspection
 * window opens at proof of delivery. `logistics.shipment` and
 * `logistics.delivery_task` are both empty and neither has a writer, so there
 * was no instant on the database either clock could run from — the after-sale
 * half of the product was not unbuilt, it was unreachable.
 *
 * So this records delivery in **ordering's own schema**, which is where the
 * order's state machine already lives: `sub_order.delivered_at`, the statuses,
 * and an `order_event` so the timeline says what happened rather than a status
 * changing with nothing behind it. It does not fabricate a shipment, a carrier
 * or a rider's proof-of-delivery photograph. When `logistics` grows a real
 * delivery task this becomes its downstream effect rather than its substitute,
 * and the column comment on `delivered_at` says so.
 *
 * **Nothing here takes a timestamp from the caller.** T17 established that a
 * deadline is computed server-side and T25 found that violated; the 48-hour
 * window is the most consequential deadline in the product, because when it
 * closes the buyer's remedy changes from a return to a warranty claim. The
 * instant comes from `ClockPort` and there is no parameter to override it. An
 * operator recording yesterday's delivery today is a real need and it is
 * deliberately not served here: it would be exactly the knob that moves a
 * deadline, and it needs its own audited path.
 *
 * **Idempotent, and that is load-bearing rather than tidy.** It is the manual
 * path a human presses, so a double-press must not re-open the window or open a
 * second warranty. A consignment that already carries `delivered_at` keeps it;
 * the warranty pass then runs over every delivered machine that has no cover,
 * which is what lets a delivery recorded any other way — a seeded arrival in the
 * past, a future logistics POD — still get its warranty.
 */

export interface DeliveryRecorded {
  orderNumber: string;
  /** Consignments whose `delivered_at` this call stamped. Zero on a re-press. */
  consignmentsDelivered: number;
  /** Consignments already delivered before this call. */
  consignmentsAlreadyDelivered: number;
  /** Machines that gained warranty cover. */
  warrantiesOpened: number;
  /** Machines that already had it. */
  warrantiesAlreadyOpen: number;
}

interface OrderRow {
  id: string;
  status: string;
}

interface ConsignmentRow {
  id: string;
  status: string;
  delivered_at: Date | null;
}

interface DeliveredUnitRow {
  unit_id: string;
  vendor_org_id: string;
  delivered_at: Date;
}

/**
 * The statuses a consignment can be delivered FROM.
 *
 * A consignment still awaiting payment or the vendor's acceptance has not left
 * anywhere, and marking it delivered would start a warranty on a machine nobody
 * has picked up. `INVOICED` and `PACKED` are included because the seeded demo
 * dispatch and a real pickup both pass through that neighbourhood.
 */
const DELIVERABLE = ['INVOICED', 'PACKED', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'];

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly platform: PlatformService,
  ) {}

  async record(orderNumber: string): Promise<DeliveryRecorded> {
    const now = this.clock.now();

    return this.prisma.runInTransaction(async () => {
      const [order] = await this.prisma.$queryRaw<OrderRow[]>`
        SELECT id, status::text AS status FROM ordering."order"
         WHERE order_number = ${orderNumber}`;
      if (!order) throw new NotFoundError('order', { reason: 'no_such_order' });

      // An order nobody has approved has not been bought yet.
      //
      // The consignment guard below is not enough on its own: it asks whether a
      // parcel looks dispatchable, not whether we ever agreed to buy the
      // machines in it. Purchase orders are raised AT APPROVAL — T25's
      // commitApproved is the only thing that writes one — so delivering an
      // order whose approval is still PENDING hands a buyer machines with no
      // record anywhere of what we owe the vendor for them, and starts a
      // warranty clock on the strength of it.
      //
      // Not hypothetical: TT-26-00007 and TT-26-00009 were sitting DELIVERED
      // with PENDING approvals and zero purchase orders, six machines each,
      // written straight in by the seed. Found by T39's board, which was the
      // first screen to put "delivered" and "what we paid" in one row.
      const [blocking] = await this.prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM ordering.order_approval
         WHERE order_id = ${order.id}::uuid AND status = 'PENDING'
         LIMIT 1`;
      if (blocking) {
        throw new PreconditionFailedError(
          `Order ${orderNumber} is still waiting on an approval, so nothing has been bought for it yet. ` +
            `Approve or decline it first — delivering it now would leave us owing a vendor with no purchase order to say for what.`,
          { reason: 'approval_still_pending' },
        );
      }

      const consignments = await this.prisma.$queryRaw<ConsignmentRow[]>`
        SELECT id, status::text AS status, delivered_at
          FROM ordering.sub_order
         WHERE order_id = ${order.id}::uuid
           AND status <> 'CANCELLED'::public.order_status
         ORDER BY sub_order_number`;
      if (consignments.length === 0) {
        throw new PreconditionFailedError(
          `Order ${orderNumber} has no live consignment to deliver — every one of them is cancelled.`,
          { reason: 'all_consignments_cancelled' },
        );
      }

      const already = consignments.filter((c) => c.delivered_at !== null);
      const pending = consignments.filter((c) => c.delivered_at === null);
      const delivering = pending.filter((c) => DELIVERABLE.includes(c.status));

      // The refusal names the state it found, because "cannot deliver" with no
      // reason is the message that sends an operator to the database.
      if (delivering.length === 0 && already.length === 0) {
        const found = [...new Set(pending.map((c) => c.status))].join(', ');
        throw new PreconditionFailedError(
          `Order ${orderNumber} has not been dispatched. Its machines are still at the supply ` +
            `point (${found}), so there is nothing for the buyer to have received.`,
          { reason: 'not_dispatched', statuses: found },
        );
      }

      if (delivering.length > 0) {
        const ids = delivering.map((c) => c.id);
        await this.prisma.$executeRaw`
          UPDATE ordering.sub_order
             SET delivered_at = ${now}, status = 'DELIVERED'::public.order_status
           WHERE id = ANY(${ids}::uuid[])`;
        await this.prisma.$executeRaw`
          UPDATE ordering.order_line SET status = 'DELIVERED'::public.order_status
           WHERE sub_order_id = ANY(${ids}::uuid[])`;
        await this.prisma.$executeRaw`
          UPDATE ordering.order_line_unit SET status = 'DELIVERED'::public.unit_status
           WHERE order_line_id IN (
                   SELECT id FROM ordering.order_line WHERE sub_order_id = ANY(${ids}::uuid[]))`;
        // The unit's own status, in listing's schema. A second statement rather
        // than a join: `no-cross-schema-join` is a design rule, and this is the
        // shape the rest of this module already uses for it.
        await this.prisma.$executeRaw`
          UPDATE listing.unit SET status = 'DELIVERED'::public.unit_status
           WHERE order_line_id IN (
                   SELECT id FROM ordering.order_line WHERE sub_order_id = ANY(${ids}::uuid[]))`;
        await this.prisma.$executeRaw`
          INSERT INTO ordering.order_event
                 (order_id, event_type, from_status, to_status, note, occurred_at)
          VALUES (${order.id}::uuid, 'STATUS_CHANGE', ${order.status}, 'DELIVERED',
                  ${`${delivering.length} consignment(s) received by the buyer. The 48-hour inspection window opens now.`},
                  ${now})`;
      }

      // The order is delivered only when every live consignment is.
      if (consignments.length === already.length + delivering.length) {
        await this.prisma.$executeRaw`
          UPDATE ordering."order" SET status = 'DELIVERED'::public.order_status
           WHERE id = ${order.id}::uuid`;
      }

      const cover = await this.openCover(order.id);

      return {
        orderNumber,
        consignmentsDelivered: delivering.length,
        consignmentsAlreadyDelivered: already.length,
        ...cover,
      };
    });
  }

  /**
   * Open warranty cover for every delivered machine on this order that has none.
   *
   * Ordering supplies the facts and `platform` decides the term. The split
   * between what the supply point stands behind and what we fund on top of it is
   * a commercial arrangement, and `platform` is where the top-up and the floor
   * live — restating them here would be a second definition of the number the
   * price was built from.
   */
  private async openCover(
    orderId: string,
  ): Promise<{ warrantiesOpened: number; warrantiesAlreadyOpen: number }> {
    const units = await this.prisma.$queryRaw<DeliveredUnitRow[]>`
      SELECT olu.unit_id, so.vendor_org_id, so.delivered_at
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order  so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
         AND so.delivered_at IS NOT NULL`;
    if (units.length === 0) return { warrantiesOpened: 0, warrantiesAlreadyOpen: 0 };

    const months = new Map(
      (
        await this.prisma.$queryRaw<Array<{ unit_id: string; vendor_warranty_months: number }>>`
          SELECT u.id AS unit_id, COALESCE(l.vendor_warranty_months, 0) AS vendor_warranty_months
            FROM listing.unit u
            LEFT JOIN listing.listing l ON l.id = u.listing_id
           WHERE u.id = ANY(${units.map((u) => u.unit_id)}::uuid[])`
      ).map((r) => [r.unit_id, Number(r.vendor_warranty_months)] as const),
    );

    const result = await this.platform.openWarranties(
      units.map((u) => ({
        unitId: u.unit_id,
        vendorOrgId: u.vendor_org_id,
        vendorWarrantyMonths: months.get(u.unit_id) ?? 0,
        deliveredAt: u.delivered_at,
      })),
    );
    return { warrantiesOpened: result.opened, warrantiesAlreadyOpen: result.alreadyCovered };
  }
}
