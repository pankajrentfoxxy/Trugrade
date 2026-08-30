import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Money,
  computeTds,
  financialYearOf,
  resolveTaxSplit,
  type TaxSplit,
} from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { PrismaService } from '../../../shared/db/prisma.service';
import { RequestContextService } from '../../../shared/db/org-scope';
import { EventBus } from '../../../shared/events';
import {
  InsufficientStockError,
  PreconditionFailedError,
} from '../../../shared/errors/domain-errors';
import { LockService } from '../../../shared/redis/redis.service';
import { HoldService } from './hold.service';

/**
 * THE order-confirmation transaction — `02_ARCHITECTURE.md` §4.1, `PHASE_06`
 * Task 3. One `BEGIN…COMMIT`, sixteen numbered steps, and the reason this
 * codebase has one database.
 *
 * Read these five rules before changing a line of it.
 *
 * **1. Locks are taken in ascending `listing_id`, always.** Not for tidiness: a
 * multi-supply-point cart that locks in cart order deadlocks under concurrency —
 * intermittently, in production, at volume, and only once there is enough
 * traffic for two carts to overlap. `LockService.withLocks` sorts, so a caller
 * cannot get it wrong, and the row locks in `reserve()` are taken in the same
 * order for the same reason. `ORD-014` proves the reverse order deadlocks.
 *
 * **2. The Redis lock is an optimisation. The database is the guarantee.** What
 * actually makes overselling impossible is `chk_qty_balance` —
 * `qty_available + qty_reserved + qty_awaiting_qc + qty_qc_failed <= qty_total`
 * — with `chk_qty_nonneg` beside it. The decrement in step 5 is written as
 * arithmetic on the stored value rather than as a number computed above,
 * precisely so Postgres re-evaluates it against the row the winner of a race
 * committed; the loser then subtracts into the negative and the CHECK refuses
 * the write. `ORD-018` force-expires the lock mid-transaction and proves it
 * still holds. If correctness depended on Redis being up, it would not be
 * correctness.
 *
 * **3. `order_line_unit.unit_id` and `purchase_order_line.unit_id` are both
 * UNIQUE.** A physical laptop is on exactly one customer order line and exactly
 * one purchase order line, ever. Together they make a double-sell a `23505`
 * rather than a discovery made by a buyer who received nothing.
 *
 * **4. If the PO cannot be raised, the order does not confirm.** No agreed
 * payout, a suspended vendor, units that disagree about their GST valuation —
 * every one of those fails the checkout, and the whole transaction unwinds with
 * it. Better a failed checkout than an order we cannot source.
 *
 * **5. Nothing in here is buyer-reachable.** Vendor org ids, ask prices and
 * pickup addresses all pass through this file because raising a purchase order
 * needs them. Not one of them appears in a return type: `confirm()` returns
 * identifiers, serials and money, and the buyer-facing projection is assembled
 * in `checkout.service.ts` from an explicit allow-list.
 */

/* ==========================================================================
 * What goes in
 * ======================================================================== */

/** One cart line, already validated and re-priced by `CheckoutService`. */
export interface OrderLineRequest {
  listingId: string;
  qty: number;
  skuId: string;
  grade: string;
  /** Our selling price per machine. Never the vendor's ask. */
  unitPrice: Money;
  gstRatePct: number;
  /** `Supply Point A · Gurugram`. What an out-of-stock refusal has to name. */
  supplyPointLabel: string;
}

export interface OrderTransactionInput {
  cartId: string;
  buyerOrgId: string;
  buyerUserId: string;
  billingGstProfileId: string;
  billingAddressId: string;
  shippingAddressId: string;
  buyerPoNumber: string | null;
  costCentre: string | null;
  paymentMode: 'PREPAID' | 'PARTIAL_ADVANCE' | 'CREDIT';
  /** Where we are registered. Half of the s.10(1)(a) comparison. */
  ourStateCode: string;
  /** Where the movement terminates. The OTHER half, and never the billing state. */
  deliveryStateCode: string;
  lines: readonly OrderLineRequest[];
  /** Freight for the whole consignment leaving one supply point, by vendor org id. */
  freightByVendor: ReadonlyMap<string, Money>;
  /**
   * Set when a `buyer_approval_policy` threshold fired. The order is created and
   * stock is held, and **no purchase order is raised** — PHASE_06 Task 2 is
   * explicit that nothing is committed to a vendor until a human signs it off.
   */
  approval: { approverUserId: string; policyId: string | null; expiresAt: Date } | null;
  /** How long the hold lasts. 20 minutes normally, 24 hours under approval. */
  holdExpiresAt: Date;
  /**
   * Test seam for `ORD-020`. Called at each of the seven points after the
   * decrement; a throw from it must leave nothing behind.
   */
  failAt?: (step: PostDecrementStep) => void;
}

/** The seven points after step 5 at which `ORD-020` injects a failure. */
export type PostDecrementStep =
  | 'order'
  | 'sub_order'
  | 'order_line'
  | 'order_line_unit'
  | 'stock_movement'
  | 'purchase_order'
  | 'vendor_payable';

export interface AllocatedSerial {
  unitId: string;
  serialNumber: string;
  listingId: string;
}

