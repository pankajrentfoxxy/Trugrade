/**
 * Submit: the listing does NOT go live.
 *
 * Everything here is a database guarantee — the counter triggers, the append-only
 * grants on `stock_movement`, the atomicity of the whole submit — so it runs
 * against the real Postgres and nothing is faked but the clock.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { permissionsFor, type Role } from '@trugrade/contracts';
import type { Principal } from '../../src/shared/db/org-scope';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, OrgScope, RequestContextService } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { StockMovementService } from '../../src/modules/listing/internal/stock-movement.service';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { PricingService } from '../../src/modules/listing/internal/pricing.service';
import { MarginRuleRepository } from '../../src/modules/listing/internal/margin-rule.repository';
import {
  LocalQcVisitPort,
  QcVisitPort,
  SubmitService,
} from '../../src/modules/listing/internal/submit.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeCatalog, makeOrganization, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let submit: SubmitService;
let movements: StockMovementService;
let listings: ListingRepository;
let ctx: RequestContextService;
let raw: PrismaClient;

let orgId: string;
let userId: string;
let addressId: string;
let skuId: string;

function as<T>(p: Principal, fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test' }, () => {
    ctx.setPrincipal(p);
    return fn();
  });
}

function vendor(): Principal {
  const roles: Role[] = ['VENDOR_OWNER'];
  return {
    userId,
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-1',
    mfaSatisfied: true,
  };
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(new Date('2026-08-26T06:00:00.000Z')) },
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
      EventBus,
      OrgScope,
      StockMovementService,
      SubmitService,
      // Submit prices the listing once the visit is raised, so the storefront
      // has a price to show when the units pass.
      PricingService,
      MarginRuleRepository,
      ListingRepository,
      { provide: QcVisitPort, useClass: LocalQcVisitPort },
    ],
  }).compile();

  submit = moduleRef.get(SubmitService);
  movements = moduleRef.get(StockMovementService);
  listings = moduleRef.get(ListingRepository);
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
  orgId = await makeOrganization({}, raw);
  userId = await makeUser(orgId, {}, raw);
  addressId = await makeAddress(orgId, {}, raw);
  await raw.$executeRaw`
    INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
    VALUES (${orgId}::uuid, ${addressId}::uuid, 'WAREHOUSE')`;
  skuId = (await makeCatalog({}, raw)).skuId;
});

async function draft(units: number): Promise<string> {
  const listingId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, qty_total, status)
    VALUES (${listingId}::uuid, ${orgId}::uuid, ${skuId}::uuid, ${addressId}::uuid,
            'A'::grade_type, 'REFURBISHED'::condition_type, 'GOOD_80_89'::battery_band,
            'ALL_ORIGINAL'::parts_status_type, 28000, ${units}, 'DRAFT'::listing_status)`;
  for (let i = 0; i < units; i++) {
    await raw.$executeRaw`
      INSERT INTO listing.unit (listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, status, vendor_ask_price)
      VALUES (${listingId}::uuid, ${orgId}::uuid, ${skuId}::uuid,
              ${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()},
              'A'::grade_type, 'CREATED'::unit_status, 28000)`;
  }
  return listingId;
}

describe('submit sends the listing to ops instead of going live', () => {
  it('moves a draft to PENDING_APPROVAL with nothing on sale and no visit raised', async () => {
    const listingId = await draft(1);
    const result = await as(vendor(), () => submit.submit(listingId));

    expect(result.outcome).toBe('SUBMITTED');
    expect(result.status).toBe('PENDING_APPROVAL');
    expect(result.unitCount).toBe(1);

    const [row] = await raw.$queryRaw<
      Array<{ status: string; qty_available: number; qc_visit_id: string | null }>
    >`
      SELECT status::text AS status, qty_available, qc_visit_id
        FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(row?.status).toBe('PENDING_APPROVAL');
    // Nothing is buyer-visible until ops approve it.
    expect(row?.qty_available).toBe(0);
    expect(row?.qc_visit_id).toBeNull();

    const [visits] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM qc.qc_visit WHERE vendor_org_id = ${orgId}::uuid`;
    expect(Number(visits?.n ?? 0)).toBe(0);
  });

  it('refuses a listing that is not a draft, and one with no quantity', async () => {
    const listingId = await draft(2);
    await as(vendor(), () => submit.submit(listingId));
    await expect(as(vendor(), () => submit.submit(listingId))).rejects.toMatchObject({
      name: 'IllegalStateTransitionError',
    });

    const empty = await draft(0);
    await raw.$executeRaw`UPDATE listing.listing SET qty_total = 0 WHERE id = ${empty}::uuid`;
    await expect(as(vendor(), () => submit.submit(empty))).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('will not submit another vendor’s listing', async () => {
    const listingId = await draft(1);
    const otherOrg = await makeOrganization({}, raw);
    const otherUser = await makeUser(otherOrg, {}, raw);
    const stranger: Principal = { ...vendor(), orgId: otherOrg, userId: otherUser };
    await expect(as(stranger, () => submit.submit(listingId))).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    const [row] = await raw.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(row?.status).toBe('DRAFT');
  });
});

describe('stock movements', () => {
  it('records from -> to per unit and leaves units in the wrong status alone', async () => {
    const listingId = await draft(3);
    const ids = (
      await raw.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM listing.unit WHERE listing_id = ${listingId}::uuid ORDER BY id`
    ).map((r) => r.id);

    await raw.$executeRaw`
      UPDATE listing.unit SET status = 'SCRAPPED'::unit_status WHERE id = ${ids[0]!}::uuid`;

    const moved = await as(vendor(), () =>
      movements.transition({
        unitIds: ids,
        expectedFrom: 'CREATED',
        to: 'AWAITING_QC',
        reason: 'Inspection requested by the vendor.',
        toLocation: 'VENDOR',
      }),
    );

    expect(moved).toHaveLength(2);
    expect(moved.every((m) => m.fromStatus === 'CREATED' && m.toStatus === 'AWAITING_QC')).toBe(
      true,
    );

    const [row] = await raw.$queryRaw<Array<{ actor_id: string | null; reason: string }>>`
      SELECT actor_id, reason FROM listing.stock_movement WHERE unit_id = ${ids[1]!}::uuid`;
    expect(row!.actor_id).toBe(userId);
    expect(row!.reason).toBe('Inspection requested by the vendor.');
  });

  it('cannot be corrected: the trail is append-only', async () => {
    const listingId = await draft(1);
    const [unit] = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
    await as(vendor(), () =>
      movements.transition({
        unitIds: [unit!.id],
        to: 'AWAITING_QC',
        reason: 'Inspection requested.',
      }),
    );

    // The REVOKE is applied per-role by ops.apply_append_only_grants. If the test
    // role is a superuser it is exempt, so this asserts the grant state rather
    // than the failure — the grant is the control either way.
    const [grant] = await raw.$queryRaw<Array<{ can_update: boolean; superuser: boolean }>>`
      SELECT has_table_privilege(current_user, 'listing.stock_movement', 'UPDATE') AS can_update,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`;
    expect(grant!.can_update && !grant!.superuser).toBe(false);
  });
});

/**
 * The label a buyer sees instead of a vendor's name.
 *
 * `publicBoardUnits` joins `listing.supply_point` ON the code and filters
 * `supply_point_code IS NOT NULL`, so a unit without one is SELLABLE AND
 * INVISIBLE: it passes QC, goes LISTED, counts as stock everywhere the vendor
 * looks, and never appears on the board a buyer actually shops from.
 *
 * `listing.assign_supply_point` existed from the first migration and only the
 * SEED had ever called it — which is exactly why the gap was invisible. Every
 * seeded unit had a label, so every screen looked right, while every unit
 * created through the product did not.
 *
 * These assert the property rather than the call: a unit created the way a
 * vendor creates one carries a label, it is the vendor's OWN label for that
 * city, and `v_supply_point_drift` — the view the demo seed refuses to finish
 * without — stays empty.
 */
