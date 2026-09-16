import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { PrismaService } from '../../shared/db/prisma.service';
import { NotFoundError } from '../../shared/errors/domain-errors';

/**
 * The chain strip — Stage 8 §8.5.
 *
 * Seven steps: Order → Purchase orders → Packed → Shipment → Delivered →
 * Invoice → Vendor paid. The same strip opens the order record, the purchase
 * order, the shipment, the payable and the invoice, so wherever an operator
 * entered the chain they can see the whole of it and step sideways without
 * going back to a board. **This is what "each flow connected" looks like on a
 * screen**, and building it once from the order number is what keeps the five
 * drawers from growing five slightly different versions of it.
 *
 * It lives in `identity` for the same reason the ops and finance workspaces do:
 * the strip spans ordering, procurement, logistics and payment, and no module's
 * service owns the combination. One statement per module schema, combined in
 * TypeScript — `no-cross-schema-join` forbids the join that would be shorter.
 *
 * **A step whose record does not exist yet is `PENDING`, never absent.** The
 * gap is the information: an order with no shipment row is an order nobody has
 * dispatched, and rendering six steps instead of seven hides exactly that.
 */

export type ChainState = 'DONE' | 'ACTIVE' | 'PENDING' | 'FAILED';

export interface ChainStep {
  key: string;
  label: string;
  state: ChainState;
  /** The step's own number: `2 POs`, `BlueDart`, `1 of 2`. Never a sentence. */
  value: string | null;
  /** Where clicking goes, when a record exists behind it. */
  href: string | null;
}

@Controller('ops/chain')
export class ChainController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':orderNumber')
  @RequirePermissions('ordering.any.read')
  async chain(@Param('orderNumber') orderNumber: string): Promise<{
    orderNumber: string;
    steps: ChainStep[];
  }> {
    const [order] = await this.prisma.$queryRaw<
      Array<{ id: string; order_number: string; status: string; placed_at: Date | null }>
    >`SELECT id, order_number, status::text AS status, placed_at
        FROM ordering."order" WHERE order_number = ${orderNumber}`;
    if (!order) throw new NotFoundError('order');

    const subs = await this.prisma.$queryRaw<
      Array<{ id: string; purchase_order_id: string | null }>
    >`SELECT id, purchase_order_id FROM ordering.sub_order WHERE order_id = ${order.id}::uuid`;

    const poIds = subs.map((s) => s.purchase_order_id).filter((v): v is string => v !== null);
    const pos = poIds.length
      ? await this.prisma.$queryRaw<Array<{ id: string; po_number: string; status: string }>>`
          SELECT id, po_number, status::text AS status
            FROM procurement.purchase_order WHERE id = ANY(${poIds}::uuid[])`
      : [];

    const subIds = subs.map((s) => s.id);
    const shipments = subIds.length
      ? await this.prisma.$queryRaw<
          Array<{ id: string; awb_number: string | null; status: string; delivered_at: Date | null }>
        >`SELECT id, awb_number, status::text AS status, delivered_at
            FROM logistics.shipment WHERE sub_order_id = ANY(${subIds}::uuid[])`
      : [];

    const invoices = await this.prisma.$queryRaw<Array<{ invoice_number: string }>>`
      SELECT i.invoice_number
        FROM payment.invoice i
       WHERE i.sub_order_id = ANY(${subIds.length ? subIds : ['00000000-0000-0000-0000-000000000000']}::uuid[])`;

    const payables = poIds.length
      ? await this.prisma.$queryRaw<Array<{ status: string; n: bigint }>>`
          SELECT status::text AS status, count(*)::bigint AS n
            FROM procurement.vendor_payable
           WHERE purchase_order_id = ANY(${poIds}::uuid[])
           GROUP BY 1`
      : [];

    const packed = pos.filter((p) => ['DISPATCH_READY', 'DISPATCHED', 'RECEIVED'].includes(p.status));
    const delivered = shipments.filter((s) => s.delivered_at !== null);
    const paid = payables.find((p) => p.status === 'PAID');
    const paidCount = Number(paid?.n ?? 0);
    const payableCount = payables.reduce((n, p) => n + Number(p.n), 0);

    const steps: ChainStep[] = [
      {
        key: 'order',
        label: 'Order',
        state: order.status === 'CANCELLED' ? 'FAILED' : 'DONE',
        value: order.order_number,
        href: `/orders/${encodeURIComponent(order.order_number)}`,
      },
      {
        key: 'po',
        label: 'Purchase orders',
        state: pos.length ? 'DONE' : 'PENDING',
        value: pos.length ? `${pos.length} PO${pos.length === 1 ? '' : 's'}` : null,
        href: pos.length ? '/procurement/pos' : null,
      },
      {
        key: 'packed',
        label: 'Packed',
        state: pos.length === 0 ? 'PENDING' : packed.length === pos.length ? 'DONE' : 'ACTIVE',
        value: pos.length ? `${packed.length} of ${pos.length}` : null,
        href: null,
      },
      {
        key: 'shipment',
        label: 'Shipment',
        state: shipments.length === 0 ? 'PENDING' : 'DONE',
        value: shipments.length
          ? (shipments[0]?.awb_number ?? `${shipments.length} booked`)
          : null,
        href: shipments.length ? '/fulfilment/shipments' : null,
      },
      {
        key: 'delivered',
        label: 'Delivered',
        state:
          shipments.length === 0
            ? 'PENDING'
            : delivered.length === shipments.length
              ? 'DONE'
              : 'ACTIVE',
        value: shipments.length ? `${delivered.length} of ${shipments.length}` : null,
        href: null,
      },
      {
        key: 'invoice',
        label: 'Invoice',
        state: invoices.length ? 'DONE' : 'PENDING',
        value: invoices[0]?.invoice_number ?? null,
        href: null,
      },
      {
        key: 'paid',
        label: 'Vendor paid',
        state: payableCount === 0 ? 'PENDING' : paidCount === payableCount ? 'DONE' : 'ACTIVE',
        value: payableCount ? `${paidCount} of ${payableCount}` : null,
        href: payableCount ? '/finance/payables' : null,
      },
    ];

    return { orderNumber: order.order_number, steps };
  }
}
