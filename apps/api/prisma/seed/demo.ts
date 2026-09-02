import { randomUUID, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppConfig } from '../../src/shared/config';
import { SystemClock } from '../../src/shared/clock';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { RequestContextService } from '../../src/shared/db/org-scope';
import { EventBus } from '../../src/shared/events/event-bus';
import { QcRepository, generateVerificationCode } from '../../src/modules/qc/internal/qc.repository';
import { VendorQualityService } from '../../src/modules/qc/internal/vendor-quality.service';
import { seedQcEvidence } from './qc-evidence';
import { seedQcSpread } from './qc-spread';

/**
 * A walkable demo: real accounts, verified vendors, inspected stock, and enough
 * of it that the supply-point comparison grid has something to compare.
 *
 * Why this exists. The platform was unusable end to end for a reason that
 * looked like a dozen separate bugs: `identity.user_account` held ONE row. No
 * one could sign in, so the console looked broken; no unit had passed QC, so the
 * storefront had nothing to render and its filter rail collapsed to an empty
 * column. Reference data alone does not make a system you can walk through.
 *
 * Why it has ten vendors rather than one. PHASE_05 Task 4 — the most load-bearing
 * screen in the product — compares every supply point offering one SKU on landed
 * price, average QC score, grade accuracy and total warranty. With a single
 * vendor that screen is a one-row table, and every bug in it (a bad sort, a
 * headline that should have been suppressed, a leaked identity) is invisible.
 * The differences below are therefore deliberate, not decorative: scores that
 * genuinely differ, one supply point under the sample threshold, batteries that
 * were never measured, QC that lapsed, a seal found broken, and both GST
 * valuation methods.
 *
 * **Explicitly NOT for production.** It writes known passwords. `seedDemo`
 * refuses to run against a database whose name is not clearly a development or
 * test one, because a seed that can reach production is a seed that eventually
 * does.
 *
 * The chain it builds is the real one, in the real order, through the real
 * constraints — a unit only becomes sellable once a QC report and a photographed
 * seal exist, because `listing.unit_is_sellable` says so and no seed can talk its
 * way past a trigger.
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
  // OPS_MANAGER holds `kyc.application.read` and NOT `kyc.document.read`, which
  // is the split the onboarding record screen is built around: they see that an
  // application is late and who it belongs to, and they do not see the
  // director's Aadhaar. With no such account on the demo database that branch —
  // "you are not cleared for this applicant's documents" — could only be
  // photographed by faking a 403, which is the same as not photographing it.
  // Also the only demo login for the ops dashboard's own slice.
  { email: 'ops@trugrade.in', name: 'Anand Krishnan', role: 'OPS_MANAGER' },
  { email: 'catalog@trugrade.in', name: 'Nisha Rao', role: 'CATALOG_ADMIN' },
  // T38. `/admin/pricing/rules` is guarded by `listing.price.override`, which is
  // held by PRICING_ADMIN and PLATFORM_SUPERADMIN and nobody else — and the
  // superadmin needs MFA. So until this row existed the margin-rule screen was
  // unreachable on the demo database by every account that could sign in, which
  // is the same shape of gap as the missing rider in T23.
  { email: 'pricing@trugrade.in', name: 'Meera Raghavan', role: 'PRICING_ADMIN' },
  { email: 'qc@trugrade.in', name: 'Vikram Iyer', role: 'QC_MANAGER' },
  { email: 'tech@trugrade.in', name: 'Rakesh Kumar', role: 'TECHNICIAN' },
  { email: 'finance@trugrade.in', name: 'Priya Nair', role: 'FINANCE' },
  { email: 'logistics@trugrade.in', name: 'Sameer Bose', role: 'LOGISTICS_MANAGER' },
  // T39. 03_UX_SPEC §3C.4 gives the order board to ADMIN_OPS *and* ADMIN_SUPPORT
  // ("read + notes"), and no SUPPORT account existed — so the read-only support
  // view of an order was unreachable on the demo database, and both accounts
  // that could reach the board at all (OPS_MANAGER, FINANCE) need MFA. Same
  // shape of gap as the missing rider in T23 and the missing pricing admin in
  // T38. The slice is also the interesting one: SUPPORT holds
  // `ordering.any.read` and NOT `procurement.po.read_any`, so it gets the order
  // board and the record and is refused the purchase-order board — which is
  // exactly the division §3C.4 describes, photographed rather than asserted.
  { email: 'support@trugrade.in', name: 'Farida Sheikh', role: 'SUPPORT' },
  // The only role carrying `logistics.delivery.execute`, which is what marks an
  // order delivered — and delivery is what starts a warranty and opens the
  // 48-hour inspection window (T23/T24). Without a rider on the demo database
  // the after-sale half of the product is unreachable by anyone who is not a
  // superadmin, and a superadmin needs MFA to get past the guard.
  { email: 'rider@trugrade.in', name: 'Imran Qureshi', role: 'RIDER' },
];

/**
 * When the demo says a unit was inspected.
 *
 * Three days ago, but never BEFORE the tolerance rules came into force. The
 * report route refuses to print a grade it cannot defend — "no QC tolerance
 * rules were in force on this date" is a 412 — and it is right to: a grade is
 * our claim under CP e-Comm r.7(5), and one derived from rules that did not
 * exist yet is a claim we could not stand behind.
 *
 * The rules are seeded effective from the migration day, so a flat "three days
 * ago" put every demo report before them and made /unit/:serial/report.pdf
 * return 412 for every unit on the platform. The refusal was correct; the seed
 * was wrong. This clamps the story to the rules rather than loosening the rule
 * to fit the story.
 */
