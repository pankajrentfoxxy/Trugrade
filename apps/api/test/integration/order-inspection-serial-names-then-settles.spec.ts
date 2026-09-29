/**
 * The order-first inspection, end to end over HTTP: ops assigns, the
 * technician's serial names the machine, the report is recorded against it,
 * and the verdict settles the order.
 *
 * Every property below is one only the real database produces — the three
 * schemas written in one transaction, the nationwide serial index, the nonce
 * replay, the visit and the order advancing on the last slot — so this runs
 * against the test database through the real controllers and guards, the way
 * the console reaches it. No mocked repository could refuse the second serial
 * for a named slot or roll the report back when the naming fails.
 *
 * The suites:
 *
 *   ASSIGN     ops sends a technician; the order goes QC_IN_PROGRESS
 *   NAME+FAIL  a serial names slot 1, its FAIL report settles the slot QC_FAILED
 *   REPLAY     the same nonce is the report that exists; one unit, not two
 *   RENAME     a different serial for a named slot is refused, 409
 *   LAST SLOT  slot 2's report closes the visit and moves the order on
 *   SHAPE      a report that names no machine, or both ways, is 422
 */

import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { permissionsFor } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { AUDIENCE_HEADER } from '../../src/shared/auth/session-cookies';
import { TokenService } from '../../src/shared/auth/token.service';
import { QC_AREA_CODES } from '../../src/modules/qc/dto/qc.dto';
import { migrateTestDatabase, seedTestReference, testDb, truncateAll } from '../support/db';
import { makeAddress, makeCatalog, makeListing, makeOrganization, makeTechnician } from '../support/factories';

let moduleRef: TestingModule;
let app: INestApplication;
let raw: PrismaClient;

let opsToken: string;
let techToken: string;
let technicianId: string;
let technicianUserId: string;

const ORDER_NUMBER = 'TT-26-91001';
let orderId: string;
let visitId: string;
let slotIds: string[];

// Staff tokens are only honoured on the console audience; a bare request with
// no Origin resolves to the storefront and is turned away as the wrong portal.
const post = (path: string, token: string, body: object) =>
  request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set(AUDIENCE_HEADER, 'console').send(body);
