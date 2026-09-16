/**
 * A vendor's answer moves the customer's order.
 *
 * `respondLines` set the PO's status, rewrote the payable and wrote an
 * `order_event` — and touched `ordering."order"`, `sub_order` and `order_line`
 * not at all. A vendor could acknowledge every line of every PO and the buyer's
 * screen still read exactly as it had the moment they paid.
 *
 * The cases below are the transitions, plus the three things a refusal has to
 * take back with it: the reservation, the accrual and a person's attention.
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
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { ProcurementModule } from '../../src/modules/procurement';
import { CheckoutService } from '../../src/modules/ordering/internal/checkout.service';
import { PurchaseOrderService } from '../../src/modules/procurement/internal/purchase-order.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeCatalog, makeOrganization, makeTechnician, makeUser } from '../support/factories';
import { seedLogisticsNcr } from '../../prisma/seed/logistics-ncr';

const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');
const GURUGRAM = { city: 'Gurugram', state: 'Haryana', stateCode: '06', pincode: '122015' };
const NOIDA = { city: 'Noida', state: 'Uttar Pradesh', stateCode: '09', pincode: '201301' };
const RETAIL = 42_000;
const VENDOR_ASK = 30_000;

let moduleRef: TestingModule;
let checkout: CheckoutService;
let pos: PurchaseOrderService;
let ctx: RequestContextService;
let redis: RedisService;
let db: PrismaClient;

let buyerOrgId: string;
let buyerUserId: string;
let gstProfileId: string;
let siteId: string;
let skuId: string;
let technician: { technicianId: string; userId: string };

function asBuyer<T>(fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = ['CUSTOMER_BUYER'];
  return run(fn, {
    userId: buyerUserId,
    orgId: buyerOrgId,
    orgType: 'BUYER',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  });
}

function asVendor<T>(orgId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = ['VENDOR_OWNER'];
  return run(fn, {
    userId,
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  });
}

function run<T>(fn: () => Promise<T>, principal: Principal): Promise<T> {
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(principal);
    return fn();
  });
}

async function makeVendor(
  place = GURUGRAM,
): Promise<{ orgId: string; userId: string; addressId: string }> {
  const orgId = await makeOrganization({ legal_name: `Northgate ${randomUUID().slice(0, 6)}` }, db);
  const userId = await makeUser(orgId, {}, db);
  await db.$executeRaw`
    INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, verified)
    VALUES (${orgId}::uuid, '\\x00'::bytea, '1234', ${randomUUID()}, TRUE)`;
  const addressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${addressId}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Plot 42, Udyog Vihar',
            ${place.city}, ${place.state}, ${place.stateCode}, ${place.pincode},
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  return { orgId, userId, addressId };
}

async function makeOffer(input: {
  vendorOrgId: string;
  pickupAddressId: string;
  qty: number;
  city?: string;
}): Promise<{ listingId: string }> {
  const listingId = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, gst_rate, qty_total, status)
    VALUES (${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
            ${input.pickupAddressId}::uuid, 'A'::grade_type, 'REFURBISHED'::condition_type,
            'GOOD_80_89'::battery_band, 'ALL_ORIGINAL'::parts_status_type,
            ${RETAIL}, 18.00, ${input.qty}, 'ACTIVE'::listing_status)`;

  const [{ code } = { code: '' }] = await db.$queryRaw<Array<{ code: string }>>`
    SELECT listing.assign_supply_point(${input.vendorOrgId}::uuid,
                                       ${input.city ?? GURUGRAM.city}) AS code`;

  for (let i = 0; i < input.qty; i += 1) {
    const unitId = randomUUID();
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, grade_actual, status, location,
                                qc_passed_at, qc_valid_until, vendor_ask_price,
                                valuation_method, itc_eligible, retail_price, supply_point_code)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
              ${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()},
              'A'::grade_type, 'A'::grade_type, 'LISTED'::unit_status, 'VENDOR',
              ${NOW}, CURRENT_DATE + 60, ${VENDOR_ASK}::numeric,
              'REGULAR', TRUE, ${RETAIL}::numeric, ${code})`;
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
  }
  return { listingId };
}

async function place(
  lines: Array<{ listingId: string; qty: number }>,
): Promise<{ orderId: string }> {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.cart (id, buyer_org_id, user_id, name, status)
    VALUES (${cartId}::uuid, ${buyerOrgId}::uuid, ${buyerUserId}::uuid, 'Cart', 'OPEN')`;
  for (const line of lines) {
    await db.$executeRaw`
      INSERT INTO ordering.cart_item (cart_id, listing_id, qty, unit_price_snapshot)
      VALUES (${cartId}::uuid, ${line.listingId}::uuid, ${line.qty}, ${RETAIL}::numeric)`;
  }
  await asBuyer(() => checkout.begin(cartId));
  const order = await asBuyer(() =>
    checkout.confirm({
      cartId,
      gstProfileId,
      billingAddressId: siteId,
      deliveryAddressId: siteId,
      paymentMode: 'PREPAID' as const,
    }),
  );
  const [row] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ordering."order" WHERE order_number = ${order.orderNumber}`;
  return { orderId: row!.id };
}

const poRows = (orderId: string): Promise<Array<{ id: string; vendor_org_id: string }>> =>
  db.$queryRaw`SELECT id, vendor_org_id FROM procurement.purchase_order
                WHERE order_id = ${orderId}::uuid ORDER BY po_number`;

const poLines = (poId: string): Promise<Array<{ id: string }>> =>
  db.$queryRaw`SELECT id FROM procurement.purchase_order_line
                WHERE po_id = ${poId}::uuid ORDER BY created_at, id`;

const orderStatus = async (orderId: string): Promise<string> => {
  const [row] = await db.$queryRaw<Array<{ status: string }>>`
    SELECT status::text AS status FROM ordering."order" WHERE id = ${orderId}::uuid`;
  return row!.status;
};

const subOrderStatuses = (orderId: string): Promise<Array<{ status: string }>> =>
  db.$queryRaw`SELECT status::text AS status FROM ordering.sub_order
                WHERE order_id = ${orderId}::uuid ORDER BY sub_order_number`;

/** Every ledger batch has to foot. This is the assertion the trigger enforces. */
async function trialBalanceFoots(): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ debit: string; credit: string }>>`
    SELECT coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit
      FROM payment.ledger_entry`;
  return Number(rows[0]!.debit) === Number(rows[0]!.credit);
}

