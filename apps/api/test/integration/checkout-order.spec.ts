/**
 * PHASE_06 Tasks 1–3 — checkout and the order-confirmation transaction.
 *
 * `02_ARCHITECTURE.md` calls the transaction "the single most important piece of
 * code in the system", and every property worth asserting about it is one only a
 * real database produces: a row lock that turns a race into a queue, a CHECK
 * constraint that refuses a decrement into the negative, `FOR UPDATE SKIP
 * LOCKED` handing two transactions different machines, a UNIQUE index that makes
 * a double-sell a `23505`, and a ROLLBACK that takes eleven tables back with it.
 * A mocked repository would pass every test below and prove nothing at all.
 *
 * The suites are named for the test-plan ids they discharge:
 *
 *   ORD-010  two buyers race for the last unit — one wins, one is told why
 *   ORD-014  ascending lock order; the reverse order deadlocks, on purpose
 *   ORD-018  the Redis lock is force-expired mid-transaction and the DB holds
 *   ORD-020  an injected failure at each of the seven post-decrement points
 *   PRC-030  the vendor PO carries no buyer identity and no retail price
 *
 * Every one of them attempts the forbidden thing and expects the refusal. A test
 * that asserts a guard EXISTS proves nothing (three shipped defects in this
 * codebase had exactly that shape), so there is no `expect(constraint).toBeDefined()`
 * anywhere below.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { Money, permissionsFor, type Role } from '@trugrade/contracts';
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
import { LockService, RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { CheckoutService } from '../../src/modules/ordering/internal/checkout.service';
import type { OrderListQueryDto } from '../../src/modules/ordering/dto/ordering.dto';
import { OrderListService } from '../../src/modules/ordering/internal/order-list.service';
import { OrderReadService } from '../../src/modules/ordering/internal/order-read.service';
import { HoldService } from '../../src/modules/ordering/internal/hold.service';
import {
  OrderTransactionService,
  type PostDecrementStep,
} from '../../src/modules/ordering/internal/order-transaction.service';
import { seedLogisticsNcr } from '../../prisma/seed/logistics-ncr';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeCatalog, makeOrganization, makeTechnician, makeUser } from '../support/factories';

/**
 * A real instant, with the DATE tracking today.
 *
 * `ordering.order_event` is partitioned by month and only the current and next
 * partitions exist, so a hard-coded date is a time bomb: two suites in this repo
 * passed only while the wall clock happened to match a literal in the file. The
 * time is fixed, the day is not.
 */
const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');

/** Gurugram — our registered state is 06 Haryana, so this is the intra-state case. */
const HARYANA = { city: 'Gurugram', state: 'Haryana', stateCode: '06', pincode: '122015' };
/** Delhi — a Union Territory, so the state half of the tax is labelled UTGST. */
const DELHI = { city: 'New Delhi', state: 'Delhi', stateCode: '07', pincode: '110001' };
/** Karnataka. Not in NCR, so the freight lane is deliberately unserviceable. */
const KARNATAKA = { city: 'Bengaluru', state: 'Karnataka', stateCode: '29', pincode: '560001' };

const RETAIL = 42_000;
const VENDOR_ASK = 30_000;

let moduleRef: TestingModule;
let checkout: CheckoutService;
let readOrder: OrderReadService;
let orderBoard: OrderListService;
let holds: HoldService;
let orders: OrderTransactionService;
let ctx: RequestContextService;
let redis: RedisService;
let locks: LockService;
let db: PrismaClient;

let buyerOrgId: string;
let buyerUserId: string;
let gstProfileId: string;
let haryanaSiteId: string;
let delhiSiteId: string;
let karnatakaSiteId: string;
let skuId: string;
let technician: { technicianId: string; userId: string };

/* ==========================================================================
 * Fixtures
 * ======================================================================== */

