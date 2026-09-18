import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CreateListingDialog } from './CreateListingDialog';

/**
 * The payout panel is two sums, and both have to close on screen.
 *
 *   the ask for the batch  +  our whole charge  =  what the buyer pays
 *   the ask for the batch  −  each deduction    =  what the vendor receives
 *
 * It used to print the *net* against the buyer's price with only the commission
 * between them and no deduction line at all, so any vendor with TDS withheld saw
 * three numbers short by exactly the amount nobody had named. The commission
 * itself carried the margin alone while the percentage beside it measured the
 * whole charge, so even with no deductions the column did not add up.
 *
 * What must stay absent is our cost stack — margin, warranty reserve, QC
 * allocation, freight. `pricing.service.ts` keeps those out of every
 * vendor-facing type on purpose, and a panel that "adds up" by itemising them
 * would be a different bug.
 */

const PREVIEW = {
  pricingMode: 'NET_PAYOUT',
  units: 500,
  perUnitPayout: '28000.00',
  grossPayout: '14000000.00',
  deductions: [
    {
      code: 'TDS',
      label: 'TDS at 5% — the higher no-PAN rate. Verify your PAN to bring this down.',
      amount: '462182.00',
    },
  ],
  totalDeductions: '462182.00',
  netPayout: '13537818.00',
  // 3,150,000 over the 14,000,000 ask. Our charge is quoted against the
  // vendor's own number, so the panel reads ask → plus our cut → buyer pays.
  commissionPct: 22.5,
  commissionAmount: '3150000.00',
  buyerPays: '17150000.00',
  vendorWarrantyMonths: 6,
  customerWarrantyMonths: 9,
};

const BRANDS = [{ brandId: 'b1', brandName: 'Acer' }];
const MODELS = [{ modelId: 'm1', modelName: 'Aspire 5', seriesName: 'Aspire' }];
const SKUS = [
  {
    skuId: 's1',
    skuCode: 'ACR-A51556-I31115G4-8-256',
    brandName: 'Acer',
    modelName: 'Aspire 5',
    modelId: 'm1',
    cpuVendor: 'Intel',
    cpuFamily: 'Core i3',
    cpuModel: 'i3-1115G4',
    cpuGeneration: '11th',
    ramGb: 8,
    storageGb: 256,
    storageType: 'NVME_SSD',
    screenSizeInches: '15.6',
    gpuType: 'INTEGRATED',
    gpuModel: null,
    osSupported: 'Windows 11',
    osLicenceType: 'OEM',
  },
];
const FACILITIES = [{ addressId: 'a1', label: 'Primary', city: 'Gurugram' }];

function mockApi(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const answer = (body: unknown): Promise<Response> =>
      Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    if (url.includes('/picker/brands')) return answer(BRANDS);
    if (url.includes('/picker/models')) return answer(MODELS);
    if (url.includes('/skus')) return answer(SKUS);
    if (url.includes('/facilities')) return answer(FACILITIES);
    if (url.includes('payout-preview')) return answer(PREVIEW);
    return answer(null);
  });
}

/**
 * Rupees out of "₹1,40,00,000.00", Indian grouping and all.
 *
 * Anchored on the ₹ so the Commission cell — "18.37% · ₹31,50,000.00" — yields
 * the amount and not the percentage glued to the front of it.
 */
const rupees = (text: string): number => {
  const match = /−?₹([\d,]+(?:\.\d{2})?)/.exec(text);
  if (!match) throw new Error(`No rupee figure in "${text}"`);
  return Number(match[1]!.replace(/,/g, ''));
};

/** The amount on the panel row whose label starts with `label`. */
function row(panel: HTMLElement, label: string): number {
  const dt = within(panel)
    .getAllByRole('term')
    .find((t) => t.textContent?.trim().startsWith(label));
  if (!dt) throw new Error(`No panel row starting "${label}". Rows: ${panel.textContent}`);
  const dd = dt.nextElementSibling;
  return rupees(dd?.textContent ?? '');
}

async function openPanel(): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <CreateListingDialog open onClose={vi.fn()} />
    </MemoryRouter>,
  );
  for (const label of ['Brand', 'Model', 'Processor', 'Generation', 'RAM', 'Hard disk']) {
    const select = await screen.findByLabelText(new RegExp(`^${label}`));
    const options = within(select).getAllByRole('option');
    await user.selectOptions(select, options[1]!);
  }
  await user.clear(screen.getByLabelText(/^Quantity/));
  await user.type(screen.getByLabelText(/^Quantity/), '500');
  await user.type(screen.getByLabelText(/^Your ask/), '28000');
  return screen.findByTestId('payout-preview');
}

beforeEach(() => mockApi());
afterEach(() => vi.restoreAllMocks());

describe('the payout panel', () => {
  it('closes the buyer’s sum: the ask plus our charge is what the buyer pays', async () => {
    const panel = await openPanel();
    expect(row(panel, 'Your ask') + row(panel, 'Commission')).toBe(row(panel, 'Buyer pays'));
  });

  it('closes the vendor’s sum: the ask less each deduction is what they receive', async () => {
    const panel = await openPanel();
    const deducted = PREVIEW.deductions.reduce((sum, d) => sum + Number(d.amount), 0);
    expect(row(panel, 'Your ask') - deducted).toBe(row(panel, 'You receive'));
  });

  it('names every deduction, rather than leaving a gap nobody can account for', async () => {
    const panel = await openPanel();
    expect(within(panel).getByText(/Verify your PAN to bring this down/)).toBeInTheDocument();
    expect(within(panel).getByText('−₹4,62,182.00')).toBeInTheDocument();
  });

  it('quotes a commission the vendor can check against the percentage beside it', async () => {
    const panel = await openPanel();
    const ask = row(panel, 'Your ask');
    const commission = row(panel, 'Commission');

    // The amount is exact; the percentage beside it is rounded to two decimals.
    // So a vendor multiplying it back out against their ask lands within half a
    // rounding step — 0.005% of that ask — and not always on the rupee. Stated
    // as the step rather than a flat tolerance, because it scales with the ask.
    const halfAStep = ask * 0.00005;
    expect(Math.abs(ask * (PREVIEW.commissionPct / 100) - commission)).toBeLessThan(halfAStep);
  });

  it('quotes the percentage against the ask, and says so', async () => {
    const panel = await openPanel();

    // The denominator is named, and it is the row directly above: the vendor
    // multiplies their own number by the percentage and lands on our charge.
    expect(within(panel).getByText(/of your ask/)).toBeInTheDocument();

    const ask = row(panel, 'Your ask');
    const commission = row(panel, 'Commission');
    expect(commission).toBe(ask * (PREVIEW.commissionPct / 100));

    // And not against the buyer's price, which is the basis this replaced.
    expect(commission / row(panel, 'Buyer pays')).not.toBeCloseTo(PREVIEW.commissionPct / 100, 3);
  });

  it('still itemises none of our own cost stack', async () => {
    const panel = await openPanel();
    for (const forbidden of [/margin/i, /warranty reserve/i, /QC allocation/i, /freight/i]) {
      expect(within(panel).queryByText(forbidden)).toBeNull();
    }
  });
});
