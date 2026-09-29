import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { ListingApprovalsRoute, agoWord, markup } from '../src/routes/ops/ListingApprovals';
import type { OpsListingBoard, OpsListingRow } from '../src/routes/ops/api';

/**
 * The listing approval queue, asserted by what it says and what it lets you do.
 *
 * The screen's one hard rule is that a flagged listing is never approved by
 * accident: not from the row, not from the bulk bar, not by select-all. These
 * tests pin that, plus the sentences built from the server's figures — the
 * header line, the markup, the relative dates — and that a seat without the
 * write permission sees no decision controls at all.
 */

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const DAY = 86_400_000;
const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString();

vi.mock('../src/lib/clock', () => ({
  nowMs: () => NOW,
  daysUntil: (iso: string) => Math.ceil((new Date(iso).getTime() - NOW) / DAY),
  daysSince: (iso: string) => Math.max(0, Math.floor((NOW - new Date(iso).getTime()) / DAY)),
}));

const WRITE = ['listing.any.read', 'listing.any.write'];
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePrincipal: () => ({ permissions: PERMS.current }),
}));
const PERMS = { current: WRITE as readonly string[] };

const row = (over: Partial<OpsListingRow>): OpsListingRow => ({
  listingId: 'l',
  status: 'PENDING_APPROVAL',
  vendorOrgId: 'v1',
  vendorLegalName: 'Sonipat Green Assets Pvt. Ltd.',
  title: 'Dell Latitude 5420',
  specSummary: 'i5-1135G7 · 16 GB · 512 GB NVMe SSD',
  grade: 'A',
  qtyTotal: 10,
  qtyAvailable: 0,
  qtyReserved: 0,
  vendorAskPrice: '27500.00',
  sellingPrice: '32450.00',
  belowFloor: false,
  priceFlag: null,
  pickupCity: 'Sonipat',
  submittedAt: daysAgo(3),
  createdAt: daysAgo(3),
  approvedAt: null,
  rejectionReason: null,
  ...over,
});

const DELL = row({ listingId: 'a' });
const ACER = row({
  listingId: 'b',
  title: 'Acer Swift 3 SF314-511',
  grade: 'A+',
  vendorLegalName: 'Ghaziabad Device Renew Pvt. Ltd.',
  pickupCity: 'Ghaziabad',
  qtyTotal: 4,
  vendorAskPrice: '28500.00',
  sellingPrice: '33630.00',
  submittedAt: daysAgo(2),
});
const MSI = row({
  listingId: 'c',
  title: 'MSI Prestige 15 A11SC',
  vendorLegalName: 'Northgate IT Assets Pvt. Ltd.',
  pickupCity: 'Gurugram',
  qtyTotal: 20,
  vendorAskPrice: '1500.00',
  sellingPrice: '1987.50',
  belowFloor: true,
  priceFlag: { reason: 'below_floor', floorPrice: '3200.00', bandMedian: null, bandRatio: null },
  submittedAt: daysAgo(0),
});

const BOARD: OpsListingBoard = {
  rows: [DELL, ACER, MSI],
  total: 3,
  page: 1,
  per: 25,
  pages: 1,
  totals: { units: 34, value: '498770.00' },
  flagged: 1,
  facets: {
    status: [
      { value: 'PENDING_APPROVAL', label: 'Awaiting approval', count: 3 },
      { value: 'ACTIVE', label: 'Live', count: 32 },
      { value: 'REJECTED', label: 'Rejected', count: 0 },
    ],
    vendor: [
      { value: 'v1', label: 'Sonipat Green Assets Pvt. Ltd.', count: 1 },
      { value: 'v2', label: 'Northgate IT Assets Pvt. Ltd.', count: 1 },
    ],
  },
};

function mockApi(body: OpsListingBoard) {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes('/approve') || url.includes('/reject')) {
      const id = url.split('/').at(-2);
      const hit = body.rows.find((r) => r.listingId === id) ?? DELL;
      const status = url.includes('/approve') ? 'ACTIVE' : 'REJECTED';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...hit, status, qtyAvailable: hit.qtyTotal, method: init?.method }),
      } as Response);
    }
    if (url.includes('/api/ops/listings')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
  return spy;
}

function Probe(): React.JSX.Element {
  const loc = useLocation();
  return <output data-testid="url">{loc.pathname + loc.search}</output>;
}

