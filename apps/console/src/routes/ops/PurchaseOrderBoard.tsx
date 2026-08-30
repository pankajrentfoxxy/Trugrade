import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Button,
  DataBoard,
  EmptyState,
  Input,
  Pagination,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { Board, DateField, NotMeasured, PageHeader, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { humanise, onDate, OPS_API, PO_TONE, rupees, type OpsPoBoard, type OpsPoRow } from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Every purchase order we have raised, across every supply point —
 * `03_UX_SPEC.md` §3C.4.
 *
 * **The buyer's order number is on every row, and that is what makes this
 * screen different from the vendor's.** T32 deliberately withheld it from
 * `/vendor/orders`: purchase orders and order numbers are both sequential, and
 * a vendor holding two of their own a fortnight apart could subtract our order
 * volume out of the difference. Nobody outside this building can reach this
 * route, and the link between a purchase and the sale that caused it is exactly
 * the question support is on the phone about.
 *
 * **No acceptance deadline exists in this product, so no row is late.** There is
 * no `platform_config` key for one and no penalty rule behind one. The board
 * shows how long a purchase order has been waiting, because that is a real
 * measurement, and it never calls it overdue — inventing 24 hours would put a
 * promise on a supplier that nobody made.
 */

function boardQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ['q', 'status', 'vendor', 'from', 'to', 'sort', 'page'] as const) {
    const value = params.get(key);
    if (value) q.set(key, value);
  }
  q.set('per', '25');
  return q.toString();
}

export function OpsPurchaseOrderBoardRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const vendor = params.get('vendor') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const page = Number(params.get('page') ?? '1');
  const filtered = Boolean(q || status || vendor || from || to);

  const [typed, setTyped] = React.useState(q);
  React.useEffect(() => setTyped(q), [q]);

  const { data, error } = useResource<OpsPoBoard>(
    `${OPS_API.purchaseOrders}?${boardQuery(params)}`,
    'The purchase-order board is unavailable',
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const columns = React.useMemo<ReadonlyArray<Column<OpsPoRow>>>(
    () => [
      {
        key: 'poNumber',
        header: 'Purchase order',
        cell: (po) => (
          <span className="flex flex-col gap-1">
            <span className="whitespace-nowrap font-mono tnum text-ink">{po.poNumber}</span>
            {po.matchedSerials.length > 0 && (
              <span className="text-body-sm text-ink-3">
                matched on{' '}
                <span className="whitespace-nowrap font-mono tnum text-ink-2">
                  {po.matchedSerials.join(', ')}
                </span>
              </span>
            )}
          </span>
        ),
      },
      {
        // Its own column, as on the order board and for the same reason: sharing
        // a cell, ACKNOWLEDGED wrapped under the number and doubled the row.
        key: 'status',
        header: 'Status',
        cell: (po) => (
          <StatusPill
            tone={PO_TONE[po.status] ?? 'neutral'}
            label={humanise(po.status)}
            className="whitespace-nowrap"
          />
        ),
      },
      {
        key: 'vendor',
        header: 'Supply point',
        cell: (po) =>
          po.vendorLegalName ?? (
            <NotMeasured
              why="The supplier organisation on this purchase order could not be resolved"
              label="Unresolved"
            />
          ),
      },
      {
        key: 'orderNumber',
        header: 'For order',
        cell: (po) =>
          po.orderNumber ? (
            <Link
              className="whitespace-nowrap font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/orders/${po.orderNumber}`}
            >
              {po.orderNumber}
            </Link>
          ) : (
            <NotMeasured
              why="The order this purchase order was raised for could not be resolved"
              label="Order unresolved"
            />
          ),
      },
      {
        key: 'raisedAt',
        header: 'Raised',
        cell: (po) => <span className="font-mono tnum text-ink-2">{onDate(po.raisedAt)}</span>,
      },
      { key: 'lines', header: 'Machines', numeric: true, cell: (po) => po.lines },
      { key: 'totalNet', header: 'We pay', numeric: true, cell: (po) => rupees(po.totalNet) },
      {
        key: 'tds',
        header: 'TDS on it',
        numeric: true,
        // No rate here on purpose. Every percentage carries its denominator, and
        // a TDS rate needs both the base it was struck on and the ₹50 lakh
        // threshold it was measured against. Both live on the payables screen.
        cell: (po) => <span className="text-ink-2">{rupees(po.tdsAmount)}</span>,
      },
      {
        key: 'accepted',
        header: 'Accepted',
        cell: (po) =>
          po.acknowledgedAt ? (
            <span className="font-mono tnum text-ink-2">{onDate(po.acknowledgedAt)}</span>
          ) : (
            <span className="flex flex-col gap-1">
              <NotMeasured
                why="The supply point has not accepted this purchase order yet"
                label="Not accepted"
              />
              {po.waitingHours !== null && (
                // "Waiting", never "late" — there is no acceptance window in
                // this product, so there is no deadline to be past.
                <span className="text-body-sm text-ink-3">
                  waiting <span className="font-mono tnum">{po.waitingHours}</span> h
                </span>
              )}
            </span>
          ),
      },
    ],
    [],
  );

  if (error) {
    return (
      <EmptyState
        title="The purchase-order board did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  return (
    <div className="tg-stack">
      <PageHeader title="Purchase orders">
        Every purchase order we have raised, across every supply point. One is written inside the
        order-confirmation transaction and names the exact serials — nothing on this screen creates
        or cancels one.
      </PageHeader>

      {/* Two rows, not one — see `OrderBoard.tsx` for why. */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', typed.trim());
        }}
      >
        <div className="max-w-xl">
          <Input
            label="Search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setFilter('q', typed.trim())}
            placeholder="PO-26-00007, TT-26-00004, a serial…"
            hint={
              data?.searchedFor
                ? `Compared against ${data.searchedFor.join(', ')}.`
                : 'One box over the purchase-order number, the order number that caused it, and a serial on one of its lines.'
            }
          />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            options={[
              { value: '', label: 'Every status' },
              ...(data?.facets.status ?? []).map((f) => ({
                value: f.value,
                label: `${f.label} (${f.count})`,
              })),
            ]}
          />
          <Select
            label="Supply point"
            value={vendor}
            onChange={(e) => setFilter('vendor', e.target.value)}
            options={[
              { value: '', label: 'Every supply point' },
              ...(data?.facets.vendor ?? []).map((f) => ({
                value: f.value,
                label: `${f.label} (${f.count})`,
              })),
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
          <Select
            label="Sort"
            value={sort}
            onChange={(e) => setFilter('sort', e.target.value)}
            options={[
              { value: 'recent', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'value', label: 'Largest first' },
              { value: 'value_asc', label: 'Smallest first' },
            ]}
          />
        </div>
      </form>

      <Board
        toolbar={
          data && (
            // The whole filtered set, not the page. A total under a paginated
            // board that silently meant "this page" is the defect T28 logged.
            <p className="text-body-sm text-ink-2">
              <span className="font-mono tnum text-ink">{data.total}</span> purchase{' '}
              {data.total === 1 ? 'order' : 'orders'} ·{' '}
              <span className="font-mono tnum text-ink">{rupees(data.totals.value)}</span> to pay
              across <span className="font-mono tnum text-ink">{data.totals.machines}</span>{' '}
              {data.totals.machines === 1 ? 'machine' : 'machines'} ·{' '}
              <span className="font-mono tnum text-ink">{rupees(data.totals.tds)}</span> TDS accrued
            </p>
          )
        }
      >
        <DataBoard
          caption={
            data
              ? `${data.total} purchase ${data.total === 1 ? 'order' : 'orders'} match, newest first.`
              : 'Loading the purchase-order board.'
          }
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(po) => po.poId}
          loading={!data}
          skeletonRows={8}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'No purchase order has been raised'}
              body={
                filtered
                  ? 'Purchase orders do exist — this filter has none of them. The box matches anywhere inside a value, so a partial serial does find its purchase order; a wrong character or a stray space does not.'
                  : 'A purchase order is written inside the order-confirmation transaction, so none here means no order has reached confirmation.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : (
                  <Link className="text-acc-ink underline underline-offset-4" to="/orders">
                    Open the order board
                  </Link>
                )
              }
            />
          }
        />
      </Board>

      {data && data.pages > 1 && (
        <Pagination
          page={page}
          pageCount={data.pages}
          onPage={(next) => setFilter('page', String(next))}
          label="Purchase-order board pages"
        />
      )}
    </div>
  );
}
