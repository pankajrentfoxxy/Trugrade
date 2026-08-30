/**
 * The things about the documents board that would be silently wrong on it.
 *
 * None of these is a "the table renders" assertion. This screen's whole job is
 * to be honest about documents that do not exist, so each test attempts the
 * failure that job invites and expects the refusal:
 *
 * 1. **A document that does not exist gets no control.** Not a disabled button,
 *    not a greyed link, not a `#` href. A disabled download says a file exists
 *    and you may not have it; the truth is that there is no file.
 * 2. **It says WHEN it will exist**, in its own row, from real state. The spec
 *    calls this out by name — *"E-way bill is generated at pickup"* — and it is
 *    the same rule as "a missing value never renders as a passing one".
 * 3. **A number that will never exist is not "not yet".** A QC report has no
 *    invoice number and never will; "Not numbered yet" would promise one.
 * 4. **Existence is not a verdict.** Nothing on this screen is green or red —
 *    those are PASS and FAIL — and exactly one thing is amber, because amber is
 *    the one primary action.
 * 5. **Every count carries its denominator.**
 * 6. **No vendor identifier, anywhere, at any depth**, swept with the same
 *    `findVendorIdentityLeaks` the API's own anonymity tests use.
 */
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { findVendorIdentityLeaks, type VendorIdentity } from '@trugrade/contracts';
import { DocumentsBoard } from './DocumentsBoard';
import type { OrderDocument, OrderDocuments } from './api';

jest.mock('./api', () => ({
  ...jest.requireActual('./api'),
  getOrderDocuments: jest.fn(),
}));

import { getOrderDocuments } from './api';

const mockGet = getOrderDocuments as jest.MockedFunction<typeof getOrderDocuments>;

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

const doc = (over: Partial<OrderDocument> = {}): OrderDocument => ({
  id: 'x',
  kind: 'TAX_INVOICE',
  status: 'AWAITED',
  title: 'Tax invoice · Supply Point L · Gurugram',
  description: 'Our invoice to you.',
  whenItWillExist: null,
  documentNumber: null,
  issuedOn: null,
  amount: null,
  valuationMethod: null,
  downloadPath: null,
  elsewherePath: null,
  ...over,
});

const PROFORMA = doc({
  id: 'proforma',
  kind: 'PROFORMA',
  status: 'ISSUED',
  title: 'Proforma invoice',
  documentNumber: 'PRO/TT-26-00004',
  issuedOn: '2026-08-30',
  amount: '307942.24',
  downloadPath: '/api/buyer/orders/TT-26-00004/documents/proforma',
});

const TAX_ISSUED = doc({
  id: 'inv-1',
  status: 'ISSUED',
  documentNumber: 'TT/2026-27/00001',
  issuedOn: '2026-08-30',
  amount: '159281.12',
  downloadPath: '/api/buyer/orders/TT-26-00004/documents/inv-1',
});

const TAX_AWAITED = doc({
  id: 'tax-awaited',
  whenItWillExist:
    'A tax invoice is raised when these machines leave the supply point, not before.',
});

const EWAY = doc({
  id: 'eway-awaited',
  kind: 'EWAY_BILL',
  title: 'E-way bill · Supply Point L · Gurugram',
  description: 'The document the consignment travels under.',
  whenItWillExist: 'The e-way bill is generated at pickup, from the tax invoice.',
});

const QC = doc({
  id: 'qc-reports',
  kind: 'QC_REPORTS',
  status: 'ELSEWHERE',
  title: 'Inspection reports',
  description: 'One report per machine.',
  elsewherePath: '/account/orders/TT-26-00004/units',
});

const CREDIT = doc({
  id: 'credit-notes',
  kind: 'CREDIT_NOTE',
  status: 'NOT_APPLICABLE',
  title: 'Credit notes',
  description: 'A credit note reverses part of a tax invoice.',
  whenItWillExist: 'There is no return or cancellation on this order.',
});

const view = (documents: OrderDocument[]): OrderDocuments => ({
  orderNumber: 'TT-26-00004',
  issuedCount: documents.filter((d) => d.status === 'ISSUED').length,
  documentCount: documents.length,
  documents,
});

const answer = (documents: OrderDocument[]): void => {
  mockGet.mockResolvedValue({ ok: true, data: view(documents) });
};

const board = async (documents: OrderDocument[]): Promise<void> => {
  answer(documents);
  render(<DocumentsBoard orderNumber="TT-26-00004" />);
  // Waiting for the TABLE is not enough: DataBoard renders skeleton rows inside
  // a real table while the fetch is open, so every assertion below would run
  // against six grey bars and pass for the wrong reason.
  await waitFor(() =>
    expect(screen.queryByText(/Reading the documents/)).not.toBeInTheDocument(),
  );
};

/**
 * The row a document's title sits in.
 *
 * Scoped to `.doctitle`, because the row's action carries the same title again
 * in an `sr-only` span — a screen reader hearing eight links all called "Open"
 * learns nothing — so an unscoped query finds two elements and fails.
 */
const rowFor = (title: string): HTMLElement =>
  screen.getByText(title, { selector: '.doctitle' }).closest('tr') as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(cleanup);

/* ========================================================================== */

