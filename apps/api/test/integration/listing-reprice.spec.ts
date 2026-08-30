import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { money, permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  OrgScope,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { ListingController } from '../../src/modules/listing/listing.controller';
import { ListingService } from '../../src/modules/listing/listing.service';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { MarginRuleRepository } from '../../src/modules/listing/internal/margin-rule.repository';
import { PricingService } from '../../src/modules/listing/internal/pricing.service';
import { SerialService } from '../../src/modules/listing/internal/serial.service';
import { SourcingService } from '../../src/modules/listing/internal/sourcing.service';
import { SubmitService } from '../../src/modules/listing/internal/submit.service';
import { PreconditionFailedError } from '../../src/shared/errors/domain-errors';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
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
  makeUser,
} from '../support/factories';

/**
 * T28 — repricing, and the two things about it that only a database can prove.
 *
 * ## 1. What we agreed to pay for a serial cannot be changed afterwards
 *
 * `unit.purchase_price` and `unit.valuation_method` are frozen once set, by
 * `trg_lock_purchase_price` and `trg_lock_valuation`. This is not a style rule:
 * `purchase_price` is what a purchase order committed to pay for one specific
 * machine, and a marketplace that can retrospectively lower what it owes is not
 * one anybody supplies twice. The valuation method decides the machine's tax
 * treatment under the margin scheme, and moving it after the invoice is a
 * different number on a filed return.
 *
 * **So the tests attempt the forbidden update and demand the refusal.** A test
 * asserting that a trigger exists proves nothing — this build has already
 * shipped an append-only guarantee enforced by a REVOKE that could not bind the
 * table owner. `pg_trigger` is not consulted anywhere below.
 *
 * ## 2. The reprice path skips those machines, and the screen can see which
 *
 * The handler updates `WHERE purchase_price IS NULL`, so a committed machine is
 * quietly left alone. "Quietly" is the defect: a vendor who reprices forty and
 * finds nine on the old number, with nothing having said so, concludes the
 * reprice half-failed. `findUnits` therefore reports `payoutLocked`, and the
 * reprice screen names those serials before the button. The test below asserts
 * both halves — the skip, and that the flag agrees with what the skip did.
 *
 * ## 3. `?corrected=1` returns the rows the vendor's dashboard counted
 *
 * The dashboard's queue counts corrections with `vendor_responded_at IS NULL AND
 * auto_applied_at IS NULL`. The board's filter used to count every correction
 * ever raised, so the queue and the board it links to had two predicates for one
 * question. They agreed only because nothing in the product can answer a
 * correction yet (T31) and the auto-apply job has never run. The test seeds one
 * of each state and demands the answered one is absent.
 */

const FIXED_NOW = new Date('2026-08-26T06:00:00.000Z');
const VENDOR = '22222222-0000-4000-8000-0000000000d1';
/** A second vendor with more of everything, so a dropped predicate reads as a bigger number. */
const NEIGHBOUR = '22222222-0000-4000-8000-0000000000d2';

let moduleRef: TestingModule;
let controller: ListingController;
let listings: ListingRepository;
let ctx: RequestContextService;
let db: PrismaClient;
let vendorUserId: string;
let skuId: string;
let addressId: string;

function principal(orgId: string, userId: string): Principal {
  const roles: Role[] = ['VENDOR_OWNER'];
  return {
    userId,
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  };
}

const asVendor = <T,>(fn: () => Promise<T>, orgId = VENDOR): Promise<T> =>
  ctx.run({ requestId: 't28' }, () => {
    ctx.setPrincipal(principal(orgId, vendorUserId));
    return fn();
  });

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(FIXED_NOW) },
      PrismaService,
      OrgScope,
      ListingRepository,
      MarginRuleRepository,
      PricingService,
      SerialService,
      ListingService,
      // Neither is reached by any handler under test. Stubbed rather than wired
      // because SubmitService pulls a QC port, an event bus and the stock-movement
      // service behind it, and nothing that graph does is being asserted here.
      { provide: SubmitService, useValue: {} },
      { provide: SourcingService, useValue: {} },
      ListingController,
    ],
  }).compile();
  await moduleRef.init();
  controller = moduleRef.get(ListingController);
  listings = moduleRef.get(ListingRepository);
  ctx = moduleRef.get(RequestContextService);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await makeOrganization({ id: VENDOR }, db);
  await makeOrganization({ id: NEIGHBOUR, legal_name: 'Neighbour Assets' }, db);
  vendorUserId = await makeUser(VENDOR, {}, db);
  const cat = await makeCatalog({}, db);
  skuId = cat.skuId;
  addressId = await makeAddress(VENDOR, {}, db);
});

