import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { OpsOverviewRoute } from '../src/routes/OpsOverview';

/**
 * The five claims this screen makes that an integration test cannot see.
 *
 * All of them are the same rule wearing different clothes: **a value we have
 * not measured must never render as a passing one.** Archetype E is where that
 * rule is easiest to break, because a dashboard full of zeroes looks calm and a
 * dashboard full of "not measured" looks broken — and only one of them is true.
 */

const QUEUE = {
  key: 'onboarding-vendor',
  label: 'Vendor applications',
  href: '/kyc?view=vendor',
  description: 'Waiting on a decision from us.',
  count: 8,
  oldestWaitHours: 85,
  breachedCount: 6,
  slaHours: 48,
};

/** A queue nobody has ever committed a turnaround on. */
const UNTIMED_QUEUE = {
  ...QUEUE,
  key: 'qc-unstaffed',
  label: 'Inspections without a technician',
  href: '/qc/visits',
  count: 3,
  breachedCount: null,
  slaHours: null,
};

const METRIC = {
  key: 'partition-runway',
  label: 'Partition runway',
  value: 183,
  unit: 'days',
  hint: 'identity.audit_log is the tightest.',
  href: null,
};

function renderWith(body: {
  metrics?: unknown[];
  queues?: unknown[];
  gaps?: unknown[];
}): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ metrics: [], queues: [], gaps: [], ...body }),
  } as Response);

  render(
    <MemoryRouter initialEntries={['/overview']}>
      <OpsOverviewRoute />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('a queue with no promise is never shown as being on time', () => {
  it('says "Breaches not measured", not "Within SLA"', async () => {
    renderWith({ queues: [UNTIMED_QUEUE] });
    await screen.findByText('Inspections without a technician');

    expect(screen.getByText('Breaches not measured')).toBeInTheDocument();
    // The failure this prevents: an ops manager reading a green board over a
    // queue nobody has ever timed.
    expect(screen.queryByText('Within SLA')).not.toBeInTheDocument();
    expect(screen.queryByText(/past SLA/)).not.toBeInTheDocument();
  });

  it('does not print an SLA clause it was never given', async () => {
    renderWith({ queues: [UNTIMED_QUEUE] });
    const row = await screen.findByTestId('queue-list');
    // 48 and 24 are real promises elsewhere in this product. Neither may be
    // borrowed by a queue that has none, and the clause is absent entirely
    // rather than printed with a blank.
    expect(row.textContent).not.toMatch(/SLA\s*\d/);
  });

  it('says out loud how many of the queues carry no promise', async () => {
    renderWith({ queues: [QUEUE, UNTIMED_QUEUE] });
    await screen.findByText('Vendor applications');
    // The sentence is stitched from mono counts and prose, so match the header
    // as a whole rather than a fragment inside one span.
    expect(screen.getByRole('banner').textContent).toMatch(
      /1 of the 2 queues below carries no promise at all/,
    );
  });

  it('still prints the real promise where there is one', async () => {
    renderWith({ queues: [QUEUE] });
    await screen.findByText('Vendor applications');
    expect(screen.getByText(/48 h/)).toBeInTheDocument();
    // Twice on purpose: the header counts it and the queue row prints it, and
    // the two must be the same number.
    expect(screen.getAllByText('6').length).toBe(2);
    expect(screen.getByText(/past SLA/)).toBeInTheDocument();
  });
});

describe('a breach is ours, said in our own words', () => {
  it('names it as a promise we made, not a fact about the applicant', async () => {
    renderWith({ queues: [QUEUE] });
    await screen.findByText('Vendor applications');
    expect(screen.getByText(/past a promise we made/)).toBeInTheDocument();
  });

  it('says so plainly when nothing is late', async () => {
    renderWith({ queues: [{ ...QUEUE, breachedCount: 0 }] });
    await screen.findByText('Vendor applications');
    expect(screen.getByText(/Nothing here is past a promise we made/)).toBeInTheDocument();
  });
});

describe('a metric we could not measure', () => {
  it('renders "Not measured", never a zero', async () => {
    renderWith({ metrics: [{ ...METRIC, value: null }] });
    await screen.findByText('Partition runway');
    expect(screen.getByText('Not measured')).toBeInTheDocument();
    // "no partitioned table is registered" and "we run out today" are opposite
    // facts, and a zero would render them identically.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders a meaningful zero as a zero', async () => {
    renderWith({
      metrics: [
        {
          key: 'payout-runs',
          label: 'Payout runs executed',
          value: 0,
          unit: 'ever',
          hint: '17 payables have accrued behind it.',
          href: null,
        },
      ],
    });
    await screen.findByText('Payout runs executed');
    // `procurement.payout_run` exists, is readable, and has never had a row.
    // That is a zero, not an absence, and the hint carries what is stuck behind it.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/17 payables have accrued/)).toBeInTheDocument();
  });
});

describe('what this dashboard cannot tell you', () => {
  it('names the missing exceptions and the reason, rather than showing a zero', async () => {
    renderWith({
      // A metric alongside, because `gaps` is permission-gated the same way the
      // metrics are: a caller with gaps and nothing else cannot happen, and with
      // nothing at all the screen correctly shows "nothing here is yours".
      metrics: [METRIC],
      gaps: [
        {
          label: 'Shipments with a failed delivery attempt',
          reason: 'logistics.shipment has no writer anywhere in this product and zero rows.',
        },
      ],
    });
    await screen.findByText('Shipments with a failed delivery attempt');
    expect(screen.getByText(/has no writer anywhere in this product/)).toBeInTheDocument();
    // Named, never counted. A zero here would read as "none failed".
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('a slice with no queues in it', () => {
  it('says it is a role question, not an empty day', async () => {
    // A RIDER's real payload: the platform-wide runway, and nothing else. The
    // failure this prevents is somebody concluding the platform has no open
    // work because their account holds none of these permissions.
    renderWith({ metrics: [METRIC] });
    await screen.findByText('No queues in your slice');
    expect(screen.getByText(/ask an administrator which section/i)).toBeInTheDocument();
    // The one number that IS theirs still renders.
    expect(screen.getByText('183')).toBeInTheDocument();
  });
});
