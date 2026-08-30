'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  DataBoard,
  EmptyState,
  Pagination,
  StatusPill,
  type Column,
  type SortDirection,
} from '@trugrade/ui';
import { Money } from '@trugrade/contracts';
import type { ApiFailure } from '../../register/api';
import { inIst } from '../../../lib/deadline';
import {
  getOrders,
  type OrderFacetOption,
  type OrderList,
  type OrderSummary,
} from '../api';

/**
 * The order board. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash — but the
 * board's state is not client state: it arrives as `query` from the server,
 * which read it off the URL, and every control here pushes the router rather
 * than setting anything. Reproducing the screen from the address bar alone is
 * the requirement; holding none of it locally is what makes that true.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

/** Parameters that are not filters, so they never appear as an applied chip. */
const NOT_A_FILTER = new Set(['sort', 'page', 'per']);

/**
 * Sorting a board is a change of order, not a change of question, so there are
 * four options and both directions of each are addressable — a link to
 * "cheapest first" has to survive being sent to somebody.
 */
const SORTS = [
  { value: 'recent', label: 'Most recently placed' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'value', label: 'Order value, high to low' },
  { value: 'value_asc', label: 'Order value, low to high' },
] as const;

const SORT_LABEL = (value: string): string =>
  SORTS.find((s) => s.value === value)?.label ?? SORTS[0].label;

/** Which column carries which sort, so a header arrow and the URL agree. */
const COLUMN_SORT: Record<string, { asc: string; desc: string }> = {
  order: { asc: 'oldest', desc: 'recent' },
  value: { asc: 'value_asc', desc: 'value' },
};

const sortState = (sort: string): { key: string; direction: SortDirection } | undefined => {
  for (const [key, pair] of Object.entries(COLUMN_SORT)) {
    if (sort === pair.asc) return { key, direction: 'asc' };
    if (sort === pair.desc) return { key, direction: 'desc' };
  }
  return undefined;
};

