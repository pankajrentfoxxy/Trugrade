/**
 * Stage 3 — one honest gate instead of three.
 *
 * A buyer used to face three gates in series and could see only one of them:
 * the cart recomputed the profile's completion percentage, the profile said
 * "ordering opens once your profile is verified", and the API refused anything
 * that was not `VERIFIED`. `VERIFIED` is set by a reviewer holding
 * `kyc.application.approve` and by nothing else, so a buyer who filled every
 * field and submitted was still refused, with one line of banner text as the
 * only signal.
 *
 * The rule is now two questions, derived on the server in one place:
 *
 *   prepaid  — automatic. A verified GSTIN, a billing address, a delivery site.
 *   credit   — reviewed. Unchanged: the organisation must be VERIFIED.
 *
 * These assert against a real database because every input is a real row:
 * `kyc.gst_profile.api_verified_at`, `identity.org_address.type`, and the org's
 * own status. A mocked repository would pass whatever this file claimed.
 *
 * **This spec does not flush Redis.** The readiness rule touches none, and the
 * suites that do flush sign out every live session on the shared dev instance.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { RequestContextService, type Principal } from '../../src/shared/db/org-scope';
import { AppModule } from '../../src/app.module';
import { CheckoutService } from '../../src/modules/ordering/internal/checkout.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeOrganization, makeUser } from '../support/factories';

const NOW = new Date('2026-09-16T09:00:00.000Z');

let moduleRef: TestingModule;
let checkout: CheckoutService;
let ctx: RequestContextService;
let db: PrismaClient;

let orgId: string;
let userId: string;

const asBuyer = (): Principal => ({
  userId,
  orgId,
  orgType: 'BUYER',
  roles: ['CUSTOMER_OWNER'] as Role[],
  permissions: permissionsFor(['CUSTOMER_OWNER'] as Role[]),
  sessionId: 's',
  mfaSatisfied: true,
});

/** A GSTIN the portal actually confirmed, which is what `api_verified_at` means. */
async function giveVerifiedGstin(): Promise<void> {
  await db.$executeRaw`
    INSERT INTO kyc.gst_profile
      (id, org_id, gstin, legal_name_as_per_gst, state_code, status, api_verified_at, is_primary)
    VALUES (${randomUUID()}::uuid, ${orgId}::uuid, '06AAHCT0310N1ZG',
            'ACME TECHNOLOGIES PRIVATE LIMITED', '06', 'ACTIVE', ${NOW}, TRUE)`;
}

async function giveAddress(type: 'BILLING' | 'SHIPPING'): Promise<void> {
  await db.$executeRaw`
    INSERT INTO identity.org_address
      (id, org_id, type, line1, city, state, state_code, pincode,
       contact_name, contact_mobile, is_billing_enabled)
    VALUES (${randomUUID()}::uuid, ${orgId}::uuid, ${type}::address_type,
            'Tower B, DLF Cyber City', 'Gurugram', 'Haryana', '06', '122002',
            'Priya Nair', '+919876543210', ${type === 'BILLING'})`;
}

const setStatus = (status: string): Promise<number> =>
  db.$executeRawUnsafe(
    `UPDATE identity.organization SET status = $1::org_status WHERE id = $2::uuid`,
    status,
    orgId,
  );

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();

  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClockPort)
    .useValue(new FixedClock(NOW))
    .overrideProvider(PrismaService)
    .useFactory({
      factory: (config: AppConfig) => {
        Object.defineProperty(config, 'env', {
          value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
        });
        return new PrismaService(config);
      },
      inject: [AppConfig],
    })
    .compile();
  await moduleRef.init();

  checkout = moduleRef.get(CheckoutService);
  ctx = moduleRef.get(RequestContextService);
}, 120_000);

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedTestReference(db);
  orgId = await makeOrganization(
    { org_type: 'BUYER', legal_name: 'Acme Technologies Pvt Ltd', status: 'REGISTERED' },
    db,
  );
  userId = await makeUser(orgId, {}, db);
});

