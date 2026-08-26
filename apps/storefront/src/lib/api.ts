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
