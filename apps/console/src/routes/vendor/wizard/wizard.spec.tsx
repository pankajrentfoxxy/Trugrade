import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SerialBatch } from '@trugrade/contracts';
import userEvent from '@testing-library/user-event';
import { StepSerials } from './StepSerials';
import { StepCondition } from './StepCondition';
import { StepMachine } from './StepMachine';
import { ListingWizardRoute } from './Wizard';
import { EMPTY_DRAFT } from './draft';
import type { CatalogModelHit, SkuDetail } from '../api';

/**
 * The two behaviours in this wizard that are decisions rather than markup.
 *
 * Step 3's rule is that a brand-shape mismatch **never blocks** — worn labels
 * are real machines, and a wizard that refuses them is a wizard the warehouse
 * works around. The shape warning is not shown. Step 2's rule is that the
 * grade-correction consequence is on the screen before the vendor grades, not
 * in an appeals process after.
 */

function mockFetch(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('step 3 — serials', () => {
  it('accepts a serial the brand pattern does not recognise, without showing a shape warning', async () => {
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
    expect(screen.queryByText(/none of them stops you/)).toBeNull();
    expect(screen.queryByText(/Does not look like a Dell/)).toBeNull();
    expect(screen.queryByText(/unrecognised shape/)).toBeNull();
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
  it('shows the grade definition and the warranty terms before any field is a block', async () => {
    mockFetch(GRADE_DEFS);

    render(
      <MemoryRouter>
        <StepCondition draft={EMPTY_DRAFT} patch={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('We will check this.')).not.toBeInTheDocument();
    expect(screen.queryByText(/grade-accuracy score/)).not.toBeInTheDocument();

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

  it('only offers the grades the vendor ticked at registration', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes('offered-grades')
        ? { offeredGrades: ['A', 'B'] }
        : GRADE_DEFS;
      return { ok: true, status: 200, json: async () => body } as Response;
    });

    render(
      <MemoryRouter>
        <StepCondition draft={EMPTY_DRAFT} patch={() => {}} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Light marks, nothing through the paint.')).toBeInTheDocument();
    expect(screen.queryByText('As new.')).not.toBeInTheDocument();
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
        pickupLocationId: 'addr-1',
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

  it('does not create a listing when the net payout is empty', async () => {
    const posts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (init?.method === 'POST') posts.push(url);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    });

    sessionStorage.setItem(
      'trugrade.vendor.listing-wizard',
      JSON.stringify({
        ...EMPTY_DRAFT,
        step: 4,
        sku: { skuId: 'sku-1', skuCode: 'X', brandName: 'Dell', modelName: 'L5420' },
        pickupLocationId: 'addr-1',
        serials: ['A1'],
        netPayoutRupees: '',
      }),
    );

    render(
      <MemoryRouter>
        <ListingWizardRoute />
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /Request the inspection/ }));
    expect(posts.filter((u) => u.endsWith('/api/vendor/listings'))).toHaveLength(0);
  });
});

const MODEL_ID = '11111111-1111-1111-1111-111111111111';

const DELL_3420: CatalogModelHit = {
  modelId: MODEL_ID,
  brandName: 'Dell',
  modelName: 'Latitude 3420',
};

function catalogSku(over: Partial<SkuDetail> = {}): SkuDetail {
  return {
    skuId: 'sku-16',
    modelId: MODEL_ID,
    skuCode: 'DEL-LAT3420-I5-16-512',
    brandName: 'Dell',
    seriesName: 'Latitude',
    modelName: 'Latitude 3420',
    cpuBrand: 'Intel',
    cpuFamily: 'Core i5',
    cpuModel: 'i5-1135G7',
    cpuGeneration: '11th',
    ramGb: 16,
    storageGb: 512,
    storageType: 'NVME_SSD',
    gpuType: 'Integrated',
    gpuModel: null,
    screenSizeIn: 14,
    resolution: 'FHD',
    isTouch: false,
    osSupported: 'Windows 11 Pro',
    ...over,
  };
}

function mockModelCatalog(hits: CatalogModelHit[], skus: SkuDetail[]): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const body = url.includes('/models/search')
      ? { hits, total: hits.length, matchedBy: 'FULL_TEXT' as const }
      : url.includes('/models/') && url.endsWith('/skus')
        ? skus
        : {};
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  });
}

