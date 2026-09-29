import * as React from 'react';
import { LISTING_QTY, VENDOR_NET_PAYOUT } from '@trugrade/contracts';
import type { SkuDetail } from '../api';

/**
 * The wizard's state, and the one job it has beyond holding fields.
 *
 * PHASE_03 Task 3 step 1: if the SKU is not in the catalog, hand off to the SKU
 * request flow **without losing the wizard state**. That is the whole reason
 * this is not three `useState` calls in a component — a vendor who has declared
 * twelve fields, then discovers their machine is not catalogued, must come back
 * to all of it. So the draft lives in `sessionStorage` and every step writes
 * through.
 *
 * There is no serial step. A listing is a declared quantity; the serials are
 * recorded by our technician at the vendor's site once a buyer has ordered.
 */

export interface WizardDraft {
  step: 1 | 2 | 3;

  // Step 1
  sku: SkuDetail | null;
  catalogModel: { modelId: string; brandName: string; modelName: string } | null;

  // Step 2
  grade: 'A_PLUS' | 'A' | 'B';
  conditionType: string;
  functionalStatus: string;
  batteryHealthBand: string;
  partsStatus: string;
  partsReplaced: string[];
  repairHistory: string;
  dataWipeStatus: string;
  sellerWarranty: string;
  oemWarrantyRemaining: string;
  vendorWarrantyMonths: number;
  pickupLocationId: string;

  // Step 3
  /** How many machines are on offer. Kept as text so a cleared field stays cleared. */
  qtyText: string;
  netPayoutRupees: string;
  moq: number;
  dispatchSlaHours: number;
}

export const EMPTY_DRAFT: WizardDraft = {
  step: 1,
  sku: null,
  catalogModel: null,
  grade: 'A',
  conditionType: 'REFURBISHED',
  functionalStatus: 'FULLY_FUNCTIONAL',
  batteryHealthBand: 'GOOD_80_89',
  partsStatus: 'ALL_ORIGINAL',
  partsReplaced: [],
  repairHistory: 'NONE',
  dataWipeStatus: 'VERIFIED_WIPED',
  sellerWarranty: 'NONE',
  oemWarrantyRemaining: 'NONE',
  vendorWarrantyMonths: 0,
  pickupLocationId: '',
  qtyText: '',
  netPayoutRupees: '',
  moq: 1,
  dispatchSlaHours: 48,
};

/** Empty string means the amount is ready to send. */
export function payoutBlocker(rupees: string): string {
  const amount = rupees.trim();
  if (amount === '') return 'Enter the net payout per machine.';
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return 'Enter a rupee amount greater than zero.';
  }
  const n = Number(amount);
  if (n < VENDOR_NET_PAYOUT.min! || n > VENDOR_NET_PAYOUT.max!) {
    return VENDOR_NET_PAYOUT.message;
  }
  return '';
}

/** Empty string means the quantity is ready to send. VR-080 is the rule. */
export function qtyBlocker(qtyText: string): string {
  const text = qtyText.trim();
  if (text === '') return 'Say how many machines you are offering.';
  if (!/^\d+$/.test(text)) return 'Enter a whole number of machines.';
  const n = Number(text);
  if (n < LISTING_QTY.min! || n > LISTING_QTY.max!) return LISTING_QTY.message;
  return '';
}

/** The quantity as a number, or 0 while the field is not yet valid. */
export function qtyOf(draft: WizardDraft): number {
  return qtyBlocker(draft.qtyText) ? 0 : Number(draft.qtyText.trim());
}

const KEY = 'trugrade.vendor.listing-wizard';

function read(): WizardDraft {
  try {
    const raw = sessionStorage.getItem(KEY);
    // A shape from an older deploy is not worth migrating — the vendor loses a
    // half-finished draft, which is far better than a screen that throws on a
    // field that is no longer there. A step beyond the last is clamped for the
    // same reason: the old wizard had four.
    const parsed = raw ? (JSON.parse(raw) as Partial<WizardDraft>) : {};
    const merged = { ...EMPTY_DRAFT, ...parsed };
    return { ...merged, step: merged.step > 3 ? 3 : merged.step };
  } catch {
    return EMPTY_DRAFT;
  }
}

/**
 * The draft, persisted on every change.
 *
 * Returns a patch function rather than a setter: every caller is updating two
 * or three fields of twenty, and `{...draft, grade}` written out at fifteen call
 * sites is fifteen chances to drop a field.
 */
export function useDraft(): [WizardDraft, (patch: Partial<WizardDraft>) => void, () => void] {
  const [draft, setDraft] = React.useState<WizardDraft>(read);

  const patch = React.useCallback((p: Partial<WizardDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...p };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode, or a quota. The wizard still works for this tab; only
        // the survive-a-navigation promise is lost.
      }
      return next;
    });
  }, []);

  const clear = React.useCallback(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* see above */
    }
    setDraft(EMPTY_DRAFT);
  }, []);

  return [draft, patch, clear];
}
