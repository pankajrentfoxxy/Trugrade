import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import Inspections, { dateRange, pillOf, type InspectionRow } from '../src/routes/supply/Inspections';

/**
 * The stock-inspection board, asserted by what it says.
 *
 * The attention strip is the server's arithmetic over every open visit, and
 * these tests pin the sentences to the figures: which are overdue and between
 * which dates, which have nobody, which supply point could be one trip. They
 * also pin that a row late on the server's calendar says so, that a visit with
 * nobody on it reads "Needs technician" whatever its status, and that the
 * strip's one real button opens the oldest unassigned visit.
 */

const PERMS = { current: ['qc.visit.read', 'qc.visit.schedule'] as readonly string[] };
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePrincipal: () => ({ permissions: PERMS.current }),
}));

const visit = (over: Partial<InspectionRow>): InspectionRow => ({
  id: 'v',
  visitNumber: 'QCV-20260903-133FC506',
  status: 'TECH_ASSIGNED',
  vendorOrgId: 'o1',
  vendorName: 'Northgate IT Assets Pvt. Ltd.',
  technicianId: 't1',
  technicianName: 'Rakesh Kumar',
  scheduledDate: '2026-09-22',
  slotFrom: null,
  requestedAt: '2026-09-03T10:00:00Z',
  waitingDays: 25,
  daysOverdue: 6,
  unitsRequested: 25,
  unitsInspected: 0,
  unitsPassed: 0,
  unitsFailed: 0,
  unitsGradeCorrected: 0,
  listingIds: [],
  ...over,
});

const A = visit({ id: 'a' });
const B = visit({
  id: 'b',
  visitNumber: 'QCV-20260911-B113D53C',
  status: 'SCHEDULED',
  technicianId: null,
  technicianName: null,
  requestedAt: '2026-09-11T10:00:00Z',
  waitingDays: 17,
});
const C = visit({
  id: 'c',
  visitNumber: 'QCV-20260923-AB89634A',
  vendorName: 'Ghaziabad Device Renew Pvt. Ltd.',
  scheduledDate: '2026-09-24',
  daysOverdue: 4,
  requestedAt: '2026-09-23T10:00:00Z',
  waitingDays: 5,
});

const BOARD = {
  rows: [A, B, C],
  page: 1,
  per: 40,
  total: 3,
  pages: 1,
  grandTotal: 10,
  views: [
    { key: 'unscheduled', label: 'Unscheduled', count: 0 },
    { key: 'scheduled', label: 'Scheduled', count: 3 },
    { key: 'onsite', label: 'On site', count: 1 },
    { key: 'partial', label: 'Partly done', count: 0 },
    { key: 'done', label: 'Completed', count: 4 },
    { key: 'all', label: 'All', count: 10 },
  ],
  facets: {
    technician: [
      { value: 't1', label: 'Rakesh Kumar', count: 7 },
      { value: 'none', label: 'Unassigned', count: 1 },
    ],
  },
  late: { scheduled: 3, onsite: 0, all: 3 },
  totals: { machinesWaiting: 75 },
  attention: {
    overdue: { count: 3, ofOpen: 4, machines: 75, machinesInspected: 0, from: '2026-09-21', to: '2026-09-24' },
    unassigned: { count: 1, oldest: B },
    cluster: { vendorName: 'Northgate IT Assets Pvt. Ltd.', visits: 3, machines: 53 },
    load: { technicianName: 'Rakesh Kumar', visits: 3, machines: 53 },
  },
};

function mockApi(body: typeof BOARD): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/qc/inspections')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

function Probe(): React.JSX.Element {
  const loc = useLocation();
  return <output data-testid="url">{loc.pathname + loc.search}</output>;
}

const draw = (entry = '/supply/inspections?view=scheduled'): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Inspections />
      <Probe />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  PERMS.current = ['qc.visit.read', 'qc.visit.schedule'];
});

describe('the strip is the server’s arithmetic', () => {
  it('says how many are overdue, between which dates, and how many machines wait', async () => {
    mockApi(BOARD);
    draw();
    const strip = await screen.findByRole('region', { name: 'Needs attention' });
    expect(strip.textContent).toContain('3 visits are overdue. Their dates (21–24 Sep) have passed and none of the 75 machines has been inspected yet.');
    expect(strip.textContent).toContain('1 visit has no technician. QCV-20260911-B113D53C at Northgate IT Assets has waited 17 days.');
    expect(strip.textContent).toContain('3 visits are to Northgate IT Assets (53 machines). One trip could cover them all. Rakesh Kumar alone has 53 machines across 3 visits.');
    expect(dateRange('2026-09-28', '2026-10-02')).toBe('28 Sep – 2 Oct');
    expect(dateRange('2026-09-22', '2026-09-22')).toBe('22 Sep');
  });

  it('badges the scheduled chip with the late count and greys the empty ones', async () => {
    mockApi(BOARD);
    draw();
    const chips = await screen.findByRole('group', { name: 'Filter by stage' });
    const scheduled = within(chips).getByRole('button', { name: /Scheduled/ });
    expect(scheduled).toHaveAttribute('aria-pressed', 'true');
    expect(within(scheduled).getByText('3 late')).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /Unscheduled/ })).toHaveClass('vi-chip--zero');
  });

  it('opens the oldest unassigned visit straight into the assignment record', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('region', { name: 'Needs attention' });
    await userEvent.click(screen.getByRole('button', { name: 'Assign technician' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('QCV-20260911-B113D53C');
    expect(within(dialog).getByRole('button', { name: 'Assign technician' })).toBeTruthy();
  });
});

describe('a row says what is late and who is missing', () => {
  it('prints the overdue days under the date, from the server', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('6 days overdue')[0]).toHaveClass('vi-late');
    expect(within(table).getByText('4 days overdue')).toBeTruthy();
    expect(within(table).getAllByText('6 days overdue')).toHaveLength(2);
  });

  it('reads Needs technician for a scheduled visit nobody is on, and offers Assign', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    const row = within(table).getByText('QCV-20260911-B113D53C').closest('tr')!;
    expect(within(row).getByText('Needs technician')).toHaveClass('vi-pill--warn');
    expect(within(row).getByText('Unassigned')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Assign QCV-20260911-B113D53C' })).toBeTruthy();
    expect(pillOf(A).label).toBe('Technician assigned');
    expect(pillOf(visit({ status: 'IN_PROGRESS' })).label).toBe('On site');
    expect(pillOf(visit({ status: 'COMPLETED' })).tone).toBe('vi-pill--ok');
  });

  it('shows no Assign to a read-only seat', async () => {
    PERMS.current = ['qc.visit.read'];
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /^Assign QCV/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign technician' })).toBeNull();
  });

  it('counts the machines still waiting in the footer', async () => {
    mockApi(BOARD);
    draw();
    const foot = (await screen.findByText(/waiting to be inspected/)).closest('div')!;
    expect(foot.textContent).toContain('Showing 3 scheduled of 10 visits · oldest first');
    expect(foot.textContent).toContain('75 machines waiting to be inspected');
  });
});

describe('filters live in the URL', () => {
  it('shows the overdue set from the strip, and the unassigned from the select', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('region', { name: 'Needs attention' });
    await userEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(screen.getByTestId('url').textContent).toBe('/supply/inspections?view=scheduled&facet.late=1');
    await userEvent.selectOptions(screen.getByLabelText(/Technician/), 'none');
    expect(screen.getByTestId('url').textContent).toBe('/supply/inspections?view=scheduled&facet.late=1&facet.technician=none');
  });
});