/** A listing with `open` repriceable machines and `committed` frozen ones. */
async function seedListing(opts: {
  open: number;
  committed: number;
  ask?: number;
  orgId?: string;
}): Promise<{ listingId: string; openSerials: string[]; committedSerials: string[] }> {
  const orgId = opts.orgId ?? VENDOR;
  const listingId = await makeListing(
    { vendorOrgId: orgId, skuId, pickupAddressId: addressId, qty: opts.open + opts.committed },
    db,
  );
  const ask = opts.ask ?? 40000;
  const openSerials: string[] = [];
  const committedSerials: string[] = [];

  for (let i = 0; i < opts.open + opts.committed; i += 1) {
    const committed = i >= opts.open;
    const serial = `T28${committed ? 'C' : 'O'}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    // `valuation_method` is NOT NULL with a default, and BOTH triggers key off
    // `purchase_price IS NOT NULL` rather than off it — so a committed machine is
    // one with a purchase price, and the method becomes immutable at that instant
    // rather than at the instant it was written. `chk_unit_margin_no_itc` is why
    // `itc_eligible` follows the method: no input tax credit on a margin-scheme
    // purchase, which is the whole point of the scheme.
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, status, location, vendor_ask_price,
                                purchase_price, valuation_method, itc_eligible)
      VALUES (${randomUUID()}::uuid, ${listingId}::uuid, ${orgId}::uuid, ${skuId}::uuid,
              ${serial}, 'A'::grade_type, 'CREATED'::unit_status, 'VENDOR', ${ask},
              ${committed ? ask : null}, ${committed ? 'MARGIN' : 'REGULAR'},
              ${!committed})`;
    (committed ? committedSerials : openSerials).push(serial);
  }
  return { listingId, openSerials, committedSerials };
}

const askOf = async (serial: string): Promise<string> => {
  const [row] = await db.$queryRaw<Array<{ p: string | null; v: string | null }>>`
    SELECT vendor_ask_price::text AS p, purchase_price::text AS v
      FROM listing.unit WHERE serial_number = ${serial}`;
  return row!.p!;
};

describe('what we agreed to pay for a serial is frozen', () => {
  it('refuses to change purchase_price on a machine that already has one', async () => {
    const { committedSerials } = await seedListing({ open: 0, committed: 1 });

    // The forbidden thing, attempted directly against the table. No REVOKE could
    // stop this — the connection owns the schema — so if the trigger is missing
    // or wrong, this UPDATE simply succeeds and the test fails.
    await expect(
      db.$executeRaw`
        UPDATE listing.unit SET purchase_price = 1
         WHERE serial_number = ${committedSerials[0]!}`,
    ).rejects.toThrow();

    const [after] = await db.$queryRaw<Array<{ p: string }>>`
      SELECT purchase_price::text AS p FROM listing.unit
       WHERE serial_number = ${committedSerials[0]!}`;
    expect(after!.p).toBe('40000.00');
  });

  it('refuses to change valuation_method once it is set', async () => {
    const { committedSerials } = await seedListing({ open: 0, committed: 1 });

    await expect(
      db.$executeRaw`
        UPDATE listing.unit SET valuation_method = 'REGULAR'
         WHERE serial_number = ${committedSerials[0]!}`,
    ).rejects.toThrow();

    const [after] = await db.$queryRaw<Array<{ v: string }>>`
      SELECT valuation_method::text AS v FROM listing.unit
       WHERE serial_number = ${committedSerials[0]!}`;
    expect(after!.v).toBe('MARGIN');
  });
});

