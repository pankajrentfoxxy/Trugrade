import { Injectable } from '@nestjs/common';
import { Money, moneyFromDb } from '@trugrade/contracts';
import { CatalogService } from '../../catalog';
import { QcService } from '../../qc';
import { ClockPort } from '../../../shared/clock';
import { RequestContextService } from '../../../shared/db/org-scope';
import { EventBus } from '../../../shared/events/event-bus';
import { AutomationService } from '../../../shared/automation/automation.service';
import {
  ConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import {
  PurchaseOrderRepository,
  type LineRespondInput,
  type PoFilter,
  type PoHeaderRow,
  type PoKpiSummary,
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
  lineId: string;
  /**
   * The vendor's own `listing.unit` id — a stable row key for a line whose
   * serial may be null. Theirs to see: it is already on their units board, and
   * it names one of their machines rather than anything about who bought it.
   */
  unitId: string | null;
  skuId: string;
  /** Null when the unit has been removed since. Never an invented serial. */
  serialNumber: string | null;
  /** "Dell Latitude 5420". Null when the SKU was withdrawn — never a guess. */
  title: string | null;
  skuCode: string | null;
  specSummary: string | null;
  /** `purchase_order_line.grade_at_po` — the grade this line was priced at. */
  gradeAtPo: string;
  lineStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  rejectionReason: string | null;
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
  consignmentCarrier: string | null;
  consignmentAwb: string | null;
  dispatchedAt: Date | null;
  /** Sum of every line before any rejection — for strike-through on the board. */
  originalTotalNet: Money;
  /** Accepted-line total after response; equals totalNet once responded. */
  owedNet: Money;
  modelCount: number;
  modelNames: string[];
  /** Null when the order or its address is gone. Never an empty string. */
  deliverTo: DeliveryCityView | null;
}

/** One grouped line on the PO — SKU + grade with quantity. */
export interface VendorPoLineGroupView {
  lineIds: string[];
  skuId: string;
  skuCode: string | null;
  title: string | null;
  specSummary: string | null;
  gradeAtPo: string;
  qty: number;
  unitPrice: Money;
  lineTotal: Money;
  lineStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'MIXED';
  rejectionReason: string | null;
  attachedCount: number;
  serials: Array<{ unitId: string; serialNumber: string | null }>;
}

export interface VendorPoTotalsView {
  orderTotal: Money;
  rejectedTotal: Money;
  tdsAmount: Money;
  owedIfAccepted: Money;
}

/** One SKU + grade the vendor must fulfil. Serials are attached later. */
export interface VendorPoDemandView {
  skuId: string;
  skuCode: string | null;
  title: string | null;
  specSummary: string | null;
  gradeAtPo: string;
  qty: number;
  attachedCount: number;
  /** Sum of what we agreed to pay for this SKU + grade. */
  agreedNetPayout: Money;
}

export interface VendorPoDetail extends VendorPoView {
  demands: VendorPoDemandView[];
  lineGroups: VendorPoLineGroupView[];
  totals: VendorPoTotalsView;
}

/** A machine the vendor may attach to a vacant slot. */
export interface AttachableUnitView {
  unitId: string;
  serialNumber: string;
  status: string;
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

/** One machine on the pick list, grouped under a model header. */
export interface PickListMachine {
  unitId: string;
  serialNumber: string | null;
  sealCode: string | null;
  sealStatus: string | null;
}

/** Model header with its machines — printable as-is. */
export interface PickListModelGroup {
  title: string | null;
  skuCode: string | null;
  gradeAtPo: string;
  attachedCount: number;
  requiredCount: number;
  machines: PickListMachine[];
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
  modelGroups: PickListModelGroup[];
}

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly repo: PurchaseOrderRepository,
    private readonly catalog: CatalogService,
    private readonly qc: QcService,
    private readonly clock: ClockPort,
    private readonly ctx: RequestContextService,
    private readonly events: EventBus,
    private readonly automation: AutomationService,
  ) {}

  kpiSummary(): Promise<PoKpiSummary> {
    return this.repo.kpiSummary();
  }

  async list(
    filter: PoFilter,
    page: { page: number; pageSize: number },
  ): Promise<{ rows: VendorPoView[]; total: number; page: number; pageSize: number }> {
    const { rows, total } = await this.repo.list(filter, page);
    const cities = await this.deliveryCities(rows);
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const base = this.header(r, cities.get(r.order_id) ?? null);
        const originalTotalNet = moneyFromDb(r.original_total_net) ?? base.totalNet;
        const lineViews = await this.lines(r.id);
        return {
          ...base,
          originalTotalNet,
          owedNet: base.totalNet,
          modelCount: Number(r.model_count),
          modelNames: [...new Set(lineViews.map((l) => l.title).filter(Boolean))] as string[],
        };
      }),
    );
    return {
      rows: enriched,
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
    const [lineViews, shipTo] = await Promise.all([
      this.lines(poId),
      this.repo.shipToForOrder(po.order_id),
    ]);
    const lineGroups = this.asLineGroups(lineViews);
    const totals = this.computeTotals(
      lineViews,
      Number(po.tds_rate_pct),
      moneyFromDb(po.tds_amount) ?? Money.ZERO,
      po.status,
    );
    const header = await this.headerWithModels(
      po,
      shipTo && { city: shipTo.city, state: shipTo.state },
      lineViews,
      totals,
    );
    return {
      ...header,
      tdsAmount: totals.tdsAmount,
      demands: this.asDemands(lineViews),
      lineGroups,
      totals,
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
      lines: lines
        .filter((l): l is VendorPoLineView & { unitId: string } => !!l.unitId)
        .map((l) => ({
          unitId: l.unitId,
          serialNumber: l.serialNumber,
          sealCode: l.seal?.code ?? null,
          sealStatus: l.seal?.status ?? null,
          title: l.title,
          skuCode: l.skuCode,
          gradeAtPo: l.gradeAtPo,
        })),
      modelGroups: this.pickListGroups(lines),
    };
  }

  /**
   * "Yes, we will produce these machines."
   *
   * The refusal names the state it found, because "that did not go through" on a
   * PO the vendor has already accepted is indistinguishable from a broken button.
   */
  async acknowledge(poId: string): Promise<VendorPoDetail> {
    const rows = await this.repo.linesOf(poId);
    return this.respond(
      poId,
      rows.map((l) => ({ lineId: l.id, accept: true })),
    );
  }

  async respond(
    poId: string,
    input: Array<{ lineId: string; accept: boolean; reason?: string }>,
  ): Promise<VendorPoDetail> {
    const po = await this.mine(poId);
    const actor = this.ctx.requirePrincipal();
    const payload: LineRespondInput[] = input.map((l) => ({
      lineId: l.lineId,
      accept: l.accept,
      reason: l.accept ? null : (l.reason ?? null),
    }));

    const result = await this.repo.respondLines(poId, payload, this.clock.now(), actor.userId);
    if (!result) {
      throw new PreconditionFailedError(
        po.acknowledged_at
          ? `${po.po_number} was already acknowledged. Nothing has changed.`
          : `${po.po_number} is ${po.status.toLowerCase().replaceAll('_', ' ')}, so it cannot be responded to again.`,
        { reason: 'po_already_responded', status: po.status },
      );
    }

    if (result.newStatus === 'PARTIAL') {
      await this.events.publish('po.partially_rejected', {
        purchaseOrderId: poId,
        poNumber: result.poNumber,
        vendorOrgId: actor.orgId!,
        orderId: result.orderId,
        acceptedLineIds: result.acceptedLineIds,
        rejectedLineIds: result.rejectedLineIds,
        shortQty: result.rejectedLineIds.length,
        owedNet: result.owedNet,
      });
    }

    return this.detail(poId);
  }

  async dispatch(
    poId: string,
    input: { carrier: string; awb: string; dispatchedAt?: string },
  ): Promise<VendorPoDetail> {
    const po = await this.mine(poId);
    const actor = this.ctx.requirePrincipal();
    const when = input.dispatchedAt ? new Date(input.dispatchedAt) : this.clock.now();
    const result = await this.repo.dispatchPo(
      poId,
      { carrier: input.carrier, awb: input.awb, dispatchedAt: when },
      actor.userId,
    );
    if (!result) {
      throw new PreconditionFailedError(
        `${po.po_number} is ${po.status.toLowerCase().replaceAll('_', ' ')}, so it cannot be dispatched from here.`,
        { reason: 'po_not_dispatchable', status: po.status },
      );
    }
    return this.detail(poId);
  }

  async attachableUnits(poId: string, skuId: string, grade: string): Promise<AttachableUnitView[]> {
    const po = await this.mine(poId);
    const [reservedIds, takenIds] = await Promise.all([
      this.repo.reservedUnitIdsForOrder(po.order_id),
      this.repo.attachedUnitIds(),
    ]);
    const rows = await this.repo.attachableUnits({ skuId, grade, reservedIds, takenIds });
    return rows.map((r) => ({
      unitId: r.id,
      serialNumber: r.serial_number,
      status: r.status,
    }));
  }

  async attach(
    poId: string,
    input: { skuId: string; grade: string; unitId: string },
  ): Promise<VendorPoDetail> {
    const po = await this.mine(poId);
    if (!['ACKNOWLEDGED', 'PARTIAL'].includes(po.status)) {
      throw new PreconditionFailedError(
        po.status === 'RAISED'
          ? `${po.po_number} has not been accepted yet. Accept it before attaching a machine.`
          : `${po.po_number} is ${po.status.toLowerCase().replaceAll('_', ' ')}, so machines can no longer be attached.`,
        { reason: 'po_not_attachable', status: po.status },
      );
    }

    const slots = (await this.repo.linesOf(poId)).filter(
      (l) =>
        l.sku_id === input.skuId && l.grade_at_po === input.grade && l.line_status === 'ACCEPTED',
    );
    if (slots.length === 0) {
      throw new ValidationError('That SKU and grade are not on this purchase order.', {
        skuId: 'Pick a line that is on this order.',
      });
    }
    if (slots.every((l) => l.unit_id)) {
      throw new PreconditionFailedError(
        'Every machine of that SKU and grade is already attached.',
        { reason: 'po_demand_filled' },
      );
    }

    const vacant = slots.find((l) => !l.unit_id)!;
    const unit = await this.repo.unitForVendor(input.unitId);
    if (!unit) {
      throw new NotFoundError('unit', { reason: 'unit_not_this_vendor' });
    }
    if (unit.sku_id !== input.skuId || unit.grade !== input.grade) {
      throw new ValidationError(
        'That machine is a different SKU or grade than this line. Pick one that matches.',
        { unitId: 'Choose a machine of the same SKU and grade.' },
      );
    }

    const [reservedIds, takenIds] = await Promise.all([
      this.repo.reservedUnitIdsForOrder(po.order_id),
      this.repo.attachedUnitIds(),
    ]);
    if (takenIds.includes(unit.id)) {
      throw new ConflictError('That machine is already on a purchase order.', {
        reason: 'unit_already_on_po',
      });
    }
    if (unit.status !== 'LISTED' && !reservedIds.includes(unit.id)) {
      throw new ValidationError(
        'That machine is not free to attach. Pick one that is listed, or one already reserved for this order.',
        { unitId: 'Choose a listed machine of this SKU and grade.' },
      );
    }

    const ok = await this.repo.attachToVacantLine({
      poId,
      skuId: input.skuId,
      grade: input.grade,
      unitId: unit.id,
      serialNumber: unit.serial_number,
      qcReportId: unit.qc_report_id,
      payout: vacant.agreed_net_payout,
      now: this.clock.now(),
    });
    if (!ok) {
      throw new ConflictError('That slot was filled just now. Refresh and try again.', {
        reason: 'po_slot_taken',
      });
    }

    await this.markPackedIfComplete(poId, po.po_number);
    return this.detail(poId);
  }

  /**
   * The last serial turns an acknowledgement into a packed consignment.
   *
   * **Acknowledge is a promise; pack is a fact.** `po_status` already carries
   * DISPATCH_READY and `dispatchPo` already refuses while any accepted line has
   * no `unit_id` — but nothing ever wrote that status, so a fully-scanned PO was
   * indistinguishable from one nobody had touched. It is the trigger for
   * booking: a carrier called at acknowledgement collects machines that are
   * still on a shelf.
   */
  private async markPackedIfComplete(poId: string, poNumber: string): Promise<void> {
    const lines = await this.repo.linesOf(poId);
    const accepted = lines.filter((l) => l.line_status === 'ACCEPTED');
    if (accepted.length === 0 || accepted.some((l) => !l.unit_id)) return;

    const moved = await this.repo.markDispatchReady(poId, this.clock.now());
    if (!moved) return;
    await this.automation.note('R2', poNumber, 'SKIPPED', {
      reason: 'Packed and ready to dispatch. Booking runs when dispatch is pressed.',
      machines: accepted.length,
    });
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
    const totalNet = moneyFromDb(r.total_net) ?? Money.ZERO;
    return {
      poId: r.id,
      poNumber: r.po_number,
      status: r.status,
      raisedAt: r.created_at,
      units: Number(r.line_count),
      totalNet,
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
      consignmentCarrier: r.consignment_carrier,
      consignmentAwb: r.consignment_awb,
      dispatchedAt: r.dispatched_at,
      originalTotalNet: moneyFromDb(r.original_total_net) ?? totalNet,
      owedNet: totalNet,
      modelCount: Number(r.model_count ?? r.line_count),
      modelNames: [],
      deliverTo,
    };
  }

  private async headerWithModels(
    r: PoHeaderRow,
    deliverTo: DeliveryCityView | null,
    lineViews: readonly VendorPoLineView[],
    totals: VendorPoTotalsView,
  ): Promise<VendorPoView> {
    const base = this.header(r, deliverTo);
    const groups = this.asLineGroups(lineViews);
    return {
      ...base,
      originalTotalNet: totals.orderTotal,
      owedNet: totals.owedIfAccepted,
      totalNet: totals.owedIfAccepted,
      modelCount: groups.length,
      modelNames: groups.map((g) => g.title ?? g.skuCode ?? 'Unknown model'),
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
      this.repo.serialsOf(rows.map((r) => r.unit_id).filter((id): id is string => !!id)),
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
          lineId: r.id,
          unitId: r.unit_id,
          skuId: r.sku_id,
          serialNumber: r.unit_id ? (serials.get(r.unit_id) ?? null) : null,
          title: sku ? `${sku.brandName} ${sku.modelName}`.trim() : null,
          skuCode: sku?.skuCode ?? null,
          specSummary: sku
            ? [sku.cpuFamily, `${sku.ramGb} GB`, `${sku.storageGb} GB ${sku.storageType}`].join(
                ' · ',
              )
            : null,
          gradeAtPo: r.grade_at_po,
          lineStatus: r.line_status as 'PENDING' | 'ACCEPTED' | 'REJECTED',
          rejectionReason: r.rejection_reason,
          agreedNetPayout: moneyFromDb(r.agreed_net_payout) ?? Money.ZERO,
          // The seal, and nothing else `qc` offers. `inspectionsByReport` also
          // returns a score and an inspection date; a purchase order is about
          // which machines and how much, and the inspection has its own screen.
          seal: inspection?.seal ?? null,
        };
      })
      .sort((a, b) => (a.serialNumber ?? '').localeCompare(b.serialNumber ?? ''));
  }

  private asDemands(lines: readonly VendorPoLineView[]): VendorPoDemandView[] {
    return this.asLineGroups(lines).map((g) => ({
      skuId: g.skuId,
      skuCode: g.skuCode,
      title: g.title,
      specSummary: g.specSummary,
      gradeAtPo: g.gradeAtPo,
      qty: g.qty,
      attachedCount: g.attachedCount,
      agreedNetPayout: g.lineTotal,
    }));
  }

  private asLineGroups(lines: readonly VendorPoLineView[]): VendorPoLineGroupView[] {
    const groups = new Map<string, VendorPoLineView[]>();
    for (const line of lines) {
      const key = `${line.skuId}:${line.gradeAtPo}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(line);
      else groups.set(key, [line]);
    }
    return [...groups.values()].map((bucket) => {
      const first = bucket[0]!;
      const statuses = new Set(bucket.map((l) => l.lineStatus));
      let lineStatus: VendorPoLineGroupView['lineStatus'] = first.lineStatus;
      if (statuses.size > 1) lineStatus = 'MIXED';
      const unitPrice = first.agreedNetPayout;
      return {
        lineIds: bucket.map((l) => l.lineId),
        skuId: first.skuId,
        skuCode: first.skuCode,
        title: first.title,
        specSummary: first.specSummary,
        gradeAtPo: first.gradeAtPo,
        qty: bucket.length,
        unitPrice,
        lineTotal: Money.sum(bucket.map((l) => l.agreedNetPayout)),
        lineStatus,
        rejectionReason:
          lineStatus === 'REJECTED'
            ? (bucket.find((l) => l.rejectionReason)?.rejectionReason ?? null)
            : null,
        attachedCount: bucket.filter((l) => l.unitId).length,
        serials: bucket
          .filter((l) => l.unitId)
          .map((l) => ({ unitId: l.unitId!, serialNumber: l.serialNumber })),
      };
    });
  }

  private computeTotals(
    lines: readonly VendorPoLineView[],
    tdsRatePct: number,
    storedTds: Money,
    poStatus: string,
  ): VendorPoTotalsView {
    const orderTotal = Money.sum(lines.map((l) => l.agreedNetPayout));
    const rejectedTotal = Money.sum(
      lines.filter((l) => l.lineStatus === 'REJECTED').map((l) => l.agreedNetPayout),
    );
    const owedIfAccepted = Money.sum(
      lines.filter((l) => l.lineStatus !== 'REJECTED').map((l) => l.agreedNetPayout),
    );
    const tdsAmount =
      poStatus === 'RAISED'
        ? Money.parse((Number(owedIfAccepted.toString()) * (tdsRatePct / 100)).toFixed(2))
        : storedTds;
    return {
      orderTotal,
      rejectedTotal,
      tdsAmount,
      owedIfAccepted,
    };
  }

  private pickListGroups(lines: readonly VendorPoLineView[]): PickListModelGroup[] {
    return this.asLineGroups(lines)
      .filter((g) => g.lineStatus === 'ACCEPTED' || g.attachedCount > 0)
      .map((g) => ({
        title: g.title,
        skuCode: g.skuCode,
        gradeAtPo: g.gradeAtPo,
        attachedCount: g.attachedCount,
        requiredCount: g.qty,
        machines: g.serials.map((s) => {
          const src = lines.find((l) => l.unitId === s.unitId);
          return {
            unitId: s.unitId,
            serialNumber: s.serialNumber,
            sealCode: src?.seal?.code ?? null,
            sealStatus: src?.seal?.status ?? null,
          };
        }),
      }));
  }
}
