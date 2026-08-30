/**
 * The things about the order board that would be silently wrong on it.
 *
 * None of these is a "the table renders" assertion. Each one attempts the
 * failure the task exists to prevent and expects the refusal:
 *
 * 1. **The board must reproduce itself from the URL alone.** That is the whole
 *    of CLAUDE.md's rule — a buyer sends a colleague a link and it shows what
 *    they saw. So the test hands the component nothing but a query string and
 *    demands that the request, the search box, the applied chips, the ticked
 *    facet, the sort control and the header's `aria-sort` all agree with it,
 *    and that a second query string with none of the first's values leaves
 *    nothing of the first behind. A component holding board state locally
 *    passes the first half and fails the second.
 * 2. **No vendor identifier, anywhere, at any depth**, swept with the same
 *    `findVendorIdentityLeaks` the API's own anonymity tests use.
 * 3. **No purchase-order vocabulary of ours.** Our PO to a supply point is
 *    vendor-and-admin-only (PHASE_06 Task 6). The buyer's OWN reference is a
 *    different document belonging to a different party and it IS on the board,
 *    so the test has to tell the two apart rather than banning the letters "PO".
 *
 * Plus the absences that are easy to turn into claims: a missing PO reference
 * and a row that matched on a serial.
 */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { OrdersBoard } from './OrdersBoard';
import type { OrderList, OrderSummary } from '../api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getOrders: jest.fn(),
}));

import { getOrders } from '../api';

const mockGet = getOrders as jest.MockedFunction<typeof getOrders>;

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

const HELD: OrderSummary = {
  orderNumber: 'TT-26-00004',
  status: 'AWAITING_APPROVAL',
  paymentStatus: 'PENDING',
  placedAt: '2026-08-29T21:28:25.293Z',
  buyerPoNumber: null,
  costCentre: null,
  grandTotal: '307942.24',
  unitsAllocated: 6,
  deliverySiteLabel: 'Gurugram IT campus',
  deliveryCity: 'Gurugram',
  matchedSerials: [],
  approval: {
    status: 'PENDING',
    approverName: 'Suresh Pillai',
    expiresAt: '2026-08-30T21:28:25.288Z',
  },
};

const PLACED: OrderSummary = {
  orderNumber: 'TT-26-00002',
  status: 'PAYMENT_PENDING',
  paymentStatus: 'PENDING',
  placedAt: '2026-08-29T21:23:28.653Z',
  buyerPoNumber: 'PO/2026/00417',
  costCentre: 'IT — Delhi office',
  grandTotal: '152217.64',
  unitsAllocated: 3,
  deliverySiteLabel: 'New Delhi head office',
  deliveryCity: 'New Delhi',
  matchedSerials: [],
  approval: null,
};

const SITE_ID = '28e9dee9-59e2-4593-aa30-ece6aeaf057d';

const list = (over: Partial<OrderList> = {}): OrderList => ({
  orders: [HELD, PLACED],
  total: 13,
  page: 1,
  per: 10,
  pages: 2,
  facets: {
    status: [
      { value: 'AWAITING_APPROVAL', label: 'Awaiting approval', count: 4 },
      { value: 'PAYMENT_PENDING', label: 'Placed · payment pending', count: 9 },
    ],
    site: [
      { value: SITE_ID, label: 'Gurugram IT campus', count: 7 },
      { value: '46b82482-75aa-434f-8b6b-d7f29ee0cbda', label: 'New Delhi head office', count: 6 },
    ],
  },
  ...over,
});

const show = async (query: string, data: OrderList = list()): Promise<void> => {
  mockGet.mockResolvedValue({ ok: true, data });
  render(<OrdersBoard query={query} />);
  await screen.findByRole('table');
};

beforeEach(() => {
  mockGet.mockReset();
  push.mockReset();
});

afterEach(cleanup);

/* ==========================================================================
 * 1. The board is its URL
 * ======================================================================== */

