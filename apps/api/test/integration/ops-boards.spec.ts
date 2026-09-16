/**
 * Stage 8's endpoints, driven through the real stack.
 *
 * Eleven of these boards are raw SQL against five schemas, and raw SQL that
 * typechecks proves nothing at all — every failure this file has caught so far
 * was a column that does not exist (`payment.invoice.total`, `kyc.kyc_application`)
 * or an enum whose values are not what the code assumed. A board that 500s is a
 * blank screen, which is the one thing §8.7 says must never happen.
 *
 * What is asserted here is the CONTRACT the one board component relies on, not
 * the contents of any particular row:
 *
 *   1. every board answers with the envelope, and its first view is never All
 *   2. every view's count comes back with the page, from the same request
 *   3. the counts endpoint gives a seat only the keys it may see — absent, not 0
 *   4. the chain is seven steps whether or not the records behind them exist
 *   5. a rider who is off shift is refused, with a reason a human can act on
 *   6. escrow and credit say `connected: false` rather than implying a zero
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { permissionsFor, PERMISSIONS, type Role } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { migrateTestDatabase, testDb, truncateAll, seedTestReference } from '../support/db';
import { makeAddress } from '../support/factories';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;
let admin: string;

const ORG = '99999999-0000-4000-8000-0000000b0001';
const USER = '99999999-0000-4000-8000-0000000b0002';

const auth = (t: string) => ({
  Authorization: `Bearer ${t}`,
  // A PLATFORM token on a request with no Origin resolves to the storefront and
  // is refused as a wrong-portal session — a real refusal, but not the one under
  // test anywhere in this file.
  'x-trugrade-audience': 'console',
});

async function issue(permissions: readonly string[], roles: Role[] = ['OPS_MANAGER']): Promise<string> {
  const { accessToken } = await app.get(TokenService).issue({
    userId: USER,
    orgId: ORG,
    orgType: 'PLATFORM',
    roles,
    permissions: [...permissions] as never,
    mfa: true,
  });
  return accessToken;
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  await raw.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, status)
    VALUES (${ORG}::uuid, 'INTERNAL', 'TrueTech Services Pvt. Ltd.', 'VERIFIED')
    ON CONFLICT (id) DO NOTHING`;
  await raw.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, status)
    VALUES (${USER}::uuid, ${ORG}::uuid, 'Board Probe', 'boards@example.test'::citext, 'ACTIVE')
    ON CONFLICT (id) DO NOTHING`;

  admin = await issue(PERMISSIONS, ['PLATFORM_SUPERADMIN']);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

const BOARDS: Array<[string, string]> = [
  ['shipments', '/api/ops/shipments'],
  ['pickups', '/api/ops/pickups'],
  ['riders', '/api/ops/riders'],
  ['carriers', '/api/ops/carriers'],
  ['ndr', '/api/ops/ndr'],
  ['purchase orders', '/api/ops/purchase-orders'],
  ['payables', '/api/ops/finance/payables'],
  ['payout runs', '/api/ops/finance/payout-runs'],
  ['automation runs', '/api/ops/platform/automation/runs'],
  ['approvals', '/api/ops/platform/approvals'],
];

describe('every board answers with the envelope', () => {
  it.each(BOARDS)('%s', async (_name, url) => {
    const res = await request(app.getHttpServer()).get(url).set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.grandTotal).toBe('number');
    expect(Array.isArray(res.body.views)).toBe(true);
  });

  it.each(BOARDS)('%s opens on a view that is not All', async (_name, url) => {
    const res = await request(app.getHttpServer()).get(url).set(auth(admin));
    const first = res.body.views[0];
    expect(first).toBeDefined();
    // The one rule §8.4 calls the most important on the page. The default is
    // the first view the server returns, so the server has to order them with
    // the work first — and All last.
    expect(first.key).not.toBe('all');
    expect(String(first.label).toLowerCase()).not.toBe('all');
  });

  it.each(BOARDS)('%s carries a count for every view in the same response', async (_name, url) => {
    const res = await request(app.getHttpServer()).get(url).set(auth(admin));
    for (const view of res.body.views) {
      expect(typeof view.count).toBe('number');
      expect(view.count).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(BOARDS)('%s honours a page beyond the end instead of failing', async (_name, url) => {
    // A stale bookmark is not an error worth a 400. It resolves to the last
    // page rather than to a 500 or an empty render with a lying pager.
    const res = await request(app.getHttpServer()).get(`${url}?page=9999`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.page).toBeLessThanOrEqual(res.body.pages);
  });
});

describe('the rail counts', () => {
  it('give a seat only the keys it may see', async () => {
    const support = await issue([...permissionsFor(['SUPPORT'])], ['SUPPORT']);
    const res = await request(app.getHttpServer()).get('/api/ops/counts').set(auth(support));
    expect(res.status).toBe(200);
    // SUPPORT holds ordering.any.read but not procurement.payable.read_any, and
    // an absent key renders nothing while a 0 renders a badge saying "none".
    // "Not yours" and "none" must not look the same on a rail.
    expect(res.body).toHaveProperty('orders');
    expect(res.body).not.toHaveProperty('payables');
  });

  it('refuse a vendor outright', async () => {
    const { accessToken } = await app.get(TokenService).issue({
      userId: USER,
      orgId: ORG,
      orgType: 'VENDOR',
      roles: ['VENDOR_OWNER'],
      permissions: [...permissionsFor(['VENDOR_OWNER'])],
      mfa: true,
    });
    const res = await request(app.getHttpServer())
      .get('/api/ops/counts')
      .set({ Authorization: `Bearer ${accessToken}`, 'x-trugrade-audience': 'console' });
    expect(res.status).toBe(403);
  });
});

describe('the chain strip', () => {
  it('is 404 for an order that does not exist, not an empty chain', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ops/chain/TT-26-99999')
      .set(auth(admin));
    expect(res.status).toBe(404);
  });

  it('is seven steps for an order that does, whatever exists behind them', async () => {
    const orderId = '99999999-0000-4000-8000-0000000b0010';
    const buyer = '99999999-0000-4000-8000-0000000b0011';
    await raw.$executeRaw`
      INSERT INTO identity.organization (id, org_type, legal_name, status)
      VALUES (${buyer}::uuid, 'BUYER', 'Chain Buyer Pvt Ltd', 'VERIFIED')
      ON CONFLICT (id) DO NOTHING`;

    // An order cannot exist without a billing profile and two addresses — the
    // schema says so, and it is right to: an invoice with no place of supply is
    // not an invoice. The fixture has to satisfy that rather than route around it.
    const address = await makeAddress(buyer, {}, raw);
    const gstProfileId = '99999999-0000-4000-8000-0000000b0012';
    await raw.$executeRaw`
      INSERT INTO kyc.gst_profile
        (id, org_id, gstin, legal_name_as_per_gst, state_code, status, api_verified_at)
      VALUES (${gstProfileId}::uuid, ${buyer}::uuid, '06AABCU9603R1ZX', 'Chain Buyer Pvt Ltd',
              '06', 'ACTIVE', now())
      ON CONFLICT (id) DO NOTHING`;

    await raw.$executeRaw`
      INSERT INTO ordering."order"
        (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id,
         billing_address_id, shipping_address_id, subtotal, gst_total, freight_total,
         tcs_amount, grand_total, payment_mode, payment_status, status, placed_at)
      VALUES (${orderId}::uuid, 'TT-26-0CHAIN', ${buyer}::uuid, ${USER}::uuid,
              ${gstProfileId}::uuid, ${address}::uuid, ${address}::uuid,
              1000, 180, 0, 0, 1180, 'PREPAID', 'PENDING', 'CONFIRMED', now())
      ON CONFLICT (id) DO NOTHING`;

    const res = await request(app.getHttpServer())
      .get('/api/ops/chain/TT-26-0CHAIN')
      .set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(7);
    // The gap IS the information: an order with no shipment is an order nobody
    // dispatched, and six steps instead of seven would hide exactly that.
    expect(res.body.steps.map((s: { key: string }) => s.key)).toEqual([
      'order',
      'po',
      'packed',
      'shipment',
      'delivered',
      'invoice',
      'paid',
    ]);
    expect(res.body.steps[3].state).toBe('PENDING');
  });
});

describe('assigning a rider', () => {
  const riderId = '99999999-0000-4000-8000-0000000b0020';

  it('refuses one who is off shift, and says so', async () => {
    await raw.$executeRaw`
      INSERT INTO logistics.rider (id, user_id, phone, zone, vehicle_type, is_active)
      VALUES (${riderId}::uuid, ${USER}::uuid, '+919000000001', 'NCR',
              'BIKE', FALSE)
      ON CONFLICT (id) DO NOTHING`;

    const res = await request(app.getHttpServer())
      .post('/api/ops/pickups/rider')
      .set(auth(admin))
      .send({ taskIds: ['99999999-0000-4000-8000-0000000b0030'], riderId });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/off shift/i);
  });

  it('is refused without logistics.task.assign', async () => {
    const viewer = await issue([...permissionsFor(['AUDITOR'])], ['AUDITOR']);
    const res = await request(app.getHttpServer())
      .post('/api/ops/pickups/rider')
      .set(auth(viewer))
      .send({ taskIds: ['99999999-0000-4000-8000-0000000b0030'], riderId });
    expect(res.status).toBe(403);
  });
});

describe('escrow and credit', () => {
  it('say no provider is connected rather than implying a zero balance', async () => {
    const escrow = await request(app.getHttpServer()).get('/api/finance/escrow').set(auth(admin));
    expect(escrow.status).toBe(200);
    expect(escrow.body.connected).toBe(false);
    expect(escrow.body.provider).toBeNull();

    const credit = await request(app.getHttpServer()).get('/api/finance/credit').set(auth(admin));
    expect(credit.status).toBe(200);
    expect(credit.body.connected).toBe(false);
  });
});

describe('a shipment record', () => {
  it('is 404 for an id that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ops/shipments/99999999-0000-4000-8000-0000000b0099')
      .set(auth(admin));
    expect(res.status).toBe(404);
  });

  it('does not swallow the board route', async () => {
    // `/shipments` and `/shipments/:id` are declared in that order; a literal
    // path matched by the parameterised one would 404 the entire board.
    const res = await request(app.getHttpServer()).get('/api/ops/shipments').set(auth(admin));
    expect(res.status).toBe(200);
  });
});
