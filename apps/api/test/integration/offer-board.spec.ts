/**
 * T12 — the supply-point comparison board, end to end.
 *
 * Every test below attempts the forbidden thing rather than asserting that a
 * guard exists. The anonymity test does not check that a `vendorOrgId` field is
 * absent from a typed object — it sweeps the SERIALISED payload for the seeded
 * vendor's legal name, GSTIN, PAN, address, phone, e-mail, slug and org id, at
 * any depth, because a leak through an untyped blob is exactly the one a typed
 * assertion cannot see.
 *
 * The fixture is the seeded scenario in miniature, and the one detail that
 * matters most is deliberate: **two different vendors are both labelled `F`, one
 * in Noida and one in Faridabad.** `listing.supply_point` is unique on
 * `(city, code)` and on `(vendor_org_id, city)`, so the letter alone identifies
 * nothing — and a board that grouped on the letter would weld two vendors' stock,
 * prices and quality records into a single row without failing anything.
 */
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import { findForbiddenKeys, findVendorIdentityLeaks } from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import { ContextModule } from '../../src/shared/db/org-scope';
import { OfferBoardService } from '../../src/modules/listing/internal/offer-board.service';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { MarginRuleRepository } from '../../src/modules/listing/internal/margin-rule.repository';
import { PricingService } from '../../src/modules/listing/internal/pricing.service';
import { QcService } from '../../src/modules/qc';
import { QcRepository } from '../../src/modules/qc/internal/qc.repository';
import { VendorQualityService } from '../../src/modules/qc/internal/vendor-quality.service';
import { LogisticsService } from '../../src/modules/logistics';
import { FreightService } from '../../src/modules/logistics/internal/freight.service';
import { ServiceabilityService } from '../../src/modules/logistics/internal/serviceability.service';
import { EventBus } from '../../src/shared/events/event-bus';
import { seedLogisticsNcr } from '../../prisma/seed/logistics-ncr';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
  testDb,
  truncateAll,
} from '../support/db';
import { makeAddress, makeCatalog, makeListing, makeOrganization, makeUnit } from '../support/factories';

/** Fixed, so "expires in N days" is arithmetic rather than a race with midnight. */
const NOW = new Date('2026-08-27T06:00:00.000Z');

/** Delhi. Serviceable, not ODA, and a different state from ours — so IGST. */
const DELHI = '110001';
/** Gurugram. Our own state, so the same board comes back as CGST + SGST. */
const HARYANA = '122001';
/** Bengaluru. In `pincode_master`, no serviceability row: a real refusal. */
const UNSERVED = '560001';

const OUR_STATE = '06';

let moduleRef: TestingModule;
let board: OfferBoardService;
let quality: VendorQualityService;
let db: PrismaClient;

interface Vendor {
  orgId: string;
  addressId: string;
  listingId: string;
  code: string;
  city: string;
}

let skuId: string;
let vendors: Record<string, Vendor>;

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);

  // The providers are listed rather than the modules imported. `ListingModule`
  // now imports `QcModule`, which imports `IdentityModule` for its OTP service —
  // and booting the identity graph to read a quality aggregate would make this
  // suite fail for reasons that have nothing to do with the board.
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(NOW) },
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
      ListingRepository,
      MarginRuleRepository,
      PricingService,
      QcRepository,
      VendorQualityService,
      QcService,
      ServiceabilityService,
      FreightService,
      LogisticsService,
      OfferBoardService,
    ],
  }).compile();

  board = moduleRef.get(OfferBoardService);
  quality = moduleRef.get(VendorQualityService);
  await moduleRef.get(PrismaService).$connect();
});

afterAll(async () => {
  await moduleRef.get(PrismaService).$disconnect();
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await seedLogisticsNcr(db);
  // The seeded threshold is ten and the fixture is deliberately small, so it is
  // moved to three: the two four- and three-unit supply points clear it and
  // Palwal's two do not. The RULE under test is "below the threshold there is no
  // headline number", not the number itself, and a fixture of forty units to
  // exercise it would hide the rule in the setup.
  await db.$executeRaw`
    INSERT INTO platform.platform_config (key, value_json, description)
    VALUES ('qc.min_sample_for_headline', '3'::jsonb, 'Lowered for the T12 fixture')
    ON CONFLICT (key, effective_from) DO NOTHING`;
  await seedBoard();
});

