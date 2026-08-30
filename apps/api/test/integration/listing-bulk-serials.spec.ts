import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { permissionsFor, type Role } from '@trugrade/contracts';
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
  makeUser,
} from '../support/factories';

/**
 * T29 — the dry run's promise, and the commit keeping it.
 *
 * ## The assertion this whole file exists for
 *
 * **A row reported as accepted must not be rejected by the commit, and the count
 * the dry run promises must be the count that results.** Every test below runs
 * the dry run and then the commit over the SAME bytes and compares the two
 * numbers. That is not a test of the parser — the parser is tested in
 * `packages/contracts` — it is a test that the two halves of this screen are
 * describing one operation.
 *
 * Three divergences existed and each rejected the ENTIRE file at commit time
 * while the report announced hundreds of happy rows:
 *
 *   1. `willAdd` counted only rows with no issue, while the commit was handed
 *      the accepted set, which includes warned rows. The promise was short by
 *      exactly the number of warnings.
 *   2. `ListingService.addUnits` refuses a listing that is not a DRAFT.
 *   3. It refuses the whole batch when it would take the listing past
 *      `LISTING_QTY.max`.
 *
 * The dry run knew about none of them, because it did not know the listing. It
 * does now, through `POST /listings/:id/serials/validate-csv`, and the tests are
 * written as "promise, then commit, then compare" rather than as assertions
 * about either half on its own.
 *
 * ## And the line numbers are the vendor's own
 *
 * `parseCsv` returns blank rows rather than filtering them, because callers
 * number rows by position and dropping one shifts every number after it. A
 * vendor told "line 47" opens line 47: if we are one row out they fix a line
 * that was fine and the real one stays broken, which is worse than saying
 * nothing because it is confidently wrong. One test below puts blank lines
 * ABOVE the bad rows and demands the reported numbers match the file.
 */

const FIXED_NOW = new Date(`${new Date().toISOString().slice(0, 10)}T06:00:00.000Z`);
const VENDOR = '44444444-0000-4000-8000-0000000000f1';
const NEIGHBOUR = '44444444-0000-4000-8000-0000000000f2';

let moduleRef: TestingModule;
let controller: ListingController;
let ctx: RequestContextService;
let db: PrismaClient;
let vendorUserId: string;
let skuId: string;
let addressId: string;
let neighbourAddressId: string;

function principal(orgId: string): Principal {
  const roles: Role[] = ['VENDOR_OWNER'];
  return {
    userId: vendorUserId,
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  };
}

const asVendor = <T,>(fn: () => Promise<T>, orgId = VENDOR): Promise<T> =>
  ctx.run({ requestId: 't29' }, () => {
    ctx.setPrincipal(principal(orgId));
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
      // Neither is reached by the handlers under test; both drag a QC port, an
      // event bus and the stock-movement service behind them.
      { provide: SubmitService, useValue: {} },
      { provide: SourcingService, useValue: {} },
      ListingController,
    ],
  }).compile();
  await moduleRef.init();
  controller = moduleRef.get(ListingController);
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
  neighbourAddressId = await makeAddress(NEIGHBOUR, {}, db);
});

const draft = (qty = 0, orgId = VENDOR): Promise<string> =>
  makeListing(
    {
      vendorOrgId: orgId,
      skuId,
      pickupAddressId: orgId === VENDOR ? addressId : neighbourAddressId,
      qty,
      status: 'DRAFT',
    },
    db,
  );

/** A serial nobody will mistake for another. Uppercase alnum, VR-076's band. */
const serial = (n: number): string => `T29${String(n).padStart(4, '0')}XZ`;

const unitCount = async (listingId: string): Promise<number> => {
  const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
  return Number(row!.n);
};

/**
 * Run the dry run, commit exactly what it accepted, and hand back both.
 *
 * Nothing between the two calls, deliberately: the whole claim is that the
 * second is predicted by the first, and any adjustment here would be the screen
 * quietly correcting a report the vendor has already read.
 */
