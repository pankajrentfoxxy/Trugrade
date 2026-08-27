/**
 * The three things about steps 4-5 and the review screen that would be silently
 * wrong, each made to do the thing rather than asserted to be guarded.
 *
 *   - No box on step 5 starts ticked. The DOM is asked, with the step's real
 *     document rules loaded, rather than the source being grepped.
 *   - A refused file names itself and carries the server's own sentence. The
 *     stub returns the exact envelope `DocumentService` builds, assembled from
 *     the same `@trugrade/contracts` constant the server uses — so a reworded
 *     rule shows up here as a rewording, never as a silent pass.
 *   - The review screen shows a gap as a gap: a required answer we do not hold
 *     renders "Not provided", the step says so in its header instead of
 *     "Complete", and Submit stays disabled.
 */
import * as React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UPLOAD_ALLOWED_MIME, UPLOAD_MAX_BYTES, UPLOAD_RULES } from '@trugrade/contracts';
import { Review } from './Review';
import { StepDocuments } from './StepDocuments';
import type { DocumentTypeRule, KycDocument, StepProgress } from './api';

/* ------------------------------------------------------------- api doubles */

const uploadDocument = jest.fn();
const getDocumentTypes = jest.fn();
const getDocuments = jest.fn();
const deleteDocument = jest.fn();

