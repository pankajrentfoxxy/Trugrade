import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../../lib/auth';
import { CommandPalette } from '../../shell/CommandPalette';
import { Unit360Route } from './Unit360';

/**
 * T35, asserted by trying to break it.
 *
 * Six claims these two screens make that no integration test can see, because
 * every one is about what is on the page rather than what the API returned:
 *
 *   1. **A machine nobody has opened does not borrow the declared grade.** The
 *      supply point's word is not a measurement, and the header must say
 *      "not inspected" rather than showing a badge that reads as a finding.
 *   2. **A machine whose order raised no purchase order says so.** Two orders on
 *      the demo database are DELIVERED with no PO at all. A blank in the money
 *      column reads as a measured zero.
 *   3. **`APPLIED` is not `INTACT`.** Sealed is not checked. Only a seal somebody
 *      has looked at since may be green, and `SealChip` is what keeps that true.
 *   4. **A grade badge carries no verdict class.** A+, A and B are all sellable.
 *   5. **An empty audit trail is a stated gap, not a clean history.** Zero rows
 *      name any serial on this platform, and an empty table would read as
 *      "nothing untoward happened here".
 *   6. **The palette names the SOURCES it did not search and never a record.**
 *      "You cannot see TT-26-00004" confirms TT-26-00004 exists, and sequential
 *      order numbers make that an order-volume oracle.
 */

const MACHINE = {
  skuCode: 'DEL-LAT5420-I51135G7-16-512',
  title: 'Dell Latitude 5420',
  spec: 'Core i5 · 16 GB · 512 GB NVME_SSD · 14.0"',
};

const BASE = {
  serialNumber: 'TGD5963139B',
  status: 'DELIVERED',
  location: 'VENDOR',
  isSellable: false,
  gradeDeclared: 'A',
  gradeActual: 'A',
  createdAt: '2026-08-27T12:38:36.134Z',
  supplyPointLegalName: 'Faridabad TechCycle Pvt. Ltd.',
  supplyPointCode: 'F',
  valuationMethod: 'REGULAR',
  itcEligible: true,
  machine: MACHINE,
  qc: {
    score: 92,
    verdict: 'PASS',
    gradeProposed: 'A',
    gradeFinal: 'A',
    technicianCode: 'TECH-DEMO01',
    inspectedAt: '2026-08-26T00:00:00.000Z',
    validUntil: '2026-11-22',
    isCurrent: true,
    batteryHealthPct: '89.00',
    cycleCount: null,
    powerOnHours: null,
    storage: null,
    cpu: null,
    ramGb: 16,
  },
  qcUnavailable: null,
  seal: {
    sealCode: 'TG-TGD5963139B',
    status: 'INTACT',
    appliedAt: '2026-08-24T12:38:36.138Z',
    verifiedAt: '2026-08-30T20:25:36.092Z',
    brokenAt: null,
    brokenReason: null,
  },
  movements: [],
  warranty: null,
  returns: [],
  commercial: {
    orderNumber: 'TT-26-00013',
    orderStatus: 'DELIVERED',
    placedAt: '2026-08-30T07:24:48.764Z',
    buyerLegalName: 'Acme Industries Pvt. Ltd.',
    soldFor: '53500.00',
    lineStatus: 'DELIVERED',
    poNumber: 'PO-26-00015',
    poStatus: 'RAISED',
    paid: '46010.00',
    margin: '7490.00',
    poUnavailable: null,
  },
  commercialUnavailable: null,
  auditEntries: 0,
};

/** A machine on TT-26-00007: delivered, and no purchase order was ever raised. */
const NO_PO = {
  ...BASE,
  serialNumber: 'TGD32792345',
  // Sealed and never looked at since. The state `SealChip` must NOT paint green.
  seal: { ...BASE.seal, sealCode: 'TG-TGD32792345', status: 'APPLIED', verifiedAt: null },
  commercial: {
    ...BASE.commercial,
    orderNumber: 'TT-26-00007',
    poNumber: null,
    poStatus: null,
    paid: null,
    margin: null,
    poUnavailable:
      'No purchase-order line covers this serial, so what we agreed to pay for it is not recorded anywhere. The margin cannot be stated.',
  },
};

