/**
 * The global palette and the unit 360 span every organisation. No tenant may
 * reach either, and no role may search a source it does not hold.
 *
 * WHAT THIS FILE IS GUARDING
 * --------------------------
 * Two different failures, and they are not the same shape.
 *
 * 1. **A tenant reaching an any-scoped console screen.** `GET /api/ops/search`
 *    searches five schemas and `GET /api/ops/units/:serial` names both the
 *    supply point a machine came from and the buyer it went to. Neither applies
 *    an org predicate — correctly, because they are the platform's own screens —
 *    which is exactly the shape that made `GET /api/qc/grade-corrections` return
 *    every competitor's serials to any vendor who asked.
 *
 *    A per-source permission check alone would NOT have caught it: `platform.
 *    ticket.read` is held by VENDOR_OWNER and VENDOR_ADMIN, so a palette gated
 *    on permissions and nothing else would have handed a vendor a box over every
 *    ticket on the platform. The outer door is `orgType === 'PLATFORM'`.
 *
 * 2. **A source searched that the caller's role cannot read.** A TECHNICIAN
 *    holds `listing.any.read` and no ordering permission. Typing `TT-26` must
 *    return no order and must NOT say "that order exists but is not yours" —
 *    sequential order numbers make that an order-volume oracle, which is T17's
 *    404-not-403 reasoning and T32's reason for keeping our order number off a
 *    vendor's purchase order.
 *
 * WHY EVERY ASSERTION HAS A CONTROL
 * ---------------------------------
 * A test that only asserts a refusal passes just as well if the route were
 * deleted, renamed, or broken for everybody — three shipped defects in this
 * build had exactly that shape. So every refusal below is paired with the same
 * call succeeding for someone who should get it, and every "this role sees no
 * orders" is paired with a role that does see them on the identical term.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { permissionsFor } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { migrateTestDatabase, testDb, truncateAll, seedTestReference } from '../support/db';
import { seedSellableUnit } from '../support/factories';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;
let vendorToken: string;
let buyerToken: string;
let opsToken: string;
let techToken: string;

/**
 * A serial that is deliberately on no database anywhere.
 *
 * Used for the reachability control: platform staff must get 404 and not 403,
 * which is what proves the ROUTE was reached rather than the guard answering
 * for everybody.
 */
const MISSING_SERIAL = 'NOSUCHSERIAL01';

/** Both console routes T35 built. Neither takes an org predicate, by design. */
const CONSOLE_ROUTES = ['/api/ops/search?q=TT-26', `/api/ops/units/${MISSING_SERIAL}`];

const ORG = {
  vendor: '99999999-0000-4000-8000-0000000350a1',
  buyer: '99999999-0000-4000-8000-0000000350a2',
  platform: '99999999-0000-4000-8000-0000000350a3',
};

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  const tokens = app.get(TokenService);
  const issue = async (
    orgId: string,
    orgType: 'VENDOR' | 'BUYER' | 'PLATFORM',
    role: Parameters<typeof permissionsFor>[0][number],
  ): Promise<string> =>
    (
      await tokens.issue({
        userId: `99999999-0000-4000-8000-0000000350${orgId.slice(-2)}`,
        orgId,
        orgType,
        roles: [role],
        permissions: [...permissionsFor([role])],
        mfa: true,
      })
    ).accessToken;

  vendorToken = await issue(ORG.vendor, 'VENDOR', 'VENDOR_OWNER');
  buyerToken = await issue(ORG.buyer, 'BUYER', 'CUSTOMER_OWNER');
  opsToken = await issue(ORG.platform, 'PLATFORM', 'OPS_MANAGER');
  // Holds `listing.any.read` and no ordering or procurement permission at all —
  // which is the whole point of the slice assertions below.
  techToken = await issue(ORG.platform, 'PLATFORM', 'TECHNICIAN');
}, 240_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