function asBuyer<T>(fn: () => Promise<T>, userId = buyerUserId): Promise<T> {
  const roles: Role[] = ['CUSTOMER_BUYER'];
  const principal: Principal = {
    userId,
    orgId: buyerOrgId,
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

/** A verified vendor with a pickup address, a supply-point label, and a PAN. */
async function makeVendor(place = HARYANA): Promise<{ orgId: string; addressId: string }> {
  const orgId = await makeOrganization({ legal_name: `Vendor ${randomUUID().slice(0, 6)}` }, db);
  const addressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${addressId}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Plot 42, Udyog Vihar',
            ${place.city}, ${place.state}, ${place.stateCode}, ${place.pincode},
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  await db.$executeRaw`
    INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, verified)
    VALUES (${orgId}::uuid, '\\x00'::bytea, '1234', ${randomUUID()}, TRUE)`;
  return { orgId, addressId };
}

/**
 * A listing with `qty` genuinely sellable machines behind it — LISTED, inspected,
 * in date, and sealed with a photographed seal.
 *
 * Deliberately NOT `seedSellableUnit` from the factories: this needs
 * `vendor_ask_price` set, because a unit with no agreed payout is a unit no
 * purchase order can be raised against, and half of these tests are about what
 * happens when one is missing.
 */
async function makeOffer(input: {
  vendorOrgId: string;
  pickupAddressId: string;
  qty: number;
  unitPrice?: number;
  vendorAsk?: number | null;
  city?: string;
  valuationMethod?: 'REGULAR' | 'MARGIN';
}): Promise<{ listingId: string; unitIds: string[]; serials: string[] }> {
  const listingId = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, gst_rate, qty_total, status)
    VALUES (${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
            ${input.pickupAddressId}::uuid, 'A'::grade_type, 'REFURBISHED'::condition_type,
            'GOOD_80_89'::battery_band, 'ALL_ORIGINAL'::parts_status_type,
            ${input.unitPrice ?? RETAIL}, 18.00, ${input.qty}, 'ACTIVE'::listing_status)`;

  const [{ code } = { code: '' }] = await db.$queryRaw<Array<{ code: string }>>`
    SELECT listing.assign_supply_point(${input.vendorOrgId}::uuid,
                                       ${input.city ?? HARYANA.city}) AS code`;

  const unitIds: string[] = [];
  const serials: string[] = [];
  for (let i = 0; i < input.qty; i += 1) {
    const unitId = randomUUID();
    const serial = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
    const ask = input.vendorAsk === undefined ? VENDOR_ASK : input.vendorAsk;
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, grade_actual, status, location,
                                qc_passed_at, qc_valid_until, vendor_ask_price,
                                valuation_method, itc_eligible, retail_price, supply_point_code)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
              ${serial}, 'A'::grade_type, 'A'::grade_type, 'LISTED'::unit_status, 'VENDOR',
              ${NOW}, CURRENT_DATE + 60, ${ask}::numeric,
              ${input.valuationMethod ?? 'REGULAR'},
              ${(input.valuationMethod ?? 'REGULAR') === 'REGULAR'},
              ${input.unitPrice ?? RETAIL}::numeric, ${code})`;

    const qcReportId = randomUUID();
    await db.$executeRaw`
      INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                                started_at, completed_at, signature, nonce, grade_final,
                                qc_score, verdict, valid_until, is_current)
      VALUES (${qcReportId}::uuid, ${unitId}::uuid, ${technician.technicianId}::uuid,
              ${'CERT-' + qcReportId.slice(0, 8)}, '2.3.1', ${NOW}, ${NOW},
              ${'sig_' + qcReportId}, ${randomUUID()}, 'A'::grade_type, 92,
              'PASS'::qc_verdict, CURRENT_DATE + 60, TRUE)`;
    const sealId = randomUUID();
    await db.$executeRaw`
      INSERT INTO qc.qc_seal (id, unit_id, qc_report_id, seal_code, applied_by, status,
                              applied_at, applied_photo_key)
      VALUES (${sealId}::uuid, ${unitId}::uuid, ${qcReportId}::uuid,
              ${'TRG-26HR-' + String(Math.floor(Math.random() * 9_999_999)).padStart(7, '0')},
              ${technician.technicianId}::uuid, 'APPLIED'::seal_status, ${NOW},
              ${'qc/seals/' + unitId + '.jpg'})`;
    await db.$executeRaw`
      UPDATE listing.unit SET seal_id = ${sealId}::uuid, qc_report_id = ${qcReportId}::uuid
       WHERE id = ${unitId}::uuid`;

    unitIds.push(unitId);
    serials.push(serial);
  }
  return { listingId, unitIds, serials };
}

async function makeCart(lines: Array<{ listingId: string; qty: number }>): Promise<string> {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.cart (id, buyer_org_id, user_id, name, status)
    VALUES (${cartId}::uuid, ${buyerOrgId}::uuid, ${buyerUserId}::uuid,
            ${'Cart ' + cartId.slice(0, 6)}, 'OPEN')`;
  for (const line of lines) {
    await db.$executeRaw`
      INSERT INTO ordering.cart_item (cart_id, listing_id, qty, unit_price_snapshot)
      VALUES (${cartId}::uuid, ${line.listingId}::uuid, ${line.qty}, ${RETAIL}::numeric)`;
  }
  return cartId;
}

const confirmArgs = (cartId: string, siteId = haryanaSiteId) => ({
  cartId,
  gstProfileId,
  billingAddressId: siteId,
  deliveryAddressId: siteId,
  paymentMode: 'PREPAID' as const,
});

const counters = async (listingId: string) =>
  (
    await db.$queryRaw<Array<{ qty_available: number; qty_reserved: number; qty_total: number }>>`
      SELECT qty_available, qty_reserved, qty_total FROM listing.listing
       WHERE id = ${listingId}::uuid`
  )[0]!;

/* ==========================================================================
 * Boot
 * ======================================================================== */

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
      // `CatalogLookup` resolves `CatalogService` from the container on first
      // use — ordering cannot import CatalogModule without closing a cycle Nest
      // cannot instantiate. So the container has to have it, which is exactly
      // what the running app does.
      CatalogModule,
      OrderingModule,
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

  checkout = moduleRef.get(CheckoutService);
  readOrder = moduleRef.get(OrderReadService);
  orderBoard = moduleRef.get(OrderListService);
  holds = moduleRef.get(HoldService);
  orders = moduleRef.get(OrderTransactionService);
  ctx = moduleRef.get(RequestContextService);
  redis = moduleRef.get(RedisService);
  locks = moduleRef.get(LockService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef?.get(PrismaService).$disconnect();
  await moduleRef?.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedLogisticsNcr(db);
  await redis.client.flushdb();

  buyerOrgId = await makeOrganization(
    { org_type: 'BUYER', legal_name: 'Northgate Technologies Pvt Ltd' },
    db,
  );
  buyerUserId = await makeUser(buyerOrgId, { full_name: 'Priya Sharma' }, db);
  technician = await makeTechnician(db);
  skuId = (await makeCatalog({}, db)).skuId;

  gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, '06AABCU9603R1ZM',
            'Northgate Technologies Pvt Ltd', '06', 'ACTIVE', ${NOW}, TRUE)`;

  const site = async (place: typeof HARYANA): Promise<string> => {
    const id = randomUUID();
    await db.$executeRaw`
      INSERT INTO identity.org_address (id, org_id, type, label, line1, city, state, state_code,
                                        pincode, contact_name, contact_mobile, landmark,
                                        delivery_instructions, is_default, is_billing_enabled)
      VALUES (${id}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type,
              ${place.city + ' office'}, 'Tower B, 4th floor', ${place.city}, ${place.state},
              ${place.stateCode}, ${place.pincode}, 'Ravi Menon', '+919812345678',
              'Opposite the metro station', 'Goods gate is at the rear; ask for security desk 2',
              ${place.stateCode === '06'}, TRUE)`;
    return id;
  };
  haryanaSiteId = await site(HARYANA);
  delhiSiteId = await site(DELHI);
  karnatakaSiteId = await site(KARNATAKA);

  await db.$executeRaw`
    INSERT INTO customer.buyer_profile (org_id, credit_limit, credit_used, payment_mode_allowed)
    VALUES (${buyerOrgId}::uuid, 0, 0, ARRAY['PREPAID']::public.payment_mode[])`;
  await db.$executeRaw`
    INSERT INTO customer.org_preference (org_id, po_required, default_shipping_address_id)
    VALUES (${buyerOrgId}::uuid, FALSE, ${haryanaSiteId}::uuid)`;
});

/* ==========================================================================
 * The happy path — what the screen and the vendor portal both depend on
 * ======================================================================== */

