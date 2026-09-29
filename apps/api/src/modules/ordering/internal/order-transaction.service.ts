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
import { AutomationService } from '../../../shared/automation/automation.service';

/**
 * THE order-confirmation transaction — `02_ARCHITECTURE.md` §4.1, `PHASE_06`
 * Task 3 — under the order-first inspection flow.
 *
 * Read these five rules before changing a line of it.
 *
 * **1. Locks are taken in ascending `listing_id`, always.** A multi-supply-point
 * cart that locks in cart order deadlocks under concurrency. `LockService.withLocks`
 * sorts, so a caller cannot get it wrong, and the row locks in `reserve()` are
 * taken in the same order for the same reason (`ORD-014`).
 *
 * **2. The Redis lock is an optimisation. The database is the guarantee.** What
 * makes overselling impossible is `chk_qty_balance` with `chk_qty_nonneg`
 * beside it. The decrement in step 5 is arithmetic on the stored value, so
 * Postgres re-evaluates it against the row the winner of a race committed; the
 * loser subtracts into the negative and the CHECK refuses the write.
 *
 * **3. Nothing is identified at placement.** A listing is a declared quantity
 * and there are no serials behind it. `order_line_unit` rows are vacant slots
 * — `unit_id`, `serial_number` and `qc_report_id` all null — that the
 * technician fills one by one at the vendor's site after ops assigns them.
 * UNIQUE on `unit_id` then refuses a second purchase of the same laptop.
 *
 * **4. No purchase order is raised at placement.** The vendor is committed to
 * only once ops has verified every machine the technician named; that is
 * `raisePurchaseOrdersForVerified`, and it is the same `raisePurchaseOrder`
 * body — the payout, the TDS accrual, the payable — called later rather than
 * a second copy of it. If a PO cannot be raised then, verification fails and
 * nothing is charged.
 *
 * **5. Nothing in here is buyer-reachable.** Vendor org ids, ask prices and
 * pickup addresses pass through this file. Not one of them appears in a return
 * type; the buyer-facing projection is assembled in `checkout.service.ts` from
 * an explicit allow-list.
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
  /** Freight per consignment, keyed by `laneKey(vendorOrgId, pickupAddressId)`. */
  freightByLane: ReadonlyMap<string, Money>;
  /**
   * Set when a `buyer_approval_policy` threshold fired. The order is created and
   * stock is held; nothing moves until a human signs it off.
   */
  approval: { approverUserId: string; policyId: string | null; expiresAt: Date } | null;
  /** How long the hold lasts. 20 minutes normally, 24 hours under approval. */
  holdExpiresAt: Date;
  /** Test seam for `ORD-020`. A throw from it must leave nothing behind. */
  failAt?: (step: PostDecrementStep) => void;
}

/** The points after step 5 at which `ORD-020` injects a failure. */
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

export type PlacedStatus = 'AWAITING_INSPECTION' | 'AWAITING_APPROVAL';

export interface OrderTransactionResult {
  orderId: string;
  orderNumber: string;
  status: PlacedStatus;
  subtotal: Money;
  freightTotal: Money;
  gstTotal: Money;
  grandTotal: Money;
  igst: Money;
  cgst: Money;
  sgst: Money;
  interState: boolean;
  /** Always empty at placement: serials are named by the technician later. */
  serials: AllocatedSerial[];
  /** How many machines the order is for. */
  units: number;
  holdExpiresAt: Date;
  /** Internal only, and always empty at placement. `PRC-030` says a buyer never sees these. */
  purchaseOrderIds: string[];
}

/** What finishing an approved order produced. */
export interface CommitApprovedResult {
  status: 'AWAITING_INSPECTION';
  orderNumber: string;
  purchaseOrderIds: string[];
  units: number;
}

/** What verifying an order produced: the purchase orders the vendors now see. */
export interface VerifiedRaiseResult {
  purchaseOrderIds: string[];
  units: number;
}

/* ==========================================================================
 * Internal shapes
 * ======================================================================== */

/** One identified machine, as `raisePurchaseOrder` needs it. */
interface AllocatedUnit {
  unitId: string;
  serialNumber: string;
  listingId: string;
  vendorOrgId: string;
  /** `listing.pickup_location_id` — the warehouse this machine leaves from. */
  pickupAddressId: string;
  skuId: string;
  grade: string;
  vendorAskPrice: Money | null;
  valuationMethod: string;
  qcReportId: string | null;
}

