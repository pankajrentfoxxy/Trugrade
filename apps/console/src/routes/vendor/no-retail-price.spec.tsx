import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VendorDashboardRoute } from './Dashboard';
import { VendorListingsRoute } from './Listings';
import { ListingUnitsRoute, UnitDetailRoute } from './Units';
import { RepriceRoute } from './Reprice';
import { ListingWizardRoute } from './wizard/Wizard';
import { StepPrice } from './wizard/StepPrice';
import { EMPTY_DRAFT, type WizardDraft } from './wizard/draft';

/**
 * The phase exit criterion, asserted in the browser rather than only in the API
 * response test: **the vendor never sees the retail price anywhere.**
 *
 * The fixtures are adversarial on purpose. Every payload carries `unitPrice`,
 * `retailPrice` and `sellingPrice` set to a number that appears nowhere else, so
 * a screen that spreads a response into its props, or renders an unexpected
 * field, or reaches for `CommissionReadout` from `@trugrade/ui` (which draws a
 * "Listed at" row), fails here. A fixture without those fields would pass for
 * the wrong reason — it would only be proving the fixture.
 */

/** Appears in no other number on any of these screens, formatted or raw. */
const FORBIDDEN = '99999';
const POISON = {
  unitPrice: '99999.00',
  retailPrice: '99999.00',
  sellingPrice: '99999.00',
  priceBandMedian: '99999.00',
  marginAmount: '99999.00',
};

function mockApi(routes: Array<[RegExp, unknown]>): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const hit = routes.find(([re]) => re.test(url));
    return Promise.resolve({
      ok: Boolean(hit),
      status: hit ? 200 : 404,
      json: async () => hit?.[1] ?? {},
    } as Response);
  });
}

const LISTING = {
  id: 'l1',
  skuId: 's1',
  grade: 'A',
  conditionType: 'REFURBISHED',
  functionalStatus: 'FULLY_FUNCTIONAL',
  batteryHealthBand: 'GOOD_80_89',
  vendorWarrantyMonths: 6,
  vendorAskPrice: '42000.00',
  qtyTotal: 50,
  qtyAvailable: 48,
  qtyReserved: 2,
  qtyAwaitingQc: 0,
  qtyQcFailed: 1,
  status: 'ACTIVE',
  underPriceReview: false,
  gradeCorrectedFrom: null,
  qcCompletedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-10-30T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...POISON,
};

const UNIT = {
  id: 'u1',
  serialNumber: '7XKQ1P3',
  gradeDeclared: 'A',
  gradeActual: 'B',
  status: 'QC_SEALED',
  isSellable: true,
  location: 'Pune warehouse',
  vendorAskPrice: '42000.00',
  qcPassedAt: '2026-08-01T00:00:00.000Z',
  qcValidUntil: '2026-10-30T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...POISON,
};

const PREVIEW = {
  units: 50,
  perUnitPayout: '42000.00',
  grossPayout: '2100000.00',
  deductions: [{ code: 'TDS', label: 'TDS at 0.1% on value excluding GST', amount: '2100.00' }],
  totalDeductions: '2100.00',
  netPayout: '2097900.00',
  commissionPct: 12.5,
  vendorWarrantyMonths: 6,
  customerWarrantyMonths: 9,
  expectedPayoutDate: '2026-09-15T00:00:00.000Z',
  ...POISON,
};