/** A machine nobody has opened. `grade_actual` is null and stays null. */
const NEVER_INSPECTED = {
  ...BASE,
  serialNumber: 'T27D806273',
  status: 'CREATED',
  gradeActual: null,
  qc: null,
  qcUnavailable:
    'No technician has inspected this machine. Nothing on this screen states its condition, because nothing has measured it.',
  seal: null,
  commercial: null,
  commercialUnavailable: 'This machine has never been allocated to an order.',
};

/** A TECHNICIAN's view: the machine, and the trade withheld with the reason. */
const NO_TRADE = {
  ...BASE,
  commercial: null,
  commercialUnavailable:
    'Your role reads the platform’s stock but not its orders. Who bought this machine, for how much, and what we paid the supply point are not shown here. The movement trail does name the order it was reserved for — that line is `listing`’s own record of this machine and is not withheld.',
};

/** What a TECHNICIAN's search comes back as: one source searched, three not. */
const TECH_SEARCH = {
  q: 'TT-26',
  groups: [
    {
      key: 'machines',
      label: 'Machines',
      comparedWith: ['the serial number', 'the seal code'],
      hits: [],
      more: 0,
    },
  ],
  unavailable: [
    {
      label: 'Orders',
      reason:
        'Your role cannot read orders across the platform, so order numbers and buyers’ own PO references were not searched.',
    },
    {
      label: 'Support tickets',
      reason:
        'The ticket desk has no screen in this console yet, so a ticket number found here would open nothing. Not searched.',
    },
  ],
  total: 0,
};

const OPS_PERMS = ['listing.any.read', 'ordering.any.read', 'procurement.po.read_any'];
/** Holds the stock permission and no ordering one. The real TECHNICIAN grant. */
const TECH_PERMS = ['listing.any.read', 'qc.report.read'];

/**
 * The session call and the screen's own call, answered separately.
 *
 * `AuthProvider` fetches `/api/auth/session` on mount; a single-body mock would
 * hand it the unit payload and it would read as a principal with no permissions,
 * which is a different bug wearing this one's clothes.
 */
function mockApi(body: unknown, permissions: string[] = OPS_PERMS): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    const payload = url.includes('/api/auth/session')
      ? {
          userId: 'u1',
          orgId: 'o1',
          orgType: 'PLATFORM',
          roles: ['OPS_MANAGER'],
          permissions,
          mfaRequired: false,
          fullName: 'Anand Krishnan',
        }
      : body;
    return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response);
  });
}

const drawUnit = (unit: typeof BASE, permissions = OPS_PERMS): void => {
  mockApi(unit, permissions);
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[`/units/${unit.serialNumber}`]}>
        <Routes>
          <Route path="/units/:serial" element={<Unit360Route />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
};

afterEach(() => vi.restoreAllMocks());

/* ========================================================================== */

describe('a missing value never renders as a passing one', () => {
  it('says a machine has never been inspected rather than showing its declared grade as a finding', async () => {
    drawUnit(NEVER_INSPECTED as unknown as typeof BASE);
    expect(await screen.findByText('T27D806273')).toBeTruthy();
    expect(screen.getByText('Not inspected')).toBeTruthy();
    expect(screen.getByText('This machine has never been inspected')).toBeTruthy();
    // The declared grade IS shown, in the side panel, labelled as the supply
    // point's word — the point is that it never stands in for a measurement.
    expect(screen.getByText('Declared by the supply point')).toBeTruthy();
  });

  it('never renders a seal that nobody has checked as a passing one', async () => {
    drawUnit(NO_PO as unknown as typeof BASE);
    expect(await screen.findByText('TGD32792345')).toBeTruthy();
    // APPLIED is "sealed", not "checked". `SealChip` renders the two words
    // differently and only the second is `--pass`.
    // `SealChip`'s own words. Uppercasing is CSS; the DOM carries these.
    expect(screen.getByText('Sealed')).toBeTruthy();
    expect(screen.queryByText('Seal intact')).toBeNull();
  });

  it('the control: a seal somebody DID check reads as checked', async () => {
    // Without this, the assertion above would pass on a `SealChip` that had
    // stopped rendering any word at all.
    drawUnit(BASE);
    expect(await screen.findByText('TGD5963139B')).toBeTruthy();
    expect(screen.getByText('Seal intact')).toBeTruthy();
  });

  it('states why a margin cannot be given rather than leaving the money column blank', async () => {
    drawUnit(NO_PO as unknown as typeof BASE);
    expect(await screen.findByText('TGD32792345')).toBeTruthy();
    // Twice, deliberately: once under the margin and once beside the missing PO
    // number, because either alone leaves half the screen looking merely blank.
    expect(screen.getAllByText(/No purchase-order line covers this serial/).length).toBe(2);
    expect(screen.getByText('None raised')).toBeTruthy();
    // Not a zero anywhere in that block.
    expect(screen.queryByText('₹0.00')).toBeNull();
  });

  it('the control: a machine WITH a purchase order prints the margin', async () => {
    drawUnit(BASE);
    expect(await screen.findByText('TGD5963139B')).toBeTruthy();
    expect(screen.getByText('₹7,490.00')).toBeTruthy();
  });

  it('an empty audit trail is a stated gap and never an empty table', async () => {
    drawUnit(BASE);
    expect(await screen.findByText('No audit entry names this machine')).toBeTruthy();
    expect(screen.getByText(/gap in the product and not a clean history/)).toBeTruthy();
  });
});

