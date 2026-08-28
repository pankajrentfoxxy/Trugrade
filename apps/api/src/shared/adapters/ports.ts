/**
 * Every external integration sits behind one of these, with a `Fake` from day one.
 *
 * This is not tidiness. Third-party onboarding lead times are the most common
 * cause of a missed date on a project like this — Blue Dart's credentials are
 * review-gated, DTDC has no self-service path at all, SMS DLT registration and
 * WhatsApp Business API are measured in weeks. The mocks mean nothing blocks.
 *
 * 02_ARCHITECTURE.md §1.4, 04_TEST_PLAN.md §1.4.3.
 *
 * Two rules hold across all of them:
 *   1. A provider being down is `ProviderError`, never a business `FAIL`. In
 *      Indian KYC that distinction is the difference between "we'll retry, do
 *      nothing" and "re-upload your documents", and conflating them is the most
 *      common onboarding-UX failure there is.
 *   2. Nothing in a port's vocabulary is a carrier's or a gateway's. The canonical
 *      model is ours; the adapter maps into it.
 */

import type { Money } from '@trugrade/contracts';

/** What every verification call resolves to. Written to `kyc.verification_check`. */
export type VerificationOutcome = 'PASS' | 'FAIL' | 'MISMATCH' | 'PROVIDER_ERROR' | 'TIMEOUT';

export interface VerificationResult<T> {
  outcome: VerificationOutcome;
  data?: T;
  /** Fuzzy name-match score where the check compares two names. VR-026. */
  matchScore?: number;
  /** Shown verbatim to the applicant. Specific, never "Validation failed". */
  reason?: string;
  provider: string;
  latencyMs: number;
  costPaise: number;
  /** Whatever the provider actually returned, retained for a later dispute. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// KYC and statutory verification
// ---------------------------------------------------------------------------

export interface GstinTaxpayer {
  gstin: string;
  legalName: string;
  tradeName?: string;
  status: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'PROVISIONAL';
  stateCode: string;
  registrationDate?: string;
  taxpayerType?: string;
  principalAddress?: string;
}

export abstract class GstinVerificationPort {
  abstract verify(
    gstin: string,
    expectedLegalName?: string,
  ): Promise<VerificationResult<GstinTaxpayer>>;
}

export interface PanHolder {
  pan: string;
  name: string;
  status: 'VALID' | 'INVALID' | 'INACTIVE';
  holderType: string;
}

export abstract class PanVerificationPort {
  abstract verify(pan: string, expectedName?: string): Promise<VerificationResult<PanHolder>>;
}

export interface BankAccountHolder {
  accountNumber: string;
  ifsc: string;
  /** The name the bank holds. Compared against the legal name — VR-026. */
  beneficiaryName: string;
  bankName: string;
  branch: string;
  creditReference?: string;
}