const INSPECTED_AT = Prisma.sql`
  GREATEST(now() - interval '3 days',
    (SELECT min(effective_from)::timestamptz FROM qc.qc_tolerance_rule))`;

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

type Grade = 'A_PLUS' | 'A' | 'B';
type Valuation = 'REGULAR' | 'MARGIN';

/**
 * A vendor and the one NCR city it supplies from.
 *
 * `scoreBase` and `batteryBase` are the centre of the band its machines come
 * back from inspection in. They differ per vendor because the comparison grid
 * exists to show that difference; a demo where every supply point scores 88 is a
 * demo in which a broken quality column looks correct.
 */
interface VendorSpec {
  legalName: string;
  city: string;
  state: string;
  /** GST state code — the same two digits the invoice carries. */
  stateCode: string;
  pincode: string;
  /**
   * MARGIN means the vendor is unregistered and we resell under GST Rule 32(5),
   * which leaves the buyer thinner input credit. PHASE_05 Task 5 requires that
   * to be labelled on the offer, so the demo has to contain some.
   */
  valuation: Valuation;
  /** Vendor-funded months. We top it up; the buyer is shown only the total. */
  warrantyMonths: number;
  scoreBase: number;
  batteryBase: number;
  /**
   * A Udyam registration number, on the vendors that have one.
   *
   * It makes this supplier an MSME, and s.15 of the MSMED Act 2006 then binds us
   * to pay within 45 days of the goods being accepted — a statutory deadline with
   * compound interest behind it, not a payout cycle. `/vendor/payables` shows a
   * different clock depending on it, and with `vendor.vendor_profile` holding no
   * rows at all neither branch could be reached through the product. One vendor
   * carries one so both can be.
   */
  udyam?: string;
}

const NORTHGATE = 'Northgate IT Assets Pvt. Ltd.';
const UDYOG = 'Udyog Vihar Endpoint Services Pvt. Ltd.';
const SECTOR62 = 'Sector 62 Refurb Works Pvt. Ltd.';
const PHASE2 = 'Noida Phase II Recommerce Pvt. Ltd.';
const OKHLA = 'Okhla Asset Recovery LLP';
const MAYAPURI = 'Mayapuri IT Exchange Pvt. Ltd.';
const FARIDABAD = 'Faridabad TechCycle Pvt. Ltd.';
const GHAZIABAD = 'Ghaziabad Device Renew Pvt. Ltd.';
const SONIPAT = 'Sonipat Green Assets Pvt. Ltd.';
const PALWAL = 'Palwal Asset Traders Pvt. Ltd.';

const VENDORS: readonly VendorSpec[] = [
  // Two vendors each in Gurugram, Noida and Delhi. `listing.supply_point` is
  // unique on (city, code), so this is what proves "Supply Point A" names a
  // different vendor in a different city rather than the same one twice.
  { legalName: NORTHGATE, city: 'Gurugram', state: 'Haryana', stateCode: '06', pincode: '122001', valuation: 'REGULAR', warrantyMonths: 3, scoreBase: 88, batteryBase: 89 },
  { legalName: UDYOG, city: 'Gurugram', state: 'Haryana', stateCode: '06', pincode: '122015', valuation: 'REGULAR', warrantyMonths: 3, scoreBase: 79, batteryBase: 83 },
  { legalName: SECTOR62, city: 'Noida', state: 'Uttar Pradesh', stateCode: '09', pincode: '201309', valuation: 'REGULAR', warrantyMonths: 6, scoreBase: 93, batteryBase: 92 },
  { legalName: PHASE2, city: 'Noida', state: 'Uttar Pradesh', stateCode: '09', pincode: '201310', valuation: 'REGULAR', warrantyMonths: 3, scoreBase: 91, batteryBase: 90 },
  { legalName: OKHLA, city: 'New Delhi', state: 'Delhi', stateCode: '07', pincode: '110020', valuation: 'MARGIN', warrantyMonths: 0, scoreBase: 85, batteryBase: 87 },
  { legalName: MAYAPURI, city: 'New Delhi', state: 'Delhi', stateCode: '07', pincode: '110092', valuation: 'REGULAR', warrantyMonths: 3, scoreBase: 74, batteryBase: 78 },
  { legalName: FARIDABAD, city: 'Faridabad', state: 'Haryana', stateCode: '06', pincode: '121001', valuation: 'REGULAR', warrantyMonths: 6, scoreBase: 90, batteryBase: 91, udyam: 'UDYAM-HR-05-0042317' },
  { legalName: GHAZIABAD, city: 'Ghaziabad', state: 'Uttar Pradesh', stateCode: '09', pincode: '201001', valuation: 'REGULAR', warrantyMonths: 0, scoreBase: 82, batteryBase: 85 },
  { legalName: SONIPAT, city: 'Sonipat', state: 'Haryana', stateCode: '06', pincode: '131001', valuation: 'MARGIN', warrantyMonths: 3, scoreBase: 87, batteryBase: 88 },
  // Palwal is an ODA lane, so it also gives the freight quote a surcharged origin.
  { legalName: PALWAL, city: 'Palwal', state: 'Haryana', stateCode: '06', pincode: '121102', valuation: 'REGULAR', warrantyMonths: 0, scoreBase: 86, batteryBase: 86 },
];

