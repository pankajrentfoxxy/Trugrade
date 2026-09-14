/**
 * `GET /vendor/facilities` — the pickup-location picker the create-listing
 * dialog and the wizard's step 2 both depend on.
 *
 * Worth a real database for one reason: the bug this file exists to catch was
 * a raw SQL column reference — `listing.unit.pickup_location_id`, which does
 * not exist; the column lives on `listing.listing` — and nothing about the
 * TypeScript around that query is wrong. It compiled, it typechecked, and it
 * 500'd on every call. A vendor could never see a facility to pick, which
 * meant a vendor could never create a listing at all. No mock of `PrismaService`
 * would have caught this; only running the actual SQL against the actual
 * schema does.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
import { VendorController } from '../../src/modules/vendor/vendor.controller';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeCatalog, makeListing, makeOrganization, makeUnit } from '../support/factories';

let moduleRef: TestingModule;
let controller: VendorController;
let ctx: RequestContextService;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(new Date('2026-09-14T06:00:00.000Z')) },
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
      VendorController,
    ],
  }).compile();

  controller = moduleRef.get(VendorController);
  ctx = moduleRef.get(RequestContextService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
});

function principal(orgId: string): Principal {
  const roles: Role[] = ['VENDOR_OWNER'];
  return {
    userId: randomUUID(),
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-facilities',
    mfaSatisfied: true,
  } as Principal;
}

const as = <T,>(orgId: string, fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 'test-facilities' }, () => {
    ctx.setPrincipal(principal(orgId));
    return fn();
  });

describe('GET /vendor/facilities', () => {
  it('answers at all, rather than 500ing on a raw-SQL column that does not exist', async () => {
    const vendorOrgId = await makeOrganization({}, raw);
    const pickupAddressId = await makeAddress(vendorOrgId, {}, raw);

    await expect(as(vendorOrgId, () => controller.facilities())).resolves.not.toThrow();
    const rows = await as(vendorOrgId, () => controller.facilities());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.addressId).toBe(pickupAddressId);
  });

  it('counts units held at each facility through the listing, not off the unit itself', async () => {
    const vendorOrgId = await makeOrganization({}, raw);
    const pickupAddressId = await makeAddress(vendorOrgId, {}, raw);
    const catalog = await makeCatalog({}, raw);
    const listingId = await makeListing(
      { vendorOrgId, skuId: catalog.skuId, pickupAddressId },
      raw,
    );
    // Two units on the listing at this facility, one already DELIVERED — the
    // count is of stock still with the vendor, not of everything ever listed.
    await makeUnit({ listingId, vendorOrgId, skuId: catalog.skuId }, raw);
    await makeUnit({ listingId, vendorOrgId, skuId: catalog.skuId, status: 'DELIVERED' }, raw);

    const [row] = await as(vendorOrgId, () => controller.facilities());
    expect(row!.unitsHeld).toBe(1);
  });

  it('never counts another vendor’s units against this one’s facility', async () => {
    const vendorOrgId = await makeOrganization({}, raw);
    const otherVendorOrgId = await makeOrganization({}, raw);
    const pickupAddressId = await makeAddress(vendorOrgId, {}, raw);
    const catalog = await makeCatalog({}, raw);

    // A listing on the SAME address row would be a data-modelling mistake, not
    // a scoping one — org scope on the unit's own vendor_org_id is what the
    // fix must hold regardless, so exercise it with the other vendor's own
    // address and listing instead.
    const otherAddressId = await makeAddress(otherVendorOrgId, {}, raw);
    const otherListingId = await makeListing(
      { vendorOrgId: otherVendorOrgId, skuId: catalog.skuId, pickupAddressId: otherAddressId },
      raw,
    );
    await makeUnit({ listingId: otherListingId, vendorOrgId: otherVendorOrgId, skuId: catalog.skuId }, raw);

    const rows = await as(vendorOrgId, () => controller.facilities());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.addressId).toBe(pickupAddressId);
    expect(rows[0]!.unitsHeld).toBe(0);
  });
});
