import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VendorDashboardRoute } from './Dashboard';

const QUEUES = {
  gradeCorrections: { count: 4, oldestWaitHours: 70, breachedCount: 4, slaHours: 48 },
  awaitingInspection: { count: 9, oldestWaitHours: 31, breachedCount: null, slaHours: null },
};

const STOCKED = {
  unitsEverListed: 46,
  unitsAwaitingQc: 9,
  unitsLive: 30,
  liveListings: 12,
  unitsSoldThisMonth: 4,
  unitsQcExpiring14d: 2,
  posToAccept: 2,
  payoutsDue: '150000.00',
  payoutsDueOn: null,
  queues: QUEUES,
};

const ONBOARDING_VERIFIED = {
  orgId: 'org-test',
  status: 'VERIFIED',
  slaDueAt: null,
  slaBreached: false,
  decision: null,
  progress: {
    constitution: 'PRIVATE_LIMITED',
    steps: [{ stepCode: 'LEGAL', isRequired: true, status: 'COMPLETE', completionPct: 100 }],
    resumeAt: null,
    completedSteps: 1,
    requiredSteps: 1,
    isSubmittable: true,
  },
  answers: {},
};

const PAYABLES = {
  statement: {
    payables: 2,
    gross: '100000.00',
    tds: {
      amount: '1000.00',
      ratePct: 1,
      financialYearPurchases: '0',
      financialYear: '2026',
      reason: '',
      hasVerifiedPan: true,
    },
    penalties: '0.00',
    qcFees: '0.00',
    net: '99000.00',
  },
  rows: [],
  payoutsEver: 0,
  msme: { registered: false, udyamNumber: null, maxPaymentDays: 45 },
  inspectionWindowHours: 72,
  account: null,
};

function mockDashboard(body: unknown, ok = true): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/onboarding/steps')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ONBOARDING_VERIFIED,
      } as Response);
    }
    if (url.includes('/api/vendor/payables')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => PAYABLES,
      } as Response);
    }
    if (url.includes('/api/account/team')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ members: [], owners: 0, invites: [], facilities: [] }),
      } as Response);
    }
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
  });
}

const draw = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <VendorDashboardRoute />
    </MemoryRouter>,
  );

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('VendorDashboardRoute', () => {
  it('shows KPI strip and needs-you queue for verified vendors', async () => {
    mockDashboard(STOCKED);
    draw();
    expect(await screen.findByText('Live listings')).toBeTruthy();
    expect(screen.getByText('POs to accept')).toBeTruthy();
    expect(screen.getByText('Purchase orders to accept')).toBeTruthy();
    expect(screen.getByText('Grade corrections')).toBeTruthy();
  });

  it('shows profile gate before verification', async () => {
    mockDashboard(STOCKED);
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/onboarding/steps')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ...ONBOARDING_VERIFIED, status: 'REGISTERED' }),
        } as Response);
      }
      if (url.includes('/api/vendor/dashboard')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => STOCKED } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });
    draw();
    expect(await screen.findByText(/Profile .* complete/)).toBeTruthy();
  });

  describe('a seat that may not read onboarding (Ops, Finance, Viewer → 403)', () => {
    const mockSeat = (orgStatus: string): void => {
      vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        const reply = (status: number, body: unknown): Promise<Response> =>
          Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
        if (url.includes('/api/onboarding/steps')) return reply(403, { error: { message: 'no' } });
        if (url.includes('/api/account/profile')) return reply(200, { status: orgStatus });
        if (url.includes('/api/vendor/payables')) return reply(403, { error: { message: 'no' } });
        if (url.includes('/api/account/team')) return reply(403, { error: { message: 'no' } });
        return reply(200, STOCKED);
      });
    };

    it('gets the dashboard on a verified org instead of a skeleton that never resolves', async () => {
      mockSeat('VERIFIED');
      draw();
      expect(await screen.findByText('Live listings')).toBeTruthy();
      expect(
        await screen.findByText('Payouts are visible to the account owner and finance.'),
      ).toBeTruthy();
    });

    it('is told who can unlock an unverified org, not shown a checklist it cannot act on', async () => {
      mockSeat('REGISTERED');
      draw();
      expect(
        await screen.findByText(/Ask your account owner to finish the supplier profile/),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Open profile' })).toBeNull();
    });
  });

  it('shows error state when dashboard fails', async () => {
    mockDashboard({ error: { message: 'no' } }, false);
    draw();
    expect(await screen.findByText('Dashboard did not load')).toBeTruthy();
  });
});
