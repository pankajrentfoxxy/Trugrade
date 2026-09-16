/**
 * The automation engine: rules as rows, runs as evidence.
 *
 * The user's requirement was "each step should be updated, each flow connected"
 * — which is only real if an operator can see what fired, switch one off, and
 * watch one fail. So these assertions are about visibility as much as behaviour:
 * a rule that silently does nothing is worse than no rule, because nobody goes
 * looking for the order it skipped.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import {
  FLOW_EXCEPTIONS,
  MAPPED_ORDER_STATUSES,
  ORDER_FLOW,
  flowPosition,
  permissionsFor,
  type Role,
} from '@trugrade/contracts';
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
import {
  AutomationModule,
  AutomationService,
} from '../../src/shared/automation/automation.service';
import { RedisModule, RedisService } from '../../src/shared/redis/redis.service';
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { ProcurementModule } from '../../src/modules/procurement';
import { LogisticsModule } from '../../src/modules/logistics';
import { OpsLogisticsController } from '../../src/modules/logistics/ops-logistics.controller';
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
const RETAIL = 42_000;
const VENDOR_ASK = 30_000;

let moduleRef: TestingModule;
let checkout: CheckoutService;
let pos: PurchaseOrderService;
let dispatch: OpsLogisticsController;
let automation: AutomationService;
let ctx: RequestContextService;
let redis: RedisService;
let db: PrismaClient;

let buyerOrgId: string;
let buyerUserId: string;
let gstProfileId: string;
let siteId: string;
let skuId: string;
let technician: { technicianId: string; userId: string };
let opsUserId: string;

const principalFor = (
  userId: string,
  orgId: string,
  orgType: 'BUYER' | 'VENDOR' | 'PLATFORM',
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

async function makeVendor(): Promise<{ orgId: string; userId: string; addressId: string }> {
  const orgId = await makeOrganization({ legal_name: `Northgate ${randomUUID().slice(0, 6)}` }, db);
  const userId = await makeUser(orgId, {}, db);
  await db.$executeRaw`
    INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, verified)
    VALUES (${orgId}::uuid, '\\x00'::bytea, '1234', ${randomUUID()}, TRUE)`;
  await db.$executeRaw`
    UPDATE identity.organization SET tier = 'GOLD'::vendor_tier WHERE id = ${orgId}::uuid`;
  const addressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${addressId}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Plot 42, Udyog Vihar',
            ${GURUGRAM.city}, ${GURUGRAM.state}, ${GURUGRAM.stateCode}, ${GURUGRAM.pincode},
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  return { orgId, userId, addressId };
}

async function makeOffer(vendorOrgId: string, pickupAddressId: string, qty: number) {
  const listingId = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, gst_rate, qty_total, status)
    VALUES (${listingId}::uuid, ${vendorOrgId}::uuid, ${skuId}::uuid,
            ${pickupAddressId}::uuid, 'A'::grade_type, 'REFURBISHED'::condition_type,
            'GOOD_80_89'::battery_band, 'ALL_ORIGINAL'::parts_status_type,
            ${RETAIL}, 18.00, ${qty}, 'ACTIVE'::listing_status)`;
  const [{ code } = { code: '' }] = await db.$queryRaw<Array<{ code: string }>>`
    SELECT listing.assign_supply_point(${vendorOrgId}::uuid, ${GURUGRAM.city}) AS code`;

  for (let i = 0; i < qty; i += 1) {
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
  return listingId;
}

async function placeOrder(listingId: string, qty: number): Promise<string> {
  const cartId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.cart (id, buyer_org_id, user_id, name, status)
    VALUES (${cartId}::uuid, ${buyerOrgId}::uuid, ${buyerUserId}::uuid, 'Cart', 'OPEN')`;
  await db.$executeRaw`
    INSERT INTO ordering.cart_item (cart_id, listing_id, qty, unit_price_snapshot)
    VALUES (${cartId}::uuid, ${listingId}::uuid, ${qty}, ${RETAIL}::numeric)`;
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
  return order.orderNumber;
}

/** Acknowledge, then scan each machine in — which is what makes it packed. */
async function acknowledgeAndPack(
  orderNumber: string,
  vendor: { orgId: string; userId: string },
): Promise<string> {
  const [order] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ordering."order" WHERE order_number = ${orderNumber}`;
  const [po] = await db.$queryRaw<Array<{ id: string; po_number: string }>>`
    SELECT id, po_number FROM procurement.purchase_order WHERE order_id = ${order!.id}::uuid`;
  const lines = await db.$queryRaw<Array<{ id: string; sku_id: string; grade_at_po: string }>>`
    SELECT id, sku_id, grade_at_po::text AS grade_at_po
      FROM procurement.purchase_order_line WHERE po_id = ${po!.id}::uuid ORDER BY id`;

  const vendorPrincipal = principalFor(vendor.userId, vendor.orgId, 'VENDOR', ['VENDOR_OWNER']);
  await run(vendorPrincipal, () =>
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
     WHERE order_line_id = ANY(${lineIds.map((l) => l.id)}::uuid[]) ORDER BY id`;

  for (const [i, line] of lines.entries()) {
    const unit = units[i];
    if (!unit) break;
    await run(vendorPrincipal, () =>
      pos.attach(po!.id, { skuId: line.sku_id, grade: line.grade_at_po, unitId: unit.id }),
    );
  }
  return po!.po_number;
}

