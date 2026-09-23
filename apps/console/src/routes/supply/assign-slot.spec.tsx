import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '../../lib/auth';
import Inspections from './Inspections';

/**
 * Booking a visit asks for the slot it is booked into.
 *
 * The dialog used to send `2026-09-19T10:00:00.000Z` for both ends, hard-coded
 * and unasked. `qc_visit.slot_from` is a `time` column and `slotTimeSchema`
 * wants `HH:MM`, so every assignment was refused with "Some of the details need
 * fixing" — a sentence naming nothing, because the answer was in `error.fields`
 * and this dialog only read `error.message`.
 */

interface Visit {
  id: string;
  visitNumber: string;
  status: string;
  vendorOrgId: string;
  vendorName: string | null;
  technicianId: string | null;
  technicianName: string | null;
  scheduledDate: string | null;
  slotFrom: string | null;
  requestedAt: string;
  waitingDays: number;
  unitsRequested: number;
  unitsInspected: number;
  unitsPassed: number;
  unitsFailed: number;
  unitsGradeCorrected: number;
  listingIds: string[];
}

const VISIT: Visit = {
  id: 'visit-1',
  visitNumber: 'QCV-20260903-433E6E96',
  status: 'REQUESTED',
  vendorOrgId: 'org-1',
  vendorName: 'Northgate IT Assets',
  technicianId: null,
  technicianName: null,
  scheduledDate: null,
  slotFrom: null,
  requestedAt: '2026-09-03T10:00:00Z',
  waitingDays: 15,
  unitsRequested: 12,
  unitsInspected: 0,
  unitsPassed: 0,
  unitsFailed: 0,
  unitsGradeCorrected: 0,
  listingIds: [],
};

const LOADS = [{ technicianId: 'tech-1', name: 'Rakesh Kumar', byDay: {}, openVisits: 1 }];

let scheduled: { url: string; body: Record<string, unknown> }[] = [];
let refuse: { status: number; body: unknown } | null = null;
/** What the board serves. A successful booking rewrites it, as the server would. */
let row: Visit = VISIT;
let boardFetches = 0;

function mockApi(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const answer = (body: unknown, ok = true, status = 200): Promise<Response> =>
      Promise.resolve({ ok, status, json: async () => body } as Response);

    if (url.includes('/api/auth/session')) {
      return answer({
        userId: 'u1',
        orgId: 'o1',
        orgType: 'PLATFORM',
        roles: ['OPS_MANAGER'],
        permissions: ['qc.visit.schedule', 'qc.visit.read'],
        mfaRequired: false,
        fullName: 'Anand Krishnan',
        email: 'ops@trugrade.in',
      });
    }
    if (url.includes('/schedule')) {
      scheduled.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      if (refuse) return answer(refuse.body, false, refuse.status);
      row = {
        ...VISIT,
        status: 'TECH_ASSIGNED',
        technicianId: 'tech-1',
        technicianName: 'Rakesh Kumar',
        scheduledDate: '2026-09-19',
      };
      return answer({ id: 'visit-1' });
    }
    // Only once the dialog is open; until then the hook is passed '' and the
    // browser's own answer to that is not JSON, so nothing lands in `data`.
    if (url.includes('/workload')) return answer(LOADS);
    if (url.includes('/api/qc/inspections')) {
      boardFetches += 1;
      return answer({
        rows: [row],
        page: 1,
        per: 40,
        total: 1,
        pages: 1,
        grandTotal: 1,
        views: [{ key: 'unscheduled', label: 'Unscheduled', count: 1 }],
        facets: { technician: [] },
      });
    }
    return answer(null);
  });
}

async function openAssignDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/supply/inspections']}>
        <Inspections />
      </MemoryRouter>
    </AuthProvider>,
  );
  await screen.findByText('QCV-20260903-433E6E96');
  // The board's own record affordance — a button, because a clickable table row
  // is unreachable by keyboard.
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await user.click(await screen.findByRole('button', { name: 'Assign technician' }));
  await screen.findByText('Assign a technician');
}

beforeEach(() => {
  scheduled = [];
  refuse = null;
  row = VISIT;
  boardFetches = 0;
  mockApi();
});
afterEach(() => vi.restoreAllMocks());

describe('assigning a technician', () => {
  it('asks for the slot, and sends it as the HH:MM the endpoint accepts', async () => {
    const user = userEvent.setup();
    await openAssignDialog(user);

    const from = screen.getByLabelText(/Slot from/i) as HTMLInputElement;
    const to = screen.getByLabelText(/Slot to/i) as HTMLInputElement;
    expect(from.type).toBe('time');
    expect(to.type).toBe('time');

    await user.clear(from);
    await user.type(from, '09:30');
    await user.clear(to);
    await user.type(to, '12:45');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.body).toMatchObject({
      technicianId: 'tech-1',
      slotFrom: '09:30',
      slotTo: '12:45',
    });
    // The shape the DTO refused: an ISO instant where a wall-clock time belongs.
    expect(String(scheduled[0]!.body.slotFrom)).not.toContain('T');
  });

  it('refuses a slot that ends before it starts, without spending a round trip', async () => {
    const user = userEvent.setup();
    await openAssignDialog(user);

    await user.clear(screen.getByLabelText(/Slot from/i));
    await user.type(screen.getByLabelText(/Slot from/i), '14:00');
    await user.clear(screen.getByLabelText(/Slot to/i));
    await user.type(screen.getByLabelText(/Slot to/i), '11:00');

    // Said on the field as it is typed, before anything is pressed.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'End time must be later than the start time.',
    );
    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(assign).toHaveAttribute('aria-disabled', 'true');

    await user.click(assign);
    expect(scheduled).toHaveLength(0);
  });

  it('refuses a zero-length slot, in either notation', async () => {
    const user = userEvent.setup();
    await openAssignDialog(user);

    // Both ends the same instant: not a slot anybody can attend.
    await user.clear(screen.getByLabelText(/Slot to/i));
    await user.type(screen.getByLabelText(/Slot to/i), '10:00');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(scheduled).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'End time must be later than the start time.',
    );
  });

  it('names the field a refusal blamed, rather than "some of the details"', async () => {
    const user = userEvent.setup();
    refuse = {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION',
          message: 'Some of the details need fixing.',
          fields: { slotFrom: 'Expected a time like 09:30.' },
        },
      },
    };
    await openAssignDialog(user);
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Expected a time like 09:30.');
  });

  /**
   * The row under the drawer used to keep the state from before the booking.
   * The assignment goes through `/qc/visits/:id/schedule`, the board was never
   * fetched again, and the operator's next "Open" showed "Unassigned" and the
   * same "Assign technician" button for a visit they had just booked.
   */
  it('refetches the board after a booking, so the row and the record show who', async () => {
    const user = userEvent.setup();
    await openAssignDialog(user);
    expect(boardFetches).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Assign' }));

    // The name lands in the Technician column without a page reload …
    expect(await screen.findByText('Rakesh Kumar')).toBeInTheDocument();
    expect(boardFetches).toBe(2);
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();

    // … and the reopened record knows it is booked.
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('button', { name: 'Reassign' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign technician' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Rakesh Kumar').length).toBeGreaterThanOrEqual(2);
  });
});
