/**
 * A configuration editor is a live weapon, so this file checks there is no
 * trigger on it — by pulling.
 *
 * WHAT THIS IS GUARDING
 * ---------------------
 * `platform.platform_config` decides what a vendor is paid, when they are paid,
 * what a buyer is charged and what tax is withheld. T41 ships the screen
 * read-only on purpose, and "read-only" is a claim about routes rather than
 * about intent — so every assertion below is an ATTEMPT to write, not an
 * inspection of the controller:
 *
 *   1. POST, PATCH, PUT and DELETE against the config route. All must be refused
 *      *for an account that holds the write permission*, which is the harder
 *      case: a refusal that only happens because the caller lacks a grant proves
 *      nothing about whether a route exists.
 *   2. The GET beside them must work, so a wholly broken route cannot pass as a
 *      guarded one.
 *   3. A platform account without `platform.config.write` must be refused the
 *      read, because that is the permission §3C.7 puts on this screen.
 *   4. A vendor must be refused, and the refusal must carry none of the payload.
 *
 * AND THE FINANCE CONSOLE
 * -----------------------
 * Same shape, one permission down: `payment.ledger.read`. It is checked here
 * rather than in its own file because the interesting case is identical — a
 * platform account that is legitimately signed in and simply may not see the
 * vendor payout stack.
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

let superToken: string;
let financeToken: string;
let catalogToken: string;
let vendorToken: string;

const VENDOR_ORG = '99999999-0000-4000-8000-0000000000f2';
const CONFIG = '/api/admin/platform/config';
const FINANCE = '/api/admin/finance';

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

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  superToken = await issue(
    'PLATFORM_SUPERADMIN',
    '99999999-0000-4000-8000-0000000000a3',
    'PLATFORM',
    null,
  );
  financeToken = await issue('FINANCE', '99999999-0000-4000-8000-0000000000b3', 'PLATFORM', null);
  catalogToken = await issue(
    'CATALOG_ADMIN',
    '99999999-0000-4000-8000-0000000000c3',
    'PLATFORM',
    null,
  );
  vendorToken = await issue(
    'VENDOR_OWNER',
    '99999999-0000-4000-8000-0000000000d3',
    'VENDOR',
    VENDOR_ORG,
  );
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('the configuration screen cannot write, even for the account that could', () => {
  it.each(['post', 'patch', 'put', 'delete'] as const)(
    'refuses %s on the config route for a PLATFORM_SUPERADMIN',
    async (method) => {
      const res = await request(app.getHttpServer())[method](CONFIG)
        .set(auth(superToken))
        .send({ key: 'tax.tds_rate_pct', value: 99 });
      // 404: no such handler is mapped. Not a 403 — the point is that the
      // capability does not exist, rather than that this caller lacks it.
      expect(res.status).toBe(404);
    },
  );

  it('leaves the table exactly as it was', async () => {
    // The attempts above must not have landed by some other path. A rate of 99%
    // on this row would be a real tax liability.
    const [row] = await raw.$queryRaw<Array<{ value_json: unknown }>>`
      SELECT value_json FROM platform.v_current_config WHERE key = 'tax.tds_rate_pct'`;
    expect(row?.value_json).not.toBe(99);
  });

  it('answers the GET beside them, so the refusals above mean something', async () => {
    const res = await request(app.getHttpServer()).get(CONFIG).set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.keys.length).toBeGreaterThan(0);
  });
});

describe('who may read the configuration', () => {
  const get = (t: string) => request(app.getHttpServer()).get(CONFIG).set(auth(t));

  it('refuses a vendor, and leaks nothing on the way out', async () => {
    const res = await get(vendorToken);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/tds_rate|keys|summary|consumers/);
  });

  it('refuses platform staff who do not hold platform.config.write', async () => {
    expect((await get(catalogToken)).status).toBe(403);
  });

  it('refuses FINANCE too — this screen is ADMIN_SUPER only', async () => {
    expect((await get(financeToken)).status).toBe(403);
  });
});

describe('reachability is reported, not assumed', () => {
  it('reports keys with no reader as an empty list, never as absent', async () => {
    const res = await request(app.getHttpServer()).get(CONFIG).set(auth(superToken));
    const keys = res.body.keys as Array<{ key: string; consumers: string[] | null }>;

    // `price.guardrail_upper_multiple` is the emblematic case and is
    // deliberately NOT asserted here: it is written by the baseline migration
    // and by no seed file, so this database — which the harness rebuilds from
    // the seed's list alone — does not have the row at all. That absence is
    // itself the provenance finding, and it is pinned in
    // `config-consumers.spec.ts` where the source tree rather than the database
    // is the subject.
    const lower = keys.find((k) => k.key === 'price.guardrail_lower_multiple');
    expect(lower?.consumers).toContain('modules/listing/internal/pricing.service.ts');

    const unread = keys.filter((k) => k.consumers !== null && k.consumers.length === 0);
    expect(unread.length).toBeGreaterThan(0);
    expect(res.body.summary.withoutReader).toBe(unread.length);

    // The control: if every key came back with an empty list the assertions
    // above would still hold, and the screen would report the whole platform as
    // dead config.
    const read = keys.filter((k) => k.consumers !== null && k.consumers.length > 0);
    expect(read.length).toBeGreaterThan(0);
    expect(res.body.summary.withReader).toBe(read.length);
  });

  /**
   * The provenance column, over the database the harness actually built.
   *
   * This database is rebuilt from the seed's config list alone, so every key it
   * holds must be seed-written — and the response must say so rather than
   * guessing. A row here claiming `migration only` would mean the map and the
   * database disagree about what exists.
   */
  it('reports where each key is written, and agrees with the database it is reading', async () => {
    const res = await request(app.getHttpServer()).get(CONFIG).set(auth(superToken));
    const keys = res.body.keys as Array<{
      key: string;
      writtenBy: { migration: boolean; seed: boolean } | null;
    }>;

    expect(keys.every((k) => k.writtenBy !== null)).toBe(true);
    expect(res.body.summary.migrationOnly).toBe(0);
    // The control: the field is not simply absent or uniformly false.
    expect(res.body.summary.seedOnly + res.body.summary.inBothWriters).toBe(keys.length);
    expect(res.body.summary.inBothWriters).toBeGreaterThan(0);
  });
});