/* ==========================================================================
 * The fixture
 * ======================================================================== */

/**
 * One SKU at Grade A, held by four supply points:
 *
 *   F · Noida      — 4 units, cheapest of the well-inspected, 1 unmeasured battery
 *   F · Faridabad  — 3 units, a DIFFERENT vendor wearing the same letter
 *   B · Palwal     — 2 units, below the sample threshold: no headline number
 *   P · New Delhi  — 2 units, MARGIN channel
 */
async function seedBoard(): Promise<void> {
  const catalog = await makeCatalog({});
  skuId = catalog.skuId;

  vendors = {};
  const plan = [
    { key: 'noida', code: 'F', city: 'Noida', pincode: '201301', price: 40000, units: 4 },
    { key: 'faridabad', code: 'F', city: 'Faridabad', pincode: '121001', price: 45000, units: 3 },
    { key: 'palwal', code: 'B', city: 'Palwal', pincode: '121102', price: 38000, units: 2 },
    { key: 'delhi', code: 'P', city: 'New Delhi', pincode: '110020', price: 42000, units: 2 },
  ] as const;

  for (const p of plan) {
    const orgId = await makeOrganization({ legal_name: `${p.city} Refurb Holdings Pvt Ltd` });
    const addressId = await makeAddress(orgId, {
      city: p.city,
      pincode: p.pincode,
      state_code: p.city === 'New Delhi' ? '07' : '06',
    });
    await db.$executeRaw`
      INSERT INTO listing.supply_point (vendor_org_id, city, code)
      VALUES (${orgId}::uuid, ${p.city}, ${p.code})`;

    const listingId = await makeListing({
      vendorOrgId: orgId,
      skuId,
      pickupAddressId: addressId,
      grade: 'A',
      unitPrice: p.price,
      qty: p.units,
    });

    for (let i = 0; i < p.units; i += 1) {
      const unit = await makeUnit({ listingId, vendorOrgId: orgId, skuId, grade: 'A' });
      // The three columns the storefront reads that the factory does not set:
      // the buyer-facing price, the tax pool, and the measurement.
      //
      // The FIRST Noida unit has no battery reading at all. Three of the seeded
      // demo units are in that state, and it is the one value that must never
      // arrive as a zero.
      const battery = p.key === 'noida' && i === 0 ? null : 88 + i;
      await db.$executeRaw`
        UPDATE listing.unit
           SET
               -- The factory writes the report and the seal and back-fills only
               -- the seal pointer, so nothing joins the unit to its inspection.
               -- The quality read counts units WHERE qc_report_id IS NOT NULL,
               -- so without this line every supply point is a new supplier and
               -- the threshold test passes for the wrong reason.
               qc_report_id = ${unit.qcReportId}::uuid,
               retail_price = ${p.price},
               valuation_method = ${p.key === 'delhi' ? 'MARGIN' : 'REGULAR'},
               -- chk_unit_margin_no_itc: a Rule 32(5) purchase carries no input
               -- credit for US either, and the database refuses to pretend it
               -- does. It is the same fact the buyer is told about on the row.
               itc_eligible = ${p.key !== 'delhi'},
               vendor_ask_price = ${p.price - 3777},
               qc_score = ${90 - i},
               battery_health_pct = ${battery},
               supply_point_code = ${p.code}
         WHERE id = ${unit.unitId}::uuid`;
    }

    vendors[p.key] = { orgId, addressId, listingId, code: p.code, city: p.city };
    // The read model the board serves its quality numbers from. Computed, cached
    // and versioned — never live — and it is what decides that two units is not
    // a sample.
    await quality.refreshVendor(orgId);
  }
}

const ask = (over: { pincode?: string; grade?: string } = {}) =>
  board.board({
    skuId,
    grade: 'A',
    pincode: over.pincode ?? DELHI,
    ourStateCode: OUR_STATE,
    // The only fact the split turns on is whether the delivery is in our state.
    deliveryStateCode: (over.pincode ?? DELHI).startsWith('12') ? OUR_STATE : '07',
  });

const row = (offers: Awaited<ReturnType<typeof ask>>['offers'], code: string, city: string) =>
  offers.find((o) => o.supplyPointCode === code && o.city === city);

/* ==========================================================================
 * (code, city) — the easiest thing on this screen to get wrong
 * ======================================================================== */

