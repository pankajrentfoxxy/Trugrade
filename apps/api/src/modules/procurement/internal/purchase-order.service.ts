import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { CatalogService } from '../../catalog';
import { QcService } from '../../qc';
import { ClockPort } from '../../../shared/clock';
import { PreconditionFailedError, NotFoundError } from '../../../shared/errors/domain-errors';
import {
  PurchaseOrderRepository,
  type PoFilter,
  type PoHeaderRow,
  type PoLineRow,
} from './purchase-order.repository';

/**
 * The vendor's side of a purchase order — T32.
 *
 * **Every shape below is written out field by field and nothing is spread from a
 * row.** A purchase order is the document where the pressure on anonymity is
 * highest: it names serials, quantities and somewhere to deliver them, and it is
 * joined to `ordering."order"` by a foreign key. So the rule that keeps a vendor
 * name off a buyer's screen is applied in the other direction here — no buyer
 * legal name, GSTIN, PAN, contact, user, order number or `org_id` appears on any
 * type in this file, at any depth. `po-is-not-a-buyer-oracle.spec.ts` sweeps the
 * serialised payload for all of them rather than trusting this paragraph.
 *
 * **The buyer's order number is absent deliberately**, even though it is one
 * join away and would look harmless. Order numbers are sequential
 * (`TT-26-000NN`), so a vendor reading two of their own POs a fortnight apart
 * could subtract them and read the platform's order volume off the difference.
 * The PO number is the reference both sides share, and it is the only one here.
 */

/** What the vendor is owed for one machine, and what we can prove about it. */
export interface VendorPoLineView {
  /**
   * The vendor's own `listing.unit` id — a stable row key for a line whose
   * serial may be null. Theirs to see: it is already on their units board, and
   * it names one of their machines rather than anything about who bought it.
   */
  unitId: string;
  /** Null when the unit has been removed since. Never an invented serial. */
  serialNumber: string | null;
  /** "Dell Latitude 5420". Null when the SKU was withdrawn — never a guess. */
  title: string | null;
  skuCode: string | null;
  specSummary: string | null;
  /** `purchase_order_line.grade_at_po` — the grade this line was priced at. */
  gradeAtPo: string;
  agreedNetPayout: Money;
  /**
   * The numbered seal on the machine, from `qc`'s own allow-list.
   *
   * Null means no seal is recorded against the report this line was bought on —
   * which is a real problem at handover, so it renders as "no seal recorded" and
   * never as a blank that reads like a tick.
   */
  seal: { code: string; status: string } | null;
}

/** The delivery point. City only until the goods actually have to travel. */
export interface DeliveryCityView {
  city: string;
  state: string;
}

export interface VendorPoView {
  poId: string;
  poNumber: string;
  status: string;
  raisedAt: Date;
  units: number;
  /**
   * `purchase_order.total_net` — the sum of what we agreed to pay for these
   * machines. There is no retail price on this type and no field one could
   * travel in: what we sell for is ours.
   */
  totalNet: Money;
  /**
   * TDS as the order transaction computed it and stored it, u/s 393(1) Sl. 8(ii).
   *
   * **Read, never recomputed.** `computeTds` in `@trugrade/contracts` ran once
   * inside the transaction that raised this PO, against that day's cumulative
   * purchases and that day's config; recomputing it here would produce a second
   * answer the moment either moved, and this repository has already had to fix
   * one number with two implementations that disagreed.
   */
  tdsRatePct: number;
  tdsAmount: Money;
  valuationMethod: string;
  termsDays: number;
  acknowledgedAt: Date | null;
  /**
   * When we agreed the machines would be ready.
   *
   * Null on every PO the platform has raised so far — nothing sets it. It is
   * null and not "today", and the screen says "not agreed" rather than printing
   * a date nobody committed to.
   */
  expectedDispatchAt: Date | null;
  /**
   * **Always null today, and that is the honest value.**
   *
   * §3B.3 asks for "the acceptance deadline with the penalty for missing it,
   * stated before acceptance". There is no acceptance window in
   * `platform.platform_config` and no penalty rule behind one, so there is no
   * deadline to state. Inventing 24 or 48 hours here would put a number on a
   * vendor's screen that nobody in the business agreed to — the same defect as
   * rendering an unmeasured value as a passing one. The field exists so the
   * screen can say "no acceptance deadline is set" rather than say nothing.
   */
  acknowledgeBy: Date | null;
  cancelledAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  /** Null when the order or its address is gone. Never an empty string. */
  deliverTo: DeliveryCityView | null;
}

