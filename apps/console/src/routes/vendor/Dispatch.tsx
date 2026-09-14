import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  DataBoard,
  EmptyState,
  HubPageHeader,
  Skeleton,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, humanise, onDate, type Page, type PurchaseOrder } from './api';
import { useProfileGateOrRender } from './ProfileLockGate';

/**
 * ARCHETYPE B — Board. Acknowledged POs awaiting dispatch.
 * Manual recording only — there is no carrier integration and no dispatch writer.
 */

const COLUMNS: ReadonlyArray<Column<PurchaseOrder>> = [
  {
    key: 'po',
    header: 'PO',
    cell: (po) => (
      <Link to={`/vendor/orders/${po.poId}`} className="font-mono text-ink underline">
        {po.poNumber}
      </Link>
    ),
  },
  { key: 'units', header: 'Units', numeric: true, cell: (po) => po.units },
  {
    key: 'city',
    header: 'City',
    cell: (po) =>
      po.deliverTo?.city ?? (
        <NotMeasured label="Not given" why="The order carries no delivery city." />
      ),
  },
  {
    key: 'ready',
    header: 'Ready by',
    numeric: true,
    cell: (po) =>
      po.expectedDispatchAt ? (
        onDate(po.expectedDispatchAt)
      ) : (
        <NotMeasured label="Not set" why="No dispatch date on this order." />
      ),
  },
  {
    key: 'state',
    header: 'State',
    cell: (po) => <StatusPill tone="processing" label={humanise(po.status)} />,
  },
];

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
      po.status === 'ACKNOWLEDGED' || po.status === 'PARTIAL' || po.status === 'DISPATCH_READY',
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
      <Board tableMinWidth={800}>
        <DataBoard
          caption={`${rows.length} purchase ${rows.length === 1 ? 'order' : 'orders'} to dispatch.`}
          columns={COLUMNS}
          rows={rows}
          rowKey={(po) => po.poId}
        />
      </Board>
    </div>
  );
}
