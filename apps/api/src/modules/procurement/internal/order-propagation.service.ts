import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { financialYearOf } from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';

/**
 * What a vendor's answer does to the customer's order.
 *
 * `respondLines` set the PO's status, rewrote the payable and wrote an
 * `order_event` — and touched `ordering."order"`, `sub_order` and `order_line`
 * not at all. So a vendor could acknowledge every line of every PO on an order
 * and the customer's screen would still read exactly as it had the moment they
 * paid. The acknowledgement went nowhere.
 *
 * **Everything here runs inside `respondLines`' transaction.** Nothing in this
 * repository subscribes to an event — `events.publish` writes to an outbox with
 * no reader — so "on acknowledgement, move the order" has to be the same
 * transaction or it is a promise nobody keeps. The event is still published, for
 * the day a consumer exists.
 *
 * **What it deliberately does not do: change what the buyer owes.** A rejected
 * line cancels its slots and releases its machines, and it raises an ops task.
 * It does not silently reduce the order total, because a vendor saying "I cannot
 * supply this" is not the platform deciding to refund it — ops either re-sources
 * the line from another supply point or cancels and credits it, and both of
 * those are decisions with a person's name on them.
 */

/** A line the vendor refused, with what it was worth and what it was for. */
export interface RejectedLine {
  lineId: string;
  skuId: string;
  grade: string;
  agreedNetPayout: string;
  reason: string;
}

export interface PropagationResult {
  /** `ordering."order".status` after the answer. */
  orderStatus: string;
  /** `sub_order.status` for this PO's consignment. */
  subOrderStatus: string;
  /** Machines put back on sale because their line was refused. */
  releasedUnits: number;
  /** Raised when anything was refused. Null when the vendor took the lot. */
  opsTaskId: string | null;
}

/**
 * The accounts this reversal touches.
 *
 * `payment.ledger_entry` has had no writer at all until now, so these are the
 * first codes in it. They are stated here rather than inline so the next thing
 * that posts — the payout run in stage 5 — uses the same strings instead of
 * inventing a second set that reconciles to nothing.
 */
export const ACCOUNTS = {
  vendorPayable: '2100-VENDOR-PAYABLE',
  purchases: '5000-PURCHASES',
  /** Where a confirmed payout leaves from. Escrow replaces it when one is signed. */
  bank: '1100-BANK',
  /**
   * Instructed, not yet confirmed by a bank.
   *
   * `chk_payout_utr` refuses a PAID payout line with no UTR, and it is right to:
   * a UTR is the bank's reference and we have no bank connected. So a released
   * run moves the liability here and it sits in transit until a real reference
   * arrives — which is what funds in transit means, and is a truer statement
   * than crediting a bank account nothing left.
   */
  payoutsInTransit: '2150-PAYOUTS-IN-TRANSIT',
} as const;

@Injectable()
export class OrderPropagationService {
  constructor(private readonly prisma: PrismaService) {}

  async propagate(input: {
    poId: string;
    orderId: string;
    vendorOrgId: string;
    poNumber: string;
    tdsRatePct: number;
    acceptedLineIds: readonly string[];
    rejectedLines: readonly RejectedLine[];
    now: Date;
    actorUserId: string;
  }): Promise<PropagationResult> {
    const subOrderId = await this.subOrderOf(input.poId, input.orderId, input.vendorOrgId);

    let releasedUnits = 0;
    if (input.rejectedLines.length > 0 && subOrderId) {
      releasedUnits = await this.cancelRefusedSlots(subOrderId, input.rejectedLines, input.now);
    }

    const fullyRejected = input.acceptedLineIds.length === 0;
    const subOrderStatus = fullyRejected ? 'VENDOR_REJECTED' : 'VENDOR_ACCEPTED';

    if (subOrderId) {
      // The lines the vendor took. A line already CANCELLED above stays
      // cancelled — `status <> 'CANCELLED'` rather than a list of ids, because
      // the ids were cancelled per slot and a line may be only partly refused.
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line
           SET status = 'VENDOR_ACCEPTED'::public.order_status
         WHERE sub_order_id = ${subOrderId}::uuid
           AND status <> 'CANCELLED'::public.order_status`;

      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order
           SET status = ${subOrderStatus}::public.order_status,
               accepted_at = CASE WHEN ${!fullyRejected} THEN ${input.now} ELSE accepted_at END,
               rejected_at = CASE WHEN ${fullyRejected} THEN ${input.now} ELSE rejected_at END
         WHERE id = ${subOrderId}::uuid`;
    }

    const orderStatus = await this.rollUpOrder(input.orderId, input.now);

    const opsTaskId =
      input.rejectedLines.length === 0
        ? null
        : await this.raiseTask(input, fullyRejected, releasedUnits);

    if (input.rejectedLines.length > 0) {
      await this.reverseAccrual(input);
    }

    return { orderStatus, subOrderStatus, releasedUnits, opsTaskId };
  }

