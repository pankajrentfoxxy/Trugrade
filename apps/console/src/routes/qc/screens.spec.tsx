import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuditRecheckRoute } from './AuditRecheck';
import { GradeCorrectionsRoute } from './GradeCorrections';
import { SamplingRulesRoute, checkDraft } from './SamplingRules';
import { ScheduleRoute } from './Schedule';
import { VisitBoardRoute } from './VisitBoard';
import { VisitDetailRoute } from './VisitDetail';
import type {
  AuditDashboard,
  GradeCorrectionRow,
  SamplingRuleRow,
  ScheduleWeek,
  VisitDetail,
  VisitRow,
} from './types';

function mockJson(body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response);
}

const inRouter = (el: React.ReactElement): ReturnType<typeof render> =>
  render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => {
  vi.restoreAllMocks();
});

/* ==========================================================================
 * Visit board
 * ======================================================================== */

const visit = (over: Partial<VisitRow>): VisitRow => ({
  id: 'v1',
  visitNumber: 'QCV-0001',
  status: 'SCHEDULED',
  vendorOrgId: 'org-1',
  vendorName: 'Northpoint Refurb',
  facilityLabel: 'Gurugram warehouse',
  scheduledDate: '2026-08-28',
  slotFrom: '09:00:00',
  slotTo: '17:00:00',
  technicianId: 'tech-1',
  technicianName: 'R. Iyer',
  unitsRequested: 40,
  unitsPresented: 40,
  unitsInspected: 40,
  unitsPassed: 38,
  unitsGradeCorrected: 1,
  unitsFailed: 1,
  unitsAbsent: 0,
  geoVarianceMetres: 20,
  geoVarianceAlertMetres: 500,
  ...over,
});

describe('the visit board', () => {
  it('counts the check-ins that happened away from the warehouse, using the threshold on the row', async () => {
    mockJson([
      visit({ id: 'ok' }),
      visit({ id: 'far', visitNumber: 'QCV-0002', geoVarianceMetres: 4200 }),
    ]);
    inRouter(<VisitBoardRoute />);
    await screen.findByText('QCV-0001');

    // The cheapest fraud signal in the phase, and worthless buried in a detail
    // page nobody opens.
    expect(
      screen.getByText('1 visit checked in outside the registered warehouse'),
    ).toBeInTheDocument();
    expect(screen.getByText(/over the 500 m alert threshold/)).toBeInTheDocument();
  });

  it('does not alert on a variance the configured threshold permits', async () => {
    mockJson([visit({ geoVarianceMetres: 900, geoVarianceAlertMetres: 1000 })]);
    inRouter(<VisitBoardRoute />);
    await screen.findByText('QCV-0001');
    expect(screen.queryByText(/outside the registered warehouse/)).not.toBeInTheDocument();
  });

  it('calls out units that were never presented', async () => {
    mockJson([visit({ unitsInspected: 30, unitsAbsent: 10 })]);
    inRouter(<VisitBoardRoute />);
    await screen.findByText('QCV-0001');
    // A visit that inspected 30 of 40 is not a successful visit, and the cost of
    // the trip is spread across the 30 that were there.
    expect(screen.getByText('10 not presented')).toBeInTheDocument();
  });

  it('puts the soonest visit first', async () => {
    mockJson([
      visit({ id: 'late', visitNumber: 'QCV-LATE', scheduledDate: '2026-09-10' }),
      visit({ id: 'soon', visitNumber: 'QCV-SOON', scheduledDate: '2026-08-27' }),
    ]);
    inRouter(<VisitBoardRoute />);
    await screen.findByText('QCV-SOON');

    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links.indexOf('QCV-SOON')).toBeLessThan(links.indexOf('QCV-LATE'));
  });
});

/* ==========================================================================
 * Visit detail
 * ======================================================================== */

