import { Injectable } from '@nestjs/common';
import { LEGAL_DISCLOSURE } from '@trugrade/config';
import {
  Money,
  moneyFromDb,
  resolveTaxSplit,
  stateTaxLabel,
  supplyPointLabel,
  type TaxSplit,
} from '@trugrade/contracts';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { ListingService } from '../../listing';
import { LogisticsService, freightLaneKey } from '../../logistics';
import { CatalogLookup } from './catalog-lookup';
import { HoldService, type HeldStock } from './hold.service';
import {
  OrderTransactionService,
  type OrderLineRequest,
  type PostDecrementStep,
} from './order-transaction.service';

/**
 * Checkout — PHASE_06 Task 1, and step 1 of the order transaction.
 *
 * The six steps the screen walks (review, GSTIN and billing, delivery site, PO
 * reference, payment mode, confirm) are all served from here, and three of them
 * decide something a finance team will otherwise discover on an invoice:
 *
 * **The GSTIN decides the billing entity and the buyer's ITC position, but it
 * does NOT decide the tax split.** The split is our state against the DELIVERY
 * state — place of supply under s.10(1)(a) is where the movement terminates —
 * and resolving it from the billing address is the specific mistake PHASE_06
 * names. A Delhi-registered buyer taking delivery in Chennai owes IGST. So
 * `quote()` takes a delivery address and reads the state off THAT, and the
 * resolved split is on screen before anything is confirmed, because a wrong
 * GSTIN is cheap to fix before an invoice exists and expensive afterwards.
 *
 * **Every charge is on one screen.** Goods, freight, GST by head, total. No
 * progressive disclosure — drip pricing is a named prohibited practice in the
 * CCPA Dark Patterns Guidelines 2023. When freight cannot be priced for a lane,
 * the quote says so and refuses to confirm rather than quietly charging zero.
 *
 * **Nothing here names a source.** The vendor org ids and pickup pincodes this
 * file reads to quote freight and to group sub-orders never appear in a return
 * type. Every response below is an explicit allow-list, built field by field.
 */

/* ==========================================================================
 * The buyer-facing shapes. All allow-lists.
 * ======================================================================== */

export interface CheckoutLineView {
  offerId: string;
  title: string;
  specSummary: string;
  grade: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
  /** `Supply Point A · Gurugram`, and nothing finer than the city. */
  dispatchPoint: string;
  /** The exact machines held for this buyer, by serial. */
  serials: string[];
}

export interface GstProfileView {
  id: string;
  gstin: string;
  legalName: string;
  tradeName: string | null;
  stateCode: string;
  registrationType: string;
  isPrimary: boolean;
}

export interface DeliverySiteView {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  landmark: string | null;
  /** `org_address.delivery_instructions` — the gate and dock note. */
  gateInstructions: string | null;
  /**
   * Null, always, and honestly so. There is no receiving-hours column on
   * `identity.org_address`; PHASE_06 Task 1 asks for one and the schema does not
   * have it. The screen renders "Not recorded" rather than a plausible window,
   * because a delivery that arrives at a closed dock is a failed delivery and
   * inventing the hours is how that happens.
   */
  receivingHours: null;
  isDefault: boolean;
}

export interface PaymentModeView {
  mode: 'PREPAID' | 'PARTIAL_ADVANCE' | 'CREDIT';
  label: string;
  allowed: boolean;
  /** Present only when `allowed` is false. A disabled control must say why. */
  reason: string | null;
}

export interface TaxSplitView {
  interState: boolean;
  igst: string;
  cgst: string;
  sgst: string;
  /** `SGST` or `UTGST` — the same arithmetic, a different word on an invoice. */
  stateTaxLabel: 'SGST' | 'UTGST';
  ratePct: number;
  ourStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyState: string;
  basis: string;
}

export interface BreakUpView {
  goods: string;
  /** Null when a lane could not be priced. Never a zero standing in for one. */
  freight: string | null;
  freightUnpricedReason: string | null;
  taxableValue: string;
  gstTotal: string;
  grandTotal: string | null;
  tax: TaxSplitView;
}

export interface CheckoutSessionView {
  cartId: string;
  cartName: string;
  /** ISO 8601. The countdown on the screen reads this and nothing else. */
  holdExpiresAt: string;
  unitsHeld: number;
  lines: CheckoutLineView[];
  gstProfiles: GstProfileView[];
  billingAddresses: DeliverySiteView[];
  deliverySites: DeliverySiteView[];
  paymentModes: PaymentModeView[];
  poRequired: boolean;
  /** Chosen so far, echoed back so a reload resumes where the buyer was. */
  selection: {
    gstProfileId: string | null;
    billingAddressId: string | null;
    deliveryAddressId: string | null;
    paymentMode: string | null;
  };
  /** Null until a delivery site is chosen — the split needs a place of supply. */
  breakUp: BreakUpView | null;
  /** Set when a `buyer_approval_policy` threshold would fire on this order. */
  approval: { required: true; approverName: string; reason: string } | null;
}

