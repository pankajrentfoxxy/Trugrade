/**
 * The things about the per-serial machine board that would be silently wrong on
 * it.
 *
 * None of these is a "the table renders" assertion. This is the one screen in
 * the product made entirely of measurements, so each test attempts the failure
 * that shape of screen invites and expects the refusal:
 *
 * 1. **A missing value never renders as a passing one.** The machine with no
 *    battery reading must say so in words. Not a dash, not an empty cell, not a
 *    zero bar — and, in the exported CSV, not a blank, because a blank battery
 *    column gets a zero the moment somebody averages it in a spreadsheet.
 * 2. **A missing value never sorts as a passing one either.** Sorted by battery
 *    ascending, the unmeasured machine is not the worst one on the order; sorted
 *    descending it is not the best. It goes last both ways.
 * 3. **Every percentage carries its denominator.** "87%" alone is not a
 *    statement; "87% measured on 2 of 3" is.
 * 4. **Both grades survive.** A machine priced at A and inspected at B shows
 *    both, because collapsing them is how a downgrade disappears from the only
 *    record the buyer keeps.
 * 5. **The board reproduces itself from the URL alone**, and every control
 *    writes back to it rather than into local state.
 * 6. **No vendor identifier, anywhere, at any depth**, swept with the same
 *    `findVendorIdentityLeaks` the API's own anonymity tests use.
 */
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { UnitsBoard } from './UnitsBoard';
import type { OrderUnits, OrderedUnit } from './api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getOrderUnits: jest.fn(),
}));

import { getOrderUnits } from './api';

const mockGet = getOrderUnits as jest.MockedFunction<typeof getOrderUnits>;

/* ----------------------------------------------------------------- fixtures */

/** The vendor behind Supply Point L. Every field of it is swept for below. */
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

const machine = (over: Partial<OrderedUnit> = {}): OrderedUnit => ({
  serialNumber: 'TGD88DA0397',
  title: 'Dell Latitude 5420',
  specSummary: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14"',
  gradeOrdered: 'A',
  gradeActual: 'A',
  unitPrice: '44900.00',
  verdict: 'PASS',
  qcScore: 81,
  batteryHealthPct: 82,
  inspectedOn: '2026-08-26',
  seal: { code: 'TG-TGD88DA0397', status: 'APPLIED' },
  passportPath: '/unit/TGD88DA0397',
  ...over,
});

/** A clean pass, a machine nobody read the battery on, and a failure. */
const CLEAN = machine();
const UNMEASURED = machine({
  serialNumber: 'TGDEC296FDC',
  passportPath: '/unit/TGDEC296FDC',
  batteryHealthPct: null,
  qcScore: 93,
  seal: { code: 'TG-TGDEC296FDC', status: 'APPLIED' },
});
const FAILED = machine({
  serialNumber: 'TGD16FE7D62',
  passportPath: '/unit/TGD16FE7D62',
  verdict: 'FAIL',
  qcScore: 41,
  batteryHealthPct: 93,
  gradeOrdered: 'A',
  gradeActual: 'B',
  seal: { code: 'TG-TGD16FE7D62', status: 'BROKEN' },
});

const units = (over: Partial<OrderUnits> = {}): OrderUnits => ({
  orderNumber: 'TT-26-00004',
  status: 'PAYMENT_PENDING',
  placedAt: '2026-08-29T21:28:25.293Z',
  units: [CLEAN, UNMEASURED, FAILED],
  ...over,
});

/**
 * Render and wait for the ROWS, not for the table.
 *
 * `DataBoard` keeps the real header and real column names on screen while it
 * loads, which is the right behaviour and makes `findByRole('table')` resolve
 * against the skeleton. A test that waited on the table alone would assert
 * against six rows of placeholder and pass for the wrong reason.
 */
const show = async (query = '', data: OrderUnits = units()): Promise<void> => {
  mockGet.mockResolvedValue({ ok: true, data });
  render(<UnitsBoard orderNumber="TT-26-00004" query={query} />);
  await screen.findByRole('table');
  await waitFor(() =>
    expect(screen.queryByText('Reading the inspections…')).not.toBeInTheDocument(),
  );
};

