import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { OrderInspectionRoute } from '../src/routes/qc/OrderInspection';
import type { OrderInspectionView } from '../src/routes/qc/order-inspection-types';

/**
 * One inspection visit, asserted by what it says.
 *
 * The record has two readers: ops, who want to know what was recorded, when
 * and by whom; and the technician, who is recording. These tests pin that a
 * step that has not happened is drawn as not happened, that a machine with no
 * serial never carries a tick, that the two serial checks appear only once a
 * serial exists, that nobody types a serial here (the technician records it
 * on the inspection form), and that only a scheduler can assign.
 */

const T = (h: number, m: number): string => new Date(Date.UTC(2026, 8, 28, h - 5, m - 30)).toISOString();

const PERMS = { current: ['qc.visit.execute', 'qc.visit.schedule', 'ordering.any.read', 'procurement.po.read_any'] as readonly string[] };
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePrincipal: () => ({ permissions: PERMS.current }),
}));

const slot = (over: Partial<OrderInspectionView['slots'][number]>): OrderInspectionView['slots'][number] => ({
  slotId: 's',
  title: 'Microsoft Surface Pro 7',
  specSummary: 'i5-1035G4 · 16 GB · 256 GB NVMe SSD',
  grade: 'A',
  serialNumber: 'JHBD3D',
  inspectedAt: T(11, 12),
  verifiedAt: T(11, 16),
  ...over,
});

const DONE: OrderInspectionView = {
  visitId: 'v1',
  visitNumber: 'QCV-20260928-60B504E7',
  status: 'COMPLETED',
  orderNumber: 'TT-26-00038',
  vendorLegalName: 'Northgate IT Assets Pvt. Ltd.',
  site: { line1: 'Plot 14, Gurugram Industrial Area', city: 'Gurugram', pincode: '122001' },
  technicianId: 't1',
  technicianName: 'Rakesh Kumar',
  assignedAt: T(11, 7),
  assignedByName: 'Asha Menon',
  scheduledDate: '2026-09-28',
  startedAt: T(11, 9),
  completedAt: T(11, 12),
  verifiedAt: T(11, 16),
  verifiedByName: 'Asha Menon',
  purchaseOrderNumber: 'PO-26-00037',
  unitsRequested: 3,
  unitsInspected: 3,
  slots: [
    slot({ slotId: 'a', serialNumber: 'JHBD3D' }),
    slot({ slotId: 'b', serialNumber: 'HBSDC63S' }),
    slot({ slotId: 'c', serialNumber: 'GSDC634A' }),
  ],
};

const OPEN: OrderInspectionView = {
  ...DONE,
  visitId: 'v2',
  status: 'IN_PROGRESS',
  completedAt: null,
  verifiedAt: null,
  verifiedByName: null,
  purchaseOrderNumber: null,
  slots: [
    slot({ slotId: 'a', serialNumber: 'JHBD3D', verifiedAt: null }),
    slot({ slotId: 'b', serialNumber: null, inspectedAt: null, verifiedAt: null }),
  ],
};

function mockApi(body: OrderInspectionView): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/qc/order-inspections/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

const draw = (id: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[`/qc/orders/${id}`]}>
      <Routes>
        <Route path="/qc/orders/:visitId" element={<OrderInspectionRoute />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  PERMS.current = ['qc.visit.execute', 'qc.visit.schedule', 'ordering.any.read', 'procurement.po.read_any'];
});

