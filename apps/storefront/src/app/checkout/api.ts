/**
 * The browser half of checkout — `/api/buyer/checkout`, through the same-origin
 * rewrite so the `httpOnly` refresh cookie stays first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `CheckoutService`
 * (`apps/api/src/modules/ordering/internal/checkout.service.ts`). They are
 * copied rather than imported because the storefront may not import the API —
 * and they are allow-lists on that side, which is what guarantees there is no
 * vendor identifier here to render. Nothing in this file widens them.
 *
 * Two shapes carry a `null` that must never be rendered as a zero:
 * `BreakUp.freight` and `BreakUp.grandTotal` are null when a delivery lane could
 * not be priced, and the screen says which it is.
 */
import { call, type ApiResult } from '../register/api';

export interface CheckoutLine {
  offerId: string;
  title: string;
  specSummary: string;
  /** `A_PLUS` | `A` | `B`, as the grade enum spells it. */
  grade: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
  /** `Supply Point A · Gurugram`. A dispatch point, never a seller. */
  dispatchPoint: string;
  /** The exact machines held for this buyer. */
  serials: string[];
}

export interface GstProfile {
  id: string;
  gstin: string;
  legalName: string;
  tradeName: string | null;
  stateCode: string;
  registrationType: string;
  isPrimary: boolean;
}

export interface DeliverySite {
  id: string;
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
  /**
   * Always null: `identity.org_address` has no receiving-hours column. The
   * screen renders "Not recorded" rather than a window nobody entered.
   */
  receivingHours: null;
  isDefault: boolean;
}

export type PaymentMode = 'PREPAID' | 'PARTIAL_ADVANCE' | 'CREDIT';

export interface PaymentModeOption {
  mode: PaymentMode;
  label: string;
  allowed: boolean;
  /** Present only when `allowed` is false. A disabled control must say why. */
  reason: string | null;
}

export interface TaxSplit {
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

export interface BreakUp {
  goods: string;
  /** Null when the lane could not be priced. Never a zero standing in for one. */
  freight: string | null;
  freightUnpricedReason: string | null;
  taxableValue: string;
  gstTotal: string;
  grandTotal: string | null;
  tax: TaxSplit;
}

export interface CheckoutSession {
  cartId: string;
  cartName: string;
  /** ISO 8601. The countdown reads this and nothing else. */
  holdExpiresAt: string;
  unitsHeld: number;
  lines: CheckoutLine[];
  gstProfiles: GstProfile[];
  billingAddresses: DeliverySite[];
  deliverySites: DeliverySite[];
  paymentModes: PaymentModeOption[];
  poRequired: boolean;
  selection: {
    gstProfileId: string | null;
    billingAddressId: string | null;
    deliveryAddressId: string | null;
    paymentMode: string | null;
  };
  breakUp: BreakUp | null;
  approval: { required: true; approverName: string; reason: string } | null;
}

export interface OrderConfirmation {
  orderId: string;
  orderNumber: string;
  status: string;
  placedAt: string;
  holdExpiresAt: string;
  subtotal: string;
  freight: string;
  gstTotal: string;
  grandTotal: string;
  tax: TaxSplit;
  serials: Array<{ serialNumber: string; dispatchPoint: string }>;
  next: string;
}

export interface ConfirmBody {
  gstProfileId: string;
  billingAddressId: string;
  deliveryAddressId: string;
  paymentMode: PaymentMode;
  buyerPoNumber?: string;
  costCentre?: string;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Enter checkout. Takes the twenty-minute hold; every refusal happens first. */
export const startCheckout = (cartId: string): Promise<ApiResult<CheckoutSession>> =>
  call<CheckoutSession>('/api/buyer/checkout', json('POST', { cartId }));

/**
 * Re-quote after a step. Does NOT renew the hold — a deadline a buyer can
 * refresh away is not a deadline, and the machines belong to everyone else
 * again at the time we said they would.
 */
export const quoteCheckout = (
  cartId: string,
  selection: Partial<{
    gstProfileId: string;
    billingAddressId: string;
    deliveryAddressId: string;
    paymentMode: string;
  }>,
): Promise<ApiResult<CheckoutSession>> => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(selection)) if (v) params.set(k, v);
  const query = params.toString();
  return call<CheckoutSession>(
    `/api/buyer/checkout/${cartId}${query ? `?${query}` : ''}`,
    json('GET'),
  );
};

/** The sixteen-step transaction. One of three outcomes, never a partial one. */
export const confirmCheckout = (
  cartId: string,
  body: ConfirmBody,
): Promise<ApiResult<OrderConfirmation>> =>
  call<OrderConfirmation>(`/api/buyer/checkout/${cartId}/confirm`, json('POST', body));

/** The buyer left. Put the machines back on sale now rather than in 20 minutes. */
export const abandonCheckout = (cartId: string): Promise<ApiResult<{ released: number }>> =>
  call<{ released: number }>(`/api/buyer/checkout/${cartId}`, json('DELETE'));
