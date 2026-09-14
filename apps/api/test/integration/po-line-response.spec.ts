/**
 * Per-line PO response — partial accept, reject-all, validation, dispatch gates.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { permissionsFor } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, RequestContextService, type Principal } from '../../src/shared/db/org-scope';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { AuthModule } from '../../src/shared/auth/auth.module';
import { EventBusModule } from '../../src/shared/events/event-bus';
import { RedisModule } from '../../src/shared/redis/redis.service';
import { ProcurementModule } from '../../src/modules/procurement';
import { ProcurementController } from '../../src/modules/procurement/procurement.controller';
import {
  PreconditionFailedError,
  ValidationError,
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

const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T08:00:00.000Z`);

let moduleRef: TestingModule;
let controller: ProcurementController;
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
  await seedTestReference(raw);
});

function as<T>(vendorOrgId: string, fn: () => Promise<T>): Promise<T> {
  const principal: Principal = {
    userId: randomUUID(),
    orgId: vendorOrgId,
    orgType: 'VENDOR',
    roles: ['VENDOR_OWNER'],
    permissions: permissionsFor(['VENDOR_OWNER']),
    sessionId: 's',
    mfaSatisfied: true,
  };
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(principal);
    return fn();
  });
}

async function seedThreeLinePo(): Promise<{
  poId: string;
  vendorOrgId: string;
  lineIds: string[];
  unitIds: string[];
  skuIds: string[];
  grade: string;
}> {
  const vendorOrgId = await makeOrganization({ org_type: 'VENDOR' }, raw);
  await makeAddress(vendorOrgId, {}, raw);
  const buyerOrg = await makeOrganization({ org_type: 'BUYER' }, raw);
  const buyerUser = await makeUser(buyerOrg, {}, raw);
  const addr = await makeAddress(buyerOrg, {}, raw);
  const gst = randomUUID();
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gst}::uuid, ${buyerOrg}::uuid, '07AABCR9603R1ZX', 'Buyer', '07',
            'ACTIVE', ${NOW}, TRUE)`;

  const first = await seedSellableUnit({ vendorOrgId, grade: 'A' }, raw);
  const units = [
    first,
    await seedSellableUnit({ vendorOrgId, grade: 'A' }, raw),
    await seedSellableUnit({ vendorOrgId, grade: 'A' }, raw),
  ];

  const orderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, grand_total, status)
    VALUES (${orderId}::uuid, 'T-PO-3', ${buyerOrg}::uuid, ${buyerUser}::uuid,
            ${gst}::uuid, ${addr}::uuid, ${addr}::uuid, 90000, 16200, 106200, 'CONFIRMED')`;

  const subOrderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering.sub_order (id, order_id, sub_order_number, vendor_org_id, subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, 'T-PO-3-1', ${vendorOrgId}::uuid, 90000, 16200, 'CONFIRMED')`;

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
    VALUES (${poId}::uuid, 'PO-3L', ${vendorOrgId}::uuid, ${orderId}::uuid, 'RAISED', 90000, 0, 0, 'REGULAR', 15)`;

  const lineIds: string[] = [];
  for (const u of units) {
    const polId = randomUUID();
    lineIds.push(polId);
    await raw.$executeRaw`
      INSERT INTO procurement.purchase_order_line
        (id, po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, line_status)
      VALUES (${polId}::uuid, ${poId}::uuid, NULL, ${u.skuId}::uuid, 30000, 'A', 'PENDING')`;
  }

  await raw.$executeRaw`
    INSERT INTO procurement.vendor_payable (vendor_org_id, purchase_order_id, gross, tds, net_payable, status)
    VALUES (${vendorOrgId}::uuid, ${poId}::uuid, 90000, 0, 90000, 'ACCRUED')`;

  return {
    poId,
    vendorOrgId,
    lineIds,
    unitIds: units.map((u) => u.unitId),
    skuIds: units.map((u) => u.skuId),
    grade: units[0]!.grade,
  };
}

describe('POST /vendor/purchase-orders/:poId/respond', () => {
  it('accepts 2 and rejects 1 → PARTIAL with corrected totals', async () => {
    const fx = await seedThreeLinePo();
    const detail = await as(fx.vendorOrgId, () =>
      controller.respond(fx.poId, {
        lines: [
          { lineId: fx.lineIds[0]!, accept: true },
          { lineId: fx.lineIds[1]!, accept: true },
          { lineId: fx.lineIds[2]!, accept: false, reason: 'OUT_OF_STOCK' },
        ],
      }),
    );
    expect(detail.status).toBe('PARTIAL');
    expect(Number(String(detail.totals.rejectedTotal))).toBe(30000);
    expect(Number(String(detail.totals.owedIfAccepted))).toBe(60000);
    expect(detail.lineGroups.filter((g) => g.lineStatus === 'REJECTED')).toHaveLength(1);
  });

  it('rejects all lines → REJECTED', async () => {
    const fx = await seedThreeLinePo();
    const detail = await as(fx.vendorOrgId, () =>
      controller.respond(fx.poId, {
        lines: fx.lineIds.map((lineId) => ({
          lineId,
          accept: false,
          reason: 'PRICE_DISPUTED',
        })),
      }),
    );
    expect(detail.status).toBe('REJECTED');
    expect(Number(String(detail.totals.owedIfAccepted))).toBe(0);
  });

  it('refuses a rejected line with no reason', async () => {
    const fx = await seedThreeLinePo();
    await expect(
      as(fx.vendorOrgId, () =>
        controller.respond(fx.poId, {
          lines: [{ lineId: fx.lineIds[0]!, accept: false }],
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a second response', async () => {
    const fx = await seedThreeLinePo();
    await as(fx.vendorOrgId, () =>
      controller.respond(fx.poId, {
        lines: fx.lineIds.map((lineId) => ({ lineId, accept: true })),
      }),
    );
    await expect(
      as(fx.vendorOrgId, () =>
        controller.respond(fx.poId, {
          lines: fx.lineIds.map((lineId) => ({ lineId, accept: true })),
        }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});

describe('POST /vendor/purchase-orders/:poId/dispatch', () => {
  it('refuses dispatch before every accepted line has serials', async () => {
    const fx = await seedThreeLinePo();
    await as(fx.vendorOrgId, () =>
      controller.respond(fx.poId, {
        lines: fx.lineIds.map((lineId) => ({ lineId, accept: true })),
      }),
    );
    await expect(
      as(fx.vendorOrgId, () =>
        controller.dispatch(fx.poId, { carrier: 'Delhivery', awb: 'AWB123' }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('dispatches once every accepted line is attached', async () => {
    const unit = await seedSellableUnit({ grade: 'A' }, raw);
    const buyerOrg = await makeOrganization({ org_type: 'BUYER' }, raw);
    const buyerUser = await makeUser(buyerOrg, {}, raw);
    const addr = await makeAddress(buyerOrg, {}, raw);
    const gst = randomUUID();
    await raw.$executeRaw`
      INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                   status, api_verified_at, is_primary)
      VALUES (${gst}::uuid, ${buyerOrg}::uuid, '07AABCR9603R1ZX', 'Buyer', '07',
              'ACTIVE', ${NOW}, TRUE)`;
    const orderId = randomUUID();
    await raw.$executeRaw`
      INSERT INTO ordering."order"
        (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
         billing_address_id, shipping_address_id, subtotal, gst_total, grand_total, status)
      VALUES (${orderId}::uuid, 'T-PO-1', ${buyerOrg}::uuid, ${buyerUser}::uuid,
              ${gst}::uuid, ${addr}::uuid, ${addr}::uuid, 30000, 5400, 35400, 'CONFIRMED')`;
    const subOrderId = randomUUID();
    const orderLineId = randomUUID();
    await raw.$executeRaw`
      INSERT INTO ordering.sub_order (id, order_id, sub_order_number, vendor_org_id, subtotal, gst_total, status)
      VALUES (${subOrderId}::uuid, ${orderId}::uuid, 'T-PO-1-1', ${unit.vendorOrgId}::uuid, 30000, 5400, 'CONFIRMED')`;
    await raw.$executeRaw`
      INSERT INTO ordering.order_line
        (id, sub_order_id, listing_id, sku_id, grade, qty, unit_price, gst_rate, gst_amount, line_total, status)
      VALUES (${orderLineId}::uuid, ${subOrderId}::uuid, ${unit.listingId}::uuid, ${unit.skuId}::uuid,
              'A', 1, 30000, 18, 5400, 35400, 'CONFIRMED')`;
    await raw.$executeRaw`
      INSERT INTO ordering.order_line_unit (order_line_id, unit_id, serial_number, qc_report_id, status)
      VALUES (${orderLineId}::uuid, NULL, NULL, NULL, 'RESERVED')`;
    const poId = randomUUID();
    const lineId = randomUUID();
    await raw.$executeRaw`
      INSERT INTO procurement.purchase_order
        (id, po_number, vendor_org_id, order_id, status, total_net, tds_rate_pct, tds_amount, valuation_method, terms_days)
      VALUES (${poId}::uuid, 'PO-1L', ${unit.vendorOrgId}::uuid, ${orderId}::uuid, 'RAISED', 30000, 0, 0, 'REGULAR', 15)`;
    await raw.$executeRaw`
      INSERT INTO procurement.purchase_order_line
        (id, po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, line_status)
      VALUES (${lineId}::uuid, ${poId}::uuid, NULL, ${unit.skuId}::uuid, 30000, 'A', 'PENDING')`;
    await raw.$executeRaw`
      INSERT INTO procurement.vendor_payable (vendor_org_id, purchase_order_id, gross, tds, net_payable, status)
      VALUES (${unit.vendorOrgId}::uuid, ${poId}::uuid, 30000, 0, 30000, 'ACCRUED')`;

    await as(unit.vendorOrgId, () =>
      controller.respond(poId, { lines: [{ lineId, accept: true }] }),
    );
    await as(unit.vendorOrgId, () =>
      controller.attach(poId, { skuId: unit.skuId, grade: 'A', unitId: unit.unitId }),
    );
    const out = await as(unit.vendorOrgId, () =>
      controller.dispatch(poId, { carrier: 'Delhivery', awb: 'AWB999' }),
    );
    expect(out.status).toBe('DISPATCHED');
    expect(out.consignmentAwb).toBe('AWB999');
  });
});
