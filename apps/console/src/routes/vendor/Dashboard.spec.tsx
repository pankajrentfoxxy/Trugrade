import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VendorDashboardRoute } from './Dashboard';

/**
 * The rule this screen exists to keep, asserted by trying to break it.
 *
 * **A queue with no promise must not borrow one.** `QueueItem.slaHours` is
 * optional so that a queue nobody has committed a turnaround for renders no SLA
 * clause at all — and `breachedCount` is then absent too, so it renders
 * "Breaches not measured" rather than the reassuring "Within SLA". The API sends
 * `null` for both; the route has to *drop* the fields rather than default them,
 * and the difference between `{}` and `{ slaHours: 0 }` is invisible in a type
 * check and very visible to a vendor.
 *
 * So the fixture below sends `null` and the test demands the absence. A test
 * that merely asserted the SLA renders for the queue that HAS one would pass
 * against a route that defaults the other to zero, which is the defect.
 */

const QUEUES = {
  gradeCorrections: { count: 4, oldestWaitHours: 70, breachedCount: 4, slaHours: 48 },
  /** Real work waiting, and genuinely no promise attached to it. */
  awaitingInspection: { count: 9, oldestWaitHours: 31, breachedCount: null, slaHours: null },
};

const STOCKED = {
  unitsEverListed: 46,
  unitsAwaitingQc: 9,
  unitsLive: 30,
  unitsSoldThisMonth: 4,
  unitsQcExpiring14d: 2,
  payoutsDue: '150000.00',
  payoutsDueOn: null,
  queues: QUEUES,
};

function mockDashboard(body: unknown, ok = true): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response),
  );
}

const draw = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <VendorDashboardRoute />
    </MemoryRouter>,
  );

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('a promise nobody made is never rendered', () => {
  it('prints the SLA for the queue that has one and no SLA clause for the queue that does not', async () => {
    mockDashboard(STOCKED);
    const { container } = draw();
    await screen.findByText('Grade corrections awaiting your answer');

    const rows = container.querySelectorAll('[data-testid="queue-list"] li');
    expect(rows).toHaveLength(2);

    // Worst first is the archetype, and the breached queue is the breached one.
    const [breached, unpromised] = [rows[0]!.textContent ?? '', rows[1]!.textContent ?? ''];
    expect(breached).toContain('Grade corrections awaiting your answer');
    expect(breached).toContain('SLA');
    expect(breached).toContain('4 past SLA');

    expect(unpromised).toContain('Machines awaiting inspection');
    // The whole point: no clause, and not a zero dressed as one.
    expect(unpromised).not.toContain('SLA 0');
    expect(unpromised).not.toContain('Within SLA');
    expect(unpromised).not.toContain('0 past SLA');
    expect(unpromised).toContain('Breaches not measured');
    // The wait IS measured here, so it must still show rather than being
    // dropped along with the promise.
    expect(unpromised).toContain('31');
  });

  it('offers no link that the listings board cannot actually reproduce', async () => {
    mockDashboard(STOCKED);
    const { container } = draw();
    await screen.findByText('Grade corrections awaiting your answer');

    // Three tiles deliberately carry no href, because no board answers them:
    // deliveries this month, units by QC expiry, and the payables statement that
    // is not built. A link to `/vendor/payables` or `?expiring=14` renders as a
    // working link and lands on a 404 or on the unfiltered catalogue.
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('payables'))).toBe(false);
    expect(hrefs.some((h) => h.includes('expiring'))).toBe(false);
    expect(hrefs.some((h) => h.includes('qc/corrections'))).toBe(false);
    // And the two that do exist, do exist.
    expect(hrefs).toContain('/vendor/listings?status=ACTIVE');
    // T31: `/vendor/corrections`, not `/vendor/listings?corrected=1`. That board
    // exists and is honest, but nothing on it could answer a correction — a queue
    // headed "awaiting your answer" landed you where you could not give one.
    expect(hrefs).toContain('/vendor/corrections');
  });

  it('says the payout date is unknown rather than inventing one', async () => {
    mockDashboard(STOCKED);
    draw();
    expect(await screen.findByText(/your payout cycle sets it/i)).toBeTruthy();
  });
});

describe('a vendor with nothing listed', () => {
  it('reads the three-step guide, not a grid of zeroes', async () => {
    mockDashboard({
      ...STOCKED,
      unitsEverListed: 0,
      unitsAwaitingQc: 0,
      unitsLive: 0,
      unitsSoldThisMonth: 0,
      unitsQcExpiring14d: 0,
      payoutsDue: '0.00',
      queues: {
        gradeCorrections: { count: 0, oldestWaitHours: null, breachedCount: 0, slaHours: 48 },
        awaitingInspection: {
          count: 0,
          oldestWaitHours: null,
          breachedCount: null,
          slaHours: null,
        },
      },
    });
    draw();
    expect(await screen.findByText('List your first stock')).toBeTruthy();
    expect(screen.queryByTestId('kpi-row')).toBeNull();
  });

  it('does NOT read the guide when the stock exists but all of it failed inspection', async () => {
    // Every acted-on number is zero and the vendor still has fourteen machines.
    // Inferring first-run from `live + awaiting + sold` told this vendor to list
    // their first stock, which is why `unitsEverListed` is on the payload.
    mockDashboard({
      ...STOCKED,
      unitsEverListed: 14,
      unitsAwaitingQc: 0,
      unitsLive: 0,
      unitsSoldThisMonth: 0,
      unitsQcExpiring14d: 0,
      payoutsDue: '0.00',
      queues: {
        gradeCorrections: { count: 0, oldestWaitHours: null, breachedCount: 0, slaHours: 48 },
        awaitingInspection: {
          count: 0,
          oldestWaitHours: null,
          breachedCount: null,
          slaHours: null,
        },
      },
    });
    draw();
    expect(await screen.findByTestId('kpi-row')).toBeTruthy();
    expect(screen.queryByText('List your first stock')).toBeNull();
    // No queue rows rather than two rows reading zero.
    expect(screen.queryByTestId('queue-list')).toBeNull();
    expect(screen.getByText(/Nothing is waiting on you/i)).toBeTruthy();
  });
});

describe('when the dashboard cannot be read', () => {
  it('says so and offers the board, rather than rendering zeroes', async () => {
    mockDashboard({ error: { message: 'no' } }, false);
    draw();
    expect(await screen.findByText('Your dashboard did not load')).toBeTruthy();
    expect(screen.queryByTestId('kpi-row')).toBeNull();
  });
});
