import { Injectable, Logger } from '@nestjs/common';
import {
  financialYearOf,
  marginTaxableValue,
  Money,
  platformToBuyer,
  resolveTaxSplit,
  stateTaxLabel,
  TIMEZONE,
  type TaxSplit,
} from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { ObjectStorePort } from '../../../shared/adapters/ports';
import { PreconditionFailedError } from '../../../shared/errors/domain-errors';
import { AuditService } from '../../identity';
import type {
  BillingConsignment,
  IssuedInvoice,
  OrderBillingBasis,
  ValuationMethod,
} from '../dto/invoice.dto';
import { InvoiceRepository } from './invoice.repository';
import { InvoicePdfService, type RenderedDocument } from './invoice-pdf.service';

/**
 * Issuing the buyer's tax invoice, and pricing the proforma that precedes it.
 *
 * **We are the seller.** Back-to-back principal: at the moment a customer
 * orders we buy that serial from a supply point and sell it on our own invoice,
 * and the goods move directly. So there are two supplies and two invoices, and
 * only one of them is this file's business. The vendor's invoice to us is a
 * `procurement` document and is not buyer-reachable at any depth.
 *
 * Three decisions are worth stating because each has a wrong answer that looks
 * right:
 *
 * **1. A tax invoice is issued at REMOVAL, not at payment.** s.31(1)(a) CGST
 * Act: for a supply of goods the invoice is issued before or at the time of
 * removal for delivery. Issuing on payment would be late for a credit order and
 * early for a prepaid one that has not been picked. `BillingConsignment.removed`
 * is the trigger, and `ordering` computes it because `ordering` owns the status.
 *
 * **2. One invoice per consignment, not one per order.** Rule 138 binds an
 * e-way bill to a consignment and `payment.eway_bill.invoice_id` is UNIQUE, so
 * an order dispatching from three supply points needs three invoices — folding
 * them into one would leave two consignments with no e-way bill they could
 * legally travel under. To the buyer they read as "Delivery 1 of 3", which is
 * the vocabulary the order screens already use.
 *
 * **3. The proforma is not stored, and that is deliberate.** It is not a
 * statutory document: it has no place in the GST series, it consumes no number,
 * and it is entirely derived from the order. Storing it would need a writer in
 * the checkout transaction and would produce a document that goes stale the
 * moment the order changes. It is rendered on demand, numbered `PRO/<order>`
 * deterministically, and it says on its face that it is not a tax invoice.
 *
 * Every figure below comes from `@trugrade/contracts` — `platformToBuyer`,
 * `resolveTaxSplit`, `marginTaxableValue`, `Money`. There is no arithmetic here
 * that is not a call into one of them. This repository has already had to fix a
 * `landedPrice` where two implementations of one number disagreed, and an
 * invoice that disagrees with the order it bills is a GST notice rather than a
 * rounding curiosity.
 */

/** One line, priced. `purchasePrice` never leaves this module. */
export interface PricedLine {
  skuId: string | null;
  description: string;
  hsn: string;
  qty: number;
  unitPrice: Money;
  serialNumbers: readonly string[];
  valuationMethod: ValuationMethod;
  purchasePrice: Money | null;
  /** Rule 32(5) value on a MARGIN line; the full value on a REGULAR one. */
  taxableValue: Money;
  gstRatePct: number;
  cgst: Money;
  sgst: Money;
  igst: Money;
  /** cgst + sgst + igst. Held so the two are never separately derived. */
  gstAmount: Money;
}

/** One consignment, priced. The shape both the PDF and the INSERT read from. */
export interface PricedDocument {
  subOrderId: string;
  dispatchLabel: string;
  valuationMethod: ValuationMethod;
  lines: readonly PricedLine[];
  /** Goods at full sale price. Not the taxable value — see MARGIN, below. */
  goods: Money;
  freight: Money;
  freightTax: TaxSplit;
  /** Goods plus freight, before tax. What the invoice calls "taxable value". */
  taxableValue: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  tax: Money;
  total: Money;
  interState: boolean;
  placeOfSupply: string;
  stateTaxLabel: 'SGST' | 'UTGST';
  basis: string;
}

/** Our own registration, as the seller on the document. */
export interface Issuer {
  orgId: string;
  gstin: string;
  legalName: string;
  tradeName: string | null;
  stateCode: string;
}

