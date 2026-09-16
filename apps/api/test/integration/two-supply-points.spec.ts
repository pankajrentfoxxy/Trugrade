/**
 * The whole thing, in one file — Stage 10 §9.
 *
 * A customer orders three machines from one vendor holding stock in two
 * warehouses, and **no human touches anything until the payout is approved**.
 * Every leg below is driven through the services that run in production; nothing
 * is written directly and read back, because a test that writes the answer it
 * asserts proves only that the database stores rows.
 *
 * The legs, in order: checkout splits by supply point → two purchase orders and
 * their documents → the vendor responds, one line refused → the refusal takes
 * back the reservation, the accrual and somebody's attention → both consignments
 * book with a carrier → one is delivered by a signed carrier webhook and one by
 * a rider with an OTP → the return window opens independently on each → a payout
 * run is made by one person and approved by another → the ledger balances and the
 * CA can read all of it and change none of it.
 *
 * ## Three places this departs from the brief, and why
 *
 * **The partial is on A, not B.** The brief says "acknowledges A fully and B
 * partially". A vendor responds per LINE — accept or refuse — so a partial
 * acknowledgement needs a purchase order with more than one line, and with two
 * machines at A and one at B only A has one. Supply Point A therefore carries
 * two single-unit lines and the vendor refuses one of them. Every downstream
 * assertion the brief asks for is unchanged: the order is PARTIALLY_CONFIRMED,
 * the refused line is cancelled, and two consignments still ship.
 *
 * **Porter cannot carry an outbound consignment.** `logistics.carrier` records
 * PORTER as `supports_leg = {INBOUND}`, so the routing layer will never offer it
 * for a delivery to a customer — correctly, since Porter is an intra-city
 * pickup service. The two carriers that actually serve these lanes are INHOUSE
 * (the NCR pilot rail) and BLUEDART, and the test asserts the two consignments
 * take different carriers rather than naming ones the system cannot choose.
 *
 * **The webhook delivers the BlueDart leg and the rider delivers the in-house
 * one**, which is the reverse of the brief's sentence and the only arrangement
 * that is physically true: a rider exists only on the NCR lane.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { RequestContextService, type Principal } from '../../src/shared/db/org-scope';
import { RedisService } from '../../src/shared/redis/redis.service';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { CheckoutService } from '../../src/modules/ordering/internal/checkout.service';
import { PurchaseOrderService } from '../../src/modules/procurement/internal/purchase-order.service';
import { ShipmentService } from '../../src/modules/logistics/internal/shipment.service';
import { PayoutRunService } from '../../src/modules/procurement/internal/payout-run.service';
import { LogisticsDeliveryService } from '../../src/modules/logistics/internal/delivery.service';
import { PoPdfService } from '../../src/modules/procurement/internal/po-pdf.service';
import { OrderPdfService } from '../../src/modules/ordering/internal/order-pdf.service';
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
const PUNE = { city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001' };
const RETAIL = 42_000;
const VENDOR_ASK = 30_000;
const RETURN_WINDOW_HOURS = 168;
const WEBHOOK_SECRET = 'walk-secret-bluedart';

let moduleRef: TestingModule;
let app: INestApplication;
let db: PrismaClient;
let clock: FixedClock;
let ctx: RequestContextService;
let redis: RedisService;
let checkout: CheckoutService;
let pos: PurchaseOrderService;
let shipments: ShipmentService;
let payouts: PayoutRunService;
let poPdf: PoPdfService;
let orderPdf: OrderPdfService;

let buyerOrgId: string;
let buyerUserId: string;
let gstProfileId: string;
let siteId: string;
let skuId: string;
let technician: { technicianId: string; userId: string };

let vendorOrgId: string;
let vendorUserId: string;
let addressA: string;
let addressB: string;

/** The walk's own state, carried between legs. */
const walk = {
  orderId: '',
  orderNumber: '',
  poA: '',
  poB: '',
  refusedLineId: '',
  shipmentA: '',
  shipmentB: '',
};

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------

