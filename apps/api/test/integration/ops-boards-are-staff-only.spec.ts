/**
 * The order board, the order record and the purchase-order board — T39.
 *
 * WHAT THIS FILE IS GUARDING
 * --------------------------
 * Every other read in this codebase is about one org and is scoped at the
 * repository. These three are deliberately about the whole platform, and the
 * order record is the **only screen in the product where a buyer and a vendor
 * appear together** (`03_UX_SPEC.md` §3C.4). So the boundary is not a `WHERE`
 * clause; it is the permission, and a test that reads the decorator proves
 * nothing. Every test below makes the request and demands the refusal, and every
 * one has its control case so a broken route cannot pass as a guarded one.
 *
 *   1. **A vendor and a buyer are refused all three routes.** Control: an
 *      OPS_MANAGER asks for the same URLs and gets them.
 *   2. **The two boards carry DIFFERENT permissions, and it shows.** SUPPORT
 *      holds `ordering.any.read` and not `procurement.po.read_any`;
 *      PRICING_ADMIN holds the second and not the first. Each gets one board and
 *      is refused the other, which is exactly the division §3C.4 describes. A
 *      single permission over both would give one of them a rail entry that
 *      403s.
 *
 * AND THE CLAIMS ONLY A DATABASE CAN SETTLE
 * -----------------------------------------
 *   3. **The margin is refused when the purchase orders do not cover every
 *      machine**, and stated (to the paisa) when they do. This is not
 *      hypothetical: the demo database has three orders with machines and no
 *      purchase order at all, two of them delivered.
 *   4. **The search box matches; it does not parse.** A seal code lives in `qc`,
 *      a serial in `ordering`, a GSTIN in `kyc`, a name in `identity` — four
 *      schemas, four statements, one box. Each is asserted with a control term
 *      that must find nothing.
 *   5. **The facet count and the filtered total are one predicate.** T28 found a
 *      queue saying "3 need you" landing on a board of nine, which was two
 *      copies of one predicate drifting apart.
 *   6. **A foreign order number is a 404 and not a 403** — the reason T17 gives:
 *      order numbers are sequential, so a route that distinguished "not yours"
 *      from "does not exist" would be an order-volume oracle. Here the caller is
 *      staff, so what matters is the unknown-number arm.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { permissionsFor, type Role } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import {
  migrateTestDatabase,
  seedTestReference,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, seedSellableUnit } from '../support/factories';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;

let opsToken: string;
let supportToken: string;
let pricingToken: string;
let vendorToken: string;
let buyerToken: string;

/**
 * Strings distinctive enough that a substring search cannot match by accident.
 *
 * "Delhi" would match half the fixture; a sweep that can pass by coincidence is
 * not a sweep, and a search assertion that can pass by coincidence is not an
 * assertion.
 */
const BUYER = {
  legalName: 'Thoroughgood Institutional Supplies Pvt Ltd',
  gstin: '07AABCT4471N1ZQ',
  contactName: 'Yamuna Balasubramanian',
  mobile: '+919812345678',
} as const;

/** Covered by a purchase order on every machine — the margin can be stated. */
const COVERED = 'TT-26-90001';
/** Machines and no purchase order at all — the margin must be refused. */
const UNCOVERED = 'TT-26-90002';

interface Fixture {
  buyerOrgId: string;
  buyerUserId: string;
  addressId: string;
  gstProfileId: string;
}

interface SeededOrder {
  orderId: string;
  serials: string[];
  sealCodes: string[];
  subtotal: string;
  paid: string;
}

async function issue(
  role: Role,
  orgType: 'PLATFORM' | 'VENDOR' | 'BUYER',
  orgId: string | null,
): Promise<string> {
  const { accessToken } = await app.get(TokenService).issue({
    userId: randomUUID(),
    orgId,
    orgType,
    roles: [role],
    permissions: [...permissionsFor([role])],
    mfa: true,
  });
  return accessToken;
}

