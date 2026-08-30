/**
 * The things about the order screen that would be silently wrong on it.
 *
 * Three of them are the ones T17 exists to protect, and none is a
 * "the panel renders" assertion — each one attempts the forbidden thing and
 * expects the refusal, or reads back the words a buyer actually sees:
 *
 * 1. **A vendor purchase order must be unreachable from this screen.** PHASE_06
 *    Task 6 names three documents and warns that confusing them is the failure.
 *    Our PO to a supply point is vendor-and-admin-only, so the test asserts that
 *    the rendered screen contains no PO number of ours, no link that could reach
 *    one, and none of the vocabulary — while the buyer's OWN reference, which is
 *    a different document belonging to a different party, is on screen.
 * 2. **An order awaiting approval must never describe itself as confirmed or
 *    paid.** Stock is held; nothing is committed. The exact phrasing was already
 *    fixed once on checkout's confirmation, which is why it is pinned here.
 * 3. **No vendor identifier, anywhere, at any depth**, swept with the same
 *    `findVendorIdentityLeaks` the API's own anonymity tests use.
 *
 * Plus the two absences that are easy to turn into claims: a missing PO
 * reference and a missing rejection reason must render as absences, never as
 * blanks that read like recorded values.
 */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { OrderRecord } from './OrderRecord';
import type { OrderApproval, OrderRecord as Order } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getOrder: jest.fn(),
}));

import { getOrder } from './api';

const mockGet = getOrder as jest.MockedFunction<typeof getOrder>;

/* ----------------------------------------------------------------- fixtures */

/** The vendor behind Supply Point L. Every field of it is swept for below. */
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

const ADDRESS = {
  label: 'New Delhi head office',
  line1: '11th floor, Barakhamba Road, Connaught Place',
  line2: null,
  city: 'New Delhi',
  state: 'Delhi',
  stateCode: '07',
  pincode: '110001',
  contactName: 'Suresh Pillai',
  contactMobile: '+919811223344',
  landmark: 'Behind the Statesman House',
  gateInstructions: 'Deliveries to the basement dock only.',
  receivingHours: null,
} as const;

/** A confirmed order, two dispatch points, inter-state. The real seeded shape. */
const CONFIRMED: Order = {
  orderNumber: 'TT-26-00002',
  status: 'PAYMENT_PENDING',
  paymentMode: 'PREPAID',
  paymentStatus: 'PENDING',
  placedAt: '2026-08-29T21:23:28.653Z',
  buyerPoNumber: 'PO/2026/00417',
  costCentre: 'IT — Delhi office',
  subtotal: '128700.00',
  freight: '298.00',
  gstTotal: '23219.64',
  grandTotal: '152217.64',
  tax: {
    interState: true,
    igst: '23219.64',
    cgst: '0.00',
    sgst: '0.00',
    stateTaxLabel: 'UTGST',
    ratePct: 18,
    ourStateCode: '06',
    placeOfSupplyStateCode: '07',
    placeOfSupplyState: 'Delhi',
    basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
  },
  billedTo: {
    gstin: '06AABCA1429B1Z8',
    legalName: 'Acme Industries Pvt. Ltd.',
    tradeName: 'Acme',
  },
  billingAddress: { ...ADDRESS },
  deliveryAddress: { ...ADDRESS },
  unitsAllocated: 3,
  dispatchGroups: [
    {
      label: 'Supply Point L · Gurugram',
      machines: [
        {
          serialNumber: 'TGDB33CA5F1',
          title: 'Dell Latitude 5420',
          specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
          grade: 'A',
          unitPrice: '44900.00',
        },
      ],
    },
    {
      label: 'Supply Point W · New Delhi',
      machines: [
        {
          serialNumber: 'TGD1F89F8F8',
          title: 'Dell Latitude 5420',
          specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
          grade: 'A',
          unitPrice: '41900.00',
        },
        {
          serialNumber: 'TGD810C882D',
          title: 'Dell Latitude 5420',
          specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
          grade: 'A',
          unitPrice: '41900.00',
        },
      ],
    },
  ],
  approval: null,
};

