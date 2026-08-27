/**
 * The storefront's server-side read of the API.
 *
 * Everything here runs on the server: the storefront is the SEO surface, so
 * model and brand pages must render with real content in the HTML rather than
 * after a client fetch. It also means the browser never talks to the API
 * directly for these, so there is one place to reason about caching.
 *
 * Nothing in these responses may carry vendor identity — the API's public
 * controller is built from explicit field lists for that reason, and
 * `findVendorIdentityLeaks` in @trugrade/contracts is what proves it in CI.
 */

const API_BASE = process.env.API_URL ?? 'http://localhost:4000/api';

/**
 * A failed fetch returns null rather than throwing.
 *
 * A marketing page that 500s because a counter was unavailable is worse than a
 * marketing page that omits the counter. Every caller renders a sensible page
 * without the data, and the page says less rather than saying something wrong.
 */
async function get<T>(path: string, revalidateSeconds: number): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      next: { revalidate: revalidateSeconds },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export interface PlatformStats {
  unitsInspected: number;
  unitsSellable: number;
  skusCatalogued: number;
  brandsCatalogued: number;
  ordersDelivered: number;
  unitsReturned: number;
}

export interface BrandSummary {
  name: string;
  slug: string;
  skuCount: number;
  inStock: number;
}

export interface GradeDefinition {
  grade: string;
  customerDescription: string;
  minBatteryHealthPct: number | null;
}

/** Revalidates every minute: it is a real counter, and a real counter moves. */
export const getStats = (): Promise<PlatformStats | null> =>
  get<PlatformStats>('/public/stats', 60);

export const getBrands = (): Promise<BrandSummary[] | null> =>
  get<BrandSummary[]>('/public/brands', 60);

/** Grade bands change with a policy decision, not with stock. */
export const getGrades = (): Promise<GradeDefinition[] | null> =>
  get<GradeDefinition[]>('/public/grades', 300);

export interface PublicOffer {
  skuId: string;
  brand: string;
  model: string;
  spec: string;
  grade: 'A_PLUS' | 'A' | 'B';
  /** Decimal string, never a float. Money does not survive a round trip as one. */
  fromPrice: string;
  unitsAvailable: number;
  supplyPoints: number;
  avgQcScore: number;
  batteryMin: number;
  batteryMax: number;
  sampleSerial: string;
}

/** Thirty seconds: stock moves, and a stale grid offers machines that are gone. */
export const getOffers = (): Promise<PublicOffer[] | null> =>
  get<PublicOffer[]>('/public/offers', 30);

export interface StepDefinition {
  stepCode: string;
  stepOrder: number;
  title: string;
  /** The "why we ask" copy, authored in the seed and rendered verbatim. */
  purposeNote: string | null;
  estimatedMinutes: number | null;
}

/**
 * The registration step rail, server-rendered so it is drawn on first paint.
 *
 * Five minutes: these rows change when someone edits a step definition, which
 * is a deliberate act and not a frequent one, and a stale rail for five minutes
 * is cheaper than a fetch on every page view.
 */
export const getStepDefinitions = (orgType: 'VENDOR' | 'BUYER'): Promise<StepDefinition[] | null> =>
  get<StepDefinition[]>(`/onboarding/steps/definitions?orgType=${orgType}`, 300);

/* ==========================================================================
 * Faceted search — `/search`
 * ======================================================================== */

export interface FacetOption {
  value: string;
  label: string;
  /** Live: computed with every OTHER facet group applied, never this one. */
  count: number;
  selected: boolean;
}

export interface FacetGroup {
  key: string;
  options: FacetOption[];
  /**
   * Present when the dimension is not measured at all. The rail prints this
   * sentence rather than a row of zeroes — "not recorded" and "recorded, none
   * found" are different statements and only one of them is true.
   */
  unavailable?: string;
}

export interface SearchResult {
  skuId: string;
  grade: string;
  brand: string;
  model: string;
  spec: string;
  fromPrice: number;
  unitsAvailable: number;
  supplyPoints: number;
  avgQcScore: number | null;
  batteryMin: number | null;
  batteryMax: number | null;
  /** How many of `unitsAvailable` carry a measured battery. The denominator. */
  batteryMeasured: number;
  shipHours: number | null;
  warrantyMonths: number | null;
  /** Cities only. The supply-point code plus the city is all a buyer ever sees. */
  cities: string[];
  sampleSerial: string;
}

export interface SearchResponse {
  total: number;
  models: number;
  page: number;
  pages: number;
  per: number;
  results: SearchResult[];
  facets: Record<string, FacetGroup>;
}

/**
 * One request for results AND facet counts, because they are one answer. A
 * count fetched separately is a count from a different instant, and a rail that
 * disagrees with the grid beside it is worse than a rail with no counts.
 *
 * The unfiltered board is revalidated like the rest of the storefront; a
 * filtered one is not stored at all. Every filtered URL is unique by
 * construction, so caching them fills the cache with single-use entries and
 * risks answering one filter set with another's results.
 */