const asOps = <T>(fn: () => Promise<T>): Promise<T> =>
  run(principalFor(opsUserId, 'platform', 'PLATFORM', ['OPS_MANAGER']), fn);

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
  dispatch = moduleRef.get(OpsLogisticsController);
  automation = moduleRef.get(AutomationService);
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
  opsUserId = await makeUser(buyerOrgId, {}, db);
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
  // Rules are seeded by the migration; a test that disables one puts it back.
  await db.$executeRaw`UPDATE platform.automation_rule SET enabled = TRUE`;
  await db.$executeRaw`DELETE FROM platform.automation_run`;
});

/* ========================================================================== */

describe('the rules are rows an operator can read', () => {
  it('gives every rule a trigger, a condition, an action and a failure path', async () => {
    const rules = await automation.rules();
    expect(rules.length).toBeGreaterThanOrEqual(12);
    for (const rule of rules) {
      expect(rule.triggerEvent.trim()).not.toBe('');
      expect(rule.conditionNote.trim()).not.toBe('');
      expect(rule.actionNote.trim()).not.toBe('');
      // The one that matters: a rule with no failure path fails silently.
      expect(rule.failureNote.trim()).not.toBe('');
      expect(['AUTO', 'SUGGEST', 'MANUAL']).toContain(rule.mode);
    }
  });

  it('places every order status somewhere in the flow, exceptions included', () => {
    for (const status of MAPPED_ORDER_STATUSES) {
      expect(flowPosition(status)).not.toBeNull();
    }
    // The bug this assertion exists for: an exception state with no index makes
    // `undefined >= 6` false, and every failed delivery silently disappears.
    for (const exception of FLOW_EXCEPTIONS) {
      expect(flowPosition(exception === 'NDR' ? 'OUT_FOR_DELIVERY' : exception)).not.toBeNull();
    }
    expect(ORDER_FLOW.map((s) => s.k)).toContain('PACKED');
  });
});

