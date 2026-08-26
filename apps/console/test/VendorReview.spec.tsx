import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { VendorReviewRoute, type VendorReviewData } from '../src/routes/VendorReview';

const COMPLETE: VendorReviewData = {
  orgId: '11111111-1111-4111-8111-111111111111',
  legalName: 'Alpha Systems Private Limited',
  status: 'UNDER_REVIEW',
  constitutionType: 'PVT_LTD',
  dispatchAddress: {
    line1: 'Plot 42, Sector 18',
    city: 'Gurugram',
    state: 'Haryana',
    pincode: '122015',
  },
  dispatchSameAsRegistered: false,
  canDropship: true,
  dropshipConstraint: null,
  defaultWarrantyMonths: 3,
  defaultWarrantyScope: {
    covers: ['MOTHERBOARD', 'DISPLAY'],
    excludes: [],
    serviceMode: 'CARRY_IN',
  },
  pricingMode: 'NET_PAYOUT',
  agreedCommissionPct: null,
};

function renderWith(data: VendorReviewData): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => data,
  } as Response);

  render(
    <MemoryRouter initialEntries={[`/kyc/${data.orgId}`]}>
      <Routes>
        <Route path="/kyc/:orgId" element={<VendorReviewRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the four Change 4 captures are on the review screen', () => {
  it('shows all four with their values', async () => {
    renderWith(COMPLETE);
    await screen.findByText('Alpha Systems Private Limited');

    expect(screen.getByText('Dispatch address')).toBeInTheDocument();
    expect(screen.getByText(/Plot 42, Sector 18/)).toBeInTheDocument();
    expect(screen.getByText('Direct dispatch to buyer')).toBeInTheDocument();
    expect(screen.getByText('Can dropship')).toBeInTheDocument();
    expect(screen.getByText('Vendor warranty')).toBeInTheDocument();
    expect(screen.getByText('3 months')).toBeInTheDocument();
    expect(screen.getByText('Pricing basis')).toBeInTheDocument();
    expect(screen.getByText(/they name the amount they receive/)).toBeInTheDocument();
  });

  it('tells the reviewer what happens if the vendor edits each field later', async () => {
    renderWith(COMPLETE);
    await screen.findByText('Alpha Systems Private Limited');

    // The distinction the matrix exists to make visible: a commercial preference
    // is free to change, the dispatch address is logged because it reaches an
    // e-way bill.
    expect(screen.getByText('Vendor may change this — logged')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor may change this').length).toBe(3);
  });
});

describe('a missing capture blocks approval', () => {
  it.each([
    ['dispatch address', { dispatchAddress: null, dispatchSameAsRegistered: false }],
    ['dropship capability', { canDropship: null }],
    ['warranty term', { defaultWarrantyMonths: null }],
    ['pricing mode', { pricingMode: null }],
  ])('%s missing — Approve is disabled and says why', async (label, patch) => {
    renderWith({ ...COMPLETE, ...(patch as Partial<VendorReviewData>) });
    await screen.findByText('Alpha Systems Private Limited');

    const approve = screen.getByRole('button', { name: /approve/i });
    // aria-disabled, not the `disabled` attribute: a reason-disabled button
    // stays focusable so a screen reader can reach it and hear why. A disabled
    // button with no reachable explanation is a support ticket.
    await waitFor(() => expect(approve).toHaveAttribute('aria-disabled', 'true'));
    expect(approve).toHaveAccessibleDescription(new RegExp(label));
  });

  it('renders "Not captured", never a silent no', async () => {
    renderWith({ ...COMPLETE, canDropship: null });
    await screen.findByText('Alpha Systems Private Limited');
    // The failure this prevents: an uncaptured boolean rendering as "cannot
    // dropship" and routing every order through a hub for no reason.
    expect(screen.getByText('Not captured')).toBeInTheDocument();
    expect(screen.queryByText('Hub leg required')).not.toBeInTheDocument();
  });

  it('enables Approve once everything is captured', async () => {
    renderWith(COMPLETE);
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.getByRole('button', { name: /approve/i })).not.toHaveAttribute('aria-disabled');
  });

  it('accepts "same as registered" as a real answer for the dispatch address', async () => {
    renderWith({ ...COMPLETE, dispatchAddress: null, dispatchSameAsRegistered: true });
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.getByRole('button', { name: /approve/i })).not.toHaveAttribute('aria-disabled');
  });
});
