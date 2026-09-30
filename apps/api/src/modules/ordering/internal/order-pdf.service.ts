import { Injectable } from '@nestjs/common';
import { rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { BRAND, LEGAL_DISCLOSURE, formatRegisteredOffice } from '@trugrade/config';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { NotFoundError } from '../../../shared/errors/domain-errors';
import {
  INK,
  MARGIN,
  MUTED,
  PAGE,
  RULE,
  drawFooters,
  newSheet,
  pdfSafe,
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
 *
 * THE LAYOUT
 * ----------
 * Drawn to the supplied sales-order design, top to bottom: the mark and the
 * document numbers across the head; the date and the seller; two rounded
 * boxes, billed-to beside shipping-to; a table under a solid teal header; the
 * charges stacked on the right under it; the notes; and a box to sign for
 * receipt. It draws its own head rather than calling the shared
 * `drawLetterhead`, because that design is this document's and the invoice,
 * the purchase order and the QC report keep the letterhead they have. The
 * shared footer — page number and grievance officer — is unchanged, since
 * r.4(4)-(5) of the E-Commerce Rules wants that officer on every document.
 *
 * What the layout was NOT allowed to change is the content. The labels that
 * carry meaning stay as they were — "Goods", "Delivery", "GST", "Total
 * payable" — and nothing the supplied design showed that we do not hold is
 * invented to fill its slot: there is no quotation number, no dispatch date
 * and no security amount on an order here, so those three are not drawn.
 */

const TEAL = rgb(0.067, 0.447, 0.561);
const WHITE = rgb(1, 1, 1);
const BOX_LINE = rgb(0.86, 0.87, 0.89);
const RIGHT = PAGE[0] - MARGIN;
const WIDTH = RIGHT - MARGIN;

type Align = 'left' | 'centre' | 'right';

/** The table's columns, left to right. Widths sum to the content width. */
const COLUMNS: ReadonlyArray<{ key: string; label: string; width: number; align: Align }> = [
  { key: 'product', label: 'Product', width: 180, align: 'left' },
  { key: 'hsn', label: 'HSN', width: 52, align: 'centre' },
  { key: 'grade', label: 'Grade', width: 40, align: 'centre' },
  { key: 'qty', label: 'Qty.', width: 36, align: 'centre' },
  { key: 'rate', label: 'Rate', width: 66, align: 'right' },
  { key: 'gst', label: 'GST', width: 70, align: 'right' },
  { key: 'amount', label: 'Amount', width: WIDTH - 444, align: 'right' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How a storage type reads on paper, rather than as its column value. */
const STORAGE_LABEL: Record<string, string> = {
  NVME_SSD: 'NVMe SSD',
  SATA_SSD: 'SATA SSD',
  SSD: 'SSD',
  HDD: 'HDD',
  EMMC: 'eMMC',
};

@Injectable()
export class OrderPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * The confirmation for the signed-in reader — the one a route hands out.
   *
   * Scoped to the reader's own organisation in the query itself. It used not
   * to be: the order was looked up by its number alone, and order numbers are
   * sequential, so any buyer with an account could read any other company's
   * confirmation — its name, GSTIN, addresses, contact number and prices — by
   * counting. Platform staff read across organisations; everyone else is
   * pinned to their own, and an order that is somebody else's is "not found"
   * rather than "forbidden", for the reason `OrderReadService.byNumber` gives:
   * a 403 would confirm the number exists.
   *
   * It requires a principal. A route that reaches this without one is a
   * programming error, not an access decision.
   */
  async renderForReader(orderNumber: string): Promise<RenderedDocument> {
    const reader = this.ctx.requirePrincipal();
    return this.draw(
      await this.load(orderNumber, reader.orgType === 'PLATFORM' ? null : reader.orgId),
    );
  }

  /**
   * The confirmation for an order, with no reader in mind.
   *
   * For in-process callers that already hold the right to the order — a job
   * attaching it to an email, a test rendering a fixture. It applies NO
   * organisation check, so it must never be what a request handler calls:
   * that is `renderForReader`.
   */
  async render(orderNumber: string): Promise<RenderedDocument> {
    return this.draw(await this.load(orderNumber, null));
  }

  private async draw(order: OrderDocument): Promise<RenderedDocument> {
    const sheet = await newSheet();
    sheet.doc.setTitle(`Order confirmation ${order.orderNumber}`);
    sheet.doc.setSubject('Order confirmation');

    this.drawHead(sheet, order);
    this.drawSeller(sheet, order);
    this.drawParties(sheet, order);
    this.drawLines(sheet, order);
    this.drawCharges(sheet, order);
    this.drawConsignments(sheet, order);
    this.drawTerms(sheet, order);
    this.drawAcknowledgement(sheet);

    drawFooters(sheet, `Order confirmation ${order.orderNumber}`);
    const bytes = Buffer.from(await sheet.doc.save({ useObjectStreams: false }));

    return {
      bytes,
      filename: `${BRAND.name}-order-${order.orderNumber}.pdf`,
      documentNumber: order.orderNumber,
    };
  }

  /**
   * The mark on the left, the two numbers on the right, a rule under both.
   *
   * The second number is the buyer's own purchase-order reference — the number
   * THEIR finance team files this under. A blank there reads as a reference
   * nobody typed, so an order without one says "None given".
   */
  private drawHead(sheet: Sheetish, order: OrderDocument): void {
    const top = PAGE[1] - MARGIN;

    this.drawMark(sheet, MARGIN, top, 30);
    const name = BRAND.name.toLowerCase();
    const head = name.slice(0, 3);
    const wordY = top - 22;
    sheet.at(MARGIN + 38, wordY, head, { size: 22, font: 'bold' });
    sheet.at(MARGIN + 38 + sheet.fonts.bold.widthOfTextAtSize(head, 22), wordY, name.slice(3), {
      size: 22,
      font: 'bold',
      colour: TEAL,
    });

    this.headline(sheet, RIGHT - 185, top - 12, order.orderNumber, 'Order Number', true);
    this.headline(
      sheet,
      RIGHT - 60,
      top - 12,
      order.buyerPoNumber ?? 'None given',
      'Your PO Reference',
      order.buyerPoNumber !== null,
    );

    sheet.y = top - 44;
    sheet.rule();
  }

  /** A value centred over its caption, shrunk to fit if it is a long one. */
  private headline(
    sheet: Sheetish,
    centreX: number,
    y: number,
    value: string,
    caption: string,
    present: boolean,
  ): void {
    const font = present ? sheet.fonts.bold : sheet.fonts.regular;
    const natural = font.widthOfTextAtSize(pdfSafe(value), 14);
    const size = Math.min(14, (14 * 118) / natural);
    this.centred(sheet, centreX, y, value, {
      size,
      font: present ? 'bold' : 'regular',
      colour: present ? INK : MUTED,
    });
    this.centred(sheet, centreX, y - 14, caption, { size: 7.5, colour: MUTED });
  }

  /**
   * The brand mark, drawn rather than embedded: a gauge bar with its two end
   * stops, one tick and one filled reading. Vector, so it is sharp at any zoom
   * and the document carries no image to go missing.
   */
  private drawMark(sheet: Sheetish, x: number, top: number, size: number): void {
    const s = size / 46;
    const at = (px: number, py: number): { x: number; y: number } => ({
      x: x + px * s,
      y: top - py * s,
    });
    const bar = { thickness: 2.6 * s * 1.6, color: INK };
    sheet.page.drawLine({ start: at(6, 23), end: at(40, 23), ...bar });
    sheet.page.drawLine({ start: at(6, 15), end: at(6, 31), ...bar });
    sheet.page.drawLine({ start: at(40, 15), end: at(40, 31), ...bar });
    sheet.page.drawLine({
      start: at(18, 17),
      end: at(18, 29),
      thickness: bar.thickness,
      color: TEAL,
    });
    sheet.page.drawCircle({ ...at(30, 23), size: 5.5 * s, color: TEAL });
  }

  /**
   * When it was placed and who sold it.
   *
   * The seller is us. Always us — that is what merchant of record means, and
   * it is the sentence a buyer's finance team needs when they ask who to chase.
   * The CIN is null in `brand.ts` until the MCA record is live, and prints as
   * "Not yet published": an absence stated is a fact, an absence drawn as a gap
   * is a document somebody has to ring up about.
   */
  private drawSeller(sheet: Sheetish, order: OrderDocument): void {
    sheet.gap(10);
    const meta = [
      `Date: ${order.placedOn}`,
      `Payment: ${order.paymentMode}`,
      order.costCentre ? `Cost centre: ${order.costCentre}` : null,
    ];
    for (const line of meta) {
      if (!line) continue;
      sheet.at(MARGIN, sheet.y, line, { size: 9, colour: MUTED });
      sheet.y -= 13;
    }

    sheet.gap(5);
    sheet.at(MARGIN, sheet.y, LEGAL_DISCLOSURE.legalName.toUpperCase(), { size: 14, font: 'bold' });
    sheet.y -= 16;

    const lines = [
      `Email: ${LEGAL_DISCLOSURE.customerCare.email}`,
      `GSTIN: ${LEGAL_DISCLOSURE.gstin}  ·  CIN: ${LEGAL_DISCLOSURE.cin ?? 'Not yet published'}`,
      ...wrapToWidth(sheet.fonts.regular, `Address: ${formatRegisteredOffice()}`, 9, WIDTH),
    ];
    for (const line of lines) {
      sheet.at(MARGIN, sheet.y, line, { size: 9 });
      sheet.y -= 12.5;
    }

    sheet.gap(7);
    sheet.at(MARGIN, sheet.y, 'Order confirmation', { size: 12.5, font: 'bold', colour: TEAL });
    sheet.y -= 10;
  }

  /**
   * Billed-to beside shipping-to, in two boxes of one height.
   *
   * The text is drawn first and the border after, because a box is as tall as
   * the longer of two addresses and that is only known once both are set.
   */
  private drawParties(sheet: Sheetish, order: OrderDocument): void {
    const gap = 14;
    const boxW = (WIDTH - gap) / 2;
    const pad = 12;
    const inner = boxW - pad * 2;
    const top = sheet.y;
    const leftX = MARGIN + pad;
    const rightX = MARGIN + boxW + gap + pad;

    let y = top - 17;
    for (const line of wrapToWidth(sheet.fonts.bold, order.buyer.legalName, 10.5, inner)) {
      sheet.at(leftX, y, line, { size: 10.5, font: 'bold' });
      y -= 13;
    }
    y -= 1;
    y = this.field(sheet, leftX, y, inner, 'Phone', order.billing.contactMobile);
    y = this.field(sheet, leftX, y, inner, 'City', order.billing.city);
    y = this.field(sheet, leftX, y, inner, 'State', order.billing.state);
    y = this.field(sheet, leftX, y, inner, 'Country', 'India');
    y = this.field(sheet, leftX, y, inner, 'PIN Code', order.billing.pincode);
    y = this.field(sheet, leftX, y, inner, 'Address', order.billing.full);
    y = this.field(sheet, leftX, y, inner, 'GSTIN', order.buyer.gstin);
    const leftBottom = y;

    y = top - 17;
    sheet.at(rightX, y, 'Shipping To:', { size: 10.5, font: 'bold' });
    y -= 14;
    for (const line of wrapToWidth(sheet.fonts.bold, order.shipping.contactName, 9.5, inner)) {
      sheet.at(rightX, y, line, { size: 9.5, font: 'bold' });
      y -= 12.5;
    }
    y -= 1;
    y = this.field(sheet, rightX, y, inner, 'Phone', order.shipping.contactMobile);
    y = this.field(sheet, rightX, y, inner, 'City', order.shipping.city);
    y = this.field(
      sheet,
      rightX,
      y,
      inner,
      'State',
      `${order.shipping.state} (${order.shipping.stateCode})`,
    );
    y = this.field(sheet, rightX, y, inner, 'Country', 'India');
    y = this.field(sheet, rightX, y, inner, 'PIN Code', order.shipping.pincode);
    y = this.field(sheet, rightX, y, inner, 'Address', order.shipping.full);

    const bottom = Math.min(leftBottom, y) - 1;
    const height = top - bottom;
    this.roundedBox(sheet, MARGIN, top, boxW, height);
    this.roundedBox(sheet, MARGIN + boxW + gap, top, boxW, height);
    sheet.y = bottom;
  }

  /**
   * `Label: value`, the label bold, the value wrapped to the box. A value that
   * is absent draws nothing at all — "GSTIN:" followed by a blank is a worse
   * line than no line. Returns the y beneath what it drew.
   */
  private field(
    sheet: Sheetish,
    x: number,
    y: number,
    maxWidth: number,
    label: string,
    value: string | null,
  ): number {
    const text = value === null ? '' : pdfSafe(value);
    if (text === '' || text === '-') return y;
    const size = 8.5;
    const lead = 11.5;
    const head = `${label}:`;
    const headWidth = sheet.fonts.bold.widthOfTextAtSize(head, size) + 3;

    // The first line shares its row with the label; the rest have the full width.
    const lines: string[] = [];
    let line = '';
    let room = maxWidth - headWidth;
    for (const word of text.split(' ')) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && sheet.fonts.regular.widthOfTextAtSize(next, size) > room) {
        lines.push(line);
        line = word;
        room = maxWidth;
      } else {
        line = next;
      }
    }
    if (line !== '') lines.push(line);

    sheet.at(x, y, head, { size, font: 'bold' });
    lines.forEach((l, i) => sheet.at(i === 0 ? x + headWidth : x, y - i * lead, l, { size }));
    return y - lines.length * lead;
  }

  private drawLines(sheet: Sheetish, order: OrderDocument): void {
    sheet.gap(16);
    this.tableHead(sheet);

    for (const line of order.lines) {
      const productWidth = COLUMNS[0]!.width - 16;
      const titleLines = wrapToWidth(sheet.fonts.bold, line.title, 9, productWidth);
      const detail = [line.cpu, line.config, line.skuCode ? `SKU ${line.skuCode}` : null].flatMap(
        (d) => (d ? wrapToWidth(sheet.fonts.regular, d, 8, productWidth) : []),
      );
      const height = 9 + titleLines.length * 11 + detail.length * 10 + 6;

      // A row is never split across the fold, and the header is repeated on
      // the new page so a separated sheet still says what its columns are.
      if (sheet.y - height < MARGIN + 30) {
        sheet.newPage();
        this.tableHead(sheet);
      }
      const top = sheet.y;

      sheet.page.drawRectangle({
        x: MARGIN,
        y: top - height,
        width: WIDTH,
        height,
        borderColor: BOX_LINE,
        borderWidth: 0.7,
      });
      let edge = MARGIN;
      for (const column of COLUMNS.slice(0, -1)) {
        edge += column.width;
        sheet.page.drawLine({
          start: { x: edge, y: top },
          end: { x: edge, y: top - height },
          thickness: 0.7,
          color: BOX_LINE,
        });
      }

      let y = top - 14;
      for (const t of titleLines) {
        sheet.at(MARGIN + 8, y, t, { size: 9, font: 'bold' });
        y -= 11;
      }
      for (const d of detail) {
        sheet.at(MARGIN + 8, y, d, { size: 8, colour: MUTED });
        y -= 10;
      }

      const middle = top - height / 2 - 3;
      const cells: Record<string, string> = {
        hsn: line.hsn ?? 'N/A',
        grade: line.grade,
        qty: `${line.qty} Pcs.`,
        rate: `Rs. ${line.unitPrice.toString()}`,
        gst: `Rs. ${line.gstAmount.toString()}`,
        amount: `Rs. ${line.lineTotal.toString()}`,
      };
      let x = MARGIN;
      for (const column of COLUMNS) {
        const value = cells[column.key];
        if (value !== undefined) this.cell(sheet, x, column.width, middle, value, column.align, {});
        x += column.width;
      }
      sheet.y = top - height;
    }
  }

  /** The solid header bar, white on teal. */
  private tableHead(sheet: Sheetish): void {
    const height = 22;
    const top = sheet.y;
    sheet.page.drawRectangle({ x: MARGIN, y: top - height, width: WIDTH, height, color: TEAL });
    let x = MARGIN;
    for (const column of COLUMNS) {
      this.cell(sheet, x, column.width, top - 14, column.label, column.align, {
        font: 'bold',
        colour: WHITE,
      });
      x += column.width;
    }
    sheet.y = top - height;
  }

  /** One value inside a column, aligned, with the column's inner padding. */
  private cell(
    sheet: Sheetish,
    x: number,
    width: number,
    y: number,
    value: string,
    align: Align,
    opts: { font?: 'regular' | 'bold'; colour?: typeof INK },
  ): void {
    const style = { size: 8.5, ...opts };
    if (align === 'left') sheet.at(x + 8, y, value, style);
    else if (align === 'right') sheet.right(x + width - 8, y, value, style);
    else this.centred(sheet, x + width / 2, y, value, style);
  }

  /**
   * Every charge, at once, stacked on the right under the table.
   *
   * Freight appears here even when it is zero, because "no delivery charge" is
   * information a buyer acts on and an absent line is one they have to ask about.
   * The rate is named beside "GST" only when every line carries the same one;
   * a mixed order gets the bare word rather than a rate that is true of half.
   */
  private drawCharges(sheet: Sheetish, order: OrderDocument): void {
    sheet.pageBreakIfBelow(110);
    sheet.gap(20);
    const labelX = RIGHT - 142;

    const row = (label: string, amount: Money, emphatic: boolean): void => {
      sheet.right(labelX, sheet.y, `${label}:`, {
        size: emphatic ? 10 : 9,
        font: emphatic ? 'bold' : 'regular',
        colour: emphatic ? INK : MUTED,
      });
      sheet.right(RIGHT, sheet.y, `Rs. ${amount.toString()}`, {
        size: emphatic ? 10 : 9,
        font: 'bold',
      });
      sheet.y -= 17;
    };

    row('Goods', order.subtotal, false);
    row('Delivery', order.freight, false);
    row(order.gstRate ? `GST (${order.gstRate}%)` : 'GST', order.gstTotal, false);

    sheet.y += 6;
    sheet.page.drawLine({
      start: { x: RIGHT - 250, y: sheet.y },
      end: { x: RIGHT, y: sheet.y },
      thickness: 0.6,
      color: RULE,
    });
    sheet.y -= 15;
    row('Total payable', order.grandTotal, true);
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
    sheet.pageBreakIfBelow(90 + order.consignments.length * 26);
    this.sectionTitle(sheet, 'Deliveries');

    for (const consignment of order.consignments) {
      this.bullet(sheet, sheet.y);
      sheet.at(MARGIN + 12, sheet.y, consignment.supplyPointLabel, { size: 9, font: 'bold' });
      sheet.y -= 11.5;
      const detail = [
        `${consignment.machines} machine${consignment.machines === 1 ? '' : 's'}`,
        consignment.awb ? `Tracking ${consignment.awb}` : 'Tracking number follows on dispatch',
        consignment.etaLabel,
      ].join('  ·  ');
      for (const line of wrapToWidth(sheet.fonts.regular, detail, 8.5, WIDTH - 12)) {
        sheet.at(MARGIN + 12, sheet.y, line, { size: 8.5, colour: MUTED });
        sheet.y -= 11;
      }
      sheet.gap(3);
    }
  }

  private drawTerms(sheet: Sheetish, order: OrderDocument): void {
    sheet.pageBreakIfBelow(100);
    this.sectionTitle(sheet, 'Returns and warranty');

    const care = LEGAL_DISCLOSURE.customerCare;
    const notes = [
      // A date, not a duration: "seven days" is arithmetic a buyer has to do,
      // and they will do it from the wrong day.
      order.returnBy
        ? `You may return a machine until ${order.returnBy} — seven days from delivery.`
        : 'You may return a machine for seven days from the day it is delivered.',
      'Every machine carries the warranty stated on its listing, backed by Trugrade.',
      `Questions: ${[care.email, care.phone].filter(Boolean).join('  ·  ')}`,
    ];
    for (const note of notes) {
      this.bullet(sheet, sheet.y);
      for (const line of wrapToWidth(sheet.fonts.regular, note, 8.5, WIDTH - 12)) {
        sheet.at(MARGIN + 12, sheet.y, line, { size: 8.5 });
        sheet.y -= 11.5;
      }
      sheet.gap(1.5);
    }
  }

  /**
   * The box the person at the gate signs. A goods-received note is what a
   * buyer's stores team files against the purchase, and printing the lines for
   * it here saves them drawing their own on the delivery challan.
   */
  private drawAcknowledgement(sheet: Sheetish): void {
    const height = 72;
    sheet.pageBreakIfBelow(height + 24);
    sheet.gap(14);
    const top = sheet.y;
    this.roundedBox(sheet, MARGIN, top, WIDTH, height);

    const x = MARGIN + 12;
    sheet.at(x, top - 18, 'Acknowledgement of Receipt', { size: 10, font: 'bold' });
    sheet.at(x, top - 31, 'Received the above item(s) in good condition.', {
      size: 8.5,
      colour: MUTED,
    });

    const y = top - 56;
    const blank = (label: string, at: number, until: number): void => {
      sheet.at(at, y, label, { size: 9 });
      const from = at + sheet.fonts.regular.widthOfTextAtSize(label, 9) + 4;
      sheet.page.drawLine({
        start: { x: from, y: y - 1.5 },
        end: { x: until, y: y - 1.5 },
        thickness: 0.6,
        color: INK,
      });
    };
    blank('Received by:', x, x + 215);
    blank('Signature:', x + 290, x + 400);
    blank('Date:', x + 418, RIGHT - 12);

    sheet.y = top - height;
  }

  private sectionTitle(sheet: Sheetish, title: string): void {
    sheet.gap(14);
    sheet.at(MARGIN, sheet.y, title, { size: 12.5, font: 'bold', colour: TEAL });
    sheet.y -= 16;
  }

  /** Drawn, not typed: the bullet glyph is outside the standard fonts' range. */
  private bullet(sheet: Sheetish, y: number): void {
    sheet.page.drawCircle({ x: MARGIN + 4, y: y + 3, size: 1.3, color: INK });
  }

  private centred(
    sheet: Sheetish,
    centreX: number,
    y: number,
    value: string,
    opts: { size?: number; font?: 'regular' | 'bold'; colour?: typeof INK },
  ): void {
    const font = opts.font === 'bold' ? sheet.fonts.bold : sheet.fonts.regular;
    const width = font.widthOfTextAtSize(pdfSafe(value), opts.size ?? 9);
    sheet.at(centreX - width / 2, y, value, opts);
  }

  /** An outline with rounded corners; `top` is its upper edge. No fill. */
  private roundedBox(sheet: Sheetish, x: number, top: number, w: number, h: number): void {
    const r = 8;
    const path =
      `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} ` +
      `H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    sheet.page.drawSvgPath(path, { x, y: top, borderColor: BOX_LINE, borderWidth: 0.9 });
  }

  /**
   * One statement per schema, and an explicit allow-list of what is read.
   *
   * Nothing on this document may come from `procurement` or from any vendor
   * table. The only fact about supply that reaches it is the supply point label,
   * which the purchase order carries precisely so a buyer-facing document can
   * name a consignment without naming a supplier.
   */
  private async load(orderNumber: string, buyerOrgId: string | null): Promise<OrderDocument> {
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
        FROM ordering."order"
       WHERE order_number = ${orderNumber}
         AND (${buyerOrgId}::uuid IS NULL OR buyer_org_id = ${buyerOrgId}::uuid)`;
    if (!order) {
      throw new NotFoundError(
        'order',
        buyerOrgId === null ? { orderNumber } : { reason: 'no_such_order_for_this_org' },
      );
    }

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
        gst_rate: string;
        gst_amount: string;
        line_total: string;
      }>
    >`
      SELECT ol.sku_id, ol.grade::text AS grade, ol.qty, ol.unit_price::text AS unit_price,
             ol.gst_rate::text AS gst_rate,
             ol.gst_amount::text AS gst_amount, ol.line_total::text AS line_total
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${order.id}::uuid
         AND ol.status <> 'CANCELLED'::public.order_status
       ORDER BY ol.id`;
    const skus = await this.skuFacts(lines.map((l) => l.sku_id));

    const consignments = await this.consignmentsOf(order.id);
    const [delivered] = await this.prisma.$queryRaw<Array<{ eligible: Date | null }>>`
      SELECT max(delivered_at) AS eligible FROM ordering.sub_order
       WHERE order_id = ${order.id}::uuid`;

    // One rate named on the GST row only if it is the rate of every line.
    const rates = new Set(lines.map((l) => Number(l.gst_rate)));
    const [onlyRate] = [...rates];
    const gstRate =
      rates.size === 1 && onlyRate !== undefined && Number.isFinite(onlyRate)
        ? String(Number(onlyRate.toFixed(2)))
        : null;

    return {
      orderNumber: order.order_number,
      placedOn: this.day(order.placed_at),
      paymentMode: order.payment_mode === 'CREDIT' ? 'Credit terms' : 'Prepaid',
      buyerPoNumber: order.buyer_po_number,
      costCentre: order.cost_centre,
      buyer: { legalName: buyer?.legal_name ?? 'Customer', gstin: gst?.gstin ?? null },
      billing,
      shipping,
      lines: lines.map((l) => {
        const sku = skus.get(l.sku_id);
        return {
          title: sku?.title ?? 'Refurbished laptop',
          cpu: sku?.cpu ?? null,
          config: sku?.config ?? null,
          skuCode: sku?.skuCode ?? null,
          hsn: sku?.hsn ?? null,
          grade: l.grade === 'A_PLUS' ? 'A+' : l.grade,
          qty: l.qty,
          unitPrice: moneyFromDb(l.unit_price) ?? Money.ZERO,
          gstAmount: moneyFromDb(l.gst_amount) ?? Money.ZERO,
          lineTotal: moneyFromDb(l.line_total) ?? Money.ZERO,
        };
      }),
      subtotal: moneyFromDb(order.subtotal) ?? Money.ZERO,
      freight: moneyFromDb(order.freight_total) ?? Money.ZERO,
      gstTotal: moneyFromDb(order.gst_total) ?? Money.ZERO,
      grandTotal: moneyFromDb(order.grand_total) ?? Money.ZERO,
      gstRate,
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
        line2: string | null;
        landmark: string | null;
        city: string;
        state: string;
        state_code: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
      }>
    >`
      SELECT line1, line2, landmark, city, state, state_code, pincode, contact_name, contact_mobile
        FROM identity.org_address WHERE id = ${addressId}::uuid`;
    const parts = [row?.line1, row?.line2, row?.landmark, row?.city, row?.state, row?.pincode];
    return {
      // The whole address on one line, the way a courier label reads it.
      full: parts.filter((p): p is string => !!p && p.trim() !== '').join(', ') || '-',
      city: row?.city ?? '-',
      state: row?.state ?? '-',
      stateCode: row?.state_code ?? '-',
      pincode: row?.pincode ?? '-',
      contactName: row?.contact_name ?? '-',
      contactMobile: row?.contact_mobile ?? '-',
    };
  }

  /**
   * What each line is, in the words a buyer would use for it.
   *
   * One statement, and every table in it is `catalog` — the maker and the model
   * name are the SKU's own ancestry, not another module's data. The SKU code
   * still prints under the description: it is what both sides of a purchase
   * order quote at each other.
   */
  private async skuFacts(skuIds: readonly string[]): Promise<Map<string, SkuFacts>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sku_code: string;
        brand: string;
        model: string;
        cpu_model: string | null;
        cpu_generation: string | null;
        ram_gb: number | null;
        storage_gb: number | null;
        storage_type: string | null;
        screen_size_inch: string | null;
        hsn_code: string | null;
      }>
    >`
      SELECT s.id, s.sku_code, b.name AS brand, m.name AS model,
             s.cpu_model, s.cpu_generation, s.ram_gb, s.storage_gb,
             s.storage_type::text AS storage_type,
             s.screen_size_inch::text AS screen_size_inch, s.hsn_code
        FROM catalog.sku s
        JOIN catalog.model m ON m.id = s.model_id
        JOIN catalog.series se ON se.id = m.series_id
        JOIN catalog.brand b ON b.id = se.brand_id
       WHERE s.id = ANY(${unique}::uuid[])`;

    return new Map(
      rows.map((r) => {
        const screen = r.screen_size_inch ? `${Number(r.screen_size_inch)}"` : null;
        const storageKind = r.storage_type
          ? (STORAGE_LABEL[r.storage_type] ?? r.storage_type.replace(/_/g, ' '))
          : null;
        return [
          r.id,
          {
            skuCode: r.sku_code,
            title: [`${r.brand} ${r.model}`, screen].filter(Boolean).join(' | '),
            cpu:
              [r.cpu_model, r.cpu_generation ? `${r.cpu_generation} Gen` : null]
                .filter(Boolean)
                .join(' | ') || null,
            config:
              [
                r.ram_gb ? `${r.ram_gb}GB RAM` : null,
                r.storage_gb ? `${r.storage_gb}GB${storageKind ? ` ${storageKind}` : ''}` : null,
              ]
                .filter(Boolean)
                .join(' | ') || null,
            hsn: r.hsn_code,
          },
        ];
      }),
    );
  }

  /** `07 Sep 2026`, Asia/Kolkata — a date nobody has to decode. */
  private day(at: Date): string {
    const ist = new Date(at.getTime() + 5.5 * 3_600_000);
    const dd = String(ist.getUTCDate()).padStart(2, '0');
    return `${dd} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
  }
}

/** Break on spaces so that no line is wider than `maxWidth` points. */
function wrapToWidth(font: PDFFont, value: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of pdfSafe(value).split(' ').filter(Boolean)) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && font.widthOfTextAtSize(next, size) > maxWidth) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== '') out.push(line);
  return out;
}

interface SkuFacts {
  skuCode: string;
  title: string;
  cpu: string | null;
  config: string | null;
  hsn: string | null;
}

interface OrderAddress {
  full: string;
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
    title: string;
    cpu: string | null;
    config: string | null;
    skuCode: string | null;
    hsn: string | null;
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
  /** `18`, when every line shares that rate; otherwise null. */
  gstRate: string | null;
  consignments: Array<{
    supplyPointLabel: string;
    machines: number;
    awb: string | null;
    etaLabel: string;
  }>;
  returnBy: string | null;
}

type Sheetish = Awaited<ReturnType<typeof newSheet>>;
