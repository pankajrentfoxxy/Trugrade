/**
 * The supplier profile's read-only view.
 *
 * Once a supplier is verified the cards lock, and "View" is how they read what
 * they were verified with. Three things it must never do: show a payout
 * account number in full, draw a missing answer as a present one, or offer to
 * open a file that is not there.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResumableOnboarding } from '@trugrade/contracts';

vi.mock('../../../../../storefront/src/app/register/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDocuments: vi.fn(),
  getDocumentUrl: vi.fn(),
}));

import { getDocumentUrl, getDocuments } from '../../../../../storefront/src/app/register/api';
import { PROFILE_SECTIONS } from './sections.config';
import { SectionViewDialog, sectionFacts } from './SectionView';

const listDocuments = vi.mocked(getDocuments);
const documentUrl = vi.mocked(getDocumentUrl);

const section = (id: string) => PROFILE_SECTIONS.find((s) => s.id === id)!;

const onboarding = (over: Record<string, unknown> = {}): ResumableOnboarding =>
  ({
    orgId: 'org-1',
    status: 'VERIFIED',
    editable: false,
    progress: { constitution: 'PVT_LTD', steps: [] },
    answers: {},
    payoutAccount: null,
    ...over,
  }) as unknown as ResumableOnboarding;

const byLabel = (facts: ReturnType<typeof sectionFacts>) =>
  Object.fromEntries(facts.map((f) => [f.label, f.value]));

/** A file as the documents endpoint lists it. */
const file = (docType: string, id: string, status = 'VERIFIED') => ({
  id,
  docType,
  label: docType,
  originalFilename: `${id}.pdf`,
  mime: 'application/pdf',
  sizeBytes: 1024,
  status,
  documentDate: null,
  exifStrippedAt: null,
  avVerdict: null,
  rejectionReason: null,
});

const filesAre = (files: ReturnType<typeof file>[]): void => {
  listDocuments.mockResolvedValue({ ok: true, data: files } as never);
};

const documentsDialog = (over: Record<string, unknown> = {}) =>
  render(
    <SectionViewDialog
      section={section('documents')}
      onboarding={onboarding(over)}
      account={null}
      onClose={() => {}}
    />,
  );

beforeEach(() => {
  listDocuments.mockReset();
  documentUrl.mockReset();
  filesAre([]);
});

describe('what each card shows when it is read', () => {
  it('reads the business card from the saved answers', () => {
    const facts = byLabel(
      sectionFacts(
        section('business'),
        onboarding({
          answers: {
            STATUTORY: {
              legalName: 'Northgate IT Pvt. Ltd.',
              pan: 'AAACN1111R',
              primaryGstin: '06AAACN1111R1ZX',
            },
          },
        }),
        null,
      ),
    );
    expect(facts.Constitution).toBe('Private Limited');
    expect(facts['Legal name']).toBe('Northgate IT Pvt. Ltd.');
    expect(facts.GSTIN).toBe('06AAACN1111R1ZX');
    expect(facts.PAN).toBe('AAACN1111R');
    // Read off the GSTIN's own state code, not asked for twice.
    expect(facts['State of registration']).toBe('Haryana');
  });

  it('reads the pickup card, window included, from the rows the card saved', () => {
    const open = { closed: false, opensAt: '10:00', closesAt: '18:00' };
    const shut = { closed: true, opensAt: '', closesAt: '' };
    const facts = byLabel(
      sectionFacts(
        section('pickup'),
        onboarding({
          answers: {
            FACILITY_CONTACTS: {
              facilities: [
                {
                  address: {
                    line1: 'Plot 42, Udyog Vihar',
                    line2: 'Gate 3',
                    city: 'Gurugram',
                    state: '06',
                    pincode: '122016',
                  },
                  hours: { 0: shut, 1: open, 2: open, 3: open, 4: open, 5: open, 6: shut },
                },
              ],
              contacts: { WAREHOUSE: { fullName: 'Ravi Kumar', mobile: '+919810000001' } },
            },
          },
        }),
        null,
      ),
    );
    expect(facts.Address).toBe('Plot 42, Udyog Vihar');
    expect(facts.State).toBe('Haryana');
    expect(facts['PIN code']).toBe('122016');
    expect(facts['Collection contact']).toBe('Ravi Kumar');
    expect(facts['Collection window']).toBe('Mon–Fri 10:00–18:00');
  });

  it('never prints a payout account number in full', () => {
    const facts = sectionFacts(
      section('bank'),
      onboarding({
        payoutAccount: {
          last4: '4321',
          bankName: 'HDFC Bank',
          ifsc: 'HDFC0001234',
          pennyDropStatus: 'SUCCESS',
          frozenUntil: null,
        },
      }),
      null,
    );
    const values = byLabel(facts);
    expect(values['Account number']).toBe('•••• 4321');
    expect(values.Verification).toBe('Verified');
    // The card has these rows and no others: there is no row that could carry
    // the number in full, because the API never sends it.
    expect(facts.map((f) => f.label)).toEqual(['Account number', 'Bank', 'IFSC', 'Verification']);
  });

  it('says a bank account that failed its check failed, never "Verified"', () => {
    const values = byLabel(
      sectionFacts(
        section('bank'),
        onboarding({
          payoutAccount: {
            last4: '4321',
            bankName: null,
            ifsc: 'HDFC0001234',
            pennyDropStatus: 'NAME_MISMATCH',
            frozenUntil: null,
          },
        }),
        null,
      ),
    );
    expect(values.Verification).toBe('Name on the account does not match your business');
  });

  it('falls back to the session for the contact when the step saved nothing', () => {
    const values = byLabel(
      sectionFacts(section('account'), onboarding(), {
        fullName: 'Asha Verma',
        email: 'asha@northgate.example',
        mobile: '+919810000002',
      }),
    );
    expect(values.Name).toBe('Asha Verma');
    expect(values['Work email']).toBe('asha@northgate.example');
  });
});

