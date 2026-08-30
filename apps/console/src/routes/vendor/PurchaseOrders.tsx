import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, DataBoard, EmptyState, StatusPill, type Column } from '@trugrade/ui';
import { Board, DateField, NotMeasured, PageHeader, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  PO_STATUSES,
  onDate,
  rupees,
  type Page,
  type PurchaseOrder,
} from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * Purchase orders **we** raised to this vendor — `03_UX_SPEC.md` §3B.3.
 *
 * The heading says so in as many words, because "orders" on a supplier's screen
 * reads as "orders my customers placed" and these are the opposite: their
 * counterparty on every row is us. A buyer exists on the other side of each one
 * and appears nowhere — not their name, not their GSTIN, not their order number,
 * not the price we sold at. There is no client-side hiding; the server's
 * response carries none of it.
 *
 * Filters live in the URL. A vendor forwarding "the four you have not accepted"
 * to a colleague is the case, and a filter that cannot be linked to cannot do it.
 */

/**
 * **A purchase-order status is not a verdict.**
 *
 * 09_FRONTEND_LOCKED §2 rule 2 reserves green and red for PASS and FAIL, so
 * neither appears here — a PO nobody has accepted yet is not a failure and a
 * paid one is not a test result. Three honest channels instead: `warn`
 * (outlined) for the two states that need the vendor to act, `processing` for
 * everything in flight, `info` — the amber wash, rule 1's "active state" — for
 * the one state where money is genuinely due, and neutral for the terminal
 * states, which carry their meaning in their own label as §9 requires anyway.
 */
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'processing'> = {
  RAISED: 'warn',
  ACKNOWLEDGED: 'processing',
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

export function VendorPurchaseOrdersRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const filtered = Boolean(status || from || to);

  const query = new URLSearchParams({ page: '1', pageSize: '50' });
  if (status) query.set('status', status);
  if (from) query.set('from', from);
  if (to) query.set('to', to);

  const { data, error } = useResource<Page<PurchaseOrder>>(
    `${API.purchaseOrders}?${query.toString()}`,
    'Your purchase orders are unavailable',
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const columns = React.useMemo<ReadonlyArray<Column<PurchaseOrder>>>(
    () => [
      {
        key: 'poNumber',
        header: 'PO',
        cell: (po) => (
          <span className="flex flex-wrap items-center gap-2">
            <Link
              className="font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/vendor/orders/${po.poId}`}
            >
              {po.poNumber}
            </Link>
            <StatusPill
              tone={STATUS_TONE[po.status] ?? 'neutral'}
              label={po.status.replaceAll('_', ' ')}
              className="whitespace-nowrap"
            />
          </span>
        ),
      },
      {
        key: 'raisedAt',
        header: 'Raised',
        cell: (po) => <span className="font-mono tnum text-ink-2">{onDate(po.raisedAt)}</span>,
      },
      { key: 'units', header: 'Machines', numeric: true, cell: (po) => po.units },
      {
        key: 'totalNet',
        header: 'PO value',
        numeric: true,
        cell: (po) => rupees(po.totalNet),
      },
      {
        key: 'tds',
        header: 'TDS on it',
        numeric: true,
        // A percentage is deliberately absent here: 09_FRONTEND_LOCKED requires
        // every percentage to carry its denominator, and a rate needs the base
        // it was struck on and the threshold it was measured against to mean
        // anything. Both are on the record screen, where there is room to say so.
        cell: (po) => <span className="text-ink-2">{rupees(po.tdsAmount)}</span>,
      },
      {
        key: 'deliverTo',
        header: 'Deliver to',
        cell: (po) =>
          po.deliverTo ? (
            <span className="text-ink-2">
              {po.deliverTo.city}, {po.deliverTo.state}
            </span>
          ) : (
            <NotMeasured
              why="The delivery address on this order could not be resolved"
              label="Destination unresolved"
            />
          ),
      },
      {
        key: 'acknowledged',
        header: 'Accepted',
        cell: (po) =>
          po.acknowledgedAt ? (
            <span className="font-mono tnum text-ink-2">{onDate(po.acknowledgedAt)}</span>
          ) : (
            // Never a dash and never a zero: an unaccepted PO is an outstanding
            // job, and a blank in this column would read as one already done.
            <NotMeasured why="You have not accepted this purchase order yet" label="Not accepted" />
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        headerHidden: true,
        cell: (po) => (
          <span className="flex justify-end gap-3">
            {/* Not amber. Fifty rows of amber links is a colour spent on
                everything and therefore marking nothing — the same reasoning the
                listings board records. Hover keeps the affordance. */}
            <Link
              className="text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/vendor/orders/${po.poId}`}
            >
              Open
            </Link>
            <Link
              className="text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/vendor/orders/${po.poId}/pick-list`}
            >
              Pick list
            </Link>
          </span>
        ),
      },
    ],
    [],
  );

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
      <PageHeader title="Purchase orders">
        These are orders <strong className="text-ink">we</strong> placed with you, not orders your
        customers placed with us. One is raised the moment a buyer pays for a machine you have
        listed, and it names the exact serials.
      </PageHeader>

      <div className="flex flex-wrap items-end gap-4">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={[
            { value: '', label: 'Every status' },
            ...PO_STATUSES.map((s) => ({
              value: s,
              label: s.replaceAll('_', ' ').toLowerCase(),
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
      </div>

      <Board>
        <DataBoard
          caption={
            data
              ? `${data.total} purchase ${data.total === 1 ? 'order' : 'orders'} match.`
              : 'Loading your purchase orders.'
          }
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(po) => po.poId}
          loading={!data}
          skeletonRows={6}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'No purchase orders yet'}
              body={
                filtered
                  ? 'You do have purchase orders — this filter has none. Clear it to see them.'
                  : 'A purchase order appears here the moment a buyer orders one of your live machines. We buy that serial from you and sell it on our own invoice, so the order you see is ours to you.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : (
                  <Link className="text-acc-ink underline underline-offset-4" to="/vendor/listings">
                    See your live stock
                  </Link>
                )
              }
            />
          }
        />
      </Board>
    </div>
  );
}
