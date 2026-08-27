/**
 * The three things about `/api/public/search` that would be silently wrong.
 *
 * None of these asserts that a guard exists. Each attempts the thing the search
 * must not do and expects the search to refuse.
 *
 * 1. **A facet count must not apply its own group.** Tick "Acer" and, if the
 *    count for every other brand is computed with the brand filter applied, they
 *    all read zero, all disable themselves, and a second brand can never be
 *    added. The rail then looks broken in exactly the way §6 spends a paragraph
 *    forbidding — and it looks broken *plausibly*, which is worse.
 *
 * 2. **A zero-count option must still be in the answer.** The option list comes
 *    from the catalogue, not from stock, so a brand we deal in but hold nothing
 *    of comes back with `count: 0` rather than not coming back. If it were
 *    absent the rail could not disable it, because there would be nothing there
 *    to disable.
 *
 * 3. **No vendor identifier may reach the response.** The rows fed in here
 *    deliberately carry a vendor's org id, legal name and GSTIN as extra
 *    properties — the shape a careless `{...row}` in a future edit would
 *    produce. The serialised answer is then swept with the contracts package's
 *    own leak finder. A test that merely listed the fields it expected would
 *    pass through any future spread.
 */
import { assertNoVendorIdentity, type VendorIdentity } from '@trugrade/contracts';
import {
  runSearch,
  type CatalogRow,
  type SearchQuery,
  type SearchRow,
} from '../../src/modules/catalog/internal/search-facets';

/* ---------------------------------------------------------------- fixtures */

const VENDOR: VendorIdentity = {
  orgId: '9f7c1a44-0e5d-4a1a-9d7a-2f3b6c8e1a22',
  legalName: 'Harbourpoint Technologies Private Limited',
  tradeName: 'Harbourpoint IT',
  gstin: '06AABCH1234M1Z7',
  pan: 'AABCH1234M',
  addressLines: ['Plot 44, Udyog Vihar Phase IV, Gurugram'],
  phones: ['+919810011122'],
  emails: ['ops@harbourpoint.example'],
  slug: 'harbourpoint-technologies',
};

const EMPTY: SearchQuery = {
  q: '',
  brand: [],
  series: [],
  cpu: [],
  gen: [],
  ram: [],
  sgb: [],
  stype: [],
  grade: [],
  bmin: null,
  bmax: null,
  smin: null,
  pmin: null,
  pmax: null,
  screen: [],
  res: [],
  ship: [],
  city: [],
  qty: null,
  feat: [],
  warr: [],
  sort: 'price',
  page: 1,
  per: 12,
};

function sku(over: Partial<CatalogRow> & { skuId: string; brandSlug: string }): CatalogRow {
  return {
    brandName: over.brandSlug.toUpperCase(),
    seriesName: 'Series One',
    modelName: 'Model One',
    cpuFamily: 'Core i5',
    cpuModel: 'i5-1135G7',
    cpuGeneration: '11th',
    ramGb: 8,
    storageGb: 256,
    storageType: 'NVME_SSD',
    screenInch: 14,
    resolution: 'FHD',
    isTouch: false,
    backlit: true,
    fingerprint: false,
    thunderbolt: false,
    ...over,
  };
}

