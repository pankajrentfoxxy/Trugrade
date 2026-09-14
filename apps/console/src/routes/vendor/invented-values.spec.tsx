import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VendorPayoutsRoute } from './Payouts';
import { VendorPayablesRoute } from './Payables';

/** A screen that shows a number it did not compute teaches people to distrust the real ones. */

const statement = {
  payables: 2,
  gross: '100000.00',
  tds: {
    amount: '100.00',
    ratePct: 0.1,
    financialYearPurchases: '0',
    financialYear: '2026-27',
    reason: '',
    hasVerifiedPan: true,
  },
  penalties: '0.00',
  qcFees: '0.00',
  net: '99900.00',
};

function mock(payables: { status: number; body: unknown }): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const reply = (status: number, body: unknown): Promise<Response> =>
      Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
    if (url.includes('/api/onboarding/steps'))
      return reply(200, { status: 'VERIFIED', progress: { steps: [] }, answers: {} });
    if (url.includes('/api/vendor/payables')) return reply(payables.status, payables.body);
    return reply(200, {});
  });
}

const draw = (ui: React.ReactElement): void => {
  render(<MemoryRouter>{ui}</MemoryRouter>);
};

afterEach(() => vi.restoreAllMocks());

describe('no invented values on the payout screens', () => {
  it('Payouts shows the run count the API returned, never a typed "0 of 0"', async () => {
    mock({
      status: 200,
      body: {
        statement,
        rows: [],
        payoutsEver: 3,
        msme: { registered: false, udyamNumber: null, maxPaymentDays: 45 },
        inspectionWindowHours: 72,
        account: null,
      },
    });
    draw(<VendorPayoutsRoute />);

    expect(await screen.findByText('Payout runs')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/of 0 issued|of ₹0 accrued/);
  });

  it('Payouts says plainly when nothing has been paid', async () => {
    mock({
      status: 200,
      body: {
        statement,
        rows: [],
        payoutsEver: 0,
        msme: { registered: false, udyamNumber: null, maxPaymentDays: 45 },
        inspectionWindowHours: 72,
        account: null,
      },
    });
    draw(<VendorPayoutsRoute />);

    expect(await screen.findByText('No payout runs yet')).toBeTruthy();
    expect(screen.queryByText('Payout runs')).toBeNull();
  });

  it('Payables refusal names who has access, not demo logins', async () => {
    mock({ status: 403, body: { error: { message: 'no' } } });
    draw(<VendorPayablesRoute />);

    const body = await screen.findByText(/Payables are visible to the account owner and finance/);
    expect(body.textContent).not.toMatch(/@northgate\.example/);
  });
});
