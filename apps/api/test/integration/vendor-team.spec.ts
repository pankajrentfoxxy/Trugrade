/**
 * Vendor team management — last-owner rule, cross-org facilities, facility-scoped POs.
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
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { EventBusModule } from '../../src/shared/events/event-bus';
import { RedisModule } from '../../src/shared/redis/redis.service';
import { AccountService } from '../../src/modules/identity/internal/account.service';
import { TeamInviteService } from '../../src/modules/identity/internal/team-invite.service';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { AuditService } from '../../src/modules/identity/internal/audit.service';
import { PasswordService } from '../../src/modules/identity/internal/password.service';
import { PurchaseOrderRepository } from '../../src/modules/procurement/internal/purchase-order.repository';
import { ProcurementModule } from '../../src/modules/procurement';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeOrganization, makeUser } from '../support/factories';

const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');

let moduleRef: TestingModule;
let account: AccountService;
let invites: TeamInviteService;
let poRepo: PurchaseOrderRepository;
let ctx: RequestContextService;
let db: PrismaClient;

let orgId: string;
let ownerId: string;
let facilityA: string;
let facilityB: string;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);

  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ContextModule,
      RedisModule,
      EventBusModule,
      AuthModule,
      AdaptersModule,
      ProcurementModule,
    ],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(NOW) },
      {
        provide: PrismaService,
        useFactory: (config) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      AuditService,
      PasswordService,
      IdentityService,
      TeamInviteService,
      AccountService,
    ],
  }).compile();

  account = moduleRef.get(AccountService);
  invites = moduleRef.get(TeamInviteService);
  poRepo = moduleRef.get(PurchaseOrderRepository);
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
  orgId = await makeOrganization({ org_type: 'VENDOR', legal_name: 'Team Test Vendor' }, db);
  ownerId = await makeUser(orgId, { full_name: 'Vendor Owner' }, db);
  await grant(ownerId, 'VENDOR_OWNER');
  const addrA = await makeAddress(orgId, { city: 'Gurugram' }, db);
  const addrB = await makeAddress(orgId, { city: 'Noida', state_code: '09' }, db);
  facilityA = await makeFacility(orgId, addrA);
  facilityB = await makeFacility(orgId, addrB);
});

async function grant(userId: string, role: Role): Promise<void> {
  await db.$executeRaw`
    INSERT INTO identity.user_role (user_id, role_id, org_id)
    SELECT ${userId}::uuid, r.id, ${orgId}::uuid FROM identity.role r WHERE r.code = ${role}
    ON CONFLICT DO NOTHING`;
}

async function makeFacility(org: string, addressId: string): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO vendor.vendor_facility (id, org_id, address_id, facility_type)
    VALUES (${id}::uuid, ${org}::uuid, ${addressId}::uuid, 'WAREHOUSE')`;
  return id;
}

function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  const principal: Principal = {
    userId: ownerId,
    orgId,
    orgType: 'VENDOR',
    roles: ['VENDOR_OWNER'],
    permissions: permissionsFor(['VENDOR_OWNER']),
    sessionId: 's',
    mfaSatisfied: true,
  };
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(principal);
    return fn();
  });
}

function asWarehouse<T>(userId: string, facilityIds: string[], fn: () => Promise<T>): Promise<T> {
  const principal: Principal = {
    userId,
    orgId,
    orgType: 'VENDOR',
    roles: ['VENDOR_VIEWER'],
    permissions: permissionsFor(['VENDOR_VIEWER']),
    sessionId: 's',
    mfaSatisfied: true,
  };
  return ctx.run({ requestId: randomUUID() }, async () => {
    ctx.setPrincipal(principal);
    for (const fid of facilityIds) {
      await db.$executeRaw`
        INSERT INTO identity.user_facility (user_id, facility_id, org_id)
        VALUES (${userId}::uuid, ${fid}::uuid, ${orgId}::uuid)`;
    }
    return fn();
  });
}

function asUser<T>(userId: string, roles: Role[], fn: () => Promise<T>): Promise<T> {
  const principal: Principal = {
    userId,
    orgId,
    orgType: 'VENDOR',
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

describe('vendor team rules', () => {
  it('REFUSES to demote the last owner', async () => {
    await expect(
      asOwner(() => account.updateMember(ownerId, { roles: ['VENDOR_ADMIN'] })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', detail: { reason: 'self_role_change' } });

    const second = await makeUser(orgId, { full_name: 'Co Owner' }, db);
    await grant(second, 'VENDOR_OWNER');
    await asUser(second, ['VENDOR_OWNER'], () =>
      account.updateMember(ownerId, { roles: ['VENDOR_ADMIN'] }),
    );

    await expect(
      asUser(ownerId, ['VENDOR_OWNER'], () =>
        account.updateMember(second, { roles: ['VENDOR_ADMIN'] }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', detail: { reason: 'last_owner' } });
  });

  it('names the mobile, not the email, when the mobile is the one already on an account', async () => {
    const buyerOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Elsewhere' }, db);
    const taken = await makeUser(buyerOrg, { email: 'someone@elsewhere.in' }, db);
    await db.$executeRaw`UPDATE identity.user_account SET mobile = '+919535312310' WHERE id = ${taken}::uuid`;

    await expect(
      asOwner(() =>
        invites.createInvite({
          email: 'brand.new@alpha.in',
          fullName: 'Raj Shukla',
          mobile: '+919535312310',
          role: 'VENDOR_VIEWER',
          facilityIds: [],
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /This mobile number is already on a Trugrade account/,
      ) as unknown,
      code: 'VALIDATION_FAILED',
      fields: { mobile: 'This mobile number is already registered.' },
    });
  });

  it('still names the email when the email is the one already on an account', async () => {
    const buyerOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Elsewhere' }, db);
    await makeUser(buyerOrg, { email: 'taken@elsewhere.in' }, db);

    await expect(
      asOwner(() =>
        invites.createInvite({
          email: 'taken@elsewhere.in',
          fullName: 'Raj Shukla',
          mobile: '+919812345670',
          role: 'VENDOR_VIEWER',
          facilityIds: [],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { email: 'This email is already registered.' },
    });
  });

  it('REFUSES a facility id from another org', async () => {
    const otherOrg = await makeOrganization({ org_type: 'VENDOR', legal_name: 'Other' }, db);
    const otherAddr = await makeAddress(otherOrg, {}, db);
    const otherFacility = await makeFacility(otherOrg, otherAddr);
    await expect(
      asOwner(() =>
        invites.createInvite({
          email: 'wh@test.com',
          fullName: 'Warehouse User',
          mobile: '+919876543211',
          role: 'VENDOR_VIEWER',
          facilityIds: [otherFacility],
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks a facility-scoped warehouse user from another facility PO', async () => {
    const whId = await makeUser(orgId, { full_name: 'WH Staff' }, db);
    await grant(whId, 'VENDOR_VIEWER');
    const buyerOrg = await makeOrganization({ org_type: 'BUYER', legal_name: 'Buyer Co' }, db);
    const buyerUser = await makeUser(buyerOrg, { full_name: 'Buyer User' }, db);
    const buyerAddr = await makeAddress(buyerOrg, {}, db);
    const gstProfileId = randomUUID();
    await db.$executeRaw`
      INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                   status, api_verified_at, is_primary)
      VALUES (${gstProfileId}::uuid, ${buyerOrg}::uuid, '07AABCR9603R1ZX',
              'Buyer Co', '07', 'ACTIVE', ${NOW}, TRUE)`;
    const orderA = randomUUID();
    const orderB = randomUUID();
    await db.$executeRaw`
      INSERT INTO ordering."order"
        (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
         billing_address_id, shipping_address_id, subtotal, gst_total, grand_total, status)
      VALUES
        (${orderA}::uuid, 'T-PO-A', ${buyerOrg}::uuid, ${buyerUser}::uuid,
         ${gstProfileId}::uuid, ${buyerAddr}::uuid, ${buyerAddr}::uuid,
         1000.00, 180.00, 1180.00, 'CONFIRMED'::order_status),
        (${orderB}::uuid, 'T-PO-B', ${buyerOrg}::uuid, ${buyerUser}::uuid,
         ${gstProfileId}::uuid, ${buyerAddr}::uuid, ${buyerAddr}::uuid,
         2000.00, 360.00, 2360.00, 'CONFIRMED'::order_status)`;
    const poA = randomUUID();
    const poB = randomUUID();
    await db.$executeRaw`
      INSERT INTO procurement.purchase_order
        (id, po_number, vendor_org_id, order_id, status, total_net, tds_rate_pct, tds_amount,
         valuation_method, terms_days, fulfillment_facility_id)
      VALUES
        (${poA}::uuid, 'PO-A', ${orgId}::uuid, ${orderA}::uuid, 'RAISED', 1000, 0, 0, 'REGULAR', 15, ${facilityA}::uuid),
        (${poB}::uuid, 'PO-B', ${orgId}::uuid, ${orderB}::uuid, 'RAISED', 2000, 0, 0, 'REGULAR', 15, ${facilityB}::uuid)`;

    await asWarehouse(whId, [facilityA], async () => {
      const list = await poRepo.list({}, { page: 1, pageSize: 20 });
      expect(list.rows.map((r) => r.po_number)).toEqual(['PO-A']);
      expect(await poRepo.findOne(poB)).toBeNull();
    });
  });
});
