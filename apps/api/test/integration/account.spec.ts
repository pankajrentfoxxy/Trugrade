/**
 * The buying organisation's addresses and its people — T25.
 *
 * Four things here are only provable against a real database, and each of them
 * is a *forbidden thing attempted*, never a guard asserted:
 *
 *   1. **Another organisation's address and another organisation's staff.** The
 *      routes take no org parameter, so a leak can only come from a missing
 *      `WHERE`. Every test seeds a neighbouring buyer with MORE rows, so a
 *      dropped predicate shows up as a bigger list rather than as a pass.
 *   2. **The last account owner.** The refusal is a live `COUNT` over
 *      `user_role`, and the only way to test it is to have exactly one owner and
 *      try to take the role away.
 *   3. **Privilege escalation by role assignment.** An admin who cannot approve
 *      orders tries to make somebody an approver, and is refused — the check is
 *      against `ROLE_PERMISSIONS`, and a mock would agree with whatever it was
 *      told.
 *   4. **A billing address edited through the delivery-site route.** The
 *      response says `editable: false`; the test ignores that and PATCHes it
 *      anyway, which is what a client that has been tampered with would do.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  OrgScope,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { RedisModule } from '../../src/shared/redis/redis.service';
import { AccountService } from '../../src/modules/identity/internal/account.service';
import { AuditService } from '../../src/modules/identity/internal/audit.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, makeUser } from '../support/factories';

const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');

const SITE = {
  label: 'Gurugram office',
  line1: 'Tower B, 4th floor, DLF Cyber City',
  city: 'Gurugram',
  state: 'Haryana',
  stateCode: '06',
  pincode: '122002',
  contactName: 'Ravi Menon',
  contactMobile: '+919812345678',
};

let moduleRef: TestingModule;
let account: AccountService;
let ctx: RequestContextService;
let db: PrismaClient;

let orgId: string;
let ownerId: string;
let adminId: string;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule, RedisModule, AuthModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(NOW) },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      OrgScope,
      AuditService,
      AccountService,
    ],
  }).compile();

  account = moduleRef.get(AccountService);
  ctx = moduleRef.get(RequestContextService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedTestReference(db);
  orgId = await makeOrganization({ org_type: 'BUYER', legal_name: 'Acme Retail Pvt Ltd' }, db);
  ownerId = await makeUser(orgId, { full_name: 'Deepak Verma' }, db);
  adminId = await makeUser(orgId, { full_name: 'Farah Khan' }, db);
  await grant(ownerId, 'CUSTOMER_OWNER');
  await grant(adminId, 'CUSTOMER_ADMIN');
});

async function grant(userId: string, role: Role): Promise<void> {
  await db.$executeRaw`
    INSERT INTO identity.user_role (user_id, role_id, org_id)
    SELECT ${userId}::uuid, r.id, ${orgId}::uuid FROM identity.role r WHERE r.code = ${role}
    ON CONFLICT DO NOTHING`;
}

function as<T>(userId: string, roles: Role[], fn: () => Promise<T>, org = orgId): Promise<T> {
  const principal: Principal = {
    userId,
    orgId: org,
    orgType: 'BUYER',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  };
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(principal);
    return fn();
  });
}

const asOwner = <T>(fn: () => Promise<T>): Promise<T> => as(ownerId, ['CUSTOMER_OWNER'], fn);

/* ==========================================================================
 * Addresses
 * ======================================================================== */

