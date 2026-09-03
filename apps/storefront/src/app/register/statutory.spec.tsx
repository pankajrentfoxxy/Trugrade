/**
 * The two things about step 3 that would be silently, expensively wrong.
 *
 * Neither test asserts that a guard exists. The first drives a real
 * `PROVIDER_ERROR` through the component and reads the screen back to see
 * whether it blamed the applicant or spent one of their attempts; the second
 * gives it a GSTIN issued against a different PAN and checks that nothing was
 * asked of the GST portal at all.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StepStatutory, BUYER_STATUTORY_COPY } from './StepStatutory';
import type { VerificationOutcomeView } from './api';

/* --------------------------------------------------------------- fetch stub */

interface Reply {
  status: number;
  body?: unknown;
}

let calls: string[];

function stubFetch(routes: Record<string, Reply>): void {
  calls = [];
  const replies = new Map(Object.entries(routes));
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    calls.push(key);
    const reply = replies.get(key) ?? { status: 404, body: { error: { message: 'no stub' } } };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? null,
    } as Response;
  }) as unknown as typeof fetch;
}

/** The fake GST adapter's own PROVIDER_ERROR, as `VerificationService` renders it. */
const providerError: VerificationOutcomeView = {
  id: 'v1',
  checkType: 'GSTIN',
  outcome: 'PROVIDER_ERROR',
  message:
    "We couldn't reach the GST portal. We'll retry automatically — nothing for you to do.",
  attemptNo: 1,
  // The service adds one back precisely because the attempt was not consumed.
  attemptsRemaining: 5,
  willRetryAutomatically: true,
};

const passed = (legalName: string): VerificationOutcomeView => ({
  id: 'v2',
  checkType: 'GSTIN',
  outcome: 'PASS',
  message: `Active · ${legalName} · Haryana (06)`,
  resolved: {
    legalName,
    tradeName: 'Alpha Systems',
    status: 'ACTIVE',
    stateCode: '06',
    registrationDate: '2019-07-01',
  },
  attemptNo: 1,
  attemptsRemaining: 4,
  willRetryAutomatically: false,
});

/** Every GSTIN below carries a real check digit — a bad one never leaves the client. */
const GSTIN_OWN_PAN = '06ABCCE1234F6Z1';
const GSTIN_OTHER_PAN = '06ABCDE1234F1Z4';
const OWN_PAN = 'ABCCE1234F';

const noop = (): void => {};

function renderStep(answers: Record<string, unknown>): void {
  render(
    <StepStatutory
      answers={answers}
      fallbackLegalName="Alpha Systems Private Limited"
      constitution="PVT_LTD"
      copy={BUYER_STATUTORY_COPY}
      busy={false}
      onSaveDraft={noop}
      onContinue={async () => null}
      onFieldFocus={noop}
    />,
  );
}

/* ================================ PROVIDER_ERROR is our problem, not theirs */

