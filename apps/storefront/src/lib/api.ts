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
  displayName: string;
  customerDescription: string;
  /** Every threshold is nullable. An unset floor is not a floor of zero. */
  minBatteryHealthPct: number | null;
  maxCycleCount: number | null;
  minCosmeticScore: number | null;
  screenDefectsAllowed: boolean;
  /** `YYYY-MM-DD`. Which definition a machine graded today was graded against. */
  effectiveFrom: string;
}

/**
 * The `platform_config` numbers the published legal pages quote — T48.
 *
 * Every field is nullable and the pages render null as "Not published", never as
 * the figure the seed happens to hold. `/legal/returns-and-refunds` printing 48
 * because the storefront assumed 48 would be a term nobody set.
 */
export interface LegalTerms {
  inspectionWindowHours: number | null;
  warrantyTopUpMonths: number | null;
  warrantyMinTotalMonths: number | null;
  grievanceAckHours: number | null;
  grievanceRedressDays: number | null;
}

/** Revalidates every minute: it is a real counter, and a real counter moves. */
export const getStats = (): Promise<PlatformStats | null> =>
  get<PlatformStats>('/public/stats', 60);

export const getBrands = (): Promise<BrandSummary[] | null> =>
  get<BrandSummary[]>('/public/brands', 60);

/** Grade bands change with a policy decision, not with stock. */
export const getGrades = (): Promise<GradeDefinition[] | null> =>
  get<GradeDefinition[]>('/public/grades', 300);

/**
 * The legal pages' numbers, from the same config view the enforcement reads.
 *
 * Five minutes, matching the endpoint's own `max-age`. A window that ops
 * shortens must reach the published document quickly — but the document is ISR
 * and a five-minute lag is the price of serving it from cache at all, which is
 * why `/legal/**` also prints the instant it was rendered.
 */
export const getLegalTerms = (): Promise<LegalTerms | null> =>
  get<LegalTerms>('/public/legal-terms', 300);

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

/**
 * One condition photograph, as the PUBLIC payload carries it.
 *
 * `s3Key` used to be here and is gone on purpose. An S3 key is an internal path
 * and PHASE_05 Task 1 lists "an S3 key path revealing a vendor slug" as a leak
 * to test for, so the API now serves images through an opaque encrypted token
 * and sends a ready-to-use `url` instead.
 *
 * This type is hand-written over `fetch`, so it compiled happily against a field
 * the server had stopped sending — every image would simply have been
 * `undefined`. Nothing would have failed; the pictures would just never appear.
 *
 * `url` EXPIRES (15 minutes). A page cached longer than that has to re-read the
 * SKU rather than reuse the link.
 */
