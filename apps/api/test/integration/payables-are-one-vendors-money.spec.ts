/**
 * The vendor's payables and the deduction stack (T33), and the four things only
 * a database can prove about them.
 *
 * **1. One vendor's money is one vendor's.** Every test seeds a neighbour with
 * strictly MORE of everything — more payables, a larger year-to-date purchase
 * position, an MSME registration, a verified bank account — so a dropped `WHERE`
 * shows up as a bigger number rather than as a passing test. Two of them attack
 * with the neighbour's REAL ids: `deliveriesFor` is handed the neighbour's own
 * order ids and must come back empty, and the year-to-date TDS position is
 * summed from `tds_ledger` rows that belong to somebody else.
 *
 * The TDS one is not decorative. `v_vendor_fy_purchases` is what decides whether
 * a vendor has crossed the ₹50 lakh threshold, so a leak there does not merely
 * show the wrong number — it changes the rate a real deduction is struck at.
 *
 * **2. `null` is not a date.** Nothing sets `vendor_payable.eligible_at` and
 * nothing writes `payout_run`, so the view must report null and zero rather than
 * derive an expected payment date from `procurement.default_payout_cycle`. The
 * assertions are on `null` and on the absence of any such field, because that is
 * a number a vendor plans cash against.
 *
 * **3. The clock arms are real.** A payable moves from INSPECTION_WINDOW_OPEN to
 * NO_PAYOUT_RUN when the window closes; the test advances the injected clock
 * across the boundary and demands both answers from the same row.
 *
 * **4. The MSME deadline is keyed off the registration.** With a Udyam number on
 * `vendor_profile` the deadline is `msme.max_payment_days` from delivery under
 * MSMED Act s.15; without one it is the purchase order's own terms. Both arms
 * are asserted against the same delivery, so the difference cannot come from
 * anywhere else.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { financialYearOf, permissionsFor, type Role } from '@trugrade/contracts';
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
import { PayableRepository } from '../../src/modules/procurement/internal/payable.repository';
import { PayablesController } from '../../src/modules/procurement/payables.controller';
import { ForbiddenError } from '../../src/shared/errors/domain-errors';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, makeUser, seedSellableUnit } from '../support/factories';
import { seedConfig } from '../../prisma/seed/reference';

/** Time pinned, date tracking today — the ledger's own rule about time bombs. */
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T06:00:00.000Z`);
const FY = financialYearOf(NOW.toISOString());

/** The seeded `ordering.inspection_window_hours`. */
const WINDOW_HOURS = 48;
/** The seeded `msme.max_payment_days` — MSMED Act s.15. */
const MSME_DAYS = 45;
const HOUR = 3_600_000;
const DAY = 86_400_000;

let moduleRef: TestingModule;
let clock: FixedClock;
let controller: PayablesController;
let repo: PayableRepository;
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
    .useValue((clock = new FixedClock(NOW)))
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

  controller = moduleRef.get(PayablesController);
  repo = moduleRef.get(PayableRepository);
  ctx = moduleRef.get(RequestContextService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  clock.advanceTo(NOW);
  await truncateAll(raw);
  // `truncateAll`'s keep-list does not survive CASCADE, so every config key is
  // gone by the first test. The inspection window, the MSME period and the whole
  // TDS policy are read from config — without this they would all come back
  // "not configured" and the null-versus-date assertions would pass for the
  // wrong reason.
  await seedConfig(raw);
});

function principal(orgId: string | null): Principal {
  const roles: Role[] = ['VENDOR_FINANCE'];
  return {
    userId: randomUUID(),
    orgId,
    orgType: orgId ? 'VENDOR' : 'PLATFORM',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-t33',
    mfaSatisfied: true,
  } as Principal;
}

const as = <T,>(orgId: string | null, fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 'test-t33' }, () => {
    ctx.setPrincipal(principal(orgId));
    return fn();
  });

interface Seeded {
  vendorOrgId: string;
  orderId: string;
  poId: string;
  poNumber: string;
  payableId: string;
}

/**
 * A vendor with one purchase order, its payable and its TDS accrual.
 *
 * Inserted in the shape `order-transaction.service.ts` writes them, column for
 * column — this file tests the read path and `checkout-order.spec.ts` proves the
 * write. `deliveredAt` is written onto `sub_order`, which is where the other
 * lane's delivery service puts it and what the inspection window is measured
 * from.
 */
async function seedPayable(opts: {
  poNumber: string;
  amount: string;
  vendorOrgId?: string;
  deliveredAt?: Date | null;
  termsDays?: number;
  udyam?: string;
  bankVerified?: boolean;
}): Promise<Seeded> {
  const unit = await seedSellableUnit({ vendorOrgId: opts.vendorOrgId }, raw);
  const vendorOrgId = unit.vendorOrgId;

  const buyerOrgId = await makeOrganization({ org_type: 'BUYER' }, raw);
  const buyerUserId = await makeUser(buyerOrgId, {}, raw);
  const addressId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO identity.org_address
      (id, org_id, type, line1, city, state, state_code, pincode,
       contact_name, contact_mobile, is_billing_enabled)
    VALUES (${addressId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type,
            'Tower B', 'New Delhi', 'Delhi', '07', '110001',
            'Site contact', '+919812345678', TRUE)`;
  const gstProfileId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, '07AABCR9603R1ZX',
            'A Buyer Pvt Ltd', '07', 'ACTIVE', ${NOW}, TRUE)`;

  const orderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, grand_total, status)
    VALUES (${orderId}::uuid, ${'TT-26-T33-' + opts.poNumber.slice(-4)}, ${buyerOrgId}::uuid,
            ${buyerUserId}::uuid, ${gstProfileId}::uuid, ${addressId}::uuid, ${addressId}::uuid,
            60000.00, 10800.00, 70800.00, 'CONFIRMED'::order_status)`;

  await raw.$executeRaw`
    INSERT INTO ordering.sub_order
      (order_id, sub_order_number, vendor_org_id, subtotal, gst_total, status, delivered_at)
    VALUES (${orderId}::uuid, ${'SO-' + opts.poNumber}, ${vendorOrgId}::uuid,
            60000.00, 10800.00, 'CONFIRMED'::order_status, ${opts.deliveredAt ?? null})`;

  const poId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO procurement.purchase_order
      (id, po_number, vendor_org_id, order_id, status, total_net,
       tds_rate_pct, tds_amount, valuation_method, terms_days)
    VALUES (${poId}::uuid, ${opts.poNumber}, ${vendorOrgId}::uuid, ${orderId}::uuid,
            'RAISED', ${opts.amount}::numeric, 0, 0, 'REGULAR', ${opts.termsDays ?? 15})`;

  await raw.$executeRaw`
    INSERT INTO procurement.purchase_order_line
      (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, qc_report_id)
    VALUES (${poId}::uuid, ${unit.unitId}::uuid, ${unit.skuId}::uuid,
            ${opts.amount}::numeric, 'A'::public.grade_type, ${unit.qcReportId}::uuid)`;

  const [payable] = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO procurement.vendor_payable
      (vendor_org_id, purchase_order_id, gross, tds, net_payable, status)
    VALUES (${vendorOrgId}::uuid, ${poId}::uuid, ${opts.amount}::numeric, 0,
            ${opts.amount}::numeric, 'ACCRUED')
    RETURNING id`;

  await raw.$executeRaw`
    INSERT INTO procurement.tds_ledger
      (vendor_org_id, financial_year, purchase_order_id, entry_type,
       gross_amount, tds_rate_pct, tds_amount, reason, occurred_at)
    VALUES (${vendorOrgId}::uuid, ${FY}, ${poId}::uuid, 'ACCRUAL',
            ${opts.amount}::numeric, 0, 0, ${'Purchase order ' + opts.poNumber + ' raised'},
            ${NOW})`;

  if (opts.udyam !== undefined) {
    await raw.$executeRaw`
      INSERT INTO vendor.vendor_profile (org_id, business_category, msme_udyam_no)
      VALUES (${vendorOrgId}::uuid, 'REFURBISHER', ${opts.udyam})
      ON CONFLICT (org_id) DO UPDATE SET msme_udyam_no = EXCLUDED.msme_udyam_no`;
  }

  if (opts.bankVerified) {
    await raw.$executeRaw`
      INSERT INTO kyc.bank_account
        (org_id, purpose, account_holder_name, account_number_enc, account_number_last4,
         ifsc, bank_name, penny_drop_status, verified_at, is_default)
      VALUES (${vendorOrgId}::uuid, 'PAYOUT', 'Neighbour Refurb Pvt Ltd',
              ${Buffer.from('encrypted')}, '9911', 'HDFC0000123', 'HDFC Bank',
              'SUCCESS', ${NOW}, TRUE)`;
  }

  return { vendorOrgId, orderId, poId, poNumber: opts.poNumber, payableId: payable!.id };
}

