import { useState } from 'react';
import { Drawer } from '@trugrade/ui';
import { BoardScreen } from '../../boards/BoardScreen';
import { ChainStrip } from '../../boards/ChainStrip';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { FULFILMENT_API, day, inr, type DispatchResult } from './api';

/** Archetype B — board, with a pipeline. */

interface PoRow {
  poId: string;
  poNumber: string;
  status: string;
  vendorOrgId: string;
  vendorLegalName: string | null;
  orderNumber: string | null;
  raisedAt: string;
  lines: number;
  totalNet: string;
  tdsAmount: string;
  supplyPointLabel?: string | null;
  acknowledgedAt: string | null;
}

/**
 * The dispatch board.
 *
 * **It opens on Packed, ready to dispatch** — the only view on which anybody
 * can act — and dispatch is one click from the row, because by the time a
 * purchase order reaches that state there is nothing left for a human to
 * confirm: the pickup address came from the vendor's verified supply point, the
 * ship-to from the order, and the freight was quoted and accepted at checkout.
 * A confirmation dialog here would be a hand-off that buys nothing and costs a
 * click on every consignment.
 */
const config: BoardConfig<PoRow> = {
  kind: 'po',
  title: 'Purchase orders',
  endpoint: '/api/ops/purchase-orders',
  rowKey: (r) => r.poNumber,
  searchHint: 'PO number, order or vendor',
  exportPermission: 'ordering.export.run',
  facets: [
    { key: 'status', label: 'Status' },
    { key: 'vendor', label: 'Vendor' },
  ],
  empty: {
    head: 'No purchase orders here',
    why: 'A PO is raised the moment a buyer approves an order — we buy the serial we just sold.',
  },
  bulk: [
    {
      key: 'dispatch',
      label: 'Dispatch',
      permission: 'procurement.po.dispatch',
      run: async (rows) => {
        const res = await fetch(FULFILMENT_API.dispatchBulk, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ poNumbers: rows.map((r) => r.poNumber) }),
        });
        if (!res.ok) {
          const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
          throw new Error(body.error?.message ?? 'The dispatch was refused.');
        }
        const out: { results?: DispatchResult[]; byCarrier?: Record<string, number> } =
          await res.json();
        const results = out.results ?? [];
        return {
          ok: results.filter((r) => r.awb && !r.error).length,
          failed: results.filter((r) => r.error).length,
          // Grouped by carrier, because "47 dispatched" tells an operator
          // nothing they can act on and "BlueDart 31 · Porter 16" tells them
          // which manifest to expect.
          detail: Object.entries(out.byCarrier ?? {})
            .map(([carrier, n]) => `${carrier} ${n}`)
            .join(' · '),
        };
      },
    },
  ],
  pipeline: {
    stages: [
      { key: 'RAISED', label: 'Raised', who: 'Waiting on vendor' },
      { key: 'ACKNOWLEDGED', label: 'Acknowledged', who: 'Vendor packing' },
      { key: 'DISPATCH_READY', label: 'Packed', who: 'Ours to dispatch' },
      { key: 'DISPATCHED', label: 'Dispatched', who: 'With the carrier' },
      { key: 'RECEIVED', label: 'Received', who: 'Done' },
    ],
    stageOf: (r) => r.status,
    value: (r) => Number(r.totalNet),
    card: (r) => (
      <span className="flex flex-col gap-0.5">
        <span className="mono text-body-sm text-ink">{r.poNumber}</span>
        <span className="text-caption text-ink-3">{r.vendorLegalName ?? '—'}</span>
        <span className="mono tnum text-caption text-ink-2">{inr(r.totalNet)}</span>
      </span>
    ),
  },
  columns: [
    { key: 'po', header: 'PO', cell: (r) => <Id>{r.poNumber}</Id> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    { key: 'vendor', header: 'Vendor', cell: (r) => r.vendorLegalName ?? '—' },
    { key: 'order', header: 'Order', cell: (r) => <Id>{r.orderNumber ?? '—'}</Id> },
    { key: 'lines', header: 'Lines', numeric: true, cell: (r) => r.lines },
    { key: 'net', header: 'Net', numeric: true, sortable: true, cell: (r) => inr(r.totalNet) },
    { key: 'tds', header: 'TDS', numeric: true, cell: (r) => inr(r.tdsAmount) },
    {
      key: 'ack',
      header: 'Acknowledged',
      cell: (r) => (r.acknowledgedAt ? day(r.acknowledgedAt) : <Unmeasured label="Not yet" />),
    },
    { key: 'raised', header: 'Raised', sortable: true, cell: (r) => day(r.raisedAt) },
  ],
};

export default function PurchaseOrders(): React.JSX.Element {
  const [open, setOpen] = useState<PoRow | null>(null);
  return (
    <>
      <BoardScreen config={config} onOpen={setOpen} />
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        size="xl"
        title={<span className="mono">{open?.poNumber ?? 'Purchase order'}</span>}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.status)} label={word(open.status)} />
              <span>{open.vendorLegalName ?? '—'}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-5">
            <ChainStrip orderNumber={open.orderNumber} />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fact label="Lines" value={String(open.lines)} />
              <Fact label="Net" value={inr(open.totalNet)} />
              <Fact label="TDS" value={inr(open.tdsAmount)} />
              <Fact label="Raised" value={day(open.raisedAt)} />
            </dl>
          </div>
        )}
      </Drawer>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mono tnum text-body-sm text-ink">{value}</dd>
    </div>
  );
}