  /**
   * The consignment this PO buys.
   *
   * By id since the supply-point split made the two 1:1. The fallback covers
   * rows raised before that migration, where the only link was the pair the
   * grouping was derived from — and it is deliberately not silent about
   * ambiguity: a vendor with two pre-migration consignments on one order cannot
   * be resolved this way, so it takes neither rather than the wrong one.
   */
  private async subOrderOf(
    poId: string,
    orderId: string,
    vendorOrgId: string,
  ): Promise<string | null> {
    const [linked] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering.sub_order WHERE purchase_order_id = ${poId}::uuid`;
    if (linked) return linked.id;

    const legacy = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering.sub_order
       WHERE order_id = ${orderId}::uuid AND vendor_org_id = ${vendorOrgId}::uuid`;
    return legacy.length === 1 ? legacy[0]!.id : null;
  }

  /**
   * Cancel one slot per refused line, and put its machine back on sale.
   *
   * A PO line is one machine; an `order_line` is a SKU and grade with a
   * quantity, and neither side carries a serial yet (both are vacant until the
   * vendor attaches one). So the refusal is matched on SKU and grade and
   * applied as a count — reject two of five and the line keeps its three.
   *
   * `cancelled_qty` is the column that already models this, with
   * `chk_line_qty` refusing more cancellations than there are machines.
   */
  private async cancelRefusedSlots(
    subOrderId: string,
    rejected: readonly RejectedLine[],
    now: Date,
  ): Promise<number> {
    const wanted = new Map<string, number>();
    for (const line of rejected) {
      const key = `${line.skuId}|${line.grade}`;
      wanted.set(key, (wanted.get(key) ?? 0) + 1);
    }

    let released = 0;
    for (const [key, count] of wanted) {
      const [skuId = '', grade = ''] = key.split('|');
      let remaining = count;

      const lines = await this.prisma.$queryRaw<
        Array<{ id: string; qty: number; cancelled_qty: number; fulfilled_qty: number }>
      >`
        SELECT id, qty, cancelled_qty, fulfilled_qty
          FROM ordering.order_line
         WHERE sub_order_id = ${subOrderId}::uuid
           AND sku_id = ${skuId}::uuid
           AND grade = ${grade}::public.grade_type
         ORDER BY id
           FOR UPDATE`;

      for (const line of lines) {
        if (remaining === 0) break;
        const cancellable = line.qty - line.cancelled_qty - line.fulfilled_qty;
        const take = Math.min(remaining, cancellable);
        if (take <= 0) continue;
        remaining -= take;

        await this.prisma.$executeRaw`
          UPDATE ordering.order_line
             SET cancelled_qty = cancelled_qty + ${take},
                 status = CASE WHEN cancelled_qty + ${take} >= qty
                               THEN 'CANCELLED'::public.order_status
                               ELSE status END
           WHERE id = ${line.id}::uuid`;

        // The slot is removed rather than marked: `unit_status` has no cancelled
        // member, and inventing one would put a machine state on a row that is
        // not a machine — an `order_line_unit` at this point is a vacant
        // placeholder with no serial in it. What happened is recorded where it
        // belongs: `cancelled_qty` on the line, the ops task, and the audit row
        // `respondLines` writes.
        await this.prisma.$executeRaw`
          DELETE FROM ordering.order_line_unit
           WHERE id IN (
             SELECT id FROM ordering.order_line_unit
              WHERE order_line_id = ${line.id}::uuid
                AND status = 'RESERVED'::public.unit_status
                AND unit_id IS NULL
              ORDER BY id
              LIMIT ${take}
           )`;

        released += await this.releaseUnits(line.id, take, now);
      }
    }
    return released;
  }

