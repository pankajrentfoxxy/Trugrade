import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import {
  Money,
  money,
  permissionsFor,
  priceFromNetPayout,
  type Grade,
  type Role,
} from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { MarginRuleRepository } from '../../src/modules/listing/internal/margin-rule.repository';
import { PricingService } from '../../src/modules/listing/internal/pricing.service';
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
 * Phase 3 Task 5 — the pricing engine's edges.
 *
 * Against the real database, because every property under test is one only
 * Postgres enforces or only the real tables can produce: the CHECK behind the
 * three floor-override columns, the CHECK behind the three price-band columns,
 * the append-only price history, and a median taken over rows that actually
 * exist.
 */

const FIXED_NOW = new Date('2026-08-26T06:00:00.000Z');

const VENDOR = '11111111-0000-4000-8000-0000000000c1';
const PLATFORM = '11111111-0000-4000-8000-0000000000c2';

let moduleRef: TestingModule;
let pricing: PricingService;
let listings: ListingRepository;
let rules: MarginRuleRepository;
let ctx: RequestContextService;
let db: PrismaClient;

let vendorUserId: string;
let platformUserId: string;
let skuId: string;
let addressId: string;

function principal(orgId: string, orgType: 'VENDOR' | 'PLATFORM', userId: string): Principal {
  const roles: Role[] = orgType === 'PLATFORM' ? ['OPS_MANAGER'] : ['VENDOR_OWNER'];
  return {
    userId,
    orgId,
    orgType,
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's',
    mfaSatisfied: true,
  };
}

function as<T>(p: Principal, fn: () => Promise<T>): Promise<T> {
  return ctx.run({ requestId: 't' }, () => {
    ctx.setPrincipal(p);
    return fn();
  });
}

const asVendor = <T>(fn: () => Promise<T>): Promise<T> =>
  as(principal(VENDOR, 'VENDOR', vendorUserId), fn);
const asOps = <T>(fn: () => Promise<T>): Promise<T> =>
  as(principal(PLATFORM, 'PLATFORM', platformUserId), fn);

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await seedTestReference(db);
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(FIXED_NOW) },
      PrismaService,
      ListingRepository,
      MarginRuleRepository,
      PricingService,
    ],
  }).compile();
  await moduleRef.init();
  pricing = moduleRef.get(PricingService);
  listings = moduleRef.get(ListingRepository);
  rules = moduleRef.get(MarginRuleRepository);
  ctx = moduleRef.get(RequestContextService);
});

afterAll(async () => {
  await setRoundingStep(null);
  await moduleRef.close();
  await closeTestDb();
});

beforeEach(async () => {
  await truncateAll(db);
  await restoreMigrationSeededConfig();
  // `margin_rule` is reference data the harness deliberately preserves and
  // re-seeds, so a spec that asserts *which* rule matched has to own the table.
  // Cleared here and repopulated per test; the harness puts the defaults back
  // on the next truncate.
  await db.$executeRaw`DELETE FROM procurement.margin_rule`;
  await makeOrganization({ id: VENDOR }, db);
  await makeOrganization({ id: PLATFORM, org_type: 'INTERNAL', legal_name: 'TrueTech' }, db);
  vendorUserId = await makeUser(VENDOR, {}, db);
  platformUserId = await makeUser(PLATFORM, {}, db);
  const cat = await makeCatalog({}, db);
  skuId = cat.skuId;
  addressId = await makeAddress(VENDOR, {}, db);
});

/**
 * Two of the keys the pricing engine reads were seeded by the **baseline
 * migration**, not by `prisma/seed/reference.ts` — and `truncateAll`'s CASCADE
 * empties `platform_config` (it has an FK into `identity.user_account`), after
 * which `restoreReference` refills it from the seed script only. So the two
 * migration-only keys never come back, and the engine correctly refuses to
 * price without them.
 *
 * Restored here so this spec is honest about what it needs. **The durable fix
 * is to add both to the CONFIG list in `prisma/seed/reference.ts`** — that file
 * is another lane's, so this is a stopgap and not the answer.
 */
