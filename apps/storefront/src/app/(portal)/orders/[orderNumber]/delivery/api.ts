/**
 * The browser half of the buyer's seal check at handover — T24, through the
 * same-origin rewrite so the `httpOnly` refresh cookie stays first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `DeliveryCheckService`
 * (`apps/api/src/modules/ordering/internal/delivery-check.service.ts`) and
 * `ReturnsService` (`apps/api/src/modules/platform/internal/returns.service.ts`).
 * They are copied rather than imported because the storefront may not import the
 * API — and they are allow-lists on that side, which is what guarantees there is
 * no vendor identifier here to render. Nothing in this file widens them.
 *
 * **Every deadline arrives decided.** `window.open` and `window.hoursRemaining`
 * are fields, not a subtraction this file does. A laptop clock two days fast
 * must not be able to tell a buyer their 48 hours are up, and one two days slow
 * must not promise a remedy that has expired. The countdown below re-renders
 * from the server's `hoursRemaining` and never recomputes it from `closesAt`.
 *
 * There is no `sub_order`, no `vendorOrgId` and no supplier name anywhere in
 * these shapes. A consignment is addressed by its position — `Delivery 2 of 3` —
 * because the internal grouping number carries the word this product never says
 * to a buyer.
 */
import { call, type ApiResult } from '../../../../register/api';

/** The four things a DeviceSure run can conclude. */
export type QcVerdict = 'PASS' | 'PASS_WITH_NOTE' | 'MISMATCH' | 'FAIL';

/** What the person at the door can report. */
export type SealOutcome = 'INTACT' | 'BROKEN' | 'MISSING';

export interface DeliverySeal {
  code: string;
  /** `APPLIED` | `INTACT` | `BROKEN` | `MISSING` | `REPLACED` | `NOT_APPLIED`. */
  status: string;
}

export interface DeliveryMachine {
  serialNumber: string;
  /** Null when the SKU has been withdrawn since. Never an invented title. */
  title: string | null;
  specSummary: string | null;
  /** Null means NO SEAL IS RECORDED. It is never rendered as one that passed. */
  seal: DeliverySeal | null;
  verdict: QcVerdict | null;
  passportPath: string;
  /** Null when this machine is ready to be accepted; otherwise the reason. */
  blockedReason: string | null;
}

export interface DeliveryWindow {
  /** ISO 8601 — the exact instant, because the refusal states it. */
  closesAt: string;
  /** The server's verdict. Never `closesAt` minus the browser's idea of now. */
  open: boolean;
  hoursRemaining: number;
}

export interface DeliveryConsignment {
  /** 1-based. The only handle a buyer gets on a consignment. */
  index: number;
  /** `Delivery 1 of 3 · Supply Point A · Gurugram`. Never a seller. */
  label: string;
  status: string;
  /** ISO 8601, or null when it has not arrived. Null is not "today". */
  deliveredAt: string | null;
  window: DeliveryWindow | null;
  machines: DeliveryMachine[];
  receiptConfirmedAt: string | null;
  /** Null when receipt can be confirmed; otherwise why not, naming the machines. */
  blockedReason: string | null;
}

export interface DeliveryView {
  orderNumber: string;
  status: string;
  /** The server's own instant, so the page can say what it reckoned against. */
  asOf: string;
  /** Null when `ordering.inspection_window_hours` is unset — then no window is drawn. */
  windowHours: number | null;
  consignments: DeliveryConsignment[];
}

export interface SealCheckResult {
  sealCode: string;
  serialNumber: string;
  status: string;
  /** The discrepancy this check opened, when it opened one. */
  returnNumber: string | null;
  delivery: DeliveryView;
}

/** The delivery manifest, scoped to the reader's organisation by the API. */
export const getDelivery = (orderNumber: string): Promise<ApiResult<DeliveryView>> =>
  call<DeliveryView>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}/delivery`, {
    method: 'GET',
  });

/**
 * Say what was found on one seal.
 *
 * A code that is not on this delivery comes back 422 with the sentence the
 * screen must show verbatim: *"Seal 88-041992 is not on this delivery. Do not
 * accept this machine."* That is the one refusal on this screen that is a safety
 * instruction rather than a validation message, and it is never summarised.
 */
export const checkSeal = (
  orderNumber: string,
  body: { sealCode: string; outcome: SealOutcome; note?: string },
): Promise<ApiResult<SealCheckResult>> =>
  call<SealCheckResult>(
    `/api/buyer/orders/${encodeURIComponent(orderNumber)}/delivery/seal-checks`,
    { method: 'POST', body: JSON.stringify(body) },
  );

/** Sign for one delivery. Refused while any seal on it is unchecked or broken. */
export const confirmReceipt = (
  orderNumber: string,
  deliveryIndex: number,
): Promise<ApiResult<DeliveryView>> =>
  call<DeliveryView>(
    `/api/buyer/orders/${encodeURIComponent(orderNumber)}/delivery/${deliveryIndex}/receipt`,
    { method: 'POST' },
  );
