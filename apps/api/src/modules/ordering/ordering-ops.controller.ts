import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import type { IssuedInvoice } from '../payment';
import { orderNumberSchema } from './dto/ordering.dto';
import { OrderDocumentsService } from './internal/order-documents.service';

/**
 * Operator-side actions on an order. Platform staff only — never a buyer, never
 * a vendor.
 *
 * A separate controller from `OrderingController` rather than a route on it,
 * because that class is `@Controller('buyer')` and its whole contract is that
 * every route under it is one a buyer may call. A staff-only route living
 * inside it would make that read of the file wrong, and the file says so in as
 * many words.
 */
@Controller('ops/orders')
export class OrderingOpsController {
  constructor(private readonly documents: OrderDocumentsService) {}

  /**
   * Issue the tax invoices this order is due — T22.
   *
   * **This is the writer that did not exist.** Thirteen orders were on the
   * platform and not one invoice, because `payment` had no internals at all.
   * s.31(1)(a) CGST Act puts the tax invoice at removal of the goods, so this
   * raises one per consignment that has left its supply point and skips one that
   * already has an invoice.
   *
   * `POST`, and emphatically not idempotent-by-verb: each invoice consumes a
   * number from a gapless statutory series, which is exactly why it must not be
   * reachable from a GET — a crawler on the buyer's documents screen would spend
   * numbers nobody could account for. What makes a double-press safe is that the
   * service skips a consignment that already has an invoice, not the method.
   *
   * **The automatic trigger is not wired, and the honest reason is that pickup
   * is not.** In the finished system `logistics` records the handover and this
   * fires from that event. `logistics` has no pickup writer yet, so this is the
   * manual path — the same one the finance console (T40) will call.
   *
   * 200 rather than 201: the useful answer is what was issued and what was
   * skipped, and an empty array is a meaningful outcome ("nothing has been
   * removed yet"), not a failure.
   */
  @Post(':orderNumber/invoices')
  @HttpCode(200)
  @RequirePermissions('payment.invoice.issue')
  issue(
    @Param('orderNumber', new ZodValidationPipe(orderNumberSchema)) orderNumber: string,
  ): Promise<IssuedInvoice[]> {
    return this.documents.issue(orderNumber);
  }
}
