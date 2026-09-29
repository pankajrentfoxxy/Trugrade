/**
 * The browser half of the sales order — `GET /api/buyer/orders/:orderNumber/sales-order`.
 *
 * **Copied field for field from `OrderReadService.salesOrder`**, for the same
 * reason the order record's types are: the storefront may not import the API,
 * and an allow-list copied by hand cannot widen what the server sends. There is
 * no dispatch-point identity here beyond `Supply Point F · Noida`, and nothing
 * that reads our purchase order.
 *
 * Under the order-first flow a sales order exists once every machine has been
 * named by our technician and verified by us; that is when it is priced and
 * the buyer pays. Nothing here waits on a dispatch point's answer.
 */
import { call, type ApiResult } from '../../../../register/api';
import type { OrderTax } from '../api';

export interface SalesOrderLine {
  /** `Supply Point F · Noida`. A dispatch point, never a seller. */
  label: string;
  title: string | null;
  specSummary: string | null;
  grade: string;
  qtyOrdered: number;
  /** Named and recorded by our technician at the supply point. */
  qtyInspected: number;
  /** Verified by us. */
  qtyVerified: number;
  /** The verified quantity once every machine on the order is verified; null before. */
  qtyConfirmed: number | null;
  unitPrice: string;
  gstRatePct: number;
  /** `qtyConfirmed × unitPrice`, before GST. Null until answered. */
  lineNet: string | null;
  lineGst: string | null;
  lineTotal: string | null;
}

export interface SalesOrderTotals {
  subtotal: string;
  freight: string;
  tax: OrderTax;
  grandTotal: string;
}

export interface SalesOrder {
  orderNumber: string;
  /** `WAITING` until every machine is verified; `READY` from then on, paid or not. */
  state: 'WAITING' | 'READY' | 'CANCELLED';
  stage: 'INSPECTION' | 'VERIFICATION' | 'PAYMENT' | 'PAID' | 'CANCELLED';
  machines: { ordered: number; inspected: number; verified: number };
  dispatchPoints: number;
  /** When the last machine was verified. Null before. */
  verifiedAt: string | null;
  /** The payment deadline set at verification; null before, and on credit terms. */
  payBy: string | null;
  paidAt: string | null;
  lines: SalesOrderLine[];
  /** Null unless `READY`. Never a total of a partly verified order. */
  totals: SalesOrderTotals | null;
  payment: {
    mode: string;
    status: string;
    /** True exactly when the Pay button belongs on the screen. The server decides. */
    payable: boolean;
  };
}

export const getSalesOrder = (orderNumber: string): Promise<ApiResult<SalesOrder>> =>
  call<SalesOrder>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}/sales-order`, {
    method: 'GET',
  });
