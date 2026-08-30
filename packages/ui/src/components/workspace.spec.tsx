/**
 * Archetype E — KpiRow and QueueList.
 *
 * `byBreach` is tested as a pure function because the ordering is the only part
 * of a workspace with a wrong answer, and "ordered by SLA breach" is the whole
 * archetype: a dashboard that lists its queues alphabetically is a list of
 * links.
 */

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { KpiRow, QueueList, byBreach, type Kpi, type QueueItem } from './workspace';

const KPIS: Kpi[] = [
  { key: 'orders', label: 'Orders today', value: 42, unit: 'orders', href: '/admin/orders' },
  {
    key: 'accuracy',
    label: 'Grade accuracy',
    pct: 98,
    denominator: 412,
    denominatorLabel: 'units inspected',
  },
  { key: 'ontime', label: 'On-time dispatch', pct: null, denominator: 118, denominatorLabel: 'orders' },
  { key: 'nps', label: 'Buyer NPS', value: null },
];

describe('KpiRow', () => {
  it('carries the denominator with every percentage', () => {
    render(<KpiRow items={KPIS} label="This week" />);
    expect(screen.getByText('98%')).toHaveClass('tnum');
    expect(screen.getByText('412 units inspected')).toBeInTheDocument();
  });

  it('renders an unmeasured metric as "Not measured", never as a zero', () => {
    render(<KpiRow items={KPIS} label="This week" />);
    const missing = screen.getAllByText('Not measured');
    expect(missing).toHaveLength(2);
    for (const node of missing) expect(node).toHaveClass('text-ink-4');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('keeps the denominator on a percentage even when the reading is missing', () => {
    render(<KpiRow items={KPIS} label="This week" />);
    // "no reading over 118 orders" is a more useful admission than "no reading".
    expect(screen.getByText('118 orders')).toBeInTheDocument();
  });

  it('drills into a board when the caller gives it somewhere to go', () => {
    render(<KpiRow items={KPIS} label="This week" />);
    expect(screen.getByRole('link', { name: /Orders today/ })).toHaveAttribute(
      'href',
      '/admin/orders',
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(<KpiRow items={KPIS} label="This week" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

const q = (over: Partial<QueueItem> & Pick<QueueItem, 'key'>): QueueItem => ({
  label: over.key,
  href: `/admin/${over.key}`,
  count: 1,
  slaHours: 48,
  ...over,
});

describe('byBreach', () => {
  it('puts the most breached queue first', () => {
    const sorted = [q({ key: 'a', breachedCount: 0 }), q({ key: 'b', breachedCount: 7 })].sort(
      byBreach,
    );
    expect(sorted.map((i) => i.key)).toEqual(['b', 'a']);
  });

  it('breaks a tie on the oldest waiting item, then on size', () => {
    const sorted = [
      q({ key: 'small', breachedCount: 2, oldestWaitHours: 60, count: 3 }),
      q({ key: 'big', breachedCount: 2, oldestWaitHours: 60, count: 30 }),
      q({ key: 'oldest', breachedCount: 2, oldestWaitHours: 91, count: 1 }),
    ].sort(byBreach);
    expect(sorted.map((i) => i.key)).toEqual(['oldest', 'big', 'small']);
  });

  it('sorts an unmeasured queue last rather than treating it as healthy', () => {
    const sorted = [
      q({ key: 'unknown' }),
      q({ key: 'clean', breachedCount: 0 }),
      q({ key: 'burning', breachedCount: 4 }),
    ].sort(byBreach);
    // Unmeasured is not evidence of a breach, so it does not outrank a queue we
    // know is on fire — but nor is it evidence of health, so it goes below the
    // one we have actually checked.
    expect(sorted.map((i) => i.key)).toEqual(['burning', 'clean', 'unknown']);
  });
});

const QUEUES: QueueItem[] = [
  q({ key: 'catalog', label: 'Catalog requests', breachedCount: 0, oldestWaitHours: 6, count: 9 }),
  q({
    key: 'onboarding',
    label: 'Onboarding review',
    breachedCount: 12,
    oldestWaitHours: 61,
    count: 34,
  }),
  q({ key: 'returns', label: 'Return claims', count: 5 }),
];

describe('QueueList', () => {
  it('orders by breach itself, so no caller can get the archetype wrong', () => {
    render(<QueueList items={QUEUES} label="Queues" />);
    const rendered = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rendered[0]).toContain('Onboarding review');
    expect(rendered[1]).toContain('Catalog requests');
    expect(rendered[2]).toContain('Return claims');
  });

  it('states the breach in words, not only with a red edge', () => {
    render(<QueueList items={QUEUES} label="Queues" />);
    const breached = screen.getByRole('link', { name: /Onboarding review/ });
    expect(breached).toHaveTextContent('12 past SLA');
    expect(breached).toHaveAttribute('data-breached', 'true');
    expect(within(breached).getByText('61 h')).toHaveClass('tnum');
  });

  it('admits when the breach count was never measured', () => {
    render(<QueueList items={QUEUES} label="Queues" />);
    const unknown = screen.getByRole('link', { name: /Return claims/ });
    expect(unknown).toHaveTextContent('Breaches not measured');
    expect(unknown).toHaveTextContent('Oldest not measured');
    expect(unknown).not.toHaveTextContent('Within SLA');
  });

  it('has no axe violations', async () => {
    const { container } = render(<QueueList items={QUEUES} label="Queues" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('a queue with no promise', () => {
  // The failure this guards is inventing one. A default SLA rendered beside a
  // number nobody committed to reads as a commitment, which is the same defect
  // as showing an unmeasured value as a passing one.
  it('says nothing about an SLA rather than borrowing a default', () => {
    const { slaHours: _omitted, ...noPromise } = q({ key: 'unpromised' });
    render(<QueueList items={[noPromise]} label="Queues" />);
    expect(screen.getByText('unpromised')).toBeInTheDocument();
    expect(screen.queryByText(/SLA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b(24|48)\s*h\b/)).not.toBeInTheDocument();
  });
});
