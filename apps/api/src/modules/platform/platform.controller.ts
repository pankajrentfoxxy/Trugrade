import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import { claimNumberSchema, raiseClaimSchema, type RaiseClaimDto } from './dto/warranty.dto';
import {
  WarrantyService,
  type ClaimView,
  type WarrantyRegister,
} from './internal/warranty.service';

/**
 * The buyer's after-sale routes — warranty cover and warranty claims (T23).
 *
 * Three rules govern every handler here.
 *
 * **1. A claim routes to us, never to a supply point.** Under the
 * merchant-of-record model there is one seller, and the buyer's remedy is ours.
 * Nothing on these payloads names a vendor at any depth — not in a claim's
 * status history, not in the terms, not in an error message. The guarantee is
 * not care taken in this file: every response type is an explicit allow-list
 * built field by field in `WarrantyService`, a repository row is never returned,
 * and the vendor-backed months and `vendor_org_id` that DO exist on
 * `platform.warranty` are simply not selected onto the customer shape. A
 * blacklist would fail open the moment somebody adds a column.
 *
 * **2. A record belonging to another organisation is 404, not 403.** Claim
 * numbers carry a month and a counter, so "you may not see that one" confirms it
 * exists and turns the route into a volume oracle for anyone with an account.
 * The org id is in the repository's WHERE clause and a miss is indistinguishable
 * from a typo.
 *
 * **3. Every deadline on these payloads was decided here.** `inWarranty`,
 * `daysRemaining` and `expiringSoon` are server verdicts, not ingredients for
 * the browser to subtract. A wrong laptop clock must not be able to offer a
 * paid repair on a machine that is covered.
 *
 * `ordering.own.read` is the read permission and `platform.ticket.write` the
 * write one, because those are what the buyer roles already carry — a claim is
 * the same kind of act as raising a ticket, and inventing a permission would put
 * this module's routes out of reach of every seeded role until somebody
 * remembered to grant it.
 */
@Controller('buyer')
export class PlatformController {
  constructor(private readonly warranty: WarrantyService) {}

  /**
   * Warranty status for every machine the organisation owns.
   *
   * Every machine, not only the covered ones. A serial that has no cover because
   * it has not been delivered is exactly what a facilities manager comes here to
   * find, and hiding it would make the register look complete when it is not.
   */
  @Get('warranty')
  @RequirePermissions('ordering.own.read')
  register(): Promise<WarrantyRegister> {
    return this.warranty.register();
  }

  @Get('warranty/claims')
  @RequirePermissions('ordering.own.read')
  claims(): Promise<{ claims: readonly ClaimView[] }> {
    return this.warranty.claims();
  }

  @Get('warranty/claims/:claimNumber')
  @RequirePermissions('ordering.own.read')
  claim(
    @Param('claimNumber', new ZodValidationPipe(claimNumberSchema)) claimNumber: string,
  ): Promise<ClaimView> {
    return this.warranty.claim(claimNumber);
  }

  /**
   * Raise a claim against a serial.
   *
   * 201 by Nest's default for `@Post`, and deliberately not idempotent: a claim
   * is a new record with its own number. What makes a double-submit safe is the
   * service refusing a second open claim on a machine that already has one, and
   * naming the existing number so the buyer goes to it rather than wondering
   * whether the first one landed.
   */
  @Post('warranty/claims')
  @RequirePermissions('platform.ticket.write')
  raise(
    @Body(new ZodValidationPipe(raiseClaimSchema)) body: RaiseClaimDto,
  ): Promise<ClaimView> {
    return this.warranty.raiseClaim(body);
  }
}
