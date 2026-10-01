/**
 * The four things about `/search` that would be silently wrong on the screen.
 *
 * None of these asserts that a control exists. Each drives the screen and reads
 * back what a buyer would see.
 *
 * 1. **A URL with filters reproduces the view.** The rail is handed nothing but
 *    the query string and the facet payload, so a link a colleague was sent must
 *    come up with the same boxes ticked and the same chips shown. Anything that
 *    quietly kept state in the component instead would fail here.
 * 2. **A zero-count option renders disabled, not absent.** Both are asserted:
 *    the row is in the document AND its checkbox refuses to be ticked. Asserting
 *    only that it is disabled would pass on a rail that never rendered it.
 * 3. **Nothing on the screen names a vendor.** The rendered HTML of the rail and
 *    the results table is swept for the supplier's org id, legal name, trade
 *    name, GSTIN, address, phone and email — at any depth, on the serialised
 *    output, which is the only sweep a future `{...row}` cannot slip past.
 * 4. **No checkbox arrives ticked, and a missing measurement is never a zero.**
 *    Rule 4(9) forbids a pre-ticked box; a battery we did not measure rendering
 *    as 0% would be a misrepresentation of the machine.
 */
import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { FilterRail } from '../FilterRail';
import { toApiQueryString } from './query';
import { ResultsList } from './ResultsList';
import type { FacetGroup, SearchResult } from '../../lib/api';

/* --------------------------------------------------------------- the router */

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

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

const group = (key: string, options: Array<[string, string, number, boolean?]>): FacetGroup => ({
  key,
  options: options.map(([value, label, count, selected]) => ({
    value,
    label,
    count,
    selected: selected ?? false,
  })),
});

/** Shaped exactly like the live `/api/public/search` payload. */
function facets(selected: { brand?: string[]; ram?: string[]; grade?: string[] } = {}) {
  const on = (list: string[] | undefined, v: string): boolean => (list ?? []).includes(v);
  return {
    brand: group('brand', [
      ['acer', 'Acer', 48, on(selected.brand, 'acer')],
      ['dell', 'Dell', 0, on(selected.brand, 'dell')],
      ['hp', 'HP', 0, on(selected.brand, 'hp')],
    ]),
    series: group('series', [['Aspire', 'Aspire', 48]]),
    cpu: group('cpu', [
      ['Core i5', 'Core i5', 24],
      ['Ryzen 7', 'Ryzen 7', 0],
    ]),
    gen: group('gen', [['11th', '11th gen', 48]]),
    ram: group('ram', [
      ['8', '8 GB', 32, on(selected.ram, '8')],
      ['16', '16 GB', 16, on(selected.ram, '16')],
      ['64', '64 GB', 0, on(selected.ram, '64')],
    ]),
    sgb: group('sgb', [['256', '256 GB', 24]]),
    stype: group('stype', [['NVME_SSD', 'NVMe SSD', 48]]),
    grade: group('grade', [
      ['A_PLUS', 'A+ · near new', 8, on(selected.grade, 'A_PLUS')],
      ['A', 'A · excellent', 24, on(selected.grade, 'A')],
      ['B', 'B · good', 16, on(selected.grade, 'B')],
    ]),
    screen: group('screen', [['15', '15"', 48]]),
    res: group('res', [
      ['fhd', 'Full HD or better', 48],
      ['touch', 'Touchscreen', 0],
    ]),
    ship: group('ship', [['48', 'Ships in 48 h', 48]]),
    city: group('city', [['Gurugram', 'Gurugram', 48]]),
    qty: group('qty', [['10', '10+ at one supply point', 0]]),
    feat: group('feat', [
      ['backlit', 'Backlit keyboard', 48],
      ['fingerprint', 'Fingerprint reader', 0],
    ]),
    warr: group('warr', [
      ['6', '6 months', 0],
      ['12', '12 months (extended)', 0],
    ]),
    cycles: {
      key: 'cycles',
      options: [],
      unavailable: 'Battery cycle count is not recorded at inspection yet.',
    },
    charger: {
      key: 'charger',
      options: [],
      unavailable: 'Whether a charger is included is not recorded at inspection yet.',
    },
  };
}

