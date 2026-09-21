/**
 * The tracking page's timeline.
 *
 * Three things a buyer relies on: the steps read oldest first with the latest
 * marked current; a step that happened without a recorded instant says so
 * rather than borrowing a time; and nothing the consignment carries — not a
 * status enum, not the word "vendor" — reaches the screen.
 */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Tracking } from './Tracking';
import type { DeliveryConsignment, DeliveryView } from '../delivery/api';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock('../delivery/api', () => ({
  ...jest.requireActual('../delivery/api'),
  getDelivery: jest.fn(),
}));

import { getDelivery } from '../delivery/api';
const mockGetDelivery = getDelivery as jest.MockedFunction<typeof getDelivery>;

const consignment = (over: Partial<DeliveryConsignment> = {}): DeliveryConsignment => ({
  index: 1,
  label: 'Delivery 1 of 1 · Supply Point A · Gurugram',
  status: 'VENDOR_ACCEPTED',
  deliveredAt: null,
  window: null,
  machines: [],
  receiptConfirmedAt: null,
  blockedReason: null,
  timeline: [
    { stage: 'PLACED', label: 'Order placed', at: '2026-09-14T06:33:31.685Z', state: 'done' },
    { stage: 'CONFIRMED', label: 'Confirmed', at: '2026-09-14T06:33:31.685Z', state: 'done' },
    {
      stage: 'PREPARING',
      label: 'Being prepared at the supply point',
      at: null,
      state: 'current',
    },
    { stage: 'DISPATCHED', label: 'On its way', at: null, state: 'upcoming' },
    { stage: 'DELIVERED', label: 'Delivered', at: null, state: 'upcoming' },
    { stage: 'RECEIVED', label: 'Receipt confirmed', at: null, state: 'upcoming' },
  ],
  ...over,
});

const view = (consignments: DeliveryConsignment[]): DeliveryView => ({
  orderNumber: 'TT-26-00028',
  status: 'CONFIRMED',
  asOf: '2026-09-21T10:00:00.000Z',
  windowHours: 48,
  consignments,
});

afterEach(() => {
  cleanup();
  mockGetDelivery.mockReset();
});

describe('Tracking timeline', () => {
  it('draws what happened oldest first, marks the latest current, and lists the rest as still to come', async () => {
    mockGetDelivery.mockResolvedValue({ ok: true, data: view([consignment()]) });
    render(<Tracking orderNumber="TT-26-00028" />);

    const timeline = await screen.findByRole('list', {
      name: 'Delivery 1 of 1 · Supply Point A · Gurugram timeline',
    });
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Order placed'),
      expect.stringContaining('Confirmed'),
      expect.stringContaining('Being prepared at the supply point'),
    ]);
    expect(rows[2]).toHaveTextContent('Current');
    expect(rows[0]).not.toHaveTextContent('Current');

    const next = screen.getByRole('list', { name: 'Still to come' });
    expect(within(next).getAllByRole('listitem').map((r) => r.textContent)).toEqual([
      'On its way',
      'Delivered',
      'Receipt confirmed',
    ]);
  });

  it('a step that happened with no recorded instant says so instead of showing a time', async () => {
    mockGetDelivery.mockResolvedValue({ ok: true, data: view([consignment()]) });
    render(<Tracking orderNumber="TT-26-00028" />);

    const timeline = await screen.findByRole('list', { name: /timeline$/ });
    const preparing = within(timeline).getAllByRole('listitem')[2]!;
    expect(preparing).toHaveTextContent('Time not recorded');
    expect(within(preparing).getByText('Time not recorded')).not.toHaveAttribute('datetime');
  });

  it('the pill names the timeline\'s current step, not the consignment row that lags behind it', async () => {
    // TT-26-00028 on the dev database: the row still says CONFIRMED, the events say acknowledged.
    mockGetDelivery.mockResolvedValue({ ok: true, data: view([consignment({ status: 'CONFIRMED' })]) });
    const { container } = render(<Tracking orderNumber="TT-26-00028" />);
    await screen.findByText('Delivery 1 of 1 · Supply Point A · Gurugram');
    expect(container.querySelector('.dvconshead')).toHaveTextContent('Being prepared at the supply point');
    expect(container.querySelector('.dvconshead')).not.toHaveTextContent('Confirmed');
  });

  it('never prints a status enum: with no timeline the pill still has buyer words, including for states it does not know', async () => {
    mockGetDelivery.mockResolvedValue({
      ok: true,
      data: view([
        consignment({ index: 1, status: 'VENDOR_ACCEPTED', timeline: [], label: 'Delivery 1 of 2 · Supply Point A · Gurugram' }),
        consignment({ index: 2, status: 'SOMETHING_NEW', timeline: [], label: 'Delivery 2 of 2 · Supply Point B · Noida' }),
      ]),
    });
    render(<Tracking orderNumber="TT-26-00028" />);

    await screen.findByText('Delivery 1 of 2 · Supply Point A · Gurugram');
    expect(screen.getByText('Being prepared')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/VENDOR|SOMETHING_NEW/);
  });

  it('a cancelled consignment ends its rail on the cancellation and lists nothing to come', async () => {
    mockGetDelivery.mockResolvedValue({
      ok: true,
      data: view([
        consignment({
          status: 'CANCELLED',
          timeline: [
            { stage: 'PLACED', label: 'Order placed', at: '2026-09-14T06:33:31.685Z', state: 'done' },
            { stage: 'CANCELLED', label: 'Cancelled', at: '2026-09-14T12:00:00.000Z', state: 'current' },
          ],
        }),
      ]),
    });
    render(<Tracking orderNumber="TT-26-00028" />);

    const timeline = await screen.findByRole('list', { name: /timeline$/ });
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Cancelled');
    expect(rows[1]).toHaveTextContent('Current');
    expect(screen.queryByRole('list', { name: 'Still to come' })).not.toBeInTheDocument();
  });

  it('says what went wrong when the order does not load', async () => {
    mockGetDelivery.mockResolvedValue({ ok: false, code: 'NETWORK', message: 'x' } as never);
    render(<Tracking orderNumber="TT-26-00028" />);
    expect(await screen.findByText('This order did not load')).toBeInTheDocument();
    expect(screen.getByText(/We could not reach your order just now/)).toBeInTheDocument();
  });
});