const DETAIL: VisitDetail = {
  ...visit({}),
  requestedAt: '2026-08-20T10:00:00Z',
  arrivedAt: '2026-08-26T03:35:00Z',
  startedAt: '2026-08-26T03:40:00Z',
  completedAt: '2026-08-26T11:00:00Z',
  vendorSignoffAt: '2026-08-26T11:05:00Z',
  vendorSignoffName: 'S. Mehta',
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
      skuLabel: 'HP Victus 16',
      declaredGrade: 'A',
      outcome: 'UNTESTABLE',
      absentReason: null,
      qcReportId: null,
      durationSeconds: 540,
    },
  ],
  toolRuns: [
    {
      id: 'tr-1',
      toolProviderCode: 'DEVICESURE',
      toolVersion: '0.1.0',
      toolRunId: 'fe486d18',
      parseStatus: 'PARSED',
      parseError: null,
      serialFromTool: 'CND9999999',
      serialMatches: false,
      rawReportHash: '2fa7aff187e5ba52942102c4bc68436f8c048cf59cedb56752fbf65ddb2076d4',
      rawReportJson: { device: { serial: 'CND9999999' }, score: 98.24, grade: 'A_PLUS' },
      ingestedAt: '2026-08-26T09:12:00Z',
    },
  ],
  photos: [],
  seals: [
    {
      sealCode: 'TRG-26HR-0004821',
      status: 'INTACT',
      appliedAt: '2026-08-26T09:20:00Z',
      appliedByName: 'R. Iyer',
      appliedPhotoUrl: '/f/seal.webp',
      verifiedAt: null,
      verifiedByName: null,
      brokenAt: null,
      brokenReason: null,
      replacedBySealCode: null,
    },
  ],
};

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={['/qc/visits/v1']}>
      <Routes>
        <Route path="/qc/visits/:visitId" element={<VisitDetailRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('one visit', () => {
  it('makes the raw payload readable, exactly as it arrived', async () => {
    mockJson(DETAIL);
    renderDetail();
    await screen.findByText('QCV-0001');

    // Task 2 stores the payload verbatim because it is the evidence when a buyer
    // disputes a grade in four months. Evidence nobody can look at is filing.
    expect(screen.getByText('The payload exactly as it arrived')).toBeInTheDocument();
    const dump = document.querySelector('pre')?.textContent ?? '';
    expect(JSON.parse(dump)).toEqual(DETAIL.toolRuns[0]?.rawReportJson);
  });

  it('reads a serial mismatch as what it is', async () => {
    mockJson(DETAIL);
    renderDetail();
    await screen.findByText('QCV-0001');

    expect(screen.getByText(/does not belong to this laptop/)).toBeInTheDocument();
    expect(screen.getByText('Serial mismatch')).toBeInTheDocument();
    expect(screen.getByText('Untestable')).toBeInTheDocument();
  });

  it('shows the seal photograph, because there is no seal without one', async () => {
    mockJson(DETAIL);
    renderDetail();
    await screen.findByText('QCV-0001');

    expect(
      screen.getByAltText('Seal TRG-26HR-0004821 applied to the machine'),
    ).toHaveAttribute('src', '/f/seal.webp');
  });

  it('formats the visit fee in rupees rather than as a bare number', async () => {
    mockJson(DETAIL);
    renderDetail();
    await screen.findByText('QCV-0001');
    expect(screen.getByText(/₹1,500\.00/)).toBeInTheDocument();
  });
});

/* ==========================================================================
 * Scheduling
 * ======================================================================== */

const WEEK: ScheduleWeek = {
  from: '2026-08-24',
  to: '2026-08-25',
  dates: ['2026-08-24', '2026-08-25'],
  technicians: [
    {
      id: 'tech-1',
      name: 'R. Iyer',
      employeeCode: 'QC-004',
      zones: ['HR-NCR'],
      certifiedTools: ['DEVICESURE'],
      dailyCapacityUnits: 40,
      maxSitesPerDay: 3,
      days: [
        {
          date: '2026-08-24',
          availability: 'BOOKED',
          bookedUnits: 52,
          sites: 2,
          visits: [
            { id: 'v1', visitNumber: 'QCV-0001', vendorName: 'Northpoint Refurb', units: 52 },
          ],
        },
        { date: '2026-08-25', availability: 'LEAVE', bookedUnits: 0, sites: 0, visits: [] },
      ],
    },
  ],
  licence: [
    {
      providerCode: 'DEVICESURE',
      seats: 2,
      seatsUsedPerDate: { '2026-08-24': 3, '2026-08-25': 1 },
    },
  ],
};

describe('the scheduling calendar', () => {
  it('shouts about licence seats, because nothing on our side fixes that morning', async () => {
    mockJson(WEEK);
    inRouter(<ScheduleRoute />);
    await screen.findByText('Scheduling');

    const breach = screen.getByTestId('seat-breach');
    expect(within(breach).getByText(/3 technicians scheduled against 2 DEVICESURE seats/))
      .toBeInTheDocument();
    expect(within(breach).getByText(/enforced inside the tool, not by us/)).toBeInTheDocument();
  });

  it('marks a day booked past the technician daily capacity', async () => {
    mockJson(WEEK);
    inRouter(<ScheduleRoute />);
    await screen.findByText('Scheduling');

    // The day's state moved from the <td> to the cell's own element: the
    // scheduling grid is `DataBoard` now, and DataBoard owns its cells at three
    // densities. The state, its two tones and the words beside them are
    // unchanged — only the element carrying the attribute is.
    expect(document.querySelector('[data-state="over"]')).not.toBeNull();
    expect(screen.getByText('Over capacity — this day will not fit')).toBeInTheDocument();
    expect(screen.getByText('52/40 units')).toBeInTheDocument();
  });

  it('does not offer a day the technician is on leave as capacity', async () => {
    mockJson(WEEK);
    inRouter(<ScheduleRoute />);
    await screen.findByText('Scheduling');
    expect(document.querySelector('[data-state="unavailable"]')?.textContent).toBe('leave');
  });
});

/* ==========================================================================
 * Grade corrections
 * ======================================================================== */

const correction = (over: Partial<GradeCorrectionRow>): GradeCorrectionRow => ({
  id: 'gc-1',
  unitId: 'u-1',
  serialNumber: 'CND4233328',
  skuLabel: 'HP Victus 16',
  vendorName: 'Northpoint Refurb',
  gradeDeclared: 'A',
  gradeCorrected: 'B',
  reason: 'Declared 16 GB, measured 8 GB installed.',
  priceBefore: '42000.00',
  priceSuggested: '36500.00',
  vendorNotifiedAt: '2026-08-25T09:00:00Z',
  vendorResponse: null,
  vendorRespondedAt: null,
  autoAppliedAt: null,
  hoursUntilAutoApply: 40,
  countsAgainstAccuracy: true,
  ...over,
});

describe('the grade-correction queue', () => {
  it('sorts by how little time is left, and warns inside twelve hours', async () => {
    mockJson([
      correction({ id: 'later', serialNumber: 'LATER111', hoursUntilAutoApply: 40 }),
      correction({ id: 'soon', serialNumber: 'SOON1111', hoursUntilAutoApply: 3 }),
    ]);
    inRouter(<GradeCorrectionsRoute />);
    await screen.findByText('SOON1111');

    const serials = screen.getAllByRole('row').flatMap((r) => {
      const t = r.textContent ?? '';
      return t.includes('SOON1111') ? ['SOON'] : t.includes('LATER111') ? ['LATER'] : [];
    });
    expect(serials).toEqual(['SOON', 'LATER']);
    expect(screen.getByText('3h left to respond')).toBeInTheDocument();
    expect(screen.getByText(/1 auto-apply within 12 hours/)).toBeInTheDocument();
  });

  it('says the window has closed rather than showing a negative countdown', async () => {
    mockJson([correction({ hoursUntilAutoApply: -6 })]);
    inRouter(<GradeCorrectionsRoute />);
    await screen.findByText('CND4233328');
    expect(screen.getByText(/Window closed/)).toBeInTheDocument();
  });

  it('offers upholding only where the vendor actually disputed', async () => {
    mockJson([correction({ vendorResponse: null })]);
    inRouter(<GradeCorrectionsRoute />);
    await screen.findByText('CND4233328');

    expect(screen.getByText('Counts against accuracy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Uphold the dispute' })).not.toBeInTheDocument();
  });

  it('takes the correction off the scorecard when a dispute is upheld', async () => {
    const user = userEvent.setup();
    mockJson([correction({ vendorResponse: 'DISPUTE' })]);
    inRouter(<GradeCorrectionsRoute />);
    await screen.findByText('CND4233328');

    await user.click(screen.getByRole('button', { name: 'Uphold the dispute' }));
    expect(await screen.findByText('Does not count')).toBeInTheDocument();
  });

  it('shows both prices in rupees, not as raw decimals', async () => {
    mockJson([correction({})]);
    inRouter(<GradeCorrectionsRoute />);
    await screen.findByText('CND4233328');
    expect(screen.getByText('₹42,000.00')).toBeInTheDocument();
    expect(screen.getByText('₹36,500.00')).toBeInTheDocument();
  });
});

