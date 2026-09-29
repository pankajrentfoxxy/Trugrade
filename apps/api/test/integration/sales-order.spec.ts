/**
 * The buyer's sales order follows the vendor's answer — through `ordering`'s
 * own columns, never through the purchase order.
 *
 * One fixture, one order, one dispatch point with three lines. Before the
 * vendor answers the sales order is WAITING with no totals; after "2 of 3",
 * it prices exactly the two confirmed machines with GST and freight, and it
 * says money is owed.
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
import { CatalogModule } from '../../src/modules/catalog';
import { OrderingModule } from '../../src/modules/ordering';
import { ProcurementModule } from '../../src/modules/procurement';
import { ProcurementController } from '../../src/modules/procurement/procurement.controller';
import { OrderReadService } from '../../src/modules/ordering/internal/order-read.service';
import { NotFoundError } from '../../src/shared/errors/domain-errors';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeOrganization, makeUser, seedSellableUnit } from '../support/factories';

const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:00.000Z`);

let moduleRef: TestingModule;
let procurement: ProcurementController;
let readOrder: OrderReadService;
let ctx: RequestContextService;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

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

  procurement = moduleRef.get(ProcurementController);
  readOrder = moduleRef.get(OrderReadService);
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
  await seedTestReference(raw);
});

function as<T>(orgId: string, orgType: 'VENDOR' | 'BUYER', fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = orgType === 'VENDOR' ? ['VENDOR_OWNER'] : ['CUSTOMER_BUYER'];
  const principal: Principal = {
    userId: randomUUID(),
    orgId,
    orgType,
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

/** One order, one consignment, three machines of three SKUs at ₹30,000 + 18%. */
async function seedOrderWithPo(): Promise<{
  poId: string;
  vendorOrgId: string;
  buyerOrgId: string;
  orderNumber: string;
  skuIds: string[];
}> {
  const vendorOrgId = await makeOrganization({ org_type: 'VENDOR' }, raw);
  await makeAddress(vendorOrgId, {}, raw);
  const buyerOrgId = await makeOrganization({ org_type: 'BUYER' }, raw);
  const buyerUser = await makeUser(buyerOrgId, {}, raw);
  // Delivery in Delhi (07); we are in Haryana (06) — an inter-state supply.
  const addr = await makeAddress(
    buyerOrgId,
    { city: 'New Delhi', state: 'Delhi', state_code: '07', pincode: '110001' },
    raw,
  );
  const gst = randomUUID();
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gst}::uuid, ${buyerOrgId}::uuid, '07AABCR9603R1ZX', 'Buyer', '07',
            'ACTIVE', ${NOW}, TRUE)`;

  const units = [
    await seedSellableUnit({ vendorOrgId, grade: 'A' }, raw),
    await seedSellableUnit({ vendorOrgId, grade: 'A' }, raw),
    await seedSellableUnit({ vendorOrgId, grade: 'A' }, raw),
  ];

  const orderId = randomUUID();
  const orderNumber = 'T-SO-1';
  await raw.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, freight_total, grand_total,
       status, payment_mode, payment_status)
    VALUES (${orderId}::uuid, ${orderNumber}, ${buyerOrgId}::uuid, ${buyerUser}::uuid,
            ${gst}::uuid, ${addr}::uuid, ${addr}::uuid, 90000, 16200, 500, 106700,
            'CONFIRMED', 'PREPAID', 'PENDING')`;

  const subOrderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering.sub_order (id, order_id, sub_order_number, vendor_org_id, subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, 'T-SO-1-1', ${vendorOrgId}::uuid, 90000, 16200, 'CONFIRMED')`;

  for (const u of units) {
    const lineId = randomUUID();
    await raw.$executeRaw`
      INSERT INTO ordering.order_line
        (id, sub_order_id, listing_id, sku_id, grade, qty, unit_price, gst_rate, gst_amount, line_total, status)
      VALUES (${lineId}::uuid, ${subOrderId}::uuid, ${u.listingId}::uuid, ${u.skuId}::uuid,
              'A', 1, 30000, 18, 5400, 35400, 'CONFIRMED')`;
    await raw.$executeRaw`
      INSERT INTO ordering.order_line_unit (order_line_id, unit_id, serial_number, qc_report_id, status)
      VALUES (${lineId}::uuid, NULL, NULL, NULL, 'RESERVED')`;
  }

  const poId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO procurement.purchase_order
      (id, po_number, vendor_org_id, order_id, status, total_net, tds_rate_pct, tds_amount, valuation_method, terms_days)
    VALUES (${poId}::uuid, 'PO-SO-1', ${vendorOrgId}::uuid, ${orderId}::uuid, 'RAISED', 90000, 0, 0, 'REGULAR', 15)`;
  await raw.$executeRaw`
    UPDATE ordering.sub_order SET purchase_order_id = ${poId}::uuid WHERE id = ${subOrderId}::uuid`;
  for (const u of units) {
    await raw.$executeRaw`
      INSERT INTO procurement.purchase_order_line
        (id, po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, line_status)
      VALUES (${randomUUID()}::uuid, ${poId}::uuid, NULL, ${u.skuId}::uuid, 30000, 'A', 'PENDING')`;
  }
  await raw.$executeRaw`
    INSERT INTO procurement.vendor_payable (vendor_org_id, purchase_order_id, gross, tds, net_payable, status)
    VALUES (${vendorOrgId}::uuid, ${poId}::uuid, 90000, 0, 90000, 'ACCRUED')`;

  return { poId, vendorOrgId, buyerOrgId, orderNumber, skuIds: units.map((u) => u.skuId) };
}

