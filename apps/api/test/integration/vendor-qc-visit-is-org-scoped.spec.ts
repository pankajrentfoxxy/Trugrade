import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { permissionsFor, type Role } from '@trugrade/contracts';
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
import { ForbiddenError, NotFoundError } from '../../src/shared/errors/domain-errors';
import { QcRepository } from '../../src/modules/qc/internal/qc.repository';
import { SchedulingService } from '../../src/modules/qc/internal/scheduling.service';
import { VendorQualityService } from '../../src/modules/qc/internal/vendor-quality.service';
import { QcService } from '../../src/modules/qc/qc.service';
import { VendorVisitRepository } from '../../src/modules/qc/internal/vendor-visit.repository';
import { VendorVisitsController } from '../../src/modules/qc/vendor-visits.controller';
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
 * T30 — a vendor sees their own QC visits, and only their own.
 *
 * ## What this is guarding
 *
 * `GET /api/qc/visits/:id` is the OPS console's record. It takes no principal,
 * applies no org predicate, and resolves a vendor's legal name and a
 * technician's real name onto the row — correctly, because a QC manager's board
 * spans every vendor. Four VENDOR roles held the `qc.visit.read` that guarded
 * it, so any vendor could open a competitor's visit by id and read their whole
 * manifest: every serial, every declared grade, every verdict.
 *
 * Those grants are gone and `qc-console-is-not-vendor-reachable.spec.ts` fails
 * if they come back. This file is the other half: the vendor's own route exists,
 * it answers for its owner, and it refuses everybody else at the REPOSITORY,
 * where no caller can forget the predicate.
 *
 * ## Why none of this reads a permission
 *
 * The console leaked for weeks while a test asserting that no vendor role holds
 * a `*.any.*` permission passed the whole time — the leaking grant was called
 * `qc.report.read`. A test keyed on a naming convention only catches mistakes
 * that remember to be named badly. So every refusal below **calls the route as
 * the wrong vendor, by the neighbour's real id, and demands the refusal** — then
 * reads the neighbour's row back out of the database to prove nothing
 * half-applied.
 *
 * The control case is half the evidence. A 404 for everybody would satisfy every
 * refusal here, and is also exactly what a deleted route looks like, so the
 * identical call is made by the owner and required to succeed.
 */

/** Fixed TIME, tracking DATE: a date literal here is a time bomb (04_TEST_PLAN). */
const FIXED_NOW = new Date(`${new Date().toISOString().slice(0, 10)}T06:00:00.000Z`);
const VENDOR = '30303030-0000-4000-8000-0000000000e1';
const NEIGHBOUR = '30303030-0000-4000-8000-0000000000e2';

let moduleRef: TestingModule;
let visits: VendorVisitsController;
let ctx: RequestContextService;
let db: PrismaClient;
let vendorUserId: string;
let neighbourUserId: string;
let skuId: string;

function principal(orgId: string, userId: string, roles: Role[] = ['VENDOR_OWNER']): Principal {
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

const asVendor = <T>(fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 't30' }, () => {
    ctx.setPrincipal(principal(VENDOR, vendorUserId));
    return fn();
  });

const asNeighbour = <T>(fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 't30n' }, () => {
    ctx.setPrincipal(principal(NEIGHBOUR, neighbourUserId));
    return fn();
  });

/** Platform staff have no org. "Your visits" has no answer for them. */
const asPlatform = <T>(fn: () => Promise<T>): Promise<T> =>
  ctx.run({ requestId: 't30p' }, () => {
    ctx.setPrincipal({
      userId: randomUUID(),
      orgId: null,
      orgType: 'PLATFORM',
      roles: ['QC_MANAGER'],
      permissions: permissionsFor(['QC_MANAGER']),
      sessionId: 's',
      mfaSatisfied: true,
    } as unknown as Principal);
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
      QcService,
      VendorQualityService,
      SchedulingService,
      VendorVisitRepository,
      VendorVisitsController,
    ],
  }).compile();
  await moduleRef.init();
  visits = moduleRef.get(VendorVisitsController);
  ctx = moduleRef.get(RequestContextService);
});

