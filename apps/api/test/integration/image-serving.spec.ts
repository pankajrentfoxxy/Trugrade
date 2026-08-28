/**
 * Images that a browser can actually fetch, and the evidence a unit passport
 * shows — through the real HTTP app.
 *
 * Everything here is driven over HTTP rather than through a service, because
 * every property under test is a property of the response: the status, the
 * content type, the bytes, the headers, and what is absent from the JSON. A
 * service-level assertion would prove that a method returns a string.
 *
 * The four things it refuses to let regress:
 *
 *   1. **An image fetch returns the bytes.** Not a URL shape, not a 200 with an
 *      empty body — the exact bytes that were stored, with the content type they
 *      were stored under. Before this route existed `presignDownload` returned
 *      `memory://download/…` and nothing in the product could render.
 *   2. **The object key never reaches a buyer.** The vendor's GSTIN and slug are
 *      planted INSIDE the keys the condition image and the QC photograph are
 *      stored at, so the sweep is testing the real path — a key path carrying a
 *      supplier identifier is the leak PHASE_05 Task 1 names.
 *   3. **The route cannot be walked.** A forged token, and a valid token with one
 *      character changed, both 404; and the miss bucket closes on a loop.
 *   4. **A not-measured area does not read as a pass.** The one assertion the
 *      whole evidence seed exists to support.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { findForbiddenKeys, findVendorIdentityLeaks } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { ObjectStorePort } from '../../src/shared/adapters/ports';
import { RateLimiter } from '../../src/shared/redis/redis.service';
import { QC_AREA_CODES } from '../../src/modules/qc/dto/qc.dto';
import { seedQcEvidence } from '../../prisma/seed/qc-evidence';
import { standInImage } from '../../prisma/seed/stand-in-image';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDb,
  truncateAll,
} from '../support/db';
import { seedSellableUnit } from '../support/factories';

/**
 * The supplier nobody buying a laptop may learn about. Both strings are planted
 * inside object keys below, which is where they would really leak from.
 */
const VENDOR = {
  legalName: 'Northwind Refurb Traders Private Limited',
  gstin: '06AABCN1234M1Z7',
  slug: 'northwind-refurb-traders',
};

/** The subject every bucket in this suite is keyed on: supertest's own socket. */
const LOCAL_IP = '::ffff:127.0.0.1';

let app: INestApplication;
let moduleRef: TestingModule;
let store: ObjectStorePort;
let limiter: RateLimiter;
let raw: PrismaClient;

let serial: string;
let unitId: string;
let reportId: string;
let skuId: string;
let vendorOrgId: string;
let conditionImageKey: string;
let photoKey: string;

/** The path part of a minted URL — supertest talks to the app, not to a host. */
function pathOf(url: string): string {
  return new URL(url).pathname;
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  // The same prefix main.ts sets, so the paths asserted here are the paths a
  // browser would use.
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  store = app.get(ObjectStorePort);
  limiter = app.get(RateLimiter);

  const seeded = await seedSellableUnit({ sealed: true }, raw);
  ({ serial, unitId, skuId, vendorOrgId } = {
    serial: seeded.serial,
    unitId: seeded.unitId,
    skuId: seeded.skuId,
    vendorOrgId: seeded.vendorOrgId,
  });
  reportId = seeded.qcReportId!;

  await raw.$executeRaw`
    UPDATE identity.organization SET legal_name = ${VENDOR.legalName} WHERE id = ${vendorOrgId}::uuid`;

  // --- the condition image, keyed under the vendor's own slug ---------------
  // Not a hypothetical: the object key is where a supplier identifier travels
  // inside a customer payload without anyone noticing it is there.
  conditionImageKey = `catalog/${VENDOR.slug}/${VENDOR.gstin}/a/lid_top.svg`;
  const conditionBytes = standInImage({ heading: 'LID TOP', detail: ['GRADE A'] });
  await store.put(conditionImageKey, conditionBytes.bytes, conditionBytes.contentType);
  const [model] = await raw.$queryRaw<Array<{ model_id: string }>>`
    SELECT model_id FROM catalog.sku WHERE id = ${skuId}::uuid`;
  await raw.$executeRaw`
    INSERT INTO catalog.condition_image
      (model_id, grade, view_code, s3_key, alt_text, is_primary, sort_order, created_by)
    SELECT ${model!.model_id}::uuid, 'A'::grade_type, 'LID_TOP', ${conditionImageKey},
           'Grade A lid from above, showing faint marks under raking light.', TRUE, 0, u.id
      FROM identity.user_account u LIMIT 1`;

  // --- the technician's photograph, keyed the same way ----------------------
  photoKey = `qc/photos/${VENDOR.slug}/${VENDOR.gstin}/lid.svg`;
  const photoBytes = standInImage({ heading: 'LID', detail: [serial] });
  await store.put(photoKey, photoBytes.bytes, photoBytes.contentType);
  await raw.$executeRaw`
    INSERT INTO qc.qc_photo (qc_report_id, angle, file_key, hash)
    VALUES (${reportId}::uuid, 'LID', ${photoKey}, 'deadbeef')`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await closeTestDb();
});

