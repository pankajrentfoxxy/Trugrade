import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { HubPageHeader, EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { API, onDate, type Page, type PurchaseOrder } from './api';
import { useProfileGateOrRender } from './ProfileLockGate';

/**
 * ARCHETYPE B — Board. Acknowledged POs awaiting dispatch.
 * Manual recording only — there is no carrier integration and no dispatch writer.
 */

export function VendorDispatchRoute(): React.JSX.Element {
  // Gated with Orders, not separately named on the rail: there is nothing to
  // dispatch before a purchase order can exist, and this screen is reached
  // only from Orders' own link once that is true.
  const gate = useProfileGateOrRender('purchase orders', 'Dispatch');
  const [params] = useSearchParams();
  const query = new URLSearchParams({ page: '1', pageSize: '50', status: 'ACKNOWLEDGED' });
  if (params.get('status')) query.set('status', params.get('status')!);

  const { data, error } = useResource<Page<PurchaseOrder>>(
    `${API.purchaseOrders}?${query.toString()}`,
    'Dispatch is unavailable',
  );

  if (gate.locked) return gate.locked;

  if (error) {
    return (
      <div>
        <HubPageHeader title="Dispatch" />
        <EmptyState title="Dispatch did not load" body={`${error}. Nothing has changed.`} />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <HubPageHeader title="Dispatch" />
        <Skeleton lines={6} />
      </div>
    );
  }

  const rows = data.rows.filter(
    (po) =>
      po.status === 'ACKNOWLEDGED' ||
      po.status === 'PARTIAL' ||
      po.status === 'DISPATCH_READY',
  );

  if (rows.length === 0) {
    return (
      <div>
        <HubPageHeader title="Dispatch" />
        <EmptyState title="Nothing to dispatch" body="Acknowledged purchase orders appear here." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HubPageHeader title="Dispatch" />
      <div className="overflow-x-auto border border-rule bg-sheet">
        <table className="w-full min-w-[800px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink bg-sheet-2">
              {['PO', 'Units', 'City', 'Ready by', 'State'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.11em] text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((po) => (
              <tr key={po.poId} className="border-b border-rule-2 last:border-b-0">
                <td className="px-3 py-2">
                  <Link to={`/vendor/orders/${po.poId}`} className="font-mono text-ink underline">
                    {po.poNumber}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">{po.units}</td>
                <td className="px-3 py-2 text-ink-2">{po.deliverTo?.city ?? '—'}</td>
                <td className="px-3 py-2 font-mono tabular-nums text-ink-4">
                  {po.expectedDispatchAt ? onDate(po.expectedDispatchAt) : '—'}
                </td>
                <td className="px-3 py-2">
                  <StatusPill tone="processing" label={po.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
