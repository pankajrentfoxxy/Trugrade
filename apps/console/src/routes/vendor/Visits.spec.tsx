import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VendorVisitsRoute, VendorVisitDetailRoute, VendorVisitResultsRoute } from './Visits';

/**
 * T30, asserted by trying to break it.
 *
 * Five claims these screens make that no integration test can see, because every
 * one is about what is on the page rather than what the API returned:
 *
 *   1. **A visit that has not happened has no result.** Not a zero score, not a
 *      blank grade, not an empty seal cell. This defect class has been found
 *      about ten times in this build and it is one careless `?? 0` away from
 *      coming back.
 *   2. **`UNTESTABLE` is not a failure.** It is where a serial mismatch lands.
 *      Red would say the machine failed; the machine was never measured, and
 *      that distinction is what a vendor's appeal turns on. The test reads the
 *      chip's tone and demands it is not the FAIL one.
 *   3. **A visit status is never a verdict.** `NO_SHOW_VENDOR` is not red, and a
 *      visit where the technician arrived to an empty warehouse does not print
 *      `0 passed · 0 regraded · 0 failed`, which reads as a measured result of
 *      zero rather than as nothing having happened.
 *   4. **The fee is never a bare zero.** Three different truths hide behind ₹0
 *      — waived, ours, or unpriced — and only one of them is ever the case.
 *   5. **Grades are neutral.** A+, A and B are all sellable; the verdict has its
 *      own column and its own colour.
 */