/**
 * Two statements rather than one join: `no-cross-schema-join` reads a query
 * spanning `listing` and `ordering` as a cross-module read, and it is right to —
 * the rule gets no exemption for being in a test.
 */
const reservedUnits = async (orderId: string): Promise<number> => {
  const lines = await db.$queryRaw<Array<{ id: string }>>`
    SELECT ol.id FROM ordering.order_line ol
      JOIN ordering.sub_order so ON so.id = ol.sub_order_id
     WHERE so.order_id = ${orderId}::uuid`;
  if (lines.length === 0) return 0;
  const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.unit
     WHERE order_line_id = ANY(${lines.map((l) => l.id)}::uuid[])
       AND status = 'RESERVED'::public.unit_status`;
  return Number(row!.n);
};

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
      CatalogModule,
      OrderingModule,
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

  checkout = moduleRef.get(CheckoutService);
  pos = moduleRef.get(PurchaseOrderService);
  ctx = moduleRef.get(RequestContextService);
  redis = moduleRef.get(RedisService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await redis.client.flushdb();
  ({ skuId } = await makeCatalog({}, db));
  technician = await makeTechnician(db);
  await seedLogisticsNcr(db);

  buyerOrgId = await makeOrganization({ org_type: 'BUYER', legal_name: 'Harbourpoint Ltd' }, db);
  buyerUserId = await makeUser(buyerOrgId, {}, db);
  siteId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, label, line1, city, state, state_code,
                                      pincode, contact_name, contact_mobile,
                                      is_default, is_billing_enabled)
    VALUES (${siteId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type, 'Gurugram office',
            'Tower B, 4th floor', ${GURUGRAM.city}, ${GURUGRAM.state}, ${GURUGRAM.stateCode},
            ${GURUGRAM.pincode}, 'Ravi Menon', '+919812345678', TRUE, TRUE)`;
  gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, '06AABCU9603R1ZM', 'Harbourpoint Ltd',
            ${GURUGRAM.stateCode}, 'ACTIVE', ${NOW}, TRUE)`;
  await db.$executeRaw`
    INSERT INTO customer.buyer_profile (org_id, credit_limit, credit_used, payment_mode_allowed)
    VALUES (${buyerOrgId}::uuid, 0, 0, ARRAY['PREPAID']::public.payment_mode[])`;
  await db.$executeRaw`
    INSERT INTO customer.org_preference (org_id, po_required, default_shipping_address_id)
    VALUES (${buyerOrgId}::uuid, FALSE, ${siteId}::uuid)`;
});

/* ========================================================================== */

describe('the vendor’s answer moves the customer’s order', () => {
  it('confirms the order when the only PO is fully acknowledged', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
    });
    const { orderId } = await place([{ listingId: offer.listingId, qty: 2 }]);
    const [po] = await poRows(orderId);
    const lines = await poLines(po!.id);

    await asVendor(vendor.orgId, vendor.userId, () =>
      pos.respond(
        po!.id,
        lines.map((l) => ({ lineId: l.id, accept: true })),
      ),
    );

    expect(await orderStatus(orderId)).toBe('VENDOR_ACCEPTED');
    expect((await subOrderStatuses(orderId)).map((s) => s.status)).toEqual(['VENDOR_ACCEPTED']);
    expect(await reservedUnits(orderId)).toBe(2);
    expect(await trialBalanceFoots()).toBe(true);
  });

  it('leaves the order partly confirmed while a second supply point has not answered', async () => {
    const alpha = await makeVendor();
    const beta = await makeVendor(NOIDA);
    const a = await makeOffer({
      vendorOrgId: alpha.orgId,
      pickupAddressId: alpha.addressId,
      qty: 1,
    });
    const b = await makeOffer({
      vendorOrgId: beta.orgId,
      pickupAddressId: beta.addressId,
      qty: 1,
      city: NOIDA.city,
    });
    const { orderId } = await place([
      { listingId: a.listingId, qty: 1 },
      { listingId: b.listingId, qty: 1 },
    ]);

    const all = await poRows(orderId);
    const alphaPo = all.find((p) => p.vendor_org_id === alpha.orgId)!;
    const lines = await poLines(alphaPo.id);
    await asVendor(alpha.orgId, alpha.userId, () =>
      pos.respond(
        alphaPo.id,
        lines.map((l) => ({ lineId: l.id, accept: true })),
      ),
    );

    expect(await orderStatus(orderId)).toBe('PARTIALLY_CONFIRMED');
    const subs = await subOrderStatuses(orderId);
    expect(subs.filter((s) => s.status === 'VENDOR_ACCEPTED')).toHaveLength(1);
    // The other consignment is untouched — CONFIRMED or PAYMENT_PENDING, but
    // certainly not moved by a different vendor's answer.
    expect(subs.filter((s) => s.status === 'VENDOR_ACCEPTED')).not.toHaveLength(2);
  });

  it('cancels the refused machine, releases it, reduces the accrual and raises an ops task', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 3,
    });
    const { orderId } = await place([{ listingId: offer.listingId, qty: 3 }]);
    const [po] = await poRows(orderId);
    const lines = await poLines(po!.id);

    const [payableBefore] = await db.$queryRaw<Array<{ gross: string }>>`
      SELECT gross::text AS gross FROM procurement.vendor_payable
       WHERE purchase_order_id = ${po!.id}::uuid`;

    await asVendor(vendor.orgId, vendor.userId, () =>
      pos.respond(po!.id, [
        { lineId: lines[0]!.id, accept: true },
        { lineId: lines[1]!.id, accept: true },
        { lineId: lines[2]!.id, accept: false, reason: 'Sold before the order arrived' },
      ]),
    );

    // Two machines still held, one back on sale.
    expect(await reservedUnits(orderId)).toBe(2);
    const [listed] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.unit
       WHERE listing_id = ${offer.listingId}::uuid AND status = 'LISTED'::public.unit_status`;
    expect(Number(listed!.n)).toBe(1);

    const [line] = await db.$queryRaw<
      Array<{ qty: number; cancelled_qty: number; status: string }>
    >`
      SELECT ol.qty, ol.cancelled_qty, ol.status::text AS status
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${orderId}::uuid`;
    expect(line!.cancelled_qty).toBe(1);
    expect(line!.qty).toBe(3);
    // Two of three survive, so the line is accepted rather than cancelled.
    expect(line!.status).toBe('VENDOR_ACCEPTED');

    // The payable is reduced by exactly the refused line's value.
    const [payableAfter] = await db.$queryRaw<Array<{ gross: string }>>`
      SELECT gross::text AS gross FROM procurement.vendor_payable
       WHERE purchase_order_id = ${po!.id}::uuid`;
    expect(Number(payableBefore!.gross) - Number(payableAfter!.gross)).toBe(VENDOR_ASK);

    // And taken back out of the TDS accrual, with the sign `chk_tds_sign` wants.
    const [reversal] = await db.$queryRaw<Array<{ gross_amount: string; entry_type: string }>>`
      SELECT gross_amount::text AS gross_amount, entry_type FROM procurement.tds_ledger
       WHERE purchase_order_id = ${po!.id}::uuid AND entry_type = 'REVERSAL'`;
    expect(Number(reversal!.gross_amount)).toBe(-VENDOR_ASK);

    const [task] = await db.$queryRaw<Array<{ kind: string; severity: string; status: string }>>`
      SELECT kind, severity, status FROM ordering.ops_task
       WHERE purchase_order_id = ${po!.id}::uuid`;
    expect(task).toMatchObject({ kind: 'PO_PARTIAL_REJECT', severity: 'BLOCKER', status: 'OPEN' });

    expect(await trialBalanceFoots()).toBe(true);
  });

  it('marks one refused consignment rejected and leaves the order partly confirmed', async () => {
    const alpha = await makeVendor();
    const beta = await makeVendor(NOIDA);
    const a = await makeOffer({
      vendorOrgId: alpha.orgId,
      pickupAddressId: alpha.addressId,
      qty: 1,
    });
    const b = await makeOffer({
      vendorOrgId: beta.orgId,
      pickupAddressId: beta.addressId,
      qty: 1,
      city: NOIDA.city,
    });
    const { orderId } = await place([
      { listingId: a.listingId, qty: 1 },
      { listingId: b.listingId, qty: 1 },
    ]);

    const all = await poRows(orderId);
    const alphaPo = all.find((p) => p.vendor_org_id === alpha.orgId)!;
    const betaPo = all.find((p) => p.vendor_org_id === beta.orgId)!;

    const alphaLines = await poLines(alphaPo.id);
    await asVendor(alpha.orgId, alpha.userId, () =>
      pos.respond(
        alphaPo.id,
        alphaLines.map((l) => ({
          lineId: l.id,
          accept: false,
          reason: 'Water damage found on inspection',
        })),
      ),
    );

    expect(await orderStatus(orderId)).toBe('PARTIALLY_CONFIRMED');
    const subs = await subOrderStatuses(orderId);
    expect(subs.filter((s) => s.status === 'VENDOR_REJECTED')).toHaveLength(1);

    // Then the other vendor accepts: still partial, because one is gone.
    const betaLines = await poLines(betaPo.id);
    await asVendor(beta.orgId, beta.userId, () =>
      pos.respond(
        betaPo.id,
        betaLines.map((l) => ({ lineId: l.id, accept: true })),
      ),
    );
    expect(await orderStatus(orderId)).toBe('PARTIALLY_CONFIRMED');
  });

  it('cancels the whole order when every consignment is refused, and releases every machine', async () => {
    const alpha = await makeVendor();
    const beta = await makeVendor(NOIDA);
    const a = await makeOffer({
      vendorOrgId: alpha.orgId,
      pickupAddressId: alpha.addressId,
      qty: 1,
    });
    const b = await makeOffer({
      vendorOrgId: beta.orgId,
      pickupAddressId: beta.addressId,
      qty: 1,
      city: NOIDA.city,
    });
    const { orderId } = await place([
      { listingId: a.listingId, qty: 1 },
      { listingId: b.listingId, qty: 1 },
    ]);

    for (const vendor of [alpha, beta]) {
      const po = (await poRows(orderId)).find((p) => p.vendor_org_id === vendor.orgId)!;
      const poLineRows = await poLines(po.id);
      await asVendor(vendor.orgId, vendor.userId, () =>
        pos.respond(
          po.id,
          poLineRows.map((l) => ({
            lineId: l.id,
            accept: false,
            reason: 'Stock no longer held',
          })),
        ),
      );
    }

    expect(await orderStatus(orderId)).toBe('CANCELLED');
    expect(await reservedUnits(orderId)).toBe(0);
    const [listed] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.unit WHERE status = 'LISTED'::public.unit_status`;
    expect(Number(listed!.n)).toBe(2);
    expect(await trialBalanceFoots()).toBe(true);
  });

  it('refuses a second answer to the same purchase order', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const { orderId } = await place([{ listingId: offer.listingId, qty: 1 }]);
    const [po] = await poRows(orderId);
    const lines = await poLines(po!.id);

    await asVendor(vendor.orgId, vendor.userId, () =>
      pos.respond(po!.id, [{ lineId: lines[0]!.id, accept: true }]),
    );
    await expect(
      asVendor(vendor.orgId, vendor.userId, () =>
        pos.respond(po!.id, [{ lineId: lines[0]!.id, accept: true }]),
      ),
    ).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'po_already_responded' }),
    });

    // And the first answer is still the one that stands.
    expect(await orderStatus(orderId)).toBe('VENDOR_ACCEPTED');
  });
});
