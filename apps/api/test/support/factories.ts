import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { testDb } from './db';

/**
 * Test data factories. 04_TEST_PLAN.md §1.4.1.
 *
 * Each produces a **valid aggregate by default** — a test that wants a seal-less
 * unit or an expired inspection asks for it explicitly, and every other test gets
 * a unit that would really be sellable. That asymmetry is the point: the
 * interesting state has to be requested, never arrived at by accident.
 *
 * The insert order below is forced by the schema and is worth reading once:
 * a seal requires a QC report, a QC report requires a unit, and a unit requires
 * a listing. So the sealed-unit path is unit -> report -> seal -> back-fill
 * `unit.seal_id`, which is also the order the real QC verdict transaction uses.
 */

/** Stable ids for the personas in §1.4.2, so a test can reference them directly. */
export const PERSONA = {
  V_ALPHA: '11111111-0000-4000-8000-000000000001', // Gurugram, registered, REGULAR, GOLD
  V_BETA: '11111111-0000-4000-8000-000000000002', // Noida, registered, REGULAR, SILVER
  V_GAMMA: '11111111-0000-4000-8000-000000000003', // Faridabad, UNREGISTERED, MARGIN, no PAN
  B_ORG1: '22222222-0000-4000-8000-000000000001', // Delhi, prepaid
  B_ORG2: '22222222-0000-4000-8000-000000000002', // Haryana, credit + approval policy
} as const;

export interface SeededCatalog {
  brandId: string;
  seriesId: string;
  modelId: string;
  skuId: string;
}

export async function makeOrganization(
  overrides: Partial<{ id: string; org_type: string; legal_name: string; status: string }> = {},
  db: PrismaClient = testDb(),
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.organization (id, org_type, legal_name, status)
    VALUES (${id}::uuid,
            ${overrides.org_type ?? 'VENDOR'}::org_type,
            ${overrides.legal_name ?? 'Alpha Systems Pvt Ltd'},
            ${overrides.status ?? 'VERIFIED'}::org_status)
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

/** A dispatch address. It becomes `Dispatch From` on every e-way bill (Case 2). */
export async function makeAddress(
  orgId: string,
  overrides: Partial<{ city: string; state: string; state_code: string; pincode: string }> = {},
  db: PrismaClient = testDb(),
): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.org_address (id, org_id, type, line1, city, state, state_code, pincode,
                                      contact_name, contact_mobile, is_pickup_enabled)
    VALUES (${id}::uuid, ${orgId}::uuid, 'PICKUP'::address_type,
            'Plot 42, Udyog Vihar Phase IV',
            ${overrides.city ?? 'Gurugram'},
            ${overrides.state ?? 'Haryana'},
            ${overrides.state_code ?? '06'},
            ${overrides.pincode ?? '122015'},
            'Warehouse Supervisor', '+919876543210', TRUE)`;
  return id;
}

/**
 * The platform's own organisation. Technicians and ops staff belong to it.
 *
 * Note the vocabulary mismatch, resolved here once: the adopted schema's
 * `org_type` enum says INTERNAL where `_CONTEXT.md` says PLATFORM. The database
 * value is INTERNAL; the domain `Principal.orgType` is PLATFORM. Mapping at this
 * boundary is cheaper than an enum migration across 164 tables.
 */
export const PLATFORM_ORG_ID = '00000000-0000-4000-8000-00000000dead';

export async function ensurePlatformOrg(db: PrismaClient = testDb()): Promise<string> {
  return makeOrganization(
    { id: PLATFORM_ORG_ID, org_type: 'INTERNAL', legal_name: 'TrueTech Services Pvt. Ltd.' },
    db,
  );
}

export async function makeUser(
  orgId: string,
  overrides: Partial<{ email: string; full_name: string }> = {},
  db: PrismaClient = testDb(),
): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO identity.user_account (id, org_id, email, full_name, status)
    VALUES (${id}::uuid, ${orgId}::uuid,
            ${overrides.email ?? `user-${id.slice(0, 8)}@example.com`},
            ${overrides.full_name ?? 'Priya Sharma'},
            'ACTIVE')`;
  return id;
}