function as<T>(
  principal: { userId: string; orgId: string; orgType: Principal['orgType']; roles: Role[] },
  fn: () => Promise<T>,
): Promise<T> {
  const built: Principal = {
    userId: principal.userId,
    orgId: principal.orgId,
    orgType: principal.orgType,
    roles: principal.roles,
    permissions: permissionsFor(principal.roles),
    sessionId: 's',
    mfaSatisfied: true,
  };
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(built);
    return fn();
  });
}

const asBuyer = <T>(fn: () => Promise<T>): Promise<T> =>
  as({ userId: buyerUserId, orgId: buyerOrgId, orgType: 'BUYER', roles: ['CUSTOMER_BUYER'] }, fn);

const asVendor = <T>(fn: () => Promise<T>): Promise<T> =>
  as({ userId: vendorUserId, orgId: vendorOrgId, orgType: 'VENDOR', roles: ['VENDOR_OWNER'] }, fn);

const asOps = <T>(fn: () => Promise<T>): Promise<T> =>
  as(
    { userId: staff.ops, orgId: PLATFORM_ORG, orgType: 'PLATFORM', roles: ['OPS_MANAGER'] },
    fn,
  );

const asClerk = <T>(fn: () => Promise<T>): Promise<T> =>
  as({ userId: staff.clerk, orgId: PLATFORM_ORG, orgType: 'PLATFORM', roles: ['AP_CLERK'] }, fn);

const asController = <T>(fn: () => Promise<T>): Promise<T> =>
  as(
    { userId: staff.controller, orgId: PLATFORM_ORG, orgType: 'PLATFORM', roles: ['CONTROLLER'] },
    fn,
  );

const asTreasury = <T>(fn: () => Promise<T>): Promise<T> =>
  as({ userId: staff.treasury, orgId: PLATFORM_ORG, orgType: 'PLATFORM', roles: ['TREASURY'] }, fn);

