/**
 * One order, one purchase order per SUPPLY POINT.
 *
 * `uq_po_order_vendor` allowed exactly one PO per vendor per order, so a vendor
 * holding stock in two warehouses received a single document covering both.
 * That document cannot be acted on: acknowledging it would release Pune stock on
 * a Gurugram pickup, the two consignments have two freight quotes and two
 * dispatch clocks, and where the vendor holds more than one GSTIN they are two
 * places of supply.
 *
 * Every assertion below is about the split and what hangs off it. The tax,
 * stock and ledger properties of a checkout are `checkout-order.spec.ts`'s job
 * and are not restated here.
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
import { CheckoutService } from '../../src/modules/ordering/internal/checkout.service';
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
  const principal: Principal = {
    userId: buyerUserId,
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

/** A verified vendor and its first pickup address. */
async function makeVendor(place = GURUGRAM): Promise<{ orgId: string; addressId: string }> {
  const orgId = await makeOrganization({ legal_name: `Northgate ${randomUUID().slice(0, 6)}` }, db);
  await db.$executeRaw`
    INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, verified)
    VALUES (${orgId}::uuid, '\\x00'::bytea, '1234', ${randomUUID()}, TRUE)`;
  return { orgId, addressId: await addPickup(orgId, place) };
}

/** A second (or third) warehouse for a vendor that already exists. */
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

async function makeOffer(input: {
  vendorOrgId: string;
  pickupAddressId: string;
  qty: number;
  city?: string;
  valuationMethod?: 'REGULAR' | 'MARGIN';
  /** One unit of a different method, to prove the refusal is per supply point. */
  mixedValuation?: boolean;
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
    const method =
      input.mixedValuation && i === 0 ? 'MARGIN' : (input.valuationMethod ?? 'REGULAR');
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, grade_actual, status, location,
                                qc_passed_at, qc_valid_until, vendor_ask_price,
                                valuation_method, itc_eligible, retail_price, supply_point_code)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${input.vendorOrgId}::uuid, ${skuId}::uuid,
              ${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()},
              'A'::grade_type, 'A'::grade_type, 'LISTED'::unit_status, 'VENDOR',
              ${NOW}, CURRENT_DATE + 60, ${VENDOR_ASK}::numeric,
              ${method}, ${method === 'REGULAR'}, ${RETAIL}::numeric, ${code})`;
    // A unit is only sellable with a passed, in-date report and an intact seal
    // — `listing.unit_is_sellable` is the one definition and the checkout reads
    // it through `v_sellable_unit`, so the fixture has to satisfy it in full.
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

const confirmArgs = (cartId: string) => ({
  cartId,
  gstProfileId,
  billingAddressId: siteId,
  deliveryAddressId: siteId,
  paymentMode: 'PREPAID' as const,
});

interface PoRow {
  id: string;
  pickup_address_id: string | null;
  supply_point_label: string | null;
  vendor_org_id: string;
  valuation_method: string;
  total_net: string;
}

const posFor = (orderId: string): Promise<PoRow[]> =>
  db.$queryRaw<PoRow[]>`
    SELECT id, pickup_address_id, supply_point_label, vendor_org_id,
           valuation_method, total_net::text AS total_net
      FROM procurement.purchase_order WHERE order_id = ${orderId}::uuid
     ORDER BY supply_point_label`;

const place = async (
  lines: Array<{ listingId: string; qty: number }>,
): Promise<{ orderId: string }> => {
  const cartId = await makeCart(lines);
  await asBuyer(() => checkout.begin(cartId));
  const order = await asBuyer(() => checkout.confirm(confirmArgs(cartId)));
  const [row] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ordering."order" WHERE order_number = ${order.orderNumber}`;
  return { orderId: row!.id };
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
  // Rate cards and India Post zones for the NCR lanes. `truncateAll` empties
  // both tables, so every test re-seeds them or freight comes back unpriced.
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

