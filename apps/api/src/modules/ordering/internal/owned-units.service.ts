import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../../shared/db/org-scope';
import { PrismaService } from '../../../shared/db/prisma.service';
import { ForbiddenError } from '../../../shared/errors/domain-errors';
import { CatalogLookup } from './catalog-lookup';

/**
 * Which machines does this organisation actually own, and when did they arrive?
 *
 * This exists so that `platform` — which owns warranty, claims and returns —
 * never has to answer that question itself. Ownership of a serial is
 * `order_line_unit` → `order_line` → `sub_order` → `order.buyer_org_id`, four
 * tables in ordering's schema and a state machine ordering owns. A warranty
 * screen that reconstructed that join would pin the definition of "yours"
 * outside the module that decides it, and would be wrong the first time an
 * order is cancelled after allocation.
 *
 * **The org filter is in the WHERE clause of the one query, not in a caller.**
 * A method that took an `orgId` argument would be one careless call away from
 * serving another company's asset register, and there is no argument here to be
 * careless with: the principal is read from the request context and there is no
 * overload that skips it.
 *
 * **`deliveredAt` is the whole reason this is not just a list of serials.** Both
 * after-sale clocks — the warranty term and the 48-hour inspection window — run
 * from proof of delivery, and it is per sub-order because three consignments
 * arriving on three days open three windows.
 */
export interface OwnedUnit {
  /** `ordering.order_line_unit.id` — what a claim or a return is raised against. */
  orderLineUnitId: string;
  /** `listing.unit.id`. The FK `platform.warranty` and `warranty_claim` carry. */
  unitId: string;
  serialNumber: string;
  orderNumber: string;
  /** `YYYY-MM-DD` of the sale, for a register sorted by when it was bought. */
  orderedOn: string;
  /**
   * Proof of delivery for this machine's consignment, or null when it has not
   * arrived. Null is not "today" and is not zero: nothing has started running.
   */
  deliveredAt: Date | null;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  /**
   * The vendor's own commitment, in months, from the listing this unit was sold
   * off. **Internal.** It is handed to `platform` so the total term can be
   * computed and is never part of a customer payload — the buyer is told one
   * number and the split between us and the supply point is a commercial
   * arrangement they are not party to (`FORBIDDEN_CUSTOMER_KEYS`).
   */
  vendorWarrantyMonths: number;
  /** Internal, for warranty recovery against the supply point. Never customer-facing. */
  vendorOrgId: string;
}

interface OwnedRow {
  order_line_unit_id: string;
  unit_id: string;
  serial_number: string;
  order_number: string;
  placed_at: Date;
  delivered_at: Date | null;
  sku_id: string;
  vendor_org_id: string;
}

interface WarrantyTermsRow {
  unit_id: string;
  vendor_warranty_months: number;
}

@Injectable()
export class OwnedUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: RequestContextService,
    private readonly catalog: CatalogLookup,
  ) {}

  /**
   * Every machine this organisation has bought, newest order first.
   *
   * Not paginated, for the reason `OrderUnitsService` gives about the asset
   * register: a warranty register that stopped at row 25 is one a facilities
   * manager files as complete. The largest account on the platform owns tens of
   * machines.
   */
  async forThisOrg(): Promise<OwnedUnit[]> {
    const orgId = this.buyerOrgId();

    // One schema. `sub_order.vendor_org_id` is read because the warranty row
    // records who we recover a claim from; it is dropped by every allow-list
    // between here and a customer.
    const rows = await this.prisma.$queryRaw<OwnedRow[]>`
      SELECT olu.id   AS order_line_unit_id,
             olu.unit_id,
             olu.serial_number,
             o.order_number,
             o.placed_at,
             so.delivered_at,
             ol.sku_id,
             so.vendor_org_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order  so ON so.id = ol.sub_order_id
        JOIN ordering."order"     o ON o.id  = so.order_id
       WHERE o.buyer_org_id = ${orgId}::uuid
         AND so.status <> 'CANCELLED'::public.order_status
       ORDER BY o.placed_at DESC, olu.serial_number`;

    return this.decorate(rows);
  }

  /** The same, narrowed to one order. Used by the return flow, which is per order. */
  async forOrder(orderNumber: string): Promise<OwnedUnit[]> {
    const orgId = this.buyerOrgId();

    const rows = await this.prisma.$queryRaw<OwnedRow[]>`
      SELECT olu.id   AS order_line_unit_id,
             olu.unit_id,
             olu.serial_number,
             o.order_number,
             o.placed_at,
             so.delivered_at,
             ol.sku_id,
             so.vendor_org_id
        FROM ordering.order_line_unit olu
        JOIN ordering.order_line ol ON ol.id = olu.order_line_id
        JOIN ordering.sub_order  so ON so.id = ol.sub_order_id
        JOIN ordering."order"     o ON o.id  = so.order_id
       WHERE o.buyer_org_id = ${orgId}::uuid
         AND o.order_number = ${orderNumber}
         AND so.status <> 'CANCELLED'::public.order_status
       ORDER BY olu.serial_number`;

    return this.decorate(rows);
  }

  private async decorate(rows: readonly OwnedRow[]): Promise<OwnedUnit[]> {
    if (rows.length === 0) return [];

    // A second statement rather than a join: `listing.listing` is another
    // module's schema and `no-cross-schema-join` is a design rule, not a lint
    // preference. Both halves are single-schema and the fuse is in TypeScript.
    const terms = new Map(
      (
        await this.prisma.$queryRaw<WarrantyTermsRow[]>`
          SELECT u.id AS unit_id, COALESCE(l.vendor_warranty_months, 0) AS vendor_warranty_months
            FROM listing.unit u
            LEFT JOIN listing.listing l ON l.id = u.listing_id
           WHERE u.id = ANY(${rows.map((r) => r.unit_id)}::uuid[])`
      ).map((r) => [r.unit_id, Number(r.vendor_warranty_months)]),
    );

    const descriptions = new Map(
      await Promise.all(
        [...new Set(rows.map((r) => r.sku_id))].map(
          async (id) => [id, await this.catalog.describe(id)] as const,
        ),
      ),
    );

    return rows.map((r) => {
      const description = descriptions.get(r.sku_id) ?? null;
      return {
        orderLineUnitId: r.order_line_unit_id,
        unitId: r.unit_id,
        serialNumber: r.serial_number,
        orderNumber: r.order_number,
        orderedOn: r.placed_at.toISOString().slice(0, 10),
        deliveredAt: r.delivered_at,
        title: description?.title ?? null,
        specSummary: description?.specSummary ?? null,
        vendorWarrantyMonths: terms.get(r.unit_id) ?? 0,
        vendorOrgId: r.vendor_org_id,
      };
    });
  }

  private buyerOrgId(): string {
    const p = this.ctx.requirePrincipal();
    if (!p.orgId || p.orgType !== 'BUYER') {
      throw new ForbiddenError('Machines belong to a buyer account.', {
        reason: 'not_a_buyer_principal',
      });
    }
    return p.orgId;
  }
}