export abstract class BankVerificationPort {
  /** ₹1 penny-drop. Returns the beneficiary name the bank has on file. */
  abstract pennyDrop(
    accountNumber: string,
    ifsc: string,
    expectedName: string,
  ): Promise<VerificationResult<BankAccountHolder>>;
  abstract lookupIfsc(
    ifsc: string,
  ): Promise<VerificationResult<{ bank: string; branch: string; city: string }>>;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationChannel = 'SMS' | 'EMAIL' | 'WHATSAPP' | 'PUSH';

export interface NotificationRequest {
  channel: NotificationChannel;
  to: string;
  /** DLT-registered template id for SMS; Meta template name for WhatsApp. */
  templateCode: string;
  locale: 'en' | 'hi';
  variables: Record<string, string>;
  /**
   * Transactional messages ignore the recipient's marketing preferences;
   * marketing and digests respect them. PHASE_01 Task 7.
   */
  isTransactional: boolean;
}

export interface NotificationReceipt {
  providerMessageId: string;
  accepted: boolean;
  reason?: string;
}

export abstract class NotificationPort {
  abstract send(req: NotificationRequest): Promise<NotificationReceipt>;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface PaymentIntent {
  gatewayOrderId: string;
  amount: Money;
  currency: 'INR';
  /** Handed to the browser SDK. Never a card number — we never see one. */
  checkoutToken: string;
}

export interface PaymentCapture {
  gatewayPaymentId: string;
  gatewayOrderId: string;
  amount: Money;
  method: 'CARD' | 'UPI' | 'NETBANKING' | 'WALLET';
  status: 'CAPTURED' | 'AUTHORIZED' | 'FAILED' | 'PENDING';
  /** The bank's own decline reason, shown verbatim — never "Something went wrong". */
  failureReason?: string;
}

export abstract class PaymentGatewayPort {
  abstract createIntent(input: {
    amount: Money;
    orderId: string;
    buyerOrgId: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent>;
  abstract fetchPayment(gatewayPaymentId: string): Promise<PaymentCapture>;
  abstract refund(input: {
    gatewayPaymentId: string;
    amount: Money;
    idempotencyKey: string;
  }): Promise<{ gatewayRefundId: string; status: 'PROCESSED' | 'PENDING' | 'FAILED' }>;
  /** Signature check on every webhook. An unverified webhook is an open endpoint. */
  abstract verifyWebhookSignature(body: string, signature: string): boolean;
}

export interface VirtualAccount {
  virtualAccountId: string;
  accountNumber: string;
  ifsc: string;
  /** TPV: only the buyer's own verified account may pay in. */
  allowedPayerAccounts: string[];
}

export abstract class VirtualAccountPort {
  abstract create(input: {
    buyerOrgId: string;
    legalName: string;
    allowedPayerAccount: { accountNumber: string; ifsc: string };
  }): Promise<VirtualAccount>;
  abstract close(virtualAccountId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tax documents
// ---------------------------------------------------------------------------

export interface EwayBillRequest {
  /** Case 2 always: we generate, on our invoice, at our price. */
  billFromGstin: string;
  billFromStateCode: string;
  /** The vendor's facility. Lawfully on the document; their *price* never is. */
  dispatchFromAddress: { line1: string; city: string; stateCode: string; pincode: string };
  billToGstin: string;
  billToStateCode: string;
  shipToAddress: { line1: string; city: string; stateCode: string; pincode: string };
  documentNumber: string;
  documentDate: string;
  documentValue: Money;
  hsnCode: string;
  transportDistanceKm: number;
  vehicleNumber?: string;
}

export interface EwayBillResult {
  ewbNumber: string;
  validUntil: string;
  generatedAt: string;
}

export abstract class EwayBillPort {
  abstract generate(req: EwayBillRequest): Promise<EwayBillResult>;
  abstract updatePartB(ewbNumber: string, vehicleNumber: string): Promise<void>;
  abstract cancel(ewbNumber: string, reason: string): Promise<void>;
}

export abstract class EInvoicePort {
  abstract generateIrn(payload: Record<string, unknown>): Promise<{
    irn: string;
    ackNo: string;
    ackDate: string;
    signedQr: string;
  }>;
  abstract cancelIrn(irn: string, reason: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Logistics — one canonical model, five adapters. Never let a carrier's
// vocabulary leak upward (02 §5.1).
// ---------------------------------------------------------------------------

export interface ShipFromLocation {
  name: string;
  line1: string;
  city: string;
  stateCode: string;
  pincode: string;
  phone: string;
  gstin?: string;
}

export interface Consignee {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  stateCode: string;
  pincode: string;
  phone: string;
  gstin?: string;
}

export interface Package {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  declaredValue: Money;
  hsnCode: string;
  description: string;
}

export interface CreateShipmentInput {
  referenceId: string;
  /** Idempotency is mandatory: a timeout after the carrier accepted must not
   *  produce a second label and a second billed shipment. */
  idempotencyKey: string;
  shipFrom: ShipFromLocation;
  consignee: Consignee;
  packages: Package[];
  serviceCode: string;
  ewayBillNumber?: string;
  sellerGstin: string;
}

export interface ShipmentResult {
  awb: string;
  carrierShipmentId: string;
  labelUrl?: string;
  estimatedDeliveryDate?: string;
}

export type TrackingMilestone =
  | 'MANIFESTED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'REACHED_DESTINATION_HUB'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED_ATTEMPT'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED'
  | 'LOST'
  | 'DAMAGED';

export interface TrackingEvent {
  milestone: TrackingMilestone;
  /**
   * The carrier's own status code, retained alongside the normalised milestone.
   * Delhivery's NDR API keys off raw codes (EOD-74, ST-108...) to decide which
   * actions are even *legal*, so a normalisation that discards them silently
   * breaks NDR handling.
   */
  rawStatusCode: string;
  rawStatusText: string;
  occurredAt: string;
  location?: string;
  /** Carrier scans arrive out of order and duplicated. This is how we dedupe. */
  eventFingerprint: string;
}

export interface ServiceabilityResult {
  serviceable: boolean;
  /** Out-of-delivery-area pincodes attract a surcharge that must reach the
   *  landed price rather than being absorbed silently. */
  isOda: boolean;
  estimatedDays?: number;
  services: string[];
}

export type NdrAction = 'REATTEMPT' | 'DEFER' | 'EDIT_ADDRESS' | 'EDIT_PHONE' | 'RTO';

export abstract class CarrierPort {
  abstract readonly code: string;
  abstract createShipment(input: CreateShipmentInput): Promise<ShipmentResult>;
  abstract cancelShipment(awb: string, reason: string): Promise<void>;
  abstract track(awb: string): Promise<TrackingEvent[]>;
  abstract checkServiceability(
    fromPincode: string,
    toPincode: string,
    weightGrams: number,
  ): Promise<ServiceabilityResult>;
  /**
   * Which NDR actions the carrier will actually accept for this raw status code.
   * Asking first is what stops us firing an action the carrier rejects and
   * burning hours of a 36-hour response window.
   */
  abstract legalNdrActions(rawStatusCode: string): NdrAction[];
  abstract submitNdrAction(
    awb: string,
    action: NdrAction,
    detail?: Record<string, string>,
  ): Promise<{ requestId: string }>;
}

// ---------------------------------------------------------------------------
// Object storage
// ---------------------------------------------------------------------------

export abstract class ObjectStorePort {
  abstract presignUpload(
    key: string,
    contentType: string,
    maxBytes: number,
  ): Promise<{ url: string; fields?: Record<string, string> }>;
  /**
   * A URL a browser can fetch. It is not required to be a provider presign, and
   * for this platform it deliberately is not: a presigned URL publishes the
   * object key, and our keys carry vendor identifiers. See `ObjectUrlSigner`.
   */
  abstract presignDownload(key: string, ttlSeconds: number): Promise<string>;
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  /**
   * The type the object was stored with — S3's `Content-Type`, not a guess from
   * the key. Whatever serves these bytes to a browser has to state it, and a
   * key is a path, not a promise about its contents.
   */
  abstract contentType(key: string): Promise<string>;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// DeviceSure — the QC platform. 07_DEVICESURE_INTEGRATION.md §5.
// ---------------------------------------------------------------------------

export interface QcSessionRequest {
  externalRef: string;
  organizationId: string;
  mode: 'BASIC' | 'FULL';
  /** Without this the mismatch engine has nothing to compare against. */
  declaredSpec: {
    skuCode: string;
    ramGb: number;
    storageGb: number;
    storageType: string;
    cpuModel: string;
    screenSizeIn: number;
    declaredGrade: string;
    serialNumber: string;
  };
  sealCodeRange: [string, string];
}

export abstract class QcPlatformPort {
  abstract createSession(req: QcSessionRequest): Promise<{ sessionId: string }>;
  /** Vendor suspension revokes their licence and their agents stop certifying. */
  abstract issueVendorLicence(input: {
    organizationId: string;
    maxAgents: number;
    features: string[];
  }): Promise<{ licenceKey: string }>;
  abstract revokeVendorLicence(organizationId: string, reason: string): Promise<void>;
  /** The public key the certificate signature is verified against, fetched from
   *  a stable URL rather than by asking DeviceSure whether it is telling the truth. */
  abstract fetchPublicKey(keyId: string): Promise<string>;
}