/**
 * The SKU every supply point stocks. PHASE_05's exit criterion names a Dell
 * Latitude; the catalog carries the 5420 rather than the 5320, and what the
 * criterion is really about is the shape — ten supply points, one SKU, one grade.
 */
const HERO_SKU = 'DEL-LAT5420-I51135G7-16-512';

/** Stocked by three supply points, so the grid is exercised at a second width. */
const SECOND_SKU = 'DEL-LAT7420-I51145G7-16-256';

/**
 * One offer: a listing, its units, and the ways this particular batch is
 * imperfect. Every optional field exists because some state of the storefront is
 * otherwise unreachable, and an unreachable state is an untested one.
 */
interface OfferSpec {
  vendor: string;
  skuCode: string;
  grade: Grade;
  units: number;
  /** Our retail price. Vendors deliberately do not rank the same on price and on quality. */
  price: number;
  /**
   * Units this vendor declared one grade higher that inspection marked down.
   * These are what make `grade_accuracy_pct` less than 100 for the bucket.
   */
  corrections?: number;
  /**
   * Units whose battery the agent could not read. A missing measurement must
   * render as "Not measured", never as a zero and never as a pass, so at least
   * one has to exist.
   */
  unmeasured?: number;
  /** Units whose QC lapsed yesterday. They stay LISTED; the predicate drops them. */
  expired?: number;
  /** A unit whose tamper seal was found broken. Also LISTED, also dropped. */
  brokenSeal?: number;
}

/**
 * The hero SKU at grade A, from all ten supply points.
 *
 * Unit counts straddle `qc.min_sample_for_headline` (seeded at 10) on purpose:
 * Palwal's three inspected machines must render as "New supplier · 3 units
 * inspected". Publishing an average computed on three machines is OUR
 * misrepresentation under CP e-Comm r.7(2), so the suppressed state is a
 * compliance path and needs a fixture like any other.
 */
const HERO_OFFERS: readonly OfferSpec[] = [
  { vendor: NORTHGATE, skuCode: HERO_SKU, grade: 'A', units: 12, price: 47_500, corrections: 1 },
  { vendor: UDYOG, skuCode: HERO_SKU, grade: 'A', units: 11, price: 44_900, corrections: 3 },
  { vendor: SECTOR62, skuCode: HERO_SKU, grade: 'A', units: 14, price: 52_000 },
  { vendor: PHASE2, skuCode: HERO_SKU, grade: 'A', units: 12, price: 51_000, unmeasured: 2 },
  { vendor: OKHLA, skuCode: HERO_SKU, grade: 'A', units: 10, price: 43_500, corrections: 1 },
  { vendor: MAYAPURI, skuCode: HERO_SKU, grade: 'A', units: 12, price: 41_900, corrections: 2, expired: 2 },
  { vendor: FARIDABAD, skuCode: HERO_SKU, grade: 'A', units: 13, price: 53_500 },
  { vendor: GHAZIABAD, skuCode: HERO_SKU, grade: 'A', units: 10, price: 46_000, corrections: 1, brokenSeal: 1 },
  { vendor: SONIPAT, skuCode: HERO_SKU, grade: 'A', units: 11, price: 45_200, corrections: 1, unmeasured: 1 },
  { vendor: PALWAL, skuCode: HERO_SKU, grade: 'A', units: 3, price: 48_000 },
];

/** The same SKU at other inspected grades, and a second multi-vendor SKU. */
const OVERLAP_OFFERS: readonly OfferSpec[] = [
  { vendor: NORTHGATE, skuCode: HERO_SKU, grade: 'A_PLUS', units: 4, price: 60_000 },
  { vendor: SECTOR62, skuCode: HERO_SKU, grade: 'A_PLUS', units: 5, price: 61_000 },
  { vendor: FARIDABAD, skuCode: HERO_SKU, grade: 'A_PLUS', units: 4, price: 62_500 },

  { vendor: MAYAPURI, skuCode: HERO_SKU, grade: 'B', units: 6, price: 35_900 },
  { vendor: GHAZIABAD, skuCode: HERO_SKU, grade: 'B', units: 5, price: 36_500 },
  { vendor: OKHLA, skuCode: HERO_SKU, grade: 'B', units: 5, price: 36_900 },

  { vendor: NORTHGATE, skuCode: SECOND_SKU, grade: 'A', units: 5, price: 68_000 },
  { vendor: SECTOR62, skuCode: SECOND_SKU, grade: 'A', units: 5, price: 71_000 },
  { vendor: FARIDABAD, skuCode: SECOND_SKU, grade: 'A', units: 4, price: 69_500 },
];

/**
 * One SKU each, stocked by exactly one supply point.
 *
 * Two jobs: the filter rail needs more than three models behind it, and the grid
 * has to be right at width one as well as at width ten — a "comparison" of a
 * single supply point is the commonest real case and the easiest to get wrong.
 */
