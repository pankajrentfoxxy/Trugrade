/**
 * T23 — warranty cover and warranty claims, against the real database.
 *
 * Four properties here cannot be checked by reading the source once, and every
 * one of them is checked by ATTEMPTING THE FORBIDDEN THING rather than by
 * asserting a guard exists.
 *
 *   1. **A foreign organisation cannot reach a claim, and cannot tell whether
 *      one exists.** The test signs in as a second buyer and asks for the first
 *      buyer's claim by its real number, then raises a claim on the first
 *      buyer's serial. Both are refused as NOT FOUND — never FORBIDDEN, because
 *      claim numbers carry a month and a counter and "you may not see that one"
 *      confirms it exists.
 *
 *   2. **The window between delivery and cover is not a place where a warranty
 *      can be raised.** A claim on a machine that has not been delivered is
 *      refused, and the refusal says cover has not started rather than that the
 *      machine is out of warranty — those are opposite facts and a screen that
 *      confuses them tells a buyer they bought something uncovered.
 *
 *   3. **The delivery writer is idempotent.** It is a button an operator can
 *      press twice, and a second press must not open a second overlapping term.
 *      The test presses it twice and counts rows, rather than reading the
 *      `ON CONFLICT` clause.
 *
 *   4. **The vendor/platform split never reaches a customer payload.** Both are
 *      real columns on `platform.warranty` and both are in
 *      `FORBIDDEN_CUSTOMER_KEYS`; the sweep runs over the actual register and
 *      claim responses with a real vendor org id and a real split planted behind
 *      them.
 *
 * The clock is fixed, and the term arithmetic is asserted against it: cover of
 * `max(vendor months + top-up, floor)` starting on the IST date of delivery.
 * `04_TEST_PLAN.md` §1.4.1 forbids `Date.now()` for exactly this reason — the
 * rules most worth testing are the time-dependent ones.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { findForbiddenKeys, permissionsFor, type Role } from '@trugrade/contracts';
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
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { NotFoundError, PreconditionFailedError } from '../../src/shared/errors/domain-errors';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { PlatformModule } from '../../src/modules/platform';
import { DeliveryService } from '../../src/modules/ordering/internal/delivery.service';
import { WarrantyService } from '../../src/modules/platform/internal/warranty.service';
import {
  addMonths,
  daysBetween,
  istDate,
} from '../../src/modules/platform/internal/warranty.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeCatalog, makeListing, makeOrganization, makeUnit } from '../support/factories';

/**
 * A real instant with the DATE tracking today.
 *
 * `ordering.order_event` is partitioned by month, so a literal date is a time
 * bomb that passes only while the real calendar agrees with it — the trap the
 * build ledger names. The TIME is fixed; the DATE follows the clock.
 */
const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');

/** Matching the seeded `platform_config`, and asserted rather than assumed. */
const TOP_UP_MONTHS = 3;
const FLOOR_MONTHS = 6;

/** The vendor's own commitment on the listing under test. 3 + 3 = 6, the floor. */
const VENDOR_MONTHS = 3;
/** A second listing whose vendor offers more, so the floor is NOT what binds. */
const GENEROUS_VENDOR_MONTHS = 9;

let moduleRef: TestingModule;
let prisma: PrismaService;
let ctx: RequestContextService;
let redis: RedisService;
let clock: FixedClock;
let delivery: DeliveryService;
let warranty: WarrantyService;

const db: PrismaClient = (() => {
  migrateTestDatabase();
  return testDb();
})();

/* ==========================================================================
 * Principals
 * ======================================================================== */

const buyerPrincipal = (orgId: string, userId: string): Principal => {
  const roles: Role[] = ['CUSTOMER_BUYER'];
  return {
    userId,
    orgId,
    orgType: 'BUYER',
    roles,
    permissions: permissionsFor(roles),
    sessionId: randomUUID(),
    mfaSatisfied: true,
  };
};

const staffPrincipal = (): Principal => {
  const roles: Role[] = ['RIDER'];
  return {
    userId: randomUUID(),
    orgId: null,
    orgType: 'PLATFORM',
    roles,
    permissions: permissionsFor(roles),
    sessionId: randomUUID(),
    mfaSatisfied: true,
  };
};

