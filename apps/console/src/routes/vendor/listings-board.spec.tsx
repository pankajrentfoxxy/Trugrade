import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('./ProfileLockGate', () => ({
  useProfileGateOrRender: () => ({ locked: null }),
}));
vi.mock('./listings/CreateListingDialog', () => ({
  CreateListingDialog: () => null,
}));

import { VendorListingsRoute } from './Listings';

const SKU = {
  skuCode: 'DEL-LAT5420-I51135G7-16-512',
  brandName: 'Dell',
  seriesName: 'Latitude',
  modelName: 'Latitude 5420',
  cpuBrand: 'Intel',
  cpuFamily: 'Core i5',
  cpuModel: 'i5-1135G7',
  cpuGeneration: '11th',
  ramGb: 16,
  storageGb: 512,
  storageType: 'NVME SSD',
  gpuType: 'INTEGRATED',
  gpuModel: null,
  screenSizeIn: 14,
  resolution: 'FHD',
  isTouch: false,
  osSupported: 'Windows 11 Pro',
};

const base = {
  skuId: 's1',
  sku: SKU,
  grade: 'A',
  conditionType: 'REFURBISHED',
  functionalStatus: 'FULLY_FUNCTIONAL',
  batteryHealthBand: 'GOOD',
  vendorWarrantyMonths: 6,
  qtyReserved: 0,
  qtyAwaitingQc: 0,
  qtyQcFailed: 0,
  underPriceReview: false,
  gradeCorrectedFrom: null,
  qcCompletedAt: null,
  expiresAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const PRICED = {
  ...base,
  id: '94c8a0d7-0000-4000-8000-000000000001',
  status: 'ACTIVE',
  vendorAskPrice: '51600.00',
  qtyTotal: 4,
  qtyAvailable: 4,
  commissionPct: 18.23,
  commissionAmount: '37620.00',
};

const UNPRICED = {
  ...base,
  id: '2a093436-0000-4000-8000-000000000002',
  status: 'ACTIVE',
  vendorAskPrice: null,
  qtyTotal: 12,
  qtyAvailable: 0,
  commissionPct: null,
  commissionAmount: null,
};

const DRAFT = {
  ...base,
  id: '6a2b4410-0000-4000-8000-000000000003',
  sku: { ...SKU, modelName: 'Latitude 3420', skuCode: 'DEL-LAT3420-I31115G4-8-256' },
  status: 'DRAFT',
  vendorAskPrice: '40000.00',
  qtyTotal: 3,
  qtyAvailable: 0,
  commissionPct: 23.75,
  commissionAmount: '28500.00',
};

const BOARD = {
  counts: { DRAFT: 5, AWAITING_QC: 3, ACTIVE: 4 },
  total: 12,
  units: { DRAFT: 18, AWAITING_QC: 55, ACTIVE: 23 },
  unitsTotal: 96,
  unitsOnSale: 1,
};

function mockApi(rows: unknown[]): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const body = url.includes('bulk-status')
      ? BOARD
      : { rows, total: rows.length, page: 1, pageSize: 50 };
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    );
  });
}

function draw(entry = '/vendor/listings'): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/vendor/listings" element={<VendorListingsRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => mockApi([PRICED, UNPRICED, DRAFT]));
afterEach(() => vi.restoreAllMocks());

/**
 * The board's figures are the server's. The tiles read `bulk-status`, which
 * counts the whole stock rather than the filtered page, so "5 drafts" stays 5
 * while the board shows only the active ones.
 */
describe('the listings board', () => {
  it('heads the page and the tiles with the server counts and their denominators', async () => {
    draw();
    const tiles = await screen.findByRole('group', { name: 'Filter by status' });
    expect(within(tiles).getByRole('button', { name: /All listings 12 96 units in total/ })).toBeInTheDocument();
    expect(within(tiles).getByRole('button', { name: /Draft 5 18 units · Not sent for QC yet/ })).toBeInTheDocument();
    expect(within(tiles).getByRole('button', { name: /Active 4 23 units · Visible to buyers/ })).toBeInTheDocument();
    expect(screen.getByText(/on sale right now/)).toHaveTextContent('12 listings · 1 of 96 units on sale right now');
  });

  it('presses a tile into the URL and asks the server for that status', async () => {
    draw();
    await userEvent.click(await screen.findByRole('button', { name: /^Draft 5/ }));

    expect(screen.getByRole('button', { name: /^Draft 5/ })).toHaveAttribute('aria-pressed', 'true');
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => String(c[0]),
    );
    expect(calls.some((u) => u.includes('status=DRAFT'))).toBe(true);
  });

  it('names the active listing with no price, in the table and above it', async () => {
    draw();
    const attention = await screen.findByTestId('listings-attention');
    expect(within(attention).getByText(/Latitude 5420 has no price/)).toBeInTheDocument();
    expect(within(attention).getByRole('link', { name: 'Set price →' })).toHaveAttribute(
      'href',
      `/vendor/listings/${UNPRICED.id}/reprice`,
    );
    // The row says so too, and its action is the thing to do, not "Reprice".
    expect(screen.getByText('No price set')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set price' })).toHaveAttribute(
      'href',
      `/vendor/listings/${UNPRICED.id}/reprice`,
    );
    expect(screen.getAllByRole('link', { name: 'Reprice' })).toHaveLength(2);
  });

  it('carries the commission with its denominator and never a selling price', async () => {
    draw();
    await screen.findByText('18.23%');
    expect(screen.getByText('₹37,620.00 · 4 units')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Listed at|selling price|retail/i);
  });

  it('searches the page by model, SKU or id from the URL', async () => {
    draw('/vendor/listings?q=3420');
    await screen.findByText('DEL-LAT3420-I31115G4-8-256');
    expect(screen.queryByText('DEL-LAT5420-I51135G7-16-512')).toBeNull();
    expect(screen.getByRole('table', { name: /1 listings, newest first/ })).toBeInTheDocument();
  });
});
