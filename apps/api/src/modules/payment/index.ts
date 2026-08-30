/**
 * The PUBLIC barrel for `payment`.
 *
 * Re-export only: the service interface, the concrete service token, the module,
 * this module's event payload types, and any DTO that is genuinely part of the
 * contract. Never a repository, never an entity, never an internal DTO.
 *
 * Anything added here becomes something another module may depend on, so adding
 * to this file is an architectural decision, not a convenience.
 */
export { type IPaymentService, PaymentService } from './payment.service';
export { PaymentModule } from './payment.module';

/**
 * The invoice contract (T22). `OrderBillingBasis` and its parts are genuinely
 * part of it: `ordering` cannot construct the argument without them, and
 * `OrderDocumentsView` is what a caller has to type the answer as.
 *
 * `PricedDocument`, `InvoiceRow` and the renderer's own shapes are deliberately
 * NOT here. They are how this module computes, not what it promises.
 */
export type {
  BillingAddress,
  BillingConsignment,
  BillingLine,
  BillingParty,
  DocumentKind,
  DocumentStatus,
  IssuedInvoice,
  OrderBillingBasis,
  OrderDocumentRow,
  OrderDocumentsView,
  ValuationMethod,
} from './dto/invoice.dto';

/** What `renderDocument` returns. A caller streaming it has to type the bytes. */
export type { RenderedDocument } from './internal/invoice-pdf.service';