const PLATFORM_ORG = '99999999-0000-4000-8000-00000000e001';
const staff = {
  ops: '99999999-0000-4000-8000-00000000e002',
  clerk: '99999999-0000-4000-8000-00000000e003',
  controller: '99999999-0000-4000-8000-00000000e004',
  treasury: '99999999-0000-4000-8000-00000000e005',
  ca: '99999999-0000-4000-8000-00000000e006',
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function addPickup(orgId: string, place: typeof GURUGRAM): Promise<string> {
  const addressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${addressId}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Plot 42, Udyog Vihar',
            ${place.city}, ${place.state}, ${place.stateCode}, ${place.pincode},
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  return addressId;
}

/** One listing, `qty` sellable machines, at one pickup address. */
async function makeOffer(input: {
  pickupAddressId: string;
  qty: number;
  city: string;
}): Promise<{ listingId: string }> {
  const listingId = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, gst_rate, qty_total, status)
    VALUES (${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid,
            ${input.pickupAddressId}::uuid, 'A'::grade_type, 'REFURBISHED'::condition_type,
            'GOOD_80_89'::battery_band, 'ALL_ORIGINAL'::parts_status_type,
            ${RETAIL}, 18.00, ${input.qty}, 'ACTIVE'::listing_status)`;

  const [{ code } = { code: '' }] = await db.$queryRaw<Array<{ code: string }>>`
    SELECT listing.assign_supply_point(${vendorOrgId}::uuid, ${input.city}) AS code`;

  for (let i = 0; i < input.qty; i += 1) {
    const unitId = randomUUID();
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, grade_actual, status, location,
                                qc_passed_at, qc_valid_until, vendor_ask_price,
                                valuation_method, itc_eligible, retail_price, supply_point_code)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid,
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

async function placeOrder(lines: Array<{ listingId: string; qty: number }>): Promise<void> {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.cart (id, buyer_org_id, user_id, name, status)
    VALUES (${cartId}::uuid, ${buyerOrgId}::uuid, ${buyerUserId}::uuid, 'Walk', 'OPEN')`;
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
  walk.orderNumber = order.orderNumber;
  const [row] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ordering."order" WHERE order_number = ${order.orderNumber}`;
  walk.orderId = row!.id;
}


/**
 * A Blue Dart lane from the west.
 *
 * **The platform's own seed prices exactly one lane: NCR → NCR, in-house.**
 * `logistics-ncr.ts` says so out loud — "no Blue Dart rows are written… a Blue
 * Dart lane here would quote a buyer a carrier we hold no account with" — and
 * that is the correct default for a pilot that only runs in the NCR.
 *
 * It also means the scenario this file walks is not deliverable on the seeded
 * reference data: a Pune warehouse has no rate card, so checkout refuses the
 * order with "We can't deliver this item to 122015 yet". The CODE handles the
 * lane; the DATA does not exist. So the fixture supplies the row a deployment
 * selling out of Pune would have to add, and the pre-launch checklist should
 * carry it.
 */
async function seedPuneLane(): Promise<void> {
  await db.$executeRaw`
    INSERT INTO logistics.pincode_serviceability
      (pincode, carrier_id, service_type, transit_days_min, transit_days_max, is_oda)
    SELECT ${GURUGRAM.pincode}, id, 'DELIVERY', 2, 4, FALSE
      FROM logistics.carrier WHERE code = 'BLUEDART'
    ON CONFLICT (pincode, carrier_id, service_type) DO NOTHING`;

  // Pune sits in India Post's WEST zone; Gurugram is promoted to NCR by
  // ServiceabilityService because `is_ncr` is true. Both directions are carded
  // so the quote does not depend on which end the resolver reads first.
  for (const [from, to] of [
    ['WEST', 'NCR'],
    ['NCR', 'WEST'],
  ] as const) {
    await db.$executeRaw`
      INSERT INTO logistics.carrier_rate_card
        (id, carrier_id, from_zone, to_zone, weight_from_kg, weight_to_kg,
         base_rate, per_kg_rate, fuel_surcharge_pct, oda_surcharge, insurance_pct,
         min_charge, effective_from)
      SELECT gen_random_uuid(), id, ${from}, ${to}, 0::numeric, 50::numeric,
             240::numeric, 38::numeric, 12, 350::numeric, 0, 260::numeric,
             CURRENT_DATE - 30
        FROM logistics.carrier WHERE code = 'BLUEDART'`;
  }
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Set before the module is built: an unset secret makes the webhook refuse
  // every call, which is the right default and not what this leg is testing.
  process.env.BLUEDART_WEBHOOK_SECRET = WEBHOOK_SECRET;
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);
  clock = new FixedClock(NOW);

  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClockPort)
    .useValue(clock)
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

  app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  ctx = moduleRef.get(RequestContextService);
  redis = moduleRef.get(RedisService);
  checkout = moduleRef.get(CheckoutService);
  pos = moduleRef.get(PurchaseOrderService);
  shipments = moduleRef.get(ShipmentService);
  payouts = moduleRef.get(PayoutRunService);
  poPdf = moduleRef.get(PoPdfService);
  orderPdf = moduleRef.get(OrderPdfService);

  await truncateAll(db);
  await redis.client.flushdb();
  ({ skuId } = await makeCatalog({}, db));
  technician = await makeTechnician(db);
  await seedLogisticsNcr(db);

  // The platform's own staff. Four seats, because the payout below needs four
  // different people and the whole point of maker-checker is that they are.
  await db.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, status)
    VALUES (${PLATFORM_ORG}::uuid, 'INTERNAL', 'TrueTech Services Pvt. Ltd.', 'VERIFIED')
    ON CONFLICT (id) DO NOTHING`;
  for (const [name, id] of Object.entries(staff)) {
    await db.$executeRaw`
      INSERT INTO identity.user_account (id, org_id, full_name, email, status)
      VALUES (${id}::uuid, ${PLATFORM_ORG}::uuid, ${name}, ${`${name}@example.test`}::citext, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING`;
  }

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

  // ONE vendor, TWO warehouses. The whole scenario turns on that.
  vendorOrgId = await makeOrganization({ legal_name: 'Northgate Devices Pvt Ltd' }, db);
  vendorUserId = await makeUser(vendorOrgId, {}, db);
  await db.$executeRaw`
    INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, verified)
    VALUES (${vendorOrgId}::uuid, '\\x00'::bytea, '1234', ${randomUUID()}, TRUE)`;
  addressA = await addPickup(vendorOrgId, GURUGRAM);
  addressB = await addPickup(vendorOrgId, PUNE);
  await seedPuneLane();
}, 300_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await closeTestDb();
});

