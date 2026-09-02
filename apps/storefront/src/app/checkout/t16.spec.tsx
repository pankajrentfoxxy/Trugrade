/**
 * The six things about checkout that would be silently wrong on the screen.
 *
 * None of these asserts that a control exists. Each renders the real flow with
 * the real payload shape and reads back what a buyer sees — because the two
 * defects this screen actually shipped with were both of the shape a
 * "the panel renders" test passes with flying colours:
 *
 * 1. **A tax split that could not be resolved was drawn as one that came out at
 *    zero** — "CGST at 9% — ₹0.00 · SGST at 9% — ₹0.00" for a Karnataka delivery
 *    against a Haryana registration, which is not merely unresolved but the
 *    wrong pair of heads. A missing value rendered as a settled one, on the one
 *    panel PHASE_06 Task 1 exists to put in front of a finance team.
 * 2. **The primary action's refusal lived only in a `title` tooltip**, and
 *    `Button` leaves an `aria-disabled` control's click handler live, so the
 *    order could be placed by pressing a button the screen said was unavailable.
 *
 * The rest pin the rules that have no other guard: the whole break-up on one
 * screen, the split resolved before confirmation, and no vendor anywhere.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { CheckoutFlow } from './CheckoutFlow';
import type { CheckoutSession, TaxSplit } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  startCheckout: jest.fn(),
  quoteCheckout: jest.fn(),
  confirmCheckout: jest.fn(),
  abandonCheckout: jest.fn(),
}));

import { confirmCheckout, quoteCheckout, startCheckout } from './api';

const mockStart = startCheckout as jest.MockedFunction<typeof startCheckout>;
const mockQuote = quoteCheckout as jest.MockedFunction<typeof quoteCheckout>;
const mockConfirm = confirmCheckout as jest.MockedFunction<typeof confirmCheckout>;

/* ----------------------------------------------------------------- fixtures */

/** The vendor behind Supply Point F. Every field of it is swept for below. */
const VENDOR: VendorIdentity = {
  orgId: '112077be-4b0c-416c-8f61-e3af0a20c53d',
  legalName: 'Harbourpoint Technologies Private Limited',
  tradeName: 'Harbourpoint IT',
  gstin: '06AABCH1234M1Z7',
  pan: 'AABCH1234M',
  addressLines: ['Plot 44, Udyog Vihar Phase IV, Gurugram'],
  phones: ['+919810011122'],
  emails: ['ops@harbourpoint.example'],
  slug: 'harbourpoint-technologies',
};

const CART_ID = '9815e559-1bc0-4f93-8520-38a582ac882c';

/** Haryana 06 delivering into Haryana 06: intra-state, CGST + SGST. */
const INTRA: TaxSplit = {
  interState: false,
  igst: '0.00',
  cgst: '19703.97',
  sgst: '19703.97',
  stateTaxLabel: 'SGST',
  ratePct: 18,
  ourStateCode: '06',
  placeOfSupplyStateCode: '06',
  placeOfSupplyState: 'Haryana',
  basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
};

/** Haryana 06 delivering into Delhi 07: the movement terminates elsewhere. */
const INTER: TaxSplit = {
  ...INTRA,
  interState: true,
  igst: '39407.94',
  cgst: '0.00',
  sgst: '0.00',
  stateTaxLabel: 'UTGST',
  placeOfSupplyStateCode: '07',
  placeOfSupplyState: 'Delhi',
};

/**
 * Karnataka 29 against our 06 — inter-state by the section — on a lane we do
 * not serve. The API returns zeros here because there is no taxable value, and
 * `interState` false because nothing was resolved. Rendering that pair as a
 * settled split is the exact defect this file exists to keep out.
 */
const UNRESOLVED: TaxSplit = {
  ...INTRA,
  placeOfSupplyStateCode: '29',
  placeOfSupplyState: 'Karnataka',
  cgst: '0.00',
  sgst: '0.00',
  basis: 's.10(1)(a) IGST Act — resolved once a delivery site is chosen',
};

