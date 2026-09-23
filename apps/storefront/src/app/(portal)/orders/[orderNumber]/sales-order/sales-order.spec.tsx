/**
 * The sales order tab, in its three states.
 *
 * What would be silently wrong on it: a total drawn while a dispatch point is
 * still to answer; an unanswered line drawn as a quantity; the word "vendor"
 * anywhere; and a pay control that looks live when nothing behind it is.
 */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SalesOrder } from './SalesOrder';
import type { SalesOrder as View, SalesOrderLine } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getSalesOrder: jest.fn(),
}));

import { getSalesOrder } from './api';
const mockGet = getSalesOrder as jest.MockedFunction<typeof getSalesOrder>;

const line = (over: Partial<SalesOrderLine> = {}): SalesOrderLine => ({
  label: 'Supply Point A · Gurugram',
  title: 'Lenovo ThinkPad T14 Gen 2',
  specSummary: 'Core i5 · 16 GB · 256 GB NVME_SSD · 14"',
  grade: 'A',
  qtyOrdered: 3,
  qtyConfirmed: 2,
  unitPrice: '33110.00',
  gstRatePct: 18,
  lineNet: '66220.00',
  lineGst: '11919.60',
  lineTotal: '78139.60',
  ...over,
});

const TAX = {
  interState: true,
  igst: '11973.24',
  cgst: '0.00',
  sgst: '0.00',
  stateTaxLabel: 'UTGST' as const,
  ratePct: 18,
  ourStateCode: '06',
  placeOfSupplyStateCode: '07',
  placeOfSupplyState: 'Delhi',
  basis: 's.10(1)(a) IGST Act — place of supply is where the movement terminates',
};

const READY: View = {
  orderNumber: 'TT-26-00002',
  state: 'READY',
  dispatchPoints: 1,
  dispatchPointsAnswered: 1,
  confirmedAt: '2026-09-23T08:00:00.000Z',
  lines: [line()],
  totals: { subtotal: '66220.00', freight: '298.00', tax: TAX, grandTotal: '78491.24' },
  payment: { mode: 'PREPAID', status: 'PENDING', payable: true },
};

const WAITING: View = {
  ...READY,
  state: 'WAITING',
  dispatchPoints: 2,
  dispatchPointsAnswered: 1,
  confirmedAt: null,
  lines: [
    line(),
    line({
      label: 'Supply Point W · New Delhi',
      qtyOrdered: 1,
      qtyConfirmed: null,
      lineNet: null,
      lineGst: null,
      lineTotal: null,
    }),
  ],
  totals: null,
  payment: { mode: 'PREPAID', status: 'PENDING', payable: false },
};

const shown = async (view: View): Promise<HTMLElement> => {
  mockGet.mockResolvedValue({ ok: true, data: view });
  const { container } = render(<SalesOrder orderNumber={view.orderNumber} />);
  await screen.findByRole('heading', { name: `Sales order · ${view.orderNumber}` });
  return container as HTMLElement;
};

afterEach(() => {
  cleanup();
  mockGet.mockReset();
});

describe('while a dispatch point is still to answer', () => {
  it('says it is waiting, prices nothing, and draws the unanswered line as an absence', async () => {
    const container = await shown(WAITING);
    const text = container.textContent ?? '';

    expect(screen.getByText('Waiting for the dispatch points to confirm')).toBeInTheDocument();
    expect(text).toContain('nothing has been charged');
    expect(screen.getByText('Total not available yet')).toHaveClass('notmeasured');
    // No grand total, no line total, no pay control.
    expect(text).not.toContain('₹78,491.24');
    expect(text).not.toContain('Line total');
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
    // The unanswered line — and the header's "confirmed on" — say so rather
    // than showing 0 or a date. Both are absences, in the absence style.
    const absences = screen.getAllByText('Not yet');
    expect(absences.length).toBeGreaterThanOrEqual(2);
    for (const el of absences) expect(el).toHaveClass('notmeasured');
  });
});

describe('once every dispatch point has answered', () => {
  it('prices the confirmed quantity, not the ordered one, and totals it with GST and freight', async () => {
    const container = await shown(READY);
    const text = container.textContent ?? '';

    expect(screen.getByText('What you will be invoiced for')).toBeInTheDocument();
    expect(text).toContain('₹78,139.60'); // 2 × 33,110 + 18%, not 3 ×
    expect(text).toContain('₹66,220.00'); // confirmed machines
    expect(text).toContain('₹298.00'); // freight
    expect(text).toContain('₹11,973.24'); // IGST on machines + freight
    expect(text).toContain('₹78,491.24'); // landed
    expect(text).toMatch(/can send 2 of the 3 you ordered/);
  });

  it('offers the payment as the one primary action, and is honest that it is not connected', async () => {
    await shown(READY);
    const pay = screen.getByRole('button', { name: 'Pay ₹78,491.24' });
    expect(pay).toHaveAttribute('title', expect.stringMatching(/not connected yet/));
  });

  it('shows a paid order as paid, with no pay control', async () => {
    await shown({ ...READY, payment: { mode: 'PREPAID', status: 'PAID', payable: false } });
    // Once as the payment fact, once as the pill where the button was.
    expect(screen.getAllByText('Paid').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
  });

  it('never puts a supplier on the screen', async () => {
    const container = await shown(READY);
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('vendor');
    expect(text).not.toContain('supplier');
    expect(text).toContain('supply point a · gurugram');
  });
});

describe('when every dispatch point refused', () => {
  it('says nothing is owed', async () => {
    const container = await shown({
      ...READY,
      state: 'CANCELLED',
      totals: null,
      lines: [line({ qtyConfirmed: 0, lineNet: '0.00', lineGst: '0.00', lineTotal: '0.00' })],
      payment: { mode: 'PREPAID', status: 'PENDING', payable: false },
    });
    expect(screen.getByText('Every dispatch point turned this order down')).toBeInTheDocument();
    expect(screen.getByText('Nothing is owed')).toBeInTheDocument();
    expect(container.textContent).not.toContain('₹78,491.24');
  });
});