async function restoreMigrationSeededConfig(): Promise<void> {
  for (const [key, valueJson] of [
    ['price.guardrail_lower_multiple', '0.3'],
    ['qc.visit_fee_waived_above', '50'],
  ]) {
    await db.$executeRaw`
      INSERT INTO platform.platform_config (key, value_json, effective_from)
      SELECT ${key}, ${valueJson}::jsonb, now() - interval '1 day'
       WHERE NOT EXISTS (SELECT 1 FROM platform.v_current_config c WHERE c.key = ${key})`;
  }
}

/**
 * `price.rounding_step_inr` has never been seeded, so the service treats its
 * absence as "do not round" — the behaviour the engine has always had. Removed
 * again afterwards rather than left to change how a later spec file prices.
 */
async function setRoundingStep(stepRupees: number | null): Promise<void> {
  await db.$executeRaw`DELETE FROM platform.platform_config WHERE key = 'price.rounding_step_inr'`;
  if (stepRupees !== null) {
    await db.$executeRaw`
      INSERT INTO platform.platform_config (key, value_json, effective_from)
      VALUES ('price.rounding_step_inr', ${stepRupees}::text::jsonb, now() - interval '1 day')`;
  }
}

async function makeMarginRule(
  over: Partial<{
    priority: number;
    grade: string | null;
    targetPct: number;
    floorPct: number;
    topUpMonths: number;
    reserve: Record<string, number> | null;
    category: string | null;
    valueFrom: number | null;
    valueTo: number | null;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO procurement.margin_rule
      (id, priority, category, brand_id, grade, value_from, value_to,
       target_margin_pct, floor_margin_pct, warranty_top_up_months,
       reserve_pct_by_grade, effective_from, is_active)
    VALUES (${id}::uuid, ${over.priority ?? 100}, ${over.category ?? null}, NULL,
            ${over.grade ?? null}::grade_type,
            ${over.valueFrom ?? null}::numeric, ${over.valueTo ?? null}::numeric,
            ${over.targetPct ?? 12}, ${over.floorPct ?? 4}, ${over.topUpMonths ?? 3},
            ${JSON.stringify(over.reserve ?? { A_PLUS: 0.8, A: 1.2, B: 2.0 })}::jsonb,
            -- Fixed well in the past: CURRENT_DATE would make this suite start
            -- failing the day the machine's clock passes the FixedClock.
            '2020-01-01'::date, TRUE)`;
  return id;
}

async function makeDraft(ask: Money, serials: string[], grade: Grade = 'A'): Promise<string> {
  const listing = await asVendor(() =>
    listings.createDraft({
      skuId,
      pickupLocationId: addressId,
      grade,
      conditionType: 'REFURBISHED',
      functionalStatus: 'FULLY_FUNCTIONAL',
      batteryHealthBand: 'GOOD_80_89',
      partsStatus: 'ALL_ORIGINAL',
      partsReplaced: [],
      repairHistory: 'NONE',
      dataWipeStatus: 'VERIFIED_WIPED',
      sellerWarranty: 'NONE',
      oemWarrantyRemaining: 'NONE',
      vendorWarrantyMonths: 3,
      vendorWarrantyScope: null,
      vendorAskPrice: ask,
      moq: 1,
      dispatchSlaHours: 48,
    }),
  );
  await asVendor(() => listings.addUnits(listing.id, serials));
  return listing.id;
}

/** Every key at every depth of what the HTTP layer would actually serialise. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v) => deepKeys(v, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      deepKeys(v, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('vendor payout preview', () => {
  /**
   * The Phase 3 exit criterion: *the vendor never sees the retail price
   * anywhere in the vendor portal*.
   *
   * Asserted twice over, because a key check alone is defeated by renaming the
   * field: no forbidden key at any depth, **and** the retail price does not
   * appear as a value anywhere in the serialised body.
   */
  it('returns the payout and the deductions, and never the retail price', async () => {
    await makeMarginRule();
    const ask = Money.rupees(28_000);

    // A penalty raised since the last settlement (there is none), and a batch
    // large enough to cross the s.194Q threshold, so both deduction paths run.
    await db.$executeRaw`
      INSERT INTO payment.penalty (vendor_org_id, type, amount, reason)
      VALUES (${VENDOR}::uuid, 'LATE_DISPATCH'::penalty_type, 2500, 'Two days late on ORD-1')`;

    // A VERIFIED PAN. Without one s.206AA charges the higher no-PAN rate, so
    // leaving this out silently tests a different tax rule than the one the
    // assertions below describe.
    await db.$executeRaw`
      INSERT INTO kyc.pan_record (org_id, pan_enc, pan_last4, pan_hash, name_as_per_pan,
                                  verified, api_verified_at)
      VALUES (${VENDOR}::uuid, 'enc', '1234', ${'hash-' + VENDOR}, 'Vendor Pvt Ltd', TRUE, now())`;

    const preview = await asVendor(() =>
      pricing.previewPayout({
        skuId,
        grade: 'A',
        vendorWarrantyMonths: 3,
        units: 500,
        ask: { mode: 'NET_PAYOUT', vendorNetPayout: ask },
      }),
    );

    expect(preview.pricingMode).toBe('NET_PAYOUT');
    expect(preview.perUnitPayout.toString()).toBe('28000.00');
    expect(preview.grossPayout.toString()).toBe('14000000.00');
    // 3 vendor months + 3 top-up, floored at 6: the vendor is told what the
    // customer gets, which is the disclosure Task 3 step 2 asks for.
    expect(preview.customerWarrantyMonths).toBe(6);
    expect(preview.commissionPct).toBeGreaterThan(0);

    const codes = preview.deductions.map((d) => d.code).sort();
    expect(codes).toEqual(['PENALTY', 'TDS']);
    // 0.1% of (Rs 1.4 crore - Rs 50 lakh), plus the penalty.
    expect(preview.deductions.find((d) => d.code === 'TDS')!.amount.toString()).toBe('9000.00');
    expect(preview.totalDeductions.toString()).toBe('11500.00');
    expect(preview.netPayout.toString()).toBe('13988500.00');
    // Above 50 units the visit fee is waived, so it is absent rather than zero.
    expect(codes).not.toContain('QC_VISIT_FEE');

    // s.206AA: no verified PAN means the penalty rate, not the 0.1% rate. Fifty
    // times the deduction is the kind of surprise a vendor rings up about, so
    // the label has to say why and the number has to be right.
    await db.$executeRaw`UPDATE kyc.pan_record SET verified = FALSE WHERE org_id = ${VENDOR}::uuid`;
    const noPan = await asVendor(() =>
      pricing.previewPayout({
        skuId,
        grade: 'A',
        vendorWarrantyMonths: 3,
        units: 500,
        ask: { mode: 'NET_PAYOUT', vendorNetPayout: ask },
      }),
    );
    const noPanTds = noPan.deductions.find((d) => d.code === 'TDS')!;
    expect(noPanTds.amount.toString()).toBe('450000.00');
    expect(noPanTds.label).toMatch(/no-PAN rate.*Verify your PAN/i);
    await db.$executeRaw`UPDATE kyc.pan_record SET verified = TRUE WHERE org_id = ${VENDOR}::uuid`;

    const body = JSON.parse(JSON.stringify(preview));
    const keys = deepKeys(body);
    for (const forbidden of [
      'retailPrice',
      'sellingPrice',
      'rawSellingPrice',
      'unitPrice',
      'marginAmount',
      'margin',
      'warrantyReserve',
      'logisticsAllowance',
      'qcCostAllocation',
      'roundingAdjustment',
      'platformBackedMonths',
      'marginRuleId',
      'targetMarginPct',
      'floorMarginPct',
      'floorPrice',
      'priceBandMedian',
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    // And the number itself, under any name.
    const listingId = await makeDraft(ask, ['PRV0000001']);
    const priced = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Initial pricing' }),
    );
    expect(JSON.stringify(body)).not.toContain(priced.sellingPrice.toString());
  });

  it('charges the visit fee only where the vendor bears it', async () => {
    await makeMarginRule();
    const preview = await asVendor(() =>
      pricing.previewPayout({
        skuId,
        grade: 'A',
        vendorWarrantyMonths: 3,
        units: 10,
        ask: { mode: 'NET_PAYOUT', vendorNetPayout: Money.rupees(28_000) },
      }),
    );
    // qc.fee_bearer is TRUETECH at pilot: we carry it, so it is priced in and
    // never deducted. A vendor deduction here would be charging for it twice.
    expect(preview.deductions).toEqual([]);
  });
});

describe('the two pricing modes', () => {
  it('converge on one stored vendor ask, and refuse the wrong one', async () => {
    await makeMarginRule();

    const net = await asVendor(() =>
      pricing.resolveAsk({ mode: 'NET_PAYOUT', vendorNetPayout: Money.rupees(28_000) }),
    );
    expect(net.vendorAskPrice.toString()).toBe('28000.00');
    expect(net.pricingMode).toBe('NET_PAYOUT');

    // A vendor on NET_PAYOUT sending a commission ask means a stale screen.
    // Pricing it in the other mode would hand them a number they never agreed
    // to, which is worse than an error.
    await expect(
      asVendor(() =>
        pricing.resolveAsk({
          mode: 'COMMISSION',
          expectedSalePrice: Money.rupees(32_000),
          commissionPct: 12.5,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await db.$executeRaw`
      INSERT INTO vendor.vendor_payout_preference (org_id, pricing_mode)
      VALUES (${VENDOR}::uuid, 'COMMISSION')`;

    const commission = await asVendor(() =>
      pricing.resolveAsk({
        mode: 'COMMISSION',
        expectedSalePrice: Money.rupees(32_000),
        commissionPct: 12.5,
      }),
    );
    // Frozen the instant it is derived: 32,000 less 12.5% is a rupee amount from
    // here on, and nothing downstream re-derives it from the rate.
    expect(commission.vendorAskPrice.toString()).toBe('28000.00');
    expect(commission.pricingMode).toBe('COMMISSION');
  });
});

describe('margin rules', () => {
  /** The exit criterion: ops retunes margin and new listings move, with no deploy. */
  it('a margin rule change alters the price of new listings, with nothing restarted', async () => {
    const ruleId = await makeMarginRule({ targetPct: 12 });
    const listingId = await makeDraft(Money.rupees(28_000), ['MRC0000001']);

    const first = await asOps(() => pricing.priceListing(listingId, { reason: 'Initial pricing' }));

    await db.$executeRaw`
      UPDATE procurement.margin_rule SET target_margin_pct = 20 WHERE id = ${ruleId}::uuid`;

    const second = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Margin rule retuned by ops' }),
    );

    expect(second.sellingPrice.gt(first.sellingPrice)).toBe(true);
    expect(second.marginRuleId).toBe(ruleId);

    const history = await db.$queryRaw<
      Array<{ old_price: unknown; new_price: unknown; change_source: string; reason: string }>
    >`SELECT old_price, new_price, change_source, reason
        FROM listing.price_history WHERE listing_id = ${listingId}::uuid
       ORDER BY changed_at, id`;
    expect(history).toHaveLength(2);
    expect(history[1]!.change_source).toBe('MARGIN_RULE');
    expect(history[1]!.reason).toBe('Margin rule retuned by ops');
    expect(money(String(history[1]!.old_price)).toString()).toBe(first.sellingPrice.toString());
    expect(money(String(history[1]!.new_price)).toString()).toBe(second.sellingPrice.toString());

    // Every unit carries the price and the rule that produced it.
    const units = await db.$queryRaw<Array<{ retail_price: unknown; margin_rule_id: string }>>`
      SELECT retail_price, margin_rule_id FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
    expect(money(String(units[0]!.retail_price)).toString()).toBe(second.sellingPrice.toString());
    expect(units[0]!.margin_rule_id).toBe(ruleId);
  });

  it('refuses to price when no rule covers the machine, rather than guessing one', async () => {
    await makeMarginRule({ grade: 'B' });
    const listingId = await makeDraft(Money.rupees(28_000), ['NRL0000001'], 'A');
    await expect(
      asOps(() => pricing.priceListing(listingId, { reason: 'Initial pricing' })),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('takes the first match by priority and treats a NULL predicate as "don\'t care"', async () => {
    const specific = await makeMarginRule({ priority: 10, grade: 'A', targetPct: 25 });
    await makeMarginRule({ priority: 90, targetPct: 12 });

    const matched = await rules.resolveFor(skuId, 'A', Money.rupees(28_000));
    expect(matched!.id).toBe(specific);
    expect(matched!.rule.targetMarginPct).toBe(25);

    // A rule outside its value band falls through to the catch-all.
    await db.$executeRaw`
      UPDATE procurement.margin_rule SET value_from = 50000 WHERE id = ${specific}::uuid`;
    const fallback = await rules.resolveFor(skuId, 'A', Money.rupees(28_000));
    expect(fallback!.rule.targetMarginPct).toBe(12);

    // And a rule that has not started yet is scheduled, not current.
    await db.$executeRaw`
      UPDATE procurement.margin_rule SET value_from = NULL, effective_from = '2099-01-01'
       WHERE id = ${specific}::uuid`;
    expect((await rules.resolveFor(skuId, 'A', Money.rupees(28_000)))!.rule.targetMarginPct).toBe(
      12,
    );
  });
});

describe('the floor guard', () => {
  it('blocks activation below the floor until ops overrides it on the record', async () => {
    await makeMarginRule();
    // A cheap machine: the VR-085 absolute floor of Rs 500 is what bites here,
    // which is exactly the case a percentage floor cannot catch.
    const listingId = await makeDraft(Money.rupees(500), ['FLR0000001']);

    const outcome = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Initial pricing' }),
    );
    expect(outcome.belowFloor).toBe(true);
    await expect(asOps(() => pricing.assertActivatable(listingId))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });

    // A vendor cannot wave away our own floor.
    await expect(
      asVendor(() => pricing.overrideFloor(listingId, 'Long-standing customer')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await asOps(() =>
      pricing.overrideFloor(listingId, 'Clearance batch agreed with the vendor, ref OPS-4412'),
    );
    await expect(asOps(() => pricing.assertActivatable(listingId))).resolves.toBeUndefined();

    const [row] = await db.$queryRaw<
      Array<{ floor_override_by: string; floor_override_reason: string; floor_override_at: Date }>
    >`SELECT floor_override_by, floor_override_reason, floor_override_at
        FROM listing.listing WHERE id = ${listingId}::uuid`;
    // chk_floor_override_complete allows 0 or 3 — all three moved together.
    expect(row!.floor_override_by).toBe(platformUserId);
    expect(row!.floor_override_at).toBeInstanceOf(Date);
    expect(row!.floor_override_reason).toContain('OPS-4412');

    const [audit] = await db.$queryRaw<Array<{ reason: string; changed_by: string }>>`
      SELECT reason, changed_by FROM listing.price_history
       WHERE listing_id = ${listingId}::uuid AND change_source = 'FLOOR_OVERRIDE'`;
    expect(audit!.reason).toContain('OPS-4412');
    expect(audit!.changed_by).toBe(platformUserId);
  });

  it('refuses an override with no real justification', async () => {
    await makeMarginRule();
    const listingId = await makeDraft(Money.rupees(500), ['FLR0000002']);
    await asOps(() => pricing.priceListing(listingId, { reason: 'Initial pricing' }));
    await expect(asOps(() => pricing.overrideFloor(listingId, ' x '))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('the price band', () => {
  it('flags a listing far below the 30-day median, and does not block it', async () => {
    await makeMarginRule();
    for (let i = 0; i < 3; i += 1) {
      await makeListing(
        { vendorOrgId: VENDOR, skuId, pickupAddressId: addressId, grade: 'A', unitPrice: 40_000 },
        db,
      );
    }

    const listingId = await makeDraft(Money.rupees(5_000), ['PBD0000001']);
    const outcome = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Initial pricing' }),
    );
    expect(outcome.priceBandFlagged).toBe(true);

    const [row] = await db.$queryRaw<
      Array<{
        status: string;
        price_band_flagged_at: Date | null;
        price_band_median: unknown;
        price_band_ratio: unknown;
      }>
    >`SELECT status, price_band_flagged_at, price_band_median, price_band_ratio
        FROM listing.listing WHERE id = ${listingId}::uuid`;
    // Flagged, never blocked: the status is untouched.
    expect(row!.status).toBe('DRAFT');
    expect(row!.price_band_flagged_at).toBeInstanceOf(Date);
    expect(money(String(row!.price_band_median)).toString()).toBe('40000.00');
    expect(Number(row!.price_band_ratio)).toBeLessThan(0.3);

    // Correcting the price has to be able to clear the queue again — there is no
    // reviewed-at column, so the reprice is the only signal there is.
    await asVendor(() => listings.updateDraft(listingId, { vendorAskPrice: Money.rupees(40_000) }));
    const fixed = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Vendor corrected a typo' }),
    );
    expect(fixed.priceBandFlagged).toBe(false);
    const [cleared] = await db.$queryRaw<Array<{ n: number }>>`
      SELECT num_nonnulls(price_band_flagged_at, price_band_median, price_band_ratio) AS n
        FROM listing.listing WHERE id = ${listingId}::uuid`;
    expect(Number(cleared!.n)).toBe(0);
  });

  it('does not flag when there is no 30-day history for that (sku, grade)', async () => {
    await makeMarginRule();
    const listingId = await makeDraft(Money.rupees(5_000), ['PBD0000002']);
    const outcome = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Initial pricing' }),
    );
    // An absent median is not evidence of a bad price. Every first listing of a
    // new SKU would otherwise land in the review queue on day one.
    expect(outcome.priceBandFlagged).toBe(false);
  });

  it('ignores listings whose unit_price is still the vendor ask', async () => {
    await makeMarginRule();
    // A DRAFT sitting at the vendor's own Rs 5,000 ask must not become the
    // median a real retail price is judged against.
    await makeListing(
      {
        vendorOrgId: VENDOR,
        skuId,
        pickupAddressId: addressId,
        grade: 'A',
        unitPrice: 5_000,
        status: 'DRAFT',
      },
      db,
    );
    const listingId = await makeDraft(Money.rupees(5_000), ['PBD0000003']);
    const outcome = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Initial pricing' }),
    );
    expect(outcome.priceBandFlagged).toBe(false);
  });
});

describe('PAY-017 — rounding is applied once, at the end', () => {
  it('a 500-line order shows zero drift', async () => {
    await setRoundingStep(10);
    await makeMarginRule();
    const step = 10n * 100n;

    const serials = Array.from({ length: 500 }, (_, i) => `PAY017${String(i).padStart(5, '0')}`);
    const listingId = await makeDraft(Money.rupees(28_000), serials);
    const priced = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Initial pricing' }),
    );

    // Rounded once, to the configured step — not per component.
    expect(priced.sellingPrice.paise % step).toBe(0n);

    const [totals] = await db.$queryRaw<Array<{ total: unknown; n: bigint }>>`
      SELECT sum(retail_price) AS total, count(*)::bigint AS n
        FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
    expect(Number(totals!.n)).toBe(500);
    // Zero drift: 500 lines sum to exactly 500 x the line price, to the paise.
    expect(money(String(totals!.total)).toString()).toBe(priced.sellingPrice.times(500).toString());

    // And with 500 *different* line prices, the components still reconcile to
    // the totals exactly — the case where a per-component rounding bug would
    // accumulate instead of cancelling.
    const rule = await rules.resolveFor(skuId, 'A', Money.rupees(28_000));
    const lines = Array.from({ length: 500 }, (_, i) =>
      priceFromNetPayout({
        vendorNetPayout: Money.rupees(20_000 + i * 37),
        grade: 'A',
        rule: { ...rule!.rule, minTotalWarrantyMonths: 6 },
        vendorWarrantyMonths: 3,
        roundToNearest: 10,
      }),
    );
    for (const line of lines) {
      expect(line.sellingPrice.paise % step).toBe(0n);
      expect(
        line.vendorNetPayout
          .add(line.marginAmount)
          .add(line.logisticsAllowance)
          .add(line.qcCostAllocation)
          .add(line.warrantyReserve)
          .add(line.roundingAdjustment)
          .eq(line.sellingPrice),
      ).toBe(true);
    }
    const orderTotal = Money.sum(lines.map((l) => l.sellingPrice));
    const componentTotal = Money.sum(lines.map((l) => l.rawSellingPrice)).add(
      Money.sum(lines.map((l) => l.roundingAdjustment)),
    );
    expect(orderTotal.eq(componentTotal)).toBe(true);
  });
});
