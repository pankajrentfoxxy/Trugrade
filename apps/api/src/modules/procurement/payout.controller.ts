import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { uuidSchema } from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { PayoutRunService, type PayoutRunView } from './internal/payout-run.service';

/**
 * Paying vendors: three acts, three seats.
 *
 * Drafting a run, approving it and releasing the money are three permissions on
 * purpose, and the middle one may not be held by whoever drafted it. That is the
 * whole control — `ck_payout_maker_is_not_checker` enforces it in the database,
 * and these routes exist so the separation is visible in the API surface rather
 * than buried in a service.
 */
/** A bank reference per payable. A line with no reference stays instructed. */
const confirmSchema = z.object({
  utrByPayableId: z.record(z.string().uuid(), z.string().trim().min(6).max(40)),
});
type ConfirmDto = z.infer<typeof confirmSchema>;

@Controller('finance/payout-runs')
export class PayoutController {
  constructor(private readonly runs: PayoutRunService) {}

  /** Draft a run over every payable whose return window has closed. */
  @Post()
  @HttpCode(201)
  @RequirePermissions('procurement.payout.run')
  create(): Promise<PayoutRunView> {
    return this.runs.create();
  }

  @Get(':id')
  @RequirePermissions('procurement.payout.run')
  detail(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<PayoutRunView> {
    return this.runs.detail(id);
  }

  /** The checker. Refused when it is the same person who drafted it. */
  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('finance.payout.approve')
  approve(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<PayoutRunView> {
    return this.runs.approve(id);
  }

  /** Treasury. The liability moves into transit here, and the batch has to foot. */
  @Post(':id/release')
  @HttpCode(200)
  @RequirePermissions('ap.payment.release')
  release(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<PayoutRunView> {
    return this.runs.release(id);
  }

  /**
   * The bank's references, once the statement has them.
   *
   * The only place a payable becomes PAID, because it is the only place there is
   * evidence that money moved — `chk_payout_utr` will not let a line say paid
   * without one.
   */
  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions('ap.payment.release')
  confirm(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(confirmSchema)) body: ConfirmDto,
  ): Promise<PayoutRunView> {
    return this.runs.confirm(id, body.utrByPayableId);
  }
}