const as = <T>(principal: Principal, fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: randomUUID() }, async () => {
    ctx.setPrincipal(principal);
    return fn();
  });

/* ==========================================================================
 * A whole order, built directly
 * ======================================================================== */

interface Fixture {
  orgId: string;
  userId: string;
  orderNumber: string;
  serials: string[];
}

let counter = 0;

/**
 * One buyer, one order, one consignment, `serials.length` machines.
 *
 * Built with raw inserts rather than through checkout: this suite is about what
 * happens AFTER an order exists, and driving the cart and the payment flow to
 * get there would make a warranty test fail for a pricing reason.
 */
async function anOrder(input: {
  orgName: string;
  status?: string;
  units?: number;
  vendorWarrantyMonths?: number;
}): Promise<Fixture> {
  const buyerOrgId = await makeOrganization(
    { legal_name: input.orgName, org_type: 'BUYER', status: 'VERIFIED' },
    db,
  );
  const vendorOrgId = await makeOrganization(
    { legal_name: `${input.orgName} Supply`, org_type: 'VENDOR', status: 'VERIFIED' },
    db,
  );
  const userId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, mobile, password_hash,
                                       status, is_org_owner, terms_accepted_version)
    VALUES (${userId}::uuid, ${buyerOrgId}::uuid, 'Test Buyer',
            ${`buyer-${(counter += 1)}@example.test`}, ${`+9198000000${String(counter).padStart(2, '0')}`},
            'x', 'ACTIVE', TRUE, 'v1')`;

  const pickupAddressId = await makeAddress(vendorOrgId, {}, db);
  const catalog = await makeCatalog({ skuCode: `SKU-T23-${counter}` }, db);
  const listingId = await makeListing(
    // `chk_qty_balance` on `listing.listing` is real: qty_total has to cover
    // every unit hung off it, and `makeUnit` reserves one each time.
    { vendorOrgId, skuId: catalog.skuId, pickupAddressId, qty: input.units ?? 1 },
    db,
  );
  await db.$executeRaw`
    UPDATE listing.listing SET vendor_warranty_months = ${input.vendorWarrantyMonths ?? VENDOR_MONTHS}
     WHERE id = ${listingId}::uuid`;

  const orderId = randomUUID();
  const subOrderId = randomUUID();
  const orderLineId = randomUUID();
  const orderNumber = `TT-99-${String(counter).padStart(5, '0')}`;
  const status = input.status ?? 'DISPATCHED';

  const billingAddressId = await makeAddress(buyerOrgId, {}, db);
  const gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 registration_type, status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid,
            ${`06AAJCT${String(2000 + counter).padStart(4, '0')}R1ZL`}, ${input.orgName},
            '06', 'REGULAR', 'ACTIVE', now(), TRUE)`;

  await db.$executeRaw`
    INSERT INTO ordering."order" (id, order_number, buyer_org_id, buyer_user_id,
                                  billing_gst_profile_id, billing_address_id, shipping_address_id,
                                  subtotal, gst_total, freight_total, grand_total,
                                  payment_status, status, placed_at, stock_hold_expires_at)
    VALUES (${orderId}::uuid, ${orderNumber}, ${buyerOrgId}::uuid, ${userId}::uuid,
            ${gstProfileId}::uuid, ${billingAddressId}::uuid, ${billingAddressId}::uuid,
            42000, 7560, 0, 49560,
            'PAID'::public.payment_status, ${status}::public.order_status, ${NOW},
            -- chk_held_order_has_expiry: an order still holding stock must say
            -- when the hold lapses. Set on every fixture, because the check
            -- decides from the status and the fixture varies it.
            ${new Date(NOW.getTime() + 86_400_000)})`;
  await db.$executeRaw`
    INSERT INTO ordering.sub_order (id, order_id, sub_order_number, vendor_org_id,
                                    subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${`${orderNumber}-1`}, ${vendorOrgId}::uuid,
            42000, 7560, ${status}::public.order_status)`;
  await db.$executeRaw`
    INSERT INTO ordering.order_line (id, sub_order_id, listing_id, sku_id, grade, qty,
                                     unit_price, line_total, gst_rate, gst_amount, status)
    VALUES (${orderLineId}::uuid, ${subOrderId}::uuid, ${listingId}::uuid, ${catalog.skuId}::uuid,
            'A'::grade_type, 1, 42000, 42000, 18, 7560, ${status}::public.order_status)`;

  const serials: string[] = [];
  for (let i = 0; i < (input.units ?? 1); i += 1) {
    const unit = await makeUnit(
      { listingId, vendorOrgId, skuId: catalog.skuId, status: 'RESERVED' },
      db,
    );
    await db.$executeRaw`
      INSERT INTO ordering.order_line_unit (order_line_id, unit_id, serial_number, status)
      VALUES (${orderLineId}::uuid, ${unit.unitId}::uuid, ${unit.serial}, 'RESERVED'::unit_status)`;
    serials.push(unit.serial);
  }

  return { orgId: buyerOrgId, userId, orderNumber, serials };
}

