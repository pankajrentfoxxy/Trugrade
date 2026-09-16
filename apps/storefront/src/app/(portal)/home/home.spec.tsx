/**
 * The things about the home screen that would be silently wrong on it.
 *
 * None of these is a "the panel renders" assertion. Each one attempts the
 * failure the screen exists to prevent and expects the refusal:
 *
 * 1. **No number the API did not supply.** A dashboard is where invented
 *    metrics are most tempting and least visible. The test moves every figure
 *    in the payload and demands the KPI strip move with it, sweeps the strip
 *    for a percentage (there is none in the response), and proves the SLA is
 *    read off the row rather than typed into the file.
 * 2. **The one percentage on the screen carries its denominator.** Profile
 *    completion is computed here — from sections done out of sections there
 *    are — and it must say so beside the figure.
 * 3. **No vendor identifier, anywhere, at any depth.**
 * 4. **No approve or reject control**, because nothing on this screen can
 *    decide an approval.
 *
 * Plus the absence that is easy to turn into a claim: an account with no
 * orders renders as an account with no orders, not as four measured zeroes.
 */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { Home } from './Home';
import { PortalContext, type PortalState } from '../shell/PortalContext';
import type { OrderDashboard, Team } from '../api';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/home',
}));

jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  getDashboard: jest.fn(),
  getTeam: jest.fn(),
}));

import { getDashboard, getTeam } from '../api';

const mockGet = getDashboard as jest.MockedFunction<typeof getDashboard>;
const mockTeam = getTeam as jest.MockedFunction<typeof getTeam>;

/* ----------------------------------------------------------------- fixtures */

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

const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();
const agoHours = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

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

const TEAM: Team = {
  members: [
    {
      id: 'u1',
      fullName: 'Deepak Verma',
      email: 'owner@acme.example',
      mobile: '+919876543210',
      jobTitle: null,
      department: null,
      status: 'ACTIVE',
      isOrgOwner: true,
      roles: ['CUSTOMER_OWNER'],
      mfaEnabled: false,
      lastLoginAt: null,
      isYou: true,
      lockedReason: null,
    },
  ],
  roles: [],
  owners: 1,
};

/** Two of five sections complete. The screen must say "2 of 5" beside any percentage. */
const STATE: PortalState = {
  session: {
    userId: 'u1',
    orgId: 'o1',
    orgType: 'BUYER',
    roles: ['CUSTOMER_OWNER'],
    permissions: [],
    mfaRequired: false,
    fullName: 'Deepak Verma',
    email: 'owner@acme.example',
    mobile: '+919876543210',
  },
  profile: null,
  onboarding: {
    orgId: 'o1',
    status: 'REGISTERED',
    slaDueAt: null,
    slaBreached: false,
    decision: null,
    progress: {
      constitution: null,
      steps: [
        { stepCode: 'ACCOUNT', status: 'COMPLETE' },
        { stepCode: 'STATUTORY', status: 'COMPLETE' },
        { stepCode: 'BUSINESS_PROFILE', status: 'NOT_STARTED' },
        { stepCode: 'CONTACTS_ADDRESSES', status: 'NOT_STARTED' },
        { stepCode: 'DOCUMENTS', status: 'NOT_STARTED' },
      ].map((s, i) => ({
        ...s,
        stepOrder: i + 1,
        title: s.stepCode,
        purposeNote: '',
        estimatedMinutes: 1,
        isRequired: true,
        completionPct: s.status === 'COMPLETE' ? 100 : 0,
        blockingReason: null,
        lastSavedAt: null,
        fields: [],
      })),
      resumeAt: 'BUSINESS_PROFILE',
      completedSteps: 2,
      requiredSteps: 5,
      isSubmittable: false,
    },
    answers: {},
  } as unknown as PortalState['onboarding'],
  reload: () => undefined,
  setSession: () => undefined,
};

const show = async (data: OrderDashboard): Promise<HTMLElement> => {
  mockGet.mockResolvedValue({ ok: true, data });
  mockTeam.mockResolvedValue({ ok: true, data: TEAM });
  render(
    <PortalContext.Provider value={STATE}>
      <Home />
    </PortalContext.Provider>,
  );
  await screen.findByText('Needs you');
  return document.body;
};