/* ==========================================================================
 * Sampling rules
 * ======================================================================== */

const RULES: SamplingRuleRow[] = [
  {
    id: 'sr-1',
    vendorTier: 'GOLD',
    minUnitsInspected: 2000,
    minPassRate: '97.00',
    minGradeAccuracy: '98.00',
    samplePct: '50.00',
    alwaysFullAboveValue: '5000000.00',
    effectiveFrom: '2026-01-01',
    isActive: true,
  },
];

describe('sampling rules', () => {
  it('refuses to let the riskiest vendors be sampled', () => {
    const problems = checkDraft({
      vendorTier: 'WATCHLIST',
      minUnitsInspected: '0',
      minPassRate: '0',
      minGradeAccuracy: '0',
      samplePct: '25',
      alwaysFullAboveValue: '',
      effectiveFrom: '2026-09-01',
    });
    expect(problems.join(' ')).toMatch(
      /stock nobody looked at, from the vendors most likely to need looking at/,
    );
  });

  it('accepts a full inspection on those tiers', () => {
    expect(
      checkDraft({
        vendorTier: 'BRONZE',
        minUnitsInspected: '0',
        minPassRate: '90',
        minGradeAccuracy: '90',
        samplePct: '100',
        alwaysFullAboveValue: '',
        effectiveFrom: '2026-09-01',
      }),
    ).toEqual([]);
  });

  it('needs a date the rule takes effect from, because history is re-derived against it', () => {
    const problems = checkDraft({
      vendorTier: 'GOLD',
      minUnitsInspected: '2000',
      minPassRate: '97',
      minGradeAccuracy: '98',
      samplePct: '50',
      alwaysFullAboveValue: '',
      effectiveFrom: '',
    });
    expect(problems.join(' ')).toMatch(/date it takes effect from/);
  });

  it('says the save will retire the rule currently in force, rather than editing it', async () => {
    mockJson(RULES);
    inRouter(<SamplingRulesRoute />);
    await screen.findByText('Sampling rules');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Vendor tier'), 'GOLD');
    expect(
      screen.getByText(/retire the GOLD rule that has been in force since 2026-01-01/),
    ).toBeInTheDocument();
  });

  it('shows what a tier had to earn next to what it gets', async () => {
    mockJson(RULES);
    inRouter(<SamplingRulesRoute />);
    await screen.findByText('Sampling rules');

    expect(screen.getByText(/2000 units · 97.00% pass · 98.00%/)).toBeInTheDocument();
    expect(screen.getByText('₹50,00,000.00')).toBeInTheDocument();
  });
});