export interface OrderConfirmationView {
  orderId: string;
  orderNumber: string;
  status: string;
  placedAt: string;
  holdExpiresAt: string;
  subtotal: string;
  freight: string;
  gstTotal: string;
  grandTotal: string;
  tax: TaxSplitView;
  serials: Array<{ serialNumber: string; dispatchPoint: string }>;
  /** What happens next, in words. The approval case is a different sentence. */
  next: string;
}

export interface ConfirmInput {
  cartId: string;
  gstProfileId: string;
  billingAddressId: string;
  deliveryAddressId: string;
  paymentMode: 'PREPAID' | 'PARTIAL_ADVANCE' | 'CREDIT';
  buyerPoNumber?: string;
  costCentre?: string;
  /** Test seam for ORD-020. Never reachable from a controller. */
  failAt?: (step: PostDecrementStep) => void;
}

/* ==========================================================================
 * Internal facts
 * ======================================================================== */

interface OfferFacts {
  listingId: string;
  skuId: string;
  grade: string;
  unitPrice: Money;
  gstRatePct: number;
  vendorOrgId: string;
  pickupPincode: string;
  purchasable: boolean;
}

/** A boxed laptop. The same figure the offers grid quotes freight on. */
const BOXED_LAPTOP_GRAMS = 2_500;

/** Where we are registered. Half of the s.10(1)(a) comparison, always. */
const OUR_STATE_CODE = LEGAL_DISCLOSURE.registeredOffice.stateCode;

