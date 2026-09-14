import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  HubPageHeader,
  EmptyState,
  GradeBadge,
  HubKpiRow,
  StatusPill,
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
        <DateField label="Raised from" value={from} max={to || undefined} onChange={(e) => setFilter('from', e.target.value)} />
        <DateField label="Raised to" value={to} min={from || undefined} onChange={(e) => setFilter('to', e.target.value)} />
      </div>

      <Board tableMinWidth={960}>
        {!data ? (
          <p className="p-4 text-body-sm text-ink-3">Loading your purchase orders.</p>
        ) : data.rows.length === 0 ? (
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
        ) : (
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-rule text-left text-label text-ink-3">
                <th className="w-8 py-2" aria-hidden />
                <th className="py-2 pr-3">PO</th>
                <th className="py-2 pr-3">Raised</th>
                <th className="py-2 pr-3">Items</th>
                <th className="py-2 pr-3 text-right">Machines</th>
                <th className="py-2 pr-3 text-right">You are owed</th>
                <th className="py-2 pr-3">Deliver to</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((po) => {
                const isOpen = expanded === po.poId;
                const owedStruck =
                  po.originalTotalNet &&
                  Number(po.originalTotalNet) > Number(po.owedNet ?? po.totalNet);
                return (
                  <React.Fragment key={po.poId}>
                    <tr
                      className="cursor-pointer border-b border-rule hover:bg-sheet"
                      onClick={() => setExpanded(isOpen ? null : po.poId)}
                    >
                      <td className="py-3 pl-2 font-mono text-ink-3">{isOpen ? '▾' : '▸'}</td>
                      <td className="py-3 pr-3 font-mono tnum text-ink">{po.poNumber}</td>
                      <td className="py-3 pr-3 font-mono tnum text-ink-2">{onDate(po.raisedAt)}</td>
                      <td className="py-3 pr-3">
                        <span className="font-mono tnum text-ink">
                          {po.modelCount || '—'} model{(po.modelCount ?? 0) === 1 ? '' : 's'}
                        </span>
                        {po.modelNames?.length > 0 && (
                          <span className="mt-0.5 block text-label text-ink-3">
                            {po.modelNames.slice(0, 3).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono tnum">{po.units}</td>
                      <td className="py-3 pr-3 text-right font-mono tnum">
                        {owedStruck && (
                          <span className="mr-2 text-ink-4 line-through">
                            {rupees(po.originalTotalNet)}
                          </span>
                        )}
                        {rupees(po.owedNet ?? po.totalNet)}
                      </td>
                      <td className="py-3 pr-3 text-ink-2">
                        {po.deliverTo ? `${po.deliverTo.city}, ${po.deliverTo.state}` : <NotMeasured label="—" why="" />}
                      </td>
                      <td className="py-3 pr-3">
                        <StatusPill tone={STATUS_TONE[po.status] ?? 'neutral'} label={statusLabel(po.status)} />
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDialogPo(po.poId);
                          }}
                        >
                          {po.status === 'RAISED' ? 'Review' : 'Open'}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <ExpandedPoLines poId={po.poId} reloadKey={reloadKey} />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Board>

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

function ExpandedPoLines({ poId, reloadKey }: { poId: string; reloadKey: number }): React.JSX.Element {
  const { data } = useResource<PurchaseOrderDetail>(
    `${API.purchaseOrder(poId)}?_=${reloadKey}`,
    'Detail unavailable',
  );
  if (!data) {
    return (
      <tr className="border-b border-rule bg-sheet">
        <td colSpan={9} className="px-4 py-3 text-ink-3">
          Loading lines…
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-rule bg-sheet">
      <td colSpan={9} className="px-4 py-3">
        <table className="w-full min-w-[640px] border-collapse text-body-sm">
          <thead>
            <tr className="text-left text-label text-ink-3">
              <th className="py-1 pr-3">Machine</th>
              <th className="py-1 pr-3">Grade</th>
              <th className="py-1 pr-3 text-right">Qty</th>
              <th className="py-1 pr-3 text-right">Unit price</th>
              <th className="py-1 pr-3 text-right">Line total</th>
              <th className="py-1 pr-3">Serials</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.lineGroups.map((g) => (
              <tr key={g.lineIds[0]} className={g.lineStatus === 'REJECTED' ? 'bg-fail-wash' : undefined}>
                <td className="py-2 pr-3">
                  <p>{g.title}</p>
                  <p className="text-label text-ink-3">{g.specSummary}</p>
                </td>
                <td className="py-2 pr-3">
                  <GradeBadge grade={g.gradeAtPo as Grade} />
                </td>
                <td className="py-2 pr-3 text-right font-mono tnum">{g.qty}</td>
                <td className="py-2 pr-3 text-right font-mono tnum">{rupees(g.unitPrice)}</td>
                <td className="py-2 pr-3 text-right font-mono tnum">{rupees(g.lineTotal)}</td>
                <td className="py-2 pr-3 font-mono tnum text-ink-2">
                  {g.serials.length > 0
                    ? g.serials.map((s) => s.serialNumber).join(', ')
                    : `${g.attachedCount}/${g.qty}`}
                </td>
                <td className="py-2 text-label text-ink-3">{g.lineStatus.toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}
