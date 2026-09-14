import * as React from 'react';
import { Link } from 'react-router';
import {
  DataBoard,
  EmptyState,
  HubKpiRow,
  HubPageHeader,
  LedgerRow,
  Skeleton,
  type Column,
} from '@trugrade/ui';
import { Board } from '../../lib/controls';
import { daysSince } from '../../lib/clock';
import { useResource } from '../../lib/useResource';
import { API, onDate, rupees, type PayableRow, type PayablesView } from './api';
import { useProfileGateOrRender } from './ProfileLockGate';

/** ARCHETYPE B — Open items + deduction stack + empty payout history. */

/** The MSMED Act's outer limit for paying a registered micro or small supplier. */
const MSME_DAYS = 45;

const COLUMNS: ReadonlyArray<Column<PayableRow>> = [
  { key: 'po', header: 'PO', cell: (r) => <span className="font-mono tnum">{r.poNumber}</span> },
  { key: 'raised', header: 'Raised', numeric: true, cell: (r) => onDate(r.accruedAt) },
  {
    key: 'age',
    header: 'Age',
    numeric: true,
    cell: (r) => {
      const age = daysSince(r.accruedAt);
      // Late is a warning to act on, not a failed check: amber, never red.
      const late = r.overdue || age > MSME_DAYS;
      return (
        <span className={late ? 'text-warn' : 'text-ink-2'}>
          {age} d{late ? ' · overdue' : ''}
        </span>
      );
    },
  },
  { key: 'amount', header: 'Amount', numeric: true, cell: (r) => rupees(r.net) },
];

export function VendorPayoutsRoute(): React.JSX.Element {
  // Gated with Payables, not separately named on the rail: there is nothing
  // to have been paid before that is true, and this screen is reached only
  // from Payables' own link once it is.
  const gate = useProfileGateOrRender('payables', 'Payout history');
  const { data, error } = useResource<PayablesView>(API.payables, 'Payables unavailable');

  if (gate.locked) return gate.locked;

  if (error) {
    return (
      <div>
        <HubPageHeader title="Payout history" />
        <EmptyState title="Did not load" body={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <HubPageHeader title="Payout history" />
        <Skeleton lines={8} />
      </div>
    );
  }

  const { statement: s, rows, account } = data;

  return (
    <div className="flex flex-col gap-6">
      <HubPageHeader title="Payout history" />

      <HubKpiRow
        cells={[
          { label: 'Open items', value: String(s.payables) },
          { label: 'Gross', value: rupees(s.gross) },
          { label: 'Net due', value: rupees(s.net) },
        ]}
      />

      <section>
        <h2 className="mb-2 text-body font-medium text-ink">Deduction stack</h2>
        <LedgerRow label="Gross" value={rupees(s.gross)} />
        <LedgerRow label="TDS (s.194Q)" value={`− ${rupees(s.tds.amount)}`} />
        <LedgerRow label="Corrections" value={`− ${rupees(s.penalties)}`} />
        <LedgerRow label="QC fees" value={`− ${rupees(s.qcFees)}`} />
        <LedgerRow label="Net" value={rupees(s.net)} total />
      </section>

      {account && (
        <p className="text-body-sm text-ink-2">
          Payout account · {account.holderName} ·{' '}
          <span className="font-mono tnum">••••{account.last4}</span>
          {!account.verified ? ' · Not verified' : ''}
        </p>
      )}

      <section>
        <h2 className="mb-2 text-body font-medium text-ink">Open items</h2>
        {rows.length === 0 ? (
          <EmptyState title="Nothing open" body="Payables appear after delivery." />
        ) : (
          <Board tableMinWidth={640}>
            <DataBoard
              caption={`${rows.length} open ${rows.length === 1 ? 'item' : 'items'}.`}
              columns={COLUMNS}
              rows={rows}
              rowKey={(r) => r.payableId}
            />
          </Board>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-body font-medium text-ink">Payout history</h2>
        {/* Only what the API computed. "0 of 0 issued" and "₹0 of ₹0 accrued" were
            typed into this screen, whatever the account had actually been paid. */}
        {data.payoutsEver === 0 ? (
          <EmptyState title="No payout runs yet" body="Nothing has been paid to this account." />
        ) : (
          <HubKpiRow cells={[{ label: 'Payout runs', value: String(data.payoutsEver) }]} />
        )}
      </section>

      <Link className="text-body-sm underline" to="/vendor/payables">
        Full payables board
      </Link>
    </div>
  );
}