jest.mock('./api', () => ({
  ...jest.requireActual<Record<string, unknown>>('./api'),
  uploadDocument: (...args: unknown[]) => uploadDocument(...args),
  getDocumentTypes: () => getDocumentTypes(),
  getDocuments: () => getDocuments(),
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

/** `document_type_rule`, shaped exactly as `DocumentService.types()` returns it. */
const rule = (docType: string, label: string, maxAgeDays: number | null = null): DocumentTypeRule => ({
  docType,
  label,
  maxAgeDays,
  requiresExpiry: false,
  maxFiles: 3,
  maxBytes: UPLOAD_MAX_BYTES,
  acceptedMime: [...UPLOAD_ALLOWED_MIME],
});

const RULES = [
  rule('GST_CERTIFICATE', 'GST registration certificate'),
  rule('PAN_CARD', 'PAN card'),
  rule('SIGNATORY_ID', 'Authorised signatory ID'),
  rule('PO_TEMPLATE', 'Purchase order template'),
];

beforeEach(() => {
  jest.clearAllMocks();
  getDocumentTypes.mockResolvedValue({ ok: true, data: RULES });
  getDocuments.mockResolvedValue({ ok: true, data: [] as KycDocument[] });
});

const renderStep5 = async (): Promise<void> => {
  render(
    <StepDocuments
      answers={{}}
      busy={false}
      onSaveDraft={() => undefined}
      onContinue={async () => null}
      onFieldFocus={() => undefined}
    />,
  );
  await screen.findByText('GST registration certificate');
};

/* ====================================================== CP e-Comm rule 4(9) */

describe('step 5 preferences', () => {
  it('starts with no notification channel and no PO flag ticked', async () => {
    await renderStep5();

    // Every box the step actually renders, not a sample of them.
    const boxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThanOrEqual(4); // three channels + the PO flag
    expect(document.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);

    // And the two that matter are named, so a renamed channel cannot hide here.
    for (const label of ['Email', 'WhatsApp', 'SMS']) {
      expect(screen.getByLabelText(label, { exact: true })).not.toBeChecked();
    }
    expect(
      screen.getByLabelText('We require a purchase order number on every invoice'),
    ).not.toBeChecked();
  });

  it('asks for a document date only where the rule table sets an age limit', async () => {
    getDocumentTypes.mockResolvedValue({
      ok: true,
      data: [
        rule('GST_CERTIFICATE', 'GST registration certificate'),
        // Age-limited by the rule table, exactly as ops would set it.
        rule('SIGNATORY_ID', 'Authorised signatory ID', 90),
      ],
    });
    await renderStep5();

    expect(screen.queryByLabelText(/Date on the gst registration certificate/i)).toBeNull();
    expect(screen.getByLabelText(/Date on the authorised signatory id/i)).toBeInTheDocument();
    // The rule's own number, rendered rather than a constant in this client —
    // in the date field's hint and again in the uploader's.
    const mentions = screen.getAllByText(/issued in the last/i);
    expect(mentions).toHaveLength(2);
    for (const node of mentions) expect(node).toHaveTextContent('90');
  });
});

/* ============================================== a file the server would not take */

describe('a refused upload', () => {
  it('names the file and gives the server’s reason, not "invalid file"', async () => {
    // The envelope `DocumentService.acceptBytes` throws for a magic-byte
    // mismatch: the filename in front, the contract's own sentence behind it.
    const why = UPLOAD_RULES.magicMessage;
    uploadDocument.mockResolvedValue({
      ok: false,
      status: 422,
      code: 'VALIDATION',
      message: `pan_card.pdf: ${why}`,
      fields: { 'pan_card.pdf': why },
    });

    await renderStep5();

    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!;
    const jpegPretendingToBeAPdf = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'pan_card.pdf', {
      type: 'application/pdf',
    });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [jpegPretendingToBeAPdf] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('pan_card.pdf');
    expect(alert).toHaveTextContent(why);
    // The row stays, so a list of six still says which one failed.
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});

/* ================================================== the review screen and gaps */

const step = (
  stepCode: string,
  title: string,
  stepOrder: number,
  status: StepProgress['status'],
  extra: Partial<StepProgress> = {},
): StepProgress => ({
  stepCode,
  stepOrder,
  title,
  purposeNote: null,
  estimatedMinutes: null,
  isRequired: true,
  status,
  completionPct: status === 'COMPLETE' ? 100 : 40,
  blockingReason: null,
  lastSavedAt: null,
  fields: [],
  ...extra,
});

describe('the review screen', () => {
  it('shows a step with a missing required answer as a gap, and refuses to submit', async () => {
    render(
      <Review
        steps={[
          step('ACCOUNT', 'Account', 1, 'COMPLETE'),
          step('CONTACTS_ADDRESSES', 'Contacts and delivery', 4, 'IN_PROGRESS'),
        ]}
        answers={{
          ACCOUNT: { fullName: 'Ananya Raghavan', companyName: 'Alpha Systems Private Limited' },
          // Procurement is answered; finance is the gap.
          CONTACTS_ADDRESSES: {
            contacts: { PROCUREMENT: { fullName: 'Devika Menon' }, FINANCE: {} },
            billing: [],
            delivery: [],
          },
        }}
        orgStatus="REGISTERED"
        slaDueAt={null}
        slaBreached={false}
        isSubmittable={false}
        onEdit={() => undefined}
        onSubmit={async () => null}
      />,
    );

    // The gap is named where the answer should have been, in words.
    const sections = await screen.findAllByTestId('form-section');
    const contacts = sections.find((s) => s.textContent?.includes('Contacts and delivery'))!;
    expect(within(contacts).getByText(/Finance/)).toBeInTheDocument();
    expect(within(contacts).getAllByText(/Not provided/).length).toBeGreaterThan(0);

    // A step 1 answer we DO hold is not reported as a gap.
    const account = sections.find((s) => s.textContent?.includes('Your name'))!;
    expect(within(account).getByText('Ananya Raghavan')).toBeInTheDocument();

    // And the outstanding step is named rather than "please complete all steps".
    expect(screen.getByText(/Contacts and delivery/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  });

  it('does not call a COMPLETE step done when a required answer is missing from it', async () => {
    render(
      <Review
        steps={[step('BUSINESS_PROFILE', 'Company', 2, 'COMPLETE')]}
        answers={{ BUSINESS_PROFILE: { legalName: '', constitution: 'PVT_LTD' } }}
        orgStatus="REGISTERED"
        slaDueAt={null}
        slaBreached={false}
        isSubmittable={false}
        onEdit={() => undefined}
        onSubmit={async () => null}
      />,
    );

    await waitFor(() => expect(screen.getByText('Answers missing')).toBeInTheDocument());
    expect(screen.queryByText('Complete')).toBeNull();
  });

  it('renders a reviewer’s reason verbatim, and the SLA it is late against', async () => {
    const reason =
      'The PAN card you sent is a photo of a director’s personal PAN. We need the PAN of the company itself.';
    render(
      <Review
        steps={[step('DOCUMENTS', 'Documents and preferences', 5, 'NEEDS_FIX', {
          blockingReason: reason,
        })]}
        answers={{}}
        orgStatus="KYC_SUBMITTED"
        slaDueAt="2026-08-26T07:00:00.000Z"
        slaBreached
        isSubmittable={false}
        onEdit={() => undefined}
        onSubmit={async () => null}
      />,
    );

    // Character for character. No summary, no wrapper sentence around it.
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.getByText(/past the time we promised/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  });
});
