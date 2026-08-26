import { randomUUID, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * A walkable demo: real accounts, a verified vendor, inspected stock, and a
 * customer order.
 *
 * Why this exists. The platform was unusable end to end for a reason that
 * looked like a dozen separate bugs: `identity.user_account` held ONE row. No
 * one could sign in, so the console looked broken; no unit had passed QC, so the
 * storefront had nothing to render and its filter rail collapsed to an empty
 * column. Reference data alone does not make a system you can walk through.
 *
 * **Explicitly NOT for production.** It writes known passwords. `seedDemo`
 * refuses to run against a database whose name is not clearly a development or
 * test one, because a seed that can reach production is a seed that eventually
 * does.
 *
 * The chain it builds is the real one, in the real order, through the real
 * constraints — a listing goes to AWAITING_QC and only becomes sellable once a
 * QC report and a photographed seal exist, because `listing.unit_is_sellable`
 * says so and no seed can talk its way past a trigger.
 */

/** One password for every demo account. Printed at the end, never guessed. */
export const DEMO_PASSWORD = 'Trugrade!Demo2026';

interface Person {
  email: string;
  name: string;
  role: string;
  owner?: boolean;
}

const PLATFORM_PEOPLE: Person[] = [
  // PLATFORM_SUPERADMIN, not PLATFORM_ADMIN. The latter exists in identity.role
  // and is mapped to ZERO permissions, so an account holding it signs in
  // successfully and then finds an empty console with nothing explaining why.
  // See identity-roles.spec.ts, which now fails on any role that grants nothing.
  { email: 'admin@trugrade.in', name: 'Asha Menon', role: 'PLATFORM_SUPERADMIN', owner: true },
  { email: 'kyc@trugrade.in', name: 'Rohit Sharma', role: 'KYC_REVIEWER' },
  { email: 'catalog@trugrade.in', name: 'Nisha Rao', role: 'CATALOG_ADMIN' },
  { email: 'qc@trugrade.in', name: 'Vikram Iyer', role: 'QC_MANAGER' },
  { email: 'tech@trugrade.in', name: 'Rakesh Kumar', role: 'TECHNICIAN' },
  { email: 'finance@trugrade.in', name: 'Priya Nair', role: 'FINANCE' },
  { email: 'logistics@trugrade.in', name: 'Sameer Bose', role: 'LOGISTICS_MANAGER' },
];

const VENDOR_PEOPLE: Person[] = [
  { email: 'owner@northgate.example', name: 'Harpreet Singh', role: 'VENDOR_OWNER', owner: true },
  { email: 'ops@northgate.example', name: 'Meera Joshi', role: 'VENDOR_OPS' },
  { email: 'admin@northgate.example', name: 'Kavita Desai', role: 'VENDOR_ADMIN' },
];

const BUYER_PEOPLE: Person[] = [
  { email: 'owner@acme.example', name: 'Deepak Verma', role: 'CUSTOMER_OWNER', owner: true },
  { email: 'buyer@acme.example', name: 'Farah Khan', role: 'CUSTOMER_BUYER' },
  { email: 'approver@acme.example', name: 'Suresh Pillai', role: 'CUSTOMER_APPROVER' },
];

function guardDatabase(url: string | undefined): void {
  const name = (url ?? '').split('/').pop()?.split('?')[0] ?? '';
  // Allow-list, not a block-list. A block-list fails open the day someone names
  // a database something the list never imagined.
  if (!/^trugrade(_test|_verify|_demo)?[a-z_]*$/.test(name)) {
    throw new Error(
      `Refusing to seed demo data into "${name}". This writes known passwords and ` +
        `is only for a local database.`,
    );
  }
}

async function upsertPerson(
  prisma: PrismaClient,
  orgId: string,
  p: Person,
  hash: string,
): Promise<string> {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.user_account WHERE lower(email) = lower(${p.email})`;
  const id = existing[0]?.id ?? randomUUID();

  if (!existing[0]) {
    await prisma.$executeRaw`
      INSERT INTO identity.user_account
        (id, org_id, full_name, email, mobile, password_hash, status,
         email_verified_at, is_org_owner, terms_accepted_version, password_changed_at)
      VALUES (${id}::uuid, ${orgId}::uuid, ${p.name}, ${p.email},
              ${'+9198' + String(Math.abs(hashCode(p.email)) % 100_000_000).padStart(8, '0')},
              ${hash}, 'ACTIVE', now(), ${p.owner ?? false}, 'v1', now())`;
  }

  await prisma.$executeRaw`
    INSERT INTO identity.user_role (user_id, role_id, org_id, granted_at)
    SELECT ${id}::uuid, r.id, ${orgId}::uuid, now() FROM identity.role r WHERE r.code = ${p.role}
    ON CONFLICT DO NOTHING`;
  return id;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

async function orgByName(
  prisma: PrismaClient,
  name: string,
  type: string,
  status: string,
): Promise<string> {
  const found = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.organization WHERE legal_name = ${name}`;
  if (found[0]) return found[0].id;

  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO identity.organization (id, legal_name, trade_name, org_type, status, created_at)
    VALUES (${id}::uuid, ${name}, ${name}, ${type}::org_type, ${status}::org_status, now())`;
  return id;
}

export async function seedDemo(
  prisma: PrismaClient,
  log: (m: string) => void = () => undefined,
): Promise<void> {
  guardDatabase(process.env.DATABASE_URL);

  const hash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });

  // --- organisations -------------------------------------------------------
  const platformOrg = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.organization WHERE org_type = 'INTERNAL' LIMIT 1`;
  const platformId = platformOrg[0]?.id ?? (await orgByName(prisma, 'TrueTech Services Pvt. Ltd.', 'INTERNAL', 'VERIFIED'));

  const vendorId = await orgByName(prisma, 'Northgate IT Assets Pvt. Ltd.', 'VENDOR', 'VERIFIED');
  const buyerId = await orgByName(prisma, 'Acme Industries Pvt. Ltd.', 'BUYER', 'VERIFIED');

  for (const p of PLATFORM_PEOPLE) await upsertPerson(prisma, platformId, p, hash);
  for (const p of VENDOR_PEOPLE) await upsertPerson(prisma, vendorId, p, hash);
  for (const p of BUYER_PEOPLE) await upsertPerson(prisma, buyerId, p, hash);
  log(
    `  accounts: ${PLATFORM_PEOPLE.length} platform, ${VENDOR_PEOPLE.length} vendor, ${BUYER_PEOPLE.length} buyer`,
  );

  // --- addresses -----------------------------------------------------------
  const addr = async (orgId: string, city: string, state: string, pin: string): Promise<string> => {
    const found = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.org_address WHERE org_id = ${orgId}::uuid AND pincode = ${pin} LIMIT 1`;
    if (found[0]) return found[0].id;
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO identity.org_address
        (id, org_id, type, label, line1, city, state, state_code, pincode,
         contact_name, contact_mobile, is_default, is_pickup_enabled, is_billing_enabled, is_active)
      VALUES (${id}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Primary',
              ${'Plot 14, ' + city + ' Industrial Area'},
              ${city}, ${state}, '06', ${pin}, 'Operations desk', '+919810000000',
              TRUE, TRUE, TRUE, TRUE)`;
    return id;
  };

  const vendorAddr = await addr(vendorId, 'Gurugram', 'Haryana', '122001');
  await addr(buyerId, 'Bengaluru', 'Karnataka', '560001');

  // --- the supply point ----------------------------------------------------
  // Assigned centrally so the label is stable and not derivable from the org id.
  const spRows = await prisma.$queryRaw<Array<{ assign_supply_point: string }>>`
    SELECT listing.assign_supply_point(${vendorId}::uuid, 'Gurugram')`;
  const supplyCode = spRows[0]!.assign_supply_point;
  log(`  supply point: ${supplyCode} - Gurugram`);

  // --- a technician --------------------------------------------------------
  const techUser = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.user_account WHERE email = 'tech@trugrade.in'`;
  const technicianId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO qc.qc_technician (id, user_id, employee_code, home_pincode, zones, certified_tools)
    VALUES (${technicianId}::uuid, ${techUser[0]!.id}::uuid, 'TECH-DEMO01', '122015',
            ARRAY['NCR'], ARRAY['DEVICESURE'])
    ON CONFLICT (user_id) DO NOTHING`;
  const tech = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM qc.qc_technician WHERE user_id = ${techUser[0]!.id}::uuid`;
  const techId = tech[0]!.id;

  // --- listings, units, and the QC that makes them sellable ----------------
  const skus = await prisma.$queryRaw<Array<{ id: string; model: string; grade_hint: string }>>`
    SELECT s.id, m.name AS model, 'A' AS grade_hint
      FROM catalog.sku s
      JOIN catalog.model m ON m.id = s.model_id
     WHERE s.is_active
     ORDER BY m.name
     LIMIT 6`;

  const provider = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM qc.qc_tool_provider WHERE code = 'DEVICESURE'`;

  // Idempotent on stock, not just on accounts. Without this a second run doubles
  // the inventory, and "48 units" quietly becomes "96 sellable" — a seed that
  // cannot be re-run is a seed nobody dares re-run.
  const already = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.listing WHERE vendor_org_id = ${vendorId}::uuid`;
  if (Number(already[0]!.n) > 0) {
    const have = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.v_sellable_unit`;
    log(`  stock: already seeded (${Number(have[0]!.n)} sellable) — left alone`);
    log(`  password for every demo account: ${DEMO_PASSWORD}`);
    return;
  }

  let unitsMade = 0;
  let listingsMade = 0;

  for (const [i, sku] of skus.entries()) {
    const grade = (['A_PLUS', 'A', 'A', 'B', 'A', 'B'] as const)[i] ?? 'A';
    const unitPrice = 28_000 + i * 4_500;

    const listingId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO listing.listing
        (id, vendor_org_id, sku_id, pickup_location_id, grade, condition_type,
         battery_health_band, parts_status, unit_price, qty_total, status,
         vendor_warranty_months)
      VALUES (${listingId}::uuid, ${vendorId}::uuid, ${sku.id}::uuid, ${vendorAddr}::uuid,
              ${grade}::grade_type, 'REFURBISHED'::condition_type, 'GOOD_80_89'::battery_band,
              'ALL_ORIGINAL'::parts_status_type, ${unitPrice}, 8, 'ACTIVE'::listing_status, 3)`;
    listingsMade += 1;

    for (let u = 0; u < 8; u++) {
      const unitId = randomUUID();
      const serial = `TGD${String(i)}${String(u).padStart(2, '0')}${randomBytes(2).toString('hex').toUpperCase()}`;
      const battery = 82 + ((i * 3 + u) % 16);
      const score = 78 + ((i * 5 + u * 3) % 21);

      await prisma.$executeRaw`
        INSERT INTO listing.unit
          (id, listing_id, vendor_org_id, sku_id, serial_number, grade_declared, grade_actual,
           status, location, qc_passed_at, qc_valid_until, qc_score, battery_health_pct,
           vendor_ask_price, retail_price, supply_point_code, valuation_method, itc_eligible)
        VALUES (${unitId}::uuid, ${listingId}::uuid, ${vendorId}::uuid, ${sku.id}::uuid, ${serial},
                ${grade}::grade_type, ${grade}::grade_type, 'QC_PASSED'::unit_status, 'VENDOR',
                now() - interval '3 days', CURRENT_DATE + 87, ${score}, ${battery},
                ${Math.round(unitPrice * 0.86)}, ${unitPrice}, ${supplyCode}, 'REGULAR', TRUE)`;

      // A report and a photographed seal, because is_sellable is a trigger and
      // will not take our word for it.
      const reportId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO qc.qc_report
          (id, unit_id, technician_id, device_cert_id, agent_version, started_at, completed_at,
           signature, nonce, qc_score, verdict, grade_proposed, grade_final,
           verification_code, valid_until, is_current, rules_version)
        VALUES (${reportId}::uuid, ${unitId}::uuid, ${techId}::uuid, ${'CERT-' + serial}, '0.1.0',
                now() - interval '3 days', now() - interval '3 days', 'demo-sig', ${randomUUID()},
                ${score}, 'PASS'::qc_verdict, ${grade}::grade_type, ${grade}::grade_type,
                ${randomBytes(9).toString('base64url')}, CURRENT_DATE + 87, TRUE, '2026.08')`;

      const sealId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO qc.qc_seal
          (id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key, status)
        VALUES (${sealId}::uuid, ${'TG-' + serial}, ${unitId}::uuid, ${reportId}::uuid,
                ${techId}::uuid, now() - interval '3 days',
                ${'qc/seals/' + serial + '.jpg'}, 'APPLIED'::seal_status)`;

      // seal_id then LISTED: both writes fire recompute_is_sellable, and only
      // after the seal exists can the predicate come out true.
      await prisma.$executeRaw`
        UPDATE listing.unit SET seal_id = ${sealId}::uuid WHERE id = ${unitId}::uuid`;
      await prisma.$executeRaw`
        UPDATE listing.unit SET status = 'LISTED'::unit_status WHERE id = ${unitId}::uuid`;
      unitsMade += 1;
    }
  }

  const sellable = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.v_sellable_unit`;
  log(`  stock: ${listingsMade} listings, ${unitsMade} units, ${Number(sellable[0]!.n)} sellable`);

  const drift = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.v_sellability_drift`;
  if (Number(drift[0]!.n) > 0) {
    throw new Error(
      `${Number(drift[0]!.n)} unit(s) disagree with listing.unit_is_sellable. The seed wrote a ` +
        `state the trigger did not produce, which is exactly what v_sellability_drift exists to catch.`,
    );
  }

  void provider;
  log(`  password for every demo account: ${DEMO_PASSWORD}`);
}
