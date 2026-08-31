/**
 * The unit 360 and the global palette — T35, `03_UX_SPEC.md` §3C and
 * component 25.
 *
 * Every type below mirrors a hand-written allow-list on the server
 * (`ConsoleController`). Mirrored rather than shared, for the reason
 * `routes/ops/api.ts` states: a field the API grows cannot arrive on a screen by
 * accident. That discipline matters more here than anywhere else in the console
 * — `listing.unit` carries `vendor_org_id`, `purchase_price` and
 * `hw_fingerprint_hash`, and the shape of `Unit360` is the only thing standing
 * between that row and a rendered page.
 *
 * **This screen shows both sides and that is what it is for.** It is reachable
 * only by platform staff (`orgType === 'PLATFORM'`, refused on the server) and
 * the commercial half needs `ordering.any.read` on top of `listing.any.read` —
 * so a TECHNICIAN gets the machine's whole life and never learns who bought it.
 */

// ponytail: the four formatters live in `routes/vendor/api.ts` and are imported
// rather than re-declared, exactly as `routes/ops/api.ts` does. Three consumers
// now; promote to `lib/format.ts` when the move is not competing with an open
// lane.
export { rupees, onDate, onDateTime, gradeLabel } from '../vendor/api';

export const UNIT_API = {
  search: (q: string) => `/api/ops/search?q=${encodeURIComponent(q)}`,
  unit: (serial: string) => `/api/ops/units/${encodeURIComponent(serial)}`,
} as const;

/* ==========================================================================
 * Global search
 * ======================================================================== */

export interface SearchHit {
  id: string;
  label: string;
  detail: string | null;
  /** Unformatted rupees, or null. The console formats it — money is grouped once. */
  amount: string | null;
  /** Null when nothing in this console opens it. The palette then offers no link. */
  href: string | null;
  matchedOn: { field: string; value: string };
}

export interface SearchGroup {
  key: string;
  label: string;
  /** Printed under an empty group so "no result" is not read as "not supported". */
  comparedWith: readonly string[];
  hits: SearchHit[];
  more: number;
}

/** A source this role cannot search, or that has no screen. Never a record. */
export interface SearchUnavailable {
  label: string;
  reason: string;
}

export interface ConsoleSearch {
  q: string;
  groups: SearchGroup[];
  unavailable: SearchUnavailable[];
  total: number;
}

/* ==========================================================================
 * The unit 360
 * ======================================================================== */

export interface Unit360Machine {
  skuCode: string;
  title: string;
  spec: string;
}

export interface Unit360Qc {
  score: number | null;
  verdict: string | null;
  gradeProposed: string | null;
  gradeFinal: string | null;
  technicianCode: string | null;
  inspectedAt: string | null;
  validUntil: string | null;
  isCurrent: boolean;
  batteryHealthPct: string | null;
  cycleCount: number | null;
  powerOnHours: number | null;
  storage: string | null;
  cpu: string | null;
  ramGb: number | null;
}

export interface Unit360Seal {
  sealCode: string;
  status: string;
  appliedAt: string;
  verifiedAt: string | null;
  brokenAt: string | null;
  brokenReason: string | null;
}

export interface Unit360Movement {
  at: string;
  fromStatus: string | null;
  toStatus: string;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string | null;
  refType: string | null;
  actorName: string | null;
}

export interface Unit360Warranty {
  status: string;
  startDate: string;
  endDate: string;
  totalMonths: number;
  vendorBackedMonths: number;
  platformBackedMonths: number;
}

export interface Unit360Return {
  returnNumber: string;
  status: string;
  reasonCode: string;
  raisedAt: string;
  qcVerdict: string | null;
  liableParty: string | null;
}

export interface Unit360Commercial {
  orderNumber: string;
  orderStatus: string;
  placedAt: string;
  buyerLegalName: string | null;
  soldFor: string;
  lineStatus: string;
  poNumber: string | null;
  poStatus: string | null;
  paid: string | null;
  margin: string | null;
  poUnavailable: string | null;
}

