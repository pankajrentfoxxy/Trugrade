/**
 * The sourcing declaration and the valuation method it decides (Phase 3 Task 8).
 *
 * Two exit-criterion halves live here:
 *
 *   - `valuation_method` is set **from verified vendor GST status** — so every
 *     test below establishes the status by writing a `kyc.verification_check`
 *     row and never by passing one in, and the "no verification" case asserts a
 *     refusal rather than a default.
 *   - It **cannot be changed once `purchase_price` is set** — and the last block
 *     proves that is the database refusing, not the service. The service has no
 *     `purchase_price IS NULL` guard on purpose; if somebody adds one, the raw
 *     assertion here still fails when the trigger goes missing.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { SourcingService } from '../../src/modules/listing/internal/sourcing.service';
import { PreconditionFailedError, ValidationError } from '../../src/shared/errors/domain-errors';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import {
  makeAddress,
  makeCatalog,
  makeListing,
  makeOrganization,
  makeUser,
} from '../support/factories';
import { seedConfig } from '../../prisma/seed/reference';

const NOW = new Date('2026-08-26T06:00:00.000Z');
const VERIFIED_AT = new Date('2026-08-20T09:15:00.000Z');

let moduleRef: TestingModule;
let clock: FixedClock;
let sourcing: SourcingService;
let ctx: RequestContextService;
let raw: PrismaClient;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: (clock = new FixedClock(NOW)) },
      {
        provide: PrismaService,
        useFactory: (config: AppConfig) => {
          Object.defineProperty(config, 'env', {
            value: { ...config.all, DATABASE_URL: testDatabaseUrl() },
          });
          return new PrismaService(config);
        },
        inject: [AppConfig],
      },
      ListingRepository,
      SourcingService,
    ],
  }).compile();

  sourcing = moduleRef.get(SourcingService);
  ctx = moduleRef.get(RequestContextService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  clock.advanceTo(NOW);
  await truncateAll(raw);
  // `truncateAll` names platform_config in its keep-list, and the keep-list does
  // not survive CASCADE: platform_config.changed_by is an FK to
  // identity.user_account, so truncating that table takes the config with it.
  // Every config key is therefore gone by the first test. Put back the one this
  // service reads; the harness bug is called out in the hand-off note.
  await seedConfig(raw);
});

interface Scaffold {
  orgId: string;
  userId: string;
  listingId: string;
  unitId: string;
  serial: string;
}

/** A vendor with one listing and one unit on it. No GST verification yet. */
async function scaffold(opts: { unitPrice?: number } = {}): Promise<Scaffold> {
  const orgId = await makeOrganization({}, raw);
  const userId = await makeUser(orgId, {}, raw);
  const cat = await makeCatalog({}, raw);
  const addressId = await makeAddress(orgId, {}, raw);
  const listingId = await makeListing(
    {
      vendorOrgId: orgId,
      skuId: cat.skuId,
      pickupAddressId: addressId,
      status: 'DRAFT',
      unitPrice: opts.unitPrice ?? 42000,
    },
    raw,
  );

  const unitId = randomUUID();
  const serial = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  await raw.$executeRaw`
    INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                              grade_declared, status, location)
    VALUES (${unitId}::uuid, ${listingId}::uuid, ${orgId}::uuid, ${cat.skuId}::uuid,
            ${serial}, 'A'::grade_type, 'CREATED'::unit_status, 'VENDOR')`;

  return { orgId, userId, listingId, unitId, serial };
}

/**
 * The GSTN answer, written where the production code will find it.
 *
 * `response_summary` carries the `GstinTaxpayer` the provider returned, which is
 * the shape `kyc` records — so a fixture that drifts from it stops proving
 * anything about the real path.
 */