/** The row for one serial, found by the serial rather than by position. */
const rowFor = (serial: string): HTMLElement => {
  const cell = screen.getByRole('link', { name: serial });
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${serial}`);
  return row;
};

const serialOrder = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('link')[0]?.textContent ?? '');

beforeEach(() => {
  mockGet.mockReset();
  push.mockReset();
});

afterEach(cleanup);

/* ==========================================================================
 * 1. A missing measurement is a missing measurement
 * ======================================================================== */

describe('a value we did not measure', () => {
  it('says so in words, and never draws a bar, a zero or a blank cell', async () => {
    await show();
    const row = rowFor('TGDEC296FDC');

    expect(within(row).getByText('Not measured')).toBeInTheDocument();
    // The bar is what a present reading looks like. Its absence here is the
    // whole point: a zero-width bar reads as a dead battery and a full one as a
    // healthy machine, and neither was measured.
    expect(within(row).queryByTestId('battery-bar')).not.toBeInTheDocument();
    expect(row.textContent).not.toMatch(/\b0%/);
  });

  it('renders it at --ink-4, not as an empty cell that reads as a pass', async () => {
    await show();
    const said = within(rowFor('TGDEC296FDC')).getByText('Not measured');
    expect(said).toHaveClass('notmeasured');
  });

  it('says which measurements are absent one by one, not with a single blanket', async () => {
    await show(
      '',
      units({
        units: [
          machine({
            serialNumber: 'TGDNOTHING01',
            passportPath: '/unit/TGDNOTHING01',
            verdict: null,
            qcScore: null,
            batteryHealthPct: null,
            gradeActual: null,
            inspectedOn: null,
            seal: null,
          }),
        ],
      }),
    );
    const row = rowFor('TGDNOTHING01');
    for (const said of [
      'Not inspected',
      'Not graded',
      'Not measured',
      'Not scored',
      'No seal recorded',
    ]) {
      expect(within(row).getAllByText(said).length).toBeGreaterThan(0);
    }
  });

  /**
   * The figure row is where a null would do the most damage: `[82, null, 93]`
   * averaged as three would report 58%, and averaged as three strings would
   * report something worse. The denominator is what makes the number readable.
   */
  it('averages only what was measured, and says what it was measured on', async () => {
    await show();
    // (82 + 93) / 2 = 87.5 → 88. Not (82 + 0 + 93) / 3 = 58.
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText(/measured on 2 of 3/)).toBeInTheDocument();
  });

  it('reports no average at all when nothing was measured, rather than 0%', async () => {
    await show('', units({ units: [UNMEASURED] }));
    expect(screen.getByText('No battery was measured')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

/* ==========================================================================
 * 2. A missing measurement does not sort as a passing one
 * ======================================================================== */

describe('sorting by a measurement', () => {
  it('puts the unmeasured machine last ascending — it is not the worst battery', async () => {
    await show('sort=battery&dir=asc');
    expect(serialOrder()).toEqual(['TGD88DA0397', 'TGD16FE7D62', 'TGDEC296FDC']);
  });

  it('puts it last descending too — it is not the best one either', async () => {
    await show('sort=battery&dir=desc');
    expect(serialOrder()).toEqual(['TGD16FE7D62', 'TGD88DA0397', 'TGDEC296FDC']);
  });
});

/* ==========================================================================
 * 3. Both grades, and the verdict in words
 * ======================================================================== */

describe('a machine that was re-graded after it was priced', () => {
  it('shows the grade it was sold at as well as the grade it came back at', async () => {
    await show();
    const row = rowFor('TGD16FE7D62');
    const badge = within(row).getByTestId('grade-badge');
    // Both letters, not just the new one. A downgrade that only shows the new
    // grade is a downgrade the buyer's own record has lost.
    expect(badge.textContent).toContain('B');
    expect(badge.textContent).toContain('A');
    expect(within(row).getByText(/Re-graded from/)).toBeInTheDocument();
  });

  it('never leaves a verdict to colour alone', async () => {
    await show();
    expect(within(rowFor('TGD16FE7D62')).getByText('Fail')).toBeInTheDocument();
    expect(within(rowFor('TGD16FE7D62')).getByText('Seal broken')).toBeInTheDocument();
    expect(within(rowFor('TGD88DA0397')).getByText('Pass')).toBeInTheDocument();
  });
});

/* ==========================================================================
 * 4. The board is its URL
 * ======================================================================== */

describe('the board reproduces its state from the URL alone', () => {
  it('applies the filter and the sort the address bar names', async () => {
    await show('show=attention&sort=score&dir=asc');
    // The clean machine is filtered out; the failure and the unmeasured one are
    // the two that need a look.
    expect(serialOrder()).toEqual(['TGD16FE7D62', 'TGDEC296FDC']);
    expect(screen.getByRole('columnheader', { name: /Score/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('keeps nothing from the board before it', async () => {
    await show('show=attention');
    expect(serialOrder()).toHaveLength(2);
    cleanup();

    await show('');
    expect(serialOrder()).toHaveLength(3);
  });

  it('puts a filter change into the URL rather than into itself', async () => {
    await show();
    screen.getByRole('button', { name: /Needs a look/ }).click();
    expect(push).toHaveBeenCalledWith('/account/orders/TT-26-00004/units?show=attention', {
      scroll: false,
    });
  });

  it('puts a sort change into the URL, and flips direction on a second click', async () => {
    await show('sort=battery&dir=asc');
    screen.getByRole('button', { name: /Battery/ }).click();
    expect(push).toHaveBeenCalledWith('/account/orders/TT-26-00004/units?sort=battery&dir=desc', {
      scroll: false,
    });
  });
});

/* ==========================================================================
 * 5. The export — the asset register, as a file
 * ======================================================================== */

describe('the CSV export', () => {
  let written = '';

  beforeEach(() => {
    written = '';
    // jsdom has neither, and the Blob's text is the only thing worth asserting.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        // `Blob.text()` is async and the click is not, so the parts are read
        // from the constructor argument the component passed.
        written = (blob as Blob & { __parts?: string[] }).__parts?.join('') ?? '';
        return 'blob:stub';
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });

    const RealBlob = global.Blob;
    class RecordingBlob extends RealBlob {
      readonly __parts: string[];
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        this.__parts = parts.map(String);
      }
    }
    global.Blob = RecordingBlob as unknown as typeof Blob;
  });

  const exported = async (query = ''): Promise<string> => {
    await show(query);
    screen.getByRole('button', { name: /asset register/ }).click();
    return written;
  };

  /**
   * The failure mode this exists to prevent: an empty battery cell in a
   * spreadsheet is read as a zero the first time somebody averages the column,
   * and a fleet of 46 machines is then reported as having half the battery
   * health it has.
   */
  it('writes the words for a measurement that is missing, never a blank', async () => {
    const csv = await exported();
    const row = csv.split('\r\n').find((line) => line.includes('TGDEC296FDC'));
    expect(row).toContain('"Not measured"');
    expect(row).not.toContain(',,');
  });

  it('carries the serial, both grades, the verdict and the seal for every row', async () => {
    const csv = await exported();
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('"Serial number"');
    expect(lines[0]).toContain('"Grade ordered"');
    expect(lines[0]).toContain('"Grade inspected"');
    expect(lines).toHaveLength(4); // header + three machines
    const failed = lines.find((line) => line.includes('TGD16FE7D62'));
    expect(failed).toContain('"Fail"');
    expect(failed).toContain('"BROKEN"');
    expect(failed).toContain('"A"');
    expect(failed).toContain('"B"');
  });

  /** What is on screen is what comes out of the button. */
  it('exports the filtered set, not the whole order, when a filter is applied', async () => {
    const csv = await exported('show=attention');
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).not.toContain('TGD88DA0397');
  });
});

/* ==========================================================================
 * 6. No vendor, anywhere
 * ======================================================================== */

describe('vendor anonymity', () => {
  it('carries no vendor identifier in the rendered board, at any depth', async () => {
    const { container } = { container: document.body };
    await show();
    const leaks = findVendorIdentityLeaks(container.innerHTML, VENDOR);
    expect(leaks).toEqual([]);
  });

  it('uses none of our purchase-order vocabulary', async () => {
    await show();
    const text = document.body.innerHTML.toLowerCase();
    for (const word of ['vendor', 'supplier', 'purchase order', 'sub-order', 'payout']) {
      expect(text).not.toContain(word);
    }
  });
});

/* ==========================================================================
 * 7. The states that are not the board
 * ======================================================================== */

describe('the states that are not the board', () => {
  it('answers a foreign order and a missing one with the same screen', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'not found',
      fields: {},
      retryAfterSeconds: null,
    });
    render(<UnitsBoard orderNumber="TT-26-09999" query="" />);
    // The wording must not distinguish "does not exist" from "not yours" —
    // order numbers are sequential and a distinction is an order-volume oracle.
    expect(
      await screen.findByText(/no order with that number on your account/i),
    ).toBeInTheDocument();
  });

  it('tells a signed-out visitor how to come back to this exact list', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'sign in',
      fields: {},
      retryAfterSeconds: null,
    });
    render(<UnitsBoard orderNumber="TT-26-00004" query="" />);
    const link = await screen.findByRole('link', { name: /Sign in/ });
    expect(link).toHaveAttribute('href', '/sign-in?next=%2Faccount%2Forders%2FTT-26-00004%2Funits');
  });

  it('says a pre-allocation order has no machines yet, rather than showing none', async () => {
    await show('', units({ units: [] }));
    expect(screen.getByText(/No machines are assigned to this order yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /asset register/ })).toBeDisabled();
  });
});
