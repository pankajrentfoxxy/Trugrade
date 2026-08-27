/**
 * PHASE_05 Tasks 6 and 7 — the cart and the bulk-requirement intake.
 *
 * Against the real database, because every property under test is one only
 * Postgres can produce: `v_sellable_unit` re-evaluating the expiry predicate on
 * read (so a stale `is_sellable` flag stops mattering at midnight), the partial
 * `uq_cart_active_name` index, and the supply-point assignment that turns a
 * vendor org id into a letter before anything customer-facing ever sees it.
 *
 * The anonymity assertions are on the **serialised** payload, not on typed
 * properties (`IDN-080`…`IDN-094`). Walking fields proves only that the fields
 * somebody thought of are clean.
 */

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import {
  assertNoVendorIdentity,
  findForbiddenKeys,
  permissionsFor,
  type Role,
} from '@trugrade/contracts';
import { ClockPort, FixedClock } from '../../src/shared/clock';
import { AppConfig, ConfigModule } from '../../src/shared/config';
import { PrismaService } from '../../src/shared/db/prisma.service';
import {
  ContextModule,
  RequestContextService,
  type Principal,
} from '../../src/shared/db/org-scope';
import { CatalogService } from '../../src/modules/catalog';
import { CatalogChangeLogService } from '../../src/modules/catalog/internal/catalog-change-log.service';
import { CatalogSearchService } from '../../src/modules/catalog/internal/catalog-search.service';
import { ConditionImageService } from '../../src/modules/catalog/internal/condition-image.service';
import { SkuImportService } from '../../src/modules/catalog/internal/sku-import.service';
import { SkuRepository } from '../../src/modules/catalog/internal/sku.repository';
import { SkuRequestService } from '../../src/modules/catalog/internal/sku-request.service';
import { ListingService } from '../../src/modules/listing';
import { ListingRepository } from '../../src/modules/listing/internal/listing.repository';
import { SerialService } from '../../src/modules/listing/internal/serial.service';
import { PlatformService } from '../../src/modules/platform';
import { CartService } from '../../src/modules/ordering/internal/cart.service';
import { CatalogLookup } from '../../src/modules/ordering/internal/catalog-lookup';
import { RfqIntakeService } from '../../src/modules/ordering/internal/rfq-intake.service';
import {
  closeTestDb,
  migrateTestDatabase,
  seedTestReference,
  testDatabaseUrl,
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

const FIXED_NOW = new Date('2026-08-26T06:00:00.000Z');

let moduleRef: TestingModule;
let carts: CartService;
let requirements: RfqIntakeService;
let catalog: CatalogService;
let ctx: RequestContextService;
let raw: PrismaClient;

let buyerOrgId: string;
let buyerUserId: string;

function asBuyer<T>(fn: () => Promise<T>): Promise<T> {
  const roles: Role[] = ['CUSTOMER_BUYER'];
  const principal: Principal = {
    userId: buyerUserId,
    orgId: buyerOrgId,
    orgType: 'BUYER',
    roles,
    permissions: permissionsFor(roles),
    sessionId: 's', mfaSatisfied: true,
  };
  return ctx.run({ requestId: 't' }, () => {
    ctx.setPrincipal(principal);
    return fn();
  });
}

beforeAll(async () => {
  migrateTestDatabase();
  raw = testDb();
  await seedTestReference(raw);

  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ContextModule],
    providers: [
      { provide: ClockPort, useValue: new FixedClock(FIXED_NOW) },
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
      // Ordering's own three.
      CartService,
      CatalogLookup,
      RfqIntakeService,
      // The two barrels ordering legitimately depends on...
      ListingService,
      ListingRepository,
      SerialService,
      PlatformService,
      // ...and catalog, which `CatalogLookup` resolves out of the container
      // rather than through a module import, because catalog imports ordering.
      CatalogService,
      CatalogChangeLogService,
      CatalogSearchService,
      ConditionImageService,
      SkuImportService,
      SkuRepository,
      SkuRequestService,
    ],
  }).compile();

  carts = moduleRef.get(CartService);
  requirements = moduleRef.get(RfqIntakeService);
  catalog = moduleRef.get(CatalogService);
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
  buyerOrgId = await makeOrganization(
    { org_type: 'BUYER', legal_name: 'Northwind Procurement Pvt Ltd' },
    raw,
  );
  buyerUserId = await makeUser(buyerOrgId, { full_name: 'Anita Rao' }, raw);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Supply {
  vendorOrgId: string;
  listingId: string;
  skuId: string;
  city: string;
  code: string;
  legalName: string;
  addressLine: string;
  phone: string;
}