describe('a confirmed order', () => {
  it('allocates specific serials, raises one PO per supply point, and balances', async () => {
    const alpha = await makeVendor(HARYANA);
    const beta = await makeVendor({ ...HARYANA, city: 'Noida', pincode: '201301' });
    const a = await makeOffer({ vendorOrgId: alpha.orgId, pickupAddressId: alpha.addressId, qty: 3 });
    const b = await makeOffer({
      vendorOrgId: beta.orgId,
      pickupAddressId: beta.addressId,
      qty: 2,
      city: 'Noida',
    });
    const cartId = await makeCart([
      { listingId: a.listingId, qty: 2 },
      { listingId: b.listingId, qty: 1 },
    ]);

    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    expect(order.orderNumber).toMatch(/^TT-\d{2}-\d{5}$/);
    expect(order.status).toBe('PAYMENT_PENDING');
    expect(order.serials).toHaveLength(3);

    // The serials are REAL machines from the two listings, not invented ones.
    const allocated = order.serials.map((s) => s.serialNumber).sort();
    expect(allocated.every((s) => [...a.serials, ...b.serials].includes(s))).toBe(true);

    // One sub-order and one purchase order per supply point. Two vendors, two POs.
    const [{ count: subOrders } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering.sub_order WHERE order_id = ${order.orderId}::uuid`;
    expect(Number(subOrders)).toBe(2);

    const pos = await db.$queryRaw<Array<{ po_number: string; total_net: string; vendor_org_id: string }>>`
      SELECT po_number, total_net::text AS total_net, vendor_org_id
        FROM procurement.purchase_order WHERE order_id = ${order.orderId}::uuid
       ORDER BY po_number`;
    expect(pos).toHaveLength(2);
    expect(pos[0]!.po_number).toMatch(/^PO-\d{2}-\d{5}$/);
    // Two machines from alpha at the agreed payout, one from beta.
    expect(Money.sum(pos.map((p) => Money.parse(p.total_net))).toString()).toBe(
      Money.rupees(VENDOR_ASK * 3).toString(),
    );

    // Every allocated machine is on exactly one PO line and exactly one order line.
    const [{ count: poLines } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM procurement.purchase_order_line WHERE po_id = ANY(
        SELECT id FROM procurement.purchase_order WHERE order_id = ${order.orderId}::uuid)`;
    expect(Number(poLines)).toBe(3);

    // The machines are off sale and the counters agree with the units.
    expect(await counters(a.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 2 });
    expect(await counters(b.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 1 });

    // A stock movement per machine, so nothing moved without a trail.
    const [{ count: movements } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM listing.stock_movement
       WHERE ref_type = 'ORDER' AND ref_id = ${order.orderId}::uuid`;
    expect(Number(movements)).toBe(3);

    // And the payable, the TDS accrual and the outbox rows are all there.
    const [{ count: payables } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM procurement.vendor_payable WHERE purchase_order_id = ANY(
        SELECT id FROM procurement.purchase_order WHERE order_id = ${order.orderId}::uuid)`;
    expect(Number(payables)).toBe(2);

    const events = await db.$queryRaw<Array<{ event_name: string }>>`
      SELECT event_name FROM platform.event_outbox ORDER BY event_name`;
    expect(events.map((e) => e.event_name)).toEqual(['order.confirmed', 'po.raised', 'po.raised']);
  });

  it('writes an order_event a human can read', async () => {
    const v = await makeVendor();
    const o = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: o.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [event] = await db.$queryRaw<Array<{ note: string; to_status: string }>>`
      SELECT note, to_status FROM ordering.order_event WHERE order_id = ${order.orderId}::uuid`;
    expect(event!.note).toBe('Order placed. 1 machine allocated to you by serial number.');
    expect(event!.to_status).toBe('PAYMENT_PENDING');
  });

  it('never enters the QC states on the normal path', async () => {
    // PHASE_06 Task 4: inspection happens before listing, so AT_HUB, QC_IN_PROGRESS,
    // QC_HOLD and QC_CLEARED are reachable only through the broken-seal exception.
    const v = await makeVendor();
    const o = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: o.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const statuses = await db.$queryRaw<Array<{ to_status: string }>>`
      SELECT to_status FROM ordering.order_event WHERE order_id = ${order.orderId}::uuid`;
    expect(
      statuses.some((s) =>
        ['AT_HUB', 'QC_IN_PROGRESS', 'QC_HOLD', 'QC_CLEARED'].includes(s.to_status),
      ),
    ).toBe(false);
  });
});

/* ==========================================================================
 * ORD-010 — two buyers, one machine
 * ======================================================================== */

describe('ORD-010: two concurrent buyers race for the last unit', () => {
  it('lets exactly one through and tells the other exactly what happened', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartA = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    const cartB = await makeCart([{ listingId: offer.listingId, qty: 1 }]);

    const settled = await Promise.allSettled([
      asBuyer(async () => {
        await checkout.begin(cartA);
        return checkout.confirm(confirmArgs(cartA));
      }),
      asBuyer(async () => {
        await checkout.begin(cartB);
        return checkout.confirm(confirmArgs(cartB));
      }),
    ]);

    const won = settled.filter((s) => s.status === 'fulfilled');
    const lost = settled.filter((s) => s.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    // A clean, specific failure — not a constraint name, not a 500.
    const failure = (lost[0] as PromiseRejectedResult).reason as Error & { code?: string };
    expect(failure.code).toBe('INSUFFICIENT_STOCK');
    expect(failure.message).toMatch(/just been taken|Only 0 of the 1/);

    // Exactly one order exists, and the machine is on it once.
    const [{ count: orderCount } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering."order"`;
    expect(Number(orderCount)).toBe(1);
    const [{ count: allocations } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering.order_line_unit WHERE unit_id = ${offer.unitIds[0]}::uuid`;
    expect(Number(allocations)).toBe(1);
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 0, qty_reserved: 1 });
  });
});

/* ==========================================================================
 * ORD-014 — lock ordering
 * ======================================================================== */

describe('ORD-014: lock ordering is ascending listing_id, always', () => {
  it('takes the Redis locks in ascending id whatever order the cart is in', async () => {
    const v = await makeVendor();
    const one = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const two = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const ascending = [one.listingId, two.listingId].sort();

    const acquired: string[] = [];
    const set = redis.client.set.bind(redis.client);
    const spy = jest
      .spyOn(redis.client, 'set')
      .mockImplementation((...args: Parameters<typeof set>) => {
        const key = String(args[0]);
        if (key.startsWith('lock:listing:')) acquired.push(key.replace('lock:listing:', ''));
        return set(...args);
      });

    try {
      // The cart is built DESCENDING on purpose. If the order the locks are taken
      // in followed the cart, this is the shape that deadlocks in production.
      const descending = [...ascending].reverse();
      const cartId = await makeCart(descending.map((listingId) => ({ listingId, qty: 1 })));
      await asBuyer(() => checkout.begin(cartId));
      acquired.length = 0;
      await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

      expect(acquired).toEqual(ascending);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * The proof that the ordering matters, rather than the claim that it does.
   *
   * Two transactions take the same two listing rows in opposite orders, with a
   * pause between so each holds one lock before asking for the other. Postgres
   * detects the cycle and kills one with SQLSTATE 40P01. This is exactly what a
   * multi-supply-point cart locking in cart order does at volume — intermittently,
   * in production — and it is why `LockService.withLocks` sorts and `reserve()`
   * walks the lines in ascending id.
   */
  it('DEADLOCKS when the same two rows are locked in opposite orders', async () => {
    const v = await makeVendor();
    const one = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const two = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const [low, high] = [one.listingId, two.listingId].sort() as [string, string];

    const lockBoth = (first: string, second: string) =>
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT id FROM listing.listing WHERE id = '${first}'::uuid FOR UPDATE`,
        );
        await new Promise((r) => setTimeout(r, 150));
        await tx.$executeRawUnsafe(
          `SELECT id FROM listing.listing WHERE id = '${second}'::uuid FOR UPDATE`,
        );
      });

    const settled = await Promise.allSettled([lockBoth(low, high), lockBoth(high, low)]);
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/deadlock/i);
  });
});

/* ==========================================================================
 * ORD-018 — the lock is an optimisation, the constraint is the guarantee
 * ======================================================================== */

describe('ORD-018: the DB constraint holds when the Redis lock expires mid-transaction', () => {
  /**
   * The lock is force-expired the instant each transaction begins — the state a
   * Redis restart, a TTL overrun or an evicted key leaves behind — and then two
   * buyers are pointed at the same last machine at the same moment.
   *
   * With the lock gone there is nothing serialising them but the database: the
   * `SELECT ... FOR UPDATE` on the listing row, and `qty_available = qty_available - n`
   * re-evaluated against whatever the winner committed, which drives the loser
   * negative and into `chk_qty_nonneg`. If this ever produced two orders, every
   * other test in this file would be worthless, because correctness would rest
   * on Redis being up.
   */
  it('two buyers race for the last machine with the lock deleted underneath them', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartA = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    const cartB = await makeCart([{ listingId: offer.listingId, qty: 1 }]);

    const real = locks.withLocks.bind(locks);
    const spy = jest
      .spyOn(locks, 'withLocks')
      .mockImplementation(async <T,>(keys: readonly string[], fn: () => Promise<T>) =>
        real(keys, async () => {
          // Gone, mid-transaction. Any other caller is now free to walk in.
          await redis.client.del(...keys);
          return fn();
        }),
      );

    try {
      const settled = await Promise.allSettled([
        asBuyer(() => checkout.confirm(confirmArgs(cartA))),
        asBuyer(() => checkout.confirm(confirmArgs(cartB))),
      ]);
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }

    // No lock was held at the end, and the invariant survived anyway.
    expect(await redis.client.get(`lock:listing:${offer.listingId}`)).toBeNull();
    const c = await counters(offer.listingId);
    expect(c).toMatchObject({ qty_available: 0, qty_reserved: 1 });
    expect(c.qty_available + c.qty_reserved).toBeLessThanOrEqual(c.qty_total);

    const [{ count } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering.order_line_unit`;
    expect(Number(count)).toBe(1);
  });

  it('the constraint itself refuses a negative decrement, with no lock in sight', async () => {
    // The guarantee, attempted directly and by hand.
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    await expect(
      db.$executeRaw`
        UPDATE listing.listing SET qty_available = qty_available - 5
         WHERE id = ${offer.listingId}::uuid`,
    ).rejects.toThrow(/chk_qty_nonneg|violates check constraint/i);
  });

  it('refuses to sell a machine the hold no longer covers', async () => {
    // The hold is real, but a machine can still leave underneath it — a QC
    // expiry at midnight, an ops correction, a seal broken in the warehouse.
    // The transaction re-reads and refuses rather than allocating something that
    // is no longer sellable.
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));

    await redis.client.del(`lock:listing:${offer.listingId}`);
    await db.$executeRaw`
      UPDATE listing.unit SET status = 'SCRAPPED'::unit_status WHERE id = ${offer.unitIds[0]}::uuid`;

    await expect(asBuyer(() => checkout.confirm(confirmArgs(cartId)))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });

    const c = await counters(offer.listingId);
    expect(c.qty_available + c.qty_reserved).toBeLessThanOrEqual(c.qty_total);
    expect(c.qty_available).toBeGreaterThanOrEqual(0);
    const [{ count } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering."order"`;
    expect(Number(count)).toBe(0);
  });
});

/* ==========================================================================
 * ORD-020 — rollback is complete, at every point after the decrement
 * ======================================================================== */

describe('ORD-020: an injected failure after the decrement leaves nothing behind', () => {
  const POINTS: PostDecrementStep[] = [
    'order',
    'sub_order',
    'order_line',
    'order_line_unit',
    'stock_movement',
    'purchase_order',
    'vendor_payable',
  ];

  it.each(POINTS)('rolls back completely when %s fails', async (point) => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 2 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    const before = await counters(offer.listingId);

    // No hold. This is the single-transaction path: all sixteen steps inside one
    // BEGIN…COMMIT, which is what the injection has to unwind.
    await expect(
      asBuyer(() =>
        checkout.confirm({
          ...confirmArgs(cartId),
          failAt: (step) => {
            if (step === point) throw new Error(`injected failure at ${step}`);
          },
        }),
      ),
    ).rejects.toThrow(`injected failure at ${point}`);

    const empty = async (sql: string): Promise<number> =>
      Number((await db.$queryRawUnsafe<Array<{ count: bigint }>>(sql))[0]!.count);

    // No orphan order, at any level.
    expect(await empty('SELECT count(*) FROM ordering."order"')).toBe(0);
    expect(await empty('SELECT count(*) FROM ordering.sub_order')).toBe(0);
    expect(await empty('SELECT count(*) FROM ordering.order_line')).toBe(0);
    expect(await empty('SELECT count(*) FROM ordering.order_line_unit')).toBe(0);
    expect(await empty('SELECT count(*) FROM ordering.order_event')).toBe(0);
    // No orphan PO, payable or TDS accrual.
    expect(await empty('SELECT count(*) FROM procurement.purchase_order')).toBe(0);
    expect(await empty('SELECT count(*) FROM procurement.purchase_order_line')).toBe(0);
    expect(await empty('SELECT count(*) FROM procurement.vendor_payable')).toBe(0);
    expect(await empty('SELECT count(*) FROM procurement.tds_ledger')).toBe(0);
    // No event escaped to the outbox.
    expect(await empty('SELECT count(*) FROM platform.event_outbox')).toBe(0);
    // No leaked stock: the counters and the units are exactly where they started.
    expect(await counters(offer.listingId)).toEqual(before);
    expect(
      await empty(
        `SELECT count(*) FROM listing.unit WHERE listing_id = '${offer.listingId}' AND status <> 'LISTED'`,
      ),
    ).toBe(0);
    // And no movement row claiming something happened.
    expect(await empty("SELECT count(*) FROM listing.stock_movement WHERE ref_type = 'ORDER'")).toBe(
      0,
    );
  });
});

/* ==========================================================================
 * The two unique constraints
 * ======================================================================== */

describe('one machine, one order line, ever', () => {
  it('order_line_unit.unit_id refuses a second allocation of the same machine', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [line] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT ol.id FROM ordering.order_line ol
        JOIN ordering.sub_order s ON s.id = ol.sub_order_id
       WHERE s.order_id = ${order.orderId}::uuid`;

    await expect(
      db.$executeRaw`
        INSERT INTO ordering.order_line_unit (order_line_id, unit_id, serial_number, status)
        VALUES (${line!.id}::uuid, ${offer.unitIds[0]}::uuid, 'DOUBLE-SOLD', 'RESERVED')`,
    ).rejects.toThrow(/23505|already exists/i);
  });

  it('purchase_order_line.unit_id refuses a second purchase of the same machine', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [po] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM procurement.purchase_order WHERE order_id = ${order.orderId}::uuid`;

    await expect(
      db.$executeRaw`
        INSERT INTO procurement.purchase_order_line
          (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po)
        VALUES (${po!.id}::uuid, ${offer.unitIds[0]}::uuid, ${skuId}::uuid, 1, 'A'::grade_type)`,
    ).rejects.toThrow(/23505|already exists/i);
  });
});

/* ==========================================================================
 * If the PO cannot be raised, the order does not confirm
 * ======================================================================== */

describe('the purchase order is the gate on confirmation', () => {
  it('fails the checkout when a machine has no agreed payout, and leaves nothing', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: v.orgId,
      pickupAddressId: v.addressId,
      qty: 1,
      vendorAsk: null,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);

    await expect(asBuyer(() => checkout.confirm(confirmArgs(cartId)))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message:
        'One of the supply points for this item is temporarily unavailable. Remove it and try again.',
    });

    const [{ count } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering."order"`;
    expect(Number(count)).toBe(0);
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 0 });
  });

  it('fails the checkout when the supply point is no longer a verified vendor', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await db.$executeRaw`
      UPDATE identity.organization SET status = 'SUSPENDED'::org_status WHERE id = ${v.orgId}::uuid`;

    await expect(asBuyer(() => checkout.confirm(confirmArgs(cartId)))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const [{ count } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM procurement.purchase_order`;
    expect(Number(count)).toBe(0);
  });
});

/* ==========================================================================
 * PRC-030 — what the vendor may see, and what the buyer may not
 * ======================================================================== */

describe('PRC-030: the vendor PO carries no buyer identity and no retail price', () => {
  it('holds only the agreed payout, and nothing that names the buyer', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 2 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [po] = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM procurement.purchase_order WHERE order_id = ${order.orderId}::uuid`;
    const lines = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM procurement.purchase_order_line WHERE po_id = ${po!.id as string}::uuid`;

    // The whole serialised PO, swept for the buyer's identity at any depth.
    const payload = JSON.stringify({ po, lines }, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    for (const forbidden of [
      buyerOrgId,
      buyerUserId,
      'Northgate',
      '06AABCU9603R1ZM',
      'Ravi Menon',
      '+919812345678',
      'Tower B',
    ]) {
      expect(payload).not.toContain(forbidden);
    }

    // And no retail price. Rs 42,000 is ours; Rs 30,000 is what the vendor is owed.
    expect(payload).not.toContain('42000');
    expect(po!.total_net!.toString()).toBe(String(VENDOR_ASK * 2));
    expect(lines.every((l) => l.agreed_net_payout!.toString() === String(VENDOR_ASK))).toBe(true);
  });

  it('the buyer-facing confirmation carries no PO, no vendor and no payout', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    const session = await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const payload = JSON.stringify({ session, order });
    for (const forbidden of [v.orgId, String(VENDOR_ASK), 'PO-', 'sub_order', 'vendor']) {
      expect(payload).not.toContain(forbidden);
    }
    // The supply point is a letter and a city, and nothing finer.
    expect(order.serials[0]!.dispatchPoint).toMatch(/^Supply Point [A-Z]{1,2} · Gurugram$/);
  });
});

/* ==========================================================================
 * The tax split — all three cases from 01_DECISIONS §2.4
 * ======================================================================== */

describe('IGST versus CGST + SGST', () => {
  const splitFor = async (siteId: string) => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    return asBuyer(() => checkout.confirm(confirmArgs(cartId, siteId)));
  };

  it('delivery inside Haryana, where we are registered: CGST + SGST', async () => {
    const order = await splitFor(haryanaSiteId);
    expect(order.tax.interState).toBe(false);
    expect(order.tax.igst).toBe('0.00');
    expect(Money.parse(order.tax.cgst).isPositive()).toBe(true);
    expect(Money.parse(order.tax.cgst).add(Money.parse(order.tax.sgst)).toString()).toBe(
      order.gstTotal,
    );
    expect(order.tax.stateTaxLabel).toBe('SGST');
    expect(order.tax.basis).toContain('s.10(1)(a)');
  });

  it('delivery to Delhi: IGST, and the state half is labelled UTGST if it were used', async () => {
    const order = await splitFor(delhiSiteId);
    expect(order.tax.interState).toBe(true);
    expect(order.tax.cgst).toBe('0.00');
    expect(order.tax.sgst).toBe('0.00');
    expect(order.tax.igst).toBe(order.gstTotal);
    // Delhi is a Union Territory. The word on the invoice differs even though the
    // arithmetic does not — and this order does not use the state half at all.
    expect(order.tax.stateTaxLabel).toBe('UTGST');
  });

  /**
   * The trap PHASE_06 Task 1 names, attempted rather than described.
   *
   * The buyer is registered in Haryana (`06AABCU9603R1ZM`) — the same state we
   * are — and takes delivery in Delhi. Billing-address logic gives CGST+SGST.
   * The law gives IGST, because the place of supply is where the movement
   * terminates. If this ever comes back intra-state, the invoice is wrong in a
   * way nobody notices until a mismatched return months later.
   */
  it('resolves from the DELIVERY state, not the billing GSTIN', async () => {
    const order = await splitFor(delhiSiteId);
    expect(order.tax.ourStateCode).toBe('06');
    expect(order.tax.placeOfSupplyStateCode).toBe('07');
    expect(order.tax.interState).toBe(true);
  });

  it('shows the resolved split BEFORE anything is confirmed', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));

    const quoted = await asBuyer(() =>
      checkout.quote(cartId, { deliveryAddressId: delhiSiteId, gstProfileId }),
    );
    expect(quoted.breakUp).not.toBeNull();
    expect(quoted.breakUp!.tax.interState).toBe(true);
    expect(quoted.breakUp!.grandTotal).not.toBeNull();

    // Nothing has been ordered by asking.
    const [{ count } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering."order"`;
    expect(Number(count)).toBe(0);
  });
});

