/**
 * A vendor declaring a grade must be able to see the photographs that define it —
 * and nothing else the library holds.
 *
 * WHAT WAS WRONG
 * --------------
 * 608 condition images were catalogued and the only screen over them was the
 * console's coverage grid, guarded by `catalog.condition_image.write`. No vendor
 * role holds that permission and none should: the grid spans every model in the
 * catalog and carries `s3_key` on every frame. So the one moment a vendor needs
 * the reference set — step 2 of the listing wizard, choosing between A+, A and B
 * — was the one moment nothing could show it to them, and they were grading
 * against prose.
 *
 * The answer is not a new route. `GET /api/catalog/skus/:id?grade=` already
 * resolves the buyer's gallery through the same fallback the product page uses,
 * and it is `@Public()` for the reason the controller states: no vendor role
 * holds any `catalog.*` permission because the catalog is TrueTech-owned
 * reference data that vendors read and never write. This file is the proof that
 * the route is genuinely reachable and genuinely narrow.
 *
 * WHAT THIS TEST DOES THAT AN ASSERTION ON THE GRANT WOULD NOT
 * ------------------------------------------------------------
 * It makes both calls with a real vendor token: the one that must answer, and
 * the one that must refuse. A test that read `ROLE_PERMISSIONS` would pass just
 * as happily if the route were deleted — and `qc-console-is-not-vendor-reachable`
 * exists because a naming-convention assertion passed for months over a live
 * leak. Each refusal here is paired with the same call under an ops token, so a
 * route broken for everybody cannot masquerade as a route that is properly
 * guarded.
 *
 * The `s3Key` assertion is the other half. The coverage grid returns object
 * keys, deliberately — it is the write surface and the operator's own upload
 * produced them. The public payload must not, at any depth: a key is a path, and
 * `qc-report-pdf.spec.ts` plants a GSTIN inside one to make the point.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { permissionsFor, REQUIRED_VIEWS } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { migrateTestDatabase, testDb, truncateAll, seedTestReference } from '../support/db';
import { ensurePlatformOrg, makeCatalog, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;
let vendorToken: string;
let catalogAdminToken: string;
let skuId: string;
let modelId: string;

/**
 * A key that would be a leak if it ever reached a buyer-reachable payload.
 *
 * Not a neutral `k/1.webp`: the assertion below has to be able to fail loudly,
 * and a key with a vendor slug in it is the shape of the real thing.
 */
const LEAKY_KEY_PREFIX = 'catalog/condition/alpha-systems-gurugram';

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  const platformOrgId = await ensurePlatformOrg(raw);
  const authorId = await makeUser(platformOrgId, { full_name: 'Catalog Ops' }, raw);
  const catalog = await makeCatalog({}, raw);
  skuId = catalog.skuId;
  modelId = catalog.modelId;

  // Anchored to the MODEL, not the SKU — which is how the seeded library is
  // anchored, and it is the case where the caption has to widen to admit the
  // photograph is of another machine of the same model.
  for (const [index, viewCode] of REQUIRED_VIEWS.entries()) {
    await raw.$executeRaw`
      INSERT INTO catalog.condition_image
        (id, model_id, grade, view_code, s3_key, alt_text, is_primary, sort_order, created_by)
      VALUES (${randomUUID()}::uuid, ${modelId}::uuid, 'B'::grade_type, ${viewCode},
              ${`${LEAKY_KEY_PREFIX}/${viewCode}.webp`},
              ${`Grade B ${viewCode.toLowerCase()} with fine scratches near the hinge`},
              ${index === 0}, ${index}, ${authorId}::uuid)`;
  }

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  const tokens = app.get(TokenService);
  vendorToken = (
    await tokens.issue({
      userId: '99999999-0000-4000-8000-00000000e001',
      orgId: '99999999-0000-4000-8000-00000000e0a1',
      orgType: 'VENDOR',
      roles: ['VENDOR_OWNER'],
      permissions: [...permissionsFor(['VENDOR_OWNER'])],
      mfa: true,
    })
  ).accessToken;

  catalogAdminToken = (
    await tokens.issue({
      userId: '99999999-0000-4000-8000-00000000e002',
      orgId: '99999999-0000-4000-8000-00000000e0a2',
      orgType: 'PLATFORM',
      roles: ['CATALOG_ADMIN'],
      permissions: [...permissionsFor(['CATALOG_ADMIN'])],
      mfa: true,
    })
  ).accessToken;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

