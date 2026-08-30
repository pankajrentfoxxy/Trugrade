import { Injectable } from '@nestjs/common';
import { Money } from '@trugrade/contracts';
import {
  PaymentService,
  type BillingConsignment,
  type BillingLine,
  type IssuedInvoice,
  type OrderBillingBasis,
  type OrderDocumentsView,
  type ValuationMethod,
} from '../../payment';
import { AuditService } from '../../identity';
import { PrismaService } from '../../../shared/db/prisma.service';
import { RequestContextService } from '../../../shared/db/org-scope';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/domain-errors';
import { CatalogLookup } from './catalog-lookup';
import { dispatchLabels, UNKNOWN_DISPATCH_LABEL } from './dispatch-label';

/**
 * Re-exported so the controller can type its own response without importing
 * another module's barrel for a type. The shape is payment's; the route is
 * ordering's.
 */
export type { OrderDocumentsView };

/**
 * The documents on one order — T22, `03_UX_SPEC.md` §3A.3.
 *
 * This file is the *ordering* half of a two-module answer, and the split is the
 * point. `ordering` owns the order and is the only module that may read it;
 * `payment` owns the invoice and is the only module that may issue or render
 * one. So this class reads the order into an `OrderBillingBasis` — a value, not
 * a handle — and hands it over. `payment` has no path back into
 * `ordering."order"` and therefore no path to a vendor org id.
 *
 * **The basis is itself an allow-list.** `ordering.sub_order.vendor_org_id` is
 * read here, once, to resolve the anonymised dispatch label, and it does not
 * appear on the object that leaves this method. Neither does the purchase order
 * we raised to the supply point: under the merchant-of-record model that
 * document is vendor-and-admin-only (PHASE_06 Task 6), and the way that stays
 * true is that no buyer-reachable code path reads `procurement.purchase_order`
 * at all. Nothing below does.
 *
 * **An order belonging to another organisation is 404, not 403.** Order numbers
 * are sequential, so "you may not see TT-26-00004" confirms it exists and turns
 * the route into an order-volume oracle for anyone with an account. T17
 * established that and this matches it. The scoping is in the statement's own
 * `WHERE`, not in a check after the fetch.
 */

/**
 * Statuses at which the goods have LEFT the supply point.
 *
 * s.31(1)(a) CGST Act puts the tax invoice at removal for delivery, so this set
 * is the trigger for issuing one. It is written out rather than expressed as
 * "after CONFIRMED in the enum" because `order_status` is an ordered list only
 * by accident of declaration, and a status inserted in the middle of it later
 * would silently start or stop invoicing.
 */
const REMOVED_STATUSES = new Set([
  'PICKED_UP',
  'AT_HUB',
  'QC_IN_PROGRESS',
  'QC_HOLD',
  'QC_CLEARED',
  'INVOICED',
  'PACKED',
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PARTIALLY_FULFILLED',
  'COMPLETED',
]);

/** An order nobody has committed to yet has nothing to bill and nothing to pay. */
const UNCOMMITTED_STATUSES = new Set(['CREATED', 'AWAITING_APPROVAL']);

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  buyer_po_number: string | null;
  cost_centre: string | null;
  placed_at: Date;
  billing_gst_profile_id: string;
  billing_address_id: string;
  shipping_address_id: string;
}

interface LineRow {
  sub_order_id: string;
  sub_order_status: string;
  sub_order_number: string;
  freight: string;
  order_line_id: string;
  sku_id: string;
  grade: string;
  unit_price: string;
  gst_rate: string;
  unit_id: string;
  serial_number: string;
}