const RESULTS: SearchResult[] = [
  {
    skuId: 'sku-1',
    grade: 'A',
    brand: 'Acer',
    model: 'Aspire 5 A515-56',
    spec: 'i5-1135G7 · 16 GB · 512 GB NVMe SSD · 15.6"',
    fromPrice: 32500,
    unitsAvailable: 8,
    supplyPoints: 1,
    avgQcScore: 88,
    batteryMin: 85,
    batteryMax: 92,
    batteryMeasured: 8,
    shipHours: 48,
    warrantyMonths: null,
    cities: ['Gurugram'],
    sampleSerial: 'TGD1003FCD',
    ramGb: 16,
    storageGb: 512,
    storageType: 'NVME_SSD',
    cpuLine: 'Intel Core i5-1135G7',
    displayLine: '15.6" FHD (1920x1080)',
  },
  {
    // The machine nobody opened the battery report on.
    skuId: 'sku-2',
    grade: 'B',
    brand: 'Acer',
    model: 'Aspire 5 A515-56',
    spec: 'i3-1115G4 · 8 GB · 256 GB NVMe SSD · 15.6"',
    fromPrice: 41500,
    unitsAvailable: 4,
    supplyPoints: 1,
    avgQcScore: null,
    batteryMin: null,
    batteryMax: null,
    batteryMeasured: 0,
    shipHours: 48,
    warrantyMonths: null,
    cities: ['Gurugram'],
    sampleSerial: 'TGD50082E5',
    ramGb: 8,
    storageGb: 256,
    storageType: 'NVME_SSD',
    cpuLine: 'Intel Core i3-1115G4',
    displayLine: '15.6" FHD (1920x1080)',
  },
];

beforeEach(() => push.mockClear());

/* -------------------------------------------------------------------- tests */

