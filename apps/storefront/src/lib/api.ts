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
