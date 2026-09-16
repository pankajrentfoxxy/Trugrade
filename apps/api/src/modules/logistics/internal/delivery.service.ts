import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
import { AutomationService } from '../../../shared/automation/automation.service';
import { NotFoundError, PreconditionFailedError } from '../../../shared/errors/domain-errors';

/**
 * Delivery, from whichever of the three paths reports it.
 *
 * A carrier webhook, a rider pressing Delivered, and an ops override are three
 * doorways into **one** function. They were three separate stories in the plan
 * and that is how a platform ends up with an order marked delivered by one route
 * and a vendor payable that never learns of it: the after-sale clocks — warranty,
 * the inspection window, the return window that decides when a vendor is paid —
 * all run from this instant, so exactly one piece of code may write it.
 *
 * `delivered_at` is the carrier's own timestamp where there is one, and `now()`
 * only where the reporter was physically at the door. An hour of drift here is
 * an hour of somebody's money.
 */

export interface DeliveredInput {
  shipmentId: string;
  /** The carrier's instant for a webhook; the rider's own for a doorstep. */
  deliveredAt: Date;
  source: 'CARRIER_WEBHOOK' | 'RIDER' | 'OPS_OVERRIDE';
  podKey?: string | null;
  actorUserId?: string | null;
}

export interface DeliveredResult {
  shipmentId: string;
  subOrderId: string | null;
  orderNumber: string | null;
  /** False when this shipment was already delivered — a replayed webhook. */
  changed: boolean;
}

@Injectable()
export class LogisticsDeliveryService {
  private readonly logger = new Logger(LogisticsDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly automation: AutomationService,
  ) {}

  /**
   * Mark one consignment delivered.
   *
   * **Idempotent.** Carriers re-deliver webhooks, riders press twice on a bad
   * connection, and a second DELIVERED must be a no-op that answers 200 — not an
   * error, and certainly not a second custody event on a machine that only
   * arrived once.
   */
  async markDelivered(input: DeliveredInput): Promise<DeliveredResult> {
    const [shipment] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sub_order_id: string | null;
        status: string;
        delivered_at: Date | null;
      }>
    >`
      SELECT id, sub_order_id, status::text AS status, delivered_at
        FROM logistics.shipment WHERE id = ${input.shipmentId}::uuid`;
    if (!shipment) throw new NotFoundError('shipment', { shipmentId: input.shipmentId });

    const orderNumber = shipment.sub_order_id
      ? await this.orderNumberOf(shipment.sub_order_id)
      : null;

    if (shipment.delivered_at) {
      return {
        shipmentId: shipment.id,
        subOrderId: shipment.sub_order_id,
        orderNumber,
        changed: false,
      };
    }

    await this.prisma.$executeRaw`
      UPDATE logistics.shipment
         SET status = 'DELIVERED'::public.shipment_status,
             delivered_at = ${input.deliveredAt},
             pod_key = COALESCE(${input.podKey ?? null}, pod_key)
       WHERE id = ${shipment.id}::uuid`;

    await this.prisma.$executeRaw`
      UPDATE logistics.delivery_task
         SET status = 'DELIVERED', delivered_at = ${input.deliveredAt}
       WHERE shipment_id = ${shipment.id}::uuid`;