/* ==========================================================================
 * Audit rechecks
 * ======================================================================== */

const AUDIT: AuditDashboard = {
  targetRecheckPct: 5,
  divergenceAlertPct: 3,
  rechecks: [
    {
      id: 'ar-1',
      serialNumber: 'CND4233328',
      originalTechnicianName: 'R. Iyer',
      auditorName: 'P. Nair',
      originalGrade: 'A_PLUS',
      recheckGrade: 'B',
      originalScore: 98,
      recheckScore: 74,
      divergence: { 'area.PORTS': { original: 'PASS', recheck: 'FAIL' } },
      createdAt: '2026-08-26',
    },
  ],
  technicians: [
    {
      technicianId: 'tech-1',
      name: 'R. Iyer',
      employeeCode: 'QC-004',
      unitsInspectedTotal: 900,
      rechecked: 35,
      diverged: 6,
      divergenceRate: '13.33',
      isActive: true,
    },
    {
      technicianId: 'tech-2',
      name: 'New Starter',
      employeeCode: 'QC-011',
      unitsInspectedTotal: 30,
      rechecked: 4,
      diverged: 2,
      divergenceRate: '50.00',
      isActive: true,
    },
  ],
};

describe('the divergence dashboard', () => {
  it('names the alert as a training problem and uses the configured threshold', async () => {
    mockJson(AUDIT);
    inRouter(<AuditRecheckRoute />);
    await screen.findByText('Audit rechecks');

    expect(screen.getByText(/Above the 3% alert line/)).toBeInTheDocument();
    expect(screen.getByText('13.33%')).toBeInTheDocument();
  });

  it('suppresses a rate computed on four rechecks', async () => {
    mockJson(AUDIT);
    inRouter(<AuditRecheckRoute />);
    await screen.findByText('Audit rechecks');

    // 50% over four rechecks is noise wearing a percentage sign, and it would
    // put the newest technician at the top of a list managers act on.
    expect(screen.queryByText('50.00%')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 4 rechecked')).toBeInTheDocument();
  });

  it('shows where the two reports actually disagreed', async () => {
    mockJson(AUDIT);
    inRouter(<AuditRecheckRoute />);
    await screen.findByText('Audit rechecks');

    expect(screen.getByText('A+ to B')).toBeInTheDocument();
    expect(screen.getByText('1 field disagreed')).toBeInTheDocument();
    expect(screen.getByText('area.PORTS')).toBeInTheDocument();
  });

  it('says when the recheck rate is under target', async () => {
    mockJson(AUDIT);
    inRouter(<AuditRecheckRoute />);
    await screen.findByText('Audit rechecks');
    expect(screen.getByText(/39 of 930 inspections rechecked, against a 5% target/))
      .toBeInTheDocument();
    expect(screen.getByText(/Below target/)).toBeInTheDocument();
  });
});