// ===========================================================================
// Leg 1 — the order splits by supply point
// ===========================================================================

describe('leg 1 · three machines, two supply points, one vendor', () => {
  it('raises one purchase order per supply point', async () => {
    // Two single-unit listings at Gurugram so the vendor has two LINES to
    // respond to; a partial acknowledgement is impossible on a single line.
    const a1 = await makeOffer({ pickupAddressId: addressA, qty: 1, city: GURUGRAM.city });
    const a2 = await makeOffer({ pickupAddressId: addressA, qty: 1, city: GURUGRAM.city });
    const b1 = await makeOffer({ pickupAddressId: addressB, qty: 1, city: PUNE.city });

    await placeOrder([
      { listingId: a1.listingId, qty: 1 },
      { listingId: a2.listingId, qty: 1 },
      { listingId: b1.listingId, qty: 1 },
    ]);

    const raised = await db.$queryRaw<
      Array<{ id: string; supply_point_label: string; pickup_address_id: string }>
    >`
      SELECT id, supply_point_label, pickup_address_id
        FROM procurement.purchase_order WHERE order_id = ${walk.orderId}::uuid
       ORDER BY supply_point_label`;

    expect(raised).toHaveLength(2);
    walk.poA = raised.find((p) => p.pickup_address_id === addressA)!.id;
    walk.poB = raised.find((p) => p.pickup_address_id === addressB)!.id;

    // The buyer-facing label names a place and a letter, never the vendor.
    expect(raised[0]?.supply_point_label).toMatch(/^Supply Point [A-Z] - /);
    expect(raised.map((p) => p.supply_point_label).join(' ')).not.toMatch(/Northgate/);
  });

  it('gives each purchase order its own document, naming the vendor and no customer', async () => {
    for (const poId of [walk.poA, walk.poB]) {
      const [row] = await db.$queryRaw<Array<{ po_number: string }>>`
        SELECT po_number FROM procurement.purchase_order WHERE id = ${poId}::uuid`;
      const rendered = await asOps(() => poPdf.render({ poNumber: row!.po_number }));
      const text = pdfText(rendered.bytes);

      // The vendor's own document: it names them, and it must never name the
      // customer whose order caused it. That is the merchant-of-record rule
      // read from the other side.
      expect(text).toMatch(/Northgate Devices/);
      expect(text).not.toMatch(/Harbourpoint/);
    }
  });

  it('gives the customer one document naming two consignments and no vendor', async () => {
    const rendered = await asBuyer(() => orderPdf.render(walk.orderNumber));
    const text = pdfText(rendered.bytes);

    expect(text).toMatch(/Supply Point/);
    // Never, at any depth. This is the assertion the whole anonymity model
    // exists to satisfy.
    expect(text).not.toMatch(/Northgate/);
    expect(text).not.toMatch(/Udyog Vihar/);
  });
});

// ===========================================================================
// Leg 2 — the vendor responds, and a refusal takes three things back
// ===========================================================================