describe('the board reproduces its state from the URL alone', () => {
  const QUERY = 'q=TGD88B6C311&status=AWAITING_APPROVAL&site=' + SITE_ID + '&sort=value&page=2&per=25';

  it('asks the server for exactly what the address bar says, unchanged', async () => {
    await show(QUERY);
    // Not "was called" — called with THAT string. A board that reconstructed
    // the query from its own state would pass a subtly different one.
    expect(mockGet).toHaveBeenCalledWith(QUERY);
  });

  it('shows the search term, the chips, the tick, the sort and the header arrow', async () => {
    await show(QUERY);

    expect(screen.getByLabelText('Find an order')).toHaveValue('TGD88B6C311');

    // One chip per applied filter, each in the facet's own words.
    expect(screen.getByRole('button', { name: /“TGD88B6C311”/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Awaiting approval/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gurugram IT campus/ })).toBeInTheDocument();

    expect(screen.getByRole('checkbox', { name: /Awaiting approval/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Placed · payment pending/ })).not.toBeChecked();

    expect(screen.getByLabelText('Sort')).toHaveValue('value');
    expect(screen.getByRole('columnheader', { name: /Order value/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  /**
   * The half a component with local state would fail.
   *
   * Re-rendering with a query that shares nothing with the first must leave
   * nothing of the first on screen — including the uncontrolled search input,
   * which keeps whatever was typed into it across a navigation unless it is
   * re-keyed.
   */
  it('keeps nothing from the board before it', async () => {
    await show(QUERY);
    cleanup();

    mockGet.mockResolvedValue({ ok: true, data: list() });
    render(<OrdersBoard query="sort=oldest" />);
    await screen.findByRole('table');

    expect(screen.getByLabelText('Find an order')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /“TGD88B6C311”/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Awaiting approval/ })).not.toBeChecked();
    expect(screen.getByLabelText('Sort')).toHaveValue('oldest');
    expect(screen.getByRole('columnheader', { name: /^Order$/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('puts every control change back into the URL rather than into itself', async () => {
    await show('');

    screen.getByRole('checkbox', { name: /Awaiting approval/ }).click();
    expect(push).toHaveBeenCalledWith('/account/orders?status=AWAITING_APPROVAL', {
      scroll: false,
    });
  });

  /** A facet that would return nothing is disabled and dimmed, never hidden. */
  it('disables a zero-count option instead of removing it', async () => {
    const zero = list();
    zero.facets.status[1] = { ...zero.facets.status[1]!, count: 0 };
    await show('status=AWAITING_APPROVAL', zero);

    const option = screen.getByRole('checkbox', { name: /Placed · payment pending/ });
    expect(option).toBeInTheDocument();
    expect(option).toBeDisabled();
  });
});

/* ==========================================================================
 * 2 and 3. Anonymity, and whose purchase order this is
 * ======================================================================== */

describe('nothing about a supplier reaches this board', () => {
  it('leaks no field of the vendor behind a held order', async () => {
    await show('');
    expect(findVendorIdentityLeaks(document.body.innerHTML, VENDOR)).toEqual([]);
  });

  it("shows the buyer's own PO reference and names no purchase order of ours", async () => {
    await show('');

    // Theirs is on screen, under a heading that says whose it is.
    expect(screen.getByRole('columnheader', { name: 'Your PO reference' })).toBeInTheDocument();
    expect(screen.getByText('PO/2026/00417')).toBeInTheDocument();

    const text = (document.body.textContent ?? '').toLowerCase();
    for (const word of ['purchase order', 'vendor', 'supplier', 'sub-order']) {
      expect(text).not.toContain(word);
    }
    // Every mention of a PO on this screen is possessive and the possessive is
    // "your". An unqualified "PO reference" is the first step to ours appearing
    // beside it.
    for (const match of text.matchAll(/.{0,12}po reference/g)) {
      expect(match[0]).toContain('your ');
    }
    for (const link of Array.from(document.querySelectorAll('a'))) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/purchase|vendor|supplier/i);
    }
  });
});

/* ==========================================================================
 * Absences that must not become claims
 * ======================================================================== */

it('renders a missing PO reference as an absence, never as a blank cell', async () => {
  await show('');
  const row = screen.getByRole('row', { name: /TT-26-00004/ });
  const cell = within(row).getByText('None given');
  expect(cell).toHaveClass('notmeasured');
});

it('says which serial matched, so a serial search has a visible reason', async () => {
  await show('q=TGD88B6C311', list({ orders: [{ ...HELD, matchedSerials: ['TGD88B6C311'] }], total: 1, pages: 1 }));
  expect(screen.getByText(/matched TGD88B6C311/)).toBeInTheDocument();
});

/* ==========================================================================
 * The states that are not the board
 * ======================================================================== */

it('tells a filtered-empty board apart from an account with no orders', async () => {
  mockGet.mockResolvedValue({ ok: true, data: list({ orders: [], total: 0, pages: 1 }) });
  render(<OrdersBoard query="q=TT-26-09999" />);
  await screen.findByText('No order on your account matches that');

  cleanup();
  mockGet.mockResolvedValue({ ok: true, data: list({ orders: [], total: 0, pages: 1 }) });
  render(<OrdersBoard query="" />);
  // No filters applied, so "nothing matched" would be a statement about the
  // filters and the truth is a statement about the account.
  await screen.findByText('No orders yet');
});

it('sends a signed-out visitor back to this board', async () => {
  mockGet.mockResolvedValue({
    ok: false,
    status: 401,
    code: 'UNAUTHORIZED',
    message: 'no session',
    fields: {},
    retryAfterSeconds: null,
  });
  render(<OrdersBoard query="" />);

  const link = await screen.findByRole('link', { name: 'Sign in' });
  expect(link).toHaveAttribute('href', '/sign-in?next=%2Faccount%2Forders');
});

it('says a failure is ours and that nothing was charged', async () => {
  mockGet.mockResolvedValue({
    ok: false,
    status: 0,
    code: 'NETWORK',
    message: 'unused — the screen has its own words for a lost network',
    fields: {},
    retryAfterSeconds: null,
  });
  render(<OrdersBoard query="" />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('our problem, not yours');
  expect(alert).toHaveTextContent('nothing has been charged');
});
