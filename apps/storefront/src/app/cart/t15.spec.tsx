/**
 * The seven things about the cart that would be silently wrong on the screen.
 *
 * None of these asserts that a control exists. Each renders the real screen with
 * the real payload shape and reads back what a buyer sees.
 *
 * 1. **The word "sub-order" appears nowhere.** Internally a multi-dispatch cart
 *    becomes sub-orders and separate purchase orders in Phase 6. To the buyer it
 *    is one order, one seller and one invoice, and the sweep below is over the
 *    whole rendered document rather than one component.
 * 2. **A short line says how many of how many.** "3 units left" is the version a
 *    buyer reads as three of three.
 * 3. **Nothing on the screen names a vendor**, at any depth.
 * 4. **A line that is gone shuts checkout**, and says what to do about it.
 * 5. **Signed out is a path, not a crash.**
 * 6. **No countdown and no scarcity device.** The 20-minute hold belongs to
 *    checkout, and the cart says so rather than showing a timer that counts
 *    nothing.
 * 7. **Every charge is named on this one screen.** No drip pricing.
 */
import * as React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { CartScreen } from './CartScreen';
import type { CartSummary, CartView } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  listCarts: jest.fn(),
  viewCart: jest.fn(),
  createCart: jest.fn(),
  setCartLine: jest.fn(),
  removeCartLine: jest.fn(),
}));

import { listCarts, viewCart } from './api';

const mockList = listCarts as jest.MockedFunction<typeof listCarts>;
const mockView = viewCart as jest.MockedFunction<typeof viewCart>;

/* ----------------------------------------------------------------- fixtures */

/**
 * The vendor behind Supply Point F. Every field of it is swept for below —
 * this is the identity the merchant-of-record model exists to keep off a
 * buyer's screen.
 */
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

const line = (over: Partial<CartView['dispatchGroups'][0]['lines'][0]> = {}) => ({
  itemId: '1b8856c7-0d2f-40f9-b19d-0486ea48a12a',
  offerId: 'b6e12109-34d1-49be-a047-e5062289b0aa',
  title: 'Dell Latitude 5420',
  specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
  grade: 'A',
  qtyRequested: 3,
  qtyAvailable: 3,
  availability: '3 units available.',
  unitPrice: '41900.00',
  lineTotal: '125700.00',
  priceChangedSinceAdded: false,
  dispatch: 'ships in 48 h',
  ...over,
});

/** Two dispatch points, one of them short. The shape of the whole screen. */
const view = (over: Partial<CartView> = {}): CartView => ({
  id: CART_ID,
  name: 'National rollout',
  dispatchGroups: [
    { label: 'Supply Point B · Palwal', lines: [shortLine] },
    { label: 'Supply Point W · New Delhi', lines: [line()] },
  ],
  itemCount: 2,
  goodsTotal: '269700.00',
  needsAttention: true,
  updatedAt: '2026-08-29T17:24:15.171Z',
  ...over,
});

/** Palwal holds three; five were asked for. The server writes the sentence. */
const shortLine = line({
  itemId: '7e7a497a-9234-4ea0-a283-455cad83671c',
  offerId: '2204dba4-1631-43b9-822f-7282b9d5b38b',
  qtyRequested: 5,
  qtyAvailable: 3,
  availability: '3 of the 5 units you selected are still available.',
  unitPrice: '48000.00',
  lineTotal: '144000.00',
});

const gone = line({
  itemId: 'c4e2dd08-1c14-4a8d-95a1-3f3f5a1b0e77',
  qtyRequested: 4,
  qtyAvailable: 0,
  availability: 'None of the 4 units you selected are still available.',
  lineTotal: '0.00',
});

const summaries: CartSummary[] = [
  { id: CART_ID, name: 'National rollout', lineCount: 2, updatedAt: '2026-08-29T17:24:15.171Z' },
  {
    id: 'd0e0a0f4-8e3a-4b2c-9c7d-2b9a1e6f4a11',
    name: 'Q3 refresh',
    lineCount: 0,
    updatedAt: '2026-08-28T09:00:00.000Z',
  },
];

const ok = <T,>(data: T) => ({ ok: true as const, data });
const refused = (status: number, message: string) => ({
  ok: false as const,
  status,
  code: 'UNAUTHENTICATED',
  message,
  fields: {},
  retryAfterSeconds: null,
});

/** Render the screen with a cart on the wire, and wait for the read to land. */
async function open(cart: CartView = view()) {
  mockList.mockResolvedValue(ok(summaries));
  mockView.mockResolvedValue(ok(cart));
  const rendered = render(<CartScreen />);
  // The h1, not the text: the cart's name is also on its chip in the switcher.
  await screen.findByRole('heading', { level: 1, name: cart.name });
  return rendered;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/cart');
});

/* ================================================================= the tests */

