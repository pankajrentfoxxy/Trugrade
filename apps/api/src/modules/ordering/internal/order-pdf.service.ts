import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config';
import { PrismaService } from '../../../shared/db/prisma.service';
import { NotFoundError } from '../../../shared/errors/domain-errors';
import {
  BODY,
  MARGIN,
  MUTED,
  PAGE,
  drawFooters,
  drawLetterhead,
  newSheet,
  type RenderedDocument,
} from '../../../shared/pdf/sheet';

/**
 * The order confirmation, as the customer receives it.
 *
 * **No vendor, anywhere, at any depth.** We are the merchant of record: the
 * customer bought from Trugrade and the supplier's identity is ours to hold.
 * That is what makes the model lawful under Rule 5(3)(a) and it is also the
 * commercial moat, so a consignment is "Supply Point A - Gurugram" and never a
 * name, an address or a GSTIN. The test asserts this against every vendor name
 * in the fixture rather than against a list of fields, because a blacklist fails
 * open the moment somebody adds a column.
 *
 * **The whole charge stack, on one page.** Goods, freight, GST, grand total —
 * all of it, in one place. The CCPA Dark Patterns Guidelines 2023 prohibit
 * revealing charges progressively, and a confirmation that hides freight until
 * the invoice arrives is exactly that.
 */

const COLUMNS = { item: MARGIN, qty: 330, rate: 420, gst: 480, total: 555 };

@Injectable()
export class OrderPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async render(orderNumber: string): Promise<RenderedDocument> {
    const order = await this.load(orderNumber);
    const sheet = await newSheet();
    sheet.doc.setTitle(`Order confirmation ${order.orderNumber}`);
    sheet.doc.setSubject('Order confirmation');

    drawLetterhead(sheet, {
      title: 'Order confirmation',
      documentNumber: order.orderNumber,
      date: order.placedOn,
      copyLabel: 'Customer copy',
      warning: null,
    });

    this.drawIdentity(sheet, order);
    this.drawParties(sheet, order);
    this.drawLines(sheet, order);
    this.drawCharges(sheet, order);
    this.drawConsignments(sheet, order);
    this.drawTerms(sheet, order);

    drawFooters(sheet, `Order confirmation ${order.orderNumber}`);
    const bytes = Buffer.from(await sheet.doc.save({ useObjectStreams: false }));