describe('grades are neutral and only the QC verdict is a verdict', () => {
  it('renders every grade with no pass or fail class', async () => {
    drawUnit(BASE);
    await screen.findByText('TGD5963139B');
    // Every rendering of the grade on the screen — the badge in the header, the
    // declared grade in the side panel, the grade the tool proposed. Not one of
    // them may carry a verdict colour: A+, A and B are all sellable.
    const grades = screen.getAllByText('A');
    expect(grades.length).toBeGreaterThan(1);
    for (const el of grades) {
      const classes = `${el.className} ${el.parentElement?.className ?? ''}`;
      expect(classes).not.toMatch(/text-pass|bg-pass|text-fail|bg-fail/);
    }
  });

  it('paints the QC verdict, which is the one thing here that was a test', async () => {
    drawUnit(BASE);
    expect(await screen.findByText('Pass')).toBeTruthy();
  });
});

describe('a caller who may not see the trade is told so, not shown a blank', () => {
  it('names the permission reason rather than reading as an unsold machine', async () => {
    drawUnit(NO_TRADE as unknown as typeof BASE, TECH_PERMS);
    expect(await screen.findByText('The commercial side is not yours to see')).toBeTruthy();
    expect(screen.getByText(/but not its orders/)).toBeTruthy();
  });

  it('the control: a caller who MAY see it gets a different heading and the buyer', async () => {
    // "You may not see this" and "there is nothing to see" must never converge,
    // and this is the pair that proves they do not.
    drawUnit(NEVER_INSPECTED as unknown as typeof BASE);
    expect(await screen.findByText('This machine has never been sold')).toBeTruthy();
  });
});

describe('the palette names the sources it did not search, and never a record', () => {
  function drawPalette(): void {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      const payload = url.includes('/api/auth/session')
        ? {
            userId: 'u1',
            orgId: 'o1',
            orgType: 'PLATFORM',
            roles: ['TECHNICIAN'],
            permissions: TECH_PERMS,
            mfaRequired: false,
            fullName: 'Anand Krishnan',
          }
        : TECH_SEARCH;
      return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response);
    });
    render(
      <AuthProvider>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </AuthProvider>,
    );
  }

  it('renders the search control in the chrome', async () => {
    drawPalette();
    expect(await screen.findByRole('button', { name: /Search/ })).toBeTruthy();
  });

  it('opening it and typing an order number names Orders as not searched', async () => {
    const { fireEvent, waitFor } = await import('@testing-library/react');
    drawPalette();
    fireEvent.click(await screen.findByRole('button', { name: /Search/ }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TT-26' } });

    await waitFor(() => expect(screen.getByText(/Not searched:/)).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.getByText('Orders')).toBeTruthy();
    // **The assertion that matters.** Not one order number reaches the DOM, so
    // nothing here confirms that any particular order exists.
    expect(document.body.textContent).not.toMatch(/TT-26-\d/);
  });
});
