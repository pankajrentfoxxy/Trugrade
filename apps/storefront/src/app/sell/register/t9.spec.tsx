/**
 * The three things about steps 6 and 7 that would be silently wrong.
 *
 * None of these asserts that a guard exists.
 *
 * The first counts every checkbox and radio step 7 actually renders and fails if
 * any one of them arrives ticked — an agreement that is pre-accepted is not an
 * agreement, and it then **attempts the forbidden thing**: it fills in every
 * commercial answer, leaves the four acceptances alone, submits, and expects the
 * step to refuse rather than send an acceptance nobody gave.
 *
 * The second drives a real MISMATCH through step 6's penny-drop and asserts that
 * nothing on the screen reads as a pass: no "Verified", no tick, and the step
 * still refuses to continue. A bank that holds an account in somebody else's
 * name is the single most useful signal on that step, and rendering it as a pass
 * is how a payout leaves for the wrong account.
 *
 * The third renders a reviewer's sentence through the status screen and asserts
 * it character for character, including its punctuation.
 */
import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
// Also loaded by `jest.setup.ts` at runtime; imported here so `tsc --noEmit`
// sees the matcher augmentation, which the setup file is outside `include` for.
import '@testing-library/jest-dom';
import type { StepProgress, VerificationOutcomeView } from '../../register/api';
import { ApplicationStatus } from '../../register/review-parts';
import { StepAgreement } from './StepAgreement';
import { StepDocumentsBank } from './StepDocumentsBank';
import { VENDOR_AGREEMENTS } from '../../register/picklists';

const noop = (): void => {};
const accept = async (
  _values: Record<string, unknown>,
  _completionPct: number,
): Promise<null> => null;

/* ==========================================================================
 * The network, stubbed at `fetch` — these steps talk to four routes
 * ======================================================================== */

const DOC_TYPES = [
  {
    docType: 'GST_CERTIFICATE',
    label: 'GST registration certificate',
    maxAgeDays: null,
    requiresExpiry: false,
    maxFiles: 1,
    maxBytes: 5 * 1024 * 1024,
    acceptedMime: ['application/pdf', 'image/jpeg'],
  },
];

/** The fake bank's own MISMATCH: the name is close but not identical. */
const MISMATCH: VerificationOutcomeView = {
  id: 'v1',
  checkType: 'BANK_PENNY_DROP',
  outcome: 'MISMATCH',
  message:
    'The bank holds this account as "Northgate Asset Recovery Enterprises". That is close to your registered name but not identical, so we’ll have someone check it.',
  resolved: {
    beneficiaryName: 'Northgate Asset Recovery Enterprises',
    bankName: 'HDFC Bank',
    branch: 'Udyog Vihar, Gurugram',
  },
  matchScore: 0.8,
  attemptNo: 1,
  attemptsRemaining: 4,
  willRetryAutomatically: false,
};

function stubFetch(outcome: VerificationOutcomeView): jest.Mock {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body =
      url.includes('/documents/types') ? DOC_TYPES
      : url.includes('/documents') ? []
      : url.includes('/verify/bank') ? outcome
      : null;
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/* ==========================================================================
 * 1 — no acceptance and no preference arrives ticked
 * ======================================================================== */

function renderAgreement(
  overrides: Partial<React.ComponentProps<typeof StepAgreement>> = {},
): ReturnType<typeof render> {
  return render(
    <StepAgreement
      answers={{}}
      fallbackSignatory="Rohan Deshpande"
      onSaveDraft={noop}
      onContinue={accept}
      busy={false}
      onFieldFocus={noop}
      {...overrides}
    />,
  );
}

describe('step 7 — the agreements', () => {
  it('renders no checkbox and no radio already answered', () => {
    const { container } = renderAgreement();

    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    // Four agreements plus three notification channels. If this count drops,
    // something stopped being asked rather than stopped being pre-ticked.
    expect(boxes.length).toBeGreaterThanOrEqual(VENDOR_AGREEMENTS.length + 3);
    for (const box of Array.from(boxes)) {
      expect(box.checked).toBe(false);
      expect(box.defaultChecked).toBe(false);
    }

    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios.length).toBeGreaterThan(0);
    for (const radio of Array.from(radios)) {
      expect(radio.checked).toBe(false);
      expect(radio.defaultChecked).toBe(false);
    }

    // And it says so, rather than showing an empty box that reads as "no".
    expect(screen.getAllByText('Not accepted yet.')).toHaveLength(VENDOR_AGREEMENTS.length);
  });

  it('refuses to continue when the agreements have not been accepted', async () => {
    const onContinue = jest.fn(accept);
    renderAgreement({ onContinue });

    // Everything else answered, so the only thing missing is the acceptances.
    fireEvent.click(screen.getByLabelText('I name the amount I want'));
    fireEvent.click(screen.getByLabelText('Weekly'));
    fireEvent.click(screen.getByLabelText('Raise it for us — self-billed'));
    fireEvent.click(screen.getByLabelText('Email'));
    fireEvent.change(screen.getByLabelText(/^Language/), { target: { value: 'EN' } });

    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));

    await waitFor(() =>
      expect(screen.getAllByText(/We cannot buy from you without the/).length).toBe(
        VENDOR_AGREEMENTS.length,
      ),
    );
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('says a payout cycle is requested rather than granted when the tier has not earned it', () => {
    renderAgreement();
    fireEvent.click(screen.getByLabelText('Two working days after delivery'));

    expect(screen.getByText('Requested, not granted')).toBeInTheDocument();
    expect(screen.getByText(/Until it is granted you will be paid on the/)).toBeInTheDocument();
  });
});