const SOLO_OFFERS: readonly OfferSpec[] = [
  { vendor: NORTHGATE, skuCode: 'LEN-T14G2-I51135G7-16-256', grade: 'A', units: 4, price: 38_500 },
  { vendor: UDYOG, skuCode: 'LEN-X1C9-I51135G7-16-1024', grade: 'A', units: 4, price: 74_000 },
  { vendor: SECTOR62, skuCode: 'HP-EB840G8-I51135G7-16-256', grade: 'A', units: 4, price: 49_500 },
  { vendor: PHASE2, skuCode: 'APL-MBAM1-M1-16-256', grade: 'A_PLUS', units: 4, price: 62_000 },
  { vendor: OKHLA, skuCode: 'DEL-XPS139310-I51135G7-16-512', grade: 'A', units: 4, price: 58_000 },
  { vendor: MAYAPURI, skuCode: 'ACR-SF314511-I51135G7-16-512', grade: 'B', units: 4, price: 27_500 },
  { vendor: FARIDABAD, skuCode: 'HP-ZBFF14G8-I51145G7-16-512', grade: 'A', units: 4, price: 81_000 },
  { vendor: GHAZIABAD, skuCode: 'ASU-UX425EA-I51135G7-16-1024', grade: 'A', units: 4, price: 43_000 },
  { vendor: SONIPAT, skuCode: 'LEN-E14G3-RYZEN55500U-16-512', grade: 'B', units: 4, price: 31_500 },
  { vendor: PALWAL, skuCode: 'MSF-SL4135-I51135G7-16-512', grade: 'A', units: 4, price: 46_500 },
];

const OFFERS: readonly OfferSpec[] = [...HERO_OFFERS, ...OVERLAP_OFFERS, ...SOLO_OFFERS];

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

/**
 * A vendor's pickup address, **and the facility behind it**.
 *
 * The second insert is not decoration. `identity.org_address` is where a lorry
 * goes; `vendor.vendor_facility` is what makes it somewhere we can send a
 * technician, and `SubmitService.facilityAt` refuses any listing whose pickup
 * address has no facility row. Without it the seed produced vendors who could
 * fill in the whole listing wizard and never once reach an inspection — the
 * success state was unreachable for every vendor in the database. Found by T27
 * trying to photograph it.
 */