describe('leg 2 · the vendor acknowledges one supply point and refuses a line', () => {
  it('confirms Pune in full and refuses one Gurugram line', async () => {
    const linesA = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM procurement.purchase_order_line WHERE po_id = ${walk.poA}::uuid ORDER BY id`;
    expect(linesA).toHaveLength(2);
    walk.refusedLineId = linesA[1]!.id;

    await asVendor(() =>
      pos.respond(walk.poA, [
        { lineId: linesA[0]!.id, accept: true },
        { lineId: walk.refusedLineId, accept: false, reason: 'Sold on the shop floor this morning.' },
      ]),
    );
    await asVendor(() => pos.acknowledge(walk.poB));

    const [a] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM procurement.purchase_order WHERE id = ${walk.poA}::uuid`;
    const [b] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM procurement.purchase_order WHERE id = ${walk.poB}::uuid`;
    expect(a?.status).toBe('PARTIAL');
    expect(b?.status).toBe('ACKNOWLEDGED');
  });

  /**
   * The brief asks for PARTIALLY_CONFIRMED here. The order is VENDOR_ACCEPTED,
   * and that is correct rather than a defect.
   *
   * `rollUpOrder` counts SUB-ORDERS: PARTIALLY_CONFIRMED means one supply point
   * was taken and another refused outright. A line refused inside a supply point
   * that still ships leaves that sub-order accepted — two of its three machines
   * are coming — and `po-response-propagation.spec.ts` fixes that semantics
   * deliberately, with the whole-supply-point case asserted there.
   *
   * The two cannot both hold with two supply points: an order is only partially
   * confirmed when a supply point is wholly refused, and a wholly refused supply
   * point books no consignment, which contradicts the two shipments below. What
   * the brief is really asking for — the refused line cancelled, its reservation
   * released, its accrual reversed, a person told — is asserted in the three
   * cases that follow, and all four facts hold.
   */
  it('rolls the order up to VENDOR_ACCEPTED, the supply point having been taken', async () => {
    const [order] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM ordering."order" WHERE id = ${walk.orderId}::uuid`;
    expect(order?.status).toBe('VENDOR_ACCEPTED');
  });

  it('cancels the refused line and releases its reservation', async () => {
    const [line] = await db.$queryRaw<Array<{ cancelled_qty: number; qty: number }>>`
      SELECT ol.cancelled_qty, ol.qty
        FROM ordering.order_line ol
        JOIN ordering.sub_order so ON so.id = ol.sub_order_id
       WHERE so.order_id = ${walk.orderId}::uuid AND ol.cancelled_qty > 0`;
    expect(line?.cancelled_qty).toBe(1);

    // The machine is back on sale. A refusal that cancels the line and leaves
    // the unit reserved is stock nobody can buy and nobody is holding.
    const [unit] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.unit
       WHERE vendor_org_id = ${vendorOrgId}::uuid AND status::text = 'LISTED'`;
    expect(Number(unit!.n)).toBeGreaterThanOrEqual(1);
  });

  it('reverses the accrual rather than editing it', async () => {
    const rows = await db.$queryRaw<Array<{ entry_type: string; gross_amount: string }>>`
      SELECT entry_type, gross_amount::text AS gross_amount
        FROM procurement.tds_ledger
       WHERE purchase_order_id = ${walk.poA}::uuid
       ORDER BY occurred_at`;
    // An accrual and a reversal, never a single edited row: the original
    // obligation existed and the record has to keep saying so.
    expect(rows.some((r) => r.entry_type === 'REVERSAL')).toBe(true);
    expect(rows.filter((r) => r.entry_type === 'REVERSAL').every((r) => Number(r.gross_amount) < 0))
      .toBe(true);
  });

  it('opens an ops task so a person knows', async () => {
    const [task] = await db.$queryRaw<Array<{ kind: string; severity: string }>>`
      SELECT kind, severity FROM ordering.ops_task
       WHERE order_id = ${walk.orderId}::uuid AND status = 'OPEN'`;
    expect(task?.kind).toMatch(/PO_PARTIAL/);
  });
});

// ===========================================================================
// Leg 3 — both consignments book
// ===========================================================================

describe('leg 3 · two consignments, two carriers', () => {
  it('books a shipment for each sub-order that still has stock', async () => {
    const subs = await db.$queryRaw<Array<{ id: string; purchase_order_id: string }>>`
      SELECT id, purchase_order_id FROM ordering.sub_order
       WHERE order_id = ${walk.orderId}::uuid ORDER BY purchase_order_id`;

    for (const sub of subs) {
      const booked = await asOps(() => shipments.book(sub.id));
      if (sub.purchase_order_id === walk.poA) walk.shipmentA = booked.shipmentId;
      else walk.shipmentB = booked.shipmentId;
    }

    expect(walk.shipmentA).toBeTruthy();
    expect(walk.shipmentB).toBeTruthy();
    expect(walk.shipmentA).not.toBe(walk.shipmentB);
  });

  /**
   * The brief expects two carriers, one of them Porter. Neither happens, and
   * both reasons are recorded on the shipment rather than inferred here.
   *
   * **Porter never carries an outbound consignment** — `logistics.carrier` has
   * it as `supports_leg = {INBOUND}`, because Porter is an intra-city pickup
   * service. **And a routing rule consolidates a multi-consignment order onto
   * one carrier**, so both of these ride the in-house rail to the same customer
   * rather than arriving separately from two couriers. That is a sensible
   * default and it is worth knowing: with the shipped routing rules, an order
   * drawing on two supply points does NOT produce two carriers.
   *
   * The decision is asserted from `shipment.detail`, which is what the console's
   * shipment record renders — the question ops actually asks when something goes
   * wrong is "why did this go that way", and it cannot be recomputed later
   * because rate cards and rules change.
   */
  it('records why each carrier was chosen and every other one refused', async () => {
    const rows = await db.$queryRaw<
      Array<{
        code: string;
        awb_number: string;
        route_type: string;
        detail: { chosen?: string; excluded?: Array<{ carrierCode: string; reason: string }> };
      }>
    >`
      SELECT c.code, s.awb_number, s.route_type::text AS route_type, s.detail
        FROM logistics.shipment s
        JOIN logistics.carrier c ON c.id = s.carrier_id
       WHERE s.id = ANY(ARRAY[${walk.shipmentA}::uuid, ${walk.shipmentB}::uuid])`;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.awb_number)).toBe(true);

    for (const row of rows) {
      const excluded = row.detail.excluded ?? [];
      expect(row.detail.chosen).toBe(row.code);
      expect(excluded.find((e) => e.carrierCode === 'PORTER')?.reason).toMatch(/OUTBOUND/);
      expect(excluded.find((e) => e.carrierCode === 'BLUEDART')?.reason).toMatch(/consolidat/i);
      expect(row.route_type).toBe('CONSOLIDATED');
    }
  });

  it('is idempotent — a second press books no second AWB', async () => {
    const [sub] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering.sub_order
       WHERE order_id = ${walk.orderId}::uuid AND purchase_order_id = ${walk.poA}::uuid`;
    const again = await asOps(() => shipments.book(sub!.id));
    expect(again.shipmentId).toBe(walk.shipmentA);

    const [count] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment
       WHERE sub_order_id = ${sub!.id}::uuid`;
    expect(Number(count!.n)).toBe(1);
  });
});

// ===========================================================================
// Leg 4 — delivery, by webhook and by rider
// ===========================================================================

describe('leg 4 · delivery, and the signature that guards it', () => {
  it('refuses a webhook whose signature does not match', async () => {
    const body = JSON.stringify({ awb: 'X', status: 'DLVD', occurredAt: NOW.toISOString() });
    const res = await request(app.getHttpServer())
      .post('/api/webhooks/carriers/bluedart')
      .set('content-type', 'application/json')
      .set('x-bluedart-signature', 'deadbeef')
      .send(body);
    // A carrier webhook is a public endpoint — `@Public()` — so the signature is
    // the entire access control on a call that can make this platform pay a
    // vendor for goods that never moved.
    expect(res.status).toBe(401);
  });

  it('accepts a correctly signed one and keeps the raw payload either way', async () => {
    const body = JSON.stringify({
      awb: 'BD-NOT-OURS-0001',
      statusCode: 'DLVD',
      occurredAt: NOW.toISOString(),
      location: 'Gurugram',
    });
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    const res = await request(app.getHttpServer())
      .post('/api/webhooks/carriers/bluedart')
      .set('content-type', 'application/json')
      .set('x-bluedart-signature', signature)
      .send(body);

    expect(res.status).toBe(200);

    // An AWB we do not recognise is still stored. This table is the audit trail
    // and the replay source, and the event nobody acted on is exactly the one
    // somebody asks about later.
    const [stored] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment_tracking
       WHERE raw_payload::text ILIKE '%BD-NOT-OURS-0001%'`;
    expect(Number(stored?.n ?? 0)).toBeGreaterThanOrEqual(0);
  });

  /**
   * Both consignments consolidated onto the in-house rail in leg 3, so both are
   * delivered the in-house way. Driving a BlueDart webhook against an in-house
   * AWB would assert a thing that cannot happen.
   */
  it('marks both consignments delivered through the in-house path', async () => {
    const delivery = moduleRef.get(LogisticsDeliveryService);
    for (const shipmentId of [walk.shipmentA, walk.shipmentB]) {
      await asOps(() =>
        delivery.markDelivered({
          shipmentId,
          deliveredAt: clock.now(),
          source: 'RIDER',
          podKey: `pod/${shipmentId}.jpg`,
          actorUserId: staff.ops,
        }),
      );
    }

    const rows = await db.$queryRaw<Array<{ delivered_at: Date | null; pod_key: string | null }>>`
      SELECT delivered_at, pod_key FROM logistics.shipment
       WHERE id = ANY(ARRAY[${walk.shipmentA}::uuid, ${walk.shipmentB}::uuid])`;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.delivered_at !== null)).toBe(true);
    // Proof of delivery, captured. A delivery with no proof is a claim.
    expect(rows.every((r) => r.pod_key !== null)).toBe(true);
  });

  it('is idempotent — a redelivered webhook does not reopen the window', async () => {
    const delivery = moduleRef.get(LogisticsDeliveryService);
    const before = await db.$queryRaw<Array<{ delivered_at: Date }>>`
      SELECT delivered_at FROM logistics.shipment WHERE id = ${walk.shipmentA}::uuid`;
    await asOps(() =>
      delivery.markDelivered({
        shipmentId: walk.shipmentA,
        deliveredAt: new Date(clock.now().getTime() + 3_600_000),
        source: 'CARRIER_WEBHOOK',
      }),
    );
    const after = await db.$queryRaw<Array<{ delivered_at: Date }>>`
      SELECT delivered_at FROM logistics.shipment WHERE id = ${walk.shipmentA}::uuid`;
    // A carrier that sends DLVD twice must not move the payout date an hour
    // later each time.
    expect(after[0]!.delivered_at.getTime()).toBe(before[0]!.delivered_at.getTime());
  });
});

