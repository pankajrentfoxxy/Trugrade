/**
 * The in-house rider's collection and delivery.
 *
 * Two properties carry this file. **The scanner does not shrug** — a missing
 * serial refuses and a broken seal quarantines, because chain of custody is the
 * entire argument for a graded-device marketplace. And **the manifest discloses
 * nothing commercial** — a rider needs a door, a box and a signature, and their
 * phone is the least controlled screen this platform has.
 */

import { randomUUID, createHash } from 'node:crypto';
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
import { AutomationModule } from '../../src/shared/automation/automation.service';
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { LogisticsModule } from '../../src/modules/logistics';
import { RiderController } from '../../src/modules/logistics/rider.controller';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeCatalog, makeOrganization, makeUser } from '../support/factories';

const NOW = new Date(new Date().toISOString().slice(0, 10) + 'T09:00:00.000Z');
const PICKUP_OTP = '445566';
const DELIVERY_OTP = '778899';
const VENDOR_NAME = 'Northgate IT Assets Pvt. Ltd.';
const CUSTOMER_NAME = 'Harbourpoint Devices Pvt Ltd';
const CUSTOMER_CONTACT = 'Ravi Menon';

let moduleRef: TestingModule;
let rider: RiderController;
let ctx: RequestContextService;
let redis: RedisService;
let db: PrismaClient;

let riderUserId: string;
let pickupTaskId: string;
let deliveryTaskId: string;
let shipmentId: string;
let subOrderId: string;
let serials: string[];
let sealCodes: string[];

const hash = (code: string, saltId: string): string =>
  createHash('sha256').update(`${saltId}:${code}`).digest('hex');

