import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { OrderInspectionsRoute, elapsed, onDay, stageOf } from '../src/routes/qc/OrderInspections';
import type { OrderInspectionView } from '../src/routes/qc/order-inspection-types';

/**
 * The order-inspection queue, asserted by what it says.
 *
 * The screen derives four stages from a visit and its machines, because the
 * visit's own status stops at "completed" and verification happens on the
 * order. These tests pin that derivation and the sentences built on it — the
 * tile metas, the expanded row's three timestamps, and the per-machine result
 * — so a visit whose machines are recorded but unverified can never read as
 * done.
 */

const T = (h: number, m: number): string => new Date(Date.UTC(2026, 8, 28, h - 5, m - 30)).toISOString();

const slot = (over: Partial<OrderInspectionView['slots'][number]>): OrderInspectionView['slots'][number] => ({
  slotId: 's',
  title: 'Microsoft Surface Pro 7',
  specSummary: 'i5 · 8 GB · 256 GB SSD',
  grade: 'A',
  serialNumber: 'JHBD3D',
  inspectedAt: T(11, 12),
  verifiedAt: T(11, 16),
  ...over,
});

const visit = (over: Partial<OrderInspectionView>): OrderInspectionView => ({
  visitId: 'v1',
  visitNumber: 'QCV-20260928-60B504E7',
  status: 'COMPLETED',
  orderNumber: 'TT-26-00038',
  vendorLegalName: 'Northgate IT Assets Pvt. Ltd.',
  site: { line1: 'Plot 4', city: 'Gurugram', pincode: '122001' },
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
  ...over,
});

const DONE = visit({});
const UNVERIFIED = visit({
  visitId: 'v2',
  visitNumber: 'QCV-20260925-0D658F67',
  orderNumber: 'TT-26-00037',
  verifiedAt: null,
  verifiedByName: null,
  slots: [slot({ slotId: 'd', serialNumber: 'AAA111', verifiedAt: null }), slot({ slotId: 'e', serialNumber: 'BBB222', verifiedAt: null })],
});
const HALF = visit({
  visitId: 'v3',
  visitNumber: 'QCV-20260927-ABCDEF01',
  orderNumber: 'TT-26-00036',
  status: 'IN_PROGRESS',
  technicianName: 'Priya Nair',
  technicianId: 't2',
  completedAt: null,
  verifiedAt: null,
  verifiedByName: null,
  slots: [
    slot({ slotId: 'f', serialNumber: 'CCC333', verifiedAt: null }),
    slot({ slotId: 'g', serialNumber: null, inspectedAt: null, verifiedAt: null }),
  ],
});

function mockApi(body: OrderInspectionView[]): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/qc/order-inspections')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

function Probe(): React.JSX.Element {
  const loc = useLocation();
  return <output data-testid="url">{loc.pathname + loc.search}</output>;
}

const draw = (entry = '/qc/orders'): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <OrderInspectionsRoute />
      <Probe />
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('a visit is complete only when every machine is verified', () => {
  it('derives the stage from the visit and its machines', () => {
    expect(stageOf(DONE)).toBe('completed');
    expect(stageOf(UNVERIFIED)).toBe('verification');
    expect(stageOf(HALF)).toBe('progress');
    expect(stageOf(visit({ status: 'TECH_ASSIGNED' }))).toBe('waiting');
    expect(stageOf(visit({ status: 'CANCELLED' }))).toBe('cancelled');
  });

  it('counts the tiles over every visit and says what the count is made of', async () => {
    mockApi([DONE, UNVERIFIED, HALF]);
    draw();
    const tiles = await screen.findByRole('group', { name: 'Filter by stage' });
    const tile = (name: RegExp): HTMLElement => within(tiles).getByRole('button', { name });
    expect(tile(/Waiting for technician/).textContent).toContain('0');
    expect(tile(/Waiting for technician/).textContent).toContain('No visit assigned yet');
    expect(tile(/Inspection in progress/).textContent).toContain('1 of 2 machines recorded');
    expect(tile(/Waiting for verification/).textContent).toContain('2 machines to verify');
    expect(tile(/Completed/).textContent).toContain('3 machines verified');
  });

  it('never calls an unverified visit completed', async () => {
    mockApi([DONE, UNVERIFIED]);
    draw();
    const table = await screen.findByRole('table');
    const done = within(table).getByText('TT-26-00038').closest('tr');
    const unverified = within(table).getByText('TT-26-00037').closest('tr');
    expect(within(done!).getByText('Completed')).toHaveClass('oi-pill--ok');
    expect(within(unverified!).getByText('Waiting for verification')).toHaveClass('oi-pill--violet');
  });
});

