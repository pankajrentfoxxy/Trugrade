import {
  dispatchAddressCapture,
  dropshipCapability,
  vendorWarrantyDefault,
  payoutPreferenceCapture,
  changeControlFor,
  CHANGE_CONTROL_MATRIX,
  REVIEW_QUEUE_FIELDS,
  VENDOR_STEP_SCHEMAS,
} from '../src/vendor-onboarding';

const FACILITY = '11111111-1111-4111-8111-111111111111';
const ADDRESS = '22222222-2222-4222-8222-222222222222';

describe('dispatch address', () => {
  it('accepts "same as registered" without asking for an address', () => {
    const r = dispatchAddressCapture.safeParse({ facilityId: FACILITY, sameAsRegistered: true });
    expect(r.success).toBe(true);
  });

  it('will not let a facility through with no dispatch origin at all', () => {
    const r = dispatchAddressCapture.safeParse({ facilityId: FACILITY });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/e-way bill/);
  });

  it('accepts a different address, which is the case the field exists for', () => {
    const r = dispatchAddressCapture.safeParse({
      facilityId: FACILITY,
      sameAsRegistered: false,
      dispatchAddressId: ADDRESS,
    });
    expect(r.success).toBe(true);
  });
});

describe('dropship capability', () => {
  it('is required, not defaulted — an unanswered question is not a "yes"', () => {
    expect(dropshipCapability.safeParse({}).success).toBe(false);
  });

  it('accepts a vendor who cannot dropship, with their constraint', () => {
    const r = dropshipCapability.safeParse({
      canDropship: false,
      dropshipConstraint: 'No packing capability for individual units.',
    });
    expect(r.success).toBe(true);
  });
});

describe('vendor warranty default', () => {
  const base = {
    defaultWarrantyMonths: 3,
    defaultWarrantyScope: { covers: ['MOTHERBOARD', 'DISPLAY'], serviceMode: 'CARRY_IN' },
    acknowledgedPlatformTopUp: true as const,
  };

  it('accepts a structured commitment', () => {
    const r = vendorWarrantyDefault.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data!.defaultWarrantyScope.coversAccidentalDamage).toBe(false);
  });

  it('will not pass the step until the top-up has actually been read', () => {
    const r = vendorWarrantyDefault.safeParse({ ...base, acknowledgedPlatformTopUp: false });
    expect(r.success).toBe(false);
  });

  it('rejects a part that is both covered and excluded', () => {
    const r = vendorWarrantyDefault.safeParse({
      ...base,
      defaultWarrantyScope: { covers: ['BATTERY', 'DISPLAY'], excludes: ['BATTERY'] },
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/BATTERY/);
  });

  it('rejects a coverage list with a zero-month term behind it', () => {
    const r = vendorWarrantyDefault.safeParse({ ...base, defaultWarrantyMonths: 0 });
    expect(r.success).toBe(false);
  });

  it('caps the term at 24 months', () => {
    expect(vendorWarrantyDefault.safeParse({ ...base, defaultWarrantyMonths: 36 }).success).toBe(
      false,
    );
  });
});

describe('payout preference', () => {
  it('defaults to NET_PAYOUT — the decided basis', () => {
    const r = payoutPreferenceCapture.safeParse({});
    expect(r.success).toBe(true);
    expect(r.data!.pricingMode).toBe('NET_PAYOUT');
  });

  it('demands a rate when the vendor picks commission', () => {
    expect(payoutPreferenceCapture.safeParse({ pricingMode: 'COMMISSION' }).success).toBe(false);
    expect(
      payoutPreferenceCapture.safeParse({ pricingMode: 'COMMISSION', agreedCommissionPct: 12.8 })
        .success,
    ).toBe(true);
  });
});

describe('post-approval change control', () => {
  it('leaves commercial preferences free to edit', () => {
    expect(changeControlFor('vendor_capability.can_dropship')).toBe('FREE');
    expect(changeControlFor('vendor_profile.default_warranty_months')).toBe('FREE');
    expect(changeControlFor('vendor_payout_preference.pricing_mode')).toBe('FREE');
  });

  it('audit-logs the dispatch address, because it lands on statutory paperwork', () => {
    expect(changeControlFor('vendor_facility.dispatch_address_id')).toBe('AUDITED');
  });

  it("never lets identity or bank details through on the vendor's own say-so", () => {
    for (const f of ['gst_profile.gstin', 'gst_profile.pan', 'bank_account.account_number']) {
      expect(changeControlFor(f)).toBe('LOCKED');
    }
  });

  it('treats an unclassified field as needing approval, not as free', () => {
    // The failure mode this prevents: a column added in Phase 6 becoming
    // vendor-editable simply because nobody remembered this file existed.
    expect(changeControlFor('vendor_profile.some_future_column')).toBe('APPROVAL');
  });

  it('classifies every field the review queue shows', () => {
    for (const f of REVIEW_QUEUE_FIELDS) {
      expect(CHANGE_CONTROL_MATRIX[f]).toBeDefined();
    }
  });
});

describe('step wiring', () => {
  it('attaches each new capture to the step that collects it', () => {
    expect(Object.keys(VENDOR_STEP_SCHEMAS).sort()).toEqual([
      'AGREEMENT',
      'BUSINESS_PROFILE',
      'CAPABILITY',
      'FACILITY_CONTACTS',
    ]);
  });
});
