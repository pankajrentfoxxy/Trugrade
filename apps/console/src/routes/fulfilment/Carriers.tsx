import { BoardScreen } from '../../boards/BoardScreen';
import { StatusDot, Unmeasured } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { FULFILMENT_API, type CarrierRow } from './api';

/** Archetype B — board. */

const config: BoardConfig<CarrierRow> = {
  kind: 'carrier',
  title: 'Carriers',
  endpoint: FULFILMENT_API.carriers,
  rowKey: (r) => r.id,
  searchHint: 'Carrier code',
  empty: { head: 'No carriers configured' },
  columns: [
    { key: 'name', header: 'Carrier', cell: (r) => r.name },
    {
      key: 'adapter',
      header: 'Adapter',
      // Live or fake, said plainly. "We booked it" means two very different
      // things depending on this cell, and an operator chasing a consignment
      // that never existed deserves to find out here rather than from a carrier.
      cell: (r) => (
        <StatusDot tone={r.live ? 'ok' : 'idle'} label={r.live ? 'Live' : 'Simulated'} />
      ),
    },
    { key: 'legs', header: 'Legs', cell: (r) => r.supportsLeg.join(', ') || '—' },
    {
      key: 'duty',
      header: 'Active',
      cell: (r) => (
        <StatusDot tone={r.isActive ? 'ok' : 'idle'} label={r.isActive ? 'Yes' : 'No'} />
      ),
    },
    { key: 'priority', header: 'Priority', numeric: true, cell: (r) => r.priority },
    { key: 'shipments', header: 'Shipments', numeric: true, cell: (r) => r.shipments },
    {
      key: 'ontime',
      header: 'On time',
      numeric: true,
      // Every percentage carries its denominator, and a carrier with nothing
      // delivered gets "Not measured" rather than a perfect score off zero runs.
      cell: (r) =>
        r.onTimePct === null ? (
          <Unmeasured />
        ) : (
          <span className="mono tnum">
            {r.onTimePct}% — {r.delivered} delivered
          </span>
        ),
    },
    {
      key: 'days',
      header: 'Avg days',
      numeric: true,
      cell: (r) => (r.avgDays === null ? <Unmeasured /> : <span className="mono tnum">{r.avgDays}</span>),
    },
  ],
};

export default function Carriers(): React.JSX.Element {
  return <BoardScreen config={config} />;
}
