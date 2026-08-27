import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  MFA_REQUIRED_ROLES,
  ROLE_PERMISSIONS,
  SESSION_POLICY,
  normaliseEmail,
  normaliseMobile,
  permissionsFor,
  type Permission,
  type Role,
} from '@trugrade/contracts';
import type { org_type as OrgTypeEnum, org_status as OrgStatusEnum } from '@prisma/client';
import { PrismaService } from '../../shared/db/prisma.service';
import { ClockPort } from '../../shared/clock';
import { EventBus } from '../../shared/events';
import { RateLimiter } from '../../shared/redis/redis.service';
import { TokenService, type IssuedTokens } from '../../shared/auth/token.service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../shared/errors/domain-errors';
import { PasswordService } from './internal/password.service';
import { AuditService } from './internal/audit.service';

/** `org_type` in the adopted schema is INTERNAL where the domain says PLATFORM. */
export type OrgType = 'VENDOR' | 'BUYER' | 'PLATFORM';
const DB_ORG_TYPE: Record<OrgType, string> = {
  VENDOR: 'VENDOR',
  BUYER: 'BUYER',
  PLATFORM: 'INTERNAL',
};
const DOMAIN_ORG_TYPE: Record<string, OrgType> = {
  VENDOR: 'VENDOR',
  BUYER: 'BUYER',
  INTERNAL: 'PLATFORM',
};

/** VR-049: roles that can move money rotate their password every 180 days. */
const PASSWORD_ROTATION_DAYS = 180;

export interface AuthenticatedUser {
  userId: string;
  orgId: string;
  orgType: OrgType;
  orgStatus: string;
  roles: Role[];
  permissions: Permission[];
  mfaEnabled: boolean;
  mfaRequired: boolean;
  fullName: string;
  email: string | null;
  mobile: string | null;
}

/**
 * The public interface of the `identity` module.
 *
 * Everything another module can ask about who someone is, which organisation
 * they act for, and what they may do. When `identity` becomes its own service,
 * this interface is the network contract and does not change.
 */
export interface IIdentityService {
  selfCheck(): Promise<{ ok: boolean; detail?: string }>;
  getUser(userId: string): Promise<AuthenticatedUser>;
  getOrganization(orgId: string): Promise<OrganizationSummary>;
  permissionsForUser(userId: string): Promise<Permission[]>;
  /** Suspension revokes every session immediately — it is not a flag for later. */
  suspendOrganization(orgId: string, reason: string, actorUserId: string): Promise<void>;
}

export interface OrganizationSummary {
  id: string;
  orgType: OrgType;
  legalName: string;
  status: string;
  constitution: string | null;
}

