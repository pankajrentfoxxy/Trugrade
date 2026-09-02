/**
 * The faceted-search engine behind `/api/public/search`.
 *
 * Pure functions over rows that the controller has already composed from the
 * two halves it is allowed to read: catalogue specification (catalog's schema)
 * and sellable-unit measurements (listing's, through `v_sellable_unit`). There
 * is no database access here on purpose — the two schemas may not be joined, so
 * the join happens in memory on `sku_id` and the interesting logic is testable
 * without a database.
 *
 * Two rules from `09_FRONTEND_LOCKED.md` §6 shape everything below.
 *
 * **Counts are live and reflect the currently-applied filters.** A facet count
 * is computed with every OTHER facet group applied but not its own. Applying
 * its own group is the classic bug: tick "Acer" and every other brand reads
 * zero, so the reader can never add a second brand and the rail looks broken.
 *
 * **A zero-count option is disabled, never hidden.** So the option list comes
 * from the CATALOGUE (every active SKU), not from what happens to be in stock.
 * "Dell — 0" tells a buyer we deal in Dell and have none sealed today; a missing
 * Dell row tells them nothing at all.
 */

/** One sellable unit, joined to the specification of the SKU behind it. */
export interface SearchRow {
  /* --- listing's half: what was measured --- */
  skuId: string;
  grade: string;
  price: number;
  /** `null` when the battery was not measured. Never coerced to zero. */
  battery: number | null;
  score: number | null;
  supplyPointCode: string | null;
  city: string | null;
  shipHours: number | null;
  warrantyMonths: number | null;
  serial: string;

  /* --- catalog's half: what the machine is --- */
  brandSlug: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  screenInch: number;
  resolution: string;
  isTouch: boolean;
  backlit: boolean;
  fingerprint: boolean;
  thunderbolt: boolean;
}

/** A catalogue SKU that may have no stock at all — the source of facet OPTIONS. */
export type CatalogRow = Omit<
  SearchRow,
  | 'grade'
  | 'price'
  | 'battery'
  | 'score'
  | 'supplyPointCode'
  | 'city'
  | 'shipHours'
  | 'warrantyMonths'
  | 'serial'
>;

export type SortKey = 'price' | 'price_desc' | 'score' | 'battery' | 'ships' | 'stock';

export const SORTS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'price', label: 'Landed price, low to high' },
  { value: 'price_desc', label: 'Landed price, high to low' },
  { value: 'score', label: 'Inspection score' },
  { value: 'battery', label: 'Battery health' },
  { value: 'ships', label: 'Fastest dispatch' },
  { value: 'stock', label: 'Most stock' },
];

export interface SearchQuery {
  q: string;
  brand: readonly string[];
  series: readonly string[];
  cpu: readonly string[];
  gen: readonly string[];
  ram: readonly number[];
  sgb: readonly number[];
  stype: readonly string[];
  grade: readonly string[];
  bmin: number | null;
  bmax: number | null;
  smin: number | null;
  pmin: number | null;
  pmax: number | null;
  screen: readonly number[];
  res: readonly string[];
  ship: readonly number[];
  city: readonly string[];
  qty: number | null;
  feat: readonly string[];
  warr: readonly number[];
  sort: SortKey;
  page: number;
  per: number;
}

/** Every group that can be filtered on, and therefore excluded from its own count. */
type Group =
  | 'q'
  | 'brand'
  | 'series'
  | 'cpu'
  | 'gen'
  | 'ram'
  | 'sgb'
  | 'stype'
  | 'grade'
  | 'batt'
  | 'score'
  | 'price'
  | 'screen'
  | 'res'
  | 'ship'
  | 'city'
  | 'qty'
  | 'feat'
  | 'warr';

export interface FacetOption {
  value: string;
  label: string;
  /** Sellable units behind this option with every OTHER group applied. */
  count: number;
  selected: boolean;
}

export interface FacetGroup {
  key: string;
  options: FacetOption[];
  /**
   * Set when the dimension is not recorded at all. The rail then prints this
   * sentence in `--ink-4` instead of a row of zeroes — a missing measurement is
   * not the same statement as "we measured and found none", and rendering it as
   * a zero would be the failure §6 is most explicit about.
   */
  unavailable?: string;
}

export type Facets = Record<string, FacetGroup>;

