/**
 * The five things about the requirement intake that would be silently wrong.
 *
 * None of these asserts that a control exists. Each attempts the thing the
 * screen must refuse, or reads back what a procurement head actually sees.
 *
 * 1. **A row that could not be parsed is reported, never dropped.** The failure
 *    this whole task is written against is a line 47 that vanished between the
 *    spreadsheet and the answer. The test reads back every rejected line number,
 *    its column and its reason, and checks that the counts on screen add up to
 *    the lines that went in — a screen that quietly omitted a rejected row would
 *    still render, and the arithmetic is what catches it.
 * 2. **The column named in a refusal is the one in the buyer's own file.** The
 *    server validates a camelCase object and answers `deliveryPincode`; the CSV
 *    header says `delivery_pincode`. Pointing somebody at a column that is not
 *    in their file is not a report.
 * 3. **Nothing on the screen implies a supplier is being asked to quote.** Under
 *    the merchant-of-record model, sourcing against a requirement is our job.
 *    The test asserts the sentence saying so is present on BOTH the intake and
 *    the answer, and sweeps the whole rendered document for the vocabulary of a
 *    bidding process.
 * 4. **No vendor identifier appears in the rendered output**, at any depth,
 *    swept with the same `findVendorIdentityLeaks` the API's own anonymity tests
 *    use — and the response shapes this screen renders carry no field that could
 *    hold one, asserted key by key so that adding one is a failing test rather
 *    than a quiet leak.
 * 5. **A file is what its first bytes say it is.** An Excel workbook named
 *    `.csv` and a PNG named `.csv` are both refused by name, with the fix.
 */
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { BulkIntake } from './BulkIntake';
import { refuseByMagicBytes, type RequirementIntakeResult } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  submitCsv: jest.fn(),
  submitRows: jest.fn(),
}));

import { submitRows } from './api';

const mockRows = submitRows as jest.MockedFunction<typeof submitRows>;

/* ----------------------------------------------------------------- fixtures */

/** The vendor behind Supply Point F. Every field of it is swept for below. */
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

/**
 * The real seeded shape: seven lines in, three matched, two with no machine
 * behind them, two that did not validate. Line numbers count the header, which
 * is the number the person sees in their own editor.
 */
const RESULT: RequirementIntakeResult = {
  matched: [
    {
      line: 2,
      rfqId: 'e2bd9d1e-6f2c-4c2f-9a3e-7f0b6b2c1f01',
      reference: 'RFQ-202608-1229EAC8',
      skuId: '892eb914-2fcb-48d9-b800-4ff13c6e36e4',
      title: 'Dell Latitude 5420',
      specSummary: 'Core i5 · 16 GB · 512 GB · 14"',
      qtyRequested: 40,
      unitsAvailableNow: 88,
      grade: 'A',
      neededBy: '2026-10-15',
    },
    {
      line: 3,
      rfqId: 'e2bd9d1e-6f2c-4c2f-9a3e-7f0b6b2c1f02',
      reference: 'RFQ-202608-3BABFB81',
      skuId: '85ea2225-6bfd-486c-a915-507dd70bf1f2',
      title: 'Lenovo ThinkPad E14 Gen 3',
      specSummary: 'Ryzen 5 · 16 GB · 512 GB · 14"',
      qtyRequested: 15,
      unitsAvailableNow: 4,
      grade: 'B',
      neededBy: null,
    },
    {
      line: 4,
      rfqId: 'e2bd9d1e-6f2c-4c2f-9a3e-7f0b6b2c1f03',
      reference: 'RFQ-202608-968C257D',
      skuId: '0244ae2b-dde6-4b7c-9971-f8645804d5aa',
      title: 'HP EliteBook 840 G8',
      specSummary: 'Core i5 · 16 GB · 256 GB · 14"',
      qtyRequested: 12,
      unitsAvailableNow: 4,
      grade: 'A',
      neededBy: '2026-09-30',
    },
  ],
  unmatched: [
    {
      line: 5,
      model: 'Zorblax Quantum Ultrabook 9000',
      quantity: 25,
      grade: 'A',
      deliveryPincode: '110001',
      neededBy: '2026-11-01',
      reason: 'No machine in our catalogue matches this description.',
    },
    {
      line: 6,
      model: 'Kryotek Nebula 17 workstation chassis',
      quantity: 8,
      grade: null,
      deliveryPincode: '560001',
      neededBy: null,
      reason: 'No machine in our catalogue matches this description.',
    },
  ],
  rejected: [
    { line: 7, errors: { quantity: 'Expected number, received nan' } },
    { line: 8, errors: { deliveryPincode: 'Enter a valid 6-digit PIN code.' } },
  ],
  salesLeadReference: 'TKT-202608-592E05E7',
};