export interface ConditionImage {
  id: string;
  grade: string;
  viewCode: string;
  /** Absolute, time-limited. Never a bucket key. */
  url: string;
  /** A tiny inline placeholder so the slot does not jump while the image loads. */
  blurDataUri?: string;
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

/* ==========================================================================
 * Unit passport — `/unit/[serial]`
 * ======================================================================== */

/** `qc_area_result.status` has no NOT_MEASURED; the passport adds it. */
export type PassportAreaStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_MEASURED';

/**
 * One of the twelve. `score` and `maxScore` are BOTH null when the area was not
 * measured — that pair is the only honest way to say "we did not look", and the
 * screen must render it as such rather than as a zero.
 */
export interface PassportArea {
  area: string;
  score: number | null;
  maxScore: number | null;
  status: PassportAreaStatus;
}

/**
 * What the tool read off the machine.
 *
 * Every field is nullable and most of them are null on real rows: the seeded
 * inspections report a model, a RAM size, a SMART status and a battery figure,
 * and nothing else. Ten "Not measured" cells is what the inspection actually
 * produced, and printing ten zeroes instead would be ten fabricated readings.
 */
export interface PassportHardware {
  model: string | null;
  cpu: string | null;
  ramDetectedGb: number;
  ramModules: number | null;
  ramType: string | null;
  storageType: string | null;
  storageDetectedGb: number | null;
  gpu: string | null;
  screenSizeIn: number | null;
  smartStatus: string | null;
  batteryHealthPct: number | null;
  cycleCount: number | null;
  tpmVersion: string | null;
  secureBoot: boolean | null;
}

/**
 * The passport, exactly as `GET /api/unit/:serial` builds it.
 *
 * `photos[].url` is absolute, opaque and **expires after 900 seconds**, which is
 * why the route that reads this is `force-dynamic`: a page held longer than the
 * signature would render six broken images under six viewfinder brackets, and a
 * viewfinder bracket over a broken image is the motif asserting something that
 * is not on screen.
 */
export interface UnitPassport {
  serialNumber: string;
  verdict: 'PASS' | 'PASS_WITH_NOTE' | 'MISMATCH' | 'FAIL' | null;
  grade: string | null;
  qcScore: number | null;
  inspectedOn: string | null;
  validUntil: string | null;
  expired: boolean;
  rulesVersion: string | null;
  seal: { code: string; status: string; appliedOn: string } | null;
  hardware: PassportHardware | null;
  /** Always twelve, in `QC_AREA_CODES` order. Never filtered. */
  areas: PassportArea[];
  photos: Array<{ angle: string; url: string }>;
  wipeCertificate: {
    standard: string;
    method: string;
    passes: number;
    verificationStatus: string;
    issuedAt: string;
  } | null;
  deviceSure: { certificateId: string } | null;
}

/**
 * Four outcomes, because the screen has four different things to say.
 *
 * `get()` above collapses every failure into `null`, which is right for a
 * counter in a footer and wrong here: "no such machine", "that is not a serial",
 * "you have asked too often" and "we could not reach our own API" produce four
 * different sentences, and rendering the fourth as the first tells a buyer
 * holding a real laptop that their machine does not exist.
 */
export type PassportResult =
  | { kind: 'FOUND'; passport: UnitPassport }
  | { kind: 'NOT_FOUND' }
  | { kind: 'MALFORMED'; message: string }
  | { kind: 'RATE_LIMITED'; message: string; retryAfterSeconds: number | null }
  | { kind: 'ERROR' };

interface ApiError {
  error?: { code?: string; message?: string; fields?: Record<string, string> };
}

/**
 * Never cached, and not only because stock moves.
 *
 * The photograph links inside carry a 900-second signature. A cached passport
 * outlives its own pictures, so this reads through on every request and the
 * routes above it are `force-dynamic`.
 *
 * `/unit/:serial` and `/qc/verify/:code` return the SAME document — the
 * controller assembles one passport and two routes reach it — so they share one
 * reader. Two copies of this function would be two places for the 422 handling
 * to drift, and the 422 is the exact thing that broke: the seed minted codes the
 * schema refused, and every verification answered "malformed" while the screen
 * would have said "unknown" if the two paths had disagreed.
 */
async function readPassport(path: string): Promise<PassportResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  } catch {
    return { kind: 'ERROR' };
  }

  if (res.ok) return { kind: 'FOUND', passport: (await res.json()) as UnitPassport };

  const body = (await res.json().catch(() => ({}))) as ApiError;
  const message = body.error?.message ?? '';

  if (res.status === 404) return { kind: 'NOT_FOUND' };
  if (res.status === 429) {
    const header = res.headers.get('Retry-After');
    const seconds = header === null ? null : Number(header);
    return {
      // The server's sentence, verbatim — it is the only party that knows which
      // budget was spent and how long the window is.
      kind: 'RATE_LIMITED',
      message: message || 'Too many attempts. Try again shortly.',
      retryAfterSeconds: Number.isFinite(seconds) ? (seconds as number) : null,
    };
  }
  if (res.status === 422) {
    // The field message is the useful one — "That looks like a firmware
    // placeholder, not a serial" — and the envelope's headline is generic.
    const fields = body.error?.fields;
    const first = fields ? Object.values(fields)[0] : undefined;
    return { kind: 'MALFORMED', message: first ?? message };
  }
  return { kind: 'ERROR' };
}

export const getUnitPassport = (serial: string): Promise<PassportResult> =>
  readPassport(`/unit/${encodeURIComponent(serial)}`);

/**
 * What the QR code on a printed QC report resolves to — `/qc/verify/:code`.
 *
 * The code is 14 characters of Crockford base32 and the API's schema upper-cases
 * and trims before it matches, so a code typed in lower case off a sticker is a
 * hit rather than a 422. Nothing is normalised here: one validator, at the
 * boundary that owns the column.
 */
export const getVerification = (code: string): Promise<PassportResult> =>
  readPassport(`/qc/verify/${encodeURIComponent(code)}`);
