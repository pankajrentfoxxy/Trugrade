import { useState } from 'react';
import { Drawer } from '@trugrade/ui';
import { BoardScreen } from '../../boards/BoardScreen';
import { ChainStrip } from '../../boards/ChainStrip';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { ShipmentRecord } from './ShipmentRecord';
import { FULFILMENT_API, day, inr, when, type ShipmentRow } from './api';

/** Archetype B — board. */

const config: BoardConfig<ShipmentRow> = {
  kind: 'shipment',
  title: 'Shipments',
  endpoint: FULFILMENT_API.shipments,
  rowKey: (r) => r.id,
  // Pasting an AWB out of a carrier's email has to land on the record, and so
  // does an internal id out of a log line — neither of which any column prints.
  searchHint: 'AWB, seal or id',
  exportPermission: 'ordering.export.run',
  facets: [
    { key: 'carrier', label: 'Carrier' },
    { key: 'leg', label: 'Leg' },
    { key: 'mode', label: 'Mode' },
  ],
  empty: {
    head: 'No shipments here',
    why: 'A consignment appears once a packed purchase order is dispatched.',
  },
  columns: [
    { key: 'awb', header: 'AWB', cell: (r) => <Id>{r.awb ?? '—'}</Id> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    { key: 'carrier', header: 'Carrier', cell: (r) => r.carrier ?? '—' },
    { key: 'order', header: 'Order', cell: (r) => <Id>{r.orderNumber ?? '—'}</Id> },
    { key: 'boxes', header: 'Boxes', numeric: true, cell: (r) => r.boxes },
    {
      key: 'value',
      header: 'Value',
      numeric: true,
      sortable: true,
      cell: (r) => inr(r.declaredValue),
    },
    {
      key: 'freight',
      header: 'Freight',
      numeric: true,
      sortable: true,
      // Quoted and billed side by side: the gap between them is the number
      // finance asks about, and showing only one of them hides it.
      cell: (r) =>
        r.freightCost ? (
          <span className="mono tnum">
            {inr(r.freightCost)}
            {r.quotedFreight && r.quotedFreight !== r.freightCost && (
              <span className="text-ink-4"> / {inr(r.quotedFreight)}</span>
            )}
          </span>
        ) : (
          <Unmeasured label="Not billed" />
        ),
    },
    {
      key: 'seal',
      header: 'Seal',
      cell: (r) =>
        r.sealId ? (
          <StatusDot
            tone={r.sealVerifiedAt ? 'ok' : 'idle'}
            label={r.sealVerifiedAt ? 'Checked' : 'Unchecked'}
          />
        ) : (
          <Unmeasured label="None" />
        ),
    },
    { key: 'dispatched', header: 'Dispatched', sortable: true, cell: (r) => day(r.dispatchedAt) },
    { key: 'eta', header: 'ETA', cell: (r) => day(r.etaFrom) },
  ],
};

export default function Shipments(): React.JSX.Element {
  const [open, setOpen] = useState<ShipmentRow | null>(null);
  return (
    <>
      <BoardScreen config={config} onOpen={setOpen} />
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        size="xl"
        title={<span className="mono">{open?.awb ?? 'Shipment'}</span>}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.status)} label={word(open.status)} />
              <span>{open.carrier ?? 'No carrier'}</span>
              <span className="text-ink-4">{when(open.createdAt)}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-5">
            <ChainStrip orderNumber={open.orderNumber} />
            <ShipmentRecord shipment={open} />
          </div>
        )}
      </Drawer>
    </>
  );
}