describe('a completed visit', () => {
  it('heads the record with the visit, its stage and the order', async () => {
    mockApi(DONE);
    draw('v1');
    expect(await screen.findByRole('heading', { level: 1, name: /QCV/ })).toHaveTextContent('Inspection QCV-20260928-60B504E7');
    expect(screen.getByText('Completed')).toHaveClass('iv-pill--ok');
    const sub = screen.getByText(/For order/).closest('p')!;
    expect(sub.textContent).toBe('For order TT-26-00038 · 3 of 3 machines recorded and verified · visit closed');
    expect(within(sub).getByRole('link', { name: 'TT-26-00038' })).toHaveAttribute('href', '/orders/TT-26-00038');
  });

  it('draws all three steps done, with the server’s times and names', async () => {
    mockApi(DONE);
    draw('v1');
    const timeline = await screen.findByRole('list', { name: 'Visit timeline' });
    const items = within(timeline).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    for (const li of items) expect(li).toHaveClass('is-done');
    expect(items[0]?.textContent).toContain('28 Sep, 11:07 am · by Asha Menon');
    expect(items[1]?.textContent).toContain('11:12 am · by Rakesh Kumar · 5 min');
    expect(items[2]?.textContent).toContain('11:16 am · by Asha Menon');
  });

  it('lists every machine with its serial, both checks and a Verified pill', async () => {
    mockApi(DONE);
    draw('v1');
    await screen.findByRole('heading', { level: 1, name: /QCV/ });
    expect(screen.getAllByText('Verified')).toHaveLength(3);
    expect(screen.getAllByText('Unique')).toHaveLength(3);
    expect(screen.getAllByText('Not on stolen list')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Copy serial HBSDC63S' })).toBeTruthy();
    expect(screen.getByText('3 of 3 · all serials passed checks')).toBeTruthy();
    expect(screen.queryByLabelText('Serial number')).toBeNull();
  });

  it('names the technician, the supply point, the order and the purchase order in the side panel', async () => {
    mockApi(DONE);
    draw('v1');
    const side = (await screen.findByRole('heading', { name: 'Visit' })).closest('section')!;
    expect(within(side).getByText('RK')).toBeTruthy();
    expect(within(side).getByText('Rakesh Kumar')).toBeTruthy();
    expect(within(side).getByText('Northgate IT Assets')).toHaveAttribute('title', 'Northgate IT Assets Pvt. Ltd.');
    expect(within(side).getByRole('link', { name: 'PO-26-00037' })).toHaveAttribute('href', '/procurement/pos?q=PO-26-00037');
    expect(within(side).getByText(/Plot 14, Gurugram Industrial Area/)).toBeTruthy();
  });
});

describe('an open visit', () => {
  it('draws the unfinished steps as unfinished, and never ticks a machine without a serial', async () => {
    mockApi(OPEN);
    draw('v2');
    const timeline = await screen.findByRole('list', { name: 'Visit timeline' });
    const items = within(timeline).getAllByRole('listitem');
    expect(items[0]).toHaveClass('is-done');
    expect(items[1]).toHaveClass('is-current');
    expect(items[1]?.textContent).toContain('1 of 2 so far');
    expect(items[2]).toHaveClass('is-next');
    expect(items[2]?.textContent).toContain('After every serial is recorded');
    expect(screen.getByText('Inspection in progress')).toHaveClass('iv-pill--info');
    expect(screen.getAllByText('Unique')).toHaveLength(1);
    expect(screen.getByText('Recorded', { selector: '.iv-pill' })).toHaveClass('iv-pill--info');
    expect(screen.getByText('Not recorded', { selector: '.iv-pill' })).toHaveClass('iv-pill--neutral');
  });

  it('offers no serial box: the technician records on the inspection form', async () => {
    mockApi(OPEN);
    draw('v2');
    await screen.findByRole('heading', { level: 1, name: /QCV/ });
    expect(screen.queryByLabelText(/Serial number/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Record an inspection' })).toHaveAttribute('href', '/qc/visits/v2/inspect');
    expect(screen.getByText('None raised')).toBeTruthy();
    expect(screen.getByText(/1 still to record/)).toBeTruthy();
  });

  it('lets a scheduler assign or reassign the technician from the visit', async () => {
    mockApi(OPEN);
    draw('v2');
    await screen.findByRole('heading', { level: 1, name: /QCV/ });
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Reassign from Rakesh Kumar');
  });

  it('shows neither the assign button nor a form to a technician-only seat', async () => {
    PERMS.current = ['qc.visit.execute'];
    mockApi(OPEN);
    draw('v2');
    await screen.findByRole('heading', { level: 1, name: /QCV/ });
    expect(screen.queryByRole('button', { name: /Assign|Reassign/ })).toBeNull();
    expect(screen.queryByLabelText(/Serial number/)).toBeNull();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
  });
});
