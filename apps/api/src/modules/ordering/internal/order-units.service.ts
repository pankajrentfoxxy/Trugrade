import { Injectable } from '@nestjs/common';
import { type Grade } from '@trugrade/contracts';
import { QcService, type QcVerdict } from '../../qc';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError, NotFoundError } from '../../../shared/errors/domain-errors';
import { CatalogLookup } from './catalog-lookup';

/**
 * The per-serial QC result for what was actually shipped — T21,
 * `/account/orders/[id]/units` in `03_UX_SPEC.md` §3A.3.
 *
 * This is the buyer's **asset register source**. It is the one screen in the
 * product that is made entirely of measurements, which makes it the one screen
 * where CLAUDE.md's rule about missing values does the most work: every field
 * below is nullable, and a null is the honest answer to "we did not measure
 * that". Nothing here substitutes a zero, a dash or an empty string for an
 * absent reading, because on a page of ticks a blank cell reads as a pass.
 *
 * **The report is the one the machine was sold against.** `order_line_unit`
 * carries `qc_report_id` — ordering's own column, written when the machine was
 * allocated — and this file reads QC through that id and no other. Resolving
 * "the current report for this unit" instead would quietly redraw a buyer's
 * asset register the day a returned machine is re-inspected, and the verdict
 * they were sold under would disappear from their own records.
 *
 * **Vendor anonymity is structural here, not careful.** `procurement.purchase_order`
 * is not read. `listing.unit` is not read — there is nothing on it this screen
 * needs that `order_line_unit` has not already got, and `vendor_org_id` and
 * `vendor_ask_price` are on it. QC comes back through `IQcService` as an
 * allow-list built in `qc`, which carries no technician, no visit and no photo
 * key. There is no field on the shape below that a vendor identifier could
 * travel in, at any depth.
 */

/**
 * One machine on the order, by serial.
 *
 * Two grades, deliberately. `gradeOrdered` is what the order line was priced at
 * — the commercial fact, and what the invoice will say. `gradeActual` is
 * `qc_report.grade_final`, the grade the inspection concluded. They agree on
 * every honest order; when they do not, the buyer is the person who most needs
 * to see both, and collapsing them into one column is how a downgrade gets lost.
 */
export interface OrderedUnitView {
  serialNumber: string;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  gradeOrdered: Grade;
  gradeActual: Grade | null;
  unitPrice: string;
  /** Null when no inspection is attached to this line at all. */
  verdict: QcVerdict | null;
  qcScore: number | null;
  /** Null means NOT MEASURED. It is never rendered as a number. */
  batteryHealthPct: number | null;
  /** `YYYY-MM-DD`. */
  inspectedOn: string | null;
  seal: { code: string; status: string } | null;
  /** Where the passport for this machine lives. The serial is the address. */
  passportPath: string;
}

export interface OrderUnitsView {
  orderNumber: string;
  status: string;
  placedAt: string;
  /**
   * Every machine on the order, in serial order. Not paginated: an asset
   * register is a document, and a buyer exporting one that stopped at row 25
   * would file an incomplete one without noticing. The largest order on the
   * platform is tens of machines.
   */
  units: OrderedUnitView[];
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  placed_at: Date;
}

interface LineUnitRow {
  serial_number: string;
  qc_report_id: string | null;
  sku_id: string;
  grade: string;
  unit_price: string;
}

@Injectable()
export class OrderUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
    private readonly qc: QcService,
    private readonly catalog: CatalogLookup,
  ) {}

  /**
   * The machines on one order, scoped to the reader's organisation.
   *
   * An order belonging to another organisation is `NotFoundError`, not
   * `ForbiddenError`, for the reason `OrderReadService` gives: order numbers are
   * sequential, so "you may not see TT-26-00004" confirms TT-26-00004 exists and
   * turns the route into an order-volume oracle for anyone with an account.
   */
  async byOrderNumber(orderNumber: string): Promise<OrderUnitsView> {
    const orgId = this.buyerOrgId();

    const [order] = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT id, order_number, status::text AS status, placed_at
        FROM ordering."order"
       WHERE order_number = ${orderNumber} AND buyer_org_id = ${orgId}::uuid`;
    if (!order) throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });

    const rows = await this.prisma.$queryRaw<LineUnitRow[]>`
      SELECT olu.serial_number, olu.qc_report_id, ol.sku_id, ol.grade::text AS grade,
             ol.unit_price::text AS unit_price
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${order.id}::uuid
       ORDER BY olu.serial_number`;

    const inspections = new Map(
      (
        await this.qc.inspectionsByReport(
          rows.map((r) => r.qc_report_id).filter((id): id is string => id !== null),
        )
      ).map((i) => [i.reportId, i]),
    );
    const descriptions = new Map(
      await Promise.all(
        [...new Set(rows.map((r) => r.sku_id))].map(
          async (id) => [id, await this.catalog.describe(id)] as const,
        ),
      ),
    );

    return {
      orderNumber: order.order_number,
      status: order.status,
      placedAt: order.placed_at.toISOString(),
      units: rows.map((row) => {
        const qc = row.qc_report_id ? (inspections.get(row.qc_report_id) ?? null) : null;
        const description = descriptions.get(row.sku_id) ?? null;
        return {
          serialNumber: row.serial_number,
          title: description?.title ?? null,
          specSummary: description?.specSummary ?? null,
          gradeOrdered: row.grade as Grade,
          gradeActual: qc?.grade ?? null,
          unitPrice: row.unit_price,
          verdict: qc?.verdict ?? null,
          qcScore: qc?.qcScore ?? null,
          batteryHealthPct: qc?.batteryHealthPct ?? null,
          inspectedOn: qc?.inspectedOn ?? null,
          seal: qc?.seal ?? null,
          // A path rather than a URL: the passport is served by the storefront
          // on its own origin, and an absolute one built here would be wrong the
          // moment the Android app consumes the same endpoint.
          passportPath: `/unit/${row.serial_number}`,
        };
      }),
    };
  }

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Orders belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }
}
