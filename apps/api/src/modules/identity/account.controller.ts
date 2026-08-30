import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  addressLine1Schema,
  addressLine2Schema,
  fullNameSchema,
  mobileSchema,
  pincodeSchema,
  uuidSchema,
} from '@trugrade/contracts';
import { RequirePermissions } from '../../shared/auth/guards';
import { ZodValidationPipe } from '../../shared/http/http';
import {
  AccountService,
  type AddressBookView,
  type OrgAddressView,
  type TeamMemberView,
  type TeamView,
} from './internal/account.service';

/**
 * The buying organisation's own record of itself — `/api/account/*`, T25.
 *
 * Separate from `IdentityController`, which is `/api/auth/*` and is about
 * proving who you are. This is about what your organisation holds: where its
 * machines go and who may spend its money. Same module, because the tables are
 * the same tables and a second module owning `identity.org_address` is the
 * duplication CLAUDE.md forbids.
 *
 * **The permissions are chosen to match 03_UX_SPEC §3A row for row**, and one
 * of them is not the obvious choice:
 *
 * | Route | Guard | Who that is |
 * |---|---|---|
 * | Read addresses | `ordering.own.read` | Every buyer role |
 * | Add a delivery site | `ordering.order.create` | Owner, admin, procurer |
 * | Change or retire one | `identity.user.write` | Owner, admin |
 * | Read the team | `identity.user.read` | Owner, admin |
 * | Change somebody's access | `identity.role.assign` | Owner |
 *
 * Adding a delivery site is guarded by an *ordering* permission because that is
 * exactly the population the spec names — *"BUYER_ADMIN, BUYER_OWNER,
 * BUYER_PROCURER (add delivery only)"* — and a procurer holds no identity
 * permission at all. Inventing a new permission code to say the same thing would
 * mean editing `packages/contracts`, which every deployed token is already
 * signed against.
 *
 * No business logic lives here. Every handler validates with a Zod schema and
 * calls one service method, and the org id comes from `OrgScope` inside the
 * repository statements — never from a body, never from a parameter.
 */

/**
 * A delivery site. Every column `identity.org_address` requires plus the two a
 * rider actually reads, and no `type`: this route writes `SHIPPING` and only
 * `SHIPPING`, so a billing address cannot be created through the storefront.
 *
 * `receivingHours` is absent because the column is. 03_UX_SPEC asks for it; the
 * table has nowhere to put it, and a field that silently discards what somebody
 * typed is worse than one that is not offered.
 */
const createAddressSchema = z.object({
  label: z.string().trim().min(1, 'Give this site a name your team will recognise.').max(60),
  line1: addressLine1Schema,
  line2: addressLine2Schema.nullish(),
  city: z.string().trim().min(1, 'Which city is this site in?').max(60),
  state: z.string().trim().min(1, 'Which state is this site in?').max(60),
  /** The GST state code. It decides which tax heads the invoice carries. */
  stateCode: z
    .string()
    .regex(/^\d{2}$/, 'Enter the two-digit GST state code — 06 for Haryana, 07 for Delhi.'),
  pincode: pincodeSchema,
  contactName: fullNameSchema,
  contactMobile: mobileSchema,
  landmark: z.string().trim().max(120).nullish(),
  /** Shown to the rider verbatim, so it is stored verbatim. */
  gateInstructions: z.string().trim().max(300).nullish(),
  isDefault: z.boolean().optional(),
});

const updateAddressSchema = createAddressSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/**
 * A change to somebody's access.
 *
 * `roles` is the whole set, not a delta. A patch that adds one role and leaves
 * the client to remember the rest is a patch that eventually drops one silently;
 * sending the full set means the screen and the row cannot disagree.
 */
const updateMemberSchema = z
  .object({
    roles: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((v) => v.roles !== undefined || v.status !== undefined, {
    message: 'Say what to change — either the roles or whether the account is active.',
  });

type CreateAddressDto = z.infer<typeof createAddressSchema>;
type UpdateAddressDto = z.infer<typeof updateAddressSchema>;
type UpdateMemberDto = z.infer<typeof updateMemberSchema>;

@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  // -------------------------------------------------------------------------
  // Addresses
  // -------------------------------------------------------------------------

  /**
   * Every address the organisation holds, split by what it is for.
   *
   * Read by every buyer role including a viewer: knowing where your own company
   * takes delivery is not a privileged fact, and the checkout picker already
   * shows the same rows to anyone who can reach a cart.
   */
  @Get('addresses')
  @RequirePermissions('ordering.own.read')
  addresses(): Promise<AddressBookView> {
    return this.account.addresses();
  }

  /** A new delivery site. 201 by default — this genuinely creates a resource. */
  @Post('addresses')
  @RequirePermissions('ordering.order.create')
  addAddress(
    @Body(new ZodValidationPipe(createAddressSchema)) body: CreateAddressDto,
  ): Promise<OrgAddressView> {
    return this.account.addAddress(body);
  }

  /**
   * Edit a delivery site, make it the default, or retire it.
   *
   * One route for all three because they are one row and one set of rules: the
   * last active site cannot be retired, promoting one demotes the rest, and a
   * billing address is refused whichever field was sent.
   */
  @Patch('addresses/:addressId')
  @RequirePermissions('identity.user.write')
  updateAddress(
    @Param('addressId', new ZodValidationPipe(uuidSchema)) addressId: string,
    @Body(new ZodValidationPipe(updateAddressSchema)) body: UpdateAddressDto,
  ): Promise<OrgAddressView> {
    return this.account.updateAddress(addressId, body);
  }

  // -------------------------------------------------------------------------
  // Team
  // -------------------------------------------------------------------------

  /**
   * The people in the organisation, with what each of them may do.
   *
   * The role matrix comes back with the members rather than from a second
   * endpoint, because the screen cannot render a role chip without knowing what
   * the role means, and two calls to draw one table is two chances to render
   * half of it.
   */
  @Get('team')
  @RequirePermissions('identity.user.read')
  team(): Promise<TeamView> {
    return this.account.team();
  }

  /**
   * Change somebody's roles, or switch their account off.
   *
   * `PATCH` and not `DELETE`: deactivation is not deletion and never will be —
   * the orders somebody raised keep naming them. Guarded by
   * `identity.role.assign`, which only an account owner holds, because both
   * halves of this route are the same power: a role change and a deactivation
   * both decide what a person can spend.
   */
  @Patch('team/:userId')
  @RequirePermissions('identity.role.assign')
  updateMember(
    @Param('userId', new ZodValidationPipe(uuidSchema)) userId: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberDto,
  ): Promise<TeamMemberView> {
    return this.account.updateMember(userId, body);
  }
}