const CALENDAR = {
  hours: [
    { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
    { dayOfWeek: 1, openTime: '09:00:00', closeTime: '18:00:00', isClosed: false },
  ],
  holidays: [{ date: '2026-09-08', reason: 'Half-yearly stock audit' }],
};

const FEE_VENDOR = {
  amount: '1500.00',
  bearer: 'VENDOR' as const,
  waiverReason: null,
  waivedAboveUnits: 50,
  standardFee: '1500.00',
};

/** Requested, manifest attached, nobody has been near it. */
const NOT_VISITED = {
  id: 'v1',
  visitNumber: 'QCV-20260830-4FCC58F1',
  status: 'REQUESTED' as const,
  siteLabel: 'Primary · Gurugram · 122001',
  requestedAt: '2026-08-30T11:08:10.066Z',
  scheduledDate: null,
  slotFrom: null,
  slotTo: null,
  technicianCode: null,
  unitsRequested: 3,
  unitsPresented: null,
  unitsInspected: 0,
  unitsPassed: 0,
  unitsGradeCorrected: 0,
  unitsFailed: 0,
  unitsAbsent: 0,
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  vendorSignoffAt: null,
  vendorSignoffName: null,
  rescheduleCount: 0,
  cancellationReason: null,
  notes: null,
  fee: FEE_VENDOR,
  cancellable: true,
  manifest: [
    {
      visitUnitId: 'vu1',
      unitId: 'u1',
      sequenceNo: 1,
      serialNumber: 'T27X56701',
      skuCode: 'DEL-LAT5420-I51135G7-16-256',
      gradeDeclared: 'A',
      outcome: 'PENDING' as const,
      absentReason: null,
      result: null,
    },
  ],
  calendar: CALENDAR,
};

/** The technician arrived; nobody was there. Not a verdict, and not a zero. */
const NO_SHOW = {
  ...NOT_VISITED,
  id: 'v2',
  visitNumber: 'QCV-20260830-SEED0003',
  status: 'NO_SHOW_VENDOR' as const,
  scheduledDate: '2026-08-24',
  slotFrom: '09:00:00',
  slotTo: '13:00:00',
  technicianCode: 'TECH-DEMO01',
  unitsRequested: 8,
  unitsPresented: 0,
  arrivedAt: '2026-08-24T09:30:00.000Z',
  cancellationReason: 'Nobody was at the warehouse at the agreed slot.',
  cancellable: false,
  manifest: [],
};

/** One failed, one that could not be measured, one clean pass, one never produced. */
const FINISHED = {
  ...NOT_VISITED,
  id: 'v3',
  visitNumber: 'QCV-20260830-SEED0004',
  status: 'COMPLETED' as const,
  scheduledDate: '2026-08-26',
  technicianCode: 'TECH-DEMO01',
  unitsRequested: 4,
  unitsPresented: 3,
  unitsInspected: 3,
  unitsPassed: 1,
  unitsFailed: 1,
  unitsAbsent: 1,
  arrivedAt: '2026-08-26T09:30:00.000Z',
  completedAt: '2026-08-26T12:00:00.000Z',
  cancellable: false,
  manifest: [
    {
      visitUnitId: 'f1',
      unitId: 'u2',
      sequenceNo: 1,
      serialNumber: 'TGD16FE7D62',
      skuCode: 'DEL-LAT5420-I51135G7-16-512',
      gradeDeclared: 'A',
      outcome: 'FAIL' as const,
      absentReason: null,
      result: {
        verdict: 'FAIL',
        grade: 'A',
        qcScore: 41,
        inspectedOn: '2026-08-26',
        batteryHealthPct: 93,
        seal: null,
        findings: [
          { area: 'BATTERY', score: 6, maxScore: 10 },
          { area: 'DISPLAY', score: 6, maxScore: 10 },
        ],
      },
    },
    {
      visitUnitId: 'f2',
      unitId: 'u3',
      sequenceNo: 2,
      serialNumber: 'TGD5963139B',
      skuCode: 'DEL-LAT5420-I51135G7-16-512',
      gradeDeclared: 'A',
      outcome: 'UNTESTABLE' as const,
      absentReason: null,
      result: {
        verdict: 'MISMATCH',
        grade: 'A',
        qcScore: 92,
        inspectedOn: '2026-08-26',
        batteryHealthPct: null,
        seal: null,
        findings: [],
      },
    },
    {
      visitUnitId: 'f3',
      unitId: 'u4',
      sequenceNo: 3,
      serialNumber: 'TGD13B4FD7B',
      skuCode: 'DEL-LAT5420-I51135G7-16-512',
      gradeDeclared: 'A',
      outcome: 'PASS' as const,
      absentReason: null,
      result: {
        verdict: 'PASS',
        grade: 'A_PLUS',
        qcScore: 86,
        inspectedOn: '2026-08-26',
        batteryHealthPct: 92,
        seal: { code: 'TG-TGD13B4FD7B', status: 'APPLIED' },
        findings: [],
      },
    },
    {
      visitUnitId: 'f4',
      unitId: 'u5',
      sequenceNo: 4,
      serialNumber: 'TGD9999999',
      skuCode: 'DEL-LAT5420-I51135G7-16-512',
      gradeDeclared: 'A',
      outcome: 'ABSENT' as const,
      absentReason: 'Not produced at the visit.',
      result: null,
    },
  ],
};

function mockApi(body: unknown, ok = true, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({ ok, status, json: async () => body } as Response),
  );
}

const drawBoard = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/vendor/qc/visits']}>
      <Routes>
        <Route path="/vendor/qc/visits" element={<VendorVisitsRoute />} />
      </Routes>
    </MemoryRouter>,
  );

const drawRecord = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/vendor/qc/visits/v1']}>
      <Routes>
        <Route path="/vendor/qc/visits/:id" element={<VendorVisitDetailRoute />} />
      </Routes>
    </MemoryRouter>,
  );

const drawResults = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/vendor/qc/visits/v3/results']}>
      <Routes>
        <Route path="/vendor/qc/visits/:id/results" element={<VendorVisitResultsRoute />} />
      </Routes>
    </MemoryRouter>,
  );

/**
 * The colour token a `StatusPill` actually rendered with.
 *
 * Read off the class rather than a test id on purpose: the rule being asserted
 * is about the token — `--fail` is PASS/FAIL only — so the assertion should fail
 * if the token changes, not merely if a label does. `StatusPill` exposes no data
 * attribute and adding one would mean editing a shared component this task does
 * not own.
 */