export async function makeTechnician(
  db: PrismaClient = testDb(),
): Promise<{ technicianId: string; userId: string }> {
  const platformOrgId = await ensurePlatformOrg(db);
  const userId = await makeUser(platformOrgId, { full_name: 'Rakesh Kumar' }, db);
  const technicianId = randomUUID();
  await db.$executeRaw`
    INSERT INTO qc.qc_technician (id, user_id, employee_code, home_pincode, zones, certified_tools)
    VALUES (${technicianId}::uuid, ${userId}::uuid,
            ${'TECH-' + technicianId.slice(0, 6).toUpperCase()},
            '122015', ARRAY['NCR'], ARRAY['DEVICESURE'])`;
  return { technicianId, userId };
}

export async function makeCatalog(
  overrides: Partial<{ brand: string; model: string; skuCode: string }> = {},
  db: PrismaClient = testDb(),
): Promise<SeededCatalog> {
  const brand = overrides.brand ?? 'Dell';
  const model = overrides.model ?? 'Latitude 5320';
  const brandId = randomUUID();
  const seriesId = randomUUID();
  const modelId = randomUUID();
  const skuId = randomUUID();
  const uniq = randomUUID().slice(0, 8);

  await db.$executeRaw`INSERT INTO catalog.brand (id, name, slug) VALUES (${brandId}::uuid, ${brand + ' ' + uniq}, ${'brand-' + uniq})`;
  await db.$executeRaw`INSERT INTO catalog.series (id, brand_id, name, slug) VALUES (${seriesId}::uuid, ${brandId}::uuid, 'Latitude', ${'latitude-' + uniq})`;
  await db.$executeRaw`INSERT INTO catalog.model (id, series_id, name) VALUES (${modelId}::uuid, ${seriesId}::uuid, ${model})`;
  await db.$executeRaw`
    INSERT INTO catalog.sku (id, model_id, sku_code, normalized_key, cpu_brand, cpu_family,
                             cpu_model, cpu_generation, ram_gb, storage_type, storage_gb,
                             gpu_type, screen_size_inch, resolution, is_touch, os_supported,
                             hsn_code, gst_rate)
    VALUES (${skuId}::uuid, ${modelId}::uuid,
            ${(overrides.skuCode ?? 'DEL-LAT5320-I5-16-512') + '-' + uniq},
            ${'dell|latitude_5320|core_i5|i5_1145g7|16|512|nvme_ssd|' + uniq},
            'Intel', 'Core i5', 'i5-1145G7', '11th', 16, 'NVME_SSD', 512,
            'INTEGRATED', 13.3, 'FHD', false, 'Windows 11 Pro', '84713010', 18)`;

  return { brandId, seriesId, modelId, skuId };
}

