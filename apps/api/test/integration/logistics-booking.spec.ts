/**
 * Booking a consignment onto the `logistics` tables that had no writer.
 *
 * Fifteen tables, well modelled, and not one INSERT anywhere in `apps/api/src`.
 * These are the properties that decide whether the code that now writes them is
 * safe to run twice, which it will be: carriers time out, riders re-submit, and
 * an AWB created twice is a second real invoice.
 *
 * Booking is driven from `DISPATCH_READY` rather than from the acknowledgement —
 * see `ShipmentService`'s header. The fixture therefore acknowledges the PO AND
 * attaches serials, which is what a vendor's packing scan does.
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
import { LogisticsModule } from '../../src/modules/logistics';
import { ShipmentService } from '../../src/modules/logistics/internal/shipment.service';
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
let shipments: ShipmentService;
let ctx: RequestContextService;
let redis: RedisService;
let db: PrismaClient;

let buyerOrgId: string;
let buyerUserId: string;
let gstProfileId: string;
let siteId: string;
let skuId: string;
let technician: { technicianId: string; userId: string };

const principalFor = (
  userId: string,
  orgId: string,
  orgType: 'BUYER' | 'VENDOR',
  roles: Role[],
): Principal => ({
  userId,
  orgId,
  orgType,
  roles,
  permissions: permissionsFor(roles),
  sessionId: 's',
  mfaSatisfied: true,
});

function run<T>(principal: Principal, fn: () => Promise<T>): Promise<T> {
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
  // GOLD, so the "new or watchlist vendor" rule does not fire and the lane rules
  // under test are the ones being exercised.
  await db.$executeRaw`
    UPDATE identity.organization SET tier = 'GOLD'::vendor_tier WHERE id = ${orgId}::uuid`;
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

async function place(lines: Array<{ listingId: string; qty: number }>): Promise<string> {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.cart (id, buyer_org_id, user_id, name, status)
    VALUES (${cartId}::uuid, ${buyerOrgId}::uuid, ${buyerUserId}::uuid, 'Cart', 'OPEN')`;
  for (const line of lines) {
    await db.$executeRaw`
      INSERT INTO ordering.cart_item (cart_id, listing_id, qty, unit_price_snapshot)
      VALUES (${cartId}::uuid, ${line.listingId}::uuid, ${line.qty}, ${RETAIL}::numeric)`;
  }
  const buyer = principalFor(buyerUserId, buyerOrgId, 'BUYER', ['CUSTOMER_BUYER']);
  await run(buyer, () => checkout.begin(cartId));
  const order = await run(buyer, () =>
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
  return row!.id;
}

/**
 * Acknowledge and pack: what a vendor does before anything can be collected.
 * Attaching the serial is the packing scan, and it is what `dispatchPo` and
 * booking both read.
 */
