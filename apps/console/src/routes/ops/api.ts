/**
 * The platform's own order and procurement boards — T39, `03_UX_SPEC.md` §3C.4.
 *
 * Every type below mirrors a hand-written allow-list on the server
 * (`OpsOrderService`, `OpsPurchaseOrderService`). Mirrored rather than shared:
 * a field the API grows cannot arrive on a screen by accident, which is the same
 * discipline `routes/vendor/api.ts` keeps for the opposite reason.
 *
 * **These screens show both sides, and that is the whole point of them.** §3C.4:
 * the order record is "the only place the two ever sit on one screen, and it is
 * ADMIN-only". Nothing here is reachable by a vendor or a buyer — the routes are
 * gated on `ordering.any.read` and `procurement.po.read_any`, and the `*.any.*`
 * convention in `roles.ts` means no tenant role holds either.
 */

// ponytail: the four formatters live in `routes/vendor/api.ts` and are imported
// rather than re-declared. Promote them to `lib/format.ts` when a third route
// folder needs them; two consumers do not justify moving a file two other lanes
// are editing this week.
export { rupees, onDate, onDateTime, gradeLabel } from '../vendor/api';
export type { MoneyString, IsoDate } from '../vendor/api';

export const OPS_API = {
  orders: '/api/ops/orders',
  order: (orderNumber: string) => `/api/ops/orders/${encodeURIComponent(orderNumber)}`,
  verify: (orderNumber: string) => `/api/ops/orders/${encodeURIComponent(orderNumber)}/verify`,
  purchaseOrders: '/api/ops/purchase-orders',
  listings: '/api/ops/listings',
  approveListing: (id: string) => `/api/ops/listings/${id}/approve`,
  rejectListing: (id: string) => `/api/ops/listings/${id}/reject`,
  technicians: '/api/qc/technicians',
  technicianWorkload: '/api/qc/inspections/workload',
  assignTechnician: '/api/qc/order-inspections/assign',
} as const;

export interface OpsFacetOption {
  value: string;
  label: string;
  count: number;
}

/* ==========================================================================
 * The order board and record
 * ======================================================================== */

export interface OpsOrderMatch {
  kind: 'serial' | 'seal' | 'buyer' | 'gstin' | 'mobile' | 'buyer_po';
  value: string;
}

export interface OpsOrderParty {
  legalName: string;
  tradeName: string | null;
}

export interface OpsOrderApproval {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverName: string;
  requestedAt: string;
  expiresAt: string;
  /** Decided by the SERVER's clock. The browser never subtracts two dates here. */
  breached: boolean;
}

export interface OpsOrderRow {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  /** `PREPAID`, or credit terms. Unpaid on credit is normal; unpaid prepaid is not. */
  paymentMode: string;
  placedAt: string;
  buyer: OpsOrderParty | null;
  buyerPoNumber: string | null;
  grandTotal: string;
  units: number;
  purchaseOrders: number;
  approval: OpsOrderApproval | null;
  matchedOn: OpsOrderMatch[];
}

export interface OpsOrderAttentionItem {
  orderNumber: string;
  status: string;
  buyerName: string | null;
  grandTotal: string;
}

/**
 * The board's "Needs attention" strip, computed by the server over every
 * order — not the page — and only for prepaid ones.
 */
export interface OpsOrderAttention {
  deliveredUnpaid: OpsOrderAttentionItem[];
  acceptedUnpaid: OpsOrderAttentionItem[];
  paymentPending: { count: number; total: string; oldestPlacedAt: string | null };
}

export interface OpsOrderBoard {
  rows: OpsOrderRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: { status: OpsFacetOption[]; payment: OpsFacetOption[] };
  /** Optional on the client only so an older payload (or a test fixture) renders the board without the strip. */
  attention?: OpsOrderAttention;
  searchedFor: string[] | null;
}

export interface OpsOrderMachine {
  /** The `order_line_unit` row. Stable before a serial exists. */
  slotId: string;
  /** Null until the technician names the machine at the supply point. */
  serialNumber: string | null;
  title: string | null;
  grade: string;
  unitPrice: string;
  /** What we agreed to pay for this exact serial. Null when no PO covers it. */
  purchaseCost: string | null;
  status: string;
  inspectedAt: string | null;
  verifiedAt: string | null;
}

export interface OpsOrderVisit {
  visitId: string;
  visitNumber: string;
  status: string;
  technicianName: string | null;
  /** `YYYY-MM-DD` and `HH:MM`: the booking, or null when not booked. */
  scheduledDate: string | null;
  slotFrom: string | null;
  slotTo: string | null;
  unitsRequested: number;
  unitsInspected: number;
}

export interface TechnicianOption {
  id: string;
  name: string;
  employeeCode: string;
  isActive: boolean;
}

