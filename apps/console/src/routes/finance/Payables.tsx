import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { day, inr } from '../fulfilment/api';
import { apiFetch } from '../../lib/auth';

/** Archetype B — board. */

export interface PayableRow {
  id: string;
  vendorOrgId: string;
  vendorName: string | null;
  purchaseOrderId: string;
  poNumber: string | null;
  gross: string;
  tds: string;
  penalties: string;
  qcFee: string;
  netPayable: string;
  status: string;
  holdReason: string | null;
  eligibleAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

const config: BoardConfig<PayableRow> = {
  kind: 'payable',
  title: 'Payables',
  endpoint: '/api/ops/finance/payables',
  rowKey: (r) => r.id,
  searchHint: 'Payable id',
  exportPermission: 'finance.export.run',
  facets: [{ key: 'vendor', label: 'Vendor' }],
  empty: {
    head: 'Nothing payable here',
    why: 'A payable accrues when a purchase order is received, and becomes due when the return window closes.',
  },
  bulk: [
    {
      key: 'run',
      label: 'Add to payout run',
      permission: 'procurement.payout.run',
      confirm: 'Draft a payout run over everything eligible?',
      // The run selects what is eligible server-side rather than taking the
      // selection: a run built from a stale page is a run that pays a payable
      // whose hold landed thirty seconds ago.
      run: async () => {
        const res = await apiFetch('/api/finance/payout-runs', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
        });
        if (!res.ok) {
          const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
          throw new Error(body.error?.message ?? 'The run was refused.');
        }
        const out: { runNumber?: string; vendorCount?: number } = await res.json();
        return { ok: out.vendorCount ?? 0, failed: 0, detail: out.runNumber ?? '' };
      },
    },
  ],
  columns: [
    { key: 'vendor', header: 'Vendor', cell: (r) => r.vendorName ?? '—' },
    { key: 'po', header: 'PO', cell: (r) => <Id>{r.poNumber ?? '—'}</Id> },
    { key: 'gross', header: 'Gross', numeric: true, sortable: true, cell: (r) => inr(r.gross) },
    { key: 'tds', header: 'TDS', numeric: true, cell: (r) => inr(r.tds) },
    {
      key: 'deductions',
      header: 'Deductions',
      numeric: true,
      cell: (r) =>
        Number(r.penalties) + Number(r.qcFee) > 0 ? (
          <span className="mono tnum">{inr(Number(r.penalties) + Number(r.qcFee))}</span>
        ) : (
          <span className="mono tnum text-ink-4">—</span>
        ),
    },
    { key: 'net', header: 'Net', numeric: true, sortable: true, cell: (r) => inr(r.netPayable) },
    {
      key: 'status',
      header: 'Status',
      cell: (r) =>
        r.holdReason ? (
          <StatusDot tone="warn" label="Held" />
        ) : (
          <StatusDot tone={toneOf(r.status)} label={word(r.status)} />
        ),
    },
    {
      key: 'eligible',
      header: 'Due',
      sortable: true,
      cell: (r) => (r.eligibleAt ? day(r.eligibleAt) : <Unmeasured label="Not set" />),
    },
  ],
};

export default function Payables(): React.JSX.Element {
  return <BoardScreen config={config} />;
}