/** One result card: a (SKU, inspected grade) pair, aggregated over its units. */
export interface SearchResult {
  skuId: string;
  grade: string;
  brand: string;
  model: string;
  spec: string;
  fromPrice: number;
  unitsAvailable: number;
  supplyPoints: number;
  /** `null` when no unit in the group carries a score. */
  avgQcScore: number | null;
  batteryMin: number | null;
  batteryMax: number | null;
  /** How many of `unitsAvailable` actually have a measured battery. */
  batteryMeasured: number;
  shipHours: number | null;
  warrantyMonths: number | null;
  cities: string[];
  sampleSerial: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  cpuLine: string;
  displayLine: string;
}

/* ==========================================================================
 * Predicates — one per filterable group
 * ======================================================================== */

const FHD_OR_BETTER = new Set(['FHD', 'QHD', 'UHD', 'RETINA', 'WUXGA']);

/**
 * The size a buyer would call it. `floor`, not `round`: a 15.6" panel is a
 * fifteen-inch laptop in every catalogue on earth, and rounding it to 16 puts
 * it in a pill next to genuinely larger machines.
 */
const screenBucket = (inch: number): number => Math.floor(inch);

function haystack(r: SearchRow | CatalogRow): string {
  return [
    r.brandName,
    r.seriesName,
    r.modelName,
    r.cpuModel,
    r.cpuFamily,
    `${r.ramGb} GB`,
    `${r.storageGb} GB`,
    r.storageType.replace('_', ' '),
    `${r.screenInch}"`,
    r.resolution,
    'serial' in r ? (r as SearchRow).serial : '',
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Free text: every token must appear somewhere in the row.
 *
 * AND rather than OR because "dell 16 gb" meaning "Dell OR 16 GB" returns the
 * whole catalogue, and a search that ignores half of what was typed is worse
 * than one that returns nothing.
 */
function matchesText(r: SearchRow | CatalogRow, q: string): boolean {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = haystack(r);
  return tokens.every((t) => hay.includes(t));
}

const inList = <T>(list: readonly T[], v: T): boolean => list.length === 0 || list.includes(v);

function hasFeature(r: SearchRow, f: string): boolean {
  if (f === 'backlit') return r.backlit;
  if (f === 'fingerprint') return r.fingerprint;
  if (f === 'thunderbolt') return r.thunderbolt;
  return false;
}

function predicates(q: SearchQuery): Record<Group, (r: SearchRow) => boolean> {
  return {
    q: (r) => matchesText(r, q.q),
    brand: (r) => inList(q.brand, r.brandSlug),
    series: (r) => inList(q.series, r.seriesName),
    cpu: (r) => inList(q.cpu, r.cpuFamily),
    gen: (r) => inList(q.gen, r.cpuGeneration),
    ram: (r) => inList(q.ram, r.ramGb),
    sgb: (r) => inList(q.sgb, r.storageGb),
    stype: (r) => inList(q.stype, r.storageType),
    grade: (r) => inList(q.grade, r.grade),
    // An unmeasured battery fails a battery filter rather than passing it. A
    // buyer who asked for 85%+ must not be shown a machine we never opened the
    // battery report on.
    batt: (r) =>
      (q.bmin === null && q.bmax === null) ||
      (r.battery !== null &&
        (q.bmin === null || r.battery >= q.bmin) &&
        (q.bmax === null || r.battery <= q.bmax)),
    score: (r) => q.smin === null || (r.score !== null && r.score >= q.smin),
    price: (r) =>
      (q.pmin === null || r.price >= q.pmin) && (q.pmax === null || r.price <= q.pmax),
    screen: (r) => inList(q.screen, screenBucket(r.screenInch)),
    res: (r) =>
      q.res.length === 0 ||
      q.res.every((v) =>
        v === 'touch' ? r.isTouch : v === 'fhd' ? FHD_OR_BETTER.has(r.resolution) : false,
      ),
    ship: (r) =>
      q.ship.length === 0 ||
      (r.shipHours !== null && q.ship.some((limit) => r.shipHours !== null && r.shipHours <= limit)),
    city: (r) => q.city.length === 0 || (r.city !== null && q.city.includes(r.city)),
    // Quantity is a property of the (model, grade, supply point) group, not of a
    // row, so it is applied after grouping — see `applyQuantity`.
    qty: () => true,
    feat: (r) => q.feat.every((f) => hasFeature(r, f)),
    warr: (r) =>
      q.warr.length === 0 || (r.warrantyMonths !== null && q.warr.includes(r.warrantyMonths)),
  };
}

const groupKey = (r: SearchRow): string => `${r.skuId}|${r.grade}|${r.supplyPointCode ?? ''}`;

/**
 * "10+ available" means ten units of one model, one grade, at ONE supply point —
 * because a buyer ordering ten wants them to arrive from one dock, and a total
 * summed across four suppliers is a promise we would then have to break.
 */
function applyQuantity(rows: readonly SearchRow[], min: number | null): SearchRow[] {
  if (min === null) return [...rows];
  const sizes = new Map<string, number>();
  for (const r of rows) sizes.set(groupKey(r), (sizes.get(groupKey(r)) ?? 0) + 1);
  return rows.filter((r) => (sizes.get(groupKey(r)) ?? 0) >= min);
}

/** Rows passing every group except `except` — the basis of a live facet count. */
function rowsExcept(
  rows: readonly SearchRow[],
  q: SearchQuery,
  except: Group | null,
): SearchRow[] {
  const p = predicates(q);
  const keys = (Object.keys(p) as Group[]).filter((k) => k !== except);
  const kept = rows.filter((r) => keys.every((k) => p[k](r)));
  return except === 'qty' ? kept : applyQuantity(kept, q.qty);
}

/* ==========================================================================
 * Facets
 * ======================================================================== */

function optionsFrom<T extends string | number>(
  catalogValues: ReadonlyArray<{ value: T; label: string }>,
  counted: readonly SearchRow[],
  valueOf: (r: SearchRow) => T | null,
  selected: readonly T[],
): FacetOption[] {
  const counts = new Map<T, number>();
  for (const r of counted) {
    const v = valueOf(r);
    if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return catalogValues.map((o) => ({
    value: String(o.value),
    label: o.label,
    count: counts.get(o.value) ?? 0,
    selected: selected.includes(o.value),
  }));
}

/** Distinct values across the whole catalogue, so a zero option still exists. */
function distinct<T extends string | number>(
  catalog: readonly CatalogRow[],
  pick: (c: CatalogRow) => T | null,
  label: (v: T) => string,
  order?: (a: T, b: T) => number,
): Array<{ value: T; label: string }> {
  const seen = new Set<T>();
  for (const c of catalog) {
    const v = pick(c);
    if (v !== null && v !== undefined) seen.add(v);
  }
  const values = [...seen].sort(
    order ?? ((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })),
  );
  return values.map((v) => ({ value: v, label: label(v) }));
}

const GRADE_LABEL: Readonly<Record<string, string>> = {
  A_PLUS: 'A+ · near new',
  A: 'A · excellent',
  B: 'B · good',
};

const STORAGE_TYPE_LABEL: Readonly<Record<string, string>> = {
  NVME_SSD: 'NVMe SSD',
  SATA_SSD: 'SATA SSD',
  EMMC: 'eMMC',
  HDD: 'Hard disk',
};

const RESOLUTION_PIXELS: Readonly<Record<string, string>> = {
  HD: '1366x768',
  FHD: '1920x1080',
  QHD: '2560x1440',
  UHD: '3840x2160',
  RETINA: 'Retina',
  WUXGA: '1920x1200',
};

function cpuLine(r: Pick<SearchRow, 'cpuFamily' | 'cpuModel'>): string {
  if (/^i[3579]-/.test(r.cpuModel)) return `Intel Core ${r.cpuModel}`;
  if (/^ryzen/i.test(r.cpuModel)) return `AMD ${r.cpuModel}`;
  const isAmd = /ryzen|amd/i.test(r.cpuFamily);
  const brand = isAmd ? 'AMD' : 'Intel';
  return `${brand} ${r.cpuFamily} ${r.cpuModel}`.replace(/\s+/g, ' ').trim();
}

function displayLine(r: Pick<SearchRow, 'screenInch' | 'resolution'>): string {
  const inch = r.screenInch % 1 === 0 ? String(r.screenInch) : r.screenInch.toFixed(1);
  const px = RESOLUTION_PIXELS[r.resolution];
  return px ? `${inch}" ${r.resolution} (${px})` : `${inch}" ${r.resolution}`;
}

export function buildFacets(
  rows: readonly SearchRow[],
  catalog: readonly CatalogRow[],
  q: SearchQuery,
): Facets {
  const forGroup = (g: Group): SearchRow[] => rowsExcept(rows, q, g);

  return {
    brand: {
      key: 'brand',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => c.brandSlug,
          (v) => catalog.find((c) => c.brandSlug === v)?.brandName ?? v,
        ),
        forGroup('brand'),
        (r) => r.brandSlug,
        q.brand,
      ),
    },
    series: {
      key: 'series',
      options: optionsFrom(
        // Series are scoped to the selected brands: showing every ThinkPad line
        // while "Acer" is ticked is a rail full of noise.
        distinct(
          q.brand.length === 0 ? catalog : catalog.filter((c) => q.brand.includes(c.brandSlug)),
          (c) => c.seriesName,
          (v) => v,
        ),
        forGroup('series'),
        (r) => r.seriesName,
        q.series,
      ),
    },
    cpu: {
      key: 'cpu',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => c.cpuFamily,
          (v) => v,
        ),
        forGroup('cpu'),
        (r) => r.cpuFamily,
        q.cpu,
      ),
    },
    gen: {
      key: 'gen',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => c.cpuGeneration,
          (v) => (/^\d+th$/.test(v) ? `${v} gen` : v),
        ),
        forGroup('gen'),
        (r) => r.cpuGeneration,
        q.gen,
      ),
    },
    ram: {
      key: 'ram',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => c.ramGb,
          (v) => `${v} GB`,
          (a, b) => a - b,
        ),
        forGroup('ram'),
        (r) => r.ramGb,
        q.ram,
      ),
    },
    sgb: {
      key: 'sgb',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => c.storageGb,
          (v) => (v >= 1024 ? `${v / 1024} TB` : `${v} GB`),
          (a, b) => a - b,
        ),
        forGroup('sgb'),
        (r) => r.storageGb,
        q.sgb,
      ),
    },
    stype: {
      key: 'stype',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => c.storageType,
          (v) => STORAGE_TYPE_LABEL[v] ?? v,
        ),
        forGroup('stype'),
        (r) => r.storageType,
        q.stype,
      ),
    },
    grade: {
      key: 'grade',
      // Grade options are the three sellable bands, in band order, and the count
      // comes from `grade_actual` — what the technician found, never what the
      // supplier declared. Getting this from `grade_declared` would be a
      // misrepresentation, not a display bug.
      options: optionsFrom(
        [
          { value: 'A_PLUS', label: GRADE_LABEL.A_PLUS! },
          { value: 'A', label: GRADE_LABEL.A! },
          { value: 'B', label: GRADE_LABEL.B! },
        ],
        forGroup('grade'),
        (r) => r.grade,
        q.grade,
      ),
    },
    screen: {
      key: 'screen',
      options: optionsFrom(
        distinct(
          catalog,
          (c) => screenBucket(c.screenInch),
          (v) => `${v}"`,
          (a, b) => a - b,
        ),
        forGroup('screen'),
        (r) => screenBucket(r.screenInch),
        q.screen,
      ),
    },
    res: {
      key: 'res',
      // Not `optionsFrom`: one row can satisfy both options at once (a touch
      // FHD panel), so each is counted over the same rows independently.
      options: [
        { value: 'fhd', label: 'Full HD or better', test: (r: SearchRow) => FHD_OR_BETTER.has(r.resolution) },
        { value: 'touch', label: 'Touchscreen', test: (r: SearchRow) => r.isTouch },
      ].map(({ value, label, test }) => ({
        value,
        label,
        count: forGroup('res').filter(test).length,
        selected: q.res.includes(value),
      })),
    },
    ship: {
      key: 'ship',
      options: [24, 48, 72].map((limit) => ({
        value: String(limit),
        label: `Ships in ${limit} h`,
        count: forGroup('ship').filter((r) => r.shipHours !== null && r.shipHours <= limit).length,
        selected: q.ship.includes(limit),
      })),
    },
    city: {
      key: 'city',
      // Options come from every sellable unit rather than from the catalogue:
      // catalog has no idea where anything is, and a city we hold no stock in
      // at all is not a dimension a buyer has ever seen.
      options: (() => {
        const counted = forGroup('city');
        const cities = [...new Set(rows.map((r) => r.city).filter((c): c is string => c !== null))].sort();
        return cities.map((c) => ({
          value: c,
          label: c,
          count: counted.filter((r) => r.city === c).length,
          selected: q.city.includes(c),
        }));
      })(),
    },
    qty: {
      key: 'qty',
      options: [10, 25, 50, 100].map((min) => ({
        value: String(min),
        label: `${min}+ at one supply point`,
        count: applyQuantity(forGroup('qty'), min).length,
        selected: q.qty === min,
      })),
    },
    feat: {
      key: 'feat',
      options: [
        { value: 'backlit', label: 'Backlit keyboard' },
        { value: 'fingerprint', label: 'Fingerprint reader' },
        { value: 'thunderbolt', label: 'Thunderbolt / USB-C' },
      ].map((o) => ({
        ...o,
        count: forGroup('feat').filter((r) => hasFeature(r, o.value)).length,
        selected: q.feat.includes(o.value),
      })),
    },
    warr: {
      key: 'warr',
      options: [6, 12].map((m) => ({
        value: String(m),
        label: m === 12 ? '12 months (extended)' : '6 months',
        count: forGroup('warr').filter((r) => r.warrantyMonths === m).length,
        selected: q.warr.includes(m),
      })),
    },
  };
}