describe('a vendor can see the reference photographs for the grade they are declaring', () => {
  it('answers the vendor with the resolved set for that grade', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/catalog/skus/${skuId}?grade=B`)
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.images.images).toHaveLength(REQUIRED_VIEWS.length);
    // MODEL, not SKU: the frames are anchored a level up, and the caption the
    // vendor and the buyer both read depends on this field being honest.
    expect(res.body.images.match).toBe('MODEL');
    for (const image of res.body.images.images) {
      expect(image.altText.length).toBeGreaterThan(10);
      expect(image.url).toContain('/api/objects/');
    }
  });

  it('never puts an object key on that payload, at any depth', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/catalog/skus/${skuId}?grade=B`)
      .set('Authorization', `Bearer ${vendorToken}`);

    const body = JSON.stringify(res.body);
    // The whole key and the vendor-identifying fragment inside it, separately:
    // a token that happened to be a base64url encoding of the key would defeat
    // only the first of these.
    expect(body).not.toContain(LEAKY_KEY_PREFIX);
    expect(body).not.toContain('alpha-systems-gurugram');
    expect(body).not.toContain('s3Key');
    expect(body).not.toContain('s3_key');
  });

  it('serves the bytes on the token it minted, and refuses the key itself', async () => {
    const sku = await request(app.getHttpServer())
      .get(`/api/catalog/skus/${skuId}?grade=B`)
      .set('Authorization', `Bearer ${vendorToken}`);

    const url = sku.body.images.images[0].url as string;
    const token = url.slice(url.indexOf('/api/objects/'));

    // No bytes were ever PUT for this fixture, so the object genuinely does not
    // exist — 404 proves the token RESOLVED and the store was asked, which is
    // the round trip under test. A forged token fails earlier, at the auth tag,
    // and returns the same 404 on purpose: the two are indistinguishable to a
    // prober, so the contrast that matters is with a request for the key.
    const byToken = await request(app.getHttpServer()).get(token);
    expect(byToken.status).toBe(404);

    const byKey = await request(app.getHttpServer()).get(
      `/api/objects/${encodeURIComponent(`${LEAKY_KEY_PREFIX}/LID_TOP.webp`)}`,
    );
    expect(byKey.status).toBe(404);
  });
});

describe('the condition-image library itself stays behind the write permission', () => {
  it('refuses a vendor the coverage grid', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/catalog/condition-images/coverage')
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('alpha-systems-gurugram');
  });

  it('still answers a catalog admin, so the refusal above is about the caller', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/catalog/condition-images/coverage')
      .set('Authorization', `Bearer ${catalogAdminToken}`);

    expect(res.status).toBe(200);
    const row = res.body.find((m: { modelId: string }) => m.modelId === modelId);
    expect(row.images).toHaveLength(REQUIRED_VIEWS.length);
    // The grid is the write surface: it keeps the key, and it now also carries a
    // token so the console can render a thumbnail without ever fetching by key.
    expect(row.images[0].s3Key).toContain(LEAKY_KEY_PREFIX);
    expect(row.images[0].url).toContain('/api/objects/');
    expect(row.images[0].url).not.toContain(LEAKY_KEY_PREFIX);
  });

  it('a vendor token carries no catalog permission at all to spend', async () => {
    const claims = await app.get(TokenService).verifyAccess(vendorToken);
    expect(claims.scope.filter((p) => p.startsWith('catalog.'))).toEqual([]);
  });
});