/**
 * The rate a consignment's freight is taxed at when the consignment somehow has
 * no lines to take one from. Laptops are 18% under HSN 8471; nothing on this
 * platform is anything else, and a consignment with no lines is a bug rather
 * than a rate question.
 */
const DEFAULT_GST_RATE_PCT = 18;

@Injectable()
export class InvoiceIssueService {
  private readonly logger = new Logger(InvoiceIssueService.name);

  constructor(
    private readonly repo: InvoiceRepository,
    private readonly pdf: InvoicePdfService,
    private readonly store: ObjectStorePort,
    private readonly clock: ClockPort,
    private readonly audit: AuditService,
  ) {}

  /**
   * Issue a tax invoice for every consignment that has been removed and does not
   * already have one.
   *
   * Idempotent by consignment: an invoice already on file is skipped rather than
   * duplicated, because `payment.next_invoice_number` is not free — every call
   * consumes a number, and a number consumed by a duplicate is a gap in the
   * series once the duplicate is deleted.
   */
  async issue(basis: OrderBillingBasis): Promise<IssuedInvoice[]> {
    if (basis.cancelled || !basis.confirmed) return [];

    const issuer = await this.requireIssuer();
    const financialYear = financialYearOf(this.today());
    if (!(await this.repo.hasSeries(issuer.gstin, financialYear))) {
      throw new PreconditionFailedError(
        `No invoice series is configured for GSTIN ${issuer.gstin} in ${financialYear}. ` +
          'A tax invoice number must be a gapless sequence per series per financial year, so ' +
          'the series is configured before the first invoice, not derived from it.',
        { reason: 'no_invoice_series', gstin: issuer.gstin, financialYear },
      );
    }

    const already = new Set(
      (await this.repo.findBySubOrders(basis.consignments.map((c) => c.subOrderId)))
        .filter((i) => i.type === 'TAX')
        .map((i) => i.subOrderId),
    );

    const issued: IssuedInvoice[] = [];
    for (const consignment of basis.consignments) {
      if (!consignment.removed || already.has(consignment.subOrderId)) continue;

      const priced = this.price(basis, consignment, issuer.stateCode);
      const written = await this.repo.insertTaxInvoice(
        {
          subOrderId: consignment.subOrderId,
          issuerOrgId: issuer.orgId,
          recipientOrgId: basis.buyerOrgId,
          invoiceDate: this.today(),
          placeOfSupply: priced.placeOfSupply,
          taxableValue: priced.taxableValue.toString(),
          cgst: priced.cgst.toString(),
          sgst: priced.sgst.toString(),
          igst: priced.igst.toString(),
          total: priced.total.toString(),
          valuationMethod: priced.valuationMethod,
          lines: priced.lines.map((l) => ({
            skuId: l.skuId,
            description: l.description,
            hsn: l.hsn,
            qty: l.qty,
            unitPrice: l.unitPrice.toString(),
            taxableValue: l.taxableValue.toString(),
            gstRate: l.gstRatePct,
            gstAmount: l.gstAmount.toString(),
            serialNumbers: l.serialNumbers,
            valuationMethod: l.valuationMethod,
            // `chk_margin_line_complete`: a MARGIN line must show its working
            // and a REGULAR line must not pretend to. Stored, never printed —
            // our purchase price is not the buyer's business and is one field
            // away from being a vendor's commercial terms.
            purchasePrice: l.valuationMethod === 'MARGIN' ? (l.purchasePrice?.toString() ?? null) : null,
            marginValue: l.valuationMethod === 'MARGIN' ? l.taxableValue.toString() : null,
          })),
        },
        issuer.gstin,
        financialYear,
      );

      const rendered = await this.pdf.render({
        kind: 'TAX',
        documentNumber: written.invoiceNumber,
        documentDate: this.today(),
        issuer,
        basis,
        documents: [priced],
      });
      const key = `invoices/${written.id}.pdf`;
      await this.store.put(key, rendered.bytes, 'application/pdf');
      await this.repo.setPdfKey(written.id, key);

      await this.audit.record({
        action: 'payment.invoice.issued',
        entityType: 'payment.invoice',
        entityId: written.id,
        after: {
          invoiceNumber: written.invoiceNumber,
          orderNumber: basis.orderNumber,
          total: priced.total.toString(),
          valuationMethod: priced.valuationMethod,
        },
      });

      issued.push({
        invoiceId: written.id,
        subOrderId: consignment.subOrderId,
        invoiceNumber: written.invoiceNumber,
        total: priced.total.toString(),
        valuationMethod: priced.valuationMethod,
      });
    }

    if (issued.length > 0) {
      this.logger.log(`Issued ${issued.length} tax invoice(s) for order ${basis.orderNumber}`);
    }
    return issued;
  }

