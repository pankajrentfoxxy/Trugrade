import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { BoardEnvelope, BoardQuery } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { NotFoundError, ValidationError } from '../../shared/errors/domain-errors';
import { PrismaService } from '../../shared/db/prisma.service';
import { ZodValidationPipe } from '../../shared/http/http';
import { CARRIER_REGISTRY } from '../../shared/adapters/adapters.module';
import type { CarrierPort } from '../../shared/adapters/ports';
import {
  FulfilmentBoardService,
  type ShipmentDetail,
  type CarrierRow,
  type NdrRow,
  type PickupRow,
  type RiderRow,
  type ShipmentRow,
} from './internal/fulfilment-board.service';

/**
 * The fulfilment boards.
 *
 * Read-only, one route each, all five sharing the board envelope so the console
 * renders them with one component. The query string is the whole of the board's
 * state — `?view=&q=&facet.x=&sort=&dir=&page=` — because a buyer, or an ops
 * manager, must be able to send a colleague a link to what they are looking at.
 */
const assignOneSchema = z.object({ riderId: z.string().uuid() });
const assignSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200),
  riderId: z.string().uuid(),
});
type AssignDto = z.infer<typeof assignSchema>;

@Controller('ops')
export class OpsBoardsController {
  constructor(
    private readonly boards: FulfilmentBoardService,
    private readonly prisma: PrismaService,
    @Inject(CARRIER_REGISTRY) private readonly carriers: Map<string, CarrierPort>,
  ) {}

  @Get('shipments')
  @RequirePermissions('logistics.shipment.read')
  shipments(@Query() query: Record<string, string>): Promise<BoardEnvelope<ShipmentRow>> {
    return this.boards.shipments(parse(query));
  }

  /**
   * One shipment, in full. Declared after the board route; Nest matches the
   * literal path first, so `/shipments` is never swallowed by `/shipments/:id`.
   */
  @Get('shipments/:id')
  @RequirePermissions('logistics.shipment.read')
  async shipment(@Param('id') id: string): Promise<ShipmentDetail> {
    const detail = await this.boards.shipmentDetail(id);
    if (!detail) throw new NotFoundError('shipment');
    return detail;
  }

  @Get('pickups')
  @RequirePermissions('logistics.shipment.read')
  pickups(@Query() query: Record<string, string>): Promise<BoardEnvelope<PickupRow>> {
    return this.boards.pickups(parse(query));
  }

  @Get('riders')
  @RequirePermissions('logistics.rider.manage')
  riders(@Query() query: Record<string, string>): Promise<BoardEnvelope<RiderRow>> {
    return this.boards.riders(parse(query));
  }

  @Get('carriers')
  @RequirePermissions('logistics.shipment.read')
  carrierBoard(@Query() query: Record<string, string>): Promise<BoardEnvelope<CarrierRow>> {
    return this.boards.carriers(parse(query));
  }

  /**
   * Each NDR row carries only the actions its own carrier accepts.
   *
   * Asked of the adapter rather than of a table, because the adapter is the only
   * thing that knows: Porter has no NDR workflow at all, and offering an
   * operator a Reattempt button that can only fail is worse than offering none.
   */
  @Get('ndr')
  @RequirePermissions('logistics.ndr.action')
  ndr(@Query() query: Record<string, string>): Promise<BoardEnvelope<NdrRow>> {
    return this.boards.ndr(parse(query), (code) => {
      const adapter = this.carriers.get(code);
      // A raw status code is what `legalNdrActions` keys on; NDR rows here are
      // already failures, so the generic failure code is the honest argument.
      return adapter ? adapter.legalNdrActions('FAILED_ATTEMPT') : [];
    });
  }

  /**
   * Put a rider on a pickup, one or many.
   *
   * One statement for the whole selection rather than one per task: a bulk
   * assignment that half-applies leaves an operator with no way to tell which
   * half, and re-running it is not safe to guess at. `status` is left alone —
   * assigning a rider is not completing a task.
   */
  @Post('pickups/rider')
  @HttpCode(200)
  @RequirePermissions('logistics.task.assign')
  async assignMany(
    @Body(new ZodValidationPipe(assignSchema)) body: AssignDto,
  ): Promise<{ assigned: number }> {
    const [rider] = await this.prisma.$queryRaw<Array<{ id: string; is_active: boolean }>>`
      SELECT id, is_active FROM logistics.rider WHERE id = ${body.riderId}::uuid`;
    if (!rider) throw new NotFoundError('rider');
    if (!rider.is_active) {
      throw new ValidationError('That rider is off shift. Pick somebody on duty, or switch them on first.', {
        riderId: 'Off shift.',
      });
    }

    const assigned = await this.prisma.$executeRaw`
      UPDATE logistics.pickup_task
         SET assigned_rider_id = ${body.riderId}::uuid
       WHERE id = ANY(${body.taskIds}::uuid[])
         AND status::text <> 'COMPLETED'`;
    return { assigned: Number(assigned) };
  }

  /** The single-task form, which is the one the record drawer calls. */
  @Post('pickups/:id/rider')
  @HttpCode(200)
  @RequirePermissions('logistics.task.assign')
  assignOne(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignOneSchema)) body: { riderId: string },
  ): Promise<{ assigned: number }> {
    return this.assignMany({ taskIds: [id], riderId: body.riderId });
  }
}


/**
 * Flatten `?facet.carrier=…` into a nested object.
 *
 * Nest hands query parameters through as a flat record, and the console sends
 * facets under a prefix so a board can add a facet without the endpoint growing
 * a parameter. Anything unrecognised is dropped rather than passed on — the
 * facet keys each board accepts are fixed in its service.
 */
function parse(query: Record<string, string>): BoardQuery {
  const facet: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('facet.') && value) facet[key.slice(6)] = value;
  }
  const page = Number(query.page);
  const per = Number(query.per);
  return {
    ...(query.view ? { view: query.view } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.sort ? { sort: query.sort } : {}),
    ...(query.dir === 'asc' || query.dir === 'desc' ? { dir: query.dir } : {}),
    ...(Number.isFinite(page) && page > 0 ? { page } : {}),
    ...(Number.isFinite(per) && per > 0 ? { per } : {}),
    facet,
  };
}
