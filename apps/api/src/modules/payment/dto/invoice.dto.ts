/**
 * The `payment` module's public shapes — T22.
 *
 * Two contracts live here and they point in opposite directions.
 *
 * **`OrderBillingBasis` is the input.** `ordering` owns the order, so it is the
 * only module that may read it; `payment` owns the invoice, so it is the only
 * module that may issue one. The basis is what crosses between them. It is
 * deliberately a *value*, not a query handle: `payment` cannot reach back into
 * `ordering."order"` to fetch anything it was not given, which is what keeps the
 * seam real rather than decorative.
 *
 * **`OrderDocumentRow` is the output**, and it is an allow-list built field by
 * field. Under the merchant-of-record model the invoice a buyer sees is OURS to
 * them; the vendor's invoice to us is a different document that is not
 * buyer-reachable. Neither this type nor anything reachable from it has a field
 * a vendor identifier could travel in — there is no supplier name, no GSTIN but
 * ours and the buyer's, no `org_id`, and the dispatch point is the anonymised
 * `Supply Point A · Gurugram` label and nothing finer.
 *
 * **A document that does not exist yet is a row, not an absence.** That is the
 * whole point of `status: 'AWAITED'` carrying `whenItWillExist`: an e-way bill
 * genuinely is generated at pickup, and a screen that drew a blank there — or
 * worse, a dead download button — would be the same defect as a missing
 * measurement rendered as a tick.
 */

/** REGULAR: 18% on full value. MARGIN: Rule 32(5), tax on (sale − purchase). */
export type ValuationMethod = 'REGULAR' | 'MARGIN';

/** A GST-registered party on an invoice. Ours or the buyer's — never a vendor's. */
export interface BillingParty {
  gstin: string;
  legalName: string;
  tradeName: string | null;
  stateCode: string;
}

export interface BillingAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  contactName: string;
  contactMobile: string;
}

/**
 * One line of one consignment.
 *
 * `purchasePrice` is our cost and is here only because
 * `chk_margin_line_complete` requires it stored on a MARGIN line. **It is never
 * printed and never returned to a buyer.** It leaves this object at the INSERT
 * and nowhere else.
 */
export interface BillingLine {
  skuId: string | null;
  /** "Dell Latitude 5320 · Grade A+". Catalog terms only. */
  description: string;
  hsn: string;
  qty: number;
  unitPrice: string;
  gstRatePct: number;
  serialNumbers: readonly string[];
  valuationMethod: ValuationMethod;
  /** Rule 32(5) needs it per serial. REGULAR lines pass null. */
  purchasePrice: string | null;
}

/**
 * The machines leaving one supply point together.
 *
 * One consignment is one tax invoice and one e-way bill, because Rule 138 binds
 * an e-way bill to a consignment and `payment.eway_bill.invoice_id` is UNIQUE.
 * Folding a three-warehouse order into a single invoice would make two of its
 * three consignments un-billable.
 */
export interface BillingConsignment {
  subOrderId: string;
  /** `Supply Point A · Gurugram`. A dispatch point, never a seller. */
  dispatchLabel: string;
  freight: string;
  /**
   * Whether the goods have left the supply point.
   *
   * s.31(1)(a) CGST Act: a tax invoice for goods is issued **before or at the
   * time of removal**. Not at payment, not at order. This flag is the trigger,
   * and it is `ordering`'s to compute because `ordering` owns the status.
   */
  removed: boolean;
  lines: readonly BillingLine[];
}

export interface OrderBillingBasis {
  orderId: string;
  orderNumber: string;
  buyerOrgId: string;
  placedAt: Date;
  /** No proforma and no tax invoice for an order nobody has committed to. */
  confirmed: boolean;
  cancelled: boolean;
  /** The buyer's OWN reference. Prints on our invoice; null when none was given. */
  buyerPoNumber: string | null;
  costCentre: string | null;
  billedTo: BillingParty;
  billingAddress: BillingAddress;
  /** Place of supply under s.10(1)(a) is where the movement terminates. */
  deliveryAddress: BillingAddress;
  consignments: readonly BillingConsignment[];
}

/* ==========================================================================
 * What the buyer sees
 * ======================================================================== */

export type DocumentKind =
  | 'PROFORMA'
  | 'TAX_INVOICE'
  | 'EWAY_BILL'
  | 'QC_REPORTS'
  | 'WIPE_CERTIFICATES'
  | 'DELIVERY_POD'
  | 'CREDIT_NOTE';

/**
 * `AWAITED` is not an error and it is not a failure — it is a document whose
 * moment has not arrived. It carries `whenItWillExist` and it never carries a
 * download, because a control that leads nowhere tells a buyer something is
 * there.
 *
 * `ELSEWHERE` is a document that exists but is not this screen's to serve — the
 * per-machine QC report lives on each machine's passport. It carries a link to
 * where it actually is rather than a copy of it.
 */
export type DocumentStatus = 'ISSUED' | 'AWAITED' | 'ELSEWHERE' | 'NOT_APPLICABLE';

export interface OrderDocumentRow {
  /** `proforma`, an invoice uuid, or a stable synthetic key for an awaited row. */
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  /** "Tax invoice · Supply Point A · Gurugram". Never a vendor. */
  title: string;
  /** What the document IS, in the buyer's words. Always present. */
  description: string;
  /**
   * When it will exist, for an `AWAITED` row — "E-way bill is generated at
   * pickup". Null on a row that exists, because a document in hand does not
   * need a promise attached to it.
   */
  whenItWillExist: string | null;
  /** The statutory number, once there is one. Mono on screen. */
  documentNumber: string | null;
  /** `YYYY-MM-DD` on the Asia/Kolkata calendar. */
  issuedOn: string | null;
  /** Invoice total, as a decimal string. Null when there is nothing to total. */
  amount: string | null;
  valuationMethod: ValuationMethod | null;
  /**
   * The path on THIS API that mints a short-lived signed URL and redirects to
   * it, writing the `audit_log` row on the way. Null unless the document
   * genuinely exists — never a disabled button.
   */
  downloadPath: string | null;
  /** Where the document actually lives, for an `ELSEWHERE` row. A storefront path. */
  elsewherePath: string | null;
}

export interface OrderDocumentsView {
  orderNumber: string;
  /** Counts, so the screen can state a denominator rather than a bare number. */
  issuedCount: number;
  documentCount: number;
  documents: readonly OrderDocumentRow[];
}

/** What `issueTaxInvoices` did. Reported to the caller and to the audit log. */
export interface IssuedInvoice {
  invoiceId: string;
  subOrderId: string;
  invoiceNumber: string;
  total: string;
  valuationMethod: ValuationMethod;
}
