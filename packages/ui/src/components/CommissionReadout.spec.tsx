import * as React from 'react';
import { render, screen } from '@testing-library/react';
import type { MarginRule } from '@trugrade/contracts';
import { CommissionReadout } from './CommissionReadout';

const RULE: MarginRule = {
  targetMarginPct: 12,
  floorMarginPct: 4,
  warrantyTopUpMonths: 3,
  reservePctByGrade: { A_PLUS: 0.8, A: 1.2, B: 2.0 },
};

function renderAt(netPayoutRupees: string): void {
  render(
    <CommissionReadout
      netPayoutRupees={netPayoutRupees}
      grade="A"
      rule={RULE}
      vendorWarrantyMonths={3}
    />,
  );
}

describe('the vendor sees a percentage, the contract stays a rupee amount', () => {
  it('shows the commission for the worked example', () => {
    renderAt('28000');
    // 4,368 over 32,368 = 13.49%. Not rounded up to a friendlier 13.5: a vendor
    // who checks the arithmetic has to land on exactly what we showed them.
    expect(screen.getByTestId('commission-pct')).toHaveTextContent('13.49%');
    expect(screen.getByTestId('selling-price')).toHaveTextContent('₹32,368.00');
  });

  it('shows the payout back unchanged, which is the promise being made', () => {
    renderAt('28000');
    expect(screen.getAllByText('₹28,000.00').length).toBeGreaterThan(0);
  });

  it('names the months we fund, so the reserve is not a mystery line', () => {
    renderAt('28000');
    expect(screen.getByText(/3 months we fund/)).toBeInTheDocument();
  });

  it('states plainly that the payout does not move', () => {
    renderAt('28000');
    // The single sentence that makes NET_PAYOUT worth explaining at all.
    expect(screen.getByText(/does not change/)).toBeInTheDocument();
    expect(screen.getByText(/fixed when the purchase order is raised/)).toBeInTheDocument();
  });
});

describe('mid-keystroke input', () => {
  it.each(['', '  ', 'abc', '28,000', '28.', '-500', '28.999'])(
    'renders the prompt rather than throwing on %p',
    (input) => {
      renderAt(input);
      expect(screen.getByText(/Enter the amount you want to receive/)).toBeInTheDocument();
    },
  );

  it('treats zero as nothing entered yet', () => {
    renderAt('0');
    expect(screen.getByText(/Enter the amount you want to receive/)).toBeInTheDocument();
  });

  it('accepts paise', () => {
    renderAt('28000.50');
    expect(screen.getByTestId('commission-pct')).toBeInTheDocument();
  });
});

describe('the break-up is never hidden', () => {
  it('shows every component on the same screen as the total', () => {
    renderAt('28000');
    // Drip pricing is a named prohibited practice; the components are visible
    // without a disclosure click.
    expect(screen.getByText('You receive')).toBeInTheDocument();
    expect(screen.getByText('Our margin')).toBeInTheDocument();
    expect(screen.getByText('Listed at')).toBeInTheDocument();
  });

  it('omits the reserve line entirely when there is nothing to reserve', () => {
    render(
      <CommissionReadout
        netPayoutRupees="28000"
        grade="A"
        rule={{ ...RULE, warrantyTopUpMonths: 0, minTotalWarrantyMonths: 3 }}
        vendorWarrantyMonths={3}
      />,
    );
    // A zero-rupee line item invites the question "why is this here"; absence is
    // the honest rendering when the answer is "it does not apply".
    expect(screen.queryByText(/we fund/)).not.toBeInTheDocument();
  });
});