const site = (over: Partial<CheckoutSession['deliverySites'][0]> = {}) => ({
  id: '28e9dee9-59e2-4593-aa30-ece6aeaf057d',
  label: 'Gurugram IT campus',
  line1: 'Tower C, 6th floor, DLF Cyber City',
  line2: null,
  city: 'Gurugram',
  state: 'Haryana',
  stateCode: '06',
  pincode: '122001',
  contactName: 'Ravi Menon',
  contactMobile: '+919810045512',
  landmark: 'Opposite the Cyber Hub gate',
  gateInstructions: 'Goods entry is gate 3 at the rear.',
  receivingHours: null,
  isDefault: true,
  ...over,
});

const BENGALURU = site({
  id: 'd912d62f-86f8-48a1-8c86-de84491daf1f',
  label: 'Bengaluru office',
  city: 'Bengaluru',
  state: 'Karnataka',
  stateCode: '29',
  pincode: '560001',
  isDefault: false,
});

const session = (over: Partial<CheckoutSession> = {}): CheckoutSession => ({
  cartId: CART_ID,
  cartName: 'National rollout',
  // Twenty minutes out, computed from now so the suite is not a time bomb: a
  // literal instant passes only while the real date matches it.
  holdExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  unitsHeld: 5,
  lines: [
    {
      offerId: 'b6e12109-34d1-49be-a047-e5062289b0aa',
      title: 'Dell Latitude 5420',
      specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
      grade: 'A',
      qty: 2,
      unitPrice: '41900.00',
      lineTotal: '83800.00',
      dispatchPoint: 'Supply Point F · Noida',
      serials: ['TGD1F89F8F8', 'TGD810C882D'],
    },
  ],
  gstProfiles: [
    {
      id: '2ef81ab2-3039-4d2c-9a39-621d64ff3dfa',
      gstin: '06AABCA1429B1Z8',
      legalName: 'Acme Industries Pvt. Ltd.',
      tradeName: 'Acme',
      stateCode: '06',
      registrationType: 'REGULAR',
      isPrimary: true,
    },
  ],
  billingAddresses: [site()],
  deliverySites: [site(), BENGALURU],
  paymentModes: [
    { mode: 'PREPAID', label: 'Pay now — UPI, card, netbanking or NEFT/RTGS', allowed: true, reason: null },
    {
      mode: 'CREDIT',
      label: 'On our credit terms with you',
      allowed: false,
      reason: 'Your buying policy does not include this method.',
    },
  ],
  poRequired: false,
  selection: {
    gstProfileId: '2ef81ab2-3039-4d2c-9a39-621d64ff3dfa',
    billingAddressId: '28e9dee9-59e2-4593-aa30-ece6aeaf057d',
    deliveryAddressId: '28e9dee9-59e2-4593-aa30-ece6aeaf057d',
    paymentMode: 'PREPAID',
  },
  breakUp: {
    goods: '218500.00',
    freight: '433.00',
    freightUnpricedReason: null,
    taxableValue: '218933.00',
    gstTotal: '39407.94',
    grandTotal: '258340.94',
    tax: INTRA,
  },
  approval: null,
  ...over,
});

/** The same session with the Bengaluru lane chosen and nothing priced. */
const unpriced = (): CheckoutSession =>
  session({
    selection: { ...session().selection, deliveryAddressId: BENGALURU.id },
    breakUp: {
      goods: '218500.00',
      freight: null,
      freightUnpricedReason: "We don't deliver to 560001 yet — our current service area is Delhi NCR.",
      taxableValue: '218500.00',
      gstTotal: '0.00',
      grandTotal: null,
      tax: UNRESOLVED,
    },
  });

const ok = <T,>(data: T) => ({ ok: true as const, data });

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', `/checkout?cart=${CART_ID}`);
});

/** Render, wait for the hold to land, and walk to the step asked for. */
async function open(first: CheckoutSession, steps = 0): Promise<void> {
  mockStart.mockResolvedValue(ok(first));
  mockQuote.mockResolvedValue(ok(first));
  render(<CheckoutFlow />);
  await screen.findByRole('heading', { level: 1, name: 'Review what is held' });
  for (let i = 0; i < steps; i += 1) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue' })).toBeTruthy(), {
      timeout: 2000,
    }).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------- tests */

