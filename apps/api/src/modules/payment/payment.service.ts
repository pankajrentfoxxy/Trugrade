import { Injectable } from '@nestjs/common';
import { ObjectStorePort } from '../../shared/adapters/ports';
import { NotFoundError } from '../../shared/errors/domain-errors';
import type {
  IssuedInvoice,
  OrderBillingBasis,
  OrderDocumentsView,
} from './dto/invoice.dto';
import { DocumentListService } from './internal/document-list.service';
import { InvoiceIssueService } from './internal/invoice-issue.service';
import { InvoiceRepository } from './internal/invoice.repository';
import type { RenderedDocument } from './internal/invoice-pdf.service';

/**
 * The public interface of the `payment` module.
 *
 * This interface is the future network contract (02_ARCHITECTURE.md §1.1 rule 4).
 * When `payment` is extracted into its own service the folder moves, the in-process
 * bus becomes SQS and the direct call becomes an HTTP client — and this interface
 * does not change. That is the whole point of writing it down now.
 *
 * Owns: customer invoices, invoice lines, e-way bills, payments, refunds, ledger entries, settlements, penalties, credit notes
 *
 * Other modules reach this through `src/modules/payment` (the barrel) and nothing
 * else. `internal/`, `entities/` and `dto/` are private, and the
 * `no-cross-module-import` lint rule makes that an error rather than a wish.
 *
 * **Every method here takes an `OrderBillingBasis` rather than an order id**, and
 * that is the seam doing its job rather than an inconvenience. `ordering` owns
 * the order and is the only module that may read it; `payment` owns the invoice
 * and is the only module that may issue one. Passing a value rather than a
 * handle means `payment` cannot reach back into `ordering."order"` for anything
 * it was not given — including, in particular, a vendor org id.
 *
 * As of T22 this module implements the invoice slice: the tax invoice, the
 * proforma that precedes it, and the state of the e-way bill that follows it.
 * Settlement, payouts, refunds, penalties and the ledger are Phase 7 proper and
 * remain unwritten — no method here pretends otherwise.
 */
export interface IPaymentService {
  /** Liveness of this module's own dependencies, surfaced on /health. */
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;

  /**
   * Every document on one order, existing or not, with the reason for each.
   *
   * Read-only: it never issues anything. A GET that quietly consumed an invoice
   * number would put a gap in the series the first time a bot crawled it.
   */
  documentsForOrder(basis: OrderBillingBasis): Promise<OrderDocumentsView>;

  /**
   * Issue the tax invoice for every consignment that has been removed and does
   * not already have one. Idempotent by consignment.
   */
  issueTaxInvoices(basis: OrderBillingBasis): Promise<IssuedInvoice[]>;

  /**
   * The bytes of one document on an order, by the id the list gave out.
   *
   * `null` when the caller's organisation has no such document — never a
   * refusal, because a refusal would confirm that somebody else's invoice
   * exists, and invoice numbers are a gapless sequence.
   */
  renderDocument(basis: OrderBillingBasis, documentId: string): Promise<RenderedDocument | null>;

  /**
   * A short-lived URL a browser can open the document at, and the filename.
   *
   * **Not a presigned S3 URL, and that distinction is the whole design.** A
   * presign publishes the object key as the path the browser fetches, and our
   * keys are not public identifiers — a key path carrying a supplier slug inside
   * a customer document is the leak PHASE_05 Task 1 names explicitly. So the
   * reference handed out is the key ENCRYPTED with an expiry (AES-256-GCM,
   * `ObjectUrlSigner`), resolved by `GET /api/objects/:token`. It carries its own
   * expiry, cannot be read, cannot be altered without failing the auth tag, and
   * cannot be walked.
   */
  documentUrl(
    basis: OrderBillingBasis,
    documentId: string,
  ): Promise<{ url: string; filename: string } | null>;
}

@Injectable()
export class PaymentService implements IPaymentService {
  constructor(
    private readonly documents: DocumentListService,
    private readonly invoices: InvoiceIssueService,
    private readonly repo: InvoiceRepository,
    private readonly store: ObjectStorePort,
  ) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  documentsForOrder(basis: OrderBillingBasis): Promise<OrderDocumentsView> {
    return this.documents.forOrder(basis);
  }

  issueTaxInvoices(basis: OrderBillingBasis): Promise<IssuedInvoice[]> {
    return this.invoices.issue(basis);
  }

  async renderDocument(
    basis: OrderBillingBasis,
    documentId: string,
  ): Promise<RenderedDocument | null> {
    if (documentId === 'proforma') {
      // Rendered fresh rather than fetched. A proforma is derived entirely from
      // the order, so a stored one would be wrong the moment the order changed;
      // there is nothing to cache that is not already in the order.
      return basis.confirmed && !basis.cancelled ? this.invoices.renderProforma(basis) : null;
    }

    // Scoped in the repository's own WHERE. A row belonging to another
    // organisation comes back null here, which the controller turns into 404.
    const invoice = await this.repo.findById(documentId);
    if (!invoice || invoice.type !== 'TAX') return null;
    if (!basis.consignments.some((c) => c.subOrderId === invoice.subOrderId)) {
      // The invoice is the caller's, but not on the order they asked under.
      // Answering it anyway would make the order number decorative.
      throw new NotFoundError('document', { reason: 'invoice_not_on_this_order' });
    }
    return this.invoices.renderTaxInvoice(basis, invoice);
  }

  async documentUrl(
    basis: OrderBillingBasis,
    documentId: string,
  ): Promise<{ url: string; filename: string } | null> {
    const document = await this.renderDocument(basis, documentId);
    if (!document) return null;

    // The key names the order or the invoice and nothing else. A key is a path,
    // and a path is the one place a supplier slug has leaked from before.
    const key =
      documentId === 'proforma'
        ? `proforma/${basis.orderId}.pdf`
        : `invoices/${documentId}.pdf`;
    // Written every time rather than only when absent: the proforma is derived
    // from an order that can change, and a cached one is a stale one. A tax
    // invoice's bytes are re-derived from frozen inputs, so rewriting them is a
    // no-op that also repairs a lost object.
    await this.store.put(key, document.bytes, 'application/pdf');

    return {
      url: await this.store.presignDownload(key, DOWNLOAD_TTL_SECONDS),
      filename: document.filename,
    };
  }
}

/**
 * Long enough for a browser to follow the redirect and for a slow connection to
 * finish the download; far too short to be worth passing on. The caller mints a
 * fresh one on every download, so this is never the thing a user waits out.
 */
const DOWNLOAD_TTL_SECONDS = 300;