/** `GET /api/qc/inspections/workload` — a technician's next fortnight, and their open visits. */
export interface TechnicianLoad {
  technicianId: string;
  name: string | null;
  /** `YYYY-MM-DD` → visits that day. */
  byDay: Record<string, number>;
  openVisits: number;
}

export interface VerifyResult {
  orderNumber: string;
  status: string;
  verified: number;
  total: number;
  payBy: string | null;
  purchaseOrders: number;
}

export interface AssignResult {
  orderNumber: string;
  visits: Array<{ visitId: string; visitNumber: string; units: number }>;
  technicianName: string;
}

export interface OpsSubOrder {
  subOrderNumber: string;
  vendorLegalName: string | null;
  status: string;
  subtotal: string;
  dispatchSlaDueAt: string | null;
  deliveredAt: string | null;
  machines: OpsOrderMachine[];
}

export interface OpsPurchaseOrderOnOrder {
  poId: string;
  poNumber: string;
  status: string;
  vendorLegalName: string | null;
  totalNet: string;
  tdsAmount: string;
  lines: number;
  raisedAt: string;
  acknowledgedAt: string | null;
  /** The consignment as the supply point typed it at dispatch. Verbatim; the screen judges it. */
  carrier: string | null;
  awb: string | null;
  dispatchedAt: string | null;
}

export interface OpsMargin {
  soldFor: string;
  paid: string;
  amount: string;
  /** A percentage string. Its denominator is `soldFor`, and the screen says so. */
  pct: string;
}

export interface OpsTimelineEvent {
  at: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  note: string | null;
}

export interface OpsAddress {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
}

export interface OpsOrderRecord {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMode: string;
  placedAt: string;
  buyer: OpsOrderParty | null;
  buyerGstin: string | null;
  placedByName: string | null;
  placedByMobile: string | null;
  buyerPoNumber: string | null;
  costCentre: string | null;
  shipTo: OpsAddress | null;
  money: {
    subtotal: string;
    freight: string;
    gstTotal: string;
    tcs: string;
    grandTotal: string;
  };
  subOrders: OpsSubOrder[];
  purchaseOrders: OpsPurchaseOrderOnOrder[];
  margin: OpsMargin | null;
  /** Present exactly when `margin` is null, and it names the reason. */
  marginUnavailable: string | null;
  approval: OpsOrderApproval | null;
  timeline: OpsTimelineEvent[];
  inspection: {
    visits: OpsOrderVisit[];
    machines: number;
    inspected: number;
    verified: number;
  };
  verifiedAt: string | null;
  /** The buyer's 24-hour payment deadline. Null until verified, or on credit terms. */
  payBy: string | null;
  paidAt: string | null;
}

/* ==========================================================================
 * The procurement board
 * ======================================================================== */

export interface OpsPoRow {
  poId: string;
  poNumber: string;
  status: string;
  vendorOrgId: string;
  vendorLegalName: string | null;
  /** Ours. Shown on this screen and on no vendor screen — see T32. */
  orderNumber: string | null;
  raisedAt: string;
  lines: number;
  totalNet: string;
  tdsAmount: string;
  valuationMethod: string;
  termsDays: number;
  acknowledgedAt: string | null;
  /** Hours since we raised it. **Not** hours late: there is no deadline. */
  waitingHours: number | null;
  matchedSerials: string[];
}

export interface OpsPoBoard {
  rows: OpsPoRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: { status: OpsFacetOption[]; vendor: OpsFacetOption[] };
  totals: { value: string; tds: string; machines: number };
  searchedFor: string[] | null;
}

/* ==========================================================================
 * Tone
 * ======================================================================== */

export type Tone = 'neutral' | 'info' | 'warn' | 'processing';

/**
 * **An order status is not a verdict, and it is usually not an exception either.**
 *
 * 09_FRONTEND_LOCKED §2 rule 2 reserves green and red for PASS and FAIL, so
 * neither appears on either board: a cancelled order is not a failed test and a
 * delivered one is not a passed one.
 *
 * The second half of the rule is the one the first draft of this board got
 * wrong. Thirteen rows carried two outlined-amber chips each — every
 * `PAYMENT_PENDING` order and every `PENDING` payment — and a board that is
 * mostly amber has spent the colour on everything and therefore marks nothing.
 * That is the same defect T37 and T38 each had to undo. **`warn` is now reserved
 * for the states that need somebody in this building today**: an order held for
 * an approver, and a payment that went wrong. An order waiting to be paid for is
 * the ordinary next step of checkout, so it is `processing` — in flight, which
 * is exactly what it is.
 */
export const ORDER_TONE: Record<string, Tone> = {
  CREATED: 'neutral',
  /** Stock is held, a deadline is running, and nobody here can move it. */
  AWAITING_APPROVAL: 'warn',
  /** Somebody here has to assign a technician. */
  AWAITING_INSPECTION: 'warn',
  QC_IN_PROGRESS: 'processing',
  /** Somebody here has to verify the machines. */
  AWAITING_VERIFICATION: 'warn',
  PAYMENT_PENDING: 'processing',
  CONFIRMED: 'processing',
  DISPATCHED: 'processing',
  DELIVERED: 'neutral',
  CANCELLED: 'neutral',
};