async function addr(
  prisma: PrismaClient,
  orgId: string,
  city: string,
  state: string,
  stateCode: string,
  pin: string,
): Promise<string> {
  const found = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.org_address WHERE org_id = ${orgId}::uuid AND pincode = ${pin} LIMIT 1`;
  const id = found[0]?.id ?? randomUUID();
  if (!found[0]) {
    await prisma.$executeRaw`
      INSERT INTO identity.org_address
        (id, org_id, type, label, line1, city, state, state_code, pincode,
         contact_name, contact_mobile, is_default, is_pickup_enabled, is_billing_enabled, is_active)
      VALUES (${id}::uuid, ${orgId}::uuid, 'PICKUP'::address_type, 'Primary',
              ${'Plot 14, ' + city + ' Industrial Area'},
              ${city}, ${state}, ${stateCode}, ${pin}, 'Operations desk', '+919810000000',
              TRUE, TRUE, TRUE, TRUE)`;
  }

  await prisma.$executeRaw`
    INSERT INTO vendor.vendor_facility
      (org_id, address_id, facility_type, has_loading_dock, testing_stations)
    VALUES (${orgId}::uuid, ${id}::uuid, 'WAREHOUSE', TRUE, 2)
    ON CONFLICT (address_id) DO NOTHING`;
  return id;
}

/** A vendor as the stock loop needs it: identity resolved, label assigned. */
interface ResolvedVendor {
  spec: VendorSpec;
  orgId: string;
  addressId: string;
  supplyCode: string;
}

/** The band the listing advertises, from the band its units actually come back in. */
function batteryBand(pct: number): string {
  if (pct >= 90) return 'EXCELLENT_90_PLUS';
  if (pct >= 80) return 'GOOD_80_89';
  if (pct >= 70) return 'FAIR_70_79';
  return 'LOW_BELOW_70';
}

/** The grade a vendor claimed before inspection marked the unit down. */
function declaredAbove(grade: Grade): Grade {
  return grade === 'B' ? 'A' : 'A_PLUS';
}

/**
 * One listing, its units, their reports and their seals.
 *
 * Returns 0 without writing anything if this vendor already lists this SKU at
 * this grade. Idempotency is keyed on the offer rather than on "does this vendor
 * have any stock at all", so a new supply point can be grown onto a database
 * that has already been seeded — which is the situation every developer with a
 * running dev database is actually in.
 */
async function seedOffer(
  prisma: PrismaClient,
  vendor: ResolvedVendor,
  techId: string,
  offer: OfferSpec,
): Promise<number> {
  const sku = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM catalog.sku WHERE sku_code = ${offer.skuCode}`;
  if (!sku[0]) {
    throw new Error(`The demo seed wants SKU ${offer.skuCode}, which the catalog has not got.`);
  }
  const skuId = sku[0].id;

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM listing.listing
     WHERE vendor_org_id = ${vendor.orgId}::uuid
       AND sku_id = ${skuId}::uuid
       AND grade = ${offer.grade}::grade_type`;
  if (existing[0]) return 0;

  const listingId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO listing.listing
      (id, vendor_org_id, sku_id, pickup_location_id, grade, condition_type,
       battery_health_band, parts_status, unit_price, qty_total, status,
       vendor_warranty_months)
    VALUES (${listingId}::uuid, ${vendor.orgId}::uuid, ${skuId}::uuid, ${vendor.addressId}::uuid,
            ${offer.grade}::grade_type, 'REFURBISHED'::condition_type,
            ${batteryBand(vendor.spec.batteryBase)}::battery_band,
            'ALL_ORIGINAL'::parts_status_type, ${offer.price}, ${offer.units},
            'ACTIVE'::listing_status, ${vendor.spec.warrantyMonths})`;

  for (let u = 0; u < offer.units; u++) {
    const corrected = u < (offer.corrections ?? 0);
    const unmeasured = u >= offer.units - (offer.unmeasured ?? 0);
    const lapsed = u < (offer.expired ?? 0);
    const broken = u === offer.units - 1 && (offer.brokenSeal ?? 0) > 0;

    const unitId = randomUUID();
    const serial = `TGD${randomBytes(4).toString('hex').toUpperCase()}`;
    const battery = unmeasured ? null : vendor.spec.batteryBase - 3 + ((u * 5) % 8);
    const score = Math.min(100, Math.max(0, vendor.spec.scoreBase - 4 + ((u * 3) % 9)));
    const declared: Grade = corrected ? declaredAbove(offer.grade) : offer.grade;
    // chk_override_reason: a report that proposes one grade and finalises another
    // must say why. The correction row below repeats it because that is the row
    // the vendor is notified from and the one grade accuracy is counted off.
    const overrideReason = corrected
      ? 'Chassis wear beyond the declared grade on inspection.'
      : null;
    // Yesterday, not "a while ago". PHASE_05's exit criterion is a unit whose QC
    // expired *yesterday*, which is the boundary the predicate is likeliest to
    // be wrong on.
    const validUntil = lapsed ? -1 : 87;

    await prisma.$executeRaw`
      INSERT INTO listing.unit
        (id, listing_id, vendor_org_id, sku_id, serial_number, grade_declared, grade_actual,
         status, location, qc_passed_at, qc_valid_until, qc_score, battery_health_pct,
         vendor_ask_price, retail_price, supply_point_code, valuation_method, itc_eligible)
      VALUES (${unitId}::uuid, ${listingId}::uuid, ${vendor.orgId}::uuid, ${skuId}::uuid, ${serial},
              ${declared}::grade_type, ${offer.grade}::grade_type, 'QC_PASSED'::unit_status, 'VENDOR',
              ${INSPECTED_AT}, CURRENT_DATE + ${validUntil}::int, ${score}, ${battery},
              ${Math.round(offer.price * 0.86)}, ${offer.price}, ${vendor.supplyCode},
              ${vendor.spec.valuation}, ${vendor.spec.valuation === 'REGULAR'})`;

    // A report and a photographed seal, because is_sellable is a trigger and
    // will not take our word for it.
    const reportId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO qc.qc_report
        (id, unit_id, technician_id, device_cert_id, agent_version, started_at, completed_at,
         signature, nonce, qc_score, verdict, grade_proposed, grade_final,
         grade_override_reason, verification_code, valid_until, is_current, rules_version)
      VALUES (${reportId}::uuid, ${unitId}::uuid, ${techId}::uuid, ${'CERT-' + serial}, '0.1.0',
              ${INSPECTED_AT}, ${INSPECTED_AT}, 'demo-sig', ${randomUUID()},
              ${score}, 'PASS'::qc_verdict, ${declared}::grade_type, ${offer.grade}::grade_type,
              ${overrideReason},
              ${generateVerificationCode()}, CURRENT_DATE + ${validUntil}::int, TRUE, '2026.08')`;

    // VendorQualityService averages battery health from HERE, not from the copy
    // denormalised onto the unit — so a machine whose battery was never read has
    // to be absent here too, or the aggregate quietly invents a measurement.
    await prisma.$executeRaw`
      INSERT INTO qc.qc_hardware_detected
        (qc_report_id, hw_serial, hw_model, ram_detected_gb, battery_health_pct, smart_status)
      VALUES (${reportId}::uuid, ${serial}, ${offer.skuCode}, 16, ${battery}, 'OK')`;

    const sealId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO qc.qc_seal
        (id, seal_code, unit_id, qc_report_id, applied_by, applied_at, applied_photo_key, status)
      VALUES (${sealId}::uuid, ${'TG-' + serial}, ${unitId}::uuid, ${reportId}::uuid,
              ${techId}::uuid, ${INSPECTED_AT},
              ${'qc/seals/' + serial + '.svg'},
              ${broken ? 'BROKEN' : 'APPLIED'}::seal_status)`;

    // seal_id and the report first, then LISTED: every one of these writes fires
    // recompute_is_sellable, and only once the seal exists can the predicate come
    // out true. qc_report_id is what VendorQualityService counts an inspected
    // unit by, so a unit missing it has been inspected and still has no quality
    // record — which is why the grid's quality columns were blank.
    await prisma.$executeRaw`
      UPDATE listing.unit SET seal_id = ${sealId}::uuid, qc_report_id = ${reportId}::uuid
       WHERE id = ${unitId}::uuid`;
    // LISTED even for the lapsed and the broken-sealed ones. Parking those in
    // QC_EXPIRED or SEAL_BROKEN would hide them behind the status check and prove
    // nothing about the expiry date or the seal — which is the half of the
    // predicate that actually decides whether they reach a buyer.
    await prisma.$executeRaw`
      UPDATE listing.unit SET status = 'LISTED'::unit_status WHERE id = ${unitId}::uuid`;

    if (corrected) {
      await prisma.$executeRaw`
        INSERT INTO listing.grade_correction
          (unit_id, listing_id, qc_report_id, grade_declared, grade_corrected, reason)
        VALUES (${unitId}::uuid, ${listingId}::uuid, ${reportId}::uuid,
                ${declared}::grade_type, ${offer.grade}::grade_type, ${overrideReason})`;
    }
  }

  return offer.units;
}

