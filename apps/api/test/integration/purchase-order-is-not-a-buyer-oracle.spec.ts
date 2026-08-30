/**
 * The vendor's purchase-order screens (T32), and the two things only a database
 * can prove about them.
 *
 * **1. Anonymity runs BOTH ways.** Every other anonymity test in this suite
 * keeps a vendor off a buyer's screen. This one is the mirror: a purchase order
 * is joined to `ordering."order"` by a foreign key, it names serials and a place
 * to deliver them, and it is the document where the pressure to leak the
 * customer is highest. So the fixture gives the buyer a distinctive legal name,
 * GSTIN, contact person, mobile number, address label and delivery
 * instruction, and then asserts that **none of those strings appears anywhere in
 * the serialised response**, at any depth, on any of the three routes. A field
 * added to the allow-list by accident fails this rather than shipping.
 *
 * **2. One vendor cannot read another's purchase orders.** The routes take no
 * parameter naming a vendor, so there is no malformed request to reject — the
 * only way this leaks is a `WHERE` that is missing or wrong. The tests below do
 * not assert that a guard exists; they sign in as the neighbour and ask for the
 * PO by its real id, and demand the refusal. The neighbour is given strictly
 * more of everything so a dropped predicate shows up as a bigger number rather
 * than as a passing test.
 *
 * The write path is not exercised here — `checkout-order.spec.ts` proves that
 * `order-transaction.service.ts` writes the PO, its lines, the payable and the
 * TDS accrual in one transaction. This file is about who may read them back.
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
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { EventBusModule } from '../../src/shared/events/event-bus';
import { RedisModule } from '../../src/shared/redis/redis.service';
import { ProcurementModule } from '../../src/modules/procurement';
import { ProcurementController } from '../../src/modules/procurement/procurement.controller';
import {
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from '../../src/shared/errors/domain-errors';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeOrganization, makeUser, seedSellableUnit } from '../support/factories';

/**
 * A fixed instant, with the DATE tracking today.
 *
 * The build ledger records two suites that passed only while the real date
 * matched a literal in the file. Only the time of day is pinned here; nothing
 * below compares against a hard-coded day.
 */
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T06:00:00.000Z`);

/**
 * Everything about the buyer that must never reach a vendor.
 *
 * Deliberately unusual strings: a substring search for "Delhi" would match half
 * the fixture, and a sweep that can pass by coincidence is not a sweep.
 */
const BUYER_SECRETS = {
  legalName: 'Ravensworth Institutional Procurement Pvt Ltd',
  gstin: '07AABCR9603R1ZX',
  contactName: 'Yamuna Balasubramanian',
  mobile: '+919812345678',
  addressLabel: 'Ravensworth head office',
  deliveryInstruction: 'Ask at the Ravensworth security desk for dock 4',
  orderNumber: 'TT-26-T32-0001',
} as const;

let moduleRef: TestingModule;
let controller: ProcurementController;
let ctx: RequestContextService;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  // `ProcurementModule` itself, wired the way the running application wires it —
  // a hand-built provider list would let the module's own imports drift out from
  // under the test, which is how a controller comes to be "tested" and
  // unbuildable at the same time. The infrastructure modules are the ones
  // `catalog` and `qc` pull in behind it.
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

  controller = moduleRef.get(ProcurementController);
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

function principal(orgId: string | null, roles: Role[] = ['VENDOR_OPS']): Principal {
  return {
    userId: randomUUID(),
    orgId,
    orgType: orgId ? 'VENDOR' : 'PLATFORM',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-t32',
    mfaSatisfied: true,
  } as Principal;
}

/** Run exactly as the AuthGuard would have established the caller. */
const as = <T,>(orgId: string | null, fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 'test-t32' }, () => {
    ctx.setPrincipal(principal(orgId));
    return fn();
  });

interface SeededPo {
  vendorOrgId: string;
  poId: string;
  poNumber: string;
  serial: string;
  orderId: string;
}

/**
 * A buyer whose every identifying field is a string we can search for.
 *
 * Created once per test rather than shared, because `truncateAll` runs between
 * them and a fixture that survives truncation is a fixture that lies.
 */
async function makeBuyer(): Promise<{ orgId: string; userId: string; addressId: string; gstProfileId: string }> {
  const orgId = await makeOrganization(
    { org_type: 'BUYER', legal_name: BUYER_SECRETS.legalName },
    raw,
  );
  const userId = await makeUser(orgId, { full_name: BUYER_SECRETS.contactName }, raw);

  const addressId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO identity.org_address
      (id, org_id, type, label, line1, city, state, state_code, pincode,
       contact_name, contact_mobile, delivery_instructions, is_billing_enabled)
    VALUES (${addressId}::uuid, ${orgId}::uuid, 'SHIPPING'::address_type,
            ${BUYER_SECRETS.addressLabel}, '11th floor, Barakhamba Road',
            'New Delhi', 'Delhi', '07', '110001',
            ${BUYER_SECRETS.contactName}, ${BUYER_SECRETS.mobile},
            ${BUYER_SECRETS.deliveryInstruction}, TRUE)`;

  const gstProfileId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${orgId}::uuid, ${BUYER_SECRETS.gstin},
            ${BUYER_SECRETS.legalName}, '07', 'ACTIVE', ${NOW}, TRUE)`;

  // No `kyc.pan_record` here on purpose: the PAN is stored encrypted
  // (`pan_enc`), so there is no plaintext column a join could reach and a sweep
  // for the PAN string could never fail. What IS plaintext on that row is
  // `name_as_per_pan`, which is the legal name — already in the sweep below.

  return { orgId, userId, addressId, gstProfileId };
}

/**
 * One vendor, one machine, one order, one purchase order.
 *
 * Inserted directly rather than driven through checkout: this file is about the
 * READ path, and `checkout-order.spec.ts` already proves the write. The shape
 * matches what `order-transaction.service.ts` writes, column for column — if it
 * ever stops matching, that is a real divergence and this fixture should follow
 * it rather than be exempted.
 */
async function seedPo(opts: {
  buyer: Awaited<ReturnType<typeof makeBuyer>>;
  orderNumber: string;
  poNumber: string;
  payout: string;
  vendorOrgId?: string;
}): Promise<SeededPo> {
  const unit = await seedSellableUnit({ vendorOrgId: opts.vendorOrgId }, raw);

  const orderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, grand_total, status)
    VALUES (${orderId}::uuid, ${opts.orderNumber}, ${opts.buyer.orgId}::uuid,
            ${opts.buyer.userId}::uuid, ${opts.buyer.gstProfileId}::uuid,
            ${opts.buyer.addressId}::uuid, ${opts.buyer.addressId}::uuid,
            60000.00, 10800.00, 70800.00, 'CONFIRMED'::order_status)`;

  const poId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO procurement.purchase_order
      (id, po_number, vendor_org_id, order_id, status, total_net,
       tds_rate_pct, tds_amount, valuation_method, terms_days)
    VALUES (${poId}::uuid, ${opts.poNumber}, ${unit.vendorOrgId}::uuid, ${orderId}::uuid,
            'RAISED', ${opts.payout}::numeric, 0, 0, 'REGULAR', 15)`;

  await raw.$executeRaw`
    INSERT INTO procurement.purchase_order_line
      (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, qc_report_id)
    VALUES (${poId}::uuid, ${unit.unitId}::uuid, ${unit.skuId}::uuid,
            ${opts.payout}::numeric, 'A'::public.grade_type, ${unit.qcReportId}::uuid)`;

  return {
    vendorOrgId: unit.vendorOrgId,
    poId,
    poNumber: opts.poNumber,
    serial: unit.serial,
    orderId,
  };
}

const page = { page: 1, pageSize: 50 } as const;

describe('a vendor reads only their own purchase orders', () => {
  it('the neighbour’s purchase orders are absent from the board, and they have more', async () => {
    const buyer = await makeBuyer();
    const mine = await seedPo({
      buyer,
      orderNumber: BUYER_SECRETS.orderNumber,
      poNumber: 'PO-T32-0001',
      payout: '46010.00',
    });
    // Strictly more, so a dropped org predicate cannot coincide with the answer.
    const neighbourA = await seedPo({
      buyer,
      orderNumber: 'TT-26-T32-0002',
      poNumber: 'PO-T32-0002',
      payout: '99999.00',
    });
    const neighbourB = await seedPo({
      buyer,
      orderNumber: 'TT-26-T32-0003',
      poNumber: 'PO-T32-0003',
      payout: '88888.00',
      vendorOrgId: neighbourA.vendorOrgId,
    });

    const board = await as(mine.vendorOrgId, () => controller.list({ ...page }));

    expect(board.total).toBe(1);
    expect(board.rows.map((r) => r.poNumber)).toEqual(['PO-T32-0001']);
    expect(JSON.stringify(board)).not.toContain(neighbourA.poNumber);
    expect(JSON.stringify(board)).not.toContain(neighbourB.poNumber);
  });

  it('refuses the neighbour’s purchase order by its real id, on all three routes', async () => {
    const buyer = await makeBuyer();
    const mine = await seedPo({
      buyer,
      orderNumber: BUYER_SECRETS.orderNumber,
      poNumber: 'PO-T32-0001',
      payout: '46010.00',
    });
    const theirs = await seedPo({
      buyer,
      orderNumber: 'TT-26-T32-0002',
      poNumber: 'PO-T32-0002',
      payout: '99999.00',
    });

    // The id is real and the row exists — this is the forbidden thing being
    // attempted, not a guard being inspected.
    await expect(as(mine.vendorOrgId, () => controller.detail(theirs.poId))).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      as(mine.vendorOrgId, () => controller.pickList(theirs.poId)),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      as(mine.vendorOrgId, () => controller.acknowledge(theirs.poId)),
    ).rejects.toBeInstanceOf(NotFoundError);

    // And it is still there afterwards: the refusal did not half-apply.
    const [row] = await raw.$queryRaw<Array<{ status: string; acknowledged_at: Date | null }>>`
      SELECT status::text AS status, acknowledged_at
        FROM procurement.purchase_order WHERE id = ${theirs.poId}::uuid`;
    expect(row?.status).toBe('RAISED');
    expect(row?.acknowledged_at).toBeNull();
  });

  it('the status counts count one vendor, not two', async () => {
    const buyer = await makeBuyer();
    const mine = await seedPo({
      buyer,
      orderNumber: BUYER_SECRETS.orderNumber,
      poNumber: 'PO-T32-0001',
      payout: '46010.00',
    });
    await seedPo({
      buyer,
      orderNumber: 'TT-26-T32-0002',
      poNumber: 'PO-T32-0002',
      payout: '99999.00',
    });

    const counts = await as(mine.vendorOrgId, () => controller.statusCounts());
    expect(counts.total).toBe(1);
    expect(counts.counts.RAISED).toBe(1);
    // Every status present with a zero, so the client never has to guess what an
    // absent key means.
    expect(counts.counts.PAID).toBe(0);
  });

  it('refuses a caller with no organisation at all', async () => {
    await expect(as(null, () => controller.list({ ...page }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('a purchase order never names the buyer', () => {
  it('carries none of the buyer’s identifiers on the board, the record or the pick list', async () => {
    const buyer = await makeBuyer();
    const mine = await seedPo({
      buyer,
      orderNumber: BUYER_SECRETS.orderNumber,
      poNumber: 'PO-T32-0001',
      payout: '46010.00',
    });

    const [board, detail, pickList] = await as(mine.vendorOrgId, async () => [
      await controller.list({ ...page }),
      await controller.detail(mine.poId),
      await controller.pickList(mine.poId),
    ]);

    // The whole payload, serialised — nesting is not an escape.
    const payloads = {
      board: JSON.stringify(board),
      detail: JSON.stringify(detail),
      pickList: JSON.stringify(pickList),
    };

    const forbidden: Array<[string, string]> = [
      ['buyer legal name', BUYER_SECRETS.legalName],
      ['buyer GSTIN', BUYER_SECRETS.gstin],
      ['buyer contact name', BUYER_SECRETS.contactName],
      ['buyer mobile', BUYER_SECRETS.mobile],
      // A label reading "Ravensworth head office" names the customer as surely
      // as a GSTIN does, and it sits on the same row as the street.
      ['buyer address label', BUYER_SECRETS.addressLabel],
      ['delivery instructions', BUYER_SECRETS.deliveryInstruction],
      // Order numbers are sequential. Two of them a fortnight apart would let a
      // vendor read the platform's order volume off the difference.
      ['buyer order number', BUYER_SECRETS.orderNumber],
      ['buyer org id', buyer.orgId],
      ['buyer user id', buyer.userId],
      ['order id', mine.orderId],
    ];

    for (const [what, secret] of forbidden) {
      for (const [route, payload] of Object.entries(payloads)) {
        expect(`${route} carries the ${what}: ${payload.includes(secret)}`).toBe(
          `${route} carries the ${what}: false`,
        );
      }
    }

    // The positive half. A test that only proves absence would pass against a
    // route that returned nothing at all.
    expect(detail.poNumber).toBe('PO-T32-0001');
    expect(detail.lines[0]?.serialNumber).toBe(mine.serial);
    expect(detail.lines[0]?.seal?.code).toMatch(/^TRG-/);
    expect(detail.deliverTo).toEqual({ city: 'New Delhi', state: 'Delhi' });
    expect(pickList.shipTo?.line1).toBe('11th floor, Barakhamba Road');
  });

  it('puts no money on the pick list, at any depth', async () => {
    const buyer = await makeBuyer();
    const mine = await seedPo({
      buyer,
      orderNumber: BUYER_SECRETS.orderNumber,
      poNumber: 'PO-T32-0001',
      // A distinctive amount: "46010" would also appear inside a uuid by chance
      // roughly never, but this one cannot be mistaken for anything else.
      payout: '43219.00',
    });

    const [detail, pickList] = await as(mine.vendorOrgId, async () => [
      await controller.detail(mine.poId),
      await controller.pickList(mine.poId),
    ]);

    // The record screen shows what the vendor is owed — that is theirs to know.
    expect(JSON.stringify(detail)).toContain('43219');
    // The document that travels with the goods does not. s.10(1)(b) IGST:
    // Bill-To-Ship-To means neither invoice value goes in the box.
    expect(JSON.stringify(pickList)).not.toContain('43219');
    expect(JSON.stringify(pickList)).not.toContain('agreedNetPayout');
    expect(JSON.stringify(pickList)).not.toContain('totalNet');
  });
});

describe('acknowledging a purchase order', () => {
  it('records the acceptance once and refuses the second attempt by name', async () => {
    const buyer = await makeBuyer();
    const mine = await seedPo({
      buyer,
      orderNumber: BUYER_SECRETS.orderNumber,
      poNumber: 'PO-T32-0001',
      payout: '46010.00',
    });

    const first = await as(mine.vendorOrgId, () => controller.acknowledge(mine.poId));
    expect(first.status).toBe('ACKNOWLEDGED');
    expect(first.acknowledgedAt).toEqual(NOW);

    // Not "that did not go through". The refusal names the PO and the state it
    // found, because an unexplained failure on a button you already pressed is
    // indistinguishable from a broken one.
    await expect(
      as(mine.vendorOrgId, () => controller.acknowledge(mine.poId)),
    ).rejects.toThrow(/PO-T32-0001 was already acknowledged/);
    await expect(
      as(mine.vendorOrgId, () => controller.acknowledge(mine.poId)),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  /**
   * The permission split this module relies on, asserted as the contract it is.
   *
   * This is not the enforcement — `PermissionsGuard` is, and it is exercised in
   * `auth-and-scope.spec.ts`. What it does prove is that the split the screen
   * and the controller were written against is real: VENDOR_FINANCE reads a
   * purchase order and cannot promise the machines on it, which is why the
   * record screen disables Accept with a reason instead of hiding the page.
   */
  it('VENDOR_FINANCE may read a purchase order and may not accept one', () => {
    const finance = permissionsFor(['VENDOR_FINANCE']);
    expect(finance).toContain('procurement.po.read_own');
    expect(finance).not.toContain('procurement.po.acknowledge');

    const ops = permissionsFor(['VENDOR_OPS']);
    expect(ops).toContain('procurement.po.acknowledge');
  });
});

/**
 * A vendor with no purchase orders is not an error, and the address lookup for
 * an order with no address does not take the board down.
 */
describe('the states with nothing in them', () => {
  it('an empty board is an empty board', async () => {
    const orgId = await makeOrganization({}, raw);
    await makeAddress(orgId, {}, raw);
    const board = await as(orgId, () => controller.list({ ...page }));
    expect(board).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
  });
});