async function makeBuyer(): Promise<Fixture> {
  const buyerOrgId = await makeOrganization(
    { org_type: 'BUYER', legal_name: BUYER.legalName },
    raw,
  );
  // Inserted here rather than through `makeUser`, which takes no mobile — and
  // the mobile is one of the seven things the search box has to match.
  const buyerUserId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, email, full_name, mobile, status)
    VALUES (${buyerUserId}::uuid, ${buyerOrgId}::uuid,
            ${`buyer-${buyerUserId.slice(0, 8)}@example.com`},
            ${BUYER.contactName}, ${BUYER.mobile}, 'ACTIVE')`;

  const addressId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO identity.org_address
      (id, org_id, type, label, line1, city, state, state_code, pincode,
       contact_name, contact_mobile, is_billing_enabled)
    VALUES (${addressId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type,
            'Thoroughgood head office', '11th floor, Barakhamba Road',
            'New Delhi', 'Delhi', '07', '110001',
            ${BUYER.contactName}, ${BUYER.mobile}, TRUE)`;

  const gstProfileId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code,
                                 status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, ${BUYER.gstin},
            ${BUYER.legalName}, '07', 'ACTIVE', now(), TRUE)`;

  return { buyerOrgId, buyerUserId, addressId, gstProfileId };
}

/**
 * One order, `machines` serials, and optionally the purchase order that pays for
 * them.
 *
 * Inserted directly rather than driven through checkout: this file is about the
 * READ path and `checkout-order.spec.ts` already proves the write. The shape
 * matches what `order-transaction.service.ts` writes column for column — if it
 * ever stops matching, that is a real divergence and this fixture should follow
 * it rather than be exempted.
 */
async function seedOrder(
  buyer: Fixture,
  opts: { orderNumber: string; machines: number; withPo: boolean; unitPrice: number; payout: number },
): Promise<SeededOrder> {
  const subtotal = (opts.unitPrice * opts.machines).toFixed(2);
  const gst = (opts.unitPrice * opts.machines * 0.18).toFixed(2);
  const grand = (Number(subtotal) + Number(gst)).toFixed(2);

  const orderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
       billing_address_id, shipping_address_id, subtotal, gst_total, grand_total, status)
    VALUES (${orderId}::uuid, ${opts.orderNumber}, ${buyer.buyerOrgId}::uuid,
            ${buyer.buyerUserId}::uuid, ${buyer.gstProfileId}::uuid,
            ${buyer.addressId}::uuid, ${buyer.addressId}::uuid,
            ${subtotal}::numeric, ${gst}::numeric, ${grand}::numeric,
            'CONFIRMED'::order_status)`;

  // Every machine on one supply point, so the fixture has one sub-order and one
  // purchase order — the coverage arm is what this file is testing, not the
  // multi-consignment split, which `checkout-order.spec.ts` owns.
  const first = await seedSellableUnit({}, raw);
  const units = [first];
  for (let i = 1; i < opts.machines; i += 1) {
    units.push(await seedSellableUnit({ vendorOrgId: first.vendorOrgId }, raw));
  }

  const subOrderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering.sub_order
      (id, order_id, sub_order_number, vendor_org_id, subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${`${opts.orderNumber}-1`},
            ${first.vendorOrgId}::uuid, ${subtotal}::numeric, ${gst}::numeric,
            'CONFIRMED'::order_status)`;

  for (const unit of units) {
    const lineId = randomUUID();
    await raw.$executeRaw`
      INSERT INTO ordering.order_line
        (id, sub_order_id, listing_id, sku_id, grade, qty, unit_price,
         gst_rate, gst_amount, line_total)
      VALUES (${lineId}::uuid, ${subOrderId}::uuid, ${unit.listingId}::uuid,
              ${unit.skuId}::uuid, 'A'::public.grade_type, 1, ${opts.unitPrice}::numeric,
              18, ${(opts.unitPrice * 0.18).toFixed(2)}::numeric,
              ${(opts.unitPrice * 1.18).toFixed(2)}::numeric)`;
    await raw.$executeRaw`
      INSERT INTO ordering.order_line_unit (order_line_id, unit_id, serial_number, status)
      VALUES (${lineId}::uuid, ${unit.unitId}::uuid, ${unit.serial}, 'RESERVED'::unit_status)`;
  }

  if (opts.withPo) {
    const poId = randomUUID();
    const totalNet = (opts.payout * opts.machines).toFixed(2);
    await raw.$executeRaw`
      INSERT INTO procurement.purchase_order
        (id, po_number, vendor_org_id, order_id, status, total_net,
         tds_rate_pct, tds_amount, valuation_method, terms_days)
      VALUES (${poId}::uuid, ${`PO-26-T39-${opts.orderNumber.slice(-3)}`},
              ${first.vendorOrgId}::uuid, ${orderId}::uuid, 'RAISED',
              ${totalNet}::numeric, 0, 0, 'REGULAR', 15)`;
    for (const unit of units) {
      await raw.$executeRaw`
        INSERT INTO procurement.purchase_order_line
          (po_id, unit_id, sku_id, agreed_net_payout, grade_at_po, qc_report_id)
        VALUES (${poId}::uuid, ${unit.unitId}::uuid, ${unit.skuId}::uuid,
                ${opts.payout}::numeric, 'A'::public.grade_type, ${unit.qcReportId}::uuid)`;
    }
  }

  const seals = await raw.$queryRaw<Array<{ seal_code: string }>>`
    SELECT seal_code FROM qc.qc_seal WHERE unit_id = ANY(${units.map((u) => u.unitId)}::uuid[])`;

  return {
    orderId,
    serials: units.map((u) => u.serial),
    sealCodes: seals.map((s) => s.seal_code),
    subtotal,
    paid: opts.withPo ? (opts.payout * opts.machines).toFixed(2) : '0.00',
  };
}

let buyer: Fixture;
let covered: SeededOrder;
let uncovered: SeededOrder;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  buyer = await makeBuyer();
  covered = await seedOrder(buyer, {
    orderNumber: COVERED,
    machines: 2,
    withPo: true,
    unitPrice: 60000,
    payout: 46010,
  });
  uncovered = await seedOrder(buyer, {
    orderNumber: UNCOVERED,
    machines: 3,
    withPo: false,
    unitPrice: 51000,
    payout: 0,
  });

  // One PENDING approval and one APPROVED, so `?approval=pending` has both a
  // row it must return and a row it must not.
  await raw.$executeRaw`
    INSERT INTO ordering.order_approval
      (order_id, requested_by, approver_user_id, status, order_value, expires_at)
    VALUES (${covered.orderId}::uuid, ${buyer.buyerUserId}::uuid, ${buyer.buyerUserId}::uuid,
            'PENDING', 141600.00, now() + interval '20 hours'),
           (${uncovered.orderId}::uuid, ${buyer.buyerUserId}::uuid, ${buyer.buyerUserId}::uuid,
            'APPROVED', 180540.00, now() + interval '20 hours')`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  opsToken = await issue('OPS_MANAGER', 'PLATFORM', null);
  // Holds `ordering.any.read` and NOT `procurement.po.read_any`.
  supportToken = await issue('SUPPORT', 'PLATFORM', null);
  // Holds `procurement.po.read_any` and NOT `ordering.any.read`.
  pricingToken = await issue('PRICING_ADMIN', 'PLATFORM', null);
  const vendorOrgId = await makeOrganization({ org_type: 'VENDOR' }, raw);
  vendorToken = await issue('VENDOR_OWNER', 'VENDOR', vendorOrgId);
  buyerToken = await issue('CUSTOMER_ADMIN', 'BUYER', buyer.buyerOrgId);
});

afterAll(async () => {
  await app.close();
  await moduleRef.close();
});

const get = (path: string, token: string) =>
  request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

const ORDERS = '/api/ops/orders';
const POS = '/api/ops/purchase-orders';

/* ========================================================================== */

describe('a tenant cannot reach the platform’s own boards', () => {
  it('refuses a vendor all three routes, and serves the same three to staff', async () => {
    for (const url of [ORDERS, `${ORDERS}/${COVERED}`, POS]) {
      // The forbidden thing, attempted — not a guard inspected.
      expect((await get(url, vendorToken)).status).toBe(403);
      // The control case. Without it a route that 500s on every caller would
      // pass the line above and look guarded.
      expect((await get(url, opsToken)).status).toBe(200);
    }
  });

  it('refuses the buyer whose own order it is', async () => {
    // The sharpest case: this buyer placed the order and may read it on their
    // own screen at /api/buyer/orders/:orderNumber. What they may not see is the
    // purchase order and the margin, which is what this route carries.
    expect((await get(`${ORDERS}/${COVERED}`, buyerToken)).status).toBe(403);
    expect((await get(ORDERS, buyerToken)).status).toBe(403);
    expect((await get(POS, buyerToken)).status).toBe(403);

    const { body } = await get(`${ORDERS}/${COVERED}`, opsToken).expect(200);
    expect(body.orderNumber).toBe(COVERED);
  });
});

describe('the two boards carry different permissions, and it shows', () => {
  it('gives SUPPORT the orders and refuses them the purchase orders', async () => {
    const orders = await get(ORDERS, supportToken).expect(200);
    expect(orders.body.total).toBe(2);
    await get(`${ORDERS}/${COVERED}`, supportToken).expect(200);
    // Not a rendering choice: `procurement.po.read_any` is a permission SUPPORT
    // does not hold, and the rail entry is gated on the same string.
    await get(POS, supportToken).expect(403);
  });

  it('gives PRICING_ADMIN the purchase orders and refuses them the orders', async () => {
    const pos = await get(POS, pricingToken).expect(200);
    expect(pos.body.total).toBe(1);
    await get(ORDERS, pricingToken).expect(403);
    await get(`${ORDERS}/${COVERED}`, pricingToken).expect(403);
  });
});

describe('the margin is stated or refused, never approximated', () => {
  it('states it to the paisa when every machine has a purchase-order line', async () => {
    const { body } = await get(`${ORDERS}/${COVERED}`, opsToken).expect(200);
    expect(body.marginUnavailable).toBeNull();
    expect(body.margin).not.toBeNull();
    expect(body.margin.soldFor).toBe(covered.subtotal);
    expect(body.margin.paid).toBe(covered.paid);
    // The arithmetic, checked against the rows rather than restated from the
    // response: 120000.00 sold, 92020.00 paid.
    expect(Number(body.margin.amount)).toBeCloseTo(
      Number(covered.subtotal) - Number(covered.paid),
      2,
    );
    // Every percentage carries its denominator, and the denominator is soldFor.
    expect(Number(body.margin.pct)).toBeCloseTo(
      ((Number(covered.subtotal) - Number(covered.paid)) / Number(covered.subtotal)) * 100,
      1,
    );
    for (const sub of body.subOrders) {
      for (const machine of sub.machines) expect(machine.purchaseCost).not.toBeNull();
    }
  });

  it('refuses it, with the reason and the machine count, when no purchase order exists', async () => {
    const { body } = await get(`${ORDERS}/${UNCOVERED}`, opsToken).expect(200);
    // Null, never zero. A ₹0 margin and an unrecorded one are opposite facts.
    expect(body.margin).toBeNull();
    expect(body.marginUnavailable).toContain('3 machines');
    expect(body.purchaseOrders).toEqual([]);
    for (const sub of body.subOrders) {
      for (const machine of sub.machines) expect(machine.purchaseCost).toBeNull();
    }
  });

  it('says on the board that an order raised no purchase order at all', async () => {
    const { body } = await get(`${ORDERS}?q=${UNCOVERED}`, opsToken).expect(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].purchaseOrders).toBe(0);
    // The control: the covered order raised one, so a zero here would mean the
    // count is broken rather than that the record is honest.
    const other = await get(`${ORDERS}?q=${COVERED}`, opsToken).expect(200);
    expect(other.body.rows[0].purchaseOrders).toBe(1);
  });
});

describe('one box over seven identifiers, matched and never parsed', () => {
  it('finds an order by a seal code, which lives in another module’s schema', async () => {
    const seal = covered.sealCodes[0] ?? '';
    expect(seal).not.toBe('');
    const { body } = await get(`${ORDERS}?q=${encodeURIComponent(seal)}`, opsToken).expect(200);
    expect(body.rows.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([COVERED]);
    // The row says WHY it matched, or a seal search lands on a board with no
    // seal column and reads as a mistake.
    expect(body.rows[0].matchedOn).toContainEqual({ kind: 'seal', value: seal });

    // The control: a seal code of the right shape belonging to no ordered unit
    // must find nothing, so the arm above cannot be passing by returning
    // everything.
    const none = await get(`${ORDERS}?q=TRG-26HR-0000000`, opsToken).expect(200);
    expect(none.body.total).toBe(0);
  });

  it('finds an order by a serial, and names the serial that matched', async () => {
    const serial = uncovered.serials[1] ?? '';
    const { body } = await get(`${ORDERS}?q=${serial}`, opsToken).expect(200);
    expect(body.rows.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([UNCOVERED]);
    expect(body.rows[0].matchedOn).toContainEqual({ kind: 'serial', value: serial });
  });

  it('finds both orders by the buyer’s GSTIN, and prints the GSTIN it matched', async () => {
    const { body } = await get(`${ORDERS}?q=${BUYER.gstin}`, opsToken).expect(200);
    expect(body.total).toBe(2);
    expect(body.rows[0].matchedOn).toContainEqual({ kind: 'gstin', value: BUYER.gstin });

    const none = await get(`${ORDERS}?q=07AABCZ9999Z1ZZ`, opsToken).expect(200);
    expect(none.body.total).toBe(0);
  });

  it('finds them by the buyer’s legal name and by the mobile the order was placed from', async () => {
    const byName = await get(`${ORDERS}?q=Thoroughgood`, opsToken).expect(200);
    expect(byName.body.total).toBe(2);
    expect(byName.body.rows[0].matchedOn).toContainEqual({
      kind: 'buyer',
      value: BUYER.legalName,
    });

    const byMobile = await get(
      `${ORDERS}?q=${encodeURIComponent(BUYER.mobile)}`,
      opsToken,
    ).expect(200);
    expect(byMobile.body.total).toBe(2);
    expect(byMobile.body.rows[0].matchedOn).toContainEqual({
      kind: 'mobile',
      value: BUYER.mobile,
    });
  });

  it('says what it compared against, so an empty result is not read as an unsupported field', async () => {
    const { body } = await get(`${ORDERS}?q=nothing-matches-this`, opsToken).expect(200);
    expect(body.total).toBe(0);
    expect(body.searchedFor).toEqual(expect.arrayContaining([expect.stringContaining('seal')]));
    // Absent when nothing was searched for: a list of what we compared against
    // is meaningless on an unfiltered board.
    const all = await get(ORDERS, opsToken).expect(200);
    expect(all.body.searchedFor).toBeNull();
  });

  it('finds a purchase order by the ORDER number that caused it', async () => {
    const { body } = await get(`${POS}?q=${COVERED}`, opsToken).expect(200);
    expect(body.total).toBe(1);
    expect(body.rows[0].orderNumber).toBe(COVERED);

    // The control: the uncovered order raised no purchase order, so searching
    // its number here must find nothing rather than everything.
    const none = await get(`${POS}?q=${UNCOVERED}`, opsToken).expect(200);
    expect(none.body.total).toBe(0);
  });

  it('finds a purchase order by a serial on one of its lines, and names it', async () => {
    const serial = covered.serials[0] ?? '';
    const { body } = await get(`${POS}?q=${serial}`, opsToken).expect(200);
    expect(body.total).toBe(1);
    expect(body.rows[0].matchedSerials).toContain(serial);
  });
});

describe('a facet count and the filtered total are one predicate', () => {
  it('returns exactly what each status facet promised', async () => {
    const { body } = await get(ORDERS, opsToken).expect(200);
    expect(body.facets.status.length).toBeGreaterThan(0);
    for (const facet of body.facets.status) {
      const filtered = await get(`${ORDERS}?status=${facet.value}`, opsToken).expect(200);
      expect(filtered.body.total).toBe(facet.count);
    }
  });

  it('returns exactly what each purchase-order status facet promised', async () => {
    const { body } = await get(POS, opsToken).expect(200);
    for (const facet of body.facets.status.filter((f: { count: number }) => f.count > 0)) {
      const filtered = await get(`${POS}?status=${facet.value}`, opsToken).expect(200);
      expect(filtered.body.total).toBe(facet.count);
    }
  });

  it('sums the whole filtered set on the purchase-order board, not the page', async () => {
    const { body } = await get(`${POS}?per=5`, opsToken).expect(200);
    const [row] = await raw.$queryRaw<Array<{ value: string; machines: number }>>`
      SELECT coalesce(sum(po.total_net), 0)::text AS value,
             (SELECT count(*)::int FROM procurement.purchase_order_line) AS machines
        FROM procurement.purchase_order po`;
    expect(body.totals.value).toBe(row?.value);
    expect(body.totals.machines).toBe(row?.machines);
  });
});

describe('the approval filter is the fact, not the order’s status', () => {
  it('returns the order with a PENDING approval and not the one that was approved', async () => {
    const { body } = await get(`${ORDERS}?approval=pending`, opsToken).expect(200);
    expect(body.rows.map((r: { orderNumber: string }) => r.orderNumber)).toEqual([COVERED]);
    // Both orders are CONFIRMED, so a filter that read the ORDER status would
    // have returned both — which is the drift this arm exists to catch.
    const all = await get(ORDERS, opsToken).expect(200);
    expect(all.body.total).toBe(2);
  });

  it('reports the approval breach against the server’s clock, not a stored flag', async () => {
    const { body } = await get(`${ORDERS}?approval=pending`, opsToken).expect(200);
    // Seeded 20 hours in the future, so it is live. `breached` is a computed
    // field; a stored one would have to be updated by a job that does not exist.
    expect(body.rows[0].approval.breached).toBe(false);
    expect(body.rows[0].approval.status).toBe('PENDING');
  });
});

describe('an order number nobody knows', () => {
  it('is a 404 and not a 403, even for staff', async () => {
    // T17's rule, applied here for consistency rather than for secrecy: staff
    // may see every order, so the only honest answer to a number that names none
    // is that it names none.
    await get(`${ORDERS}/TT-26-99999`, opsToken).expect(404);
  });
});