describe('neither console screen is tenant-reachable', () => {
  it.each(CONSOLE_ROUTES)('refuses a VENDOR on %s', async (route) => {
    const res = await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(res.status).toBe(403);
    // Nothing about another organisation may ride along on the refusal itself.
    expect(JSON.stringify(res.body)).not.toMatch(/serial|legalName|gstin|vendor_org_id/i);
  });

  it.each(CONSOLE_ROUTES)('refuses a BUYER on %s', async (route) => {
    const res = await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/serial|legalName|gstin/i);
  });

  it('still answers platform staff on the search — the control', async () => {
    // Without this the two refusals above prove nothing: a deleted or broken
    // route refuses everybody, and a permission typo refuses everybody too.
    const res = await request(app.getHttpServer())
      .get('/api/ops/search?q=TT-26')
      .set('Authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.groups)).toBe(true);
  });

  it('still answers platform staff on the 360 — the control', async () => {
    // 404 and not 403: the route is REACHED, and the serial simply is not on
    // this database. A 403 here would mean the guard, not the lookup, answered.
    const res = await request(app.getHttpServer())
      .get(`/api/ops/units/${MISSING_SERIAL}`)
      .set('Authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    // And the refusal does not echo what was looked for. "No unit
    // NOSUCHSERIAL01" confirms the format of one that does exist.
    expect(JSON.stringify(res.body)).not.toContain(MISSING_SERIAL);
  });

  it('a VENDOR token holds platform.ticket.read, which is why orgType is the door', async () => {
    // The assertion that explains the design. A palette gated on per-source
    // permissions alone would have searched tickets for this token.
    const claims = await app.get(TokenService).verifyAccess(vendorToken);
    expect(claims.scope).toContain('platform.ticket.read');
    expect(claims.scope).not.toContain('listing.any.read');
    expect(claims.scope).not.toContain('ordering.any.read');
  });
});

describe('a source the caller cannot read is not searched, and is never confirmed', () => {
  it('a TECHNICIAN searching an order number gets no order group at all', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ops/search?q=TT-26')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { key: string }) => g.key)).not.toContain('orders');
    // The source is named. The record never is: "orders were not searched" is a
    // fact about the product, "TT-26-00004 exists" is a fact about a record.
    expect(res.body.unavailable.map((u: { label: string }) => u.label)).toContain('Orders');
    expect(JSON.stringify(res.body)).not.toMatch(/TT-26-\d/);
  });

  it('an OPS_MANAGER on the same term does get an order group — the control', async () => {
    // Without this, the assertion above would pass on a search that was simply
    // broken for everyone.
    const res = await request(app.getHttpServer())
      .get('/api/ops/search?q=TT-26')
      .set('Authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { key: string }) => g.key)).toContain('orders');
  });

  it('a TECHNICIAN is told which fields WERE compared, hit or miss', async () => {
    // The other half of the honesty. An empty result with no statement of what
    // was compared reads as "this box does not take serials".
    const res = await request(app.getHttpServer())
      .get('/api/ops/search?q=zzzz-no-such-thing')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    const machines = res.body.groups.find((g: { key: string }) => g.key === 'machines');
    expect(machines.comparedWith).toEqual(
      expect.arrayContaining([expect.stringContaining('serial')]),
    );
  });

  it('a one-character term is refused rather than scanning five schemas', async () => {
    // 422 and not 400: `ZodValidationPipe` raises `ValidationError`, which this
    // application maps to 422 across every route. A `%a%` over five schemas
    // returns most of the database and helps nobody.
    const res = await request(app.getHttpServer())
      .get('/api/ops/search?q=a')
      .set('Authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(422);
  });
});

/**
 * The 360's own permission split, over a real machine.
 *
 * A TECHNICIAN may read the machine and must not read the trade. The control is
 * the same serial read by OPS_MANAGER, who gets both — without it, a 360 that
 * returned `commercial: null` for everybody would pass.
 */
describe('the unit 360 shows the machine to a technician and the trade to nobody else', () => {
  let vendorOrgId: string;
  let serial: string;

  beforeAll(async () => {
    // A real vendor + catalog + listing + unit graph, through the shared
    // factory. The machine is on no order, deliberately: the assertion under
    // test is about PERMISSION, and "you may not see the trade" and "there is no
    // trade to see" produce two different sentences that must not converge.
    const seeded = await seedSellableUnit({}, raw);
    vendorOrgId = seeded.vendorOrgId;
    serial = seeded.serial;
  }, 60_000);

  it('a TECHNICIAN gets the machine', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ops/units/${serial}`)
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(200);
    expect(res.body.serialNumber).toBe(serial);
    expect(res.body.gradeDeclared).toBe('A');
  });

  it('a TECHNICIAN does not get the trade, and is told so rather than shown a blank', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ops/units/${serial}`)
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.body.commercial).toBeNull();
    // A null with no sentence beside it renders as an empty panel, which reads
    // as "this machine was never sold". The reason is the whole point.
    expect(res.body.commercialUnavailable).toMatch(/not/i);
    expect(res.body.commercialUnavailable).toMatch(/orders/i);
  });

  it('an OPS_MANAGER reading the same serial is not refused the commercial half — the control', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ops/units/${serial}`)
      .set('Authorization', `Bearer ${opsToken}`);

    expect(res.status).toBe(200);
    // This machine is on no order, so `commercial` is still null — but for the
    // OTHER reason, and the two sentences must be distinguishable. If they were
    // not, "you may not see this" and "there is nothing to see" would be the
    // same screen.
    expect(res.body.commercialUnavailable).toMatch(/never been allocated/i);
  });

  it('no response carries a field outside the allow-list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/ops/units/${serial}`)
      .set('Authorization', `Bearer ${opsToken}`);

    // The three columns on `listing.unit` that must never leave it. The unit id
    // is checked too: this screen addresses a machine by its serial, and an
    // internal uuid on the wire is a handle nobody on a screen needs.
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/purchase_price|purchasePrice/);
    expect(body).not.toMatch(/hw_fingerprint|fingerprint/i);
    expect(body).not.toMatch(/vendorOrgId|vendor_org_id/);
    expect(body).not.toContain(vendorOrgId);
  });

  it('offers nothing that would write to the append-only audit log', async () => {
    // `identity.audit_log` is append-only, enforced by `trg_append_only` calling
    // `ops.reject_mutation()` — a trigger and not a REVOKE, because a REVOKE
    // cannot bind the table owner and the owner is who this application connects
    // as. The screen must not offer an edit either, so the count it reports is a
    // NUMBER and never a row somebody could be handed a control over.
    const res = await request(app.getHttpServer())
      .get(`/api/ops/units/${serial}`)
      .set('Authorization', `Bearer ${opsToken}`);

    expect(typeof res.body.auditEntries).toBe('number');

    // And the trigger holds, which is the layer that would still be right if the
    // other two were wrong. Attempting the forbidden thing, not asserting a
    // guard exists.
    //
    // **A row is inserted first, and that is not ceremony.** The first version
    // of this assertion ran `UPDATE ... WHERE true` against a truncated table,
    // matched zero rows, fired no row-level trigger and passed — a vacuous test
    // of exactly the shape this build keeps finding. `trg_append_only` is a
    // ROW trigger; with nothing to update there is nothing to refuse.
    await raw.$executeRaw`
      INSERT INTO identity.audit_log (action, entity_type, entity_id)
      VALUES ('t35.append_only_probe', 'unit', ${serial})`;

    await expect(
      raw.$executeRaw`
        UPDATE identity.audit_log SET action = 'tampered'
         WHERE action = 't35.append_only_probe'`,
    ).rejects.toThrow();

    await expect(
      raw.$executeRaw`
        DELETE FROM identity.audit_log WHERE action = 't35.append_only_probe'`,
    ).rejects.toThrow();

    // The control: the same table DOES take an insert, so the two refusals above
    // are the trigger refusing a mutation rather than the table being unusable.
    const rows = await raw.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM identity.audit_log
       WHERE action = 't35.append_only_probe'`;
    expect(rows[0]?.n).toBe(1);
  });
});
