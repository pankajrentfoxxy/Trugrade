import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  HubKpiRow,
  HubPageHeader,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { Board, DateField, NotMeasured, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  PO_STATUSES,
  onDate,
  rupees,
  type Page,
  type PoKpis,
  type PurchaseOrder,
  type PurchaseOrderDetail,
} from './api';
import { PoDetailDialog } from './orders/PoDetailDialog';
import { useProfileGateOrRender } from './ProfileLockGate';

/**
 * ARCHETYPE B — Board. KPI strip + filter rail + expandable table + row dialog.
 */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'processing'> = {
  RAISED: 'warn',
  ACKNOWLEDGED: 'processing',
  PARTIAL: 'warn',
  REJECTED: 'neutral',
  DISPATCH_READY: 'processing',
  DISPATCHED: 'processing',
  RECEIVED: 'processing',
  INVOICED: 'processing',
  MATCHED: 'processing',
  PAYABLE: 'info',
  PAID: 'neutral',
  CANCELLED: 'neutral',
  DISPUTED: 'warn',
};

function statusLabel(s: string): string {
  return s === 'RAISED' ? 'Issued' : s.replaceAll('_', ' ').toLowerCase();
}

export function VendorPurchaseOrdersRoute(): React.JSX.Element {
  const gate = useProfileGateOrRender('purchase orders', 'Purchase orders');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const filtered = Boolean(status || from || to);

  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [dialogPo, setDialogPo] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const query = new URLSearchParams({ page: '1', pageSize: '50' });
  if (status) query.set('status', status);
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  const { data, error } = useResource<Page<PurchaseOrder>>(
    `${API.purchaseOrders}?${query.toString()}&_=${reloadKey}`,
    'Your purchase orders are unavailable',
  );
  const { data: kpis } = useResource<PoKpis>(API.purchaseOrderKpis, 'KPIs unavailable');

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function refresh(): void {
    setReloadKey((k) => k + 1);
  }

  const columns: ReadonlyArray<Column<PurchaseOrder>> = [
    {
      key: 'po',
      header: 'PO',
      cell: (po) => <span className="font-mono tnum text-ink">{po.poNumber}</span>,
    },
    { key: 'raised', header: 'Raised', numeric: true, cell: (po) => onDate(po.raisedAt) },
    {
      key: 'items',
      header: 'Items',
      cell: (po) => (
        <>
          <span className="font-mono tnum text-ink">
            {po.modelCount} {po.modelCount === 1 ? 'model' : 'models'}
          </span>
          {po.modelNames?.length > 0 && (
            <span className="mt-0.5 block text-label text-ink-3">
              {po.modelNames.slice(0, 3).join(' · ')}
            </span>
          )}
        </>
      ),
    },
    { key: 'machines', header: 'Machines', numeric: true, cell: (po) => po.units },
    {
      key: 'owed',
      header: 'You are owed',
      numeric: true,
      cell: (po) => {
        const struck =
          po.originalTotalNet && Number(po.originalTotalNet) > Number(po.owedNet ?? po.totalNet);
        return (
          <>
            {struck && (
              <span className="mr-2 text-ink-4 line-through">{rupees(po.originalTotalNet)}</span>
            )}
            {rupees(po.owedNet ?? po.totalNet)}
          </>
        );
      },
    },
    {
      key: 'deliver',
      header: 'Deliver to',
      cell: (po) =>
        po.deliverTo ? (
          <span className="text-ink-2">{`${po.deliverTo.city}, ${po.deliverTo.state}`}</span>
        ) : (
          <NotMeasured label="Not given" why="The order carries no delivery city." />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (po) => (
        <StatusPill tone={STATUS_TONE[po.status] ?? 'neutral'} label={statusLabel(po.status)} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      headerHidden: true,
      cell: (po) => (
        <span className="flex justify-end gap-2">
          <Button
            variant="ghost"
            aria-expanded={expanded === po.poId}
            onClick={() => setExpanded(expanded === po.poId ? null : po.poId)}
          >
            {expanded === po.poId ? 'Hide lines' : 'Lines'}
          </Button>
          <Button variant="secondary" onClick={() => setDialogPo(po.poId)}>
            {po.status === 'RAISED' ? 'Review' : 'Open'}
          </Button>
        </span>
      ),
    },
  ];

  if (gate.locked) return gate.locked;

  if (error) {
    return (
      <EmptyState
        title="Your purchase orders did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  return (
    <div className="tg-stack">
      {/* Dispatch is off the rail, so this is the only way to the pick-and-ship
          board — which is the screen this one hands work to. */}
      <HubPageHeader
        title="Purchase orders"
        actions={
          <Link
            className="text-body-sm text-acc-ink underline underline-offset-4"
            to="/vendor/dispatch"
          >
            Dispatch board
          </Link>
        }
      />

      <HubKpiRow
        cells={[
          {
            label: 'Open orders',
            value: kpis ? String(kpis.openOrders) : '—',
            sub: 'Raised through dispatch-ready',
          },
          {
            label: 'Waiting on you',
            value: kpis ? String(kpis.waitingOrders) : '—',
            sub: kpis ? `${kpis.waitingMachines} machines` : 'Issued, not responded',
          },
          {
            label: 'Machines to pick',
            value: kpis ? String(kpis.machinesToPick) : '—',
            sub: 'Accepted, no serial yet',
          },
          {
            label: 'Value accepted',
            value: kpis ? rupees(kpis.valueAccepted) : '—',
            sub: 'Net on accepted lines',
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-4">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={[
            { value: '', label: 'Every status' },
            ...PO_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          ]}
        />
        <DateField
          label="Raised from"
          value={from}
          max={to || undefined}
          onChange={(e) => setFilter('from', e.target.value)}
        />
        <DateField
          label="Raised to"
          value={to}
          min={from || undefined}
          onChange={(e) => setFilter('to', e.target.value)}
        />
      </div>

      <Board tableMinWidth={960}>
        <DataBoard
          caption={
            data
              ? `${data.rows.length} purchase ${data.rows.length === 1 ? 'order' : 'orders'}, newest first.`
              : 'Loading your purchase orders.'
          }
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(po) => po.poId}
          loading={!data}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'No purchase orders yet'}
              body={
                filtered
                  ? 'Clear the filter to see your purchase orders.'
                  : 'A purchase order appears when a buyer orders your stock.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Board>

      {expanded ? (
        <PoLines
          poId={expanded}
          poNumber={data?.rows.find((po) => po.poId === expanded)?.poNumber ?? ''}
          reloadKey={reloadKey}
          onClose={() => setExpanded(null)}
        />
      ) : null}

      {dialogPo && (
        <PoDetailDialog
          poId={dialogPo}
          open
          onClose={() => setDialogPo(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}

/** One purchase order's lines, beneath the board. Was a nested table in an expanded row. */
function PoLines({
  poId,
  poNumber,
  reloadKey,
  onClose,
}: {
  poId: string;
  poNumber: string;
  reloadKey: number;
  onClose: () => void;
}): React.JSX.Element {
  const { data, error } = useResource<PurchaseOrderDetail>(
    `${API.purchaseOrder(poId)}?_=${reloadKey}`,
    'The lines on this order did not load',
  );
  type Line = PurchaseOrderDetail['lineGroups'][number];
  const columns: ReadonlyArray<Column<Line>> = [
    {
      key: 'machine',
      header: 'Machine',
      cell: (g) => (
        <>
          <p className="text-ink">{g.title}</p>
          <p className="text-label text-ink-3">{g.specSummary}</p>
        </>
      ),
    },
    { key: 'grade', header: 'Grade', cell: (g) => <GradeBadge grade={g.gradeAtPo as Grade} /> },
    { key: 'qty', header: 'Qty', numeric: true, cell: (g) => g.qty },
    { key: 'unit', header: 'Unit price', numeric: true, cell: (g) => rupees(g.unitPrice) },
    { key: 'total', header: 'Line total', numeric: true, cell: (g) => rupees(g.lineTotal) },
    {
      key: 'serials',
      header: 'Serials',
      cell: (g) => (
        <span className="font-mono tnum text-ink-2">
          {g.serials.length > 0
            ? g.serials.map((sn) => sn.serialNumber).join(', ')
            : `${g.attachedCount} of ${g.qty} attached`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (g) => (
        <StatusPill
          tone={g.lineStatus === 'REJECTED' ? 'neutral' : 'processing'}
          label={statusLabel(g.lineStatus)}
        />
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3" aria-label={`Lines on ${poNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-body font-medium text-ink">
          Lines on <span className="font-mono tnum">{poNumber}</span>
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Hide lines
        </Button>
      </div>
      {error ? (
        <EmptyState title="The lines did not load" body={`${error}. Nothing has been changed.`} />
      ) : (
        <Board tableMinWidth={720}>
          <DataBoard
            caption={data ? `${data.lineGroups.length} lines on ${poNumber}.` : 'Loading lines.'}
            columns={columns}
            rows={data?.lineGroups ?? []}
            rowKey={(g) => g.lineIds.join(',')}
            loading={!data}
          />
        </Board>
      )}
    </section>
  );
}