describe('the search board reproduces its URL', () => {
  it('renders exactly what the query string says, with no state of its own', () => {
    const query = 'brand=acer&ram=16&grade=A&bmin=85&q=aspire';
    render(
      <FilterRail
        facets={facets({ brand: ['acer'], ram: ['16'], grade: ['A'] })}
        query={query}
        total={8}
      />,
    );

    // The boxes the link says are ticked.
    expect(screen.getByRole('checkbox', { name: /^Acer/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^16 GB/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^A · excellent/ })).toBeChecked();

    // ...and the ones it does not.
    expect(screen.getByRole('checkbox', { name: /^8 GB/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^B · good/ })).not.toBeChecked();

    // The free-text and range values, back in their boxes.
    // The box is for the NEXT word; the applied one is the chip below it.
    expect(screen.getByPlaceholderText('Search within results')).toHaveValue('');
    expect(screen.getByLabelText(/Minimum measured battery health/)).toHaveValue(85);

    // Every applied filter is a removable chip, and each one reads as English
    // rather than as `bmin=85`.
    expect(screen.getByRole('button', { name: /Acer/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Battery 85%\+/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /“aspire”/ })).toBeInTheDocument();
    expect(screen.getByText('5 applied')).toBeInTheDocument();

    // Ticking one more writes it back to the URL rather than into local state.
    screen.getByRole('checkbox', { name: /^B · good/ }).click();
    expect(push).toHaveBeenCalledTimes(1);
    const target = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
    expect(target.getAll('grade')).toEqual(['A', 'B']);
    expect(target.getAll('brand')).toEqual(['acer']);
    expect(target.get('bmin')).toBe('85');
  });

  it('shows a zero-count option, disabled, rather than hiding it', () => {
    render(<FilterRail facets={facets()} query="" total={48} />);

    // Present. A rail that dropped the row would fail here first.
    const dell = screen.getByRole('checkbox', { name: /^Dell/ });
    expect(dell).toBeInTheDocument();
    expect(within(dell.closest('label')!).getByText('0')).toBeInTheDocument();

    // And unusable — attempted, not merely inspected. Clicking a disabled
    // checkbox must not navigate.
    expect(dell).toBeDisabled();
    dell.click();
    expect(push).not.toHaveBeenCalled();

    // The same rule for a facet that used to be drawn as pills and is a
    // checkbox like the rest now.
    expect(screen.getByRole('checkbox', { name: /Ryzen 7/ })).toBeDisabled();

    // A dimension nothing MEASURES is a different statement again. The rail
    // used to print a sentence saying so; it now prints nothing for it — and
    // still never a row of zeroes, which would read as "we checked and found
    // none".
    expect(
      screen.queryByText('Battery cycle count is not recorded at inspection yet.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Whether a charger is included is not recorded at inspection yet.'),
    ).not.toBeInTheDocument();
  });

  it('ticks the option that follows from a choice in another group', () => {
    // A series was chosen, and it left one brand with stock. Unfiltered, the
    // shelf held two brands — so this is a consequence of the choice.
    const narrowed = {
      ...facets(),
      brand: group('brand', [
        ['acer', 'Acer', 48],
        ['dell', 'Dell', 0],
        ['hp', 'HP', 0],
      ]),
      series: group('series', [['Aspire', 'Aspire', 48, true]]),
    };
    const shelf = {
      ...facets(),
      brand: group('brand', [
        ['acer', 'Acer', 48],
        ['dell', 'Dell', 30],
        ['hp', 'HP', 0],
      ]),
    };
    render(<FilterRail facets={narrowed} baseline={shelf} query="series=Aspire" total={48} />);

    const acer = screen.getByRole('checkbox', { name: /^Acer/ });
    expect(acer).toBeChecked();
    // It cannot be cleared here: clearing the series is what clears it.
    expect(acer).toBeDisabled();
    // A readout, not a filter — the URL and the count are the buyer's own.
    expect(screen.getByText('1 applied')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('does not tick an option the shelf only ever had one of', () => {
    // The same narrowed rail, but unfiltered there was only ever one brand
    // with stock. Ticking it would credit the buyer with the catalogue's doing.
    const narrowed = {
      ...facets(),
      series: group('series', [['Aspire', 'Aspire', 48, true]]),
    };
    render(<FilterRail facets={narrowed} baseline={facets()} query="series=Aspire" total={48} />);
    expect(screen.getByRole('checkbox', { name: /^Acer/ })).not.toBeChecked();
  });

  it("ticks nothing on the buyer's behalf when the unfiltered read is missing", () => {
    const narrowed = {
      ...facets(),
      series: group('series', [['Aspire', 'Aspire', 48, true]]),
    };
    render(<FilterRail facets={narrowed} query="series=Aspire" total={48} />);
    expect(screen.getByRole('checkbox', { name: /^Acer/ })).not.toBeChecked();
  });

  it('applies a search word on Enter, as its own chip, and empties the box for the next', () => {
    render(<FilterRail facets={facets()} query="q=acer" total={48} />);
    const box = screen.getByPlaceholderText('Search within results');
    // The word already applied is a chip, not text in the box.
    expect(box).toHaveValue('');
    expect(screen.getByRole('button', { name: /“acer”/ })).toBeInTheDocument();

    fireEvent.change(box, { target: { value: '  i5 ' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    // Appended, trimmed, beside the first — never in place of it.
    expect(push).toHaveBeenCalledTimes(1);
    const target = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
    expect(target.getAll('q')).toEqual(['acer', 'i5']);
    expect(box).toHaveValue('');
  });

  it('applies a word that names a filter option as that filter, not as a search', () => {
    render(<FilterRail facets={facets()} query="" total={48} />);
    const box = screen.getByPlaceholderText('Search within results');

    // The brand, by its label, case aside.
    fireEvent.change(box, { target: { value: 'ACER' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    let target = new URLSearchParams(String(push.mock.calls[0]![0]).split('?')[1]);
    expect(target.getAll('brand')).toEqual(['acer']);
    expect(target.get('q')).toBeNull();

    // The memory option, by its label.
    fireEvent.change(box, { target: { value: '16 GB' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    target = new URLSearchParams(String(push.mock.calls[1]![0]).split('?')[1]);
    expect(target.getAll('ram')).toEqual(['16']);
    expect(target.get('q')).toBeNull();

    // Part of a label is not the label: a search term, as before.
    fireEvent.change(box, { target: { value: 'i5' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    target = new URLSearchParams(String(push.mock.calls[2]![0]).split('?')[1]);
    expect(target.getAll('q')).toEqual(['i5']);
    expect(box).toHaveValue('');
  });

  it('does not apply an empty or repeated word, and nothing applies without Enter', () => {
    // 'thinkpad' names no option in the fixture, so it is a plain search term.
    render(<FilterRail facets={facets()} query="q=thinkpad" total={48} />);
    const box = screen.getByPlaceholderText('Search within results');
    fireEvent.change(box, { target: { value: 'lenovo' } });
    expect(push).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: 'thinkpad' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();
  });

  it('sends every word to the API as one term, which matches all of them', () => {
    expect(
      new URLSearchParams(toApiQueryString({ q: ['acer', 'i5'], brand: 'acer' })).get('q'),
    ).toBe('acer i5');
  });

  it('arrives with no box ticked and no filter applied', () => {
    render(<FilterRail facets={facets()} query="" total={48} />);
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.getByText('0 applied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
  });

  it('renders an unmeasured battery as "Not measured", never as a zero', () => {
    render(<ResultsList results={RESULTS} sortLabel="landed price, low to high" />);

    // The measured row carries its denominator.
    expect(screen.getByText(/85–92%/)).toBeInTheDocument();
    expect(screen.getByText(/8 of 8/)).toBeInTheDocument();

    // The unmeasured row says so, and says it twice — battery and score.
    expect(screen.getAllByText('Not measured')).toHaveLength(2);
    // No "0%" and no "0 / 100" anywhere: a machine we did not open must not
    // look like a machine that failed.
    expect(screen.queryByText(/\b0%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b0\s*\/\s*100/)).not.toBeInTheDocument();
  });
});

describe('vendor anonymity', () => {
  it('names no supplier anywhere in the rail or the results', () => {
    const rail = render(
      <FilterRail facets={facets()} query="brand=acer&city=Gurugram" total={48} />,
    );
    const list = render(<ResultsList results={RESULTS} sortLabel="landed price, low to high" />);

    for (const [what, html] of [
      ['filter rail', rail.container.innerHTML],
      ['results table', list.container.innerHTML],
    ] as const) {
      const leaks = findVendorIdentityLeaks(html, VENDOR);
      expect({ what, leaks }).toEqual({ what, leaks: [] });
    }

    // The city IS shown, and is the only thing about the source that is: a
    // supply point is a dispatch city, never a company.
    expect(list.getAllByText('Gurugram').length).toBeGreaterThan(0);
  });
});
