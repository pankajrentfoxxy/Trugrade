/**
 * The five things about the comparison board that would be silently wrong on
 * the screen. None of these asserts that a control exists — each renders the
 * real components with the real payload shape and reads back what a buyer sees.
 *
 * 1. **Two supply points sharing a letter stay two rows.** `F · Noida` and
 *    `F · Faridabad` are different vendors. The board is keyed on the pair, and
 *    a component keyed on the code alone would drop one of them here.
 * 2. **Below the sample threshold there is no percentage.** The row reads
 *    "New supplier · 3 units inspected", and the rendered HTML contains no
 *    accuracy figure at all for that supply point.
 * 3. **An unmeasured battery renders "Not measured", never 0%.** Three seeded
 *    machines genuinely have no reading, and a 0 there is a claim about a dead
 *    battery.
 * 4. **Every percentage carries its denominator.** `100%` on its own is a claim;
 *    `100% · 14 units` is evidence.
 * 5. **Nothing on the screen names a vendor.** The serialised HTML of the board
 *    and the serial list is swept for the supplier's org id, legal name, trade
 *    name, GSTIN, PAN, address, phone and e-mail — the only sweep a future
 *    `{...row}` cannot slip past.
 */
import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { Board } from './Board';
import { UnitList } from './UnitList';
import type { OfferUnit, SupplyPointOfferRow } from '../../../lib/api';

/* ----------------------------------------------------------------- fixtures */

const VENDOR: VendorIdentity = {
  orgId: '112077be-4b0c-416c-8f61-e3af0a20c53d',
  legalName: 'Harbourpoint Technologies Private Limited',
  tradeName: 'Harbourpoint IT',
  gstin: '06AABCH1234M1Z7',
  pan: 'AABCH1234M',
  addressLines: ['Plot 44, Udyog Vihar Phase IV, Gurugram'],
  phones: ['+919810011122'],
  emails: ['ops@harbourpoint.example'],
  slug: 'harbourpoint-technologies',
};

const units = (n: number, unmeasured = 0): OfferUnit[] =>
  Array.from({ length: n }, (_, i) => ({
    serialNumber: `TGD${String(i).padStart(8, '0')}`,
    qcScore: 90 + (i % 3),
    batteryHealthPct: i < unmeasured ? null : 88 + (i % 5),
    inspectedOn: '24 Aug 2026',
    expiresOn: '22 Nov 2026',
    expiresInDays: 87,
    valuationMethod: 'REGULAR',
  }));

/**
 * The break-up is derived from the price rather than fixed, because
 * `PriceBreakup` sums the lines and has no `total` prop — a fixture whose lines
 * disagree with its headline would be testing a state the component cannot
 * produce.
 */
const linesFor = (unitPrice: number) => [
  { label: 'Unit price', amount: unitPrice.toFixed(2) },
  { label: 'Freight', amount: '149.00' },
  { label: 'IGST', amount: (Math.round((unitPrice + 149) * 18) / 100).toFixed(2) },
];

const priced = (unitPrice: number): Partial<SupplyPointOfferRow> => {
  const lines = linesFor(unitPrice);
  return {
    priceLines: lines,
    landedPrice: lines.reduce((total, l) => total + Number(l.amount), 0).toFixed(2),
  };
};

const offer = (over: Partial<SupplyPointOfferRow> = {}): SupplyPointOfferRow => ({
  listingId: '445e1874-ca5e-4d60-9d21-ad4357b230de',
  supplyPointCode: 'F',
  city: 'Noida',
  label: 'Supply Point F · Noida',
  grade: 'A',
  landedPrice: '61535.82',
  priceLines: [
    { label: 'Unit price', amount: '52000.00' },
    { label: 'Freight', amount: '149.00' },
    { label: 'IGST', amount: '9386.82' },
  ],
  isInterState: true,
  valuationMethod: 'REGULAR',
  quality: { kind: 'SCORE', avgQcScore: 91.79, gradeAccuracyPct: 100, unitsInspected: 14 },
  batteryHealthPct: { min: 89, max: 96 },
  batteryMeasured: 14,
  totalWarrantyMonths: 9,
  unitsAvailable: 14,
  inspectedOn: '24 Aug 2026',
  qcExpiresOn: '22 Nov 2026',
  qcExpiresInDays: 87,
  dispatchCommitment: 'Ships in 48 h',
  units: units(14),
  ...over,
});

/** The seeded board in miniature: both Fs, the new supplier, the MARGIN pool. */
const ROWS: SupplyPointOfferRow[] = [
  offer({
    supplyPointCode: 'B',
    city: 'Palwal',
    label: 'Supply Point B · Palwal',
    ...priced(48000),
    quality: { kind: 'NEW_SUPPLIER', unitsInspected: 3, label: 'New supplier · 3 units inspected' },
    unitsAvailable: 3,
    units: units(3),
    batteryHealthPct: { min: 83, max: 88 },
    batteryMeasured: 3,
  }),
  offer({
    supplyPointCode: 'J',
    city: 'Noida',
    label: 'Supply Point J · Noida',
    ...priced(51000),
    unitsAvailable: 12,
    units: units(12, 2),
    quality: { kind: 'SCORE', avgQcScore: 90, gradeAccuracyPct: 100, unitsInspected: 12 },
  }),
  offer(),
  offer({
    supplyPointCode: 'F',
    city: 'Faridabad',
    label: 'Supply Point F · Faridabad',
    ...priced(53500),
    unitsAvailable: 13,
    units: units(13),
    quality: { kind: 'SCORE', avgQcScore: 88.77, gradeAccuracyPct: 100, unitsInspected: 13 },
  }),
];