const toneOf = (el: HTMLElement): string | null =>
  /\btext-(pass|fail|warn|acc-ink|ink-2)\b/.exec(el.className)?.[1] ?? null;

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('a visit that has not happened has no result', () => {
  it('says so on the board instead of printing a zero', async () => {
    mockApi([NOT_VISITED]);
    drawBoard();

    const [link] = await screen.findAllByText('QCV-20260830-4FCC58F1');
    const cells = link!.closest('tr')!;
    expect(within(cells).getByText('Not inspected yet')).toBeTruthy();
    expect(within(cells).getByText('Not scheduled yet')).toBeTruthy();
    expect(within(cells).getByText('Not assigned yet')).toBeTruthy();
    // The trap: `0 of 3 inspected` is arithmetically true and reads as a result.
    expect(within(cells).queryByText(/0 of 3/)).toBeNull();
  });

  it('leaves every measured field absent on the record, never zero', async () => {
    mockApi(NOT_VISITED);
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    for (const label of ['Not arrived', 'Not started', 'Not finished', 'Not signed off']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText('Not inspected yet').length).toBeGreaterThan(0);
  });

  it('refuses to draw a results table for a visit nobody attended', async () => {
    mockApi({ ...NOT_VISITED, id: 'v3' });
    drawResults();

    expect(await screen.findByText('This inspection has not happened yet')).toBeTruthy();
    // No manifest row, no score column, nothing that could be read as a finding.
    expect(screen.queryByText('T27X56701')).toBeNull();
    expect(screen.queryByText(/of 100/)).toBeNull();
  });
});

describe('a colour never claims more than the data does', () => {
  it('renders UNTESTABLE as a warning and not as a failure', async () => {
    mockApi(FINISHED);
    drawResults();

    const untestable = await screen.findByText('Could not be measured');
    expect(toneOf(untestable)).toBe('warn');
    // The one that genuinely failed still reads as a failure, so the assertion
    // above is about UNTESTABLE rather than about nothing ever being red.
    expect(toneOf(screen.getByText('Failed'))).toBe('fail');
    // And it says why it is not a failure, in words.
    expect(screen.getByText(/That is not a failure/)).toBeTruthy();
  });

  it('renders a no-show as a warning, not a verdict, and prints no zero breakdown', async () => {
    mockApi([NO_SHOW]);
    drawBoard();

    // Scoped to the row: the status filter's <option> carries the same words,
    // and asserting a colour against a dropdown entry proves nothing.
    const row = (await screen.findByText('QCV-20260830-SEED0003')).closest('tr')!;
    expect(toneOf(within(row).getByText('Nobody at the site'))).toBe('warn');
    expect(within(row).getByText('No machine was opened')).toBeTruthy();
    expect(within(row).queryByText(/0 passed/)).toBeNull();
  });

  it('keeps grades neutral, on both the declared and the inspected side', async () => {
    mockApi(FINISHED);
    drawResults();

    await screen.findByText('TGD13B4FD7B');
    for (const badge of screen.getAllByTestId('grade-badge')) {
      expect(badge.className).not.toMatch(/\b(bg|text|border)-(pass|fail)\b/);
    }
  });

  it('a machine that was never produced carries no measurement at all', async () => {
    mockApi(FINISHED);
    drawResults();

    const row = (await screen.findByText('TGD9999999')).closest('tr')!;
    expect(within(row).getByText('Not presented')).toBeTruthy();
    expect(within(row).getByText('Not presented — never opened')).toBeTruthy();
    expect(within(row).queryByText(/of 100/)).toBeNull();
  });

  it('says a battery was not measured rather than leaving the cell blank', async () => {
    mockApi(FINISHED);
    drawResults();

    const row = (await screen.findByText('TGD5963139B')).closest('tr')!;
    expect(within(row).getByText('Battery not measured')).toBeTruthy();
    expect(within(row).getByText('Not sealed')).toBeTruthy();
  });
});

