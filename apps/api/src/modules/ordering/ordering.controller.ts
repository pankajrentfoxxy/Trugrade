import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { uuidSchema } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  addCartItemSchema,
  createCartSchema,
  orderListQuerySchema,
  orderNumberSchema,
  requirementIntakeSchema,
  type AddCartItemDto,
  type CreateCartDto,
  type OrderListQueryDto,
  type RequirementIntakeDto,
} from './dto/ordering.dto';
import {
  checkoutQuerySchema,
  confirmCheckoutSchema,
  startCheckoutSchema,
  type CheckoutQueryDto,
  type ConfirmCheckoutDto,
  type StartCheckoutDto,
} from './dto/checkout.dto';
import { CartService, type CartSummary, type CartView } from './internal/cart.service';
import {
  CheckoutService,
  type CheckoutSessionView,
  type OrderConfirmationView,
} from './internal/checkout.service';
import {
  OrderListService,
  type OrderDashboardView,
  type OrderListView,
} from './internal/order-list.service';
import { OrderReadService, type OrderRecordView } from './internal/order-read.service';
import { OrderUnitsService, type OrderUnitsView } from './internal/order-units.service';
import { RfqIntakeService, type RequirementIntakeResult } from './internal/rfq-intake.service';

/**
 * The authenticated buyer's cart and bulk-requirement intake.
 *
 * Two rules govern every handler here.
 *
 * **1. No customer-facing response may contain a vendor identifier at any
 * depth.** Under the merchant-of-record model there is exactly one seller — us —
 * so a vendor's legal name, trade name, GSTIN, PAN, address line, contact
 * details, ask price or `org_id` in any of these payloads is a P0 defect
 * (VR-099, `IDN-080`…`IDN-094`). The guarantee is not care taken in this file:
 * every response type below is an explicit allow-list built field by field in
 * the service, and a Prisma row is never returned. A blacklist would fail open
 * the moment somebody adds a column.
 *
 * **2. The vocabulary is the buyer's.** "Sub-order", "vendor" and "supplier" do
 * not appear in a route, a field name or a message here, because to the buyer
 * this is one order from one seller with one invoice. What the cart does show is
 * where machines dispatch from, as `Supply Point A · Gurugram` and nothing
 * finer.
 *
 * Validation is a Zod schema per endpoint through `ZodValidationPipe` rather
 * than a global pipe (VR-META-01), so the client and the server run the
 * identical constant.
 */
@Controller('buyer')
export class OrderingController {
  constructor(
    private readonly carts: CartService,
    private readonly checkout: CheckoutService,
    private readonly orders: OrderReadService,
    private readonly orderUnits: OrderUnitsService,
    private readonly orderBoard: OrderListService,
    private readonly requirements: RfqIntakeService,
  ) {}

  // -------------------------------------------------------------------------
  // Carts
  // -------------------------------------------------------------------------

  /**
   * A named cart. Multiple open ones per person is the feature, not an accident:
   * a procurement head sourcing for three departments at once needs three, and
   * `uq_cart_active_name` is what keeps them distinguishable.
   */
  @Post('carts')
  @RequirePermissions('ordering.cart.write')
  create(@Body(new ZodValidationPipe(createCartSchema)) body: CreateCartDto): Promise<CartSummary> {
    return this.carts.create(body.name);
  }

  @Get('carts')
  @RequirePermissions('ordering.own.read')
  list(): Promise<CartSummary[]> {
    return this.carts.listOpen();
  }

  /**
   * The cart, with availability checked at the moment of the call.
   *
   * A GET that reads live state rather than a stored total, because the stored
   * total is wrong the instant somebody else buys the last machine — and a cart
   * that quietly keeps offering a unit whose QC expired overnight is the failure
   * this endpoint exists to prevent.
   */
  @Get('carts/:cartId')
  @RequirePermissions('ordering.own.read')
  view(@Param('cartId', new ZodValidationPipe(uuidSchema)) cartId: string): Promise<CartView> {
    return this.carts.view(cartId);
  }

