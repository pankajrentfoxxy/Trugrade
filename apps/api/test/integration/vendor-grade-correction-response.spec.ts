import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { money, permissionsFor, type Role } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { ConfigModule } from '../../src/shared/config';
import { EventBus } from '../../src/shared/events/event-bus';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  OrgScope,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { NotFoundError } from '../../src/shared/errors/domain-errors';
import { QcRepository } from '../../src/modules/qc/internal/qc.repository';
import { GradeCorrectionService } from '../../src/modules/qc/internal/grade-correction.service';
import { VendorCorrectionRepository } from '../../src/modules/qc/internal/vendor-correction.repository';
import { VendorCorrectionsController } from '../../src/modules/qc/vendor-corrections.controller';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { VendorController } from '../../src/modules/vendor/vendor.controller';
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
 * T31 — a vendor can answer a grade correction, and only their own.
 *
 * ## What was broken
 *
 * `GradeCorrectionService.respond()` implemented all four answers transactionally
 * and **no controller exposed it**, so `listing.grade_correction.respond` was
 * granted to three vendor roles and guarded nothing. Every correction ever raised
 * ran out its two days and auto-applied. The reachability gap is the bug, so the
 * first test here is simply that the answer lands and moves the machine.
 *
 * ## Why the refusal tests attempt the forbidden thing
 *
 * The console's own queue leaked every vendor's serials for weeks while a test
 * asserting that no vendor role holds a `*.any.*` permission passed the entire
 * time — the leaking grant was called `qc.report.read`. A test keyed on a naming
 * convention only catches mistakes that remember to be named badly, so none of
 * the assertions below reads a grant. They call the route as the wrong vendor and
 * demand the refusal, then read the neighbour's row back out of the database to
 * prove nothing moved.
 *
 * The control case is half the evidence: the identical call is made by the OWNER
 * and required to succeed. A 404 for everybody would satisfy the refusal on its
 * own, and would also be what a deleted route looks like.
 *
 * ## The queue and the board have to keep agreeing
 *
 * `/api/vendor/dashboard` counts corrections with `vendor_responded_at IS NULL AND
 * auto_applied_at IS NULL`; the listings board's `?corrected=1` filters on the
 * same predicate. They agreed before this task only because nothing could answer
 * a correction. The last test answers one of two and demands BOTH numbers drop to
 * one — the disagreement this task was warned it could reintroduce.
 */

/** Fixed TIME, tracking DATE: a date literal here is a time bomb (04_TEST_PLAN). */
const FIXED_NOW = new Date(`${new Date().toISOString().slice(0, 10)}T06:00:00.000Z`);
const VENDOR = '33333333-0000-4000-8000-0000000000e1';
const NEIGHBOUR = '33333333-0000-4000-8000-0000000000e2';

let moduleRef: TestingModule;
let corrections: VendorCorrectionsController;
let listings: ListingRepository;
let vendorApi: VendorController;
let ctx: RequestContextService;
let db: PrismaClient;
let vendorUserId: string;
let neighbourUserId: string;
let skuId: string;
let addressId: string;
let neighbourAddressId: string;

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

const asVendor = <T,>(fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 't31' }, () => {
    ctx.setPrincipal(principal(VENDOR, vendorUserId));
    return fn();
  });

const asNeighbour = <T,>(fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 't31n' }, () => {
    ctx.setPrincipal(principal(NEIGHBOUR, neighbourUserId));
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
      EventBus,
      QcRepository,
      GradeCorrectionService,
      VendorCorrectionRepository,
      VendorCorrectionsController,
      ListingRepository,
      VendorController,
    ],
  }).compile();
  await moduleRef.init();
  corrections = moduleRef.get(VendorCorrectionsController);
  listings = moduleRef.get(ListingRepository);
  vendorApi = moduleRef.get(VendorController);
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
  neighbourUserId = await makeUser(NEIGHBOUR, { email: 'ops@neighbour.example' }, db);
  const cat = await makeCatalog({}, db);
  skuId = cat.skuId;
  addressId = await makeAddress(VENDOR, {}, db);
  neighbourAddressId = await makeAddress(NEIGHBOUR, {}, db);
});