/* -------------------------------------------------------------------- driver */

/**
 * Drive the real screen to its answer through the real form.
 *
 * The typed path rather than the file path because it exercises the validation
 * as well: a row that does not pass never reaches the endpoint, so a mocked
 * response arriving at all is itself part of what is asserted.
 */
async function answer(result: RequirementIntakeResult = RESULT): Promise<void> {
  mockRows.mockResolvedValue({ ok: true, data: result });
  render(<BulkIntake initialModel="Dell Latitude 5420 i5 16GB 512GB" initialPincode="122001" />);

  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '40' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check these lines' }));
  });
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { level: 1, name: 'What we can fill now' }),
    ).toBeInTheDocument(),
  );
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

/* ==========================================================================
 * 1 — a row that could not be parsed is reported, not dropped
 * ======================================================================== */

describe('a line that could not be read', () => {
  it('is reported with its own line number and reason, never quietly skipped', async () => {
    await answer();

    const panel = screen.getByRole('region', { name: 'Lines we could not read' });

    // Both rejected lines are on screen, by the number in the buyer's own file.
    expect(panel).toHaveTextContent('7');
    expect(panel).toHaveTextContent('8');
    expect(panel).toHaveTextContent('Expected number, received nan');
    expect(panel).toHaveTextContent('Enter a valid 6-digit PIN code.');

    // And they are said to be in neither of the other two lists, so nobody
    // reads "3 matched, 2 not stocked" as an account of all seven lines.
    expect(panel).toHaveTextContent(/neither list above/i);
  });

  it('counts every line that went in, so a dropped row would not add up', async () => {
    await answer();

    const total = RESULT.matched.length + RESULT.unmatched.length + RESULT.rejected.length;
    const summary = screen.getByText(/We read/).textContent ?? '';
    // "We read 7 lines. 3 of 7 matched …, 2 of 7 did not, and 2 of 7 could not
    // be read at all." Every figure carries its denominator.
    expect(summary).toContain(`We read ${total} lines`);
    expect(summary).toContain(`${RESULT.matched.length} of ${total}`);
    expect(summary).toContain(`${RESULT.unmatched.length} of ${total}`);
    expect(summary).toContain(`${RESULT.rejected.length} of ${total}`);
  });

  it('names the column the buyer has in their file, not the one the schema uses', async () => {
    await answer();

    const panel = screen.getByRole('region', { name: 'Lines we could not read' });
    expect(panel).toHaveTextContent('delivery_pincode');
    expect(panel).not.toHaveTextContent('deliveryPincode');
  });
});

/* ==========================================================================
 * 2 — nothing implies a supplier is quoting
 * ======================================================================== */

/**
 * The vocabulary of a bidding process.
 *
 * Each of these would be true of a marketplace and is false here: we are the
 * merchant of record, we buy the machines and we sell them on our own invoice.
 * A screen that said any of it would be describing a different business.
 */
const IMPLIES_A_BIDDING_PROCESS: readonly RegExp[] = [
  /suppliers? (are|will be|have been) (asked|invited|notified)/i,
  /suppliers? (will |may )?(respond|reply|quote back|bid)/i,
  /(compare|collect|gather|request) (the )?quotes/i,
  /best (quote|bid|offer from)/i,
  /lowest bid/i,
  /reverse auction/i,
  /\btender\b/i,
  /out to (the )?market/i,
  /shared with (our |the )?(suppliers|vendors|sellers)/i,
];

const NO_VENDOR_SENTENCE = 'none is asked to quote on it';

describe('the merchant-of-record model', () => {
  it('says on the intake screen that no supplier sees the list or quotes on it', () => {
    render(<BulkIntake initialModel={null} initialPincode={null} />);
    expect(document.body).toHaveTextContent(NO_VENDOR_SENTENCE);
    for (const pattern of IMPLIES_A_BIDDING_PROCESS)
      expect(document.body.textContent ?? '').not.toMatch(pattern);
  });

  it('says it again beside the reference, where a list would otherwise look circulated', async () => {
    await answer();
    const panel = screen.getByRole('region', { name: 'Not in our catalogue' });
    expect(panel).toHaveTextContent(NO_VENDOR_SENTENCE);
    for (const pattern of IMPLIES_A_BIDDING_PROCESS)
      expect(document.body.textContent ?? '').not.toMatch(pattern);
  });
});

/* ==========================================================================
 * 3 — anonymity
 * ======================================================================== */