  /**
   * 200 rather than 201: the same request creates a line or changes the quantity
   * on one that already exists (`UNIQUE (cart_id, listing_id)`), and a status
   * code that flips between the two makes every client branch on it to find out
   * which happened. The body is the whole cart either way, so the page can
   * re-render from one response.
   */
  @Post('carts/:cartId/items')
  @HttpCode(200)
  @RequirePermissions('ordering.cart.write')
  addItem(
    @Param('cartId', new ZodValidationPipe(uuidSchema)) cartId: string,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemDto,
  ): Promise<CartView> {
    return this.carts.addLine(cartId, body.listingId, body.qty);
  }

  /** 200 and the updated cart, not 204: the totals and the shortfalls both moved. */
  @Delete('carts/:cartId/items/:itemId')
  @HttpCode(200)
  @RequirePermissions('ordering.cart.write')
  removeItem(
    @Param('cartId', new ZodValidationPipe(uuidSchema)) cartId: string,
    @Param('itemId', new ZodValidationPipe(uuidSchema)) itemId: string,
  ): Promise<CartView> {
    return this.carts.removeLine(cartId, itemId);
  }

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  /**
   * Enter checkout. Validates, takes the twenty-minute hold, and quotes.
   *
   * 200 rather than 201 and no `Location`: what this creates is a hold, not a
   * resource the client will fetch again by id — the cart id addresses it. The
   * body is the whole session, so the screen renders every step from one call.
   *
   * The hold is the promise the cart screen makes ("stock is held for 20
   * minutes when you start checkout"), and `holdExpiresAt` is a real deadline we
   * imposed, read straight off `ordering.checkout_hold`. It is not a scarcity
   * device: nothing about it is invented, and it releases on its own.
   */
  @Post('checkout')
  @HttpCode(200)
  @RequirePermissions('ordering.cart.write')
  startCheckout(
    @Body(new ZodValidationPipe(startCheckoutSchema)) body: StartCheckoutDto,
  ): Promise<CheckoutSessionView> {
    return this.checkout.begin(body.cartId);
  }

  /**
   * Re-quote after a step, without touching the hold.
   *
   * The selection is in the query string rather than a POST body on purpose: it
   * is board state, and a buyer sending a colleague their half-finished
   * checkout link should land on the same GSTIN and the same delivery site.
   * Re-reading does not renew the deadline.
   */
  @Get('checkout/:cartId')
  @RequirePermissions('ordering.own.read')
  quoteCheckout(
    @Param('cartId', new ZodValidationPipe(uuidSchema)) cartId: string,
    @Query(new ZodValidationPipe(checkoutQuerySchema)) query: CheckoutQueryDto,
  ): Promise<CheckoutSessionView> {
    return this.checkout.quote(cartId, query);
  }

  /**
   * Place the order. This is the sixteen-step transaction (PHASE_06 Task 3).
   *
   * Exactly one of three things happens: the order is confirmed with specific
   * serial numbers allocated and a purchase order raised per supply point; it is
   * parked for approval with the stock still held and NO purchase order; or
   * nothing at all happened and the buyer gets a specific reason. There is no
   * fourth outcome, and no partial one.
   */
  @Post('checkout/:cartId/confirm')
  @HttpCode(200)
  @RequirePermissions('ordering.cart.write')
  confirmCheckout(
    @Param('cartId', new ZodValidationPipe(uuidSchema)) cartId: string,
    @Body(new ZodValidationPipe(confirmCheckoutSchema)) body: ConfirmCheckoutDto,
  ): Promise<OrderConfirmationView> {
    return this.checkout.confirm({ cartId, ...body });
  }

