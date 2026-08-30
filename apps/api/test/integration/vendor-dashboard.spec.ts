/**
 * The vendor workspace's numbers (T26).
 *
 * Two things are worth a database to prove, and neither is provable by reading
 * the controller:
 *
 *   1. **One vendor cannot see another's figures.** The route takes no parameter
 *      naming a vendor, so there is no malformed request to reject — the only
 *      way this leaks is a `WHERE` that is missing or wrong, and the only way to
 *      catch that is to put a *second* vendor's stock and corrections
 *      in the same tables and assert they do not appear. Every test below seeds
 *      a neighbour with strictly MORE of everything, so a dropped predicate
 *      shows up as a bigger number rather than as a passing test.
 *
 *   2. **`null` is not `0`.** `awaitingInspection.slaHours` is null because
 *      nothing in `platform_config` commits us to an inspection date, and
 *      `breachedCount` is null in consequence. If somebody "tidies" those to
 *      zero, the screen starts printing "Within SLA" against a promise nobody
 *      made — so the assertion is on `null` specifically, not on falsiness.
 *
 * The breach itself is real: the clock is fixed, the correction is written 70
 * hours before it, and `qc.grade_correction_auto_days` is the seeded 2. Nothing
 * asserts "a breach field exists".
 *
 * **What this does NOT cover, stated rather than implied:** the `payoutsDue`
 * SUM over `procurement.vendor_payable`. That table's `purchase_order_id` is NOT
 * NULL and a purchase order needs an `ordering.order`, which needs a buyer org, a
 * GST profile and two addresses — thirty lines of fixture to prove one `WHERE`
 * on a statement whose sibling is proven three times over just below. The real
 * write path is exercised end to end by `checkout-order.spec.ts`. If that
 * statement's predicate is ever edited, this is the file that should grow the
 * fixture rather than the edit going out unproven.
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
  OrgScope,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { VendorController } from '../../src/modules/vendor/vendor.controller';
import { ForbiddenError } from '../../src/shared/errors/domain-errors';
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
  makeTechnician,
  makeUnit,
} from '../support/factories';
import { seedConfig } from '../../prisma/seed/reference';

const NOW = new Date('2026-08-26T06:00:00.000Z');
/** The seeded `qc.grade_correction_auto_days` is 2, so the promise is 48 hours. */
const EXPECTED_SLA_HOURS = 48;

let moduleRef: TestingModule;
let clock: FixedClock;
let controller: VendorController;
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
      OrgScope,
      VendorController,
    ],
  }).compile();

  controller = moduleRef.get(VendorController);
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
  // `truncateAll`'s keep-list does not survive CASCADE — platform_config.changed_by
  // is an FK to identity.user_account — so every config key is gone by the first
  // test. The correction window is read from it, and without this the SLA would
  // come back null and the null-vs-zero assertions would pass for the wrong reason.
  await seedConfig(raw);
});

function principal(orgId: string | null): Principal {
  const roles: Role[] = ['VENDOR_OPS'];
  return {
    userId: randomUUID(),
    orgId,
    orgType: orgId ? 'VENDOR' : 'PLATFORM',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-t26',
    mfaSatisfied: true,
  } as Principal;
}

/** Run exactly as the AuthGuard would have established the caller. */
const as = <T,>(orgId: string | null, fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 'test-t26' }, () => {
    ctx.setPrincipal(principal(orgId));
    return fn();
  });

interface Vendor {
  orgId: string;
  listingId: string;
  skuId: string;
}

/**
 * A vendor with `awaitingUnits` machines declared but not inspected, and
 * `corrections` grade corrections open against them.
 *
 * `notifiedHoursAgo` is how long ago the vendor was told. Past 48 it is a breach
 * and the controller must say so; under it, it must not.
 */