afterAll(async () => {
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await makeOrganization({ id: VENDOR }, db);
  await makeOrganization({ id: NEIGHBOUR, legal_name: 'Neighbour Assets Pvt Ltd' }, db);
  vendorUserId = await makeUser(VENDOR, {}, db);
  neighbourUserId = await makeUser(NEIGHBOUR, { email: 'ops@neighbour.example' }, db);
  skuId = (await makeCatalog({}, db)).skuId;
});

interface SeededVisit {
  visitId: string;
  visitNumber: string;
  unitId: string;
  serial: string;
  facilityId: string;
}

/**
 * One vendor site, one visit, one machine on the manifest.
 *
 * `status` is REQUESTED by default so the cancellation path is reachable; the
 * completed variant carries a report, which is what makes the results half of
 * the payload non-empty.
 */
async function seedVisit(
  orgId: string,
  opts: { status?: string; withReport?: boolean; serial?: string } = {},
): Promise<SeededVisit> {
  const addressId = await makeAddress(orgId, {}, db);
  const facilityId = randomUUID();
  await db.$executeRaw`
    INSERT INTO vendor.vendor_facility (id, org_id, address_id, facility_type)
    VALUES (${facilityId}::uuid, ${orgId}::uuid, ${addressId}::uuid, 'WAREHOUSE')`;
  // Sunday shut, so the "a closed day cannot be booked" half of the payload has
  // something behind it.
  for (let dow = 0; dow <= 6; dow += 1) {
    await db.$executeRaw`
      INSERT INTO vendor.facility_hours (facility_id, day_of_week, open_time, close_time, is_closed)
      VALUES (${facilityId}::uuid, ${dow},
              ${dow === 0 ? null : '09:00:00'}::time, ${dow === 0 ? null : '18:00:00'}::time,
              ${dow === 0})`;
  }

  const tech = await makeTechnician(db);
  const listingId = await makeListing(
    { vendorOrgId: orgId, skuId, pickupAddressId: addressId, qty: 1, status: 'ACTIVE' },
    db,
  );
  const unit = await makeUnit(
    {
      listingId,
      vendorOrgId: orgId,
      skuId,
      technicianId: tech.technicianId,
      technicianUserId: tech.userId,
      ...(opts.serial ? { serial: opts.serial } : {}),
      ...(opts.withReport === false ? { sealed: false } : {}),
    },
    db,
  );

  const visitId = randomUUID();
  const visitNumber = `QCV-TEST-${visitId.slice(0, 8).toUpperCase()}`;
  const status = opts.status ?? 'REQUESTED';
  const finished = status === 'COMPLETED';
  await db.$executeRaw`
    INSERT INTO qc.qc_visit (id, visit_number, vendor_org_id, facility_id, address_id,
                             requested_at, units_requested, status, visit_fee, fee_bearer,
                             technician_id, arrived_at, completed_at)
    VALUES (${visitId}::uuid, ${visitNumber}, ${orgId}::uuid, ${facilityId}::uuid,
            ${addressId}::uuid, ${FIXED_NOW}, 1, ${status}::public.qc_visit_status,
            1500, 'VENDOR', ${tech.technicianId}::uuid,
            ${finished ? FIXED_NOW : null}, ${finished ? FIXED_NOW : null})`;
  await db.$executeRaw`
    INSERT INTO qc.qc_visit_unit (visit_id, unit_id, serial_number, listing_id, sequence_no,
                                  outcome, qc_report_id)
    VALUES (${visitId}::uuid, ${unit.unitId}::uuid, ${unit.serial}, ${listingId}::uuid, 1,
            ${finished ? 'PASS' : 'PENDING'}::public.qc_unit_outcome,
            ${finished ? unit.qcReportId : null}::uuid)`;

  return { visitId, visitNumber, unitId: unit.unitId, serial: unit.serial, facilityId };
}