/** One cart line's reservation: a quantity against a listing, unidentified. */
interface LineAllocation {
  listingId: string;
  vendorOrgId: string;
  pickupAddressId: string;
  qty: number;
}

interface PricedLine {
  request: OrderLineRequest;
  vendorOrgId: string;
  pickupAddressId: string;
  qty: number;
  /** `unitPrice x qty`. What the buyer sees on the line, before tax. */
  goods: Money;
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
    private readonly automation: AutomationService,
  ) {}

  /**
   * Steps 1–16, in one transaction.
   *
   * Step 1 — cart, buyer org status, credit headroom, approval policy — is
   * evaluated by `CheckoutService` before this is called. Everything from step 2
   * is here, where the transaction is.
   */
  async confirm(input: OrderTransactionInput): Promise<OrderTransactionResult> {
    const keys = input.lines.map((l) => `lock:listing:${l.listingId}`);
    return this.locks.withLocks(keys, () =>
      this.prisma.runInTransaction(() => this.body(input), { timeoutMs: 30_000 }),
    );
  }

  private async body(input: OrderTransactionInput): Promise<OrderTransactionResult> {
    const now = this.clock.now();
    const actorId = this.ctx.principal?.userId ?? input.buyerUserId;

    // The twenty-minute hold, folded back in before anything else happens, so
    // steps 3–5 below are the SAME code whether the buyer came through the
    // checkout screen or posted a cart straight to `confirm`.
    await this.holds.consume(input.cartId);

    // 3, 4 and 5. Reserve the quantity, one listing at a time, in ascending id.
    const ordered = [...input.lines].sort((a, b) => (a.listingId < b.listingId ? -1 : 1));
    const allocations = new Map<string, LineAllocation>();
    for (const line of ordered) {
      allocations.set(line.listingId, await this.reserve(line));
    }

    const priced = this.price(input, allocations);

    // A consignment is a vendor's stock at ONE pickup address. Same key
    // `checkout.service.ts` prices freight on, so the quote and the order
    // cannot split the same cart two different ways.
    const bySupplyPoint = groupBy(priced, (l) => laneKey(l.vendorOrgId, l.pickupAddressId));

    const subtotal = Money.sum(priced.map((l) => l.goods));
    const freightTotal = Money.sum([...bySupplyPoint.keys()].map((k) => freightOf(input, k)));
    const freightSplit = this.freightTax(input, freightTotal);
    const igst = Money.sum([...priced.map((l) => l.split.igst), freightSplit.igst]);
    const cgst = Money.sum([...priced.map((l) => l.split.cgst), freightSplit.cgst]);
    const sgst = Money.sum([...priced.map((l) => l.split.sgst), freightSplit.sgst]);
    const gstTotal = igst.add(cgst).add(sgst);
    const grandTotal = subtotal.add(freightTotal).add(gstTotal);

    const status: PlacedStatus = input.approval ? 'AWAITING_APPROVAL' : 'AWAITING_INSPECTION';
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

    let units = 0;
    let vendorIndex = 0;

    for (const [supplyPointKey, lines] of bySupplyPoint) {
      vendorIndex += 1;
      const { vendorOrgId, pickupAddressId } = splitLaneKey(supplyPointKey);
      const vendorGoods = Money.sum(lines.map((l) => l.goods));
      const vendorGst = Money.sum(lines.map((l) => l.split.total));
      const vendorFreight = freightOf(input, supplyPointKey);

      // 7. sub_order — INTERNAL grouping. There is one seller, one order and one
      //    invoice; this row exists so a dispatch point can be tracked and a
      //    vendor SLA measured, and the word never reaches a buyer.
      input.failAt?.('sub_order');
      const subOrderId = randomUUID();
      await this.prisma.$executeRaw`
        INSERT INTO ordering.sub_order
          (id, order_id, sub_order_number, vendor_org_id, pickup_address_id,
           subtotal, gst_total, freight, status)
        VALUES (${subOrderId}::uuid, ${orderId}::uuid,
                ${`${orderNumber}-${vendorIndex}`}, ${vendorOrgId}::uuid,
                ${pickupAddressId}::uuid,
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
                  ${line.qty}, ${line.request.unitPrice.toString()}::numeric,
                  ${line.request.gstRatePct}, ${line.split.total.toString()}::numeric,
                  ${line.goods.add(line.split.total).toString()}::numeric,
                  ${lineStatus}::public.order_status)`;

        // 10. order_line_unit: one vacant SKU + grade slot per machine. The
        //     technician names the serial when they inspect it at the vendor.
        input.failAt?.('order_line_unit');
        for (let i = 0; i < line.qty; i += 1) {
          await this.prisma.$executeRaw`
            INSERT INTO ordering.order_line_unit
              (order_line_id, unit_id, serial_number, qc_report_id, status)
            VALUES (${lineId}::uuid, NULL, NULL, NULL, 'RESERVED'::public.unit_status)`;
          units += 1;
        }
        input.failAt?.('stock_movement');
      }
    }

    // 15. The event log the buyer's tracking page renders. Written for a human.
    await this.writeEvent(orderId, {
      type: input.approval ? 'order.approval_requested' : 'order.placed',
      to: status,
      note: input.approval
        ? `Sent for approval. ${units} ${machines(units)} are held while it is signed off. A technician inspects and names each machine once it is approved.`
        : `Order placed. ${units} ${machines(units)} held. A technician will inspect each machine at the supply point and record its serial; you pay once every machine is verified.`,
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
      serials: [],
      units,
      holdExpiresAt: input.holdExpiresAt,
      purchaseOrderIds: [],
    };
  }

  /* ------------------------------------------------------------------------
   * Steps 3, 4 and 5 — the part that must be right under concurrency
   * --------------------------------------------------------------------- */

  private async reserve(line: OrderLineRequest): Promise<LineAllocation> {
    // 3. Re-read under a row lock. A second checkout for the same listing blocks
    //    here and re-reads the committed value when the first one lands, which
    //    is what turns a race into a queue.
    const [row] = await this.prisma.$queryRaw<
      Array<{
        qty_available: number;
        status: string;
        vendor_org_id: string;
        pickup_location_id: string;
      }>
    >`
      SELECT qty_available, status::text AS status, vendor_org_id, pickup_location_id
        FROM listing.listing
       WHERE id = ${line.listingId}::uuid
         FOR UPDATE`;

    // 4. Assert, and fail cleanly — with a number and the supply point it refers
    //    to, because "out of stock" on a ten-supply-point cart tells a buyer
    //    nothing about which line to change.
    if (!row || (row.status !== 'ACTIVE' && row.status !== 'PARTIALLY_ACTIVE')) {
      throw new InsufficientStockError(line.qty, 0, line.supplyPointLabel);
    }
    if (Number(row.qty_available) < line.qty) {
      throw new InsufficientStockError(line.qty, Number(row.qty_available), line.supplyPointLabel);
    }

    // 5. The decrement, written as arithmetic on the stored value rather than as
    //    a number computed above. The CHECK — not the Redis lock — is what makes
    //    overselling impossible (ORD-018).
    await this.prisma.$executeRaw`
      UPDATE listing.listing
         SET qty_available = qty_available - ${line.qty},
             qty_reserved  = qty_reserved  + ${line.qty},
             updated_at    = ${this.clock.now()}
       WHERE id = ${line.listingId}::uuid`;

    return {
      listingId: line.listingId,
      vendorOrgId: row.vendor_org_id,
      pickupAddressId: row.pickup_location_id,
      qty: line.qty,
    };
  }

  /**
   * "Supply Point A - Gurugram" — the only name a buyer ever sees for a
   * warehouse. The letter is the consignment's position in THIS order.
   */
  private async supplyPointLabel(pickupAddressId: string, sequence: number): Promise<string> {
    const [row] = await this.prisma.$queryRaw<Array<{ city: string }>>`
      SELECT city FROM identity.org_address WHERE id = ${pickupAddressId}::uuid`;
    const letter = String.fromCharCode(64 + Math.min(Math.max(sequence, 1), 26));
    return row?.city ? `Supply Point ${letter} - ${row.city}` : `Supply Point ${letter}`;
  }

  /* ------------------------------------------------------------------------
   * Steps 13 and 14 — the vendor half of the merchant-of-record model
   * --------------------------------------------------------------------- */

  private async raisePurchaseOrder(input: {
    orderId: string;
    vendorOrgId: string;
    pickupAddressId: string;
    supplyPointLabel: string;
    units: readonly AllocatedUnit[];
    now: Date;
    failAt?: (step: PostDecrementStep) => void;
  }): Promise<string> {
    const { units, vendorOrgId } = input;

    // Every refusal below fails the caller. The message names the supply point
    // rather than the vendor, because the buyer may read it.
    const unpriced = units.find((u) => u.vendorAskPrice === null || !u.vendorAskPrice.isPositive());
    if (unpriced) {
      throw new PreconditionFailedError(SUPPLY_POINT_UNAVAILABLE, {
        reason: 'no_agreed_payout',
        unitId: unpriced.unitId,
      });
    }

    // A purchase order carries one `valuation_method`, because Rule 32(5) margin
    // treatment is decided for the purchase as a whole.
    const methods = new Set(units.map((u) => u.valuationMethod));
    if (methods.size > 1) {
      throw new PreconditionFailedError(SUPPLY_POINT_UNAVAILABLE, {
        reason: 'mixed_valuation_method',
        vendorOrgId,
        pickupAddressId: input.pickupAddressId,
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
        (id, po_number, vendor_org_id, order_id, pickup_address_id, supply_point_label,
         status, total_net,
         tds_rate_pct, tds_amount, valuation_method, terms_days, created_at, updated_at)
      -- status carries no ::po_status cast, deliberately: the enum landed in the
      -- identity schema by accident and Postgres infers the type from the column.
      -- ACKNOWLEDGED from the start, with every line ACCEPTED: the vendor does
      -- not accept a purchase order under the order-first flow. The machines
      -- were named and verified at their site, so the document is a record of
      -- what we are buying, not a question.
      VALUES (${poId}::uuid, ${poNumber}, ${vendorOrgId}::uuid, ${input.orderId}::uuid,
              ${input.pickupAddressId}::uuid, ${input.supplyPointLabel},
              'ACKNOWLEDGED', ${totalNet.toString()}::numeric,
              ${tds.ratePct}, ${tds.amount.toString()}::numeric,
              ${valuationMethod}, 15, ${input.now}, ${input.now})`;
    await this.prisma.$executeRaw`
      UPDATE procurement.purchase_order SET acknowledged_at = ${input.now}
       WHERE id = ${poId}::uuid`;

    for (const unit of units) {
      // The machine is already named: the technician recorded it and ops has
      // verified it. The line carries the serial from the day it is raised.
      await this.prisma.$executeRaw`
        INSERT INTO procurement.purchase_order_line
          (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, qc_report_id, line_status, created_at)
        VALUES (${poId}::uuid, ${unit.unitId}::uuid, ${unit.skuId}::uuid,
                ${(unit.vendorAskPrice ?? Money.ZERO).toString()}::numeric,
                ${unit.grade}::public.grade_type, ${unit.qcReportId}::uuid,
                'ACCEPTED'::identity.po_line_status, ${input.now})`;
      // What we agreed to pay for THIS serial, frozen. `trg_lock_purchase_price`
      // keeps it that way.
      await this.prisma.$executeRaw`
        UPDATE listing.unit
           SET purchase_price = COALESCE(purchase_price, ${(unit.vendorAskPrice ?? Money.ZERO).toString()}::numeric)
         WHERE id = ${unit.unitId}::uuid`;
    }

    // 14. The payable and the TDS ledger entry, in the same breath as the PO.
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
   * s.10(1)(a): the place of supply is where the movement terminates. Declared
   * stock is REGULAR-valued — Rule 32(5) margin treatment needs a per-serial
   * purchase price, and there is none until the machine is named.
   */
  private price(
    input: OrderTransactionInput,
    allocations: ReadonlyMap<string, LineAllocation>,
  ): PricedLine[] {
    return input.lines.map((request) => {
      const allocation = allocations.get(request.listingId);
      const qty = allocation?.qty ?? 0;
      const goods = request.unitPrice.times(qty);
      return {
        request,
        vendorOrgId: allocation?.vendorOrgId ?? '',
        pickupAddressId: allocation?.pickupAddressId ?? '',
        qty,
        goods,
        taxable: goods,
        split: resolveTaxSplit({
          supplierState: input.ourStateCode,
          placeOfSupply: input.deliveryStateCode,
          taxableAmount: goods,
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
   * Under the order-first flow an approval commits nothing to a vendor; it
   * releases the order into the inspection queue. The purchase orders are
   * raised later, when ops verifies the machines the technician named.
   */
  async commitApproved(orderId: string): Promise<CommitApprovedResult> {
    return this.prisma.runInTransaction(() => this.commitBody(orderId), { timeoutMs: 30_000 });
  }

  private async commitBody(orderId: string): Promise<CommitApprovedResult> {
    const now = this.clock.now();
    const actorId = this.ctx.principal?.userId ?? null;

    const [order] = await this.prisma.$queryRaw<
      Array<{ order_number: string; buyer_org_id: string; status: string; grand_total: string }>
    >`
      SELECT order_number, buyer_org_id, status::text AS status, grand_total::text AS grand_total
        FROM ordering."order"
       WHERE id = ${orderId}::uuid
         FOR UPDATE`;
    if (!order || order.status !== 'AWAITING_APPROVAL') {
      throw new PreconditionFailedError('That order is no longer waiting for approval.', {
        reason: 'order_not_awaiting_approval',
        status: order?.status ?? 'missing',
      });
    }

    const [count] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid`;
    const units = count?.n ?? 0;

    const status = 'AWAITING_INSPECTION' as const;
    await this.prisma.$executeRaw`
      UPDATE ordering."order" SET status = ${status}::public.order_status
       WHERE id = ${orderId}::uuid`;
    await this.prisma.$executeRaw`
      UPDATE ordering.sub_order SET status = ${status}::public.order_status
       WHERE order_id = ${orderId}::uuid`;
    await this.prisma.$executeRaw`
      UPDATE ordering.order_line ol SET status = ${status}::public.order_status
        FROM ordering.sub_order so
       WHERE so.id = ol.sub_order_id AND so.order_id = ${orderId}::uuid`;

    await this.writeEvent(orderId, {
      type: 'order.approved',
      from: 'AWAITING_APPROVAL',
      to: status,
      note: `Approved. ${units} ${machines(units)} are held. A technician will inspect each machine at the supply point and record its serial.`,
      occurredAt: now,
      actorId,
    });

    return { status, orderNumber: order.order_number, purchaseOrderIds: [], units };
  }

  /* ------------------------------------------------------------------------
   * Verification — where the vendor is finally committed to
   * --------------------------------------------------------------------- */

  /**
   * Raise one purchase order per consignment for an order whose every machine
   * ops has verified. Runs inside the caller's transaction.
   *
   * The units are the ones the technician created and bound to the order's
   * slots; their facts are read back from `listing.unit`, which is where the
   * vendor's ask for that serial was copied when it was named.
   */
  async raisePurchaseOrdersForVerified(orderId: string): Promise<VerifiedRaiseResult> {
    if (!this.prisma.isInTransaction) {
      throw new Error('raisePurchaseOrdersForVerified() must run inside the verification transaction.');
    }
    const now = this.clock.now();

    const slots = await this.prisma.$queryRaw<
      Array<{ unit_id: string; serial_number: string; listing_id: string; vendor_org_id: string }>
    >`
      SELECT olu.unit_id, olu.serial_number, ol.listing_id, so.vendor_org_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
         AND olu.unit_id IS NOT NULL
         AND olu.verified_at IS NOT NULL
       ORDER BY olu.unit_id`;
    if (slots.length === 0) return { purchaseOrderIds: [], units: 0 };

    const facts = await this.unitFacts(slots.map((s) => s.unit_id));
    const rows = slots.flatMap((s) => {
      const fact = facts.get(s.unit_id);
      if (!fact) {
        throw new PreconditionFailedError(
          'One of the machines on this order is no longer reserved for it, so it cannot be verified. Ask the technician to re-inspect.',
          { reason: 'verified_unit_not_reserved', unitId: s.unit_id },
        );
      }
      return [{ ...fact, serialNumber: s.serial_number, listingId: s.listing_id }];
    });

    const bySupplyPoint = groupBy(rows, (r) => laneKey(r.vendorOrgId, r.pickupAddressId));
    const purchaseOrderIds: string[] = [];
    let supplyPointIndex = 0;

    for (const [supplyPointKey, allocated] of bySupplyPoint) {
      supplyPointIndex += 1;
      const { vendorOrgId, pickupAddressId } = splitLaneKey(supplyPointKey);
      // One PO per consignment. A second verification pass on an order whose
      // PO exists already must not raise a second document.
      const [existing] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM procurement.purchase_order
         WHERE order_id = ${orderId}::uuid AND vendor_org_id = ${vendorOrgId}::uuid
           AND pickup_address_id = ${pickupAddressId}::uuid`;
      if (existing) {
        purchaseOrderIds.push(existing.id);
        continue;
      }
      const poId = await this.raisePurchaseOrder({
        orderId,
        vendorOrgId,
        pickupAddressId,
        supplyPointLabel: await this.supplyPointLabel(pickupAddressId, supplyPointIndex),
        units: allocated,
        now,
      });
      purchaseOrderIds.push(poId);
      await this.prisma.$executeRaw`
        UPDATE ordering.sub_order
           SET purchase_order_id = ${poId}::uuid
         WHERE order_id = ${orderId}::uuid
           AND vendor_org_id = ${vendorOrgId}::uuid
           AND (pickup_address_id IS NULL OR pickup_address_id = ${pickupAddressId}::uuid)`;
    }

    return { purchaseOrderIds, units: rows.length };
  }

  /**
   * Put an order's held quantity back on sale, and un-name its machines.
   *
   * The mirror of `HoldService.release` for the stage after a hold has been
   * consumed. The reservation is a quantity on the listing; any unit the
   * technician already created goes back to the vendor's shelf — off the order
   * and outside `uq_unit_active_serial`, so the same serial can be named again
   * on the next order.
   */
  async releaseOrderStock(orderId: string, reason: string): Promise<number> {
    const lines = await this.prisma.$queryRaw<
      Array<{ id: string; listing_id: string; qty: number; cancelled_qty: number }>
    >`
      SELECT ol.id, ol.listing_id, ol.qty, ol.cancelled_qty
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid`;
    if (lines.length === 0) return 0;

    let released = 0;
    for (const line of lines) {
      const qty = Math.max(Number(line.qty) - Number(line.cancelled_qty), 0);
      if (qty === 0) continue;
      await this.prisma.$executeRaw`
        UPDATE listing.listing
           SET qty_available = qty_available + ${qty},
               qty_reserved  = GREATEST(qty_reserved - ${qty}, 0),
               updated_at    = ${this.clock.now()}
         WHERE id = ${line.listing_id}::uuid`;
      released += qty;
    }

    const units = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.unit
       WHERE order_line_id = ANY(${lines.map((l) => l.id)}::uuid[])
         AND status = 'RESERVED'::public.unit_status
       ORDER BY id`;
    if (units.length > 0) {
      const ids = units.map((u) => u.id);
      await this.prisma.$executeRaw`
        WITH before AS (
          SELECT u.id, u.status, u.location
            FROM listing.unit u
           WHERE u.id = ANY(${ids}::uuid[])
             AND u.status = 'RESERVED'::public.unit_status
           ORDER BY u.id
             FOR UPDATE
        ),
        moved AS (
          UPDATE listing.unit u
             SET status = 'RETURNED_TO_VENDOR'::public.unit_status, order_line_id = NULL
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
      await this.prisma.$executeRaw`
        UPDATE ordering.order_line_unit
           SET unit_id = NULL, serial_number = NULL, qc_report_id = NULL,
               inspected_at = NULL, verified_at = NULL, verified_by = NULL
         WHERE unit_id = ANY(${ids}::uuid[])`;
    }

    return released;
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
        pickup_location_id: string;
      }>
    >`
      SELECT u.id, u.vendor_org_id, u.sku_id,
             COALESCE(u.grade_actual, u.grade_declared)::text AS grade,
             u.vendor_ask_price, u.valuation_method, u.qc_report_id,
             l.pickup_location_id
        FROM listing.unit u
        JOIN listing.listing l ON l.id = u.listing_id
       WHERE u.id = ANY(${[...unitIds]}::uuid[])
         AND u.status = 'RESERVED'::public.unit_status
       ORDER BY u.id
         FOR UPDATE OF u`;
    return new Map(
      rows.map((u) => [
        u.id,
        {
          unitId: u.id,
          vendorOrgId: u.vendor_org_id,
          pickupAddressId: u.pickup_location_id,
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
   * them. It is a product surface, not a debug log.
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

  /** Kept on the class so the automation seam stays wired for R1 when it is re-enabled. */
  protected get automationSeam(): AutomationService {
    return this.automation;
  }
}

/* ==========================================================================
 * Small shared helpers
 * ======================================================================== */

/**
 * PHASE_06 Task 3's own wording for every reason a PO cannot be raised. One
 * sentence for four causes, deliberately: naming the cause would name the
 * source. The engineer-facing reason travels in `detail`.
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

/**
 * The key a consignment is grouped, quoted and purchased on: one vendor's stock
 * at one pickup address.
 */
export const laneKey = (vendorOrgId: string, pickupAddressId: string): string =>
  `${vendorOrgId}|${pickupAddressId}`;

const splitLaneKey = (key: string): { vendorOrgId: string; pickupAddressId: string } => {
  const [vendorOrgId = '', pickupAddressId = ''] = key.split('|');
  return { vendorOrgId, pickupAddressId };
};

const freightOf = (input: OrderTransactionInput, supplyPointKey: string): Money =>
  input.freightByLane.get(supplyPointKey) ?? Money.ZERO;

const machines = (n: number): string => (n === 1 ? 'machine' : 'machines');
