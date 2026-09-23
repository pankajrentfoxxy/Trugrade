import { Injectable } from '@nestjs/common';
import { LEGAL_DISCLOSURE } from '@trugrade/config';
import {
  Money,
  resolveTaxSplit,
  stateTaxLabel,
  supplyPointLabel,
  type Grade,
} from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/domain-errors';
import { ListingService } from '../../listing';
import { CatalogLookup } from './catalog-lookup';
import { dispatchLabels, UNKNOWN_DISPATCH_LABEL } from './dispatch-label';

/**
 * One order, read back by the buyer who placed it — PHASE_06 Task 6 and the
 * first half of Task 7.
 *
 * Checkout's `OrderConfirmationView` only exists for the instant the transaction
 * commits; it is a function return value, not a resource. A buyer who closes the
 * tab, or who is emailed "your order needs approval", has nowhere to go. This is
 * that resource.
 *
 * **The distinction PHASE_06 Task 6 exists to protect.** There are three
 * documents and confusing them is how a vendor's identity reaches a buyer:
 *
 * | Document | Issued by | Who may see it |
 * |---|---|---|
 * | The buyer's own PO reference | The buyer's procurement system | Buyer |
 * | Our order confirmation / proforma | Us, to the buyer | Buyer |
 * | Our purchase order to the vendor | Us, to the vendor | **Vendor and admin only** |
 *
 * `procurement.purchase_order` is therefore not read by this file at all — not
 * counted, not summarised, not referenced by number. The absence is the feature.
 * The buyer's own reference is `order.buyer_po_number`, which is theirs.
 *
 * **The approval arm is the half that is easy to get wrong.** An order at
 * `AWAITING_APPROVAL` has stock **held and not committed**: the exact machines
 * are off sale to everyone else, and no purchase order exists. The view
 * therefore never calls those machines the buyer's, and carries the four facts
 * an approval needs to be honest about — what is held, who was asked, until
 * when, and what happens if nobody answers.
 *
 * A `PENDING` approval whose `expires_at` has passed is reported as `EXPIRED`.
 * The release job is what actually puts the machines back, and it runs on a
 * schedule, so a screen reading the raw status would tell a buyer their order is
 * still with their manager an hour after the deadline we set. The deadline is
 * ours and it has passed; that is the true statement.
 *
 * Nothing below joins across a schema, and every field is an allow-list.
 */

/* ==========================================================================
 * The buyer-facing shapes. All allow-lists.
 * ======================================================================== */

/** One allocated machine, by serial. Never a listing id, never a vendor. */
export interface OrderedMachineView {
  serialNumber: string;
  /** "Dell Latitude 5320". Null when the SKU has since been withdrawn. */
  title: string | null;
  specSummary: string | null;
  grade: Grade;
  unitPrice: string;
}

/** The machines leaving one warehouse. They travel together and arrive together. */
export interface DispatchGroupView {
  /** `Supply Point F · Noida`. A dispatch point, never a seller. */
  label: string;
  machines: OrderedMachineView[];
}

/**
 * One line of the order as the dispatch point answered it.
 *
 * **Built from `ordering` alone.** When a supply point answers our purchase
 * order, `OrderPropagationService` writes the shortfall to
 * `order_line.cancelled_qty` and the answer's moment to `sub_order.accepted_at`
 * / `rejected_at`. Those columns are ours, so this view reads them and never
 * reads the purchase order itself — which keeps the rule at the top of this
 * file true while still telling the buyer what they can expect.
 *
 * `qtyAvailable` is null until the dispatch point has answered. An unanswered
 * line is neither "0" nor "all"; the screen says it has not been confirmed.
 */
export interface SupplyLineView {
  /** `Supply Point F · Noida`. A dispatch point, never a seller. */
  label: string;
  title: string | null;
  specSummary: string | null;
  grade: Grade;
  qtyOrdered: number;
  qtyAvailable: number | null;
  /** ISO 8601, when the dispatch point answered. Null until it has. */
  answeredAt: string | null;
}

/**
 * One line of the sales order: what was ordered, what the dispatch point
 * confirmed, and what the confirmed quantity comes to.
 *
 * Amounts are for the CONFIRMED quantity — the sales order is what we will
 * invoice, and we do not invoice machines nobody can supply. `qtyConfirmed`
 * and the three amounts are null until the dispatch point has answered.
 */