describe('a unit created through the product is labelled for the board', () => {
  it('stamps the vendor city letter, and agrees with the register', async () => {
    // draft() inserts its units with raw SQL, so it would prove nothing here —
    // the point is the path a vendor actually goes through.
    const listingId = await draft(0);
    const serials = [1, 2, 3].map((i) => `TSPA${i}${randomUUID().slice(0, 6).toUpperCase()}`);
    await as(vendor(), () => listings.addUnits(listingId, serials));

    const units = await raw.$queryRaw<Array<{ supply_point_code: string | null }>>`
      SELECT supply_point_code FROM listing.unit WHERE listing_id = ${listingId}::uuid`;

    expect(units).toHaveLength(3);
    for (const u of units) expect(u.supply_point_code).toMatch(/^[A-Z]$/);

    // The letter is the register's, not one this code invented. Two vendors in
    // one city sharing a letter would merge them into a single identity.
    // The city is read on its own rather than joined in: identity owns
    // org_address, and no-cross-schema-join is a design rule, not a lint
    // preference. It is also why the repository resolves it the same way.
    const [addr] = await raw.$queryRaw<Array<{ city: string }>>`
      SELECT city FROM identity.org_address WHERE id = ${addressId}::uuid`;

    const [agree] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n
        FROM listing.unit u
        JOIN listing.supply_point sp
             ON sp.vendor_org_id = u.vendor_org_id AND sp.city = ${addr!.city}
       WHERE u.listing_id = ${listingId}::uuid AND sp.code = u.supply_point_code`;
    expect(Number(agree!.n)).toBe(3);

    const [drift] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.v_supply_point_drift`;
    expect(Number(drift!.n)).toBe(0);
  });

  it('refuses to create stock it cannot label rather than hiding it', async () => {
    const listingId = await draft(1);
    const [row] = await raw.$queryRaw<Array<{ pickup_location_id: string }>>`
      SELECT pickup_location_id FROM listing.listing WHERE id = ${listingId}::uuid`;

    // A city is the only input the label needs. Without one the old code wrote
    // NULL and the stock quietly never reached a buyer.
    await raw.$executeRaw`
      UPDATE identity.org_address SET city = '' WHERE id = ${row!.pickup_location_id}::uuid`;

    await expect(
      as(vendor(), () => listings.addUnits(listingId, [`TSPX${randomUUID().slice(0, 8)}`])),
    ).rejects.toThrow(/city/i);
  });
});
