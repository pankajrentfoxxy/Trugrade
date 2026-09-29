import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import PurchaseOrders, { type PoBoard } from '../src/routes/fulfilment/PurchaseOrders';

/**
 * The purchase-order board, asserted by what it says.
 *
 * Every number on this screen is the server's, and every sentence is built
 * from one: the tile flags, the attention strip, the row age notes and the
 * footer's TDS line. These tests pin the sentences to the figures, so a copy
 * change that quietly stops quoting the server's threshold, or an age note
 * that turns red a day early, fails here rather than on a screenshot.
 *
 * The clock is a stub. "No reply for 14 days" is only true on one day, and a
 * test that is true on one day is not a test.
 */

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const DAY = 86_400_000;
const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString();

vi.mock('../src/lib/clock', () => ({
  nowMs: () => NOW,
  daysUntil: (iso: string) => Math.ceil((new Date(iso).getTime() - NOW) / DAY),
  daysSince: (iso: string) => Math.max(0, Math.floor((NOW - new Date(iso).getTime()) / DAY)),
}));

const row = (over: Partial<PoBoard['rows'][number]>): PoBoard['rows'][number] => ({
  poId: 'p',
  poNumber: 'PO-26-00000',
  status: 'RAISED',
  vendorOrgId: 'v1',
  vendorLegalName: 'Northgate IT Assets Pvt. Ltd.',
  orderNumber: 'TT-26-00001',
  raisedAt: daysAgo(3),
  lines: 1,
  totalNet: '5000.00',
  tdsAmount: '0.00',
  termsDays: 30,
  acknowledgedAt: null,
  matchedSerials: [],
  ...over,
});

const BOARD: PoBoard = {
  rows: [
    row({ poId: 'a', poNumber: 'PO-26-00037', status: 'DISPATCHED', orderNumber: 'TT-26-00038', lines: 3, totalNet: '7500.00', raisedAt: daysAgo(0), acknowledgedAt: daysAgo(0) }),
    row({ poId: 'b', poNumber: 'PO-26-00036', status: 'RAISED', orderNumber: 'TT-26-00037', lines: 2, totalNet: '76000.00', raisedAt: daysAgo(3) }),
    row({ poId: 'c', poNumber: 'PO-26-00029', status: 'ACKNOWLEDGED', orderNumber: 'TT-26-00030', raisedAt: daysAgo(14), acknowledgedAt: daysAgo(14) }),
    row({ poId: 'd', poNumber: 'PO-26-00024', status: 'RAISED', orderNumber: 'TT-26-00025', lines: 2, totalNet: '8400.00', raisedAt: daysAgo(14) }),
  ],
  total: 4,
  grandTotal: 36,
  page: 1,
  per: 50,
  pages: 1,
  facets: {
    status: [],
    vendor: [
      { value: 'v1', label: 'Northgate IT Assets Pvt. Ltd.', count: 21 },
      { value: 'v2', label: 'Sonipat Green Assets Pvt. Ltd.', count: 1 },
    ],
  },
  totals: { value: '96900.00', tds: '0.00', machines: 8 },
  searchedFor: null,
  summary: { pos: 36, vendors: 7, payable: '1177078.00' },
  stages: [
    { status: 'RAISED', count: 18, value: '889158.00', late: 14, lateValue: '655950.00' },
    { status: 'ACKNOWLEDGED', count: 12, value: '154410.00', late: 11, lateValue: '123020.00' },
    { status: 'DISPATCHED', count: 6, value: '133510.00', late: 0, lateValue: '0.00' },
  ],
  attention: {
    unacknowledged: {
      count: 14,
      value: '655950.00',
      oldest: { poNumber: 'PO-26-00001', vendorLegalName: 'Sonipat Green Assets Pvt. Ltd.', raisedAt: daysAgo(28) },
    },
    undispatched: { count: 11, value: '123020.00', vendors: ['Northgate IT Assets Pvt. Ltd.'] },
  },
  thresholds: { ackDays: 7, dispatchDays: 14 },
};

function mockApi(body: PoBoard): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/ops/purchase-orders')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

function Probe(): React.JSX.Element {
  const loc = useLocation();
  return <output data-testid="url">{loc.pathname + loc.search}</output>;
}