describe('repricing a listing that is partly committed', () => {
  it('moves the open machines, leaves the committed ones, and says which is which', async () => {
    const { listingId, openSerials, committedSerials } = await seedListing({
      open: 2,
      committed: 3,
    });

    // The screen reads this BEFORE the button. If it disagreed with what the
    // update actually does, the vendor would be told the wrong thing.
    const before = await asVendor(() => listings.findUnits(listingId));
    expect(before.filter((u) => u.payoutLocked).map((u) => u.serialNumber).sort()).toEqual(
      [...committedSerials].sort(),
    );
    expect(before.filter((u) => !u.payoutLocked).map((u) => u.serialNumber).sort()).toEqual(
      [...openSerials].sort(),
    );

    await asVendor(() =>
      controller.reprice(listingId, { vendorNetPayout: money('51000'), reason: 'Market moved' }),
    );

    for (const s of openSerials) expect(await askOf(s)).toBe('51000.00');
    // Not "close to" the old number — exactly it. A committed machine keeps the
    // payout its purchase order agreed to, whichever way the new one moves.
    for (const s of committedSerials) expect(await askOf(s)).toBe('40000.00');
  });

  it('refuses, in the vendor’s language, when every machine is committed', async () => {
    const { listingId, committedSerials } = await seedListing({ open: 0, committed: 2 });

    await expect(
      asVendor(() =>
        controller.reprice(listingId, { vendorNetPayout: money('51000'), reason: 'Market moved' }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    // Nothing moved, and in particular nothing moved *partially* — a refusal that
    // had already written half the units would be worse than one that wrote none.
    for (const s of committedSerials) expect(await askOf(s)).toBe('40000.00');
  });

  it('will not reprice another vendor’s listing, even one that is wide open', async () => {
    const { listingId, openSerials } = await seedListing({
      open: 2,
      committed: 0,
      orgId: NEIGHBOUR,
    });

    // Scoped at the repository layer, so there is no parameter to reject: the
    // only way this leaks is a missing predicate, and the only way to catch that
    // is to aim a real call at a real neighbour's row.
    await expect(
      asVendor(() =>
        controller.reprice(listingId, { vendorNetPayout: money('51000'), reason: 'Not mine' }),
      ),
    ).rejects.toBeInstanceOf(PreconditionFailedError);

    for (const s of openSerials) expect(await askOf(s)).toBe('40000.00');
  });
});

describe('the corrections filter the dashboard links to', () => {
  it('returns the listings with a correction still waiting, and not the answered ones', async () => {
    const tech = await makeTechnician(db);
    const open = await makeListing(
      { vendorOrgId: VENDOR, skuId, pickupAddressId: addressId, qty: 1 },
      db,
    );
    const answered = await makeListing(
      { vendorOrgId: VENDOR, skuId, pickupAddressId: addressId, qty: 1 },
      db,
    );
    const untouched = await makeListing(
      { vendorOrgId: VENDOR, skuId, pickupAddressId: addressId, qty: 1 },
      db,
    );

    for (const [listingId, respondedAt] of [
      [open, null],
      [answered, FIXED_NOW],
    ] as const) {
      const built = await makeUnit(
        {
          listingId,
          vendorOrgId: VENDOR,
          skuId,
          technicianId: tech.technicianId,
          technicianUserId: tech.userId,
          status: 'QC_PASSED',
        },
        db,
      );
      await db.$executeRaw`
        INSERT INTO listing.grade_correction
          (id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
           vendor_notified_at, vendor_responded_at)
        VALUES (${randomUUID()}::uuid, ${built.unitId}::uuid, ${listingId}::uuid,
                ${built.qcReportId}::uuid, 'A'::grade_type, 'B'::grade_type,
                'Lid has a dent the declaration did not mention.',
                ${FIXED_NOW}, ${respondedAt})`;
    }

    const filtered = await asVendor(() =>
      listings.findByVendor({ corrected: true }, { page: 1, pageSize: 50 }),
    );
    const ids = filtered.rows.map((r) => r.id);

    expect(ids).toContain(open);
    // The two halves of the same bug. `answered` has a correction and must not
    // appear; `untouched` never had one.
    expect(ids).not.toContain(answered);
    expect(ids).not.toContain(untouched);
    // `total` is what the board's caption prints, so it has to agree with the rows.
    expect(filtered.total).toBe(1);
  });
});