beforeEach(async () => {
  // Every test in this file shares one IP, so a previous test's fetches would
  // otherwise decide whether the rate-limit test reaches its own limit.
  await limiter.reset({ name: 'object-fetch', limit: 0, windowSeconds: 0 }, LOCAL_IP);
  await limiter.reset({ name: 'object-fetch-miss', limit: 0, windowSeconds: 0 }, LOCAL_IP);
  await limiter.reset({ name: 'qc-passport', limit: 0, windowSeconds: 0 }, LOCAL_IP);
  await limiter.reset({ name: 'qc-passport-miss', limit: 0, windowSeconds: 0 }, LOCAL_IP);
  await limiter.reset({ name: 'catalog-search', limit: 0, windowSeconds: 0 }, LOCAL_IP);
});

describe('GET /api/objects/:token', () => {
  it('returns the stored bytes, with the type they were stored under', async () => {
    const expected = await store.get(conditionImageKey);
    const url = await store.presignDownload(conditionImageKey, 300);

    const res = await request(app.getHttpServer()).get(pathOf(url));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // The bytes, not a redirect to them and not a placeholder of the same size.
    expect(Buffer.from(res.body).equals(expected)).toBe(true);
    expect(expected.toString('utf8')).toContain('STAND-IN');
  });

  it('does not publish the key it was minted from', async () => {
    const url = await store.presignDownload(conditionImageKey, 300);
    expect(url).not.toContain(VENDOR.slug);
    expect(url).not.toContain(VENDOR.gstin);
    expect(url).not.toContain('catalog/');
  });

  it('refuses a forged token, a tampered one, and an expired one', async () => {
    const url = await store.presignDownload(conditionImageKey, 300);
    const token = pathOf(url).split('/').pop()!;

    // A token invented from nothing.
    const forged = await request(app.getHttpServer()).get('/api/objects/AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(forged.status).toBe(404);

    // One character of a VALID token changed — the case a signature-only scheme
    // catches and a plain-base64 one does not.
    const flipped = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1);
    const tampered = await request(app.getHttpServer()).get(`/api/objects/${flipped}`);
    expect(tampered.status).toBe(404);

    // Already expired when minted. The TTL is inside the token, so this needs no
    // clock manipulation and cannot become a time bomb.
    const stale = await store.presignDownload(conditionImageKey, -60);
    const expired = await request(app.getHttpServer()).get(pathOf(stale));
    expect(expired.status).toBe(404);

    // And the real one still works, so the three refusals above mean something.
    const good = await request(app.getHttpServer()).get(pathOf(url));
    expect(good.status).toBe(200);
  });

  it('closes the miss bucket on a walk, and leaves a real reader alone', async () => {
    // The miss bucket is 20 an hour. Twenty-one guesses is a for-loop, and the
    // twenty-first must be refused rather than merely unhelpful.
    let refusedAt = 0;
    for (let i = 1; i <= 25 && refusedAt === 0; i++) {
      const res = await request(app.getHttpServer()).get(
        `/api/objects/${Buffer.from(`guess-${i}`).toString('base64url')}`,
      );
      if (res.status === 429) refusedAt = i;
      else expect(res.status).toBe(404);
    }
    expect(refusedAt).toBeGreaterThan(0);
    expect(refusedAt).toBeLessThanOrEqual(22);

    // And that is the asymmetry the control rests on: a walker is stopped by
    // their misses while somebody reading a page they were legitimately given a
    // URL for is not, because they never produce one. The volume bucket below is
    // what bounds them.
    const url = await store.presignDownload(conditionImageKey, 300);
    const stillWorks = await request(app.getHttpServer()).get(pathOf(url));
    expect(stillWorks.status).toBe(200);
  });

  it('refuses a valid token once the volume bucket is exhausted', async () => {
    const url = await store.presignDownload(conditionImageKey, 300);
    // Driven through the limiter rather than 240 HTTP round trips: what is under
    // test is that the ROUTE consults this bucket, not that Redis can count.
    await limiter
      .consume({ name: 'object-fetch', limit: 240, windowSeconds: 300 }, LOCAL_IP, 241)
      .catch(() => undefined);

    const blocked = await request(app.getHttpServer()).get(pathOf(url));
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('customer-facing payloads carry a URL, never a key', () => {
  it('GET /api/catalog/skus/:id?grade=A serves an image without naming the object', async () => {
    const res = await request(app.getHttpServer()).get(`/api/catalog/skus/${skuId}?grade=A`);
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(conditionImageKey);
    expect(body).not.toContain('s3Key');
    expect(findVendorIdentityLeaks(res.body, { orgId: vendorOrgId, ...VENDOR })).toEqual([]);
    expect(findForbiddenKeys(res.body)).toEqual([]);

    // Positive half: the sweep above would pass over an empty response too.
    expect(res.body.images.images).toHaveLength(1);
    const fetched = await request(app.getHttpServer()).get(pathOf(res.body.images.images[0].url));
    expect(fetched.status).toBe(200);
    expect(fetched.headers['content-type']).toContain('image/svg+xml');
    expect(Buffer.from(fetched.body).equals(await store.get(conditionImageKey))).toBe(true);
  });

  it('GET /api/unit/:serial serves the technician photograph without naming the object', async () => {
    const res = await request(app.getHttpServer()).get(`/api/unit/${serial}`);
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(photoKey);
    expect(body).not.toContain('fileKey');
    expect(findVendorIdentityLeaks(res.body, { orgId: vendorOrgId, ...VENDOR })).toEqual([]);
    expect(findForbiddenKeys(res.body)).toEqual([]);

    expect(res.body.photos).toHaveLength(1);
    const fetched = await request(app.getHttpServer()).get(pathOf(res.body.photos[0].url));
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body).equals(await store.get(photoKey))).toBe(true);
  });
});

describe('the twelve areas, and the ones nobody measured', () => {
  /** The area codes the seed wrote a row for, read back from the table. */
  async function storedAreas(): Promise<string[]> {
    const rows = await raw.$queryRaw<Array<{ area: string }>>`
      SELECT area FROM qc.qc_area_result WHERE qc_report_id = ${reportId}::uuid`;
    return rows.map((r) => r.area);
  }

  it('leaves out the areas read off a tool that reported nothing', async () => {
    await seedQcEvidence(raw);
    const areas = await storedAreas();

    // This report has no `qc_hardware_detected` row, so the three areas read off
    // the diagnostic tool were not measured and must be absent, not invented.
    expect(areas).not.toContain('BATTERY');
    expect(areas).not.toContain('STORAGE');
    expect(areas).not.toContain('MEMORY_CPU');
    // The positive half — the cosmetic areas a technician looks at with their
    // own eyes were measured, so the absences above mean something.
    expect(areas).toContain('PHYSICAL');
    expect(areas).toContain('DISPLAY');
    expect(areas).toContain('KEYBOARD');
  });

  it('reports a not-measured area as NOT_MEASURED, never as a pass', async () => {
    const written = new Set(await storedAreas());
    const res = await request(app.getHttpServer()).get(`/api/unit/${serial}`);
    expect(res.status).toBe(200);

    // Twelve, always. A screen iterating the array cannot silently skip an area
    // it was never told about.
    expect(res.body.areas).toHaveLength(QC_AREA_CODES.length);
    expect(written.size).toBeLessThan(QC_AREA_CODES.length);
    expect(written.size).toBeGreaterThan(0);

    for (const area of res.body.areas as Array<{
      area: string;
      status: string;
      score: number | null;
      maxScore: number | null;
    }>) {
      if (written.has(area.area)) {
        expect(['PASS', 'WARN']).toContain(area.status);
        expect(area.score).toBeGreaterThan(0);
      } else {
        expect(area.status).toBe('NOT_MEASURED');
        // Null, not zero. Zero renders as a bar at the bottom of a scale, which
        // is a measurement — a lie in the opposite direction to a tick.
        expect(area.score).toBeNull();
        expect(area.maxScore).toBeNull();
      }
    }

    const battery = (res.body.areas as Array<{ area: string; status: string }>).find(
      (a) => a.area === 'BATTERY',
    )!;
    expect(battery.status).toBe('NOT_MEASURED');
  });

  it('shows the wipe certificate the seed wrote, or says nothing at all', async () => {
    const res = await request(app.getHttpServer()).get(`/api/unit/${serial}`);
    const [row] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM qc.wipe_certificate WHERE unit_id = ${unitId}::uuid`;

    if (Number(row!.n) === 0) {
      // One unit in twelve is seeded without one on purpose, so that the absent
      // state is reachable. Null is the honest answer; an empty object is not.
      expect(res.body.wipeCertificate).toBeNull();
    } else {
      expect(res.body.wipeCertificate.standard).toBe('NIST_800_88_PURGE');
      expect(res.body.wipeCertificate.verificationStatus).toBe('VERIFIED');
    }
  });
});