/* ==========================================================================
 * The break-up, in full, on one screen
 * ======================================================================== */

describe('the price break-up', () => {
  it('names every charge and adds up', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 2 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    await asBuyer(() => checkout.begin(cartId));
    const session = await asBuyer(() =>
      checkout.quote(cartId, { deliveryAddressId: haryanaSiteId }),
    );

    const b = session.breakUp!;
    expect(b.goods).toBe(Money.rupees(RETAIL * 2).toString());
    expect(b.freight).not.toBeNull();
    expect(Money.parse(b.taxableValue).toString()).toBe(
      Money.parse(b.goods).add(Money.parse(b.freight!)).toString(),
    );
    expect(Money.parse(b.grandTotal!).toString()).toBe(
      Money.parse(b.taxableValue).add(Money.parse(b.gstTotal)).toString(),
    );
  });

  it('refuses to price an unserviceable lane rather than charging zero freight', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));

    const session = await asBuyer(() =>
      checkout.quote(cartId, { deliveryAddressId: karnatakaSiteId }),
    );
    // Never a zero standing in for "we could not price it" — CP e-Comm r.6(5).
    expect(session.breakUp!.freight).toBeNull();
    expect(session.breakUp!.grandTotal).toBeNull();
    expect(session.breakUp!.freightUnpricedReason).toBeTruthy();
    // And the reason does not name the origin of the anonymous supply point.
    expect(session.breakUp!.freightUnpricedReason).not.toMatch(/Gurugram|122015/);

    await expect(
      asBuyer(() => checkout.confirm(confirmArgs(cartId, karnatakaSiteId))),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

/* ==========================================================================
 * The twenty-minute hold
 * ======================================================================== */

describe('the twenty-minute hold', () => {
  it('takes the machines off sale and gives the screen a real deadline', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 3 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);

    const session = await asBuyer(() => checkout.begin(cartId));

    expect(session.unitsHeld).toBe(2);
    expect(new Date(session.holdExpiresAt).getTime() - NOW.getTime()).toBe(20 * 60_000);
    // Really off sale, not merely flagged.
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 2 });
    // And the exact serials are on screen.
    expect(session.lines[0]!.serials).toHaveLength(2);
  });

  it('does not renew the deadline when the buyer reloads the screen', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);

    const first = await asBuyer(() => checkout.begin(cartId));
    const second = await asBuyer(() => checkout.begin(cartId));
    expect(second.holdExpiresAt).toBe(first.holdExpiresAt);
  });

  it('releases on expiry and puts the machines back on sale', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));

    await db.$executeRaw`
      UPDATE ordering.checkout_hold SET expires_at = ${new Date(NOW.getTime() - 1000)}
       WHERE cart_id = ${cartId}::uuid`;

    const result = await holds.expireDueHolds();
    expect(result).toEqual({ released: 1, units: 1 });
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 0 });

    // The trail says why, in words a stranger can read.
    const [movement] = await db.$queryRaw<Array<{ reason: string; to_status: string }>>`
      SELECT reason, to_status FROM listing.stock_movement
       WHERE unit_id = ${offer.unitIds[0]}::uuid ORDER BY id DESC LIMIT 1`;
    expect(movement!.to_status).toBe('LISTED');
    expect(movement!.reason).toContain('twenty-minute checkout hold expired');
  });

  it('refuses to quote against an expired hold, and says so', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    await db.$executeRaw`
      UPDATE ordering.checkout_hold SET expires_at = ${new Date(NOW.getTime() - 1000)}
       WHERE cart_id = ${cartId}::uuid`;

    await expect(
      asBuyer(() => checkout.quote(cartId, { deliveryAddressId: haryanaSiteId })),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('releases early when the buyer leaves checkout', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    expect(await asBuyer(() => checkout.abandon(cartId))).toEqual({ released: 1 });
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 0 });
  });

  it('holds exactly the machines that end up on the order', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 3 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    const session = await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    expect(order.serials.map((s) => s.serialNumber).sort()).toEqual(
      [...session.lines[0]!.serials].sort(),
    );
    // The hold is consumed, not left behind to be released later.
    const [{ count } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering.checkout_hold`;
    expect(Number(count)).toBe(0);
  });
});

/* ==========================================================================
 * Approval — stock held, order not confirmed, no PO
 * ======================================================================== */

describe('an order above the approval threshold', () => {
  const withPolicy = async (approverUserId: string | null) => {
    await db.$executeRaw`
      INSERT INTO customer.buyer_approval_policy
        (org_id, user_id, requires_approval_above, approver_user_id, allowed_payment_modes)
      VALUES (${buyerOrgId}::uuid, ${buyerUserId}::uuid, 50000,
              ${approverUserId}::uuid, ARRAY['PREPAID']::public.payment_mode[])`;
  };

  it('holds the stock, does not confirm, and raises NO purchase order', async () => {
    const approver = await makeUser(buyerOrgId, { full_name: 'Anil Kapoor' }, db);
    await withPolicy(approver);
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 2 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);

    const session = await asBuyer(() => checkout.begin(cartId));
    expect(session.approval).toMatchObject({ required: true, approverName: 'Anil Kapoor' });
    expect(session.approval!.reason).toContain('above the');

    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));
    expect(order.status).toBe('AWAITING_APPROVAL');

    // Stock IS held — the units are unavailable to other buyers...
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 0, qty_reserved: 2 });
    // ...but nothing is committed to a vendor.
    const [{ count: pos } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM procurement.purchase_order`;
    expect(Number(pos)).toBe(0);
    const [{ count: payables } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM procurement.vendor_payable`;
    expect(Number(payables)).toBe(0);
    // And no order.confirmed escaped to anyone.
    const [{ count: outbox } = { count: 0n }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.event_outbox`;
    expect(Number(outbox)).toBe(0);

    const [approval] = await db.$queryRaw<
      Array<{ status: string; expires_at: Date; approver_user_id: string }>
    >`SELECT status, expires_at, approver_user_id FROM ordering.order_approval
       WHERE order_id = ${order.orderId}::uuid`;
    expect(approval!.status).toBe('PENDING');
    expect(approval!.approver_user_id).toBe(approver);
    // Twenty-four hours, because stock cannot be held indefinitely for a manager.
    expect(approval!.expires_at.getTime() - NOW.getTime()).toBe(24 * 3_600_000);
  });

  it('falls back to the account owner when no approver is named', async () => {
    await withPolicy(null);
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 2 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [approval] = await db.$queryRaw<Array<{ approver_user_id: string }>>`
      SELECT approver_user_id FROM ordering.order_approval WHERE order_id = ${order.orderId}::uuid`;
    expect(approval!.approver_user_id).toBe(buyerUserId);
  });

  it('expires at 24 hours and releases the hold', async () => {
    // The hold on an approval order is the ORDER's `stock_hold_expires_at`, which
    // `ix_order_hold` indexes for exactly this sweep. Proven here as the state
    // the releasing job selects on, and that the units are genuinely held until
    // then rather than merely marked.
    await withPolicy(null);
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 2 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    await asBuyer(() => checkout.begin(cartId));
    const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [row] = await db.$queryRaw<Array<{ stock_hold_expires_at: Date; status: string }>>`
      SELECT stock_hold_expires_at, status::text AS status FROM ordering."order"
       WHERE id = ${order.orderId}::uuid`;
    expect(row!.status).toBe('AWAITING_APPROVAL');
    expect(row!.stock_hold_expires_at.getTime() - NOW.getTime()).toBe(24 * 3_600_000);

    // The database will not accept a held order with no deadline at all.
    await expect(
      db.$executeRaw`
        UPDATE ordering."order" SET stock_hold_expires_at = NULL WHERE id = ${order.orderId}::uuid`,
    ).rejects.toThrow(/chk_held_order_has_expiry|violates check constraint/i);
  });
});