@Injectable()
export class OrderDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
    private readonly catalog: CatalogLookup,
    private readonly payments: PaymentService,
    private readonly audit: AuditService,
  ) {}

  /** Every document on the order, existing or not. Issues nothing. */
  async byOrderNumber(orderNumber: string): Promise<OrderDocumentsView> {
    return this.payments.documentsForOrder(await this.basis(orderNumber));
  }

  /**
   * One document's bytes, and the `audit_log` row that says who took it.
   *
   * The audit is written on this path rather than when the list is read, because
   * a list is a page view and this is a download. `03_UX_SPEC` §3A.3 says every
   * download writes a row, and a row per page view would make the log useless
   * for the question it exists to answer.
   *
   * Recorded BEFORE the bytes are handed over: an audit written afterwards is
   * one thrown response away from a document that left without a trace.
   */
  async download(
    orderNumber: string,
    documentId: string,
  ): Promise<{ url: string; filename: string }> {
    const basis = await this.basis(orderNumber);
    const document = await this.payments.documentUrl(basis, documentId);
    if (!document) {
      // A document that does not exist and one belonging to another
      // organisation are the same answer, deliberately. Invoice numbers are a
      // gapless sequence, so distinguishing them would count our invoices for
      // anybody with an account.
      throw new NotFoundError('document', { reason: 'no_such_document_on_this_order' });
    }

    await this.audit.record({
      action: 'payment.document.downloaded',
      entityType: 'payment.invoice',
      // `proforma` for the derived document, an invoice uuid otherwise. The id
      // the buyer asked with, so the log answers "who took what" directly.
      entityId: documentId,
      after: { orderNumber: basis.orderNumber, filename: document.filename },
    });

    return document;
  }

  /**
   * Issue the tax invoices this order is due, for an operator or a job.
   *
   * Not reachable from a buyer route and not reachable from a GET. Issuing
   * consumes a number from the statutory series, and a number consumed by a
   * crawler is a gap somebody has to explain in an audit.
   */
  async issue(orderNumber: string): Promise<IssuedInvoice[]> {
    return this.payments.issueTaxInvoices(await this.basis(orderNumber));
  }

  /* ----------------------------------------------------------------------
   * Building the basis
   * ------------------------------------------------------------------- */

  private async basis(orderNumber: string): Promise<OrderBillingBasis> {
    const scope = this.readerOrgId();

    const [order] = await this.prisma.$queryRaw<Array<OrderRow & { buyer_org_id: string }>>`
      SELECT id, order_number, status::text AS status, buyer_po_number, cost_centre, placed_at,
             buyer_org_id, billing_gst_profile_id, billing_address_id, shipping_address_id
        FROM ordering."order"
       WHERE order_number = ${orderNumber}
         AND (${scope}::uuid IS NULL OR buyer_org_id = ${scope}::uuid)`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });
    const orgId = order.buyer_org_id;

    const rows = await this.prisma.$queryRaw<LineRow[]>`
      SELECT so.id AS sub_order_id, so.status::text AS sub_order_status, so.sub_order_number,
             so.freight::text AS freight, ol.id AS order_line_id, ol.sku_id,
             ol.grade::text AS grade, ol.unit_price::text AS unit_price,
             ol.gst_rate::text AS gst_rate, olu.unit_id, olu.serial_number
        FROM ordering.sub_order so
        JOIN ordering.order_line ol ON ol.sub_order_id = so.id
        JOIN ordering.order_line_unit olu ON olu.order_line_id = ol.id
       WHERE so.order_id = ${order.id}::uuid
       ORDER BY so.sub_order_number, olu.serial_number`;

    const unitIds = rows.map((r) => r.unit_id);
    const [labels, valuations, party, addresses, descriptions] = await Promise.all([
      dispatchLabels(this.prisma, unitIds),
      this.valuations(unitIds),
      this.party(order.billing_gst_profile_id),
      this.addresses([order.billing_address_id, order.shipping_address_id]),
      this.describe([...new Set(rows.map((r) => r.sku_id))]),
    ]);

    const billingAddress = addresses.get(order.billing_address_id);
    const deliveryAddress = addresses.get(order.shipping_address_id);
    if (!party || !billingAddress || !deliveryAddress) {
      throw new NotFoundError('order', { reason: 'order_references_a_removed_record' });
    }

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      buyerOrgId: orgId,
      placedAt: order.placed_at,
      confirmed: !UNCOMMITTED_STATUSES.has(order.status) && order.status !== 'CANCELLED',
      cancelled: order.status === 'CANCELLED',
      // An empty string is what a form posts when nobody typed anything. It is
      // not a reference, and printing it puts a blank line on an invoice.
      buyerPoNumber: order.buyer_po_number?.trim() || null,
      costCentre: order.cost_centre?.trim() || null,
      billedTo: party,
      billingAddress,
      deliveryAddress,
      consignments: this.consignments(rows, labels, valuations, descriptions),
    };
  }

  /**
   * The machines grouped into the consignments they travel in.
   *
   * Grouped by sub-order, which is one supply point — but the label the buyer
   * sees comes from the MACHINES, not from the sub-order's vendor, so nothing
   * downstream can reach a supplier through it.
   *
   * Lines are split by `(order_line, valuation_method, purchase_price)` rather
   * than by order line alone. Rule 32(5) values a margin per serial, and two
   * machines on one line bought at different prices carry different margins;
   * one line with an averaged cost would break the scheme outright.
   */
  private consignments(
    rows: readonly LineRow[],
    labels: ReadonlyMap<string, string>,
    valuations: ReadonlyMap<string, { method: ValuationMethod; purchasePrice: string | null }>,
    descriptions: ReadonlyMap<string, { title: string; hsn: string }>,
  ): BillingConsignment[] {
    const bySubOrder = new Map<
      string,
      { freight: string; status: string; label: string; lines: Map<string, BillingLine> }
    >();

    for (const row of rows) {
      const consignment =
        bySubOrder.get(row.sub_order_id) ??
        (() => {
          const created = {
            freight: row.freight,
            status: row.sub_order_status,
            label: labels.get(row.unit_id) ?? UNKNOWN_DISPATCH_LABEL,
            lines: new Map<string, BillingLine>(),
          };
          bySubOrder.set(row.sub_order_id, created);
          return created;
        })();

      const valuation = valuations.get(row.unit_id) ?? { method: 'REGULAR' as const, purchasePrice: null };
      const purchasePrice = valuation.method === 'MARGIN' ? valuation.purchasePrice : null;
      const key = `${row.order_line_id}|${valuation.method}|${purchasePrice ?? ''}`;
      const description = descriptions.get(row.sku_id);

      const line =
        consignment.lines.get(key) ??
        ({
          skuId: row.sku_id,
          // Catalog terms and a grade. Never a listing, never a supply point.
          description: `${description?.title ?? 'Refurbished laptop'} · Grade ${row.grade.replace('_PLUS', '+')}`,
          hsn: description?.hsn ?? DEFAULT_HSN,
          qty: 0,
          unitPrice: row.unit_price,
          gstRatePct: Number(row.gst_rate),
          serialNumbers: [] as string[],
          valuationMethod: valuation.method,
          purchasePrice,
        } satisfies BillingLine & { serialNumbers: string[] });

      (line.serialNumbers as string[]).push(row.serial_number);
      line.qty = line.serialNumbers.length;
      consignment.lines.set(key, line);
    }

    return [...bySubOrder.entries()]
      .map(([subOrderId, c]) => ({
        subOrderId,
        dispatchLabel: c.label,
        freight: c.freight,
        removed: REMOVED_STATUSES.has(c.status),
        lines: [...c.lines.values()],
      }))
      .sort((a, b) => a.dispatchLabel.localeCompare(b.dispatchLabel));
  }

  /**
   * How each machine was bought, for Rule 32(5).
   *
   * `listing.unit.purchase_price` is frozen by `trg_lock_purchase_price` at
   * allocation, so this is the same figure the order was priced against — read
   * back rather than re-derived, because a margin computed from a price that
   * moved is a margin nobody can defend months later.
   *
   * **`purchase_price` is our cost and never leaves the API.** It goes into
   * `payment` to satisfy `chk_margin_line_complete`, is stored, and is not on
   * any buyer-facing payload or in the rendered PDF.
   */
  private async valuations(
    unitIds: readonly string[],
  ): Promise<Map<string, { method: ValuationMethod; purchasePrice: string | null }>> {
    if (unitIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; valuation_method: string; purchase_price: string | null }>
    >`
      SELECT id, valuation_method, purchase_price::text AS purchase_price
        FROM listing.unit WHERE id = ANY(${[...unitIds]}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          method: (r.valuation_method === 'MARGIN' ? 'MARGIN' : 'REGULAR') as ValuationMethod,
          // A MARGIN unit with no frozen purchase price cannot be valued under
          // Rule 32(5) at all, so it falls back to REGULAR-style full value —
          // the HIGHER tax. Guessing downwards would be understating our own
          // liability on a document we sign.
          purchasePrice: r.purchase_price === null ? null : Money.parse(r.purchase_price).toString(),
        },
      ]),
    );
  }

  private async describe(
    skuIds: readonly string[],
  ): Promise<Map<string, { title: string; hsn: string }>> {
    const entries = await Promise.all(
      skuIds.map(async (id) => {
        const sku = await this.catalog.describe(id);
        return [id, sku ? { title: sku.title, hsn: sku.hsn } : null] as const;
      }),
    );
    return new Map(
      entries.filter((e): e is readonly [string, { title: string; hsn: string }] => e[1] !== null),
    );
  }

  /**
   * The organisation whose orders the caller may read, as a SQL predicate.
   *
   * `null` for platform staff, which is the same across-orgs grant `OrgScope`
   * makes everywhere else and which finance and the issuing endpoint genuinely
   * need. A vendor gets nothing: a supply point has no business reading the
   * document we issue to a buyer, and that is the whole anonymity model seen
   * from the other side.
   */
  private readerOrgId(): string | null {
    const p = this.ctx.requirePrincipal();
    if (p.orgType === 'PLATFORM') return null;
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Order documents belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }

  /** Who the invoice names. The buyer's own entity, from their GSTIN. */
  private async party(gstProfileId: string): Promise<OrderBillingBasis['billedTo'] | null> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        gstin: string;
        legal_name_as_per_gst: string;
        trade_name: string | null;
        state_code: string;
      }>
    >`
      SELECT gstin, legal_name_as_per_gst, trade_name, state_code
        FROM kyc.gst_profile WHERE id = ${gstProfileId}::uuid`;
    return row
      ? {
          gstin: row.gstin.trim(),
          legalName: row.legal_name_as_per_gst,
          tradeName: row.trade_name,
          stateCode: row.state_code.trim(),
        }
      : null;
  }

  private async addresses(
    ids: readonly string[],
  ): Promise<Map<string, OrderBillingBasis['billingAddress']>> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        state_code: string;
        pincode: string;
        contact_name: string;
        contact_mobile: string;
      }>
    >`
      SELECT id, line1, line2, city, state, state_code, pincode, contact_name, contact_mobile
        FROM identity.org_address
       WHERE id = ANY(${[...new Set(ids)]}::uuid[])`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          line1: r.line1,
          line2: r.line2,
          city: r.city,
          state: r.state,
          stateCode: r.state_code.trim(),
          pincode: r.pincode,
          contactName: r.contact_name,
          contactMobile: r.contact_mobile,
        },
      ]),
    );
  }
}

/**
 * HSN 8471 30 10 — portable automatic data-processing machines under 10 kg.
 *
 * Only reached when a SKU has been withdrawn from the catalog since the order
 * was placed. Every laptop on this platform is this code and `catalog.sku`
 * defaults to it, so this is a fallback for a missing row rather than a
 * classification decision made here.
 */
const DEFAULT_HSN = '84713010';
