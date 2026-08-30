import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import type { IssuedInvoice } from '../payment';
import { orderNumberSchema } from './dto/ordering.dto';
import { opsOrderListQuerySchema, type OpsOrderListQueryDto } from './dto/ops-order.dto';
import { DeliveryService, type DeliveryRecorded } from './internal/delivery.service';
import { OrderDocumentsService } from './internal/order-documents.service';
import {
  OpsOrderService,
  type OpsOrderBoardView,
  type OpsOrderRecordView,
} from './internal/ops-order.service';

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
  constructor(
    private readonly documents: OrderDocumentsService,
    private readonly delivery: DeliveryService,
    private readonly board: OpsOrderService,
  ) {}

  /**
   * The order board — T39, `03_UX_SPEC.md` §3C.4.
   *
   * `ordering.any.read` and not `ordering.own.read`: this is every order on the
   * platform and there is no org predicate under it. The `*.any.*` convention in
   * `roles.ts` is what keeps that safe — no vendor or buyer role holds one, and
   * the six that do are all ours.
   *
   * Declared **before** `:orderNumber`, and the reason is worth the line: Nest
   * matches in declaration order, and a bare `GET /ops/orders` after a
   * parameterised route is still fine — but the record below is what must not
   * swallow anything, and keeping the list first makes that impossible to get
   * wrong later.
   */
  @Get()
  @RequirePermissions('ordering.any.read')
  list(
    @Query(new ZodValidationPipe(opsOrderListQuerySchema)) query: OpsOrderListQueryDto,
  ): Promise<OpsOrderBoardView> {
    return this.board.list(query);
  }

  /**
   * One order end-to-end, both sides on one screen.
   *
   * §3C.4: "the buyer's invoice and the vendor PO with the margin — this is the
   * only place the two ever sit on one screen, and it is ADMIN-only." That is
   * the whole reason this route exists separately from
   * `GET /api/buyer/orders/:orderNumber`, which reads `procurement` nowhere at
   * all and must never learn to.
   *
   * `orderNumberSchema` rather than a uuid, because an operator reading a number
   * off a customer's email is the case this route is for.
   */
  @Get(':orderNumber')
  @RequirePermissions('ordering.any.read')
  record(
    @Param('orderNumber', new ZodValidationPipe(orderNumberSchema)) orderNumber: string,
  ): Promise<OpsOrderRecordView> {
    return this.board.record(orderNumber);
  }

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

  /**
   * Record that this order reached the buyer — T23/T24.
   *
   * **The writer that did not exist.** `logistics.shipment` and
   * `logistics.delivery_task` are both empty and neither has a writer, so
   * nothing on the platform could say a machine had arrived — and both
   * after-sale clocks run from that instant. A warranty starts at delivery; the
   * 48-hour inspection window opens at delivery. Without this, the whole
   * after-sale half of the product was unreachable rather than merely unbuilt.
   *
   * This is the manual path, and it is honest about being one: it records
   * delivery in ordering's own schema and does not fabricate a carrier, an AWB
   * or a rider's proof-of-delivery photograph. When `logistics` grows a real
   * delivery task, that becomes the source and this endpoint becomes the
   * exception path, exactly as `POST :orderNumber/invoices` is waiting on the
   * same missing pickup writer.
   *
   * **It takes no timestamp.** The instant comes from `ClockPort` and there is
   * no parameter to override it, because this stamp is what the 48-hour return
   * window is measured from and a caller-supplied one would be a knob that moves
   * a money deadline.
   *
   * 200 rather than 201, and idempotent: the useful answer is what changed and
   * what was already true, and a second press of the same button must be a
   * no-op rather than a second warranty on the same machine.
   */
  @Post(':orderNumber/delivery')
  @HttpCode(200)
  @RequirePermissions('logistics.delivery.execute')
  deliver(
    @Param('orderNumber', new ZodValidationPipe(orderNumberSchema)) orderNumber: string,
  ): Promise<DeliveryRecorded> {
    return this.delivery.record(orderNumber);
  }
}