export async function getSearch(qs: string): Promise<SearchResponse | null> {
  try {
    const res = await fetch(
      `${API_BASE}/public/search${qs ? `?${qs}` : ''}`,
      qs === '' ? { next: { revalidate: 30 } } : { cache: 'no-store' },
    );
    return res.ok ? ((await res.json()) as SearchResponse) : null;
  } catch {
    return null;
  }
}

/* ==========================================================================
 * Product detail — `/laptops/[slug]`
 * ======================================================================== */

/** One condition photograph, as `catalog.condition_image` holds it. */
export interface ConditionImage {
  id: string;
  grade: string;
  viewCode: string;
  s3Key: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ResolvedImages {
  images: ConditionImage[];
  /** SKU / MODEL / SERIES / PLACEHOLDER — the caption widens with the anchor. */
  match: 'SKU' | 'MODEL' | 'SERIES' | 'PLACEHOLDER';
  isGeneric: boolean;
  placeholderReason?: string;
}

export interface SkuDetail {
  skuId: string;
  skuCode: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  cpuBrand: string;
  cpuFamily: string;
  cpuModel: string;
  cpuGeneration: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  gpuType: string;
  gpuModel: string | null;
  screenSizeIn: number;
  resolution: string;
  isTouch: boolean;
  osSupported: string;
  hsnCode: string;
  isActive: boolean;
  images: ResolvedImages | null;
}

/**
 * The declared specification and the condition photographs for one grade.
 *
 * `catalog` owns both and answers for both, which is why this is a second call
 * rather than a bigger offers response: what a machine IS belongs to the
 * catalogue and what was MEASURED belongs to listing, and the endpoint that
 * joined them would be a third definition of a SKU living in a page.
 */
export const getSkuDetail = (skuId: string, grade: string): Promise<SkuDetail | null> =>
  get<SkuDetail>(`/catalog/skus/${skuId}?grade=${grade}`, 60);

export type QualityHeadline =
  | { kind: 'SCORE'; avgQcScore: number; gradeAccuracyPct: number; unitsInspected: number }
  | { kind: 'NEW_SUPPLIER'; unitsInspected: number; label: string };

export interface OfferUnit {
  serialNumber: string;
  qcScore: number | null;
  /** `null` when the battery was not measured. Never rendered as 0%. */
  batteryHealthPct: number | null;
  inspectedOn: string | null;
  expiresOn: string | null;
  expiresInDays: number | null;
  valuationMethod: 'REGULAR' | 'MARGIN';
}

export interface SupplyPointOfferRow {
  listingId: string;
  /** `A`, `F` — unique within its city and not across cities. */
  supplyPointCode: string;
  city: string;
  label: string;
  grade: string;
  /** Decimal string. Money does not survive a round trip as a float. */
  landedPrice: string;
  priceLines: Array<{ label: string; amount: string }>;
  isInterState: boolean;
  valuationMethod: 'REGULAR' | 'MARGIN';
  quality: QualityHeadline;
  batteryHealthPct: { min: number; max: number } | null;
  batteryMeasured: number;
  totalWarrantyMonths: number;
  unitsAvailable: number;
  inspectedOn: string | null;
  qcExpiresOn: string | null;
  qcExpiresInDays: number | null;
  dispatchCommitment: string;
  units: OfferUnit[];
}

export interface OfferBoard {
  skuId: string;
  grade: string;
  grades: Array<{
    grade: string;
    unitsAvailable: number;
    supplyPoints: number;
    fromPrice: string;
  }>;
  pincode: string | null;
  /**
   * Three arms. "Nobody has told us where to deliver" and "we cannot deliver
   * there" are different statements, and a screen that renders the first as the
   * second tells a buyer we refuse them when they have not typed anything yet.
   */
  delivery:
    | { kind: 'NONE' }
    | { kind: 'DELIVERABLE'; etaDays: number }
    | { kind: 'UNSERVICEABLE'; reason: string };
  offers: SupplyPointOfferRow[];
  unitsAvailable: number;
  supplyPoints: number;
  unpricedSupplyPoints: number;
}

/**
 * The supply-point comparison board for one SKU, landed to one pincode.
 *
 * Not cached: the pincode is the buyer's, the prices are landed to it, and a
 * board answered from another destination's entry would be a wrong price on the
 * most load-bearing screen in the product. The endpoint itself sets a 15-second
 * `Cache-Control` for anything in front of it that shares an audience.
 */
export async function getOfferBoard(
  skuId: string,
  params: { pincode?: string; grade?: string },
): Promise<OfferBoard | null> {
  const qs = new URLSearchParams();
  if (params.pincode) qs.set('pincode', params.pincode);
  if (params.grade) qs.set('grade', params.grade);
  try {
    const res = await fetch(`${API_BASE}/public/skus/${skuId}/offers?${qs.toString()}`, {
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as OfferBoard) : null;
  } catch {
    return null;
  }
}
