import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BulkUploadRoute } from './BulkUpload';
import { refuseByMagicBytes, MAX_ROWS } from './csvFile';

/**
 * T29, asserted by trying to break it.
 *
 * Two claims the screen makes that the API cannot make for it:
 *
 *   1. **The number in the sentence is the number on the button.** They were two
 *      different counts — the sentence printed `willAdd` (clean rows) and the
 *      button offered the accepted set (clean + warned) — so a file with 28
 *      warnings said "412 will be added" above a button reading "Add 440
 *      machines". Neither was lying; they meant different things by the same
 *      word, which is worse.
 *   2. **A workbook is refused, not half-parsed.** The extension and the
 *      browser's MIME type are both attacker-controlled; the first bytes are
 *      not. A `.csv` beginning `PK` is a zip, and a zip through a CSV parser is
 *      four thousand rows of nonsense instead of one sentence naming the file.
 */

const LISTING = {
  id: 'l1',
  skuId: 's1',
  grade: 'A_PLUS',
  conditionType: 'REFURBISHED',
  functionalStatus: 'FULLY_FUNCTIONAL',
  batteryHealthBand: 'GOOD_80_89',
  vendorWarrantyMonths: 6,
  vendorAskPrice: '40000.00',
  qtyTotal: 12,
  qtyAvailable: 12,
  qtyReserved: 0,
  qtyAwaitingQc: 0,
  qtyQcFailed: 0,
  status: 'DRAFT',
  underPriceReview: false,
  gradeCorrectedFrom: null,
  qcCompletedAt: null,
  expiresAt: null,
  createdAt: '2026-08-20T06:00:00.000Z',
};

/**
 * Three clean rows and two warned ones. The warned rows are the whole point:
 * they are ACCEPTED, so `willAdd` is 5 and the button must offer 5.
 */
const REPORT = {
  rows: [
    { lineNumber: 2, serial: 'AAA111ZZ', outcome: 'WILL_ADD' },
    { lineNumber: 3, serial: 'AAA112ZZ', outcome: 'WILL_ADD' },
    { lineNumber: 4, serial: 'AAA113ZZ', outcome: 'WILL_ADD' },
    { lineNumber: 5, serial: 'QQQ777ZZ', outcome: 'WARN', reason: 'Does not look like a Dell serial.' },
    { lineNumber: 6, serial: 'QQQ778ZZ', outcome: 'WARN', reason: 'Does not look like a Dell serial.' },
    { lineNumber: 7, serial: 'no', outcome: 'ERROR', reason: 'Too short to be a serial number.' },
  ],
  willAdd: 5,
  warnings: 2,
  errors: 1,
  fileErrors: [],
  errorReportCsv: 'line_number,serial_number,outcome,reason\n7,no,ERROR,Too short\n',
};

function mockApi(handlers: { listing?: unknown; report?: unknown }): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('validate-csv')
      ? (handlers.report ?? REPORT)
      : (handlers.listing ?? LISTING);
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  });
}

const draw = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/vendor/listings/l1/bulk-upload']}>
      <Routes>
        <Route path="/vendor/listings/:id/bulk-upload" element={<BulkUploadRoute />} />
      </Routes>
    </MemoryRouter>,
  );

