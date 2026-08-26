/**
 * Two things a reviewer's screen and a vendor's bank account depend on.
 *
 * 1. `GET /api/kyc/review/:orgId` — the payload the console screen loads. The
 *    assertion that matters is not the shape but the **null**: every one of the
 *    four RETROFIT Change 4 captures sits on a NOT NULL column with a default, so
 *    a review payload built by reading columns would tell a reviewer the vendor
 *    answered questions nobody asked them. `canDropship: false` is a real answer
 *    that puts a hub leg on every order they win; `canDropship: null` is a gap
 *    that blocks approval. Those two must never collapse into each other.
 *
 * 2. PHASE_01: "A bank-account change triggers penny-drop, a 24-hour freeze, and
 *    an owner alert." All three, and the freeze tested where it is actually
 *    enforced — against a real INSERT into `payment.payout`, because a freeze
 *    that only a service remembers to check is not a freeze.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { RedisService, RateLimiter, LockService } from '../../src/shared/redis/redis.service';
import { AdaptersModule } from '../../src/shared/adapters/adapters.module';
import { NotificationOutbox } from '../../src/shared/adapters/fakes/infra.fakes';
import { VerificationService } from '../../src/modules/kyc/internal/verification.service';
import { VendorService } from '../../src/modules/vendor';
import { closeTestDb, migrateTestDatabase, testDatabaseUrl, testDb, truncateAll } from '../support/db';
import { makeAddress, makeOrganization, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let verification: VerificationService;
let vendor: VendorService;
let outbox: NotificationOutbox;
let redis: RedisService;
let clock: FixedClock;
let raw: PrismaClient;

/**
 * Deliberately in the future.
 *
 * `changeBankAccount` stamps `frozen_until` off the injected clock, but the
 * trigger that refuses a payout compares it against the database's own `now()` —
 * as it must, since a trigger has no injected anything. A fixed clock set in the
 * past would write a freeze that had already expired by the time Postgres looked
 * at it, and every assertion here would pass for the wrong reason.
 */
const NOW = new Date('2030-01-15T06:00:00.000Z');

/** The fake penny-drop returns the expected name verbatim unless the tail says otherwise. */
const GOOD_ACCOUNT = '50100234567012';
const OWNER_MOBILE = '+919810011223';
const OWNER_EMAIL = 'owner@alphasystems.in';
const HOLDER = 'Alpha Systems Private Limited';

/** Structured coverage, as `vendorWarrantyDefault` requires it. */
const WARRANTY_SCOPE = JSON.stringify({
  covers: ['MOTHERBOARD', 'DISPLAY'],
  excludes: ['BATTERY'],
  coversAccidentalDamage: false,
  serviceMode: 'CARRY_IN',
});

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  clock = new FixedClock(NOW);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule, AdaptersModule],
    providers: [
      { provide: ClockPort, useValue: clock },
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
      RedisService,
      RateLimiter,
      LockService,
      VerificationService,
      VendorService,
    ],
  }).compile();

  await moduleRef.init();
  verification = moduleRef.get(VerificationService);
  vendor = moduleRef.get(VendorService);
  outbox = moduleRef.get(NotificationOutbox);
  redis = moduleRef.get(RedisService);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  await redis.client.flushdb();
  outbox.clear();
  clock.advanceTo(NOW);

  // `truncateAll` protects `platform_config` from TRUNCATE but not from the
  // CASCADE that reaches it through `changed_by`, and what puts it back is the
  // seed's CONFIG list — which does not know about a key inserted by a
  // migration. So the key this suite depends on is re-asserted here, at a fixed
  // `effective_from` so repeated runs collapse onto one row rather than piling up.
  await raw.$executeRaw`
    INSERT INTO platform.platform_config (key, value_json, description, effective_from)
    VALUES ('kyc.bank_change_freeze_hours', '24'::jsonb,
            'Test fixture mirroring 20260905000000_bank_change_freeze.',
            '2020-01-01T00:00:00Z'::timestamptz)
    ON CONFLICT (key, effective_from) DO NOTHING`;
});

/** A vendor org with an owner who can be reached on both channels. */
async function makeVendorWithOwner(): Promise<string> {
  const orgId = await makeOrganization({ legal_name: HOLDER }, raw);
  await raw.$executeRaw`
    INSERT INTO identity.user_account (org_id, full_name, mobile, email, status, is_org_owner)
    VALUES (${orgId}::uuid, 'Priya Sharma', ${OWNER_MOBILE}::text, ${OWNER_EMAIL}::citext,
            'ACTIVE', TRUE)`;
  return orgId;
}

