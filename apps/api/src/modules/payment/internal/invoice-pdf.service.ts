import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config';
import { Money, RULE_32_5_NARRATION } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import type { OrderBillingBasis } from '../dto/invoice.dto';
import type { Issuer, PricedDocument, PricedLine } from './invoice-issue.service';

/**
 * The invoice as a printed document.
 *
 * The buyer's finance team files this, their auditor reads it, and their GSTR-2B
 * reconciliation is checked against it. So two properties are hard constraints
 * rather than preferences, and both are the same ones the QC report is built
 * under (`qc/internal/report-pdf.service.ts`, which is where this approach comes
 * from — pdf-lib, standard fonts, an explicit allow-list, no headless browser).
 *
 *   1. **No vendor identity anywhere in the file.** We are the principal and the
 *      merchant of record. "Anywhere" includes the places nobody looks: the
 *      **filename** in `Content-Disposition`, the **document metadata** —
 *      Title/Author/Subject/Producer/Creator default to whatever the writing
 *      library felt like and are a real leak vector — and the **object key**,
 *      since a vendor slug in a storage path is the leak PHASE_05 Task 1 names.
 *      The key is `invoices/<invoice uuid>.pdf` for exactly that reason. Where
 *      the goods leave from is stated as `Supply Point A · Gurugram` and nothing
 *      finer: a city, never an address, never a name.
 *
 *      Every field drawn below is named individually. A row is never handed to
 *      the renderer to iterate over, because a blacklist fails open the moment
 *      somebody adds a column.
 *
 *   2. **Our purchase price is never printed.** `invoice_line.purchase_price` is
 *      stored because `chk_margin_line_complete` requires a MARGIN line to show
 *      its working to us; it is not on the document. What a Rule 32(5) invoice
 *      does state is the taxable value — the margin — because understating the
 *      buyer's input credit is the one thing their finance team must not be
 *      misled about, and `RULE_32_5_NARRATION` says so on the face of it.
 *
 * A proforma renders through the same code with `kind: 'PROFORMA'` and says on
 * its face that it is not a tax invoice, that it consumes no invoice number and
 * that no input credit may be claimed against it. One renderer, because two
 * would drift and the second one to drift would be the one nobody reads.
 */

/** A4 in points. This gets printed on an office printer and filed. */
const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const LEAD = 12;
const BODY = 9;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const WASH = rgb(0.95, 0.95, 0.96);

/**
 * Description, HSN, qty, rate, taxable, GST%, GST. RIGHT edges, in points.
 *
 * Right edges rather than left, because every column but the description holds a
 * number and numbers align on their last digit. The gaps are sized for the
 * widest value each column can hold at 9pt — `taxable` and `gst` both have to
 * fit nine characters (`134700.00`), and a column pair set 40pt apart printed
 * `18 15084.00` as one run with no gap between the rate and the amount.
 */
const COLUMNS = { hsn: 305, qty: 348, rate: 412, taxable: 478, rate_pct: 505, gst: 555 };

export interface RenderedDocument {
  bytes: Buffer;
  /** Order number and document kind only — never a vendor, never a serial list. */
  filename: string;
  documentNumber: string;
}

export interface RenderInput {
  kind: 'TAX' | 'PROFORMA';
  documentNumber: string;
  /** `YYYY-MM-DD`, Asia/Kolkata. */
  documentDate: string;
  issuer: Issuer;
  basis: OrderBillingBasis;
  /** One per consignment. A tax invoice has exactly one; a proforma has all. */
  documents: readonly PricedDocument[];
}

@Injectable()
export class InvoicePdfService {
  constructor(private readonly clock: ClockPort) {}

