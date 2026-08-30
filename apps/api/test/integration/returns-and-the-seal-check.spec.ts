/**
 * T24 — the 48-hour return window and the buyer's own seal check, against the
 * real database.
 *
 * **Every guard here is tested by attempting the forbidden thing, and every one
 * has a control case beside it** — because a route that is simply broken refuses
 * everything, and a suite of refusals with no successes cannot tell the two
 * apart. Three attacks, three controls:
 *
 *   1. **A return outside the window is refused, one inside is allowed.** The
 *      same order, the same machine, one clock tick apart. Nothing about the
 *      fixture differs except the instant, so the refusal can only have come
 *      from the window.
 *
 *   2. **A seal that is not on this delivery is refused, one that is is
 *      allowed.** The stranger is a REAL seal on a REAL machine belonging to
 *      somebody else, not a made-up string: a manifest lookup that fell back to
 *      "is this a valid seal anywhere" would pass a garbage code and fail this.
 *      The refusal carries §3A.3's own sentence.
 *
 *   3. **A second organisation cannot raise a return on the first's order, or
 *      read their return by its real number.** Both are NOT FOUND and never
 *      FORBIDDEN — order and return numbers carry counters, and "you may not see
 *      that one" confirms it exists. The control is the owner doing both
 *      successfully, in the same test.
 *
 * The clock is fixed and every window assertion is made against it.
 * `04_TEST_PLAN.md` §1.4.1 forbids `Date.now()` for exactly this reason, and
 * this is the single most time-dependent rule in the product: when the window
 * closes, the buyer's remedy changes from a return to a warranty claim.
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
import {
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../src/shared/errors/domain-errors';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { PlatformModule } from '../../src/modules/platform';
import { DeliveryService } from '../../src/modules/ordering/internal/delivery.service';
import { DeliveryCheckService } from '../../src/modules/ordering/internal/delivery-check.service';
import { ReturnsService } from '../../src/modules/platform/internal/returns.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import {
  makeAddress,
  makeCatalog,
  makeListing,
  makeOrganization,
  makeUnit,
} from '../support/factories';

/**
 * A real instant with the DATE tracking today.
 *
 * `ordering.order_event` is partitioned by month, and this suite writes one on
 * every confirmed receipt — so a literal date here is the time bomb the build
 * ledger names. The TIME is fixed; the DATE follows the clock.
 */
const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T06:00:00.000Z');

/** `ordering.inspection_window_hours`, seeded. Asserted, never assumed. */
const WINDOW_HOURS = 48;
const HOUR_MS = 3_600_000;

let moduleRef: TestingModule;
let prisma: PrismaService;
let ctx: RequestContextService;
let redis: RedisService;
let clock: FixedClock;
let delivery: DeliveryService;
let check: DeliveryCheckService;
let returns: ReturnsService;

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

interface Machine {
  serial: string;
  unitId: string;
  sealCode: string;
}

interface Fixture {
  orgId: string;
  userId: string;
  orderNumber: string;
  machines: Machine[];
  principal: Principal;
}

let counter = 0;

/**
 * One buyer, one order, one consignment, `units` machines — each with a real QC
 * report and a real photographed seal.
 *
 * Raw inserts rather than checkout: this suite is about what happens after an
 * order exists, and driving the cart to get there would make a window test fail
 * for a pricing reason. **`order_line_unit.qc_report_id` is set**, because that
 * column is how the delivery manifest resolves a seal at all — a fixture that
 * omitted it would render a manifest with no seals and pass every test in this
 * file for the wrong reason.
 */