/* ==========================================================================
 * Buyer status, PO reference, payment modes
 * ======================================================================== */

describe('who may check out, and on what terms', () => {
  it('refuses an unverified buyer organisation, and takes no hold', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await db.$executeRaw`
      UPDATE identity.organization SET status = 'REGISTERED'::org_status
       WHERE id = ${buyerOrgId}::uuid`;

    await expect(asBuyer(() => checkout.begin(cartId))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    // A refused checkout must never take stock off sale.
    expect(await counters(offer.listingId)).toMatchObject({ qty_available: 1, qty_reserved: 0 });
  });

  it('makes the PO reference mandatory when the organisation requires one', async () => {
    await db.$executeRaw`
      UPDATE customer.org_preference SET po_required = TRUE WHERE org_id = ${buyerOrgId}::uuid`;
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);

    const session = await asBuyer(() => checkout.begin(cartId));
    expect(session.poRequired).toBe(true);

    await expect(asBuyer(() => checkout.confirm(confirmArgs(cartId)))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { buyerPoNumber: expect.stringContaining('PO reference') },
    });

    const order = await asBuyer(() =>
      checkout.confirm({ ...confirmArgs(cartId), buyerPoNumber: 'PO/2026/00417' }),
    );
    const [row] = await db.$queryRaw<Array<{ buyer_po_number: string }>>`
      SELECT buyer_po_number FROM ordering."order" WHERE id = ${order.orderId}::uuid`;
    expect(row!.buyer_po_number).toBe('PO/2026/00417');
  });

  it('offers only the payment modes this buyer may use, with the reason on the rest', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    const session = await asBuyer(() => checkout.begin(cartId));

    const credit = session.paymentModes.find((m) => m.mode === 'CREDIT')!;
    expect(credit.allowed).toBe(false);
    expect(credit.reason).toContain('credit line');
    expect(session.paymentModes.find((m) => m.mode === 'PREPAID')!.allowed).toBe(true);

    await expect(
      asBuyer(() => checkout.confirm({ ...confirmArgs(cartId), paymentMode: 'CREDIT' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('never reports receiving hours it does not have', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    const session = await asBuyer(() => checkout.begin(cartId));

    const site = session.deliverySites.find((s) => s.id === haryanaSiteId)!;
    expect(site.receivingHours).toBeNull();
    expect(site.gateInstructions).toContain('security desk 2');
    expect(site.contactMobile).toBe('+919812345678');
  });
});

/* ==========================================================================
 * The transaction, called directly — the sixteen steps with no screen at all
 * ======================================================================== */

describe('the transaction as an API, with no hold in front of it', () => {
  it('does all sixteen steps in one BEGIN…COMMIT', async () => {
    const v = await makeVendor();
    const offer = await makeOffer({ vendorOrgId: v.orgId, pickupAddressId: v.addressId, qty: 1 });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);

    const result = await asBuyer(() =>
      orders.confirm({
        cartId,
        buyerOrgId,
        buyerUserId,
        billingGstProfileId: gstProfileId,
        billingAddressId: haryanaSiteId,
        shippingAddressId: haryanaSiteId,
        buyerPoNumber: null,
        costCentre: null,
        paymentMode: 'PREPAID',
        ourStateCode: '06',
        deliveryStateCode: '06',
        lines: [
          {
            listingId: offer.listingId,
            qty: 1,
            skuId,
            grade: 'A',
            unitPrice: Money.rupees(RETAIL),
            gstRatePct: 18,
            supplyPointLabel: 'Supply Point A · Gurugram',
          },
        ],
        freightByVendor: new Map([[v.orgId, Money.rupees(149)]]),
        approval: null,
        holdExpiresAt: new Date(NOW.getTime() + 20 * 60_000),
      }),
    );

    expect(result.serials).toHaveLength(1);
    expect(result.purchaseOrderIds).toHaveLength(1);
    expect(result.grandTotal.toString()).toBe(
      Money.rupees(RETAIL + 149)
        .add(Money.percentOf(Money.rupees(RETAIL + 149), 18))
        .toString(),
    );
    // The cart is spent, so a replayed POST cannot order the same thing twice.
    const [cart] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM ordering.cart WHERE id = ${cartId}::uuid`;
    expect(cart!.status).toBe('CONVERTED');
  });
});

/* ==========================================================================
 * Reading an order back — the record T17 renders
 * ======================================================================== */

/** A buyer at a DIFFERENT organisation, with a real principal of their own. */
function asOtherBuyer<T>(orgId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = ['CUSTOMER_BUYER'];
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal({
      userId,
      orgId,
      orgType: 'BUYER',
      roles,
      permissions: permissionsFor(roles),
      sessionId: 's',
      mfaSatisfied: true,
    });
    return fn();
  });
}

describe('the buyer reads their order back', () => {
  it('carries the allocated serials, grouped by dispatch point, and no vendor anywhere', async () => {
    const vendorA = await makeVendor(HARYANA);
    const vendorB = await makeVendor(DELHI);
    const a = await makeOffer({
      vendorOrgId: vendorA.orgId,
      pickupAddressId: vendorA.addressId,
      qty: 2,
      city: HARYANA.city,
    });
    const b = await makeOffer({
      vendorOrgId: vendorB.orgId,
      pickupAddressId: vendorB.addressId,
      qty: 1,
      city: DELHI.city,
    });
    const cartId = await makeCart([
      { listingId: a.listingId, qty: 2 },
      { listingId: b.listingId, qty: 1 },
    ]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const record = await asBuyer(() => readOrder.byNumber(placed.orderNumber));

    expect(record.unitsAllocated).toBe(3);
    expect(record.dispatchGroups).toHaveLength(2);
    expect(
      record.dispatchGroups
        .flatMap((g) => g.machines)
        .map((m) => m.serialNumber)
        .sort(),
    ).toEqual([...a.serials, ...b.serials].sort());
    for (const group of record.dispatchGroups) {
      expect(group.label).toMatch(/^Supply Point [A-Z]+ · /);
    }
    expect(record.grandTotal).toBe(placed.grandTotal);
    expect(record.approval).toBeNull();

    // The whole payload, swept for the two vendors actually behind it.
    const json = JSON.stringify(record);
    for (const orgId of [vendorA.orgId, vendorB.orgId]) expect(json).not.toContain(orgId);
    const names = await db.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization
       WHERE id IN (${vendorA.orgId}::uuid, ${vendorB.orgId}::uuid)`;
    for (const { legal_name } of names) expect(json).not.toContain(legal_name);
  });

  /**
   * The one that matters. Not "a scope exists" — another organisation's buyer
   * ASKS for the order, by its real number, and is refused.
   */
  it('refuses an order that belongs to another organisation, without confirming it exists', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const otherOrgId = await makeOrganization(
      { org_type: 'BUYER', legal_name: 'Meridian Devices Pvt Ltd' },
      db,
    );
    const otherUserId = await makeUser(otherOrgId, { full_name: 'Anita Rao' }, db);

    const refusal = await asOtherBuyer(otherOrgId, otherUserId, () =>
      readOrder.byNumber(placed.orderNumber).then(
        () => null,
        (e: Error & { httpStatus?: number; code?: string }) => e,
      ),
    );

    expect(refusal).not.toBeNull();
    // 404, not 403. Order numbers are sequential, so "you may not see
    // TT-26-00004" confirms TT-26-00004 exists and turns the route into an
    // order-volume oracle for anyone with an account.
    expect(refusal?.httpStatus).toBe(404);
    expect(refusal?.code).toBe('NOT_FOUND');
    expect(refusal?.message).not.toContain(placed.orderNumber);
  });

  it('reports a PENDING approval past its deadline as EXPIRED, not as still waiting', async () => {
    const approverId = await makeUser(buyerOrgId, { full_name: 'Suresh Pillai' }, db);
    await db.$executeRaw`
      INSERT INTO customer.buyer_approval_policy (org_id, user_id, requires_approval_above,
                                                  approver_user_id, is_active)
      VALUES (${buyerOrgId}::uuid, ${buyerUserId}::uuid, 1000, ${approverId}::uuid, TRUE)`;
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));
    expect(placed.status).toBe('AWAITING_APPROVAL');

    const pending = await asBuyer(() => readOrder.byNumber(placed.orderNumber));
    expect(pending.approval?.status).toBe('PENDING');
    expect(pending.approval?.approverName).toBe('Suresh Pillai');

    // The release job runs on a schedule, so past the deadline the row still
    // reads PENDING. The true statement is that our own 24 hours ran out.
    await db.$executeRaw`
      UPDATE ordering.order_approval SET expires_at = ${new Date(NOW.getTime() - 60_000)}
       WHERE order_id IN (SELECT id FROM ordering."order"
                           WHERE order_number = ${placed.orderNumber})`;
    const expired = await asBuyer(() => readOrder.byNumber(placed.orderNumber));
    expect(expired.approval?.status).toBe('EXPIRED');
  });

  it('never reaches the purchase order, at any depth', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    // A purchase order really was raised: this is not a case of there being
    // nothing to leak. Two reads, one per schema — `no-cross-schema-join` is
    // the rule this whole test exists to defend, and it caught the one-query
    // version of it.
    const [order] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering."order" WHERE order_number = ${placed.orderNumber}`;
    const [po] = await db.$queryRaw<Array<{ po_number: string }>>`
      SELECT po_number FROM procurement.purchase_order WHERE order_id = ${order!.id}::uuid`;
    expect(po?.po_number).toMatch(/^PO-/);

    const json = JSON.stringify(await asBuyer(() => readOrder.byNumber(placed.orderNumber)));
    expect(json).not.toContain(po!.po_number);
    // The agreed payout to the supply point. A retail screen must never carry it.
    expect(json).not.toContain(String(VENDOR_ASK));
    for (const word of ['vendor', 'supplier', 'purchase_order', 'suborder', 'payout']) {
      expect(json.toLowerCase()).not.toContain(word);
    }
  });
});

/**
 * The board (T20) and the dashboard figures (T19), which widen the same read
 * from one order to all of them — and therefore widen the same three ways of
 * getting it wrong.
 *
 * The scoping test is the one that matters and it is deliberately not "the
 * guard exists": it places an order as one organisation, then asks for the
 * board and the dashboard as a DIFFERENT one, and expects the order to be
 * absent and every figure to be zero. A list that filtered after the read, or
 * one that trusted a service-layer check somebody later moves, passes nothing
 * here.
 */
describe('the buyer reads their orders back as a board', () => {
  const board = (query: Partial<OrderListQueryDto> = {}) =>
    orderBoard.list({ sort: 'recent', page: 1, per: 10, ...query });

  it('finds an order by its number, by the buyer’s own PO reference, and by a serial', async () => {
    const vendor = await makeVendor(HARYANA);
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
      city: HARYANA.city,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 2 }]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const record = await asBuyer(() => readOrder.byNumber(placed.orderNumber));
    const serial = record.dispatchGroups[0]!.machines[0]!.serialNumber;

    const byNumber = await asBuyer(() => board({ q: placed.orderNumber }));
    expect(byNumber.orders.map((o) => o.orderNumber)).toContain(placed.orderNumber);

    const bySerial = await asBuyer(() => board({ q: serial }));
    const hit = bySerial.orders.find((o) => o.orderNumber === placed.orderNumber);
    expect(hit).toBeDefined();
    // The row has to be able to say WHY it is in the result, or a serial search
    // reads as a mistake.
    expect(hit!.matchedSerials).toContain(serial);
    expect(hit!.unitsAllocated).toBe(2);

    if (record.buyerPoNumber) {
      const byPo = await asBuyer(() => board({ q: record.buyerPoNumber! }));
      expect(byPo.orders.map((o) => o.orderNumber)).toContain(placed.orderNumber);
    }
  });

  it('does not put one organisation’s order on another organisation’s board', async () => {
    const vendor = await makeVendor(HARYANA);
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
      city: HARYANA.city,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const otherOrgId = await makeOrganization(
      { org_type: 'BUYER', legal_name: 'Meridian Devices Pvt Ltd' },
      db,
    );
    const otherUserId = await makeUser(otherOrgId, { full_name: 'Anita Rao' }, db);

    // Every parameter that could widen the read is pushed at once: the largest
    // page size, and a search for the exact order number.
    const foreign = await asOtherBuyer(otherOrgId, otherUserId, () =>
      orderBoard.list({ sort: 'recent', page: 1, per: 50, q: placed.orderNumber }),
    );
    expect(foreign.total).toBe(0);
    expect(foreign.orders).toEqual([]);

    const unfiltered = await asOtherBuyer(otherOrgId, otherUserId, () =>
      orderBoard.list({ sort: 'recent', page: 1, per: 50 }),
    );
    expect(unfiltered.orders.map((o) => o.orderNumber)).not.toContain(placed.orderNumber);

    // The facets are a second read and would be a second way to leak: a status
    // count of 1 tells a stranger an order exists even with no rows returned.
    for (const option of [...unfiltered.facets.status, ...unfiltered.facets.site]) {
      expect(option.count).toBe(0);
    }

    // And the dashboard, which counts rather than lists.
    const summary = await asOtherBuyer(otherOrgId, otherUserId, () => orderBoard.summary());
    expect(summary.orders).toBe(0);
    expect(summary.machines).toBe(0);
    expect(summary.approvals).toEqual([]);
    expect(summary.approvalSlaHours).toBeNull();
  });

  it('carries no vendor identity and no purchase order of ours on any row', async () => {
    const vendor = await makeVendor(HARYANA);
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
      city: HARYANA.city,
    });
    const cartId = await makeCart([{ listingId: offer.listingId, qty: 1 }]);
    await asBuyer(() => checkout.begin(cartId));
    const placed = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));

    const [order] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering."order" WHERE order_number = ${placed.orderNumber}`;
    const [po] = await db.$queryRaw<Array<{ po_number: string }>>`
      SELECT po_number FROM procurement.purchase_order WHERE order_id = ${order!.id}::uuid`;
    expect(po?.po_number).toMatch(/^PO-/);

    const json = JSON.stringify(await asBuyer(() => board({ per: 50 })));
    expect(json).not.toContain(po!.po_number);
    // The agreed payout to the supply point. A retail screen must never carry it.
    expect(json).not.toContain(String(VENDOR_ASK));
    for (const word of ['vendor', 'supplier', 'purchase_order', 'suborder', 'payout']) {
      expect(json.toLowerCase()).not.toContain(word);
    }

    const dashboard = JSON.stringify(await asBuyer(() => orderBoard.summary()));
    expect(dashboard).not.toContain(po!.po_number);
    for (const word of ['vendor', 'supplier', 'purchase_order', 'suborder', 'payout']) {
      expect(dashboard.toLowerCase()).not.toContain(word);
    }
  });
});