export async function makeListing(
  input: {
    vendorOrgId: string;
    skuId: string;
    pickupAddressId: string;
    grade?: string;
    qty?: number;
    status?: string;
    unitPrice?: number;
  },
  db: PrismaClient = testDb(),
): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO listing.listing (id, vendor_org_id, sku_id, pickup_location_id,
                                 grade, condition_type, battery_health_band, parts_status,
                                 unit_price, qty_total, status)
    VALUES (${id}::uuid, ${input.vendorOrgId}::uuid, ${input.skuId}::uuid,
            ${input.pickupAddressId}::uuid,
            ${input.grade ?? 'A'}::grade_type,
            'REFURBISHED'::condition_type,
            'GOOD_80_89'::battery_band,
            'ALL_ORIGINAL'::parts_status_type,
            ${input.unitPrice ?? 42000}, ${input.qty ?? 1},
            ${input.status ?? 'ACTIVE'}::listing_status)`;
  return id;
}

/**
 * A unit that is genuinely sellable: LISTED, QC passed, QC fresh, and sealed with
 * a photographed seal. Pass `sealed: false` to get the dangerous state on purpose.
 */
export async function makeUnit(
  input: {
    listingId: string;
    vendorOrgId: string;
    skuId: string;
    technicianId?: string;
    technicianUserId?: string;
    serial?: string;
    grade?: string;
    status?: string;
    sealed?: boolean;
    qcValidUntilDays?: number;
  },
  db: PrismaClient = testDb(),
): Promise<{ unitId: string; sealId: string | null; qcReportId: string | null; serial: string }> {
  const unitId = randomUUID();
  const serial = input.serial ?? randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const validDays = input.qcValidUntilDays ?? 60;
  const grade = input.grade ?? 'A';

  await db.$executeRaw`
    INSERT INTO listing.unit (id, listing_id, vendor_org_id, sku_id, serial_number,
                              grade_declared, grade_actual, status, location,
                              qc_passed_at, qc_valid_until)
    VALUES (${unitId}::uuid, ${input.listingId}::uuid, ${input.vendorOrgId}::uuid,
            ${input.skuId}::uuid, ${serial},
            ${grade}::grade_type, ${grade}::grade_type,
            ${input.status ?? 'LISTED'}::unit_status,
            'VENDOR',
            now(), CURRENT_DATE + ${validDays}::int)`;

  if (input.sealed === false) {
    return { unitId, sealId: null, qcReportId: null, serial };
  }

  const tech =
    input.technicianId && input.technicianUserId
      ? { technicianId: input.technicianId, userId: input.technicianUserId }
      : await makeTechnician(db);

  const qcReportId = randomUUID();
  await db.$executeRaw`
    INSERT INTO qc.qc_report (id, unit_id, technician_id, device_cert_id, agent_version,
                              started_at, completed_at, signature, nonce,
                              grade_final, qc_score, verdict, valid_until, is_current)
    VALUES (${qcReportId}::uuid, ${unitId}::uuid, ${tech.userId}::uuid,
            ${'CERT-' + qcReportId.slice(0, 8)}, '2.3.1',
            now() - interval '20 minutes', now(),
            ${'sig_' + qcReportId}, ${randomUUID()},
            ${grade}::grade_type, 92, 'PASS'::qc_verdict,
            CURRENT_DATE + ${validDays}::int, TRUE)`;

  const sealId = randomUUID();
  await db.$executeRaw`
    INSERT INTO qc.qc_seal (id, unit_id, qc_report_id, seal_code, applied_by, status,
                            applied_at, applied_photo_key)
    VALUES (${sealId}::uuid, ${unitId}::uuid, ${qcReportId}::uuid,
            ${'TRG-26HR-' + String(Math.floor(Math.random() * 9_999_999)).padStart(7, '0')},
            ${tech.technicianId}::uuid, 'APPLIED'::seal_status, now(),
            ${'qc/seals/' + unitId + '.jpg'})`;

  // Back-fill the pointer. This is the UPDATE that fires trg_recompute_sellable.
  await db.$executeRaw`UPDATE listing.unit SET seal_id = ${sealId}::uuid WHERE id = ${unitId}::uuid`;

  return { unitId, sealId, qcReportId, serial };
}

/**
 * Force a unit into a state the application would never write, by disabling the
 * trigger that would correct it. This is how a drift test creates real drift —
 * drift by definition is a state no code path produces on purpose.
 */
export async function forceUnitFlag(
  unitId: string,
  flags: { is_sellable?: boolean },
  db: PrismaClient = testDb(),
): Promise<void> {
  await db.$executeRawUnsafe('ALTER TABLE listing.unit DISABLE TRIGGER trg_recompute_sellable');
  try {
    if (flags.is_sellable !== undefined) {
      await db.$executeRaw`UPDATE listing.unit SET is_sellable = ${flags.is_sellable} WHERE id = ${unitId}::uuid`;
    }
  } finally {
    await db.$executeRawUnsafe('ALTER TABLE listing.unit ENABLE TRIGGER trg_recompute_sellable');
  }
}

export interface SeededUnit {
  vendorOrgId: string;
  pickupAddressId: string;
  skuId: string;
  listingId: string;
  unitId: string;
  serial: string;
  sealId: string | null;
  qcReportId: string | null;
}

/** A complete, valid, sellable vendor + catalog + listing + unit graph. */
export async function seedSellableUnit(
  overrides: {
    vendorOrgId?: string;
    sealed?: boolean;
    qcValidUntilDays?: number;
    grade?: string;
    status?: string;
  } = {},
  db: PrismaClient = testDb(),
): Promise<SeededUnit> {
  const vendorOrgId = overrides.vendorOrgId ?? (await makeOrganization({}, db));
  const pickupAddressId = await makeAddress(vendorOrgId, {}, db);
  const catalog = await makeCatalog({}, db);
  const listingId = await makeListing(
    { vendorOrgId, skuId: catalog.skuId, pickupAddressId, grade: overrides.grade },
    db,
  );
  const unit = await makeUnit(
    {
      listingId,
      vendorOrgId,
      skuId: catalog.skuId,
      grade: overrides.grade,
      status: overrides.status,
      sealed: overrides.sealed,
      qcValidUntilDays: overrides.qcValidUntilDays,
    },
    db,
  );
  return { vendorOrgId, pickupAddressId, skuId: catalog.skuId, listingId, ...unit };
}
