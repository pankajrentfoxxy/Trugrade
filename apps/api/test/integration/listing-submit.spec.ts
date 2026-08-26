/**
 * Submit: the listing does NOT go live.
 *
 * Everything here is a database guarantee — the counter triggers, the append-only
 * grants on `stock_movement`, the atomicity of the whole submit — so it runs
 * against the real Postgres and nothing is faked but the clock.
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { moneyFromDb, permissionsFor, type Role } from '@trugrade/contracts';
import type { Principal } from '../../src/shared/db/org-scope';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule, OrgScope, RequestContextService } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { StockMovementService } from '../../src/modules/listing/internal/stock-movement.service';
import {
  LocalQcVisitPort,
  QcVisitPort,
  SubmitService,
} from '../../src/modules/listing/internal/submit.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeCatalog, makeOrganization, makeUser } from '../support/factories';

let moduleRef: TestingModule;
let submit: SubmitService;
let movements: StockMovementService;
let ctx: RequestContextService;
let raw: PrismaClient;

let orgId: string;
let userId: string;
let addressId: string;
let skuId: string;

function as<T>(p: Principal, fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 'test' }, () => {
    ctx.setPrincipal(p);
    return fn();
  });
}

function vendor(): Principal {
  const roles: Role[] = ['VENDOR_OWNER'];
  return {
    userId,
    orgId,
    orgType: 'VENDOR',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 'sess-1',
  };
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(new Date('2026-08-26T06:00:00.000Z')) },
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
      EventBus,
      OrgScope,
      StockMovementService,
      SubmitService,
      { provide: QcVisitPort, useClass: LocalQcVisitPort },
    ],
  }).compile();

  submit = moduleRef.get(SubmitService);
  movements = moduleRef.get(StockMovementService);
  ctx = moduleRef.get(RequestContextService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(raw);
  orgId = await makeOrganization({}, raw);
  userId = await makeUser(orgId, {}, raw);
  addressId = await makeAddress(orgId, {}, raw);
  await raw.$executeRaw`
    INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
    VALUES (${orgId}::uuid, ${addressId}::uuid, 'WAREHOUSE')`;
  skuId = (await makeCatalog({}, raw)).skuId;
});

async function draft(units: number): Promise<string> {
  const listingId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id, grade,
                                 condition_type, battery_health_band, parts_status,
                                 unit_price, qty_total, status)
    VALUES (${listingId}::uuid, ${orgId}::uuid, ${skuId}::uuid, ${addressId}::uuid,
            'A'::grade_type, 'REFURBISHED'::condition_type, 'GOOD_80_89'::battery_band,
            'ALL_ORIGINAL'::parts_status_type, 28000, ${units}, 'DRAFT'::listing_status)`;
  for (let i = 0; i < units; i++) {
    await raw.$executeRaw`
      INSERT INTO listing.unit (listing_id, vendor_org_id, sku_id, serial_number,
                                grade_declared, status, vendor_ask_price)
      VALUES (${listingId}::uuid, ${orgId}::uuid, ${skuId}::uuid,
              ${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()},
              'A'::grade_type, 'CREATED'::unit_status, 28000)`;
  }
  return listingId;
}

describe('submit requests an inspection instead of going live', () => {
  it('moves the listing and every unit to AWAITING_QC and raises a REQUESTED visit', async () => {
    const listingId = await draft(30);
    const result = await as(vendor(), () => submit.submit(listingId));

    expect(result.outcome).toBe('SUBMITTED');
    if (result.outcome !== 'SUBMITTED') return;
    expect(result.unitCount).toBe(30);
    expect(result.visitFee.toString()).toBe('0.00');
    expect(result.visitNumber).toMatch(/^QCV-20260826-[0-9A-F]{8}$/);

    const [listing] = await raw.$queryRaw<
      Array<{
        status: string;
        qty_available: number;
        qty_awaiting_qc: number;
        qty_total: number;
        qc_visit_id: string | null;
        qc_requested_at: Date | null;
      }>
    >`
      SELECT status, qty_available, qty_awaiting_qc, qty_total, qc_visit_id, qc_requested_at
        FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(listing!.status).toBe('AWAITING_QC');
    // The rule that decides the phase: nothing is buyer-visible.
    expect(listing!.qty_available).toBe(0);
    expect(listing!.qty_awaiting_qc).toBe(30);
    expect(listing!.qty_total).toBe(30);
    expect(listing!.qc_visit_id).toBe(result.qcVisitId);
    expect(listing!.qc_requested_at).not.toBeNull();

    const [units] = await raw.$queryRaw<Array<{ n: bigint; sellable: bigint; visits: bigint }>>`
      SELECT count(*)::bigint AS n,
             count(*) FILTER (WHERE is_sellable)::bigint AS sellable,
             count(DISTINCT qc_visit_id)::bigint AS visits
        FROM listing.unit
       WHERE listing_id = ${listingId}::uuid AND status = 'AWAITING_QC'`;
    expect(Number(units!.n)).toBe(30);
    expect(Number(units!.sellable)).toBe(0);
    expect(Number(units!.visits)).toBe(1);

    const [visit] = await raw.$queryRaw<
      Array<{ status: string; units_requested: number; visit_fee: unknown; fee_bearer: string }>
    >`SELECT status, units_requested, visit_fee, fee_bearer
        FROM qc.qc_visit WHERE id = ${result.qcVisitId}::uuid`;
    expect(visit!.status).toBe('REQUESTED');
    expect(visit!.units_requested).toBe(30);
    expect(moneyFromDb(visit!.visit_fee as string)!.toString()).toBe('0.00');
    expect(visit!.fee_bearer).toBe('TRUETECH');

    const [mv] = await raw.$queryRaw<Array<{ n: bigint; froms: string; refs: bigint }>>`
      SELECT count(*)::bigint AS n,
             string_agg(DISTINCT from_status::text, ',') AS froms,
             count(*) FILTER (WHERE ref_type = 'QC_VISIT' AND ref_id = ${result.qcVisitId}::uuid)::bigint AS refs
        FROM listing.stock_movement m
       WHERE m.unit_id IN (SELECT id FROM listing.unit WHERE listing_id = ${listingId}::uuid)`;
    expect(Number(mv!.n)).toBe(30);
    expect(mv!.froms).toBe('CREATED');
    expect(Number(mv!.refs)).toBe(30);

    const [outbox] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM platform.event_outbox
       WHERE event_name = 'listing.submitted'
         AND payload_json ->> 'listingId' = ${listingId}`;
    expect(Number(outbox!.n)).toBe(1);

    const drift = await raw.$queryRaw<unknown[]>`SELECT * FROM listing.v_stock_drift`;
    expect(drift).toHaveLength(0);
  });

  it('asks rather than rejecting below the minimum, and holds without writing', async () => {
    const listingId = await draft(5);

    const asked = await as(vendor(), () => submit.submit(listingId));
    expect(asked.outcome).toBe('DECISION_REQUIRED');
    if (asked.outcome !== 'DECISION_REQUIRED') return;
    expect(asked.minUnitsPerVisit).toBe(25);
    expect(asked.shortBy).toBe(20);
    expect(asked.visitFee.toString()).toBe('1500.00');

    const held = await as(vendor(), () => submit.submit(listingId, 'HOLD'));
    expect(held.outcome).toBe('HELD');

    const [still] = await raw.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(still!.status).toBe('DRAFT');
    const [visits] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM qc.qc_visit`;
    expect(Number(visits!.n)).toBe(0);

    const paid = await as(vendor(), () => submit.submit(listingId, 'ACCEPT_FEE'));
    expect(paid.outcome).toBe('SUBMITTED');
    if (paid.outcome !== 'SUBMITTED') return;
    expect(paid.visitFee.toString()).toBe('1500.00');
    expect(paid.feeBearer).toBe('VENDOR');

    const [visit] = await raw.$queryRaw<Array<{ visit_fee: unknown; fee_bearer: string }>>`
      SELECT visit_fee, fee_bearer FROM qc.qc_visit WHERE id = ${paid.qcVisitId}::uuid`;
    expect(moneyFromDb(visit!.visit_fee as string)!.toString()).toBe('1500.00');
    expect(visit!.fee_bearer).toBe('VENDOR');
  });

  it('is one transaction: no facility means no visit and no movement', async () => {
    await raw.$executeRaw`DELETE FROM vendor.vendor_facility WHERE org_id = ${orgId}::uuid`;
    const listingId = await draft(30);

    await expect(as(vendor(), () => submit.submit(listingId))).rejects.toThrow(
      /registered facility/,
    );

    const [after] = await raw.$queryRaw<Array<{ status: string; created: bigint }>>`
      SELECT l.status,
             (SELECT count(*)::bigint FROM listing.unit u
               WHERE u.listing_id = l.id AND u.status = 'CREATED') AS created
        FROM listing.listing l WHERE l.id = ${listingId}::uuid`;
    expect(after!.status).toBe('DRAFT');
    expect(Number(after!.created)).toBe(30);
    const [mv] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.stock_movement`;
    expect(Number(mv!.n)).toBe(0);
  });

  it('refuses a listing that is not a draft, and one with no serials', async () => {
    const listingId = await draft(30);
    await as(vendor(), () => submit.submit(listingId));
    await expect(as(vendor(), () => submit.submit(listingId))).rejects.toThrow(
      /isn't available from the current status/,
    );

    const empty = await draft(0);
    await expect(as(vendor(), () => submit.submit(empty))).rejects.toThrow(/at least one serial/);
  });

  it('will not submit another vendor’s listing', async () => {
    const listingId = await draft(30);
    const otherOrg = await makeOrganization({ legal_name: 'Beta Systems' }, raw);
    const otherUser = await makeUser(otherOrg, {}, raw);
    const roles: Role[] = ['VENDOR_OWNER'];
    await expect(
      as(
        {
          userId: otherUser,
          orgId: otherOrg,
          orgType: 'VENDOR',
          roles,
          permissions: permissionsFor(roles),
          sessionId: 's2',
        },
        () => submit.submit(listingId),
      ),
    ).rejects.toThrow(/access to that listing/);
  });
});

describe('stock movements', () => {
  it('records from -> to per unit and leaves units in the wrong status alone', async () => {
    const listingId = await draft(3);
    const ids = (
      await raw.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM listing.unit WHERE listing_id = ${listingId}::uuid ORDER BY id`
    ).map((r) => r.id);

    await raw.$executeRaw`
      UPDATE listing.unit SET status = 'SCRAPPED'::unit_status WHERE id = ${ids[0]!}::uuid`;

    const moved = await as(vendor(), () =>
      movements.transition({
        unitIds: ids,
        expectedFrom: 'CREATED',
        to: 'AWAITING_QC',
        reason: 'Inspection requested by the vendor.',
        toLocation: 'VENDOR',
      }),
    );

    expect(moved).toHaveLength(2);
    expect(moved.every((m) => m.fromStatus === 'CREATED' && m.toStatus === 'AWAITING_QC')).toBe(
      true,
    );

    const [row] = await raw.$queryRaw<Array<{ actor_id: string | null; reason: string }>>`
      SELECT actor_id, reason FROM listing.stock_movement WHERE unit_id = ${ids[1]!}::uuid`;
    expect(row!.actor_id).toBe(userId);
    expect(row!.reason).toBe('Inspection requested by the vendor.');
  });

  it('cannot be corrected: the trail is append-only', async () => {
    const listingId = await draft(1);
    const [unit] = await raw.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
    await as(vendor(), () =>
      movements.transition({
        unitIds: [unit!.id],
        to: 'AWAITING_QC',
        reason: 'Inspection requested.',
      }),
    );

    // The REVOKE is applied per-role by ops.apply_append_only_grants. If the test
    // role is a superuser it is exempt, so this asserts the grant state rather
    // than the failure — the grant is the control either way.
    const [grant] = await raw.$queryRaw<Array<{ can_update: boolean; superuser: boolean }>>`
      SELECT has_table_privilege(current_user, 'listing.stock_movement', 'UPDATE') AS can_update,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`;
    expect(grant!.can_update && !grant!.superuser).toBe(false);
  });
});
