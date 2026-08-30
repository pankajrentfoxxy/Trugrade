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
import type { OrderRecord } from './orders/[orderNumber]/api';

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

/* ==========================================================================
 * Approvals — T25
 *
 * The types below are `ApprovalService`'s response types
 * (`apps/api/src/modules/ordering/internal/approval.service.ts`), copied field
 * for field like every other block in this file. `OrderRecord` is the order
 * half, and it is the SAME shape `orders/[orderNumber]/api.ts` already
 * declares — imported from there rather than restated, because two definitions
 * of one order is how two screens start disagreeing about its money.
 * ======================================================================== */

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface ApprovalRow {
  id: string;
  orderNumber: string;
  /** `PENDING` past `expiresAt` arrives as `EXPIRED`. The server decides, never the browser. */
  status: ApprovalStatus;
  orderValue: string;
  requestedByName: string;
  approverName: string;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  comment: string | null;
  unitsHeld: number;
  /** Measured off the row, not the column default. */
  slaHours: number;
  decidable: boolean;
  blockedReason: string | null;
}

export interface ApprovalInbox {
  approvals: ApprovalRow[];
  total: number;
  page: number;
  per: number;
  pages: number;
  facets: Array<{ value: string; label: string; count: number }>;
  waitingOnYou: number;
}

export interface ApprovalRecord {
  approval: ApprovalRow;
  /** The clause that fired, in words. Null when the policy has since gone. */
  policyRule: string | null;
  order: OrderRecord;
}

export interface ApprovalDecision {
  approval: ApprovalRow;
  orderStatus: 'CONFIRMED' | 'PAYMENT_PENDING' | 'CANCELLED';
  units: number;
}

export const getApprovals = (query: string): Promise<ApiResult<ApprovalInbox>> =>
  call<ApprovalInbox>(`/api/buyer/approvals${query ? `?${query}` : ''}`, { method: 'GET' });

export const getApproval = (id: string): Promise<ApiResult<ApprovalRecord>> =>
  call<ApprovalRecord>(`/api/buyer/approvals/${id}`, { method: 'GET' });

/**
 * Approve or reject. The comment is the approver's own words and is sent
 * unaltered — the requester reads exactly this string on their order screen.
 */
export const decideApproval = (
  id: string,
  body: { decision: 'APPROVE' | 'REJECT'; comment?: string },
): Promise<ApiResult<ApprovalDecision>> =>
  call<ApprovalDecision>(`/api/buyer/approvals/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ==========================================================================
 * Addresses and team — T25
 *
 * `AccountService`'s response types
 * (`apps/api/src/modules/identity/internal/account.service.ts`), copied.
 * ======================================================================== */

export interface OrgAddress {
  id: string;
  type: 'REGISTERED' | 'BILLING' | 'SHIPPING' | 'PICKUP' | 'HUB';
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
  /** Always null — there is no column. Rendered as not recorded, never as hours. */
  receivingHours: null;
  isDefault: boolean;
  isBillingEnabled: boolean;
  isActive: boolean;
  verifiedAt: string | null;
  editable: boolean;
  lockedReason: string | null;
}

export interface AddressBook {
  delivery: OrgAddress[];
  billing: OrgAddress[];
}

export interface NewAddress {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
  landmark?: string | null;
  gateInstructions?: string | null;
  isDefault?: boolean;
}

export interface TeamRole {
  code: string;
  description: string | null;
  permissions: string[];
  /** False when the reader does not hold everything the role grants. */
  assignable: boolean;
}

export interface TeamMember {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  jobTitle: string | null;
  department: string | null;
  status: string;
  isOrgOwner: boolean;
  roles: string[];
  mfaEnabled: boolean;
  /** Null means never signed in. Never drawn as a date. */
  lastLoginAt: string | null;
  isYou: boolean;
  lockedReason: string | null;
}

export interface Team {
  members: TeamMember[];
  roles: TeamRole[];
  owners: number;
}

export const getAddresses = (): Promise<ApiResult<AddressBook>> =>
  call<AddressBook>('/api/account/addresses', { method: 'GET' });

export const addAddress = (body: NewAddress): Promise<ApiResult<OrgAddress>> =>
  call<OrgAddress>('/api/account/addresses', { method: 'POST', body: JSON.stringify(body) });

export const updateAddress = (
  id: string,
  body: Partial<NewAddress> & { isActive?: boolean },
): Promise<ApiResult<OrgAddress>> =>
  call<OrgAddress>(`/api/account/addresses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const getTeam = (): Promise<ApiResult<Team>> =>
  call<Team>('/api/account/team', { method: 'GET' });

export const updateMember = (
  userId: string,
  body: { roles?: string[]; status?: 'ACTIVE' | 'SUSPENDED' },
): Promise<ApiResult<TeamMember>> =>
  call<TeamMember>(`/api/account/team/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