describe('confirming an order and packing it', () => {
  it('writes one automation run per purchase order raised', async () => {
    const vendor = await makeVendor();
    const listingId = await makeOffer(vendor.orgId, vendor.addressId, 2);
    const orderNumber = await placeOrder(listingId, 2);

    const runs = await automation.runs({ ruleId: 'R1' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.objectRef).toBe(orderNumber);
    expect(runs[0]!.status).toBe('OK');
  });

  it('turns an acknowledged PO into a packed one once every serial is scanned', async () => {
    const vendor = await makeVendor();
    const listingId = await makeOffer(vendor.orgId, vendor.addressId, 2);
    const orderNumber = await placeOrder(listingId, 2);
    const poNumber = await acknowledgeAndPack(orderNumber, vendor);

    const [po] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM procurement.purchase_order
       WHERE po_number = ${poNumber}`;
    expect(po!.status).toBe('DISPATCH_READY');
  });
});

describe('one-click dispatch', () => {
  it('books exactly one shipment, and a second press returns the same AWB', async () => {
    const vendor = await makeVendor();
    const listingId = await makeOffer(vendor.orgId, vendor.addressId, 1);
    const orderNumber = await placeOrder(listingId, 1);
    const poNumber = await acknowledgeAndPack(orderNumber, vendor);

    const first = await asOps(() => dispatch.dispatch(poNumber));
    expect(first.awb).toBeTruthy();
    expect(first.alreadyBooked).toBe(false);

    const second = await asOps(() => dispatch.dispatch(poNumber));
    expect(second.awb).toBe(first.awb);
    expect(second.alreadyBooked).toBe(true);

    const [shipments] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment`;
    expect(Number(shipments!.n)).toBe(1);

    const runs = await automation.runs({ ruleId: 'R2' });
    expect(runs.filter((r) => r.status === 'OK').length).toBeGreaterThanOrEqual(2);
  });

  it('reports a bulk dispatch per carrier rather than as one number', async () => {
    const poNumbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const vendor = await makeVendor();
      const listingId = await makeOffer(vendor.orgId, vendor.addressId, 1);
      const orderNumber = await placeOrder(listingId, 1);
      poNumbers.push(await acknowledgeAndPack(orderNumber, vendor));
    }

    const result = await asOps(() => dispatch.dispatchMany({ poNumbers }));

    expect(result.booked).toBe(3);
    expect(result.failed).toBe(0);
    // Every NCR lane goes in-house by rule, so the shape is one carrier with
    // three — what matters is that the answer is per carrier at all.
    expect(Object.values(result.byCarrier).reduce((a, b) => a + b, 0)).toBe(3);
    expect(Object.keys(result.byCarrier)).toContain('INHOUSE');

    const [shipments] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment`;
    expect(Number(shipments!.n)).toBe(3);
  });

  it('refuses a PO the vendor has not packed', async () => {
    const vendor = await makeVendor();
    const listingId = await makeOffer(vendor.orgId, vendor.addressId, 1);
    const orderNumber = await placeOrder(listingId, 1);
    const [order] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ordering."order" WHERE order_number = ${orderNumber}`;
    const [po] = await db.$queryRaw<Array<{ po_number: string }>>`
      SELECT po_number FROM procurement.purchase_order WHERE order_id = ${order!.id}::uuid`;

    await expect(asOps(() => dispatch.dispatch(po!.po_number))).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'po_not_packed' }),
    });
  });
});

describe('an operator can switch a rule off and watch it stop', () => {
  it('stops booking while R2 is disabled, and resumes when it is re-enabled', async () => {
    const vendor = await makeVendor();
    const listingId = await makeOffer(vendor.orgId, vendor.addressId, 1);
    const orderNumber = await placeOrder(listingId, 1);
    const poNumber = await acknowledgeAndPack(orderNumber, vendor);

    await automation.setEnabled('R2', false, opsUserId);
    await expect(asOps(() => dispatch.dispatch(poNumber))).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'automation_disabled' }),
    });

    const [none] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM logistics.shipment`;
    expect(Number(none!.n)).toBe(0);

    // The skip is on the log, not silence: "why did this not book" is answerable.
    const skipped = (await automation.runs({ ruleId: 'R2' })).filter((r) => r.status === 'SKIPPED');
    expect(skipped.length).toBeGreaterThanOrEqual(1);

    await automation.setEnabled('R2', true, opsUserId);
    const booked = await asOps(() => dispatch.dispatch(poNumber));
    expect(booked.awb).toBeTruthy();
  });

  it('records who switched it, and refuses an unsigned change', async () => {
    await automation.setEnabled('R1', false, opsUserId);
    const [audit] = await db.$queryRaw<Array<{ actor_user_id: string; entity_id: string }>>`
      SELECT actor_user_id, entity_id FROM identity.audit_log
       WHERE action = 'platform.automation.rule_toggled'`;
    expect(audit!.actor_user_id).toBe(opsUserId);
    expect(audit!.entity_id).toBe('R1');

    await expect(automation.setEnabled('R1', true, null)).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'no_principal' }),
    });
  });

  it('puts a failed run on the log within the same request', async () => {
    const vendor = await makeVendor();
    const listingId = await makeOffer(vendor.orgId, vendor.addressId, 1);
    const orderNumber = await placeOrder(listingId, 1);
    const poNumber = await acknowledgeAndPack(orderNumber, vendor);

    await expect(
      automation.run('R2', poNumber, () => Promise.reject(new Error('carrier gateway down'))),
    ).rejects.toThrow('carrier gateway down');

    const failed = await automation.runs({ status: 'FAILED' });
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error).toMatch(/gateway down/);
    expect(failed[0]!.objectRef).toBe(poNumber);
  });
});
