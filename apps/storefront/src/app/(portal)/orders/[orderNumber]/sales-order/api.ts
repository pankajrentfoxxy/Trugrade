/**
 * The browser half of the sales order — `GET /api/buyer/orders/:orderNumber/sales-order`.
 *
 * **Copied field for field from `OrderReadService.salesOrder`**, for the same
 * reason the order record's types are: the storefront may not import the API,
 * and an allow-list copied by hand cannot widen what the server sends. There is
 * no dispatch-point identity here beyond `Supply Point F · Noida`, and nothing
 * that reads our purchase order.
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
  /** Null until the dispatch point has answered. Renders as an absence, never a number. */
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
  /** `WAITING` until every dispatch point has answered. */
  state: 'WAITING' | 'READY' | 'CANCELLED';
  dispatchPoints: number;
  dispatchPointsAnswered: number;
  confirmedAt: string | null;
  lines: SalesOrderLine[];
  /** Null unless `READY`. Never a total of a partly answered order. */
  totals: SalesOrderTotals | null;
  payment: {
    mode: string;
    status: string;
    payable: boolean;
  };
}

export const getSalesOrder = (orderNumber: string): Promise<ApiResult<SalesOrder>> =>
  call<SalesOrder>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}/sales-order`, {
    method: 'GET',
  });