/* ==========================================================================
 * Results
 * ======================================================================== */

const SPEC = (r: SearchRow): string =>
  [
    r.cpuModel,
    `${r.ramGb} GB`,
    `${r.storageGb} GB ${STORAGE_TYPE_LABEL[r.storageType] ?? r.storageType}`,
    `${r.screenInch}"`,
  ].join(' · ');

function aggregate(rows: readonly SearchRow[]): SearchResult[] {
  const groups = new Map<string, SearchRow[]>();
  for (const r of rows) {
    const k = `${r.skuId}|${r.grade}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  return [...groups.values()].map((g) => {
    const first = g[0]!;
    const batteries = g.map((r) => r.battery).filter((b): b is number => b !== null);
    const scores = g.map((r) => r.score).filter((s): s is number => s !== null);
    const ships = g.map((r) => r.shipHours).filter((s): s is number => s !== null);
    return {
      skuId: first.skuId,
      grade: first.grade,
      brand: first.brandName,
      model: first.modelName,
      spec: SPEC(first),
      fromPrice: Math.min(...g.map((r) => r.price)),
      unitsAvailable: g.length,
      supplyPoints: new Set(g.map((r) => r.supplyPointCode)).size,
      // No score on any unit means no chip, not a zero. A QC chip reading 0 says
      // "we inspected it and it failed"; the truth is that we have no number.
      avgQcScore: scores.length === 0 ? null : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      batteryMin: batteries.length === 0 ? null : Math.round(Math.min(...batteries)),
      batteryMax: batteries.length === 0 ? null : Math.round(Math.max(...batteries)),
      batteryMeasured: batteries.length,
      shipHours: ships.length === 0 ? null : Math.min(...ships),
      warrantyMonths: first.warrantyMonths,
      cities: [...new Set(g.map((r) => r.city).filter((c): c is string => c !== null))].sort(),
      sampleSerial: g.map((r) => r.serial).sort()[0]!,
      ramGb: first.ramGb,
      storageGb: first.storageGb,
      storageType: first.storageType,
      cpuLine: cpuLine(first),
      displayLine: displayLine(first),
    };
  });
}

function sortResults(results: SearchResult[], sort: SortKey): SearchResult[] {
  const by: Record<SortKey, (a: SearchResult, b: SearchResult) => number> = {
    price: (a, b) => a.fromPrice - b.fromPrice,
    price_desc: (a, b) => b.fromPrice - a.fromPrice,
    // A missing measurement sorts last under every "best first" ordering, so an
    // unmeasured machine can never lead a list ranked by measurement.
    score: (a, b) => (b.avgQcScore ?? -1) - (a.avgQcScore ?? -1),
    battery: (a, b) => (b.batteryMax ?? -1) - (a.batteryMax ?? -1),
    ships: (a, b) => (a.shipHours ?? Number.MAX_SAFE_INTEGER) - (b.shipHours ?? Number.MAX_SAFE_INTEGER),
    stock: (a, b) => b.unitsAvailable - a.unitsAvailable,
  };
  // Price is the tiebreak everywhere, so the order is total and a page boundary
  // never shuffles between two requests.
  return [...results].sort((a, b) => by[sort](a, b) || a.fromPrice - b.fromPrice);
}

export interface SearchResponse {
  total: number;
  models: number;
  page: number;
  pages: number;
  per: number;
  results: SearchResult[];
  facets: Facets;
}

export function runSearch(
  rows: readonly SearchRow[],
  catalog: readonly CatalogRow[],
  q: SearchQuery,
): SearchResponse {
  const matched = rowsExcept(rows, q, null);
  const all = sortResults(aggregate(matched), q.sort);
  const pages = Math.max(1, Math.ceil(all.length / q.per));
  const page = Math.min(q.page, pages);

  return {
    total: matched.length,
    models: all.length,
    page,
    pages,
    per: q.per,
    results: all.slice((page - 1) * q.per, page * q.per),
    facets: buildFacets(rows, catalog, q),
  };
}
