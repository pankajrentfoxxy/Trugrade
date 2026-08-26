import * as React from 'react';
import type { SkuDetail } from '../api';

/**
 * The wizard's state, and the one job it has beyond holding fields.
 *
 * PHASE_03 Task 3 step 1: if the SKU is not in the catalog, hand off to the SKU
 * request flow **without losing the wizard state**. That is the whole reason
 * this is not four `useState` calls in a component — a vendor who has declared
 * twelve fields and pasted fifty serials, then discovers their machine is not
 * catalogued, must come back to all of it. So the draft lives in
 * `sessionStorage` and every step writes through.
 *
 * `sessionStorage`, not `localStorage`: a half-finished listing is not something
 * to resurrect on a shared warehouse machine a week later, and the tab is the
 * right lifetime for "I stepped out to request a SKU".
 */

export interface WizardDraft {
  step: 1 | 2 | 3 | 4;

  // Step 1
  sku: SkuDetail | null;

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

  // Step 3 — the raw text is kept, not just the accepted list, so a vendor
  // returning to the step sees their own paste and can fix line 34 in place.
  serialText: string;
  serials: string[];

  // Step 4
  netPayoutRupees: string;
  moq: number;
  dispatchSlaHours: number;
}

export const EMPTY_DRAFT: WizardDraft = {
  step: 1,
  sku: null,
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
  serialText: '',
  serials: [],
  netPayoutRupees: '',
  moq: 1,
  dispatchSlaHours: 48,
};

const KEY = 'trugrade.vendor.listing-wizard';

function read(): WizardDraft {
  try {
    const raw = sessionStorage.getItem(KEY);
    // A shape from an older deploy is not worth migrating — the vendor loses a
    // half-finished draft, which is far better than a screen that throws on a
    // field that is no longer there.
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<WizardDraft>) } : EMPTY_DRAFT;
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
        // the survive-a-navigation promise is lost, and there is nothing
        // useful to tell the vendor about it mid-keystroke.
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
