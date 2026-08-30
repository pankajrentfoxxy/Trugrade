/**
 * The ops dashboard shows you your slice, and refuses everybody else.
 *
 * WHAT THIS IS GUARDING
 * ---------------------
 * An aggregate is where a leak creeps in unnoticed. Every other read in this
 * codebase is about one org and is scoped at the repository; this one is about
 * the whole platform on purpose, so the boundary has to be somewhere else — and
 * it is in two places, both tested here by making the request rather than by
 * reading the guard:
 *
 *   1. **A vendor or a buyer may not reach it at all.** There is no permission
 *      that means "you work here", so the refusal is on `orgType`. A vendor who
 *      simply held none of the six slice permissions would otherwise get an
 *      empty dashboard with a 200 — and an empty screen is not an answer to a
 *      question that has none.
 *   2. **Platform staff see only the sections they hold the permission for.** A
 *      KYC_REVIEWER holds `kyc.application.read` and no `procurement.*`, so
 *      their payload must not carry a purchase-order count. The control case is
 *      the point of the file: an OPS_MANAGER asks for the same URL and gets it,
 *      so a section missing for the reviewer is missing because of the
 *      permission and not because the query is broken.
 *
 * AND ONE INVARIANT
 * -----------------
 * The dashboard's breach count and the review board's must agree. They are two
 * queries over the same column and T25's defect was exactly this shape — an SLA
 * measured against the database's `now()` in one place and `ClockPort` in the
 * other, differing by the app/DB skew and by two hours in that instance. If
 * these two numbers can disagree, an ops manager opens a queue of fifteen and
 * finds fourteen.
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

let opsToken: string;
let reviewerToken: string;
let riderToken: string;
let vendorToken: string;

const VENDOR_ORG = '99999999-0000-4000-8000-0000000000e1';

interface Slice {
  metrics: Array<{ key: string; value: number | null }>;
  queues: Array<{ key: string; count: number; breachedCount: number | null; slaHours: number | null }>;
  gaps: Array<{ label: string }>;
}

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

  // Two applications, one of each kind, both already past their own promise —
  // 48 working hours for the vendor, 24 for the buyer.
  await raw.$executeRaw`
    INSERT INTO identity.organization
      (org_type, legal_name, status, submitted_for_review_at, review_sla_due_at)
    VALUES
      ('VENDOR','Ambattur Recommerce Pvt. Ltd.','KYC_SUBMITTED',
       now() - interval '78 hours', now() - interval '30 hours'),
      ('BUYER','Whitefield Procurement Services Pvt. Ltd.','KYC_SUBMITTED',
       now() - interval '40 hours', now() - interval '16 hours')`;

  // And one that was never submitted: it must be counted by neither screen.
  await raw.$executeRaw`
    INSERT INTO identity.organization (org_type, legal_name, status, review_sla_due_at)
    VALUES ('VENDOR','Abandoned Halfway Pvt. Ltd.','KYC_SUBMITTED', now() - interval '400 hours')`;

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  opsToken = await issue('OPS_MANAGER', '99999999-0000-4000-8000-0000000000a1', 'PLATFORM', null);
  reviewerToken = await issue(
    'KYC_REVIEWER',
    '99999999-0000-4000-8000-0000000000b1',
    'PLATFORM',
    null,
  );
  // A RIDER holds none of the six slice permissions. CATALOG_ADMIN was the
  // obvious choice and is wrong: it holds `listing.any.read`, so it genuinely
  // gets the grade-correction queue — which is the feature working, not a leak.
  riderToken = await issue('RIDER', '99999999-0000-4000-8000-0000000000c1', 'PLATFORM', null);
  vendorToken = await issue(
    'VENDOR_OWNER',
    '99999999-0000-4000-8000-0000000000d1',
    'VENDOR',
    VENDOR_ORG,
  );
}, 180_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await raw?.$disconnect();
});

const dashboard = (token: string) =>
  request(app.getHttpServer())
    .get('/api/ops/dashboard')
    .set('Authorization', `Bearer ${token}`);

describe('the ops dashboard is not tenant-reachable', () => {
  it('refuses a vendor, rather than handing them an empty one', async () => {
    const res = await dashboard(vendorToken);

    expect(res.status).toBe(403);
    // Nothing about the platform's own work may ride along on the refusal.
    expect(JSON.stringify(res.body)).not.toMatch(/Ambattur|Whitefield|queues|metrics/);
  });

  it('still answers platform staff', async () => {
    // Without this the refusal above proves nothing: a broken route refuses
    // everybody.
    const res = await dashboard(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.queues.length).toBeGreaterThan(0);
  });
});

describe('you see your slice, and only your slice', () => {
  it('gives a KYC reviewer the application queues and no procurement anything', async () => {
    const res = await dashboard(reviewerToken);
    expect(res.status).toBe(200);

    const body = res.body as Slice;
    const keys = [...body.metrics.map((m) => m.key), ...body.queues.map((q) => q.key)];
    expect(keys).toContain('onboarding-vendor');
    expect(keys).toContain('onboarding-buyer');
    // `procurement.po.read_any` is not a KYC reviewer's permission, and a tile
    // linking to a board that will 403 is worse than no tile.
    expect(keys).not.toContain('po-unacknowledged');
    expect(keys).not.toContain('payout-runs');
    expect(keys).not.toContain('tickets');
  });

  it('gives an ops manager all of it', async () => {
    const res = await dashboard(opsToken);
    const body = res.body as Slice;
    const keys = [...body.metrics.map((m) => m.key), ...body.queues.map((q) => q.key)];

    // The same keys the reviewer was refused. If these are absent too, the
    // assertion above was passing for the wrong reason.
    expect(keys).toContain('po-unacknowledged');
    expect(keys).toContain('payout-runs');
    expect(keys).toContain('tickets');
    expect(keys).toContain('grade-corrections');
    expect(keys).toContain('qc-unstaffed');
  });

  it('gives a rider nothing but the platform-wide runway', async () => {
    const res = await dashboard(riderToken);
    expect(res.status).toBe(200);

    const body = res.body as Slice;
    expect(body.queues).toHaveLength(0);
    // The runway is our own capacity: it names no org and no person, and the
    // day it reaches zero every insert into five tables fails.
    expect(body.metrics.map((m) => m.key)).toEqual(['partition-runway']);
  });
});

describe('a queue with no promise carries no promise', () => {
  it('sends null rather than a borrowed 24 or 48', async () => {
    const res = await dashboard(opsToken);
    const unstaffed = (res.body as Slice).queues.find((q) => q.key === 'qc-unstaffed');

    // Nothing in `platform_config` commits us to a date by which a declared
    // machine is inspected. `null` renders "Breaches not measured"; `0` would
    // render "Within SLA" over a queue nobody has ever timed.
    expect(unstaffed?.slaHours).toBeNull();
    expect(unstaffed?.breachedCount).toBeNull();
  });

  it('sends the real promise where there is one, and it is not the same for both applicants', async () => {
    const queues = (await dashboard(opsToken)).body.queues as Slice['queues'];
    expect(queues.find((q) => q.key === 'onboarding-vendor')?.slaHours).toBe(48);
    expect(queues.find((q) => q.key === 'onboarding-buyer')?.slaHours).toBe(24);
  });
});

describe('the dashboard and the board it links to cannot disagree', () => {
  it('counts the same breaches the review queue counts', async () => {
    const [dash, queue] = await Promise.all([
      dashboard(reviewerToken),
      request(app.getHttpServer())
        .get('/api/kyc/review-queue')
        .set('Authorization', `Bearer ${reviewerToken}`),
    ]);

    const fromDashboard = (dash.body as Slice).queues
      .filter((q) => q.key.startsWith('onboarding-'))
      .reduce((n, q) => n + (q.breachedCount ?? 0), 0);
    const fromBoard = (queue.body as Array<{ slaBreached: boolean }>).filter(
      (r) => r.slaBreached,
    ).length;

    expect(fromDashboard).toBe(2);
    expect(fromDashboard).toBe(fromBoard);
  });

  it('leaves out the application that was never submitted, on both', async () => {
    const [dash, queue] = await Promise.all([
      dashboard(reviewerToken),
      request(app.getHttpServer())
        .get('/api/kyc/review-queue')
        .set('Authorization', `Bearer ${reviewerToken}`),
    ]);

    const counted = (dash.body as Slice).queues
      .filter((q) => q.key.startsWith('onboarding-'))
      .reduce((n, q) => n + q.count, 0);

    // Three organisations carry the status; one has no submission instant, so
    // its SLA was never made and it belongs on neither screen.
    expect(counted).toBe(2);
    expect(queue.body).toHaveLength(2);
    expect(JSON.stringify(queue.body)).not.toContain('Abandoned Halfway');
  });
});
