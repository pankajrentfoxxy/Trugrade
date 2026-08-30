/**
 * The things about the dashboard that would be silently wrong on it.
 *
 * None of these is a "the panel renders" assertion. Each one attempts the
 * failure the task exists to prevent and expects the refusal:
 *
 * 1. **No number the API did not supply.** A dashboard is where invented
 *    metrics are most tempting and least visible, and this build has already
 *    had to strip fabricated counters off the homepage once. So the test moves
 *    every figure in the payload and demands the screen move with it, sweeps
 *    the rendered text for a percentage (there is no percentage in the response,
 *    so any on screen was computed here) and for the vocabulary of derived
 *    metrics, and — the sharp one — proves the 24-hour SLA is read off the row
 *    rather than typed into the file, by handing it a twelve-hour one.
 * 2. **No vendor identifier, anywhere, at any depth**, swept with the same
 *    `findVendorIdentityLeaks` the API's own anonymity tests use.
 * 3. **No purchase-order vocabulary of ours.** Our PO to a supply point is
 *    vendor-and-admin-only (PHASE_06 Task 6); nothing on a buyer screen may
 *    name one.
 * 4. **No button that cannot work.** Nothing in this product can decide an
 *    approval, so an approve or reject control on this screen would be a
 *    control that lies.
 *
 * Plus the absence that is easy to turn into a claim: an account with no orders
 * renders as an account with no orders, not as four measured zeroes.
 */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { Dashboard } from './Dashboard';
import type { OrderDashboard } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getDashboard: jest.fn(),
}));

import { getDashboard } from './api';

const mockGet = getDashboard as jest.MockedFunction<typeof getDashboard>;

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

/** An hour out, so the countdown has something true to say while the test runs. */
const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();
const agoHours = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

/** The seeded shape: 13 orders, 46 machines, 4 held, 9 placed and unpaid. */
const REAL: OrderDashboard = {
  orders: 13,
  machines: 46,
  awaitingApproval: { orders: 4, value: '1340092.96' },
  awaitingPayment: { orders: 9, value: '1213140.94' },
  approvals: [
    {
      orderNumber: 'TT-26-00004',
      approverName: 'Suresh Pillai',
      requestedByName: 'Farah Khan',
      requestedAt: agoHours(11),
      expiresAt: inHours(13),
      orderValue: '307942.24',
      unitsHeld: 6,
      slaHours: 24,
      breached: false,
    },
  ],
  oldestApprovalWaitHours: 11,
  approvalSlaHours: 24,
};

const EMPTY: OrderDashboard = {
  orders: 0,
  machines: 0,
  awaitingApproval: { orders: 0, value: '0.00' },
  awaitingPayment: { orders: 0, value: '0.00' },
  approvals: [],
  oldestApprovalWaitHours: null,
  approvalSlaHours: null,
};

const show = async (data: OrderDashboard): Promise<HTMLElement> => {
  mockGet.mockResolvedValue({ ok: true, data });
  render(<Dashboard />);
  // The heading is server-rendered; the figures arrive after the read resolves.
  await screen.findByText('What is on order');
  return document.body;
};

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(cleanup);

/* ==========================================================================
 * 1. No number the API did not supply
 * ======================================================================== */