describe('a GST portal that does not answer', () => {
  it('does not consume an attempt, does not blame the applicant, and retries itself', async () => {
    stubFetch({
      'POST /api/onboarding/verify/gstin': { status: 200, body: providerError },
    });

    renderStep({ pan: OWN_PAN, gstins: [{ gstin: GSTIN_OWN_PAN, isPrimary: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    const panel = await screen.findByText(/did not answer/i);
    const box = panel.closest('div') as HTMLElement;

    // 1. The attempt was not spent, and the screen says so in as many words —
    //    "have I just burnt a try on their outage" is the fear here.
    expect(box).toHaveTextContent(/This has not used any of your checks/);
    const remaining = within(box).getAllByText('5');
    expect(remaining.length).toBeGreaterThan(0);

    // 2. Nothing on screen tells them to fix anything.
    expect(box).not.toHaveTextContent(/refused/i);
    expect(box).not.toHaveTextContent(/check the (value|number)/i);
    expect(box).not.toHaveTextContent(/correct/i);
    expect(screen.queryByText('Refused')).not.toBeInTheDocument();

    // 3. It is not coloured as a failure. `--fail` is PASS/FAIL only.
    expect(box.className).toContain('border-warn');
    expect(box.className).not.toContain('border-fail');
    expect(box.querySelector('[role="alert"]')).toBeNull();

    // 4. It retries by itself, visibly, rather than waiting to be poked.
    expect(box).toHaveTextContent(/Retrying automatically in/);
  });

  /**
   * Seventy `act` flushes of a form that grew four more fields when the vendor
   * flow started sharing it, so the default five seconds is now inside the
   * margin on a loaded machine — `pnpm test` runs every package at once. A
   * timeout is what this needs: the assertions are the same, and a test that
   * fails on scheduling rather than on behaviour is worse than a slow one.
   * Timing out mid-fake-timers also skips the `useRealTimers` below, which is
   * what turned one failure into six.
   */
  it('offers to continue rather than dead-ending, once the retries are spent', async () => {
    jest.useFakeTimers();
    try {
      stubFetch({
        'POST /api/onboarding/verify/gstin': { status: 200, body: providerError },
      });

      renderStep({ pan: OWN_PAN, gstins: [{ gstin: GSTIN_OWN_PAN, isPrimary: false }] });
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

      // Three scheduled retries at 5s, 15s and 45s, all answered the same way.
      // A second at a time, because each retry's timeout is only scheduled once
      // React has committed the outcome before it — advancing seventy seconds in
      // one jump runs the first countdown and nothing after it.
      await screen.findByText(/Retrying automatically in/);
      for (let second = 0; second < 70; second += 1) {
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1000);
        });
      }

      expect(
        screen.getByRole('button', { name: 'Continue — let a reviewer verify it' }),
      ).toBeInTheDocument();
      // Four calls: the one they asked for, then three automatic retries.
      expect(calls.filter((c) => c.endsWith('/verify/gstin'))).toHaveLength(4);
    } finally {
      jest.useRealTimers();
    }
  }, 30_000);
});

/* ============================== VR-006 — the PAN inside the GSTIN must agree */

describe('a GSTIN issued against a different PAN', () => {
  it('is caught before the portal is asked anything', async () => {
    stubFetch({ 'POST /api/onboarding/verify/gstin': { status: 200, body: passed('Anyone') } });

    renderStep({ pan: OWN_PAN, gstins: [{ gstin: GSTIN_OTHER_PAN, isPrimary: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    // Names both values. "Invalid input" would leave them staring at two
    // correct-looking strings.
    expect(await screen.findByText(/belongs to PAN ABCDE1234F, not to ABCCE1234F/)).toBeInTheDocument();

    // And the whole point: no provider call was spent on it.
    expect(calls).toHaveLength(0);
  });

  it('rejects a GSTIN whose check digit is wrong without calling out', async () => {
    stubFetch({ 'POST /api/onboarding/verify/gstin': { status: 200, body: passed('Anyone') } });

    // Same fourteen characters as GSTIN_OWN_PAN, last one changed.
    renderStep({ pan: OWN_PAN, gstins: [{ gstin: '06ABCCE1234F6Z9', isPrimary: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText(/the last character does not match the rest/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

/* ========================================= a PASS is a name, never just a tick */

describe('a verified GSTIN', () => {
  it('shows the name the portal returned and asks for it to be confirmed', async () => {
    stubFetch({
      'POST /api/onboarding/verify/gstin': {
        status: 200,
        body: passed('Alpha Systems Private Limited'),
      },
    });

    renderStep({ pan: OWN_PAN, gstins: [{ gstin: GSTIN_OWN_PAN, isPrimary: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    // Twice over: as the heading of the verified panel, and beside the primary
    // radio, which is where the choice is actually made.
    expect(await screen.findAllByText('Alpha Systems Private Limited')).toHaveLength(2);
    const confirm = screen.getByLabelText(/Yes, this is our business/);
    // Rule 4(9): the box that says "that is us" is never ticked for them.
    expect(confirm).not.toBeChecked();
  });

  it('does not pre-select a primary registration', () => {
    stubFetch({});
    renderStep({
      pan: OWN_PAN,
      gstins: [{ gstin: GSTIN_OWN_PAN, isPrimary: false }, { gstin: GSTIN_OTHER_PAN }],
    });

    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });
});

/* ========================================================== GSTIN row list */

describe('adding and removing GSTIN rows', () => {
  const gstSection = (): HTMLElement => {
    const title = screen.getByText('GST registrations');
    const section = title.closest('[data-testid="form-section"]');
    if (!section) throw new Error('GST section not found');
    return section as HTMLElement;
  };

  it('numbers rows in order and drops a row when Remove is clicked', () => {
    stubFetch({});
    renderStep({ pan: OWN_PAN, gstins: [{ gstin: '', isPrimary: false }] });

    fireEvent.click(screen.getByRole('button', { name: 'Add another GSTIN' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add another GSTIN' }));

    const rows = screen.getAllByTestId('gstin-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('GSTIN 1');
    expect(rows[1]).toHaveTextContent('GSTIN 2');
    expect(rows[2]).toHaveTextContent('GSTIN 3');
    expect(gstSection()).toHaveTextContent('0 of 3 confirmed');

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Remove' }));

    const after = screen.getAllByTestId('gstin-row');
    expect(after).toHaveLength(2);
    expect(after[0]).toHaveTextContent('GSTIN 1');
    expect(after[1]).toHaveTextContent('GSTIN 2');
    expect(gstSection()).toHaveTextContent('0 of 2 confirmed');
    expect(screen.queryByText('GSTIN 3')).not.toBeInTheDocument();
  });

  it('always keeps at least one empty row', () => {
    stubFetch({});
    renderStep({ pan: OWN_PAN, gstins: [{ gstin: '', isPrimary: false }] });

    fireEvent.click(screen.getByRole('button', { name: 'Add another GSTIN' }));
    const rows = screen.getAllByTestId('gstin-row');
    expect(rows).toHaveLength(2);

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove' }));

    expect(screen.getAllByTestId('gstin-row')).toHaveLength(1);
    expect(gstSection()).toHaveTextContent('0 of 1 confirmed');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

/* ================================================================== resuming */

describe('a resumed session', () => {
  it('shows what was already verified rather than checking it again', () => {
    stubFetch({});
    renderStep({
      pan: OWN_PAN,
      panOutcome: {
        id: 'p1',
        checkType: 'PAN',
        outcome: 'PASS',
        message: 'Valid · ALPHA SYSTEMS PRIVATE LIMITED',
        resolved: { name: 'ALPHA SYSTEMS PRIVATE LIMITED', holderType: 'COMPANY' },
        attemptNo: 1,
        attemptsRemaining: 4,
        willRetryAutomatically: false,
      },
      gstins: [
        {
          gstin: GSTIN_OWN_PAN,
          isPrimary: true,
          confirmed: true,
          outcome: passed('Alpha Systems Private Limited'),
        },
      ],
    });

    expect(screen.getByText('ALPHA SYSTEMS PRIVATE LIMITED')).toBeInTheDocument();
    expect(screen.getAllByText('Alpha Systems Private Limited').length).toBeGreaterThan(0);
    expect(screen.getByRole('radio')).toBeChecked();
    expect(calls).toHaveLength(0);
  });
});
