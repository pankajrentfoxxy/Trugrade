import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VendorCorrectionsRoute, VendorCorrectionDetailRoute } from './Corrections';

/**
 * T31, asserted by trying to break it.
 *
 * Four claims this screen makes that no integration test can see, because every
 * one of them is about what is on the page rather than what the API returned:
 *
 *   1. **Nothing is pre-selected and the four answers are peers.** The whole
 *      fairness argument rests on that, and it is one careless `defaultChecked`
 *      away from being false. So the test reads every radio and demands they are
 *      all unchecked, and that the primary action refuses to send until one is
 *      picked.
 *   2. **An elapsed window is not a failure.** `--fail` is PASS/FAIL only, and
 *      nothing here failed: the machine passed inspection at a different grade
 *      and the vendor ran out of time to answer. It is `warn`, and it says the
 *      correction can still be answered — which is true, because `respond()`
 *      refuses a SETTLED correction and not a late one.
 *   3. **A missing amount is words, not a zero and not a blank.** `price_before`
 *      is null on every seeded correction, so this is the live case rather than
 *      a hypothetical one.
 *   4. **A correction that is not the caller's is not shown.** The API answers
 *      404; the screen has to render that as an answer rather than a spinner.
 */

const OPEN = {
  id: 'c1',
  unitId: 'u1',
  listingId: 'l1',
  serialNumber: 'TGD88B6C311',
  skuCode: 'DEL-LAT5420-I51135G7-16-512',
  gradeDeclared: 'A_PLUS',
  gradeCorrected: 'A',
  reason: 'Chassis wear beyond the declared grade on inspection.',
  askBefore: null,
  vendorNotifiedAt: '2026-08-27T12:38:35.517Z',
  respondByAt: '2026-08-29T12:38:35.517Z',
  /** Negative: the window closed ~29 hours ago and it is still answerable. */
  hoursUntilAutoApply: -29.3,
  vendorResponse: null,
  vendorRespondedAt: null,
  autoAppliedAt: null,
  countsAgainstAccuracy: true,
};

function mockApi(body: unknown, ok = true, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({ ok, status, json: async () => body } as Response),
  );
}

const drawBoard = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/vendor/corrections']}>
      <Routes>
        <Route path="/vendor/corrections" element={<VendorCorrectionsRoute />} />
      </Routes>
    </MemoryRouter>,
  );

const drawRecord = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/vendor/corrections/c1']}>
      <Routes>
        <Route path="/vendor/corrections/:id" element={<VendorCorrectionDetailRoute />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('disputing is as easy as accepting', () => {
  it('pre-selects nothing, and offers the four answers at equal weight', async () => {
    mockApi(OPEN);
    drawRecord();
    await screen.findByText('Your answer');

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    // The claim. A default of "accept" would make the auto-apply the vendor is
    // trying to avoid the same click as agreeing with it.
    for (const r of radios) expect((r as HTMLInputElement).checked).toBe(false);

    // Disputing is reachable in exactly the same way as accepting: one radio in
    // the same group, not a link, not a second screen, not a confirmation.
    expect(
      screen.getByRole('radio', { name: /Dispute the correction/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Accept the corrected grade/ }),
    ).toBeTruthy();

    // And the one primary action will not fire until a choice is made.
    const send = screen.getByRole('button', { name: 'Send your answer' });
    expect(send.getAttribute('aria-disabled')).toBe('true');
    expect(send.getAttribute('title') ?? send.textContent).toBeTruthy();
  });

  it('names each answer’s consequence before it is chosen, not after', async () => {
    mockApi(OPEN);
    drawRecord();
    await screen.findByText('Your answer');

    // The money consequence of the two that change what the vendor is paid, and
    // the scorecard consequence of the one that can clear the mark.
    expect(screen.getByText(/price band that grade carries/)).toBeTruthy();
    expect(screen.getByText(/you name a new amount for it/)).toBeTruthy();
    expect(screen.getByText(/stops counting against your grade accuracy/)).toBeTruthy();
  });
});

describe('an elapsed response window is not a failure', () => {
  it('says the correction can still be answered, and never calls it expired or failed', async () => {
    mockApi(OPEN);
    const { container } = drawRecord();
    await screen.findByText('Your answer');

    expect(screen.getAllByText(/Window closed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/you can still answer/i).length).toBeGreaterThan(0);

    // Green and red are PASS and FAIL. Nothing on this machine failed — the
    // ledger recorded this exact chip being painted red once already.
    expect(container.querySelectorAll('.text-fail')).toHaveLength(0);
    expect(container.querySelectorAll('.text-pass')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/expired/i);

    // The form is still there, because the correction is still answerable.
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('drops the form once the correction really is settled', async () => {
    mockApi({
      ...OPEN,
      vendorResponse: 'ACCEPT_NEW_GRADE',
      vendorRespondedAt: '2026-08-30T06:00:00.000Z',
    });
    drawRecord();
    await screen.findByText('This one is settled');

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Send your answer' })).toBeNull();
  });
});

describe('a missing value never renders as a passing one', () => {
  it('says "No amount" where there is no recorded ask, not a zero and not a blank', async () => {
    mockApi([OPEN]);
    const { container } = drawBoard();
    await screen.findByText(/still waiting on you/);

    const row = container.querySelector('tbody tr');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('No amount')).toBeTruthy();

    // Scoped to the "Your ask" cell, because the row's prose legitimately
    // contains em dashes. What must never appear is a dash or a zero standing
    // where the AMOUNT goes: in a column of amounts a dash reads as a result —
    // "nothing owed here" — which is the one reading it must not get.
    const askCell = row!.querySelectorAll('td')[2]!;
    // `NotMeasured` carries its reason for a screen reader; the VISIBLE text is
    // what is being asserted here.
    askCell.querySelector('.sr-only')?.remove();
    expect(askCell.textContent!.trim()).toBe('No amount');
  });

  it('says the window is not measured when the server could not read it', async () => {
    // `null`, not zero. "We cannot tell you how long you have" and "you have no
    // time left" are different sentences and only one of them is ever true.
    mockApi({ ...OPEN, hoursUntilAutoApply: null, respondByAt: null });
    drawRecord();
    await screen.findByText('Your answer');

    expect(screen.getAllByText(/not measured/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 hours left/)).toBeNull();
  });
});

describe("another vendor's correction", () => {
  it('renders the refusal as an answer rather than loading forever', async () => {
    mockApi({ error: { message: 'Not found' } }, false, 404);
    drawRecord();

    const title = await screen.findByText('This grade correction did not load');
    expect(title).toBeTruthy();
    expect(screen.getByText(/may not be on your account/)).toBeTruthy();
    // Nothing about the record it refused to show.
    expect(document.body.textContent).not.toContain('TGD88B6C311');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
