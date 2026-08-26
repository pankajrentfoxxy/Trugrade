/**
 * The four captures the 7-step vendor flow was missing, and what may be changed
 * after approval.
 *
 * All four exist because a later phase breaks without them, and each is cheaper
 * to ask for during onboarding than to chase afterwards across every vendor at
 * once.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Step 5 · Facility — the dispatch address                                    */
/* -------------------------------------------------------------------------- */

/**
 * The exact address goods leave from. It becomes `Dispatch From` on every e-way
 * bill, and it is frequently *not* the registered address — a trader registered
 * at an accountant's office ships from a warehouse two districts away. An e-way
 * bill naming the wrong origin is a detention risk at the check post, and
 * correcting it across a vendor's entire catalogue later is expensive.
 */
export const dispatchAddressCapture = z
  .object({
    facilityId: z.string().uuid(),
    /** The common case, and the one that must stay one click. */
    sameAsRegistered: z.boolean().default(false),
    /** An existing `identity.org_address` row. Required unless sameAsRegistered. */
    dispatchAddressId: z.string().uuid().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (!v.sameAsRegistered && !v.dispatchAddressId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispatchAddressId'],
        message:
          'Tell us where goods actually leave from. This becomes "Dispatch From" on the e-way bill for every unit you sell.',
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Step 4 · Capability — dropship                                              */
/* -------------------------------------------------------------------------- */

/**
 * Can this vendor dispatch straight to a buyer's address rather than to a hub?
 *
 * In the back-to-back model that is the *default* flow, so a vendor who cannot
 * do it is a materially different vendor — every order they win needs a hub leg,
 * which changes both the freight cost and the promise date. Required, never
 * defaulted silently, and shown in the review queue.
 */
export const dropshipCapability = z.object({
  canDropship: z.boolean({
    required_error:
      'Tell us whether you can ship directly to our buyers. Most orders in this model work that way.',
  }),
  /** Free text, only when they cannot. Ops reads it before deciding hub routing. */
  dropshipConstraint: z.string().max(500).optional(),
});

/* -------------------------------------------------------------------------- */
/* Step 2 · Condition declaration — the vendor's own warranty                  */
/* -------------------------------------------------------------------------- */

export const WARRANTY_COVERAGE_ITEMS = Object.freeze([
  'MOTHERBOARD',
  'DISPLAY',
  'BATTERY',
  'KEYBOARD',
  'STORAGE',
  'RAM',
  'CHARGER',
  'HINGE',
  'PORTS',
] as const);
export type WarrantyCoverageItem = (typeof WARRANTY_COVERAGE_ITEMS)[number];

/**
 * Structured coverage, not a note.
 *
 * "6 months warranty" is worth nothing at claim time if nobody wrote down
 * whether it covered the battery. Consumables are usually excluded and that is
 * fine — but it has to be *recorded* as excluded, at the point the vendor made
 * the commitment, not argued about afterwards.
 */
export const warrantyScope = z.object({
  covers: z.array(z.enum(WARRANTY_COVERAGE_ITEMS)).min(1),
  excludes: z.array(z.enum(WARRANTY_COVERAGE_ITEMS)).default([]),
  /** Physical damage and liquid ingress are excluded by default across the market. */
  coversAccidentalDamage: z.boolean().default(false),
  /** Onsite, carry-in, or the vendor collects. Drives the Phase 9 claim routing. */
  serviceMode: z.enum(['ONSITE', 'CARRY_IN', 'PICKUP']).default('CARRY_IN'),
  notes: z.string().max(1000).optional(),
});
export type WarrantyScope = z.infer<typeof warrantyScope>;

export const vendorWarrantyDefault = z
  .object({
    defaultWarrantyMonths: z.number().int().min(0).max(24),
    defaultWarrantyScope: warrantyScope,
    /**
     * The vendor must have seen this before they can pass the step. We sell a
     * longer total term than they offer and carry the difference ourselves —
     * a claim in month 8 against a 6-month vendor term is ours, not theirs.
     * Nobody should discover that during a claim.
     */
    acknowledgedPlatformTopUp: z.literal(true, {
      errorMap: () => ({
        message: 'Please confirm you have read how the warranty term works before continuing.',
      }),
    }),
  })
  .superRefine((v, ctx) => {
    const overlap = v.defaultWarrantyScope.covers.filter((c) =>
      v.defaultWarrantyScope.excludes.includes(c),
    );
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultWarrantyScope', 'excludes'],
        // Ambiguity here surfaces as a dispute in month 5, so it is rejected now.
        message: `${overlap.join(', ')} cannot be both covered and excluded.`,
      });
    }
    if (v.defaultWarrantyMonths === 0 && v.defaultWarrantyScope.covers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultWarrantyMonths'],
        message: 'You have listed what you cover but offered zero months. Set a term.',
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Step 7 · Payout — the pricing mode                                          */
/* -------------------------------------------------------------------------- */

export const payoutPreferenceCapture = z
  .object({
    pricingMode: z.enum(['NET_PAYOUT', 'COMMISSION']).default('NET_PAYOUT'),
    /** Only meaningful in COMMISSION mode; the agreed rate. */
    agreedCommissionPct: z.number().min(0).max(50).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.pricingMode === 'COMMISSION' && v.agreedCommissionPct === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agreedCommissionPct'],
        message: 'Commission pricing needs an agreed rate.',
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Post-approval change control                                                */
/* -------------------------------------------------------------------------- */

/**
 * What happens when a verified vendor edits a field.
 *
 *   FREE      save it. A commercial preference the vendor owns outright.
 *   AUDITED   save it, write an audit row. Reversible, but somebody must be
 *             able to answer "when did this change and who did it" a year later.
 *   APPROVAL  a `kyc.profile_change_request` row; ops decides.
 *   LOCKED    re-verification against the source, not a human's judgement.
 *
 * The distinction that matters is AUDITED vs APPROVAL. Making a commercial
 * preference need approval trains vendors to route around the system; making an
 * identity field merely audited means we find out after the money moved.
 */
export type ChangeControl = 'FREE' | 'AUDITED' | 'APPROVAL' | 'LOCKED';

export const CHANGE_CONTROL_MATRIX: Readonly<Record<string, ChangeControl>> = Object.freeze({
  // The four new captures.
  'vendor_capability.can_dropship': 'FREE',
  'vendor_profile.default_warranty_months': 'FREE',
  'vendor_profile.default_warranty_scope': 'FREE',
  'vendor_payout_preference.pricing_mode': 'FREE',
  // Audit-logged: it lands on statutory paperwork, so a silent edit is a gap in
  // the e-way bill trail rather than a preference change.
  'vendor_facility.dispatch_address_id': 'AUDITED',

  // Identity and money. Never free.
  'organization.legal_name': 'LOCKED',
  'organization.constitution_type': 'LOCKED',
  'gst_profile.gstin': 'LOCKED',
  'gst_profile.pan': 'LOCKED',
  'bank_account.account_number': 'LOCKED',
  'bank_account.ifsc': 'LOCKED',

  // Ops judgement.
  'vendor_facility.address_id': 'APPROVAL',
  'vendor_capability.monthly_volume': 'APPROVAL',
  'vendor_profile.trade_name': 'APPROVAL',
});

/**
 * Unknown fields are APPROVAL, not FREE.
 *
 * A field nobody classified is a field nobody thought about, and defaulting it
 * open means every future column silently becomes vendor-editable the moment it
 * is added.
 */
export function changeControlFor(field: string): ChangeControl {
  return CHANGE_CONTROL_MATRIX[field] ?? 'APPROVAL';
}

/** The four fields the review queue must show, in the order a reviewer reads them. */
export const REVIEW_QUEUE_FIELDS = Object.freeze([
  'vendor_facility.dispatch_address_id',
  'vendor_capability.can_dropship',
  'vendor_profile.default_warranty_months',
  'vendor_payout_preference.pricing_mode',
] as const);

export const VENDOR_STEP_SCHEMAS = Object.freeze({
  BUSINESS_PROFILE: vendorWarrantyDefault,
  CAPABILITY: dropshipCapability,
  FACILITY_CONTACTS: dispatchAddressCapture,
  AGREEMENT: payoutPreferenceCapture,
});