const PER_PAGE = [10, 25, 50] as const;

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; list: OrderList };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your orders just now. That is our problem, not yours — the orders themselves are unaffected.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function OrdersBoard({ query }: { query: string }): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const params = React.useMemo(() => new URLSearchParams(query), [query]);

  React.useEffect(() => {
    let live = true;
    setPhase({ k: 'loading' });
    void (async () => {
      const result = await getOrders(query);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', list: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [query]);

  /**
   * Write through to the URL. `push`, not `replace`: a filter is a place a
   * buyer navigated to, and back must undo it. The page resets, because page 4
   * of a different result set is not the page they were looking at.
   */
  const commit = React.useCallback(
    (next: URLSearchParams, { keepPage = false } = {}): void => {
      if (!keepPage) next.delete('page');
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      // The cast is on the ONE line that builds it.
      router.push((qs ? `/account/orders?${qs}` : '/account/orders') as Route, { scroll: false });
    },
    [router],
  );

  const setValue = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    commit(next);
  };

  const href = (key: string, value: string): Route => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    return `/account/orders?${next.toString()}` as Route;
  };

  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const list = phase.k === 'ready' ? phase.list : null;
  const sort = params.get('sort') ?? 'recent';
  const applied = [...params.entries()].filter(
    ([k, v]) => !NOT_A_FILTER.has(k) && v !== '',
  );

  return (
    <>
      <div className="wshead obhead">
        <h1>Your orders</h1>
        <p>
          Every order your organisation has placed with us. Search by our order number, by your own
          PO reference, or by the serial number of one machine.
        </p>
      </div>

      <div className="cols">
        <Rail
          params={params}
          applied={applied}
          facets={list?.facets ?? null}
          onSet={setValue}
          onClear={() => commit(new URLSearchParams())}
        />

        <main>
          <div className="rbar">
            <span className="cnt">
              {list === null ? (
                <span className="ink4">Counting your orders…</span>
              ) : (
                <>
                  <b className="mono">{list.total.toLocaleString('en-IN')}</b> order
                  {list.total === 1 ? '' : 's'}
                  {applied.length > 0 && (
                    <>
                      {' '}
                      {list.total === 1 ? 'matches' : 'match'}{' '}
                      {applied.length === 1 ? 'that filter' : 'those filters'}
                    </>
                  )}
                </>
              )}
            </span>
            <div className="r">
              <label htmlFor="osort">Sort</label>
              <select
                id="osort"
                value={sort}
                onChange={(e) => setValue('sort', e.target.value)}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {list !== null && list.total === 0 ? (
            <Nothing applied={applied.length > 0} onClear={() => commit(new URLSearchParams())} />
          ) : (
            <div className="tbl oboard">
              <DataBoard
                caption={
                  list === null
                    ? 'Loading your orders.'
                    : `${list.orders.length} order${list.orders.length === 1 ? '' : 's'} on this page of ${list.total}, sorted by ${SORT_LABEL(sort).toLowerCase()}.`
                }
                columns={COLUMNS}
                rows={list?.orders ?? []}
                rowKey={(o) => o.orderNumber}
                loading={list === null}
                skeletonRows={8}
                sort={sortState(sort)}
                onSort={(key) => {
                  const pair = COLUMN_SORT[key];
                  if (!pair) return;
                  setValue('sort', sort === pair.desc ? pair.asc : pair.desc);
                }}
              />
            </div>
          )}

          {list !== null && list.total > 0 && (
            <div className="pager">
              {list.pages <= 1 ? (
                <p className="shown">
                  Showing {list.total === 1 ? 'the only' : 'all'}{' '}
                  <b className="mono">{list.total}</b> order{list.total === 1 ? '' : 's'}
                </p>
              ) : (
                <p className="shown">
                  Page <b className="mono">{list.page}</b> of <b className="mono">{list.pages}</b> ·{' '}
                  <b className="mono">{list.total}</b> orders
                </p>
              )}
              <Pagination
                page={list.page}
                pageCount={list.pages}
                hrefFor={(target) => href('page', String(target))}
                onPage={(target) => {
                  const next = new URLSearchParams(params);
                  next.set('page', String(target));
                  commit(next, { keepPage: true });
                }}
                label="Order board pages"
              />
              <div className="perpage">
                <label htmlFor="oper">Per page</label>
                <select
                  id="oper"
                  value={String(list.per)}
                  onChange={(e) => setValue('per', e.target.value)}
                >
                  {PER_PAGE.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

/* ==========================================================================
 * The columns
 * ======================================================================== */

const NONE_GIVEN = <span className="notmeasured">None given</span>;

/**
 * Seven columns.
 *
 * Storefront density is comfortable, so every column costs 40px of gutter
 * before it holds anything. Facts that qualify another fact ride in its cell
 * rather than taking a column of their own: the date under the order number,
 * the city under the site, the deadline under the status.
 *
 * There is no dispatch-point column. The count of warehouses behind an order
 * is a real fact and it is on the order screen, where the machines are named
 * beneath it; as a bare number in a list column it is a per-order supplier
 * count with nothing on screen to give it meaning.
 */
const COLUMNS: ReadonlyArray<Column<OrderSummary>> = [
  {
    key: 'order',
    header: 'Order',
    sortable: true,
    cell: (o) => (
      <span className="obord">
        <a className="mono" href={`/orders/${o.orderNumber}`}>
          {o.orderNumber}
        </a>
        <span className="obwhen">{inIst(o.placedAt)}</span>
        {/* Why this row is in a serial search. A result with no visible reason
            reads as a mistake. */}
        {o.matchedSerials.length > 0 && (
          <span className="obhit">
            matched {o.matchedSerials.join(', ')}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (o) => {
      const state = statusOf(o);
      return (
        <span className="obord">
          <StatusPill tone={state.tone} label={state.label} />
          {/* The one deadline this product imposes on a buyer. Stated as the
              instant, not as a ticking clock — a board is read down a column,
              and ten counters racing each other is noise, not information. */}
          {o.approval?.status === 'PENDING' && (
            <span className="obdue">held until {inIst(o.approval.expiresAt)}</span>
          )}
        </span>
      );
    },
  },
  {
    key: 'machines',
    header: 'Machines',
    numeric: true,
    cell: (o) => <span className="mono">{o.unitsAllocated}</span>,
  },
  {
    key: 'site',
    header: 'Delivery site',
    cell: (o) => (
      <span className="obsite">
        {o.deliverySiteLabel ?? <span className="notmeasured">Site no longer on your account</span>}
        {o.deliveryCity && <span>{o.deliveryCity}</span>}
      </span>
    ),
  },
  {
    key: 'po',
    header: 'Your PO reference',
    // An absence renders as an absence. An empty cell reads as a recorded
    // value, and this one prints on our invoice.
    cell: (o) => (o.buyerPoNumber ? <span className="mono">{o.buyerPoNumber}</span> : NONE_GIVEN),
  },
  {
    key: 'value',
    header: 'Order value',
    numeric: true,
    sortable: true,
    cell: (o) => (
      <span className="money">
        {rupees(o.grandTotal)}
        <small>incl. GST</small>
      </span>
    ),
  },
  {
    key: 'action',
    header: 'Open',
    headerHidden: true,
    cell: (o) => (
      <a className="sel gh" href={`/orders/${o.orderNumber}`}>
        Open
      </a>
    ),
  },
];

/**
 * The pill.
 *
 * `warn` on a live approval because it is a genuine hold-up somebody has to act
 * on. Neutral everywhere else: green and red are PASS and FAIL, and an order
 * state is neither a pass nor a failure. This is `OrderRecord.statusOf` said
 * again over the list's narrower payload — the same words for the same facts,
 * because a board and a record that disagree about a status is worse than
 * either being wrong alone.
 */
function statusOf(order: OrderSummary): { tone: 'neutral' | 'warn'; label: string } {
  const approval = order.approval;
  if (approval?.status === 'PENDING') return { tone: 'warn', label: 'Awaiting approval' };
  if (approval?.status === 'REJECTED') return { tone: 'neutral', label: 'Approval declined' };
  if (approval?.status === 'EXPIRED') return { tone: 'neutral', label: 'Approval expired' };
  if (order.status === 'PAYMENT_PENDING')
    return { tone: 'neutral', label: 'Placed · payment pending' };
  return { tone: 'neutral', label: order.status.replace(/_/g, ' ').toLowerCase() };
}

/* ==========================================================================
 * The rail
 * ======================================================================== */

/**
 * Two facets, and only two, because two is what this product can honestly
 * filter an order list on: the status it is in and the site it goes to.
 *
 * A zero-count option is DISABLED and dimmed, never removed —
 * 09_FRONTEND_LOCKED.md §6 is explicit that disappearing options make people
 * think the site is broken. The counts arrive computed with every OTHER filter
 * applied but not the group's own, so ticking a status leaves the sites
 * countable.
 */
function Rail({
  params,
  applied,
  facets,
  onSet,
  onClear,
}: {
  params: URLSearchParams;
  applied: ReadonlyArray<[string, string]>;
  facets: OrderList['facets'] | null;
  onSet: (key: string, value: string) => void;
  onClear: () => void;
}): React.JSX.Element {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const q = params.get('q') ?? '';

  return (
    <div className="railzone">
      {/* Under 900px the rail is a full-screen sheet behind this button. It is
          hidden on desktop by CSS, never by a resize listener in JavaScript. */}
      <button
        type="button"
        className="fsheetbtn"
        onClick={() => setSheetOpen(true)}
        aria-expanded={sheetOpen}
        aria-controls="order-filters"
      >
        Filters {applied.length > 0 && <span className="mono">({applied.length})</span>}
      </button>

      <aside
        id="order-filters"
        className={sheetOpen ? 'filters open' : 'filters'}
        aria-label="Order filters"
      >
        <div className="fhead">
          <b>Filters</b>
          <span className="n mono">{applied.length} applied</span>
          <button type="button" className="clr" onClick={onClear} disabled={applied.length === 0}>
            Clear all
          </button>
          <button type="button" className="fclose" onClick={() => setSheetOpen(false)}>
            <span aria-hidden="true">&times;</span>
            <span className="sr-only">Close filters</span>
          </button>
        </div>

        {/*
          A real `<form>` with a submit button, not a debounced input. An order
          number is typed in full and then looked for; re-running the query on
          every keystroke of "TT-26-000" would show four wrong boards on the way
          to the right one.
        */}
        <form
          className="obsearch"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get('q');
            onSet('q', typeof value === 'string' ? value.trim() : '');
          }}
        >
          <label htmlFor="oq">Find an order</label>
          <div className="obrow">
            <input
              id="oq"
              name="q"
              type="search"
              // `key` so a cleared or shared URL resets the box: an
              // uncontrolled input keeps whatever was typed into it across a
              // navigation, and a board whose search field disagrees with its
              // results is the specific failure the URL rule exists to stop.
              key={q}
              defaultValue={q}
              placeholder="TT-26-00004"
              autoComplete="off"
            />
            <button type="submit" className="sel gh">
              Find
            </button>
          </div>
          <p className="d">
            One box over three numbers: our order number, your own PO reference, or the serial of
            one machine.
          </p>
        </form>

        {applied.length > 0 && (
          <div className="applied">
            {applied.map(([k, v]) => (
              <button key={`${k}=${v}`} type="button" className="ftag" onClick={() => onSet(k, '')}>
                {chipLabel(facets, k, v)} <i aria-hidden="true">&times;</i>
                <span className="sr-only">Remove filter</span>
              </button>
            ))}
          </div>
        )}

        <details open>
          <summary>Status</summary>
          <div className="fbody">
            <Options
              options={facets?.status ?? null}
              selected={params.get('status')}
              onPick={(v) => onSet('status', v)}
            />
          </div>
        </details>

        <details open>
          <summary>Delivery site</summary>
          <div className="fbody">
            <Options
              options={facets?.site ?? null}
              selected={params.get('site')}
              onPick={(v) => onSet('site', v)}
            />
          </div>
        </details>

        <div className="fdone">
          <button type="button" onClick={() => setSheetOpen(false)}>
            Show these orders
          </button>
        </div>
      </aside>

      {sheetOpen && (
        <button
          type="button"
          className="fscrim"
          aria-label="Close filters"
          onClick={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * One facet group. Radio behaviour rather than checkbox, because an order has
 * exactly one status and goes to exactly one site — a list of checkboxes would
 * promise an OR the server does not offer.
 */
function Options({
  options,
  selected,
  onPick,
}: {
  options: readonly OrderFacetOption[] | null;
  selected: string | null;
  onPick: (value: string) => void;
}): React.JSX.Element {
  // Not "no options": we have not read them yet, and a facet group that
  // rendered empty while loading would say the dimension does not exist.
  if (options === null) return <p className="fnote">Counting…</p>;
  if (options.length === 0) {
    return <p className="fnote">Nothing on your account has one of these yet.</p>;
  }

  return (
    <>
      {options.map((o) => {
        const on = selected === o.value;
        const empty = o.count === 0 && !on;
        return (
          <label key={o.value} className={empty ? 'fopt off' : 'fopt'}>
            <input
              type="checkbox"
              checked={on}
              disabled={empty}
              onChange={() => onPick(on ? '' : o.value)}
            />
            {o.label}
            <span className="c mono">{o.count}</span>
          </label>
        );
      })}
    </>
  );
}

/** What an applied chip says. The facet's own words where we have them. */
function chipLabel(facets: OrderList['facets'] | null, key: string, value: string): string {
  if (key === 'q') return `“${value}”`;
  const group = key === 'status' ? facets?.status : key === 'site' ? facets?.site : undefined;
  return group?.find((o) => o.value === value)?.label ?? value;
}

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

function Nothing({
  applied,
  onClear,
}: {
  applied: boolean;
  onClear: () => void;
}): React.JSX.Element {
  if (!applied) {
    return (
      <div className="empty">
        <h3>No orders yet</h3>
        <p>
          Nothing has been ordered on your organisation&rsquo;s account. When something is, it
          appears here with its machines, its value and its delivery site.
        </p>
        <p className="retry">
          <a className="pill acc" href="/search">
            Browse inspected laptops
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="empty">
      <h3>No order on your account matches that</h3>
      <p>
        Every option in the rail still shows how many orders it would return on its own, so the one
        that took the count to zero is the one reading <span className="mono">0</span>. Remove it,
        or clear the filters and start again. If you were looking for a specific number, check it
        against your confirmation — ours look like <span className="mono">TT-26-00004</span>.
      </p>
      <p className="retry">
        <button type="button" className="pill acc" onClick={onClear}>
          Clear all filters
        </button>
      </p>
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see your orders"
        body="An order belongs to the organisation that placed it, so we need to know who is asking. Signing in brings you straight back to this board."
        action={
          <a className="pill acc" href="/sign-in?next=%2Faccount%2Forders">
            Sign in
          </a>
        }
      />
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not open your orders</h3>
        <p>{message}</p>
        <p>Nothing has changed and nothing has been charged.</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