const draw = (entry = '/procurement/pos'): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PurchaseOrders />
      <Probe />
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('every figure on the board is the server’s', () => {
  it('states the whole board in the header line', async () => {
    mockApi(BOARD);
    draw();
    const sub = (await screen.findByText('36 POs')).closest('p');
    expect(sub?.textContent).toBe('36 POs to 7 supply points · ₹11,77,078 payable in total');
  });

  it('flags each stage against the server’s threshold, quoting that threshold', async () => {
    mockApi(BOARD);
    draw();
    const tiles = await screen.findByRole('group', { name: 'Filter by stage' });
    expect(within(tiles).getByText('14 not acknowledged after 7+ days')).toBeTruthy();
    expect(within(tiles).getByText('11 not dispatched after 14+ days')).toBeTruthy();
    expect(within(tiles).getByText('Track under Shipments')).toBeTruthy();
    expect(within(tiles).getByText('₹8,89,158')).toBeTruthy();
  });

  it('names the oldest unacknowledged PO and who is sitting on the undispatched ones', async () => {
    mockApi(BOARD);
    draw();
    const attn = await screen.findByRole('region', { name: 'Needs attention' });
    expect(attn.textContent).toContain('14 POs have not been acknowledged in over a week');
    expect(attn.textContent).toContain('The oldest, PO-26-00001 to Sonipat Green Assets, was raised 28 days ago.');
    expect(attn.textContent).toContain('11 POs acknowledged 2+ weeks ago are still not dispatched');
    expect(attn.textContent).toContain('All are with Northgate IT Assets.');
  });
});

describe('a row says how long it has waited, and turns colour only past the threshold', () => {
  it('reads the age off the clock, in the design’s three tones', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Raised 3 days ago')).toHaveClass('po-age--ok');
    expect(within(table).getByText('No reply for 14 days')).toHaveClass('po-age--bad');
    expect(within(table).getByText('Not dispatched for 14 days')).toHaveClass('po-age--warn');
    // A dispatched PO is waiting on nobody, so it carries no age line at all.
    const dispatched = within(table).getByText('PO-26-00037').closest('tr');
    expect(dispatched?.querySelector('.po-age')).toBeNull();
  });

  it('never prints a date for an acknowledgement that has not happened', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    // Two RAISED rows, two "Not yet"; the other two carry a date.
    expect(within(table).getAllByText('Not yet')).toHaveLength(2);
  });

  it('shortens the legal name for the column and keeps the full one in the title', async () => {
    mockApi(BOARD);
    draw();
    const table = await screen.findByRole('table');
    const cell = within(table).getAllByTitle('Northgate IT Assets Pvt. Ltd.')[0];
    expect(cell?.textContent).toBe('Northgate IT Assets');
  });
});

describe('the controls the screen can honour', () => {
  it('offers no selection to a seat that cannot dispatch', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    expect(screen.queryByLabelText('Select all purchase orders')).toBeNull();
  });

  it('filters by stage from a tile, and the filter lives in the URL', async () => {
    mockApi(BOARD);
    draw();
    const tiles = await screen.findByRole('group', { name: 'Filter by stage' });
    await userEvent.click(within(tiles).getByRole('button', { name: /Acknowledged/ }));
    expect(screen.getByTestId('url').textContent).toBe('/procurement/pos?status=ACKNOWLEDGED');
    // Pressing the same tile again clears it.
    await userEvent.click(within(tiles).getByRole('button', { name: /Acknowledged/ }));
    expect(screen.getByTestId('url').textContent).toBe('/procurement/pos');
  });

  it('says which stuck set it is showing, and lets it go', async () => {
    mockApi(BOARD);
    draw('/procurement/pos?late=ack');
    expect(
      await screen.findByText(/Showing only purchase orders raised over 7 days ago and not acknowledged/),
    ).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Showing them' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByTestId('url').textContent).toBe('/procurement/pos');
  });

  it('keeps the density toggle in the URL', async () => {
    mockApi(BOARD);
    draw();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Roomy' }));
    expect(screen.getByTestId('url').textContent).toBe('/procurement/pos?density=roomy');
    expect(screen.getByRole('button', { name: 'Roomy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('tells the reader the TDS is nil rather than hiding the column', async () => {
    mockApi(BOARD);
    draw();
    expect(await screen.findByText('TDS is ₹0 on every PO shown. Open a PO to see it.')).toBeTruthy();
  });
});