export interface VendorPoDetail extends VendorPoView {
  lines: VendorPoLineView[];
}

/**
 * The full delivery address, released only here.
 *
 * §3B.3: the ship-to is a city on the PO and a full address on the packing list,
 * "released at this point because the goods must physically travel". Still no
 * person and no organisation — a courier label is generated from `logistics`,
 * which is what the contact belongs on.
 */
export interface PickListAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  landmark: string | null;
}

/** One row a warehouse reads off a screen with a laptop in the other hand. */
export interface PickListLine {
  unitId: string;
  serialNumber: string | null;
  sealCode: string | null;
  sealStatus: string | null;
  title: string | null;
  skuCode: string | null;
  gradeAtPo: string;
}

/**
 * The printable list for the box.
 *
 * **There is no money on this type, at any depth.** Bill-To-Ship-To under
 * s.10(1)(b) IGST means the vendor's invoice value never travels with the goods
 * and neither does ours, so a price on a packing list is a compliance defect and
 * not merely untidy. `agreedNetPayout` is on `VendorPoLineView` and deliberately
 * absent from `PickListLine`; the two are separate types for exactly that
 * reason, rather than one type with a flag.
 */
export interface VendorPickList {
  poNumber: string;
  raisedAt: Date;
  units: number;
  shipTo: PickListAddress | null;
  lines: PickListLine[];
}

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly catalog: CatalogService,
    private readonly qc: QcService,
    private readonly clock: ClockPort,
  ) {}

  async list(
    filter: PoFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ rows: VendorPoView[]; total: number; page: number; pageSize: number }> {
    const { rows, total } = await this.repo.list(filter, page);
    const cities = await this.deliveryCities(rows);
    return {
      rows: rows.map((r) => this.header(r, cities.get(r.order_id) ?? null)),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  statusCounts(): Promise<Map<string, number>> {
    return this.repo.statusCounts();
  }

  async detail(poId: string): Promise<VendorPoDetail> {
    const po = await this.mine(poId);
    const [lines, shipTo] = await Promise.all([
      this.lines(poId),
      this.repo.shipToForOrder(po.order_id),
    ]);
    return {
      ...this.header(po, shipTo && { city: shipTo.city, state: shipTo.state }),
      lines,
    };
  }

  async pickList(poId: string): Promise<VendorPickList> {
    const po = await this.mine(poId);
    const [lines, shipTo] = await Promise.all([
      this.lines(poId),
      this.repo.shipToForOrder(po.order_id),
    ]);
    return {
      poNumber: po.po_number,
      raisedAt: po.created_at,
      units: Number(po.line_count),
      shipTo: shipTo && {
        line1: shipTo.line1,
        line2: shipTo.line2,
        city: shipTo.city,
        state: shipTo.state,
        pincode: shipTo.pincode,
        landmark: shipTo.landmark,
      },
      // Field by field, and no `agreedNetPayout` among them. See `VendorPickList`.
      lines: lines.map((l) => ({
        unitId: l.unitId,
        serialNumber: l.serialNumber,
        sealCode: l.seal?.code ?? null,
        sealStatus: l.seal?.status ?? null,
        title: l.title,
        skuCode: l.skuCode,
        gradeAtPo: l.gradeAtPo,
      })),
    };
  }

  /**
   * "Yes, we will produce these machines."
   *
   * The refusal names the state it found, because "that did not go through" on a
   * PO the vendor has already accepted is indistinguishable from a broken button.
   */
  async acknowledge(poId: string): Promise<VendorPoDetail> {
    const po = await this.mine(poId);
    if (!(await this.repo.acknowledge(poId, this.clock.now()))) {
      throw new PreconditionFailedError(
        po.acknowledged_at
          ? `${po.po_number} was already acknowledged. Nothing has changed.`
          : `${po.po_number} is ${po.status.toLowerCase().replaceAll('_', ' ')}, so it is past the point where it can be acknowledged.`,
        { reason: 'po_not_acknowledgeable', status: po.status },
      );
    }
    return this.detail(poId);
  }

  // -------------------------------------------------------------------------

  private async mine(poId: string): Promise<PoHeaderRow> {
    const po = await this.repo.findOne(poId);
    // 404 and not 403 — see `PurchaseOrderRepository.findOne`.
    if (!po) throw new NotFoundError('purchase order', { reason: 'no_such_po_for_this_org' });
    return po;
  }

  /**
   * The delivery city per order, one address lookup each.
   *
   * A board of fifty POs is fifty pairs of statements. That is fine at this size
   * and the ceiling is named rather than pre-optimised: a page holds at most 100
   * rows, and the two queries are primary-key lookups.
   *
   * ponytail: N+1 by order id, bounded by the page size. Batch it into two
   * `= ANY(...)` statements if a page ever exceeds a few hundred rows.
   */
  private async deliveryCities(
    rows: readonly PoHeaderRow[],
  ): Promise<Map<string, DeliveryCityView>> {
    const orderIds = [...new Set(rows.map((r) => r.order_id))];
    const found = await Promise.all(
      orderIds.map(async (id) => [id, await this.repo.shipToForOrder(id)] as const),
    );
    return new Map(
      found.flatMap(([id, a]) => (a ? [[id, { city: a.city, state: a.state }] as const] : [])),
    );
  }

  private header(r: PoHeaderRow, deliverTo: DeliveryCityView | null): VendorPoView {
    return {
      poId: r.id,
      poNumber: r.po_number,
      status: r.status,
      raisedAt: r.created_at,
      units: Number(r.line_count),
      totalNet: moneyFromDb(r.total_net) ?? Money.ZERO,
      tdsRatePct: Number(r.tds_rate_pct),
      tdsAmount: moneyFromDb(r.tds_amount) ?? Money.ZERO,
      valuationMethod: r.valuation_method,
      termsDays: r.terms_days,
      acknowledgedAt: r.acknowledged_at,
      expectedDispatchAt: r.expected_dispatch_at,
      acknowledgeBy: null,
      cancelledAt: r.cancelled_at,
      rejectedAt: r.rejected_at,
      rejectionReason: r.rejection_reason,
      deliverTo,
    };
  }

  /**
   * The lines, in serial order.
   *
   * Serial order and not insertion order: this list is read against a stack of
   * physical machines, and a warehouse ticking off an unsorted list is a
   * warehouse that miscounts.
   *
   * The seal comes through `IQcService.inspectionsByReport`, addressed by the
   * report id the PO line carries rather than by "the current report for this
   * unit". A later re-inspection is a different document, and it must not
   * silently change which seal a settled purchase says is on the box.
   */
  private async lines(poId: string): Promise<VendorPoLineView[]> {
    const rows: PoLineRow[] = await this.repo.linesOf(poId);
    const [serials, inspections, skus] = await Promise.all([
      this.repo.serialsOf(rows.map((r) => r.unit_id)),
      this.qc
        .inspectionsByReport(rows.map((r) => r.qc_report_id).filter((id): id is string => !!id))
        .then((list) => new Map(list.map((i) => [i.reportId, i]))),
      Promise.all(
        [...new Set(rows.map((r) => r.sku_id))].map(
          async (id) => [id, await this.catalog.getSku(id)] as const,
        ),
      ).then((pairs) => new Map(pairs)),
    ]);

    return rows
      .map((r) => {
        const sku = skus.get(r.sku_id) ?? null;
        const inspection = r.qc_report_id ? (inspections.get(r.qc_report_id) ?? null) : null;
        return {
          unitId: r.unit_id,
          serialNumber: serials.get(r.unit_id) ?? null,
          title: sku ? `${sku.brandName} ${sku.modelName}`.trim() : null,
          skuCode: sku?.skuCode ?? null,
          specSummary: sku
            ? [sku.cpuFamily, `${sku.ramGb} GB`, `${sku.storageGb} GB ${sku.storageType}`].join(
                ' · ',
              )
            : null,
          gradeAtPo: r.grade_at_po,
          agreedNetPayout: moneyFromDb(r.agreed_net_payout) ?? Money.ZERO,
          // The seal, and nothing else `qc` offers. `inspectionsByReport` also
          // returns a score and an inspection date; a purchase order is about
          // which machines and how much, and the inspection has its own screen.
          seal: inspection?.seal ?? null,
        };
      })
      .sort((a, b) => (a.serialNumber ?? '').localeCompare(b.serialNumber ?? ''));
  }
}
