/**
 * The sales order tab, in its states under the order-first flow.
 *
 * What would be silently wrong on it: a total drawn while a machine is still to
 * be verified; a machine nobody has verified drawn as a priced quantity; the
 * word "vendor" anywhere; a pay control on a paid order; and a paid order that
 * does not say so.
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
  qtyInspected: 3,
  qtyVerified: 2,
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

/** Every machine verified, the deadline set, nothing paid yet. */
const READY: View = {
  orderNumber: 'TT-26-00002',
  state: 'READY',
  stage: 'PAYMENT',
  machines: { ordered: 3, inspected: 3, verified: 2 },
  dispatchPoints: 1,
  verifiedAt: '2026-09-23T08:00:00.000Z',
  payBy: '2099-09-24T08:00:00.000Z',
  paidAt: null,
  lines: [line()],
  totals: { subtotal: '66220.00', freight: '298.00', tax: TAX, grandTotal: '78491.24' },
  payment: { mode: 'PREPAID', status: 'PENDING', payable: true },
};

const PAID: View = {
  ...READY,
  stage: 'PAID',
  paidAt: '2026-09-23T09:10:00.000Z',
  payment: { mode: 'PREPAID', status: 'PAID', payable: false },
};

/** The technician has named one machine of three; nothing is verified. */
const WAITING: View = {
  ...READY,
  state: 'WAITING',
  stage: 'INSPECTION',
  machines: { ordered: 4, inspected: 1, verified: 0 },
  dispatchPoints: 2,
  verifiedAt: null,
  payBy: null,
  lines: [
    line({ qtyInspected: 1, qtyVerified: 0, qtyConfirmed: null, lineNet: null, lineGst: null, lineTotal: null }),
    line({
      label: 'Supply Point W · New Delhi',
      qtyOrdered: 1,
      qtyInspected: 0,
      qtyVerified: 0,
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

describe('while the machines are still being inspected and verified', () => {
  it('says where they are, prices nothing, and draws the verification date as an absence', async () => {
    const container = await shown(WAITING);
    const text = container.textContent ?? '';

    expect(screen.getByText('Waiting for every machine to be verified')).toBeInTheDocument();
    expect(text).toContain('1 of 4 machines have a serial recorded');
    expect(text).toContain('nothing has been charged');
    expect(screen.getByText('Total not available yet')).toHaveClass('notmeasured');
    // No grand total, no line total, no pay control, no talk of dispatch points answering.
    expect(text).not.toContain('₹78,491.24');
    expect(text).not.toContain('Line total');
    expect(text).not.toContain('confirm');
    expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
    for (const el of screen.getAllByText('Not yet')) expect(el).toHaveClass('notmeasured');
  });
});

describe('once every machine is verified', () => {
  it('prices the verified quantity, not the ordered one, and totals it with GST and freight', async () => {
    const container = await shown(READY);
    const text = container.textContent ?? '';

    expect(screen.getByText('What you will be invoiced for')).toBeInTheDocument();
    expect(text).toContain('₹78,139.60'); // 2 × 33,110 + 18%, not 3 ×
    expect(text).toContain('₹66,220.00'); // verified machines
    expect(text).toContain('₹298.00'); // freight
    expect(text).toContain('₹11,973.24'); // IGST on machines + freight
    expect(text).toContain('₹78,491.24'); // landed
    expect(text).toMatch(/2 of the 3 you ordered were verified/);
  });

  it('offers the payment as the one primary action, with the deadline beside it', async () => {
    const container = await shown(READY);
    const pay = screen.getByRole('button', { name: /Pay.*78,491\.24/ });
    expect(pay).toBeEnabled();
    expect(container.textContent).toContain('Pay by');
  });

  it('shows a paid order as paid, with when, and no pay control', async () => {
    const container = await shown(PAID);
    expect(screen.getAllByText('Paid').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('Total paid');
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

describe('when the order was cancelled', () => {
  it('says nothing is owed', async () => {
    const container = await shown({
      ...READY,
      state: 'CANCELLED',
      stage: 'CANCELLED',
      totals: null,
      lines: [line({ qtyVerified: 0, qtyConfirmed: 0, lineNet: '0.00', lineGst: '0.00', lineTotal: '0.00' })],
      payment: { mode: 'PREPAID', status: 'PENDING', payable: false },
    });
    expect(screen.getByText('This order was cancelled')).toBeInTheDocument();
    expect(screen.getByText('Nothing is owed')).toBeInTheDocument();
    expect(container.textContent).not.toContain('₹78,491.24');
  });
});