/* ==========================================================================
 * Wiring
 * ======================================================================== */

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      ContextModule,
      RedisModule,
      EventBusModule,
      AuthModule,
      AdaptersModule,
      CatalogModule,
      OrderingModule,
      PlatformModule,
    ],
  })
    .overrideProvider(ClockPort)
    .useValue(new FixedClock(NOW))
    .overrideProvider(PrismaService)
    .useFactory({
      factory: (config: AppConfig) => {
        Object.defineProperty(config, 'env', {
          value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
        });
        return new PrismaService(config);
      },
      inject: [AppConfig],
    })
    .compile();

  clock = moduleRef.get(ClockPort) as FixedClock;
  delivery = moduleRef.get(DeliveryService);
  warranty = moduleRef.get(WarrantyService);
  ctx = moduleRef.get(RequestContextService);
  redis = moduleRef.get(RedisService);
  prisma = moduleRef.get(PrismaService);
  await prisma.$connect();
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await moduleRef?.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedTestReference(db);
  await redis.client.flushdb();
  clock.advanceTo(NOW);
  counter = 0;
});

/* ==========================================================================
 * The term
 * ======================================================================== */

describe('the warranty term', () => {
  it('is the platform floor when the vendor term plus the top-up falls short', async () => {
    const order = await anOrder({ orgName: 'Floor Buyer Ltd', vendorWarrantyMonths: 0 });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));

    const [row] = await db.$queryRaw<
      Array<{
        total_months: number;
        vendor_backed_months: number;
        platform_backed_months: number;
        start_date: Date;
        end_date: Date;
      }>
    >`SELECT total_months, vendor_backed_months, platform_backed_months, start_date, end_date
        FROM platform.warranty`;

    // 0 + 3 = 3, below the floor of 6, so the floor binds — and the whole of it
    // is ours to fund. "We have not agreed a top-up" must never render as "no
    // warranty".
    expect(row!.total_months).toBe(FLOOR_MONTHS);
    expect(row!.vendor_backed_months).toBe(0);
    expect(row!.platform_backed_months).toBe(FLOOR_MONTHS);
    expect(row!.start_date.toISOString().slice(0, 10)).toBe(istDate(NOW));
    expect(row!.end_date.toISOString().slice(0, 10)).toBe(
      addMonths(istDate(NOW), FLOOR_MONTHS),
    );
  });

  it('is the vendor term plus the top-up when that beats the floor', async () => {
    const order = await anOrder({
      orgName: 'Generous Buyer Ltd',
      vendorWarrantyMonths: GENEROUS_VENDOR_MONTHS,
    });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));

    const [row] = await db.$queryRaw<
      Array<{ total_months: number; vendor_backed_months: number; platform_backed_months: number }>
    >`SELECT total_months, vendor_backed_months, platform_backed_months FROM platform.warranty`;

    expect(row!.total_months).toBe(GENEROUS_VENDOR_MONTHS + TOP_UP_MONTHS);
    expect(row!.vendor_backed_months).toBe(GENEROUS_VENDOR_MONTHS);
    expect(row!.platform_backed_months).toBe(TOP_UP_MONTHS);
  });

  it('starts on the delivery date, not the order date', async () => {
    const order = await anOrder({ orgName: 'Late Delivery Ltd' });
    // The order was placed at NOW; the machines arrive eleven days later.
    clock.advanceBy(11 * 86_400_000);
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));

    const [row] = await db.$queryRaw<Array<{ start_date: Date }>>`
      SELECT start_date FROM platform.warranty`;
    expect(row!.start_date.toISOString().slice(0, 10)).toBe(istDate(clock.now()));
    expect(row!.start_date.toISOString().slice(0, 10)).not.toBe(istDate(NOW));
  });
});

