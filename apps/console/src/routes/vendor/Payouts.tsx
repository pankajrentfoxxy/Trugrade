import * as React from 'react';
import { Link } from 'react-router';
import { HubPageHeader, EmptyState, LedgerRow, HubKpiRow, Skeleton } from '@trugrade/ui';
import { daysSince } from '../../lib/clock';
import { useResource } from '../../lib/useResource';
import { API, onDate, rupees, type PayablesView } from './api';
import { useProfileGateOrRender } from './ProfileLockGate';

/** ARCHETYPE B — Open items + deduction stack + empty payout history. */

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
          <div className="overflow-x-auto border border-rule bg-sheet">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-ink bg-sheet-2">
                  {['Reference', 'PO', 'Raised', 'Age', 'Amount'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-mono text-[10px] uppercase text-ink-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const age = daysSince(r.accruedAt);
                  return (
                    <tr
                      key={r.payableId}
                      className={`border-b border-rule-2 last:border-b-0 ${r.overdue || age > 45 ? 'border-l-2 border-l-fail' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono tnum">{r.payableId.slice(0, 8)}</td>
                      <td className="px-3 py-2 font-mono tnum">{r.poNumber}</td>
                      <td className="px-3 py-2 font-mono tnum">{onDate(r.accruedAt)}</td>
                      <td
                        className={`px-3 py-2 font-mono tnum ${age > 45 ? 'text-fail' : 'text-ink-2'}`}
                      >
                        {age} d
                      </td>
                      <td className="px-3 py-2 font-mono tnum">{rupees(r.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