    return {
      bytes,
      filename: `${BRAND.name}-order-${order.orderNumber}.pdf`,
      documentNumber: order.orderNumber,
    };
  }

  private drawIdentity(sheet: Sheetish, order: OrderDocument): void {
    const right = PAGE[0] / 2 + 10;
    const top = sheet.y;
    sheet.pair('Order number', order.orderNumber, MARGIN);
    sheet.pair('Placed on', order.placedOn, MARGIN);
    sheet.pair('Payment', order.paymentMode, MARGIN);
    const leftBottom = sheet.y;

    sheet.y = top;
    sheet.pair('Your PO reference', order.buyerPoNumber, right);
    sheet.pair('Your cost centre', order.costCentre, right);
    sheet.y = Math.min(leftBottom, sheet.y);
    sheet.gap(6);
    sheet.rule();
  }

  private drawParties(sheet: Sheetish, order: OrderDocument): void {
    const right = PAGE[0] / 2 + 10;
    sheet.gap(8);
    const top = sheet.y;

    sheet.at(MARGIN, sheet.y, 'SELLER', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    // Us. Always us — that is what merchant of record means, and it is the
    // sentence a buyer's finance team needs when they ask who to chase.
    sheet.block(MARGIN, [
      LEGAL_DISCLOSURE.legalName,
      `GSTIN ${LEGAL_DISCLOSURE.gstin}`,
      LEGAL_DISCLOSURE.registeredOffice.line1,
      `${LEGAL_DISCLOSURE.registeredOffice.city} ${LEGAL_DISCLOSURE.registeredOffice.pincode}`,
    ]);
    const sellerBottom = sheet.y;

    sheet.y = top;
    sheet.at(right, sheet.y, 'BILLED TO', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(right, [
      order.buyer.legalName,
      order.buyer.gstin ? `GSTIN ${order.buyer.gstin}` : null,
      order.billing.line1,
      `${order.billing.city} ${order.billing.pincode}`,
    ]);
    sheet.y = Math.min(sellerBottom, sheet.y);

    sheet.gap(8);
    sheet.at(MARGIN, sheet.y, 'DELIVERED TO', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(MARGIN, [
      order.shipping.line1,
      `${order.shipping.city} ${order.shipping.pincode}`,
      `${order.shipping.state} (${order.shipping.stateCode})`,
      `Contact ${order.shipping.contactName} · ${order.shipping.contactMobile}`,
    ]);
    sheet.gap(4);
    sheet.rule();
  }

  private drawLines(sheet: Sheetish, order: OrderDocument): void {
    sheet.gap(10);
    sheet.at(COLUMNS.item, sheet.y, 'MACHINE', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.qty, sheet.y, 'QTY', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.rate, sheet.y, 'UNIT PRICE', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.gst, sheet.y, 'GST', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.total, sheet.y, 'TOTAL', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 6;
    sheet.rule();
    sheet.gap(6);

    for (const line of order.lines) {
      sheet.pageBreakIfBelow(70);
      sheet.at(COLUMNS.item, sheet.y, `${line.description} · Grade ${line.grade}`, { size: BODY });
      sheet.right(COLUMNS.qty, sheet.y, String(line.qty), { size: BODY });
      sheet.right(COLUMNS.rate, sheet.y, line.unitPrice.toString(), { size: BODY });
      sheet.right(COLUMNS.gst, sheet.y, line.gstAmount.toString(), { size: BODY });
      sheet.right(COLUMNS.total, sheet.y, line.lineTotal.toString(), { size: BODY });
      sheet.y -= 14;
    }
    sheet.rule();
  }

  /**
   * Every charge, at once.
   *
   * Freight appears here even when it is zero, because "no delivery charge" is
   * information a buyer acts on and an absent line is one they have to ask about.
   */
  private drawCharges(sheet: Sheetish, order: OrderDocument): void {
    sheet.gap(8);
    sheet.total('Goods', order.subtotal, false, COLUMNS.gst, COLUMNS.total);
    sheet.total('Delivery', order.freight, false, COLUMNS.gst, COLUMNS.total);
    sheet.total('GST', order.gstTotal, false, COLUMNS.gst, COLUMNS.total);
    sheet.total('Total payable', order.grandTotal, true, COLUMNS.gst, COLUMNS.total);
  }

  /**
   * The consignments, by supply point.
   *
   * An order drawing on two warehouses arrives in two deliveries, and a buyer
   * who is told one total and then receives half of it twice rings support. Each
   * is labelled the only way a buyer may see a warehouse: "Supply Point A -
   * Gurugram", a letter and a city, sequenced within this order alone.
   */
  private drawConsignments(sheet: Sheetish, order: OrderDocument): void {
    if (order.consignments.length === 0) return;
    sheet.pageBreakIfBelow(120);
    sheet.gap(10);
    sheet.at(MARGIN, sheet.y, 'DELIVERIES', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;

    for (const consignment of order.consignments) {
      sheet.at(MARGIN, sheet.y, consignment.supplyPointLabel, { size: BODY, font: 'bold' });
      sheet.y -= 11;
      sheet.block(MARGIN + 8, [
        `${consignment.machines} machine${consignment.machines === 1 ? '' : 's'}`,
        consignment.awb ? `Tracking ${consignment.awb}` : 'Tracking number follows on dispatch',
        consignment.etaLabel,
      ]);
      sheet.gap(2);
    }
    sheet.rule();
  }

  private drawTerms(sheet: Sheetish, order: OrderDocument): void {
    sheet.pageBreakIfBelow(90);
    sheet.gap(8);
    sheet.at(MARGIN, sheet.y, 'RETURNS AND WARRANTY', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(MARGIN, [
      // A date, not a duration: "seven days" is arithmetic a buyer has to do,
      // and they will do it from the wrong day.
      order.returnBy
        ? `You may return a machine until ${order.returnBy} — seven days from delivery.`
        : 'You may return a machine for seven days from the day it is delivered.',
      'Every machine carries the warranty stated on its listing, backed by Trugrade.',
      `Questions: ${LEGAL_DISCLOSURE.customerCare.email} · ${LEGAL_DISCLOSURE.customerCare.phone}`,
    ]);
  }

  /**
   * One statement per schema, and an explicit allow-list of what is read.
   *
   * Nothing on this document may come from `procurement` or from any vendor
   * table. The only fact about supply that reaches it is the supply point label,
   * which the purchase order carries precisely so a buyer-facing document can
   * name a consignment without naming a supplier.
   */
  private async load(orderNumber: string): Promise<OrderDocument> {
    const [order] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        order_number: string;
        buyer_org_id: string;
        billing_address_id: string;
        shipping_address_id: string;
        billing_gst_profile_id: string;
        buyer_po_number: string | null;
        cost_centre: string | null;
        subtotal: string;
        gst_total: string;
        freight_total: string;
        grand_total: string;
        payment_mode: string;
        placed_at: Date;
      }>
    >`
      SELECT id, order_number, buyer_org_id, billing_address_id, shipping_address_id,
             billing_gst_profile_id, buyer_po_number, cost_centre,
             subtotal::text AS subtotal, gst_total::text AS gst_total,
             freight_total::text AS freight_total, grand_total::text AS grand_total,
             payment_mode::text AS payment_mode, placed_at
        FROM ordering."order" WHERE order_number = ${orderNumber}`;
    if (!order) throw new NotFoundError('order', { orderNumber });

    const [buyer] = await this.prisma.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization WHERE id = ${order.buyer_org_id}::uuid`;
    const [gst] = await this.prisma.$queryRaw<Array<{ gstin: string }>>`
      SELECT gstin FROM kyc.gst_profile WHERE id = ${order.billing_gst_profile_id}::uuid`;

    const billing = await this.address(order.billing_address_id);
    const shipping = await this.address(order.shipping_address_id);

    const lines = await this.prisma.$queryRaw<
      Array<{
        sku_id: string;
        grade: string;
        qty: number;
        unit_price: string;
        gst_amount: string;
        line_total: string;
      }>
    >`
      SELECT ol.sku_id, ol.grade::text AS grade, ol.qty, ol.unit_price::text AS unit_price,
             ol.gst_amount::text AS gst_amount, ol.line_total::text AS line_total
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${order.id}::uuid
         AND ol.status <> 'CANCELLED'::public.order_status
       ORDER BY ol.id`;
    const skus = await this.skuTitles(lines.map((l) => l.sku_id));

    const consignments = await this.consignmentsOf(order.id);
    const [delivered] = await this.prisma.$queryRaw<Array<{ eligible: Date | null }>>`
      SELECT max(delivered_at) AS eligible FROM ordering.sub_order
       WHERE order_id = ${order.id}::uuid`;

    return {
      orderNumber: order.order_number,
      placedOn: this.day(order.placed_at),
      paymentMode: order.payment_mode === 'CREDIT' ? 'Credit terms' : 'Prepaid',
      buyerPoNumber: order.buyer_po_number,
      costCentre: order.cost_centre,
      buyer: { legalName: buyer?.legal_name ?? 'Customer', gstin: gst?.gstin ?? null },
      billing,
      shipping,
      lines: lines.map((l) => ({
        description: skus.get(l.sku_id) ?? 'Refurbished laptop',
        grade: l.grade,
        qty: l.qty,
        unitPrice: moneyFromDb(l.unit_price) ?? Money.ZERO,
        gstAmount: moneyFromDb(l.gst_amount) ?? Money.ZERO,
        lineTotal: moneyFromDb(l.line_total) ?? Money.ZERO,
      })),
      subtotal: moneyFromDb(order.subtotal) ?? Money.ZERO,
      freight: moneyFromDb(order.freight_total) ?? Money.ZERO,
      gstTotal: moneyFromDb(order.gst_total) ?? Money.ZERO,
      grandTotal: moneyFromDb(order.grand_total) ?? Money.ZERO,
      consignments,
      returnBy: delivered?.eligible
        ? this.day(new Date(delivered.eligible.getTime() + 168 * 3_600_000))
        : null,
    };
  }

  /**
   * One entry per consignment, named by supply point and never by supplier.
   *
   * The label is read from the purchase order, which is where it was sequenced
   * when the order was split. Deriving a new one here would give the same
   * warehouse a different letter on the confirmation and on the tracking page.
   */
  private async consignmentsOf(orderId: string): Promise<OrderDocument['consignments']> {
    const subs = await this.prisma.$queryRaw<
      Array<{ id: string; purchase_order_id: string | null; machines: bigint }>
    >`
      SELECT so.id, so.purchase_order_id,
             coalesce(sum(ol.qty - ol.cancelled_qty), 0)::bigint AS machines
        FROM ordering.sub_order so
        LEFT JOIN ordering.order_line ol ON ol.sub_order_id = so.id
       WHERE so.order_id = ${orderId}::uuid
         AND so.status <> 'CANCELLED'::public.order_status
       GROUP BY so.id, so.purchase_order_id
       ORDER BY so.sub_order_number`;
    if (subs.length === 0) return [];

    const poIds = subs.map((s) => s.purchase_order_id).filter((id): id is string => !!id);
    const labels = poIds.length
      ? await this.prisma.$queryRaw<Array<{ id: string; supply_point_label: string | null }>>`
          SELECT id, supply_point_label FROM procurement.purchase_order
           WHERE id = ANY(${poIds}::uuid[])`
      : [];
    const labelById = new Map(labels.map((l) => [l.id, l.supply_point_label]));

    const shipments = await this.prisma.$queryRaw<
      Array<{ sub_order_id: string | null; awb_number: string | null; eta_to: Date | null }>
    >`
      SELECT sub_order_id, awb_number, eta_to FROM logistics.shipment
       WHERE sub_order_id = ANY(${subs.map((s) => s.id)}::uuid[])`;
    const shipmentBySub = new Map(shipments.map((s) => [s.sub_order_id ?? '', s]));

    return subs.map((sub, i) => {
      const shipment = shipmentBySub.get(sub.id);
      return {
        supplyPointLabel:
          (sub.purchase_order_id ? labelById.get(sub.purchase_order_id) : null) ??
          `Supply Point ${String.fromCharCode(65 + i)}`,
        machines: Number(sub.machines),
        awb: shipment?.awb_number ?? null,
        etaLabel: shipment?.eta_to
          ? `Expected by ${this.day(shipment.eta_to)}`
          : 'Delivery date confirmed at dispatch',
      };
    });
  }

  private async address(addressId: string): Promise<OrderAddress> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        line1: string;
        city: string;
        state: string;
        state_code: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
      }>
    >`
      SELECT line1, city, state, state_code, pincode, contact_name, contact_mobile
        FROM identity.org_address WHERE id = ${addressId}::uuid`;
    return {
      line1: row?.line1 ?? '—',
      city: row?.city ?? '—',
      state: row?.state ?? '—',
      stateCode: row?.state_code ?? '—',
      pincode: row?.pincode ?? '—',
      contactName: row?.contact_name ?? '—',
      contactMobile: row?.contact_mobile ?? '—',
    };
  }

  private async skuTitles(skuIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    // `sku_code` and the spec that identifies the machine. There is no `title`
    // column — a SKU is described by what it is, and the code is what both
    // sides of a purchase order quote at each other.
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; sku_code: string; cpu_model: string; ram_gb: number }>
    >`
      SELECT id, sku_code, cpu_model, ram_gb FROM catalog.sku
       WHERE id = ANY(${unique}::uuid[])`;
    return new Map(rows.map((r) => [r.id, `${r.sku_code} · ${r.cpu_model} · ${r.ram_gb} GB`]));
  }

  private day(at: Date): string {
    return new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  }
}

interface OrderAddress {
  line1: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
}

interface OrderDocument {
  orderNumber: string;
  placedOn: string;
  paymentMode: string;
  buyerPoNumber: string | null;
  costCentre: string | null;
  buyer: { legalName: string; gstin: string | null };
  billing: OrderAddress;
  shipping: OrderAddress;
  lines: Array<{
    description: string;
    grade: string;
    qty: number;
    unitPrice: Money;
    gstAmount: Money;
    lineTotal: Money;
  }>;
  subtotal: Money;
  freight: Money;
  gstTotal: Money;
  grandTotal: Money;
  consignments: Array<{
    supplyPointLabel: string;
    machines: number;
    awb: string | null;
    etaLabel: string;
  }>;
  returnBy: string | null;
}

type Sheetish = Awaited<ReturnType<typeof newSheet>>;
