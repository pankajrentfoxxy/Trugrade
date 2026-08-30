/**
 * The audit log is evidence, and this file tries to destroy it.
 *
 * WHAT THIS IS GUARDING
 * ---------------------
 * A test that asserts `trg_append_only` exists proves nothing. It proves the
 * trigger is defined, not that it fires, not that it fires for the role the
 * application connects as, and not that some later migration replaced its
 * function with a no-op. This repo has already shipped exactly that defect once:
 * append-only was enforced by `REVOKE UPDATE, DELETE`, **a REVOKE cannot bind
 * the table owner**, and the application connects as the owner — so the log was
 * freely rewritable while a test happily confirmed the grant was in place.
 *
 * So every assertion below is an ATTEMPT:
 *
 *   1. UPDATE one row. The database must refuse.
 *   2. DELETE one row. The database must refuse.
 *   3. UPDATE with a WHERE that matches nothing — the trigger is FOR EACH ROW,
 *      so this must SUCCEED, affecting zero rows. Without it, cases 1 and 2 are
 *      equally satisfied by a table that rejects every statement, including the
 *      INSERT the application depends on.
 *   4. INSERT, and read it back. The control: an append-only table that cannot
 *      be appended to is a broken table, not a protected one.
 *
 * AND THE ROUTES
 * --------------
 * The viewer must have no way to call a mutation either, which is checked by
 * asking for one rather than by grepping the controller: POST, PATCH, PUT and
 * DELETE on the audit-log route must all be refused, and the GET beside them
 * must work, so a wholly broken route cannot pass as a guarded one.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { permissionsFor, type Role } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { migrateTestDatabase, testDb, truncateAll, seedTestReference } from '../support/db';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;

let auditorToken: string;
let catalogToken: string;
let vendorToken: string;

const VENDOR_ORG = '99999999-0000-4000-8000-0000000000f1';

async function issue(
  role: Role,
  userId: string,
  orgType: 'PLATFORM' | 'VENDOR',
  orgId: string | null,
): Promise<string> {
  const { accessToken } = await app.get(TokenService).issue({
    userId,
    orgId,
    orgType,
    roles: [role],
    permissions: [...permissionsFor([role])],
    mfa: true,
  });
  return accessToken;
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  // One row to try to destroy. Written with raw SQL rather than through the
  // application, because what is under test is the TABLE's behaviour and the
  // application deliberately has no method that could produce cases 1 and 2.
  await raw.$executeRaw`
    INSERT INTO identity.audit_log (action, entity_type, entity_id, after_json, created_at)
    VALUES ('test.evidence.written', 'test_subject', 'subject-1',
            '{"before":"the original"}'::jsonb, now())`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  auditorToken = await issue('AUDITOR', '99999999-0000-4000-8000-0000000000a2', 'PLATFORM', null);
  catalogToken = await issue(
    'CATALOG_ADMIN',
    '99999999-0000-4000-8000-0000000000b2',
    'PLATFORM',
    null,
  );
  vendorToken = await issue(
    'VENDOR_OWNER',
    '99999999-0000-4000-8000-0000000000c2',
    'VENDOR',
    VENDOR_ORG,
  );
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

describe('the database refuses to let the audit log be rewritten', () => {
  it('refuses an UPDATE that matches a row', async () => {
    await expect(
      raw.$executeRaw`
        UPDATE identity.audit_log SET action = 'test.evidence.tampered'
         WHERE entity_id = 'subject-1'`,
    ).rejects.toThrow();

    // And the row is untouched, which the rejection alone does not prove: a
    // statement can fail after a partial effect if the refusal is not a
    // constraint.
    const [row] = await raw.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM identity.audit_log WHERE entity_id = 'subject-1'`;
    expect(row?.action).toBe('test.evidence.written');
  });

  it('refuses a DELETE that matches a row', async () => {
    await expect(
      raw.$executeRaw`DELETE FROM identity.audit_log WHERE entity_id = 'subject-1'`,
    ).rejects.toThrow();

    const [row] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM identity.audit_log WHERE entity_id = 'subject-1'`;
    expect(Number(row?.n)).toBe(1);
  });

  /**
   * The control that stops the two above passing against a table that refuses
   * everything. `trg_append_only` is FOR EACH ROW, so a statement matching no
   * row never fires it and must succeed with zero rows affected.
   */
  it('allows an UPDATE that matches nothing, because the trigger is per-row', async () => {
    const affected = await raw.$executeRaw`
      UPDATE identity.audit_log SET action = 'never' WHERE entity_id = 'no-such-subject'`;
    expect(affected).toBe(0);
  });

  it('still accepts an INSERT, and reads it back', async () => {
    await raw.$executeRaw`
      INSERT INTO identity.audit_log (action, entity_type, entity_id, created_at)
      VALUES ('test.evidence.appended', 'test_subject', 'subject-2', now())`;

    const [row] = await raw.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM identity.audit_log WHERE entity_id = 'subject-2'`;
    expect(row?.action).toBe('test.evidence.appended');
  });
});

describe('the viewer offers no way to mutate the log', () => {
  const url = '/api/admin/audit-log';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it.each(['post', 'patch', 'put', 'delete'] as const)(
    'refuses %s on the audit-log route',
    async (method) => {
      const res = await request(app.getHttpServer())[method](url).set(auth(auditorToken)).send({});
      // 404 because no such handler is mapped — the strongest possible answer,
      // and the one that stays true if somebody removes a guard.
      expect(res.status).toBe(404);
    },
  );

  it('answers the GET beside them, so the refusals above mean something', async () => {
    const res = await request(app.getHttpServer()).get(url).set(auth(auditorToken));
    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBeGreaterThan(0);
  });
});

describe('who may read the log', () => {
  const get = (t: string) =>
    request(app.getHttpServer()).get('/api/admin/audit-log').set({ Authorization: `Bearer ${t}` });

  it('refuses a vendor', async () => {
    const res = await get(vendorToken);
    expect(res.status).toBe(403);
    // Nothing about the platform's own activity may ride along on a refusal.
    expect(JSON.stringify(res.body)).not.toMatch(/test\.evidence|subject-1|counts/);
  });

  it('refuses platform staff who do not hold identity.audit.read', async () => {
    expect((await get(catalogToken)).status).toBe(403);
  });

  it('answers an auditor', async () => {
    expect((await get(auditorToken)).status).toBe(200);
  });
});

describe('the viewer never drops rows silently', () => {
  const get = (query: string) =>
    request(app.getHttpServer())
      .get(`/api/admin/audit-log${query}`)
      .set({ Authorization: `Bearer ${auditorToken}` });

  it('reports what a filter excluded, not just what it matched', async () => {
    const all = await get('');
    const filtered = await get('?action=test.evidence.appended');

    expect(filtered.status).toBe(200);
    expect(filtered.body.counts.matching).toBe(1);
    expect(filtered.body.counts.total).toBe(all.body.counts.total);
    expect(filtered.body.counts.excludedByFilter).toBe(all.body.counts.total - 1);
  });

  /**
   * A date-only `to` must mean the END of that day.
   *
   * Treated as an instant it is midnight, which silently excludes every row on
   * the day the operator asked for — the exact silent drop this screen exists to
   * refuse, and invisible because the response still looks like a clean result.
   */
  it('treats a date-only end of range as the whole day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await get(`?from=${today}&to=${today}`);

    expect(res.status).toBe(200);
    expect(res.body.counts.matching).toBeGreaterThan(0);
  });

  /**
   * A range with no partition behind it returns nothing, and must SAY so. Both
   * halves matter: the zero is real, and reporting it without the coverage flag
   * would present "we cannot look there" as "nothing happened there".
   */
  it('flags a range that falls outside every partition', async () => {
    const res = await get('?from=2020-01-01&to=2020-12-31');

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
    expect(res.body.coverage.rangeIsCovered).toBe(false);
    expect(res.body.coverage.hasDefaultPartition).toBe(false);
  });

  it('does not flag a range that is inside them', async () => {
    // The control. Without it the assertion above is satisfied by a field that
    // is always false, which would train an operator to ignore the warning.
    const from = new Date().toISOString().slice(0, 10);
    const res = await get(`?from=${from}`);
    expect(res.body.coverage.rangeIsCovered).toBe(true);
  });
});