/**
 * Same rule. A payment that has not arrived yet is the ordinary state of a
 * fresh order; a partial one and a failed one are somebody's afternoon.
 */
export const PAYMENT_TONE: Record<string, Tone> = {
  PENDING: 'processing',
  PARTIAL: 'warn',
  PAID: 'neutral',
  REFUNDED: 'neutral',
  FAILED: 'warn',
};

/**
 * An approval's state, from the platform's side.
 *
 * A live one is in flight. A decided one is terminal and neutral — **including
 * REJECTED, which is a decision and not a failure.** `EXPIRED` is `warn` and the
 * reason is T34's: the deadline was ours, we let it lapse, and that is our
 * failure rather than a verdict on the buyer.
 */
export const APPROVAL_TONE: Record<string, Tone> = {
  PENDING: 'processing',
  APPROVED: 'neutral',
  REJECTED: 'neutral',
  EXPIRED: 'warn',
};

/**
 * A purchase-order status, from OUR side of it.
 *
 * **`RAISED` is `processing` here and `warn` on the vendor's board, and that
 * divergence is deliberate.** On `/vendor/orders` an unaccepted purchase order
 * is the one thing that vendor must do something about. Here it is the ordinary
 * first state of every purchase order the platform has ever raised — fifteen of
 * seventeen on this database — and this screen says in as many words that no
 * acceptance deadline exists, so painting them all amber would mark the normal
 * case and leave nothing for the abnormal one.
 */
export const PO_TONE: Record<string, Tone> = {
  RAISED: 'processing',
  ACKNOWLEDGED: 'processing',
  DISPATCH_READY: 'processing',
  DISPATCHED: 'processing',
  RECEIVED: 'processing',
  INVOICED: 'processing',
  MATCHED: 'processing',
  PAYABLE: 'info',
  PAID: 'neutral',
  CANCELLED: 'neutral',
  DISPUTED: 'warn',
};

/**
 * `PAYMENT_PENDING` → `Payment pending`, `order.placed` → `Order placed`.
 *
 * The dot matters: `ordering.order_event.event_type` carries both shapes —
 * `STATUS_CHANGE` from the state machine and `order.approval_requested` from the
 * domain events — and a timeline reading "Order.placed" is a machine word that
 * escaped onto a screen a person reads.
 */
export function humanise(value: string): string {
  const words = value.replace(/[._]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The buyer, as a subtitle.
 *
 * The trade name is dropped when it equals the legal name, which it does for
 * every organisation the demo seed builds — the record header read "Acme
 * Industries Pvt. Ltd. · Acme Industries Pvt. Ltd." until this existed.
 */
export function partyLine(party: OpsOrderParty | null): string | null {
  if (!party) return null;
  return party.tradeName && party.tradeName !== party.legalName
    ? `${party.legalName} · ${party.tradeName}`
    : party.legalName;
}

/* ==========================================================================
 * Listing approvals — `GET /api/ops/listings`
 * ======================================================================== */

export interface OpsListingRow {
  listingId: string;
  status: string;
  vendorOrgId: string;
  /** Named: this is our console and the vendor is our counterparty. */
  vendorLegalName: string | null;
  title: string | null;
  specSummary: string | null;
  grade: string;
  qtyTotal: number;
  qtyAvailable: number;
  qtyReserved: number;
  /** What the vendor wants per machine. */
  vendorAskPrice: string | null;
  /** Our selling price after the margin rule. Null while a draft. */
  sellingPrice: string | null;
  /** True when only an ops floor override can take this listing live. */
  belowFloor: boolean;
  /** The pricing service's flag on this row, or null. See the API service note. */
  priceFlag: {
    reason: 'below_floor' | 'unpriced' | 'below_band';
    floorPrice: string | null;
    bandMedian: string | null;
    bandRatio: number | null;
  } | null;
  pickupCity: string | null;
  submittedAt: string;
  createdAt: string;
  approvedAt: string | null;
  rejectionReason: string | null;
}

export interface OpsListingBoard {
  rows: OpsListingRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  /** Under the current filter: machines, and what they fetch at our prices. */
  totals: { units: number; value: string };
  /** Rows under the current status, search and vendor that carry a price flag. */
  flagged: number;
  facets: { status: OpsFacetOption[]; vendor: OpsFacetOption[] };
}

/** A listing status, from ops' side. Amber is reserved for the one live state. */
export const LISTING_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warn',
  ACTIVE: 'info',
  PARTIALLY_ACTIVE: 'info',
  PAUSED: 'neutral',
  OUT_OF_STOCK: 'neutral',
  REJECTED: 'neutral',
  SUSPENDED: 'warn',
  EXPIRED: 'neutral',
  DELISTED: 'neutral',
};
