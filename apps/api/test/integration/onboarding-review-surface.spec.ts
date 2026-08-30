/**
 * Who may open an application, and who may open the documents inside it.
 *
 * WHAT THIS IS GUARDING
 * ---------------------
 * `kyc.application.read` and `kyc.document.read` are two permissions and they
 * are held by different people. OPS_MANAGER and SUPPORT hold the first: they
 * need to see that an application is late, who it belongs to and where it sits.
 * Only KYC_REVIEWER, AUDITOR, DPO and the superadmin hold the second, because
 * the documents are a director's Aadhaar, a cancelled cheque and a PAN card.
 *
 * The tempting shape — put the documents on the payload the review screen
 * already fetches — would have widened the second grant to everybody holding
 * the first, and nothing would have looked wrong: the guard would still read
 * `kyc.application.read`, the response would just carry more. So the documents
 * are a separate route, and this file makes the request rather than inspecting
 * the grant.
 *
 * The control cases are the point. A refusal proves nothing on its own — a
 * deleted route, a typo in a path and a broken handler all refuse everybody —
 * so every route is also called by somebody who should get through, and
 * required to answer.
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

let reviewerToken: string;
let opsToken: string;
let vendorToken: string;
let orgId: string;
let documentId: string;

/** The applicant. A real org, because a 404 and a 403 must be told apart. */
const APPLICANT = '99999999-0000-4000-8000-0000000000a1';

/**
 * The reviewer, as a real row.
 *
 * `kyc_document.reviewed_by` is a foreign key into `identity.user_account`, so
 * a decision made by a token whose user does not exist is refused by the
 * database. Worth stating rather than working around: it is the constraint that
 * makes "who accepted this document" answerable, and the first version of this
 * file found it by violating it.
 */
const REVIEWER = '99999999-0000-4000-8000-0000000000c1';
const PLATFORM_ORG = '99999999-0000-4000-8000-0000000000b1';

/** A string that appears in no other row, so a leak is unambiguous. */
const SECRET_FILENAME = 'director-aadhaar-zx91.pdf';