  /** The buyer left checkout. Put the machines back on sale now, not in 20 minutes. */
  @Delete('checkout/:cartId')
  @HttpCode(200)
  @RequirePermissions('ordering.cart.write')
  abandonCheckout(
    @Param('cartId', new ZodValidationPipe(uuidSchema)) cartId: string,
  ): Promise<{ released: number }> {
    return this.checkout.abandon(cartId);
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  /**
   * The buyer's dashboard figures (T19).
   *
   * **Declared above `orders/:orderNumber`, and it has to be.** Nest matches in
   * declaration order, so the other way round `summary` would be captured as an
   * order number and refused by `orderNumberSchema` with a 422 — a route that
   * exists answering as though it does not.
   *
   * It is a separate endpoint rather than a block bolted onto the list because
   * the two answer different questions: the list answers "which orders match
   * this filter", the dashboard answers "what is outstanding across all of
   * them", and folding the second into the first would make every filtered
   * board recompute org-wide totals it does not show.
   */
  @Get('orders/summary')
  @RequirePermissions('ordering.own.read')
  dashboard(): Promise<OrderDashboardView> {
    return this.orderBoard.summary();
  }

  /**
   * Every order the buyer's organisation placed (T20).
   *
   * The whole of the board's state is in the query string — search, status,
   * delivery site, sort, page — because a buyer must be able to send a
   * colleague a link that reproduces exactly what they saw, and that is only
   * true if the server takes its instructions from the URL rather than from a
   * session.
   *
   * An order belonging to another organisation is not in the list, and is not
   * refused either: the scoping is inside every statement's own `WHERE`. See
   * the service for why a refusal would be worse than an absence.
   */
  @Get('orders')
  @RequirePermissions('ordering.own.read')
  orderList(
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQueryDto,
  ): Promise<OrderListView> {
    return this.orderBoard.list(query);
  }

  /**
   * One order the buyer's organisation placed, by its human number.
   *
   * Addressed by `order_number` rather than by id because that is the string on
   * the confirmation, in the email and in the buyer's own finance system — a
   * route keyed on a uuid makes "look up TT-26-00004" impossible without a
   * search first.
   *
   * **There is deliberately no route below this one that reaches a vendor
   * purchase order.** Under the merchant-of-record model the buyer's documents
   * are their own PO reference and our confirmation to them; our purchase order
   * to a supply point is vendor-and-admin-only (PHASE_06 Task 6), and the way to
   * keep that true is for no buyer-reachable endpoint to read
   * `procurement.purchase_order` at all.
   *
   * An order belonging to another organisation answers 404, not 403 — see the
   * service for why a 403 would turn sequential order numbers into an oracle.
   */
  @Get('orders/:orderNumber')
  @RequirePermissions('ordering.own.read')
  order(
    @Param('orderNumber', new ZodValidationPipe(orderNumberSchema)) orderNumber: string,
  ): Promise<OrderRecordView> {
    return this.orders.byNumber(orderNumber);
  }

  /**
   * The machines on one order, by serial, with what the inspection said (T21).
   *
   * A sub-resource of the order rather than a block on it: this is the buyer's
   * asset register, it is what their IT team exports into their own CMDB, and it
   * is addressable on its own so a link to "the serials on TT-26-00004" can be
   * sent to somebody who has no use for the money panel.
   *
   * Same 404-not-403 rule as the order itself, and for the same reason. Nothing
   * below reads `procurement.purchase_order` or `listing.unit`.
   */
  @Get('orders/:orderNumber/units')
  @RequirePermissions('ordering.own.read')
  orderUnitList(
    @Param('orderNumber', new ZodValidationPipe(orderNumberSchema)) orderNumber: string,
  ): Promise<OrderUnitsView> {
    return this.orderUnits.byOrderNumber(orderNumber);
  }

  // -------------------------------------------------------------------------
  // Bulk requirement intake
  // -------------------------------------------------------------------------

  /**
   * A requirement list, as a filled form or an uploaded CSV.
   *
   * One route for both because they are the same intake with the same outcome; a
   * client that has to choose a URL by input type ends up with two code paths
   * for one screen.
   *
   * 200 rather than 201 even though rows are recorded: the useful answer is the
   * classification — what we can fill now, what we cannot, and which rows did
   * not parse — and that is meaningful whether or not anything was created.
   *
   * **Nothing here is visible to any vendor.** Sourcing against a requirement is
   * our job under the merchant-of-record model, not a bidding process; see the
   * service for why that distinction is load bearing rather than a preference.
   */
  @Post('requirements')
  @HttpCode(200)
  @RequirePermissions('ordering.cart.write')
  submitRequirements(
    @Body(new ZodValidationPipe(requirementIntakeSchema)) body: RequirementIntakeDto,
  ): Promise<RequirementIntakeResult> {
    if ('csv' in body) {
      const { rows, rejected } = this.requirements.fromCsv(body.csv);
      return this.requirements.intake(rows, rejected);
    }
    // A typed form row has already been validated by the same schema the CSV
    // rows go through, so it needs no line number of its own beyond its position.
    return this.requirements.intake(body.rows.map((value, i) => ({ line: i + 1, value })));
  }
}
