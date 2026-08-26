/**
 * The brand tile rollup, after it stopped being a JOIN.
 *
 * `GET /api/public/brands` used to compute `count(DISTINCT s.id)` and
 * `count(DISTINCT u.id)` in one statement that read `catalog.*` and
 * `listing.v_sellable_unit` together. That join crossed a module seam, so the
 * stock half now comes from `ListingService.countSellableBySku()` and the two
 * halves are married on `sku_id` in TypeScript.
 *
 * Two things the JOIN did for free and the rollup has to do on purpose, which is
 * the entire reason this file exists:
 *
 *   - **DISTINCT.** brand -> series -> model -> sku fans out, so one SKU arrives
 *     on several rows. Counting rows instead of SKUs inflates every tile, and it
 *     inflates it *plausibly* — a number that is merely too large is the kind
 *     nobody notices until a vendor asks why we advertise stock we do not have.
 *
 *   - **The zero.** A SKU with no sellable unit is absent from the stock map
 *     entirely, not present with 0. `undefined` reaching an accumulator turns the
 *     whole tile into NaN, which then renders.
 *
 * The seed database has no units at all, so no integration test can reach this
 * arithmetic today — it would assert 0 === 0 for every brand and pass whatever
 * the code did.
 */

import { CatalogPublicController } from '../../src/modules/catalog/catalog-public.controller';
import type { ListingService } from '../../src/modules/listing';

type BrandSkuRow = { name: string; slug: string; sku_id: string };

/**
 * `$queryRaw` is a tagged template, so a plain function standing in for it gets
 * the same call. The controller's catalog half is exercised for real by the
 * integration suite; what is faked here is only the rows it would have returned.
 */
function controller(rows: BrandSkuRow[], sellable: Record<string, number>) {
  const prisma = { $queryRaw: () => Promise.resolve(rows) };
  const listings = {
    countSellableBySku: () => Promise.resolve(new Map(Object.entries(sellable))),
  } as unknown as ListingService;
  return new CatalogPublicController(
    prisma as never,
    listings,
    undefined as never,
    undefined as never,
  );
}

describe('public brand tiles', () => {
  it('counts a SKU once however many series and models reach it', async () => {
    // Dell has two SKUs; sku-1 arrives twice because two models carry it.
    const c = controller(
      [
        { name: 'Dell', slug: 'dell', sku_id: 'sku-1' },
        { name: 'Dell', slug: 'dell', sku_id: 'sku-1' },
        { name: 'Dell', slug: 'dell', sku_id: 'sku-2' },
      ],
      { 'sku-1': 3, 'sku-2': 4 },
    );

    expect(await c.brands()).toEqual([
      // 2, not 3: the duplicate row is the same machine spec.
      // 7, not 10: sku-1's three units are three units, counted once.
      { name: 'Dell', slug: 'dell', skuCount: 2, inStock: 7 },
    ]);
  });

  it('reports zero stock rather than NaN when a SKU has no sellable unit', async () => {
    const c = controller(
      [
        { name: 'HP', slug: 'hp', sku_id: 'sku-9' },
        { name: 'Acer', slug: 'acer', sku_id: 'sku-8' },
      ],
      // sku-9 is absent from the map entirely, which is what "no stock" looks
      // like coming out of a GROUP BY.
      { 'sku-8': 2 },
    );

    expect(await c.brands()).toEqual([
      { name: 'HP', slug: 'hp', skuCount: 1, inStock: 0 },
      { name: 'Acer', slug: 'acer', skuCount: 1, inStock: 2 },
    ]);
  });

  it('keeps brands separate when their tiles interleave in the result', async () => {
    // The SQL orders by brand name, but the rollup must not depend on that: a
    // Map keyed by slug is what makes the grouping order-independent.
    const c = controller(
      [
        { name: 'Asus', slug: 'asus', sku_id: 'sku-a' },
        { name: 'MSI', slug: 'msi', sku_id: 'sku-m' },
        { name: 'Asus', slug: 'asus', sku_id: 'sku-b' },
      ],
      { 'sku-a': 1, 'sku-b': 1, 'sku-m': 5 },
    );

    expect(await c.brands()).toEqual([
      { name: 'Asus', slug: 'asus', skuCount: 2, inStock: 2 },
      { name: 'MSI', slug: 'msi', skuCount: 1, inStock: 5 },
    ]);
  });
});