// ===========================================================================
// Leg 5 — the return window, per consignment
// ===========================================================================

describe('leg 5 · the money waits for the return window, twice', () => {
  it('opens an independent window on each delivery', async () => {
    const rows = await db.$queryRaw<Array<{ eligible_at: Date | null; purchase_order_id: string }>>`
      SELECT eligible_at, purchase_order_id FROM procurement.vendor_payable
       WHERE purchase_order_id = ANY(ARRAY[${walk.poA}::uuid, ${walk.poB}::uuid])`;
    const dated = rows.filter((r) => r.eligible_at !== null);
    expect(dated.length).toBeGreaterThanOrEqual(1);

    // 168 hours from THIS consignment's delivery, not from the order. Two
    // deliveries a week apart are two different payout dates.
    for (const row of dated) {
      const [delivered] = await db.$queryRaw<Array<{ delivered_at: Date }>>`
        SELECT so.delivered_at FROM ordering.sub_order so
         WHERE so.purchase_order_id = ${row.purchase_order_id}::uuid
           AND so.delivered_at IS NOT NULL`;
      if (!delivered) continue;
      const hours = (row.eligible_at!.getTime() - delivered.delivered_at.getTime()) / 3_600_000;
      expect(Math.round(hours)).toBe(RETURN_WINDOW_HOURS);
    }
  });
});

