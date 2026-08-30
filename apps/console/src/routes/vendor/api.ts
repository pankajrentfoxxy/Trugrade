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
  /**
   * The reference photographs for one grade of one SKU — the same call the
   * product page makes, and the same resolver.
   *
   * No vendor role holds a `catalog.*` permission, and this route is `@Public()`
   * for exactly that reason: the catalog is TrueTech-owned reference data a
   * vendor reads and never writes. Note what it is NOT — the coverage grid at
   * `/api/catalog/condition-images/coverage` is `catalog.condition_image.write`
   * and carries object keys and every model's frames. A vendor gets the six
   * frames they are declaring against and nothing else.
   */
  skuImages: (skuId: string, grade: string) =>
    `/api/catalog/skus/${skuId}?grade=${encodeURIComponent(grade)}`,
  gradeDefinitions: '/api/catalog/grade-definitions',
  skuRequests: '/api/catalog/sku-requests',

  /** `identity.org_address`, scoped to the caller's org. The pickup picker. */
  facilities: '/api/vendor/facilities',

  listings: '/api/vendor/listings',
  listing: (id: string) => `/api/vendor/listings/${id}`,
  listingUnits: (id: string) => `/api/vendor/listings/${id}/units`,
  validateSerials: '/api/vendor/listings/serials/validate',
  /** The wizard's dry run. No listing exists yet, so it checks neither capacity nor status. */
  validateSerialsCsv: '/api/vendor/listings/serials/validate-csv',
  /**
   * The bulk-upload screen's dry run. The scoped one, and the only one that can
   * promise what the commit will do — it reads the listing's remaining capacity
   * and its status, which are the two things `addUnits` refuses a whole file on.
   */
  validateSerialsCsvFor: (id: string) => `/api/vendor/listings/${id}/serials/validate-csv`,

  payoutPreview: '/api/vendor/listings/payout-preview',
  submit: (id: string) => `/api/vendor/listings/${id}/submit`,
  bulkStatus: '/api/vendor/listings/bulk-status',
  reprice: (id: string) => `/api/vendor/listings/${id}/reprice`,

  /**
   * The vendor's own grade corrections — org-scoped, and NOT the QC console's
   * `/api/qc/grade-corrections`, which spans every vendor and carries a resolved
   * vendor name on every row. No vendor role holds the permission that guards
   * that one, and none should: the two audiences are one query apart and that is
   * exactly how a competitor's serials leaked once already.
   */
  corrections: '/api/vendor/grade-corrections',
  correction: (id: string) => `/api/vendor/grade-corrections/${id}`,
  respondToCorrection: (id: string) => `/api/vendor/grade-corrections/${id}/respond`,

  /**
   * The purchase orders WE raised to THEM (T32). Built by `procurement`, whose
   * tables `ordering` has been filling since Phase 6 — the module owned four
   * populated tables and no code until these routes.
   *
   * Note what is not here: nothing addressed by buyer, order number or delivery
   * contact. The anonymity rule runs both ways and a PO is where the pressure on
   * it is highest, so the server's allow-list is mirrored by there being no type
   * in this file that could hold a buyer.
   */
  purchaseOrders: '/api/vendor/purchase-orders',
  purchaseOrderStatusCounts: '/api/vendor/purchase-orders/status-counts',
  purchaseOrder: (poId: string) => `/api/vendor/purchase-orders/${poId}`,
  pickList: (poId: string) => `/api/vendor/purchase-orders/${poId}/pick-list`,
  acknowledgePo: (poId: string) => `/api/vendor/purchase-orders/${poId}/acknowledge`,

  /**
   * What we owe, the deduction stack, and what is honestly unknown (T33).
   *
   * There is no `/api/vendor/payouts` here and no route to add one to.
   * `procurement.payout_run` and `payout_line` have no writer, so a payouts
   * board would be a route whose only reachable state is "nothing yet" — the
   * statement §3B.4 asks for is built from the payables that exist and served
   * by this one endpoint.
   */
  payables: '/api/vendor/payables',

  /**
   * The vendor's own QC visits (T30) — org-scoped, and NOT the QC console's
   * `/api/qc/visits`, which spans every vendor and carries a resolved vendor
   * name and a technician's real name on every row. No vendor role holds the
   * permission that guards those, and none should: the two audiences are one
   * `WHERE` clause apart, and that is exactly how a competitor's manifest was
   * readable once already.
   */
  visits: '/api/vendor/qc/visits',
  visit: (id: string) => `/api/vendor/qc/visits/${id}`,
  cancelVisit: (id: string) => `/api/vendor/qc/visits/${id}/cancel`,
} as const;

