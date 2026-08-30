import { Money } from '@trugrade/contracts';

/**
 * Every API surface the vendor portal touches, in one file.
 *
 * Written down as constants rather than string literals at each call site for a
 * reason that is not tidiness: several of these endpoints **do not exist yet**
 * (they are marked below). Keeping them in one list makes "what does the vendor
 * portal need the API to grow" a file you read rather than a grep you run, and
 * it is the list handed back to the orchestrator.
 *
 * The vendor portal never asks for a retail price and there is no type in this
 * file that carries one. `VendorListingView` on the server is a hand-written
 * whitelist for exactly that reason; these mirrors keep the same discipline, so
 * a field added to the API cannot arrive on a vendor screen by accident.
 */

/**
 * A NUMERIC(14,2) as it crosses the wire — `Money.toJSON()` produces a decimal
 * string. **Never a number.** `Number("45000.00")` is the float bug the whole
 * money path exists to prevent, so the string is carried untouched until it
 * reaches `rupees()` below.
 */
export type MoneyString = string;

/** An ISO-8601 instant. Formatted for display, never arithmetic'd in the client. */
export type IsoDate = string;

export const API = {
  /** Aggregates `listing.unit`, `listing.grade_correction` and the payables. */
  dashboard: '/api/vendor/dashboard',

  /**
   * Every entry below was marked MISSING when this file was written and every
   * one of them now exists — `catalog.controller.ts` 438/459/527/813,
   * `vendor.controller.ts` 317, `listing.controller.ts` 236/417/454/502. T26
   * found the same staleness on `dashboard` and nearly re-built a route that
   * was already serving. Checked again at T27; the comments are the audit.
   */
  catalogSearch: (q: string) => `/api/catalog/search?q=${encodeURIComponent(q)}&limit=20`,
  sku: (skuId: string) => `/api/catalog/skus/${skuId}`,
  gradeDefinitions: '/api/catalog/grade-definitions',
  skuRequests: '/api/catalog/sku-requests',

  /** `identity.org_address`, scoped to the caller's org. The pickup picker. */
  facilities: '/api/vendor/facilities',

  listings: '/api/vendor/listings',
  listing: (id: string) => `/api/vendor/listings/${id}`,
  listingUnits: (id: string) => `/api/vendor/listings/${id}/units`,
  validateSerials: '/api/vendor/listings/serials/validate',
  validateSerialsCsv: '/api/vendor/listings/serials/validate-csv',

  payoutPreview: '/api/vendor/listings/payout-preview',
  submit: (id: string) => `/api/vendor/listings/${id}/submit`,
  bulkStatus: '/api/vendor/listings/bulk-status',
  reprice: (id: string) => `/api/vendor/listings/${id}/reprice`,
} as const;

/* ==========================================================================
 * Wire types
 * ======================================================================== */

/**
 * One queue on the workspace, exactly as the server measured it.
 *
 * **`null` means "not measured here", never zero.** The server sends `null` for
 * `slaHours` on a queue nobody has promised a turnaround for, and the screen
 * drops the field rather than defaulting it — `QueueItem` renders an absent SLA
 * as no clause at all and a `0` as a promise of nothing, which is not the same
 * claim. `oldestWaitHours` and `breachedCount` are computed against the server
 * clock: the correction window is a money deadline and a browser clock must not
 * be able to move it.
 */
export interface VendorQueue {
  count: number;
  oldestWaitHours: number | null;
  breachedCount: number | null;
  slaHours: number | null;
}

export interface DashboardTiles {
  /** Any state, ever. Tells a new vendor apart from one whose stock all failed. */
  unitsEverListed: number;
  unitsAwaitingQc: number;
  unitsLive: number;
  unitsSoldThisMonth: number;
  /** `qc.v_expiring_qc` — reports valid 90 days, warned at T−14. */
  unitsQcExpiring14d: number;
  payoutsDue: MoneyString;
  payoutsDueOn: IsoDate | null;
  queues: {
    gradeCorrections: VendorQueue;
    awaitingInspection: VendorQueue;
  };
}

/** One catalog hit, plus enough specification to recognise the machine. */
export interface SkuHit {
  skuId: string;
  skuCode: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  cpuFamily: string;
  ramGb: number;
  storageGb: number;
  screenSizeIn: number;
}

/** The full declared specification, shown once a SKU is picked. */
export interface SkuDetail extends SkuHit {
  cpuBrand: string;
  cpuModel: string;
  cpuGeneration: string;
  storageType: string;
  gpuType: string;
  gpuModel: string | null;
  resolution: string;
  isTouch: boolean;
  osSupported: string;
  /** `catalog.sku.os_licence_type` — OEM | RETAIL | VOLUME | NONE. */
  osLicenceType?: string | null;
}

/**
 * `catalog.v_current_grade_definition` — the words AND the numbers QC grades against.
 *
 * The thresholds were already on the wire and this type dropped them, so the
 * wizard showed a vendor an adjective ("light marks") where the engine will
 * apply a measurement. A declaration anchored to prose is the root of most grade
 * disputes; the floors are what make it checkable before submission.
 */
