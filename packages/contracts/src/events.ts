/**
 * The domain event catalogue — a discriminated union, exhaustively typed.
 *
 * These names are deliberately the names a real queue would use later
 * (02_ARCHITECTURE.md §1.1 rule 3). When `qc` is extracted into its own service the
 * event names do not change; only the transport does.
 *
 * Payloads carry ids, never entities. A subscriber that needs the entity asks the
 * owning module's service for it — otherwise the payload becomes a second, stale
 * copy of another module's schema and the seam quietly stops meaning anything.
 */

import { z } from 'zod';

export const eventEnvelopeSchema = z.object({
  /** Stable id, so a subscriber can dedupe across a retry or a replay. */
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  /** W3C trace parent, so a cross-module flow is one trace end to end. */
  traceId: z.string().optional(),
  /** Who caused it. Null for scheduled jobs. */
  actorUserId: z.string().uuid().nullable().optional(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

// --- identity / kyc ---------------------------------------------------------

export const vendorVerifiedPayload = z.object({
  orgId: z.string().uuid(),
  verifiedBy: z.string().uuid(),
  supplyPointCodesByCity: z.record(z.string(), z.string()).optional(),
});

export const buyerVerifiedPayload = z.object({
  orgId: z.string().uuid(),
  verifiedBy: z.string().uuid(),
});

/**
 * Suspension is the enforcement mechanism the whole quality model rests on:
 * it revokes the vendor's DeviceSure licence and their agents stop certifying
 * (07 §5.1). Cheap to build now, awkward to retrofit.
 */
export const vendorSuspendedPayload = z.object({
  orgId: z.string().uuid(),
  reason: z.string(),
  suspendedBy: z.string().uuid(),
  revokeQcLicence: z.boolean().default(true),
});

// --- listing / qc -----------------------------------------------------------

export const listingSubmittedPayload = z.object({
  listingId: z.string().uuid(),
  vendorOrgId: z.string().uuid(),
  facilityId: z.string().uuid(),
  unitCount: z.number().int().positive(),
});

export const listingPublishedPayload = z.object({
  listingId: z.string().uuid(),
  skuId: z.string().uuid(),
  sellableUnitCount: z.number().int().nonnegative(),
  partial: z.boolean(),
});

export const qcReportCompletedPayload = z.object({
  qcReportId: z.string().uuid(),
  unitId: z.string().uuid(),
  vendorOrgId: z.string().uuid(),
  skuId: z.string().uuid(),
  verdict: z.enum(['PASS', 'PASS_WITH_NOTE', 'MISMATCH', 'FAIL']),
  gradeDeclared: z.enum(['A_PLUS', 'A', 'B']),
  gradeActual: z.enum(['A_PLUS', 'A', 'B']).nullable(),
  qcScore: z.number().min(0).max(100).nullable(),
  isSellable: z.boolean(),
});

export const gradeCorrectionRaisedPayload = z.object({
  correctionId: z.string().uuid(),
  unitId: z.string().uuid(),
  vendorOrgId: z.string().uuid(),
  gradeDeclared: z.enum(['A_PLUS', 'A', 'B']),
  gradeCorrected: z.enum(['A_PLUS', 'A', 'B']),
  respondByAt: z.string().datetime(),
});

export const qcExpiredPayload = z.object({
  unitId: z.string().uuid(),
  vendorOrgId: z.string().uuid(),
  expiredAt: z.string().datetime(),
});

export const sealBrokenPayload = z.object({
  unitId: z.string().uuid(),
  sealCode: z.string(),
  detectedAt: z.string().datetime(),
  detectedBy: z.enum(['PICKUP', 'DELIVERY', 'AUDIT']),
});

// --- ordering / procurement -------------------------------------------------

export const orderConfirmedPayload = z.object({
  orderId: z.string().uuid(),
  orderNumber: z.string(),
  buyerOrgId: z.string().uuid(),
  totalValue: z.string(), // decimal string, never a JSON number
  unitIds: z.array(z.string().uuid()),
});

export const poRaisedPayload = z.object({
  purchaseOrderId: z.string().uuid(),
  poNumber: z.string(),
  vendorOrgId: z.string().uuid(),
  orderId: z.string().uuid(),
  unitIds: z.array(z.string().uuid()),
  totalNet: z.string(),
  valuationMethod: z.enum(['REGULAR', 'MARGIN']),
});

export const goodsReceiptWrittenPayload = z.object({
  purchaseOrderId: z.string().uuid(),
  unitIds: z.array(z.string().uuid()),
  sealVerified: z.boolean(),
  receivedAt: z.string().datetime(),
});

// --- payment ----------------------------------------------------------------

export const invoiceIssuedPayload = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  orderId: z.string().uuid(),
  buyerOrgId: z.string().uuid(),
  valuationMethod: z.enum(['REGULAR', 'MARGIN']),
  total: z.string(),
});

export const paymentCapturedPayload = z.object({
  paymentId: z.string().uuid(),
  buyerOrgId: z.string().uuid(),
  amount: z.string(),
  rail: z.enum(['CARD', 'UPI', 'NETBANKING', 'NEFT_RTGS', 'CHEQUE', 'CREDIT']),
  gatewayRef: z.string().nullable(),
});

export const payoutExecutedPayload = z.object({
  payoutId: z.string().uuid(),
  payoutRunId: z.string().uuid(),
  vendorOrgId: z.string().uuid(),
  net: z.string(),
  utr: z.string().nullable(),
});

// --- logistics --------------------------------------------------------------

export const shipmentDispatchedPayload = z.object({
  shipmentId: z.string().uuid(),
  orderId: z.string().uuid(),
  carrierCode: z.string(),
  awb: z.string(),
});

export const shipmentDeliveredPayload = z.object({
  shipmentId: z.string().uuid(),
  orderId: z.string().uuid(),
  deliveredAt: z.string().datetime(),
  unitIds: z.array(z.string().uuid()),
  /** Starts the inspection window and therefore the payout-eligibility clock. */
  inspectionWindowClosesAt: z.string().datetime(),
});

// --- platform ---------------------------------------------------------------

export const warrantyClaimRaisedPayload = z.object({
  claimId: z.string().uuid(),
  ticketNumber: z.string(),
  unitId: z.string().uuid(),
  buyerOrgId: z.string().uuid(),
});

export const returnRequestedPayload = z.object({
  returnRequestId: z.string().uuid(),
  ticketNumber: z.string(),
  orderId: z.string().uuid(),
  unitIds: z.array(z.string().uuid()),
  reason: z.string(),
  autoApproved: z.boolean(),
});

// ---------------------------------------------------------------------------

export const EVENT_PAYLOADS = {
  'vendor.verified': vendorVerifiedPayload,
  'buyer.verified': buyerVerifiedPayload,
  'vendor.suspended': vendorSuspendedPayload,
  'listing.submitted': listingSubmittedPayload,
  'listing.published': listingPublishedPayload,
  'qc.report.completed': qcReportCompletedPayload,
  'qc.grade_correction.raised': gradeCorrectionRaisedPayload,
  'qc.expired': qcExpiredPayload,
  'qc.seal.broken': sealBrokenPayload,
  'order.confirmed': orderConfirmedPayload,
  'po.raised': poRaisedPayload,
  'procurement.goods_receipt.written': goodsReceiptWrittenPayload,
  'payment.invoice.issued': invoiceIssuedPayload,
  'payment.captured': paymentCapturedPayload,
  'procurement.payout.executed': payoutExecutedPayload,
  'shipment.dispatched': shipmentDispatchedPayload,
  'shipment.delivered': shipmentDeliveredPayload,
  'platform.warranty_claim.raised': warrantyClaimRaisedPayload,
  'platform.return.requested': returnRequestedPayload,
} as const;

export type EventName = keyof typeof EVENT_PAYLOADS;
export type EventPayload<N extends EventName> = z.infer<(typeof EVENT_PAYLOADS)[N]>;

export type DomainEvent = {
  [N in EventName]: EventEnvelope & { name: N; payload: EventPayload<N> };
}[EventName];

export const EVENT_NAMES = Object.keys(EVENT_PAYLOADS) as EventName[];
