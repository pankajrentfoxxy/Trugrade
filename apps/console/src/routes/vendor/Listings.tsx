import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  HubPageHeader,
  DataBoard,
  EmptyState,
  GradeBadge,
  Pagination,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { Board, NotMeasured, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, gradeLabel, rupees, type Page, type VendorListing } from './api';
import { machineTitle } from './ListingMachine';
import { CreateListingDialog } from './listings/CreateListingDialog';

/** ARCHETYPE B — Board. */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'processing'> = {
  DRAFT: 'neutral',
  AWAITING_QC: 'processing',
  QC_IN_PROGRESS: 'processing',
  PENDING_APPROVAL: 'processing',
  ACTIVE: 'info',
  PARTIALLY_ACTIVE: 'info',
  PAUSED: 'neutral',
  OUT_OF_STOCK: 'neutral',
  REJECTED: 'warn',
  SUSPENDED: 'warn',
  EXPIRED: 'warn',
  DELISTED: 'neutral',
};

const STATUSES = Object.keys(STATUS_TONE);

export function VendorListingsRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = React.useState(false);
  const status = params.get('status') ?? '';
  const grade = params.get('grade') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = 50;

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  if (grade) query.set('grade', grade);

  const { data, error } = useResource<Page<VendorListing>>(
    `${API.listings}?${query.toString()}`,
    'Listings unavailable',
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const columns = React.useMemo<ReadonlyArray<Column<VendorListing>>>(
    () => [
      {
        key: 'id',
        header: 'Listing',
        cell: (l) => (
          <>
            <span className="font-mono tnum text-ink">{l.id.slice(0, 8)}</span>
            <span className="mt-1 block font-mono text-body-sm text-ink-3">
              {l.sku?.skuCode ?? '—'}
            </span>
          </>
        ),
      },
      {
        key: 'machine',
        header: 'Machine',
        cell: (l) =>
          l.sku ? (
            <span className="text-body-sm text-ink">{machineTitle(l)}</span>
          ) : (
            <NotMeasured why="SKU missing" label="Unknown" />
          ),
      },
      {
        key: 'grade',
        header: 'Grade',
        cell: (l) => <GradeBadge grade={l.grade as Grade} variant="verified" />,
      },
      {
        key: 'units',
        header: 'Units',
        numeric: true,
        cell: (l) => (
          <span className="font-mono tnum">
            {l.qtyAvailable}/{l.qtyTotal}
          </span>
        ),
      },
      {
        key: 'ask',
        header: 'Ask',
        numeric: true,
        cell: (l) =>
          l.vendorAskPrice ? rupees(l.vendorAskPrice) : <span className="text-ink-4">—</span>,
      },
      {
        key: 'commission',
        header: 'Commission',
        cell: (l) =>
          l.commissionPct != null && l.commissionAmount ? (
            <span className="font-mono tnum text-ink">
              {l.commissionPct}% · {rupees(l.commissionAmount)}
            </span>
          ) : (
            <span className="text-ink-4">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (l) => (
          <StatusPill tone={STATUS_TONE[l.status] ?? 'neutral'} label={l.status.replaceAll('_', ' ')} />
        ),
      },
      {
        key: 'actions',
        header: '',
        headerHidden: true,
        cell: (l) => (
          <Link className="text-ink underline underline-offset-4" to={`/vendor/listings/${l.id}/reprice`}>
            Reprice
          </Link>
        ),
      },
    ],
    [],
  );

  if (error) {
    return <EmptyState title="Listings did not load" body={error} />;
  }

  const rows = data?.rows ?? [];
  const pageCount = data ? Math.ceil(data.total / data.pageSize) : 0;
  const onSale = rows.reduce((n, r) => n + r.qtyAvailable, 0);

  return (
    <div className="tg-stack">
      <HubPageHeader
        title="Listings"
        subtitle={
          data
            ? // `qtyAvailable` is what a buyer can actually order today, which is
              // what "on sale" means. `qtyTotal` includes units still in QC.
              `${data.total} created · ${onSale} unit${onSale === 1 ? '' : 's'} on sale`
            : undefined
        }
        actions={
          <>
            {/* The wizard is off the rail. The dialog is the one-screen path for
                a vendor who knows what they hold; the wizard is the four-step
                one for a batch with serials, and both start here. */}
            <Link
              className="text-body-sm text-acc-ink underline underline-offset-4"
              to="/vendor/listings/new"
            >
              List a batch
            </Link>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Create listing
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-4">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={[
            { value: '', label: 'All' },
            ...STATUSES.map((st) => ({ value: st, label: st.replaceAll('_', ' ').toLowerCase() })),
          ]}
        />
        <Select
          label="Grade"
          value={grade}
          onChange={(e) => setFilter('grade', e.target.value)}
          options={[
            { value: '', label: 'All' },
            ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) })),
          ]}
        />
      </div>

      <Board>
        <DataBoard
          caption={data ? `${data.total} listings` : 'Loading'}
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          loading={!data}
          skeletonRows={8}
          empty={
            <EmptyState
              title="No listings"
              body={status || grade ? 'Clear filters.' : 'Create one to start.'}
              action={
                status || grade ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    Create listing
                  </Button>
                )
              }
            />
          }
        />
      </Board>

      {data && pageCount > 1 && (
        <Pagination page={page} pageCount={pageCount} onPage={(p) => setFilter('page', String(p))} label="Pages" />
      )}

      <CreateListingDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