const APPROVAL: OrderApproval = {
  status: 'PENDING',
  approverName: 'Suresh Pillai',
  requestedByName: 'Farah Khan',
  requestedAt: '2026-08-29T21:28:25.291Z',
  decidedAt: null,
  expiresAt: '2026-08-30T21:28:25.288Z',
  comment: null,
  orderValue: '307942.24',
};

const awaiting = (over: Partial<OrderApproval> = {}): Order => ({
  ...CONFIRMED,
  orderNumber: 'TT-26-00004',
  status: 'AWAITING_APPROVAL',
  // The seeded approval-held orders carry no PO reference. An empty string is
  // what the form posts; the API normalises it to null, and so does this.
  buyerPoNumber: null,
  costCentre: null,
  unitsAllocated: 6,
  approval: { ...APPROVAL, ...over },
});

const shown = async (order: Order): Promise<HTMLElement> => {
  mockGet.mockResolvedValue({ ok: true, data: order });
  const { container } = render(<OrderRecord orderNumber={order.orderNumber} />);
  await screen.findByRole('heading', { name: `Order ${order.orderNumber}` });
  return container as HTMLElement;
};

beforeEach(() => jest.clearAllMocks());

/* ========================================================================== */

describe('a vendor purchase order is unreachable from the buyer’s screen', () => {
  it('shows the buyer their OWN reference and no purchase order of ours', async () => {
    const container = await shown(CONFIRMED);

    // The buyer's own document, which is theirs and prints on our invoice.
    expect(screen.getByText('PO/2026/00417')).toBeInTheDocument();
    expect(screen.getByText('Your PO reference')).toBeInTheDocument();

    const text = container.textContent ?? '';
    // Ours to a supply point: `PO-26-00841`. Not a number, not a status, not
    // a mention.
    expect(text).not.toMatch(/PO-\d{2}-\d{4,}/);
    for (const word of [
      'vendor',
      'supplier',
      'seller’s purchase order',
      'ACKNOWLEDGED',
      'DISPATCH_READY',
      'payout',
    ]) {
      expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('offers no link that could reach one', async () => {
    const container = await shown(CONFIRMED);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    // Every link on the screen goes to a unit passport the buyer already owns,
    // and nothing goes anywhere near procurement.
    for (const href of hrefs) {
      expect(href).not.toMatch(/purchase-order|purchase_order|\/po\/|procurement|vendor/i);
    }
    expect(hrefs.filter((h) => h.startsWith('/unit/'))).toHaveLength(3);
  });

  it('names the documents that ARE the buyer’s, and does not fake the ones that do not exist', async () => {
    await shown(CONFIRMED);
    expect(screen.getByText('Our order confirmation')).toBeInTheDocument();
    expect(screen.getByText('Proforma invoice')).toBeInTheDocument();
    // No download, no disabled button suggesting a file: the words say it is
    // not issued, because it is not.
    expect(screen.getAllByText('Not issued yet').length).toBeGreaterThan(0);
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('an order awaiting approval never describes itself as confirmed or paid', () => {
  it('says held, not allocated, and not yours', async () => {
    const container = await shown(awaiting());
    const text = container.textContent ?? '';

    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByText(/The machines held against this order/)).toBeInTheDocument();
    expect(text).toContain('It is not confirmed');
    expect(text).toContain('nothing has been charged');

    // The words that would be a lie on this state.
    expect(text).not.toMatch(/machines allocated to you/i);
    expect(text).not.toMatch(/order placed/i);
    // Every occurrence of the word is preceded by "not". There is no other
    // legitimate way for it to appear on this state.
    expect(text).not.toMatch(/(?<!not )confirmed/i);
    // `\b` on purpose: "Prepaid" is the payment MODE this order would use if it
    // is approved, not a claim that anything has been paid.
    expect(text).not.toMatch(/\bpaid\b|payment received|invoice raised/i);
  });

  it('quotes the money as conditional, never as a charge', async () => {
    const container = await shown(awaiting());
    const text = container.textContent ?? '';
    expect(screen.getByText('What this order would come to')).toBeInTheDocument();
    expect(text).toContain('Nothing has been charged');
  });

  it('says what is held, for whom, until when, who asked, and what happens if nobody answers', async () => {
    const container = await shown(awaiting());
    const text = container.textContent ?? '';
    expect(text).toContain('6 machines');
    expect(text).toContain('Suresh Pillai');
    expect(text).toContain('Farah Khan');
    // The deadline, as an instant a person can act on rather than an ISO string.
    expect(text).toMatch(/31 Aug 2026, \d{1,2}:\d{2} (a|p)m IST/);
    expect(text).toContain('the hold releases on its own');
  });

  it('says the hold is gone once the window closed, rather than leaving it ambiguous', async () => {
    const container = await shown(awaiting({ status: 'EXPIRED' }));
    const text = container.textContent ?? '';
    expect(screen.getByText('Approval expired')).toBeInTheDocument();
    expect(text).toContain('went back on sale');
    expect(text).toContain('no longer held');
    expect(screen.getByText(/Nothing — the hold was released/)).toHaveClass('notmeasured');
  });

  it('carries the approver’s reason on a rejection, and an absence when there is none', async () => {
    const withReason = await shown(
      awaiting({
        status: 'REJECTED',
        decidedAt: '2026-08-30T05:00:00.000Z',
        comment: 'Q3 hardware budget is committed until October.',
      }),
    );
    expect(withReason.textContent).toContain('Q3 hardware budget is committed until October.');
    expect(screen.getByText('Reason given')).toBeInTheDocument();

    cleanup();
    jest.clearAllMocks();
    await shown(awaiting({ status: 'REJECTED', decidedAt: '2026-08-30T05:00:00.000Z' }));
    // An absence renders as an absence, in --ink-4. Never "not specified" drawn
    // as though somebody recorded it.
    const none = screen.getByText('None recorded');
    expect(none).toHaveClass('notmeasured');
  });
});

describe('no vendor identifier reaches the rendered screen', () => {
  it.each([
    ['a confirmed order', CONFIRMED],
    ['one awaiting approval', awaiting()],
    ['a declined one', awaiting({ status: 'REJECTED', comment: 'No budget.' })],
  ])('%s', async (_label, order) => {
    const container = await shown(order);
    const leaks = findVendorIdentityLeaks(container.innerHTML, VENDOR);
    expect(leaks).toEqual([]);
    // A supply point is a place, and it carries nothing finer than the city.
    expect(container.textContent).toContain('Supply Point L · Gurugram');
  });
});

describe('absences stay absences', () => {
  it('renders a missing PO reference as one, not as a blank that reads as recorded', async () => {
    await shown(awaiting());
    const none = screen.getByText('None given');
    expect(none).toHaveClass('notmeasured');
  });

  it('renders a missing cost centre the same way', async () => {
    await shown(awaiting());
    expect(screen.getByText('Not recorded')).toHaveClass('notmeasured');
  });
});

describe('the states that are not the record', () => {
  it('offers a way back in rather than an error when there is no session', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'no session',
      fields: {},
      retryAfterSeconds: null,
    });
    render(<OrderRecord orderNumber="TT-26-00002" />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/sign-in?next=%2Forders%2FTT-26-00002');
  });

  it('answers an order that is not on this account without confirming it exists', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: "We couldn't find that order.",
      fields: {},
      retryAfterSeconds: null,
    });
    render(<OrderRecord orderNumber="TT-26-00099" />);
    const heading = await screen.findByText(/no order with that number on your account/i);
    const text = heading.closest('div')?.textContent ?? '';
    // Nothing here distinguishes "does not exist" from "belongs to somebody
    // else" — order numbers are sequential, and a screen that told them apart
    // would let anyone with an account count our orders.
    expect(text).not.toMatch(/belongs to|another organisation|not permitted|forbidden/i);
  });

  it('says a failure is ours, and that the order is unaffected', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 0,
      code: 'NETWORK',
      message: 'anything',
      fields: {},
      retryAfterSeconds: null,
    });
    render(<OrderRecord orderNumber="TT-26-00002" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('That is our problem, not yours');
    expect(alert.textContent).toContain('the order itself is unaffected');
    expect(alert.textContent).toContain('nothing has been charged');
  });
});
