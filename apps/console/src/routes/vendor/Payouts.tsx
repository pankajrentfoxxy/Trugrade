import * as React from 'react';
import { ClauseHeading, EmptyState, RegisterStrip } from '@trugrade/ui';

/**
 * ARCHETYPE B — Board.
 * Payout runs have never been written. This screen is an honest empty state.
 */

export function VendorPayoutsRoute(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <ClauseHeading n="01" kicker="Money" title="Payout history" />
      <RegisterStrip
        cells={[
          { label: 'Runs', value: '0', sub: 'of 0 issued' },
          { label: 'Paid', value: '₹0', sub: 'of ₹0 accrued' },
          { label: 'In flight', value: '0', sub: 'of 0 runs' },
        ]}
      />
      <EmptyState title="No payout runs" body="A run appears here when one is issued." />
    </div>
  );
}