  /**
   * Put refused machines back on sale, with the trail.
   *
   * A refused line that leaves its machines RESERVED is stock the platform
   * cannot sell and cannot explain: the listing counters are derived from unit
   * status by trigger, so a machine stuck at RESERVED is simply missing from
   * everyone's inventory for ever.
   */
  private async releaseUnits(orderLineId: string, take: number, now: Date): Promise<number> {
    const moved = await this.prisma.$executeRaw`
      WITH picked AS (
        SELECT u.id
          FROM listing.unit u
         WHERE u.order_line_id = ${orderLineId}::uuid
           AND u.status = 'RESERVED'::public.unit_status
         ORDER BY u.id
         LIMIT ${take}
           FOR UPDATE
      ),
      before AS (
        SELECT u.id, u.status, u.location FROM listing.unit u JOIN picked p ON p.id = u.id
      ),
      moved AS (
        UPDATE listing.unit u
           SET status = 'LISTED'::public.unit_status, order_line_id = NULL
          FROM before b
         WHERE u.id = b.id
        RETURNING u.id, b.status AS from_status, u.status AS to_status,
                  b.location AS from_location, u.location AS to_location
      )
      INSERT INTO listing.stock_movement
        (unit_id, from_status, to_status, from_location, to_location,
         reason, actor_id, ref_type, ref_id, occurred_at)
      SELECT m.id, m.from_status, m.to_status, m.from_location, m.to_location,
             'The vendor refused this line, so the machine went back on sale.',
             NULL, 'ORDER_LINE', ${orderLineId}::uuid, ${now}
        FROM moved m`;
    return Number(moved);
  }

  /**
   * The parent order, read back from its consignments rather than inferred.
   *
   * Inferring it from this one PO's answer would be wrong the moment an order
   * has two: the second vendor's acknowledgement has to see the first vendor's
   * rejection. So the roll-up counts sub-orders and nothing else.
   *
   * An order still awaiting payment is left alone: moving it to VENDOR_ACCEPTED
   * would assert that money arrived, which is a different fact from a vendor
   * agreeing to supply.
   */
  private async rollUpOrder(orderId: string, now: Date): Promise<string> {
    const [counts] = await this.prisma.$queryRaw<
      Array<{ total: bigint; accepted: bigint; rejected: bigint; order_status: string }>
    >`
      SELECT count(*)::bigint AS total,
             count(*) FILTER (WHERE so.status = 'VENDOR_ACCEPTED')::bigint AS accepted,
             count(*) FILTER (WHERE so.status = 'VENDOR_REJECTED')::bigint AS rejected,
             (SELECT o.status::text FROM ordering."order" o WHERE o.id = ${orderId}::uuid) AS order_status
        FROM ordering.sub_order so
       WHERE so.order_id = ${orderId}::uuid`;

    const total = Number(counts?.total ?? 0);
    const accepted = Number(counts?.accepted ?? 0);
    const rejected = Number(counts?.rejected ?? 0);
    const current = counts?.order_status ?? 'CONFIRMED';

    if (total === 0) return current;

    const next =
      rejected === total
        ? 'CANCELLED'
        : accepted === total
          ? 'VENDOR_ACCEPTED'
          : accepted + rejected === 0
            ? current
            : 'PARTIALLY_CONFIRMED';

    if (next === current) return current;

    await this.prisma.$executeRaw`
      UPDATE ordering."order" SET status = ${next}::public.order_status
       WHERE id = ${orderId}::uuid`;
    await this.prisma.$executeRaw`
      INSERT INTO ordering.order_event
        (order_id, event_type, from_status, to_status, note, occurred_at, actor_id)
      VALUES (${orderId}::uuid, 'ORDER_STATUS', ${current}, ${next},
              ${orderStatusNote(next)}, ${now}, NULL)`;
    return next;
  }