const get = (path: string, token: string) =>
  request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`).set(AUDIENCE_HEADER, 'console');

/** A complete manual report for one ordered slot. Every field the schema wants; the caller picks the verdict. */
function report(slotId: string, serial: string, verdict: 'PASS' | 'FAIL', nonce: string): Record<string, unknown> {
  const pass = verdict === 'PASS';
  const startedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  return {
    visitId,
    slotId,
    technicianId,
    serialScanned: serial,
    serialMatches: true,
    startedAt,
    completedAt: new Date().toISOString(),
    areaResults: QC_AREA_CODES.map((area) => ({ area, status: pass ? 'PASS' : 'FAIL', score: pass ? 10 : 0, maxScore: 10, note: null })),
    areasNotMeasured: [],
    // The factory SKU is 16 GB / 512 GB NVMe / i5-1145G7; a passing report says so.
    hardware: pass
      ? { ramDetectedGb: 16, ramModules: 2, storageType: 'NVME_SSD', storageDetectedGb: 477, smartStatus: 'OK', batteryHealthPct: 80, cycleCount: 120, biosLocked: 'NO', mdmLocked: 'NO', computraceActive: 'NO' }
      : { ramDetectedGb: null, ramModules: null, storageType: null, storageDetectedGb: null, smartStatus: null, batteryHealthPct: null, cycleCount: null, biosLocked: 'UNKNOWN', mdmLocked: 'UNKNOWN', computraceActive: 'UNKNOWN' },
    photos: [],
    seal: pass ? { sealCode: 'TRG-26HR-0009101', photoKey: 'qc/seals/test-seal.jpg', photoHash: 'a'.repeat(64) } : null,
    qcScore: pass ? 96 : 12,
    gradeProposed: pass ? 'A' : null,
    gradeFinal: pass ? 'A' : null,
    gradeOverrideReason: null,
    verdict,
    notes: null,
    nonce,
  };
}

const slot = async (id: string) =>
  (
    await raw.$queryRaw<Array<{ unit_id: string | null; serial_number: string | null; status: string; inspected_at: Date | null; qc_report_id: string | null }>>`
      SELECT unit_id, serial_number, status::text AS status, inspected_at, qc_report_id
        FROM ordering.order_line_unit WHERE id = ${id}::uuid`
  )[0]!;
const unitOf = async (id: string) =>
  (
    await raw.$queryRaw<Array<{ status: string; order_line_id: string | null; qc_report_id: string | null }>>`
      SELECT status::text AS status, order_line_id, qc_report_id FROM listing.unit WHERE id = ${id}::uuid`
  )[0]!;
const visit = async () =>
  (
    await raw.$queryRaw<Array<{ status: string; started_at: Date | null; completed_at: Date | null }>>`
      SELECT status::text AS status, started_at, completed_at FROM qc.qc_visit WHERE id = ${visitId}::uuid`
  )[0]!;
const order = async () =>
  (await raw.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM ordering."order" WHERE id = ${orderId}::uuid`)[0]!;

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await truncateAll(raw);
  await seedTestReference(raw);

  // The supply point: a vendor with a pickup address that is a registered
  // facility (assignment refuses an address nobody can be sent to).
  const vendorOrgId = await makeOrganization({}, raw);
  const addressId = await makeAddress(vendorOrgId, {}, raw);
  await raw.$executeRaw`
    INSERT INTO vendor.vendor_facility (org_id, address_id, facility_type)
    VALUES (${vendorOrgId}::uuid, ${addressId}::uuid, 'WAREHOUSE')`;
  const { skuId } = await makeCatalog({}, raw);
  // A declared quantity and no serials — the order-first listing.
  const listingId = await makeListing({ vendorOrgId, skuId, pickupAddressId: addressId, qty: 2, unitPrice: 42000 }, raw);

  // The buyer, and the order awaiting inspection: two vacant slots on one line.
  const buyerOrgId = await makeOrganization({ org_type: 'BUYER', legal_name: 'Slotwise Systems Pvt Ltd' }, raw);
  const buyerUserId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, email, full_name, mobile, status)
    VALUES (${buyerUserId}::uuid, ${buyerOrgId}::uuid, ${`buyer-${buyerUserId.slice(0, 8)}@example.com`},
            'Meera Krishnan', '+919812345600', 'ACTIVE')`;
  const buyerAddressId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO identity.org_address
      (id, org_id, type, label, line1, city, state, state_code, pincode, contact_name, contact_mobile, is_billing_enabled)
    VALUES (${buyerAddressId}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type, 'Head office',
            '11th floor, Barakhamba Road', 'New Delhi', 'Delhi', '07', '110001', 'Meera Krishnan', '+919812345600', TRUE)`;
  const gstProfileId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO kyc.gst_profile (id, org_id, gstin, legal_name_as_per_gst, state_code, status, api_verified_at, is_primary)
    VALUES (${gstProfileId}::uuid, ${buyerOrgId}::uuid, '07AABCS4471N1ZQ', 'Slotwise Systems Pvt Ltd', '07', 'ACTIVE', now(), TRUE)`;

  orderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering."order"
      (id, order_number, buyer_org_id, buyer_user_id, billing_gst_profile_id, billing_address_id,
       shipping_address_id, subtotal, gst_total, grand_total, status)
    VALUES (${orderId}::uuid, ${ORDER_NUMBER}, ${buyerOrgId}::uuid, ${buyerUserId}::uuid, ${gstProfileId}::uuid,
            ${buyerAddressId}::uuid, ${buyerAddressId}::uuid, 84000, 15120, 99120, 'AWAITING_INSPECTION'::order_status)`;
  const subOrderId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering.sub_order
      (id, order_id, sub_order_number, vendor_org_id, pickup_address_id, subtotal, gst_total, status)
    VALUES (${subOrderId}::uuid, ${orderId}::uuid, ${`${ORDER_NUMBER}-1`}, ${vendorOrgId}::uuid, ${addressId}::uuid,
            84000, 15120, 'AWAITING_INSPECTION'::order_status)`;
  const lineId = randomUUID();
  await raw.$executeRaw`
    INSERT INTO ordering.order_line
      (id, sub_order_id, listing_id, sku_id, grade, qty, unit_price, gst_rate, gst_amount, line_total)
    VALUES (${lineId}::uuid, ${subOrderId}::uuid, ${listingId}::uuid, ${skuId}::uuid, 'A'::public.grade_type, 2,
            42000, 18, 15120, 99120)`;
  const inserted = await raw.$queryRaw<Array<{ id: string }>>`
    INSERT INTO ordering.order_line_unit (order_line_id) VALUES (${lineId}::uuid), (${lineId}::uuid) RETURNING id`;
  slotIds = inserted.map((r) => r.id).sort();

  ({ technicianId, userId: technicianUserId } = await makeTechnician(raw));

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  const tokens = app.get(TokenService);
  opsToken = (
    await tokens.issue({
      userId: technicianUserId,
      orgId: null,
      orgType: 'PLATFORM',
      roles: ['QC_MANAGER'],
      permissions: [...permissionsFor(['QC_MANAGER'])],
      mfa: true,
    })
  ).accessToken;
  techToken = (
    await tokens.issue({
      userId: technicianUserId,
      orgId: null,
      orgType: 'PLATFORM',
      roles: ['TECHNICIAN'],
      permissions: [...permissionsFor(['TECHNICIAN'])],
      mfa: true,
    })
  ).accessToken;
});

afterAll(async () => {
  await app.close();
  await moduleRef.close();
});

/* ========================================================================== */

describe('ASSIGN — ops sends a technician for the order', () => {
  it('raises one visit per consignment and moves the order to QC_IN_PROGRESS', async () => {
    const res = await post('/api/qc/order-inspections/assign', opsToken, { orderNumber: ORDER_NUMBER, technicianId });
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
    visitId = res.body.visits[0].visitId;

    expect((await visit()).status).toBe('TECH_ASSIGNED');
    expect((await order()).status).toBe('QC_IN_PROGRESS');

    const view = await get(`/api/qc/order-inspections/${visitId}`, techToken);
    expect(view.status).toBe(200);
    expect(view.body.slots.map((s: { slotId: string }) => s.slotId).sort()).toEqual(slotIds);
    expect(view.body.slots.every((s: { serialNumber: string | null }) => s.serialNumber === null)).toBe(true);
  });
});

describe('NAME + FAIL — the serial names slot 1 and its report settles it', () => {
  let reportId: string;

  it('records the report against a unit the serial creates', async () => {
    const res = await post('/api/qc/reports/manual', techToken, report(slotIds[0]!, 'ORD1SERIAL01', 'FAIL', 'nonce-slot-one-0001'));
    expect(res.status).toBe(200);
    expect(res.body.alreadyRecorded).toBe(false);
    reportId = res.body.reportId;

    const s = await slot(slotIds[0]!);
    expect(s.serial_number).toBe('ORD1SERIAL01');
    expect(s.unit_id).not.toBeNull();
    // The verdict, not the naming, is what the slot carries.
    expect(s.status).toBe('QC_FAILED');
    expect(s.inspected_at).not.toBeNull();
    // The buyer's machines tab reads QC through the slot's report id and no other.
    expect(s.qc_report_id).toBe(reportId);

    const u = await unitOf(s.unit_id!);
    expect(u.status).toBe('QC_FAILED');
    expect(u.qc_report_id).toBe(reportId);

    const [line] = await raw.$queryRaw<Array<{ outcome: string; qc_report_id: string | null }>>`
      SELECT outcome::text AS outcome, qc_report_id FROM qc.qc_visit_unit
       WHERE visit_id = ${visitId}::uuid AND unit_id = ${s.unit_id}::uuid`;
    expect(line?.outcome).toBe('FAIL');
    expect(line?.qc_report_id).toBe(reportId);
  });

  it('leaves the visit in progress and the order where it was, with a slot still open', async () => {
    expect((await visit()).status).toBe('IN_PROGRESS');
    expect((await order()).status).toBe('QC_IN_PROGRESS');
    expect((await slot(slotIds[1]!)).unit_id).toBeNull();
  });

  it('REPLAY — the same nonce is the report that exists, and no second unit', async () => {
    const res = await post('/api/qc/reports/manual', techToken, report(slotIds[0]!, 'ORD1SERIAL01', 'FAIL', 'nonce-slot-one-0001'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reportId, alreadyRecorded: true });

    const units = await raw.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM listing.unit WHERE serial_number = 'ORD1SERIAL01'`;
    expect(units[0]!.n).toBe(1);
  });

  it('RENAME — a different serial for a named slot is refused, and nothing is written', async () => {
    const before = await raw.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM qc.qc_report`;
    const res = await post('/api/qc/reports/manual', techToken, report(slotIds[0]!, 'OTHERSERIAL9', 'FAIL', 'nonce-rename-attempt-1'));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already recorded as ORD1SERIAL01/);

    const after = await raw.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM qc.qc_report`;
    expect(after[0]!.n).toBe(before[0]!.n);
    const units = await raw.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM listing.unit WHERE serial_number = 'OTHERSERIAL9'`;
    expect(units[0]!.n).toBe(0);
  });
});

describe('LAST SLOT — slot 2 closes the visit and moves the order on', () => {
  it('settles the slot from the verdict the engine reached, and any machine that did not fail is RESERVED for the buyer again', async () => {
    const res = await post('/api/qc/reports/manual', techToken, report(slotIds[1]!, 'ORD1SERIAL02', 'PASS', 'nonce-slot-two-0002'));
    expect(res.status).toBe(200);
    expect(res.body.alreadyRecorded).toBe(false);

    const s = await slot(slotIds[1]!);
    expect(s.serial_number).toBe('ORD1SERIAL02');
    expect(s.inspected_at).not.toBeNull();
    const u = await unitOf(s.unit_id!);
    expect(u.qc_report_id).toBe(res.body.reportId);
    expect(s.qc_report_id).toBe(res.body.reportId);

    // `VerdictService` has the last word, and the slot records it: a
    // certified pass as QC_PASSED, a pass held for review as QC_MISMATCH.
    // Either way the machine goes back to the order as RESERVED — that is how
    // verification, the PO, the pickup and a refusal's release find an ordered
    // machine, and for an ordered machine the review the engine holds for is
    // ops verification itself. Which of the two this fixture reaches depends
    // on the engine's auto-approval rules, not on this flow, so both are
    // pinned; only a FAIL would keep the machine out.
    expect(['QC_PASSED', 'QC_MISMATCH']).toContain(s.status);
    expect(u.status).toBe('RESERVED');
  });

  it('closes the visit and puts the order in front of ops', async () => {
    const v = await visit();
    expect(v.status).toBe('COMPLETED');
    expect(v.completed_at).not.toBeNull();
    expect((await order()).status).toBe('AWAITING_VERIFICATION');

    const [ev] = await raw.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM ordering.order_event
       WHERE order_id = ${orderId}::uuid AND event_type = 'order.inspected'`;
    expect(ev?.n).toBe(1);

    const view = await get(`/api/qc/order-inspections/${visitId}`, opsToken);
    expect(view.body.unitsInspected).toBe(2);
    expect(view.body.slots.map((x: { serialNumber: string }) => x.serialNumber).sort()).toEqual(['ORD1SERIAL01', 'ORD1SERIAL02']);
  });
});

describe('SHAPE — a report names the machine exactly once', () => {
  it('refuses a report with neither a manifest line nor a slot', async () => {
    const body = report(slotIds[0]!, 'ANY', 'FAIL', 'nonce-shape-check-001');
    delete body.slotId;
    const res = await post('/api/qc/reports/manual', techToken, body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields.slotId).toMatch(/Name the machine once/);
  });

  it('refuses a report that names both', async () => {
    const body = { ...report(slotIds[0]!, 'ANY', 'FAIL', 'nonce-shape-check-002'), visitUnitId: randomUUID(), unitId: randomUUID() };
    const res = await post('/api/qc/reports/manual', techToken, body);
    expect(res.status).toBe(422);
  });
});