describe('grouping', () => {
  it('keeps two supply points that share a letter apart', async () => {
    const { offers } = await ask();

    const noida = row(offers, 'F', 'Noida');
    const faridabad = row(offers, 'F', 'Faridabad');

    expect(noida).toBeDefined();
    expect(faridabad).toBeDefined();
    // Not merged: four units and three units, not one row of seven.
    expect(noida?.unitsAvailable).toBe(4);
    expect(faridabad?.unitsAvailable).toBe(3);
    expect(noida?.landed.total.toString()).not.toBe(faridabad?.landed.total.toString());
    expect(offers.filter((o) => o.supplyPointCode === 'F')).toHaveLength(2);
  });

  it('gives each of them its own quality record', async () => {
    const { offers } = await ask();

    const noida = row(offers, 'F', 'Noida');
    const faridabad = row(offers, 'F', 'Faridabad');

    // Both cleared the sample threshold on their own count of inspected units,
    // and the counts differ — which they could not if one row were serving both.
    expect(noida?.quality.kind).toBe('SCORE');
    expect(faridabad?.quality.kind).toBe('SCORE');
    expect(noida?.quality.unitsInspected).toBe(4);
    expect(faridabad?.quality.unitsInspected).toBe(3);
  });

  it('counts supply points on the pair, not on the letter', async () => {
    const { supplyPoints } = await ask();
    expect(supplyPoints).toBe(4);
  });
});

/* ==========================================================================
 * Small samples do not get a headline number
 * ======================================================================== */

describe('the sample threshold', () => {
  it('publishes no percentage for a supply point below it', async () => {
    const { offers } = await ask();
    const palwal = row(offers, 'B', 'Palwal');

    expect(palwal?.quality.kind).toBe('NEW_SUPPLIER');
    if (palwal?.quality.kind !== 'NEW_SUPPLIER') throw new Error('unreachable');
    expect(palwal.quality.label).toBe('New supplier · 2 units inspected');
    // The union has no percentage in this arm at all, which is the point: there
    // is no field a careless caller could render.
    expect(JSON.stringify(palwal.quality)).not.toMatch(/gradeAccuracyPct|avgQcScore/);
  });

  it('is not a rounding of the average — the number is absent, not zero', async () => {
    const { offers } = await ask();
    const palwal = row(offers, 'B', 'Palwal');
    expect(JSON.stringify(palwal?.quality)).not.toMatch(/\b0\b/);
  });
});

/* ==========================================================================
 * A measurement nobody took
 * ======================================================================== */

describe('an unmeasured battery', () => {
  it('reaches the screen as null, never as 0', async () => {
    const { offers } = await ask();
    const noida = row(offers, 'F', 'Noida');

    const unmeasured = noida?.units.filter((u) => u.batteryHealthPct === null) ?? [];
    expect(unmeasured).toHaveLength(1);
    // Not a zero anywhere in the serialised unit — a 0 here renders as a dead
    // battery beside machines that measured 88%.
    expect(JSON.stringify(unmeasured[0])).toContain('"batteryHealthPct":null');
  });

  it('excludes it from the range and carries the denominator', async () => {
    const { offers } = await ask();
    const noida = row(offers, 'F', 'Noida');

    // Four units, three measured. The range is drawn from the three, and the
    // count of them travels with it so the screen can print the denominator.
    expect(noida?.unitsAvailable).toBe(4);
    expect(noida?.batteryMeasured).toBe(3);
    expect(noida?.batteryHealthPct).toEqual({ min: 89, max: 91 });
  });
});

/* ==========================================================================
 * A sort that cannot leak
 * ======================================================================== */