  /**
   * The proforma for a whole order, rendered on demand.
   *
   * Every consignment on one document, because the buyer's finance team raises
   * one payment against one order. It carries no invoice number from the
   * statutory series — see the class comment.
   */
  async renderProforma(basis: OrderBillingBasis): Promise<RenderedDocument> {
    const issuer = await this.requireIssuer();
    return this.pdf.render({
      kind: 'PROFORMA',
      documentNumber: `PRO/${basis.orderNumber}`,
      documentDate: this.today(),
      issuer,
      basis,
      documents: basis.consignments.map((c) => this.price(basis, c, issuer.stateCode)),
    });
  }

  /**
   * What the whole order comes to, for the proforma row on the documents board.
   *
   * `null` when we have no GST registration on file, because the split cannot be
   * resolved without our state — and a total we cannot stand behind must not be
   * drawn as one. The board turns that null into a row that says so rather than
   * into a blank.
   *
   * The same `price()` the invoice uses, over the same basis, so the figure on
   * the board and the figure on the document are one calculation. Two would
   * disagree eventually, and the one that disagreed would be the one somebody
   * paid against.
   */
  async proformaTotal(basis: OrderBillingBasis): Promise<Money | null> {
    const issuer = await this.repo.issuer();
    if (!issuer) return null;
    return Money.sum(
      basis.consignments.map((c) => this.price(basis, c, issuer.stateCode).total),
    );
  }

  /** The rendered bytes for an already-issued tax invoice, re-derived if lost. */
  async renderTaxInvoice(
    basis: OrderBillingBasis,
    invoice: { id: string; invoiceNumber: string; invoiceDate: Date; subOrderId: string | null },
  ): Promise<RenderedDocument> {
    const issuer = await this.requireIssuer();
    const consignment = basis.consignments.find((c) => c.subOrderId === invoice.subOrderId);
    if (!consignment) {
      throw new PreconditionFailedError(
        'This invoice does not belong to this order.',
        { reason: 'invoice_not_on_order' },
      );
    }
    return this.pdf.render({
      kind: 'TAX',
      documentNumber: invoice.invoiceNumber,
      documentDate: istDate(invoice.invoiceDate),
      issuer,
      basis,
      documents: [this.price(basis, consignment, issuer.stateCode)],
    });
  }

  /* ----------------------------------------------------------------------
   * Pricing
   * ------------------------------------------------------------------- */