export interface GradeDefinition {
  grade: string;
  displayName: string;
  customerDescription: string;
  minBatteryHealthPct: number;
  maxCycleCount: number | null;
  minCosmeticScore: number;
  screenDefectsAllowed: boolean;
}

export interface VendorFacility {
  /** `identity.org_address.id` — what `listing.pickup_location_id` points at. */
  addressId: string;
  label: string;
  city: string;
  pincode: string;
}

export interface VendorListing {
  id: string;
  skuId: string;
  grade: string;
  conditionType: string;
  functionalStatus: string;
  batteryHealthBand: string;
  vendorWarrantyMonths: number;
  /** Their own number, the one they typed. Never ours. */
  vendorAskPrice: MoneyString | null;
  qtyTotal: number;
  qtyAvailable: number;
  qtyReserved: number;
  qtyAwaitingQc: number;
  qtyQcFailed: number;
  status: string;
  underPriceReview: boolean;
  gradeCorrectedFrom: string | null;
  qcCompletedAt: IsoDate | null;
  expiresAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface VendorUnit {
  id: string;
  serialNumber: string;
  gradeDeclared: string;
  gradeActual: string | null;
  status: string;
  isSellable: boolean;
  location: string;
  vendorAskPrice: MoneyString | null;
  /**
   * `unit.purchase_price IS NOT NULL` — a purchase order has named this serial
   * and what we owe for it is settled. `trg_lock_purchase_price` enforces that
   * at the database, and the reprice handler updates `WHERE purchase_price IS
   * NULL`, so this is the flag a repricing screen has to read to say which
   * machines will not move BEFORE the vendor commits.
   */
  payoutLocked: boolean;
  qcPassedAt: IsoDate | null;
  qcValidUntil: IsoDate | null;
  createdAt: IsoDate;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Mirrors `SerialCsvReport` from the listing module's serial service. */
export interface SerialCsvRow {
  lineNumber: number;
  serial: string;
  outcome: 'WILL_ADD' | 'WARN' | 'ERROR';
  reason?: string;
}

export interface SerialCsvReport {
  rows: SerialCsvRow[];
  willAdd: number;
  warnings: number;
  errors: number;
  fileErrors: string[];
  errorReportCsv: string;
}

export interface PayoutDeduction {
  code: 'QC_VISIT_FEE' | 'TDS' | 'PENALTY';
  label: string;
  amount: MoneyString;
}

/**
 * Mirrors `VendorPayoutPreview`, minus nothing — the server type already carries
 * no retail figure. `commissionPct` is the one deliberate inversion and it is
 * documented as such in `pricing.service.ts`.
 *
 * `expectedPayoutDate` is NOT on the server type yet. PHASE_03 Task 3 step 4
 * requires it ("their expected payout date given their `vendor_payout_preference`
 * cycle"), so it is optional here and the screen says so when it is absent —
 * inventing the date in the client would be a promise nobody can keep.
 */
export interface PayoutPreview {
  /** `NET_PAYOUT` | `COMMISSION` — which conversation the account is on. */
  pricingMode: string;
  units: number;
  perUnitPayout: MoneyString;
  grossPayout: MoneyString;
  deductions: PayoutDeduction[];
  totalDeductions: MoneyString;
  netPayout: MoneyString;
  commissionPct: number;
  vendorWarrantyMonths: number;
  customerWarrantyMonths: number;
  expectedPayoutDate?: IsoDate | null;
}

/* ==========================================================================
 * Helpers
 * ======================================================================== */

/**
 * The write half of `useResource`. Same credentials, same failure shape.
 *
 * `DomainExceptionFilter` nests its payload under `error`, so the message lives
 * at `error.message` and not at the top level. Reading the top level instead
 * silently discards every actionable sentence the API wrote and renders the
 * generic fallback for all of them — which looks like the API being unhelpful
 * rather than the client dropping the answer.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(detail?.error?.message ?? `That did not go through (${res.status}).`);
  }
  return (await res.json()) as T;
}

/**
 * What both formatters return when there is nothing to format.
 *
 * **Not an em dash.** 09_FRONTEND_LOCKED.md: a missing value never renders as a
 * passing one, and a dash in a column of amounts reads as a result — "nothing
 * owed here" — which is the one reading it must not get. Words, and the caller
 * renders them in `--ink-4`. Exported so a screen can test for the absence
 * rather than string-matching a glyph.
 */
export const NO_AMOUNT = 'No amount';
export const NO_DATE = 'No date';

/**
 * Indian-format rupees, from the decimal string the wire carries.
 *
 * `Money.parse` throws on anything that is not a clean decimal, which is right
 * for storage and useless for display — a missing field would take the screen
 * down.
 */
export function rupees(amount: MoneyString | null | undefined): string {
  if (amount === null || amount === undefined) return NO_AMOUNT;
  try {
    return Money.parse(amount).format();
  } catch {
    return NO_AMOUNT;
  }
}

/** A date the vendor can act on. Absolute, never "in 3 days" — no clock here. */
export function onDate(iso: IsoDate | null | undefined): string {
  if (!iso) return NO_DATE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? NO_DATE
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);
}

/** `A_PLUS` → `A+`, everywhere a grade is spoken rather than badged. */
export function gradeLabel(grade: string): string {
  return grade === 'A_PLUS' ? 'A+' : grade;
}