describe('the delivery sites an organisation holds', () => {
  it('creates the first one as the default, and does not show another org theirs', async () => {
    // A neighbour with strictly more sites, so a dropped `WHERE` grows the list.
    const otherOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Beta Ltd' }, db);
    const otherUser = await makeUser(otherOrg, {}, db);
    await as(otherUser, ['CUSTOMER_OWNER'], () => account.addAddress({ ...SITE, label: 'Beta A' }), otherOrg);
    await as(otherUser, ['CUSTOMER_OWNER'], () => account.addAddress({ ...SITE, label: 'Beta B' }), otherOrg);

    const first = await asOwner(() => account.addAddress(SITE));
    // Not because the form said so — because an organisation with sites and no
    // default gives checkout nothing to pre-select.
    expect(first.isDefault).toBe(true);
    expect(first.receivingHours).toBeNull();

    const book = await asOwner(() => account.addresses());
    expect(book.delivery.map((a) => a.label)).toEqual(['Gurugram office']);
    expect(book.delivery).toHaveLength(1);
  });

  it('promoting a site demotes the one that was default, leaving exactly one', async () => {
    await asOwner(() => account.addAddress(SITE));
    const second = await asOwner(() =>
      account.addAddress({ ...SITE, label: 'Noida warehouse', city: 'Noida', stateCode: '09' }),
    );
    expect(second.isDefault).toBe(false);

    await asOwner(() => account.updateAddress(second.id, { isDefault: true }));
    const book = await asOwner(() => account.addresses());
    expect(book.delivery.filter((a) => a.isDefault).map((a) => a.label)).toEqual([
      'Noida warehouse',
    ]);
  });

  it('REFUSES to retire the only delivery site, because checkout needs one', async () => {
    const only = await asOwner(() => account.addAddress(SITE));
    await expect(asOwner(() => account.updateAddress(only.id, { isActive: false }))).rejects.toMatchObject(
      { code: 'PRECONDITION_FAILED' },
    );
    const [row] = await db.$queryRaw<Array<{ is_active: boolean }>>`
      SELECT is_active FROM identity.org_address WHERE id = ${only.id}::uuid`;
    expect(row!.is_active).toBe(true);
  });

  it('REFUSES to edit a billing address through the delivery-site route', async () => {
    const billingId = randomUUID();
    await db.$executeRaw`
      INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                        contact_name, contact_mobile, is_billing_enabled)
      VALUES (${billingId}::uuid, ${orgId}::uuid, 'BILLING'::address_type, 'Registered office',
              'Gurugram', 'Haryana', '06', '122002', 'Deepak Verma', '+919812345678', TRUE)`;

    const book = await asOwner(() => account.addresses());
    expect(book.billing[0]!.editable).toBe(false);
    expect(book.billing[0]!.lockedReason).toContain('GST registration');

    // Ignore what the response said and try anyway.
    await expect(
      asOwner(() => account.updateAddress(billingId, { city: 'Chennai', stateCode: '33' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [row] = await db.$queryRaw<Array<{ city: string; state_code: string }>>`
      SELECT city, state_code FROM identity.org_address WHERE id = ${billingId}::uuid`;
    // A wrong state code on a billing address is a wrong GST jurisdiction on an
    // invoice, so the assertion is on the stored value, not on the refusal.
    expect(row).toMatchObject({ city: 'Gurugram', state_code: '06' });
  });

  it('REFUSES another organisation site by id, without saying whether it exists', async () => {
    const otherOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Beta Ltd' }, db);
    const otherUser = await makeUser(otherOrg, {}, db);
    const theirs = await as(otherUser, ['CUSTOMER_OWNER'], () => account.addAddress(SITE), otherOrg);

    await expect(
      asOwner(() => account.updateAddress(theirs.id, { label: 'Mine now' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db.$queryRaw<Array<{ label: string }>>`
      SELECT label FROM identity.org_address WHERE id = ${theirs.id}::uuid`;
    expect(row!.label).toBe('Gurugram office');
  });
});

/* ==========================================================================
 * Team
 * ======================================================================== */

describe('the people in the organisation', () => {
  it('lists this org only, with roles read from the database', async () => {
    const otherOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Beta Ltd' }, db);
    await makeUser(otherOrg, { full_name: 'Somebody Else' }, db);
    await makeUser(otherOrg, { full_name: 'Another Person' }, db);

    const team = await asOwner(() => account.team());
    expect(team.members.map((m) => m.fullName).sort()).toEqual(['Deepak Verma', 'Farah Khan']);
    expect(team.owners).toBe(1);
    expect(team.members.find((m) => m.isYou)?.fullName).toBe('Deepak Verma');
    // Never signed in is null, and stays null. A date here would be invented.
    expect(team.members.every((m) => m.lastLoginAt === null)).toBe(true);

    const approver = team.roles.find((r) => r.code === 'CUSTOMER_APPROVER');
    expect(approver!.permissions).toContain('ordering.order.approve');
  });

  it('makes somebody an approver, and the grant is a real row', async () => {
    const updated = await asOwner(() =>
      account.updateMember(adminId, { roles: ['CUSTOMER_ADMIN', 'CUSTOMER_APPROVER'] }),
    );
    expect(updated.roles.sort()).toEqual(['CUSTOMER_ADMIN', 'CUSTOMER_APPROVER']);
    const rows = await db.$queryRaw<Array<{ code: string }>>`
      SELECT r.code FROM identity.user_role ur JOIN identity.role r ON r.id = ur.role_id
       WHERE ur.user_id = ${adminId}::uuid ORDER BY r.code`;
    expect(rows.map((r) => r.code)).toEqual(['CUSTOMER_ADMIN', 'CUSTOMER_APPROVER']);
  });

  it('REFUSES to remove the last account owner', async () => {
    await expect(
      asOwner(() => account.updateMember(ownerId, { roles: ['CUSTOMER_VIEWER'] })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', detail: { reason: 'self_role_change' } });

    // And through another owner's hands, once there are two and one goes away.
    const second = await makeUser(orgId, { full_name: 'Nita Rao' }, db);
    await grant(second, 'CUSTOMER_OWNER');
    await as(second, ['CUSTOMER_OWNER'], () =>
      account.updateMember(ownerId, { roles: ['CUSTOMER_VIEWER'] }),
    );

    await expect(
      as(ownerId, ['CUSTOMER_OWNER'], () =>
        account.updateMember(second, { roles: ['CUSTOMER_VIEWER'] }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', detail: { reason: 'last_owner' } });

    const rows = await db.$queryRaw<Array<{ code: string }>>`
      SELECT r.code FROM identity.user_role ur JOIN identity.role r ON r.id = ur.role_id
       WHERE ur.user_id = ${second}::uuid`;
    expect(rows.map((r) => r.code)).toEqual(['CUSTOMER_OWNER']);
  });

  it('REFUSES to grant a role that outruns the granter, so nobody escalates', async () => {
    // An admin holds no `ordering.order.approve`. Making somebody an approver
    // would grant a power the granter does not have.
    await expect(
      as(adminId, ['CUSTOMER_ADMIN'], () =>
        account.updateMember(ownerId, { roles: ['CUSTOMER_APPROVER'] }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', detail: { reason: 'role_exceeds_granter' } });

    const rows = await db.$queryRaw<Array<{ code: string }>>`
      SELECT r.code FROM identity.user_role ur JOIN identity.role r ON r.id = ur.role_id
       WHERE ur.user_id = ${ownerId}::uuid`;
    expect(rows.map((r) => r.code)).toEqual(['CUSTOMER_OWNER']);

    // The screen is told before it tries, too.
    const team = await as(adminId, ['CUSTOMER_ADMIN'], () => account.team());
    expect(team.roles.find((r) => r.code === 'CUSTOMER_APPROVER')!.assignable).toBe(false);
  });

  it('REFUSES to change your own access, because that is how an org locks itself out', async () => {
    await expect(
      as(adminId, ['CUSTOMER_ADMIN'], () =>
        account.updateMember(adminId, { status: 'SUSPENDED' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [row] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM identity.user_account WHERE id = ${adminId}::uuid`;
    expect(row!.status).toBe('ACTIVE');
  });

  it('deactivating suspends the account and kills the live sessions with it', async () => {
    const sessionId = randomUUID();
    await db.$executeRaw`
      INSERT INTO identity.session (id, user_id, refresh_token_hash, token_family_id, expires_at)
      VALUES (${sessionId}::uuid, ${adminId}::uuid, ${randomUUID()}, ${randomUUID()}::uuid,
              now() + interval '30 days')`;

    const updated = await asOwner(() => account.updateMember(adminId, { status: 'SUSPENDED' }));
    expect(updated.status).toBe('SUSPENDED');

    // Nothing is deleted — the orders they raised still name them.
    const [user] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM identity.user_account WHERE id = ${adminId}::uuid`;
    expect(user!.status).toBe('SUSPENDED');

    // A deactivation that leaves a live refresh token behind has deactivated nobody.
    const [session] = await db.$queryRaw<Array<{ revoked_at: Date | null }>>`
      SELECT revoked_at FROM identity.session WHERE id = ${sessionId}::uuid`;
    expect(session!.revoked_at).not.toBeNull();
  });

  it('REFUSES to touch somebody in another organisation', async () => {
    const otherOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Beta Ltd' }, db);
    const theirs = await makeUser(otherOrg, { full_name: 'Somebody Else' }, db);

    await expect(
      asOwner(() => account.updateMember(theirs, { status: 'SUSPENDED' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM identity.user_account WHERE id = ${theirs}::uuid`;
    expect(row!.status).toBe('ACTIVE');
  });
});