function priceDraft(): WizardDraft {
  return {
    ...EMPTY_DRAFT,
    step: 4,
    sku: {
      skuId: 's1',
      skuCode: 'DEL-LAT-5420-A',
      brandName: 'Dell',
      seriesName: 'Latitude',
      modelName: 'Latitude 5420',
      cpuBrand: 'Intel',
      cpuFamily: 'Core i5',
      cpuModel: 'i5-1145G7',
      cpuGeneration: '11th',
      ramGb: 16,
      storageGb: 512,
      storageType: 'NVMe',
      gpuType: 'Integrated',
      gpuModel: null,
      screenSizeIn: 14,
      resolution: 'FHD',
      isTouch: false,
      osSupported: 'Windows 11 Pro',
    },
    serials: Array.from({ length: 50 }, (_, i) => `SER${i}`),
    netPayoutRupees: '42000',
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every rendered character on the screen, so nothing hides in an attribute-free node. */
function assertNoRetailPrice(container: HTMLElement): void {
  const text = container.textContent ?? '';
  expect(text).not.toContain(FORBIDDEN);
  // The Indian grouping `Money.format()` would produce if the raw string leaked
  // through `rupees()` rather than being rendered verbatim.
  expect(text).not.toContain('99,999');
  // `CommissionReadout` renders both of these and belongs to the admin side.
  expect(container.querySelector('[data-testid="selling-price"]')).toBeNull();
  expect(text).not.toContain('Listed at');
}

describe('no vendor screen shows the retail price', () => {
  it('the dashboard does not', async () => {
    mockApi([
      [
        /vendor\/dashboard/,
        {
          unitsEverListed: 46,
          unitsAwaitingQc: 12,
          unitsLive: 30,
          unitsSoldThisMonth: 4,
          unitsQcExpiring14d: 2,
          payoutsDue: '150000.00',
          payoutsDueOn: '2026-09-15T00:00:00.000Z',
          queues: {
            gradeCorrections: {
              count: 1,
              oldestWaitHours: 70,
              breachedCount: 1,
              slaHours: 48,
            },
            awaitingInspection: {
              count: 12,
              oldestWaitHours: 31,
              breachedCount: null,
              slaHours: null,
            },
          },
          ...POISON,
        },
      ],
    ]);
    const { container } = render(
      <MemoryRouter>
        <VendorDashboardRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Machines awaiting inspection');
    assertNoRetailPrice(container);
  });

  it('the listing board does not, even though the row carries the field', async () => {
    mockApi([[/vendor\/listings\?/, { rows: [LISTING], total: 1, page: 1, pageSize: 50 }]]);
    const { container } = render(
      <MemoryRouter initialEntries={['/vendor/listings']}>
        <Routes>
          <Route path="/vendor/listings" element={<VendorListingsRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('₹42,000.00');
    assertNoRetailPrice(container);
  });

  it('the repricing screen does not, and it is the one that quotes a new price', async () => {
    mockApi([
      [/vendor\/listings\/l1\/units/, [UNIT, { ...UNIT, id: 'u2', serialNumber: 'LOCKED9', payoutLocked: true }]],
      [/vendor\/listings\/l1$/, LISTING],
      [/payout-preview/, PREVIEW],
    ]);
    const { container } = render(
      <MemoryRouter initialEntries={['/vendor/listings/l1/reprice']}>
        <Routes>
          <Route path="/vendor/listings/:id/reprice" element={<RepriceRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('What will not change');
    assertNoRetailPrice(container);
  });

  it('the units table does not', async () => {
    mockApi([[/listings\/l1\/units/, [UNIT]]]);
    const { container } = render(
      <MemoryRouter initialEntries={['/vendor/listings/l1']}>
        <Routes>
          <Route path="/vendor/listings/:id" element={<ListingUnitsRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('7XKQ1P3');
    assertNoRetailPrice(container);
  });

  it('the per-unit lifecycle does not', async () => {
    mockApi([[/listings\/l1\/units/, [UNIT]]]);
    const { container } = render(
      <MemoryRouter initialEntries={['/vendor/listings/l1/units/u1']}>
        <Routes>
          <Route path="/vendor/listings/:id/units/:unitId" element={<UnitDetailRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Where this machine is');
    assertNoRetailPrice(container);
  });

  it('the payout step does not, and it is the one that knows the selling price exists', async () => {
    mockApi([[/payout-preview/, PREVIEW]]);
    const { container } = render(
      <MemoryRouter>
        <StepPrice draft={priceDraft()} patch={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByTestId('net-payout');
    assertNoRetailPrice(container);
  });

  it('the wizard shell does not, with a full draft restored from a previous session', async () => {
    sessionStorage.setItem('trugrade.vendor.listing-wizard', JSON.stringify(priceDraft()));
    mockApi([[/payout-preview/, PREVIEW]]);
    const { container } = render(
      <MemoryRouter>
        <ListingWizardRoute />
      </MemoryRouter>,
    );
    await screen.findByTestId('net-payout');
    assertNoRetailPrice(container);
  });
});

describe('what the payout step does show', () => {
  it('states the deductions, the net, the commission and the payout date', async () => {
    mockApi([[/payout-preview/, PREVIEW]]);
    render(
      <MemoryRouter>
        <StepPrice draft={priceDraft()} patch={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('net-payout')).toHaveTextContent('₹20,97,900.00');
    // A deduction the vendor cannot see until the statement arrives is drip
    // pricing, and it is exactly the surprise this screen exists to prevent.
    expect(screen.getByText(/TDS at 0.1%/)).toBeInTheDocument();
    // Twice: once as the charge and once as the total of the charges. The
    // itemisation has to add up on screen or the vendor adds it up themselves.
    expect(screen.getAllByText('−₹2,100.00')).toHaveLength(2);
    expect(screen.getByText('Deducted in total')).toBeInTheDocument();
    expect(screen.getByText(/charge, from/)).toBeInTheDocument();
    expect(screen.getByTestId('commission-pct')).toHaveTextContent('12.5%');
    expect(screen.getByText('15 Sept 2026')).toBeInTheDocument();
    // The warranty incentive, as a number rather than a claim.
    expect(
      screen.getByText(/We sell the customer 9 and fund the difference/),
    ).toBeInTheDocument();
  });

  it('says nothing rather than guessing when the payout date is absent', async () => {
    const { expectedPayoutDate: _drop, ...withoutDate } = PREVIEW;
    mockApi([[/payout-preview/, withoutDate]]);
    render(
      <MemoryRouter>
        <StepPrice draft={priceDraft()} patch={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByTestId('net-payout');
    // NOT a sentence in the value slot. "Set by your payout cycle" reads as an
    // answer; nothing has computed this date, and --ink-4 "Not calculated" is
    // the only honest rendering of a figure we do not have.
    await waitFor(() => expect(screen.getByText('Not calculated')).toBeInTheDocument());
    expect(screen.queryByText('Set by your payout cycle')).not.toBeInTheDocument();
  });
});


/**
 * The repricing screen's whole reason to exist: it names the machines that will
 * NOT move before the vendor commits.
 *
 * `unit.purchase_price` is immutable once set and the reprice handler updates
 * `WHERE purchase_price IS NULL`, so a committed machine is silently skipped. A
 * vendor who is not told which ones concludes the reprice half-failed. The
 * integration suite proves the skip against the real trigger; this proves the
 * screen says so.
 */
describe('what the repricing screen says before the button', () => {
  const OPEN = { ...UNIT, id: 'u1', serialNumber: 'OPEN0001', payoutLocked: false };
  const FROZEN = { ...UNIT, id: 'u2', serialNumber: 'FROZEN01', payoutLocked: true };

  function renderReprice(units: unknown[]): ReturnType<typeof render> {
    mockApi([
      [/vendor\/listings\/l1\/units/, units],
      [/vendor\/listings\/l1$/, LISTING],
      [/payout-preview/, PREVIEW],
    ]);
    return render(
      <MemoryRouter initialEntries={['/vendor/listings/l1/reprice']}>
        <Routes>
          <Route path="/vendor/listings/:id/reprice" element={<RepriceRoute />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('names the committed serials and counts only the movable ones on the button', async () => {
    renderReprice([OPEN, FROZEN]);

    expect(await screen.findByText('FROZEN01')).toBeInTheDocument();
    // The button promises exactly what will change. Two machines, one movable.
    expect(screen.getByRole('button', { name: /Reprice 1 machine$/ })).toBeInTheDocument();
    expect(screen.getByText(/2 machines on this listing, 1 of them repriceable/)).toBeInTheDocument();
  });

  it('refuses, with the reason, when nothing on the listing can move', async () => {
    renderReprice([FROZEN, { ...FROZEN, id: 'u3', serialNumber: 'FROZEN02' }]);

    const button = await screen.findByRole('button', { name: 'Nothing to reprice' });
    // Attempting the forbidden thing: the control is refused rather than posting
    // a request the API would correctly reject with a trigger's exception.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute(
      'title',
      expect.stringContaining('committed to an order'),
    );
  });

  it('says so plainly when nothing is committed, rather than an empty list', async () => {
    renderReprice([OPEN]);

    expect(
      await screen.findByText(/Nothing on this listing is committed to an order yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText('FROZEN01')).not.toBeInTheDocument();
  });
});