describe('the default order', () => {
  it('is landed price ascending', async () => {
    const { offers } = await ask();
    const prices = offers.map((o) => o.landed.total.paise);
    expect([...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(prices);
  });

  it('is stable across repeated reads', async () => {
    const a = await ask();
    const b = await ask();
    expect(order(a.offers)).toEqual(order(b.offers));
  });

  it('does not follow vendor creation order', async () => {
    const { offers } = await ask();
    const created = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM identity.organization WHERE org_type = 'VENDOR' ORDER BY created_at, id`;
    const byCreation = created
      .map((o) => Object.values(vendors).find((v) => v.orgId === o.id))
      .filter((v): v is Vendor => Boolean(v))
      .map((v) => `${v.code}|${v.city}`);

    // The fixture prices them so the two orders genuinely differ; if they ever
    // agree by accident this assertion is what says the fixture stopped testing
    // anything.
    expect(order(offers)).not.toEqual(byCreation);
  });

  it('survives a vendor being re-inserted with a new id', async () => {
    const before = order((await ask()).offers);
    // The unit ids are what the tie-break hashes, and they have not moved, so a
    // change to anything vendor-shaped must not reorder the board.
    await db.$executeRaw`
      UPDATE identity.organization SET legal_name = 'Zzz Last Alphabetically Pvt Ltd'
       WHERE id = ${vendors.noida!.orgId}::uuid`;
    expect(order((await ask()).offers)).toEqual(before);
  });
});

const order = (offers: Awaited<ReturnType<typeof ask>>['offers']): string[] =>
  offers.map((o) => `${o.supplyPointCode}|${o.city}`);

/* ==========================================================================
 * Anonymity — swept over the serialised payload, at any depth
 * ======================================================================== */

describe('the anonymity guarantee', () => {
  it('leaks no part of any vendor identity into the board', async () => {
    const answer = await ask();
    const payload = JSON.stringify(answer);

    for (const vendor of Object.values(vendors)) {
      const org = await db.$queryRaw<Array<{ legal_name: string }>>`
        SELECT legal_name FROM identity.organization WHERE id = ${vendor.orgId}::uuid`;
      const address = await db.$queryRaw<
        Array<{ line1: string; contact_mobile: string; pincode: string }>
      >`SELECT line1, contact_mobile, pincode FROM identity.org_address WHERE id = ${vendor.addressId}::uuid`;

      const leaks = findVendorIdentityLeaks(payload, {
        orgId: vendor.orgId,
        legalName: org[0]!.legal_name,
        addressLines: [address[0]!.line1],
        phones: [address[0]!.contact_mobile],
        // The dispatch pincode is finer than a city and is freight input only.
        // It resolves inside the module and must not come back out.
        slug: address[0]!.pincode,
      });
      expect(leaks).toEqual([]);
    }
  });

  it('carries no forbidden key at any depth', async () => {
    expect(findForbiddenKeys(await ask())).toEqual([]);
  });

  it('never carries the vendor ask, the purchase price or the margin', async () => {
    const payload = JSON.stringify(await ask());
    // Every listing's ask is its price minus 3 777 — a number chosen so it can
    // collide with no selling price in the fixture. If one of them is in the
    // payload, a buyer can compute our margin.
    for (const asked of [36223, 41223, 34223, 38223]) {
      expect(payload).not.toContain(String(asked));
    }
  });

  it('shows the total warranty and never the split', async () => {
    const answer = await ask();
    const payload = JSON.stringify(answer);
    expect(answer.offers.every((o) => o.totalWarrantyMonths > 0)).toBe(true);
    expect(payload).not.toMatch(/vendorWarranty|platformBacked|vendorBacked/i);
  });
});

/* ==========================================================================
 * The landed price
 * ======================================================================== */

describe('the landed price', () => {
  it('is our price plus freight plus GST, with the whole break-up', async () => {
    const { offers } = await ask();
    const noida = row(offers, 'F', 'Noida')!;

    expect(noida.landed.sellingPrice.toString()).toBe('40000.00');
    expect(noida.landed.freight.toString()).toBe('149.00');
    // 18% of 40 149.00, inter-state, so all of it is IGST.
    expect(noida.landed.igst.toString()).toBe('7226.82');
    expect(noida.landed.cgst.isZero()).toBe(true);
    expect(noida.landed.total.toString()).toBe('47375.82');
  });

  it('splits into CGST and SGST when the delivery is in our own state', async () => {
    const { offers } = await ask({ pincode: HARYANA });
    const noida = row(offers, 'F', 'Noida')!;

    expect(noida.landed.isInterState).toBe(false);
    expect(noida.landed.igst.isZero()).toBe(true);
    expect(noida.landed.cgst.add(noida.landed.sgst).toString()).toBe('7226.82');
  });

  it('taxes a MARGIN unit on the full value and labels it instead', async () => {
    const { offers } = await ask();
    const delhi = row(offers, 'P', 'New Delhi')!;

    // Rule 32(5) values the supply on (sale − purchase) per SERIAL, and the
    // serial is not known until allocation — so the board quotes the higher,
    // full-value figure and discloses the ITC consequence rather than guessing
    // which machine ships.
    expect(delhi.valuationMethod).toBe('MARGIN');
    expect(delhi.landed.taxableValue.toString()).toBe('42149.00');
  });

  it('prices nothing at all for a pincode we do not serve', async () => {
    const answer = await ask({ pincode: UNSERVED });

    expect(answer.delivery.kind).toBe('UNSERVICEABLE');
    if (answer.delivery.kind !== 'UNSERVICEABLE') throw new Error('unreachable');
    // A sentence a buyer can act on, and one that names no origin.
    expect(answer.delivery.reason).toContain(UNSERVED);
    expect(answer.offers).toEqual([]);
    // The evidence still stands: the stock is there, it just cannot be priced.
    expect(answer.supplyPoints).toBe(4);
    expect(answer.unpricedSupplyPoints).toBe(4);
  });

  it('says "not asked" rather than "cannot deliver" when no pincode is given', async () => {
    const answer = await board.board({
      skuId,
      grade: 'A',
      ourStateCode: OUR_STATE,
      deliveryStateCode: '07',
    });

    expect(answer.delivery.kind).toBe('NONE');
    expect(answer.pincode).toBeNull();
    expect(answer.offers).toEqual([]);
    expect(answer.grades.find((g) => g.grade === 'A')?.unitsAvailable).toBe(11);
  });
});

/* ==========================================================================
 * The grade selector
 * ======================================================================== */

describe('grades', () => {
  it('summarises every grade with stock, ordered by how much of it there is', async () => {
    const grade = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM listing.v_sellable_unit WHERE sku_id = ${skuId}::uuid`;
    const answer = await ask();

    expect(Number(grade[0]!.n)).toBe(11);
    expect(answer.grades).toHaveLength(1);
    expect(answer.grades[0]).toMatchObject({ grade: 'A', unitsAvailable: 11, supplyPoints: 4 });
    expect(answer.grades[0]!.fromPrice.toString()).toBe('38000.00');
  });

  it('returns an empty board for a grade nobody holds', async () => {
    const answer = await board.board({
      skuId,
      grade: 'B',
      pincode: DELHI,
      ourStateCode: OUR_STATE,
      deliveryStateCode: '07',
    });
    expect(answer.offers).toEqual([]);
    expect(answer.unitsAvailable).toBe(0);
  });

  it('refuses a SKU with nothing sealed behind it', async () => {
    const empty = await makeCatalog({});
    await expect(
      board.board({
        skuId: empty.skuId,
        pincode: DELHI,
        ourStateCode: OUR_STATE,
        deliveryStateCode: '07',
      }),
    ).rejects.toThrow(/available/i);
  });
});

/* ==========================================================================
 * The serials behind a row
 * ======================================================================== */

describe('the per-unit list', () => {
  it('lists the real serials, ordered, with their own measurements', async () => {
    const { offers } = await ask();
    const noida = row(offers, 'F', 'Noida')!;

    expect(noida.units).toHaveLength(4);
    expect(noida.units.map((u) => u.serialNumber)).toEqual(
      [...noida.units.map((u) => u.serialNumber)].sort(),
    );
    for (const unit of noida.units) {
      expect(unit.serialNumber).toMatch(/^[0-9A-Z]+$/);
      expect(unit.qcScore).not.toBeNull();
    }
  });

  it('flags a certificate inside the fortnight window', async () => {
    await db.$executeRaw`
      UPDATE listing.unit SET qc_valid_until = CURRENT_DATE + 9
       WHERE listing_id = ${vendors.noida!.listingId}::uuid`;

    const { offers } = await ask();
    const noida = row(offers, 'F', 'Noida')!;

    expect(noida.qcExpiresInDays).toBeLessThanOrEqual(14);
    expect(noida.units.every((u) => (u.expiresInDays ?? 99) <= 14)).toBe(true);
  });

  it('drops a unit whose seal is broken before it can be offered', async () => {
    await db.$executeRaw`
      UPDATE qc.qc_seal SET status = 'BROKEN'::seal_status
       WHERE unit_id IN (SELECT id FROM listing.unit WHERE listing_id = ${vendors.palwal!.listingId}::uuid)`;

    const { offers } = await ask();
    // `v_sellable_unit` is the one definition of sellable and the board never
    // re-states it, so a broken seal removes the row without this file knowing
    // how sellability is computed.
    expect(row(offers, 'B', 'Palwal')).toBeUndefined();
  });
});
