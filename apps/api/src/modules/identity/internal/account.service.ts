import { Injectable } from '@nestjs/common';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@trugrade/contracts';
import { AppConfig } from '../../../shared/config';
import { PrismaService } from '../../../shared/db/prisma.service';
import { OrgScope, RequestContextService } from '../../../shared/db/org-scope';
import { TokenService } from '../../../shared/auth/token.service';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { AuditService } from './audit.service';

/**
 * The buying organisation's own record of itself — its addresses and its people
 * (T25, 03_UX_SPEC §3A `/account/addresses` and `/account/team`).
 *
 * **Nothing new is stored.** `identity.org_address`, `identity.user_account`,
 * `identity.user_role` and `identity.role` already hold every fact these two
 * screens show, and they are this module's tables. The `customer` module is
 * empty and stays empty: a second home for an address is how two screens end up
 * disagreeing about where a laptop is being delivered.
 *
 * **Org scoping is at the repository layer, not here.** Every statement below
 * takes its `org_id` from `OrgScope`, which resolves it from the principal and
 * refuses a caller who asks for another organisation's — so a forgotten `WHERE`
 * cannot leak, because there is no path that supplies an org id from a request
 * body at all.
 *
 * Three rules that are decisions rather than code:
 *
 * **1. A billing address is not editable here.** It is bound to a GSTIN and it
 * is what the invoice carries; changing it changes the jurisdiction the tax is
 * charged in. 03_UX_SPEC: *"a change requires a `profile_change_request` with
 * proof"*. So a billing row comes back with `editable: false` and the reason in
 * words, and the write paths refuse it by type rather than by trusting the flag
 * the client was handed.
 *
 * **2. Nothing is deleted.** A deactivated person keeps their orders and a
 * deactivated site keeps its deliveries. `is_active = false` and
 * `status = 'SUSPENDED'` are the whole of it.
 *
 * **3. The last owner cannot be removed, and the screen is told why before it
 * tries.** An organisation with no `CUSTOMER_OWNER` cannot grant one back to
 * itself, and the way out is a support ticket. Counted from live rows on every
 * call, never cached.
 */

/* ==========================================================================
 * Allow-lists
 * ======================================================================== */

export interface OrgAddressView {
  id: string;
  type: 'REGISTERED' | 'BILLING' | 'SHIPPING' | 'PICKUP' | 'HUB';
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  /** Two digits. The GST jurisdiction, and mono wherever it is drawn. */
  stateCode: string;
  pincode: string;
  contactName: string;
  /** Normalised `+91XXXXXXXXXX`. */
  contactMobile: string;
  landmark: string | null;
  /** `org_address.delivery_instructions` — the gate and dock note, verbatim. */
  gateInstructions: string | null;
  /**
   * Always null. `identity.org_address` has **no receiving-hours column**, and
   * 03_UX_SPEC asks a delivery site for one. Reported rather than defaulted: a
   * screen given "09:00–18:00" we never collected would fail a delivery on our
   * own invented promise.
   */
  receivingHours: null;
  isDefault: boolean;
  isBillingEnabled: boolean;
  isActive: boolean;
  /** When we last confirmed it against a document. Null means never. */
  verifiedAt: string | null;
  editable: boolean;
  /** Why not, in words, when `editable` is false. */
  lockedReason: string | null;
}

export interface AddressBookView {
  /** Where machines go. The only kind this screen may add or change. */
  delivery: OrgAddressView[];
  /** Where the invoice is addressed. Read-only here; see rule 1. */
  billing: OrgAddressView[];
}

export interface TeamRoleView {
  code: string;
  description: string | null;
  /**
   * Read from `identity.role_permission`, not from a constant in the browser.
   * 03_UX_SPEC: *"Matrix is read from the server, not hard-coded in the UI."*
   */
  permissions: string[];
  /** False when the person asking does not hold everything the role grants. */
  assignable: boolean;
}