export interface SalesOrderLineView {
  label: string;
  title: string | null;
  specSummary: string | null;
  grade: Grade;
  qtyOrdered: number;
  qtyConfirmed: number | null;
  unitPrice: string;
  gstRatePct: number;
  /** `qtyConfirmed × unitPrice`, before GST. */
  lineNet: string | null;
  lineGst: string | null;
  lineTotal: string | null;
}

export interface SalesOrderTotalsView {
  subtotal: string;
  freight: string;
  tax: OrderTaxView;
  grandTotal: string;
}

/**
 * The sales order — the booking as the dispatch points confirmed it.
 *
 * `WAITING` until every dispatch point on the order has answered: a sales
 * order that totals two confirmed consignments and silently omits a third
 * nobody has answered yet is a figure the buyer would be asked to pay against
 * and then have to pay again. `READY` carries totals for the confirmed
 * quantities; `CANCELLED` is an order every dispatch point refused.
 */
export interface SalesOrderView {
  orderNumber: string;
  state: 'WAITING' | 'READY' | 'CANCELLED';
  dispatchPoints: number;
  dispatchPointsAnswered: number;
  /** When the last dispatch point answered. Null while any is outstanding. */
  confirmedAt: string | null;
  lines: SalesOrderLineView[];
  /** Null unless `READY`. Never a total of a partly answered order. */
  totals: SalesOrderTotalsView | null;
  payment: {
    mode: string;
    status: string;
    /**
     * True when the sales order is ready and money is still owed on it.
     * Credit-terms orders are never payable here: they are invoiced and paid on
     * the agreed terms, not at a button.
     */
    payable: boolean;
  };
}

export interface OrderPartyView {
  gstin: string;
  legalName: string;
  tradeName: string | null;
}

export interface OrderAddressView {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  landmark: string | null;
  gateInstructions: string | null;
  /** Always null — `identity.org_address` has no receiving-hours column. */
  receivingHours: null;
}

export interface OrderTaxView {
  interState: boolean;
  igst: string;
  cgst: string;
  sgst: string;
  stateTaxLabel: 'SGST' | 'UTGST';
  ratePct: number;
  ourStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyState: string;
  basis: string;
}

/**
 * The approval, when one was needed.
 *
 * `PENDING` past `expiresAt` is reported as `EXPIRED`; see the class comment.
 * `comment` is the approver's own words on a rejection and is absent otherwise —
 * an invented "Reason: not specified" reads as a recorded fact.
 */
export interface OrderApprovalView {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverName: string;
  requestedByName: string;
  requestedAt: string;
  decidedAt: string | null;
  /** ISO 8601. The deadline WE imposed on ourselves, not a scarcity device. */
  expiresAt: string;
  comment: string | null;
  orderValue: string;
}

export interface OrderRecordView {
  orderNumber: string;
  status: string;
  paymentMode: string;
  paymentStatus: string;
  placedAt: string;
  /** The buyer's OWN reference, printed on our invoice. Null when none was given. */
  buyerPoNumber: string | null;
  costCentre: string | null;
  subtotal: string;
  freight: string;
  gstTotal: string;
  grandTotal: string;
  tax: OrderTaxView;
  billedTo: OrderPartyView;
  billingAddress: OrderAddressView;
  deliveryAddress: OrderAddressView;
  unitsAllocated: number;
  dispatchGroups: DispatchGroupView[];
  /** What each dispatch point said it can supply, line by line. */
  supply: SupplyLineView[];
  /**
   * The approval, when the policy fired. **`order.stock_hold_expires_at` is
   * deliberately not exposed.** On a confirmed order it still holds the spent
   * twenty-minute checkout hold — an instant in the past — and a screen handed
   * that would draw a deadline that has already gone by on an order whose
   * machines are allocated and are not going anywhere. The only hold a buyer
   * needs a deadline for is the approval one, and it is `approval.expiresAt`.
   */
  approval: OrderApprovalView | null;
}

/* ========================================================================== */

/** Where we are registered. Half of the s.10(1)(a) comparison, always. */
const OUR_STATE_CODE = LEGAL_DISCLOSURE.registeredOffice.stateCode;

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  payment_mode: string;
  payment_status: string;
  buyer_po_number: string | null;
  cost_centre: string | null;
  subtotal: string;
  gst_total: string;
  freight_total: string;
  grand_total: string;
  placed_at: Date;
  billing_gst_profile_id: string;
  billing_address_id: string;
  shipping_address_id: string;
}