// ===========================================================================
// 1. The review payload — a gap is not a "no"
// ===========================================================================

describe('vendor review captures', () => {
  it('reports every capture as null when the vendor tables are empty', async () => {
    const orgId = await makeOrganization({}, raw);

    const captures = await vendor.reviewCaptures(orgId);

    expect(captures).toEqual({
      dispatchAddress: null,
      dispatchSameAsRegistered: false,
      canDropship: null,
      dropshipConstraint: null,
      defaultWarrantyMonths: null,
      defaultWarrantyScope: null,
      pricingMode: null,
      agreedCommissionPct: null,
    });
  });

  it('keeps a captured FALSE distinct from a capture that never happened', async () => {
    const orgId = await makeOrganization({}, raw);
    // The column defaults to TRUE. A vendor who said "no" is the case that has to
    // survive the round trip, because a silent TRUE would dropship freight that
    // this vendor cannot dispatch.
    await raw.$executeRaw`
      INSERT INTO vendor.vendor_capability
        (org_id, category, monthly_capacity_units, sourcing_channels, can_dropship, is_active)
      VALUES (${orgId}::uuid, 'BUSINESS_LAPTOP', 100, ARRAY['CORPORATE_BUYBACK'], FALSE, TRUE)`;

    const captures = await vendor.reviewCaptures(orgId);

    expect(captures.canDropship).toBe(false);
    expect(captures.canDropship).not.toBeNull();
    // Nothing else was captured, and the false must not drag the others with it.
    expect(captures.pricingMode).toBeNull();
    expect(captures.defaultWarrantyMonths).toBeNull();
  });

  it('resolves the dispatch address and the commercial terms once they exist', async () => {
    const orgId = await makeOrganization({}, raw);
    const registered = await makeAddress(orgId, {}, raw);
    const dispatch = await makeAddress(orgId, { city: 'Manesar', pincode: '122051' }, raw);

    await raw.$executeRaw`
      INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type, dispatch_address_id)
      VALUES (${orgId}::uuid, ${registered}::uuid, 'WAREHOUSE', ${dispatch}::uuid)`;
    await raw.$executeRaw`
      INSERT INTO vendor.vendor_profile
        (org_id, business_category, default_warranty_months, default_warranty_scope,
         commission_rate_override)
      VALUES (${orgId}::uuid, 'REFURBISHER', 6,
              ${WARRANTY_SCOPE}::jsonb,
              12.5)`;
    await raw.$executeRaw`
      INSERT INTO vendor.vendor_payout_preference (org_id, pricing_mode)
      VALUES (${orgId}::uuid, 'COMMISSION')`;

    const captures = await vendor.reviewCaptures(orgId);

    expect(captures.dispatchAddress).toMatchObject({ city: 'Manesar', pincode: '122051' });
    expect(captures.dispatchSameAsRegistered).toBe(false);
    expect(captures.defaultWarrantyMonths).toBe(6);
    expect(captures.defaultWarrantyScope?.covers).toEqual(['MOTHERBOARD', 'DISPLAY']);
    expect(captures.pricingMode).toBe('COMMISSION');
    expect(captures.agreedCommissionPct).toBe(12.5);
  });

  it('says "same as registered" only when a facility exists to say it of', async () => {
    const orgId = await makeOrganization({}, raw);
    const registered = await makeAddress(orgId, {}, raw);
    await raw.$executeRaw`
      INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
      VALUES (${orgId}::uuid, ${registered}::uuid, 'WAREHOUSE')`;

    const captures = await vendor.reviewCaptures(orgId);

    expect(captures.dispatchSameAsRegistered).toBe(true);
    expect(captures.dispatchAddress).toBeNull();
  });
});

// ===========================================================================
// 2. Penny-drop, freeze, alert
// ===========================================================================

