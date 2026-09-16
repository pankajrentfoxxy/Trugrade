import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { day, inr } from '../fulfilment/api';

/** Archetype B — board. */

export interface PayoutRunRow {
  id: string;
  runNumber: string;
  cycle: string;
  status: string;
  totalNet: string;
  vendorCount: number;
  lines: number;
  createdBy: string | null;
  createdByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  releasedBy: string | null;
  createdAt: string;
  releasedAt: string | null;
}

const config: BoardConfig<PayoutRunRow> = {
  kind: 'payout',
  title: 'Payout runs',
  endpoint: '/api/ops/finance/payout-runs',
  rowKey: (r) => r.id,
  searchHint: 'Run number',
  empty: {
    head: 'No payout runs',
    why: 'A run is drafted from the payables that are due, and needs a second signature before it releases.',
  },
  columns: [
    { key: 'run', header: 'Run', cell: (r) => <Id>{r.runNumber}</Id> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    { key: 'vendors', header: 'Vendors', numeric: true, cell: (r) => r.vendorCount },
    { key: 'lines', header: 'Lines', numeric: true, cell: (r) => r.lines },
    { key: 'net', header: 'Net', numeric: true, cell: (r) => inr(r.totalNet) },
    // Maker and checker as two columns, named. "Who approved this" is the first
    // question an auditor asks, and the separation is only real if it is visible.
    { key: 'maker', header: 'Prepared by', cell: (r) => r.createdByName ?? '—' },
    {
      key: 'checker',
      header: 'Approved by',
      cell: (r) => r.approvedByName ?? <Unmeasured label="Unapproved" />,
    },
    { key: 'created', header: 'Drafted', cell: (r) => day(r.createdAt) },
  ],
};

export default function Payouts(): React.JSX.Element {
  return <BoardScreen config={config} />;
}
