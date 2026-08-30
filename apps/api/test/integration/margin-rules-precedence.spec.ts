/**
 * When two margin rules can price one machine, the screen and the pricer must
 * name the same winner.
 *
 * WHY THIS IS THE TEST THAT MATTERS
 * ---------------------------------
 * A margin rule decides what we keep between what a vendor is paid and what a
 * buyer pays. `procurement.margin_rule` resolves **first match wins, by
 * `(priority, created_at, id)`**, and overlap is the normal case rather than a
 * mistake: the seeded set has a `0-25,000` band at priority 5 and a Grade B rule
 * at priority 10, so a Grade B machine at 20,000 satisfies both.
 *
 * `/admin/pricing/margin-rules` tells ops which of the two wins. If that
 * assertion is computed by different code from the one that actually prices the
 * listing, the screen is a second opinion — and a margin quietly becoming
 * whichever row sorted first is exactly the failure nobody notices until a
 * reconciliation.
 *
 * So this file does not check the two agree in the abstract. It seeds a real
 * collision, reads the screen, then **prices a real listing through
 * `PricingService` and demands the rule the screen named is the rule the row
 * carries**. Mutation-checked: reversing the comparator in
 * `margin-rule-overlap.ts` fails it.
 *
 * The guard half attempts the forbidden thing rather than inspecting the grant.
 * `/admin/pricing` carries every margin we take; §3C.2 gives it to ADMIN_PRICING
 * and ADMIN_SUPER, and the tempting `listing.any.read` is also held by
 * OPS_MANAGER, QC_MANAGER, CATALOG_ADMIN and TECHNICIAN. Each refusal is paired
 * with the same call under a PRICING_ADMIN token, because a route broken for
 * everybody refuses everybody.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Money, permissionsFor, type Role } from '@trugrade/contracts';
import { AppModule } from '../../src/app.module';
import { TokenService } from '../../src/shared/auth/token.service';
import { RequestContextService, type Principal } from '../../src/shared/db/org-scope';
import { ListingService } from '../../src/modules/listing/listing.service';
import { PricingService } from '../../src/modules/listing/internal/pricing.service';
import { migrateTestDatabase, testDb, truncateAll, seedTestReference } from '../support/db';
import {
  ensurePlatformOrg,
  makeAddress,
  makeCatalog,
  makeOrganization,
  makeUser,
} from '../support/factories';

const ROUTE = '/api/admin/pricing/margin-rules';

/** A Grade B machine at 20,000 — inside the cheap band AND under the grade rule. */
const COLLIDING_ASK = Money.rupees(20_000);

let moduleRef: TestingModule;
let app: INestApplication;
let db: PrismaClient;
let ctx: RequestContextService;
let pricing: PricingService;
let listings: ListingService;

let vendorOrgId: string;
let vendorUserId: string;
let opsUserId: string;
let platformOrgId: string;
let addressId: string;
let skuId: string;

let cheapBandRuleId: string;
let gradeBRuleId: string;

const tokens: Record<string, string> = {};

async function issue(role: Role, orgType: 'PLATFORM' | 'VENDOR'): Promise<string> {
  const { accessToken } = await app.get(TokenService).issue({
    userId: randomUUID(),
    orgId: randomUUID(),
    orgType,
    roles: [role],
    permissions: [...permissionsFor([role])],
    mfa: true,
  });
  return accessToken;
}

