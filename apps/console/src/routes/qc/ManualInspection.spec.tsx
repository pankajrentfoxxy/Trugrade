import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QC_AREAS } from '@trugrade/contracts';
import { ManualInspectionRoute } from './ManualInspection';
import { QC_AREA_CODES, type TechnicianOption, type VisitDetail } from './types';

const VISIT: VisitDetail = {
  id: 'visit-1',
  visitNumber: 'QCV-2026-0041',
  status: 'IN_PROGRESS',
  vendorOrgId: 'org-1',
  vendorName: 'Northpoint Refurb',
  facilityLabel: 'Gurugram warehouse',
  scheduledDate: '2026-08-26',
  slotFrom: '09:00:00',
  slotTo: '17:00:00',
  technicianId: 'tech-1',
  technicianName: 'R. Iyer',
  unitsRequested: 12,
  unitsPresented: 12,
  unitsInspected: 3,
  unitsPassed: 3,
  unitsGradeCorrected: 0,
  unitsFailed: 0,
  unitsAbsent: 0,
  geoVarianceMetres: 40,
  geoVarianceAlertMetres: 500,
  requestedAt: '2026-08-20T10:00:00Z',
  arrivedAt: '2026-08-26T03:35:00Z',
  startedAt: '2026-08-26T03:40:00Z',
  completedAt: null,
  vendorSignoffAt: null,
  vendorSignoffName: null,
  visitFee: '1500.00',
  feeBearer: 'TRUETECH',
  notes: null,
  manifest: [
    {
      visitUnitId: 'vu-1',
      unitId: 'u-1',
      sequenceNo: 1,
      serialNumber: 'CND4233328',
      listingId: 'l-1',
      skuLabel: 'HP Victus 16 · i7 · 16 GB · 512 GB NVMe',
      declaredGrade: 'A',
      outcome: 'PENDING',
      absentReason: null,
      qcReportId: null,
      durationSeconds: null,
    },
  ],
  toolRuns: [],
  photos: [],
  seals: [],
};

const TECHS: TechnicianOption[] = [
  { id: 'tech-1', name: 'R. Iyer', employeeCode: 'QC-004', isActive: true },
];

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/technicians') ? TECHS : VISIT;
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  });
}

function renderForm(): void {
  render(
    <MemoryRouter initialEntries={['/qc/visits/visit-1/inspect']}>
      <Routes>
        <Route path="/qc/visits/:visitId/inspect" element={<ManualInspectionRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the form captures the twelve areas the database actually allows', () => {
  it('renders the schema codes, not the cosmetic vocabulary the doc lists', async () => {
    mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    // The twelve areas are a <fieldset> each rather than twelve rows of a
    // <table>: four controls per area is a form, and DataBoard reads data rather
    // than collecting it. `data-area` still addresses one area's controls as a
    // group, which is what this assertion is actually about.
    const rows = document.querySelectorAll('[data-area]');
    expect([...rows].map((r) => r.getAttribute('data-area'))).toEqual([...QC_AREA_CODES]);

    // The trap this whole lane keeps stepping in: PHASE_04_QC.md and
    // `QC_AREAS` in @trugrade/contracts both name chassis/lid/palmrest, and
    // every one of those fails qc_area_result_area_check on insert.
    expect(QC_AREAS).toContain('CHASSIS');
    expect([...rows].map((r) => r.getAttribute('data-area'))).not.toContain('CHASSIS');
  });

  it('offers "not measured" on every single area', async () => {
    mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    const rows = document.querySelectorAll('[data-area]');
    for (const row of rows) {
      // Without this option the area a technician could not test gets marked
      // Pass, because the form will not let them submit otherwise.
      expect(within(row as HTMLElement).getByLabelText('Not measured')).toBeInTheDocument();
    }
    expect(rows).toHaveLength(12);
  });
});

describe('the serial hard stop', () => {
  it('says stop, and offers the only action left, when the label is the wrong one', async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    await user.selectOptions(screen.getByLabelText('Unit on the manifest'), 'vu-1');
    await user.type(screen.getByLabelText('Serial read off the machine'), 'CND9999999');

    expect(screen.getByText('Stop. This is not the machine on the manifest.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record as untestable/ })).toBeInTheDocument();
  });

  it('confirms the match instead of staying silent when the serial is right', async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    await user.selectOptions(screen.getByLabelText('Unit on the manifest'), 'vu-1');
    await user.type(screen.getByLabelText('Serial read off the machine'), 'CND4233328');

    expect(screen.getByText('Matches the manifest: CND4233328')).toBeInTheDocument();
    expect(
      screen.queryByText('Stop. This is not the machine on the manifest.'),
    ).not.toBeInTheDocument();
  });
});

describe('submitting', () => {
  it('lists everything outstanding and posts nothing', async () => {
    const user = userEvent.setup();
    const fetchSpy = mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    await user.click(screen.getByRole('button', { name: 'Record the inspection' }));

    const blockers = await screen.findByTestId('blockers');
    expect(within(blockers).getByText(/Scan or type the serial/)).toBeInTheDocument();
    expect(within(blockers).getByText(/Still to photograph/)).toBeInTheDocument();
    expect(within(blockers).getByText(/no seal without a photograph/)).toBeInTheDocument();

    // The point of the whole check: an incomplete inspection never reaches the API.
    const posts = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts).toHaveLength(0);
  });
});

describe('the cycle count', () => {
  it('lets a technician say the system did not report one', async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    const field = screen.getByLabelText('Cycle count');
    await user.type(field, '0');
    await user.click(screen.getByLabelText(/Not reported by this system/));

    // A disabled box holding a stale zero is exactly the zero-default that
    // 07 section 3.5 says a never-fabricate policy leaks through.
    expect(field).toBeDisabled();
    expect(field).toHaveValue(null);
  });
});

describe('the grade cap is on screen, not only in the blocker list', () => {
  it('says what a failed area does to the grade as soon as it is recorded', async () => {
    const user = userEvent.setup();
    mockApi();
    renderForm();
    await screen.findByText('Manual inspection');

    const ports = document.querySelector('[data-area="PORTS"]') as HTMLElement;
    await user.click(within(ports).getByLabelText('Fail'));

    expect(screen.getByText('Caps this machine at B')).toBeInTheDocument();
    expect(screen.getByText(/A weighted mean would swallow that/)).toBeInTheDocument();
  });
});