async function anOrder(input: { orgName: string; units?: number }): Promise<Fixture> {
  const buyerOrgId = await makeOrganization(
    { legal_name: input.orgName, org_type: 'BUYER', status: 'VERIFIED' },
    db,
  );
  const vendorOrgId = await makeOrganization(
    { legal_name: `${input.orgName} Supply`, org_type: 'VENDOR', status: 'VERIFIED' },
    db,
  );
  const userId = randomUUID();
  counter += 1;
  await db.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, mobile, password_hash,
                                       status, is_org_owner, terms_accepted_version)
    VALUES (${userId}::uuid, ${buyerOrgId}::uuid, 'Test Buyer',
            ${`buyer-t24-${counter}@example.test`},
            ${`+9198100000${String(counter).padStart(2, '0')}`},
            'x', 'ACTIVE', TRUE, 'v1')`;

  const pickupAddressId = await makeAddress(vendorOrgId, {}, db);
  const catalog = await makeCatalog({ skuCode: `SKU-T24-${counter}` }, db);
  const units = input.units ?? 1;
  const listingId = await makeListing(
    { vendorOrgId, skuId: catalog.skuId, pickupAddressId, qty: units },
    db,
  );

  const orderId = randomUUID();
  const subOrderId = randomUUID();
  const orderLineId = randomUUID();
  const orderNumber = `TT-99-${String(counter).padStart(5, '0')}`;

  const billingAddressId = await makeAddress(buyerOrgId, {}, db);
  const gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 registration_type, status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid,
            ${`06AAJCT${String(3000 + counter).padStart(4, '0')}R1ZL`}, ${input.orgName},
            '06', 'REGULAR', 'ACTIVE', now(), TRUE)`;

  await db.$executeRaw`
    INSERT INTO ordering."order" (id, order_number, buyer_org_id, buyer_user_id,
                                  billing_gst_profile_id, billing_address_id, shipping_address_id,
                                  subtotal, gst_total, freight_total, grand_total,
                                  payment_status, status, placed_at, stock_hold_expires_at)
    VALUES (${orderId}::uuid, ${orderNumber}, ${buyerOrgId}::uuid, ${userId}::uuid,
            ${gstProfileId}::uuid, ${billingAddressId}::uuid, ${billingAddressId}::uuid,
            42000, 7560, 0, 49560,
            'PAID'::public.payment_status, 'DISPATCHED'::public.order_status, ${NOW},
            ${new Date(NOW.getTime() + 86_400_000)})`;
  await db.$executeRaw`
    INSERT INTO ordering.sub_order (id, order_id, sub_order_number, vendor_org_id,
                                    subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${`${orderNumber}-1`}, ${vendorOrgId}::uuid,
            42000, 7560, 'DISPATCHED'::public.order_status)`;
  await db.$executeRaw`
    INSERT INTO ordering.order_line (id, sub_order_id, listing_id, sku_id, grade, qty,
                                     unit_price, line_total, gst_rate, gst_amount, status)
    VALUES (${orderLineId}::uuid, ${subOrderId}::uuid, ${listingId}::uuid, ${catalog.skuId}::uuid,
            'A'::grade_type, ${units}, 42000, ${42000 * units}, 18, 7560,
            'DISPATCHED'::public.order_status)`;

  const machines: Machine[] = [];
  for (let i = 0; i < units; i += 1) {
    const unit = await makeUnit(
      { listingId, vendorOrgId, skuId: catalog.skuId, status: 'RESERVED' },
      db,
    );
    await db.$executeRaw`
      INSERT INTO ordering.order_line_unit (order_line_id, unit_id, serial_number, status,
                                            qc_report_id)
      VALUES (${orderLineId}::uuid, ${unit.unitId}::uuid, ${unit.serial},
              'RESERVED'::unit_status, ${unit.qcReportId}::uuid)`;
    const [seal] = await db.$queryRaw<Array<{ seal_code: string }>>`
      SELECT seal_code FROM qc.qc_seal WHERE unit_id = ${unit.unitId}::uuid`;
    machines.push({ serial: unit.serial, unitId: unit.unitId, sealCode: seal!.seal_code });
  }

  return {
    orgId: buyerOrgId,
    userId,
    orderNumber,
    machines,
    principal: buyerPrincipal(buyerOrgId, userId),
  };
}