function principal(
  userId: string,
  orgId: string,
  orgType: Principal['orgType'],
  roles: Role[],
): Principal {
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
  as(principal(vendorUserId, vendorOrgId, 'VENDOR', ['VENDOR_OWNER']), fn);

const asOps = <T>(fn: () => Promise<T>): Promise<T> =>
  as(principal(opsUserId, platformOrgId, 'PLATFORM', ['PRICING_ADMIN']), fn);

/** A rule, written straight to the table — nothing in the product creates one. */
async function makeRule(over: {
  priority: number;
  grade?: string | null;
  valueFrom?: number | null;
  valueTo?: number | null;
  targetPct?: number;
  floorPct?: number;
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO procurement.margin_rule
      (id, priority, category, brand_id, grade, value_from, value_to,
       target_margin_pct, floor_margin_pct, warranty_top_up_months,
       reserve_pct_by_grade, effective_from, effective_to, is_active)
    VALUES (${id}::uuid, ${over.priority}, NULL, NULL,
            ${over.grade ?? null}::grade_type,
            ${over.valueFrom ?? null}::numeric, ${over.valueTo ?? null}::numeric,
            ${over.targetPct ?? 15}, ${over.floorPct ?? 9}, 3,
            ${JSON.stringify({ A_PLUS: 1.5, A: 2.5, B: 4.0 })}::jsonb,
            ${over.effectiveFrom ?? '2020-01-01'}::date,
            ${over.effectiveTo ?? null}::date,
            ${over.isActive ?? true})`;
  return id;
}

async function screen(token: string): Promise<request.Response> {
  return request(app.getHttpServer()).get(ROUTE).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  migrateTestDatabase();
  db = testDb();
  await truncateAll(db);
  await seedTestReference(db);

  platformOrgId = await ensurePlatformOrg(db);
  opsUserId = await makeUser(platformOrgId, { full_name: 'Meera Raghavan' }, db);
  vendorOrgId = await makeOrganization({}, db);
  vendorUserId = await makeUser(vendorOrgId, {}, db);
  addressId = await makeAddress(vendorOrgId, {}, db);
  ({ skuId } = await makeCatalog({}, db));

  // `seedTestReference` restores the five production rules, and `truncateAll`
  // deliberately protects them. This suite is about precedence within a set it
  // controls, so it starts from an empty table — otherwise "these two rules are
  // the only ones that collide" is an assertion about somebody else's data.
  await db.$executeRaw`DELETE FROM procurement.margin_rule`;

  // The seeded collision, reproduced: a cheap-machine band that does not care
  // about grade, and a Grade B rule that does not care about price.
  cheapBandRuleId = await makeRule({ priority: 5, valueFrom: 0, valueTo: 25_000, targetPct: 20, floorPct: 13 });
  gradeBRuleId = await makeRule({ priority: 10, grade: 'B', targetPct: 18, floorPct: 11 });

  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });
  await app.init();

  ctx = app.get(RequestContextService);
  pricing = app.get(PricingService);
  listings = app.get(ListingService);

  for (const [role, orgType] of [
    ['PRICING_ADMIN', 'PLATFORM'],
    ['OPS_MANAGER', 'PLATFORM'],
    ['CATALOG_ADMIN', 'PLATFORM'],
    ['VENDOR_OWNER', 'VENDOR'],
  ] as Array<[Role, 'PLATFORM' | 'VENDOR']>) {
    tokens[role] = await issue(role, orgType);
  }
}, 240_000);

afterAll(async () => {
  await app?.close();
  await moduleRef?.close();
  await db?.$disconnect();
});

describe('the screen names the same winner the pricer does', () => {
  it('says the lower priority wins the collision', async () => {
    const res = await screen(tokens.PRICING_ADMIN!);
    expect(res.status).toBe(200);

    const cheap = res.body.rules.find((r: { id: string }) => r.id === cheapBandRuleId);
    const gradeB = res.body.rules.find((r: { id: string }) => r.id === gradeBRuleId);

    // Each names the other, and exactly one of them claims the win.
    expect(cheap.overlaps.find((o: { ruleId: string }) => o.ruleId === gradeBRuleId).wins).toBe(true);
    expect(gradeB.overlaps.find((o: { ruleId: string }) => o.ruleId === cheapBandRuleId).wins).toBe(false);
    // Resolution order, not the order the rows came back in.
    expect(cheap.order).toBeLessThan(gradeB.order);
  });

  it('and the listing it prices carries that rule, not the other one', async () => {
    const listingId = await makeDraft(COLLIDING_ASK, ['MRP000000001'], 'B');
    const outcome = await asOps(() =>
      pricing.priceListing(listingId, { reason: 'Precedence check' }),
    );

    // The whole point of the file. The screen said the cheap band wins a Grade B
    // machine at 20,000; the engine has now actually priced one.
    expect(outcome.marginRuleId).toBe(cheapBandRuleId);

    // And the target margin that was applied is the winner's 20%, not the Grade
    // B rule's 18% — so this is about the rule, not about a matching id.
    const margin = Money.percentOf(COLLIDING_ASK, 20);
    expect(outcome.sellingPrice.gte(COLLIDING_ASK.add(margin))).toBe(true);

    // The attribution column the screen reports on is genuinely written.
    const rows = await db.$queryRaw<Array<{ margin_rule_id: string | null }>>`
      SELECT margin_rule_id FROM listing.unit WHERE listing_id = ${listingId}::uuid`;
    expect(rows.every((r) => r.margin_rule_id === cheapBandRuleId)).toBe(true);

    // On sale, so the live totals below have something real to add up. Written
    // here rather than through activation because `assertActivatable` is a
    // different subject and this suite is not testing it.
    await goLive(listingId);
  });

  it('stops calling it a collision once the cheap band is switched off', async () => {
    await db.$executeRaw`
      UPDATE procurement.margin_rule SET is_active = FALSE WHERE id = ${cheapBandRuleId}::uuid`;
    try {
      const res = await screen(tokens.PRICING_ADMIN!);
      const gradeB = res.body.rules.find((r: { id: string }) => r.id === gradeBRuleId);
      expect(gradeB.overlaps).toEqual([]);

      // And the pricer agrees: the same machine now resolves to the Grade B rule.
      const listingId = await makeDraft(COLLIDING_ASK, ['MRP000000002'], 'B');
      const outcome = await asOps(() =>
        pricing.priceListing(listingId, { reason: 'Precedence check, rule disabled' }),
      );
      expect(outcome.marginRuleId).toBe(gradeBRuleId);
    } finally {
      await db.$executeRaw`
        UPDATE procurement.margin_rule SET is_active = TRUE WHERE id = ${cheapBandRuleId}::uuid`;
    }
  });
});

describe('what the screen refuses to make up', () => {
  it('reports no ceiling as absent, never as zero', async () => {
    const res = await screen(tokens.PRICING_ADMIN!);
    for (const rule of res.body.rules) {
      // There is no ceiling COLUMN on procurement.margin_rule. A rule with no
      // ceiling set is not a rule that caps margin at nothing.
      expect(rule.ceilingMarginPct).toBeNull();
    }
  });

  it('reports a rule that prices nothing as null, never as a row of zeroes', async () => {
    const idle = await makeRule({ priority: 900, grade: 'A_PLUS', effectiveFrom: '2020-01-01' });
    try {
      const res = await screen(tokens.PRICING_ADMIN!);
      const rule = res.body.rules.find((r: { id: string }) => r.id === idle);
      expect(rule.live).toBeNull();
    } finally {
      await db.$executeRaw`DELETE FROM procurement.margin_rule WHERE id = ${idle}::uuid`;
    }
  });

  it('counts the warranty reserve rather than claiming it', async () => {
    const res = await screen(tokens.PRICING_ADMIN!);
    // Nothing consumes `reserve_pct_by_grade` — `platform.warranty.reserve_amount`
    // is left NULL (T23). The screen must be able to stop saying so on its own
    // the day a writer appears, so it is served two counts, not a sentence.
    expect(typeof res.body.reserve.warranties).toBe('number');
    expect(res.body.reserve.withReserveAmount).toBe(0);
  });

  it('asks the catalog whether a price book exists instead of assuming', async () => {
    const res = await screen(tokens.PRICING_ADMIN!);
    expect(res.body.priceBook.tableExists).toBe(false);

    // The claim on screen is only as good as the question behind it, so prove
    // the question is a real one: to_regclass finds a relation that IS there.
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass('procurement.margin_rule') IS NOT NULL AS present`;
    expect(rows[0]!.present).toBe(true);
  });

  it('does not recompute the money it reports — the totals are the stored rows', async () => {
    const res = await screen(tokens.PRICING_ADMIN!);
    const priced = res.body.rules.filter((r: { live: unknown }) => r.live !== null);
    expect(priced.length).toBeGreaterThan(0);

    for (const rule of priced) {
      // margin is exactly what we charge minus what we pay, to the paisa. A
      // recomputed figure would not tie out against the rows.
      const selling = Money.parse(rule.live.sellingPrice);
      const payout = Money.parse(rule.live.vendorPayout);
      expect(rule.live.margin).toBe(selling.sub(payout).toString());
    }
  });
});

