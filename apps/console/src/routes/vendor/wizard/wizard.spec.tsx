import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SerialBatch } from '@trugrade/contracts';
import userEvent from '@testing-library/user-event';
import { StepSerials } from './StepSerials';
import { StepCondition } from './StepCondition';
import { ListingWizardRoute } from './Wizard';
import { EMPTY_DRAFT } from './draft';

/**
 * The two behaviours in this wizard that are decisions rather than markup.
 *
 * Step 3's rule is that a brand-shape mismatch **warns and never blocks** — worn
 * labels are real machines, and a wizard that refuses them is a wizard the
 * warehouse works around. Step 2's rule is that the grade-correction consequence
 * is on the screen before the vendor grades, not in an appeals process after.
 */

function mockFetch(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe('step 3 — serials', () => {
  it('accepts a serial the brand pattern does not recognise, and says why it is only a warning', async () => {
    const batch: SerialBatch = {
      accepted: ['7XKQ1P3', 'WORNLABEL9'],
      errors: [],
      warnings: [
        {
          line: 2,
          serial: 'WORNLABEL9',
          message: 'Does not look like a Dell service tag (7 letters and digits).',
        },
      ],
    };
    mockFetch(batch);

    render(
      <MemoryRouter>
        <StepSerials serialText={'7XKQ1P3\nWORNLABEL9'} brandName="Dell" onChange={() => {}} />
      </MemoryRouter>,
    );

    // Both serials are ready. The warned one is NOT held back — that is the rule.
    expect(await screen.findByText('2 serials ready to add', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/none of them stops you/)).toBeInTheDocument();
    expect(
      screen.getByText(/An unrecognised shape usually means a worn or reprinted label/),
    ).toBeInTheDocument();
  });

  it('holds back the serials that are genuinely wrong and names the line', async () => {
    const batch: SerialBatch = {
      accepted: ['7XKQ1P3'],
      errors: [{ line: 2, serial: '7XKQ1P3', message: 'Already listed by another vendor.' }],
      warnings: [],
    };
    mockFetch(batch);

    render(
      <MemoryRouter>
        <StepSerials serialText={'7XKQ1P3\n7XKQ1P3'} brandName="Dell" onChange={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Line 2', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Already listed by another vendor/)).toBeInTheDocument();
  });

  it('accepts nothing when the check could not run, rather than accepting on local rules alone', async () => {
    // Uniqueness and the blacklist are the two checks a browser cannot make.
    // Proceeding without them would put a stolen serial into a listing.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const onChange = vi.fn();

    render(
      <MemoryRouter>
        <StepSerials serialText="7XKQ1P3" onChange={onChange} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      /Nothing has been added/,
    );
    expect(onChange).toHaveBeenLastCalledWith('7XKQ1P3', []);
  });
});

const GRADE_DEFS = [
  {
    grade: 'A_PLUS',
    displayName: 'A+',
    customerDescription: 'As new.',
    minBatteryHealthPct: 90,
    maxCycleCount: 300,
    minCosmeticScore: 90,
    screenDefectsAllowed: false,
  },
  {
    grade: 'A',
    displayName: 'A',
    customerDescription: 'Light marks, nothing through the paint.',
    minBatteryHealthPct: 80,
    maxCycleCount: null,
    minCosmeticScore: 75,
    screenDefectsAllowed: false,
  },
];

describe('step 2 — declaration', () => {
  it('says we will check this, and what a correction costs, before any field', async () => {
    mockFetch(GRADE_DEFS);

    render(
      <MemoryRouter>
        <StepCondition draft={EMPTY_DRAFT} patch={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText('We will check this.')).toBeInTheDocument();
    expect(screen.getByText(/grade correction/)).toBeInTheDocument();
    expect(screen.getByText(/lower your\s+grade-accuracy score/)).toBeInTheDocument();

    // Both warranty sentences PHASE_03 Task 3 step 2 requires, in plain words.
    expect(screen.getByText(/longer total term than you offer/)).toBeInTheDocument();
    expect(screen.getByText(/earns you a better price/)).toBeInTheDocument();

    // The platform's own definition, next to the grade it defines — so the
    // vendor grades against the words QC will grade against.
    expect(
      await screen.findByText('Light marks, nothing through the paint.'),
    ).toBeInTheDocument();
  });

  /**
   * The declaration is checkable before it is submitted, and this is the check.
   *
   * It attempts the mismatch rather than asserting the guard exists: a draft
   * that says Grade A+ and 80–89% battery cannot clear A+'s 90% floor at the top
   * of its own band, so the screen must say so. Warns, never blocks — the vendor
   * may have read the band off a worn machine.
   */
  it('warns when the declared battery band cannot reach the chosen grade floor', async () => {
    mockFetch(GRADE_DEFS);

    render(
      <MemoryRouter>
        <StepCondition
          draft={{ ...EMPTY_DRAFT, grade: 'A_PLUS', batteryHealthBand: 'GOOD_80_89' }}
          patch={() => {}}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/needs battery health of/)).toBeInTheDocument();
    expect(screen.getByText(/the inspection will correct the grade downwards/)).toBeInTheDocument();
    // Not a block. Nothing on the screen refuses the declaration.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing when the band could clear the floor', async () => {
    mockFetch(GRADE_DEFS);

    render(
      <MemoryRouter>
        <StepCondition
          draft={{ ...EMPTY_DRAFT, grade: 'A', batteryHealthBand: 'GOOD_80_89' }}
          patch={() => {}}
        />
      </MemoryRouter>,
    );

    await screen.findByText('Light marks, nothing through the paint.');
    expect(screen.queryByText(/needs battery health of/)).not.toBeInTheDocument();
  });

  /**
   * UNKNOWN has no ceiling, and a missing measurement must not render as a
   * passing one. It also must not render as a failing one — the honest outcome
   * is silence on this comparison, which is what `BATTERY_CEILING[UNKNOWN]` is
   * null for.
   */
  it('does not compare an unmeasured battery band against any floor', async () => {
    mockFetch(GRADE_DEFS);

    render(
      <MemoryRouter>
        <StepCondition
          draft={{ ...EMPTY_DRAFT, grade: 'A_PLUS', batteryHealthBand: 'UNKNOWN' }}
          patch={() => {}}
        />
      </MemoryRouter>,
    );

    await screen.findByText('As new.');
    expect(screen.queryByText(/needs battery health of/)).not.toBeInTheDocument();
  });
});


/**
 * Answering the batch-size question must re-submit the listing that already
 * exists, never build a second one.
 *
 * `POST /:id/submit` returns DECISION_REQUIRED *after* the listing and its units
 * are written — the vendor is being asked a question, not refused, so nothing is
 * rolled back. The bug this asserts against ran create → attach → submit a
 * second time on the accept-fee press, which meant `POST /:id/units` was handed
 * serials the vendor's own draft was already holding. The API correctly refused
 * them, and the vendor was left with two drafts, an error calling their own
 * machines duplicates, and no inspection. Found by photographing the state.
 */
describe('the batch-size decision', () => {
  it('submits the listing it already created instead of creating a second one', async () => {
    const posts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (init?.method === 'POST') posts.push(url);
      const body =
        url.endsWith('/submit')
          ? {
              outcome: 'DECISION_REQUIRED',
              unitCount: 3,
              minUnitsPerVisit: 25,
              shortBy: 22,
              visitFee: '1500.00',
              options: ['HOLD', 'ACCEPT_FEE'],
            }
          : url.endsWith('/units')
            ? { added: 3 }
            : url.endsWith('/api/vendor/listings')
              ? { id: 'listing-1' }
              // The payout preview, which step 4 renders on the way to the
              // batch-size question. It used to fall through to `{}`, and
              // `StepPrice` maps over `preview.deductions` — so this fixture
              // threw an unhandled TypeError after the assertions had already
              // passed, which vitest reports as a failed FILE whenever the
              // rejection lands inside the run rather than after it. A response
              // shape the API cannot produce is not a useful stub.
              : url.endsWith('/payout-preview')
                ? {
                    pricingMode: 'NET_PAYOUT',
                    units: 3,
                    perUnitPayout: '42000.00',
                    grossPayout: '126000.00',
                    deductions: [],
                    totalDeductions: '0.00',
                    netPayout: '126000.00',
                    commissionPct: 14,
                    vendorWarrantyMonths: 3,
                    customerWarrantyMonths: 6,
                  }
                : {};
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    });

    sessionStorage.setItem(
      'trugrade.vendor.listing-wizard',
      JSON.stringify({
        ...EMPTY_DRAFT,
        step: 4,
        sku: { skuId: 'sku-1', skuCode: 'X', brandName: 'Dell', modelName: 'L5420' },
        serials: ['A1', 'A2', 'A3'],
        netPayoutRupees: '42000',
      }),
    );

    render(
      <MemoryRouter>
        <ListingWizardRoute />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Request the inspection/ }));
    await screen.findByText(/fewer than the 25 a visit is worth/);

    const afterFirst = posts.filter((u) => u.endsWith('/api/vendor/listings')).length;
    expect(afterFirst).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: /inspect now/ }));

    // The forbidden thing, attempted: a second create and a second attach of the
    // same three serials.
    await waitFor(() =>
      expect(posts.filter((u) => u.endsWith('/submit'))).toHaveLength(2),
    );
    expect(posts.filter((u) => u.endsWith('/api/vendor/listings'))).toHaveLength(1);
    expect(posts.filter((u) => u.endsWith('/units'))).toHaveLength(1);
  });
});