describe('every figure on the dashboard came from the response', () => {
  it('moves when the response moves — the counts are read, not computed', async () => {
    const moved: OrderDashboard = {
      ...REAL,
      orders: 41,
      machines: 137,
      awaitingApproval: { orders: 2, value: '55555.00' },
      awaitingPayment: { orders: 39, value: '99999.00' },
    };
    await show(moved);

    // Read off the KPI row itself rather than the page, because an order
    // number three sections down contains every digit in the alphabet and a
    // whole-page string match would pass on a coincidence.
    const tiles = screen.getByTestId('kpi-row');
    expect(tiles).toHaveTextContent('41');
    expect(tiles).toHaveTextContent('137');
    expect(tiles).toHaveTextContent('₹55,555.00');
    expect(tiles).toHaveTextContent('₹99,999.00');
    // None of the seeded figures survives anywhere on the row: nothing is
    // cached, defaulted or recomputed from a constant.
    expect(tiles).not.toHaveTextContent('46');
    expect(tiles).not.toHaveTextContent('13,40,092.96');
    expect(tiles).not.toHaveTextContent('12,13,140.94');
  });

  it('prints no percentage, because the response contains none to print', async () => {
    const body = await show(REAL);
    // A percentage on this screen could only have been divided here — and a
    // percentage without its denominator is banned besides.
    expect(body.textContent ?? '').not.toMatch(/\d\s?%/);
  });

  it('prints no derived metric vocabulary', async () => {
    const body = await show(REAL);
    const text = (body.textContent ?? '').toLowerCase();
    for (const phrase of [
      'average',
      'per order',
      'per month',
      'this month',
      'last month',
      'vs ',
      'trend',
      'on track',
      'total spend',
    ]) {
      expect(text).not.toContain(phrase);
    }
  });

  /**
   * The sharp one. `order_approval.expires_at` defaults to 24 hours after the
   * request, but a default is not a law: the service measures the window off
   * the row. A screen that had typed 24 into itself would print 24 here.
   */
  it('reads the SLA off the row rather than assuming twenty-four hours', async () => {
    const body = await show({
      ...REAL,
      approvalSlaHours: 12,
      approvals: [{ ...REAL.approvals[0]!, slaHours: 12 }],
    });
    expect(body).toHaveTextContent('12');
    expect(body.textContent ?? '').not.toContain('24 hours');
  });

  /** And with nothing pending there is no window at all, so no number for one. */
  it('shows no SLA and no queue when nothing is waiting', async () => {
    mockGet.mockResolvedValue({
      ok: true,
      data: { ...REAL, approvals: [], approvalSlaHours: null, oldestApprovalWaitHours: null },
    });
    render(<Dashboard />);
    await screen.findByText('Nothing is waiting on anybody');

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('SLA');
    expect(text).not.toContain('past SLA');
    expect(screen.queryByText('The orders being held')).not.toBeInTheDocument();
  });
});

/* ==========================================================================
 * 2 and 3. Anonymity, and our purchase order
 * ======================================================================== */

describe('nothing about a supplier reaches this screen', () => {
  it('leaks no field of the vendor behind a held order', async () => {
    const body = await show(REAL);
    expect(findVendorIdentityLeaks(body.innerHTML, VENDOR)).toEqual([]);
  });

  it('names no purchase order of ours, and offers no route to one', async () => {
    const body = await show(REAL);
    const text = (body.textContent ?? '').toLowerCase();
    for (const word of ['purchase order', 'vendor', 'supplier', 'sub-order', 'seller ']) {
      expect(text).not.toContain(word);
    }
    for (const link of Array.from(body.querySelectorAll('a'))) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/purchase|vendor|supplier/i);
    }
  });
});

/* ==========================================================================
 * 4. No control that cannot work
 * ======================================================================== */

it('offers no approve or reject control, because nothing can decide an approval', async () => {
  const body = await show(REAL);
  expect(body.querySelectorAll('button')).toHaveLength(0);
  const text = (body.textContent ?? '').toLowerCase();
  expect(text).not.toContain('approve this');
  expect(text).not.toContain('reject');
  expect(text).not.toContain('decline');
});

/* ==========================================================================
 * The absence that must not become a claim
 * ======================================================================== */

it('renders an account with no orders as no orders, not as four measured zeroes', async () => {
  mockGet.mockResolvedValue({ ok: true, data: EMPTY });
  render(<Dashboard />);
  await screen.findByText('No orders yet');

  // Not a KPI row of zeroes: zero orders and no orders are different facts, and
  // four tiles reading 0 is a screen that measured something.
  expect(screen.queryByTestId('kpi-row')).not.toBeInTheDocument();
  expect(screen.queryByTestId('queue-list')).not.toBeInTheDocument();
});

/* ==========================================================================
 * The states that are not the workspace
 * ======================================================================== */

it('sends a signed-out visitor back here, rather than reporting a failure', async () => {
  mockGet.mockResolvedValue({
    ok: false,
    status: 401,
    code: 'UNAUTHORIZED',
    message: 'no session',
    fields: {},
    retryAfterSeconds: null,
  });
  render(<Dashboard />);

  const link = await screen.findByRole('link', { name: 'Sign in' });
  expect(link).toHaveAttribute('href', '/sign-in?next=%2Faccount');
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
  render(<Dashboard />);

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('our problem, not yours');
  expect(alert).toHaveTextContent('nothing has been charged');
});
