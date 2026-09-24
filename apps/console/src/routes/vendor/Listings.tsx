import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  HubPageHeader,
  DataBoard,
  EmptyState,
  GradeBadge,
  Input,
  Pagination,
  StatusPill,
  cn,
  type Column,
} from '@trugrade/ui';
import { GRADES, type Grade } from '@trugrade/contracts';
import { Board, NotMeasured, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  gradeLabel,
  humanise,
  rupees,
  type ListingStatusBoard,
  type Page,
  type VendorListing,
} from './api';
import { machineTitle } from './ListingMachine';
import { CreateListingDialog } from './listings/CreateListingDialog';
import { useProfileGateOrRender } from './ProfileLockGate';

/** ARCHETYPE B — Board. Filter tiles + data table + row actions. */

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

/**
 * The four states a supplier actually manages by. Every other status is still
 * reachable through the pill on its row; these are the ones worth a tile.
 */
const TILES = [
  { status: '', label: 'All listings', dot: 'bg-ink-2' },
  { status: 'DRAFT', label: 'Draft', dot: 'bg-ink-4', meta: 'Not sent for QC yet' },
  { status: 'AWAITING_QC', label: 'Awaiting QC', dot: 'bg-ink-3', meta: 'We are testing the units' },
  // Amber: an active state, rule 1's third meaning.
  { status: 'ACTIVE', label: 'Active', dot: 'bg-acc', meta: 'Visible to buyers' },
] as const;

const SORTS = [
  { value: '', label: 'Newest first' },
  { value: 'model', label: 'Model A–Z' },
  { value: 'ask', label: 'Ask: high to low' },
  { value: 'units', label: 'Units: most first' },
] as const;

const units = (n: number): string => `${n} unit${n === 1 ? '' : 's'}`;

/** A live listing a buyer can see but cannot order: the one row that needs a price. */
const needsPrice = (l: VendorListing): boolean =>
  (l.status === 'ACTIVE' || l.status === 'PARTIALLY_ACTIVE') && l.vendorAskPrice === null;

/**
 * Search and sort happen over the page the server sent. The listings endpoint
 * takes status and grade and nothing else, so anything finer is done here, and
 * the caption says "on this page" whenever the page is not the whole set.
 */