describe('a vendor sees only their own money', () => {
  it('does not count the neighbour, who is owed far more', async () => {
    const mine = await seedPayable({ poNumber: 'PO-T33-0001', amount: '10000.00' });
    const theirs = await seedPayable({ poNumber: 'PO-T33-0002', amount: '900000.00' });
    await seedPayable({
      poNumber: 'PO-T33-0003',
      amount: '800000.00',
      vendorOrgId: theirs.vendorOrgId,
    });

    const view = await as(mine.vendorOrgId, () => controller.view({}));

    expect(view.rows).toHaveLength(1);
    expect(view.statement.payables).toBe(1);
    expect(view.statement.gross.toString()).toBe('10000.00');
    expect(view.statement.net.toString()).toBe('10000.00');

    const payload = JSON.stringify(view);
    expect(payload).not.toContain(theirs.payableId);
    expect(payload).not.toContain('PO-T33-0002');
    expect(payload).not.toContain('900000');
  });

  it('refuses the neighbour’s deliveries when handed their real order ids', async () => {
    const deliveredAt = new Date(NOW.getTime() - 10 * DAY);
    const mine = await seedPayable({ poNumber: 'PO-T33-0001', amount: '10000.00' });
    const theirs = await seedPayable({
      poNumber: 'PO-T33-0002',
      amount: '900000.00',
      deliveredAt,
    });

    // The id is real and the sub-order exists — this is the forbidden thing
    // being attempted, not a guard being inspected.
    const found = await as(mine.vendorOrgId, () => repo.deliveriesFor([theirs.orderId]));
    expect(found.size).toBe(0);

    // And it is still there afterwards, delivered, for its own vendor.
    const theirsOwn = await as(theirs.vendorOrgId, () => repo.deliveriesFor([theirs.orderId]));
    expect(theirsOwn.get(theirs.orderId)?.delivered_at).toEqual(deliveredAt);
  });

  it('sums the TDS ledger for one vendor, so a threshold cannot be crossed by a stranger', async () => {
    const mine = await seedPayable({ poNumber: 'PO-T33-0001', amount: '10000.00' });
    // Comfortably over the ₹50 lakh threshold. If this leaked into the caller's
    // position the reason would flip from "below the threshold" to a rate on a
    // real deduction — a tax outcome, not a display bug.
    await seedPayable({ poNumber: 'PO-T33-0002', amount: '9000000.00' });

    const view = await as(mine.vendorOrgId, () => controller.view({}));

    expect(view.statement.tds.financialYearPurchases.toString()).toBe('10000.00');
    expect(view.statement.tds.financialYear).toBe(FY);
    expect(view.statement.tds.reason).toMatch(/[Bb]elow the/);
    expect(JSON.stringify(view)).not.toContain('9000000');
  });

  it('does not show the neighbour’s MSME registration or their bank account', async () => {
    const mine = await seedPayable({ poNumber: 'PO-T33-0001', amount: '10000.00' });
    await seedPayable({
      poNumber: 'PO-T33-0002',
      amount: '20000.00',
      udyam: 'UDYAM-HR-05-0042317',
      bankVerified: true,
    });

    const view = await as(mine.vendorOrgId, () => controller.view({}));

    expect(view.msme.registered).toBe(false);
    expect(view.msme.udyamNumber).toBeNull();
    expect(view.account).toBeNull();
    expect(JSON.stringify(view)).not.toContain('UDYAM-HR-05-0042317');
    expect(JSON.stringify(view)).not.toContain('9911');
  });

  it('refuses a caller with no organisation at all', async () => {
    await expect(as(null, () => controller.view({}))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('a date nobody has recorded is not shown as one', () => {
  it('reports eligible_at as null and no payout run, rather than deriving a date', async () => {
    const mine = await seedPayable({
      poNumber: 'PO-T33-0001',
      amount: '10000.00',
      deliveredAt: new Date(NOW.getTime() - 30 * DAY),
    });

    const view = await as(mine.vendorOrgId, () => controller.view({}));
    const row = view.rows[0]!;

    // Nothing writes `vendor_payable.eligible_at`. The rule's answer is carried
    // separately and is NOT copied into the record's slot.
    expect(row.eligibleAt).toBeNull();
    expect(row.inspectionWindowClosesAt).not.toBeNull();
    expect(row.paidAt).toBeNull();
    expect(view.payoutsEver).toBe(0);

    // The whole point of the task: no field on this payload promises a payment
    // date derived from a cycle. `procurement.default_payout_cycle` says
    // T_PLUS_2 and it must not reach a vendor's screen as an expectation.
    const keys = new Set(Object.keys(row));
    for (const invented of ['expectedPaymentOn', 'expectedOn', 'payoutDate', 'payoutOn']) {
      expect(keys.has(invented)).toBe(false);
    }
    expect(JSON.stringify(view)).not.toContain('T_PLUS_2');
  });

  it('says the clock has not started when nothing has been delivered', async () => {
    const mine = await seedPayable({ poNumber: 'PO-T33-0001', amount: '10000.00' });
    const row = (await as(mine.vendorOrgId, () => controller.view({}))).rows[0]!;

    expect(row.waitingOn).toBe('NOT_DELIVERED');
    expect(row.deliveredAt).toBeNull();
    expect(row.inspectionWindowClosesAt).toBeNull();
    expect(row.payBy).toBeNull();
    expect(row.payByBasis).toBeNull();
    expect(row.overdue).toBe(false);
  });
});

describe('the inspection window is a real boundary', () => {
  it('turns from “window open” to “nothing has paid it” as the clock crosses', async () => {
    const deliveredAt = new Date(NOW.getTime() - (WINDOW_HOURS - 1) * HOUR);
    const mine = await seedPayable({
      poNumber: 'PO-T33-0001',
      amount: '10000.00',
      deliveredAt,
    });

    const before = (await as(mine.vendorOrgId, () => controller.view({}))).rows[0]!;
    expect(before.waitingOn).toBe('INSPECTION_WINDOW_OPEN');
    expect(before.inspectionWindowClosesAt).toEqual(
      new Date(deliveredAt.getTime() + WINDOW_HOURS * HOUR),
    );

    // Two hours later the same row is payable, and the reason it has not been
    // paid is ours: no payout run exists to pay it.
    clock.advanceBy(2 * HOUR);
    const after = (await as(mine.vendorOrgId, () => controller.view({}))).rows[0]!;
    expect(after.payableId).toBe(before.payableId);
    expect(after.waitingOn).toBe('NO_PAYOUT_RUN');
    // Still null. Becoming payable by the rule does not make it recorded.
    expect(after.eligibleAt).toBeNull();
  });
});

describe('the MSME deadline is keyed off the registration, not assumed', () => {
  const deliveredAt = () => new Date(NOW.getTime() - 3 * DAY);

  it('binds us to the statutory period when a Udyam number is on record', async () => {
    const mine = await seedPayable({
      poNumber: 'PO-T33-0001',
      amount: '10000.00',
      deliveredAt: deliveredAt(),
      termsDays: 15,
      udyam: 'UDYAM-HR-05-0042317',
    });

    const view = await as(mine.vendorOrgId, () => controller.view({}));
    expect(view.msme).toEqual({
      registered: true,
      udyamNumber: 'UDYAM-HR-05-0042317',
      maxPaymentDays: MSME_DAYS,
    });

    const row = view.rows[0]!;
    expect(row.payByBasis).toBe('MSMED_ACT');
    expect(row.payByDays).toBe(MSME_DAYS);
    expect(row.payBy).toEqual(new Date(deliveredAt().getTime() + MSME_DAYS * DAY));
    expect(row.overdue).toBe(false);
  });

  it('falls back to the purchase order’s own terms with no registration', async () => {
    const mine = await seedPayable({
      poNumber: 'PO-T33-0001',
      amount: '10000.00',
      deliveredAt: deliveredAt(),
      termsDays: 15,
    });

    const row = (await as(mine.vendorOrgId, () => controller.view({}))).rows[0]!;
    expect(row.payByBasis).toBe('PO_TERMS');
    expect(row.payByDays).toBe(15);
    expect(row.payBy).toEqual(new Date(deliveredAt().getTime() + 15 * DAY));
  });

  it('marks a deadline we have already missed, without calling it a failed test', async () => {
    const long = new Date(NOW.getTime() - 400 * DAY);
    const mine = await seedPayable({
      poNumber: 'PO-T33-0001',
      amount: '10000.00',
      deliveredAt: long,
      termsDays: 15,
    });

    const row = (await as(mine.vendorOrgId, () => controller.view({}))).rows[0]!;
    expect(row.overdue).toBe(true);
    expect(row.waitingOn).toBe('NO_PAYOUT_RUN');
  });
});