/**
 * Populate `qc.vendor_sku_quality` and `qc.vendor_quality`.
 *
 * Those are base tables, not views: nothing fills them but the `qc.report.completed`
 * handler and a 4 AM cron, so on a freshly seeded database every quality column
 * on the comparison grid is blank until this runs. The service is called rather
 * than the aggregation restated in SQL — a second implementation of "what counts
 * as an inspected unit" is a second answer waiting to disagree with the first.
 *
 * It gets its own PrismaService because that is what the service takes; the seed
 * script's own client is a bare PrismaClient. `refreshAll` is a full recompute
 * per vendor, so running it twice leaves the same rows behind.
 */
async function refreshVendorQuality(): Promise<number> {
  const prisma = new PrismaService(new AppConfig());
  const clock = new SystemClock();
  const quality = new VendorQualityService(
    prisma,
    new QcRepository(prisma, clock),
    new EventBus(prisma, clock, new RequestContextService()),
  );
  try {
    const results = await quality.refreshAll();
    return results.reduce((n, r) => n + r.skuRows, 0);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * What a buyer needs before they can check out at all (PHASE_06 Task 1).
 *
 * The demo buyer had a login and a cart and nothing else: no GSTIN, so there was
 * no entity to invoice; no SHIPPING address, so there was no place of supply and
 * therefore no tax split; no `org_preference`, so nothing said whether a PO
 * reference is required; and no `buyer_profile`, so no payment method was
 * permitted. Checkout refused at the first step, correctly, and there was no way
 * to see the rest of the flow.
 *
 * Two delivery sites on purpose, because ONE of them proves nothing: Gurugram is
 * in Haryana, where we are registered, and gives CGST + SGST; Bengaluru is
 * Karnataka and gives IGST. Switching between them on the delivery step is the
 * whole s.10(1)(a) rule, visible.
 */
async function seedBuyerCheckoutSetup(prisma: PrismaClient, buyerOrgId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO kyc.gst_profile (org_id, gstin, legal_name_as_per_gst, trade_name, state_code,
                                 registration_type, status, api_verified_at, is_primary)
    VALUES (${buyerOrgId}::uuid, '06AABCA1429B1Z8', 'Acme Industries Pvt. Ltd.', 'Acme',
            '06', 'REGULAR', 'ACTIVE', now(), TRUE)
    ON CONFLICT (org_id, gstin) DO NOTHING`;

  const site = async (
    label: string,
    line1: string,
    city: string,
    state: string,
    stateCode: string,
    pin: string,
    contact: string,
    mobile: string,
    landmark: string,
    gate: string,
    isDefault: boolean,
  ): Promise<string> => {
    const found = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.org_address
       WHERE org_id = ${buyerOrgId}::uuid AND type = 'SHIPPING'::address_type AND pincode = ${pin}
       LIMIT 1`;
    if (found[0]) return found[0].id;
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO identity.org_address
        (id, org_id, type, label, line1, city, state, state_code, pincode, contact_name,
         contact_mobile, landmark, delivery_instructions, is_default, is_billing_enabled, is_active)
      VALUES (${id}::uuid, ${buyerOrgId}::uuid, 'SHIPPING'::address_type, ${label}, ${line1},
              ${city}, ${state}, ${stateCode}, ${pin}, ${contact}, ${mobile}, ${landmark},
              ${gate}, ${isDefault}, TRUE, TRUE)`;
    return id;
  };

  const gurugram = await site(
    'Gurugram IT campus',
    'Tower C, 6th floor, DLF Cyber City',
    'Gurugram',
    'Haryana',
    '06',
    '122001',
    'Ravi Menon',
    '+919810045512',
    'Opposite the Cyber Hub gate',
    'Goods entry is gate 3 at the rear. Ask for the IT store on level B1.',
    true,
  );
  await site(
    'New Delhi head office',
    '11th floor, Barakhamba Road, Connaught Place',
    'New Delhi',
    'Delhi',
    '07',
    '110001',
    'Suresh Pillai',
    '+919811223344',
    'Behind the Statesman House',
    'Deliveries to the basement dock only. Building pass from the front desk.',
    false,
  );
  // Genuinely outside the NCR pilot, and that is the point: choosing it shows
  // the honest "we cannot price this lane" state rather than a zero freight.
  await site(
    'Bengaluru office',
    'Prestige Tech Park, Outer Ring Road',
    'Bengaluru',
    'Karnataka',
    '29',
    '560001',
    'Anitha Rajan',
    '+919845012233',
    'Next to the Marathahalli bridge',
    'Loading bay is on the service road side; security desk 2 holds the pass.',
    false,
  );

  const gst = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM kyc.gst_profile WHERE org_id = ${buyerOrgId}::uuid AND is_primary`;

  await prisma.$executeRaw`
    INSERT INTO customer.org_preference (org_id, po_required, default_shipping_address_id,
                                         default_billing_gst_profile_id)
    VALUES (${buyerOrgId}::uuid, FALSE, ${gurugram}::uuid, ${gst[0]!.id}::uuid)
    ON CONFLICT (org_id) DO UPDATE
      SET default_shipping_address_id = EXCLUDED.default_shipping_address_id,
          default_billing_gst_profile_id = EXCLUDED.default_billing_gst_profile_id`;

  // Prepaid and credit both permitted at the organisation, with a real limit —
  // so the payment step has something to offer and the credit arm is reachable.
  await prisma.$executeRaw`
    INSERT INTO customer.buyer_profile (org_id, credit_limit, credit_terms_days, credit_used,
                                        payment_mode_allowed, onboarding_status, verified_at)
    VALUES (${buyerOrgId}::uuid, 2000000, 30, 0,
            ARRAY['PREPAID','CREDIT']::public.payment_mode[], 'VERIFIED'::org_status, now())
    ON CONFLICT (org_id) DO UPDATE
      SET credit_limit = EXCLUDED.credit_limit,
          payment_mode_allowed = EXCLUDED.payment_mode_allowed`;

  // A policy on the ordinary buyer, not on the owner: Farah may spend up to
  // Rs 2 lakh alone and needs Suresh above that, and she may not draw on the
  // credit line. That is the B2B differentiator PHASE_06 Task 2 asks for, and
  // without a seeded policy the approval path has no way to be seen.
  const farah = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.user_account WHERE email = 'buyer@acme.example'`;
  const suresh = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM identity.user_account WHERE email = 'approver@acme.example'`;
  if (farah[0] && suresh[0]) {
    await prisma.$executeRaw`
      INSERT INTO customer.buyer_approval_policy
        (org_id, user_id, requires_approval_above, allowed_payment_modes, approver_user_id, is_active)
      SELECT ${buyerOrgId}::uuid, ${farah[0].id}::uuid, 200000,
             ARRAY['PREPAID']::public.payment_mode[], ${suresh[0].id}::uuid, TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM customer.buyer_approval_policy
          WHERE org_id = ${buyerOrgId}::uuid AND user_id = ${farah[0].id}::uuid)`;
  }
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
  const platformId =
    platformOrg[0]?.id ??
    (await orgByName(prisma, 'TrueTech Services Pvt. Ltd.', 'INTERNAL', 'VERIFIED'));

  const buyerId = await orgByName(prisma, 'Acme Industries Pvt. Ltd.', 'BUYER', 'VERIFIED');

  for (const p of PLATFORM_PEOPLE) await upsertPerson(prisma, platformId, p, hash);
  for (const p of BUYER_PEOPLE) await upsertPerson(prisma, buyerId, p, hash);
  // No `addr()` for the buyer. It writes a PICKUP address — a vendor's shape —
  // labelled "Primary", `is_default` AND `is_billing_enabled`. On checkout that
  // made it the pre-selected billing address of an organisation that has never
  // shipped anything, put a second row reading DEFAULT into a radio group that
  // already had one, and (because `addr` matches on pincode alone, so an early
  // run's row survives a later correction) carried state "Karnataka" under state
  // code 06, which is Haryana. A wrong state code on a billing address is a
  // wrong GSTIN jurisdiction on an invoice. `seedBuyerCheckoutSetup` gives the
  // buyer three real SHIPPING sites, all billing-enabled, one default.
  await seedBuyerCheckoutSetup(prisma, buyerId);

  // --- vendors, their pickup points, and the anonymised labels -------------
  const vendors = new Map<string, ResolvedVendor>();
  for (const spec of VENDORS) {
    const orgId = await orgByName(prisma, spec.legalName, 'VENDOR', 'VERIFIED');
    const addressId = await addr(prisma, orgId, spec.city, spec.state, spec.stateCode, spec.pincode);
    // Assigned centrally so the label is stable and not derivable from the org
    // id. The letter is drawn at random from those free in that city, which is
    // what stops the labels publishing either the join order or the vendor count.
    const rows = await prisma.$queryRaw<Array<{ assign_supply_point: string }>>`
      SELECT listing.assign_supply_point(${orgId}::uuid, ${spec.city})`;

    // **`vendor.vendor_profile` had zero rows for every vendor on the platform.**
    //
    // The real onboarding path writes it — `vendor/internal/promotion.service.ts`
    // upserts the row when step 3 is promoted — and this seed builds its vendors
    // directly, so the table nobody looked at stayed empty. `licence.service.ts`,
    // `vendor.service.ts` and T33's payables screen all read it, which means the
    // MSME payment clock, the settlement cycle and the DeviceSure licence state
    // were three behaviours no demo account could reach. Found by T33 trying to
    // photograph the MSMED 45-day deadline and finding nobody was an MSME.
    //
    // Everything except the Udyam number takes its column default; a business
    // category is required and REFURBISHER is what these ten are.
    await prisma.$executeRaw`
      INSERT INTO vendor.vendor_profile (org_id, business_category, msme_udyam_no, verified_at)
      VALUES (${orgId}::uuid, 'REFURBISHER', ${spec.udyam ?? null}, now())
      ON CONFLICT (org_id) DO UPDATE SET msme_udyam_no = EXCLUDED.msme_udyam_no`;

    vendors.set(spec.legalName, {
      spec,
      orgId,
      addressId,
      supplyCode: rows[0]!.assign_supply_point,
    });
  }
  for (const p of VENDOR_PEOPLE) await upsertPerson(prisma, vendors.get(NORTHGATE)!.orgId, p, hash);

  // **One operator per supply point, not just Northgate's three.**
  //
  // Nine of the ten vendors had no user account at all, and they are precisely
  // the nine whose stock the demo orders were placed against — so every unit in
  // the database with a `purchase_price` belonged to a vendor who could not sign
  // in. The whole "machines already committed to an order keep the payout they
  // were bought at" behaviour was therefore unreachable through the product, and
  // the repricing screen that has to state it had nobody to state it to. Found
  // by T28 trying to photograph it.
  //
  // VENDOR_OPS: it holds `listing.own.read` and `listing.own.write` and is not
  // in MFA_REQUIRED_ROLES, which is the account a warehouse actually works from.
  for (const spec of VENDORS) {
    if (spec.legalName === NORTHGATE) continue;
    await upsertPerson(
      prisma,
      vendors.get(spec.legalName)!.orgId,
      {
        email: `ops@${spec.legalName.split(' ')[0]!.toLowerCase()}.example`,
        name: `${spec.city} operations`,
        role: 'VENDOR_OPS',
      },
      hash,
    );
  }

  // VENDOR_FINANCE, one per supply point.
  //
  // /vendor/payables is FINANCE and OWNER only (UX spec §3B.4), and
  // procurement.payable.read_own was narrowed to those two roles once it
  // existed — before that the screen rode on procurement.po.read_own, which
  // every vendor role holds. The narrowing was right and it stranded the demo:
  // every supply point except Northgate had ONLY a VENDOR_OPS login, so the one
  // vendor carrying a Udyam registration — the MSME 45-day clock, the whole
  // reason that screen has a real date on it — had nobody who could open it.
  //
  // A permission that no demo account holds is a screen nobody reviews.
  for (const spec of VENDORS) {
    if (spec.legalName === NORTHGATE) continue;
    await upsertPerson(
      prisma,
      vendors.get(spec.legalName)!.orgId,
      {
        email: `finance@${spec.legalName.split(' ')[0]!.toLowerCase()}.example`,
        name: `${spec.city} finance`,
        role: 'VENDOR_FINANCE',
      },
      hash,
    );
  }

  log(
    `  accounts: ${PLATFORM_PEOPLE.length} platform, ${VENDOR_PEOPLE.length + VENDORS.length - 1} vendor, ${BUYER_PEOPLE.length} buyer`,
  );
  log(`  supply points: ${VENDORS.length} across ${new Set(VENDORS.map((v) => v.city)).size} NCR cities`);

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
  let unitsMade = 0;
  let listingsMade = 0;
  for (const offer of OFFERS) {
    const vendor = vendors.get(offer.vendor);
    if (!vendor) throw new Error(`An offer names ${offer.vendor}, which is not in VENDORS.`);
    const made = await seedOffer(prisma, vendor, techId, offer);
    if (made > 0) listingsMade += 1;
    unitsMade += made;
  }

  const sellable = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.v_sellable_unit`;
  log(
    `  stock: ${listingsMade} new listing(s), ${unitsMade} new unit(s), ` +
      `${Number(sellable[0]!.n)} sellable in total`,
  );

  const drift = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.v_sellability_drift`;
  if (Number(drift[0]!.n) > 0) {
    throw new Error(
      `${Number(drift[0]!.n)} unit(s) disagree with listing.unit_is_sellable. The seed wrote a ` +
        `state the trigger did not produce, which is exactly what v_sellability_drift exists to catch.`,
    );
  }

  const labelDrift = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM listing.v_supply_point_drift`;
  if (Number(labelDrift[0]!.n) > 0) {
    throw new Error(
      `${Number(labelDrift[0]!.n)} unit(s) carry a supply-point label that is not the one assigned to ` +
        `their vendor in that city. A vendor appearing under two labels has had their unit count leaked.`,
    );
  }

  // Over every current report, not only the ones written above: seedOffer
  // returns early for a listing it has already made, so a developer with a
  // seeded database would otherwise never get the evidence.
  await seedQcEvidence(prisma, log);

  // After the evidence, because PASS_WITH_NOTE is derived from the area results
  // it writes. Every seeded report was PASS / grade A / seal APPLIED before
  // this, which is a monoculture that makes every after-sale screen look
  // finished and be wrong the first time a machine fails.
  await seedQcSpread(prisma, log);

  const skuRows = await refreshVendorQuality();
  log(`  vendor quality: ${skuRows} (vendor, sku, grade) row(s) computed`);

  log(`  password for every demo account: ${DEMO_PASSWORD}`);
}