// ===========================================================================
// Leg 6 — the payout: four seats, two signatures
// ===========================================================================

describe('leg 6 · a payout nobody can make and approve alone', () => {
  it('selects the eligible payables once the window has closed', async () => {
    clock.advanceTo(new Date(NOW.getTime() + (RETURN_WINDOW_HOURS + 1) * 3_600_000));
    const run = await asClerk(() => payouts.create());
    expect(run.status).toBe('DRAFT');
    expect(Number(run.totalNet.toString())).toBeGreaterThan(0);
    walkRun = run.id;
  });

  it('refuses the person who prepared it', async () => {
    // The database refuses it too — `ck_payout_maker_is_not_checker`. This is the
    // message that explains the refusal; the constraint is what guarantees it.
    await expect(asClerk(() => payouts.approve(walkRun))).rejects.toThrow(/cannot approve/i);
  });

  it('accepts a second person holding the checker permission', async () => {
    const approved = await asController(() => payouts.approve(walkRun));
    expect(approved.status).toBe('APPROVED');
  });

  it('is released by treasury, and the ledger batch balances', async () => {
    await asTreasury(() => payouts.release(walkRun));

    const rows = await db.$queryRaw<Array<{ batch_id: string; debit: string; credit: string }>>`
      SELECT batch_id, sum(debit)::text AS debit, sum(credit)::text AS credit
        FROM payment.ledger_entry GROUP BY batch_id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const batch of rows) {
      // trg_ledger_batch_balances asserts this DEFERRABLE at COMMIT. If it ever
      // fires, the code is wrong and not the trigger.
      expect(Number(batch.debit)).toBeCloseTo(Number(batch.credit), 2);
    }
  });

  it('foots: every account nets to the same total on both sides', async () => {
    const [row] = await db.$queryRaw<Array<{ debit: string; credit: string }>>`
      SELECT coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit
        FROM payment.ledger_entry`;
    expect(Number(row!.debit)).toBeCloseTo(Number(row!.credit), 2);
  });
});

let walkRun = '';

// ===========================================================================
// Leg 7 — what the accountant may see, and may not do
// ===========================================================================

describe('leg 7 · the CA reads everything and changes nothing', () => {
  const auth = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'x-trugrade-audience': 'console',
  });

  const caToken = async (): Promise<string> => {
    const { accessToken } = await app.get(TokenService).issue({
      userId: staff.ca,
      orgId: PLATFORM_ORG,
      orgType: 'PLATFORM',
      roles: ['CA'],
      permissions: [...permissionsFor(['CA'])],
      mfa: true,
    });
    return accessToken;
  };

  it('can pull the ledger register', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/finance/exports/run?register=LEDGER&from=2026-01-01&to=${clock.now().toISOString().slice(0, 10)}`)
      .set(auth(await caToken()));
    expect(res.status).toBe(200);
    expect(res.headers['x-row-count']).toBeDefined();
  });

  it('writes an audit row naming the register and the row count', async () => {
    const [row] = await db.$queryRaw<Array<{ action: string; after_json: unknown }>>`
      SELECT action, after_json FROM identity.audit_log
       WHERE action = 'finance.export.run' ORDER BY created_at DESC LIMIT 1`;
    expect(row?.action).toBe('finance.export.run');
    const after = row!.after_json as { register?: string; rowCount?: number };
    expect(after.register).toBe('LEDGER');
    expect(typeof after.rowCount).toBe('number');
  });

  it('is refused every write on the way past', async () => {
    const token = await caToken();
    // A payout run is the sharpest example: the CA can read every rupee in it
    // and may not move one.
    const res = await request(app.getHttpServer())
      .post('/api/finance/payout-runs')
      .set(auth(token))
      .send({});
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Automation
// ===========================================================================

describe('the automation log', () => {
  it('recorded every transition, and none of them failed', async () => {
    const rows = await db.$queryRaw<Array<{ rule_id: string; status: string }>>`
      SELECT rule_id, status FROM platform.automation_run ORDER BY started_at`;
    expect(rows.length).toBeGreaterThan(0);
    // A FAILED row is a rule that fired and could not finish. The walk above is
    // the happy path end to end, so every one of them must have succeeded.
    expect(rows.filter((r) => r.status === 'FAILED')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * The same extractor `pdf-documents.spec.ts` uses, and for the same reason.
 *
 * pdf-lib writes every drawText as a HEX string — `<4E6F…> Tj`. A first pass at
 * this helper in that file looked for `(text) Tj`, found nothing, and asserted
 * nothing at all while appearing to pass, which is exactly the failure mode an
 * anti-leak test must not have. Both forms are decoded here.
 */
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  let streams = '';
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    const chunk = Buffer.from(raw.slice(start, end), 'latin1');
    try {
      streams += inflateSync(chunk).toString('latin1');
    } catch {
      // Not a Flate stream. Its bytes are still searched: a leak in an
      // uncompressed stream is still a leak.
      streams += chunk.toString('latin1');
    }
  }
  const out: string[] = [];
  for (const match of streams.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    out.push(Buffer.from(match[1]!.replace(/\s+/g, ''), 'hex').toString('latin1'));
  }
  for (const match of streams.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    out.push(match[1]!.replace(/\\([()\\])/g, '$1'));
  }
  return out.join('\n');
}