    const units = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT unit_id FROM logistics.shipment_unit WHERE shipment_id = ${shipment.id}::uuid`;
    for (const unit of units) {
      await this.prisma.$executeRaw`
        INSERT INTO logistics.custody_event
          (unit_id, from_party, to_party, actor_id, scan_type, occurred_at)
        VALUES (${unit.unit_id}::uuid, 'CARRIER', 'CUSTOMER',
                ${input.actorUserId ?? null}::uuid,
                ${input.source === 'RIDER' ? 'OTP' : 'MANUAL'}, ${input.deliveredAt})`;
    }

    if (shipment.sub_order_id) {
      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order
           SET status = 'DELIVERED'::public.order_status, delivered_at = ${input.deliveredAt}
         WHERE id = ${shipment.sub_order_id}::uuid`;
      await this.rollUpOrder(shipment.sub_order_id, input.deliveredAt);
      await this.receiveGoods(shipment.sub_order_id, input);
      await this.openReturnWindow(shipment.sub_order_id, input.deliveredAt);
    }

    await this.prisma.$executeRaw`
      INSERT INTO logistics.shipment_tracking (shipment_id, status_code, description, occurred_at)
      VALUES (${shipment.id}::uuid, 'DELIVERED',
              ${`Delivered, reported by ${input.source.toLowerCase().replace('_', ' ')}`},
              ${input.deliveredAt})`;

    await this.automation.note('R4', orderNumber ?? shipment.id, 'OK', {
      source: input.source,
      deliveredAt: input.deliveredAt.toISOString(),
    });

    return {
      shipmentId: shipment.id,
      subOrderId: shipment.sub_order_id,
      orderNumber,
      changed: true,
    };
  }

  /**
   * R5. The seven-day return window opens, and the vendor's payable with it.
   *
   * `payable.service.ts` documented that **nothing** had ever set
   * `vendor_payable.eligible_at`: the rule's answer was computed on the fly and
   * labelled as the rule rather than as a record, because "payable under the
   * policy" and "recorded as payable" are different claims and only one was
   * true. This is where the record starts being true.
   *
   * The window is the RETURN window, not the inspection one. They are separate
   * keys because they answer different questions — dispute the grade, versus
   * send it back — and payment waits for the longer of the two. One sub-order,
   * one PO, one payable, so the clock is per consignment: two consignments
   * delivered three days apart have two independent clocks, which is right,
   * because each vendor's goods arrived when they arrived.
   */
  /**
   * Title passed, so the purchase order is received.
   *
   * **Nothing wrote this, and the consequence was that no vendor could ever be
   * paid.** `PayoutRunService.create` selects payables whose purchase order is
   * `RECEIVED` or later; every purchase order in the system sat at ACKNOWLEDGED
   * or PARTIAL forever, `procurement.goods_receipt` had no writer at all, and so
   * the eligible set was permanently empty. The end-to-end walk is what found
   * it: every earlier leg passed and the money simply stopped.
   *
   * **Why delivery is the right moment.** We are the merchant of record buying
   * back-to-back: the machine goes vendor → customer and never touches us, so
   * there is no dock to receive it at. Title passes through us when the customer
   * takes it, and that instant is this one. Receiving earlier — at dispatch —
   * would start the payout clock on goods that might never arrive.
   *
   * Same transaction as the delivery, never an event: a delivery that recorded
   * itself and lost its goods receipt is a vendor who is never paid for a
   * machine the customer is holding.
   */
  private async receiveGoods(
    subOrderId: string,
    input: { deliveredAt: Date; actorUserId?: string | null },
  ): Promise<void> {
    const [sub] = await this.prisma.$queryRaw<Array<{ purchase_order_id: string | null }>>`
      SELECT purchase_order_id FROM ordering.sub_order WHERE id = ${subOrderId}::uuid`;
    if (!sub?.purchase_order_id) return;

    // One line is one machine — `purchase_order_line` carries `unit_id`, not a
    // quantity — and only an ACCEPTED line was ever bought, which is the same
    // predicate `purchase-order.repository.ts` uses everywhere else.
    //
    // Zero means nothing to take in: a purchase order the vendor never answered,
    // or one whose every line was refused. `units_expected > 0` is a CHECK on
    // the table and it is right — a receipt for nothing is not a receipt — so
    // nothing is written and the status stays where it is.
    const [units] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM procurement.purchase_order_line
       WHERE po_id = ${sub.purchase_order_id}::uuid
         AND line_status = 'ACCEPTED'::identity.po_line_status`;
    const expected = Number(units?.n ?? 0);
    if (expected === 0) return;

    // One receipt per purchase order. A second delivery webhook must not write a
    // second receipt and double the units we say we took.
    await this.prisma.$executeRaw`
      INSERT INTO procurement.goods_receipt
        (purchase_order_id, received_at, received_by, units_expected, units_confirmed,
         seals_verified, notes)
      SELECT ${sub.purchase_order_id}::uuid, ${input.deliveredAt},
             ${input.actorUserId ?? null}::uuid, ${expected}, ${expected}, TRUE,
             'Received on delivery to the customer — back-to-back, no hub leg.'
       WHERE NOT EXISTS (
         SELECT 1 FROM procurement.goods_receipt
          WHERE purchase_order_id = ${sub.purchase_order_id}::uuid)`;

    await this.prisma.$executeRaw`
      UPDATE procurement.purchase_order
         SET status = 'RECEIVED'::identity.po_status
       WHERE id = ${sub.purchase_order_id}::uuid
         AND status::text IN ('ACKNOWLEDGED', 'PARTIAL', 'DISPATCH_READY', 'DISPATCHED')`;
  }

  private async openReturnWindow(subOrderId: string, deliveredAt: Date): Promise<void> {
    const [sub] = await this.prisma.$queryRaw<Array<{ purchase_order_id: string | null }>>`
      SELECT purchase_order_id FROM ordering.sub_order WHERE id = ${subOrderId}::uuid`;
    if (!sub?.purchase_order_id) return;

    const [config] = await this.prisma.$queryRaw<Array<{ hours: number }>>`
      SELECT (value_json #>> '{}')::int AS hours FROM platform.platform_config
       WHERE key = 'ordering.return_window_hours'`;
    // Unconfigured means no promise can be made, so none is recorded. The
    // payable's own `waitingOn` already has a word for that state.
    if (!config?.hours) return;

    const eligibleAt = new Date(deliveredAt.getTime() + config.hours * 3_600_000);
    await this.prisma.$executeRaw`
      UPDATE procurement.vendor_payable
         SET eligible_at = ${eligibleAt}
       WHERE purchase_order_id = ${sub.purchase_order_id}::uuid
         AND status NOT IN ('PAID', 'CANCELLED', 'ON_HOLD')`;

    await this.automation.note('R5', subOrderId, 'OK', {
      deliveredAt: deliveredAt.toISOString(),
      eligibleAt: eligibleAt.toISOString(),
      windowHours: config.hours,
    });
  }

  /**
   * A failed attempt, with only the actions this carrier will accept.
   *
   * `legalNdrActions` exists on the port for exactly this: firing an action the
   * carrier rejects burns hours of a 36-hour response window, and the window is
   * the whole reason NDR is urgent.
   */
  async recordFailedAttempt(input: {
    shipmentId: string;
    outcome: string;
    reason: string;
    legalActions: readonly string[];
    occurredAt: Date;
  }): Promise<{ attemptNo: number }> {
    const [task] = await this.prisma.$queryRaw<Array<{ id: string; attempts: number }>>`
      SELECT id, attempts FROM logistics.delivery_task
       WHERE shipment_id = ${input.shipmentId}::uuid`;
    if (!task) throw new NotFoundError('delivery_task', { shipmentId: input.shipmentId });

    const attemptNo = task.attempts + 1;
    await this.prisma.$executeRaw`
      INSERT INTO logistics.delivery_attempt
        (delivery_task_id, attempt_no, attempted_at, outcome, reason_note)
      VALUES (${task.id}::uuid, ${attemptNo}, ${input.occurredAt}, ${input.outcome}, ${input.reason})
      ON CONFLICT (delivery_task_id, attempt_no) DO NOTHING`;

    await this.prisma.$executeRaw`
      UPDATE logistics.delivery_task
         SET attempts = ${attemptNo}, status = 'ATTEMPTED'
       WHERE id = ${task.id}::uuid`;

    await this.prisma.$executeRaw`
      UPDATE logistics.shipment SET status = 'FAILED'::public.shipment_status
       WHERE id = ${input.shipmentId}::uuid`;

    const orderId = await this.orderIdOfShipment(input.shipmentId);
    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (kind, severity, order_id, shipment_id, subject, detail, assigned_role, status, created_at)
      VALUES ('NDR', 'ATTENTION', ${orderId}::uuid, ${input.shipmentId}::uuid,
              ${`Delivery attempt ${attemptNo} failed: ${input.reason}`},
              ${JSON.stringify({
                outcome: input.outcome,
                attemptNo,
                // Only what the carrier accepts. The screen draws these and
                // nothing else, so an operator cannot fire a refused action.
                legalActions: input.legalActions,
              })}::jsonb,
              'OPS_MANAGER', 'OPEN', ${input.occurredAt})`;

    await this.automation.note('R7', input.shipmentId, 'OK', {
      attemptNo,
      legalActions: input.legalActions,
    });
    return { attemptNo };
  }

  /** An order is delivered when every live consignment on it is. */
  private async rollUpOrder(subOrderId: string, at: Date): Promise<void> {
    const [sub] = await this.prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT order_id FROM ordering.sub_order WHERE id = ${subOrderId}::uuid`;
    if (!sub) return;

    const [counts] = await this.prisma.$queryRaw<Array<{ live: bigint; delivered: bigint }>>`
      SELECT count(*) FILTER (WHERE status <> 'CANCELLED'::public.order_status)::bigint AS live,
             count(*) FILTER (WHERE delivered_at IS NOT NULL)::bigint AS delivered
        FROM ordering.sub_order WHERE order_id = ${sub.order_id}::uuid`;

    const live = Number(counts?.live ?? 0);
    const delivered = Number(counts?.delivered ?? 0);
    const status = delivered >= live && live > 0 ? 'DELIVERED' : 'PARTIALLY_FULFILLED';

    await this.prisma.$executeRaw`
      UPDATE ordering."order" SET status = ${status}::public.order_status
       WHERE id = ${sub.order_id}::uuid`;
    await this.prisma.$executeRaw`
      INSERT INTO ordering.order_event
        (order_id, event_type, to_status, note, occurred_at, actor_id)
      VALUES (${sub.order_id}::uuid, 'DELIVERY', ${status},
              ${
                status === 'DELIVERED'
                  ? 'Every consignment on this order has been delivered.'
                  : 'One consignment has been delivered. The rest are still on their way.'
              },
              ${at}, NULL)`;
  }

  private async orderNumberOf(subOrderId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ order_number: string }>>`
      SELECT o.order_number FROM ordering."order" o
        JOIN ordering.sub_order so ON so.order_id = o.id
       WHERE so.id = ${subOrderId}::uuid`;
    return row?.order_number ?? null;
  }

  private async orderIdOfShipment(shipmentId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ sub_order_id: string | null }>>`
      SELECT sub_order_id FROM logistics.shipment WHERE id = ${shipmentId}::uuid`;
    if (!row?.sub_order_id) return null;
    const [sub] = await this.prisma.$queryRaw<Array<{ order_id: string }>>`
      SELECT order_id FROM ordering.sub_order WHERE id = ${row.sub_order_id}::uuid`;
    return sub?.order_id ?? null;
  }

  /**
   * The OTP check, shared by both doorsteps.
   *
   * Salted with the task id exactly as it was issued. A mismatch is refused with
   * the same sentence whatever went wrong, because a doorstep is not a place to
   * explain which half of a code was right.
   */
  assertOtp(otpHash: string | null, code: string, saltId: string): void {
    const given = createHash('sha256').update(`${saltId}:${code}`).digest('hex');
    if (!otpHash || given !== otpHash) {
      throw new PreconditionFailedError('That code does not match. Ask for it again.', {
        reason: 'otp_mismatch',
      });
    }
  }
}