/**
 * Step 1 identifies a machine by brand + model, then a configuration among the
 * SKUs that model actually carries. Showing a sku_code in the picker is how a
 * vendor ends up listing the wrong RAM because they clicked the first row.
 */
describe('step 1 — machine', () => {
  it('suggests each model once, without a SKU code or a spec chip', async () => {
    const user = userEvent.setup();
    mockModelCatalog([DELL_3420], [catalogSku(), catalogSku({ skuId: 'sku-32', ramGb: 32 })]);

    render(
      <MemoryRouter>
        <StepMachine draft={EMPTY_DRAFT} patch={() => {}} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Search the catalog'), 'Dell Latitude');

    expect(await screen.findByText('Dell Latitude 3420')).toBeInTheDocument();
    expect(screen.queryByText(/DEL-LAT3420/)).not.toBeInTheDocument();
    expect(screen.queryByText(/16 GB/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Dell Latitude 3420')).toHaveLength(1);
  });

  it('asks for the configuration after a model is picked, and leaves OS as a fact', async () => {
    const user = userEvent.setup();
    const patch = vi.fn();
    mockModelCatalog(
      [DELL_3420],
      [
        catalogSku(),
        catalogSku({ skuId: 'sku-32', ramGb: 32 }),
      ],
    );

    render(
      <MemoryRouter>
        <StepMachine draft={EMPTY_DRAFT} patch={patch} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Search the catalog'), 'Latitude 3420');
    await user.click(await screen.findByRole('button', { name: 'Select' }));

    expect(await screen.findByRole('heading', { name: 'Dell Latitude 3420' })).toBeInTheDocument();
    expect(screen.getByLabelText('Processor')).toBeInTheDocument();
    expect(screen.getByLabelText('Memory')).toBeInTheDocument();
    expect(screen.getByLabelText('Storage')).toBeInTheDocument();
    expect(screen.getByLabelText('Graphics')).toBeInTheDocument();
    expect(screen.getByLabelText('Screen')).toBeInTheDocument();
    expect(screen.getByText('Windows 11 Pro')).toBeInTheDocument();
    expect(screen.queryByLabelText('Operating system')).not.toBeInTheDocument();

    const last = patch.mock.calls.at(-1)?.[0] as { sku: SkuDetail | null };
    expect(last.sku).toBeNull();

    await user.selectOptions(screen.getByLabelText('Memory'), '32');
    const after = patch.mock.calls.at(-1)?.[0] as { sku: SkuDetail | null };
    expect(after.sku?.skuId).toBe('sku-32');
    const code = await screen.findByText('DEL-LAT3420-I5-16-512');
    expect(code).toHaveClass('text-pass');
    expect(code).toHaveClass('font-bold');
  });

  it('does not let Continue through until a unique configuration is chosen', async () => {
    const user = userEvent.setup();
    mockModelCatalog(
      [DELL_3420],
      [catalogSku(), catalogSku({ skuId: 'sku-32', ramGb: 32 })],
    );

    render(
      <MemoryRouter>
        <ListingWizardRoute />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Search the catalog'), 'Latitude 3420');
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await screen.findByLabelText('Memory');

    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-disabled', 'true');

    await user.selectOptions(screen.getByLabelText('Memory'), '32');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    );
  });

  it('hands an unknown model to the SKU-request flow without inventing a match', async () => {
    const user = userEvent.setup();
    mockModelCatalog([], []);

    render(
      <MemoryRouter>
        <StepMachine draft={EMPTY_DRAFT} patch={() => {}} />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Search the catalog'), 'Framework 13');

    expect(await screen.findByText('No model matches this search')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request this SKU' })).toHaveAttribute(
      'href',
      '/vendor/sku-request?brand=Framework%2013',
    );
  });
});
