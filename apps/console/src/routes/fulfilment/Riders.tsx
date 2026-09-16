import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { FULFILMENT_API, type RiderRow } from './api';

/** Archetype B — board. */

const config: BoardConfig<RiderRow> = {
  kind: 'rider',
  title: 'Riders',
  endpoint: FULFILMENT_API.riders,
  rowKey: (r) => r.id,
  searchHint: 'Phone or zone',
  facets: [{ key: 'zone', label: 'Zone' }],
  empty: {
    head: 'No riders on the roster',
    why: 'In-house delivery is the NCR pilot rail; every other lane goes to a carrier.',
  },
  columns: [
    { key: 'name', header: 'Rider', cell: (r) => r.name ?? <Unmeasured label="No account" /> },
    { key: 'phone', header: 'Phone', cell: (r) => <Id>{r.phone}</Id> },
    { key: 'zone', header: 'Zone', cell: (r) => r.zone ?? <Unmeasured label="Unzoned" /> },
    { key: 'vehicle', header: 'Vehicle', cell: (r) => r.vehicleType ?? '—' },
    {
      key: 'duty',
      header: 'Duty',
      cell: (r) => (
        <StatusDot tone={r.isActive ? 'ok' : 'idle'} label={r.isActive ? 'On' : 'Off'} />
      ),
    },
    {
      key: 'load',
      header: 'Open',
      numeric: true,
      // Pickups and deliveries separately: a rider with six of one and none of
      // the other is a different problem from one with three of each.
      cell: (r) => (
        <span className="mono tnum">
          {r.openPickups} / {r.openDeliveries}
        </span>
      ),
    },
  ],
};

export default function Riders(): React.JSX.Element {
  return <BoardScreen config={config} />;
}
