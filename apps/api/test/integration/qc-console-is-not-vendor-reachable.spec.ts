/**
 * The QC console spans every vendor. No vendor may reach it.
 *
 * WHAT WENT WRONG
 * ---------------
 * `GET /api/qc/grade-corrections` was guarded by `qc.report.read`, and four
 * VENDOR roles held it. The handler takes no principal and the query carries no
 * org predicate — which is CORRECT for an ops queue meant to span vendors, and
 * catastrophic once a vendor can call it. It returned every competitor's
 * serials, unit ids and resolved vendor names. `GET /api/qc/visits` and
 * `/visits/:id` were the same shape over another vendor's manifest.
 *
 * WHY THE EXISTING TEST DID NOT CATCH IT
 * --------------------------------------
 * `auth-and-scope.spec.ts` asserts that no vendor role holds a `*.any.*`
 * permission, and it passed the whole time: the leaking permission was called
 * `qc.report.read`, not `qc.report.read_any`. A test keyed on a NAMING
 * convention only catches mistakes that remember to be named badly. Note that
 * every other vendor grant in `roles.ts` is own-scoped BY NAME —
 * `listing.own.read`, `procurement.po.read_own` — which is exactly why these two
 * did not look wrong sitting among them.
 *
 * So this test does not inspect the grant. It makes the request.
 *
 * The control case is the point of the file. Asserting only that a vendor gets
 * 403 would pass just as well if the route were deleted, renamed, or broken for
 * everyone — so each route is also called with an ops token and required to
 * answer. A refusal is only evidence when the same call succeeds for someone
 * else.
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

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;
let vendorToken: string;
let opsToken: string;

/** Every route that reads the QC console across orgs. */
const CONSOLE_ROUTES = ['/api/qc/grade-corrections', '/api/qc/visits', '/api/qc/technicians'];

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
  vendorToken = (
    await tokens.issue({
      userId: '99999999-0000-4000-8000-00000000f001',
      orgId: '99999999-0000-4000-8000-00000000f0a1',
      orgType: 'VENDOR',
      roles: ['VENDOR_OWNER'],
      permissions: [...permissionsFor(['VENDOR_OWNER'])],
      mfa: true,
    })
  ).accessToken;

  opsToken = (
    await tokens.issue({
      userId: '99999999-0000-4000-8000-00000000f002',
      orgId: '99999999-0000-4000-8000-00000000f0a2',
      orgType: 'PLATFORM',
      roles: ['QC_MANAGER'],
      permissions: [...permissionsFor(['QC_MANAGER'])],
      mfa: true,
    })
  ).accessToken;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

describe('the QC console is not vendor-reachable', () => {
  it.each(CONSOLE_ROUTES)('refuses a vendor on %s', async (route) => {
    const res = await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(res.status).toBe(403);
    // Nothing about another org may ride along on the refusal itself.
    expect(JSON.stringify(res.body)).not.toMatch(/serial|vendorName|vendor_org_id/i);
  });

  it.each(CONSOLE_ROUTES)('still answers QC staff on %s', async (route) => {
    const res = await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${opsToken}`);

    // Without this the refusal above proves nothing: a deleted or broken route
    // refuses everybody.
    expect(res.status).toBe(200);
  });

  it('a vendor token carries no qc permission at all to spend', async () => {
    const claims = await app.get(TokenService).verifyAccess(vendorToken);
    expect(claims.scope.filter((p) => p.startsWith('qc.'))).toEqual([]);
  });
});
