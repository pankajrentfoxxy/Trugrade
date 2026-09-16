/**
 * The seven-day return window, and the payout it gates.
 *
 * Two facts decide everything here. **`eligible_at` is now a record, not a
 * rule** — `payable.service.ts` spent its life computing the answer and
 * labelling it as policy because nothing had ever written the column. And **the
 * two windows are separate**: 48 hours to dispute the grade, 168 to send it
 * back, and payment waits for the longer one.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { Money, permissionsFor, type Role } from '@trugrade/contracts';
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
import { ProcurementModule } from '../../src/modules/procurement';
import { LogisticsDeliveryService } from '../../src/modules/logistics/internal/delivery.service';
import { PayoutRunService } from '../../src/modules/procurement/internal/payout-run.service';
import { PayableService } from '../../src/modules/procurement/internal/payable.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeCatalog, makeOrganization, makeUser } from '../support/factories';

const DELIVERED_AT = new Date('2026-09-10T09:00:00.000Z');
const HOUR = 3_600_000;
const RETURN_WINDOW_HOURS = 168;

let moduleRef: TestingModule;
let deliveries: LogisticsDeliveryService;
let payouts: PayoutRunService;
let payables: PayableService;
let ctx: RequestContextService;
let redis: RedisService;
let clock: FixedClock;
let db: PrismaClient;

let vendorOrgId: string;
let buyerOrgId: string;
let clerkUserId: string;
let controllerUserId: string;
let shipmentIds: string[];
let poIds: string[];

const principal = (userId: string, orgId: string, roles: Role[]): Principal => ({
  userId,
  orgId,
  orgType: 'PLATFORM',
  roles,
  permissions: permissionsFor(roles),
  sessionId: 's',
  mfaSatisfied: true,
});

function as<T>(p: Principal, fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(p);
    return fn();
  });
}

const asClerk = <T>(fn: () => Promise<T>): Promise<T> =>
  as(principal(clerkUserId, buyerOrgId, ['FINANCE']), fn);
const asController = <T>(fn: () => Promise<T>): Promise<T> =>
  as(principal(controllerUserId, buyerOrgId, ['PLATFORM_SUPERADMIN']), fn);

/** One consignment, delivered or not, with its purchase order and payable. */
async function makeConsignment(index: number): Promise<{ shipmentId: string; poId: string }> {
  const { skuId } = await makeCatalog({ brand: `Brand${index}` }, db);

  const addressId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${addressId}::uuid, ${vendorOrgId}::uuid, 'PICKUP'::address_type, 'Plot 42',
            'Gurugram', 'Haryana', '06', '122015', 'Supervisor', '+919876543210', TRUE)`;
  const shipToId = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile)
    VALUES (${shipToId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type, 'Tower B',
            'New Delhi', 'Delhi', '07', '110001', 'Ravi Menon', '+919812345678')`;

  const buyerUserId = await makeUser(buyerOrgId, {}, db);
  const gstProfileId = randomUUID();
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, ${'06AABCU960' + index + 'R1ZM'},
            'Harbourpoint', '06', 'ACTIVE', ${DELIVERED_AT}, ${index === 0})`;

  const orderId = randomUUID();
  const orderNumber = `TT-26-${String(10000 + index)}`;
  await db.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, freight_total,
       grand_total, payment_mode, payment_status, status, placed_at)
    VALUES (${orderId}::uuid, ${orderNumber}, ${buyerOrgId}::uuid, ${buyerUserId}::uuid,
            ${gstProfileId}::uuid, ${shipToId}::uuid, ${shipToId}::uuid,
            42000, 7560, 0, 49560, 'PREPAID', 'PAID',
            'VENDOR_ACCEPTED'::public.order_status, ${DELIVERED_AT})`;

  const poId = randomUUID();
  await db.$executeRaw`
    INSERT INTO procurement.purchase_order
      (id, po_number, vendor_org_id, order_id, pickup_address_id, status, total_net,
       tds_rate_pct, tds_amount, valuation_method, terms_days, created_at, updated_at)
    VALUES (${poId}::uuid, ${'PO-26-' + String(10000 + index)}, ${vendorOrgId}::uuid,
            ${orderId}::uuid, ${addressId}::uuid, 'RECEIVED', 30000, 0.10, 30,
            'REGULAR', 15, ${DELIVERED_AT}, ${DELIVERED_AT})`;
  await db.$executeRaw`
    INSERT INTO procurement.vendor_payable
      (vendor_org_id, purchase_order_id, gross, tds, net_payable, status, created_at)
    VALUES (${vendorOrgId}::uuid, ${poId}::uuid, 30000, 30, 29970, 'ACCRUED', ${DELIVERED_AT})`;

  const subOrderId = randomUUID();
  await db.$executeRaw`
    INSERT INTO ordering.sub_order
      (id, order_id, sub_order_number, vendor_org_id, pickup_address_id, purchase_order_id,
       subtotal, gst_total, freight, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${orderNumber + '-1'}, ${vendorOrgId}::uuid,
            ${addressId}::uuid, ${poId}::uuid, 42000, 7560, 0,
            'VENDOR_ACCEPTED'::public.order_status)`;

  const [carrier] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM logistics.carrier WHERE code = 'INHOUSE'`;
  const shipmentId = randomUUID();
  await db.$executeRaw`
    INSERT INTO logistics.shipment
      (id, leg, sub_order_id, carrier_id, from_address_id, to_address_id, mode,
       declared_value, boxes, status, route_type, awb_number, created_at)
    VALUES (${shipmentId}::uuid, 'OUTBOUND'::public.shipment_leg, ${subOrderId}::uuid,
            ${carrier!.id}::uuid, ${addressId}::uuid, ${shipToId}::uuid, 'SURFACE',
            42000, 1, 'IN_TRANSIT'::public.shipment_status, 'DIRECT'::public.route_type,
            ${'TG-IH-' + String(index).padStart(8, '0')}, ${DELIVERED_AT})`;
  await db.$executeRaw`
    INSERT INTO logistics.delivery_task (shipment_id, status)
    VALUES (${shipmentId}::uuid, 'OUT_FOR_DELIVERY')`;

  void skuId;
  return { shipmentId, poId };
}

const payableRow = async (
  poId: string,
): Promise<{ eligible_at: Date | null; status: string; hold_reason: string | null }> => {
  const [row] = await db.$queryRaw<
    Array<{ eligible_at: Date | null; status: string; hold_reason: string | null }>
  >`
    SELECT eligible_at, status, hold_reason FROM procurement.vendor_payable
     WHERE purchase_order_id = ${poId}::uuid`;
  return row!;
};

const trialBalanceFoots = async (): Promise<boolean> => {
  const [row] = await db.$queryRaw<Array<{ debit: string; credit: string }>>`
    SELECT coalesce(sum(debit), 0)::text AS debit, coalesce(sum(credit), 0)::text AS credit
      FROM payment.ledger_entry`;
  return Number(row!.debit) === Number(row!.credit);
};

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);
  clock = new FixedClock(DELIVERED_AT);

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
      ProcurementModule,
    ],
  })
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

  deliveries = moduleRef.get(LogisticsDeliveryService);
  payouts = moduleRef.get(PayoutRunService);
  payables = moduleRef.get(PayableService);
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
  clock.advanceTo(DELIVERED_AT);

  vendorOrgId = await makeOrganization({ legal_name: 'Northgate IT' }, db);
  buyerOrgId = await makeOrganization({ org_type: 'BUYER', legal_name: 'Harbourpoint' }, db);
  clerkUserId = await makeUser(buyerOrgId, {}, db);
  controllerUserId = await makeUser(buyerOrgId, {}, db);

  const first = await makeConsignment(0);
  const second = await makeConsignment(1);
  shipmentIds = [first.shipmentId, second.shipmentId];
  poIds = [first.poId, second.poId];
});

/* ========================================================================== */

describe('delivery opens the return window', () => {
  it('sets eligible_at to delivery plus 168 hours, exactly', async () => {
    await deliveries.markDelivered({
      shipmentId: shipmentIds[0]!,
      deliveredAt: DELIVERED_AT,
      source: 'RIDER',
    });

    const payable = await payableRow(poIds[0]!);
    expect(payable.eligible_at).not.toBeNull();
    expect(payable.eligible_at!.getTime()).toBe(
      DELIVERED_AT.getTime() + RETURN_WINDOW_HOURS * HOUR,
    );
  });

  it('gives two consignments delivered three days apart two independent clocks', async () => {
    await deliveries.markDelivered({
      shipmentId: shipmentIds[0]!,
      deliveredAt: DELIVERED_AT,
      source: 'RIDER',
    });
    const later = new Date(DELIVERED_AT.getTime() + 72 * HOUR);
    await deliveries.markDelivered({
      shipmentId: shipmentIds[1]!,
      deliveredAt: later,
      source: 'CARRIER_WEBHOOK',
    });

    const first = await payableRow(poIds[0]!);
    const second = await payableRow(poIds[1]!);
    expect(second.eligible_at!.getTime() - first.eligible_at!.getTime()).toBe(72 * HOUR);
  });
});

describe('a payout run selects on the recorded window', () => {
  beforeEach(async () => {
    await deliveries.markDelivered({
      shipmentId: shipmentIds[0]!,
      deliveredAt: DELIVERED_AT,
      source: 'RIDER',
    });
  });

  it('says RETURN_WINDOW_OPEN at +167h and will not draft a run', async () => {
    clock.advanceTo(new Date(DELIVERED_AT.getTime() + 167 * HOUR));

    const view = await as(principal(clerkUserId, vendorOrgId, ['VENDOR_OWNER']), () =>
      payables.view(),
    );
    const row = view.rows.find((r) => r.poId === poIds[0]);
    expect(row?.waitingOn).toBe('RETURN_WINDOW_OPEN');

    await expect(asClerk(() => payouts.create())).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'nothing_eligible' }),
    });
  });

  it('selects it at +169h', async () => {
    clock.advanceTo(new Date(DELIVERED_AT.getTime() + 169 * HOUR));

    const run = await asClerk(() => payouts.create());
    expect(run.status).toBe('DRAFT');
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]!.netAmount.toString()).toBe('29970.00');
    // The deduction stack is read off the payable, not recomputed.
    expect(run.lines[0]!.tds.toString()).toBe('30.00');
  });
});

describe('a return stops the money', () => {
  beforeEach(async () => {
    await deliveries.markDelivered({
      shipmentId: shipmentIds[0]!,
      deliveredAt: DELIVERED_AT,
      source: 'RIDER',
    });
  });

  it('puts the payable on hold and clears its date', async () => {
    const hold = moduleRef.get<{
      holdForReturn: (order: string, reason: string) => Promise<number>;
    }>(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/modules/platform/internal/payable-hold.port').PayableHoldPort,
      { strict: false },
    );
    await hold.holdForReturn('TT-26-10000', 'Return RET-1 open on 1 machine');

    const payable = await payableRow(poIds[0]!);
    expect(payable.status).toBe('ON_HOLD');
    // Null as well as held: a held payable that kept its date walks back into a
    // run the moment somebody clears the hold for an unrelated reason.
    expect(payable.eligible_at).toBeNull();
    expect(payable.hold_reason).toMatch(/Return RET-1/);

    clock.advanceTo(new Date(DELIVERED_AT.getTime() + 200 * HOUR));
    await expect(asClerk(() => payouts.create())).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'nothing_eligible' }),
    });
  });

  it('re-arms the window when the return is refused', async () => {
    const hold = moduleRef.get<{
      holdForReturn: (order: string, reason: string) => Promise<number>;
      releaseHold: (order: string, hours: number) => Promise<number>;
    }>(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/modules/platform/internal/payable-hold.port').PayableHoldPort,
      { strict: false },
    );
    await hold.holdForReturn('TT-26-10000', 'Return RET-1 open');

    const refusedAt = new Date(DELIVERED_AT.getTime() + 48 * HOUR);
    clock.advanceTo(refusedAt);
    await hold.releaseHold('TT-26-10000', RETURN_WINDOW_HOURS);

    const payable = await payableRow(poIds[0]!);
    expect(payable.status).toBe('ACCRUED');
    expect(payable.hold_reason).toBeNull();
    // From the refusal, not from the original delivery: the goods were in
    // dispute in between and that clock was not running.
    expect(payable.eligible_at!.getTime()).toBe(refusedAt.getTime() + RETURN_WINDOW_HOURS * HOUR);
  });
});

describe('a payout is made by one person and approved by another', () => {
  beforeEach(async () => {
    await deliveries.markDelivered({
      shipmentId: shipmentIds[0]!,
      deliveredAt: DELIVERED_AT,
      source: 'RIDER',
    });
    clock.advanceTo(new Date(DELIVERED_AT.getTime() + 169 * HOUR));
  });

  it('refuses the person who drafted it', async () => {
    const run = await asClerk(() => payouts.create());
    await expect(asClerk(() => payouts.approve(run.id))).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'maker_is_checker' }),
    });

    const [row] = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM procurement.payout_run WHERE id = ${run.id}::uuid`;
    expect(row!.status).toBe('DRAFT');
  });

  it('instructs on a second pair of eyes, and only a bank reference marks it paid', async () => {
    const run = await asClerk(() => payouts.create());
    const approved = await asController(() => payouts.approve(run.id));
    expect(approved.status).toBe('APPROVED');

    const released = await asController(() => payouts.release(run.id));
    expect(released.status).toBe('EXECUTING');

    // Instructed, not paid: `chk_payout_utr` refuses a paid line with no bank
    // reference, and there is no bank connected to give one.
    const [sent] = await db.$queryRaw<Array<{ status: string; utr: string | null }>>`
      SELECT status, utr FROM procurement.payout_line WHERE run_id = ${run.id}::uuid`;
    expect(sent!.status).toBe('SENT');
    expect(sent!.utr).toBeNull();
    expect((await payableRow(poIds[0]!)).status).toBe('ACCRUED');
    expect(await trialBalanceFoots()).toBe(true);

    // A second run must not pick the same payable up again while it is in transit.
    await expect(asClerk(() => payouts.create())).rejects.toMatchObject({
      detail: expect.objectContaining({ reason: 'nothing_eligible' }),
    });

    const [payableId] = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM procurement.vendor_payable WHERE purchase_order_id = ${poIds[0]}::uuid`;
    const confirmed = await asController(() =>
      payouts.confirm(run.id, { [payableId!.id]: 'UTR2026091700001' }),
    );
    expect(confirmed.status).toBe('COMPLETED');

    const [paid] = await db.$queryRaw<Array<{ status: string; utr: string | null }>>`
      SELECT status, utr FROM procurement.payout_line WHERE run_id = ${run.id}::uuid`;
    expect(paid!.status).toBe('PAID');
    expect(paid!.utr).toBe('UTR2026091700001');
    expect((await payableRow(poIds[0]!)).status).toBe('PAID');

    expect(await trialBalanceFoots()).toBe(true);
    const [entries] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM payment.ledger_entry
       WHERE ref_type = 'PAYOUT_RUN' AND ref_id = ${run.id}::uuid`;
    // Two legs when instructed, two more when confirmed.
    expect(Number(entries!.n)).toBe(4);
  });

  it('refuses a self-approved run at the database, not only in the service', async () => {
    const run = await asClerk(() => payouts.create());
    // Straight at the table, bypassing every guard in the service: the CHECK is
    // the control, and a bug in application code must not be able to produce a
    // self-approved payout.
    await expect(
      db.$executeRaw`
        UPDATE procurement.payout_run
           SET approved_by = ${clerkUserId}::uuid, approved_at = now(), status = 'APPROVED'
         WHERE id = ${run.id}::uuid`,
    ).rejects.toThrow(/ck_payout_maker_is_not_checker/);
  });
});