export interface Unit360 {
  serialNumber: string;
  status: string;
  location: string;
  isSellable: boolean;
  gradeDeclared: string;
  gradeActual: string | null;
  createdAt: string;
  supplyPointLegalName: string | null;
  supplyPointCode: string | null;
  valuationMethod: string;
  itcEligible: boolean;
  machine: Unit360Machine | null;
  qc: Unit360Qc | null;
  qcUnavailable: string | null;
  seal: Unit360Seal | null;
  movements: Unit360Movement[];
  warranty: Unit360Warranty | null;
  returns: Unit360Return[];
  commercial: Unit360Commercial | null;
  commercialUnavailable: string | null;
  auditEntries: number;
}

/* ==========================================================================
 * Tone
 * ======================================================================== */

export type Tone = 'neutral' | 'info' | 'warn' | 'processing' | 'pass' | 'fail';

/**
 * **A unit status is not a verdict.**
 *
 * 09_FRONTEND_LOCKED §2 rule 2 reserves green and red for PASS and FAIL, so
 * neither appears on the status of a machine: `DELIVERED` is not a passed test
 * and `RETURNED_TO_VENDOR` is not a failed one. The two that earn `warn` are the
 * two that need somebody in this building — a machine that failed inspection and
 * one that came back — and `warn` because both are our problem to resolve rather
 * than a verdict on the machine's owner.
 */
export const UNIT_TONE: Record<string, Tone> = {
  CREATED: 'neutral',
  AWAITING_QC: 'processing',
  QC_SCHEDULED: 'processing',
  QC_IN_PROGRESS: 'processing',
  QC_PASSED: 'neutral',
  QC_SEALED: 'neutral',
  LISTED: 'neutral',
  RESERVED: 'processing',
  PICKUP_SCHEDULED: 'processing',
  PICKED_UP: 'processing',
  RECEIVED_AT_HUB: 'processing',
  PACKED: 'processing',
  DISPATCHED: 'processing',
  DELIVERED: 'neutral',
  // The five that need somebody in this building. `warn` and never `fail`: a
  // machine that did not meet its declaration is a supply problem to work, not a
  // test result to paint red — the red on this screen belongs to the QC verdict
  // alone, which is the only thing here that IS a test.
  QC_MISMATCH: 'warn',
  QC_FAILED: 'warn',
  QC_EXPIRED: 'warn',
  SEAL_BROKEN: 'warn',
  RETURN_REQUESTED: 'warn',
  RETURN_IN_TRANSIT: 'processing',
  RETURN_QC: 'processing',
  RETURNED_TO_VENDOR: 'neutral',
  SCRAPPED: 'neutral',
};

/**
 * A QC verdict IS a verdict, and it is the one place on this screen green and
 * red are correct. `MISMATCH` is neither: the machine was inspected and what it
 * is is not what was declared — that is a finding about the declaration, and it
 * is ours and the supply point's to settle.
 */
export const VERDICT_TONE: Record<string, Tone> = {
  PASS: 'pass',
  PASS_WITH_NOTE: 'pass',
  MISMATCH: 'warn',
  FAIL: 'fail',
};

/** A warranty is a period, not a result. Expired is not a failure. */
export const WARRANTY_TONE: Record<string, Tone> = {
  ACTIVE: 'neutral',
  EXPIRED: 'neutral',
  VOID: 'warn',
  CLAIMED: 'processing',
};

/**
 * A return in flight is somebody's afternoon; a closed one is not.
 *
 * `RAISED` is `warn` and not `processing`, and the difference from T39's order
 * statuses is deliberate: a returned machine is a customer waiting, a 48-hour
 * window running and stock we cannot sell, all at once. That is the definition
 * of a state needing somebody today.
 */
export const RETURN_TONE: Record<string, Tone> = {
  RAISED: 'warn',
  APPROVED: 'processing',
  PICKED_UP: 'processing',
  RECEIVED: 'processing',
  IN_QC: 'processing',
  // The five `CLOSED_RETURN_STATUSES` in `returns.repository.ts`. All neutral: a
  // rejected return is a decision, and a refunded one is a finished job.
  REJECTED: 'neutral',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
  REPLACED: 'neutral',
  RETURNED_TO_BUYER: 'neutral',
};

/** `PAYMENT_PENDING` → `Payment pending`. Same rule as `routes/ops/api.ts`. */
export function humanise(value: string): string {
  const words = value.replace(/[._]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