export interface TeamMemberView {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  jobTitle: string | null;
  department: string | null;
  status: string;
  isOrgOwner: boolean;
  roles: string[];
  mfaEnabled: boolean;
  /** Null means they have never signed in. Never drawn as a date. */
  lastLoginAt: string | null;
  /** The person reading the screen. Their own row takes no actions. */
  isYou: boolean;
  /** Why this row cannot be changed. Null when it can. */
  lockedReason: string | null;
}

export interface TeamView {
  members: TeamMemberView[];
  roles: TeamRoleView[];
  /** Live count of active owners. One is the floor, and the screen says so. */
  owners: number;
}

export interface CreateAddressInput {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  landmark?: string | null;
  gateInstructions?: string | null;
  isDefault?: boolean;
}

export type UpdateAddressInput = Partial<CreateAddressInput> & { isActive?: boolean };

export interface UpdateMemberInput {
  roles?: string[];
  status?: 'ACTIVE' | 'SUSPENDED';
}

export interface RegisteredAddressView {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

/** What the signed-in person may read about their own organisation — registration particulars. */
export interface OrgProfileView {
  fullName: string;
  email: string | null;
  mobile: string | null;
  jobTitle: string | null;
  orgType: 'BUYER' | 'VENDOR';
  legalName: string;
  tradeName: string | null;
  constitution: string | null;
  status: string;
  website: string | null;
  employeeCountBand: string | null;
  annualTurnoverBand: string | null;
  /** Buyer only — the code stored at registration. */
  industry: string | null;
  /** Vendor only — the category stored at registration. */
  businessCategory: string | null;
  gstin: string | null;
  gstLegalName: string | null;
  pan: string | null;
  panName: string | null;
  panVerified: boolean;
  registeredAddress: RegisteredAddressView | null;
}

/* ========================================================================== */

/** The roles a buying organisation may hold. Everything else is ours or a vendor's. */
const BUYER_ROLES: readonly Role[] = [
  'CUSTOMER_OWNER',
  'CUSTOMER_ADMIN',
  'CUSTOMER_BUYER',
  'CUSTOMER_APPROVER',
  'CUSTOMER_FINANCE',
  'CUSTOMER_VIEWER',
];

const OWNER_ROLE = 'CUSTOMER_OWNER';

const BILLING_LOCKED =
  'This address is bound to your GST registration and appears on every invoice we raise you, so it cannot be edited here. Changing it needs a document showing the new registered address — raise a support ticket and we will take it through the change-of-particulars check.';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
    private readonly ctx: RequestContextService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /* ----------------------------------------------------------------------
   * Profile
   * ------------------------------------------------------------------- */