describe('anonymity', () => {
  it('renders no vendor identifier anywhere in the answer, at any depth', async () => {
    await answer();
    expect(findVendorIdentityLeaks(document.body.innerHTML, VENDOR)).toEqual([]);
  });

  /**
   * The shapes are copied from the server's own types, and the guarantee that
   * no vendor can reach this screen is that they carry no field one could sit
   * in. Adding `supplyPointCode`, `city`, `sourceOrgId` or anything like it is a
   * decision, and this is where it has to be argued rather than merged.
   */
  it('carries no field a supply point or a vendor could arrive in', () => {
    expect(Object.keys(RESULT.matched[0]!).sort()).toEqual(
      [
        'grade',
        'line',
        'neededBy',
        'qtyRequested',
        'reference',
        'rfqId',
        'skuId',
        'specSummary',
        'title',
        'unitsAvailableNow',
      ].sort(),
    );
    expect(Object.keys(RESULT.unmatched[0]!).sort()).toEqual(
      ['deliveryPincode', 'grade', 'line', 'model', 'neededBy', 'quantity', 'reason'].sort(),
    );
  });
});

/* ==========================================================================
 * 4 — absences, and the counts that carry their denominator
 * ======================================================================== */

describe('what is available now', () => {
  it('says how many of how many, never a bare count', async () => {
    await answer();
    const panel = screen.getByRole('region', { name: 'In our catalogue' });
    expect(panel).toHaveTextContent('of 40 asked');
    expect(panel).toHaveTextContent('of 15 asked');
    expect(panel).toHaveTextContent('1 of 3 can be filled in full today');
  });

  it('renders a missing grade and a missing date as absences, never as values', async () => {
    await answer();
    // Line 3 asked for no date and line 6 for no grade. Neither is drawn as a
    // chosen value, and neither is drawn as a zero.
    expect(document.body).toHaveTextContent('No date given');
    expect(screen.getAllByText('No preference').length).toBeGreaterThan(0);
  });

  it('says out loud that the count is across grades, so it is not read as narrowed', async () => {
    await answer();
    expect(screen.getByRole('region', { name: 'In our catalogue' })).toHaveTextContent(
      /across A\+, A and B/,
    );
  });
});

/* ==========================================================================
 * 5 — a file is what its first bytes say it is
 * ======================================================================== */

const head = (...bytes: number[]): Uint8Array => Uint8Array.from([...bytes, 0x61, 0x62, 0x63]);

/** jsdom has no `TextEncoder`; Node's Buffer is the same bytes. */
const utf8 = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'utf8'));

describe('the magic-byte check', () => {
  it('refuses an Excel workbook renamed .csv, by name, with the conversion', () => {
    const refusal = refuseByMagicBytes('requirements-q4.csv', head(0x50, 0x4b, 0x03, 0x04));
    expect(refusal).toContain('requirements-q4.csv');
    expect(refusal).toContain('Excel workbook');
    expect(refusal).toContain('CSV UTF-8');
  });

  it('refuses a PNG renamed .csv, whatever the extension and the Content-Type say', () => {
    const refusal = refuseByMagicBytes('list.csv', head(0x89, 0x50, 0x4e, 0x47));
    expect(refusal).toContain('list.csv');
    expect(refusal).toContain('PNG');
  });

  it('refuses a file with no known signature that carries binary anyway', () => {
    expect(refuseByMagicBytes('list.csv', Uint8Array.from([0x61, 0x00, 0x62]))).toContain(
      'not a text file',
    );
  });

  it('accepts a plain CSV, which has no signature at all', () => {
    const csv = utf8('model,quantity,delivery_pincode\nDell,4,122001\n');
    expect(refuseByMagicBytes('list.csv', csv)).toBeUndefined();
  });

  it('accepts a CSV Excel wrote with a UTF-8 BOM in front of it', () => {
    const csv = utf8('﻿model,quantity,delivery_pincode\nDell,4,122001\n');
    expect(refuseByMagicBytes('list.csv', csv)).toBeUndefined();
  });
});

/* ==========================================================================
 * 6 — the typed path refuses a row rather than sending it half-filled
 * ======================================================================== */

describe('the typed form', () => {
  it('refuses an incomplete line and sends nothing, naming what is missing', async () => {
    render(<BulkIntake initialModel="Dell Latitude 5420" initialPincode={null} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check these lines' }));
    });

    expect(mockRows).not.toHaveBeenCalled();
    expect(screen.getByText('How many machines do you need?')).toBeInTheDocument();
    expect(
      screen.getByText('Enter the 6-digit PIN code. It decides the delivery route.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/still needs something\. Nothing has been sent/),
    ).toBeInTheDocument();
  });
});