async function dryRunThenCommit(
  listingId: string,
  csv: string,
): Promise<{
  report: Awaited<ReturnType<ListingController['validateSerialsCsvForListing']>>;
  added: number;
}> {
  const report = await asVendor(() => controller.validateSerialsCsvForListing(listingId, { csv }));
  const accepted = report.rows.filter((r) => r.outcome !== 'ERROR').map((r) => r.serial);
  if (accepted.length === 0) return { report, added: 0 };
  const outcome = await asVendor(() => controller.addUnits(listingId, { serials: accepted }));
  return { report, added: outcome.added.length };
}
describe('the dry run promises what the commit delivers', () => {
  it('on a clean file', async () => {
    const listingId = await draft();
    const csv = ['serial_number', serial(1), serial(2), serial(3)].join('\n');

    const { report, added } = await dryRunThenCommit(listingId, csv);

    expect(report.willAdd).toBe(3);
    expect(report.errors).toBe(0);
    expect(added).toBe(report.willAdd);
    expect(await unitCount(listingId)).toBe(report.willAdd);
  });

  it('on a file that is partly bad, and the counts still add up', async () => {
    const listingId = await draft();
    // Live on somebody else's listing, so it is a real global-uniqueness error
    // rather than one this file could have detected on its own.
    const taken = serial(90);
    const otherListing = await draft(1, NEIGHBOUR);
    await db.$executeRaw`
      INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, status, location)
      VALUES (${randomUUID()}::uuid, ${otherListing}::uuid, ${NEIGHBOUR}::uuid, ${skuId}::uuid,
              ${taken}, 'A'::grade_type, 'LISTED'::unit_status, 'VENDOR')`;

    const csv = [
      'serial_number', // 1
      serial(1), //       2  good
      serial(2), //       3  good
      serial(1), //       4  duplicate of line 2
      '', //              5  blank — skipped, and shifts nothing after it
      taken, //           6  live on another listing
      'no', //            7  too short for VR-076
      serial(3), //       8  good
    ].join('\n');

    const { report, added } = await dryRunThenCommit(listingId, csv);

    // The invariant. Not "roughly": every row is in exactly one bucket, and
    // `willAdd` is what the commit gets.
    expect(report.willAdd + report.errors).toBe(report.rows.length);
    expect(report.willAdd).toBe(3);
    // Three errors, not four: line 5 is BLANK and a blank line is not a bad row.
    // It is skipped without renumbering anything, which the line numbers below
    // are what actually prove.
    expect(report.errors).toBe(3);
    expect(report.rows.map((r) => r.lineNumber)).toEqual([2, 3, 4, 6, 7, 8]);

    // The duplicate message names the line in the VENDOR'S file, not the index
    // of the serial in the batch. `validateSerialBatch` is shared with the paste
    // box, where those are the same number; here they are not, and the message
    // used to say "Duplicate of line 1" — the header.
    const duplicate = report.rows.find((r) => r.lineNumber === 4);
    expect(duplicate?.reason).toContain('Duplicate of line 2');

    // The point of the whole file.
    expect(added).toBe(report.willAdd);
    expect(await unitCount(listingId)).toBe(report.willAdd);

    // And the error report the vendor downloads carries the same three rows.
    const errorLines = report.errorReportCsv.trim().split('\n').slice(1);
    expect(errorLines).toHaveLength(report.errors);
  });

  it('counts a warned row as one that WILL be added, because it will be', async () => {
    const listingId = await draft();
    // `brandName` drives the warn-only shape check. A serial that does not look
    // like a Dell serial is a worn label, not a refusal — and the promise has to
    // include it, because the commit does.
    const csv = ['serial_number', 'ZZQQ7781', 'ZZQQ7782'].join('\n');

    const report = await asVendor(() =>
      controller.validateSerialsCsvForListing(listingId, { csv, brandName: 'Dell' }),
    );

    // Whatever the shape check decided, these two facts must hold together.
    expect(report.warnings).toBeLessThanOrEqual(report.willAdd);
    expect(report.willAdd + report.errors).toBe(report.rows.length);

    const accepted = report.rows.filter((r) => r.outcome !== 'ERROR').map((r) => r.serial);
    expect(accepted).toHaveLength(report.willAdd);

    const outcome = await asVendor(() => controller.addUnits(listingId, { serials: accepted }));
    expect(outcome.added).toHaveLength(report.willAdd);
  });
});