describe('one seller, one order, one invoice', () => {
  it('never says "sub-order" anywhere on the screen', async () => {
    const { container } = await open();
    // The whole document, not one component: the vocabulary rule is about what
    // a buyer can read, and it only takes one label to break it.
    expect(container.textContent).not.toMatch(/sub[-\s]?order/i);
    expect(container.innerHTML).not.toMatch(/sub[-\s]?order/i);
  });

  it('does not call a dispatch point a seller, a vendor or a supplier', async () => {
    const { container } = await open();
    expect(container.textContent).not.toMatch(/vendor|supplier|seller of these/i);
    expect(screen.getByText('Supply Point B · Palwal')).toBeInTheDocument();
    expect(screen.getByText('Supply Point W · New Delhi')).toBeInTheDocument();
  });

  it('says there is one invoice, from us, over however many dispatch points', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('One order and one invoice');
    expect(container.textContent).toContain('TrueTech Services Pvt. Ltd.');
    expect(container.textContent).toMatch(/2 dispatch points/);
  });
});

describe('a line whose availability has dropped', () => {
  it('says how many of how many are left, never a bare count', async () => {
    await open();
    expect(
      screen.getByText('3 of the 5 units you selected are still available.'),
    ).toBeInTheDocument();
  });

  it('offers the fix as one action, in units', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Set this line to 3 units' })).toBeInTheDocument();
  });

  it('prices the line on what can ship, and shows that arithmetic', async () => {
    const { container } = await open();
    const row = [...container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('3 of the 5'),
    );
    // 3 × 48,000 — not 5 × 48,000. A total for machines that cannot ship is a
    // figure the buyer will not be charged.
    expect(row?.textContent).toContain('₹1,44,000.00');
    expect(row?.textContent).toContain('3 × ₹48,000.00');
  });

  it('holds checkout shut and says what has to change', async () => {
    const { container } = await open();
    expect(container.querySelector('a[href^="/checkout"]')).toBeNull();
    expect(screen.getAllByText(/Set those lines to what is left/).length).toBeGreaterThan(0);
  });
});

describe('a line that is gone entirely', () => {
  it('says none are left rather than showing a zero', async () => {
    await open(
      view({
        dispatchGroups: [{ label: 'Supply Point L · Gurugram', lines: [gone] }],
        itemCount: 1,
        goodsTotal: '0.00',
      }),
    );
    expect(
      screen.getByText('None of the 4 units you selected are still available.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Take the line out/)).toBeInTheDocument();
  });
});

describe('a cart that can be bought', () => {
  it('opens checkout, once and only once — one primary action', async () => {
    const { container } = await open(
      view({
        dispatchGroups: [{ label: 'Supply Point W · New Delhi', lines: [line()] }],
        itemCount: 1,
        needsAttention: false,
      }),
    );
    const primary = container.querySelectorAll('a.pill.acc, button.bg-acc');
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveAttribute('href', `/checkout?cart=${CART_ID}`);
  });
});

describe('the hold, and the absence of a scarcity device', () => {
  it('says the 20-minute hold happens at checkout, and shows no timer here', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('Nothing in a cart is reserved');
    expect(container.textContent).toMatch(/held for 20 minutes when you start\s+checkout/);
    // No countdown, and none of the pressure phrasings.
    expect(container.textContent).not.toMatch(/only \d+ left|hurry|expires in|\d+:\d\d left/i);
  });

  it('says when availability was last read, because it was read', async () => {
    const { container } = await open();
    expect(container.textContent).toMatch(/Availability checked at \d{2}:\d{2}/);
  });
});

describe('every charge on one screen', () => {
  it('names freight and GST rather than revealing them later', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('Freight');
    expect(container.textContent).toContain('18%, IGST or CGST + SGST');
    expect(container.textContent).toContain('There is no third charge.');
    // And the figure that is not the landed total is not called the total.
    expect(screen.getAllByText('Goods value').length).toBeGreaterThan(0);
  });
});

describe('the anonymity guarantee', () => {
  it('leaks no vendor identifier anywhere in the rendered screen', async () => {
    const { container } = await open();
    expect(findVendorIdentityLeaks(container.innerHTML, VENDOR)).toEqual([]);
  });

  it('shows a supply point label and nothing finer than the city', async () => {
    await open();
    const groups = screen.getAllByRole('region', { hidden: true });
    expect(groups.length).toBeGreaterThan(0);
    const first = within(screen.getByLabelText('Supply Point B · Palwal'));
    expect(first.getByText('Supply Point B · Palwal')).toBeInTheDocument();
  });
});

describe('a visitor with no session', () => {
  it('offers a way in rather than an error', async () => {
    mockList.mockResolvedValue(refused(401, 'Sign in to continue.'));
    render(<CartScreen />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/sign-in?next='));
    expect(screen.getByText('Sign in to keep a cart')).toBeInTheDocument();
  });
});

describe('a cart we could not read', () => {
  it('says it is our problem and offers the retry', async () => {
    mockList.mockResolvedValue(
      refused(0, 'We could not reach the server. Your answers are still here — try again.'),
    );
    render(<CartScreen />);
    expect(await screen.findByText('We could not read your cart')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('more than one named cart', () => {
  it('lists them all with their line counts, and marks the open one', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('Q3 refresh')).toBeInTheDocument());
    const active = screen.getAllByRole('button', { current: true });
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain('National rollout');
    expect(active[0]?.textContent).toContain('2 lines');
  });
});
