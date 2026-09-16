import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { PrismaService } from '../../shared/db/prisma.service';
import { NotFoundError, PreconditionFailedError } from '../../shared/errors/domain-errors';
import { AutomationService } from '../../shared/automation/automation.service';
import { ShipmentService } from './internal/shipment.service';

/**
 * One-click dispatch.
 *
 * **The button does not open a form, and that is the whole point.** By the time
 * a purchase order reaches DISPATCH_READY the pickup address came from the
 * vendor's verified supply point, the ship-to came from the order,
 * serviceability and the rate card were both resolved at checkout to quote the
 * freight the buyer accepted, and the vendor has scanned each machine into a
 * sealed box. There is nothing left for an operator to confirm, so confirming it
 * is a hand-off that buys nothing and costs a click on every consignment.
 *
 * Both routes run rule R2, and both are idempotent through
 * `ShipmentService.book` — a double-click must not book two AWBs, because a
 * second AWB is a second real invoice from the carrier.
 */

const bulkDispatchSchema = z.object({
  poNumbers: z.array(z.string().trim().min(3).max(40)).min(1).max(200),
});
type BulkDispatchDto = z.infer<typeof bulkDispatchSchema>;

export interface DispatchResult {
  poNumber: string;
  awb: string | null;
  carrier: string;
  freight: string;
  /** Already booked, so this call changed nothing. */
  alreadyBooked: boolean;
  error: string | null;
}

@Controller('ops/purchase-orders')
export class OpsLogisticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: ShipmentService,
    private readonly automation: AutomationService,
  ) {}

  /**
   * Book one packed consignment.
   *
   * The response carries the four facts an operator needs and nothing else —
   * carrier, AWB, freight and the pickup window are what goes on the line of
   * confirmation the console renders.
   */
  @Post(':poNumber/dispatch')
  @RequirePermissions('procurement.po.dispatch')
  async dispatch(@Param('poNumber') poNumber: string): Promise<DispatchResult> {
    return this.dispatchOne(poNumber.trim());
  }

  /**
   * Book a selection.
   *
   * Reported per carrier rather than as one number — "22 on BlueDart, 9 on
   * Porter, 4 in-house" is the sentence that tells an operator whether the
   * routing rules are doing what they think they are doing, and a single total
   * tells them nothing at all.
   */
  @Post('dispatch')
  @RequirePermissions('procurement.po.dispatch')
  async dispatchMany(
    @Body(new ZodValidationPipe(bulkDispatchSchema)) body: BulkDispatchDto,
  ): Promise<{
    booked: number;
    alreadyBooked: number;
    failed: number;
    byCarrier: Record<string, number>;
    results: DispatchResult[];
  }> {
    const results: DispatchResult[] = [];
    for (const poNumber of body.poNumbers) {
      try {
        results.push(await this.dispatchOne(poNumber.trim()));
      } catch (err) {
        // One refusal does not abandon the other forty-nine. The board shows
        // which ones did not go and why, against their own PO numbers.
        results.push({
          poNumber,
          awb: null,
          carrier: '—',
          freight: '0.00',
          alreadyBooked: false,
          error: (err as Error).message,
        });
      }
    }

    const byCarrier: Record<string, number> = {};
    for (const row of results) {
      if (row.error || row.alreadyBooked) continue;
      byCarrier[row.carrier] = (byCarrier[row.carrier] ?? 0) + 1;
    }

    return {
      booked: results.filter((r) => !r.error && !r.alreadyBooked).length,
      alreadyBooked: results.filter((r) => r.alreadyBooked).length,
      failed: results.filter((r) => r.error).length,
      byCarrier,
      results,
    };
  }

  private async dispatchOne(poNumber: string): Promise<DispatchResult> {
    const [po] = await this.prisma.$queryRaw<
      Array<{ id: string; status: string; po_number: string }>
    >`
      SELECT id, status::text AS status, po_number
        FROM procurement.purchase_order WHERE po_number = ${poNumber}`;
    if (!po) throw new NotFoundError('purchase_order', { poNumber });

    if (!['DISPATCH_READY', 'DISPATCHED'].includes(po.status)) {
      throw new PreconditionFailedError(
        `${po.po_number} is ${po.status.toLowerCase().replaceAll('_', ' ')}. A consignment is booked once the vendor has packed it.`,
        { reason: 'po_not_packed', status: po.status },
      );
    }

    const [sub] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering.sub_order WHERE purchase_order_id = ${po.id}::uuid`;
    if (!sub) {
      throw new NotFoundError('sub_order', {
        poNumber,
        reason: 'This purchase order has no consignment linked to it.',
      });
    }

    const booking = await this.automation.run('R2', po.po_number, () =>
      this.shipments.book(sub.id),
    );

    // R2 switched off. The operator is told, rather than left looking at a
    // button that appeared to do nothing.
    if (!booking) {
      throw new PreconditionFailedError(
        'Automatic booking is switched off. Turn rule R2 back on, or book this consignment with the carrier directly.',
        { reason: 'automation_disabled', ruleId: 'R2' },
      );
    }

    return {
      poNumber: po.po_number,
      awb: booking.awb,
      carrier: booking.carrierCode,
      freight: booking.quotedFreight.toString(),
      alreadyBooked: booking.alreadyBooked,
      error: booking.bookingError,
    };
  }
}