function asRider<T>(fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = ['RIDER'];
  const principal: Principal = {
    userId: riderUserId,
    orgId: 'platform',
    orgType: 'PLATFORM',
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
      AutomationModule,
      AuthModule,
      AdaptersModule,
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

  rider = moduleRef.get(RiderController);
  ctx = moduleRef.get(RequestContextService);
  redis = moduleRef.get(RedisService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

/** One packed consignment, a rider assigned to both ends of it. */
beforeEach(async () => {
  await truncateAll(db);
  await redis.client.flushdb();
  const { skuId } = await makeCatalog({}, db);

  const vendorOrgId = await makeOrganization({ legal_name: VENDOR_NAME }, db);
  const buyerOrgId = await makeOrganization({ org_type: 'BUYER', legal_name: CUSTOMER_NAME }, db);

  const pickupAddressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${pickupAddressId}::uuid, ${vendorOrgId}::uuid, 'PICKUP'::address_type,
            'Plot 42, Udyog Vihar', 'Gurugram', 'Haryana', '06', '122015',
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  const shipToId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile)
    VALUES (${shipToId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type, 'Tower B',
            'New Delhi', 'Delhi', '07', '110001', ${CUSTOMER_CONTACT}, '+919812345678')`;

  // A minimal order and consignment: this file is about the rider, and a full
  // checkout here would make a failure harder to read rather than the test stronger.
  const buyerUserId = await makeUser(buyerOrgId, {}, db);
  const gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, '06AABCU9603R1ZM', ${CUSTOMER_NAME},
            '06', 'ACTIVE', ${NOW}, TRUE)`;

  const orderId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id,
       subtotal, gst_total, freight_total, grand_total, payment_mode, payment_status,
       status, placed_at)
    VALUES (${orderId}::uuid, ${'TT-26-' + String(Math.floor(Math.random() * 99999)).padStart(5, '0')},
            ${buyerOrgId}::uuid, ${buyerUserId}::uuid, ${gstProfileId}::uuid,
            ${shipToId}::uuid, ${shipToId}::uuid,
            84000, 15120, 0, 99120, 'PREPAID', 'PAID',
            'VENDOR_ACCEPTED'::public.order_status, ${NOW})`;

  subOrderId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.sub_order
      (id, order_id, sub_order_number, vendor_org_id, pickup_address_id,
       subtotal, gst_total, freight, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, 'SO-1', ${vendorOrgId}::uuid,
            ${pickupAddressId}::uuid, 84000, 15120, 0, 'VENDOR_ACCEPTED'::public.order_status)`;

  const [carrier] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM logistics.carrier WHERE code = 'INHOUSE'`;
  shipmentId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.shipment
      (id, leg, sub_order_id, carrier_id, from_address_id, to_address_id, mode,
       declared_value, boxes, status, route_type, awb_number, created_at)
    VALUES (${shipmentId}::uuid, 'OUTBOUND'::public.shipment_leg, ${subOrderId}::uuid,
            ${carrier!.id}::uuid, ${pickupAddressId}::uuid, ${shipToId}::uuid, 'SURFACE',
            84000, 2, 'SCHEDULED'::public.shipment_status, 'DIRECT'::public.route_type,
            'TG-IH-00000001', ${NOW})`;

  serials = [];
  sealCodes = [];
  for (let i = 0; i < 2; i += 1) {
    const listingId = randomUUID();
    await db.$executeRaw`
      INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                   condition_type, battery_health_band, parts_status,
                                   unit_price, gst_rate, qty_total, status)
      VALUES (${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid, ${pickupAddressId}::uuid,
              'A'::grade_type, 'REFURBISHED'::condition_type, 'GOOD_80_89'::battery_band,
              'ALL_ORIGINAL'::parts_status_type, 42000, 18.00, 1, 'ACTIVE'::listing_status)`;
    const unitId = randomUUID();
    const serial = `SER${String(i).padStart(9, '0')}`;
    serials.push(serial);
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, status, location, vendor_ask_price,
                                valuation_method, itc_eligible)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid,
              ${serial}, 'A'::grade_type, 'RESERVED'::unit_status, 'VENDOR', 30000,
              'REGULAR', TRUE)`;
    await db.$executeRaw`
      INSERT INTO logistics.shipment_unit (shipment_id, unit_id, serial_number)
      VALUES (${shipmentId}::uuid, ${unitId}::uuid, ${serial})`;
    sealCodes.push(`TRG-26HR-${String(i).padStart(7, '0')}`);
  }

  riderUserId = await makeUser(vendorOrgId, {}, db);
  const riderId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.rider (id, user_id, phone, zone, vehicle_type)
    VALUES (${riderId}::uuid, ${riderUserId}::uuid, '+919800000001', 'NCR', 'BIKE')`;

  pickupTaskId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.pickup_task
      (id, sub_order_id, vendor_org_id, address_id, expected_serials, expected_seals,
       otp_hash, assigned_rider_id, status)
    VALUES (${pickupTaskId}::uuid, ${subOrderId}::uuid, ${vendorOrgId}::uuid,
            ${pickupAddressId}::uuid, ${serials}::text[], ${sealCodes}::text[],
            ${hash(PICKUP_OTP, pickupTaskId)}, ${riderId}::uuid, 'ASSIGNED')`;

  deliveryTaskId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.delivery_task (id, shipment_id, rider_id, otp_hash, status)
    VALUES (${deliveryTaskId}::uuid, ${shipmentId}::uuid, ${riderId}::uuid,
            ${hash(DELIVERY_OTP, deliveryTaskId)}, 'ASSIGNED')`;
});

/* ========================================================================== */

describe('the rider’s collection', () => {
  it('shows the manifest without naming the vendor or the customer', async () => {
    const manifest = await asRider(() =>
      rider.pickup({ userId: riderUserId } as never, pickupTaskId),
    );
    const json = JSON.stringify(manifest);

    expect(manifest.expectedSerials).toHaveLength(2);
    expect(manifest.expectedSeals).toHaveLength(2);
    expect(manifest.address.contactMobile).toBe('+919876543210');
    expect(manifest.destinationCity).toBe('New Delhi');

    // The whole point of this controller. Asserted on the serialised payload,
    // so a name added at any depth later fails here.
    expect(json).not.toContain(VENDOR_NAME);
    expect(json).not.toContain('Northgate');
    expect(json).not.toContain(CUSTOMER_NAME);
    expect(json).not.toContain(CUSTOMER_CONTACT);
    expect(json).not.toContain('Tower B');
    // And no money.
    expect(json).not.toContain('84000');
    expect(json).not.toContain('42000');
  });

  it('refuses a wrong OTP and leaves the collection open', async () => {
    await asRider(() =>
      rider.scan({ userId: riderUserId } as never, pickupTaskId, {
        serials,
        seals: sealCodes,
      }),
    );

    await expect(
      asRider(() =>
        rider.completePickup({ userId: riderUserId } as never, pickupTaskId, { otp: '000000' }),
      ),
    ).rejects.toMatchObject({ detail: expect.objectContaining({ reason: 'otp_mismatch' }) });

    const [task] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM logistics.pickup_task WHERE id = ${pickupTaskId}::uuid`;
    expect(task!.status).toBe('ASSIGNED');
  });

  it('refuses a collection with a machine missing from the scan', async () => {
    await asRider(() =>
      rider.scan({ userId: riderUserId } as never, pickupTaskId, {
        serials: [serials[0]!],
        seals: sealCodes,
      }),
    );

    await expect(
      asRider(() =>
        rider.completePickup({ userId: riderUserId } as never, pickupTaskId, { otp: PICKUP_OTP }),
      ),
    ).rejects.toMatchObject({ detail: expect.objectContaining({ reason: 'serials_missing' }) });
  });

  it('completes with every serial and seal, and hands custody to the carrier', async () => {
    await asRider(() =>
      rider.scan({ userId: riderUserId } as never, pickupTaskId, {
        serials,
        seals: sealCodes,
      }),
    );
    const result = await asRider(() =>
      rider.completePickup({ userId: riderUserId } as never, pickupTaskId, { otp: PICKUP_OTP }),
    );

    expect(result).toMatchObject({ status: 'COMPLETED', sealsIntact: true, brokenSealCodes: [] });

    const [shipment] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM logistics.shipment WHERE id = ${shipmentId}::uuid`;
    expect(shipment!.status).toBe('PICKED_UP');

    const [custody] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.custody_event
       WHERE from_party = 'VENDOR' AND to_party = 'CARRIER'`;
    expect(Number(custody!.n)).toBe(2);
  });

  it('completes a broken seal but quarantines the money and raises a blocker', async () => {
    await asRider(() =>
      rider.scan({ userId: riderUserId } as never, pickupTaskId, {
        serials,
        // One seal is not scanned: it was not intact at the door.
        seals: [sealCodes[0]!],
      }),
    );
    const result = await asRider(() =>
      rider.completePickup({ userId: riderUserId } as never, pickupTaskId, { otp: PICKUP_OTP }),
    );

    expect(result.sealsIntact).toBe(false);
    expect(result.brokenSealCodes).toEqual([sealCodes[1]]);

    const [task] = await db.$queryRaw<Array<{ kind: string; severity: string }>>`
      SELECT kind, severity FROM ordering.ops_task WHERE kind = 'SEAL_BROKEN'`;
    expect(task).toMatchObject({ kind: 'SEAL_BROKEN', severity: 'BLOCKER' });

    const [row] = await db.$queryRaw<Array<{ seals_intact: boolean }>>`
      SELECT seals_intact FROM logistics.pickup_task WHERE id = ${pickupTaskId}::uuid`;
    expect(row!.seals_intact).toBe(false);
  });
});

describe('the rider’s delivery', () => {
  it('marks it delivered on the OTP and a photograph', async () => {
    const result = await asRider(() =>
      rider.completeDelivery({ userId: riderUserId } as never, deliveryTaskId, {
        otp: DELIVERY_OTP,
        photoKeys: ['qc/pod/one.jpg'],
      }),
    );
    expect(result.status).toBe('DELIVERED');

    const [shipment] = await db.$queryRaw<Array<{ status: string; delivered_at: Date | null }>>`
      SELECT status::text AS status, delivered_at FROM logistics.shipment
       WHERE id = ${shipmentId}::uuid`;
    expect(shipment!.status).toBe('DELIVERED');
    expect(shipment!.delivered_at).not.toBeNull();

    const [sub] = await db.$queryRaw<Array<{ status: string; delivered_at: Date | null }>>`
      SELECT status::text AS status, delivered_at FROM ordering.sub_order
       WHERE id = ${subOrderId}::uuid`;
    expect(sub!.status).toBe('DELIVERED');
    expect(sub!.delivered_at).not.toBeNull();
  });

  it('refuses a wrong OTP at the door', async () => {
    await expect(
      asRider(() =>
        rider.completeDelivery({ userId: riderUserId } as never, deliveryTaskId, {
          otp: '111111',
          photoKeys: ['qc/pod/one.jpg'],
        }),
      ),
    ).rejects.toMatchObject({ detail: expect.objectContaining({ reason: 'otp_mismatch' }) });

    const [shipment] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM logistics.shipment WHERE id = ${shipmentId}::uuid`;
    expect(shipment!.status).toBe('SCHEDULED');
  });

  it('records a failed attempt as an NDR task', async () => {
    const result = await asRider(() =>
      rider.failDelivery({ userId: riderUserId } as never, deliveryTaskId, {
        reason: 'Nobody at the goods gate',
        outcome: 'CONSIGNEE_UNAVAILABLE',
      }),
    );
    expect(result.attemptNo).toBe(1);

    const [task] = await db.$queryRaw<Array<{ kind: string; severity: string }>>`
      SELECT kind, severity FROM ordering.ops_task WHERE kind = 'NDR'`;
    expect(task).toMatchObject({ kind: 'NDR', severity: 'ATTENTION' });
  });

  it('shows a delivery without the consignee’s name', async () => {
    const view = await asRider(() =>
      rider.delivery({ userId: riderUserId } as never, deliveryTaskId),
    );
    const json = JSON.stringify(view);
    expect(view.address.city).toBe('New Delhi');
    expect(json).not.toContain(CUSTOMER_NAME);
    expect(json).not.toContain(CUSTOMER_CONTACT);
  });
});