async function recordGstinCheck(
  orgId: string,
  opts: {
    status?: 'PASS' | 'FAIL' | 'PROVIDER_ERROR';
    gstinStatus?: string;
    taxpayerType?: string;
    gstin?: string;
    checkedAt?: Date;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const gstin = opts.gstin ?? '06ABCDE1234F1Z5';
  const summary =
    opts.status === 'FAIL'
      ? null
      : JSON.stringify({
          gstin,
          legalName: 'Alpha Systems Pvt Ltd',
          status: opts.gstinStatus ?? 'ACTIVE',
          stateCode: '06',
          taxpayerType: opts.taxpayerType ?? 'Regular',
        });

  await raw.$executeRaw`
    INSERT INTO kyc.verification_check
      (id, org_id, check_type, input_value_masked, input_hash, provider, status,
       response_summary, checked_at)
    VALUES (${id}::uuid, ${orgId}::uuid, 'GSTIN', '06AB*****1Z5', ${'hash-' + id},
            'SANDBOX', ${opts.status ?? 'PASS'}, ${summary}::jsonb,
            ${opts.checkedAt ?? VERIFIED_AT})`;
  return id;
}

/** The durable registration record, when onboarding persisted one. */
async function recordGstProfile(
  orgId: string,
  registrationType: 'REGULAR' | 'COMPOSITION',
  gstinStatus = 'ACTIVE',
): Promise<void> {
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (org_id, gstin, legal_name_as_per_gst, state_code,
                                 registration_type, status, api_verified_at, is_primary)
    VALUES (${orgId}::uuid, '06ABCDE1234F1Z5', 'Alpha Systems Pvt Ltd', '06',
            ${registrationType}, ${gstinStatus}, ${VERIFIED_AT}, TRUE)`;
}

function principal(orgId: string, userId: string): Principal {
  const roles: Role[] = ['VENDOR_OWNER'];
  return {
    userId,
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-sourcing',
  };
}

function asVendor<T>(s: Scaffold, fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test', principal: principal(s.orgId, s.userId) }, fn);
}

async function unitTax(unitId: string): Promise<{ method: string; itc: boolean }> {
  const [row] = await raw.$queryRaw<Array<{ valuation_method: string; itc_eligible: boolean }>>`
    SELECT valuation_method, itc_eligible FROM listing.unit WHERE id = ${unitId}::uuid`;
  return { method: row!.valuation_method, itc: row!.itc_eligible };
}

const BASE = {
  sourceType: 'CORPORATE_BUYBACK',
  sourceOrgName: 'Northwind Technologies Pvt Ltd',
  acquisitionInvoiceNo: 'NW/2026/00184',
  acquisitionDate: '2026-07-01',
} as const;

describe('valuation_method is derived from a verified GST status', () => {
  it('REGULAR when the vendor is registered and ITC was available', async () => {
    const s = await scaffold();
    const checkId = await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    const [declaration] = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );

    expect(declaration!.vendorGstStatus).toBe('REGULAR');
    expect(declaration!.itcAvailable).toBe(true);
    expect(declaration!.valuationMethod).toBe('REGULAR');
    // The four GST columns move together, pointing at the check that answered.
    expect(declaration!.gstVerificationCheckId).toBe(checkId);
    expect(declaration!.gstVerifiedAt).toEqual(VERIFIED_AT);
    expect(declaration!.declaredBy).toBe(s.userId);

    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'REGULAR', itc: true });
  });

  it('MARGIN when the vendor is registered but no ITC was availed (Rule 32(5))', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    const [declaration] = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }),
    );

    expect(declaration!.valuationMethod).toBe('MARGIN');
    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'MARGIN', itc: false });
  });

  it('MARGIN for an unregistered vendor — GSTN found no live registration', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId, { status: 'FAIL' });

    const [declaration] = await asVendor(s, () =>
      // Ticked, and it makes no difference: an unregistered vendor cannot have
      // availed ITC, so the declared answer is bounded by the verified status.
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );

    expect(declaration!.vendorGstStatus).toBe('UNREGISTERED');
    expect(declaration!.itcAvailable).toBe(false);
    expect(declaration!.valuationMethod).toBe('MARGIN');
    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'MARGIN', itc: false });
  });

  it('MARGIN for a composition dealer, whatever they tick', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId, { taxpayerType: 'Composition Levy' });
    await recordGstProfile(s.orgId, 'COMPOSITION');

    const [declaration] = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );

    expect(declaration!.vendorGstStatus).toBe('COMPOSITION');
    expect(declaration!.itcAvailable).toBe(false);
    expect(declaration!.valuationMethod).toBe('MARGIN');
  });

  it('UNREGISTERED when GSTN reports the registration cancelled', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId, { gstinStatus: 'CANCELLED' });

    const [declaration] = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }),
    );
    expect(declaration!.vendorGstStatus).toBe('UNREGISTERED');
  });
});

describe('a status is never defaulted', () => {
  it('refuses the declaration when no GSTN verification exists, and writes nothing', async () => {
    const s = await scaffold();

    await expect(
      asVendor(s, () =>
        sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    const [count] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM vendor.vendor_sourcing_declaration`;
    expect(Number(count!.n)).toBe(0);
    // The column default stands untouched. Nothing claimed a tax position.
    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'REGULAR', itc: true });
  });

  it('refuses when the only verification is a provider error, not a vendor answer', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId, { status: 'PROVIDER_ERROR' });

    await expect(
      asVendor(s, () =>
        sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('refuses while the registration is suspended rather than guessing', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId, { gstinStatus: 'SUSPENDED' });

    await expect(
      asVendor(s, () =>
        sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }),
      ),
    ).rejects.toThrow(/suspended/i);
  });
});