/** A File whose BYTES are what the test is about, not its name. */
const fileOf = (name: string, bytes: number[] | string): File =>
  new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, {
    type: 'text/csv',
  });

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('the dry run and the button quote one number', () => {
  it('counts a warned row in the promise, because the commit will add it', async () => {
    mockApi({});
    draw();
    await screen.findByText('Add serials from a file');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, fileOf('stock.csv', 'serial_number\nAAA111ZZ\n'));

    // The sentence. Read by testid rather than by text, because the numbers in
    // it are `<span>`s — every number is IBM Plex Mono with tabular figures, so
    // the sentence is genuinely several elements.
    const sentence = (await screen.findByTestId('dry-run-summary')).textContent ?? '';
    expect(sentence).toContain('5');
    expect(sentence).toContain('6');
    // And the warnings stated as a SUBSET of the five, never as a third number
    // added beside them.
    expect(sentence).toMatch(/2 of the 5 carry a warning/);

    // The button. This is the assertion: it used to read "Add 5 machines" beside
    // a sentence promising 3, or the reverse, depending on which count moved.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Add 5 machines$/ })).toBeTruthy(),
    );
  });

  it('offers nothing to add when every row failed', async () => {
    mockApi({
      report: {
        rows: [{ lineNumber: 2, serial: 'no', outcome: 'ERROR', reason: 'Too short.' }],
        willAdd: 0,
        warnings: 0,
        errors: 1,
        fileErrors: [],
        errorReportCsv: '',
      },
    });
    draw();
    await screen.findByText('Add serials from a file');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, fileOf('stock.csv', 'serial_number\nno\n'));

    await screen.findByTestId('dry-run-summary');
    const button = screen.getByRole('button', { name: 'Nothing to add yet' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('a file that is not a CSV is refused before it is read', () => {
  it('names the workbook and how to fix it, and never calls the API', async () => {
    mockApi({});
    draw();
    await screen.findByText('Add serials from a file');
    const callsBefore = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // A real XLSX, renamed. Every operating system will let somebody do this.
    await userEvent.upload(
      input,
      fileOf('stock.csv', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
    );

    await screen.findByText(/is an Excel workbook, not a CSV/);
    expect(screen.getByText(/Save As, CSV UTF-8/)).toBeTruthy();

    // The forbidden thing did not happen: no dry run was requested, so there is
    // no page of bad serials to read.
    const callsAfter = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length;
    expect(callsAfter).toBe(callsBefore);
    expect(screen.queryByTestId('dry-run-summary')).toBeNull();
  });

  it('recognises the signatures directly, including the ones with no extension clue', () => {
    const head = (...b: number[]): Uint8Array => new Uint8Array([...b, 0x00, 0x00, 0x00, 0x00]);

    expect(refuseByMagicBytes('a.csv', head(0x50, 0x4b, 0x03, 0x04))).toMatch(/Excel workbook/);
    expect(refuseByMagicBytes('a.csv', head(0xd0, 0xcf, 0x11, 0xe0))).toMatch(/older Excel/);
    expect(refuseByMagicBytes('a.csv', head(0x25, 0x50, 0x44, 0x46))).toMatch(/PDF/);
    expect(refuseByMagicBytes('a.csv', head(0x89, 0x50, 0x4e, 0x47))).toMatch(/PNG/);
    expect(refuseByMagicBytes('a.csv', head(0x1f, 0x8b))).toMatch(/gzip/);

    // A real CSV passes. Without this the checks above would pass just as well
    // against a function that refused everything.
    expect(refuseByMagicBytes('a.csv', new Uint8Array([0x73, 0x65, 0x72, 0x69, 0x61, 0x6c])))
      .toBeUndefined();
  });
});

describe('what the screen says before a file is chosen', () => {
  it('states the listing grade, the room left and the row cap up front', async () => {
    mockApi({});
    draw();
    await screen.findByText('Add serials from a file');

    // The grade every serial in the file will be declared at. A vendor whose
    // spreadsheet mixes conditions has to know that before they upload it.
    expect(screen.getByText('A+')).toBeTruthy();
    // 5000 - 12. Said before the dry run, and repeated by it as row outcomes.
    expect(screen.getByText('4988')).toBeTruthy();
    // Twice, deliberately: the listing's own ceiling and the row cap on one
    // upload are the same number for the same reason (VR-080).
    expect(screen.getAllByText(String(MAX_ROWS)).length).toBeGreaterThan(0);
  });

  it('says a listing past drafting cannot take serials, before a file is chosen', async () => {
    mockApi({ listing: { ...LISTING, status: 'ACTIVE' } });
    draw();
    await screen.findByText('Add serials from a file');

    expect(screen.getByText(/only be added while a listing is still a draft/)).toBeTruthy();
  });
});