/**
 * One vendor, in one city, with `qty` sellable machines on one listing.
 *
 * The supply point is assigned through `listing.assign_supply_point` — the same
 * function the application uses — rather than by writing a letter onto the unit
 * by hand. A test that invents its own label would pass while the real
 * assignment was broken, which is the one failure that matters here.
 */
async function makeSupply(input: {
  city: string;
  qty: number;
  unitPrice?: number;
  model?: string;
  brand?: string;
  skuId?: string;
}): Promise<Supply> {
  const legalName = `Nexus IT Recyclers ${randomUUID().slice(0, 8)}`;
  const vendorOrgId = await makeOrganization({ org_type: 'VENDOR', legal_name: legalName }, raw);
  const pickupAddressId = await makeAddress(vendorOrgId, { city: input.city }, raw);
  const skuId =
    input.skuId ?? (await makeCatalog({ brand: input.brand, model: input.model }, raw)).skuId;

  // `qty` here is `qty_total`, and `chk_qty_balance` holds the listing's
  // counters to it — `trg_listing_counters` raises `qty_available` as each unit
  // lands, so a listing declared for one machine cannot hold three.
  const listingId = await makeListing(
    { vendorOrgId, skuId, pickupAddressId, qty: input.qty, unitPrice: input.unitPrice ?? 42000 },
    raw,
  );

  // One technician for the whole listing: makeUnit creates a fresh one per call
  // otherwise, and twenty technicians for five machines makes the fixture the
  // slowest part of the suite.
  const tech = await makeTechnician(raw);
  for (let i = 0; i < input.qty; i++) {
    await makeUnit(
      {
        listingId,
        vendorOrgId,
        skuId,
        technicianId: tech.technicianId,
        technicianUserId: tech.userId,
      },
      raw,
    );
  }

  const [assigned] = await raw.$queryRaw<Array<{ code: string }>>`
    SELECT listing.assign_supply_point(${vendorOrgId}::uuid, ${input.city}) AS code`;
  const code = assigned!.code;
  await raw.$executeRaw`
    UPDATE listing.unit SET supply_point_code = ${code} WHERE listing_id = ${listingId}::uuid`;

  const [addr] = await raw.$queryRaw<Array<{ line1: string; contact_mobile: string }>>`
    SELECT line1, contact_mobile FROM identity.org_address WHERE id = ${pickupAddressId}::uuid`;

  return {
    vendorOrgId,
    listingId,
    skuId,
    city: input.city,
    code,
    legalName,
    addressLine: addr!.line1,
    phone: addr!.contact_mobile,
  };
}

/** Every vendor identity in the fixture, in the forms it could leak in. */
function identityOf(s: Supply) {
  return {
    orgId: s.vendorOrgId,
    legalName: s.legalName,
    addressLines: [s.addressLine],
    phones: [s.phone],
  };
}