describe('checkout — the tax split before confirmation', () => {
  it('shows the resolved heads and their amounts on the very first step', async () => {
    await open(session());
    // Not progressive: goods, freight and each GST head are together from the
    // first screen. Drip pricing is a named prohibited practice.
    expect(screen.getByText(/CGST 9%/)).toBeInTheDocument();
    expect(screen.getByText(/SGST 9%/)).toBeInTheDocument();
    expect(screen.getByText('₹2,58,340.94')).toBeInTheDocument();
    expect(screen.getByText(/Intra-state supply, so it splits into CGST and SGST/)).toBeInTheDocument();
  });

  it('reads the whole tax as IGST when the movement terminates in another state', async () => {
    await open(session({ breakUp: { ...session().breakUp!, tax: INTER, gstTotal: '39407.94' } }));
    expect(screen.getByText(/IGST 18%/)).toBeInTheDocument();
    expect(screen.getByText(/the whole tax is IGST/)).toBeInTheDocument();
    // …and never both pairs of heads at once. `payment.invoice` CHECKs it, and
    // a screen that shows both is telling a finance team something the database
    // would refuse to store.
    expect(screen.queryByText(/CGST 9%/)).not.toBeInTheDocument();
  });

  it('never draws an unresolved split as one that came out at zero', async () => {
    await open(unpriced(), 5);
    await screen.findByRole('heading', { level: 1, name: 'Confirm' });

    expect(screen.getByText('The tax split is not resolved yet')).toBeInTheDocument();
    expect(screen.getByText('Not resolved')).toBeInTheDocument();
    // The heading that claims a settled split must be gone, and no ₹0.00 may
    // stand in for a figure nobody computed.
    expect(screen.queryByText('The tax split on this order')).not.toBeInTheDocument();
    expect(screen.queryByText(/₹0\.00/)).not.toBeInTheDocument();
    // …and the honest reading is named: 06 against 29 could only be IGST.
    expect(screen.getByText(/would be IGST/)).toBeInTheDocument();
  });
});

describe('checkout — the primary action', () => {
  it('says on the screen why it is unavailable, not only in a tooltip', async () => {
    await open(unpriced(), 5);
    await screen.findByRole('heading', { level: 1, name: 'Confirm' });
    // `Button` puts `disabledReason` in `title`, which a touch or keyboard user
    // never reaches. The sentence has to be in the document text.
    expect(
      screen.getByText(/Delivery to that site cannot be priced, so there is no total to agree to/),
    ).toBeInTheDocument();
  });

  it('does not place an order when it has said the order cannot be placed', async () => {
    await open(unpriced(), 5);
    await screen.findByRole('heading', { level: 1, name: 'Confirm' });
    // `aria-disabled` leaves the handler live, so pressing it really does fire
    // the click — the guard is what must stop the request, and this attempts
    // the forbidden thing rather than asserting a guard exists.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Place this order' }));
    });
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

describe('checkout — what it must not say', () => {
  it('names no vendor anywhere on the screen, at any depth', async () => {
    const { container } = { container: (await openReturning(session())).container };
    expect(findVendorIdentityLeaks(container.innerHTML, VENDOR)).toEqual([]);
    expect(container.textContent).toContain('Supply Point F · Noida');
  });

  it('hides the registration draft sentence on the step rail', async () => {
    await open(session());
    expect(screen.queryByText(/Nothing here is saved as a draft/)).not.toBeInTheDocument();
    const rails = screen.getAllByTestId('step-rail');
    expect(rails).toHaveLength(2);
    for (const rail of rails) expect(rail).toHaveClass('checkoutrail');
  });
});

/** `render`'s handle, for the sweep that needs the DOM rather than a query. */
async function openReturning(first: CheckoutSession): Promise<{ container: HTMLElement }> {
  mockStart.mockResolvedValue(ok(first));
  mockQuote.mockResolvedValue(ok(first));
  const rendered = render(<CheckoutFlow />);
  await screen.findByRole('heading', { level: 1, name: 'Review what is held' });
  return rendered;
}
