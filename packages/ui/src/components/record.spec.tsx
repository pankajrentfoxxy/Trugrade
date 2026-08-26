/**
 * Archetype C — RecordHeader, SidePanel, Timeline, AddressCard.
 *
 * Two assertions here are the ones that matter, and both are about a missing
 * value never rendering as a passing one: a timeline event with no recorded
 * reason must print no reason at all, and an address with no gate instructions
 * must say "Not provided" rather than leaving a blank line that reads as "no
 * special instructions".
 */

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AddressCard, RecordHeader, SidePanel, Timeline, type Address } from './record';
import { StatusPill } from './primitives';

describe('RecordHeader', () => {
  it('makes the record itself the page heading, not the section name', () => {
    render(<RecordHeader title="Latitude 5320" subtitle="i5-1135G7 · 16 GB · 512 GB" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Latitude 5320');
  });

  it('renders identifiers as mono term/value pairs', () => {
    render(
      <RecordHeader
        title="Order TG-2026-004112"
        identifiers={[
          { label: 'Order', value: 'TG-2026-004112' },
          { label: 'Serial', value: 'CN0X1Y2Z3', href: '/unit/CN0X1Y2Z3' },
        ]}
      />,
    );
    const list = screen.getByTestId('record-identifiers');
    expect(within(list).getByText('TG-2026-004112')).toHaveClass('tnum');
    expect(within(list).getByRole('link', { name: 'CN0X1Y2Z3' })).toHaveAttribute(
      'href',
      '/unit/CN0X1Y2Z3',
    );
  });

  it('omits the identifier list entirely when there is nothing to identify', () => {
    render(<RecordHeader title="New listing" />);
    expect(screen.queryByTestId('record-identifiers')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <RecordHeader
        title="Latitude 5320"
        status={<StatusPill tone="pass" label="Passed" />}
        identifiers={[{ label: 'Serial', value: 'CN0X1Y2Z3' }]}
        action={<button type="button">Add to cart</button>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SidePanel', () => {
  it('is a labelled landmark, so it can be jumped to and skipped past', () => {
    render(
      <SidePanel title="Actions" footnote="Withdrawing releases the 20-minute stock hold.">
        <button type="button">Withdraw</button>
      </SidePanel>,
    );
    const panel = screen.getByRole('complementary', { name: 'Actions' });
    expect(within(panel).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('Withdrawing releases the 20-minute stock hold.');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <SidePanel title="Actions" description="What you can do with this application.">
        <button type="button">Approve</button>
      </SidePanel>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const EVENTS = [
  {
    key: 'e3',
    action: 'Grade corrected to B',
    actor: 'Priya N., inspector',
    at: '9 Aug 2026, 11:20',
    dateTime: '2026-08-09T11:20:00+05:30',
    reason: 'Lid dent 12 mm, not declared.',
    current: true,
  },
  {
    key: 'e2',
    action: 'Inspection completed',
    actor: 'Trugrade',
    at: '9 Aug 2026, 10:02',
    dateTime: '2026-08-09T10:02:00+05:30',
  },
  { key: 'e1', action: 'Listing created', actor: 'Supply Point A', at: '4 Aug 2026, 18:04' },
];

describe('Timeline', () => {
  it('prints the recorded reason, and nothing at all where there is none', () => {
    render(<Timeline events={EVENTS} label="Unit history" />);
    expect(screen.getByText('Lid dent 12 mm, not declared.')).toBeInTheDocument();
    // One event has a reason. An audit trail that invented "not specified" for
    // the other two would be reporting a fact nobody recorded.
    expect(screen.getAllByText('Reason')).toHaveLength(1);
  });

  it('names the actor and machine-readable time on every event', () => {
    const { container } = render(<Timeline events={EVENTS} label="Unit history" />);
    expect(screen.getByText(/Priya N\., inspector/)).toBeInTheDocument();
    expect(container.querySelector('time[datetime="2026-08-09T10:02:00+05:30"]')).toHaveTextContent(
      '9 Aug 2026, 10:02',
    );
  });

  it('marks the current event in words, not only in amber', () => {
    render(<Timeline events={EVENTS} label="Unit history" />);
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getAllByText('Current')).toHaveLength(1);
  });

  it('has no axe violations', async () => {
    const { container } = render(<Timeline events={EVENTS} label="Unit history" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

const FULL: Address = {
  label: 'Warehouse 2',
  line1: 'Plot 14, Sector 34',
  line2: 'IMT Manesar',
  city: 'Gurugram',
  state: 'Haryana',
  pincode: '122051',
  landmark: 'Opposite the Maruti gate 3',
  contactName: 'R. Sharma',
  contactMobile: '+919876543210',
  gateInstructions: 'Gate 3 only. Ask for the security desk.',
  receivingHours: 'Mon–Sat, 09:30–18:00',
  gstin: '06AABCT1234C1Z5',
};

describe('AddressCard', () => {
  it('shows the dispatch fields a generic address component drops', () => {
    render(<AddressCard address={FULL} />);
    expect(screen.getByText('Gate 3 only. Ask for the security desk.')).toBeInTheDocument();
    expect(screen.getByText('Mon–Sat, 09:30–18:00')).toBeInTheDocument();
    expect(screen.getByText('Opposite the Maruti gate 3')).toBeInTheDocument();
  });

  it('says "Not provided" for a field nobody was asked, never a blank line', () => {
    const bare: Address = {
      label: 'Billing',
      line1: '2nd floor, Cyber Hub',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122002',
    };
    render(<AddressCard address={bare} />);
    // Landmark, gate instructions and receiving hours — three unasked fields,
    // three explicit admissions rather than three empty rows.
    const missing = screen.getAllByText('Not provided');
    expect(missing).toHaveLength(3);
    for (const node of missing) expect(node).toHaveClass('text-ink-4');
  });

  it('renders the pincode, mobile and GSTIN as mono data', () => {
    render(<AddressCard address={FULL} />);
    expect(screen.getByText('122051')).toHaveClass('tnum');
    expect(screen.getByText('06AABCT1234C1Z5')).toHaveClass('tnum');
    expect(screen.getByRole('link', { name: '+919876543210' })).toHaveAttribute(
      'href',
      'tel:+919876543210',
    );
  });

  it('marks the selected card in words as well as with an amber border', () => {
    render(<AddressCard address={FULL} selected />);
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByTestId('address-card')).toHaveClass('border-acc-dk');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <AddressCard address={FULL} selected actions={<button type="button">Edit</button>} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
