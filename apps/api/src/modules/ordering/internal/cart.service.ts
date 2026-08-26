import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money, moneyFromDb, supplyPointLabel } from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { OrgScope, RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { ListingService } from '../../listing';
import { CatalogLookup } from './catalog-lookup';

/**
 * The buyer's cart.
 *
 * Three properties decide the shape of everything below, and each of them is a
 * rule somebody will otherwise "helpfully" break:
 *
 * 1. **Nothing here reserves stock.** A cart is an intention. Reservation is the
 *    20-minute hold taken at checkout entry, and it belongs to PHASE 6 with the
 *    order transaction, because a hold that is not released by the same code
 *    that took it is how inventory leaks. If you are about to add an UPDATE to
 *    `listing.unit` in this file, you are in the wrong phase and the wrong
 *    module: ask `listing` for the hold instead.
 *
 * 2. **Availability is read live, from the listing module, on every view.** The
 *    denormalised `listing.qty_available` and the stored `unit.is_sellable` are
 *    both computed on write, so a machine whose QC expired at midnight still
 *    reads as available until something touches the row.
 *    `ListingService.availabilityByListing` counts through `v_sellable_unit`,
 *    which re-evaluates the expiry and seal predicates on read. Ordering does
 *    not re-state that predicate and does not read `listing.unit` — there is one
 *    definition of sellable and it lives in one place (PHASE_05 Task 3).
 *
 * 3. **The buyer has one order.** The cart groups its lines by dispatch point
 *    because machines physically leave from more than one warehouse and that
 *    changes delivery timing. What splits internally into sub-orders and
 *    purchase orders in Phase 6 is invisible here: we are the merchant of
 *    record, there is exactly one seller, one invoice, and no word in any
 *    response below suggests otherwise. The dispatch point is labelled
 *    `Supply Point A · Gurugram` and carries nothing finer than the city.
 */

/**
 * Offers a buyer may actually add.
 *
 * This is the listing's own status — a *selling* decision — and it is a
 * different question from whether a machine is sellable, which only
 * `v_sellable_unit` answers. A vendor who pauses a listing keeps every unit's
 * QC, seal and `is_sellable` flag intact, so filtering on unit state alone would
 * happily sell out of a paused offer.
 */
const PURCHASABLE_STATUSES: readonly string[] = ['ACTIVE', 'PARTIALLY_ACTIVE'];

/**
 * Shown when the dispatch point cannot be resolved — a listing with no units
 * left, or a unit whose `supply_point_code` has not been assigned.
 *
 * Deliberately not shaped like a supply-point label, and it would fail VR-099's
 * pattern if anything validated it, which is correct: it is not one. Inventing
 * `Supply Point ? · ` instead would put a fake label in front of a buyer.
 */
const DISPATCH_UNKNOWN = 'Dispatch point to be confirmed';

export interface CartSummary {
  id: string;
  name: string;
  lineCount: number;
  updatedAt: Date;
}

/**
 * One cart line, built from an explicit allow-list.
 *
 * Every field here was chosen; nothing arrives by spreading a row, and the
 * `listing.listing` row behind it carries both `vendor_org_id` and — through its
 * units — the vendor's ask. A blacklist would let both through the day somebody
 * adds a column, which is why neither this type nor the projection that fills it
 * is built by subtraction.
 */
export interface CartLineView {
  itemId: string;
  /** The offer's id. A listing UUID identifies an offer, never its source. */
  offerId: string;
  title: string;
  specSummary: string;
  grade: string;
  qtyRequested: number;
  /** Sellable at the moment of this call, counted through `v_sellable_unit`. */
  qtyAvailable: number;
  /** "3 of the 5 units you selected are still available." */
  availability: string;
  /** Our selling price per unit. The vendor's ask is not in this module's reach. */
  unitPrice: string;
  /** Priced on what can actually ship, not on what was asked for. */
  lineTotal: string;
  /**
   * Our price moved after this line was added. Surfaced rather than silently
   * re-priced: a figure that changes between the cart and the payment screen is
   * drip pricing, which the CCPA Dark Patterns Guidelines 2023 name outright.
   */
  priceChangedSinceAdded: boolean;
  /** "ships in 24 h" — the vendor's SLA, anonymised to a duration. */
  dispatch: string;
}

export interface DispatchGroupView {
  label: string;
  lines: CartLineView[];
}

export interface CartView {
  id: string;
  name: string;
  /**
   * Grouped for delivery expectations only. There is one order and one invoice;
   * "sub-order" is an internal Phase 6 word and never appears in a buyer payload.
   */
  dispatchGroups: DispatchGroupView[];
  itemCount: number;
  /**
   * Goods value of what can ship right now.
   *
   * Not the landed figure: GST and freight need a delivery pincode the cart does
   * not have, and the landed price with its full break-up is built on the offers
   * path (PHASE_05 Task 5). Calling it `goodsTotal` rather than `total` is the
   * point — a field named `total` that is not the total is how a checkout screen
   * ends up revealing charges in steps.
   */
  goodsTotal: string;
  /** At least one line cannot be filled in full. */
  needsAttention: boolean;
  updatedAt: Date;
}

/**
 * What the cart needs to know about an offer beyond its stock.
 *
 * Internal and not exported: the moment `ListingAvailability` carries these,
 * this type and the query that fills it both go away.
 */
interface OfferFacts {
  skuId: string;
  grade: string;
  /** Our selling price. `listing.unit_price` after the pricing engine has run. */
  unitPrice: Money;
  moq: number;
  dispatchSlaHours: number;
  purchasable: boolean;
}

function units(n: number): string {
  return `${n} unit${n === 1 ? '' : 's'}`;
}

/**
 * "3 of the 5 units you selected are still available."
 *
 * The shortfall sentence PHASE_05 Task 6 asks for, with the zero case written
 * out rather than falling out of the general form — "0 of the 1 unit you
 * selected are still available" is what the arithmetic version says, and a buyer
 * reading that concludes the site is broken rather than that the machine sold.
 */
function availabilitySentence(requested: number, available: number): string {
  if (available >= requested) return `${units(requested)} available.`;
  const verb = (n: number) => (n === 1 ? 'is' : 'are');
  if (available === 0) {
    return `None of the ${units(requested)} you selected ${verb(requested)} still available.`;
  }
  return `${available} of the ${units(requested)} you selected ${verb(available)} still available.`;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly scope: OrgScope,
    private readonly ctx: RequestContextService,
    private readonly listings: ListingService,
    private readonly catalog: CatalogLookup,
  ) {}

  // -------------------------------------------------------------------------
  // Named carts
  // -------------------------------------------------------------------------

  /**
   * A cart belongs to a buyer organisation and to one person inside it.
   *
   * `uq_cart_active_name` is keyed on `(buyer_org_id, user_id, name)`, so the
   * database has already decided that carts are per user: two people on the same
   * procurement team may each keep one called "Q3 refresh". Platform staff have
   * no buyer org and therefore no cart, which is why this refuses rather than
   * falling through to a null org id the foreign key would reject anyway.
   */
  private buyer(): { orgId: string; userId: string } {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('A cart belongs to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return { orgId: p.orgId, userId: p.userId };
  }

  private mine<T extends Record<string, unknown>>(where: T): Prisma.cartWhereInput {
    return this.scope.scoped(where, 'buyer_org_id') as Prisma.cartWhereInput;
  }

  /**
   * `ON CONFLICT ... DO NOTHING` against the partial index rather than a read
   * followed by an insert: the read-then-write version has a window in which two
   * tabs both create "Q3 refresh", and the index would then reject the second
   * with a message naming an index.
   */
  async create(name: string): Promise<CartSummary> {
    const { orgId, userId } = this.buyer();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; updated_at: Date }>>`
      INSERT INTO ordering.cart (buyer_org_id, user_id, name, status)
      VALUES (${orgId}::uuid, ${userId}::uuid, ${name}, 'OPEN')
      ON CONFLICT (buyer_org_id, user_id, lower(btrim(name))) WHERE status = 'OPEN'
      DO NOTHING
      RETURNING id, updated_at`;

    const row = rows[0];
    if (!row) {
      throw new ConflictError(`You already have an open cart called "${name}".`, {
        reason: 'duplicate_cart_name',
      });
    }
    return { id: row.id, name, lineCount: 0, updatedAt: row.updated_at };
  }

  /** The caller's own open carts. Scoped by org first, then narrowed to the person. */
  async listOpen(): Promise<CartSummary[]> {
    const { userId } = this.buyer();
    const rows = await this.prisma.db.cart.findMany({
      where: this.mine({ user_id: userId, status: 'OPEN' }),
      orderBy: { updated_at: 'desc' },
      select: { id: true, name: true, updated_at: true, _count: { select: { cart_item: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      lineCount: r._count.cart_item,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * The cart, or a 404 that does not distinguish "not yours" from "not there".
   *
   * The org predicate comes from `OrgScope`, which reads the session and never
   * the request, so another organisation's cart id is simply not found — which
   * is also the right answer to somebody enumerating ids.
   */
  private async requireCart(cartId: string): Promise<{ id: string; name: string }> {
    const { userId } = this.buyer();
    const cart = await this.prisma.db.cart.findFirst({
      where: this.mine({ id: cartId, user_id: userId, status: 'OPEN' }),
      select: { id: true, name: true },
    });
    if (!cart) throw new NotFoundError('cart');
    return cart;
  }

  // -------------------------------------------------------------------------
  // The offer's commercial facts
  // -------------------------------------------------------------------------

  /**
   * Price, grade, lot size and dispatch time for a set of offers.
   *
   * **ponytail: this SELECT is a bridge and is meant to be deleted.** It belongs
   * on `ListingService.availabilityByListing`, which is already the one
   * buyer-facing offer read and already returns a row per listing — it just does
   * not carry these six columns yet. The listing lane has been asked to add
   * `skuId`, `grade`, `unitPrice`, `moq`, `dispatchSlaHours` and `purchasable`
   * to `ListingAvailability`; when they land, delete this method and read them
   * off `stock` in `view()` below. Nothing else has to change.
   *
   * Why it exists at all: `ListingService.getListing` — the barrel method a
   * sibling module is supposed to use — runs through the repository's org scope,
   * whose predicate is `isPlatform OR vendor_org_id = <caller's org>`. Under a
   * buyer principal that is false for every listing on the platform, so the
   * documented seam returns `null` for every offer a buyer could possibly want.
   *
   * Two things this deliberately does NOT do, so the bridge cannot become a leak
   * while it is standing:
   *
   *   - It selects an **allow-list**, exactly as a response DTO would. There is
   *     no `vendor_org_id` and no `vendor_ask_price` in the projection, so the
   *     two fields that would matter cannot travel even by accident.
   *   - It does not touch `listing.unit` and does not mention sellability.
   *     Availability still comes from `availabilityByListing` and therefore from
   *     `v_sellable_unit`, which stays the single definition (PHASE_05 Task 3).
   */
  private async offerFacts(listingIds: readonly string[]): Promise<Map<string, OfferFacts>> {
    if (listingIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        sku_id: string;
        grade: string;
        /** NUMERIC(14,2) arrives as a Decimal object, never a number. */
        unit_price: { toString(): string };
        moq: number;
        dispatch_sla_hours: number;
        purchasable: boolean;
      }>
    >`
      SELECT id, sku_id, grade::text AS grade, unit_price, moq, dispatch_sla_hours,
             status::text = ANY(${[...PURCHASABLE_STATUSES]}::text[]) AS purchasable
        FROM listing.listing
       WHERE id = ANY(${[...listingIds]}::uuid[])`;

    return new Map(
      rows.map((r) => [
        r.id,
        {
          skuId: r.sku_id,
          grade: r.grade,
          unitPrice: moneyFromDb(r.unit_price) ?? Money.ZERO,
          moq: r.moq,
          dispatchSlaHours: r.dispatch_sla_hours,
          purchasable: r.purchasable,
        },
      ]),
    );
  }

  // -------------------------------------------------------------------------
  // Lines
  // -------------------------------------------------------------------------

  /**
   * Put a quantity of one offer in the cart.
   *
   * The quantity **replaces** rather than accumulates. This is a procurement
   * tool: the buyer typed a number next to a supply point on the comparison
   * grid, and sending that same number twice must not silently mean double it.
   *
   * `unit_price_snapshot` is our selling price at the moment of the add, kept so
   * the view can say when it has moved. It is taken only from a purchasable
   * listing — on a DRAFT listing `unit_price` still holds the vendor's own ask,
   * which has not been through the pricing engine and must never reach a buyer
   * as a price.
   */
  async addLine(cartId: string, listingId: string, qty: number): Promise<CartView> {
    await this.requireCart(cartId);

    const offer = (await this.offerFacts([listingId])).get(listingId);
    if (!offer?.purchasable) {
      // Not "this offer is paused": an offer a buyer cannot buy is one they
      // should not be able to distinguish from one that never existed.
      throw new NotFoundError('offer', { listingId });
    }
    if (qty < offer.moq) {
      // The listing's own minimum, refused here rather than at checkout: a cart
      // that accepts a quantity the order will reject wastes the buyer's
      // afternoon and teaches them to distrust the cart.
      throw new ValidationError(`This supply point sells this model in lots of ${offer.moq}.`, {
        qty: `Order at least ${units(offer.moq)}.`,
      });
    }

    await this.prisma.$executeRaw`
      INSERT INTO ordering.cart_item (cart_id, listing_id, qty, unit_price_snapshot)
      VALUES (${cartId}::uuid, ${listingId}::uuid, ${qty}, ${offer.unitPrice.toString()}::numeric)
      ON CONFLICT (cart_id, listing_id)
      DO UPDATE SET qty = EXCLUDED.qty, unit_price_snapshot = EXCLUDED.unit_price_snapshot`;

    await this.touch(cartId);
    return this.view(cartId);
  }

  async removeLine(cartId: string, itemId: string): Promise<CartView> {
    await this.requireCart(cartId);
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM ordering.cart_item WHERE id = ${itemId}::uuid AND cart_id = ${cartId}::uuid`;
    if (deleted === 0) throw new NotFoundError('cart line', { itemId });
    await this.touch(cartId);
    return this.view(cartId);
  }

  private async touch(cartId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE ordering.cart SET updated_at = ${this.clock.now()} WHERE id = ${cartId}::uuid`;
  }

  // -------------------------------------------------------------------------
  // The view, re-validated on every read
  // -------------------------------------------------------------------------

  /**
   * Build the cart the buyer sees, checking availability as it goes.
   *
   * This *is* the re-validation. There is no second "revalidate" entry point,
   * because a second one would be a second definition of what the cart currently
   * is, and the two would eventually disagree. Phase 6's checkout entry calls
   * this and refuses on `needsAttention` before it takes any hold — the hold
   * itself goes through `listing`, not through here.
   *
   * ponytail: the catalogue description is fetched per distinct SKU, memoised
   * within the call, so two lines for the same model cost one lookup. Everything
   * else is batched. That is fine for a cart, which is tens of lines; if
   * `describe` ever needs to serve a page of hundreds, give catalog a
   * `describeMany(skuIds)` rather than caching here.
   */
  async view(cartId: string): Promise<CartView> {
    const cart = await this.requireCart(cartId);

    const items = await this.prisma.db.cart_item.findMany({
      where: { cart_id: cart.id },
      orderBy: { added_at: 'asc' },
      select: { id: true, listing_id: true, qty: true, unit_price_snapshot: true },
    });

    const [row] = await this.prisma.$queryRaw<Array<{ updated_at: Date }>>`
      SELECT updated_at FROM ordering.cart WHERE id = ${cartId}::uuid`;

    const listingIds = items.map((i) => i.listing_id);
    // One call for every line's live stock and its dispatch label. The vendor
    // org id that resolves that label never crosses the seam — asking `listing`
    // for the answer is what keeps it on the other side.
    const availability = await this.listings.availabilityByListing(listingIds);
    const offers = await this.offerFacts(listingIds);

    const groups = new Map<string, CartLineView[]>();
    const described = new Map<string, Awaited<ReturnType<CatalogLookup['describe']>>>();
    let goodsTotal = Money.ZERO;
    let needsAttention = false;

    for (const item of items) {
      const offer = offers.get(item.listing_id);
      const stock = availability.get(item.listing_id);
      const snapshot = moneyFromDb(item.unit_price_snapshot);

      // A listing that has been paused, delisted or has expired is not on sale,
      // whatever its units say. Reported as zero rather than dropped, so the
      // buyer can see which of their lines went away instead of counting.
      const sellable = offer?.purchasable ? (stock?.availableQty ?? 0) : 0;

      const shippable = Math.min(item.qty, sellable);
      if (shippable < item.qty) needsAttention = true;

      const unitPrice = offer?.unitPrice ?? snapshot ?? Money.ZERO;
      const lineTotal = unitPrice.times(shippable);
      goodsTotal = goodsTotal.add(lineTotal);

      if (offer && !described.has(offer.skuId)) {
        described.set(offer.skuId, await this.catalog.describe(offer.skuId));
      }
      const sku = offer ? described.get(offer.skuId) : null;

      const label =
        stock?.supplyPointCode && stock.city
          ? supplyPointLabel(stock.supplyPointCode, stock.city)
          : DISPATCH_UNKNOWN;

      const line: CartLineView = {
        itemId: item.id,
        offerId: item.listing_id,
        title: sku?.title ?? 'This model is no longer in the catalogue',
        specSummary: sku?.specSummary ?? '',
        grade: offer?.grade ?? '',
        qtyRequested: item.qty,
        qtyAvailable: sellable,
        availability: availabilitySentence(item.qty, sellable),
        unitPrice: unitPrice.toString(),
        lineTotal: lineTotal.toString(),
        priceChangedSinceAdded: snapshot !== null && !unitPrice.eq(snapshot),
        dispatch: `ships in ${offer?.dispatchSlaHours ?? 48} h`,
      };

      const bucket = groups.get(label);
      if (bucket) bucket.push(line);
      else groups.set(label, [line]);
    }

    return {
      id: cart.id,
      name: cart.name,
      // Sorted by label so the page does not reshuffle between reads. The label
      // is a letter assigned at random by `listing.assign_supply_point`, so
      // ordering on it carries nothing about who the source is or how long they
      // have been with us — which ordering by anything on the row would.
      dispatchGroups: [...groups.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([label, lines]) => ({ label, lines })),
      itemCount: items.length,
      goodsTotal: goodsTotal.toString(),
      needsAttention,
      updatedAt: row!.updated_at,
    };
  }
}
