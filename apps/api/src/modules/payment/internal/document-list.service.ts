import { Injectable } from '@nestjs/common';
import { BRAND } from '@trugrade/config';
import type {
  OrderBillingBasis,
  OrderDocumentRow,
  OrderDocumentsView,
  ValuationMethod,
} from '../dto/invoice.dto';
import { InvoiceRepository, type InvoiceRow } from './invoice.repository';
import { InvoiceIssueService, istDate } from './invoice-issue.service';

/**
 * The documents on one order, as the buyer's finance team sees them.
 *
 * **The rule this file exists to hold: a document that does not exist yet is a
 * ROW, not an absence.** 03_UX_SPEC §3A.3 is emphatic about it — *"documents not
 * yet generated → each row shows when it will exist"* — and it is the same rule
 * as "a missing value never renders as a passing one", which this build has hit
 * about ten times. So every row below is present on every order, and the ones
 * that are not there yet carry `whenItWillExist` and **no `downloadPath`**. A
 * disabled download button would be the defect: it tells a buyer a file exists.
 *
 * The three moments are real and different, and each row says which is its own:
 *
 *   - a **proforma** exists as soon as the order is confirmed, because it is what
 *     a finance team raises the payment against;
 *   - a **tax invoice** is issued when the machines leave the supply point,
 *     because s.31(1)(a) CGST Act puts it at removal;
 *   - an **e-way bill** is generated at pickup, from the tax invoice, because
 *     Rule 138 binds it to the consignment actually moving.
 *
 * Two rows are `ELSEWHERE` rather than duplicated here. The QC report and the
 * wipe certificate are per MACHINE, not per order, and they already live on each
 * machine's passport. A copy on this screen would be a second place to keep
 * current, and the first one to go stale would be the one somebody printed.
 *
 * Nothing built here reads a vendor. `OrderBillingBasis` carries the anonymised
 * `Supply Point A · Gurugram` label and no supplier field exists on it at any
 * depth, so there is nothing on this payload to omit.
 */