function refine(rows: readonly VendorListing[], q: string, sort: string): VendorListing[] {
  const needle = q.trim().toLowerCase();
  const kept = needle
    ? rows.filter((l) =>
        [machineTitle(l), l.sku?.skuCode ?? '', l.id]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : [...rows];
  if (sort === 'model') kept.sort((a, b) => machineTitle(a).localeCompare(machineTitle(b)));
  if (sort === 'ask') kept.sort((a, b) => Number(b.vendorAskPrice ?? -1) - Number(a.vendorAskPrice ?? -1));
  if (sort === 'units') kept.sort((a, b) => b.qtyAvailable - a.qtyAvailable);
  return kept;
}

export function VendorListingsRoute(): React.JSX.Element {
  const gate = useProfileGateOrRender('listings', 'Listings');
  const [params, setParams] = useSearchParams();
  const [createOpen, setCreateOpen] = React.useState(false);
  const status = params.get('status') ?? '';
  const grade = params.get('grade') ?? '';
  const q = params.get('q') ?? '';
  const sort = params.get('sort') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = 50;

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  if (grade) query.set('grade', grade);

  const { data, error } = useResource<Page<VendorListing>>(
    `${API.listings}?${query.toString()}`,
    'Listings unavailable',
  );
  // The tiles count the whole stock, whatever the board is filtered to.
  const board = useResource<ListingStatusBoard>(API.bulkStatus, 'Listing counts unavailable');

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
        key: 'machine',
        header: 'Machine',
        // The row opens the listing. Without this the record — its serials, the
        // inspection request, the QC result — was reachable only by being
        // redirected to it immediately after creating one.
        cell: (l) => (
          <Link className="block text-ink" to={`/vendor/listings/${l.id}`}>
            <span className="whitespace-nowrap font-semibold underline-offset-4 hover:underline">
              {l.sku ? machineTitle(l) : <NotMeasured why="SKU missing" label="Unknown" />}
            </span>
            <span className="mt-1 block whitespace-nowrap font-mono text-body-sm tnum text-ink-2">
              {l.sku?.skuCode ?? '—'}
            </span>
            <span className="block font-mono text-body-sm tnum text-ink-4">#{l.id.slice(0, 8)}</span>
          </Link>
        ),
      },
      {
        key: 'grade',
        header: 'Grade',
        cell: (l) => <GradeBadge grade={l.grade as Grade} variant="verified" />,
      },
      {
        key: 'units',
        header: 'Units on sale',
        cell: (l) => {
          const pct = l.qtyTotal > 0 ? Math.round((l.qtyAvailable / l.qtyTotal) * 100) : 0;
          return (
            <span className="flex min-w-[96px] flex-col gap-1.5">
              <span className="font-mono tnum text-ink-2">
                <strong className="font-semibold text-ink">{l.qtyAvailable}</strong> of {l.qtyTotal}
              </span>
              {/* Amber: a measured value. */}
              <span className="block h-1 overflow-hidden rounded-xs bg-sheet-3" aria-hidden="true">
                <span className="block h-full bg-acc" style={{ width: `${pct}%` }} />
              </span>
            </span>
          );
        },
      },
      {
        key: 'ask',
        header: (
          <>
            Your ask
            <span className="block text-body-sm font-normal normal-case tracking-normal text-ink-3">
              per unit · what you receive
            </span>
          </>
        ),
        numeric: true,
        cell: (l) =>
          l.vendorAskPrice ? (
            rupees(l.vendorAskPrice)
          ) : (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-sans font-semibold text-warn">
              <span className="hub-sev hub-sev--warn !mr-0" aria-hidden="true" />
              No price set
            </span>
          ),
      },
      {
        // Headed with its denominator, which is the ask in the column beside it.
        key: 'commission',
        header: (
          <>
            Commission
            <span className="block text-body-sm font-normal normal-case tracking-normal text-ink-3">
              of your ask
            </span>
          </>
        ),
        numeric: true,
        cell: (l) =>
          l.commissionPct != null && l.commissionAmount ? (
            <span className="flex flex-col items-end">
              <span className="text-ink">{l.commissionPct}%</span>
              <span className="whitespace-nowrap text-body-sm text-ink-3">
                {rupees(l.commissionAmount)} · {units(l.qtyTotal)}
              </span>
            </span>
          ) : (
            <span className="text-ink-4">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (l) => (
          <StatusPill tone={STATUS_TONE[l.status] ?? 'neutral'} label={humanise(l.status)} />
        ),
      },
      {
        key: 'actions',
        header: 'Action',
        headerHidden: true,
        numeric: true,
        cell: (l) => (
          <Link
            className={cn(
              'inline-flex h-9 items-center whitespace-nowrap rounded border px-3 font-sans text-body-sm font-semibold',
              needsPrice(l)
                ? 'border-warn text-warn hover:bg-warn-wash'
                : 'border-rule bg-sheet text-ink hover:bg-sheet-2',
            )}
            to={`/vendor/listings/${l.id}/reprice`}
          >
            {needsPrice(l) ? 'Set price' : 'Reprice'}
          </Link>
        ),
      },
    ],
    [],
  );

  if (gate.locked) return gate.locked;

  if (error) {
    return <EmptyState title="Listings did not load" body={error} />;
  }

  const rows = data ? refine(data.rows, q, sort) : [];
  const pageCount = data ? Math.ceil(data.total / data.pageSize) : 0;
  const partial = data !== null && data.total > data.rows.length;
  const unpriced = data ? data.rows.filter(needsPrice) : [];
  const drafts = board.data?.counts.DRAFT ?? 0;
  const first = data && rows.length > 0 ? (data.page - 1) * data.pageSize + 1 : 0;

  return (
    <div className="hub-page">
      <HubPageHeader
        title="Listings"
        subtitle={
          board.data ? (
            <>
              <span className="font-mono tnum">{board.data.total}</span> listings ·{' '}
              <strong className="font-semibold text-ink">
                {/* `unitsOnSale` is what a buyer can actually order today, which
                    is what "on sale" means. `unitsTotal` includes units in QC. */}
                <span className="font-mono tnum">{board.data.unitsOnSale}</span> of{' '}
                <span className="font-mono tnum">{board.data.unitsTotal}</span> units
              </strong>{' '}
              on sale right now
            </>
          ) : undefined
        }
        actions={
          <>
            {/* The wizard is off the rail. The dialog is the one-screen path for
                a vendor who knows what they hold; the wizard is the four-step
                one for a batch with serials, and both start here. */}
            <Link className="hub-link text-body-sm" to="/vendor/listings/new">
              List a batch
            </Link>
            <Button variant="primary" size="lg" onClick={() => setCreateOpen(true)}>
              New listing
            </Button>
          </>
        }
      />

      <div
        className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        role="group"
        aria-label="Filter by status"
      >
        {TILES.map((tile) => {
          const pressed = status === tile.status;
          const count = board.data
            ? tile.status
              ? board.data.counts[tile.status]
              : board.data.total
            : null;
          const tileUnits = board.data
            ? tile.status
              ? board.data.units[tile.status]
              : board.data.unitsTotal
            : null;
          return (
            <button
              key={tile.status || 'all'}
              type="button"
              aria-pressed={pressed}
              onClick={() => setFilter('status', tile.status)}
              className={cn(
                'flex flex-col gap-1 rounded-lg border bg-sheet p-4 text-left transition-colors',
                pressed ? 'border-acc-dk ring-1 ring-inset ring-acc-dk' : 'border-rule hover:border-ink-3',
              )}
            >
              <span
                className={cn(
                  'hub-strip__label flex items-center gap-2',
                  pressed && 'text-acc-ink',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', tile.dot)} aria-hidden="true" />
                {tile.label}
              </span>
              {count === null ? (
                <span className="hub-strip__value hub-strip__value--none">Loading</span>
              ) : (
                <span className="hub-strip__value">{count}</span>
              )}
              <span className="hub-strip__sub">
                {tileUnits === null
                  ? ' '
                  : 'meta' in tile
                    ? `${units(tileUnits ?? 0)} · ${tile.meta}`
                    : `${units(tileUnits ?? 0)} in total`}
              </span>
            </button>
          );
        })}
      </div>

      {(unpriced.length > 0 || drafts > 0) && (
        <section
          className="hub-panel border-warn-line"
          aria-label="Needs your attention"
          data-testid="listings-attention"
        >
          <div className="flex items-center gap-2 bg-warn-wash px-5 py-3 text-body-sm font-semibold text-warn">
            <span className="hub-sev hub-sev--warn !mr-0" aria-hidden="true" />
            Needs your attention
          </div>
          <ul className="divide-y divide-rule-2">
            {unpriced.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-body-sm text-ink-2"
              >
                <span>
                  <strong className="font-semibold text-ink">
                    {machineTitle(l)} has no price.
                  </strong>{' '}
                  <span className="font-mono tnum">#{l.id.slice(0, 8)}</span>,{' '}
                  {units(l.qtyTotal)} — buyers cannot order it until you set one.
                </span>
                <Link className="hub-link whitespace-nowrap" to={`/vendor/listings/${l.id}/reprice`}>
                  Set price →
                </Link>
              </li>
            ))}
            {drafts > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-body-sm text-ink-2">
                <span>
                  <strong className="font-semibold text-ink">
                    <span className="font-mono tnum">{drafts}</span> draft{drafts === 1 ? '' : 's'}
                  </strong>{' '}
                  with <span className="font-mono tnum">{board.data?.units.DRAFT ?? 0}</span> units
                  not sent for QC. Units go on sale only after they pass.
                </span>
                <button
                  type="button"
                  className="hub-link whitespace-nowrap"
                  onClick={() => setFilter('status', 'DRAFT')}
                >
                  Review drafts →
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input
          className="min-w-[260px] flex-1"
          label="Search"
          type="search"
          placeholder="Model, SKU or listing ID"
          value={q}
          onChange={(e) => setFilter('q', e.target.value)}
        />
        <div
          className="inline-flex gap-0.5 rounded-lg bg-sheet-3 p-[3px]"
          role="group"
          aria-label="Grade"
        >
          {[{ value: '', label: 'All grades' }, ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) }))].map(
            (opt) => {
              const pressed = grade === opt.value;
              return (
                <button
                  key={opt.value || 'all'}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFilter('grade', opt.value)}
                  className={cn(
                    'h-10 min-w-11 rounded px-3 text-body-sm font-semibold',
                    pressed ? 'bg-sheet text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {opt.label}
                </button>
              );
            },
          )}
        </div>
        <Select
          label="Sort"
          value={sort}
          onChange={(e) => setFilter('sort', e.target.value)}
          options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
        />
      </div>

      <Board>
        <DataBoard
          caption={
            data
              ? `${rows.length} listings${partial ? ' on this page' : ''}, ${
                  SORTS.find((s) => s.value === sort)?.label.toLowerCase() ?? 'newest first'
                }`
              : 'Loading'
          }
          columns={columns}
          rows={rows}
          rowKey={(l) => l.id}
          rowClassName={(l) => (needsPrice(l) ? 'bg-warn-wash' : undefined)}
          loading={!data}
          skeletonRows={8}
          empty={
            <EmptyState
              title="No listings"
              body={status || grade || q ? 'Clear filters.' : 'Create one to start.'}
              action={
                status || grade || q ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    New listing
                  </Button>
                )
              }
            />
          }
        />
        {data && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3 text-body-sm text-ink-2">
            <span>
              Showing{' '}
              <span className="font-mono tnum text-ink">
                {first}–{first + rows.length - 1}
              </span>{' '}
              of <span className="font-mono tnum text-ink">{data.total}</span> listings
            </span>
            <span className="text-body-sm text-ink-3">
              Your ask is what you receive per unit when it sells, before the deductions itemised on
              your payout.
            </span>
          </div>
        )}
      </Board>

      {data && pageCount > 1 && (
        <Pagination
          className="mt-4"
          page={page}
          pageCount={pageCount}
          onPage={(p) => setFilter('page', String(p))}
          label="Pages"
        />
      )}

      <CreateListingDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