  async render(input: RenderInput): Promise<RenderedDocument> {
    const doc = await PDFDocument.create();
    const tax = input.kind === 'TAX';
    const title = tax ? 'Tax invoice' : 'Proforma invoice';

    // Set explicitly, every field of it. pdf-lib otherwise stamps its own
    // Producer and Creator, and a field left to a default is a field nobody is
    // checking the day something vendor-shaped gets written into it.
    doc.setTitle(`${title} ${input.documentNumber}`);
    doc.setSubject(`${title} from ${BRAND.legalEntity} against order ${input.basis.orderNumber}`);
    doc.setAuthor(BRAND.legalEntity);
    doc.setProducer(BRAND.legalEntity);
    doc.setCreator(BRAND.legalEntity);
    doc.setKeywords([title, input.basis.orderNumber, input.documentNumber]);
    doc.setCreationDate(this.clock.now());
    doc.setModificationDate(this.clock.now());

    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const sheet = new Sheet(doc, font, bold);

    this.drawHeader(sheet, input, title);
    this.drawParties(sheet, input);
    for (const consignment of input.documents) this.drawConsignment(sheet, input, consignment);
    this.drawGrandTotal(sheet, input);
    this.drawNarration(sheet, input);
    sheet.footers(title);

    // `useObjectStreams: false` keeps the document's own dictionaries — the
    // metadata among them — as plain objects rather than inside a compressed
    // object stream. It costs a few hundred bytes and it means the anti-leak
    // sweep can read what it is asserting about.
    const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));

    return {
      bytes,
      filename: `${BRAND.name}-${tax ? 'tax-invoice' : 'proforma'}-${input.basis.orderNumber}.pdf`,
      documentNumber: input.documentNumber,
    };
  }

  /* ----------------------------------------------------------------------
   * Sections. Every value drawn is named here.
   * ------------------------------------------------------------------- */

  private drawHeader(sheet: Sheet, input: RenderInput, title: string): void {
    sheet.text(BRAND.legalEntity, { size: 15, font: 'bold' });
    sheet.text(`${BRAND.name} · ${LEGAL_DISCLOSURE.website}`, { size: 8.5, colour: MUTED });
    sheet.gap(8);
    sheet.text(title.toUpperCase(), { size: 13, font: 'bold' });

    if (input.kind === 'PROFORMA') {
      // The single most important sentence on a proforma. A finance team that
      // files this as a tax invoice claims credit that does not exist yet.
      sheet.gap(2);
      sheet.text(
        'This is NOT a tax invoice. No GST is payable on it and no input tax credit may be claimed against it.',
        { size: 8.5, font: 'bold' },
      );
    }

    sheet.gap(6);
    sheet.rule();
    sheet.gap(6);

    const right = PAGE[0] / 2 + 10;
    const top = sheet.y;
    sheet.pair('Document number', input.documentNumber, MARGIN);
    sheet.pair('Document date', input.documentDate, MARGIN);
    sheet.pair(
      input.kind === 'TAX' ? 'Against order' : 'Order',
      input.basis.orderNumber,
      MARGIN,
    );
    const leftBottom = sheet.y;

    sheet.y = top;
    // The buyer's OWN reference, printed on our invoice because their accounts
    // payable matches on it. Absent renders as the words, never as a blank line
    // that reads like a reference nobody typed.
    sheet.pair('Your PO reference', input.basis.buyerPoNumber, right);
    sheet.pair('Your cost centre', input.basis.costCentre, right);
    sheet.pair('Reverse charge', 'No', right);
    sheet.y = Math.min(leftBottom, sheet.y);
    sheet.gap(6);
    sheet.rule();
  }

  private drawParties(sheet: Sheet, input: RenderInput): void {
    const { basis, issuer } = input;
    const right = PAGE[0] / 2 + 10;
    sheet.gap(8);
    const top = sheet.y;

    sheet.at(MARGIN, sheet.y, 'SELLER', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= LEAD;
    sheet.block(MARGIN, [
      issuer.legalName,
      `GSTIN ${issuer.gstin}`,
      LEGAL_DISCLOSURE.registeredOffice.line1,
      `${LEGAL_DISCLOSURE.registeredOffice.city} ${LEGAL_DISCLOSURE.registeredOffice.pincode}`,
      `${LEGAL_DISCLOSURE.registeredOffice.state} (${issuer.stateCode})`,
    ]);
    const sellerBottom = sheet.y;

    sheet.y = top;
    sheet.at(right, sheet.y, 'BILLED TO', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= LEAD;
    sheet.block(right, [
      basis.billedTo.legalName,
      `GSTIN ${basis.billedTo.gstin}`,
      basis.billingAddress.line1,
      basis.billingAddress.line2,
      `${basis.billingAddress.city} ${basis.billingAddress.pincode}`,
      `${basis.billingAddress.state} (${basis.billingAddress.stateCode})`,
    ]);

    sheet.y = Math.min(sellerBottom, sheet.y);
    sheet.gap(8);

    const shipTop = sheet.y;
    sheet.at(MARGIN, sheet.y, 'DELIVERED TO', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= LEAD;
    sheet.block(MARGIN, [
      basis.deliveryAddress.line1,
      basis.deliveryAddress.line2,
      `${basis.deliveryAddress.city} ${basis.deliveryAddress.pincode}`,
      `${basis.deliveryAddress.state} (${basis.deliveryAddress.stateCode})`,
      `Contact ${basis.deliveryAddress.contactName} · ${basis.deliveryAddress.contactMobile}`,
    ]);
    const shipBottom = sheet.y;

    sheet.y = shipTop;
    sheet.at(right, sheet.y, 'PLACE OF SUPPLY', { size: 7.5, font: 'bold', colour: MUTED });
    sheet.y -= LEAD;
    // s.10(1)(a): where the movement terminates. Stated on the face of the
    // document with the section that decided it, so a reviewer can check the
    // head against the rule rather than against a habit.
    sheet.block(right, [
      `${basis.deliveryAddress.state} (${basis.deliveryAddress.stateCode})`,
      input.documents[0]?.basis ?? null,
    ]);

    sheet.y = Math.min(shipBottom, sheet.y);
    sheet.gap(6);
    sheet.rule();
  }

  private drawConsignment(sheet: Sheet, input: RenderInput, c: PricedDocument): void {
    sheet.pageBreakIfBelow(190);
    sheet.gap(10);
    // A dispatch point, never a seller. City-level and no finer, which is what
    // keeps the supply point anonymous while still telling the buyer's receiving
    // bay where to expect the lorry from.
    sheet.text(`Dispatched from ${c.dispatchLabel}`, { size: 9.5, font: 'bold' });
    if (input.documents.length > 1) {
      sheet.text(
        `Delivery ${input.documents.indexOf(c) + 1} of ${input.documents.length} on this order`,
        { size: 8, colour: MUTED },
      );
    }
    sheet.gap(4);

    this.drawLineHeader(sheet);
    for (const line of c.lines) this.drawLine(sheet, line, c);
    this.drawFreight(sheet, c);
    this.drawTotals(sheet, c);
  }

  private drawLineHeader(sheet: Sheet): void {
    sheet.page.drawRectangle({
      x: MARGIN,
      y: sheet.y - 3,
      width: PAGE[0] - MARGIN * 2,
      height: LEAD + 1,
      color: WASH,
    });
    sheet.at(MARGIN + 3, sheet.y, 'DESCRIPTION', { size: 7, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.hsn, sheet.y, 'HSN', { size: 7, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.qty, sheet.y, 'QTY', { size: 7, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.rate, sheet.y, 'RATE', { size: 7, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.taxable, sheet.y, 'TAXABLE', { size: 7, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.rate_pct, sheet.y, 'GST%', { size: 7, font: 'bold', colour: MUTED });
    sheet.right(COLUMNS.gst, sheet.y, 'GST', { size: 7, font: 'bold', colour: MUTED });
    sheet.y -= LEAD + 3;
  }

  private drawLine(sheet: Sheet, line: PricedLine, c: PricedDocument): void {
    sheet.pageBreakIfBelow(120);
    sheet.at(MARGIN + 3, sheet.y, line.description, { size: BODY });
    sheet.right(COLUMNS.hsn, sheet.y, line.hsn, { size: BODY });
    sheet.right(COLUMNS.qty, sheet.y, String(line.qty), { size: BODY });
    sheet.right(COLUMNS.rate, sheet.y, line.unitPrice.toString(), { size: BODY });
    sheet.right(COLUMNS.taxable, sheet.y, line.taxableValue.toString(), { size: BODY });
    sheet.right(COLUMNS.rate_pct, sheet.y, String(line.gstRatePct), { size: BODY });
    sheet.right(COLUMNS.gst, sheet.y, line.gstAmount.toString(), { size: BODY });
    sheet.y -= LEAD;

    // The serial numbers ARE the goods. This document and the buyer's asset
    // register have to name the same machines, so they are on the invoice rather
    // than on an annexure that gets separated from it.
    for (const chunk of wrap(line.serialNumbers.join('  '), 74)) {
      sheet.at(MARGIN + 9, sheet.y, chunk, { size: 7.5, colour: MUTED });
      sheet.y -= 10;
    }
    if (c.valuationMethod === 'MARGIN') {
      sheet.at(MARGIN + 9, sheet.y, 'Taxable value is the margin under Rule 32(5).', {
        size: 7.5,
        colour: MUTED,
      });
      sheet.y -= 10;
    }
    sheet.y -= 2;
  }

  private drawFreight(sheet: Sheet, c: PricedDocument): void {
    sheet.at(MARGIN + 3, sheet.y, 'Freight and handling', { size: BODY });
    sheet.right(COLUMNS.hsn, sheet.y, '9965', { size: BODY });
    sheet.right(COLUMNS.qty, sheet.y, '1', { size: BODY });
    sheet.right(COLUMNS.rate, sheet.y, c.freight.toString(), { size: BODY });
    sheet.right(COLUMNS.taxable, sheet.y, c.freight.toString(), { size: BODY });
    sheet.right(COLUMNS.rate_pct, sheet.y, String(c.lines[0]?.gstRatePct ?? 18), { size: BODY });
    sheet.right(COLUMNS.gst, sheet.y, c.freightTax.total.toString(), { size: BODY });
    sheet.y -= LEAD;
    sheet.at(MARGIN + 9, sheet.y, 'Freight follows the principal supply and carries its rate.', {
      size: 7.5,
      colour: MUTED,
    });
    sheet.y -= 12;
    sheet.rule();
  }

  private drawTotals(sheet: Sheet, c: PricedDocument): void {
    sheet.gap(6);
    sheet.total('Taxable value', c.taxableValue);
    if (c.interState) {
      sheet.total(`IGST ${rate(c)}%`, c.igst);
    } else {
      sheet.total(`CGST ${rate(c) / 2}%`, c.cgst);
      // UTGST where a Union Territory charges it. The amount is carried in the
      // same column; the label on the printed page is what has to be right.
      sheet.total(`${c.stateTaxLabel} ${rate(c) / 2}%`, c.sgst);
    }
    sheet.total('Consignment total', c.total, true);
    sheet.gap(4);
  }

  private drawGrandTotal(sheet: Sheet, input: RenderInput): void {
    if (input.documents.length < 2) return;
    sheet.pageBreakIfBelow(90);
    sheet.gap(8);
    sheet.rule();
    sheet.gap(6);
    sheet.total(
      `Order total across ${input.documents.length} deliveries`,
      Money.sum(input.documents.map((d) => d.total)),
      true,
    );
  }

  private drawNarration(sheet: Sheet, input: RenderInput): void {
    // Four short notes at 10pt of leading, plus the rule above them. Set at 120
    // this pushed the whole block onto a page of its own with a third of page
    // one still empty, which reads as a document that ran out rather than one
    // that ended.
    sheet.pageBreakIfBelow(80);
    sheet.gap(10);
    sheet.rule();
    sheet.gap(8);

    const margin = input.documents.some((d) => d.valuationMethod === 'MARGIN');
    const notes: string[] = [];
    if (margin) notes.push(RULE_32_5_NARRATION);
    if (input.kind === 'PROFORMA') {
      notes.push(
        'A tax invoice is issued when the machines leave the supply point, and it is the ' +
          'document to claim input tax credit against.',
      );
    }
    notes.push(
      `${BRAND.legalEntity} is the seller on this order. There is one seller and one invoice.`,
    );
    notes.push(
      `Queries: ${LEGAL_DISCLOSURE.customerCare.email} · ${LEGAL_DISCLOSURE.customerCare.phone} · ${LEGAL_DISCLOSURE.customerCare.hours}`,
    );

    for (const note of notes) {
      for (const chunk of wrap(note, 118)) {
        sheet.at(MARGIN, sheet.y, chunk, { size: 7.5, colour: MUTED });
        sheet.y -= 10;
      }
      sheet.y -= 2;
    }
  }
}

/* ==========================================================================
 * Drawing
 * ======================================================================== */

const rate = (c: PricedDocument): number => c.lines[0]?.gstRatePct ?? 18;

/**
 * A cursor over the document: pages, a running `y`, and the handful of line
 * kinds this document draws.
 *
 * A near-twin of the one in `qc/internal/report-pdf.service.ts`, and deliberately
 * a copy rather than a shared helper: it is private to that file, modules never
 * cross-import, and a `packages/ui`-style layout package for two PDF layouts
 * would be a third place to keep true. What the two files share is the *rule* —
 * an explicit allow-list, no row handed to a renderer — not a code path.
 */
class Sheet {
  page: PDFPage;
  y: number;
  readonly fonts: { regular: PDFFont; bold: PDFFont };
  private readonly pages: PDFPage[] = [];

  constructor(
    readonly doc: PDFDocument,
    regular: PDFFont,
    bold: PDFFont,
  ) {
    this.fonts = { regular, bold };
    this.page = doc.addPage(PAGE);
    this.pages.push(this.page);
    this.y = PAGE[1] - MARGIN - 12;
  }

  newPage(): void {
    this.page = this.doc.addPage(PAGE);
    this.pages.push(this.page);
    this.y = PAGE[1] - MARGIN - 12;
  }

  /** Break before a block that would otherwise be orphaned across the fold. */
  pageBreakIfBelow(points: number): void {
    if (this.y < MARGIN + points) this.newPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  at(
    x: number,
    y: number,
    value: string,
    opts: { size?: number; font?: 'regular' | 'bold'; colour?: typeof INK } = {},
  ): void {
    this.page.drawText(pdfSafe(value), {
      x,
      y,
      size: opts.size ?? BODY,
      font: opts.font === 'bold' ? this.fonts.bold : this.fonts.regular,
      color: opts.colour ?? INK,
    });
  }

  /** Right-aligned at `x`. Every number on this document is right-aligned. */
  right(
    x: number,
    y: number,
    value: string,
    opts: { size?: number; font?: 'regular' | 'bold'; colour?: typeof INK } = {},
  ): void {
    const size = opts.size ?? BODY;
    const font = opts.font === 'bold' ? this.fonts.bold : this.fonts.regular;
    const text = pdfSafe(value);
    this.at(x - font.widthOfTextAtSize(text, size), y, text, opts);
  }

  text(
    value: string,
    opts: { size?: number; font?: 'regular' | 'bold'; colour?: typeof INK } = {},
  ): void {
    this.at(MARGIN, this.y, value, opts);
    this.y -= (opts.size ?? BODY) + 3;
  }

  /** A stack of lines in one column. `null` entries are simply absent. */
  block(x: number, lines: ReadonlyArray<string | null>): void {
    for (const line of lines) {
      if (line === null || line.trim() === '') continue;
      this.at(x, this.y, line, { size: 8.5 });
      this.y -= 11;
    }
  }

  /**
   * A labelled value in a column. `null` prints the words rather than a blank —
   * a blank beside "Your PO reference" reads as a reference nobody typed.
   */
  pair(label: string, value: string | null, x: number): void {
    this.at(x, this.y, label, { size: 7.5, colour: MUTED });
    this.at(x + 96, this.y, value ?? 'None given', {
      size: 8.5,
      font: value === null ? 'regular' : 'bold',
      colour: value === null ? MUTED : INK,
    });
    this.y -= LEAD;
  }

  total(label: string, amount: Money, emphatic = false): void {
    this.right(COLUMNS.taxable, this.y, label, {
      size: emphatic ? 9.5 : BODY,
      font: emphatic ? 'bold' : 'regular',
    });
    this.right(COLUMNS.gst, this.y, amount.toString(), {
      size: emphatic ? 9.5 : BODY,
      font: emphatic ? 'bold' : 'regular',
    });
    this.y -= LEAD;
  }

  rule(): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE[0] - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 4;
  }

  /** The same footer on every page, so a page separated from the file still names itself. */
  footers(title: string): void {
    this.pages.forEach((page, i) => {
      page.drawText(
        pdfSafe(
          `${title} · ${BRAND.legalEntity} · computer generated, valid without signature · page ${i + 1} of ${this.pages.length}`,
        ),
        { x: MARGIN, y: MARGIN - 12, size: 7, font: this.fonts.regular, color: MUTED },
      );
    });
  }
}

/**
 * Punctuation that has a Latin-1 equivalent, mapped rather than dropped.
 *
 * The em dash matters more here than it looks. Our own constants are typeset —
 * `LEGAL_DISCLOSURE.customerCare.hours` is "Mon–Sat, 10:00–18:00 IST" and the
 * place-of-supply basis carries an em dash — so dropping them printed
 * "Mon Sat, 10:00 18:00 IST" and "s.10(1)(a) IGST Act place of supply is…" on a
 * document a buyer's auditor reads. A hyphen is right; a hole is not.
 */
const TRANSLITERATE: ReadonlyArray<readonly [RegExp, string]> = [
  [/[–—−]/g, '-'],
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
  [/[™®]/g, ''],
  [/₹/g, 'Rs '],
];

/**
 * The standard PDF fonts encode WinAnsi, which stops at U+00FF. Model names
 * arrive from a third-party catalogue and carry trademark signs and smart
 * quotes; an unencodable character makes the writer throw, so without this the
 * whole invoice fails to generate because a laptop's model name ends in a "™".
 * Latin-1 and below is kept, the middle dot included.
 */
function pdfSafe(value: string): string {
  let out = value;
  for (const [pattern, replacement] of TRANSLITERATE) out = out.replace(pattern, replacement);
  return out.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Break on spaces at `width` characters. Serial lists and narration only. */
function wrap(value: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (line.length + word.length + 1 > width && line !== '') {
      out.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') out.push(line);
  return out;
}