beforeEach(() => {
  mockGet.mockReset();
  mockTeam.mockReset();
});

afterEach(cleanup);

/* ==========================================================================
 * 1. No number the API did not supply
 * ======================================================================== */

describe('every figure on the KPI strip came from the response', () => {
  it('moves when the response moves — the counts are read, not computed', async () => {
    const moved: OrderDashboard = {
      ...REAL,
      orders: 41,
      machines: 137,
      awaitingApproval: { orders: 2, value: '55555.00' },
      awaitingPayment: { orders: 39, value: '99999.00' },
    };
    const body = await show(moved);
    const strip = body.querySelector('.hub-strip')!;
    expect(strip).toHaveTextContent('41');
    expect(strip).toHaveTextContent('137');
    expect(strip).toHaveTextContent('₹55,555.00');
    expect(strip).toHaveTextContent('₹99,999.00');
    expect(strip).not.toHaveTextContent('46');
    expect(strip).not.toHaveTextContent('13,40,092.96');
    expect(strip).not.toHaveTextContent('12,13,140.94');
  });

  it('prints no percentage on the strip, because the response contains none to print', async () => {
    const body = await show(REAL);
    expect(body.querySelector('.hub-strip')!.textContent ?? '').not.toMatch(/\d\s?%/);
  });

  it('reads the SLA off the row rather than assuming twenty-four hours', async () => {
    const body = await show({
      ...REAL,
      approvalSlaHours: 12,
      approvals: [{ ...REAL.approvals[0]!, slaHours: 12 }],
    });
    expect(screen.getByTestId('held-orders')).toHaveTextContent('12');
    expect(body.textContent ?? '').not.toContain('24 hours');
  });

  it('shows no queue when nothing is waiting', async () => {
    await show({ ...REAL, approvals: [], approvalSlaHours: null, oldestApprovalWaitHours: null });
    await screen.findByText('Nothing is waiting on anybody');
    expect(screen.queryByTestId('held-orders')).not.toBeInTheDocument();
  });
});

/* ==========================================================================
 * 2. The one percentage carries its denominator
 * ======================================================================== */

it('says how many sections the profile percentage is out of', async () => {
  const body = await show(REAL);
  // Account alone, of the three cards that gate ordering: 30 of 100.
  //
  // The fixture has STATUTORY complete and BUSINESS_PROFILE not, and the Tax
  // card is responsible for both — so it is not done, and the percentage says
  // so. The denominator is three because Preferences is weight 0 and gates
  // nothing; counting it would put a card in the denominator that can never
  // move the number.
  const text = body.textContent ?? '';
  expect(text).toContain('30%');
  expect(text).toContain('1 of 3 sections');
});

/* ==========================================================================
 * 3. Anonymity
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

it('offers no approve or reject control, because nothing here can decide an approval', async () => {
  const body = await show(REAL);
  const buttons = Array.from(body.querySelectorAll('button')).map((b) => b.textContent ?? '');
  // The screen's one primary action is the way back to the shop.
  expect(buttons).toEqual(['Start purchasing']);
  const text = (body.textContent ?? '').toLowerCase();
  expect(text).not.toContain('approve this');
  expect(text).not.toContain('reject');
  expect(text).not.toContain('decline');
});

/* ==========================================================================
 * The absence that must not become a claim
 * ======================================================================== */

it('renders an account with no orders as no orders, not as four measured zeroes', async () => {
  const body = await show(EMPTY);
  await screen.findByText('No orders yet');
  expect(body.querySelector('.hub-strip')).not.toBeInTheDocument();
});

it('says a failure is ours and that the orders are unaffected', async () => {
  mockGet.mockResolvedValue({
    ok: false,
    status: 0,
    code: 'NETWORK',
    message: 'unused — the screen has its own words for a lost network',
    fields: {},
    retryAfterSeconds: null,
  });
  mockTeam.mockResolvedValue({ ok: true, data: TEAM });
  render(
    <PortalContext.Provider value={STATE}>
      <Home />
    </PortalContext.Provider>,
  );
  await screen.findByText('Your orders did not load');
  expect(document.body).toHaveTextContent('our problem, not yours');
});
