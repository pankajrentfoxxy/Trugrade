/**
 * The browser half of the customer portal — the dashboard's figures (T19) and
 * the order board (T20), through the same-origin rewrite so the `httpOnly`
 * refresh cookie stays first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `OrderListService` (`apps/api/src/modules/ordering/internal/order-list.service.ts`),
 * exactly as `orders/[orderNumber]/api.ts` copies `OrderReadService`'s. They are
 * copied rather than imported because the storefront may not import the API —
 * and they are allow-lists on that side, which is what guarantees there is no
 * vendor identifier here to render. Nothing in this file widens them.
 *
 * Note again what has no type here, because there is no field for it: our
 * purchase order to a supply point. No buyer-reachable endpoint reads
 * `procurement.purchase_order`, so nothing on these screens could render one.
 * `buyerPoNumber` is the buyer's OWN reference, a different document belonging
 * to a different party, and it is theirs.
 */
import { call, type ApiResult } from '../register/api';

/* ==========================================================================
 * The board — T20
 * ======================================================================== */

export interface OrderListApproval {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  approverName: string;
  /** ISO 8601. A deadline we imposed on ourselves. */
  expiresAt: string;
}

export interface OrderSummary {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  placedAt: string;
  /** The buyer's OWN reference. Null when their organisation gave none. */
  buyerPoNumber: string | null;
  costCentre: string | null;
  grandTotal: string;
  unitsAllocated: number;
  deliverySiteLabel: string | null;
  deliveryCity: string | null;
  /** Why this row is in a serial search. Empty when the search was not one. */
  matchedSerials: string[];
  approval: OrderListApproval | null;
}

export interface OrderFacetOption {
  value: string;
  label: string;
  /** Under every OTHER filter applied, but not this group's own. */
  count: number;
}

export interface OrderList {
  orders: OrderSummary[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: { status: OrderFacetOption[]; site: OrderFacetOption[] };
}

/* ==========================================================================
 * The dashboard — T19
 * ======================================================================== */

export interface PendingApproval {
  orderNumber: string;
  approverName: string;
  requestedByName: string;
  requestedAt: string;
  expiresAt: string;
  orderValue: string;
  unitsHeld: number;
  /** Measured off the row, not a constant: `expiresAt - requestedAt`. */
  slaHours: number;
  breached: boolean;
}

export interface OrderDashboard {
  orders: number;
  machines: number;
  awaitingApproval: { orders: number; value: string };
  awaitingPayment: { orders: number; value: string };
  approvals: PendingApproval[];
  oldestApprovalWaitHours: number | null;
  approvalSlaHours: number | null;
}

/* ========================================================================== */

/** The dashboard's figures, scoped to the reader's organisation by the server. */
export const getDashboard = (): Promise<ApiResult<OrderDashboard>> =>
  call<OrderDashboard>('/api/buyer/orders/summary', { method: 'GET' });

/**
 * One page of the board.
 *
 * `query` is the storefront's own URL query string, passed through unchanged so
 * the address bar and the request cannot disagree. Unknown parameters are
 * dropped by the server's schema rather than filtered here — one place decides
 * what a board parameter is.
 */
export const getOrders = (query: string): Promise<ApiResult<OrderList>> =>
  call<OrderList>(`/api/buyer/orders${query ? `?${query}` : ''}`, { method: 'GET' });