async function acknowledgeAndPack(orderId: string, vendor: { orgId: string; userId: string }) {
  const [po] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM procurement.purchase_order
     WHERE order_id = ${orderId}::uuid AND vendor_org_id = ${vendor.orgId}::uuid`;
  const lines = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM procurement.purchase_order_line WHERE po_id = ${po!.id}::uuid ORDER BY id`;
  await run(principalFor(vendor.userId, vendor.orgId, 'VENDOR', ['VENDOR_OWNER']), () =>
    pos.respond(
      po!.id,
      lines.map((l) => ({ lineId: l.id, accept: true })),
    ),
  );

  const [sub] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ordering.sub_order WHERE purchase_order_id = ${po!.id}::uuid`;
  const lineIds = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ordering.order_line WHERE sub_order_id = ${sub!.id}::uuid`;
  const units = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM listing.unit
     WHERE order_line_id = ANY(${lineIds.map((l) => l.id)}::uuid[])
     ORDER BY id`;

  for (const [i, line] of lines.entries()) {
    const unit = units[i];
    if (!unit) break;
    await db.$executeRaw`
      UPDATE procurement.purchase_order_line SET unit_id = ${unit.id}::uuid
       WHERE id = ${line.id}::uuid`;
  }
  return { poId: po!.id, subOrderId: sub!.id };
}

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
      LogisticsModule,
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
  shipments = moduleRef.get(ShipmentService);
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

describe('booking a packed consignment', () => {
  it('writes a shipment, its units, a pickup task, a delivery task and custody', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
    });
    const orderId = await place([{ listingId: offer.listingId, qty: 2 }]);
    const { subOrderId } = await acknowledgeAndPack(orderId, vendor);

    const booking = await shipments.book(subOrderId);

    expect(booking.alreadyBooked).toBe(false);
    expect(booking.awb).toBeTruthy();
    expect(booking.bookingError).toBeNull();

    const [shipment] = await db.$queryRaw<
      Array<{ status: string; route_type: string; quoted_freight: string; detail: unknown }>
    >`
      SELECT status::text AS status, route_type::text AS route_type,
             quoted_freight::text AS quoted_freight, detail
        FROM logistics.shipment WHERE id = ${booking.shipmentId}::uuid`;
    expect(shipment!.status).toBe('SCHEDULED');
    expect(Number(shipment!.quoted_freight)).toBeGreaterThan(0);

    const [units] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment_unit
       WHERE shipment_id = ${booking.shipmentId}::uuid`;
    expect(Number(units!.n)).toBe(2);

    const [pickup] = await db.$queryRaw<
      Array<{ expected_serials: string[]; expected_seals: string[]; status: string }>
    >`
      SELECT expected_serials, expected_seals, status FROM logistics.pickup_task
       WHERE id = ${booking.pickupTaskId}::uuid`;
    expect(pickup!.expected_serials).toHaveLength(2);
    expect(pickup!.expected_seals).toHaveLength(2);
    expect(pickup!.status).toBe('PENDING');

    const [delivery] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM logistics.delivery_task WHERE id = ${booking.deliveryTaskId}::uuid`;
    expect(delivery!.status).toBe('PENDING');

    const [custody] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.custody_event`;
    expect(Number(custody!.n)).toBe(2);
  });

  it('books two supply points as two consignments with two AWBs', async () => {
    const vendor = await makeVendor();
    const second = randomUUID();
    await db.$executeRaw`
      INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                        contact_name, contact_mobile, is_pickup_enabled)
      VALUES (${second}::uuid, ${vendor.orgId}::uuid, 'PICKUP'::address_type, 'Block C',
              ${NOIDA.city}, ${NOIDA.state}, ${NOIDA.stateCode}, ${NOIDA.pincode},
              'Supervisor', '+919876543211', TRUE)`;
    const a = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const b = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: second,
      qty: 1,
      city: NOIDA.city,
    });
    const orderId = await place([
      { listingId: a.listingId, qty: 1 },
      { listingId: b.listingId, qty: 1 },
    ]);

    const pos2 = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM procurement.purchase_order WHERE order_id = ${orderId}::uuid`;
    expect(pos2).toHaveLength(2);

    // Acknowledge and pack both, then book both.
    const subOrderIds: string[] = [];
    for (const po of pos2) {
      const lines = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM procurement.purchase_order_line WHERE po_id = ${po.id}::uuid`;
      await run(principalFor(vendor.userId, vendor.orgId, 'VENDOR', ['VENDOR_OWNER']), () =>
        pos.respond(
          po.id,
          lines.map((l) => ({ lineId: l.id, accept: true })),
        ),
      );
      const [sub] = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ordering.sub_order WHERE purchase_order_id = ${po.id}::uuid`;
      const lineIds = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ordering.order_line WHERE sub_order_id = ${sub!.id}::uuid`;
      const [unit] = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM listing.unit
         WHERE order_line_id = ANY(${lineIds.map((l) => l.id)}::uuid[]) LIMIT 1`;
      await db.$executeRaw`
        UPDATE procurement.purchase_order_line SET unit_id = ${unit!.id}::uuid
         WHERE id = ${lines[0]!.id}::uuid`;
      subOrderIds.push(sub!.id);
    }

    const first = await shipments.book(subOrderIds[0]!);
    const secondBooking = await shipments.book(subOrderIds[1]!);

    expect(first.shipmentId).not.toBe(secondBooking.shipmentId);
    expect(first.awb).not.toBe(secondBooking.awb);

    const froms = await db.$queryRaw<Array<{ from_address_id: string }>>`
      SELECT from_address_id FROM logistics.shipment ORDER BY created_at`;
    expect(new Set(froms.map((f) => f.from_address_id)).size).toBe(2);
  });

  it('is idempotent: booking twice returns the same shipment and the same AWB', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const orderId = await place([{ listingId: offer.listingId, qty: 1 }]);
    const { subOrderId } = await acknowledgeAndPack(orderId, vendor);

    const first = await shipments.book(subOrderId);
    const again = await shipments.book(subOrderId);

    expect(again.alreadyBooked).toBe(true);
    expect(again.shipmentId).toBe(first.shipmentId);
    expect(again.awb).toBe(first.awb);

    const [count] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment`;
    expect(Number(count!.n)).toBe(1);
  });

  it('keeps the routing reasoning, including who was excluded and why', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const orderId = await place([{ listingId: offer.listingId, qty: 1 }]);
    const { subOrderId } = await acknowledgeAndPack(orderId, vendor);

    const booking = await shipments.book(subOrderId);
    const [row] = await db.$queryRaw<
      Array<{
        detail: { chosen: string; excluded: Array<{ carrierCode: string; reason: string }> };
      }>
    >`
      SELECT detail FROM logistics.shipment WHERE id = ${booking.shipmentId}::uuid`;

    expect(row!.detail.chosen).toBe(booking.carrierCode);
    // Porter is registered INBOUND-only, so it must appear as excluded with the
    // reason rather than silently not being considered.
    const porter = row!.detail.excluded.find((e) => e.carrierCode === 'PORTER');
    expect(porter?.reason).toMatch(/OUTBOUND|serve/i);
  });

  it('sends an NCR lane in-house, because a routing rule says so', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const orderId = await place([{ listingId: offer.listingId, qty: 1 }]);
    const { subOrderId } = await acknowledgeAndPack(orderId, vendor);

    const booking = await shipments.book(subOrderId);
    expect(booking.carrierCode).toBe('INHOUSE');

    const [row] = await db.$queryRaw<Array<{ routing_rule_id: string | null }>>`
      SELECT routing_rule_id FROM logistics.shipment WHERE id = ${booking.shipmentId}::uuid`;
    expect(row!.routing_rule_id).not.toBeNull();
  });

  it('records a carrier refusal as a booking failure and a blocker, not as an absence', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const orderId = await place([{ listingId: offer.listingId, qty: 1 }]);
    const { subOrderId } = await acknowledgeAndPack(orderId, vendor);

    // The adapter the routing will pick, made to fail exactly as a carrier
    // outage does: the shipment must survive it carrying the reason.
    const registry = moduleRef.get<Map<string, { createShipment: unknown }>>(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/shared/adapters/adapters.module').CARRIER_REGISTRY,
    );
    const inhouse = registry.get('INHOUSE')!;
    const original = inhouse.createShipment;
    inhouse.createShipment = () => Promise.reject(new Error('Carrier gateway timed out'));

    try {
      const booking = await shipments.book(subOrderId);
      expect(booking.awb).toBeNull();
      expect(booking.bookingError).toMatch(/timed out/);

      const [shipment] = await db.$queryRaw<
        Array<{ status: string; detail: { bookingError: string } }>
      >`
        SELECT status::text AS status, detail FROM logistics.shipment
         WHERE id = ${booking.shipmentId}::uuid`;
      expect(shipment!.status).toBe('CREATED');
      expect(shipment!.detail.bookingError).toMatch(/timed out/);

      const [task] = await db.$queryRaw<Array<{ kind: string; severity: string }>>`
        SELECT kind, severity FROM ordering.ops_task WHERE kind = 'BOOKING_FAILED'`;
      expect(task).toMatchObject({ kind: 'BOOKING_FAILED', severity: 'BLOCKER' });
    } finally {
      inhouse.createShipment = original;
    }
  });

  it('stores neither OTP in clear', async () => {
    const vendor = await makeVendor();
    const offer = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const orderId = await place([{ listingId: offer.listingId, qty: 1 }]);
    const { subOrderId } = await acknowledgeAndPack(orderId, vendor);
    await shipments.book(subOrderId);

    const [pickup] = await db.$queryRaw<Array<{ otp_hash: string }>>`
      SELECT otp_hash FROM logistics.pickup_task`;
    const [delivery] = await db.$queryRaw<Array<{ otp_hash: string }>>`
      SELECT otp_hash FROM logistics.delivery_task`;

    // A sha256 hex digest, and never six digits.
    for (const hash of [pickup!.otp_hash, delivery!.otp_hash]) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toMatch(/^\d{6}$/);
    }
    expect(pickup!.otp_hash).not.toBe(delivery!.otp_hash);
  });
});