describe('a purchase order is a vendor’s stock at one pickup address', () => {
  it('raises two POs for one vendor shipping from two warehouses, each linked to its sub-order', async () => {
    const vendor = await makeVendor();
    const second = await addPickup(vendor.orgId, NOIDA);
    const a = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
    });
    const b = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: second,
      qty: 1,
      city: NOIDA.city,
    });

    const { orderId } = await place([
      { listingId: a.listingId, qty: 2 },
      { listingId: b.listingId, qty: 1 },
    ]);

    const pos = await posFor(orderId);
    expect(pos).toHaveLength(2);
    expect(new Set(pos.map((p) => p.pickup_address_id))).toEqual(
      new Set([vendor.addressId, second]),
    );
    // One vendor, so the old constraint would have allowed only one of these.
    expect(new Set(pos.map((p) => p.vendor_org_id))).toEqual(new Set([vendor.orgId]));

    const subs = await db.$queryRaw<
      Array<{
        id: string;
        purchase_order_id: string | null;
        pickup_address_id: string | null;
        freight: string;
      }>
    >`
      SELECT id, purchase_order_id, pickup_address_id, freight::text AS freight
        FROM ordering.sub_order WHERE order_id = ${orderId}::uuid`;
    expect(subs).toHaveLength(2);
    // 1:1, walked in either direction.
    expect(subs.every((s) => s.purchase_order_id !== null)).toBe(true);
    expect(new Set(subs.map((s) => s.purchase_order_id))).toEqual(new Set(pos.map((p) => p.id)));
    expect(new Set(subs.map((s) => s.pickup_address_id))).toEqual(
      new Set([vendor.addressId, second]),
    );
    // Freight is per consignment: each lane carries its own quote, and the two
    // are not both charged to whichever document was built first.
    for (const s of subs) expect(Number(s.freight)).toBeGreaterThan(0);
  });

  it('still raises one PO per vendor when each has a single warehouse', async () => {
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
    const pos = await posFor(orderId);
    expect(pos).toHaveLength(2);
    expect(new Set(pos.map((p) => p.vendor_org_id))).toEqual(new Set([alpha.orgId, beta.orgId]));
  });

  it('keeps three lines from one warehouse on one PO', async () => {
    const vendor = await makeVendor();
    // Sequential: `listing.assign_supply_point` is unique on (vendor, city), so
    // three parallel calls race each other rather than the code under test.
    const offers = [];
    for (let i = 0; i < 3; i += 1) {
      offers.push(
        await makeOffer({ vendorOrgId: vendor.orgId, pickupAddressId: vendor.addressId, qty: 1 }),
      );
    }

    const { orderId } = await place(offers.map((o) => ({ listingId: o.listingId, qty: 1 })));
    const pos = await posFor(orderId);
    expect(pos).toHaveLength(1);

    const [lines] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM procurement.purchase_order_line
       WHERE po_id = ${pos[0]!.id}::uuid`;
    expect(Number(lines!.n)).toBe(3);
  });

  it('gives each warehouse its own valuation method instead of refusing the order', async () => {
    const vendor = await makeVendor();
    const second = await addPickup(vendor.orgId, NOIDA);
    const regular = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 1,
    });
    const margin = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: second,
      qty: 1,
      city: NOIDA.city,
      valuationMethod: 'MARGIN',
    });

    const { orderId } = await place([
      { listingId: regular.listingId, qty: 1 },
      { listingId: margin.listingId, qty: 1 },
    ]);
    const pos = await posFor(orderId);
    expect(pos).toHaveLength(2);
    expect(new Set(pos.map((p) => p.valuation_method))).toEqual(new Set(['REGULAR', 'MARGIN']));
  });

  it('still refuses one warehouse whose own machines mix valuation methods', async () => {
    const vendor = await makeVendor();
    const mixed = await makeOffer({
      vendorOrgId: vendor.orgId,
      pickupAddressId: vendor.addressId,
      qty: 2,
      mixedValuation: true,
    });

    const cartId = await makeCart([{ listingId: mixed.listingId, qty: 2 }]);
    await asBuyer(() => checkout.begin(cartId));
    await expect(asBuyer(() => checkout.confirm(confirmArgs(cartId)))).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'mixed_valuation_method' }),
    });

    const [orders] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM procurement.purchase_order`;
    expect(Number(orders!.n)).toBe(0);
  });

  it('labels the supply point without ever naming the vendor', async () => {
    const vendor = await makeVendor();
    const second = await addPickup(vendor.orgId, NOIDA);
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

    const { orderId } = await place([
      { listingId: a.listingId, qty: 1 },
      { listingId: b.listingId, qty: 1 },
    ]);

    const [vendorRow] = await db.$queryRaw<Array<{ legal_name: string }>>`
      SELECT legal_name FROM identity.organization WHERE id = ${vendor.orgId}::uuid`;
    const vendorName = vendorRow!.legal_name;

    const pos = await posFor(orderId);
    expect(pos.map((p) => p.supply_point_label)).toEqual([
      'Supply Point A - Gurugram',
      'Supply Point B - Noida',
    ]);
    for (const po of pos) {
      expect(po.supply_point_label).not.toContain(vendorName);
      // The first word of the vendor's name, in case the label ever tried to
      // shorten it rather than replace it.
      expect(po.supply_point_label?.toLowerCase()).not.toContain(
        vendorName.split(' ')[0]!.toLowerCase(),
      );
    }
  });
});