async function issue(
  tokens: TokenService,
  userId: string,
  role: Parameters<typeof permissionsFor>[0][number],
  orgType: 'PLATFORM' | 'VENDOR',
  org: string | null,
): Promise<string> {
  const { accessToken } = await tokens.issue({
    userId,
    orgId: org,
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

  await raw.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, status, submitted_for_review_at, review_sla_due_at)
    VALUES (${APPLICANT}::uuid, 'VENDOR', 'Ambattur Recommerce Pvt. Ltd.', 'KYC_SUBMITTED',
            now() - interval '78 hours', now() - interval '30 hours')`;
  orgId = APPLICANT;

  await raw.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, status)
    VALUES (${PLATFORM_ORG}::uuid, 'INTERNAL', 'TrueTech Services Pvt. Ltd.', 'VERIFIED')`;
  await raw.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, full_name, email, status)
    VALUES (${REVIEWER}::uuid, ${PLATFORM_ORG}::uuid, 'Rohit Sharma', 'kyc@trugrade.test', 'ACTIVE')`;

  const [doc] = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO kyc.kyc_document
      (org_id, doc_type, file_key, file_hash_sha256, mime, size_bytes, status, original_filename)
    VALUES (${APPLICANT}::uuid, 'SIGNATORY_ID', 'kyc/x/signatory', repeat('a', 64),
            'application/pdf', 120000, 'UPLOADED', ${SECRET_FILENAME})
    RETURNING id`;
  documentId = doc?.id ?? '';

  await raw.$executeRaw`
    INSERT INTO kyc.verification_check
      (org_id, check_type, input_value_masked, input_hash, provider, status, attempt_no, checked_at)
    VALUES (${APPLICANT}::uuid, 'GSTIN', '33CC****88E1ZQ', repeat('b', 64), 'mock', 'PROVIDER_ERROR', 1, now())`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  const tokens = app.get(TokenService);
  reviewerToken = await issue(tokens, REVIEWER, 'KYC_REVIEWER', 'PLATFORM', null);
  opsToken = await issue(
    tokens,
    '99999999-0000-4000-8000-0000000000d1',
    'OPS_MANAGER',
    'PLATFORM',
    null,
  );
  vendorToken = await issue(
    tokens,
    '99999999-0000-4000-8000-0000000000e1',
    'VENDOR_OWNER',
    'VENDOR',
    '99999999-0000-4000-8000-0000000000f9',
  );
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

const get = (route: string, token: string) =>
  request(app.getHttpServer()).get(route).set('Authorization', `Bearer ${token}`);

describe('an applicant’s documents are not readable by everyone who can see the queue', () => {
  it('refuses OPS_MANAGER the documents — they hold the queue permission, not the document one', async () => {
    const res = await get(`/api/kyc/orgs/${orgId}/documents`, opsToken);

    expect(res.status).toBe(403);
    // The refusal itself must not leak what it refused.
    expect(JSON.stringify(res.body)).not.toContain(SECRET_FILENAME);
  });

  it('still lets OPS_MANAGER see the application, which is the half they are entitled to', async () => {
    // Without this the refusal above would pass just as well if the whole
    // controller were broken for everybody.
    const res = await get(`/api/kyc/review/${orgId}`, opsToken);
    expect(res.status).toBe(200);
    expect(res.body.legalName).toBe('Ambattur Recommerce Pvt. Ltd.');
  });

  it('the application payload carries no document, at any depth', async () => {
    const res = await get(`/api/kyc/review/${orgId}`, opsToken);
    // A sweep rather than a key check: the leak this guards against is somebody
    // adding documents to the review payload for convenience, and that would
    // not necessarily use the word "documents".
    expect(JSON.stringify(res.body)).not.toContain(SECRET_FILENAME);
    expect(JSON.stringify(res.body)).not.toContain('SIGNATORY_ID');
  });

  it('lets a KYC reviewer read them', async () => {
    const res = await get(`/api/kyc/orgs/${orgId}/documents`, reviewerToken);
    expect(res.status).toBe(200);
    expect(res.body.map((d: { originalFilename: string }) => d.originalFilename)).toContain(
      SECRET_FILENAME,
    );
  });

  it('never puts the object-store key or the file hash on the wire', async () => {
    const res = await get(`/api/kyc/orgs/${orgId}/documents`, reviewerToken);
    // Both would let a holder of a signed URL, or of a leaked bucket listing,
    // tie a file to a business. Neither is on `KycDocumentView`, and this is the
    // test that keeps them off it.
    expect(JSON.stringify(res.body)).not.toContain('kyc/x/signatory');
    expect(JSON.stringify(res.body)).not.toContain('a'.repeat(64));
  });
});

describe('a vendor is not a reviewer', () => {
  it.each([
    ['/api/kyc/review-queue'],
    [`/api/kyc/review/${'99999999-0000-4000-8000-0000000000a1'}`],
    [`/api/kyc/orgs/${'99999999-0000-4000-8000-0000000000a1'}/documents`],
  ])('refuses a vendor on %s', async (route) => {
    const res = await get(route, vendorToken);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(SECRET_FILENAME);
    expect(JSON.stringify(res.body)).not.toContain('Ambattur');
  });

  it('a vendor token carries no kyc permission at all to spend', async () => {
    const claims = await app.get(TokenService).verifyAccess(vendorToken);
    expect(claims.scope.filter((p) => p.startsWith('kyc.'))).toEqual([]);
  });
});

describe('a document decision needs a reason the applicant can act on', () => {
  it('refuses a rejection with no reason code', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/kyc/orgs/${orgId}/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ decision: 'REJECTED', specific: 'this is long enough to pass the length rule' });

    expect(res.status).toBe(422);
    // The row must be untouched: a half-applied rejection is a document the
    // applicant is told to fix with no sentence saying what.
    const [row] = await raw.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM kyc.kyc_document WHERE id = ${documentId}::uuid`;
    expect(row?.status).toBe('UPLOADED');
  });

  it('refuses a rejection whose sentence says nothing', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/kyc/orgs/${orgId}/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ decision: 'REJECTED', reasonCode: 'TOO_OLD', specific: 'no' });

    expect(res.status).toBe(422);
  });

  it('records the controlled sentence and the reviewer’s own, together, where the applicant reads it', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/kyc/orgs/${orgId}/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        decision: 'REJECTED',
        reasonCode: 'TOO_OLD',
        specific: 'Your bill is dated January 2026; we need one from the last three months.',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.rejectionReason).toBe(
      'This document is older than we can accept. Your bill is dated January 2026; we need one from the last three months.',
    );
  });

  it('refuses OPS_MANAGER the decision even though they may review applications', async () => {
    // `kyc.application.review` alone is not enough: settling a file you are not
    // cleared to look at is not a decision anybody should be able to make.
    const res = await request(app.getHttpServer())
      .post(`/api/kyc/orgs/${orgId}/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ decision: 'VERIFIED' });

    expect(res.status).toBe(403);
  });
});

describe('the queue states the promise it actually made', () => {
  it('carries the org type’s own SLA rather than one number for everybody', async () => {
    const res = await get('/api/kyc/review-queue', reviewerToken);
    expect(res.status).toBe(200);

    const row = res.body.find((r: { orgId: string }) => r.orgId === orgId);
    // 48 for a vendor. The board printed "past the 48-hour promise" over buyer
    // rows too, which overstated by a day what a buyer was owed.
    expect(row.slaHours).toBe(48);
    expect(row.slaBreached).toBe(true);
  });
});