describe('a missing value', () => {
  it('is a row that says so, on every card — never a blank and never dropped', () => {
    for (const s of PROFILE_SECTIONS) {
      const facts = sectionFacts(
        s,
        onboarding({ progress: { constitution: null, steps: [] } }),
        null,
      );
      expect(facts.length).toBeGreaterThan(0);
      for (const f of facts) expect(f.value).toBeNull();
    }
  });

  it('reads "Not given" for an answer nobody gave', () => {
    render(
      <SectionViewDialog
        section={section('stock')}
        onboarding={onboarding()}
        account={null}
        onClose={() => {}}
      />,
    );
    expect(within(screen.getByTestId('section-facts')).getAllByText('Not given')).toHaveLength(4);
  });
});

describe('the Documents card, read', () => {
  it('reads "Not uploaded" for every document when there are no files', async () => {
    documentsDialog();
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());
    const docs = within(screen.getByTestId('section-facts'));
    expect(docs.getAllByText('Not uploaded')).toHaveLength(3);
    expect(docs.queryByText('Uploaded')).not.toBeInTheDocument();
    // Nothing to open, so nothing offers to.
    expect(screen.queryByRole('button', { name: /^View / })).not.toBeInTheDocument();
  });

  it('offers View beside a file that exists, and only beside one', async () => {
    filesAre([file('GST_CERTIFICATE', 'doc-gst'), file('PAN_CARD', 'doc-pan')]);
    documentsDialog();

    expect(await screen.findByRole('button', { name: 'View GST certificate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View PAN card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Cancelled cheque' })).not.toBeInTheDocument();

    const docs = within(screen.getByTestId('section-facts'));
    expect(docs.getAllByText('Uploaded')).toHaveLength(2);
    expect(docs.getAllByText('Not uploaded')).toHaveLength(1);
  });

  it('opens the file through a fresh link, in a new tab', async () => {
    filesAre([file('PAN_CARD', 'doc-pan')]);
    documentUrl.mockResolvedValue({
      ok: true,
      data: { url: 'https://files.example/signed/doc-pan', expiresInSeconds: 60 },
    } as never);
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    documentsDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'View PAN card' }));

    expect(documentUrl).toHaveBeenCalledWith('doc-pan');
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith(
        'https://files.example/signed/doc-pan',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    opened.mockRestore();
  });

  it("says so, in the server's words, when a file will not open — and opens nothing", async () => {
    filesAre([file('PAN_CARD', 'doc-pan')]);
    documentUrl.mockResolvedValue({
      ok: false,
      status: 503,
      code: 'PROVIDER_ERROR',
      message: 'File storage did not answer. Try again in a moment.',
    } as never);
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    documentsDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'View PAN card' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not open this file. File storage did not answer. Try again in a moment.',
    );
    expect(opened).not.toHaveBeenCalled();
    // Still there to try again.
    expect(screen.getByRole('button', { name: 'View PAN card' })).toBeEnabled();
    opened.mockRestore();
  });

  it('does not treat a rejected file as an upload', async () => {
    filesAre([file('PAN_CARD', 'doc-pan', 'REJECTED')]);
    documentsDialog();
    await waitFor(() => expect(listDocuments).toHaveBeenCalled());
    expect(within(screen.getByTestId('section-facts')).getAllByText('Not uploaded')).toHaveLength(
      3,
    );
    expect(screen.queryByRole('button', { name: 'View PAN card' })).not.toBeInTheDocument();
  });

  it('keeps the saved record, and says why nothing can be opened, when the list fails', async () => {
    listDocuments.mockResolvedValue({
      ok: false,
      status: 503,
      code: 'UNKNOWN',
      message: 'Something went wrong at our end.',
    } as never);
    documentsDialog({
      answers: { DOCUMENTS_BANK: { documentsComplete: true, uploadedDocTypes: ['PAN_CARD'] } },
    });

    expect(await screen.findByTestId('documents-unavailable')).toHaveTextContent(
      'We could not load your files to open them. That is on our side, not yours.',
    );
    // What the card recorded is still what the rows say.
    const docs = within(screen.getByTestId('section-facts'));
    expect(docs.getAllByText('Uploaded')).toHaveLength(1);
    expect(docs.getAllByText('Not uploaded')).toHaveLength(2);
    // And it can be tried again.
    filesAre([file('PAN_CARD', 'doc-pan')]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'View PAN card' })).toBeInTheDocument();
  });
});

describe('the dialog', () => {
  it('says why it cannot be edited, in the words for the state it is in', () => {
    const { rerender } = render(
      <SectionViewDialog
        section={section('account')}
        onboarding={onboarding()}
        account={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/approved and locked/)).toBeInTheDocument();

    rerender(
      <SectionViewDialog
        section={section('account')}
        onboarding={onboarding({ status: 'UNDER_REVIEW' })}
        account={null}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/with our review team/)).toBeInTheDocument();
  });

  it('has nothing on it that writes', () => {
    render(
      <SectionViewDialog
        section={section('business')}
        onboarding={onboarding()}
        account={null}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save|edit|submit/i })).not.toBeInTheDocument();
  });
});