const draw = (entry = '/listings/approvals'): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ListingApprovalsRoute />
      <Probe />
    </MemoryRouter>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  PERMS.current = WRITE;
});

describe('the figures are the server’s', () => {
  it('states the queue in the header line and badges the Waiting tab', async () => {
    mockApi(BOARD);
    draw();
    const sub = (await screen.findByText('3 listings')).closest('p');
    expect(sub?.textContent).toBe('3 listings waiting · 34 units · ₹4,98,770 at storefront prices');
    const tabs = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(tabs).getByRole('button', { name: /Waiting/ }).textContent).toBe('Waiting3');
    expect(screen.getByRole('button', { name: /Price flags/ }).textContent).toBe('Price flags 1');
  });

  it('shows both prices with the markup between them, and a relative date', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    const dell = within(table).getByText('Dell Latitude 5420').closest('tr')!;
    expect(within(dell).getByText('₹27,500.00')).toBeTruthy();
    expect(within(dell).getByText('₹32,450.00')).toHaveClass('lq-money--sell');
    expect(within(dell).getByText('+18.0%')).toBeTruthy();
    expect(within(dell).getByText('3 days ago')).toBeTruthy();
    expect(markup('1500.00', '1987.50')).toBe('+32.5%');
    expect(markup(null, '1.00')).toBeNull();
    expect(agoWord(daysAgo(0))).toBe('today');
    expect(agoWord(daysAgo(1))).toBe('yesterday');
  });
});

describe('a flagged listing is never approved by accident', () => {
  it('flags the row, offers only a review, and cannot be selected', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    const msi = within(table).getByText('MSI Prestige 15 A11SC').closest('tr')!;
    expect(msi).toHaveClass('is-flagged');
    expect(within(msi).getByText('Price looks too low')).toBeTruthy();
    expect(within(msi).getByRole('button', { name: 'Review price' })).toBeTruthy();
    expect(within(msi).queryByRole('button', { name: /^Approve / })).toBeNull();
    expect(within(msi).getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/flagged listings can’t be bulk-approved/)).toBeTruthy();
  });

  it('select-all skips the flagged row, and the bulk bar sums only what is selected', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByLabelText('Select all listings'));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar.textContent).toContain('2 selected');
    expect(bar.textContent).toContain('14 units · ₹4,59,020 at storefront prices');
    expect(within(bar).getByRole('button', { name: 'Approve 2' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Reject 2' })).toBeTruthy();
  });

  it('explains the floor in the review dialog and offers no approve for it', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Review price' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('₹3,200.00');
    expect(dialog.textContent).toContain('Approve would refuse it');
    expect(within(dialog).queryByRole('button', { name: /^Approve / })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Reject with a reason' })).toBeTruthy();
  });
});

describe('decisions', () => {
  it('approves from the row and reports the machines now on sale', async () => {
    const fetchSpy = mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Approve Dell Latitude 5420' }));
    expect(await screen.findByText('Dell Latitude 5420 is live: 10 machines on sale.')).toBeTruthy();
    const approveCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith('/a/approve'));
    expect(approveCall).toBeTruthy();
  });

  it('approves a selection one by one and counts the outcome', async () => {
    const fetchSpy = mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByLabelText('Select all listings'));
    await userEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    expect(await screen.findByText('2 listings are live: 14 machines on sale.')).toBeTruthy();
    const approved = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/approve')).map(([u]) => String(u));
    expect(approved).toEqual([expect.stringContaining('/a/approve'), expect.stringContaining('/b/approve')]);
  });

  it('shows no decision controls to a seat that can only read', async () => {
    PERMS.current = ['listing.any.read'];
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Select all listings')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review price' })).toBeNull();
  });
});

describe('filters live in the URL', () => {
  it('switches tab, toggles the flag filter and searches', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(screen.getByTestId('url').textContent).toBe('/listings/approvals?status=ACTIVE');
    await userEvent.click(screen.getByRole('button', { name: /Price flags/ }));
    expect(screen.getByTestId('url').textContent).toBe('/listings/approvals?status=ACTIVE&flagged=1');
    await userEvent.type(screen.getByLabelText('Search listings'), 'latitude{Enter}');
    expect(screen.getByTestId('url').textContent).toBe('/listings/approvals?status=ACTIVE&flagged=1&q=latitude');
  });
});