/** The four answers, exactly as `listing.grade_correction.vendor_response` allows. */
export const VENDOR_RESPONSES = [
  'ACCEPT_NEW_GRADE',
  'ACCEPT_AND_REPRICE',
  'WITHDRAW_UNIT',
  'DISPUTE',
] as const;
export type VendorResponse = (typeof VENDOR_RESPONSES)[number];

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
 * One reference photograph, as the public SKU route hands it over.
 *
 * `s3Key` is absent and that is the point: the API replaces the object key with
 * a short-lived opaque token, so nothing on a vendor screen carries a storage
 * path. There is no type here that could hold one.
 */
export interface ResolvedGradeImage {
  id: string;
  viewCode: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  url: string;
}

/** Which level of the catalog the photographs came from, and the frames themselves. */
export interface ResolvedGradeImages {
  images: ResolvedGradeImage[];
  match: 'SKU' | 'MODEL' | 'SERIES' | 'PLACEHOLDER';
  isGeneric: boolean;
  placeholderReason?: string;
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

/**
 * One grade correction, as the vendor's own routes send it.
 *
 * **`hoursUntilAutoApply` and `respondByAt` are computed on the server** and are
 * `null` when the window could not be read from config — never zero. A browser
 * clock must not be able to move a deadline that reprices a machine, and "we
 * cannot tell you how long you have" is a different sentence from "you have no
 * time left".
 *
 * Negative hours are normal and are not an error: the window has closed and the
 * correction has not auto-applied yet, so it is still answerable. The screen says
 * so rather than hiding the row or painting it as failed.
 *
 * There is no vendor name (they are the vendor) and no retail price. `askBefore`
 * is the vendor's own ask as it stood when the correction was raised.
 */
export interface GradeCorrection {
  id: string;
  unitId: string;
  listingId: string | null;
  serialNumber: string;
  /** Empty when the SKU could not be resolved. The screen says so; it never guesses. */
  skuCode: string;
  gradeDeclared: string;
  gradeCorrected: string;
  reason: string;
  askBefore: MoneyString | null;
  vendorNotifiedAt: IsoDate;
  respondByAt: IsoDate | null;
  hoursUntilAutoApply: number | null;
  vendorResponse: VendorResponse | null;
  vendorRespondedAt: IsoDate | null;
  autoAppliedAt: IsoDate | null;
  /** Feeds the grade-accuracy figure buyers compare supply points on. */
  countsAgainstAccuracy: boolean;
}

/** Still waiting on the vendor — the same predicate the dashboard queue counts. */
export function needsAnswer(c: GradeCorrection): boolean {
  return c.vendorResponse === null && c.autoAppliedAt === null;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Mirrors `SerialCsvReport` from the listing module's serial service. */
export interface SerialCsvRow {
  /** The line in the VENDOR'S file, blank rows included in the count. */
  lineNumber: number;
  serial: string;
  outcome: 'WILL_ADD' | 'WARN' | 'ERROR';
  reason?: string;
}

/**
 * What a file will do, before it does it.
 *
 * **`willAdd + errors === rows.length`, and `willAdd` is what the commit
 * inserts.** `warnings` is a SUBSET of `willAdd`, not a third bucket beside it —
 * a warned row is an accepted row, because an unrecognised brand shape is a worn
 * label and the whole point of a warning is that it does not stop the machine
 * going in. This screen used to print `willAdd` as the promise while handing the
 * commit `willAdd + warnings`, so the sentence and the button disagreed by
 * exactly the number of warnings.
 */
export interface SerialCsvReport {
  rows: SerialCsvRow[];
  willAdd: number;
  warnings: number;
  errors: number;
  fileErrors: string[];
  errorReportCsv: string;
}

/** What `POST /listings/:id/units` actually did. `added` is the serials written. */
export interface AddUnitsOutcome {
  added: string[];
  batch: {
    accepted: string[];
    errors: Array<{ line: number; serial: string; message: string }>;
    warnings: Array<{ line: number; serial: string; message: string }>;
  };
}

/* --------------------------------------------------------------------------
 * T32 — purchase orders
 * ------------------------------------------------------------------------ */

/**
 * The ten states of a purchase order, in the order they happen.
 *
 * Ordered rather than alphabetical because the filter is a lifecycle and reading
 * it as one is the whole value of a list this long.
 */
export const PO_STATUSES = [
  'RAISED',
  'ACKNOWLEDGED',
  'DISPATCH_READY',
  'DISPATCHED',
  'RECEIVED',
  'INVOICED',
  'MATCHED',
  'PAYABLE',
  'PAID',
  'CANCELLED',
  'DISPUTED',
] as const;

/** Where the machines go. City only — the street is on the pick list and nowhere else. */
export interface DeliveryCity {
  city: string;
  state: string;
}

/**
 * One purchase order, exactly as `procurement`'s allow-list sends it.
 *
 * **There is no buyer on this type and no retail price**, and that is structural
 * rather than careful: the server never puts either on the wire, so there is no
 * field here one could arrive in. The buyer's own order number is absent too —
 * order numbers are sequential, so two of them a fortnight apart would let a
 * vendor read the platform's order volume off the difference.
 *
 * `acknowledgeBy` is **always null today**, and the screen says so rather than
 * inventing a window: no acceptance deadline exists in `platform_config` and no
 * penalty rule stands behind one. `expectedDispatchAt` is null for the same
 * kind of reason — nothing sets it. Neither renders as a date.
 */
export interface PurchaseOrder {
  poId: string;
  poNumber: string;
  status: string;
  raisedAt: IsoDate;
  units: number;
  /** `purchase_order.total_net` — what we agreed to pay for these machines. */
  totalNet: MoneyString;
  /**
   * TDS as it was computed and stored when the PO was raised, u/s 393(1)
   * Sl. 8(ii). Read, never recomputed — `computeTds` ran once against that day's
   * cumulative purchases, and a second implementation is a second answer.
   */
  tdsRatePct: number;
  tdsAmount: MoneyString;
  valuationMethod: string;
  termsDays: number;
  acknowledgedAt: IsoDate | null;
  expectedDispatchAt: IsoDate | null;
  acknowledgeBy: IsoDate | null;
  cancelledAt: IsoDate | null;
  rejectedAt: IsoDate | null;
  rejectionReason: string | null;
  deliverTo: DeliveryCity | null;
}

/** One machine on the PO. The serial and the seal are what a warehouse reads. */
export interface PurchaseOrderLine {
  /** Their own `listing.unit` id — the row key when a serial is missing. */
  unitId: string;
  /** Null when the unit has been removed since. Never an invented serial. */
  serialNumber: string | null;
  title: string | null;
  skuCode: string | null;
  specSummary: string | null;
  gradeAtPo: string;
  agreedNetPayout: MoneyString;
  /** Null means no seal is recorded — a real problem at handover, said as one. */
  seal: { code: string; status: string } | null;
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  lines: PurchaseOrderLine[];
}

export interface PickListAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  landmark: string | null;
}

/**
 * The printable list for the box.
 *
 * **No money, at any depth, deliberately.** Bill-To-Ship-To under s.10(1)(b)
 * IGST means neither the vendor's invoice value nor ours travels with the goods,
 * so a price on a packing list is a compliance defect. `PurchaseOrderLine` has
 * `agreedNetPayout` and this type does not — two types rather than one with a
 * flag, so the omission cannot be undone by passing `true`.
 */
export interface PickList {
  poNumber: string;
  raisedAt: IsoDate;
  units: number;
  shipTo: PickListAddress | null;
  lines: Array<{
    unitId: string;
    serialNumber: string | null;
    sealCode: string | null;
    sealStatus: string | null;
    title: string | null;
    skuCode: string | null;
    gradeAtPo: string;
  }>;
}

/* --------------------------------------------------------------------------
 * T33 — payables and the statement
 * ------------------------------------------------------------------------ */

/** `procurement.vendor_payable.status`, as its CHECK constraint allows. */
export const PAYABLE_STATUSES = [
  'ACCRUED',
  'ELIGIBLE',
  'IN_RUN',
  'PAID',
  'ON_HOLD',
  'CANCELLED',
] as const;

/**
 * Why a payable has not been paid, decided on the server against its clock.
 *
 * The two arms that compare a time — the inspection window and "payable but
 * nothing has run" — are money deadlines, so the answer is handed to the client
 * rather than the ingredients. A browser clock must not be able to move when a
 * vendor is owed.
 */
export type PayableWaitingOn =
  | 'PAID'
  | 'ON_HOLD'
  | 'CANCELLED'
  | 'NOT_DELIVERED'
  | 'INSPECTION_WINDOW_OPEN'
  | 'NO_PAYOUT_RUN'
  | 'WINDOW_NOT_CONFIGURED';

export interface PayableRow {
  payableId: string;
  poId: string;
  poNumber: string;
  units: number;
  gross: MoneyString;
  tds: MoneyString;
  penalties: MoneyString;
  qcFee: MoneyString;
  net: MoneyString;
  status: string;
  holdReason: string | null;
  accruedAt: IsoDate;
  deliveredAt: IsoDate | null;
  inspectionWindowClosesAt: IsoDate | null;
  /**
   * What the system has RECORDED as the eligibility instant.
   *
   * **Null on every payable in existence — nothing writes it.** Kept beside
   * `inspectionWindowClosesAt` rather than merged with it: one is the rule and
   * the other is the record, and the screen must not present the first as the
   * second.
   */
  eligibleAt: IsoDate | null;
  paidAt: IsoDate | null;
  /** The date we are BOUND to pay by. Null until something is delivered. */
  payBy: IsoDate | null;
  payByBasis: 'MSMED_ACT' | 'PO_TERMS' | null;
  payByDays: number | null;
  overdue: boolean;
  waitingOn: PayableWaitingOn;
}

/**
 * The deduction stack over everything unpaid.
 *
 * **There is no `expectedPaymentOn` on this type and there must not be.** No
 * payout run has ever executed, `eligible_at` is set by nothing, and
 * `procurement.default_payout_cycle` is a cycle rather than a promise — a date
 * derived from it is one a vendor plans cash against and we invented.
 */
export interface PayablesView {
  statement: {
    /** The denominator for every figure below. */
    payables: number;
    gross: MoneyString;
    tds: {
      amount: MoneyString;
      /** The rate that would apply ABOVE the threshold, from config. Never ₹0 ÷ gross. */
      ratePct: number | null;
      thresholdAmount: MoneyString | null;
      financialYearPurchases: MoneyString;
      financialYear: string;
      /** `computeTds`'s own sentence, from `@trugrade/contracts`. Never restated. */
      reason: string;
      hasVerifiedPan: boolean;
    };
    penalties: MoneyString;
    qcFees: MoneyString;
    net: MoneyString;
  };
  rows: PayableRow[];
  /** Zero everywhere, and the screen says so rather than showing an empty board. */
  payoutsEver: number;
  msme: {
    registered: boolean;
    udyamNumber: string | null;
    /** `msme.max_payment_days`. Null when unconfigured — never defaulted to 45. */
    maxPaymentDays: number | null;
  };
  inspectionWindowHours: number | null;
  account: {
    last4: string;
    holderName: string;
    bankName: string | null;
    verified: boolean;
    pennyDropStatus: string;
    frozenUntil: IsoDate | null;
  } | null;
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

/**
 * A deadline to the hour.
 *
 * `onDate` is right for a day somebody plans around; an inspection window closes
 * at a particular time and rounding it to a date would move a money deadline by
 * up to a day in the direction that suits us.
 */
export function onDateTime(iso: IsoDate | null | undefined): string {
  if (!iso) return NO_DATE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? NO_DATE
    : new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(d);
}

/** `A_PLUS` → `A+`, everywhere a grade is spoken rather than badged. */
export function gradeLabel(grade: string): string {
  return grade === 'A_PLUS' ? 'A+' : grade;
}

/* ==========================================================================
 * QC visits (T30)
 * ======================================================================== */

/** `qc_visit.status`, exactly as `public.qc_visit_status` allows. */
export const VISIT_STATUSES = [
  'REQUESTED',
  'QUOTED',
  'SCHEDULED',
  'TECH_ASSIGNED',
  'EN_ROUTE',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
  'NO_SHOW_VENDOR',
  'NO_SHOW_TECH',
  'RESCHEDULED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** `qc_visit_unit.outcome`. UNTESTABLE is where a serial mismatch lands. */
export type UnitOutcome =
  | 'PENDING'
  | 'PASS'
  | 'PASS_GRADE_CORRECTED'
  | 'PASS_WITH_NOTE'
  | 'FAIL'
  | 'UNTESTABLE'
  | 'ABSENT';

/**
 * The visit fee, with everything needed to say what it is and why.
 *
 * A bare `₹0` is the one rendering this screen may never produce: it reads as
 * "nothing to pay" whether the truth is that we are bearing it, that the batch
 * cleared the waiver, or that nobody has priced the visit yet. `waivedAboveUnits`
 * is `null` and not `0` when the threshold could not be read — "we cannot tell
 * you the threshold" is not "there is no threshold".
 */
export interface VisitFee {
  amount: MoneyString;
  bearer: 'TRUETECH' | 'VENDOR' | 'SPLIT' | 'WAIVED';
  waiverReason: string | null;
  waivedAboveUnits: number | null;
  standardFee: MoneyString | null;
}

/**
 * One visit as the vendor's own routes send it.
 *
 * There is no vendor name (they are the vendor) and no technician name — §3B
 * identifies the technician as `TECH-0142` until arrival, and a name never
 * crosses this wire at any status.
 */
export interface VendorVisit {
  id: string;
  visitNumber: string;
  status: VisitStatus;
  siteLabel: string;
  requestedAt: IsoDate;
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  technicianCode: string | null;
  unitsRequested: number;
  /** Null until somebody has arrived and counted. Never a zero standing in. */
  unitsPresented: number | null;
  unitsInspected: number;
  unitsPassed: number;
  unitsGradeCorrected: number;
  unitsFailed: number;
  unitsAbsent: number;
  arrivedAt: IsoDate | null;
  startedAt: IsoDate | null;
  completedAt: IsoDate | null;
  vendorSignoffAt: IsoDate | null;
  vendorSignoffName: string | null;
  rescheduleCount: number;
  cancellationReason: string | null;
  notes: string | null;
  fee: VisitFee;
  /** Server-decided from the same transition map the scheduler enforces. */
  cancellable: boolean;
}

export interface VisitUnitResult {
  verdict: string | null;
  grade: string | null;
  qcScore: number | null;
  inspectedOn: string | null;
  batteryHealthPct: number | null;
  seal: { code: string; status: string } | null;
  /** The areas marked down, worst first, each with its own denominator. */
  findings: Array<{ area: string; score: number; maxScore: number }>;
}

export interface VisitManifestUnit {
  visitUnitId: string;
  unitId: string;
  sequenceNo: number | null;
  serialNumber: string;
  skuCode: string;
  gradeDeclared: string | null;
  outcome: UnitOutcome;
  absentReason: string | null;
  /** `null` means nobody has opened this machine. It never means a zero score. */
  result: VisitUnitResult | null;
}

export interface FacilityCalendar {
  hours: Array<{
    dayOfWeek: number;
    openTime: string | null;
    closeTime: string | null;
    isClosed: boolean;
  }>;
  holidays: Array<{ date: string; reason: string | null }>;
}

export interface VendorVisitDetail extends VendorVisit {
  manifest: VisitManifestUnit[];
  calendar: FacilityCalendar;
}

/** A visit nobody has been to yet: no arrival, so no result of any kind. */
export function notVisitedYet(v: VendorVisit): boolean {
  return v.arrivedAt === null;
}
