import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { BRAND } from '@trugrade/config';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ClockPort } from '../../../shared/clock';
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
 * The purchase order, as the vendor receives it.
 *
 * **Audience decides content, and this one is the vendor.** They are entitled to
 * know exactly what they are selling, which of their warehouses it leaves from,
 * what we will pay, what we will withhold and when they will be paid. They are
 * entitled to nothing downstream of that: no customer name, no customer address,
 * no selling price, no platform margin. A purchase order is a purchase document,
 * and a vendor who can read the retail price off ours can price against it.
 *
 * Every field is named individually below. A row is never handed to the renderer
 * to iterate over, because a blacklist fails open the moment somebody adds a
 * column — the same rule `invoice-pdf.service.ts` states for the other direction.
 */

const COLUMNS = { sku: MARGIN, grade: 300, qty: 350, rate: 430, amount: 520 };

export interface PoPdfInput {
  poNumber: string;
}

@Injectable()
export class PoPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  async render(input: PoPdfInput): Promise<RenderedDocument> {
    const po = await this.load(input.poNumber);
    const sheet = await newSheet();
    sheet.doc.setTitle(`Purchase order ${po.poNumber}`);
    sheet.doc.setSubject('Purchase order');

    drawLetterhead(sheet, {
      title: 'Purchase order',
      documentNumber: po.poNumber,
      date: po.raisedOn,
      copyLabel: 'Vendor copy',
    });

    this.drawIdentity(sheet, po);
    this.drawSupplyPoint(sheet, po);
    this.drawLines(sheet, po);
    this.drawTotals(sheet, po);
    this.drawTerms(sheet, po);
    this.drawAcknowledgement(sheet);

    drawFooters(sheet, `Purchase order ${po.poNumber}`);
    const bytes = Buffer.from(await sheet.doc.save({ useObjectStreams: false }));