  /** The row that puts a refusal in front of a person. */
  private async raiseTask(
    input: {
      poId: string;
      orderId: string;
      poNumber: string;
      rejectedLines: readonly RejectedLine[];
      now: Date;
    },
    fullyRejected: boolean,
    releasedUnits: number,
  ): Promise<string> {
    const id = randomUUID();
    const count = input.rejectedLines.length;
    await this.prisma.$executeRaw`
      INSERT INTO ordering.ops_task
        (id, kind, severity, order_id, purchase_order_id, subject, detail, assigned_role,
         status, created_at)
      VALUES (
        ${id}::uuid,
        ${fullyRejected ? 'PO_REJECTED' : 'PO_PARTIAL_REJECT'},
        'BLOCKER',
        ${input.orderId}::uuid,
        ${input.poId}::uuid,
        ${`${input.poNumber}: the vendor refused ${count} ${count === 1 ? 'machine' : 'machines'}. Re-source or cancel ${count === 1 ? 'it' : 'them'}.`},
        ${JSON.stringify({
          poNumber: input.poNumber,
          releasedUnits,
          rejected: input.rejectedLines.map((l) => ({
            lineId: l.lineId,
            skuId: l.skuId,
            grade: l.grade,
            reason: l.reason,
          })),
        })}::jsonb,
        'OPS_MANAGER',
        'OPEN',
        ${input.now})`;
    return id;
  }

  /**
   * Take the refused value back out of the accrual, in both places it was put.
   *
   * s.194Q charges at credit or payment, whichever is earlier, and credit was
   * the moment the PO was raised — so the accrual was right when it was made and
   * is reduced rather than deleted. `chk_tds_sign` enforces the sign: a REVERSAL
   * carries a negative gross, which is what makes `v_vendor_fy_purchases` add up
   * to what we actually bought.
   *
   * The ledger batch is this table's first writer. Both legs are posted together
   * because `trg_ledger_batch_balances` asserts the batch foots at COMMIT — and
   * a reversal that only reduced the liability would leave the purchase standing
   * against goods nobody is supplying.
   */
  private async reverseAccrual(input: {
    poId: string;
    vendorOrgId: string;
    poNumber: string;
    tdsRatePct: number;
    rejectedLines: readonly RejectedLine[];
    now: Date;
    actorUserId: string;
  }): Promise<void> {
    const refused = input.rejectedLines.reduce((sum, l) => sum + Number(l.agreedNetPayout), 0);
    if (refused <= 0) return;

    const tds = Number(((refused * input.tdsRatePct) / 100).toFixed(2));

    await this.prisma.$executeRaw`
      INSERT INTO procurement.tds_ledger
        (vendor_org_id, financial_year, purchase_order_id, entry_type,
         gross_amount, tds_rate_pct, tds_amount, reason, actor_id, occurred_at)
      VALUES (${input.vendorOrgId}::uuid, ${financialYearOf(input.now.toISOString())},
              ${input.poId}::uuid, 'REVERSAL', ${(-refused).toFixed(2)}::numeric,
              ${input.tdsRatePct}, ${(-tds).toFixed(2)}::numeric,
              ${`${input.poNumber}: ${input.rejectedLines.length} line(s) refused by the vendor`},
              ${input.actorUserId}::uuid, ${input.now})`;

    const batchId = randomUUID();
    const entryDate = input.now.toISOString().slice(0, 10);
    const narration = `${input.poNumber}: vendor refused ${input.rejectedLines.length} line(s)`;
    await this.prisma.$executeRaw`
      INSERT INTO payment.ledger_entry
        (entry_date, account_code, org_id, debit, credit, ref_type, ref_id, narration, batch_id)
      VALUES
        (${entryDate}::date, ${ACCOUNTS.vendorPayable}, ${input.vendorOrgId}::uuid,
         ${refused.toFixed(2)}::numeric, 0, 'PURCHASE_ORDER', ${input.poId}::uuid,
         ${narration}, ${batchId}::uuid),
        (${entryDate}::date, ${ACCOUNTS.purchases}, ${input.vendorOrgId}::uuid,
         0, ${refused.toFixed(2)}::numeric, 'PURCHASE_ORDER', ${input.poId}::uuid,
         ${narration}, ${batchId}::uuid)`;
  }
}

const orderStatusNote = (status: string): string => {
  if (status === 'CANCELLED') {
    return 'Every supply point turned this order down. The machines are back on sale and nothing is owed.';
  }
  if (status === 'VENDOR_ACCEPTED') {
    return 'Every supply point has accepted. The machines are being packed.';
  }
  return 'One supply point could not supply everything on this order. We are sourcing the rest.';
};