describe('changing a payout bank account', () => {
  it('verifies, freezes for the configured window, and alerts the owner out of band', async () => {
    const orgId = await makeVendorWithOwner();

    const result = await verification.changeBankAccount({
      orgId,
      actorUserId: await makeUser(orgId, {}, raw),
      accountNumber: GOOD_ACCOUNT,
      ifsc: 'HDFC0001234',
      accountHolderName: HOLDER,
    });

    expect(result.verification.outcome).toBe('PASS');
    expect(result.accountId).not.toBeNull();

    // 24 hours from the clock, not from wall time.
    expect(result.frozenUntil?.toISOString()).toBe('2030-01-16T06:00:00.000Z');

    const [row] = await raw.$queryRaw<
      Array<{
        frozen_until: Date | null;
        penny_drop_status: string;
        is_default: boolean;
        account_number_last4: string;
      }>
    >`
      SELECT frozen_until, penny_drop_status, is_default, account_number_last4
        FROM kyc.bank_account WHERE org_id = ${orgId}::uuid`;
    expect(row?.penny_drop_status).toBe('SUCCESS');
    expect(row?.is_default).toBe(true);
    expect(row?.account_number_last4).toBe('7012');
    expect(row?.frozen_until?.toISOString()).toBe('2030-01-16T06:00:00.000Z');

    // Both channels, which is the whole control: whichever one the attacker got
    // in through, the warning also left by the other.
    expect(result.alertedVia.sort()).toEqual(['EMAIL', 'SMS']);
    expect(outbox.forRecipient(OWNER_MOBILE)).toHaveLength(1);
    expect(outbox.forRecipient(OWNER_EMAIL)).toHaveLength(1);
    expect(outbox.last('BANK_ACCOUNT_CHANGED')?.variables).toMatchObject({
      last4: '7012',
      freezeHours: '24',
    });
  });

  it('never writes the account number in the clear', async () => {
    const orgId = await makeVendorWithOwner();
    await verification.changeBankAccount({
      orgId,
      actorUserId: await makeUser(orgId, {}, raw),
      accountNumber: GOOD_ACCOUNT,
      ifsc: 'HDFC0001234',
      accountHolderName: HOLDER,
    });

    const [row] = await raw.$queryRaw<Array<{ enc: string }>>`
      SELECT encode(account_number_enc, 'escape') AS enc
        FROM kyc.bank_account WHERE org_id = ${orgId}::uuid`;
    expect(row?.enc).not.toContain(GOOD_ACCOUNT);
  });

  it('refuses the change outright when the owner cannot be warned', async () => {
    // Not a soft failure. An org with nobody to warn is an org where a
    // redirected payout account would be silent, which is the attack.
    //
    // `chk_user_identifier` already guarantees that a user row carries a mobile
    // or an email, so the reachable gap is not a contactless owner — it is no
    // active owner at all. A deactivated founder and a staff-only org both land
    // here, and both are orgs where this change must not go through quietly.
    const orgId = await makeOrganization({ legal_name: HOLDER }, raw);

    await expect(
      verification.changeBankAccount({
        orgId,
        actorUserId: await makeUser(orgId, {}, raw),
        accountNumber: GOOD_ACCOUNT,
        ifsc: 'HDFC0001234',
        accountHolderName: HOLDER,
      }),
    ).rejects.toThrow(/warn the account owner/i);

    const [n] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM kyc.bank_account WHERE org_id = ${orgId}::uuid`;
    expect(Number(n?.n ?? 0)).toBe(0);

    // And the penny-drop was never spent on a change that could not go through.
    const [checks] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM kyc.verification_check WHERE org_id = ${orgId}::uuid`;
    expect(Number(checks?.n ?? 0)).toBe(0);
  });

  it('writes nothing and raises no alarm when the penny-drop does not pass', async () => {
    const orgId = await makeVendorWithOwner();

    // Tail 0008: the fake bank reports the account closed.
    const result = await verification.changeBankAccount({
      orgId,
      actorUserId: await makeUser(orgId, {}, raw),
      accountNumber: '50100234560008',
      ifsc: 'HDFC0001234',
      accountHolderName: HOLDER,
    });

    expect(result.verification.outcome).toBe('FAIL');
    expect(result.accountId).toBeNull();
    expect(result.frozenUntil).toBeNull();
    // Crying wolf over a change that did not happen is how the real alert stops
    // being read.
    expect(outbox.all()).toHaveLength(0);
  });

  it('demotes the previous default so a payout run never has two to choose from', async () => {
    const orgId = await makeVendorWithOwner();
    const actorUserId = await makeUser(orgId, {}, raw);
    const first = { accountNumber: GOOD_ACCOUNT, ifsc: 'HDFC0001234', accountHolderName: HOLDER };
    await verification.changeBankAccount({ orgId, actorUserId, ...first });
    await verification.changeBankAccount({
      orgId,
      actorUserId,
      accountNumber: '50100234567777',
      ifsc: 'ICIC0004321',
      accountHolderName: HOLDER,
    });

    const rows = await raw.$queryRaw<Array<{ last4: string; is_default: boolean }>>`
      SELECT account_number_last4 AS last4, is_default
        FROM kyc.bank_account WHERE org_id = ${orgId}::uuid ORDER BY created_at`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_default)).toEqual([{ last4: '7777', is_default: true }]);
  });
});

