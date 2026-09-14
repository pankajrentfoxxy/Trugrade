import * as React from 'react';
import { Link } from 'react-router';
import {
  ClauseHeading,
  EmptyState,
  LedgerRow,
  RegisterStrip,
  Skeleton,
} from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { API, onDate, rupees, type PayablesView } from './api';

/** ARCHETYPE B — Open items + deduction stack + empty payout history. */

export function VendorPayoutsRoute(): React.JSX.Element {
  const { data, error } = useResource<PayablesView>(API.payables, 'Payables unavailable');

  if (error) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Money" title="Payouts" />
        <EmptyState title="Did not load" body={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <ClauseHeading n="01" kicker="Money" title="Payouts" />
        <Skeleton lines={8} />
      </div>
    );
  }

  const { statement: s, rows, account } = data;

  return (
    <div className="flex flex-col gap-6">
      <ClauseHeading n="01" kicker="Money" title="Payouts" />

      <RegisterStrip
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
                    <th key={h} className="px-3 py-2 text-left font-mono text-[10px] uppercase text-ink-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const age = Math.max(
                    0,
                    Math.floor((Date.now() - new Date(r.accruedAt).getTime()) / 86_400_000),
                  );
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
        <RegisterStrip
          cells={[
            { label: 'Runs', value: '0', sub: 'of 0 issued' },
            { label: 'Paid', value: '₹0', sub: 'of ₹0 accrued' },
          ]}
        />
        <EmptyState title="No payout runs" body="None issued yet." />
      </section>

      <Link className="text-body-sm underline" to="/vendor/payables">
        Full payables board
      </Link>
    </div>
  );
}
