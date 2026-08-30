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
import { call, type ApiResult } from '../../register/api';

/** `A_PLUS` | `A` | `B`, as the grade enum spells it. */
export interface OrderedMachine {
  serialNumber: string;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  grade: string;
  unitPrice: string;
}

export interface DispatchGroup {
  /** `Supply Point F · Noida`. A dispatch point, never a seller. */
  label: string;
  machines: OrderedMachine[];
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
  approval: OrderApproval | null;
}

/** One order, scoped to the reader's organisation by the repository. */
export const getOrder = (orderNumber: string): Promise<ApiResult<OrderRecord>> =>
  call<OrderRecord>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}`, { method: 'GET' });
