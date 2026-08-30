import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../shared/auth/guards';
import { NotFoundError } from '../../shared/errors/domain-errors';
import { ZodValidationPipe } from '../../shared/http/http';
import { claimNumberSchema, raiseClaimSchema, type RaiseClaimDto } from './dto/warranty.dto';
import {
  raiseReturnSchema,
  returnEligibilityQuerySchema,
  returnNumberSchema,
  type RaiseReturnDto,
  type ReturnEligibilityQueryDto,
} from './dto/returns.dto';
import {
  ReturnsService,
  type ReturnEligibility,
  type ReturnView,
} from './internal/returns.service';
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
  constructor(
    private readonly warranty: WarrantyService,
    private readonly returns: ReturnsService,
  ) {}

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

  // -------------------------------------------------------------------------
  // Returns — T24, inside the 48-hour inspection window
  // -------------------------------------------------------------------------

  /**
   * What can be sent back, and what cannot, and why.
   *
   * `?order=` narrows it to one order, which is how the return form arrives from
   * an order record. **Every machine is listed either way, blocked ones
   * included** — a machine that silently vanished from this list because its
   * window closed would leave the buyer thinking the serial was wrong. The
   * `blockedReason` is the sentence saying which of the four it is, and the
   * closed-window one carries the exact instant and the warranty route.
   *
   * A foreign order comes back with no machines and the route answers 404, never
   * 403: order numbers are sequential, so a refusal that distinguished them
   * would let anyone with an account count our orders.
   */
  @Get('returns/eligibility')
  @RequirePermissions('ordering.own.read')
  async eligibility(
    @Query(new ZodValidationPipe(returnEligibilityQuerySchema)) query: ReturnEligibilityQueryDto,
  ): Promise<ReturnEligibility> {
    const view = await this.returns.eligibility(query.order);
    if (query.order !== undefined && view.machines.length === 0) {
      throw new NotFoundError('order', { reason: 'no_such_order_for_this_org' });
    }
    return view;
  }

  @Get('returns')
  @RequirePermissions('ordering.own.read')
  returnList(): Promise<{ returns: readonly ReturnView[] }> {
    return this.returns.list();
  }

  @Get('returns/:returnNumber')
  @RequirePermissions('ordering.own.read')
  returnRecord(
    @Param('returnNumber', new ZodValidationPipe(returnNumberSchema)) returnNumber: string,
  ): Promise<ReturnView> {
    return this.returns.view(returnNumber);
  }

  /**
   * Raise a return over one or more machines on one order.
   *
   * 201 by Nest's default, and deliberately not idempotent: a return is a new
   * record with its own number, one per machine. What makes a double-submit safe
   * is `uq_return_open_per_unit` — a partial unique index on the states that are
   * still live — and the service refusing a machine that already has a return
   * open by naming its number, so the buyer goes to it rather than wondering
   * whether the first one landed.
   *
   * `platform.ticket.write` for the same reason a claim uses it: a return is the
   * same kind of act as raising a ticket, and it is what BUYER_PROCURER,
   * BUYER_ADMIN, BUYER_OWNER and BUYER_FINANCE already carry. VIEWER does not,
   * which is §3A.4's role list exactly.
   */
  @Post('returns')
  @RequirePermissions('platform.ticket.write')
  raiseReturn(
    @Body(new ZodValidationPipe(raiseReturnSchema)) body: RaiseReturnDto,
  ): Promise<{ returns: readonly ReturnView[] }> {
    return this.returns.raise(body);
  }
}