/** One listing, one inspected machine, one open correction A → B on it. */
async function seedCorrection(
  orgId: string = VENDOR,
): Promise<{ correctionId: string; listingId: string; unitId: string; serial: string }> {
  const tech = await makeTechnician(db);
  const listingId = await makeListing(
    {
      vendorOrgId: orgId,
      skuId,
      pickupAddressId: orgId === VENDOR ? addressId : neighbourAddressId,
      qty: 1,
    },
    db,
  );
  const built = await makeUnit(
    {
      listingId,
      vendorOrgId: orgId,
      skuId,
      technicianId: tech.technicianId,
      technicianUserId: tech.userId,
      status: 'QC_MISMATCH',
    },
    db,
  );
  // The verdict has to be MISMATCH for `applyCorrectedGrade` to release the
  // machine; `makeUnit` writes a PASS report, which is a different story about
  // the same unit and would leave it where it was.
  await db.$executeRaw`
    UPDATE qc.qc_report SET verdict = 'MISMATCH'::qc_verdict WHERE id = ${built.qcReportId!}::uuid`;
  await db.$executeRaw`
    UPDATE listing.unit SET vendor_ask_price = 40000 WHERE id = ${built.unitId}::uuid`;

  const correctionId = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.grade_correction
      (id, unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason,
       price_before, vendor_notified_at)
    VALUES (${correctionId}::uuid, ${built.unitId}::uuid, ${listingId}::uuid,
            ${built.qcReportId!}::uuid, 'A'::grade_type, 'B'::grade_type,
            'The lid has a dent the declaration did not mention.',
            40000, ${FIXED_NOW})`;

  return { correctionId, listingId, unitId: built.unitId, serial: built.serial };
}

const correctionRow = async (
  id: string,
): Promise<{ response: string | null; responded: Date | null }> => {
  const [row] = await db.$queryRaw<Array<{ vendor_response: string | null; at: Date | null }>>`
    SELECT vendor_response, vendor_responded_at AS at
      FROM listing.grade_correction WHERE id = ${id}::uuid`;
  return { response: row!.vendor_response, responded: row!.at };
};

const gradeOf = async (unitId: string): Promise<string | null> => {
  const [row] = await db.$queryRaw<Array<{ g: string | null; s: string; ask: string | null }>>`
    SELECT grade_actual::text AS g, status::text AS s, vendor_ask_price::text AS ask
      FROM listing.unit WHERE id = ${unitId}::uuid`;
  return row!.g;
};

describe('a vendor can finally answer a correction', () => {
  it('accepts the corrected grade, and the machine moves', async () => {
    const { correctionId, unitId } = await seedCorrection();

    const answered = await asVendor(() =>
      corrections.respond(correctionId, { response: 'ACCEPT_NEW_GRADE' }),
    );

    expect(answered.vendorResponse).toBe('ACCEPT_NEW_GRADE');
    expect(answered.vendorRespondedAt).not.toBeNull();
    // The row, not the DTO. A response recorded without its consequence is a
    // machine that stays blocked under a record saying it was settled.
    expect((await correctionRow(correctionId)).response).toBe('ACCEPT_NEW_GRADE');
    expect(await gradeOf(unitId)).toBe('B');
  });

  it('accepts at a new price, and the ask the vendor named is what is stored', async () => {
    const { correctionId, unitId } = await seedCorrection();

    await asVendor(() =>
      corrections.respond(correctionId, {
        response: 'ACCEPT_AND_REPRICE',
        // `moneySchema` has already parsed the decimal STRING off the wire by
        // this point; a JSON number is refused there and never reaches here.
        vendorAskPrice: money('36500'),
      }),
    );

    const [row] = await db.$queryRaw<Array<{ ask: string }>>`
      SELECT vendor_ask_price::text AS ask FROM listing.unit WHERE id = ${unitId}::uuid`;
    expect(row!.ask).toBe('36500.00');
    expect(await gradeOf(unitId)).toBe('B');
  });

  it('disputes it, and opens the re-verification a QC manager rules on', async () => {
    const { correctionId, unitId } = await seedCorrection();

    await asVendor(() =>
      corrections.respond(correctionId, {
        response: 'DISPUTE',
        note: 'That dent is on the box, not the lid.',
      }),
    );

    const [rev] = await db.$queryRaw<Array<{ trigger: string; notes: string | null }>>`
      SELECT "trigger"::text AS trigger, notes FROM qc.qc_reverification
       WHERE unit_id = ${unitId}::uuid`;
    expect(rev?.trigger).toBe('VENDOR_REQUEST');
    expect(rev?.notes).toContain('box');
    // Disputing must not re-grade the machine while it is being argued about.
    expect(await gradeOf(unitId)).toBe('A');
  });

  it('refuses a second answer on a correction that is already settled', async () => {
    const { correctionId } = await seedCorrection();
    await asVendor(() => corrections.respond(correctionId, { response: 'ACCEPT_NEW_GRADE' }));

    await expect(
      asVendor(() => corrections.respond(correctionId, { response: 'DISPUTE' })),
    ).rejects.toThrow(/already been settled/i);
    expect((await correctionRow(correctionId)).response).toBe('ACCEPT_NEW_GRADE');
  });
});

describe("a vendor cannot touch another vendor's correction", () => {
  it('refuses the answer, and the neighbour’s correction is untouched', async () => {
    const mine = await seedCorrection(VENDOR);
    const theirs = await seedCorrection(NEIGHBOUR);

    // The forbidden thing, attempted. Not "assert the guard exists".
    await expect(
      asVendor(() => corrections.respond(theirs.correctionId, { response: 'ACCEPT_NEW_GRADE' })),
    ).rejects.toBeInstanceOf(NotFoundError);

    const after = await correctionRow(theirs.correctionId);
    expect(after.response).toBeNull();
    expect(after.responded).toBeNull();
    expect(await gradeOf(theirs.unitId)).toBe('A');

    // The control case. Without it the refusal above would also pass against a
    // route that is broken for everybody.
    const ok = await asVendor(() =>
      corrections.respond(mine.correctionId, { response: 'ACCEPT_NEW_GRADE' }),
    );
    expect(ok.vendorResponse).toBe('ACCEPT_NEW_GRADE');

    // And it is not a one-way door: the neighbour can still answer their own.
    const theirsOk = await asNeighbour(() =>
      corrections.respond(theirs.correctionId, { response: 'WITHDRAW_UNIT' }),
    );
    expect(theirsOk.vendorResponse).toBe('WITHDRAW_UNIT');
  });

  it('does not let a vendor read it either, by id or in the list', async () => {
    const mine = await seedCorrection(VENDOR);
    const theirs = await seedCorrection(NEIGHBOUR);

    await expect(asVendor(() => corrections.one(theirs.correctionId))).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const list = await asVendor(() => corrections.list());
    expect(list.map((c) => c.id)).toEqual([mine.correctionId]);
    // The serial is the fact that leaked last time. It must not be reachable at
    // any depth of the payload the vendor CAN read.
    expect(JSON.stringify(list)).not.toContain(theirs.serial);
  });

  it('answers nothing at all without an org in context', async () => {
    const mine = await seedCorrection(VENDOR);
    // Platform staff have no org. "Your corrections" has no answer without a
    // vendor, and PLATFORM_SUPERADMIN holds every permission — so the guard
    // cannot be what stops this.
    await expect(
      ctx.run({ requestId: 't31p' }, () => {
        ctx.setPrincipal({
          userId: vendorUserId,
          orgId: null,
          orgType: 'PLATFORM',
          roles: ['PLATFORM_SUPERADMIN'],
          permissions: permissionsFor(['PLATFORM_SUPERADMIN']),
          sessionId: 's',
          mfaSatisfied: true,
        });
        return corrections.respond(mine.correctionId, { response: 'ACCEPT_NEW_GRADE' });
      }),
    ).rejects.toThrow(/one vendor/i);
    expect((await correctionRow(mine.correctionId)).response).toBeNull();
  });
});

describe('the dashboard queue and the ?corrected=1 board still agree', () => {
  it('both drop by one when a correction is answered', async () => {
    const first = await seedCorrection(VENDOR);
    const second = await seedCorrection(VENDOR);

    const before = await asVendor(() => vendorApi.dashboard());
    const boardBefore = await asVendor(() =>
      listings.findByVendor({ corrected: true }, { page: 1, pageSize: 50 }),
    );
    expect(before.queues.gradeCorrections.count).toBe(2);
    expect(boardBefore.total).toBe(2);

    await asVendor(() => corrections.respond(first.correctionId, { response: 'ACCEPT_NEW_GRADE' }));

    const after = await asVendor(() => vendorApi.dashboard());
    const boardAfter = await asVendor(() =>
      listings.findByVendor({ corrected: true }, { page: 1, pageSize: 50 }),
    );

    // One number, two screens. A queue that says "1 needs you" over a board of
    // two is the defect this pair of assertions exists to catch.
    expect(after.queues.gradeCorrections.count).toBe(1);
    expect(boardAfter.total).toBe(1);
    expect(boardAfter.rows.map((r) => r.id)).toEqual([second.listingId]);

    // And the vendor's own corrections board reads the same predicate.
    const open = (await asVendor(() => corrections.list())).filter(
      (c) => c.vendorResponse === null && c.autoAppliedAt === null,
    );
    expect(open.map((c) => c.id)).toEqual([second.correctionId]);
  });
});