const visitRow = async (id: string): Promise<{ status: string; reason: string | null }> => {
  const [row] = await db.$queryRaw<Array<{ status: string; reason: string | null }>>`
    SELECT status::text AS status, cancellation_reason AS reason
      FROM qc.qc_visit WHERE id = ${id}::uuid`;
  return row!;
};

describe('a vendor can read their own inspections', () => {
  it('lists their own and nobody else’s, by real id', async () => {
    const mine = await seedVisit(VENDOR, { serial: 'MINE00000001' });
    const theirs = await seedVisit(NEIGHBOUR, { serial: 'THEIRS000001' });

    const rows = await asVendor(() => visits.list());

    expect(rows.map((v) => v.visitNumber)).toEqual([mine.visitNumber]);
    // The neighbour's visit exists and is reachable by its owner — so its
    // absence here is scoping, not an empty table.
    expect((await asNeighbour(() => visits.list())).map((v) => v.visitNumber)).toEqual([
      theirs.visitNumber,
    ]);
  });

  it('opens a completed visit with the manifest, the results and the site calendar', async () => {
    const mine = await seedVisit(VENDOR, { status: 'COMPLETED' });

    const view = await asVendor(() => visits.one(mine.visitId));

    expect(view.visitNumber).toBe(mine.visitNumber);
    expect(view.manifest).toHaveLength(1);
    expect(view.manifest[0]!.serialNumber).toBe(mine.serial);
    expect(view.manifest[0]!.outcome).toBe('PASS');
    expect(view.manifest[0]!.result?.verdict).toBe('PASS');
    expect(view.manifest[0]!.result?.seal?.code).toBeTruthy();
    // The rule §3B asks the screen to state: a closed day cannot be booked.
    expect(view.calendar.hours.filter((h) => h.isClosed).map((h) => h.dayOfWeek)).toEqual([0]);
  });

  it('a visit nobody has been to carries no result and no invented zero', async () => {
    const mine = await seedVisit(VENDOR);

    const view = await asVendor(() => visits.one(mine.visitId));

    expect(view.arrivedAt).toBeNull();
    expect(view.completedAt).toBeNull();
    // The defect class this build has found about ten times: a machine nobody
    // opened must not arrive carrying a score, a grade or a seal.
    expect(view.manifest[0]!.outcome).toBe('PENDING');
    expect(view.manifest[0]!.result).toBeNull();
    // Not zero. "Nobody has counted" and "the vendor produced none" differ.
    expect(view.unitsPresented).toBeNull();
  });

  it('never carries a vendor name, an org id or a technician’s name', async () => {
    await seedVisit(VENDOR, { status: 'COMPLETED' });
    const [row] = await asVendor(() => visits.list());
    const detail = await asVendor(() => visits.one(row!.id));

    const wire = JSON.stringify([row, detail]);
    // `makeTechnician` names the technician Rakesh Kumar; §3B says a vendor sees
    // TECH-0142 and not a person, at every status.
    for (const forbidden of ['Rakesh', 'Alpha Systems', 'Neighbour Assets', VENDOR, NEIGHBOUR]) {
      expect(wire).not.toContain(forbidden);
    }
    // Positive control: the sweep would pass on an empty payload otherwise.
    expect(wire).toContain(row!.visitNumber);
    expect(detail.technicianCode).toMatch(/^TECH-/);
  });
});

