/**
 * The browser half of warranty and claims — T23, through the same-origin
 * rewrite so the `httpOnly` refresh cookie stays first-party.
 *
 * **The types below are the server's response types, copied field for field**
 * from `WarrantyService`
 * (`apps/api/src/modules/platform/internal/warranty.service.ts`). They are
 * copied rather than imported because the storefront may not import the API —
 * and they are allow-lists on that side, which is what guarantees there is no
 * vendor identifier here to render.
 *
 * Note what has no field here, because there is no field for it on the server
 * shape either: `vendorBackedMonths` and `platformBackedMonths`. The buyer is
 * sold ONE warranty term and the split between what a supply point stands
 * behind and what we fund on top is a commercial arrangement they are not party
 * to. `FORBIDDEN_CUSTOMER_KEYS` names both by name.
 *
 * **`inWarranty`, `daysRemaining` and `expiringSoon` arrive decided.** They are
 * not a subtraction this file does. "Is this machine still covered" is a money
 * question and a browser clock must never be able to answer it — a laptop three
 * weeks fast would offer a paid repair on a machine we owe a free one on.
 */
import { call, type ApiResult } from '../../register/api';

/** The twelve inspection areas, which are also the twelve fault categories. */
export const FAULT_AREAS = [
  'BATTERY',
  'BIOS_SECURITY',
  'CAMERA_AUDIO',
  'CONNECTIVITY',
  'DATA_SECURITY',
  'DISPLAY',
  'KEYBOARD',
  'MEMORY_CPU',
  'PHYSICAL',
  'PORTS',
  'STORAGE',
  'THERMAL',
] as const;

export type FaultArea = (typeof FAULT_AREAS)[number];

/** What each area is called on a screen, and what it means to a person. */
export const FAULT_AREA_LABEL: Record<FaultArea, { label: string; hint: string }> = {
  BATTERY: { label: 'Battery', hint: 'Will not hold charge, drains fast, will not charge' },
  BIOS_SECURITY: { label: 'BIOS and firmware', hint: 'BIOS password, secure boot, firmware lock' },
  CAMERA_AUDIO: { label: 'Camera, microphone and speakers', hint: 'No picture, no sound, crackle' },
  CONNECTIVITY: { label: 'Wi-Fi and Bluetooth', hint: 'Will not connect, drops, no adapter found' },
  DATA_SECURITY: { label: 'Data and wipe', hint: 'Previous data present, wipe certificate wrong' },
  DISPLAY: { label: 'Screen', hint: 'Dead pixels, lines, flicker, backlight' },
  KEYBOARD: { label: 'Keyboard and trackpad', hint: 'Keys not registering, trackpad erratic' },
  MEMORY_CPU: { label: 'Memory and processor', hint: 'Crashes, freezes, less RAM than ordered' },
  PHYSICAL: { label: 'Chassis and hinges', hint: 'Hinge, lid, casing, port housing' },
  PORTS: { label: 'Ports', hint: 'USB, HDMI, audio jack, charging port' },
  STORAGE: { label: 'Storage', hint: 'Drive not detected, errors, smaller than ordered' },
  THERMAL: { label: 'Heat and fan', hint: 'Runs hot, fan noise, thermal shutdown' },
};

export interface WarrantyTerms {
  version: string;
  covers: string[];
  excludes: string[];
}

export interface WarrantyCover {
  startDate: string;
  endDate: string;
  /** The one number. There is no split on this shape and there never will be. */
  totalMonths: number;
  /** Server-decided, never negative. Zero when the term has run out. */
  daysRemaining: number;
  /** The server's verdict. This page renders it; it does not re-derive it. */
  inWarranty: boolean;
  expiringSoon: boolean;
}

export interface CoveredMachine {
  serialNumber: string;
  orderNumber: string;
  orderedOn: string;
  title: string | null;
  specSummary: string | null;
  passportPath: string;
  /**
   * Null means cover has NOT STARTED — the machine has not been delivered.
   * That is a different fact from an expired term and must never render as one.
   */
  cover: WarrantyCover | null;
  openClaim: { claimNumber: string; status: string; raisedOn: string } | null;
}

export interface WarrantyRegister {
  machines: CoveredMachine[];
  terms: WarrantyTerms;
  /** The IST date the server reckoned every term against. */
  asOf: string;
}

export interface ClaimView {
  claimNumber: string;
  serialNumber: string;
  orderNumber: string;
  title: string | null;
  status: string;
  faultArea: string;
  description: string;
  evidenceCount: number;
  raisedOn: string;
  updatedOn: string;
  closedOn: string | null;
  resolution: string | null;
  passportPath: string;
}

export const getWarrantyRegister = (): Promise<ApiResult<WarrantyRegister>> =>
  call<WarrantyRegister>('/api/buyer/warranty', { method: 'GET' });

export const getClaims = (): Promise<ApiResult<{ claims: ClaimView[] }>> =>
  call<{ claims: ClaimView[] }>('/api/buyer/warranty/claims', { method: 'GET' });

export const getClaim = (claimNumber: string): Promise<ApiResult<ClaimView>> =>
  call<ClaimView>(`/api/buyer/warranty/claims/${encodeURIComponent(claimNumber)}`, {
    method: 'GET',
  });

export const raiseClaim = (body: {
  serialNumber: string;
  faultArea: FaultArea;
  description: string;
}): Promise<ApiResult<ClaimView>> =>
  call<ClaimView>('/api/buyer/warranty/claims', {
    method: 'POST',
    body: JSON.stringify(body),
  });

/* ==========================================================================
 * Claim status — the vocabulary, and what colour it is allowed to be
 * ======================================================================== */

/**
 * **A pending claim is not a failure and an open one is not a pass.**
 *
 * Green and red are PASS and FAIL. A claim moving through triage is neither: it
 * is work in progress, and painting it amber or red would make a buyer whose
 * laptop is being repaired think something had gone wrong. Only the two terminal
 * verdicts get a verdict colour — `REJECTED` is a refusal we have to own, and
 * the repaired/replaced/refunded endings are genuinely good outcomes.
 */
export const CLAIM_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'pass' | 'warn' | 'fail' | 'processing' }
> = {
  RAISED: { label: 'Raised', tone: 'neutral' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'neutral' },
  TRIAGE: { label: 'In triage', tone: 'processing' },
  INFO_REQUESTED: { label: 'We need more from you', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'neutral' },
  IN_REPAIR: { label: 'In repair', tone: 'processing' },
  REPLACEMENT_ISSUED: { label: 'Replacement issued', tone: 'pass' },
  REFUND_ISSUED: { label: 'Refund issued', tone: 'pass' },
  ESCALATED: { label: 'Escalated', tone: 'warn' },
  REJECTED: { label: 'Rejected', tone: 'fail' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};