interface AllocatedRow {
  unit_id: string;
  serial_number: string;
  sku_id: string;
  grade: string;
  unit_price: string;
  gst_rate: string;
}

/** One `order_line` with its consignment's answer. `ordering` only. */
interface OrderLineRow {
  sub_order_id: string;
  sub_status: string;
  listing_id: string;
  sku_id: string;
  grade: string;
  qty: number;
  cancelled_qty: number;
  unit_price: string;
  gst_rate: string;
  accepted_at: Date | null;
  rejected_at: Date | null;
}

@Injectable()
export class OrderReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly catalog: CatalogLookup,
    private readonly listings: ListingService,
  ) {}

  /**
   * One order by its human number, scoped to the reader's organisation.
   *
   * An order belonging to another organisation is `NotFoundError`, not
   * `ForbiddenError`: "you may not see order TT-26-00004" confirms that
   * TT-26-00004 exists, and order numbers are sequential, so a 403 turns the
   * route into an order-volume oracle for anyone with an account.
   */
  async byNumber(orderNumber: string): Promise<OrderRecordView> {
    const orgId = this.buyerOrgId();

    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status, payment_mode::text AS payment_mode,
             payment_status::text AS payment_status, buyer_po_number, cost_centre,
             subtotal::text AS subtotal, gst_total::text AS gst_total,
             freight_total::text AS freight_total, grand_total::text AS grand_total,
             placed_at, billing_gst_profile_id, billing_address_id, shipping_address_id
        FROM ordering."order"
       WHERE order_number = ${orderNumber} AND buyer_org_id = ${orgId}::uuid`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });

    const allocated = await this.allocated(order.id);
    const [billedTo, addresses, approval, supply] = await Promise.all([
      this.party(order.billing_gst_profile_id),
      this.addresses([order.billing_address_id, order.shipping_address_id]),
      this.approval(order.id),
      this.supply(order.id),
    ]);

    const billingAddress = addresses.get(order.billing_address_id);
    const deliveryAddress = addresses.get(order.shipping_address_id);
    if (!billedTo || !billingAddress || !deliveryAddress) {
      throw new NotFoundError('order', { reason: 'order_references_a_removed_record' });
    }

    // The heads are not stored on the order — only the total is — so they are
    // resolved again from the two facts that decided them at confirmation: our
    // state and the DELIVERY state. Same inputs, same function, same answer.
    const split = resolveTaxSplit({
      supplierState: OUR_STATE_CODE,
      placeOfSupply: deliveryAddress.stateCode,
      taxableAmount: Money.parse(order.subtotal).add(Money.parse(order.freight_total)),
      ratePct: Number(allocated[0]?.gst_rate ?? 18),
      basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
    });

    return {
      orderNumber: order.order_number,
      status: order.status,
      paymentMode: order.payment_mode,
      paymentStatus: order.payment_status,
      placedAt: order.placed_at.toISOString(),
      // An empty string is what a form posts when nobody typed anything. It is
      // not a reference, and drawing it as one puts a blank line on an invoice.
      buyerPoNumber: order.buyer_po_number?.trim() || null,
      costCentre: order.cost_centre?.trim() || null,
      subtotal: order.subtotal,
      freight: order.freight_total,
      gstTotal: order.gst_total,
      grandTotal: order.grand_total,
      tax: {
        interState: split.interState,
        igst: split.igst.toString(),
        cgst: split.cgst.toString(),
        sgst: split.sgst.toString(),
        stateTaxLabel: stateTaxLabel(deliveryAddress.stateCode),
        ratePct: Number(allocated[0]?.gst_rate ?? 18),
        ourStateCode: OUR_STATE_CODE,
        placeOfSupplyStateCode: deliveryAddress.stateCode,
        placeOfSupplyState: deliveryAddress.state,
        basis: split.basis,
      },
      billedTo,
      billingAddress,
      deliveryAddress,
      unitsAllocated: allocated.length,
      dispatchGroups: await this.groups(allocated),
      supply,
      approval,
    };
  }

  /**
   * The sales order: the booking as the dispatch points confirmed it.
   *
   * Same scoping and the same 404-not-403 rule as `byNumber`. Everything here
   * is `ordering`'s own: the consignment's `accepted_at` / `rejected_at` say
   * whether a dispatch point has answered, `cancelled_qty` says how short it
   * was, and the line's own price and GST rate say what the rest comes to.
   */
  async salesOrder(orderNumber: string): Promise<SalesOrderView> {
    const orgId = this.buyerOrgId();
    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status, payment_mode::text AS payment_mode,
             payment_status::text AS payment_status, buyer_po_number, cost_centre,
             subtotal::text AS subtotal, gst_total::text AS gst_total,
             freight_total::text AS freight_total, grand_total::text AS grand_total,
             placed_at, billing_gst_profile_id, billing_address_id, shipping_address_id
        FROM ordering."order"
       WHERE order_number = ${orderNumber} AND buyer_org_id = ${orgId}::uuid`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });

    const [rows, addresses] = await Promise.all([
      this.lineRows(order.id),
      this.addresses([order.shipping_address_id]),
    ]);
    const deliveryAddress = addresses.get(order.shipping_address_id);
    if (!deliveryAddress) {
      throw new NotFoundError('order', { reason: 'order_references_a_removed_record' });
    }
    const { availability, descriptions } = await this.lineContext(rows);

    // One answer per consignment, not per line: a dispatch point answers the
    // whole of what it was asked for at once.
    const consignments = new Map<string, { answeredAt: Date | null; refused: boolean }>();
    for (const row of rows) {
      consignments.set(row.sub_order_id, {
        answeredAt: row.accepted_at ?? row.rejected_at,
        refused: row.sub_status === 'VENDOR_REJECTED',
      });
    }
    const answers = [...consignments.values()];
    const answered = answers.filter((c) => c.answeredAt !== null);
    const everyoneAnswered = answers.length > 0 && answered.length === answers.length;
    const everyoneRefused = everyoneAnswered && answers.every((c) => c.refused);
    const state: SalesOrderView['state'] = !everyoneAnswered
      ? 'WAITING'
      : everyoneRefused || order.status === 'CANCELLED'
        ? 'CANCELLED'
        : 'READY';
    const confirmedAt = everyoneAnswered
      ? new Date(Math.max(...answered.map((c) => c.answeredAt!.getTime()))).toISOString()
      : null;

    const lines: SalesOrderLineView[] = rows.map((row) => {
      const stock = availability.get(row.listing_id);
      const description = descriptions.get(row.sku_id) ?? null;
      const isAnswered = (row.accepted_at ?? row.rejected_at) !== null;
      const qtyConfirmed = isAnswered ? row.qty - row.cancelled_qty : null;
      const unitPrice = Money.parse(row.unit_price);
      const net = qtyConfirmed === null ? null : unitPrice.times(qtyConfirmed);
      const gst = net === null ? null : Money.percentOf(net, Number(row.gst_rate));
      return {
        label:
          stock?.supplyPointCode && stock.city
            ? supplyPointLabel(stock.supplyPointCode, stock.city)
            : UNKNOWN_DISPATCH_LABEL,
        title: description?.title ?? null,
        specSummary: description?.specSummary ?? null,
        grade: row.grade as Grade,
        qtyOrdered: row.qty,
        qtyConfirmed,
        unitPrice: row.unit_price,
        gstRatePct: Number(row.gst_rate),
        lineNet: net?.toString() ?? null,
        lineGst: gst?.toString() ?? null,
        lineTotal: net && gst ? net.add(gst).toString() : null,
      };
    });

    let totals: SalesOrderTotalsView | null = null;
    if (state === 'READY') {
      const subtotal = Money.sum(lines.map((l) => Money.parse(l.lineNet ?? '0')));
      const freight = Money.parse(order.freight_total);
      const ratePct = Number(rows[0]?.gst_rate ?? 18);
      // The same two facts and the same function that decided the heads at
      // checkout: our state and the delivery state. Freight is taxed with the
      // goods, as it was on the booking.
      const split = resolveTaxSplit({
        supplierState: OUR_STATE_CODE,
        placeOfSupply: deliveryAddress.stateCode,
        taxableAmount: subtotal.add(freight),
        ratePct,
        basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
      });
      const gstTotal = split.igst.add(split.cgst).add(split.sgst);
      totals = {
        subtotal: subtotal.toString(),
        freight: freight.toString(),
        tax: {
          interState: split.interState,
          igst: split.igst.toString(),
          cgst: split.cgst.toString(),
          sgst: split.sgst.toString(),
          stateTaxLabel: stateTaxLabel(deliveryAddress.stateCode),
          ratePct,
          ourStateCode: OUR_STATE_CODE,
          placeOfSupplyStateCode: deliveryAddress.stateCode,
          placeOfSupplyState: deliveryAddress.state,
          basis: split.basis,
        },
        grandTotal: subtotal.add(freight).add(gstTotal).toString(),
      };
    }

    const owed = ['PENDING', 'FAILED', 'PARTIALLY_PAID'].includes(order.payment_status);
    return {
      orderNumber: order.order_number,
      state,
      dispatchPoints: answers.length,
      dispatchPointsAnswered: answered.length,
      confirmedAt,
      lines,
      totals,
      payment: {
        mode: order.payment_mode,
        status: order.payment_status,
        payable: state === 'READY' && order.payment_mode !== 'CREDIT' && owed,
      },
    };
  }

  /* ----------------------------------------------------------------------
   * The parts
   * ------------------------------------------------------------------- */

  /** Every line on the order with its consignment's answer. Inside `ordering` only. */
  private async lineRows(orderId: string): Promise<OrderLineRow[]> {
    return this.prisma.$queryRaw<OrderLineRow[]>`
      SELECT so.id AS sub_order_id, so.status::text AS sub_status,
             ol.listing_id, ol.sku_id, ol.grade::text AS grade, ol.qty, ol.cancelled_qty,
             ol.unit_price::text AS unit_price, ol.gst_rate::text AS gst_rate,
             so.accepted_at, so.rejected_at
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
       ORDER BY so.sub_order_number, ol.id`;
  }

  /**
   * The anonymised dispatch label per listing and the catalog words per SKU.
   *
   * The label comes through `listing`'s own view of the listing — the same
   * seam checkout uses — so no vendor id crosses into here.
   */
  private async lineContext(rows: readonly OrderLineRow[]): Promise<{
    availability: Map<string, { supplyPointCode: string | null; city: string | null }>;
    descriptions: Map<string, { title: string; specSummary: string } | null>;
  }> {
    if (rows.length === 0) return { availability: new Map(), descriptions: new Map() };
    const [availability, descriptions] = await Promise.all([
      this.listings.availabilityByListing([...new Set(rows.map((r) => r.listing_id))]),
      Promise.all(
        [...new Set(rows.map((r) => r.sku_id))].map(
          async (id) => [id, await this.catalog.describe(id)] as const,
        ),
      ).then((pairs) => new Map(pairs)),
    ]);
    return { availability, descriptions };
  }

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Orders belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }

  /** The allocated machines. Inside `ordering` only — no cross-schema JOIN. */
  private async allocated(orderId: string): Promise<AllocatedRow[]> {
    return this.prisma.$queryRaw<AllocatedRow[]>`
      SELECT olu.unit_id, olu.serial_number, ol.sku_id, ol.grade::text AS grade,
             ol.unit_price::text AS unit_price, ol.gst_rate::text AS gst_rate
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid
       ORDER BY olu.serial_number`;
  }

  /**
   * The machines, grouped by the warehouse they leave from.
   *
   * Grouped by the LABEL rather than by sub-order: a sub-order is a vendor, and
   * grouping a buyer-facing list by one is how "two dispatch points" quietly
   * becomes "two suppliers" the first time somebody adds a count beside it.
   * Sorted by label so the order on screen does not shuffle between reads.
   */
  private async groups(rows: readonly AllocatedRow[]): Promise<DispatchGroupView[]> {
    if (rows.length === 0) return [];
    const labels = await dispatchLabels(
      this.prisma,
      rows.map((r) => r.unit_id),
    );
    const descriptions = new Map(
      await Promise.all(
        [...new Set(rows.map((r) => r.sku_id))].map(
          async (id) => [id, await this.catalog.describe(id)] as const,
        ),
      ),
    );

    const groups = new Map<string, DispatchGroupView>();
    for (const row of rows) {
      const label = labels.get(row.unit_id) ?? UNKNOWN_DISPATCH_LABEL;
      const description = descriptions.get(row.sku_id) ?? null;
      const group = groups.get(label) ?? { label, machines: [] };
      group.machines.push({
        serialNumber: row.serial_number,
        title: description?.title ?? null,
        specSummary: description?.specSummary ?? null,
        grade: row.grade as Grade,
        unitPrice: row.unit_price,
      });
      groups.set(label, group);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * What each dispatch point said it can supply, line by line.
   *
   * `cancelled_qty` is written by the propagation of the supply point's answer;
   * `accepted_at` / `rejected_at` on the consignment are the moment it answered.
   * Until one of those is set the line is unanswered and `qtyAvailable` stays
   * null. The label is resolved through `listing`'s own anonymised view of the
   * listing, the same seam checkout uses, so no vendor id crosses into here.
   */
  private async supply(orderId: string): Promise<SupplyLineView[]> {
    const rows = await this.lineRows(orderId);
    if (rows.length === 0) return [];
    const { availability, descriptions } = await this.lineContext(rows);

    return rows.map((row) => {
      const stock = availability.get(row.listing_id);
      const description = descriptions.get(row.sku_id) ?? null;
      const answeredAt = row.accepted_at ?? row.rejected_at;
      return {
        label:
          stock?.supplyPointCode && stock.city
            ? supplyPointLabel(stock.supplyPointCode, stock.city)
            : UNKNOWN_DISPATCH_LABEL,
        title: description?.title ?? null,
        specSummary: description?.specSummary ?? null,
        grade: row.grade as Grade,
        qtyOrdered: row.qty,
        qtyAvailable: answeredAt ? row.qty - row.cancelled_qty : null,
        answeredAt: answeredAt ? answeredAt.toISOString() : null,
      };
    });
  }

  /** Who the invoice will name. The buyer's own entity, from their GSTIN. */
  private async party(gstProfileId: string): Promise<OrderPartyView | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ gstin: string; legal_name_as_per_gst: string; trade_name: string | null }>
    >`
      SELECT gstin, legal_name_as_per_gst, trade_name
        FROM kyc.gst_profile WHERE id = ${gstProfileId}::uuid`;
    return row
      ? { gstin: row.gstin, legalName: row.legal_name_as_per_gst, tradeName: row.trade_name }
      : null;
  }

  private async addresses(ids: readonly string[]): Promise<Map<string, OrderAddressView>> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        label: string | null;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        state_code: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
        landmark: string | null;
        delivery_instructions: string | null;
      }>
    >`
      SELECT id, label, line1, line2, city, state, state_code, pincode,
             contact_name, contact_mobile, landmark, delivery_instructions
        FROM identity.org_address
       WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          label: r.label,
          line1: r.line1,
          line2: r.line2,
          city: r.city,
          state: r.state,
          stateCode: r.state_code,
          pincode: r.pincode,
          contactName: r.contact_name,
          contactMobile: r.contact_mobile,
          landmark: r.landmark,
          gateInstructions: r.delivery_instructions,
          receivingHours: null,
        },
      ]),
    );
  }

  /**
   * The approval, if the policy fired. Two queries, because the approver's name
   * lives in `identity` and this one lives in `ordering`.
   */
  private async approval(orderId: string): Promise<OrderApprovalView | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        status: string;
        order_value: string;
        comment: string | null;
        requested_at: Date;
        decided_at: Date | null;
        expires_at: Date;
        approver_user_id: string;
        requested_by: string;
      }>
    >`
      SELECT status, order_value::text AS order_value, comment, requested_at, decided_at,
             expires_at, approver_user_id, requested_by
        FROM ordering.order_approval
       WHERE order_id = ${orderId}::uuid
       ORDER BY requested_at DESC
       LIMIT 1`;
    if (!row) return null;

    const names = await this.names([row.approver_user_id, row.requested_by]);
    const expired =
      row.status === 'PENDING' && row.expires_at.getTime() <= this.clock.now().getTime();

    return {
      status: expired ? 'EXPIRED' : (row.status as OrderApprovalView['status']),
      // Not "your approver": the person was named on the request and the buyer
      // needs to know which manager to go and ask.
      approverName: names.get(row.approver_user_id) ?? 'the approver named on this order',
      requestedByName: names.get(row.requested_by) ?? 'the person who placed it',
      requestedAt: row.requested_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
      expiresAt: row.expires_at.toISOString(),
      comment: row.comment?.trim() || null,
      orderValue: row.order_value,
    };
  }

  private async names(userIds: readonly string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; full_name: string }>>`
      SELECT id, full_name FROM identity.user_account
       WHERE id = ANY(${[...new Set(userIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.full_name]));
  }
}