describe('a vendor cannot reach a neighbour’s inspection', () => {
  it('refuses to open it by its real id, and the row is untouched', async () => {
    const theirs = await seedVisit(NEIGHBOUR, { status: 'COMPLETED' });
    const before = await visitRow(theirs.visitId);

    await expect(asVendor(() => visits.one(theirs.visitId))).rejects.toBeInstanceOf(NotFoundError);

    // Nothing half-applied: the read must not have moved anything, and the row
    // is still there for its owner.
    expect(await visitRow(theirs.visitId)).toEqual(before);
    await expect(asNeighbour(() => visits.one(theirs.visitId))).resolves.toMatchObject({
      visitNumber: theirs.visitNumber,
    });
  });

  it('refuses to cancel it by its real id, and the status does not move', async () => {
    const theirs = await seedVisit(NEIGHBOUR);
    expect((await visitRow(theirs.visitId)).status).toBe('REQUESTED');

    await expect(
      asVendor(() =>
        visits.cancel(theirs.visitId, { reason: 'We changed our minds about this batch.' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const after = await visitRow(theirs.visitId);
    expect(after.status).toBe('REQUESTED');
    expect(after.reason).toBeNull();
  });

  it('the neighbour’s serials do not appear on the refusal or anywhere in the list', async () => {
    const theirs = await seedVisit(NEIGHBOUR, { status: 'COMPLETED', serial: 'THEIRS000042' });
    await seedVisit(VENDOR, { serial: 'MINE00000042' });

    const rows = await asVendor(() => visits.list());
    const detail = await asVendor(() => visits.one(rows[0]!.id));
    let refusal = '';
    await asVendor(() => visits.one(theirs.visitId)).catch((e: Error) => {
      refusal = JSON.stringify({ m: e.message, ...(e as unknown as object) });
    });

    const wire = JSON.stringify([rows, detail]) + refusal;
    expect(wire).not.toContain('THEIRS000042');
    expect(wire).toContain('MINE00000042');
  });

  it('refuses a caller with no vendor org at all', async () => {
    const mine = await seedVisit(VENDOR);

    // PLATFORM_SUPERADMIN holds every permission, so the guard cannot be what
    // stops this — the refusal has to live in the repository.
    await expect(asPlatform(() => visits.list())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(asPlatform(() => visits.one(mine.visitId))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('a vendor can call off their own inspection', () => {
  it('cancels it with a reason, and the row carries both', async () => {
    const mine = await seedVisit(VENDOR);

    const after = await asVendor(() =>
      visits.cancel(mine.visitId, { reason: 'The stock has been sold elsewhere.' }),
    );

    expect(after.status).toBe('CANCELLED');
    expect(after.cancellable).toBe(false);
    // The row, not the DTO: a cancellation recorded nowhere is a technician who
    // still turns up.
    const row = await visitRow(mine.visitId);
    expect(row.status).toBe('CANCELLED');
    expect(row.reason).toBe('The stock has been sold elsewhere.');
  });

  it('cannot cancel one that has already happened', async () => {
    const mine = await seedVisit(VENDOR, { status: 'COMPLETED' });

    const view = await asVendor(() => visits.one(mine.visitId));
    expect(view.cancellable).toBe(false);

    // The screen hides the control; the API refuses it anyway, because a guard
    // in the browser is one breakpoint away from irrelevant.
    await expect(
      asVendor(() => visits.cancel(mine.visitId, { reason: 'Too late, but trying anyway.' })),
    ).rejects.toThrow();
    expect((await visitRow(mine.visitId)).status).toBe('COMPLETED');
  });
});

describe('the visit fee is never a bare zero', () => {
  it('carries the bearer and the configured waiver threshold beside the amount', async () => {
    const mine = await seedVisit(VENDOR);

    const view = await asVendor(() => visits.one(mine.visitId));

    expect(view.fee.amount).toBe('1500.00');
    expect(view.fee.bearer).toBe('VENDOR');
    // Both come from `platform_config` and both are null-not-zero when unreadable,
    // so the screen can say "we cannot tell you the threshold" rather than
    // painting every batch as too small to qualify.
    expect(view.fee.waivedAboveUnits).toBe(50);
    expect(view.fee.standardFee).toBe('1500.00');
  });
});