  /**
   * The organisation's own registration particulars — what was collected at
   * sign-up and promoted into the ledger after verification.
   *
   * No `@RequirePermissions` on the route: every signed-in org member may read
   * their own company name and GSTIN, including a viewer who holds neither
   * `identity.user.read` nor `ordering.own.read`. Org scoping is still enforced
   * here via `orgId()` — there is no org id on the request to tamper with.
   *
   * PAN is decrypted for the org's own row only. It never leaves this allow-list.
   */
  async profile(): Promise<OrgProfileView> {
    const orgId = this.orgId();
    const me = this.ctx.requirePrincipal();
    const piiKey = this.config.get('PII_ENCRYPTION_KEY') ?? 'trugrade-local-pii-key';

    const [row] = await this.prisma.$queryRaw<
      Array<{
        full_name: string;
        email: string | null;
        mobile: string | null;
        job_title: string | null;
        org_type: string;
        legal_name: string;
        trade_name: string | null;
        constitution: string | null;
        status: string;
        website: string | null;
        employee_count_band: string | null;
        annual_turnover_band: string | null;
        industry: string | null;
        business_category: string | null;
        gstin: string | null;
        gst_legal_name: string | null;
        pan: string | null;
        pan_name: string | null;
        pan_verified: boolean | null;
        reg_line1: string | null;
        reg_line2: string | null;
        reg_city: string | null;
        reg_state: string | null;
        reg_pincode: string | null;
      }>
    >`
      SELECT u.full_name, u.email, u.mobile, u.job_title,
             o.org_type::text AS org_type, o.legal_name, o.trade_name,
             o.constitution::text AS constitution, o.status::text AS status,
             o.website, o.employee_count_band, o.annual_turnover_band,
             bp.industry, vp.business_category,
             g.gstin, g.legal_name_as_per_gst AS gst_legal_name,
             CASE WHEN p.pan_enc IS NOT NULL
                  THEN pgp_sym_decrypt(p.pan_enc, ${piiKey})::text
                  ELSE NULL END AS pan,
             p.name_as_per_pan AS pan_name,
             p.verified AS pan_verified,
             ra.line1 AS reg_line1, ra.line2 AS reg_line2,
             ra.city AS reg_city, ra.state AS reg_state, ra.pincode AS reg_pincode
        FROM identity.user_account u
        JOIN identity.organization o ON o.id = u.org_id
        LEFT JOIN customer.buyer_profile bp ON bp.org_id = o.id
        LEFT JOIN vendor.vendor_profile vp ON vp.org_id = o.id
        LEFT JOIN LATERAL (
          SELECT gstin, legal_name_as_per_gst
            FROM kyc.gst_profile
           WHERE org_id = o.id
           ORDER BY is_primary DESC, created_at ASC
           LIMIT 1
        ) g ON TRUE
        LEFT JOIN kyc.pan_record p ON p.org_id = o.id
        LEFT JOIN LATERAL (
          SELECT line1, line2, city, state, pincode
            FROM identity.org_address
           WHERE org_id = o.id AND type = 'REGISTERED'::address_type AND is_active
           ORDER BY created_at ASC
           LIMIT 1
        ) ra ON TRUE
       WHERE u.id = ${me.userId}::uuid AND u.org_id = ${orgId}::uuid`;

    if (!row) throw new NotFoundError('profile', { reason: 'signed_in_user_not_in_org' });

    const orgType = row.org_type === 'VENDOR' ? 'VENDOR' : 'BUYER';

    return {
      fullName: row.full_name,
      email: row.email,
      mobile: row.mobile,
      jobTitle: row.job_title,
      orgType,
      legalName: row.legal_name,
      tradeName: row.trade_name,
      constitution: row.constitution,
      status: row.status,
      website: row.website,
      employeeCountBand: row.employee_count_band,
      annualTurnoverBand: row.annual_turnover_band,
      industry: row.industry,
      businessCategory: row.business_category,
      gstin: row.gstin,
      gstLegalName: row.gst_legal_name,
      pan: row.pan?.trim().toUpperCase() ?? null,
      panName: row.pan_name,
      panVerified: row.pan_verified ?? false,
      registeredAddress:
        row.reg_line1 && row.reg_city && row.reg_state && row.reg_pincode
          ? {
              line1: row.reg_line1,
              line2: row.reg_line2,
              city: row.reg_city,
              state: row.reg_state,
              pincode: row.reg_pincode,
            }
          : null,
    };
  }

  /* ----------------------------------------------------------------------
   * Addresses
   * ------------------------------------------------------------------- */

  async addresses(): Promise<AddressBookView> {
    const rows = await this.addressRows();
    const all = rows.map((r) => this.addressView(r));
    return {
      delivery: all.filter((a) => a.type === 'SHIPPING'),
      // REGISTERED is where the company legally is and BILLING is where the
      // invoice goes; to a finance team they are one panel, and both are locked.
      billing: all.filter((a) => a.type === 'BILLING' || a.type === 'REGISTERED'),
    };
  }

