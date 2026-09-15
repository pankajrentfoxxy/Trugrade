import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  CUSTOMER_ROLES,
  MFA_REQUIRED_ROLES,
  VENDOR_ROLES,
  normaliseEmail,
  normaliseMobile,
  type Role,
} from '@trugrade/contracts';
import { PrismaService } from '../../../shared/db/prisma.service';
import { OrgScope, RequestContextService } from '../../../shared/db/org-scope';
import { ClockPort } from '../../../shared/clock';
import { NotificationPort } from '../../../shared/adapters/ports';
import { AppConfig } from '../../../shared/config';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../../shared/errors/domain-errors';
import { AuditService } from './audit.service';
import { PasswordService } from './password.service';
import { IdentityService } from '../identity.service';

const INVITE_TTL_HOURS = 72;
const TOKEN_BYTES = 32;

export interface TeamInviteView {
  id: string;
  email: string | null;
  mobile: string | null;
  fullName: string;
  role: string;
  facilityIds: string[];
  facilityLabels: string[];
  status: string;
  sentAt: string;
  expiresAt: string;
  /** Seconds remaining, for countdown display. */
  expiresInSeconds: number;
}

export interface InvitePreviewView {
  fullName: string;
  email: string | null;
  role: string;
  roleLabel: string;
  orgLegalName: string;
  inviterName: string;
  mfaRequired: boolean;
  expired: boolean;
  alreadyUsed: boolean;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const ROLE_LABEL: Record<string, string> = {
  VENDOR_OWNER: 'Owner',
  VENDOR_ADMIN: 'Operations Manager',
  VENDOR_FINANCE: 'Finance',
  VENDOR_VIEWER: 'Warehouse',
  CUSTOMER_OWNER: 'Owner',
  CUSTOMER_ADMIN: 'Admin',
  CUSTOMER_BUYER: 'Buyer',
  CUSTOMER_APPROVER: 'Approver',
  CUSTOMER_FINANCE: 'Finance',
  CUSTOMER_VIEWER: 'Viewer',
};

/** The database's spelling of an organisation's kind, as the invite reads it. */
type InviteOrgType = 'VENDOR' | 'BUYER' | 'INTERNAL';

/**
 * Which roles an organisation of this kind may hand out, and the one it may
 * not: an owner is promoted, never invited, on either side.
 */
function invitableRoles(orgType: InviteOrgType): {
  allowed: readonly string[];
  owner: string;
  refusal: string;
  noun: string;
} {
  if (orgType === 'BUYER') {
    return {
      allowed: CUSTOMER_ROLES,
      owner: 'CUSTOMER_OWNER',
      refusal: 'Pick Admin, Buyer, Approver, Finance or Viewer.',
      noun: 'buyer',
    };
  }
  return {
    allowed: VENDOR_ROLES,
    owner: 'VENDOR_OWNER',
    refusal: 'Pick Owner, Operations, Finance or Warehouse.',
    noun: 'vendor',
  };
}

/**
 * Where the emailed link lands. A buyer's team lives on the storefront and a
 * supplier's on the console; a buyer sent to the console would be refused at
 * the door as the wrong kind of account.
 */
function inviteDestination(
  orgType: InviteOrgType,
  urls: { storefront: string; console: string },
): { path: string; base: string; templateCode: string; orgFallback: string } {
  if (orgType === 'BUYER') {
    return {
      base: urls.storefront,
      path: '/invite/accept',
      templateCode: 'BUYER_TEAM_INVITE',
      orgFallback: 'your buyer account',
    };
  }
  return {
    base: urls.console,
    path: '/team/accept',
    templateCode: 'VENDOR_TEAM_INVITE',
    orgFallback: 'your supplier account',
  };
}

@Injectable()
export class TeamInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrgScope,
    private readonly ctx: RequestContextService,
    private readonly clock: ClockPort,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationPort,
    private readonly config: AppConfig,
    private readonly identity: IdentityService,
  ) {}

  private orgId(): string {
    const orgId = this.scope.currentOrgId;
    if (!orgId) {
      throw new ForbiddenError('Team invites require a signed-in organisation.', {
        reason: 'team_route_without_org',
      });
    }
    return orgId;
  }

  private assertTeamManage(): void {
    const me = this.ctx.requirePrincipal();
    if (!me.permissions.has('identity.team.manage')) {
      throw new ForbiddenError('Only the account owner may invite or change team members.', {
        reason: 'team_manage_required',
      });
    }
  }

  async listInvites(): Promise<TeamInviteView[]> {
    this.assertTeamManage();
    const orgId = this.orgId();
    const now = this.clock.now();
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        email: string | null;
        mobile: string | null;
        full_name: string;
        role_code: string;
        facility_ids: string[];
        status: string;
        created_at: Date;
        expires_at: Date;
      }>
    >`
      SELECT i.id, i.email::text AS email, i.mobile, i.full_name,
             r.code AS role_code, i.facility_ids, i.status,
             i.created_at, i.expires_at
        FROM identity.user_invitation i
        JOIN identity.role r ON r.id = i.role_id
       WHERE i.org_id = ${orgId}::uuid
         AND i.status = 'PENDING'
       ORDER BY i.created_at DESC`;

    const labels = await this.facilityLabels(
      orgId,
      rows.flatMap((r) => r.facility_ids ?? []),
    );
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      mobile: row.mobile,
      fullName: row.full_name,
      role: row.role_code,
      facilityIds: row.facility_ids ?? [],
      facilityLabels: (row.facility_ids ?? []).map((id) => labels.get(id) ?? id.slice(0, 8)),
      status: row.status,
      sentAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      expiresInSeconds: Math.max(0, Math.floor((row.expires_at.getTime() - now.getTime()) / 1000)),
    }));
  }

  async createInvite(input: {
    email: string;
    fullName: string;
    mobile: string;
    role: string;
    facilityIds: string[];
  }): Promise<{ invite: TeamInviteView; emailSent: boolean }> {
    this.assertTeamManage();
    const orgId = this.orgId();
    const me = this.ctx.requirePrincipal();
    const email = normaliseEmail(input.email);
    const mobile = normaliseMobile(input.mobile);
    if (!email || !mobile) {
      const fields: Record<string, string> = {};
      if (!email) fields.email = 'Enter a valid work email.';
      if (!mobile) fields.mobile = 'Enter a valid 10-digit mobile number.';
      throw new ValidationError('Enter a valid email and a 10-digit mobile number.', fields);
    }
    const [org] = await this.prisma.$queryRaw<
      Array<{ legal_name: string; org_type: InviteOrgType }>
    >`
      SELECT legal_name, org_type::text AS org_type
        FROM identity.organization WHERE id = ${orgId}::uuid`;
    const orgType: InviteOrgType = org?.org_type ?? 'VENDOR';
    const roles = invitableRoles(orgType);

    if (!roles.allowed.includes(input.role)) {
      throw new ValidationError(`${input.role} is not a ${roles.noun} role.`, {
        role: roles.refusal,
      });
    }
    if (input.role === roles.owner) {
      throw new ValidationError(
        'Invite another role first, then promote them to Owner if needed.',
        { role: 'New invites cannot be Owners directly.' },
      );
    }

    await this.assertFacilitiesOwned(orgId, input.facilityIds);

    const clashes = await this.prisma.$queryRaw<
      Array<{ email: string | null; mobile: string | null }>
    >`
      SELECT email::text AS email, mobile FROM identity.user_account
       WHERE (lower(email::text) = lower(${email}) OR mobile = ${mobile})
         AND status <> 'DEACTIVATED'
       LIMIT 2`;
    // Name the value that collided. Email and mobile are each unique across every
    // account, and a refusal that always blamed the email sent an owner retyping
    // a perfectly good address while the mobile was the one already in use.
    if (clashes.some((c) => c.email?.toLowerCase() === email.toLowerCase())) {
      throw new ValidationError(
        `${email} is already on a Trugrade account, possibly with another organisation. Invite them with a different email.`,
        { email: 'This email is already registered.' },
      );
    }
    if (clashes.some((c) => c.mobile === mobile)) {
      throw new ValidationError(
        'This mobile number is already on a Trugrade account, possibly with another organisation. Invite them with a different mobile number.',
        { mobile: 'This mobile number is already registered.' },
      );
    }

    const [pending] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.user_invitation
       WHERE org_id = ${orgId}::uuid AND lower(email::text) = lower(${email})
         AND status = 'PENDING' AND expires_at > ${this.clock.now()}
       LIMIT 1`;
    if (pending) {
      throw new ValidationError(
        'An invite for this email is already pending. Revoke it first or resend.',
        { email: 'Pending invite exists.' },
      );
    }

    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(this.clock.nowMs() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    const [inviter] = await this.prisma.$queryRaw<Array<{ full_name: string }>>`
      SELECT full_name FROM identity.user_account WHERE id = ${me.userId}::uuid`;

    const [row] = await this.prisma.$queryRaw<Array<{ id: string; created_at: Date }>>`
      INSERT INTO identity.user_invitation
        (org_id, email, mobile, full_name, role_id, invited_by, token_hash, expires_at, facility_ids)
      SELECT ${orgId}::uuid, ${email}, ${mobile}, ${input.fullName.trim()},
             r.id, ${me.userId}::uuid, ${tokenHash}, ${expiresAt}, ${input.facilityIds}::uuid[]
        FROM identity.role r WHERE r.code = ${input.role}
      RETURNING id, created_at`;
    if (!row) throw new PreconditionFailedError('That invite could not be created.');

    const destination = this.destinationFor(orgType);
    const acceptUrl = `${destination.base}${destination.path}?token=${encodeURIComponent(rawToken)}`;
    const receipt = await this.notifications.send({
      channel: 'EMAIL',
      to: email,
      templateCode: destination.templateCode,
      locale: 'en',
      isTransactional: true,
      variables: {
        inviterName: inviter?.full_name ?? 'Your administrator',
        orgName: org?.legal_name ?? destination.orgFallback,
        roleLabel: ROLE_LABEL[input.role] ?? input.role,
        mfaNote: (MFA_REQUIRED_ROLES as readonly string[]).includes(input.role)
          ? 'Two-factor authentication is required for this role before you can manage money or team access.'
          : '',
        acceptUrl,
        expiresHours: String(INVITE_TTL_HOURS),
      },
    });

    await this.audit.record({
      action: 'account.invite.created',
      entityType: 'user_invitation',
      entityId: row.id,
      after: { email, role: input.role, facilityIds: input.facilityIds },
    });

    const labels = await this.facilityLabels(orgId, input.facilityIds);
    const invite: TeamInviteView = {
      id: row.id,
      email,
      mobile,
      fullName: input.fullName.trim(),
      role: input.role,
      facilityIds: input.facilityIds,
      facilityLabels: input.facilityIds.map((id) => labels.get(id) ?? id.slice(0, 8)),
      status: 'PENDING',
      sentAt: row.created_at.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: INVITE_TTL_HOURS * 60 * 60,
    };
    return { invite, emailSent: receipt.accepted };
  }

  async resendInvite(inviteId: string): Promise<TeamInviteView> {
    this.assertTeamManage();
    const orgId = this.orgId();
    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(this.clock.nowMs() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    const [row] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        email: string | null;
        mobile: string | null;
        full_name: string;
        role_code: string;
        facility_ids: string[];
        created_at: Date;
      }>
    >`
      UPDATE identity.user_invitation i
         SET token_hash = ${tokenHash}, expires_at = ${expiresAt}, status = 'PENDING'
        FROM identity.role r
       WHERE i.id = ${inviteId}::uuid AND i.org_id = ${orgId}::uuid
         AND i.status = 'PENDING' AND r.id = i.role_id
      RETURNING i.id, i.email::text AS email, i.mobile, i.full_name,
                r.code AS role_code, i.facility_ids, i.created_at`;
    if (!row) throw new NotFoundError('invite', { reason: 'not_pending' });

    if (row.email) {
      const [org] = await this.prisma.$queryRaw<
        Array<{ legal_name: string; org_type: InviteOrgType }>
      >`
        SELECT legal_name, org_type::text AS org_type
          FROM identity.organization WHERE id = ${orgId}::uuid`;
      const destination = this.destinationFor(org?.org_type ?? 'VENDOR');
      const acceptUrl = `${destination.base}${destination.path}?token=${encodeURIComponent(rawToken)}`;
      await this.notifications.send({
        channel: 'EMAIL',
        to: row.email,
        templateCode: destination.templateCode,
        locale: 'en',
        isTransactional: true,
        variables: {
          inviterName: 'Your administrator',
          orgName: org?.legal_name ?? destination.orgFallback,
          roleLabel: ROLE_LABEL[row.role_code] ?? row.role_code,
          mfaNote: '',
          acceptUrl,
          expiresHours: String(INVITE_TTL_HOURS),
        },
      });
    }

    await this.audit.record({
      action: 'account.invite.resent',
      entityType: 'user_invitation',
      entityId: inviteId,
    });

    const labels = await this.facilityLabels(orgId, row.facility_ids ?? []);
    return {
      id: row.id,
      email: row.email,
      mobile: row.mobile,
      fullName: row.full_name,
      role: row.role_code,
      facilityIds: row.facility_ids ?? [],
      facilityLabels: (row.facility_ids ?? []).map((id) => labels.get(id) ?? id.slice(0, 8)),
      status: 'PENDING',
      sentAt: row.created_at.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: INVITE_TTL_HOURS * 60 * 60,
    };
  }

  async revokeInvite(inviteId: string): Promise<void> {
    this.assertTeamManage();
    const orgId = this.orgId();
    const updated = await this.prisma.$executeRaw`
      UPDATE identity.user_invitation
         SET status = 'REVOKED'
       WHERE id = ${inviteId}::uuid AND org_id = ${orgId}::uuid AND status = 'PENDING'`;
    if (!updated) throw new NotFoundError('invite', { reason: 'not_pending' });
    await this.audit.record({
      action: 'account.invite.revoked',
      entityType: 'user_invitation',
      entityId: inviteId,
    });
  }

  async previewInvite(token: string): Promise<InvitePreviewView> {
    const tokenHash = hashToken(token);
    const [row] = await this.prisma.$queryRaw<
      Array<{
        full_name: string;
        email: string | null;
        role_code: string;
        status: string;
        expires_at: Date;
        legal_name: string;
        inviter_name: string;
      }>
    >`
      SELECT i.full_name, i.email::text AS email, r.code AS role_code, i.status,
             i.expires_at, o.legal_name, u.full_name AS inviter_name
        FROM identity.user_invitation i
        JOIN identity.role r ON r.id = i.role_id
        JOIN identity.organization o ON o.id = i.org_id
        JOIN identity.user_account u ON u.id = i.invited_by
       WHERE i.token_hash = ${tokenHash}
       LIMIT 1`;
    if (!row) {
      throw new NotFoundError('invite', { reason: 'invalid_token' });
    }
    const expired = row.status !== 'PENDING' || row.expires_at.getTime() <= this.clock.nowMs();
    return {
      fullName: row.full_name,
      email: row.email,
      role: row.role_code,
      roleLabel: ROLE_LABEL[row.role_code] ?? row.role_code,
      orgLegalName: row.legal_name,
      inviterName: row.inviter_name,
      mfaRequired: MFA_REQUIRED_ROLES.includes(row.role_code as Role),
      expired,
      alreadyUsed: row.status === 'ACCEPTED',
    };
  }

  /**
   * Take up an invite.
   *
   * `password` is what a supplier's invitee chooses to sign in with. A buyer's
   * invitee chooses nothing: buyers sign in with a code to the email or mobile
   * on the invite, so the buyer accept page never asks, and a vendor invite
   * that arrives without one is refused rather than left passwordless.
   */
  async acceptInvite(
    token: string,
    password: string | undefined,
    input: { ip?: string; userAgent?: string },
  ): Promise<Awaited<ReturnType<IdentityService['loginWithVerifiedCode']>>> {
    const tokenHash = hashToken(token);
    const now = this.clock.now();

    const [invite] = await this.prisma.$queryRaw<
      Array<{
        id: string;
        org_id: string;
        org_type: InviteOrgType;
        email: string | null;
        mobile: string | null;
        full_name: string;
        role_id: string;
        role_code: string;
        facility_ids: string[];
        status: string;
        expires_at: Date;
      }>
    >`
      SELECT i.id, i.org_id, o.org_type::text AS org_type, i.email::text AS email, i.mobile,
             i.full_name, i.role_id, r.code AS role_code, i.facility_ids, i.status, i.expires_at
        FROM identity.user_invitation i
        JOIN identity.role r ON r.id = i.role_id
        JOIN identity.organization o ON o.id = i.org_id
       WHERE i.token_hash = ${tokenHash}
       LIMIT 1`;
    if (!invite || invite.status !== 'PENDING') {
      throw new NotFoundError('invite', { reason: 'invalid_or_used' });
    }
    if (password === undefined && invite.org_type !== 'BUYER') {
      throw new ValidationError('Choose a password to finish joining.', {
        password: 'A password is required for this account.',
      });
    }
    if (invite.expires_at.getTime() <= now.getTime()) {
      await this.prisma.$executeRaw`
        UPDATE identity.user_invitation SET status = 'EXPIRED' WHERE id = ${invite.id}::uuid`;
      throw new PreconditionFailedError(
        'This invite link expired. Ask your account owner to send a new one.',
        { reason: 'invite_expired' },
      );
    }

    const email = invite.email;
    const mobile = invite.mobile;
    if (!email || !mobile) {
      throw new PreconditionFailedError('This invite is missing contact details.');
    }

    // A passwordless invitee has just proved the mailbox by opening the link in
    // it, and that email is one of the two things they will sign in with.
    const emailVerifiedAt = password === undefined ? now : null;

    const userId = await this.prisma.runInTransaction(async () => {
      const [user] = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO identity.user_account
          (org_id, full_name, email, mobile, status, is_org_owner, email_verified_at)
        VALUES (${invite.org_id}::uuid, ${invite.full_name}, ${email}, ${mobile},
                'ACTIVE', ${invite.role_code === 'VENDOR_OWNER'}, ${emailVerifiedAt})
        RETURNING id`;
      if (!user) throw new PreconditionFailedError('Your account could not be created.');

      await this.prisma.$executeRaw`
        INSERT INTO identity.user_role (user_id, role_id, org_id, granted_at)
        VALUES (${user.id}::uuid, ${invite.role_id}::uuid, ${invite.org_id}::uuid, ${now})`;

      if (invite.facility_ids?.length) {
        for (const facilityId of invite.facility_ids) {
          await this.prisma.$executeRaw`
            INSERT INTO identity.user_facility (user_id, facility_id, org_id)
            VALUES (${user.id}::uuid, ${facilityId}::uuid, ${invite.org_id}::uuid)`;
        }
      }

      if (password !== undefined) {
        await this.passwords.setPassword(user.id, password, {
          email,
          mobile,
          fullName: invite.full_name,
          rotationDays: MFA_REQUIRED_ROLES.includes(invite.role_code as Role) ? 180 : null,
        });
      }

      await this.prisma.$executeRaw`
        UPDATE identity.user_invitation
           SET status = 'ACCEPTED', accepted_at = ${now}, accepted_user_id = ${user.id}::uuid
         WHERE id = ${invite.id}::uuid AND status = 'PENDING'`;

      await this.audit.record({
        action: 'account.invite.accepted',
        entityType: 'user_invitation',
        entityId: invite.id,
        after: { userId: user.id, role: invite.role_code },
        actorUserId: user.id,
        actorOrgId: invite.org_id,
      });

      return user.id;
    });

    return this.identity.loginWithVerifiedCode({
      userId,
      identifier: email,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  private destinationFor(orgType: InviteOrgType): ReturnType<typeof inviteDestination> {
    return inviteDestination(orgType, {
      storefront: this.config.get('STOREFRONT_URL'),
      console: this.config.get('CONSOLE_URL'),
    });
  }

  async assertFacilitiesOwned(orgId: string, facilityIds: readonly string[]): Promise<void> {
    if (facilityIds.length === 0) return;
    const unique = [...new Set(facilityIds)];
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM vendor.vendor_facility
       WHERE org_id = ${orgId}::uuid AND id = ANY(${unique}::uuid[])`;
    if (rows.length !== unique.length) {
      throw new ForbiddenError('One or more facilities do not belong to your organisation.', {
        reason: 'cross_org_facility',
      });
    }
  }

  async replaceMemberFacilities(
    userId: string,
    orgId: string,
    facilityIds: readonly string[],
  ): Promise<void> {
    await this.assertFacilitiesOwned(orgId, facilityIds);
    await this.prisma.$executeRaw`
      DELETE FROM identity.user_facility
       WHERE user_id = ${userId}::uuid AND org_id = ${orgId}::uuid`;
    for (const facilityId of facilityIds) {
      await this.prisma.$executeRaw`
        INSERT INTO identity.user_facility (user_id, facility_id, org_id)
        VALUES (${userId}::uuid, ${facilityId}::uuid, ${orgId}::uuid)`;
    }
  }

  async memberFacilityIds(userId: string, orgId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ facility_id: string }>>`
      SELECT facility_id::text AS facility_id
        FROM identity.user_facility
       WHERE user_id = ${userId}::uuid AND org_id = ${orgId}::uuid`;
    return rows.map((r) => r.facility_id);
  }

  private async facilityLabels(
    orgId: string,
    facilityIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (facilityIds.length === 0) return new Map();
    const unique = [...new Set(facilityIds)];
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; label: string | null; city: string }>
    >`
      SELECT f.id::text AS id, a.label, a.city
        FROM vendor.vendor_facility f
        JOIN identity.org_address a ON a.id = f.address_id
       WHERE f.org_id = ${orgId}::uuid AND f.id = ANY(${unique}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.label?.trim() || r.city]));
  }

  async listOrgFacilities(): Promise<Array<{ id: string; label: string }>> {
    const orgId = this.orgId();
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; label: string | null; city: string }>
    >`
      SELECT f.id::text AS id, a.label, a.city
        FROM vendor.vendor_facility f
        JOIN identity.org_address a ON a.id = f.address_id
       WHERE f.org_id = ${orgId}::uuid
       ORDER BY a.label NULLS LAST, a.city`;
    return rows.map((r) => ({ id: r.id, label: r.label?.trim() || r.city }));
  }
}