describe('a document that does not exist yet', () => {
  it('offers no control at all — not a disabled one, not a dead link', async () => {
    await board([TAX_AWAITED, EWAY]);
    for (const title of [TAX_AWAITED.title, EWAY.title]) {
      const row = within(rowFor(title));
      expect(row.queryByRole('link', { name: /open/i })).not.toBeInTheDocument();
      expect(row.queryByRole('button')).not.toBeInTheDocument();
    }
    // Nothing on the screen points at a href that goes nowhere.
    for (const link of screen.queryAllByRole('link')) {
      expect(link.getAttribute('href')).not.toBe('#');
      expect(link.getAttribute('href')).toBeTruthy();
    }
  });

  it('says which moment brings it into existence, in its own row', async () => {
    await board([TAX_AWAITED, EWAY]);
    expect(within(rowFor(EWAY.title)).getByText(/generated at pickup/i)).toBeInTheDocument();
    expect(
      within(rowFor(TAX_AWAITED.title)).getByText(/leave the supply point/i),
    ).toBeInTheDocument();
  });

  it('does not promise a number for a document that will never carry one', async () => {
    await board([QC, CREDIT]);
    // "Not numbered yet" would be a promise. A QC report belongs to a serial and
    // a credit note to an event that has not happened; neither gets a number.
    expect(screen.queryByText(/not numbered yet/i)).not.toBeInTheDocument();
  });

  it('sends the reader to where a per-machine document actually lives', async () => {
    await board([QC]);
    const link = within(rowFor(QC.title)).getByRole('link');
    expect(link).toHaveAttribute('href', '/account/orders/TT-26-00004/units');
  });
});

describe('a document that does exist', () => {
  it('carries its number, its date and its amount, all in mono', async () => {
    await board([TAX_ISSUED]);
    const row = within(rowFor(TAX_ISSUED.title));
    expect(row.getByText('TT/2026-27/00001')).toHaveClass('mono');
    expect(row.getByText('2026-08-30')).toHaveClass('mono');
    // Formatted from Money, never from a float.
    expect(row.getByText(/1,59,281\.12/)).toHaveClass('mono');
  });

  it('opens in a new tab through our own route, so the download is recorded', async () => {
    await board([TAX_ISSUED]);
    const link = within(rowFor(TAX_ISSUED.title)).getByRole('link', { name: /open/i });
    // Our route, not the object URL: the audit row is written on the way past.
    expect(link).toHaveAttribute('href', '/api/buyer/orders/TT-26-00004/documents/inv-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('flags a margin-scheme invoice, because the input credit is thinner', async () => {
    await board([doc({ ...TAX_ISSUED, valuationMethod: 'MARGIN' })]);
    expect(screen.getByText(/limited input credit/i)).toBeInTheDocument();
  });
});

describe('colour', () => {
  it('gives the tax invoice the one amber action and nothing else', async () => {
    await board([PROFORMA, TAX_ISSUED, EWAY, QC]);
    const amber = screen.getAllByRole('link').filter((a) => a.className.includes('acc'));
    expect(amber).toHaveLength(1);
    expect(amber[0]!.getAttribute('href')).toContain('inv-1');
  });

  it('falls back to the proforma before dispatch, because that is what gets paid', async () => {
    await board([PROFORMA, TAX_AWAITED, EWAY]);
    const amber = screen.getAllByRole('link').filter((a) => a.className.includes('acc'));
    expect(amber).toHaveLength(1);
    expect(amber[0]!.getAttribute('href')).toContain('proforma');
  });

  it('makes nothing amber when nothing is issued', async () => {
    await board([TAX_AWAITED, EWAY, CREDIT]);
    expect(screen.queryAllByRole('link').filter((a) => a.className.includes('acc'))).toHaveLength(0);
  });

  it('never renders a document as a verdict', async () => {
    await board([PROFORMA, TAX_ISSUED, TAX_AWAITED, EWAY, QC, CREDIT]);
    // PASS and FAIL are the only things green and red mean here, and an issued
    // invoice is neither. A colour sweep already had to fix eight of these.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/text-pass|text-fail|tone="pass"|tone="fail"/);
  });
});

describe('the figures above the table', () => {
  it('carries the denominator with every count', async () => {
    await board([PROFORMA, TAX_ISSUED, TAX_AWAITED, EWAY, QC, CREDIT]);
    // "2" is not a statement. "2 of 6 documents" is.
    // Scoped to the figures: the table's own caption says it a third time, for
    // a screen reader, and counting that would make this test pass on its own.
    expect(screen.getAllByText(/of 6 documents/, { selector: '.denom' })).toHaveLength(2);
  });
});

describe('what the buyer may not learn', () => {
  it('carries no vendor identifier anywhere, at any depth', async () => {
    await board([PROFORMA, TAX_ISSUED, TAX_AWAITED, EWAY, QC, CREDIT]);
    expect(findVendorIdentityLeaks(document.body.innerHTML, VENDOR)).toEqual([]);
    // The dispatch point IS shown, at city granularity. That is the label, not
    // a leak, and asserting it keeps the sweep from passing on an empty page.
    expect(screen.getAllByText(/Supply Point L · Gurugram/).length).toBeGreaterThan(0);
  });
});

describe('a colleague without the finance role', () => {
  it('is told who can open it, rather than just refused', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have permission to read invoices.',
      fields: {},
      retryAfterSeconds: null,
    });
    render(<DocumentsBoard orderNumber="TT-26-00004" />);
    await waitFor(() =>
      expect(screen.getByText(/cannot open this organisation/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/finance role/i)).toBeInTheDocument();
  });
});

describe('an order on somebody else’s account', () => {
  it('gets the same screen as one that does not exist', async () => {
    mockGet.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      message: 'order not found',
      fields: {},
      retryAfterSeconds: null,
    });
    render(<DocumentsBoard orderNumber="TT-26-09999" />);
    await waitFor(() =>
      expect(screen.getByText(/no order with that number/i)).toBeInTheDocument(),
    );
  });
});