// ===========================================================================
// 3. The freeze, where it is actually enforced
// ===========================================================================

describe('the freeze blocks payment', () => {
  /** A settlement run to hang a payout off. Nothing here cares about its figures. */
  async function makeSettlementRun(): Promise<string> {
    const [row] = await raw.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payment.settlement_run (cycle_start, cycle_end, run_date)
      VALUES (CURRENT_DATE, CURRENT_DATE, CURRENT_DATE)
      RETURNING id`;
    return row!.id;
  }

  async function freshlyChangedAccount(): Promise<{ orgId: string; accountId: string }> {
    const orgId = await makeVendorWithOwner();
    const { accountId } = await verification.changeBankAccount({
      orgId,
      actorUserId: await makeUser(orgId, {}, raw),
      accountNumber: GOOD_ACCOUNT,
      ifsc: 'HDFC0001234',
      accountHolderName: HOLDER,
    });
    return { orgId, accountId: accountId! };
  }

  it('refuses a payout to an account inside its freeze window', async () => {
    const { orgId, accountId } = await freshlyChangedAccount();
    const runId = await makeSettlementRun();

    await expect(
      raw.$executeRaw`
        INSERT INTO payment.payout (settlement_run_id, vendor_org_id, bank_account_id, gross, net_amount)
        VALUES (${runId}::uuid, ${orgId}::uuid, ${accountId}::uuid, 100000, 95000)`,
    ).rejects.toThrow(/frozen until/i);
  });

  it('allows the payout once the freeze has expired', async () => {
    const { orgId, accountId } = await freshlyChangedAccount();
    const runId = await makeSettlementRun();

    // The trigger reads the database clock, so expiry is expressed the way the
    // database will see it rather than by moving the injected one.
    await raw.$executeRaw`
      UPDATE kyc.bank_account SET frozen_until = now() - interval '1 minute'
       WHERE id = ${accountId}::uuid`;

    await expect(
      raw.$executeRaw`
        INSERT INTO payment.payout (settlement_run_id, vendor_org_id, bank_account_id, gross, net_amount)
        VALUES (${runId}::uuid, ${orgId}::uuid, ${accountId}::uuid, 100000, 95000)`,
    ).resolves.toBe(1);
  });

  it('refuses to pay a payout that was raised before the account was changed', async () => {
    // The realistic takeover: a run is already sitting there PENDING, the account
    // is redirected, and the attacker only has to get it marked paid. Guarding
    // the INSERT alone would let exactly that through.
    const orgId = await makeVendorWithOwner();
    const actorUserId = await makeUser(orgId, {}, raw);
    const runId = await makeSettlementRun();

    const { accountId } = await verification.changeBankAccount({
      orgId,
      actorUserId,
      accountNumber: GOOD_ACCOUNT,
      ifsc: 'HDFC0001234',
      accountHolderName: HOLDER,
    });
    await raw.$executeRaw`
      UPDATE kyc.bank_account SET frozen_until = NULL WHERE id = ${accountId}::uuid`;

    const [payout] = await raw.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payment.payout (settlement_run_id, vendor_org_id, bank_account_id, gross, net_amount)
      VALUES (${runId}::uuid, ${orgId}::uuid, ${accountId}::uuid, 100000, 95000)
      RETURNING id`;

    // Now the account is redirected and frozen, with the payout already raised.
    await raw.$executeRaw`
      UPDATE kyc.bank_account SET frozen_until = now() + interval '24 hours'
       WHERE id = ${accountId}::uuid`;

    await expect(
      raw.$executeRaw`
        UPDATE payment.payout SET status = 'PAID', paid_at = now(), utr = 'UTR0001'
         WHERE id = ${payout!.id}::uuid`,
    ).rejects.toThrow(/frozen until/i);

    // A run must still be able to record a failure against it, though — otherwise
    // the freeze strands rows mid-run for a day for no security benefit.
    await expect(
      raw.$executeRaw`
        UPDATE payment.payout SET status = 'FAILED' WHERE id = ${payout!.id}::uuid`,
    ).resolves.toBe(1);
  });
});