describe('the margin table is not readable by everyone who can read a listing', () => {
  it.each(['VENDOR_OWNER', 'OPS_MANAGER', 'CATALOG_ADMIN'])('refuses %s', async (role) => {
    const res = await screen(tokens[role]!);
    expect(res.status).toBe(403);
    // Nothing about what we keep may ride along on the refusal itself.
    expect(JSON.stringify(res.body)).not.toMatch(/marginPct|targetMargin|vendorPayout/i);
  });

  it('answers PRICING_ADMIN, so the refusals above are about the caller', async () => {
    const res = await screen(tokens.PRICING_ADMIN!);
    expect(res.status).toBe(200);
    expect(res.body.rules.length).toBeGreaterThan(0);
  });

  it('and OPS_MANAGER holds listing.any.read, so the guard is the narrow one', async () => {
    const claims = await app.get(TokenService).verifyAccess(tokens.OPS_MANAGER!);
    // If this ever stops being true the refusal above proves something weaker
    // than it looks: it would be refusing a role that could not read a listing
    // either, rather than a role that can read listings and not margins.
    expect(claims.scope).toContain('listing.any.read');
    expect(claims.scope).not.toContain('listing.price.override');
  });
});

/**
 * Put a priced listing on sale, so `liveCombinations` can see it.
 *
 * `unit.status = 'LISTED'` and the listing ACTIVE are the two conditions the
 * controller's query applies, and they are what "this rule is pricing something
 * right now" means.
 */
async function goLive(listingId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE listing.listing SET status = 'ACTIVE'::listing_status WHERE id = ${listingId}::uuid`;
  await db.$executeRaw`
    UPDATE listing.unit SET status = 'LISTED'::unit_status WHERE listing_id = ${listingId}::uuid`;
}

/** A vendor draft with units, through the product's own path. */
async function makeDraft(ask: Money, serials: string[], grade: 'A_PLUS' | 'A' | 'B'): Promise<string> {
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