function assertAnonymous(payload: unknown, supplies: readonly Supply[]): void {
  for (const s of supplies) assertNoVendorIdentity(payload, identityOf(s));
  expect(findForbiddenKeys(payload)).toEqual([]);

  // The vocabulary matters as much as the values. Under merchant-of-record there
  // is one seller, so a buyer payload that says "vendor", "supplier" or
  // "sub-order" has published an internal concept even with every id stripped.
  const json = JSON.stringify(payload).toLowerCase();
  for (const word of ['vendor', 'supplier', 'sub-order', 'sub_order', 'suborder', 'gstin']) {
    expect(json).not.toContain(word);
  }
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

describe('cart', () => {
  it('reads as one order across two supply points, with honest per-line availability', async () => {
    const gurugram = await makeSupply({ city: 'Gurugram', qty: 3, unitPrice: 42000 });
    const noida = await makeSupply({ city: 'Noida', qty: 2, unitPrice: 39500 });

    const view = await asBuyer(async () => {
      const cart = await carts.create('Q3 laptop refresh');
      await carts.addLine(cart.id, gurugram.listingId, 3);
      return carts.addLine(cart.id, noida.listingId, 5);
    });

    // Two dispatch points, one order. Nothing in the payload calls them orders.
    expect(view.dispatchGroups).toHaveLength(2);
    const labels = view.dispatchGroups.map((g) => g.label).sort();
    expect(labels).toEqual(
      [`Supply Point ${gurugram.code} · Gurugram`, `Supply Point ${noida.code} · Noida`].sort(),
    );

    const lines = view.dispatchGroups.flatMap((g) => g.lines);
    const fromGurugram = lines.find((l) => l.offerId === gurugram.listingId)!;
    const fromNoida = lines.find((l) => l.offerId === noida.listingId)!;

    expect(fromGurugram.qtyAvailable).toBe(3);
    expect(fromGurugram.availability).toBe('3 units available.');

    // The sentence PHASE_05 Task 6 asks for, word for word.
    expect(fromNoida.qtyAvailable).toBe(2);
    expect(fromNoida.availability).toBe('2 of the 5 units you selected are still available.');
    expect(view.needsAttention).toBe(true);

    // Priced on what can ship: 3 × 42,000 + 2 × 39,500.
    expect(view.goodsTotal).toBe('205000.00');
    expect(view.itemCount).toBe(2);

    assertAnonymous(view, [gurugram, noida]);
  });

  it('drops a line out of the availability count when its unit expired overnight', async () => {
    const supply = await makeSupply({ city: 'Gurugram', qty: 1 });

    const before = await asBuyer(async () => {
      const cart = await carts.create('Overnight');
      return carts.addLine(cart.id, supply.listingId, 1);
    });
    expect(before.dispatchGroups[0]!.lines[0]!.qtyAvailable).toBe(1);

    // Midnight passes. `is_sellable` is computed on WRITE, so the flag stays
    // TRUE until something touches the row — which is exactly the stale state
    // `v_sellable_unit` exists to see through. The trigger is disabled so the
    // UPDATE cannot quietly correct the flag and make the test prove nothing.
    await raw.$executeRawUnsafe('ALTER TABLE listing.unit DISABLE TRIGGER trg_recompute_sellable');
    try {
      await raw.$executeRaw`
        UPDATE listing.unit
           SET qc_valid_until = CURRENT_DATE - 1
         WHERE listing_id = ${supply.listingId}::uuid`;
    } finally {
      await raw.$executeRawUnsafe('ALTER TABLE listing.unit ENABLE TRIGGER trg_recompute_sellable');
    }

    const [stale] = await raw.$queryRaw<Array<{ is_sellable: boolean }>>`
      SELECT is_sellable FROM listing.unit WHERE listing_id = ${supply.listingId}::uuid`;
    expect(stale!.is_sellable).toBe(true);

    const after = await asBuyer(() => carts.view(before.id));
    const line = after.dispatchGroups[0]!.lines[0]!;
    expect(line.qtyAvailable).toBe(0);
    expect(line.availability).toBe('None of the 1 unit you selected is still available.');
    expect(after.needsAttention).toBe(true);
    // Nothing shippable, so nothing owed for it.
    expect(after.goodsTotal).toBe('0.00');
  });

  it('keeps parallel named carts apart and refuses a duplicate name', async () => {
    const supply = await makeSupply({ city: 'Gurugram', qty: 2 });

    const { finance, ops } = await asBuyer(async () => {
      const finance = await carts.create('Finance dept');
      const ops = await carts.create('Ops dept');
      await carts.addLine(finance.id, supply.listingId, 1);
      return { finance, ops };
    });

    const open = await asBuyer(() => carts.listOpen());
    expect(open.map((c) => c.name).sort()).toEqual(['Finance dept', 'Ops dept']);
    expect(open.find((c) => c.id === finance.id)!.lineCount).toBe(1);
    expect(open.find((c) => c.id === ops.id)!.lineCount).toBe(0);

    // `uq_cart_active_name` indexes lower(btrim(name)), so the collision is on
    // the name a person would read, not on the bytes they typed.
    await expect(asBuyer(() => carts.create('  finance dept  '))).rejects.toThrow(
      /already have an open cart/i,
    );
  });

  it('replaces the quantity on a second add rather than accumulating', async () => {
    const supply = await makeSupply({ city: 'Gurugram', qty: 5 });

    const view = await asBuyer(async () => {
      const cart = await carts.create('Repeat');
      await carts.addLine(cart.id, supply.listingId, 2);
      return carts.addLine(cart.id, supply.listingId, 4);
    });

    expect(view.itemCount).toBe(1);
    expect(view.dispatchGroups[0]!.lines[0]!.qtyRequested).toBe(4);
  });

  it('will not put a paused offer in a cart', async () => {
    const supply = await makeSupply({ city: 'Gurugram', qty: 2 });
    await raw.$executeRaw`
      UPDATE listing.listing SET status = 'PAUSED' WHERE id = ${supply.listingId}::uuid`;

    await expect(
      asBuyer(async () => {
        const cart = await carts.create('Paused');
        return carts.addLine(cart.id, supply.listingId, 1);
      }),
    ).rejects.toThrow();
  });

  it('does not let one buyer read another buyer organisation cart', async () => {
    const mine = await asBuyer(() => carts.create('Mine'));

    const otherOrgId = await makeOrganization({ org_type: 'BUYER', legal_name: 'Rival Ltd' }, raw);
    const otherUserId = await makeUser(otherOrgId, {}, raw);
    const roles: Role[] = ['CUSTOMER_BUYER'];

    await expect(
      ctx.run({ requestId: 't2' }, () => {
        ctx.setPrincipal({
          userId: otherUserId,
          orgId: otherOrgId,
          orgType: 'BUYER',
          roles,
          permissions: permissionsFor(roles),
          sessionId: 's2', mfaSatisfied: true,
        });
        return carts.view(mine.id);
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bulk requirement intake
// ---------------------------------------------------------------------------

describe('bulk requirement intake', () => {
  it('matches what we stock, and turns the rest into one internal lead', async () => {
    const latitude = await makeSupply({
      city: 'Gurugram',
      qty: 4,
      brand: 'Dell',
      model: 'Latitude 5320',
    });
    await makeSupply({ city: 'Noida', qty: 2, brand: 'Lenovo', model: 'ThinkPad T14' });
    // The search index is a materialised view, so it holds the previous test's
    // rows until this runs. A forgotten refresh here passes on stale data.
    await catalog.refreshSearchIndex();

    const csv = [
      'model,quantity,grade,target_price,delivery_pincode,needed_by',
      'Latitude 5320,10,A,38000.00,110001,2026-10-01',
      'ThinkPad T14,6,B,,110001,',
      'Rugged tablet with integrated barcode scanner,3,,,110001,',
    ].join('\n');

    const result = await asBuyer(() => {
      const { rows, rejected } = requirements.fromCsv(csv);
      return requirements.intake(rows, rejected);
    });

    expect(result.matched.map((m) => m.line).sort()).toEqual([2, 3]);
    expect(result.rejected).toEqual([]);

    const dell = result.matched.find((m) => m.title.includes('Latitude 5320'))!;
    expect(dell.qtyRequested).toBe(10);
    expect(dell.unitsAvailableNow).toBe(4);
    expect(dell.skuId).toBe(latitude.skuId);
    expect(dell.reference).toMatch(/^RFQ-\d{6}-[0-9A-F]{8}$/);

    // The unmatched row, and only that row, is what the sales desk has to source.
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]).toMatchObject({
      line: 4,
      model: 'Rugged tablet with integrated barcode scanner',
      quantity: 3,
    });
    expect(result.salesLeadReference).toMatch(/^TKT-/);

    // The lead exists, is ours, and carries the parsed rows on an INTERNAL
    // message — a requirement list is the buyer's commercial intent and does not
    // belong on a thread they are shown verbatim.
    const [ticket] = await raw.$queryRaw<Array<{ id: string; org_id: string; category: string }>>`
      SELECT id, org_id, category FROM platform.ticket
       WHERE ticket_number = ${result.salesLeadReference}`;
    expect(ticket!.org_id).toBe(buyerOrgId);
    expect(ticket!.category).toBe('BULK_REQUIREMENT');

    const [message] = await raw.$queryRaw<Array<{ body: string; is_internal: boolean }>>`
      SELECT body, is_internal FROM platform.ticket_message WHERE ticket_id = ${ticket!.id}::uuid`;
    expect(message!.is_internal).toBe(true);
    expect(message!.body).toContain('Rugged tablet with integrated barcode scanner');

    // The requirements we matched are on the record, open, and quotable.
    const rfqs = await raw.$queryRaw<Array<{ qty: number; status: string; sku_id: string }>>`
      SELECT qty, status, sku_id FROM ordering.rfq WHERE buyer_org_id = ${buyerOrgId}::uuid`;
    expect(rfqs).toHaveLength(2);
    expect(rfqs.every((r) => r.status === 'OPEN')).toBe(true);

    // **No vendor is invited to bid.** Sourcing against a requirement is ours to
    // do under merchant-of-record, and `rfq_quote` is the marketplace table this
    // module deliberately never writes.
    const [quotes] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ordering.rfq_quote`;
    expect(Number(quotes!.n)).toBe(0);

    assertAnonymous(result, [latitude]);
  });

  it('raises no lead when the whole list matches', async () => {
    await makeSupply({ city: 'Gurugram', qty: 1, brand: 'Dell', model: 'Latitude 5320' });
    await catalog.refreshSearchIndex();

    const result = await asBuyer(() => {
      const { rows, rejected } = requirements.fromCsv(
        'model,quantity,delivery_pincode\nLatitude 5320,2,110001\n',
      );
      return requirements.intake(rows, rejected);
    });

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toEqual([]);
    expect(result.salesLeadReference).toBeNull();

    const [tickets] = await raw.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM platform.ticket`;
    expect(Number(tickets!.n)).toBe(0);
  });

  it('reports a bad row by its line number and still takes the good ones', async () => {
    await makeSupply({ city: 'Gurugram', qty: 1, brand: 'Dell', model: 'Latitude 5320' });
    await catalog.refreshSearchIndex();

    const csv = [
      'model,quantity,delivery_pincode',
      'Latitude 5320,2,110001',
      'Latitude 5320,not-a-number,110001',
    ].join('\n');

    const result = await asBuyer(() => {
      const { rows, rejected } = requirements.fromCsv(csv);
      return requirements.intake(rows, rejected);
    });

    expect(result.matched).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.line).toBe(3);
  });

  it('refuses a file whose header does not name the columns it needs', () => {
    expect(() => requirements.fromCsv('machine,howmany\nLatitude,5')).toThrow(/quantity/i);
  });
});