describe('the expanded row', () => {
  it('opens under its row with the three timestamps and every machine', async () => {
    mockApi([DONE]);
    draw();
    await screen.findByRole('table');
    expect(screen.queryByText('Technician assigned')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show machines for TT-26-00038' }));
    const detail = screen.getByText('Technician assigned').closest('tr');
    expect(detail).toHaveClass('oi-detail');
    expect(detail?.textContent).toContain('11:07 amby Asha Menon');
    expect(detail?.textContent).toContain('11:12 amby Rakesh Kumar · 5 min');
    expect(detail?.textContent).toContain('11:16 amby Asha Menon · 4 min');
    const machines = within(detail!).getByRole('table');
    expect(within(machines).getAllByText('✓ Verified')).toHaveLength(3);
    expect(within(machines).getByText('HBSDC63S')).toBeTruthy();
    // And the toggle reads as open.
    expect(screen.getByRole('button', { name: 'Hide machines for TT-26-00038' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says what has not happened yet, machine by machine', async () => {
    mockApi([HALF]);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Show machines for TT-26-00036' }));
    const detail = screen.getByText('Technician assigned').closest('tr')!;
    expect(detail.textContent).toContain('All machines recordedNot yet1 of 2 so far');
    expect(detail.textContent).toContain('VerifiedNot yetafter every machine is recorded');
    expect(within(detail).getByText('Recorded, not verified')).toBeTruthy();
    expect(within(detail).getAllByText('Not recorded')).toHaveLength(2);
    expect(within(detail).queryByText('✓ Verified')).toBeNull();
  });
});

describe('filters live in the URL', () => {
  it('filters by stage from a tile and by search over serials', async () => {
    mockApi([DONE, UNVERIFIED, HALF]);
    draw();
    const tiles = await screen.findByRole('group', { name: 'Filter by stage' });
    await userEvent.click(within(tiles).getByRole('button', { name: /Completed/ }));
    expect(screen.getByTestId('url').textContent).toBe('/qc/orders?stage=completed');
    expect(screen.getAllByRole('button', { name: /Show machines for/ })).toHaveLength(1);
    expect(screen.getByText(/Showing/).textContent).toBe('Showing 1 inspection of 3 · open visits first, then newest');
    await userEvent.click(within(tiles).getByRole('button', { name: /Completed/ }));

    const box = screen.getByLabelText('Search inspections');
    await userEvent.type(box, 'bbb222{Enter}');
    expect(screen.getByTestId('url').textContent).toBe('/qc/orders?q=bbb222');
    expect(screen.getAllByRole('button', { name: /Show machines for/ })).toHaveLength(1);
    expect(screen.getByText('TT-26-00037')).toBeTruthy();
  });

  it('formats the dates the way the design writes them', () => {
    expect(onDay('2026-09-28T05:37:57.745Z')).toBe('28 Sep 2026');
    expect(elapsed(T(11, 7), T(11, 12))).toBe('5 min');
    expect(elapsed(T(11, 7), T(11, 7))).toBe('under a minute');
    expect(elapsed(T(9, 0), T(10, 12))).toBe('1 h 12 min');
  });
});