/* ==========================================================================
 * 2 — a penny-drop MISMATCH is never a pass
 * ======================================================================== */

describe('step 6 — the penny-drop', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not render a MISMATCH as a pass, and refuses to continue on one', async () => {
    stubFetch(MISMATCH);
    const onContinue = jest.fn(accept);
    render(
      <StepDocumentsBank
        answers={{}}
        legalName="Northgate Asset Recovery Private Limited"
        onSaveDraft={noop}
        onContinue={onContinue}
        busy={false}
        onFieldFocus={noop}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Account holder name/), {
      target: { value: 'Northgate Asset Recovery Private Limited' },
    });
    fireEvent.change(screen.getByLabelText(/^Account number/), {
      target: { value: '502010030001' },
    });
    fireEvent.change(screen.getByLabelText(/^IFSC/), { target: { value: 'HDFC0001234' } });

    fireEvent.click(screen.getByRole('button', { name: 'Check this account' }));

    await waitFor(() =>
      expect(screen.getByText('Held in a different name')).toBeInTheDocument(),
    );

    // Not a pass, by any of the ways this screen could accidentally say so.
    expect(screen.queryByText('Verified')).toBeNull();
    expect(screen.queryByText('Bank confirmed')).toBeNull();
    // Both names are shown side by side, which is the whole point of the panel.
    expect(screen.getByText('Northgate Asset Recovery Enterprises')).toBeInTheDocument();
    // The server's sentence, as written.
    expect(screen.getByText(MISMATCH.message)).toBeInTheDocument();

    // And the forbidden thing: try to continue on it.
    fireEvent.click(screen.getByRole('button', { name: 'Save account and continue' }));
    await waitFor(() =>
      expect(
        screen.getByText(/We can only take an account the bank confirms is yours/),
      ).toBeInTheDocument(),
    );
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows nothing that reads as verified before any check has run', () => {
    stubFetch(MISMATCH);
    render(
      <StepDocumentsBank
        answers={{}}
        legalName="Northgate Asset Recovery Private Limited"
        onSaveDraft={noop}
        onContinue={accept}
        busy={false}
        onFieldFocus={noop}
      />,
    );
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);
    expect(screen.queryByText('Verified')).toBeNull();
  });
});

/* ==========================================================================
 * 3 — a reviewer's sentence, character for character
 * ======================================================================== */

const step = (
  code: string,
  title: string,
  order: number,
  status: StepProgress['status'],
  extra: Partial<StepProgress> = {},
): StepProgress => ({
  stepCode: code,
  stepOrder: order,
  title,
  purposeNote: null,
  estimatedMinutes: null,
  isRequired: true,
  status,
  completionPct: status === 'COMPLETE' ? 100 : 60,
  blockingReason: null,
  lastSavedAt: null,
  fields: [],
  ...extra,
});

describe('the application-status screen', () => {
  it('renders a reviewer’s reason verbatim, with its own punctuation', () => {
    // Curly apostrophe, an em dash, a double space after the full stop and a
    // trailing space: a "tidied" copy fails this.
    const reason =
      'The cancelled cheque is for account ••••4417 — that isn’t the account you typed.  Send one for the account you actually want paying, or correct the number. ';

    render(
      <ApplicationStatus
        orgStatus="INFO_REQUESTED"
        slaDueAt="2026-09-01T07:00:00.000Z"
        slaBreached={false}
        needsFix={[
          step('DOCUMENTS_BANK', 'Documents and bank', 6, 'NEEDS_FIX', {
            blockingReason: reason,
          }),
        ]}
        onEdit={noop}
        copy={{
          KYC_SUBMITTED: { title: 'With our team', body: 'Nothing to do.', tone: 'info' },
          INFO_REQUESTED: {
            title: 'We need something from you',
            body: 'The reviewer has asked for a change.',
            tone: 'fail',
          },
        }}
        steps={[
          step('ACCOUNT', 'Account', 1, 'COMPLETE'),
          step('DOCUMENTS_BANK', 'Documents and bank', 6, 'NEEDS_FIX', {
            blockingReason: reason,
          }),
        ]}
      />,
    );

    const quote = screen.getByText((_, node) => node?.textContent === reason && node.tagName === 'BLOCKQUOTE');
    expect(quote).toBeInTheDocument();
    expect(quote.textContent).toBe(reason);

    // Per-step state, which is the other half of what this screen is for.
    const rows = screen.getByRole('list');
    expect(within(rows).getByText('Account')).toBeInTheDocument();
    expect(within(rows).getByText('Complete')).toBeInTheDocument();
    expect(within(rows).getByText('Send this again')).toBeInTheDocument();
  });
});