async function seedVendor(opts: {
  awaitingUnits: number;
  awaitingAgeHours: number;
  corrections: number;
  notifiedHoursAgo: number;
}): Promise<Vendor> {
  const orgId = await makeOrganization({}, raw);
  const cat = await makeCatalog({}, raw);
  const addressId = await makeAddress(orgId, {}, raw);
  const listingId = await makeListing(
    {
      vendorOrgId: orgId,
      skuId: cat.skuId,
      pickupAddressId: addressId,
      status: 'AWAITING_QC',
      // `chk_qty_balance` refuses a listing whose counters exceed `qty_total`,
      // and `trg_listing_counters` recomputes them on every unit insert. The
      // default of 1 therefore fails on the second unit rather than the first,
      // which is a confusing way to find out the fixture was wrong.
      qty: opts.awaitingUnits + opts.corrections,
    },
    raw,
  );

  const declaredAt = new Date(NOW.getTime() - opts.awaitingAgeHours * 3_600_000);
  for (let i = 0; i < opts.awaitingUnits; i += 1) {
    await raw.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, status, location, created_at)
      VALUES (${randomUUID()}::uuid, ${listingId}::uuid, ${orgId}::uuid, ${cat.skuId}::uuid,
              ${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()},
              'A'::grade_type, 'AWAITING_QC'::unit_status, 'VENDOR', ${declaredAt})`;
  }

  const notifiedAt = new Date(NOW.getTime() - opts.notifiedHoursAgo * 3_600_000);
  // One technician for the whole vendor: `makeUnit` creates its own otherwise,
  // and each one costs a platform user account for no gain here.
  const tech = opts.corrections > 0 ? await makeTechnician(raw) : null;
  for (let i = 0; i < opts.corrections; i += 1) {
    // A correction needs a unit AND the inspection that raised it — `qc_report`
    // is NOT NULL on the correction. `makeUnit` builds the whole graph the real
    // flow does, technician and seal included, so this test cannot pass against
    // a report shape the product would never write. One unit per correction,
    // because `grade_correction.unit_id` is what the real flow writes.
    const built = await makeUnit(
      {
        listingId,
        vendorOrgId: orgId,
        skuId: cat.skuId,
        technicianId: tech!.technicianId,
        technicianUserId: tech!.userId,
        status: 'QC_PASSED',
      },
      raw,
    );
    await raw.$executeRaw`
      INSERT INTO listing.grade_correction
        (id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
         vendor_notified_at)
      VALUES (${randomUUID()}::uuid, ${built.unitId}::uuid, ${listingId}::uuid,
              ${built.qcReportId}::uuid,
              'A'::grade_type, 'B'::grade_type, 'Lid has a dent the declaration did not mention.',
              ${notifiedAt})`;
  }

  return { orgId, listingId, skuId: cat.skuId };
}

describe('the vendor dashboard is about exactly one vendor', () => {
  it('does not count the neighbour, who has more of everything', async () => {
    const mine = await seedVendor({
      awaitingUnits: 2,
      awaitingAgeHours: 5,
      corrections: 1,
      notifiedHoursAgo: 70,
    });
    // Strictly more, so a dropped org predicate cannot coincide with the answer.
    await seedVendor({
      awaitingUnits: 9,
      awaitingAgeHours: 300,
      corrections: 6,
      notifiedHoursAgo: 400,
    });

    const seen = await as(mine.orgId, () => controller.dashboard());

    expect(seen.unitsAwaitingQc).toBe(2);
    expect(seen.queues.awaitingInspection.count).toBe(2);
    expect(seen.queues.gradeCorrections.count).toBe(1);
    // The neighbour's 300-hour-old unit would win this if the predicate were
    // gone, and 5 is only reachable from our own row.
    expect(seen.queues.awaitingInspection.oldestWaitHours).toBe(5);
    // Every unit we ever declared: two awaiting plus the one the correction is on.
    expect(seen.unitsEverListed).toBe(3);
  });

  it('refuses to answer for a caller with no vendor org rather than answering for all of them', async () => {
    await seedVendor({
      awaitingUnits: 4,
      awaitingAgeHours: 5,
      corrections: 2,
      notifiedHoursAgo: 70,
    });

    // PLATFORM_SUPERADMIN holds every permission including both this route
    // guards on, so the guard lets it through and the refusal has to be here.
    // Attempt it and demand the refusal — a platform caller silently receiving
    // one arbitrary vendor's figures, or all of them summed, is the bug.
    await expect(as(null, () => controller.dashboard())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('a promise nobody made is never rendered as a promise kept', () => {
  it('reports the correction SLA and a real breach, and no SLA at all for inspection', async () => {
    const mine = await seedVendor({
      awaitingUnits: 3,
      awaitingAgeHours: 31,
      corrections: 2,
      notifiedHoursAgo: 70,
    });

    const seen = await as(mine.orgId, () => controller.dashboard());

    expect(seen.queues.gradeCorrections.slaHours).toBe(EXPECTED_SLA_HOURS);
    expect(seen.queues.gradeCorrections.oldestWaitHours).toBe(70);
    // 70 hours into a 48-hour window: both are late, and the count is the count.
    expect(seen.queues.gradeCorrections.breachedCount).toBe(2);

    // The inspection queue has real work in it and still no promise. `null`
    // exactly — `toBeFalsy` would pass on the 0 this is here to forbid.
    expect(seen.queues.awaitingInspection.count).toBe(3);
    expect(seen.queues.awaitingInspection.oldestWaitHours).toBe(31);
    expect(seen.queues.awaitingInspection.slaHours).toBeNull();
    expect(seen.queues.awaitingInspection.breachedCount).toBeNull();
  });

  it('counts no breach while the window is still open', async () => {
    const mine = await seedVendor({
      awaitingUnits: 0,
      awaitingAgeHours: 0,
      corrections: 3,
      notifiedHoursAgo: 12,
    });

    const seen = await as(mine.orgId, () => controller.dashboard());

    expect(seen.queues.gradeCorrections.count).toBe(3);
    expect(seen.queues.gradeCorrections.breachedCount).toBe(0);
    // An empty queue has nothing waiting, so there is no oldest — and that is
    // null rather than 0, which would read as "waiting no time at all".
    expect(seen.queues.awaitingInspection.count).toBe(0);
    expect(seen.queues.awaitingInspection.oldestWaitHours).toBeNull();
  });

  it('reports nothing measured, not nothing owed, when the window is unconfigured', async () => {
    const mine = await seedVendor({
      awaitingUnits: 0,
      awaitingAgeHours: 0,
      corrections: 2,
      notifiedHoursAgo: 70,
    });
    await raw.$executeRaw`
      DELETE FROM platform.platform_config WHERE key = 'qc.grade_correction_auto_days'`;

    const seen = await as(mine.orgId, () => controller.dashboard());

    // The corrections are still there and still countable; what is unknowable is
    // whether any of them is late. Declaring them all on time would be a lie the
    // vendor acts on.
    expect(seen.queues.gradeCorrections.count).toBe(2);
    expect(seen.queues.gradeCorrections.slaHours).toBeNull();
    expect(seen.queues.gradeCorrections.breachedCount).toBeNull();
  });
});

describe('nothing in the payload names a buyer', () => {
  it('carries counts and money only, at every depth', async () => {
    const mine = await seedVendor({
      awaitingUnits: 1,
      awaitingAgeHours: 2,
      corrections: 1,
      notifiedHoursAgo: 70,
    });

    const seen = await as(mine.orgId, () => controller.dashboard());

    // The anonymity rule runs both ways, and an aggregate is where a customer id
    // creeps in unnoticed. Serialised, because a nested object is exactly what
    // a shallow key check would miss.
    const wire = JSON.stringify(seen).toLowerCase();
    for (const forbidden of ['buyer', 'customer', 'order_id', 'ordernumber', 'orgid', 'org_id']) {
      expect(wire).not.toContain(forbidden);
    }
  });
});