const PAYMENT_MODE_LABELS: Record<string, string> = {
  PREPAID: 'Pay now — UPI, card, netbanking or NEFT/RTGS',
  PARTIAL_ADVANCE: 'Part payment now, balance before dispatch',
  CREDIT: 'On our credit terms with you',
};

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly holds: HoldService,
    private readonly orders: OrderTransactionService,
    private readonly logistics: LogisticsService,
    private readonly listings: ListingService,
    private readonly catalog: CatalogLookup,
  ) {}

  /* ----------------------------------------------------------------------
   * Entry, and the hold
   * ------------------------------------------------------------------- */

  /**
   * Enter checkout: validate, take the twenty-minute hold, and quote.
   *
   * The hold is taken BEFORE anything is priced, because the price is only
   * meaningful for machines the buyer actually has. Everything that can refuse
   * — an unverified buyer org, a cart with a short line, no GSTIN, no delivery
   * site — refuses before the hold, so a refused checkout never takes stock off
   * sale.
   */
  async begin(cartId: string): Promise<CheckoutSessionView> {
    const buyer = this.buyer();
    const cart = await this.requireCart(cartId);
    await this.assertBuyerMayOrder(buyer.orgId);

    const items = await this.cartItems(cartId);
    if (items.length === 0) {
      throw new ValidationError('There is nothing in this cart to check out.', {
        cart: 'Add at least one machine before starting checkout.',
      });
    }

    const facts = await this.offerFacts(items.map((i) => i.listingId));
    const labels = await this.dispatchLabels(items.map((i) => i.listingId));

    for (const item of items) {
      const offer = facts.get(item.listingId);
      if (!offer?.purchasable) {
        throw new PreconditionFailedError(
          'One of the supply points in this cart is no longer selling. Take that line out of the cart and start again.',
          { listingId: item.listingId },
        );
      }
    }

    const ttl = await this.holdTtlMinutes();
    const held = await this.holds.take({
      cartId,
      buyerOrgId: buyer.orgId,
      userId: buyer.userId,
      lines: items.map((i) => ({
        listingId: i.listingId,
        qty: i.qty,
        supplyPointLabel: labels.get(i.listingId) ?? 'this supply point',
      })),
      ttlMinutes: ttl,
    });

    return this.session({ cartId, cart, held, items, facts, labels, selection: {} });
  }

  /**
   * Re-quote without touching the hold.
   *
   * Every step of the flow after "review" calls this: choosing a GSTIN or a
   * delivery site changes the tax split and the freight, and the buyer must see
   * the recomputed break-up before the step that confirms. Re-entering checkout
   * does not renew the deadline — see `HoldService.take`.
   */
  async quote(
    cartId: string,
    selection: {
      gstProfileId?: string;
      billingAddressId?: string;
      deliveryAddressId?: string;
      paymentMode?: string;
    },
  ): Promise<CheckoutSessionView> {
    const buyer = this.buyer();
    const cart = await this.requireCart(cartId);
    const held = await this.holds.read(cartId);
    if (!held || held.expiresAt <= this.clock.now()) {
      throw new PreconditionFailedError(
        'The twenty-minute hold on these machines has expired and they are back on sale. Start checkout again to take a fresh hold.',
        { reason: 'hold_expired' },
      );
    }
    await this.assertBuyerMayOrder(buyer.orgId);

    const items = await this.cartItems(cartId);
    const facts = await this.offerFacts(items.map((i) => i.listingId));
    const labels = await this.dispatchLabels(items.map((i) => i.listingId));
    return this.session({ cartId, cart, held, items, facts, labels, selection });
  }

  /** The buyer walked away. Put the machines back on sale now, not in 20 minutes. */
  async abandon(cartId: string): Promise<{ released: number }> {
    this.buyer();
    await this.requireCart(cartId);
    const released = await this.holds.release(
      cartId,
      'The buyer left checkout, so the hold was released early.',
    );
    return { released };
  }

  /* ----------------------------------------------------------------------
   * Confirm — step 1 of the transaction, then the transaction
   * ------------------------------------------------------------------- */

  async confirm(input: ConfirmInput): Promise<OrderConfirmationView> {
    const buyer = this.buyer();
    await this.requireCart(input.cartId);
    await this.assertBuyerMayOrder(buyer.orgId);

    const items = await this.cartItems(input.cartId);
    if (items.length === 0) {
      throw new ValidationError('There is nothing in this cart to check out.', {
        cart: 'Add at least one machine before confirming.',
      });
    }
    const facts = await this.offerFacts(items.map((i) => i.listingId));
    const labels = await this.dispatchLabels(items.map((i) => i.listingId));

    // --- the buyer's choices, each validated against what they may choose ---
    const gst = (await this.gstProfiles(buyer.orgId)).find((g) => g.id === input.gstProfileId);
    if (!gst) {
      throw new ValidationError('Choose one of your registered GSTINs to bill this order to.', {
        gstProfileId: 'That GSTIN is not registered to your organisation.',
      });
    }
    const addresses = await this.addresses(buyer.orgId);
    const delivery = addresses.delivery.find((a) => a.id === input.deliveryAddressId);
    if (!delivery) {
      throw new ValidationError('Choose where these machines should be delivered.', {
        deliveryAddressId: 'That delivery site is not on your account.',
      });
    }
    const billing = addresses.billing.find((a) => a.id === input.billingAddressId);
    if (!billing) {
      throw new ValidationError('Choose the address to bill this order to.', {
        billingAddressId: 'That billing address is not on your account.',
      });
    }

    const prefs = await this.preferences(buyer.orgId);
    const poNumber = (input.buyerPoNumber ?? '').trim();
    if (prefs.poRequired && poNumber.length === 0) {
      throw new ValidationError(
        'Your organisation requires a purchase-order reference on every order. It prints on our invoice, and many finance teams will not process one without it.',
        { buyerPoNumber: 'Enter the PO reference your procurement system issued.' },
      );
    }
    if (poNumber.length > 40) {
      throw new ValidationError(
        `That reference is ${poNumber.length} characters. A purchase-order reference can be up to 40 — it has to fit on the invoice.`,
        { buyerPoNumber: 'Shorten it to 40 characters or fewer.' },
      );
    }

    const modes = await this.paymentModes(buyer.orgId);
    const chosen = modes.find((m) => m.mode === input.paymentMode);
    if (!chosen || !chosen.allowed) {
      throw new ValidationError(
        chosen?.reason ?? 'That payment method is not available on your account.',
        { paymentMode: chosen?.reason ?? 'Choose one of the methods offered.' },
      );
    }

    // --- freight, priced per supply point to the real delivery pincode -----
    const freight = await this.freight(items, facts, delivery.pincode);
    if (freight.unpricedReason) {
      throw new PreconditionFailedError(freight.unpricedReason, { reason: 'freight_unpriced' });
    }

    const lines: OrderLineRequest[] = items.map((item) => {
      const offer = facts.get(item.listingId)!;
      return {
        listingId: item.listingId,
        qty: item.qty,
        skuId: offer.skuId,
        grade: offer.grade,
        unitPrice: offer.unitPrice,
        gstRatePct: offer.gstRatePct,
        supplyPointLabel: labels.get(item.listingId) ?? 'this supply point',
      };
    });

    // --- approval policy: does this order need a signature? ----------------
    const goods = Money.sum(lines.map((l) => l.unitPrice.times(l.qty)));
    const approval = await this.approvalRequired(buyer, goods, lines);
    const ttlMinutes = approval
      ? (await this.approvalHoldHours()) * 60
      : await this.holdTtlMinutes();

    const result = await this.orders.confirm({
      cartId: input.cartId,
      buyerOrgId: buyer.orgId,
      buyerUserId: buyer.userId,
      billingGstProfileId: gst.id,
      billingAddressId: billing.id,
      shippingAddressId: delivery.id,
      buyerPoNumber: poNumber.length > 0 ? poNumber : null,
      costCentre: input.costCentre?.trim() || null,
      paymentMode: input.paymentMode,
      ourStateCode: OUR_STATE_CODE,
      // s.10(1)(a). The DELIVERY state, never the billing state, and never the
      // state on the GSTIN.
      deliveryStateCode: delivery.stateCode,
      lines,
      freightByVendor: freight.byVendor,
      approval: approval
        ? {
            approverUserId: approval.approverUserId,
            policyId: approval.policyId,
            expiresAt: new Date(this.clock.now().getTime() + ttlMinutes * 60_000),
          }
        : null,
      holdExpiresAt: new Date(this.clock.now().getTime() + ttlMinutes * 60_000),
      failAt: input.failAt,
    });

    const serialLabels = await this.dispatchLabelsForUnits(result.serials.map((s) => s.unitId));

    return {
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      status: result.status,
      placedAt: this.clock.now().toISOString(),
      holdExpiresAt: result.holdExpiresAt.toISOString(),
      subtotal: result.subtotal.toString(),
      freight: result.freightTotal.toString(),
      gstTotal: result.gstTotal.toString(),
      grandTotal: result.grandTotal.toString(),
      tax: this.taxView(
        {
          igst: result.igst,
          cgst: result.cgst,
          sgst: result.sgst,
          total: result.gstTotal,
          interState: result.interState,
          basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
        },
        delivery,
        lines[0]?.gstRatePct ?? 18,
      ),
      serials: result.serials.map((s) => ({
        serialNumber: s.serialNumber,
        dispatchPoint: serialLabels.get(s.unitId) ?? 'Dispatch point to be confirmed',
      })),
      next:
        result.status === 'AWAITING_APPROVAL'
          ? `Sent to ${approval?.approverName ?? 'your approver'} to sign off. These exact machines are held for you until then; if the approval is not given by ${result.holdExpiresAt.toISOString()}, they go back on sale and nothing is charged.`
          : result.status === 'PAYMENT_PENDING'
            ? 'These exact machines are allocated to you. Complete payment and we buy them on your behalf and arrange dispatch.'
            : 'Confirmed on your credit terms. These exact machines are allocated to you and we are arranging dispatch.',
    };
  }

  /* ----------------------------------------------------------------------
   * Assembling the session
   * ------------------------------------------------------------------- */

  private async session(input: {
    cartId: string;
    cart: { name: string };
    held: HeldStock;
    items: Array<{ listingId: string; qty: number }>;
    facts: Map<string, OfferFacts>;
    labels: Map<string, string>;
    selection: {
      gstProfileId?: string;
      billingAddressId?: string;
      deliveryAddressId?: string;
      paymentMode?: string;
    };
  }): Promise<CheckoutSessionView> {
    const buyer = this.buyer();
    const [gstProfiles, addresses, prefs, modes] = await Promise.all([
      this.gstProfiles(buyer.orgId),
      this.addresses(buyer.orgId),
      this.preferences(buyer.orgId),
      this.paymentModes(buyer.orgId),
    ]);

    const serials = await this.serialsByListing(input.held);
    const described = new Map<string, Awaited<ReturnType<CatalogLookup['describe']>>>();
    const lines: CheckoutLineView[] = [];
    for (const item of input.items) {
      const offer = input.facts.get(item.listingId);
      if (!offer) continue;
      if (!described.has(offer.skuId)) {
        described.set(offer.skuId, await this.catalog.describe(offer.skuId));
      }
      const sku = described.get(offer.skuId);
      lines.push({
        offerId: item.listingId,
        title: sku?.title ?? 'This model is no longer in the catalogue',
        specSummary: sku?.specSummary ?? '',
        grade: offer.grade,
        qty: item.qty,
        unitPrice: offer.unitPrice.toString(),
        lineTotal: offer.unitPrice.times(item.qty).toString(),
        dispatchPoint: input.labels.get(item.listingId) ?? 'Dispatch point to be confirmed',
        serials: serials.get(item.listingId) ?? [],
      });
    }

    const deliveryId = input.selection.deliveryAddressId ?? prefs.defaultShippingAddressId;
    const delivery = addresses.delivery.find((a) => a.id === deliveryId) ?? null;

    const goods = Money.sum(
      input.items.map((i) => (input.facts.get(i.listingId)?.unitPrice ?? Money.ZERO).times(i.qty)),
    );
    const approval = await this.approvalRequired(
      buyer,
      goods,
      input.items.map((i) => ({ qty: i.qty })),
    );

    return {
      cartId: input.cartId,
      cartName: input.cart.name,
      holdExpiresAt: input.held.expiresAt.toISOString(),
      unitsHeld: input.held.unitCount,
      lines,
      gstProfiles,
      billingAddresses: addresses.billing,
      deliverySites: addresses.delivery,
      paymentModes: modes,
      poRequired: prefs.poRequired,
      selection: {
        gstProfileId:
          input.selection.gstProfileId ??
          prefs.defaultGstProfileId ??
          gstProfiles.find((g) => g.isPrimary)?.id ??
          null,
        billingAddressId:
          input.selection.billingAddressId ??
          addresses.billing.find((a) => a.isDefault)?.id ??
          null,
        deliveryAddressId: delivery?.id ?? null,
        paymentMode:
          input.selection.paymentMode ?? modes.find((m) => m.allowed)?.mode ?? null,
      },
      breakUp: delivery
        ? await this.breakUp(input.items, input.facts, delivery, goods)
        : null,
      approval: approval
        ? {
            required: true,
            approverName: approval.approverName,
            reason: approval.reason,
          }
        : null,
    };
  }

  /**
   * The whole price, on one screen, with the split resolved before confirmation.
   *
   * Freight is quoted per supply point against the real delivery pincode. An
   * unpriced lane produces `freight: null` and a reason, never a zero — a zero
   * standing in for "we could not price it" is a price misrepresentation under
   * CP e-Comm r.6(5), and `grandTotal` is then null rather than a smaller number
   * a buyer would read as the total.
   */
  private async breakUp(
    items: Array<{ listingId: string; qty: number }>,
    facts: Map<string, OfferFacts>,
    delivery: DeliverySiteView,
    goods: Money,
  ): Promise<BreakUpView> {
    const freight = await this.freight(items, facts, delivery.pincode);
    const ratePct = facts.get(items[0]?.listingId ?? '')?.gstRatePct ?? 18;

    if (freight.unpricedReason) {
      return {
        goods: goods.toString(),
        freight: null,
        freightUnpricedReason: freight.unpricedReason,
        taxableValue: goods.toString(),
        gstTotal: '0.00',
        grandTotal: null,
        tax: this.taxView(zeroSplit(), delivery, ratePct),
      };
    }

    const freightTotal = Money.sum([...freight.byVendor.values()]);
    const taxable = goods.add(freightTotal);
    const split = resolveTaxSplit({
      supplierState: OUR_STATE_CODE,
      placeOfSupply: delivery.stateCode,
      taxableAmount: taxable,
      ratePct,
      basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
    });

    return {
      goods: goods.toString(),
      freight: freightTotal.toString(),
      freightUnpricedReason: null,
      taxableValue: taxable.toString(),
      gstTotal: split.total.toString(),
      grandTotal: taxable.add(split.total).toString(),
      tax: this.taxView(split, delivery, ratePct),
    };
  }

  private taxView(split: TaxSplit, delivery: DeliverySiteView, ratePct: number): TaxSplitView {
    return {
      interState: split.interState,
      igst: split.igst.toString(),
      cgst: split.cgst.toString(),
      sgst: split.sgst.toString(),
      stateTaxLabel: stateTaxLabel(delivery.stateCode),
      ratePct,
      ourStateCode: OUR_STATE_CODE,
      placeOfSupplyStateCode: delivery.stateCode,
      placeOfSupplyState: delivery.state,
      basis: split.basis,
    };
  }

  private async freight(
    items: Array<{ listingId: string; qty: number }>,
    facts: Map<string, OfferFacts>,
    toPincode: string,
  ): Promise<{ byVendor: Map<string, Money>; unpricedReason: string | null }> {
    // One consignment per supply point: the machines leaving one warehouse
    // travel together, so quoting per line would charge a minimum three times.
    const perLane = new Map<string, { vendorOrgId: string; from: string; units: number }>();
    for (const item of items) {
      const offer = facts.get(item.listingId);
      if (!offer) continue;
      const key = `${offer.vendorOrgId}:${offer.pickupPincode}`;
      const lane = perLane.get(key);
      if (lane) lane.units += item.qty;
      else
        perLane.set(key, {
          vendorOrgId: offer.vendorOrgId,
          from: offer.pickupPincode,
          units: item.qty,
        });
    }

    const requests = [...perLane.values()].map((l) => ({
      fromPincode: l.from,
      toPincode,
      weightGrams: BOXED_LAPTOP_GRAMS,
      units: l.units,
    }));
    if (requests.length === 0) return { byVendor: new Map(), unpricedReason: null };

    const quotes = await this.logistics.quoteFreightBatch(requests);
    const byVendor = new Map<string, Money>();
    for (const lane of perLane.values()) {
      const quote = quotes.get(
        freightLaneKey({
          fromPincode: lane.from,
          toPincode,
          weightGrams: BOXED_LAPTOP_GRAMS,
          units: lane.units,
        }),
      );
      if (!quote?.serviceable) {
        return {
          byVendor: new Map(),
          // The carrier's own sentence, which never names the origin.
          unpricedReason:
            quote?.reason ??
            'We cannot price delivery to that pincode yet, so we will not put a figure on it. Try another delivery site, or contact us and we will quote it by hand.',
        };
      }
      byVendor.set(lane.vendorOrgId, (byVendor.get(lane.vendorOrgId) ?? Money.ZERO).add(quote.amount));
    }
    return { byVendor, unpricedReason: null };
  }

  /* ----------------------------------------------------------------------
   * Step 1 — who may order, and for how much
   * ------------------------------------------------------------------- */

  private buyer(): { orgId: string; userId: string } {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Checkout belongs to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return { orgId: p.orgId, userId: p.userId };
  }

  /**
   * Buyer org VERIFIED, and inside its credit headroom.
   *
   * The verification message says what is happening and roughly when, rather
   * than refusing flatly: an organisation mid-review is a customer we want, and
   * "not allowed" reads as a rejection of them rather than a state of their
   * paperwork.
   */
  private async assertBuyerMayOrder(orgId: string): Promise<void> {
    const [org] = await this.prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM identity.organization WHERE id = ${orgId}::uuid`;
    if (!org) throw new NotFoundError('organisation');
    if (org.status !== 'VERIFIED') {
      throw new PreconditionFailedError(
        org.status === 'SUSPENDED'
          ? 'Ordering is paused on this account. Contact us and we will tell you exactly what is outstanding.'
          : 'Your account is still being verified, so orders cannot be placed yet. We will email the moment it clears — usually within one working day.',
        { orgStatus: org.status },
      );
    }
  }

  private async preferences(orgId: string): Promise<{
    poRequired: boolean;
    defaultShippingAddressId: string | null;
    defaultGstProfileId: string | null;
  }> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        po_required: boolean;
        default_shipping_address_id: string | null;
        default_billing_gst_profile_id: string | null;
      }>
    >`
      SELECT po_required, default_shipping_address_id, default_billing_gst_profile_id
        FROM customer.org_preference WHERE org_id = ${orgId}::uuid`;
    return {
      poRequired: row?.po_required ?? false,
      defaultShippingAddressId: row?.default_shipping_address_id ?? null,
      defaultGstProfileId: row?.default_billing_gst_profile_id ?? null,
    };
  }

  /**
   * Which methods this buyer may use.
   *
   * Filtered by `buyer_approval_policy.allowed_payment_modes` where a policy
   * targets this person, falling back to `buyer_profile.payment_mode_allowed`
   * for the organisation. A junior buyer may be permitted prepaid but not the
   * company credit line, and a mode they cannot use is shown disabled WITH THE
   * REASON rather than hidden — a control that vanishes teaches nobody anything.
   */
  private async paymentModes(orgId: string): Promise<PaymentModeView[]> {
    const userId = this.ctx.principal?.userId ?? null;
    const [profile] = await this.prisma.$queryRaw<
      Array<{ modes: string[]; credit_limit: string; credit_used: string }>
    >`
      SELECT payment_mode_allowed::text[] AS modes,
             credit_limit::text AS credit_limit, credit_used::text AS credit_used
        FROM customer.buyer_profile WHERE org_id = ${orgId}::uuid`;

    const [policy] = await this.prisma.$queryRaw<Array<{ modes: string[] }>>`
      SELECT allowed_payment_modes::text[] AS modes
        FROM customer.buyer_approval_policy
       WHERE org_id = ${orgId}::uuid AND is_active AND user_id = ${userId}::uuid
       LIMIT 1`;

    const orgModes = new Set(profile?.modes ?? ['PREPAID']);
    const mine = policy ? new Set(policy.modes) : orgModes;
    const creditLimit = moneyFromDb(profile?.credit_limit ?? '0') ?? Money.ZERO;
    const creditUsed = moneyFromDb(profile?.credit_used ?? '0') ?? Money.ZERO;

    return (['PREPAID', 'PARTIAL_ADVANCE', 'CREDIT'] as const).map((mode) => {
      if (!orgModes.has(mode)) {
        return {
          mode,
          label: PAYMENT_MODE_LABELS[mode]!,
          allowed: false,
          reason:
            mode === 'CREDIT'
              ? 'Your organisation does not have a credit line with us yet. Apply from Account, and we usually answer within two working days.'
              : 'This method is not enabled on your organisation. Your account owner can turn it on.',
        };
      }
      if (!mine.has(mode)) {
        return {
          mode,
          label: PAYMENT_MODE_LABELS[mode]!,
          allowed: false,
          reason:
            'Your buying policy does not include this method. Your account owner can change it in Account → Approvals.',
        };
      }
      if (mode === 'CREDIT' && !creditLimit.sub(creditUsed).isPositive()) {
        return {
          mode,
          label: PAYMENT_MODE_LABELS[mode]!,
          allowed: false,
          reason: `Your credit line is fully drawn — ${creditUsed.format()} of ${creditLimit.format()} is outstanding. Settle an invoice or pay for this order now.`,
        };
      }
      return { mode, label: PAYMENT_MODE_LABELS[mode]!, allowed: true, reason: null };
    });
  }

  /**
   * Does this order need somebody's signature?
   *
   * A policy targets exactly one of a user or a role (`chk_policy_target`), so
   * the user-targeted one wins where both could apply. `approver_user_id` null
   * falls back to the organisation's owner, because a threshold with nobody to
   * ask is a threshold that strands the order.
   */
  private async approvalRequired(
    buyer: { orgId: string; userId: string },
    orderValue: Money,
    lines: ReadonlyArray<{ qty: number }>,
  ): Promise<{
    approverUserId: string;
    approverName: string;
    policyId: string | null;
    reason: string;
  } | null> {
    const [policy] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        max_order_value: string | null;
        max_units_per_order: number | null;
        requires_approval_above: string | null;
        approver_user_id: string | null;
      }>
    >`
      SELECT id, max_order_value::text AS max_order_value, max_units_per_order,
             requires_approval_above::text AS requires_approval_above, approver_user_id
        FROM customer.buyer_approval_policy
       WHERE org_id = ${buyer.orgId}::uuid AND is_active AND user_id = ${buyer.userId}::uuid
       LIMIT 1`;
    if (!policy) return null;

    const units = lines.reduce((n, l) => n + l.qty, 0);
    const threshold = moneyFromDb(policy.requires_approval_above);
    const ceiling = moneyFromDb(policy.max_order_value);

    let reason: string | null = null;
    if (ceiling && orderValue.gt(ceiling)) {
      reason = `This order is ${orderValue.format()}. Your buying limit is ${ceiling.format()}, so it needs sign-off.`;
    } else if (threshold && orderValue.gt(threshold)) {
      reason = `This order is ${orderValue.format()}, above the ${threshold.format()} your organisation set for approval.`;
    } else if (policy.max_units_per_order !== null && units > policy.max_units_per_order) {
      reason = `This order is ${units} machines. Your policy allows ${policy.max_units_per_order} per order without sign-off.`;
    }
    if (!reason) return null;

    const approverUserId = policy.approver_user_id ?? (await this.orgOwner(buyer.orgId));
    if (!approverUserId) {
      throw new PreconditionFailedError(
        'This order needs approval, but your organisation has nobody set up to give it. Ask your account owner to name an approver in Account → Approvals.',
        { reason: 'no_approver' },
      );
    }
    const [approver] = await this.prisma.$queryRaw<Array<{ full_name: string }>>`
      SELECT full_name FROM identity.user_account WHERE id = ${approverUserId}::uuid`;

    return {
      approverUserId,
      approverName: approver?.full_name ?? 'your approver',
      policyId: policy.id,
      reason,
    };
  }

  private async orgOwner(orgId: string): Promise<string | null> {
    const [row] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.user_account
       WHERE org_id = ${orgId}::uuid AND status = 'ACTIVE'
       ORDER BY created_at ASC
       LIMIT 1`;
    return row?.id ?? null;
  }

  /* ----------------------------------------------------------------------
   * Reads
   * ------------------------------------------------------------------- */

  private async requireCart(cartId: string): Promise<{ id: string; name: string }> {
    const buyer = this.buyer();
    const [cart] = await this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ordering.cart
       WHERE id = ${cartId}::uuid AND buyer_org_id = ${buyer.orgId}::uuid
         AND user_id = ${buyer.userId}::uuid AND status = 'OPEN'`;
    if (!cart) throw new NotFoundError('cart');
    return cart;
  }

  private async cartItems(cartId: string): Promise<Array<{ listingId: string; qty: number }>> {
    const rows = await this.prisma.$queryRaw<Array<{ listing_id: string; qty: number }>>`
      SELECT listing_id, qty FROM ordering.cart_item
       WHERE cart_id = ${cartId}::uuid ORDER BY added_at ASC`;
    return rows.map((r) => ({ listingId: r.listing_id, qty: r.qty }));
  }

  /**
   * The offer's commercial facts, as an allow-list.
   *
   * The buyer-facing half — price, grade, SKU, whether it is on sale — comes
   * from `ListingService.availabilityByListing`, which is the one sanctioned
   * offer read and counts availability through `v_sellable_unit`. Ordering does
   * not restate the sellable predicate anywhere.
   *
   * The other three fields have no barrel method yet. `vendor_org_id` groups the
   * sub-orders and the purchase orders; the pickup pincode is the origin of the
   * freight lane; `gst_rate` is the rate on the invoice. All three are read here
   * as a hand-written projection, in two statements rather than a join — one per
   * schema, so the seam holds — and none of them reaches a response type.
   */
  private async offerFacts(listingIds: readonly string[]): Promise<Map<string, OfferFacts>> {
    if (listingIds.length === 0) return new Map();

    const availability = await this.listings.availabilityByListing(listingIds);
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        gst_rate: string;
        vendor_org_id: string;
        pickup_location_id: string;
      }>
    >`
      SELECT id, gst_rate::text AS gst_rate, vendor_org_id, pickup_location_id
        FROM listing.listing
       WHERE id = ANY(${[...listingIds]}::uuid[])`;

    const pincodes = await this.pincodesByAddress(rows.map((r) => r.pickup_location_id));

    const out = new Map<string, OfferFacts>();
    for (const r of rows) {
      const stock = availability.get(r.id);
      if (!stock) continue;
      out.set(r.id, {
        listingId: r.id,
        skuId: stock.skuId,
        grade: stock.grade,
        unitPrice: stock.unitPrice,
        gstRatePct: Number(r.gst_rate),
        vendorOrgId: r.vendor_org_id,
        pickupPincode: pincodes.get(r.pickup_location_id) ?? '',
        purchasable: stock.purchasable,
      });
    }
    return out;
  }

  private async pincodesByAddress(addressIds: readonly string[]): Promise<Map<string, string>> {
    if (addressIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; pincode: string }>>`
      SELECT id, pincode FROM identity.org_address
       WHERE id = ANY(${[...new Set(addressIds)]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.pincode]));
  }

  /**
   * `Supply Point A · Gurugram`, per listing. The anonymity boundary.
   *
   * Resolved by `listing` rather than here, so the vendor org id that turns into
   * a letter stays on the other side of the seam.
   */
  private async dispatchLabels(listingIds: readonly string[]): Promise<Map<string, string>> {
    const availability = await this.listings.availabilityByListing(listingIds);
    const out = new Map<string, string>();
    for (const [listingId, stock] of availability) {
      out.set(
        listingId,
        stock.supplyPointCode && stock.city
          ? supplyPointLabel(stock.supplyPointCode, stock.city)
          : 'Dispatch point to be confirmed',
      );
    }
    return out;
  }

  /**
   * The same label per allocated machine, for the confirmation page.
   *
   * Joined inside `listing`'s own schema and on both keys the unique constraint
   * uses: `uq_supply_point_vendor_city` means a code is unique per city, not
   * globally, so joining on `code` alone would eventually label two vendors the
   * same and quietly merge two supply points into one on screen.
   */
  private async dispatchLabelsForUnits(unitIds: readonly string[]): Promise<Map<string, string>> {
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; supply_point_code: string | null; city: string | null }>
    >`
      SELECT u.id, u.supply_point_code, p.city
        FROM listing.unit u
        LEFT JOIN listing.supply_point p
               ON p.vendor_org_id = u.vendor_org_id AND p.code = u.supply_point_code
       WHERE u.id = ANY(${[...unitIds]}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.id,
        r.supply_point_code && r.city
          ? supplyPointLabel(r.supply_point_code, r.city)
          : 'Dispatch point to be confirmed',
      ]),
    );
  }

  /** The serials actually held, per listing. What the review step shows. */
  private async serialsByListing(held: HeldStock): Promise<Map<string, string[]>> {
    const unitIds = [...held.unitsByListing.values()].flat();
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; serial_number: string }>>`
      SELECT id, serial_number FROM listing.unit
       WHERE id = ANY(${unitIds}::uuid[]) ORDER BY serial_number`;
    const serialOf = new Map(rows.map((r) => [r.id, r.serial_number]));
    const out = new Map<string, string[]>();
    for (const [listingId, ids] of held.unitsByListing) {
      out.set(
        listingId,
        ids.map((id) => serialOf.get(id) ?? '').filter((s) => s.length > 0),
      );
    }
    return out;
  }

  private async gstProfiles(orgId: string): Promise<GstProfileView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        gstin: string;
        legal_name_as_per_gst: string;
        trade_name: string | null;
        state_code: string;
        registration_type: string;
        is_primary: boolean;
      }>
    >`
      SELECT id, gstin, legal_name_as_per_gst, trade_name, state_code,
             registration_type, is_primary
        FROM kyc.gst_profile
       WHERE org_id = ${orgId}::uuid AND status = 'ACTIVE'
       ORDER BY is_primary DESC, gstin`;
    return rows.map((r) => ({
      id: r.id,
      gstin: r.gstin,
      legalName: r.legal_name_as_per_gst,
      tradeName: r.trade_name,
      stateCode: r.state_code,
      registrationType: r.registration_type,
      isPrimary: r.is_primary,
    }));
  }

  /**
   * Where we may bill, and where we may deliver.
   *
   * `identity.org_address` has `is_billing_enabled` and `is_pickup_enabled` but
   * **no `is_delivery_enabled`** — PHASE_06 Task 1 assumes one and the schema
   * does not have it. A SHIPPING or REGISTERED address that is active is the
   * closest true statement, and it is stated here in one place rather than
   * guessed at in three.
   */
  private async addresses(
    orgId: string,
  ): Promise<{ billing: DeliverySiteView[]; delivery: DeliverySiteView[] }> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        label: string | null;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        state_code: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
        landmark: string | null;
        delivery_instructions: string | null;
        is_default: boolean;
        is_billing_enabled: boolean;
      }>
    >`
      SELECT id, type::text AS type, label, line1, line2, city, state, state_code, pincode,
             contact_name, contact_mobile, landmark, delivery_instructions,
             is_default, is_billing_enabled
        FROM identity.org_address
       WHERE org_id = ${orgId}::uuid AND is_active
       ORDER BY is_default DESC, city`;

    const view = (r: (typeof rows)[number]): DeliverySiteView => ({
      id: r.id,
      label: r.label,
      line1: r.line1,
      line2: r.line2,
      city: r.city,
      state: r.state,
      stateCode: r.state_code,
      pincode: r.pincode,
      contactName: r.contact_name,
      contactMobile: r.contact_mobile,
      landmark: r.landmark,
      gateInstructions: r.delivery_instructions,
      receivingHours: null,
      isDefault: r.is_default,
    });

    return {
      billing: rows.filter((r) => r.is_billing_enabled || r.type === 'BILLING' || r.type === 'REGISTERED').map(view),
      delivery: rows.filter((r) => r.type === 'SHIPPING' || r.type === 'REGISTERED').map(view),
    };
  }

  private async holdTtlMinutes(): Promise<number> {
    return this.configNumber('ordering.reservation_ttl_minutes', 20);
  }

  private async approvalHoldHours(): Promise<number> {
    return this.configNumber('ordering.approval_hold_ttl_hours', 24);
  }

  private async configNumber(key: string, fallback: number): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = ${key}`;
    const n = Number(row?.value_json ?? fallback);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
}

/** No delivery site chosen yet, so no split has been resolved. Zeroes, not guesses. */
function zeroSplit(): TaxSplit {
  return {
    igst: Money.ZERO,
    cgst: Money.ZERO,
    sgst: Money.ZERO,
    total: Money.ZERO,
    interState: false,
    basis: 's.10(1)(a) IGST Act — resolved once a delivery site is chosen',
  };
}
