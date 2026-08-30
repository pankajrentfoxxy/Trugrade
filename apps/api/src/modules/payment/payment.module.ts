import { Module } from '@nestjs/common';
import { ClockModule } from '../../shared/clock';
import { PrismaModule } from '../../shared/db/prisma.service';
import { IdentityModule } from '../identity';
import { PaymentService } from './payment.service';
import { DocumentListService } from './internal/document-list.service';
import { InvoiceIssueService } from './internal/invoice-issue.service';
import { InvoicePdfService } from './internal/invoice-pdf.service';
import { InvoiceRepository } from './internal/invoice.repository';

/**
 * Registers the invoice slice — T22.
 *
 * `IdentityModule` is imported for one thing: `AuditService`. Issuing an invoice
 * and handing one over are both audited events, and `identity` owns
 * `platform.audit_log`. Writing that table from here would be a cross-schema
 * write dressed up as convenience.
 *
 * **`OrderingModule` is deliberately absent, and the dependency runs the other
 * way.** `ordering` owns the order and hands `payment` an `OrderBillingBasis`;
 * `payment` never reaches back for one. Importing ordering here would close a
 * cycle and, worse, would give this module a path to `ordering.sub_order` and
 * from there to a vendor org id — the exact thing the seam exists to prevent.
 *
 * `ObjectStorePort` is not imported: it is provided globally by the adapters
 * module, the same way `qc`'s report renderer gets it.
 *
 * `PaymentService` stays the only export. The repository, the renderer and the
 * issuing service are internals, and the barrel is this module's whole public
 * surface.
 */
@Module({
  imports: [PrismaModule, ClockModule, IdentityModule],
  providers: [
    PaymentService,
    InvoiceRepository,
    InvoicePdfService,
    InvoiceIssueService,
    DocumentListService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