export interface OrderTransactionResult {
  orderId: string;
  orderNumber: string;
  status: 'CONFIRMED' | 'PAYMENT_PENDING' | 'AWAITING_APPROVAL';
  subtotal: Money;
  freightTotal: Money;
  gstTotal: Money;
  grandTotal: Money;
  igst: Money;
  cgst: Money;
  sgst: Money;
  interState: boolean;
  serials: AllocatedSerial[];
  holdExpiresAt: Date;
  /** Internal only. `PRC-030` is the test that says a buyer never sees these. */
  purchaseOrderIds: string[];
}

/**
 * What finishing an approved order produced. Internal: `purchaseOrderIds` is
 * ours to a supply point and never reaches a buyer-facing payload.
 */
export interface CommitApprovedResult {
  status: 'CONFIRMED' | 'PAYMENT_PENDING';
  orderNumber: string;
  purchaseOrderIds: string[];
  units: number;
}

/* ==========================================================================
 * Internal shapes
 * ======================================================================== */

interface AllocatedUnit {
  unitId: string;
  serialNumber: string;
  listingId: string;
  vendorOrgId: string;
  skuId: string;
  grade: string;
  vendorAskPrice: Money | null;
  valuationMethod: string;
  qcReportId: string | null;
}

interface PricedLine {
  request: OrderLineRequest;
  vendorOrgId: string;
  units: AllocatedUnit[];
  /** `unitPrice x qty`. What the buyer sees on the line, before tax. */
  goods: Money;
  /** Rule 32(5) shrinks this for MARGIN stock. Freight is taxed separately. */
  taxable: Money;
  split: TaxSplit;
}

const TDS_CONFIG_KEYS = [
  'tax.tds_applicable',
  'tax.tds_vendor_threshold_inr',
  'tax.tds_rate_pct',
  'tax.tds_rate_no_pan_pct',
] as const;

