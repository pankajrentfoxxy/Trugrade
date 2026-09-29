import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../src/lib/auth';
import { OpsOrderRecordRoute } from '../src/routes/ops/OrderRecord';

/**
 * Assigning a technician from the order record books the visit.
 *
 * The card states the booking — who, which day, which slot — and the dialog it
 * opens asks for the same three facts the stock-visit dialog asks for, sending
 * them with the assignment so the visit lands on the Inspections, Visits and
 * Schedule boards with a day and an hour. These tests pin the card's reading of
 * a booked and an unbooked visit, the request the dialog sends, and that a slot
 * which ends before it starts is refused before any round trip.
 */

const RECORD = {
  orderNumber: 'TT-26-00039',
  status: 'QC_IN_PROGRESS',
  paymentStatus: 'PENDING',
  paymentMode: 'PREPAID',
  placedAt: '2026-09-28T10:00:00.000Z',
  buyer: { legalName: 'Acme Industries Pvt. Ltd.', tradeName: null },
  buyerGstin: '06AABCA1429B1Z8',
  placedByName: 'Farah Khan',
  placedByMobile: '+919854598621',
  buyerPoNumber: null,
  costCentre: null,
  shipTo: null,
  money: { subtotal: '50000.00', freight: '0.00', gstTotal: '9000.00', tcs: '0.00', grandTotal: '59000.00' },
  subOrders: [],
  purchaseOrders: [],
  approval: null,
  timeline: [],
  inspection: { visits: [], machines: 2, inspected: 0, verified: 0 },
  margin: null,
  marginUnavailable: 'No purchase order has been raised yet.',
  verifiedAt: null,
  payBy: null,
  paidAt: null,
};

const BOOKED = {
  ...RECORD,
  inspection: {
    ...RECORD.inspection,
    visits: [
      {
        visitId: 'v1',
        visitNumber: 'QCV-20260928-FD0569A7',
        status: 'TECH_ASSIGNED',
        technicianName: 'Rakesh Kumar',
        scheduledDate: '2026-09-30',
        slotFrom: '10:00',
        slotTo: '13:00',
        unitsRequested: 2,
        unitsInspected: 0,
      },
    ],
  },
};

const TECHS = [{ id: 't1', name: 'Rakesh Kumar', employeeCode: 'TECH-DEMO01', isActive: true }];
const LOADS = [{ technicianId: 't1', name: 'Rakesh Kumar', byDay: {}, openVisits: 5 }];

let posted: Array<{ url: string; body: Record<string, unknown> }> = [];

function mockApi(record: unknown = RECORD): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    const answer = (body: unknown): Promise<Response> =>
      Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    if (url.includes('/api/auth/session')) {
      return answer({
        userId: 'u1',
        orgId: 'o1',
        orgType: 'PLATFORM',
        roles: ['OPS_MANAGER'],
        permissions: ['ordering.any.read', 'qc.visit.schedule'],
        mfaRequired: false,
        fullName: 'Asha Menon',
      });
    }
    if (url.endsWith('/api/qc/order-inspections/assign')) {
      posted.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return answer({
        orderNumber: 'TT-26-00039',
        visits: [{ visitId: 'v1', visitNumber: 'QCV-20260928-FD0569A7', units: 2 }],
        technicianName: 'Rakesh Kumar',
      });
    }
    if (url.includes('/api/qc/technicians')) return answer(TECHS);
    if (url.includes('/api/qc/inspections/workload')) return answer(LOADS);
    if (url.includes('/api/ops/orders/')) return answer(record);
    return answer(null);
  });
}

async function drawCard(): Promise<HTMLElement> {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/orders/TT-26-00039']}>
        <Routes>
          <Route path="/orders/:orderNumber" element={<OpsOrderRecordRoute />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  return screen.findByTestId('assign-technician');
}

async function openDialog(user: ReturnType<typeof userEvent.setup>, name: string): Promise<HTMLElement> {
  const card = await drawCard();
  await user.click(within(card).getByRole('button', { name }));
  const dialog = await screen.findByRole('dialog');
  // The roster arrives after the dialog does.
  await within(dialog).findByText('Rakesh Kumar');
  return dialog;
}

afterEach(() => {
  vi.restoreAllMocks();
  posted = [];
});

describe('the technician card', () => {
  it('states the booking, day and slot included', async () => {
    mockApi(BOOKED);
    const card = await drawCard();
    expect(card.textContent).toContain('TechnicianRakesh Kumar');
    expect(card.textContent).toContain('Slot10:00–13:00');
    expect(within(card).getByText(/30 Sept? 2026/)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Reassign' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never dresses an unbooked visit up as booked', async () => {
    mockApi();
    const card = await drawCard();
    expect(within(card).getByText('Not assigned')).toBeTruthy();
    expect(within(card).getAllByText('Not booked')).toHaveLength(2);
    expect(within(card).getByRole('button', { name: 'Assign technician' })).toBeTruthy();
  });
});

describe('the dialog', () => {
  it('asks for the date and the slot, and sends them with the technician', async () => {
    mockApi();
    const user = userEvent.setup();
    const dialog = await openDialog(user, 'Assign technician');
    const date = within(dialog).getByLabelText(/^Date/) as HTMLInputElement;
    const from = within(dialog).getByLabelText(/Slot from/) as HTMLInputElement;
    const to = within(dialog).getByLabelText(/Slot to/) as HTMLInputElement;
    // Tomorrow by default, with a morning slot already in the boxes.
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from.value).toBe('10:00');
    expect(to.value).toBe('13:00');
    expect(dialog.textContent).toContain('TECH-DEMO01 · 0 that day · 5 open');

    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toEqual({
      orderNumber: 'TT-26-00039',
      technicianId: 't1',
      scheduledDate: date.value,
      slotFrom: '10:00',
      slotTo: '13:00',
    });
    expect(await screen.findByText(/Rakesh Kumar is assigned to the visit for TT-26-00039/)).toBeTruthy();
  });

  it('is titled for a reassignment when someone is already on the visit', async () => {
    mockApi(BOOKED);
    const user = userEvent.setup();
    const dialog = await openDialog(user, 'Reassign');
    expect(within(dialog).getByText('Reassign from Rakesh Kumar')).toBeTruthy();
  });

  it('refuses a slot that ends before it starts, without spending a round trip', async () => {
    mockApi();
    const user = userEvent.setup();
    const dialog = await openDialog(user, 'Assign technician');
    const to = within(dialog).getByLabelText(/Slot to/);
    await user.clear(to);
    await user.type(to, '09:00');
    expect(within(dialog).getByText('End time must be later than the start time.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(posted).toHaveLength(0);
  });
});