/** The whole fixture, delivered. `delivered_at` comes from the fixed clock. */
async function delivered(input: { orgName: string; units?: number }): Promise<Fixture> {
  const order = await anOrder(input);
  await as(staffPrincipal(), () => delivery.record(order.orderNumber));
  return order;
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
  check = moduleRef.get(DeliveryCheckService);
  returns = moduleRef.get(ReturnsService);
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
 * 1. The window
 * ======================================================================== */

describe('the 48-hour inspection window', () => {
  it('is the configured number of hours from delivery, and the server decides both ends', async () => {
    const order = await delivered({ orgName: 'Window Buyer Ltd' });

    const view = await as(order.principal, () => check.manifest(order.orderNumber));
    expect(view.windowHours).toBe(WINDOW_HOURS);
    expect(view.consignments).toHaveLength(1);

    const w = view.consignments[0]!.window!;
    expect(w.open).toBe(true);
    // Both ends from ClockPort: delivery stamped it, and "has it closed" is
    // decided against the same clock. The T25 defect was exactly this pair
    // coming from two different sources and disagreeing by two hours.
    expect(new Date(w.closesAt).getTime()).toBe(NOW.getTime() + WINDOW_HOURS * HOUR_MS);
    expect(w.hoursRemaining).toBe(WINDOW_HOURS);
  });

  it('refuses a return AFTER the window and allows one INSIDE it — same order, one tick apart', async () => {
    const order = await delivered({ orgName: 'Tick Buyer Ltd', units: 2 });
    const [first, second] = order.machines;

    // CONTROL: one minute before the window closes, the return lands.
    clock.advanceTo(new Date(NOW.getTime() + WINDOW_HOURS * HOUR_MS - 60_000));
    const raised = await as(order.principal, () =>
      returns.raise({
        orderNumber: order.orderNumber,
        serialNumbers: [first!.serial],
        reasonCode: 'GRADE_MISMATCH',
        description: 'The lid is scratched right across and that is not on any inspection photo.',
        evidenceKeys: [],
      }),
    );
    expect(raised.returns).toHaveLength(1);
    expect(raised.returns[0]!.returnNumber).toMatch(/^TT-RET-\d{4}-[0-9A-F]{8}$/);

    // ATTACK: two minutes later the window has closed, and the SAME order, the
    // SAME reason and a machine on the same consignment is refused. Nothing
    // differs but the instant, so the refusal can only be the window.
    clock.advanceTo(new Date(NOW.getTime() + WINDOW_HOURS * HOUR_MS + 60_000));
    await expect(
      as(order.principal, () =>
        returns.raise({
          orderNumber: order.orderNumber,
          serialNumbers: [second!.serial],
          reasonCode: 'GRADE_MISMATCH',
          description: 'The lid is scratched right across and that is not on any inspection photo.',
          evidenceKeys: [],
        }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    // And nothing half-applied: still exactly the one return.
    const [counted] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.return_request`;
    expect(Number(counted!.count)).toBe(1);
  });

  it('states the exact closing instant in the refusal, and routes to warranty', async () => {
    const order = await delivered({ orgName: 'Closed Buyer Ltd' });
    clock.advanceTo(new Date(NOW.getTime() + (WINDOW_HOURS + 1) * HOUR_MS));

    const eligibility = await as(order.principal, () =>
      returns.eligibility(order.orderNumber),
    );
    const machine = eligibility.machines[0]!;
    expect(machine.window!.open).toBe(false);
    expect(machine.window!.hoursRemaining).toBe(0);
    // Never negative, and the sentence carries both the instant and the way out.
    expect(machine.blockedReason).toContain(machine.window!.closesAt);
    expect(machine.blockedReason).toContain('warranty');
  });

  it('says nothing has started rather than that a window closed, when the machine has not arrived', async () => {
    const order = await anOrder({ orgName: 'Undelivered Buyer Ltd' });

    const eligibility = await as(order.principal, () =>
      returns.eligibility(order.orderNumber),
    );
    const machine = eligibility.machines[0]!;
    expect(machine.deliveredAt).toBeNull();
    // Null, not a zero-hour window. "Nothing has started" and "it is over" are
    // opposite facts and a screen that confused them would tell a buyer they had
    // missed a deadline that has not begun.
    expect(machine.window).toBeNull();
    expect(machine.blockedReason).toContain('has not reached you yet');
  });
});

/* ==========================================================================
 * 2. The seal check at the door
 * ======================================================================== */

describe('the buyer’s seal check', () => {
  it('turns APPLIED into INTACT, and only this screen does', async () => {
    const order = await delivered({ orgName: 'Seal Buyer Ltd' });
    const machine = order.machines[0]!;

    const before = await as(order.principal, () => check.manifest(order.orderNumber));
    expect(before.consignments[0]!.machines[0]!.seal!.status).toBe('APPLIED');
    // APPLIED blocks the handover on its own: a seal nobody has looked at is not
    // an intact one, which is the entire premise of this screen.
    expect(before.consignments[0]!.machines[0]!.blockedReason).toContain('Nobody has checked');
    expect(before.consignments[0]!.blockedReason).toContain('nobody has looked at yet');

    const result = await as(order.principal, () =>
      check.check(order.orderNumber, { sealCode: machine.sealCode, outcome: 'INTACT' }),
    );
    expect(result.status).toBe('INTACT');
    expect(result.returnNumber).toBeNull();
    expect(result.delivery.consignments[0]!.machines[0]!.blockedReason).toBeNull();
    expect(result.delivery.consignments[0]!.blockedReason).toBeNull();

    // The buyer, on `qc_seal.verified_by`, and not the technician who sealed it.
    const [row] = await db.$queryRaw<Array<{ verified_by: string; verified_at: Date }>>`
      SELECT verified_by, verified_at FROM qc.qc_seal WHERE seal_code = ${machine.sealCode}`;
    expect(row!.verified_by).toBe(order.userId);
    expect(row!.verified_at.getTime()).toBe(NOW.getTime());
  });

  it('refuses a seal that is not on this delivery — a REAL one, belonging to somebody else', async () => {
    const mine = await delivered({ orgName: 'Manifest Buyer Ltd' });
    const theirs = await delivered({ orgName: 'Neighbour Buyer Ltd' });

    // ATTACK. The stranger is a real, valid, currently-APPLIED seal on a real
    // machine — so a lookup that asked "is this a seal we know about" rather
    // than "is this a seal on THIS delivery" would accept it.
    await expect(
      as(mine.principal, () =>
        check.check(mine.orderNumber, {
          sealCode: theirs.machines[0]!.sealCode,
          outcome: 'INTACT',
        }),
      ),
    ).rejects.toMatchObject({
      constructor: ValidationError,
      message: `Seal ${theirs.machines[0]!.sealCode} is not on this delivery. Do not accept this machine.`,
    });

    // The neighbour's seal is untouched — nothing half-applied on a refusal.
    const [neighbour] = await db.$queryRaw<Array<{ status: string; verified_by: string | null }>>`
      SELECT status::text AS status, verified_by FROM qc.qc_seal
       WHERE seal_code = ${theirs.machines[0]!.sealCode}`;
    expect(neighbour!.status).toBe('APPLIED');
    expect(neighbour!.verified_by).toBeNull();

    // CONTROL: the same call with a code that IS on this delivery succeeds, so
    // the refusal above is the manifest and not a broken route.
    const ok = await as(mine.principal, () =>
      check.check(mine.orderNumber, {
        sealCode: mine.machines[0]!.sealCode,
        outcome: 'INTACT',
      }),
    );
    expect(ok.status).toBe('INTACT');
  });

  it('refuses a code that is not a seal anywhere, with the same safety sentence', async () => {
    const order = await delivered({ orgName: 'Garbage Buyer Ltd' });
    await expect(
      as(order.principal, () =>
        check.check(order.orderNumber, { sealCode: 'TRG-26HR-0000000', outcome: 'INTACT' }),
      ),
    ).rejects.toThrow('Do not accept this machine');
  });

  it('opens a discrepancy by itself on a broken seal, and only one when pressed twice', async () => {
    const order = await delivered({ orgName: 'Broken Buyer Ltd' });
    const machine = order.machines[0]!;

    const first = await as(order.principal, () =>
      check.check(order.orderNumber, {
        sealCode: machine.sealCode,
        outcome: 'BROKEN',
        note: 'The sticker was cut through when the box was opened at our gate.',
      }),
    );
    expect(first.status).toBe('BROKEN');
    // One tap. Rule 7(4) take-back is ours and non-delegable, so the buyer must
    // not have to ask for this.
    expect(first.returnNumber).toMatch(/^TT-RET-\d{4}-[0-9A-F]{8}$/);

    const raised = await db.$queryRaw<Array<{ reason_code: string; status: string }>>`
      SELECT reason_code, status FROM platform.return_request`;
    expect(raised).toHaveLength(1);
    expect(raised[0]!.reason_code).toBe('SEAL_BROKEN');
    expect(raised[0]!.status).toBe('RAISED');

    // The unit is off sale on the spot — `SEAL_BROKEN` drops `is_sellable`.
    const [unit] = await db.$queryRaw<Array<{ status: string; is_sellable: boolean }>>`
      SELECT status::text AS status, is_sellable FROM listing.unit
       WHERE id = ${machine.unitId}::uuid`;
    expect(unit!.status).toBe('SEAL_BROKEN');
    expect(unit!.is_sellable).toBe(false);

    // Pressed again: BROKEN is terminal, so `qc` refuses the transition and no
    // second return is written. The count is what proves it, not the clause.
    await expect(
      as(order.principal, () =>
        check.check(order.orderNumber, { sealCode: machine.sealCode, outcome: 'BROKEN' }),
      ),
    ).rejects.toThrow();
    const [counted] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.return_request`;
    expect(Number(counted!.count)).toBe(1);
  });

  it('refuses a seal check once the window has closed, and names the instant', async () => {
    const order = await delivered({ orgName: 'Late Buyer Ltd' });
    clock.advanceTo(new Date(NOW.getTime() + (WINDOW_HOURS + 2) * HOUR_MS));

    await expect(
      as(order.principal, () =>
        check.check(order.orderNumber, {
          sealCode: order.machines[0]!.sealCode,
          outcome: 'INTACT',
        }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});

/* ==========================================================================
 * 3. Signing for the delivery
 * ======================================================================== */

describe('confirming receipt', () => {
  it('is refused while any seal is unchecked, allowed once every one is, and idempotent', async () => {
    const order = await delivered({ orgName: 'Receipt Buyer Ltd', units: 2 });

    // ATTACK: sign for it without looking at anything.
    await expect(
      as(order.principal, () => check.confirmReceipt(order.orderNumber, 1)),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    // Half-checked is still refused, and the refusal names the machine left.
    await as(order.principal, () =>
      check.check(order.orderNumber, {
        sealCode: order.machines[0]!.sealCode,
        outcome: 'INTACT',
      }),
    );
    await expect(
      as(order.principal, () => check.confirmReceipt(order.orderNumber, 1)),
    ).rejects.toThrow(order.machines[1]!.serial);

    // CONTROL: both checked, and it lands.
    await as(order.principal, () =>
      check.check(order.orderNumber, {
        sealCode: order.machines[1]!.sealCode,
        outcome: 'INTACT',
      }),
    );
    const signed = await as(order.principal, () => check.confirmReceipt(order.orderNumber, 1));
    expect(signed.consignments[0]!.receiptConfirmedAt).toBe(NOW.toISOString());

    // Pressed twice: one acceptance on the timeline, not two.
    await as(order.principal, () => check.confirmReceipt(order.orderNumber, 1));
    const [counted] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM ordering.order_event WHERE event_type = 'BUYER_RECEIPT_CONFIRMED'`;
    expect(Number(counted!.count)).toBe(1);
  });

  it('is refused outright when a seal is broken, naming the machines', async () => {
    const order = await delivered({ orgName: 'Blocked Buyer Ltd', units: 2 });
    await as(order.principal, () =>
      check.check(order.orderNumber, {
        sealCode: order.machines[0]!.sealCode,
        outcome: 'INTACT',
      }),
    );
    await as(order.principal, () =>
      check.check(order.orderNumber, {
        sealCode: order.machines[1]!.sealCode,
        outcome: 'BROKEN',
        note: 'Seal cut through on arrival.',
      }),
    );

    await expect(
      as(order.principal, () => check.confirmReceipt(order.orderNumber, 1)),
    ).rejects.toThrow(order.machines[1]!.serial);
  });
});

/* ==========================================================================
 * 4. A return belongs to one organisation
 * ======================================================================== */

describe('org scoping', () => {
  it('refuses a return on another organisation’s order as NOT FOUND, and the owner can still raise one', async () => {
    const mine = await delivered({ orgName: 'Owner Buyer Ltd' });
    const theirs = await delivered({ orgName: 'Attacker Buyer Ltd' });

    // ATTACK, with the real order number and the real serial.
    await expect(
      as(theirs.principal, () =>
        returns.raise({
          orderNumber: mine.orderNumber,
          serialNumbers: [mine.machines[0]!.serial],
          reasonCode: 'DOA',
          description: 'It does not power on at all, no lights, nothing on the charger.',
          evidenceKeys: [],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // 404 and not 403: order numbers are sequential, so a refusal that admitted
    // the order exists would be an order-volume oracle for anyone with an
    // account.
    await expect(
      as(theirs.principal, () => check.manifest(mine.orderNumber)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(theirs.principal, () => returns.eligibility(mine.orderNumber)),
    ).resolves.toMatchObject({ machines: [] });

    // Nothing was written by the attempt.
    const [counted] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM platform.return_request`;
    expect(Number(counted!.count)).toBe(0);

    // CONTROL: the owner does the same thing and it works, so the refusals above
    // are the org predicate and not a route that refuses everybody.
    const raised = await as(mine.principal, () =>
      returns.raise({
        orderNumber: mine.orderNumber,
        serialNumbers: [mine.machines[0]!.serial],
        reasonCode: 'DOA',
        description: 'It does not power on at all, no lights, nothing on the charger.',
        evidenceKeys: [],
      }),
    );
    expect(raised.returns).toHaveLength(1);

    // ATTACK again: read it by its real number as the neighbour.
    const number = raised.returns[0]!.returnNumber;
    await expect(as(theirs.principal, () => returns.view(number))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(as(theirs.principal, () => returns.list())).resolves.toMatchObject({
      returns: [],
    });

    // CONTROL: the owner reads it back.
    await expect(as(mine.principal, () => returns.view(number))).resolves.toMatchObject({
      returnNumber: number,
      serialNumber: mine.machines[0]!.serial,
    });
  });

  it('refuses a serial that is not on the order named, even when the buyer owns both', async () => {
    const first = await delivered({ orgName: 'Two Orders Ltd' });
    // A second order for the SAME organisation. The serial is theirs; it is just
    // not on the order they named, and the endpoint takes one order because the
    // window is per delivery.
    const second = await anOrder({ orgName: 'Two Orders Ltd Second' });

    await expect(
      as(first.principal, () =>
        returns.raise({
          orderNumber: first.orderNumber,
          serialNumbers: [second.machines[0]!.serial],
          reasonCode: 'DOA',
          description: 'It does not power on at all, no lights, nothing on the charger.',
          evidenceKeys: [],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/* ==========================================================================
 * 5. One machine, one live return
 * ======================================================================== */

describe('a machine can carry only one live return', () => {
  it('refuses a second, names the first, and the database backs it', async () => {
    const order = await delivered({ orgName: 'Twice Buyer Ltd' });
    const serial = order.machines[0]!.serial;
    const body = {
      orderNumber: order.orderNumber,
      serialNumbers: [serial],
      reasonCode: 'TRANSIT_DAMAGE' as const,
      description: 'A dent across the lid that is not in any of the inspection photographs.',
      evidenceKeys: [],
    };

    const first = await as(order.principal, () => returns.raise(body));
    await expect(as(order.principal, () => returns.raise(body))).rejects.toThrow(
      first.returns[0]!.returnNumber,
    );

    // The partial unique index is the backstop, and it is attempted directly
    // rather than assumed — a service-only rule on a table whose caller is a
    // button is the shape T23 found on `platform.warranty`.
    const [line] = await db.$queryRaw<Array<{ order_line_unit_id: string }>>`SELECT order_line_unit_id FROM platform.return_request`;
    await expect(
      db.$executeRaw`
        INSERT INTO platform.return_request
               (return_number, order_line_unit_id, buyer_org_id, reason_code, evidence_keys, status)
        VALUES ('TT-RET-9999-DEADBEEF', ${line!.order_line_unit_id}::uuid, ${order.orgId}::uuid,
                'DOA', ARRAY[]::text[], 'RAISED')`,
    ).rejects.toThrow();

    // A REJECTED one does not block a new one: the index predicate and the
    // service agree on which statuses are still live.
    await db.$executeRaw`UPDATE platform.return_request SET status = 'REJECTED'`;
    await expect(as(order.principal, () => returns.raise(body))).resolves.toMatchObject({
      returns: [{ serialNumber: serial }],
    });
  });
});

/* ==========================================================================
 * 6. Nothing on a buyer payload names a supply point
 * ======================================================================== */

describe('vendor anonymity', () => {
  it('carries no vendor identifier on the manifest, the eligibility view or a return', async () => {
    const order = await delivered({ orgName: 'Anonymous Buyer Ltd', units: 2 });
    await as(order.principal, () =>
      check.check(order.orderNumber, {
        sealCode: order.machines[0]!.sealCode,
        outcome: 'BROKEN',
        note: 'Seal cut through on arrival.',
      }),
    );

    const [manifest, eligibility, list] = await Promise.all([
      as(order.principal, () => check.manifest(order.orderNumber)),
      as(order.principal, () => returns.eligibility(order.orderNumber)),
      as(order.principal, () => returns.list()),
    ]);

    for (const payload of [manifest, eligibility, list]) {
      expect(findForbiddenKeys(payload)).toEqual([]);
    }

    // And the vendor's legal name is not in the serialised text at any depth —
    // including inside the description we wrote ourselves on the automatic
    // discrepancy, which is the one string on these payloads we author.
    const text = JSON.stringify({ manifest, eligibility, list });
    expect(text).not.toContain('Supply');
    expect(text).not.toContain('vendor');
    // The dispatch label survives, and it is the anonymised one.
    expect(manifest.consignments[0]!.label).toMatch(/^Delivery 1 of 1 · /);
  });
});
