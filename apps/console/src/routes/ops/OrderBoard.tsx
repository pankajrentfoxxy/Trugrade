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
import { Board, NotMeasured, PageHeader, Select } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import {
  APPROVAL_TONE,
  humanise,
  onDate,
  OPS_API,
  ORDER_TONE,
  partyLine,
  PAYMENT_TONE,
  rupees,
  type OpsOrderBoard,
  type OpsOrderRow,
} from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Every order on the platform — `03_UX_SPEC.md` §3C.4.
 *
 * **One box over seven identifiers.** §3C.4 asks for search by order number, PO
 * number, serial, seal code, GSTIN, buyer name and mobile, and the box takes all
 * seven without asking which one you have. T20 settled that for the buyer's
 * board and the reasoning is stronger here: the person typing is on the phone to
 * a customer who is reading a number off a sticker. The box **matches** — it
 * never parses — and the board prints what it compared against, so nobody
 * concludes it does not take seal codes because theirs found nothing.
 *
 * **A row says why it matched.** A seal-code search landing on a row with no
 * seal column reads as a bug, so the value that produced the match is printed on
 * the row.
 *
 * **Read-only, and the screen says so rather than showing a dead button.**
 * §3C.4 asks for cancel-with-reason, reallocate-a-unit and force-progress. All
 * three are transactions — cancelling releases units back to sellable, reverses
 * the purchase order, the payable and the TDS accrual — and no service in this
 * codebase performs any of them. A control that looks live and is not is the
 * dead-control pattern this build keeps finding; the honest form is its absence,
 * named.
 */

function boardQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ['q', 'status', 'payment', 'approval', 'sort', 'page'] as const) {
    const value = params.get(key);
    if (value) q.set(key, value);
  }
  q.set('per', '25');
  return q.toString();
}