/** Mark `done` of the order's slots as named and verified, and stamp the order — what the flow writes. */
async function verified(orderNumber: string, done: number, over: Partial<{ status: string; payment_status: string; paid: boolean }> = {}): Promise<void> {
  await raw.$executeRaw`
    UPDATE ordering.order_line_unit olu SET inspected_at = ${NOW}, verified_at = ${NOW}, serial_number = 'SN' || left(olu.id::text, 8)
     WHERE olu.id IN (
       SELECT olu2.id FROM ordering.order_line_unit olu2
         JOIN ordering.order_line ol ON ol.id = olu2.order_line_id
         JOIN ordering.sub_order so ON so.id = ol.sub_order_id
         JOIN ordering."order" o ON o.id = so.order_id
        WHERE o.order_number = ${orderNumber}
        ORDER BY ol.id LIMIT ${done})`;
  await raw.$executeRaw`
    UPDATE ordering."order"
       SET verified_at = ${NOW}, pay_by = ${new Date(NOW.getTime() + 86_400_000)},
           status = ${over.status ?? 'PAYMENT_PENDING'}::public.order_status,
           payment_status = ${over.payment_status ?? 'PENDING'}::public.payment_status,
           paid_at = ${over.paid ? NOW : null},
           -- chk_held_order_has_expiry: a PAYMENT_PENDING order holds its machines until pay_by.
           stock_hold_expires_at = ${new Date(NOW.getTime() + 86_400_000)}
     WHERE order_number = ${orderNumber}`;
}

describe('the sales order', () => {
  it('is WAITING with no totals while machines are still to be named and verified', async () => {
    const fx = await seedOrderWithPo();
    const so = await as(fx.buyerOrgId, 'BUYER', () => readOrder.salesOrder(fx.orderNumber));
    expect(so.state).toBe('WAITING');
    expect(so.stage).toBe('INSPECTION');
    expect(so.machines).toEqual({ ordered: 3, inspected: 0, verified: 0 });
    expect(so.totals).toBeNull();
    expect(so.verifiedAt).toBeNull();
    expect(so.lines.every((l) => l.qtyConfirmed === null && l.lineTotal === null)).toBe(true);
    expect(so.payment.payable).toBe(false);
  });

  it('is not made READY by the dispatch point answering — only by verification', async () => {
    const fx = await seedOrderWithPo();
    await as(fx.vendorOrgId, 'VENDOR', () =>
      procurement.confirmAvailability(fx.poId, {
        lines: fx.skuIds.map((skuId) => ({ skuId, grade: 'A' as const, qtyAvailable: 1 })),
      }),
    );
    const so = await as(fx.buyerOrgId, 'BUYER', () => readOrder.salesOrder(fx.orderNumber));
    expect(so.state).toBe('WAITING');
    expect(so.totals).toBeNull();
  });

  it('prices exactly the verified machines once the last one is verified, with the deadline', async () => {
    const fx = await seedOrderWithPo();
    await verified(fx.orderNumber, 2);

    const so = await as(fx.buyerOrgId, 'BUYER', () => readOrder.salesOrder(fx.orderNumber));
    expect(so.state).toBe('READY');
    expect(so.stage).toBe('PAYMENT');
    expect(so.machines).toEqual({ ordered: 3, inspected: 2, verified: 2 });
    expect(so.verifiedAt).not.toBeNull();
    expect(so.payBy).not.toBeNull();

    const confirmed = so.lines.map((l) => l.qtyConfirmed);
    expect(confirmed.filter((q) => q === 1)).toHaveLength(2);
    expect(confirmed.filter((q) => q === 0)).toHaveLength(1);

    // 2 × 30,000 machines + 500 freight, 18% IGST on both (Delhi from Haryana).
    expect(so.totals).toMatchObject({
      subtotal: '60000.00',
      freight: '500.00',
      grandTotal: '71390.00',
    });
    expect(so.totals?.tax.interState).toBe(true);
    expect(so.totals?.tax.igst).toBe('10890.00');
    expect(so.payment.payable).toBe(true);

    // Nothing about the vendor reaches the payload, at any depth.
    const json = JSON.stringify(so);
    expect(json).not.toContain(fx.vendorOrgId);
    expect(json).not.toMatch(/PO-SO-1|purchase/i);
  });

  it('is PAID, with when, and no longer payable once the buyer has paid', async () => {
    const fx = await seedOrderWithPo();
    await verified(fx.orderNumber, 3, { status: 'CONFIRMED', payment_status: 'PAID', paid: true });
    const so = await as(fx.buyerOrgId, 'BUYER', () => readOrder.salesOrder(fx.orderNumber));
    expect(so.state).toBe('READY');
    expect(so.stage).toBe('PAID');
    expect(so.paidAt).not.toBeNull();
    // What was charged — the order's own total — not a re-pricing.
    expect(so.totals?.grandTotal).toBe('106700.00');
    expect(so.payment).toMatchObject({ status: 'PAID', payable: false });
  });

  it('is CANCELLED with nothing owed when the order is cancelled', async () => {
    const fx = await seedOrderWithPo();
    await raw.$executeRaw`
      UPDATE ordering."order" SET status = 'CANCELLED'::public.order_status WHERE order_number = ${fx.orderNumber}`;
    const so = await as(fx.buyerOrgId, 'BUYER', () => readOrder.salesOrder(fx.orderNumber));
    expect(so.state).toBe('CANCELLED');
    expect(so.stage).toBe('CANCELLED');
    expect(so.totals).toBeNull();
    expect(so.payment.payable).toBe(false);
  });

  it('answers 404 for an order on another account', async () => {
    const fx = await seedOrderWithPo();
    const stranger = await makeOrganization({ org_type: 'BUYER' }, raw);
    await expect(
      as(stranger, 'BUYER', () => readOrder.salesOrder(fx.orderNumber)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