describe('the supporting document threshold', () => {
  it('requires the acquisition document above platform.sourcing_declaration_threshold_inr', async () => {
    const s = await scaffold({ unitPrice: 60000 });
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    await expect(
      asVendor(s, () =>
        sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('does not require one at or below it', async () => {
    const s = await scaffold({ unitPrice: 50000 });
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    const [declaration] = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );
    expect(declaration!.valuationMethod).toBe('REGULAR');
  });
});

describe('immutability once purchase_price is set — the trigger, not the service', () => {
  it('lets the method change while the unit is unpurchased', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );
    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'REGULAR', itc: true });

    // Same call, corrected answer. Nothing has been bought, so it lands.
    await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }),
    );
    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'MARGIN', itc: false });
  });

  it('is the database that refuses once purchase_price is set', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );

    // Phase 7 raises the PO.
    await raw.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000 WHERE id = ${s.unitId}::uuid`;

    // Direct SQL, no application code anywhere near it: the trigger is what
    // speaks. If this ever stops throwing, the control is gone whatever the
    // service does.
    await expect(
      raw.$executeRaw`
        UPDATE listing.unit SET valuation_method = 'MARGIN', itc_eligible = FALSE
         WHERE id = ${s.unitId}::uuid`,
    ).rejects.toThrow(/immutable once purchase_price is set/i);

    // And the service reaches the same wall, because it does not pre-filter
    // purchased units — it attempts the write and translates the refusal.
    const rejection = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: false }).then(
        () => null,
        (e: unknown) => e as PreconditionFailedError,
      ),
    );
    expect(rejection).toBeInstanceOf(PreconditionFailedError);
    expect(rejection!.detail).toMatchObject({ reason: 'valuation_locked_by_trigger' });

    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'REGULAR', itc: true });

    // The whole call rolled back, so no declaration claims a position the units
    // do not carry.
    const [count] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM vendor.vendor_sourcing_declaration`;
    expect(Number(count!.n)).toBe(1);
  });

  it('re-declaring the same position over purchased stock still succeeds', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );
    await raw.$executeRaw`
      UPDATE listing.unit SET purchase_price = 28000 WHERE id = ${s.unitId}::uuid`;

    await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );
    await expect(unitTax(s.unitId)).resolves.toEqual({ method: 'REGULAR', itc: true });
  });
});

describe('the declaration itself', () => {
  it('carries no price of ours anywhere in the response', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    const [declaration] = await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );
    const keys = Object.keys(declaration!);
    expect(keys).not.toContain('retailPrice');
    expect(keys).not.toContain('unitPrice');
    expect(keys).not.toContain('priceBandMedian');
  });

  it('reads back the declaration in force, latest first', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);
    await recordGstProfile(s.orgId, 'REGULAR');

    await asVendor(s, () =>
      sourcing.declare({ ...BASE, listingIds: [s.listingId], itcAvailedOnAcquisition: true }),
    );
    // Two declarations at the same instant would tie on declared_at, and which
    // one is 'in force' would then be arbitrary. A correction happens later.
    clock.advanceBy(60_000);
    await asVendor(s, () =>
      sourcing.declare({
        ...BASE,
        sourceType: 'LEASE_RETURN',
        listingIds: [s.listingId],
        itcAvailedOnAcquisition: false,
      }),
    );

    const current = await asVendor(s, () => sourcing.findForListing(s.listingId));
    expect(current!.sourceType).toBe('LEASE_RETURN');
    expect(current!.valuationMethod).toBe('MARGIN');
    expect(current!.unitsUpdated).toBe(1);
  });

  it('refuses a future acquisition date', async () => {
    const s = await scaffold();
    await recordGstinCheck(s.orgId);

    await expect(
      asVendor(s, () =>
        sourcing.declare({
          ...BASE,
          acquisitionDate: '2027-01-01',
          listingIds: [s.listingId],
          itcAvailedOnAcquisition: false,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