@Injectable()
export class DocumentListService {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly invoices: InvoiceIssueService,
  ) {}

  async forOrder(basis: OrderBillingBasis): Promise<OrderDocumentsView> {
    const subOrderIds = basis.consignments.map((c) => c.subOrderId);
    const invoices = await this.repo.findBySubOrders(subOrderIds);
    const taxInvoices = new Map(
      invoices.filter((i) => i.type === 'TAX').map((i) => [i.subOrderId ?? '', i]),
    );
    const [ewayBills, creditNotes] = await Promise.all([
      this.repo.findEwayBills(invoices.map((i) => i.id)),
      this.repo.countCreditNotes(invoices.map((i) => i.id)),
    ]);
    const ewayByInvoice = new Map(ewayBills.map((e) => [e.invoiceId, e]));

    const base = `/api/buyer/orders/${encodeURIComponent(basis.orderNumber)}/documents`;
    const orderPath = `/account/orders/${encodeURIComponent(basis.orderNumber)}`;
    const rows: OrderDocumentRow[] = [];

    rows.push(await this.proforma(basis, base));

    const multiple = basis.consignments.length > 1;
    basis.consignments.forEach((consignment, index) => {
      const delivery = multiple
        ? `Delivery ${index + 1} of ${basis.consignments.length} · ${consignment.dispatchLabel}`
        : consignment.dispatchLabel;
      const invoice = taxInvoices.get(consignment.subOrderId) ?? null;
      rows.push(this.taxInvoice(basis, consignment.removed, delivery, invoice, base));
      rows.push(
        this.ewayBill(
          basis.cancelled,
          delivery,
          invoice,
          invoice === null ? null : (ewayByInvoice.get(invoice.id) ?? null),
        ),
      );
    });

    rows.push({
      id: 'qc-reports',
      kind: 'QC_REPORTS',
      status: 'ELSEWHERE',
      title: 'Inspection reports',
      description:
        'One report per machine — the twelve inspection areas, the photographs and the grade we ' +
        'awarded, with the rule set it was awarded under.',
      whenItWillExist: null,
      documentNumber: null,
      issuedOn: null,
      amount: null,
      valuationMethod: null,
      downloadPath: null,
      // A report belongs to a serial, not to an order. It lives on the machine's
      // own passport and this row points there rather than keeping a copy.
      elsewherePath: `${orderPath}/units`,
    });

    rows.push({
      id: 'wipe-certificates',
      kind: 'WIPE_CERTIFICATES',
      status: 'ELSEWHERE',
      title: 'Data-wipe certificates',
      description:
        'One certificate per machine, naming the standard, the method and the number of passes. ' +
        'Your IT team files these against the serial, so they sit on the machine, not on the order.',
      whenItWillExist: null,
      documentNumber: null,
      issuedOn: null,
      amount: null,
      valuationMethod: null,
      downloadPath: null,
      elsewherePath: `${orderPath}/units`,
    });

    rows.push({
      id: 'delivery-pod',
      kind: 'DELIVERY_POD',
      status: basis.cancelled ? 'NOT_APPLICABLE' : 'AWAITED',
      title: 'Proof of delivery',
      description:
        'Signed by whoever receives the machines, with the seal codes they checked at the door.',
      // Honest about the gap rather than promising a date. Nothing on this
      // platform writes a proof of delivery yet, and a row saying "after
      // delivery" would imply one appears on its own.
      whenItWillExist: basis.cancelled
        ? 'This order was cancelled, so nothing was ever delivered and nothing was signed for.'
        : 'Captured at handover, once delivery is scheduled on this order. Delivery tracking is ' +
          'not switched on yet, so no proof of delivery is recorded for any order.',
      documentNumber: null,
      issuedOn: null,
      amount: null,
      valuationMethod: null,
      downloadPath: null,
      elsewherePath: null,
    });

    rows.push({
      id: 'credit-notes',
      kind: 'CREDIT_NOTE',
      status: creditNotes > 0 ? 'ISSUED' : 'NOT_APPLICABLE',
      title: 'Credit notes',
      description:
        'A credit note reverses part of a tax invoice — it exists only after a return or a ' +
        'cancellation has been settled.',
      whenItWillExist:
        creditNotes > 0
          ? null
          : 'There is no return or cancellation on this order, so there is nothing to credit.',
      documentNumber: null,
      issuedOn: null,
      amount: null,
      valuationMethod: null,
      downloadPath: null,
      elsewherePath: null,
    });

    return {
      orderNumber: basis.orderNumber,
      issuedCount: rows.filter((r) => r.status === 'ISSUED').length,
      documentCount: rows.length,
      documents: rows,
    };
  }

  /* ----------------------------------------------------------------------
   * The rows
   * ------------------------------------------------------------------- */

  private async proforma(basis: OrderBillingBasis, base: string): Promise<OrderDocumentRow> {
    const common = {
      id: 'proforma',
      kind: 'PROFORMA' as const,
      title: 'Proforma invoice',
      description:
        'What your finance team raises the payment against. It is not a tax invoice and no input ' +
        'tax credit may be claimed against it.',
      documentNumber: null,
      issuedOn: null,
      amount: null,
      valuationMethod: null,
      elsewherePath: null,
    };

    if (basis.cancelled) {
      return {
        ...common,
        status: 'NOT_APPLICABLE',
        whenItWillExist: 'This order was cancelled, so there is nothing to pay and nothing to bill.',
        downloadPath: null,
      };
    }
    if (!basis.confirmed) {
      return {
        ...common,
        status: 'AWAITED',
        whenItWillExist:
          'A proforma is issued the moment this order is confirmed. It is still waiting on an ' +
          'approval inside your organisation.',
        downloadPath: null,
      };
    }
    const total = await this.invoices.proformaTotal(basis);
    if (total === null) {
      // We are the seller, and without our own GST registration there is no
      // seller to put on the document. A real state, not an error page: it is
      // our configuration that is missing, not the buyer's order.
      return {
        ...common,
        status: 'AWAITED',
        whenItWillExist:
          'We cannot raise a document against this order until our own GST registration is on ' +
          'file. That is our problem, not yours — support has been told.',
        downloadPath: null,
      };
    }

    return {
      ...common,
      status: 'ISSUED',
      whenItWillExist: null,
      // Deterministic, and deliberately not from the GST series: a proforma is
      // not a tax document, and consuming a statutory number for one would put a
      // gap in the series the day the order changes.
      documentNumber: `PRO/${basis.orderNumber}`,
      issuedOn: istDate(basis.placedAt),
      // The figure the buyer's finance team raises the payment against. The same
      // `price()` the tax invoice uses, so the board and the document are one
      // calculation rather than two that agree today.
      amount: total.toString(),
      // Flagged BEFORE the money moves, not at invoice time. Rule 32(5) leaves a
      // buyer thinner input credit than they would assume, and a procurement
      // head who finds that out from the tax invoice does not buy again
      // (03_UX_SPEC §3A.4). Any margin line on the order sets it: the honest
      // signal is "some of this carries limited credit", and silence is worse
      // than an imprecise warning.
      valuationMethod: basis.consignments.some((c) =>
        c.lines.some((l) => l.valuationMethod === 'MARGIN'),
      )
        ? 'MARGIN'
        : 'REGULAR',
      downloadPath: `${base}/proforma`,
    };
  }

  private taxInvoice(
    basis: OrderBillingBasis,
    removed: boolean,
    delivery: string,
    invoice: InvoiceRow | null,
    base: string,
  ): OrderDocumentRow {
    const common = {
      kind: 'TAX_INVOICE' as const,
      title: `Tax invoice · ${delivery}`,
      description: `Our invoice to you. ${BRAND.legalEntity} is the seller on this order, so there is one seller and one invoice per delivery.`,
      elsewherePath: null,
    };

    if (invoice) {
      return {
        ...common,
        id: invoice.id,
        status: 'ISSUED',
        whenItWillExist: null,
        documentNumber: invoice.invoiceNumber,
        issuedOn: istDate(invoice.invoiceDate),
        amount: invoice.total,
        valuationMethod: invoice.valuationMethod satisfies ValuationMethod,
        downloadPath: `${base}/${invoice.id}`,
      };
    }

    return {
      ...common,
      // Stable across reloads so the screen does not reshuffle. Not an invoice
      // id, because there is no invoice — inventing one would be inventing the
      // document.
      id: `tax-invoice-awaited-${delivery}`,
      status: basis.cancelled ? 'NOT_APPLICABLE' : 'AWAITED',
      whenItWillExist: basis.cancelled
        ? 'This order was cancelled before dispatch, so no tax invoice was raised.'
        : removed
          ? 'These machines have left the supply point and the invoice is being raised now. It ' +
            'appears here within a few minutes.'
          : 'A tax invoice is raised when these machines leave the supply point, not before — ' +
            'that is what the law requires of us, and it is why nothing is billed on an order ' +
            'still being picked.',
      documentNumber: null,
      issuedOn: null,
      amount: null,
      valuationMethod: null,
      downloadPath: null,
    };
  }

  private ewayBill(
    cancelled: boolean,
    delivery: string,
    invoice: InvoiceRow | null,
    bill: { ewbNumber: string | null; ewbDate: Date | null; validUpto: Date | null } | null,
  ): OrderDocumentRow {
    const common = {
      kind: 'EWAY_BILL' as const,
      title: `E-way bill · ${delivery}`,
      description:
        'The document the consignment travels under. It is generated from the tax invoice and ' +
        'stays with the driver; you do not need it to take delivery.',
      amount: null,
      valuationMethod: null,
      // We generate the e-way bill on the GST portal, which returns a number and
      // not a file we hold. A download here would have to be a document we made
      // up, so the number is the whole row.
      downloadPath: null,
      elsewherePath: null,
    };

    if (bill?.ewbNumber) {
      return {
        ...common,
        id: `eway-${invoice?.id ?? delivery}`,
        status: 'ISSUED',
        whenItWillExist: null,
        documentNumber: bill.ewbNumber,
        issuedOn: bill.ewbDate ? istDate(bill.ewbDate) : null,
      };
    }

    return {
      ...common,
      id: `eway-awaited-${delivery}`,
      // On a cancelled order nothing will ever move, so "at pickup" would be a
      // promise about a lorry that is not coming. AWAITED means "later"; this is
      // "never", and the two must not read the same.
      status: cancelled ? 'NOT_APPLICABLE' : 'AWAITED',
      whenItWillExist: cancelled
        ? 'This order was cancelled before dispatch, so nothing ever moved and no e-way bill was generated.'
        : 'The e-way bill is generated at pickup, from the tax invoice — Rule 138 ties it to the ' +
          'consignment that is actually moving, so it cannot exist before the lorry does.',
      documentNumber: null,
      issuedOn: null,
    };
  }
}