describe('the finance console is not a general-staff screen', () => {
  const get = (t: string) => request(app.getHttpServer()).get(FINANCE).set(auth(t));

  it('refuses a vendor', async () => {
    const res = await get(vendorToken);
    expect(res.status).toBe(403);
    // A vendor must not learn another supply point's name from a refusal.
    expect(JSON.stringify(res.body)).not.toMatch(/payables|vendors|gates|Pvt/);
  });

  it('refuses platform staff without payment.ledger.read', async () => {
    expect((await get(catalogToken)).status).toBe(403);
  });

  it('answers FINANCE', async () => {
    const res = await get(financeToken);
    expect(res.status).toBe(200);
    expect(res.body.gates).toHaveLength(5);
  });

  /**
   * Every §4.8 condition has to report a verdict, and a condition whose table is
   * empty must report `UNMEASURABLE` rather than `UNMET`.
   *
   * On a truncated database `procurement.goods_receipt` and
   * `procurement.vendor_invoice` are both empty, which is exactly the state the
   * dev database is in — so this pins the distinction the screen is built on:
   * "we did not look" must never render the same as "we looked and it failed".
   */
  it('reports an unevaluable gate as unevaluable, not as failed', async () => {
    const res = await get(financeToken);
    const gates = res.body.gates as Array<{ key: string; verdict: string; passing: number | null }>;

    const match = gates.find((g) => g.key === 'three-way-match');
    expect(match?.verdict).toBe('UNMEASURABLE');
    expect(match?.passing).toBeNull();

    // The control: not every gate is unevaluable, or the field means nothing.
    expect(gates.map((g) => g.verdict)).toContain('MET');
  });
});