@Injectable()
export class OrderTransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly locks: LockService,
    private readonly events: EventBus,
    private readonly holds: HoldService,
  ) {}

  /**
   * Steps 1–16, in one transaction.
   *
   * Step 1 — cart, buyer org status, credit headroom, approval policy — is
   * evaluated by `CheckoutService` before this is called and its verdict arrives
   * in `input`. It is stated there rather than here because it is the half a
   * buyer can act on, so the messages belong beside the screen that shows them,
   * and because none of it takes a lock. Everything from step 2 is here, where
   * the transaction is.
   */
  async confirm(input: OrderTransactionInput): Promise<OrderTransactionResult> {
    // 2. Locks, ascending listing_id. `withLocks` sorts its keys, so the order
    //    is a property of the lock service and not of every caller.
    const keys = input.lines.map((l) => `lock:listing:${l.listingId}`);
    return this.locks.withLocks(keys, () =>
      this.prisma.runInTransaction(() => this.body(input), { timeoutMs: 30_000 }),
    );
  }

  private async body(input: OrderTransactionInput): Promise<OrderTransactionResult> {
    const now = this.clock.now();
    const actorId = this.ctx.principal?.userId ?? input.buyerUserId;

    // The twenty-minute hold, folded back in before anything else happens.
    //
    // The held machines return to `LISTED` here so that steps 3–5 and 9 below
    // are the SAME code whether the buyer came through the checkout screen or
    // an API client posted a cart straight to `confirm`. One implementation of
    // the sixteen steps, one set of concurrency properties, one set of tests.
    // Nothing can take the machines in between: the Redis lock for every listing
    // in this order is already held, and this is inside the transaction, so a
    // failure anywhere below restores the hold with everything else.
    await this.holds.consume(input.cartId);

    // 3, 4, 5 and 9. Reserve stock and pick the serials, one listing at a time,
    // in ascending id. The two orderings agreeing is what stops the row locks
    // and the Redis locks from crossing.
    const ordered = [...input.lines].sort((a, b) => (a.listingId < b.listingId ? -1 : 1));
    const allocations = new Map<string, AllocatedUnit[]>();
    for (const line of ordered) {
      allocations.set(line.listingId, await this.reserve(line));
    }

    const priced = this.price(input, allocations);
    const byVendor = groupBy(priced, (l) => l.vendorOrgId);

    const subtotal = Money.sum(priced.map((l) => l.goods));
    const freightTotal = Money.sum([...byVendor.keys()].map((v) => freightOf(input, v)));
    const freightSplit = this.freightTax(input, freightTotal);
    const igst = Money.sum([...priced.map((l) => l.split.igst), freightSplit.igst]);
    const cgst = Money.sum([...priced.map((l) => l.split.cgst), freightSplit.cgst]);
    const sgst = Money.sum([...priced.map((l) => l.split.sgst), freightSplit.sgst]);
    const gstTotal = igst.add(cgst).add(sgst);
    const grandTotal = subtotal.add(freightTotal).add(gstTotal);

    const status = input.approval ? 'AWAITING_APPROVAL' : statusFor(input.paymentMode);
    const lineStatus = input.approval ? 'CREATED' : status;

    // 6. The order.
    input.failAt?.('order');
    const orderId = randomUUID();
    const orderNumber = await this.nextOrderNumber();
    await this.prisma.$executeRaw`
      INSERT INTO ordering."order"
        (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
         billing_address_id, shipping_address_id, buyer_po_number, cost_centre,
         subtotal, gst_total, freight_total, grand_total,
         payment_mode, payment_status, status, placed_at, stock_hold_expires_at)
      VALUES (${orderId}::uuid, ${orderNumber}, ${input.buyerOrgId}::uuid,
              ${input.buyerUserId}::uuid, ${input.billingGstProfileId}::uuid,
              ${input.billingAddressId}::uuid, ${input.shippingAddressId}::uuid,
              ${input.buyerPoNumber}, ${input.costCentre},
              ${subtotal.toString()}::numeric, ${gstTotal.toString()}::numeric,
              ${freightTotal.toString()}::numeric, ${grandTotal.toString()}::numeric,
              ${input.paymentMode}::public.payment_mode, 'PENDING'::public.payment_status,
              ${status}::public.order_status, ${now}, ${input.holdExpiresAt})`;

    const serials: AllocatedSerial[] = [];
    const purchaseOrderIds: string[] = [];
    let vendorIndex = 0;

    for (const [vendorOrgId, lines] of byVendor) {
      vendorIndex += 1;
      const vendorGoods = Money.sum(lines.map((l) => l.goods));
      const vendorGst = Money.sum(lines.map((l) => l.split.total));
      const vendorFreight = freightOf(input, vendorOrgId);

      // 7. sub_order — INTERNAL grouping. There is one seller, one order and one
      //    invoice; this row exists so a dispatch point can be tracked and a
      //    vendor SLA measured, and the word never reaches a buyer.
      input.failAt?.('sub_order');
      const subOrderId = randomUUID();
      await this.prisma.$executeRaw`
        INSERT INTO ordering.sub_order
          (id, order_id, sub_order_number, vendor_org_id, subtotal, gst_total, freight, status)
        VALUES (${subOrderId}::uuid, ${orderId}::uuid,
                ${`${orderNumber}-${vendorIndex}`}, ${vendorOrgId}::uuid,
                ${vendorGoods.toString()}::numeric, ${vendorGst.toString()}::numeric,
                ${vendorFreight.toString()}::numeric,
                ${lineStatus}::public.order_status)`;

      for (const line of lines) {
        // 8. order_line.
        input.failAt?.('order_line');
        const lineId = randomUUID();
        await this.prisma.$executeRaw`
          INSERT INTO ordering.order_line
            (id, sub_order_id, listing_id, sku_id, grade, qty, unit_price,
             gst_rate, gst_amount, line_total, status)
          VALUES (${lineId}::uuid, ${subOrderId}::uuid, ${line.request.listingId}::uuid,
                  ${line.request.skuId}::uuid, ${line.request.grade}::public.grade_type,
                  ${line.units.length}, ${line.request.unitPrice.toString()}::numeric,
                  ${line.request.gstRatePct}, ${line.split.total.toString()}::numeric,
                  ${line.goods.add(line.split.total).toString()}::numeric,
                  ${lineStatus}::public.order_status)`;

        // 10. order_line_unit. `unit_id` is UNIQUE — this is the customer half of
        //     "a laptop is sold once", and a second attempt is a 23505.
        input.failAt?.('order_line_unit');
        for (const unit of line.units) {
          await this.prisma.$executeRaw`
            INSERT INTO ordering.order_line_unit
              (order_line_id, unit_id, serial_number, qc_report_id, status)
            VALUES (${lineId}::uuid, ${unit.unitId}::uuid, ${unit.serialNumber},
                    ${unit.qcReportId}::uuid, 'RESERVED'::public.unit_status)`;
          serials.push({
            unitId: unit.unitId,
            serialNumber: unit.serialNumber,
            listingId: unit.listingId,
          });
        }

        // 11 and 12. The unit's status and its movement row, in ONE statement.
        //
        // Split into an UPDATE and a later INSERT they would have a window in
        // which a machine has moved and the trail says otherwise, and the
        // dispute is always about the one unit with no trail. This mirrors
        // `listing`'s own `StockMovementService.transition` statement for
        // statement; it is restated rather than called because that service is
        // `internal/` to another module, and this row is written inside the
        // order's transaction or not at all.
        input.failAt?.('stock_movement');
        await this.prisma.$executeRaw`
          WITH before AS (
            SELECT u.id, u.status, u.location
              FROM listing.unit u
             WHERE u.id = ANY(${line.units.map((u) => u.unitId)}::uuid[])
             ORDER BY u.id
               FOR UPDATE
          ),
          moved AS (
            UPDATE listing.unit u
               SET status = 'RESERVED'::public.unit_status,
                   order_line_id = ${lineId}::uuid
              FROM before b
             WHERE u.id = b.id
            RETURNING u.id, b.status AS from_status, u.status AS to_status,
                      b.location AS from_location, u.location AS to_location
          )
          INSERT INTO listing.stock_movement
            (unit_id, from_status, to_status, from_location, to_location,
             reason, actor_id, ref_type, ref_id, occurred_at)
          SELECT m.id, m.from_status, m.to_status, m.from_location, m.to_location,
                 ${`Reserved for order ${orderNumber}`}, ${actorId}::uuid,
                 'ORDER', ${orderId}::uuid, ${now}
            FROM moved m`;
      }

      // 13 and 14. The purchase order, and what we owe against it.
      //
      // Skipped entirely while an approval is outstanding: PHASE_06 Task 2 says
      // stock is held but *nothing is committed*, and a PO sitting in a vendor
      // portal against an order a manager has not signed is a commitment.
      if (!input.approval) {
        purchaseOrderIds.push(
          await this.raisePurchaseOrder({
            orderId,
            vendorOrgId,
            units: lines.flatMap((l) => l.units),
            now,
            failAt: input.failAt,
          }),
        );
      }
    }

    // 15. The event log the buyer's tracking page renders. Written for a human.
    await this.writeEvent(orderId, {
      type: input.approval ? 'order.approval_requested' : 'order.placed',
      to: status,
      note: input.approval
        ? `Sent for approval. ${serials.length} ${machines(serials.length)} are held for you while it is signed off.`
        : `Order placed. ${serials.length} ${machines(serials.length)} allocated to you by serial number.`,
      occurredAt: now,
      actorId,
    });

    if (input.approval) {
      await this.prisma.$executeRaw`
        INSERT INTO ordering.order_approval
          (order_id, requested_by, approver_user_id, status, order_value, policy_id,
           requested_at, expires_at)
        VALUES (${orderId}::uuid, ${input.buyerUserId}::uuid,
                ${input.approval.approverUserId}::uuid, 'PENDING',
                ${grandTotal.toString()}::numeric,
                ${input.approval.policyId}::uuid, ${now}, ${input.approval.expiresAt})`;
    }

    // 16. The outbox. `EventBus.publish` only ever writes a row; the dispatcher
    //     drains it after commit, so no subscriber can act on an order that
    //     rolled back — and the subscribers that matter raise a PO and accrue a
    //     payable.
    if (!input.approval) {
      await this.events.publish('order.confirmed', {
        orderId,
        orderNumber,
        buyerOrgId: input.buyerOrgId,
        totalValue: grandTotal.toString(),
        unitIds: serials.map((s) => s.unitId),
      });
    }

    await this.prisma.$executeRaw`
      UPDATE ordering.cart SET status = 'CONVERTED', updated_at = ${now}
       WHERE id = ${input.cartId}::uuid`;

    return {
      orderId,
      orderNumber,
      status,
      subtotal,
      freightTotal,
      gstTotal,
      grandTotal,
      igst,
      cgst,
      sgst,
      interState: !igst.isZero(),
      serials,
      holdExpiresAt: input.holdExpiresAt,
      purchaseOrderIds,
    };
  }

  /* ------------------------------------------------------------------------
   * Steps 3, 4, 5 and 9 — the part that must be right under concurrency
   * --------------------------------------------------------------------- */

  private async reserve(line: OrderLineRequest): Promise<AllocatedUnit[]> {
    // 3. Re-read under a row lock. A second checkout for the same listing blocks
    //    here and re-reads the committed value when the first one lands, which
    //    is what turns a race into a queue.
    const [row] = await this.prisma.$queryRaw<Array<{ qty_available: number; status: string }>>`
      SELECT qty_available, status::text AS status
        FROM listing.listing
       WHERE id = ${line.listingId}::uuid
         FOR UPDATE`;

    // 4. Assert, and fail cleanly — with a number and the supply point it refers
    //    to, because "out of stock" on a ten-supply-point cart tells a buyer
    //    nothing about which line to change.
    if (!row || (row.status !== 'ACTIVE' && row.status !== 'PARTIALLY_ACTIVE')) {
      throw new InsufficientStockError(line.qty, 0, line.supplyPointLabel);
    }
    if (row.qty_available < line.qty) {
      throw new InsufficientStockError(line.qty, row.qty_available, line.supplyPointLabel);
    }

    // 5. The decrement, written as arithmetic on the stored value rather than as
    //    a number computed above. Postgres re-evaluates it against whatever the
    //    winner of a race committed, so the loser subtracts into the negative
    //    and `chk_qty_nonneg` refuses the row. That CHECK — not the Redis lock —
    //    is what makes overselling impossible (ORD-018).
    await this.prisma.$executeRaw`
      UPDATE listing.listing
         SET qty_available = qty_available - ${line.qty},
             qty_reserved  = qty_reserved  + ${line.qty},
             updated_at    = ${this.clock.now()}
       WHERE id = ${line.listingId}::uuid`;

    // 9a. Candidates from `v_sellable_unit` and nowhere else. The view combines
    //     the stored flag with the live expiry and seal predicates, so a machine
    //     whose QC lapsed at midnight stops being sellable at midnight. Ordering
    //     does not restate that predicate; there is one definition of sellable
    //     and it lives in the listing schema (PHASE_05 Task 3).
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.v_sellable_unit
       WHERE listing_id = ${line.listingId}::uuid
       ORDER BY id`;

    // 9b. `FOR UPDATE SKIP LOCKED`, so two concurrent orders take DIFFERENT
    //     machines rather than queueing behind each other. The lock cannot be
    //     taken through the view — it has an outer join and Postgres refuses to
    //     lock the nullable side of one — so it is taken on the table, with
    //     LISTED re-checked to close the gap between the two statements.
    const units = await this.prisma.$queryRaw<
      Array<{
        id: string;
        serial_number: string;
        vendor_org_id: string;
        sku_id: string;
        grade: string;
        vendor_ask_price: { toString(): string } | null;
        valuation_method: string;
        qc_report_id: string | null;
      }>
    >`
      SELECT id, serial_number, vendor_org_id, sku_id,
             COALESCE(grade_actual, grade_declared)::text AS grade,
             vendor_ask_price, valuation_method, qc_report_id
        FROM listing.unit
       WHERE id = ANY(${candidates.map((c) => c.id)}::uuid[])
         AND status = 'LISTED'::public.unit_status
       ORDER BY id
         FOR UPDATE SKIP LOCKED
       LIMIT ${line.qty}`;

    if (units.length < line.qty) {
      // The counter and the units disagreed, or a concurrent order took them
      // between the two statements. Either way this order cannot be filled, and
      // the transaction is about to take the decrement back with it.
      throw new InsufficientStockError(line.qty, units.length, line.supplyPointLabel);
    }

    return units.map((u) => ({
      unitId: u.id,
      serialNumber: u.serial_number,
      listingId: line.listingId,
      vendorOrgId: u.vendor_org_id,
      skuId: u.sku_id,
      grade: u.grade,
      vendorAskPrice: u.vendor_ask_price ? Money.parse(u.vendor_ask_price.toString()) : null,
      valuationMethod: u.valuation_method,
      qcReportId: u.qc_report_id,
    }));
  }

  /* ------------------------------------------------------------------------
   * Steps 13 and 14 — the vendor half of the merchant-of-record model
   * --------------------------------------------------------------------- */

  private async raisePurchaseOrder(input: {
    orderId: string;
    vendorOrgId: string;
    units: readonly AllocatedUnit[];
    now: Date;
    failAt?: (step: PostDecrementStep) => void;
  }): Promise<string> {
    const { units, vendorOrgId } = input;

    // Every refusal below fails the checkout. The message names the supply point
    // rather than the vendor, because the buyer reads it — and it is the wording
    // PHASE_06 Task 3 gives, so a buyer is told what to do rather than what
    // broke.
    const unpriced = units.find((u) => u.vendorAskPrice === null || !u.vendorAskPrice.isPositive());
    if (unpriced) {
      throw new PreconditionFailedError(SUPPLY_POINT_UNAVAILABLE, {
        reason: 'no_agreed_payout',
        unitId: unpriced.unitId,
      });
    }

    // A purchase order carries one `valuation_method`, because Rule 32(5) margin
    // treatment is decided for the purchase as a whole and `uq_po_order_vendor`
    // allows exactly one PO per vendor per order. Two answers on one PO would
    // misstate the GST on whichever half lost.
    const methods = new Set(units.map((u) => u.valuationMethod));
    if (methods.size > 1) {
      throw new PreconditionFailedError(SUPPLY_POINT_UNAVAILABLE, {
        reason: 'mixed_valuation_method',
        vendorOrgId,
      });
    }
    const valuationMethod = methods.has('MARGIN') ? 'MARGIN' : 'REGULAR';

    const [vendor] = await this.prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM identity.organization
       WHERE id = ${vendorOrgId}::uuid`;
    if (!vendor || vendor.status !== 'VERIFIED') {
      throw new PreconditionFailedError(SUPPLY_POINT_UNAVAILABLE, {
        reason: 'vendor_not_verified',
        vendorOrgId,
      });
    }

    const totalNet = Money.sum(units.map((u) => u.vendorAskPrice ?? Money.ZERO));
    const tds = await this.computeVendorTds(vendorOrgId, totalNet, input.now);

    input.failAt?.('purchase_order');
    const poId = randomUUID();
    const poNumber = await this.nextPoNumber();
    await this.prisma.$executeRaw`
      INSERT INTO procurement.purchase_order
        (id, po_number, vendor_org_id, order_id, status, total_net,
         tds_rate_pct, tds_amount, valuation_method, terms_days, created_at, updated_at)
      -- status carries no ::po_status cast, deliberately. The Phase 6 migration
      -- created that enum under whatever search_path was current, so it landed
      -- in the identity schema rather than public: an unqualified cast fails at
      -- runtime, and a qualified one would hard-code an accident. Postgres
      -- infers the parameter type from the target column, which stays right if
      -- the type is ever moved to where it belongs.
      VALUES (${poId}::uuid, ${poNumber}, ${vendorOrgId}::uuid, ${input.orderId}::uuid,
              'RAISED', ${totalNet.toString()}::numeric,
              ${tds.ratePct}, ${tds.amount.toString()}::numeric,
              ${valuationMethod}, 15, ${input.now}, ${input.now})`;

    for (const unit of units) {
      // `unit_id` is UNIQUE here too. The pair of unique constraints is what
      // makes double-selling structurally impossible rather than merely
      // unlikely — one on the customer's side, one on ours.
      await this.prisma.$executeRaw`
        INSERT INTO procurement.purchase_order_line
          (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, qc_report_id, created_at)
        VALUES (${poId}::uuid, ${unit.unitId}::uuid, ${unit.skuId}::uuid,
                ${(unit.vendorAskPrice ?? Money.ZERO).toString()}::numeric,
                ${unit.grade}::public.grade_type, ${unit.qcReportId}::uuid, ${input.now})`;

      // What we agreed to pay is frozen onto the machine at this moment.
      // `trg_lock_purchase_price` makes it immutable from here, so a later move
      // in the retail price cannot retrospectively change what a vendor is owed.
      await this.prisma.$executeRaw`
        UPDATE listing.unit
           SET purchase_price = ${(unit.vendorAskPrice ?? Money.ZERO).toString()}::numeric
         WHERE id = ${unit.unitId}::uuid AND purchase_price IS NULL`;
    }

    // 14. The payable and the TDS ledger entry, in the same breath as the PO.
    //     s.194Q charges at credit OR payment, whichever is earlier — credit is
    //     now — so the ledger accrues here and `v_vendor_fy_purchases` stays the
    //     single answer to "how much have we bought from them this year".
    input.failAt?.('vendor_payable');
    await this.prisma.$executeRaw`
      INSERT INTO procurement.vendor_payable
        (vendor_org_id, purchase_order_id, gross, tds, net_payable, status, created_at)
      VALUES (${vendorOrgId}::uuid, ${poId}::uuid, ${totalNet.toString()}::numeric,
              ${tds.amount.toString()}::numeric,
              ${totalNet.sub(tds.amount).toString()}::numeric, 'ACCRUED', ${input.now})`;

    await this.prisma.$executeRaw`
      INSERT INTO procurement.tds_ledger
        (vendor_org_id, financial_year, purchase_order_id, entry_type,
         gross_amount, tds_rate_pct, tds_amount, reason, actor_id, occurred_at)
      VALUES (${vendorOrgId}::uuid, ${financialYearOf(input.now.toISOString())},
              ${poId}::uuid, 'ACCRUAL', ${totalNet.toString()}::numeric,
              ${tds.ratePct}, ${tds.amount.toString()}::numeric,
              ${`Purchase order ${poNumber} raised`},
              ${this.ctx.principal?.userId ?? null}::uuid, ${input.now})`;

    await this.events.publish('po.raised', {
      purchaseOrderId: poId,
      poNumber,
      vendorOrgId,
      orderId: input.orderId,
      unitIds: units.map((u) => u.unitId),
      totalNet: totalNet.toString(),
      valuationMethod,
    });

    return poId;
  }

  private async computeVendorTds(
    vendorOrgId: string,
    purchaseValue: Money,
    now: Date,
  ): Promise<{ ratePct: number; amount: Money }> {
    // `v_current_config` and not `platform_config`: config is effective-dated,
    // and reading the table directly is how a future-dated row goes live early.
    const cfg = new Map(
      (
        await this.prisma.$queryRaw<Array<{ key: string; value_json: unknown }>>`
          SELECT key, value_json FROM platform.v_current_config
           WHERE key = ANY(${[...TDS_CONFIG_KEYS]}::text[])`
      ).map((r) => [r.key, r.value_json]),
    );

    const financialYear = financialYearOf(now.toISOString());
    const [ytd] = await this.prisma.$queryRaw<Array<{ gross_to_date: string | null }>>`
      SELECT gross_to_date::text AS gross_to_date
        FROM procurement.v_vendor_fy_purchases
       WHERE vendor_org_id = ${vendorOrgId}::uuid AND financial_year = ${financialYear}`;

    const [pan] = await this.prisma.$queryRaw<Array<{ verified: boolean }>>`
      SELECT verified FROM kyc.pan_record WHERE org_id = ${vendorOrgId}::uuid`;

    const result = computeTds({
      policy: {
        applicable: cfg.get('tax.tds_applicable') === true,
        thresholdAmount: Money.rupees(Number(cfg.get('tax.tds_vendor_threshold_inr') ?? 0)),
        ratePct: Number(cfg.get('tax.tds_rate_pct') ?? 0),
        noPanRatePct: Number(cfg.get('tax.tds_rate_no_pan_pct') ?? 0),
      },
      cumulativeBefore: ytd?.gross_to_date ? Money.parse(ytd.gross_to_date) : Money.ZERO,
      purchaseValue,
      hasValidPan: pan?.verified === true,
    });
    return { ratePct: result.ratePct, amount: result.amount };
  }

  /* ------------------------------------------------------------------------
   * Money
   * --------------------------------------------------------------------- */

  /**
   * The tax split, per line, from OUR state against the DELIVERY state.
   *
   * s.10(1)(a): the place of supply is where the movement terminates. Resolving
   * it from the billing address instead is the trap PHASE_06 Task 1 names — a
   * Delhi-registered buyer taking delivery in Chennai is an inter-state supply,
   * and billing-address logic would put CGST+SGST on an invoice that owes IGST.
   * `resolveTaxSplit` is the one implementation of that comparison and its spec
   * proves all three rows of the `01_DECISIONS` §2.4 table.
   */
  private price(
    input: OrderTransactionInput,
    allocations: ReadonlyMap<string, AllocatedUnit[]>,
  ): PricedLine[] {
    return input.lines.map((request) => {
      const units = allocations.get(request.listingId) ?? [];
      const goods = request.unitPrice.times(units.length);

      // Rule 32(5): a MARGIN unit is taxed on (sale − purchase) per serial,
      // never pooled, and a negative margin contributes zero rather than
      // offsetting another serial's.
      const taxable = Money.sum(
        units.map((u) =>
          u.valuationMethod === 'MARGIN' && u.vendorAskPrice
            ? Money.max(request.unitPrice.sub(u.vendorAskPrice), Money.ZERO)
            : request.unitPrice,
        ),
      );

      return {
        request,
        vendorOrgId: units[0]?.vendorOrgId ?? '',
        units,
        goods,
        taxable,
        split: resolveTaxSplit({
          supplierState: input.ourStateCode,
          placeOfSupply: input.deliveryStateCode,
          taxableAmount: taxable,
          ratePct: request.gstRatePct,
          basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
        }),
      };
    });
  }

  /** Freight follows the principal supply, so it carries the same rate and head. */
  private freightTax(input: OrderTransactionInput, freight: Money): TaxSplit {
    return resolveTaxSplit({
      supplierState: input.ourStateCode,
      placeOfSupply: input.deliveryStateCode,
      taxableAmount: freight,
      ratePct: input.lines[0]?.gstRatePct ?? 18,
      basis: 's.10(1)(a) IGST Act — freight follows the principal supply',
    });
  }

  /* ------------------------------------------------------------------------
   * Numbers and events
   * --------------------------------------------------------------------- */

  /** `TT-26-00001`. The year is the Indian financial year, not the calendar one. */
  private async nextOrderNumber(): Promise<string> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT nextval('ordering.order_number_seq') AS n`;
    return `TT-${this.fyShort()}-${String(row?.n ?? 1n).padStart(5, '0')}`;
  }

  private async nextPoNumber(): Promise<string> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT nextval('procurement.po_number_seq') AS n`;
    return `PO-${this.fyShort()}-${String(row?.n ?? 1n).padStart(5, '0')}`;
  }

  private fyShort(): string {
    return financialYearOf(this.clock.now().toISOString()).slice(2, 4);
  }

  /* ------------------------------------------------------------------------
   * The half of the transaction an approval defers — T25
   * --------------------------------------------------------------------- */

  /**
   * Finish an order a manager has just signed off.
   *
   * `AWAITING_APPROVAL` is the one status this transaction can leave behind
   * unfinished: steps 6 to 12 ran, so the order, its lines and its serials all
   * exist and the machines are `RESERVED` — but steps 13, 14 and 16 were
   * deliberately skipped, because a purchase order sitting in a vendor's portal
   * against an order nobody has signed is a commitment we have not made. This
   * runs exactly those steps and nothing else.
   *
   * **It calls `raisePurchaseOrder`, it does not restate it.** There is one
   * definition of what raising a PO means — the payout, the TDS accrual, the
   * frozen `purchase_price`, the payable — and a second copy written for the
   * approval path is the copy that would drift on the next tax change.
   *
   * No listing lock is taken and none is needed: nothing here decrements a
   * counter or picks a serial. The machines were picked at placement and have
   * been off sale ever since. What it does check is that they are still ours to
   * commit — a machine scrapped or found seal-broken while a manager was
   * thinking is not sold by an approval arriving afterwards.
   */
  async commitApproved(orderId: string): Promise<CommitApprovedResult> {
    return this.prisma.runInTransaction(() => this.commitBody(orderId), { timeoutMs: 30_000 });
  }

  private async commitBody(orderId: string): Promise<CommitApprovedResult> {
    const now = this.clock.now();
    const actorId = this.ctx.principal?.userId ?? null;

    const [order] = await this.prisma.$queryRaw<
      Array<{
        order_number: string;
        buyer_org_id: string;
        payment_mode: string;
        status: string;
        grand_total: string;
      }>
    >`
      SELECT order_number, buyer_org_id, payment_mode::text AS payment_mode,
             status::text AS status, grand_total::text AS grand_total
        FROM ordering."order"
       WHERE id = ${orderId}::uuid
         FOR UPDATE`;
    if (!order || order.status !== 'AWAITING_APPROVAL') {
      throw new PreconditionFailedError('That order is no longer waiting for approval.', {
        reason: 'order_not_awaiting_approval',
        status: order?.status ?? 'missing',
      });
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ vendor_org_id: string; unit_id: string; serial_number: string; listing_id: string }>
    >`
      SELECT so.vendor_org_id, olu.unit_id, olu.serial_number, ol.listing_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
       ORDER BY olu.unit_id`;

    const units = await this.unitFacts(rows.map((r) => r.unit_id));
    const byVendor = groupBy(rows, (r) => r.vendor_org_id);

    const status = statusFor(order.payment_mode);
    const purchaseOrderIds: string[] = [];

    for (const [vendorOrgId, vendorRows] of byVendor) {
      const allocated = vendorRows.map((r) => {
        const fact = units.get(r.unit_id);
        // The machine moved while the approval sat. Refusing here is the only
        // honest answer: the alternative is selling a scrapped laptop because a
        // manager pressed approve after somebody else pressed scrap.
        if (!fact) {
          throw new PreconditionFailedError(
            'One of the machines held for this order is no longer available, so it cannot be confirmed. Nothing has been charged — place the order again and we will hold different stock.',
            { reason: 'held_unit_no_longer_reserved', unitId: r.unit_id },
          );
        }
        return { ...fact, serialNumber: r.serial_number, listingId: r.listing_id };
      });

      purchaseOrderIds.push(
        await this.raisePurchaseOrder({ orderId, vendorOrgId, units: allocated, now }),
      );
    }

    await this.prisma.$executeRaw`
      UPDATE ordering."order"
         SET status = ${status}::public.order_status
       WHERE id = ${orderId}::uuid`;
    await this.prisma.$executeRaw`
      UPDATE ordering.sub_order
         SET status = ${status}::public.order_status
       WHERE order_id = ${orderId}::uuid`;
    await this.prisma.$executeRaw`
      UPDATE ordering.order_line ol
         SET status = ${status}::public.order_status
        FROM ordering.sub_order so
       WHERE so.id = ol.sub_order_id AND so.order_id = ${orderId}::uuid`;

    await this.writeEvent(orderId, {
      type: 'order.approved',
      from: 'AWAITING_APPROVAL',
      to: status,
      note: `Approved. ${rows.length} ${machines(rows.length)} are now committed to you by serial number.`,
      occurredAt: now,
      actorId,
    });

    // Step 16, held back until now for the same reason the PO was: the
    // subscribers on this event act on an order somebody has agreed to.
    await this.events.publish('order.confirmed', {
      orderId,
      orderNumber: order.order_number,
      buyerOrgId: order.buyer_org_id,
      totalValue: order.grand_total,
      unitIds: rows.map((r) => r.unit_id),
    });

    return { status, orderNumber: order.order_number, purchaseOrderIds, units: rows.length };
  }

  /**
   * Put an order's held machines back on sale.
   *
   * The mirror of `HoldService.release` for the stage after a hold has been
   * consumed: at `AWAITING_APPROVAL` there is no `checkout_hold` row left to
   * release, and what holds the stock is `listing.unit.status = 'RESERVED'`
   * against `order_line_unit`. `AND status = 'RESERVED'` is load bearing here
   * for the reason it is there in `consume` — a machine scrapped underneath the
   * order is not resurrected onto the storefront by a rejection.
   *
   * `listing.qty_available` is not touched: `trg_listing_counters` recomputes it
   * from the units on every status change, and a second hand-written arithmetic
   * correction beside a trigger is how counters end up disagreeing.
   */
  async releaseOrderStock(orderId: string, reason: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ unit_id: string }>>`
      SELECT olu.unit_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
       ORDER BY olu.unit_id`;
    if (rows.length === 0) return 0;

    const unitIds = rows.map((r) => r.unit_id);
    await this.prisma.$executeRaw`
      WITH before AS (
        SELECT u.id, u.status, u.location
          FROM listing.unit u
         WHERE u.id = ANY(${unitIds}::uuid[])
           AND u.status = 'RESERVED'::public.unit_status
         ORDER BY u.id
           FOR UPDATE
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
             ${reason}, ${this.ctx.principal?.userId ?? null}::uuid,
             'ORDER', ${orderId}::uuid, ${this.clock.now()}
        FROM moved m`;

    return unitIds.length;
  }

  /**
   * The facts `raisePurchaseOrder` needs about each machine, read back from
   * `listing.unit` — and only for units still `RESERVED`. One missing from the
   * result is one that moved, and the caller refuses on it.
   */
  private async unitFacts(
    unitIds: readonly string[],
  ): Promise<Map<string, Omit<AllocatedUnit, 'serialNumber' | 'listingId'>>> {
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        vendor_org_id: string;
        sku_id: string;
        grade: string;
        vendor_ask_price: { toString(): string } | null;
        valuation_method: string;
        qc_report_id: string | null;
      }>
    >`
      SELECT id, vendor_org_id, sku_id,
             COALESCE(grade_actual, grade_declared)::text AS grade,
             vendor_ask_price, valuation_method, qc_report_id
        FROM listing.unit
       WHERE id = ANY(${[...unitIds]}::uuid[])
         AND status = 'RESERVED'::public.unit_status
       ORDER BY id
         FOR UPDATE`;
    return new Map(
      rows.map((u) => [
        u.id,
        {
          unitId: u.id,
          vendorOrgId: u.vendor_org_id,
          skuId: u.sku_id,
          grade: u.grade,
          vendorAskPrice: u.vendor_ask_price ? Money.parse(u.vendor_ask_price.toString()) : null,
          valuationMethod: u.valuation_method,
          qcReportId: u.qc_report_id,
        },
      ]),
    );
  }

  /**
   * Every transition writes one of these, and the buyer's tracking page renders
   * them. It is a product surface, not a debug log, which is why `note` is a
   * sentence written for a stranger reading it months later.
   */
  async writeEvent(
    orderId: string,
    e: {
      type: string;
      from?: string | null;
      to: string;
      note: string;
      occurredAt: Date;
      actorId: string | null;
      subOrderId?: string | null;
    },
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO ordering.order_event
        (order_id, sub_order_id, event_type, from_status, to_status, actor_id, note, occurred_at)
      VALUES (${orderId}::uuid, ${e.subOrderId ?? null}::uuid, ${e.type},
              ${e.from ?? null}, ${e.to}, ${e.actorId}::uuid, ${e.note}, ${e.occurredAt})`;
  }
}

/* ==========================================================================
 * Small shared helpers
 * ======================================================================== */

/**
 * PHASE_06 Task 3's own wording for every reason a PO cannot be raised.
 *
 * One sentence for four causes, deliberately: a suspended vendor and an
 * unpriced unit are the same fact to a buyer — this supply point cannot fill
 * the line — and naming the cause would name the source. The engineer-facing
 * reason travels in `detail`, which is logged and never serialised.
 */
const SUPPLY_POINT_UNAVAILABLE =
  'One of the supply points for this item is temporarily unavailable. Remove it and try again.';

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

const freightOf = (input: OrderTransactionInput, vendorOrgId: string): Money =>
  input.freightByVendor.get(vendorOrgId) ?? Money.ZERO;

const machines = (n: number): string => (n === 1 ? 'machine' : 'machines');

/**
 * A prepaid order is not confirmed until it is paid for.
 *
 * `CONFIRMED` on an unpaid prepaid order would tell a vendor to start picking
 * against money we have not received. Credit terms are the case where the order
 * IS confirmed on placement, because the payment is a receivable by agreement.
 */
const statusFor = (mode: string): 'CONFIRMED' | 'PAYMENT_PENDING' =>
  mode === 'CREDIT' ? 'CONFIRMED' : 'PAYMENT_PENDING';