@Injectable()
export class IdentityService implements IIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly bus: EventBus,
  ) {}

  async selfCheck(): Promise<{ ok: boolean; detail?: string }> {
    const roles = await this.prisma.db.role.count();
    return roles > 0
      ? { ok: true }
      : { ok: false, detail: 'No roles seeded — RBAC would deny everything.' };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getUser(userId: string): Promise<AuthenticatedUser> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        org_id: string;
        org_type: string;
        org_status: string;
        full_name: string;
        email: string | null;
        mobile: string | null;
        mfa_enabled: boolean;
        status: string;
        roles: string[] | null;
      }>
    >`
      SELECT u.id, u.org_id, o.org_type::text AS org_type, o.status::text AS org_status,
             u.full_name, u.email::text AS email, u.mobile, u.mfa_enabled, u.status,
             array_remove(array_agg(r.code), NULL) AS roles
      FROM identity.user_account u
      JOIN identity.organization o ON o.id = u.org_id
      LEFT JOIN identity.user_role ur ON ur.user_id = u.id
      LEFT JOIN identity.role r ON r.id = ur.role_id
      WHERE u.id = ${userId}::uuid
      GROUP BY u.id, o.org_type, o.status`;

    const row = rows[0];
    if (!row) throw new NotFoundError('user');

    const roles = (row.roles ?? []) as Role[];
    return {
      userId: row.id,
      orgId: row.org_id,
      orgType: DOMAIN_ORG_TYPE[row.org_type] ?? 'BUYER',
      orgStatus: row.org_status,
      roles,
      permissions: [...permissionsFor(roles)],
      mfaEnabled: row.mfa_enabled,
      mfaRequired: roles.some((r) => MFA_REQUIRED_ROLES.includes(r)),
      fullName: row.full_name,
      email: row.email,
      mobile: row.mobile,
    };
  }

  async getOrganization(orgId: string): Promise<OrganizationSummary> {
    const org = await this.prisma.db.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundError('organisation');
    return {
      id: org.id,
      orgType: DOMAIN_ORG_TYPE[org.org_type] ?? 'BUYER',
      legalName: org.legal_name,
      status: org.status,
      constitution: org.constitution ?? null,
    };
  }

  async permissionsForUser(userId: string): Promise<Permission[]> {
    return (await this.getUser(userId)).permissions;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Create the organisation shell and its owner, after the contact details have
   * been verified.
   *
   * Deliberately one transaction: an org with no owner is unreachable, and an
   * owner with no org has nowhere to act. Neither half is useful alone.
   */
  async createOrganizationWithOwner(input: {
    orgType: OrgType;
    legalName: string;
    fullName: string;
    email: string;
    mobile: string;
    password?: string;
    leadId?: string | null;
  }): Promise<{ orgId: string; userId: string }> {
    const email = normaliseEmail(input.email);
    const mobile = normaliseMobile(input.mobile);
    if (!email || !mobile) {
      throw new ValidationError(
        'We need a valid work email and mobile number to create the account.',
      );
    }

    await this.assertContactAvailable(email, mobile);

    const ownerRole: Role = input.orgType === 'VENDOR' ? 'VENDOR_OWNER' : 'CUSTOMER_OWNER';

    return this.prisma.runInTransaction(async () => {
      const org = await this.prisma.db.organization.create({
        data: {
          org_type: DB_ORG_TYPE[input.orgType] as OrgTypeEnum,
          legal_name: input.legalName,
          status: 'REGISTERED',
        },
      });

      const user = await this.prisma.db.user_account.create({
        data: {
          org_id: org.id,
          full_name: input.fullName,
          email,
          mobile,
          // Contact verification is what got them here, so both are verified.
          email_verified_at: this.clock.now(),
          mobile_verified_at: this.clock.now(),
          is_org_owner: true,
          status: 'ACTIVE',
        },
      });

      await this.assignRole(user.id, ownerRole);

      if (input.password) {
        await this.passwords.setPassword(user.id, input.password, {
          email,
          mobile,
          fullName: input.fullName,
          rotationDays: MFA_REQUIRED_ROLES.includes(ownerRole) ? PASSWORD_ROTATION_DAYS : null,
        });
      }

      if (input.leadId) {
        await this.prisma.db.registration_lead.update({
          where: { id: input.leadId },
          data: { status: 'CONVERTED', converted_org_id: org.id },
        });
      }

      await this.audit.record({
        action: 'identity.organization.created',
        entityType: 'organization',
        entityId: org.id,
        after: { orgType: input.orgType, legalName: input.legalName },
        actorUserId: user.id,
        actorOrgId: org.id,
      });

      return { orgId: org.id, userId: user.id };
    });
  }

  /**
   * VR-031 / VR-033. Checked before the transaction so the message names the
   * field, and again by the database's unique indexes so a race cannot slip past.
   */
  private async assertContactAvailable(email: string, mobile: string): Promise<void> {
    const clash = await this.prisma.$queryRaw<
      Array<{ email: string | null; mobile: string | null }>
    >`
      SELECT email::text AS email, mobile FROM identity.user_account
      WHERE (lower(email::text) = lower(${email}) OR mobile = ${mobile})
        AND status <> 'DEACTIVATED'
      LIMIT 1`;

    const found = clash[0];
    if (!found) return;

    // Name the one that actually collided. "Already registered" against the wrong
    // field sends people to support.
    if (found.email && found.email.toLowerCase() === email.toLowerCase()) {
      throw new ConflictError(
        'This email is already registered. Sign in instead, or use a different address.',
      );
    }
    throw new ConflictError(
      'This mobile number is already registered. Sign in instead, or use a different number.',
    );
  }

  /**
   * `user_role` is scoped to an organisation, not just a user — the same person
   * could in principle hold a role in more than one org, and a grant that did not
   * say which would be ambiguous the first time that happened.
   */
  async assignRole(userId: string, role: Role, orgId?: string, grantedBy?: string): Promise<void> {
    const rows = await this.prisma.$executeRaw`
      INSERT INTO identity.user_role (user_id, role_id, org_id, granted_by)
      SELECT u.id, r.id, u.org_id, ${grantedBy ?? null}::uuid
      FROM identity.user_account u, identity.role r
      WHERE u.id = ${userId}::uuid
        AND r.code = ${role}
        AND (${orgId ?? null}::uuid IS NULL OR u.org_id = ${orgId ?? null}::uuid)
      ON CONFLICT DO NOTHING`;

    if (rows === 0) {
      // Either the role is not seeded or the user does not exist. Both are
      // deployment faults rather than user errors, and silently granting nothing
      // would surface much later as an unexplained permission denial.
      const exists = await this.prisma.db.role.findFirst({ where: { code: role } });
      if (!exists) {
        throw new Error(
          `Role "${role}" is not seeded. Run \`pnpm db:seed\` — RBAC cannot be assigned from an empty role table.`,
        );
      }
    }
  }

  async revokeRole(userId: string, role: Role): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM identity.user_role ur USING identity.role r
      WHERE ur.role_id = r.id AND ur.user_id = ${userId}::uuid AND r.code = ${role}`;
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  /**
   * VR-060: 5 failures per identifier per 15 minutes, 20 per IP.
   *
   * The response is deliberately identical for "no such user" and "wrong
   * password" — a different message is a user-enumeration oracle, and under this
   * model the buyer and vendor lists are both commercially sensitive.
   */
  async loginWithPassword(input: {
    identifier: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ tokens: IssuedTokens; user: AuthenticatedUser; mfaRequired: boolean }> {
    const email = normaliseEmail(input.identifier);
    const mobile = normaliseMobile(input.identifier);
    const subject = (email ?? mobile ?? input.identifier).toLowerCase();

    await this.limiter.consume(
      {
        name: 'login-id',
        limit: SESSION_POLICY.loginFailuresPerEmail,
        windowSeconds: SESSION_POLICY.loginWindowSeconds,
      },
      subject,
    );
    if (input.ip) {
      await this.limiter.consume(
        {
          name: 'login-ip',
          limit: SESSION_POLICY.loginFailuresPerIp,
          windowSeconds: SESSION_POLICY.loginWindowSeconds,
        },
        input.ip,
      );
    }

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        password_hash: string | null;
        status: string;
        locked_until: Date | null;
      }>
    >`
      SELECT id, password_hash, status, locked_until
      FROM identity.user_account
      WHERE (lower(email::text) = lower(${email ?? ''}) OR mobile = ${mobile ?? ''})
      LIMIT 1`;

    const found = rows[0];
    const generic = 'That email or password is not right.';

    if (!found) {
      // Spend comparable time on the miss, so response timing does not reveal
      // whether the account exists.
      await this.passwords.hash(input.password);
      throw new UnauthenticatedError(generic);
    }

    if (found.locked_until && found.locked_until.getTime() > this.clock.nowMs()) {
      throw new UnauthenticatedError(SESSION_POLICY.lockoutMessage);
    }

    const ok = await this.passwords.verify(found.password_hash, input.password);
    if (!ok) {
      const attempts = await this.recordFailedLogin(found.id);
      await this.audit.record({
        action: 'identity.login.failed',
        entityType: 'user_account',
        entityId: found.id,
        after: { attempts },
        actorUserId: found.id,
      });
      throw new UnauthenticatedError(generic);
    }

    return this.completeLogin(found.id, found.status, subject, input);
  }

  /**
   * Find the account behind a typed identifier, without saying whether there is
   * one.
   *
   * Returns null rather than throwing, because every caller is a `@Public()`
   * route that must answer identically either way. The *caller* decides what not
   * to do with a null; nothing about the response shape changes.
   */
  async findByIdentifier(identifier: string): Promise<{
    userId: string;
    status: string;
    /** Their role needs a second factor, so a code alone must not sign them in. */
    mfaRequired: boolean;
    /** Lower-cased. The only address a pre-session code may be sent to. */
    email: string | null;
  } | null> {
    const email = normaliseEmail(identifier);
    const mobile = normaliseMobile(identifier);

    const rows = await this.prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status
      FROM identity.user_account
      WHERE (lower(email::text) = lower(${email ?? ''}) OR mobile = ${mobile ?? ''})
      LIMIT 1`;

    const found = rows[0];
    if (!found) return null;
    const user = await this.getUser(found.id);
    return {
      userId: found.id,
      status: found.status,
      mfaRequired: user.mfaRequired,
      email: user.email?.toLowerCase() ?? null,
    };
  }

  /**
   * Sign in on the strength of a code that has already been verified.
   *
   * Everything after the password comparison is the same work — the ACTIVE
   * check, the suspended-organisation check, the lockout reset, the token, the
   * session row and the audit line — so it is the same code. A second copy of
   * "is this organisation suspended" is the copy that gets forgotten.
   *
   * **The caller must have consumed the OTP first.** This proves nothing on its
   * own; it is the half that happens once something else has.
   */
  async loginWithVerifiedCode(input: {
    userId: string;
    identifier: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ tokens: IssuedTokens; user: AuthenticatedUser; mfaRequired: boolean }> {
    const rows = await this.prisma.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM identity.user_account WHERE id = ${input.userId}::uuid LIMIT 1`;
    const status = rows[0]?.status;
    if (!status) throw new UnauthenticatedError();

    const email = normaliseEmail(input.identifier);
    const mobile = normaliseMobile(input.identifier);
    const subject = (email ?? mobile ?? input.identifier).toLowerCase();

    return this.completeLogin(input.userId, status, subject, input);
  }

  /**
   * Set a new password against a proof that is not the old password, and end
   * every session that was open at the time.
   *
   * The sign-out is the point rather than a courtesy: a reset is what somebody
   * does when they think an account is compromised, and one that leaves the
   * intruder's thirty-day refresh token alive has changed a string and nothing
   * else. The account owner signs in again a moment later; whoever else was
   * holding a session does not.
   */
  async resetPassword(userId: string, password: string): Promise<void> {
    const user = await this.getUser(userId);

    await this.passwords.setPassword(userId, password, {
      email: user.email,
      mobile: user.mobile,
      fullName: user.fullName,
      // VR-049, the same rule an owner account meets anywhere else: a login that
      // can change where money goes rotates. Read off the role rather than taken
      // as a parameter, so no caller can opt an owner out of it.
      rotationDays: user.mfaRequired ? PASSWORD_ROTATION_DAYS : null,
    });

    await this.tokens.revokeAllForUser(userId);
    await this.prisma.$executeRaw`
      UPDATE identity.session SET revoked_at = now()
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;

    // The lockout budget goes with it. Somebody who has just proved they can
    // read the account's mailbox should not then meet "too many attempts" left
    // over from the guesses that sent them here.
    for (const identifier of [user.email, user.mobile]) {
      if (!identifier) continue;
      await this.limiter.reset(
        {
          name: 'login-id',
          limit: SESSION_POLICY.loginFailuresPerEmail,
          windowSeconds: SESSION_POLICY.loginWindowSeconds,
        },
        identifier.toLowerCase(),
      );
    }

    await this.audit.record({
      action: 'identity.password.reset',
      entityType: 'user_account',
      entityId: userId,
      actorUserId: userId,
      actorOrgId: user.orgId,
    });
  }

  /**
   * The half of a sign-in that is true however the caller proved themselves.
   *
   * `subject` is the identifier the lockout budget is keyed on, passed in rather
   * than re-derived: both paths normalise the same typed string, and a second
   * normalisation here is a second chance to reset a key the consume never used.
   */
  private async completeLogin(
    userId: string,
    accountStatus: string,
    subject: string,
    input: { ip?: string; userAgent?: string },
  ): Promise<{ tokens: IssuedTokens; user: AuthenticatedUser; mfaRequired: boolean }> {
    if (accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        'This account is not active. Contact your organisation owner, or our support team if you believe this is wrong.',
      );
    }

    const user = await this.getUser(userId);

    // A suspended organisation cannot transact, and saying so plainly beats a
    // permission error on every subsequent screen.
    if (['SUSPENDED', 'BLACKLISTED', 'DEACTIVATED'].includes(user.orgStatus)) {
      throw new ForbiddenError(
        'This organisation account is suspended. Our team has been in touch — reply to that email, or contact support.',
      );
    }

    await this.prisma.db.user_account.update({
      where: { id: userId },
      data: { failed_login_count: 0, locked_until: null, last_login_at: this.clock.now() },
    });
    await this.limiter.reset(
      {
        name: 'login-id',
        limit: SESSION_POLICY.loginFailuresPerEmail,
        windowSeconds: SESSION_POLICY.loginWindowSeconds,
      },
      subject,
    );

    // When MFA is required but not yet satisfied the session is issued marked
    // unverified: the guard refuses privileged calls until the second factor lands.
    const tokens = await this.tokens.issue({
      userId: user.userId,
      orgId: user.orgId,
      orgType: user.orgType,
      roles: user.roles,
      permissions: user.permissions,
      mfa: !user.mfaRequired,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    await this.persistSession(tokens, user.userId, input);
    await this.audit.record({
      action: 'identity.login.succeeded',
      entityType: 'user_account',
      entityId: user.userId,
      actorUserId: user.userId,
      actorOrgId: user.orgId,
    });

    return { tokens, user, mfaRequired: user.mfaRequired };
  }

  private async recordFailedLogin(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ failed_login_count: number }>>`
      UPDATE identity.user_account
         SET failed_login_count = failed_login_count + 1,
             locked_until = CASE
               WHEN failed_login_count + 1 >= ${SESSION_POLICY.loginFailuresPerEmail}
               -- make_interval(secs => $1) fails when the driver binds the
               -- parameter as text; multiplying a literal interval does not.
               THEN now() + (INTERVAL '1 second' * ${SESSION_POLICY.lockoutSeconds})
               ELSE locked_until END
       WHERE id = ${userId}::uuid
       RETURNING failed_login_count`;
    return rows[0]?.failed_login_count ?? 0;
  }

  /**
   * The DB session row is the audit trail and the "your active sessions" screen.
   * Redis holds the hot path; this holds the history. They are allowed to
   * disagree after a Redis flush, because only one of them is authoritative.
   */
  private async persistSession(
    tokens: IssuedTokens,
    userId: string,
    input: { ip?: string; userAgent?: string },
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO identity.session (id, user_id, refresh_token_hash, token_family_id, ip, user_agent, expires_at)
      VALUES (${tokens.sessionId}::uuid, ${userId}::uuid,
              ${createHash('sha256').update(tokens.refreshToken).digest('hex')},
              ${tokens.sessionId}::uuid,
              ${input.ip ?? null}::inet, ${input.userAgent ?? null}, ${tokens.refreshExpiresAt})
      ON CONFLICT (id) DO UPDATE SET refresh_token_hash = EXCLUDED.refresh_token_hash`;
  }

  async refresh(presentedToken: string): Promise<IssuedTokens> {
    return this.tokens.rotate(presentedToken, async ({ userId }) => {
      const user = await this.getUser(userId);
      if (['SUSPENDED', 'BLACKLISTED', 'DEACTIVATED'].includes(user.orgStatus)) {
        // Catches a suspension that happened mid-session: the refresh is where a
        // long-lived login gets re-checked against reality.
        throw new ForbiddenError('This organisation account is suspended.');
      }
      return { orgType: user.orgType, roles: user.roles, permissions: user.permissions };
    });
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.tokens.revokeSession(sessionId);
    await this.prisma.$executeRaw`
      UPDATE identity.session SET revoked_at = now() WHERE id = ${sessionId}::uuid`;
    await this.audit.record({
      action: 'identity.logout',
      entityType: 'session',
      entityId: sessionId,
      actorUserId: userId,
    });
  }

  // -------------------------------------------------------------------------
  // Status changes
  // -------------------------------------------------------------------------

  /**
   * Suspension is immediate and total: every session dies now.
   *
   * A suspended vendor who keeps a valid access token for another fifteen minutes
   * can list stock in those fifteen minutes — and under the self-serve QC model
   * they can certify it too.
   */
  async suspendOrganization(orgId: string, reason: string, actorUserId: string): Promise<void> {
    const before = await this.getOrganization(orgId);

    await this.prisma.db.organization.update({
      where: { id: orgId },
      data: { status: 'SUSPENDED' },
    });

    const users = await this.prisma.db.user_account.findMany({
      where: { org_id: orgId },
      select: { id: true },
    });
    for (const u of users) await this.tokens.revokeAllForUser(u.id);
    await this.prisma.$executeRaw`
      UPDATE identity.session SET revoked_at = now()
      WHERE user_id IN (SELECT id FROM identity.user_account WHERE org_id = ${orgId}::uuid)
        AND revoked_at IS NULL`;

    // Revoking sessions stops them logging in. It does NOT stop their already
    // licensed DeviceSure agents from certifying machines, which is what would
    // actually keep suspended stock flowing. The vendor module listens for this.
    if (before.orgType === 'VENDOR') {
      await this.bus.publish('vendor.suspended', {
        orgId,
        reason,
        suspendedBy: actorUserId,
        revokeQcLicence: true,
      });
    }

    await this.audit.record({
      action: 'identity.organization.suspended',
      entityType: 'organization',
      entityId: orgId,
      before: { status: before.status },
      after: { status: 'SUSPENDED', reason, sessionsRevoked: users.length },
      actorUserId,
    });
  }

  async setOrganizationStatus(
    orgId: string,
    status: string,
    actorUserId: string,
    reason?: string,
  ): Promise<void> {
    const before = await this.getOrganization(orgId);
    await this.prisma.db.organization.update({
      where: { id: orgId },
      data: { status: status as OrgStatusEnum },
    });
    await this.audit.record({
      action: 'identity.organization.status_changed',
      entityType: 'organization',
      entityId: orgId,
      before: { status: before.status },
      after: { status, reason },
      actorUserId,
    });
  }

  /** The bundle a role carries. Exposed so the console can explain it to a person. */
  describeRole(role: Role): {
    role: Role;
    permissions: readonly Permission[];
    mfaRequired: boolean;
  } {
    return {
      role,
      permissions: ROLE_PERMISSIONS[role] ?? [],
      mfaRequired: MFA_REQUIRED_ROLES.includes(role),
    };
  }
}
