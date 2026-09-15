/**
 * The browser half of returns — T24, `03_UX_SPEC.md` §3A.4, through the
 * same-origin rewrite so the `httpOnly` refresh cookie stays first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `ReturnsService`
 * (`apps/api/src/modules/platform/internal/returns.service.ts`). They are copied
 * rather than imported because the storefront may not import the API — and they
 * are allow-lists on that side, which is what guarantees there is no vendor
 * identifier here to render. Nothing in this file widens them.
 *
 * **The window arrives decided.** `window.open` and `window.hoursRemaining` are
 * fields, and `blockedReason` is a finished sentence. This file does no date
 * arithmetic: the 48-hour window is the deadline that decides whether a buyer
 * has a remedy, and a browser clock must never be able to answer that.
 *
 * Note what has no field here, because there is none on the server shape either:
 * `approved_by`. That is a member of our own staff on one side of a dispute, and
 * it is not selected by the repository at all rather than dropped later.
 */
import { call, type ApiResult } from '../../register/api';

/**
 * §3A.4's six reasons, in the order the form offers them.
 *
 * The order is deliberate: the two that need evidence sit next to their
 * requirement, and "short shipment" is last because it is the only one that is
 * not about a machine in front of you.
 */
export const RETURN_REASONS = [
  'GRADE_MISMATCH',
  'SPEC_MISMATCH',
  'DOA',
  'TRANSIT_DAMAGE',
  'SEAL_BROKEN',
  'SHORT_SHIPMENT',
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];

/** What each reason is called, and what it means to a person holding the laptop. */
export const REASON_LABEL: Record<ReturnReason, { label: string; hint: string }> = {
  GRADE_MISMATCH: {
    label: 'Not as described',
    hint: 'The condition is worse than the grade we sold it at — marks, wear or battery we did not declare.',
  },
  SPEC_MISMATCH: {
    label: 'Wrong model or specification',
    hint: 'Different model, less memory, smaller drive or a different processor than the order line.',
  },
  DOA: {
    label: 'Functional failure',
    hint: 'It does not work, or something on it does not — out of the box, before you did anything.',
  },
  TRANSIT_DAMAGE: {
    label: 'Physical damage',
    hint: 'Damage that was not there when we inspected it. Two photographs, please.',
  },
  SEAL_BROKEN: {
    label: 'Seal broken on arrival',
    hint: 'The tamper seal was broken or missing. A photograph of the seal, please — it settles who is liable.',
  },
  SHORT_SHIPMENT: {
    label: 'Short shipment',
    hint: 'A machine on the order did not arrive at all.',
  },
};

/**
 * How many photographs each reason calls for.
 *
 * **Stated, not enforced — and the honest reason is that there is nowhere to put
 * one.** The only upload route on this platform writes `kyc.document` rows into
 * the onboarding review queue, which is the wrong home for a photograph of a
 * scratched lid. Refusing a return against a control that does not exist would
 * make two of the six reasons unreachable with a 422 nobody can satisfy, and a
 * damage claim recorded with no picture can still be chased by email. The
 * shortfall travels on `ReturnView.evidenceStillNeeded` instead, and both
 * screens say what we will ask for.
 */
export const EVIDENCE_MINIMUM: Partial<Record<ReturnReason, number>> = {
  TRANSIT_DAMAGE: 2,
  SEAL_BROKEN: 1,
};

export interface ReturnWindow {
  /** ISO 8601 — the exact instant the refusal states. */
  closesAt: string;
  /** The server's verdict, never a subtraction this file does. */
  open: boolean;
  hoursRemaining: number;
}

export interface ReturnableMachine {
  serialNumber: string;
  orderNumber: string;
  title: string | null;
  specSummary: string | null;
  passportPath: string;
  /** ISO 8601, or null when it has not arrived. Null is not "today". */
  deliveredAt: string | null;
  window: ReturnWindow | null;
  openReturn: { returnNumber: string; status: string } | null;
  /** Null when it can be returned; otherwise the sentence saying why not. */
  blockedReason: string | null;
}

export interface ReturnEligibility {
  asOf: string;
  /** Null when the window length is unset — then no window is drawn at all. */
  windowHours: number | null;
  machines: ReturnableMachine[];
}

export interface ReturnView {
  returnNumber: string;
  serialNumber: string;
  orderNumber: string;
  title: string | null;
  reasonCode: string;
  reasonLabel: string;
  /** The buyer's own words, verbatim. We do not edit what they wrote. */
  description: string;
  evidenceCount: number;
  /** How many photographs this reason calls for. Zero for the four that need none. */
  evidenceRequired: number;
  /** The shortfall. Never rendered as a tick — a return that still owes evidence says so. */
  evidenceStillNeeded: number;
  status: string;
  raisedAt: string;
  raisedOn: string;
  resolution: string | null;
  passportPath: string;
  /** True while we still have something to do. Decided on the server. */
  open: boolean;
}

/**
 * The eleven states `platform.return_request.status` allows, as a person reads
 * them.
 *
 * **A pending return is not amber and an open one is not green.** Green and red
 * are PASS and FAIL, and "we have your machine and are looking at it" is neither
 * — those are neutral. The only `fail` here is a rejection, which genuinely is a
 * verdict, and the only `pass` are the two outcomes that gave the buyer their
 * remedy.
 */
export const RETURN_STATUS: Record<string, { label: string; tone: 'neutral' | 'pass' | 'fail' | 'warn' }> = {
  RAISED: { label: 'Raised', tone: 'neutral' },
  APPROVED: { label: 'Approved', tone: 'neutral' },
  REJECTED: { label: 'Rejected', tone: 'fail' },
  PICKUP_SCHEDULED: { label: 'Pickup scheduled', tone: 'neutral' },
  PICKED_UP: { label: 'Collected', tone: 'neutral' },
  RECEIVED: { label: 'Received by us', tone: 'neutral' },
  INSPECTED: { label: 'Inspected', tone: 'neutral' },
  REFUNDED: { label: 'Refunded', tone: 'pass' },
  REPLACED: { label: 'Replaced', tone: 'pass' },
  RETURNED_TO_BUYER: { label: 'Sent back to you', tone: 'warn' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

/** What can be sent back and what cannot, for one order or the whole account. */
export const getReturnEligibility = (
  orderNumber?: string,
): Promise<ApiResult<ReturnEligibility>> =>
  call<ReturnEligibility>(
    orderNumber
      ? `/api/buyer/returns/eligibility?order=${encodeURIComponent(orderNumber)}`
      : '/api/buyer/returns/eligibility',
    { method: 'GET' },
  );

export const getReturns = (): Promise<ApiResult<{ returns: ReturnView[] }>> =>
  call<{ returns: ReturnView[] }>('/api/buyer/returns', { method: 'GET' });

export const getReturn = (returnNumber: string): Promise<ApiResult<ReturnView>> =>
  call<ReturnView>(`/api/buyer/returns/${encodeURIComponent(returnNumber)}`, { method: 'GET' });

export const raiseReturn = (body: {
  orderNumber: string;
  serialNumbers: string[];
  reasonCode: ReturnReason;
  description: string;
  evidenceKeys?: string[];
}): Promise<ApiResult<{ returns: ReturnView[] }>> =>
  call<{ returns: ReturnView[] }>('/api/buyer/returns', {
    method: 'POST',
    body: JSON.stringify(body),
  });