  /**
   * A new delivery site.
   *
   * `SHIPPING` is not a parameter. A route that took a type could create a
   * BILLING row from the storefront and walk straight past rule 1 — so the one
   * kind this screen may add is the one it writes, and it is written here.
   */
  async addAddress(input: CreateAddressInput): Promise<OrgAddressView> {
    const orgId = this.orgId();
    return this.prisma.runInTransaction(async () => {
      // A first site is the default whether or not the form said so: an
      // organisation with delivery sites and no default has a checkout with
      // nothing pre-selected, and somebody has to pick every time.
      const [existing] = await this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM identity.org_address
         WHERE org_id = ${orgId}::uuid AND type = 'SHIPPING' AND is_active`;
      const makeDefault = input.isDefault === true || (existing?.n ?? 0) === 0;
      if (makeDefault) await this.clearDefault(orgId);

      const [row] = await this.prisma.$queryRaw<AddressRow[]>`
        INSERT INTO identity.org_address
          (org_id, type, label, line1, line2, city, state, state_code, pincode,
           contact_name, contact_mobile, landmark, delivery_instructions,
           is_default, is_billing_enabled, is_active)
        VALUES (${orgId}::uuid, 'SHIPPING'::public.address_type, ${input.label},
                ${input.line1}, ${input.line2 ?? null}, ${input.city}, ${input.state},
                ${input.stateCode}, ${input.pincode}, ${input.contactName},
                ${input.contactMobile}, ${input.landmark ?? null},
                ${input.gateInstructions ?? null}, ${makeDefault}, FALSE, TRUE)
        RETURNING id, type::text AS type, label, line1, line2, city, state, state_code,
                  pincode, contact_name, contact_mobile, landmark, delivery_instructions,
                  is_default, is_billing_enabled, is_active, verified_at`;
      if (!row) throw new PreconditionFailedError('That delivery site could not be saved.');

      await this.audit.record({
        action: 'account.address.created',
        entityType: 'org_address',
        entityId: row.id,
        after: { city: row.city, pincode: row.pincode },
      });
      return this.addressView(row);
    });
  }

  async updateAddress(id: string, input: UpdateAddressInput): Promise<OrgAddressView> {
    const orgId = this.orgId();
    const current = await this.requireAddress(id, orgId);
    if (current.type !== 'SHIPPING') throw new ForbiddenError(BILLING_LOCKED, { reason: 'billing_address_locked' });

    return this.prisma.runInTransaction(async () => {
      if (input.isActive === false) await this.guardLastDeliverySite(orgId, id);
      if (input.isDefault === true) await this.clearDefault(orgId);
      // Deactivating the default would leave the organisation with no default at
      // all, which is the state `addAddress` goes out of its way to prevent.
      const stillDefault =
        input.isDefault === true ? true : input.isActive === false ? false : current.is_default;

      const [row] = await this.prisma.$queryRaw<AddressRow[]>`
        UPDATE identity.org_address
           SET label = ${input.label ?? current.label},
               line1 = ${input.line1 ?? current.line1},
               line2 = ${input.line2 === undefined ? current.line2 : input.line2},
               city = ${input.city ?? current.city},
               state = ${input.state ?? current.state},
               state_code = ${input.stateCode ?? current.state_code},
               pincode = ${input.pincode ?? current.pincode},
               contact_name = ${input.contactName ?? current.contact_name},
               contact_mobile = ${input.contactMobile ?? current.contact_mobile},
               landmark = ${input.landmark === undefined ? current.landmark : input.landmark},
               delivery_instructions = ${
                 input.gateInstructions === undefined
                   ? current.delivery_instructions
                   : input.gateInstructions
               },
               is_default = ${stillDefault},
               is_active = ${input.isActive ?? current.is_active}
         WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
        RETURNING id, type::text AS type, label, line1, line2, city, state, state_code,
                  pincode, contact_name, contact_mobile, landmark, delivery_instructions,
                  is_default, is_billing_enabled, is_active, verified_at`;
      if (!row) throw new NotFoundError('address');

      await this.audit.record({
        action: input.isActive === false ? 'account.address.deactivated' : 'account.address.updated',
        entityType: 'org_address',
        entityId: id,
        before: { isDefault: current.is_default, isActive: current.is_active },
        after: { isDefault: row.is_default, isActive: row.is_active },
      });
      return this.addressView(row);
    });
  }

  /* ----------------------------------------------------------------------
   * Team
   * ------------------------------------------------------------------- */

  async team(): Promise<TeamView> {
    const orgId = this.orgId();
    const me = this.ctx.requirePrincipal();

    const members = await this.prisma.$queryRaw<MemberRow[]>`
      SELECT u.id, u.full_name, u.email, u.mobile, u.job_title, u.department, u.status,
             u.is_org_owner, u.mfa_enabled, u.last_login_at,
             coalesce(
               (SELECT array_agg(r.code ORDER BY r.code)
                  FROM identity.user_role ur
                  JOIN identity.role r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND ur.org_id = u.org_id),
               ARRAY[]::text[]) AS roles
        FROM identity.user_account u
       WHERE u.org_id = ${orgId}::uuid
       ORDER BY u.is_org_owner DESC, u.full_name`;

    const owners = members.filter(
      (m) => m.status === 'ACTIVE' && m.roles.includes(OWNER_ROLE),
    ).length;

    return {
      members: members.map((m) => this.memberView(m, me.userId, owners)),
      roles: await this.roleOptions(),
      owners,
    };
  }

  /**
   * Change what somebody may do, or switch them off.
   *
   * Every refusal here is a sentence rather than a 403 with no body, because the
   * three that fire in practice — your own row, the last owner, a role you do
   * not hold yourself — each have a different thing the person should do next.
   */
  async updateMember(userId: string, input: UpdateMemberInput): Promise<TeamMemberView> {
    const orgId = this.orgId();
    const me = this.ctx.requirePrincipal();

    if (userId === me.userId) {
      throw new ForbiddenError(
        'You cannot change your own access from here. Removing your own last permission is how an organisation locks itself out, so another account owner has to make the change.',
        { reason: 'self_role_change' },
      );
    }

    const [target] = await this.prisma.$queryRaw<MemberRow[]>`
      SELECT u.id, u.full_name, u.email, u.mobile, u.job_title, u.department, u.status,
             u.is_org_owner, u.mfa_enabled, u.last_login_at,
             coalesce(
               (SELECT array_agg(r.code ORDER BY r.code)
                  FROM identity.user_role ur
                  JOIN identity.role r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND ur.org_id = u.org_id),
               ARRAY[]::text[]) AS roles
        FROM identity.user_account u
       WHERE u.id = ${userId}::uuid AND u.org_id = ${orgId}::uuid`;
    if (!target) throw new NotFoundError('person', { reason: 'not_in_this_organisation' });

    const roles = input.roles ? this.checkRoles(input.roles, me.permissions) : null;
    const nextStatus = input.status ?? target.status;
    const keepsOwner = (roles ?? target.roles).includes(OWNER_ROLE) && nextStatus === 'ACTIVE';

    // The last-owner floor. Counted live, from the same statement shape the
    // screen reads, so the button the screen disables and the rule the server
    // enforces cannot drift apart.
    if (target.roles.includes(OWNER_ROLE) && target.status === 'ACTIVE' && !keepsOwner) {
      const [owners] = await this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM identity.user_account u
          JOIN identity.user_role ur ON ur.user_id = u.id AND ur.org_id = u.org_id
          JOIN identity.role r ON r.id = ur.role_id
         WHERE u.org_id = ${orgId}::uuid AND u.status = 'ACTIVE' AND r.code = ${OWNER_ROLE}`;
      if ((owners?.n ?? 0) <= 1) {
        throw new PreconditionFailedError(
          `${target.full_name} is the only account owner your organisation has. An organisation with no owner cannot grant the role back to itself, so make somebody else an owner first and then change this.`,
          { reason: 'last_owner' },
        );
      }
    }

    return this.prisma.runInTransaction(async () => {
      if (roles) {
        await this.prisma.$executeRaw`
          DELETE FROM identity.user_role
           WHERE user_id = ${userId}::uuid AND org_id = ${orgId}::uuid`;
        for (const code of roles) {
          await this.prisma.$executeRaw`
            INSERT INTO identity.user_role (user_id, role_id, org_id, granted_by, granted_at)
            SELECT ${userId}::uuid, r.id, ${orgId}::uuid, ${me.userId}::uuid, now()
              FROM identity.role r WHERE r.code = ${code}`;
        }
      }

      if (input.status && input.status !== target.status) {
        await this.prisma.$executeRaw`
          UPDATE identity.user_account SET status = ${input.status}, updated_at = now()
           WHERE id = ${userId}::uuid AND org_id = ${orgId}::uuid`;
        if (input.status === 'SUSPENDED') {
          // A deactivation that leaves a live fifteen-minute access token behind
          // has not deactivated anybody for fifteen minutes. Same pair of writes
          // a password reset does, for the same reason.
          await this.tokens.revokeAllForUser(userId);
          await this.prisma.$executeRaw`
            UPDATE identity.session SET revoked_at = now()
             WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;
        }
      }

      await this.audit.record({
        action: 'account.member.updated',
        entityType: 'user_account',
        entityId: userId,
        before: { roles: target.roles, status: target.status },
        after: { roles: roles ?? target.roles, status: nextStatus },
      });

      const owners = await this.ownerCount(orgId);
      return this.memberView(
        { ...target, roles: roles ?? target.roles, status: nextStatus },
        me.userId,
        owners,
      );
    });
  }

  /* ----------------------------------------------------------------------
   * The parts
   * ------------------------------------------------------------------- */

  /**
   * The organisation every statement above is about.
   *
   * `OrgScope.currentOrgId` and never a request parameter: there is no shape of
   * request that can name a different organisation, which is a stronger property
   * than checking that it matches.
   */
  private orgId(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError('This screen is about one organisation, so one has to be signed in.', {
        reason: 'account_route_without_org',
      });
    }
    return orgId;
  }

  private async addressRows(): Promise<AddressRow[]> {
    const orgId = this.orgId();
    return this.prisma.$queryRaw<AddressRow[]>`
      SELECT id, type::text AS type, label, line1, line2, city, state, state_code, pincode,
             contact_name, contact_mobile, landmark, delivery_instructions,
             is_default, is_billing_enabled, is_active, verified_at
        FROM identity.org_address
       WHERE org_id = ${orgId}::uuid
         AND type IN ('SHIPPING','BILLING','REGISTERED')
       ORDER BY is_active DESC, is_default DESC, label NULLS LAST, city`;
  }

  private async requireAddress(id: string, orgId: string): Promise<AddressRow> {
    const [row] = await this.prisma.$queryRaw<AddressRow[]>`
      SELECT id, type::text AS type, label, line1, line2, city, state, state_code, pincode,
             contact_name, contact_mobile, landmark, delivery_instructions,
             is_default, is_billing_enabled, is_active, verified_at
        FROM identity.org_address
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid`;
    if (!row) throw new NotFoundError('address', { reason: 'no_such_address_for_this_org' });
    return row;
  }

  private async clearDefault(orgId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE identity.org_address SET is_default = FALSE
       WHERE org_id = ${orgId}::uuid AND type = 'SHIPPING' AND is_default`;
  }

  private async guardLastDeliverySite(orgId: string, id: string): Promise<void> {
    const [others] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM identity.org_address
       WHERE org_id = ${orgId}::uuid AND type = 'SHIPPING' AND is_active
         AND id <> ${id}::uuid`;
    if ((others?.n ?? 0) === 0) {
      throw new PreconditionFailedError(
        'This is the only delivery site on your account, and checkout needs somewhere to send machines. Add the new site first, then switch this one off.',
        { reason: 'last_delivery_site' },
      );
    }
  }

  private async ownerCount(orgId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n
        FROM identity.user_account u
        JOIN identity.user_role ur ON ur.user_id = u.id AND ur.org_id = u.org_id
        JOIN identity.role r ON r.id = ur.role_id
       WHERE u.org_id = ${orgId}::uuid AND u.status = 'ACTIVE' AND r.code = ${OWNER_ROLE}`;
    return row?.n ?? 0;
  }

  /**
   * The roles on offer, with what each one grants, read from the database.
   *
   * `assignable` is *"custom roles cannot exceed the creator's own permissions"*
   * applied to the fixed ones: an admin who cannot approve orders cannot make
   * somebody an approver, because that is granting a power they do not hold.
   */
  private async roleOptions(): Promise<TeamRoleView[]> {
    const me = this.ctx.requirePrincipal();
    const rows = await this.prisma.$queryRaw<
      Array<{ code: string; description: string | null; permissions: string[] }>
    >`
      SELECT r.code, r.description,
             coalesce(
               (SELECT array_agg(p.code ORDER BY p.code)
                  FROM identity.role_permission rp
                  JOIN identity.permission p ON p.id = rp.permission_id
                 WHERE rp.role_id = r.id),
               ARRAY[]::text[]) AS permissions
        FROM identity.role r
       WHERE r.code = ANY(${[...BUYER_ROLES]}::text[])
       ORDER BY r.code`;

    return rows.map((r) => ({
      code: r.code,
      description: r.description,
      permissions: r.permissions,
      assignable: r.permissions.every((p) => me.permissions.has(p as Permission)),
    }));
  }

  /** Every requested role must be a buyer role AND within the caller's own grant. */
  private checkRoles(requested: readonly string[], mine: ReadonlySet<Permission>): string[] {
    const unique = [...new Set(requested)];
    if (unique.length === 0) {
      throw new ValidationError(
        'Give this person at least one role. Somebody with none can sign in and see nothing, which looks like a broken account rather than a deliberate one — switch them off instead.',
        { roles: 'Pick at least one role.' },
      );
    }
    for (const code of unique) {
      if (!BUYER_ROLES.includes(code as Role)) {
        throw new ValidationError(`${code} is not a role a buying organisation can hold.`, {
          roles: `${code} is not one of your organisation's roles.`,
        });
      }
      const granted = ROLE_PERMISSIONS[code as Role] ?? [];
      const beyond = granted.filter((p) => !mine.has(p));
      if (beyond.length > 0) {
        throw new ForbiddenError(
          `You cannot give somebody ${code}, because it grants more than your own account can do. An account owner can make this change.`,
          { reason: 'role_exceeds_granter', role: code, beyond },
        );
      }
    }
    return unique;
  }

  private addressView(row: AddressRow): OrgAddressView {
    const editable = row.type === 'SHIPPING';
    return {
      id: row.id,
      type: row.type as OrgAddressView['type'],
      label: row.label,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      state: row.state,
      stateCode: row.state_code,
      pincode: row.pincode,
      contactName: row.contact_name,
      contactMobile: row.contact_mobile,
      landmark: row.landmark?.trim() || null,
      gateInstructions: row.delivery_instructions?.trim() || null,
      receivingHours: null,
      isDefault: row.is_default,
      isBillingEnabled: row.is_billing_enabled,
      isActive: row.is_active,
      verifiedAt: row.verified_at?.toISOString() ?? null,
      editable,
      lockedReason: editable ? null : BILLING_LOCKED,
    };
  }

  private memberView(row: MemberRow, viewerId: string, owners: number): TeamMemberView {
    const isYou = row.id === viewerId;
    const lastOwner = row.status === 'ACTIVE' && row.roles.includes(OWNER_ROLE) && owners <= 1;
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      mobile: row.mobile,
      jobTitle: row.job_title,
      department: row.department,
      status: row.status,
      isOrgOwner: row.is_org_owner,
      roles: row.roles,
      mfaEnabled: row.mfa_enabled,
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      isYou,
      lockedReason: isYou
        ? 'This is you. Another account owner has to change your access.'
        : lastOwner
          ? 'The only account owner. Make somebody else an owner before changing this one.'
          : null,
    };
  }
}

/* ==========================================================================
 * Row shapes
 * ======================================================================== */

interface AddressRow {
  id: string;
  type: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  state_code: string;
  pincode: string;
  contact_name: string;
  contact_mobile: string;
  landmark: string | null;
  delivery_instructions: string | null;
  is_default: boolean;
  is_billing_enabled: boolean;
  is_active: boolean;
  verified_at: Date | null;
}

interface MemberRow {
  id: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  job_title: string | null;
  department: string | null;
  status: string;
  is_org_owner: boolean;
  mfa_enabled: boolean;
  last_login_at: Date | null;
  roles: string[];
}