function unit(spec: CatalogRow, over: Partial<SearchRow> = {}): SearchRow {
  return {
    ...spec,
    grade: 'A',
    price: 30000,
    battery: 90,
    score: 92,
    supplyPointCode: 'M',
    city: 'Gurugram',
    shipHours: 48,
    warrantyMonths: null,
    serial: `TG${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    ...over,
  };
}

const ACER = sku({ skuId: 'sku-acer', brandSlug: 'acer', brandName: 'Acer' });
const DELL = sku({ skuId: 'sku-dell', brandSlug: 'dell', brandName: 'Dell' });
const LENOVO = sku({ skuId: 'sku-lenovo', brandSlug: 'lenovo', brandName: 'Lenovo', ramGb: 16 });

/** Acer has stock, Lenovo has stock, Dell is catalogued and empty. */
const CATALOG = [ACER, DELL, LENOVO];
const ROWS = [
  ...Array.from({ length: 3 }, () => unit(ACER)),
  ...Array.from({ length: 2 }, () => unit(LENOVO, { grade: 'B', price: 41000 })),
];

const brandCount = (facets: ReturnType<typeof runSearch>['facets'], slug: string): number =>
  facets.brand!.options.find((o) => o.value === slug)!.count;

/* ------------------------------------------------------------------- tests */

describe('faceted search', () => {
  it('counts a facet with every OTHER group applied, never its own', () => {
    const unfiltered = runSearch(ROWS, CATALOG, EMPTY);
    expect(brandCount(unfiltered.facets, 'acer')).toBe(3);
    expect(brandCount(unfiltered.facets, 'lenovo')).toBe(2);

    // Now tick Acer. The RESULTS narrow to Acer...
    const acerOnly = runSearch(ROWS, CATALOG, { ...EMPTY, brand: ['acer'] });
    expect(acerOnly.total).toBe(3);

    // ...but Lenovo must still report the 2 units it would return, or it
    // disables itself and the reader can never add a second brand.
    expect(brandCount(acerOnly.facets, 'lenovo')).toBe(2);
    expect(brandCount(acerOnly.facets, 'acer')).toBe(3);
    expect(acerOnly.facets.brand!.options.find((o) => o.value === 'acer')!.selected).toBe(true);

    // The other half of the same rule, which is what makes it a rule and not a
    // bug: a facet DOES apply every other group. With grade B ticked, its own
    // options are still counted over all grades (A stays at 3, so the reader can
    // switch), while Memory — a different group — narrows to the B units and
    // reports 8 GB as empty rather than as three.
    const gradeB = runSearch(ROWS, CATALOG, { ...EMPTY, grade: ['B'] });
    expect(gradeB.total).toBe(2);
    expect(gradeB.facets.grade!.options.find((o) => o.value === 'A')!.count).toBe(3);
    expect(gradeB.facets.ram!.options.find((o) => o.value === '16')!.count).toBe(2);
    expect(gradeB.facets.ram!.options.find((o) => o.value === '8')!.count).toBe(0);
  });

  it('returns a zero-count option rather than omitting it', () => {
    const { facets } = runSearch(ROWS, CATALOG, EMPTY);
    const dell = facets.brand!.options.find((o) => o.value === 'dell');

    // Present, at zero, and not selected — which is exactly what the rail needs
    // to render it disabled at --ink-4 instead of dropping the row.
    expect(dell).toBeDefined();
    expect(dell!.count).toBe(0);
    expect(dell!.selected).toBe(false);

    // And a filter that matches nothing empties the results without emptying
    // the rail: the option that took the count to zero is still readable.
    const nothing = runSearch(ROWS, CATALOG, { ...EMPTY, brand: ['dell'] });
    expect(nothing.total).toBe(0);
    expect(nothing.results).toHaveLength(0);
    expect(nothing.facets.brand!.options).toHaveLength(3);
  });

  it('lets no vendor identifier through, even when the input rows carry one', () => {
    // The shape a future `{...unitRow}` would produce. If the response were
    // built by spreading rather than by naming fields, every one of these
    // reaches a buyer.
    const contaminated = ROWS.map((r) => ({
      ...r,
      vendorOrgId: VENDOR.orgId,
      vendorLegalName: VENDOR.legalName,
      vendorGstin: VENDOR.gstin,
      vendorPhone: VENDOR.phones![0],
      metadata: { supplier: VENDOR.tradeName, key: `s3://units/${VENDOR.slug}/report.pdf` },
    })) as SearchRow[];

    const answer = runSearch(contaminated, CATALOG, EMPTY);

    // Sanity: the contaminated rows really did produce results, so the sweep
    // below is reading a populated payload rather than an empty one.
    expect(answer.results.length).toBeGreaterThan(0);
    assertNoVendorIdentity(answer, VENDOR);

    // The city and the supply-point count are the only facts about the source
    // that survive, which is what `supplyPointLabel` renders.
    expect(answer.results[0]!.cities).toEqual(['Gurugram']);
    expect(answer.results[0]!.supplyPoints).toBe(1);
  });

  it('never turns an unmeasured battery into a zero, and never sorts it first', () => {
    const rows = [
      unit(ACER, { battery: null, score: null, price: 20000 }),
      unit(ACER, { battery: 88, score: 91, price: 25000 }),
    ];
    const byBattery = runSearch(rows, CATALOG, { ...EMPTY, sort: 'battery' });

    // One (SKU, grade) group, so both units aggregate into one card: the
    // measured count is the denominator the screen prints.
    expect(byBattery.results).toHaveLength(1);
    expect(byBattery.results[0]!.batteryMeasured).toBe(1);
    expect(byBattery.results[0]!.unitsAvailable).toBe(2);
    expect(byBattery.results[0]!.batteryMin).toBe(88);

    // A unit with no reading fails a battery filter rather than passing it.
    const filtered = runSearch(rows, CATALOG, { ...EMPTY, bmin: 80 });
    expect(filtered.total).toBe(1);

    // And a group with no reading at all reports null, never 0.
    const none = runSearch([rows[0]!], CATALOG, EMPTY);
    expect(none.results[0]!.batteryMin).toBeNull();
    expect(none.results[0]!.avgQcScore).toBeNull();
    expect(none.results[0]!.batteryMeasured).toBe(0);
  });
});
