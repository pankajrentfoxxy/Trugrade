import { Module } from '@nestjs/common';
import { ClockModule } from '../../shared/clock';
import { PrismaModule } from '../../shared/db/prisma.service';
import { IdentityModule } from '../identity';
import { ListingModule } from '../listing';
import { LogisticsModule } from '../logistics';
import { PaymentModule } from '../payment';
import { PlatformModule } from '../platform';
import { QcModule } from '../qc';
import { OrderingController } from './ordering.controller';
import { OrderingOpsController } from './ordering-ops.controller';
import { OrderingService } from './ordering.service';
import { ApprovalService } from './internal/approval.service';
import { CartService } from './internal/cart.service';
import { CheckoutService } from './internal/checkout.service';
import { HoldService } from './internal/hold.service';
import { OrderListService } from './internal/order-list.service';
import { OrderReadService } from './internal/order-read.service';
import { OrderDocumentsService } from './internal/order-documents.service';
import { OrderUnitsService } from './internal/order-units.service';
import { OrderTransactionService } from './internal/order-transaction.service';
import { CatalogLookup } from './internal/catalog-lookup';
import { RfqIntakeService } from './internal/rfq-intake.service';

/**
 * Registers the cart and the bulk-requirement intake.
 *
 * `ListingModule` is imported for one thing and it is the thing that keeps the
 * anonymity model intact: the cart asks it for live sellable stock and the
 * dispatch label per listing. The vendor org id that resolves that label stays
 * on the other side of the seam, and the sellable predicate stays in
 * `v_sellable_unit` where there is exactly one of it. A cart query joining
 * `listing.unit` would break both at once.
 *
 * `PlatformModule` is imported because `platform.ticket` is the only table that
 * means "something a human on our side has to pick up", and an unmatched
 * requirement row is exactly that. Ordering asks for a lead rather than writing
 * into `platform.*` across the seam or inventing a second queue.
 *
 * **`CatalogModule` is deliberately absent.** Catalog imports *this* module for
 * its public storefront figures, so declaring it here would close a cycle Nest
 * cannot instantiate without `forwardRef` on both sides — one of which is a file
 * this module does not own. `CatalogLookup` resolves `CatalogService` from the
 * container on first use instead; the reasoning lives there, in one place.
 *
 * `QcModule` is imported for one call and it is the one that keeps this
 * module's per-serial screen honest: `inspectionsByReport`. Ordering owns
 * `order_line_unit.qc_report_id` but owns nothing behind it, and a query here
 * joining `qc.qc_report`, `qc.qc_hardware_detected` and `qc.qc_seal` would put
 * "which seal is the current one" in a module that does not own seals.
 *
 * `LogisticsModule` is imported for one number: freight, priced per supply
 * point against the buyer's real delivery pincode. Checkout cannot show a
 * complete break-up without it, and a break-up missing a charge that appears
 * later is drip pricing. The unserviceable arm of `FreightQuote` is why the
 * quote can say "we could not price this lane" instead of charging zero.
 *
 * `PaymentModule` is imported for the invoice slice (T22), and the dependency
 * runs deliberately in this direction. `ordering` owns the order and hands
 * `payment` an `OrderBillingBasis` — a value, not a handle — so `payment` has no
 * path back into `ordering."order"` and therefore no path to a vendor org id.
 * The reverse import would close a cycle AND open that path in one move.
 *
 * `IdentityModule` is imported for `AuditService`. Every document download
 * writes an `audit_log` row (03_UX_SPEC §3A.3), and `identity` owns that table.
 *
 * `OrderingService` stays the only export, because the barrel is this module's
 * whole public surface and a cart service leaking out of it is how the seam is
 * lost.
 */
@Module({
  imports: [
    PrismaModule,
    ClockModule,
    IdentityModule,
    ListingModule,
    LogisticsModule,
    PaymentModule,
    PlatformModule,
    QcModule,
  ],
  controllers: [OrderingController, OrderingOpsController],
  providers: [
    OrderingService,
    CartService,
    CheckoutService,
    HoldService,
    OrderTransactionService,
    OrderReadService,
    OrderUnitsService,
    OrderDocumentsService,
    OrderListService,
    ApprovalService,
    CatalogLookup,
    RfqIntakeService,
  ],
  exports: [OrderingService],
})
export class OrderingModule {}