describe('escrow and credit are contracts, not claims', () => {
  it('says plainly that no provider is connected', async () => {
    const escrow = moduleRef.get<{
      openAccount: (i: { orgId: string; legalName: string; purpose: 'PAYOUT' }) => Promise<{
        accountRef: string;
        provider: string;
      }>;
      balance: (ref: string) => Promise<Money>;
    }>(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/shared/adapters/ports').EscrowPort,
      { strict: false },
    );
    const account = await escrow.openAccount({
      orgId: vendorOrgId,
      legalName: 'Northgate IT',
      purpose: 'PAYOUT',
    });

    expect(account.provider).toBe('none');
    // Nothing about this reference can be mistaken for a provider's.
    expect(account.accountRef).toMatch(/^NOPROVIDER-/);
    expect((await escrow.balance(account.accountRef)).toString()).toBe('0.00');
  });

  it('refuses an order beyond the credit headroom, and never underwrites one', async () => {
    const credit = moduleRef.get<{
      requestLimit: (i: {
        orgId: string;
        legalName: string;
        gstin: string;
        requestedLimit: Money;
      }) => Promise<{ outcome: string; limit: Money }>;
      grantLimit: (orgId: string, limit: Money) => void;
      reserve: (orgId: string, orderId: string, amount: Money) => Promise<{ amount: Money }>;
    }>(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/shared/adapters/ports').CreditLinePort,
      { strict: false },
    );

    const decision = await credit.requestLimit({
      orgId: buyerOrgId,
      legalName: 'Harbourpoint',
      gstin: '06AABCU9603R1ZM',
      requestedLimit: Money.rupees(500_000),
    });
    // Never APPROVED: saying so with no NBFC behind it would be this platform
    // underwriting, which is exactly what the port exists to prevent.
    expect(decision.outcome).toBe('REFERRED');
    expect(decision.limit.toString()).toBe('0.00');

    credit.grantLimit(buyerOrgId, Money.rupees(100_000));
    await expect(credit.reserve(buyerOrgId, randomUUID(), Money.rupees(150_000))).rejects.toThrow(
      /available/,
    );
    const reservation = await credit.reserve(buyerOrgId, randomUUID(), Money.rupees(40_000));
    expect(reservation.amount.toString()).toBe('40000.00');
  });
});