const readiness = (): ReturnType<CheckoutService['readiness']> =>
  ctx.run({ requestId: randomUUID() }, () => {
    ctx.setPrincipal(asBuyer());
    return checkout.readiness();
  });

/* ==========================================================================
 * 1. The test that matters: prepaid, with no human involved
 * ======================================================================== */

describe('a buyer we can invoice and deliver to', () => {
  it('may order prepaid without a reviewer ever touching the account', async () => {
    await giveVerifiedGstin();
    await giveAddress('BILLING');
    await giveAddress('SHIPPING');

    const ready = await readiness();

    // REGISTERED, not VERIFIED — no human has acted, and none needs to.
    expect(ready.orgStatus).toBe('REGISTERED');
    expect(ready.prepaid).toBe(true);
    expect(ready.missing).toEqual([]);
  });

  it('may not take credit terms until a human has reviewed them', async () => {
    await giveVerifiedGstin();
    await giveAddress('BILLING');
    await giveAddress('SHIPPING');

    const ready = await readiness();
    expect(ready.prepaid).toBe(true);
    expect(ready.credit).toBe(false);

    await setStatus('VERIFIED');
    const reviewed = await readiness();
    expect(reviewed.credit).toBe(true);
  });
});

/* ==========================================================================
 * 2. What is outstanding is named, one thing at a time
 * ======================================================================== */

describe('a buyer who is not ready', () => {
  it('is told exactly what is missing, and nothing that is not', async () => {
    const nothing = await readiness();
    expect(nothing.prepaid).toBe(false);
    expect(nothing.missing).toEqual(['your GSTIN', 'a billing address', 'a delivery address']);

    await giveVerifiedGstin();
    expect((await readiness()).missing).toEqual(['a billing address', 'a delivery address']);

    await giveAddress('BILLING');
    expect((await readiness()).missing).toEqual(['a delivery address']);

    await giveAddress('SHIPPING');
    expect((await readiness()).missing).toEqual([]);
  });

  it('counts only a registration the portal confirmed, which the schema guarantees', async () => {
    // `kyc.gst_profile.api_verified_at` is NOT NULL, and `promoteStatutory`
    // skips any GSTIN without a PASS behind it. So a row in this table IS a
    // confirmed registration — an unverified one cannot be written at all.
    // Attempting it is the assertion: a number somebody typed must never be
    // able to stand in for a registration an invoice is raised against.
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO kyc.gst_profile
           (org_id, gstin, legal_name_as_per_gst, state_code, status, api_verified_at, is_primary)
         VALUES ($1::uuid, '06AAHCT0310N1ZG', 'ACME TECHNOLOGIES PRIVATE LIMITED',
                 '06', 'ACTIVE', NULL, TRUE)`,
        orgId,
      ),
    ).rejects.toThrow();

    // And with no row at all, the GSTIN is what is outstanding.
    await giveAddress('BILLING');
    await giveAddress('SHIPPING');
    const ready = await readiness();
    expect(ready.prepaid).toBe(false);
    expect(ready.missing).toEqual(['your GSTIN']);
  });

  it('accepts a billing-enabled address as the billing address', async () => {
    // `promoteContactsAddresses` writes BILLING rows, but an older account may
    // carry the flag on another row instead. Both are an address we can invoice.
    await giveVerifiedGstin();
    await giveAddress('SHIPPING');
    await db.$executeRaw`
      UPDATE identity.org_address SET is_billing_enabled = TRUE WHERE org_id = ${orgId}::uuid`;
    expect((await readiness()).missing).toEqual([]);
  });
});

/* ==========================================================================
 * 3. Suspension still closes the door
 * ======================================================================== */

describe('a suspended account', () => {
  it('may not order on any terms, however complete it is', async () => {
    await giveVerifiedGstin();
    await giveAddress('BILLING');
    await giveAddress('SHIPPING');
    await setStatus('SUSPENDED');

    const ready = await readiness();
    expect(ready.suspended).toBe(true);
    expect(ready.prepaid).toBe(false);
    expect(ready.credit).toBe(false);
  });
});