export function OpsOrderBoardRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  // Board state lives in the URL, all of it: an ops manager forwarding "the six
  // waiting on payment" to a colleague is the case, and the dashboard's tiles
  // are links into exactly these filters.
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const payment = params.get('payment') ?? '';
  const approval = params.get('approval') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const page = Number(params.get('page') ?? '1');
  const filtered = Boolean(q || status || payment || approval);

  // The box is debounced locally so a filter does not refetch per keystroke, but
  // the URL is still the source of truth — Enter and blur both commit it.
  const [typed, setTyped] = React.useState(q);
  React.useEffect(() => setTyped(q), [q]);

  const { data, error } = useResource<OpsOrderBoard>(
    `${OPS_API.orders}?${boardQuery(params)}`,
    'The order board is unavailable',
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change returns to page 1: a kept page number on a smaller
    // result set lands on an empty board that looks like a broken filter.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  // Whether the purchase-order count may be a link at all.
  //
  // `procurement.po.read_any` is a DIFFERENT permission from the one guarding
  // this screen, and SUPPORT — whose board this is, per §3C.4 — does not hold
  // it. A link that 403s for the very role the screen exists for is the
  // dead-control pattern this build keeps finding, so the count stays a number
  // for them and becomes a link for everyone who can open it.
  const { principal } = useAuth();
  const canOpenPos = principal?.permissions.includes('procurement.po.read_any') ?? false;

  const columns = React.useMemo<ReadonlyArray<Column<OpsOrderRow>>>(
    () => [
      {
        key: 'orderNumber',
        header: 'Order',
        cell: (o) => (
          <span className="flex flex-col gap-1">
            <Link
              className="whitespace-nowrap font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/orders/${o.orderNumber}`}
            >
              {o.orderNumber}
            </Link>
            {o.matchedOn.length > 0 && (
              // Why this row is in the result. Without it, a seal-code search
              // lands on a board with no seal column and reads as a mistake.
              <span className="text-body-sm text-ink-3">
                matched on{' '}
                {o.matchedOn.map((m, i) => (
                  <React.Fragment key={`${m.kind}-${m.value}`}>
                    {i > 0 && ', '}
                    <span
                      className={
                        // Nowrap on the identifiers: a seal code broken across
                        // two lines is a value nobody can read back over a phone.
                        m.kind === 'serial' || m.kind === 'seal'
                          ? 'whitespace-nowrap font-mono tnum text-ink-2'
                          : 'text-ink-2'
                      }
                    >
                      {m.value}
                    </span>
                  </React.Fragment>
                ))}
              </span>
            )}
          </span>
        ),
      },
      {
        // Its own column rather than a chip beside the order number. Sharing a
        // cell, "PAYMENT PENDING" wrapped to a second line on six of thirteen
        // rows, which doubles a 34px compact row for no information gained.
        key: 'status',
        header: 'Status',
        cell: (o) => (
          <StatusPill
            tone={ORDER_TONE[o.status] ?? 'neutral'}
            label={humanise(o.status)}
            className="whitespace-nowrap"
          />
        ),
      },
      {
        key: 'buyer',
        header: 'Buyer',
        cell: (o) =>
          o.buyer ? (
            <span className="text-ink-2">{partyLine(o.buyer)}</span>
          ) : (
            <NotMeasured
              why="The organisation on this order could not be resolved"
              label="Buyer unresolved"
            />
          ),
      },
      {
        key: 'placedAt',
        header: 'Placed',
        cell: (o) => <span className="font-mono tnum text-ink-2">{onDate(o.placedAt)}</span>,
      },
      {
        key: 'payment',
        header: 'Payment',
        cell: (o) => (
          <StatusPill
            tone={PAYMENT_TONE[o.paymentStatus] ?? 'neutral'}
            label={humanise(o.paymentStatus)}
            className="whitespace-nowrap"
          />
        ),
      },
      { key: 'units', header: 'Machines', numeric: true, cell: (o) => o.units },
      {
        key: 'pos',
        header: 'POs raised',
        numeric: true,
        cell: (o) =>
          o.purchaseOrders > 0 ? (
            canOpenPos ? (
              <Link
                className="whitespace-nowrap font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
                to={`/procurement/pos?q=${encodeURIComponent(o.orderNumber)}`}
              >
                {o.purchaseOrders}
              </Link>
            ) : (
              <span className="whitespace-nowrap font-mono tnum text-ink-2">
                {o.purchaseOrders}
              </span>
            )
          ) : (
            // **Never a bare 0 here.** On a DISPATCHED or DELIVERED row it means
            // we shipped a machine with no record of buying it, and a zero in a
            // numeric column reads as a measured, unremarkable value.
            <NotMeasured
              why="No purchase order was ever raised for this order, so what we paid for its machines is not recorded"
              label="None raised"
            />
          ),
      },
      {
        key: 'grandTotal',
        header: 'Order value',
        numeric: true,
        cell: (o) => rupees(o.grandTotal),
      },
      {
        key: 'approval',
        header: 'Approval',
        cell: (o) =>
          o.approval === null ? (
            <span className="text-ink-3">Not required</span>
          ) : (
            <span className="flex flex-col gap-1">
              <StatusPill
                // A breached approval deadline is `warn`, never `fail`: the
                // deadline is one WE set on the buyer's own approver and letting
                // it lapse is our failure, not a verdict on anybody. A decided
                // approval — approved OR rejected — is terminal and neutral.
                tone={
                  o.approval.breached ? 'warn' : (APPROVAL_TONE[o.approval.status] ?? 'neutral')
                }
                label={humanise(o.approval.status)}
                className="whitespace-nowrap"
              />
              <span className="font-mono tnum text-body-sm text-ink-3">
                {onDate(o.approval.expiresAt)}
              </span>
            </span>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        headerHidden: true,
        cell: (o) => (
          // Not amber. Twenty-five rows of amber links is a colour spent on
          // everything and therefore marking nothing.
          <span className="flex justify-end">
            <Link
              className="text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/orders/${o.orderNumber}`}
            >
              Open
            </Link>
          </span>
        ),
      },
    ],
    [canOpenPos],
  );

  if (error) {
    return (
      <EmptyState
        title="The order board did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  return (
    <div className="tg-stack">
      <PageHeader title="Orders">
        Every order on the platform. This is the only place the buyer’s side and the purchase orders
        we raised against it appear together, so it is staff-only — open a row to see both.
      </PageHeader>

      {/* Two rows, not one. `items-end` on a single row aligns the BOTTOM of
          each control, and the search box is taller than a select by exactly the
          height of its hint — so the input floated a line above the selects it
          was meant to sit beside. The box also earns its own row: it is the
          control an operator on the phone reaches for first. */}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', typed.trim());
        }}
      >
        {/* The wrapper carries the width: `Input`'s own `className` lands on the
            `<input>`, and the label and hint sit in a wrapper that would not
            grow with it. */}
        <div className="max-w-xl">
          <Input
            label="Search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setFilter('q', typed.trim())}
            placeholder="TT-26-00004, a serial, a seal code, a GSTIN…"
            hint={
              data?.searchedFor
                ? `Compared against ${data.searchedFor.join(', ')}.`
                : 'One box over the order number, the buyer’s own PO reference, a serial, a seal code, the buyer’s name, their GSTIN and the mobile it was placed from.'
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
            label="Payment"
            value={payment}
            onChange={(e) => setFilter('payment', e.target.value)}
            options={[
              { value: '', label: 'Any payment state' },
              ...(data?.facets.payment ?? []).map((f) => ({
                value: f.value,
                label: `${f.label} (${f.count})`,
              })),
            ]}
          />
          <Select
            label="Approval"
            value={approval}
            onChange={(e) => setFilter('approval', e.target.value)}
            options={[
              { value: '', label: 'Any' },
              { value: 'pending', label: 'Held for a buyer’s approver' },
            ]}
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

      <Board>
        <DataBoard
          caption={
            data
              ? `${data.total} ${data.total === 1 ? 'order' : 'orders'} match, newest first.`
              : 'Loading the order board.'
          }
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(o) => o.orderNumber}
          loading={!data}
          skeletonRows={8}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'No orders yet'}
              body={
                filtered
                  ? 'Orders do exist — this filter has none of them. The box matches anywhere inside a value, so a partial serial does find its order; a wrong character or a stray space does not.'
                  : 'An order appears here the moment a buyer completes checkout. Nothing has gone wrong.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : undefined
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
          label="Order board pages"
        />
      )}
    </div>
  );
}
