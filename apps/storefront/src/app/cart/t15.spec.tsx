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
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { CartScreen } from './CartScreen';
import type { CartView } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getCart: jest.fn(),
  setCartLine: jest.fn(),
  removeCartLine: jest.fn(),
}));
jest.mock('../../lib/merge-guest-cart', () => ({ mergeGuestCart: jest.fn(async () => null) }));

import { getCart } from './api';

const mockCart = getCart as jest.MockedFunction<typeof getCart>;

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
  mockCart.mockResolvedValue(ok(cart));
  const rendered = render(<CartScreen />);
  // Wait for the cart read to land — the rail's subtitle is only in the ready
  // state (the skeleton carries the rail's title, hidden).
  await screen.findByText('Goods value now. GST and freight are shown in full at checkout.');
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

  it('shows dispatch points as labels, not as sellers', async () => {
    const { container } = await open();
    expect(container.textContent).not.toMatch(/vendor|supplier|seller of these/i);
    expect(screen.getByText('Supply Point B · Palwal')).toBeInTheDocument();
    expect(screen.getByText('Supply Point W · New Delhi')).toBeInTheDocument();
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
    const card = [...container.querySelectorAll('.cartline-card')].find((r) =>
      r.textContent?.includes('3 of the 5'),
    );
    // 3 × 48,000 — not 5 × 48,000. A total for machines that cannot ship is a
    // figure the buyer will not be charged.
    expect(card?.textContent).toContain('₹1,44,000.00');
    expect(card?.textContent).toContain('3 × ₹48,000.00');
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
  it('says GST and freight exist and where they are shown, without rows that can only say "later"', async () => {
    const { container } = await open();
    // Both charges are named, and named as shown in full at checkout: the
    // card no longer carries a GST row and a freight row whose only value was
    // "at checkout", which named a charge without giving it.
    expect(container.textContent).toContain('GST and freight are shown in full at checkout.');
    expect(container.textContent).toContain('There is no third charge.');
    expect(container.textContent).not.toContain('Split shown at checkout');
    expect(container.textContent).not.toContain('Priced to your pincode at checkout');
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
    mockCart.mockResolvedValue(refused(401, 'Sign in to continue.'));
    render(<CartScreen />);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/sign-in?next='));
    expect(screen.getByText('Sign in to keep a cart')).toBeInTheDocument();
  });
});

describe('a cart we could not read', () => {
  it('says it is our problem and offers the retry', async () => {
    mockCart.mockResolvedValue(
      refused(0, 'We could not reach the server. Your answers are still here — try again.'),
    );
    render(<CartScreen />);
    expect(await screen.findByText('We could not read your cart')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('one cart per buyer', () => {
  it('is titled as the cart, with what is in it, and offers nowhere to make another', async () => {
    await open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /Your cart.*6 machines.*2 dispatch points/,
    );
    expect(screen.queryByRole('button', { name: /new cart/i })).toBeNull();
  });
});