describe('the two refusals that used to reject the whole file after it was promised', () => {
  it('says the listing is past drafting instead of promising rows it cannot write', async () => {
    const active = await makeListing(
      { vendorOrgId: VENDOR, skuId, pickupAddressId: addressId, qty: 0, status: 'ACTIVE' },
      db,
    );
    const csv = ['serial_number', serial(1), serial(2)].join('\n');

    const report = await asVendor(() => controller.validateSerialsCsvForListing(active, { csv }));

    expect(report.willAdd).toBe(0);
    expect(report.rows).toHaveLength(0);
    expect(report.fileErrors.join(' ')).toMatch(/draft/i);

    // The forbidden thing, attempted: the commit the report has just refused to
    // promise. Without this the assertion above would pass just as well against
    // a dry run that had become uselessly pessimistic.
    await expect(
      asVendor(() => controller.addUnits(active, { serials: [serial(1)] })),
    ).rejects.toThrow();
    expect(await unitCount(active)).toBe(0);
  });

  it('marks the rows past the listing cap, rather than losing all of them at the commit', async () => {
    // `qty_total` is the column `addUnits` reads before it refuses the batch, so
    // a listing can be brought to the brink without inserting 4,999 rows.
    const listingId = await draft(4999);
    const csv = ['serial_number', serial(1), serial(2), serial(3)].join('\n');

    const { report, added } = await dryRunThenCommit(listingId, csv);

    // One fits. The other two are named, in file order, with the line to delete.
    expect(report.willAdd).toBe(1);
    expect(report.errors).toBe(2);
    expect(report.rows[1]!.reason).toMatch(/room for 1 more machine/);
    expect(report.rows[1]!.lineNumber).toBe(3);

    // And the commit takes exactly the one the report promised. Before this, the
    // report promised three and `addUnits` threw on all three.
    expect(added).toBe(1);
  });
});

describe('the line number a vendor is told is the line in their file', () => {
  it('survives blank rows above the bad ones', async () => {
    const listingId = await draft();
    const csv = [
      'serial_number', // 1
      serial(1), //       2
      '', //              3  blank
      '', //              4  blank
      serial(2), //       5
      '', //              6  blank
      'no', //            7  the bad one
    ].join('\n');

    const report = await asVendor(() => controller.validateSerialsCsvForListing(listingId, { csv }));

    const bad = report.rows.find((r) => r.outcome === 'ERROR');
    // 7, not 4. Filtering blanks in the parser would report 4 — the number of
    // the row it became after three were dropped — and a vendor opening line 4
    // finds a blank line and concludes our validation is broken.
    expect(bad?.lineNumber).toBe(7);
    expect(report.rows.map((r) => r.lineNumber)).toEqual([2, 5, 7]);
  });
});

describe('a file that is not a CSV is refused, not half-parsed', () => {
  it('refuses a workbook decoded as text rather than reporting a page of bad serials', async () => {
    const listingId = await draft();
    // What `file.text()` produces from a zip: NULs and replacement characters.
    // Built from code points rather than typed into the source, because a file
    // carrying real control characters is one editor away from being silently
    // repaired into something that no longer tests anything.
    //
    // The browser refuses this by magic bytes before it is ever sent; the API is
    // the trust boundary and refuses it again, because a client that is not our
    // screen gets the same answer.
    const csv =
      'PK' +
      String.fromCharCode(3, 4) +
      '�'.repeat(200) +
      String.fromCharCode(0) +
      ' binary';

    const report = await asVendor(() => controller.validateSerialsCsvForListing(listingId, { csv }));

    expect(report.rows).toHaveLength(0);
    expect(report.willAdd).toBe(0);
    expect(report.fileErrors.join(' ')).toMatch(/binary|Excel/i);
    expect(await unitCount(listingId)).toBe(0);
  });

  it('refuses a file with more rows than one upload can carry, and says the number', async () => {
    const listingId = await draft();
    const rows = ['serial_number', ...Array.from({ length: 5001 }, (_, i) => serial(i + 1))];

    const report = await asVendor(() =>
      controller.validateSerialsCsvForListing(listingId, { csv: rows.join('\n') }),
    );

    expect(report.rows).toHaveLength(0);
    expect(report.fileErrors.join(' ')).toContain('5001');
    expect(report.fileErrors.join(' ')).toContain('5000');
  });
});