const board = (rows: SupplyPointOfferRow[] = ROWS, pool: 'REGULAR' | 'MARGIN' = 'REGULAR') =>
  render(
    <Board
      rows={rows}
      pool={pool}
      layout="table"
      caption={`${rows.length} supply points, sorted by landed price, lowest first.`}
    />,
  );

/* ================================================================= the tests */

describe('the two supply points that share a letter', () => {
  it('renders both, as different rows', () => {
    board();
    // Not "one F". Both, with their own cities beside them.
    expect(screen.getAllByText('Supply Point F · Noida').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Supply Point F · Faridabad').length).toBeGreaterThan(0);
  });

  it('gives them their own prices and their own stock', () => {
    const { container } = board();
    const rows = [...container.querySelectorAll('tbody tr')];
    const noida = rows.find((r) => r.textContent?.includes('Supply Point F · Noida'));
    const faridabad = rows.find((r) => r.textContent?.includes('Supply Point F · Faridabad'));

    expect(noida?.textContent).toContain('61,535.82');
    expect(faridabad?.textContent).toContain('63,305.82');
    expect(noida?.textContent).not.toContain('63,305.82');
    expect(noida?.textContent).toContain('14');
    expect(faridabad?.textContent).toContain('13');
  });
});

describe('a supply point below the sample threshold', () => {
  it('says how many units it has instead of an average', () => {
    board();
    expect(screen.getAllByText('New supplier · 3 units inspected').length).toBeGreaterThan(0);
  });

  it('publishes no accuracy percentage for it at all', () => {
    const { container } = board();
    const row = [...container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('Supply Point B · Palwal'),
    );
    // The QUALITY cell, not the whole row: the battery range beside it is a
    // measurement of the three machines themselves and is legitimately a
    // percentage. A 100% grade accuracy computed on three machines would be OUR
    // misrepresentation under CP e-Comm r.7(2), so that cell has no percentage
    // in it at all.
    const quality = row?.querySelectorAll('td')[1];
    expect(quality?.textContent).toContain('New supplier');
    expect(quality?.textContent).not.toMatch(/\d+(\.\d+)?%/);
  });
});

describe('a measurement nobody took', () => {
  it('renders "Not measured" and never a zero', () => {
    render(<UnitList units={units(4, 2)} label="Supply Point J · Noida" />);

    expect(screen.getAllByText('Not measured')).toHaveLength(2);
    // Not "0%": a machine whose battery report was never opened must not sit
    // beside one that measured 0%.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('keeps the measured ones as real percentages', () => {
    render(<UnitList units={units(4, 2)} label="Supply Point J · Noida" />);
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('91%')).toBeInTheDocument();
  });
});

describe('every percentage carries its denominator', () => {
  it('prints the sample size beside grade accuracy', () => {
    const { container } = board();
    const row = [...container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('Supply Point F · Faridabad'),
    );
    expect(row?.textContent).toContain('100%');
    expect(row?.textContent).toMatch(/13\s*units/i);
  });
});

describe('the MARGIN pool', () => {
  it('carries its ITC consequence in words, before the price', () => {
    board([offer({ valuationMethod: 'MARGIN' })], 'MARGIN');
    expect(screen.getByText(/GST charged on margin/)).toBeInTheDocument();
    expect(screen.getByText(/limited input credit/)).toBeInTheDocument();
  });
});

describe('the serial list', () => {
  it('links every serial to its unit passport', () => {
    render(<UnitList units={units(3)} label="Supply Point F · Noida" />);
    const link = screen.getAllByRole('link', { name: 'TGD00000000' })[0];
    expect(link).toHaveAttribute('href', '/unit/TGD00000000');
  });

  it('flags a certificate inside the fortnight window', () => {
    render(
      <UnitList
        units={[{ ...units(1)[0]!, expiresOn: '04 Sep 2026', expiresInDays: 8 }]}
        label="Supply Point F · Noida"
      />,
    );
    expect(screen.getByText(/Expires in 8 days/)).toBeInTheDocument();
  });
});

describe('anonymity', () => {
  it('names no vendor anywhere in the board or the serial list', () => {
    const { container: boardHtml } = board();
    const { container: unitHtml } = render(
      <UnitList units={units(4, 1)} label="Supply Point F · Noida" />,
    );

    for (const html of [boardHtml.innerHTML, unitHtml.innerHTML]) {
      expect(findVendorIdentityLeaks(html, VENDOR)).toEqual([]);
    }
  });

  it('shows the total warranty and never a split', () => {
    const { container } = board();
    const row = [...container.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.includes('Supply Point F · Noida'),
    );
    expect(row?.textContent).toContain('9 months');
    expect(container.innerHTML).not.toMatch(/vendor|platform.backed/i);
  });
});

describe('the price break-up', () => {
  it('shows every line at once behind one disclosure, never progressively', () => {
    const { container } = board([offer()]);
    const disclosure = container.querySelector('details');
    expect(disclosure).toBeInTheDocument();

    const lines = within(disclosure as HTMLElement);
    // All three lines are in the DOM the moment the disclosure is there: the
    // whole break-up is behind it, never part of it (drip pricing, CCPA 2023).
    expect(lines.getByText('Unit price')).toBeInTheDocument();
    expect(lines.getByText('Freight')).toBeInTheDocument();
    expect(lines.getByText('IGST')).toBeInTheDocument();
    // And the total is summed from the lines by the component, not sent to it.
    expect(lines.getByTestId('price-breakup-total')).toHaveTextContent('61,535.82');
  });
});