  /**
   * One consignment, priced.
   *
   * **The place of supply is the DELIVERY state, never the billing state.** A
   * Delhi-registered buyer taking delivery in Bengaluru is an inter-state supply
   * and billing-address logic would put CGST+SGST on an invoice that owes IGST.
   * `platformToBuyer` takes `deliveryState` as a required parameter for exactly
   * that reason, and there is no billing state in scope here to reach for by
   * mistake.
   *
   * The split is resolved once per line and carried, rather than recomputed
   * wherever a head is needed. Two calls with the same inputs agree today; the
   * `landedPrice` defect this codebase already fixed is what happens when one of
   * them is later given a different input by somebody who did not know the other
   * existed.
   */
  private price(
    basis: OrderBillingBasis,
    consignment: BillingConsignment,
    ourStateCode: string,
  ): PricedDocument {
    const methods = new Set(consignment.lines.map((l) => l.valuationMethod));
    if (methods.size > 1) {
      // One invoice is single-channel structurally — `fk_line_matches_invoice_channel`
      // gives a line whose channel differs from its parent no parent to point
      // at. Splitting the consignment in two would leave one half with no e-way
      // bill it could legally travel under, so this refuses instead.
      throw new PreconditionFailedError(
        'This consignment mixes margin-scheme and regular-scheme machines, and one invoice ' +
          'cannot carry both. The dispatch has to be split before it can be invoiced.',
        { reason: 'mixed_valuation_method', subOrderId: consignment.subOrderId },
      );
    }
    const valuationMethod: ValuationMethod = methods.has('MARGIN') ? 'MARGIN' : 'REGULAR';
    const placeOfSupply = basis.deliveryAddress.stateCode;
    const ratePct = consignment.lines[0]?.gstRatePct ?? DEFAULT_GST_RATE_PCT;

    const lines: PricedLine[] = consignment.lines.map((line) => {
      const unitPrice = Money.parse(line.unitPrice);
      // Rule 32(5) is per serial and never pooled: a weighted average breaks the
      // scheme, and a negative margin contributes zero rather than offsetting
      // another serial's. `marginTaxableValue` is the one implementation of it.
      const purchasePrice = line.purchasePrice === null ? null : Money.parse(line.purchasePrice);
      const taxableValue =
        line.valuationMethod === 'MARGIN' && purchasePrice !== null
          ? Money.sum(line.serialNumbers.map(() => marginTaxableValue(unitPrice, purchasePrice)))
          : unitPrice.times(line.qty);
      const split = platformToBuyer({
        platformState: ourStateCode,
        deliveryState: placeOfSupply,
        taxableAmount: taxableValue,
        ratePct: line.gstRatePct,
      });
      return {
        skuId: line.skuId,
        description: line.description,
        hsn: line.hsn,
        qty: line.qty,
        unitPrice,
        serialNumbers: line.serialNumbers,
        valuationMethod: line.valuationMethod,
        purchasePrice,
        taxableValue,
        gstRatePct: line.gstRatePct,
        cgst: split.cgst,
        sgst: split.sgst,
        igst: split.igst,
        gstAmount: split.total,
      };
    });

    // Freight follows the principal supply, so it carries the same rate and the
    // same head — and it is taxed in full even on a MARGIN invoice, because
    // Rule 32(5) values the second-hand GOODS, not the carriage of them.
    const freight = Money.parse(consignment.freight);
    const freightTax = resolveTaxSplit({
      supplierState: ourStateCode,
      placeOfSupply,
      taxableAmount: freight,
      ratePct,
      basis: 's.10(1)(a) IGST Act — freight follows the principal supply',
    });

    const cgst = Money.sum(lines.map((l) => l.cgst)).add(freightTax.cgst);
    const sgst = Money.sum(lines.map((l) => l.sgst)).add(freightTax.sgst);
    const igst = Money.sum(lines.map((l) => l.igst)).add(freightTax.igst);
    const tax = cgst.add(sgst).add(igst);
    const goods = Money.sum(lines.map((l) => l.unitPrice.times(l.qty)));

    return {
      subOrderId: consignment.subOrderId,
      dispatchLabel: consignment.dispatchLabel,
      valuationMethod,
      lines,
      goods,
      freight,
      freightTax,
      // What tax was charged ON. On a MARGIN invoice that is the margin, not the
      // sale price, and printing the sale price here would overstate the credit
      // the buyer's finance team may claim — the one number they must not be
      // misled about.
      taxableValue: Money.sum(lines.map((l) => l.taxableValue)).add(freight),
      cgst,
      sgst,
      igst,
      tax,
      // Goods at their full price plus freight plus the tax actually charged.
      // Never `taxableValue + tax`: on a MARGIN invoice that would bill the
      // machine at its margin.
      total: goods.add(freight).add(tax),
      interState: freightTax.interState,
      placeOfSupply,
      stateTaxLabel: stateTaxLabel(placeOfSupply),
      basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
    };
  }

  private async requireIssuer(): Promise<Issuer> {
    const issuer = await this.repo.issuer();
    if (!issuer) {
      // We are the merchant of record; without our own registration there is no
      // seller on the document. Refusing is the only honest answer — an invoice
      // with a blank GSTIN is not a tax invoice, it is a piece of paper.
      throw new PreconditionFailedError(
        'No active GST registration is on file for the seller, so no tax invoice can be issued.',
        { reason: 'no_issuer_registration' },
      );
    }
    return issuer;
  }

  /** `YYYY-MM-DD` on the Asia/Kolkata calendar (VR-160). */
  private today(): string {
    return istDate(this.clock.now());
  }
}

/** `YYYY-MM-DD` on the Asia/Kolkata calendar. A date, not a log line (VR-160). */
export function istDate(when: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(when);
}
