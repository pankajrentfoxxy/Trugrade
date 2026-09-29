import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { uuidSchema } from '@trugrade/contracts';
import { z } from 'zod';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { listingStatusSchema } from './dto/listing.dto';
import {
  ListingApprovalService,
  type OpsListingBoard,
  type OpsListingRow,
} from './internal/listing-approval.service';

/**
 * The listing approval queue. Platform staff only.
 *
 * A separate controller from `ListingController` because that one is
 * `@Controller('vendor/listings')` and every route on it is one a vendor may
 * call. These are gated on `listing.any.*`, which by the convention in
 * `roles.ts` no vendor or buyer role holds.
 */

const listQuerySchema = z.object({
  status: listingStatusSchema.optional(),
  /** A model name, a SKU code or a vendor's legal name. Matched, never parsed. */
  q: z.string().trim().min(1).max(60).optional(),
  vendor: uuidSchema.optional(),
  sort: z.enum(['oldest', 'newest', 'units', 'value']).default('oldest'),
  /** `?flagged=1` — only rows the pricing service has flagged. */
  flagged: z.literal('1').optional(),
  page: z.coerce.number().int().min(1).default(1),
  per: z.coerce.number().int().min(1).max(100).default(25),
});
type ListQueryDto = z.infer<typeof listQuerySchema>;

/** A reason the vendor can act on. "no" is not one. */
const rejectSchema = z.object({
  reason: z.string().trim().min(8, 'Say what the vendor should change, in a sentence.').max(500),
});
type RejectDto = z.infer<typeof rejectSchema>;

@Controller('ops/listings')
export class ListingOpsController {
  constructor(private readonly approvals: ListingApprovalService) {}

  @Get()
  @RequirePermissions('listing.any.read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto): Promise<OpsListingBoard> {
    return this.approvals.list({ ...query, flagged: query.flagged === '1' });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('listing.any.write')
  approve(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<OpsListingRow> {
    return this.approvals.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('listing.any.write')
  reject(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: RejectDto,
  ): Promise<OpsListingRow> {
    return this.approvals.reject(id, body.reason);
  }
}
