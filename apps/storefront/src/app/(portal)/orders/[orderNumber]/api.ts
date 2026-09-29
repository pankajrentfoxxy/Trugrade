/**
 * The browser half of one order — `GET /api/buyer/orders/:orderNumber`, through
 * the same-origin rewrite so the `httpOnly` refresh cookie stays first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `OrderReadService` (`apps/api/src/modules/ordering/internal/order-read.service.ts`).
 * They are copied rather than imported because the storefront may not import the
 * API — and they are allow-lists on that side, which is what guarantees there is
 * no vendor identifier here to render. Nothing in this file widens them.
 *
 * Note what has no type here, because there is no field for it: our purchase
 * order to a supply point. Under the merchant-of-record model that document is
 * vendor-and-admin-only (PHASE_06 Task 6), so no buyer-reachable endpoint reads
 * `procurement.purchase_order` and nothing on this screen could render one if it
 * wanted to. The buyer's own PO reference — `buyerPoNumber` — is a different
 * document belonging to a different party, and it is theirs.
 */
import { call, type ApiResult } from '../../../register/api';

/** `A_PLUS` | `A` | `B`, as the grade enum spells it. */
export interface OrderedMachine {
  /** Null until the technician has inspected the machine and recorded its serial. */
  serialNumber: string | null;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  grade: string;
  unitPrice: string;
  /** ISO 8601 when the technician recorded it. Null before. */
  inspectedAt: string | null;
  /** ISO 8601 when we verified it. "Device verified" reads this and nothing else. */
  verifiedAt: string | null;
}

export interface DispatchGroup {
  /** `Supply Point F · Noida`. A dispatch point, never a seller. */
  label: string;
  machines: OrderedMachine[];
}

/**
 * One line of the order as the dispatch point answered it.
 *
 * `qtyAvailable` is null until the dispatch point has answered. Null renders as
 * "not confirmed yet", never as a quantity — an unanswered line is neither
 * zero nor all.
 */
export interface SupplyLine {
  /** `Supply Point F · Noida`. A dispatch point, never a seller. */
  label: string;
  title: string | null;
  specSummary: string | null;
  grade: string;
  qtyOrdered: number;
  qtyAvailable: number | null;
  /** ISO 8601, when the dispatch point answered. Null until it has. */
  answeredAt: string | null;
}

export interface OrderParty {
  gstin: string;
  legalName: string;
  tradeName: string | null;
}

export interface OrderAddress {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  landmark: string | null;
  gateInstructions: string | null;
  /** Always null: `identity.org_address` has no receiving-hours column. */
  receivingHours: null;
}

export interface OrderTax {
  interState: boolean;
  igst: string;
  cgst: string;
  sgst: string;
  stateTaxLabel: 'SGST' | 'UTGST';
  ratePct: number;
  ourStateCode: string;
  placeOfSupplyStateCode: string;
  placeOfSupplyState: string;
  basis: string;
}

/**
 * The approval, when the buyer's policy required one.
 *
 * `EXPIRED` is computed on the server from `expiresAt` against its own clock,
 * not derived here: the release job runs on a schedule, and a screen that did
 * its own arithmetic would disagree with the database for as long as the job
 * lagged.
 */
export interface OrderApproval {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverName: string;
  requestedByName: string;
  requestedAt: string;
  decidedAt: string | null;
  /** ISO 8601. A deadline we imposed on ourselves, and the only one on this screen. */
  expiresAt: string;
  /** The approver's own words on a rejection. Absent renders nothing. */
  comment: string | null;
  orderValue: string;
}

export interface OrderRecord {
  orderNumber: string;
  status: string;
  paymentMode: string;
  paymentStatus: string;
  placedAt: string;
  /** The buyer's OWN reference. Null when their organisation does not use one. */
  buyerPoNumber: string | null;
  costCentre: string | null;
  subtotal: string;
  freight: string;
  gstTotal: string;
  grandTotal: string;
  tax: OrderTax;
  billedTo: OrderParty;
  billingAddress: OrderAddress;
  deliveryAddress: OrderAddress;
  unitsAllocated: number;
  dispatchGroups: DispatchGroup[];
  /** What each dispatch point said it can supply, line by line. */
  supply: SupplyLine[];
  approval: OrderApproval | null;
  /** How many machines the technician has recorded, of `unitsAllocated`. */
  unitsInspected: number;
  /** How many machines we have verified, of `unitsAllocated`. */
  unitsVerified: number;
  /** ISO 8601 when the last machine was verified. */
  verifiedAt: string | null;
  /**
   * The payment deadline, ISO 8601. Set when the last machine is verified;
   * null before, and null on credit terms. A real deadline: the order is
   * cancelled and the machines released when it passes.
   */
  payBy: string | null;
  paidAt: string | null;
  /** True exactly when the Pay button should be on screen. The server decides. */
  payable: boolean;
}

export interface PayResult {
  orderNumber: string;
  status: 'CONFIRMED';
  paymentStatus: 'PAID';
  paidAt: string;
  amount: string;
}

/** One order, scoped to the reader's organisation by the repository. */
export const getOrder = (orderNumber: string): Promise<ApiResult<OrderRecord>> =>
  call<OrderRecord>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}`, { method: 'GET' });

/** Pay for a verified order. Refused with the reason outside the 24-hour window. */
export const payOrder = (orderNumber: string): Promise<ApiResult<PayResult>> =>
  call<PayResult>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}/pay`, {
    method: 'POST',
  });
