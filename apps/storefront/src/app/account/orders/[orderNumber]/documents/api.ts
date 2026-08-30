/**
 * The browser half of one order's documents — `GET /api/buyer/orders/:orderNumber/documents`,
 * through the same-origin rewrite so the `httpOnly` refresh cookie stays
 * first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `payment/dto/invoice.dto.ts`. They are copied rather than imported
 * because the storefront may not import the API — and they are allow-lists on
 * that side, which is what guarantees there is no vendor identifier here to
 * render. Nothing in this file widens them.
 *
 * Note what has no type here, because there is no field for it: our purchase
 * price. `payment.invoice_line.purchase_price` is stored, because Rule 32(5)
 * requires a margin line to show its working to us, and it is on no
 * buyer-reachable payload and in no rendered PDF.
 *
 * `downloadPath` is nullable and stays nullable. A document that has not been
 * issued has no path, and a `?? '#'` here would put a dead control on the screen
 * — which is the same defect as a missing measurement drawn as a tick.
 */
import { call, type ApiResult } from '../../../../register/api';

export type DocumentKind =
  | 'PROFORMA'
  | 'TAX_INVOICE'
  | 'EWAY_BILL'
  | 'QC_REPORTS'
  | 'WIPE_CERTIFICATES'
  | 'DELIVERY_POD'
  | 'CREDIT_NOTE';

/**
 * `AWAITED` is a document whose moment has not arrived, and it always carries
 * `whenItWillExist`. `ELSEWHERE` exists but lives on another screen — the QC
 * report belongs to a serial, not to an order.
 */
export type DocumentStatus = 'ISSUED' | 'AWAITED' | 'ELSEWHERE' | 'NOT_APPLICABLE';

export interface OrderDocument {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  /** "Tax invoice · Supply Point A · Gurugram". A dispatch point, never a seller. */
  title: string;
  description: string;
  /** Present exactly when the document is not. Never rendered as a blank. */
  whenItWillExist: string | null;
  documentNumber: string | null;
  /** `YYYY-MM-DD`, Asia/Kolkata. */
  issuedOn: string | null;
  /** A decimal string. Parsed as `Money`, never as a float. */
  amount: string | null;
  valuationMethod: 'REGULAR' | 'MARGIN' | null;
  /** Null unless the document exists. The API mints the signed URL and redirects. */
  downloadPath: string | null;
  elsewherePath: string | null;
}

export interface OrderDocuments {
  orderNumber: string;
  issuedCount: number;
  documentCount: number;
  documents: OrderDocument[];
}

/** One order's documents, scoped to the reader's organisation by the API. */
export const getOrderDocuments = (orderNumber: string): Promise<ApiResult<OrderDocuments>> =>
  call<OrderDocuments>(`/api/buyer/orders/${encodeURIComponent(orderNumber)}/documents`, {
    method: 'GET',
  });