/* ==========================================================================
 * Delivery — the writer that opens cover
 * ======================================================================== */

describe('recording delivery', () => {
  it('is idempotent: a second press opens no second term', async () => {
    const order = await anOrder({ orgName: 'Double Press Ltd', units: 3 });

    const first = await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    expect(first.consignmentsDelivered).toBe(1);
    expect(first.warrantiesOpened).toBe(3);

    // The operator presses it again, a day later. Nothing must move.
    clock.advanceBy(86_400_000);
    const second = await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    expect(second.consignmentsDelivered).toBe(0);
    expect(second.consignmentsAlreadyDelivered).toBe(1);
    expect(second.warrantiesOpened).toBe(0);
    expect(second.warrantiesAlreadyOpen).toBe(3);

    const rows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.warranty`;
    expect(Number(rows[0]!.count)).toBe(3);

    // And the window did not move with the second press.
    const [row] = await db.$queryRaw<Array<{ delivered_at: Date }>>`
      SELECT delivered_at FROM ordering.sub_order`;
    expect(row!.delivered_at.toISOString()).toBe(NOW.toISOString());
  });

  it('refuses an order still at the supply point, and names the state it found', async () => {
    const order = await anOrder({ orgName: 'Unpaid Ltd', status: 'PAYMENT_PENDING' });
    await expect(as(staffPrincipal(), () => delivery.record(order.orderNumber))).rejects.toThrow(
      PreconditionFailedError,
    );
    const rows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.warranty`;
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('refuses an order number that does not exist', async () => {
    await expect(as(staffPrincipal(), () => delivery.record('TT-99-00000'))).rejects.toThrow(
      NotFoundError,
    );
  });
});

/* ==========================================================================
 * The register
 * ======================================================================== */

describe('the warranty register', () => {
  it('shows an undelivered machine with NO cover, which is not an expiry', async () => {
    const order = await anOrder({ orgName: 'Awaiting Ltd' });
    const principal = buyerPrincipal(order.orgId, order.userId);

    const register = await as(principal, () => warranty.register());
    expect(register.machines).toHaveLength(1);
    // Null, and emphatically not an object with `inWarranty: false` — the
    // screen has to be able to tell "not started" from "ended".
    expect(register.machines[0]!.cover).toBeNull();
  });

  it('decides inWarranty on the server clock, not on the caller', async () => {
    const order = await anOrder({ orgName: 'Expiry Ltd', vendorWarrantyMonths: 0 });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    const principal = buyerPrincipal(order.orgId, order.userId);

    const live = await as(principal, () => warranty.register());
    expect(live.machines[0]!.cover).toMatchObject({ inWarranty: true, expiringSoon: false });
    expect(live.machines[0]!.cover!.daysRemaining).toBe(
      daysBetween(istDate(NOW), addMonths(istDate(NOW), FLOOR_MONTHS)),
    );

    // Twenty days before the term ends: still covered, now expiring soon.
    clock.advanceTo(
      new Date(
        new Date(`${addMonths(istDate(NOW), FLOOR_MONTHS)}T09:00:00.000Z`).getTime() -
          20 * 86_400_000,
      ),
    );
    const soon = await as(principal, () => warranty.register());
    expect(soon.machines[0]!.cover).toMatchObject({ inWarranty: true, expiringSoon: true });

    // A day after it ends: out of cover, and `daysRemaining` is clamped to zero
    // rather than going negative — a negative countdown is a page's invitation
    // to draw a bar backwards.
    clock.advanceBy(21 * 86_400_000);
    const over = await as(principal, () => warranty.register());
    expect(over.machines[0]!.cover).toMatchObject({ inWarranty: false, daysRemaining: 0 });
  });

  it('carries no vendor identifier and no term split, at any depth', async () => {
    const order = await anOrder({ orgName: 'Anonymity Ltd', units: 2 });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    const principal = buyerPrincipal(order.orgId, order.userId);

    // The split and the vendor really are on the row this view is built from.
    const [row] = await db.$queryRaw<
      Array<{ vendor_org_id: string | null; vendor_backed_months: number }>
    >`SELECT vendor_org_id, vendor_backed_months FROM platform.warranty LIMIT 1`;
    expect(row!.vendor_org_id).not.toBeNull();
    expect(row!.vendor_backed_months).toBe(VENDOR_MONTHS);

    const register = await as(principal, () => warranty.register());
    expect(findForbiddenKeys(register)).toEqual([]);
    // The value sweep as well as the key sweep: a vendor org id under an
    // innocent-looking key would pass the key check.
    expect(JSON.stringify(register)).not.toContain(row!.vendor_org_id);
    expect(JSON.stringify(register)).not.toContain('Anonymity Ltd Supply');
  });
});

/* ==========================================================================
 * Claims — and the forbidden things
 * ======================================================================== */

describe('raising a claim', () => {
  const FAULT = {
    faultArea: 'BATTERY' as const,
    description: 'Battery drops from 100 to 12 percent in about forty minutes on idle.',
    evidenceKeys: [] as readonly string[],
  };

  it('refuses a machine that has not been delivered, and says cover has not STARTED', async () => {
    const order = await anOrder({ orgName: 'Not Arrived Ltd' });
    const principal = buyerPrincipal(order.orgId, order.userId);

    const attempt = as(principal, () =>
      warranty.raiseClaim({ serialNumber: order.serials[0]!, ...FAULT }),
    );
    await expect(attempt).rejects.toThrow(PreconditionFailedError);
    // The two facts must not be confused: "not started" is the opposite of
    // "ended", and telling a buyer their undelivered laptop is out of warranty
    // is the worst thing this endpoint can say.
    await expect(attempt).rejects.toThrow(/not been recorded as delivered/i);
  });

  it('refuses a machine whose cover has ended, naming the exact expiry date', async () => {
    const order = await anOrder({ orgName: 'Lapsed Ltd', vendorWarrantyMonths: 0 });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    const principal = buyerPrincipal(order.orgId, order.userId);

    const endDate = addMonths(istDate(NOW), FLOOR_MONTHS);
    clock.advanceTo(new Date(new Date(`${endDate}T09:00:00.000Z`).getTime() + 5 * 86_400_000));

    const attempt = as(principal, () =>
      warranty.raiseClaim({ serialNumber: order.serials[0]!, ...FAULT }),
    );
    await expect(attempt).rejects.toThrow(PreconditionFailedError);
    // §4.6: an expiry is a fact with a way forward beside it, not a dead end.
    await expect(attempt).rejects.toThrow(new RegExp(endDate));
    await expect(attempt).rejects.toThrow(/paid job/i);
  });

  it('refuses a second open claim on the same machine, and names the first', async () => {
    const order = await anOrder({ orgName: 'Twice Ltd' });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    const principal = buyerPrincipal(order.orgId, order.userId);

    const first = await as(principal, () =>
      warranty.raiseClaim({ serialNumber: order.serials[0]!, ...FAULT }),
    );
    const attempt = as(principal, () =>
      warranty.raiseClaim({ serialNumber: order.serials[0]!, ...FAULT }),
    );
    await expect(attempt).rejects.toThrow(new RegExp(first.claimNumber));
  });

  /* ------------------------------------------------------------------------
   * THE FORBIDDEN THING: another organisation's machine and another
   * organisation's claim.
   * ---------------------------------------------------------------------- */

  it("refuses a claim on ANOTHER organisation's serial, as NOT FOUND", async () => {
    const theirs = await anOrder({ orgName: 'Victim Ltd' });
    await as(staffPrincipal(), () => delivery.record(theirs.orderNumber));
    const mine = await anOrder({ orgName: 'Attacker Ltd' });

    const attacker = buyerPrincipal(mine.orgId, mine.userId);
    const attempt = as(attacker, () =>
      warranty.raiseClaim({ serialNumber: theirs.serials[0]!, ...FAULT }),
    );

    // NotFound, never Forbidden. A serial is printed on a case and could be
    // read off a photograph; "that machine is not yours" would confirm it is
    // somebody's.
    await expect(attempt).rejects.toThrow(NotFoundError);

    const rows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.warranty_claim`;
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it("refuses to read ANOTHER organisation's claim by its real number, as NOT FOUND", async () => {
    const theirs = await anOrder({ orgName: 'Owner Ltd' });
    await as(staffPrincipal(), () => delivery.record(theirs.orderNumber));
    const owner = buyerPrincipal(theirs.orgId, theirs.userId);
    const claim = await as(owner, () =>
      warranty.raiseClaim({ serialNumber: theirs.serials[0]!, ...FAULT }),
    );

    const mine = await anOrder({ orgName: 'Snooper Ltd' });
    const snooper = buyerPrincipal(mine.orgId, mine.userId);

    await expect(as(snooper, () => warranty.claim(claim.claimNumber))).rejects.toThrow(
      NotFoundError,
    );
    // And it is not in their list either — the list is the other door to the
    // same data and a guard on one is not a guard on both.
    const list = await as(snooper, () => warranty.claims());
    expect(list.claims).toHaveLength(0);
  });

  it('accepts a claim in cover and returns it with no vendor identifier', async () => {
    const order = await anOrder({ orgName: 'Good Claim Ltd' });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    const principal = buyerPrincipal(order.orgId, order.userId);

    const claim = await as(principal, () =>
      warranty.raiseClaim({ serialNumber: order.serials[0]!, ...FAULT }),
    );

    expect(claim.claimNumber).toMatch(/^TT-CLM-\d{4}-[0-9A-F]{8}$/);
    // 'RAISED', not the 'OPEN' the column used to default to — which was not in
    // its own CHECK constraint, so every insert without an explicit status
    // failed. The migration fixed the default; this is what proves it.
    expect(claim.status).toBe('RAISED');
    expect(claim.serialNumber).toBe(order.serials[0]);
    expect(findForbiddenKeys(claim)).toEqual([]);
    expect(JSON.stringify(claim)).not.toContain('Good Claim Ltd Supply');

    // And the register now reports the open claim against that machine.
    const register = await as(principal, () => warranty.register());
    expect(register.machines[0]!.openClaim).toMatchObject({
      claimNumber: claim.claimNumber,
      status: 'RAISED',
    });
  });

  it('refuses a description too short to send an engineer on', async () => {
    const order = await anOrder({ orgName: 'Terse Ltd' });
    await as(staffPrincipal(), () => delivery.record(order.orderNumber));
    const principal = buyerPrincipal(order.orgId, order.userId);

    await expect(
      as(principal, () =>
        warranty.raiseClaim({
          serialNumber: order.serials[0]!,
          faultArea: 'BATTERY',
          description: 'broken',
          evidenceKeys: [],
        }),
      ),
      // The refusal names what to do, not that something was invalid. The
      // actionable half lives on the field, which is where the form renders it.
    ).rejects.toThrow(/sends an engineer who does not know what to bring/i);
  });
});

/* ==========================================================================
 * Calendar arithmetic — the bug that only shows up in a dispute
 * ======================================================================== */

describe('addMonths', () => {
  it('clamps to the last day of the target month rather than rolling over', () => {
    // Naive addition gives 2027-03-03. A term that quietly runs two days long on
    // some months is the sort of thing only ever noticed in an argument.
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    // A leap year still gets its extra day.
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    // The ordinary case is unremarkable, which is the point.
    expect(addMonths('2026-08-30', 6)).toBe('2027-02-28');
    expect(addMonths('2026-08-15', 9)).toBe('2027-05-15');
  });
});
