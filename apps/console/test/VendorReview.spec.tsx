import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { VendorReviewRoute, type VendorReviewData } from '../src/routes/VendorReview';
import type { VerificationCheck } from '../src/routes/ReviewEvidence';

const COMPLETE: VendorReviewData = {
  orgId: '11111111-1111-4111-8111-111111111111',
  orgType: 'VENDOR',
  legalName: 'Alpha Systems Private Limited',
  status: 'UNDER_REVIEW',
  constitutionType: 'PVT_LTD',
  slaDueAt: null,
  slaBreached: false,
  slaHours: 48,
  hoursRemaining: null,
  decision: null,
  checks: [],
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

const ok = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as Response;

/**
 * Three calls now leave this screen, and one of them is allowed to be refused.
 *
 * A single blanket mock returned the review payload to the documents route as
 * well, which typechecked and rendered a documents table built out of an
 * application — the exact shape of bug a URL-aware fake catches and a
 * `mockResolvedValue` cannot.
 */
function renderWith(
  data: VendorReviewData,
  opts: { documents?: unknown[]; documentsStatus?: number } = {},
): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/documents')) {
      if (opts.documentsStatus && opts.documentsStatus !== 200) {
        return { ok: false, status: opts.documentsStatus, json: async () => ({}) } as Response;
      }
      return ok(opts.documents ?? []);
    }
    if (url.includes('document-rejection-reasons')) {
      return ok([{ code: 'TOO_OLD', sentence: 'This document is older than we can accept.' }]);
    }
    return ok(data);
  });

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

// ===========================================================================
// PROVIDER_ERROR is not FAIL
// ===========================================================================

const check = (patch: Partial<VerificationCheck> & { checkType: string; outcome: string }): VerificationCheck => ({
  id: `${patch.checkType}-${patch.outcome}-${patch.checkedAt ?? '1'}`,
  maskedInput: '07AA****23C1Z5',
  provider: 'mock',
  matchScore: null,
  failureReason: null,
  attemptNo: 1,
  checkedAt: '2026-08-30T06:00:00.000Z',
  ...patch,
});

describe('a provider that did not answer is our problem, never the applicant’s', () => {
  it('renders a provider error as "no answer", not as a failure', async () => {
    renderWith({
      ...COMPLETE,
      checks: [check({ checkType: 'BANK_PENNY_DROP', outcome: 'PROVIDER_ERROR' })],
    });
    await screen.findByText('Alpha Systems Private Limited');

    expect(screen.getByText('No answer yet')).toBeInTheDocument();
    // The word that must not appear against this applicant's name.
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(screen.getByText(/consumed none of the applicant/i)).toBeInTheDocument();
  });

  it('keeps a provider error off the list of things blocking approval', async () => {
    renderWith({
      ...COMPLETE,
      checks: [check({ checkType: 'GSTIN', outcome: 'PROVIDER_ERROR' })],
    });
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.queryByText('Outstanding before approval')).not.toBeInTheDocument();
  });

  it('puts a real mismatch on that list, and calls it a difference rather than a failure', async () => {
    renderWith({
      ...COMPLETE,
      checks: [check({ checkType: 'GSTIN', outcome: 'MISMATCH', matchScore: 0.42 })],
    });
    await screen.findByText('Alpha Systems Private Limited');

    expect(screen.getByText('Outstanding before approval')).toBeInTheDocument();
    expect(screen.getByText('Does not match')).toBeInTheDocument();
    expect(screen.getByText(/a difference for you to judge/i)).toBeInTheDocument();
  });

  it('does not let a later provider error erase an answer that already arrived', async () => {
    renderWith({
      ...COMPLETE,
      checks: [
        check({
          checkType: 'BANK_PENNY_DROP',
          outcome: 'PASS',
          checkedAt: '2026-08-30T06:00:00.000Z',
        }),
        check({
          checkType: 'BANK_PENNY_DROP',
          outcome: 'PROVIDER_ERROR',
          checkedAt: '2026-08-30T09:00:00.000Z',
        }),
      ],
    });
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.getByText('Pass')).toBeInTheDocument();
    expect(screen.queryByText('No answer yet')).not.toBeInTheDocument();
  });

  it('renders a check nobody has run as "not run", never as a tick', async () => {
    renderWith({ ...COMPLETE, checks: [] });
    await screen.findByText('Alpha Systems Private Limited');
    // Three: GSTIN, PAN, penny drop — the three this product actually runs.
    expect(screen.getAllByText('Not run').length).toBe(3);
    expect(screen.queryByText('Pass')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// A breached SLA is ours
// ===========================================================================

describe('an SLA we broke is not a verdict on the applicant', () => {
  it('says we are past our own promise, and never renders it as a rejection', async () => {
    renderWith({
      ...COMPLETE,
      slaDueAt: '2026-08-29T00:00:00.000Z',
      hoursRemaining: -30,
      slaBreached: true,
    });
    await screen.findByText('Alpha Systems Private Limited');

    expect(screen.getByText('Past our promise')).toBeInTheDocument();
    expect(screen.getByText(/past the date we gave them/i)).toBeInTheDocument();
  });

  it('states the promise this org type was actually made', async () => {
    renderWith({
      ...COMPLETE,
      orgType: 'BUYER',
      slaHours: 24,
      slaDueAt: '2026-08-31T00:00:00.000Z',
      hoursRemaining: 6,
    });
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.getByText(/buyer application is/i)).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
  });
});

// ===========================================================================
// Documents
// ===========================================================================

const DOC = {
  id: 'd1',
  docType: 'ADDRESS_PROOF',
  label: 'Address proof',
  originalFilename: 'bill.pdf',
  sizeBytes: 120_000,
  status: 'UPLOADED',
  documentDate: '2026-08-01',
  exifStrippedAt: null,
  avVerdict: null,
  rejectionReason: null,
  expiresOn: null,
  uploadedAt: '2026-08-29T06:00:00.000Z',
};

describe('documents', () => {
  it('says you are not cleared rather than showing an empty panel', async () => {
    renderWith(COMPLETE, { documentsStatus: 403 });
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.getByText(/not cleared for this applicant/i)).toBeInTheDocument();
    // The failure this prevents: a reviewer concluding the applicant sent nothing.
    expect(screen.queryByText('No documents yet')).not.toBeInTheDocument();
  });

  it('renders an unscanned file as "not scanned", never as clean', async () => {
    renderWith(COMPLETE, { documents: [DOC] });
    await screen.findByText('Alpha Systems Private Limited');
    expect(screen.getByText('Not scanned')).toBeInTheDocument();
  });

  it('shows the applicant’s own rejection sentence back to the reviewer', async () => {
    renderWith(COMPLETE, {
      documents: [
        {
          ...DOC,
          status: 'REJECTED',
          rejectionReason:
            'This document is older than we can accept. Your bill is dated January 2026.',
        },
      ],
    });
    await screen.findByText('Alpha Systems Private Limited');
    // Twice: DataBoard renders a table and a stacked card for the narrow
    // breakpoint, and the reviewer must see the sentence in both.
    expect(screen.getAllByText(/dated January 2026/).length).toBeGreaterThan(0);
    expect(screen.getByText('Outstanding before approval')).toBeInTheDocument();
  });
});
