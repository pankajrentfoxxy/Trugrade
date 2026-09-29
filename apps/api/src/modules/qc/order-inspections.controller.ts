import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { uuidSchema } from '@trugrade/contracts';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../shared/auth/guards';
import type { Principal } from '../../shared/db/org-scope';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  OrderInspectionService,
  type AssignResult,
  type OrderInspectionView,
} from './internal/order-inspection.service';

/**
 * Order-first inspections: ops sends a technician for one order's machines,
 * and the technician names each machine at the vendor's site.
 *
 * Two audiences on one controller, split by permission the way the rest of
 * `/qc` is: `qc.visit.schedule` is ops (OPS_MANAGER, QC_MANAGER), and
 * `qc.visit.execute` is the technician, whose reads are scoped to their own
 * visits by the service. A technician holds `execute` and not `schedule`, so
 * the assign route and the platform-wide list are not theirs.
 */

/**
 * Assigning names the person AND books the slot, in one call, so an order
 * visit lands on the Visits and Schedule boards the same way a stock visit
 * does. The three slot fields travel together: a date without a slot is a
 * visit nobody can plan a day around.
 */
const assignSchema = z
  .object({
    orderNumber: z.string().trim().min(3).max(40),
    technicianId: uuidSchema,
    scheduledDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD, for example 2026-09-30.')
      .optional(),
    slotFrom: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected a time like 09:30.').optional(),
    slotTo: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Expected a time like 09:30.').optional(),
  })
  .refine(
    (v) =>
      (v.scheduledDate === undefined && v.slotFrom === undefined && v.slotTo === undefined) ||
      (v.scheduledDate !== undefined && v.slotFrom !== undefined && v.slotTo !== undefined),
    { path: ['slotTo'], message: 'Give the visit a date, a start time and an end time together.' },
  );
type AssignDto = z.infer<typeof assignSchema>;

const recordSchema = z.object({
  /** As printed on the sticker. Normalised server-side; a label prefix is stripped. */
  serial: z.string().trim().min(4).max(64),
});
type RecordDto = z.infer<typeof recordSchema>;

@Controller('qc/order-inspections')
export class OrderInspectionsController {
  constructor(private readonly inspections: OrderInspectionService) {}

  @Post('assign')
  @HttpCode(200)
  @RequirePermissions('qc.visit.schedule')
  assign(@Body(new ZodValidationPipe(assignSchema)) body: AssignDto): Promise<AssignResult> {
    return this.inspections.assign(
      body.orderNumber,
      body.technicianId,
      body.scheduledDate && body.slotFrom && body.slotTo
        ? { scheduledDate: body.scheduledDate, slotFrom: body.slotFrom, slotTo: body.slotTo }
        : undefined,
    );
  }

  /** Every order visit on the platform. Ops. */
  @Get()
  @RequirePermissions('qc.visit.schedule')
  all(): Promise<OrderInspectionView[]> {
    return this.inspections.all();
  }

  /** The signed-in technician's own order visits. */
  @Get('mine')
  @RequirePermissions('qc.visit.execute')
  mine(@CurrentUser() user: Principal): Promise<OrderInspectionView[]> {
    return this.inspections.mine(user.userId);
  }

  @Get(':visitId')
  @RequirePermissions('qc.visit.execute')
  one(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
    @CurrentUser() user: Principal,
  ): Promise<OrderInspectionView> {
    // Ops may open any order visit; a technician only their own.
    const isOps = user.permissions.has('qc.visit.schedule');
    return this.inspections.one(visitId, isOps ? {} : { forUserId: user.userId });
  }

  /** Name one machine: its serial, and its inspection. */
  @Post(':visitId/slots/:slotId')
  @HttpCode(200)
  @RequirePermissions('qc.visit.execute')
  record(
    @Param('visitId', new ZodValidationPipe(uuidSchema)) visitId: string,
    @Param('slotId', new ZodValidationPipe(uuidSchema)) slotId: string,
    @Body(new ZodValidationPipe(recordSchema)) body: RecordDto,
    @CurrentUser() user: Principal,
  ): Promise<OrderInspectionView> {
    return this.inspections.recordUnit({ visitId, slotId, serial: body.serial, userId: user.userId });
  }
}