    return {
      bytes,
      // The PO number and nothing else. A filename travels through mail clients
      // and download folders, and a vendor slug in one is the same leak as a
      // vendor slug in an object key.
      filename: `${BRAND.name}-purchase-order-${po.poNumber}.pdf`,
      documentNumber: po.poNumber,
    };
  }

  private drawIdentity(sheet: Sheetish, po: PoDocument): void {
    const right = PAGE[0] / 2 + 10;
    const top = sheet.y;
    sheet.pair('Purchase order', po.poNumber, MARGIN);
    sheet.pair('Raised on', po.raisedOn, MARGIN);
    sheet.pair('Payment terms', `${po.termsDays} days`, MARGIN);
    const leftBottom = sheet.y;

    sheet.y = top;
    sheet.at(right, sheet.y, 'SUPPLIER', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(right, [
      po.vendor.legalName,
      po.vendor.gstin ? `GSTIN ${po.vendor.gstin}` : 'GSTIN not on record',
      po.vendor.addressLine,
    ]);
    sheet.y = Math.min(leftBottom, sheet.y);
    sheet.gap(6);
    sheet.rule();
  }

  /**
   * Which warehouse to open.
   *
   * Spelled out in full, unlike everywhere else in this platform: the supply
   * point label is what a BUYER sees, and the vendor needs the actual address of
   * their own site. Anonymity runs one way.
   */
  private drawSupplyPoint(sheet: Sheetish, po: PoDocument): void {
    sheet.gap(8);
    sheet.at(MARGIN, sheet.y, 'COLLECT FROM', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(MARGIN, [
      po.pickup.line1,
      po.pickup.line2,
      `${po.pickup.city} ${po.pickup.pincode}`,
      `${po.pickup.state} (${po.pickup.stateCode})`,
      `Contact ${po.pickup.contactName} · ${po.pickup.contactMobile}`,
    ]);

    const right = PAGE[0] / 2 + 10;
    sheet.gap(2);
    sheet.at(right, sheet.y + 60, 'DISPATCH BY', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.block(right, [
      po.expectedDispatchAt ?? 'On acknowledgement',
      // Where it is going, to the city. A vendor routing a consignment needs the
      // lane; the consignee is not theirs to know.
      `Destination ${po.destinationCity}`,
    ]);
    sheet.gap(4);
    sheet.rule();
  }

  private drawLines(sheet: Sheetish, po: PoDocument): void {
    sheet.gap(10);
    sheet.at(COLUMNS.sku, sheet.y, 'MACHINE', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.at(COLUMNS.grade, sheet.y, 'GRADE', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.qty + 20, sheet.y, 'QTY', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.rate, sheet.y, 'RATE', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.amount, sheet.y, 'AMOUNT', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 6;
    sheet.rule();
    sheet.gap(6);

    for (const line of po.lines) {
      sheet.pageBreakIfBelow(80);
      sheet.at(COLUMNS.sku, sheet.y, line.description, { size: BODY });
      sheet.at(COLUMNS.grade, sheet.y, line.grade, { size: BODY });
      sheet.right(COLUMNS.qty + 20, sheet.y, String(line.qty), { size: BODY });
      sheet.right(COLUMNS.rate, sheet.y, line.rate.toString(), { size: BODY });
      sheet.right(COLUMNS.amount, sheet.y, line.amount.toString(), { size: BODY });
      sheet.y -= 12;

      // The serial, or the plain statement that there is not one yet. A PO is
      // raised with `unit_id` NULL — the vendor names the machine when they pack
      // it — and a blank here would read as a serial nobody typed.
      sheet.at(COLUMNS.sku + 8, sheet.y, line.serialNumber ?? 'Serial to be captured at pickup', {
        size: 7.5,
        colour: MUTED,
      });
      sheet.y -= 14;
    }
    sheet.rule();
  }

  private drawTotals(sheet: Sheetish, po: PoDocument): void {
    sheet.gap(8);
    sheet.total('Agreed payout', po.totalNet, false, COLUMNS.rate, COLUMNS.amount);
    sheet.total(
      `TDS u/s 194Q at ${po.tdsRatePct}%`,
      po.tdsAmount.negate(),
      false,
      COLUMNS.rate,
      COLUMNS.amount,
    );
    sheet.total('Net payable to you', po.netPayable, true, COLUMNS.rate, COLUMNS.amount);
    sheet.gap(4);
    sheet.at(MARGIN, sheet.y, 'Tax deducted at source under s.194Q of the Income-tax Act 1961.', {
      size: 7.5,
      colour: MUTED,
    });
    sheet.y -= 12;
  }

  /**
   * When the vendor gets paid, stated as a date rather than a policy.
   *
   * "Seven days after delivery" is a sentence a vendor has to do arithmetic on,
   * and the arithmetic depends on a delivery that has not happened yet. So the
   * policy is stated AND the recorded date is printed the moment there is one.
   */
  private drawTerms(sheet: Sheetish, po: PoDocument): void {
    sheet.gap(6);
    sheet.rule();
    sheet.gap(8);
    sheet.at(MARGIN, sheet.y, 'PAYMENT', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(MARGIN, [
      'The customer has seven days from delivery to return a machine.',
      'Your payment becomes due once that window closes.',
      po.eligibleOn
        ? `On this order that is ${po.eligibleOn}.`
        : 'The exact date is set when the machines are delivered.',
    ]);
  }

  private drawAcknowledgement(sheet: Sheetish): void {
    sheet.pageBreakIfBelow(90);
    sheet.gap(10);
    sheet.rule();
    sheet.gap(8);
    sheet.at(MARGIN, sheet.y, 'ACKNOWLEDGEMENT', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= 12;
    sheet.block(MARGIN, [
      'Accept or decline each line on your supplier console. Acknowledging this order',
      'commits the machines listed above at the rates shown.',
    ]);
  }

  /**
   * Everything the document prints, read once.
   *
   * Four statements rather than one join: `no-cross-schema-join` reads a query
   * spanning `procurement`, `identity`, `ordering` and `catalog` as a
   * cross-module read, and it is right to.
   */
  private async load(poNumber: string): Promise<PoDocument> {
    const [po] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        po_number: string;
        vendor_org_id: string;
        order_id: string;
        pickup_address_id: string | null;
        supply_point_label: string | null;
        total_net: string;
        tds_rate_pct: string;
        tds_amount: string;
        terms_days: number;
        expected_dispatch_at: Date | null;
        created_at: Date;
      }>
    >`
      SELECT id, po_number, vendor_org_id, order_id, pickup_address_id, supply_point_label,
             total_net::text AS total_net, tds_rate_pct::text AS tds_rate_pct,
             tds_amount::text AS tds_amount, terms_days, expected_dispatch_at, created_at
        FROM procurement.purchase_order WHERE po_number = ${poNumber}`;
    if (!po) throw new NotFoundError('purchase_order', { poNumber });

    const [vendor] = await this.prisma.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization WHERE id = ${po.vendor_org_id}::uuid`;
    const [gst] = await this.prisma.$queryRaw<Array<{ gstin: string }>>`
      SELECT gstin FROM kyc.gst_profile
       WHERE org_id = ${po.vendor_org_id}::uuid AND is_primary LIMIT 1`;

    const pickup = po.pickup_address_id ? await this.address(po.pickup_address_id) : null;
    const [order] = await this.prisma.$queryRaw<
      Array<{ shipping_address_id: string; order_number: string }>
    >`
      SELECT shipping_address_id, order_number FROM ordering."order"
       WHERE id = ${po.order_id}::uuid`;
    const destination = order ? await this.address(order.shipping_address_id) : null;

    const lines = await this.prisma.$queryRaw<
      Array<{
        sku_id: string;
        grade_at_po: string;
        agreed_net_payout: string;
        unit_id: string | null;
      }>
    >`
      SELECT sku_id, grade_at_po::text AS grade_at_po,
             agreed_net_payout::text AS agreed_net_payout, unit_id
        FROM procurement.purchase_order_line WHERE po_id = ${po.id}::uuid ORDER BY created_at, id`;

    const skus = await this.skuTitles(lines.map((l) => l.sku_id));
    const serials = await this.serials(
      lines.map((l) => l.unit_id).filter((id): id is string => !!id),
    );

    const [payable] = await this.prisma.$queryRaw<Array<{ eligible_at: Date | null }>>`
      SELECT eligible_at FROM procurement.vendor_payable
       WHERE purchase_order_id = ${po.id}::uuid`;

    const totalNet = moneyFromDb(po.total_net) ?? Money.ZERO;
    const tdsAmount = moneyFromDb(po.tds_amount) ?? Money.ZERO;

    return {
      poNumber: po.po_number,
      raisedOn: this.day(po.created_at),
      termsDays: po.terms_days,
      expectedDispatchAt: po.expected_dispatch_at ? this.day(po.expected_dispatch_at) : null,
      vendor: {
        legalName: vendor?.legal_name ?? 'Supplier',
        gstin: gst?.gstin ?? null,
        addressLine: pickup ? `${pickup.city} ${pickup.pincode}` : null,
      },
      pickup: pickup ?? EMPTY_ADDRESS,
      destinationCity: destination?.city ?? 'Not yet set',
      lines: lines.map((l) => {
        const rate = moneyFromDb(l.agreed_net_payout) ?? Money.ZERO;
        return {
          description: skus.get(l.sku_id) ?? 'Laptop',
          grade: l.grade_at_po,
          qty: 1,
          rate,
          amount: rate,
          serialNumber: l.unit_id ? (serials.get(l.unit_id) ?? null) : null,
        };
      }),
      totalNet,
      tdsRatePct: po.tds_rate_pct,
      tdsAmount,
      netPayable: totalNet.sub(tdsAmount),
      eligibleOn: payable?.eligible_at ? this.day(payable.eligible_at) : null,
    };
  }

  private async address(addressId: string): Promise<PoAddress> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        state_code: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
      }>
    >`
      SELECT line1, line2, city, state, state_code, pincode, contact_name, contact_mobile
        FROM identity.org_address WHERE id = ${addressId}::uuid`;
    return row
      ? {
          line1: row.line1,
          line2: row.line2,
          city: row.city,
          state: row.state,
          stateCode: row.state_code,
          pincode: row.pincode,
          contactName: row.contact_name,
          contactMobile: row.contact_mobile,
        }
      : EMPTY_ADDRESS;
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

  private async serials(unitIds: readonly string[]): Promise<Map<string, string>> {
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit WHERE id = ANY(${[...unitIds]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.serial_number]));
  }

  /** `YYYY-MM-DD` in IST, which is the day a vendor's accounts run on. */
  private day(at: Date): string {
    return new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  }
}

interface PoAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
}

const EMPTY_ADDRESS: PoAddress = {
  line1: 'Address not on record',
  line2: null,
  city: '—',
  state: '—',
  stateCode: '—',
  pincode: '—',
  contactName: '—',
  contactMobile: '—',
};

interface PoDocument {
  poNumber: string;
  raisedOn: string;
  termsDays: number;
  expectedDispatchAt: string | null;
  vendor: { legalName: string; gstin: string | null; addressLine: string | null };
  pickup: PoAddress;
  destinationCity: string;
  lines: Array<{
    description: string;
    grade: string;
    qty: number;
    rate: Money;
    amount: Money;
    serialNumber: string | null;
  }>;
  totalNet: Money;
  tdsRatePct: string;
  tdsAmount: Money;
  netPayable: Money;
  eligibleOn: string | null;
}

/** The drawing surface, structurally. Keeps this file off the class's internals. */
type Sheetish = Awaited<ReturnType<typeof newSheet>>;
