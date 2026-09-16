import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { BRAND, LEGAL_DISCLOSURE, formatRegisteredOffice } from '@trugrade/config';
import { Money } from '@trugrade/contracts';

/**
 * One letterhead, for every document this platform prints.
 *
 * There were two PDF renderers before this file — the tax invoice and the QC
 * report — and each drew its own header. Adding a purchase order and an order
 * confirmation that each drew a third and a fourth is how a brand ends up with
 * four slightly different logos and three spellings of its own registered
 * office. So the drawing primitives and the letterhead live here, and every
 * renderer is a caller.
 *
 * It lives in `shared/pdf/` rather than a workspace package deliberately: these
 * are only ever rendered server-side, both existing renderers already live in
 * this app, and a new package would add a build step and a version boundary for
 * no consumer. Stated once here so the next person does not have to re-decide it.
 *
 * The primitives are lifted from `invoice-pdf.service.ts` unchanged, including
 * `pdfSafe` — the standard PDF fonts encode WinAnsi and stop at U+00FF, so a
 * laptop model ending in a trademark sign makes the writer throw and the whole
 * document fail to generate.
 */

/** A4 in points. These get printed on an office printer and filed. */
export const PAGE: [number, number] = [595.28, 841.89];
export const MARGIN = 40;
export const LEAD = 12;
export const BODY = 9;
export const INK = rgb(0.09, 0.09, 0.11);
export const MUTED = rgb(0.42, 0.42, 0.46);
export const RULE = rgb(0.82, 0.82, 0.85);
export const WASH = rgb(0.95, 0.95, 0.96);

export interface RenderedDocument {
  bytes: Buffer;
  /** Never a vendor, never a serial list. */
  filename: string;
  documentNumber: string;
}

/** A document's own identity block, drawn under the letterhead. */
export interface LetterheadInput {
  title: string;
  documentNumber: string;
  /** `YYYY-MM-DD`, Asia/Kolkata. */
  date: string;
  /** "ORIGINAL FOR RECIPIENT", "VENDOR COPY" — whatever this copy is for. */
  copyLabel?: string | null;
  /** A sentence that must appear above everything else, e.g. a proforma warning. */
  warning?: string | null;
}

export async function newSheet(): Promise<Sheet> {
  const doc = await PDFDocument.create();
  // Metadata is a real leak vector: Title/Author/Producer default to whatever
  // the library felt like. Every document sets them explicitly.
  doc.setAuthor(BRAND.legalEntity);
  doc.setProducer(BRAND.legalEntity);
  doc.setCreator(BRAND.legalEntity);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return new Sheet(doc, regular, bold);
}

/**
 * The letterhead: who is issuing this, from where, under what registration.
 *
 * `cin` is null in `brand.ts` on purpose — the company's MCA record is not live
 * — so it renders as "Not yet published" rather than a blank or, worse, a
 * placeholder that looks like a number. An absence stated is a fact; an absence
 * drawn as a gap is a document somebody has to ring up about.
 */
export function drawLetterhead(sheet: Sheet, input: LetterheadInput): void {
  sheet.text(BRAND.legalEntity, { size: 15, font: 'bold' });
  sheet.text(`${BRAND.name} · ${LEGAL_DISCLOSURE.website}`, { size: 8.5, colour: MUTED });
  sheet.text(formatRegisteredOffice(), { size: 7.5, colour: MUTED });
  sheet.text(
    `GSTIN ${LEGAL_DISCLOSURE.gstin} · CIN ${LEGAL_DISCLOSURE.cin ?? 'Not yet published'}`,
    { size: 7.5, colour: MUTED },
  );

  sheet.gap(8);
  sheet.text(input.title.toUpperCase(), { size: 13, font: 'bold' });
  if (input.copyLabel) {
    sheet.text(input.copyLabel.toUpperCase(), { size: 7.5, colour: MUTED });
  }
  if (input.warning) {
    sheet.gap(2);
    sheet.text(input.warning, { size: 8.5, font: 'bold' });
  }

  sheet.gap(6);
  sheet.rule();
  sheet.gap(6);
}

/**
 * The foot of every page: who to complain to, and where you are in the file.
 *
 * The grievance officer is r.4(4)-(5) of the Consumer Protection (E-Commerce)
 * Rules 2020 and is not optional. `brand.ts` still says "To be appointed before
 * launch" and that is what prints — the rule is satisfied by naming a real
 * person, and printing a name we do not have would satisfy nobody.
 */
export function drawFooters(sheet: Sheet, title: string): void {
  sheet.footers(title);
  sheet.grievanceBlock();
}

export class Sheet {
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

  /** A right-aligned label/amount pair. `labelX`/`amountX` are right edges. */
  total(
    label: string,
    amount: Money,
    emphatic = false,
    labelX = PAGE[0] - MARGIN - 90,
    amountX = PAGE[0] - MARGIN,
  ): void {
    this.right(labelX, this.y, label, {
      size: emphatic ? 9.5 : BODY,
      font: emphatic ? 'bold' : 'regular',
    });
    this.right(amountX, this.y, amount.toString(), {
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

  /**
   * The grievance officer, once, at the foot of the last page.
   *
   * r.4(4)-(5) requires a named person resident in India who acknowledges in 48
   * hours and redresses in a month. `brand.ts` has not appointed one yet and
   * says so in the string, which is what prints.
   */
  grievanceBlock(): void {
    const officer = LEGAL_DISCLOSURE.grievanceOfficer;
    this.page.drawText(
      pdfSafe(
        // r.4(5): acknowledged within 48 hours, redressed within one month.
        // Stated as the rule's own periods rather than invented service levels.
        `Grievance officer: ${officer.name} · ${officer.email} · ${officer.phone} · acknowledged within 48 hours, resolved within one month`,
      ),
      { x: MARGIN, y: MARGIN - 22, size: 7, font: this.fonts.regular, color: MUTED },
    );
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
export function pdfSafe(value: string): string {
  let out = value;
  for (const [pattern, replacement] of TRANSLITERATE) out = out.replace(pattern, replacement);
  return out
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Break on spaces at `width` characters. Serial lists and narration only. */
export function wrap(value: string, width: number): string[] {
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