describe('every number carries its denominator', () => {
  it('prints the score out of 100 and each finding out of its own maximum', async () => {
    mockApi(FINISHED);
    drawResults();

    await screen.findByText('TGD16FE7D62');
    expect(screen.getByText('41 of 100')).toBeTruthy();
    expect(screen.getByText(/Battery 6 of 10/)).toBeTruthy();
    expect(screen.getAllByText(/of the battery.s design capacity/).length).toBeGreaterThan(0);
  });
});

describe('the visit fee is never a bare zero', () => {
  it('names who bears it when there is one to pay', async () => {
    mockApi(NOT_VISITED);
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getAllByText(/is yours to pay/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/we stop charging the fee above 50/).length).toBeGreaterThan(0);
  });

  it('says what waived it rather than showing nothing', async () => {
    mockApi({
      ...NOT_VISITED,
      fee: {
        amount: '0.00',
        bearer: 'WAIVED',
        waiverReason: 'First inspection at this supply point.',
        waivedAboveUnits: 50,
        standardFee: '1500.00',
      },
    });
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getAllByText('No fee for this inspection.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('First inspection at this supply point.').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹0.00')).toBeNull();
  });

  it('says a fee we bear is at our cost rather than naming ₹0.00', async () => {
    mockApi({
      ...NOT_VISITED,
      fee: { ...FEE_VENDOR, amount: '0.00', bearer: 'TRUETECH' },
    });
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getAllByText('This inspection is at our cost.').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹0.00')).toBeNull();
  });

  it('says a fee nobody has set is unpriced, not free', async () => {
    mockApi({
      ...NOT_VISITED,
      fee: {
        amount: '0.00',
        bearer: 'VENDOR',
        waiverReason: null,
        waivedAboveUnits: 50,
        standardFee: '1500.00',
      },
    });
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getAllByText('Not priced yet').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹0.00')).toBeNull();
  });
});

describe('the site calendar states what cannot be booked', () => {
  it('names the closed weekday and the holiday, rather than leaving them out', async () => {
    mockApi(NOT_VISITED);
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getByText('Closed — cannot be booked')).toBeTruthy();
    expect(screen.getByText('2026-09-08')).toBeTruthy();
    expect(screen.getByText(/Half-yearly stock audit/)).toBeTruthy();
  });

  it('an unpublished calendar is not a shut warehouse', async () => {
    mockApi({ ...NOT_VISITED, calendar: { hours: [], holidays: [] } });
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getByText(/You have not published opening hours/)).toBeTruthy();
    expect(screen.queryByText('Closed — cannot be booked')).toBeNull();
  });
});

describe('an inspection that cannot be called off does not offer to be', () => {
  it('hides the cancel panel on a finished visit', async () => {
    mockApi(FINISHED);
    render(
      <MemoryRouter initialEntries={['/vendor/qc/visits/v3']}>
        <Routes>
          <Route path="/vendor/qc/visits/:id" element={<VendorVisitDetailRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findAllByText('QCV-20260830-SEED0004');
    expect(screen.queryByRole('button', { name: 'Cancel this inspection' })).toBeNull();
  });

  it('offers it on a requested one, and says the fee does not move', async () => {
    mockApi(NOT_VISITED);
    drawRecord();

    await screen.findAllByText('QCV-20260830-4FCC58F1');
    expect(screen.getByRole('button', { name: 'Cancel this inspection' })).toBeTruthy();
    expect(screen.getByText(/no cancellation notice period set/)).toBeTruthy();
  });
});

describe('a visit that is not the caller’s renders as an answer', () => {
  it('shows the refusal rather than spinning forever', async () => {
    mockApi({ error: { message: "We couldn't find that qc_visit." } }, false, 404);
    drawRecord();

    expect(await screen.findByText('This inspection did not load')).toBeTruthy();
    expect(screen.getByText(/may not be on your account/)).toBeTruthy();
  });
});
