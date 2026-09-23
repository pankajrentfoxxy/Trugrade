'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  DataBoard,
  EmptyState,
  Pagination,
  Skeleton,
  type Column,
  type SortDirection,
} from '@trugrade/ui';
import { Money, buyerOrderStatusLabel, hasReached } from '@trugrade/contracts';
import type { ApiFailure } from '../../register/api';
import { inIst } from '../../../lib/deadline';
import { getOrders, type OrderList, type OrderSummary } from '../api';

/**
 * The order board. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash — but the
 * board's state is not client state: it arrives as `query` from the server,
 * which read it off the URL, and every control here pushes the router rather
 * than setting anything. Reproducing the screen from the address bar alone is
 * the requirement; holding none of it locally is what makes that true.
 *
 * The shape: a row of status tabs that ARE the status filter, each carrying
 * the server's count for it; a banner when orders are waiting on the buyer's
 * own payment; one search box, the site and the sort; then the table in a
 * card with its own footer. The status counts and the site list are the
 * facets the API computes with every other filter applied, so nothing here is
 * a number the screen made up.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

/** "23 Sep 2026, 3:11 pm", on the IST calendar. The board column has no room for the zone; the record states it. */
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});
const boardDate = (iso: string): string => DATE.format(new Date(iso)).replace('Sept', 'Sep');

/** Parameters that are not filters, so an empty result knows whether one applied. */
const NOT_A_FILTER = new Set(['sort', 'page', 'per']);

/**
 * Sorting a board is a change of order, not a change of question, so there are
 * four options and both directions of each are addressable — a link to
 * "cheapest first" has to survive being sent to somebody.
 */
const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'value', label: 'Value: high to low' },
  { value: 'value_asc', label: 'Value: low to high' },
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

/** The statuses under which an order is over without having been delivered. */
const OVER = new Set(['CANCELLED', 'VENDOR_REJECTED', 'RTO']);

/**
 * What a status tab says under its count, and whether it is a hold-up.
 *
 * The two `warn` states are the ones waiting on the buyer's own organisation —
 * an approver's signature or a payment. Everything else is with us or the
 * carrier, and the tab says what happens next rather than colouring it.
 */
type Tone = 'warn' | 'info' | 'ok' | 'neutral';

/** The badge family a status belongs to: a hold-up, in motion, arrived, or over. */
function toneOf(status: string): Tone {
  if (status === 'AWAITING_APPROVAL' || status === 'PAYMENT_PENDING') return 'warn';
  if (OVER.has(status)) return 'neutral';
  if (hasReached(status, 'DELIVERED')) return 'ok';
  return 'info';
}

function metaFor(status: string): { text: string; dot: Tone } {
  const dot = toneOf(status);
  if (status === 'AWAITING_APPROVAL') return { text: 'Held until your approver answers', dot };
  if (status === 'PAYMENT_PENDING') return { text: 'Machines held until you pay', dot };
  if (OVER.has(status)) return { text: 'Nothing more is owed', dot };
  if (hasReached(status, 'DELIVERED')) return { text: 'Run delivery check', dot };
  if (hasReached(status, 'DISPATCHED')) return { text: 'On its way', dot };
  return { text: 'Getting ready to ship', dot };
}

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
      router.push((qs ? `/orders?${qs}` : '/orders') as Route, { scroll: false });
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
    next.delete('page');
    return `/orders?${next.toString()}` as Route;
  };

  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const list = phase.k === 'ready' ? phase.list : null;
  const sort = params.get('sort') ?? 'recent';
  const status = params.get('status') ?? '';
  const site = params.get('site') ?? '';
  const q = params.get('q') ?? '';
  const applied = [...params.entries()].filter(([k, v]) => !NOT_A_FILTER.has(k) && v !== '');

  const statusFacets = list?.facets.status ?? null;
  const siteFacets = list?.facets.site ?? null;
  // The counts arrive with every OTHER filter applied but not the status's
  // own, so their sum is what "All orders" would return.
  const everything = statusFacets === null ? null : statusFacets.reduce((n, o) => n + o.count, 0);
  const pending = statusFacets?.find((o) => o.value === 'PAYMENT_PENDING') ?? null;
  const from = list === null || list.total === 0 ? 0 : (list.page - 1) * list.per + 1;
  const to = list === null ? 0 : Math.min(list.page * list.per, list.total);

  return (
    <div className="ol">
      <div className="ol-head">
        <div>
          <h1 className="ol-title">Orders</h1>
          <p className="ol-sub">
            <Sub list={list} />
          </p>
        </div>
      </div>

      {/* The status filter. Radio behaviour on buttons: an order has exactly
          one status, so pressing a tab replaces the last one. A zero-count
          tab is DISABLED and dimmed, never removed — disappearing options make
          people think the site is broken. */}
      <div className="ol-tabs" role="group" aria-label="Filter by status">
        <button
          type="button"
          className="ol-tab"
          aria-pressed={status === ''}
          onClick={() => setValue('status', '')}
        >
          <span className="ol-tab__top">
            <span className="ol-dot ol-dot--all" aria-hidden="true" />
            All orders
          </span>
          <span className="ol-tab__count mono">
            {everything === null ? <Skeleton className="h-7 w-10 rounded" /> : everything}
          </span>
          <span className="ol-tab__meta">Every order on your account</span>
        </button>
        {statusFacets === null
          ? [0, 1, 2].map((i) => (
              <div key={i} className="ol-tab ol-tab--skeleton" aria-hidden="true">
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-7 w-10 rounded" />
                <Skeleton className="h-3 w-32 rounded" />
              </div>
            ))
          : statusFacets.map((o) => {
              const on = status === o.value;
              const empty = o.count === 0 && !on;
              const meta = metaFor(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  className={meta.dot === 'warn' ? 'ol-tab ol-tab--warn' : 'ol-tab'}
                  aria-pressed={on}
                  disabled={empty}
                  onClick={() => setValue('status', on ? '' : o.value)}
                >
                  <span className="ol-tab__top">
                    <span className={`ol-dot ol-dot--${meta.dot}`} aria-hidden="true" />
                    {o.label}
                  </span>
                  <span className="ol-tab__count mono">{o.count}</span>
                  <span className="ol-tab__meta">{meta.text}</span>
                </button>
              );
            })}
      </div>

      {pending !== null && pending.count > 0 && status !== 'PAYMENT_PENDING' && (
        <div className="ol-alert" role="status">
          <AlertIcon />
          <p className="ol-alert__text">
            <strong>
              <span className="mono">{pending.count}</span>{' '}
              {pending.count === 1 ? 'order is' : 'orders are'} waiting for payment.
            </strong>{' '}
            Machines are held for you, but will not ship until you pay.
          </p>
          <a href={href('status', 'PAYMENT_PENDING')}>Show these orders →</a>
        </div>
      )}

      <div className="ol-toolbar">
        {/*
          A real `<form>` with a submit button, not a debounced input. An order
          number is typed in full and then looked for; re-running the query on
          every keystroke of "TT-26-000" would show four wrong boards on the way
          to the right one.
        */}
        <form
          className="ol-search"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get('q');
            setValue('q', typeof value === 'string' ? value.trim() : '');
          }}
        >
          <SearchIcon />
          <label htmlFor="oq" className="sr-only">
            Find an order
          </label>
          <input
            id="oq"
            name="q"
            type="search"
            // `key` so a cleared or shared URL resets the box: an uncontrolled
            // input keeps whatever was typed into it across a navigation, and
            // a board whose search field disagrees with its results is the
            // specific failure the URL rule exists to stop.
            key={q}
            defaultValue={q}
            placeholder="Search by order no., your PO reference or machine serial"
            autoComplete="off"
          />
          <button type="submit" className="ol-btn ol-btn--sm">
            Find
          </button>
        </form>

        <div className="ol-select">
          <label htmlFor="osite">Delivery site</label>
          <div className="ol-select__box">
            <select
              id="osite"
              value={site}
              onChange={(e) => setValue('site', e.target.value)}
              disabled={siteFacets === null}
            >
              <option value="">All sites</option>
              {(siteFacets ?? []).map((o) => (
                <option key={o.value} value={o.value} disabled={o.count === 0 && site !== o.value}>
                  {o.label} ({o.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ol-select">
          <label htmlFor="osort">Sort</label>
          <div className="ol-select__box">
            <select id="osort" value={sort} onChange={(e) => setValue('sort', e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="ol-card">
        <DataBoard
          className="ol-table"
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
          empty={
            <Nothing applied={applied.length > 0} onClear={() => commit(new URLSearchParams())} />
          }
        />

        {list !== null && list.total > 0 && (
          <div className="ol-foot">
            <span>
              Showing{' '}
              <strong className="mono">
                {from}–{to}
              </strong>{' '}
              of <strong className="mono">{list.total.toLocaleString('en-IN')}</strong>{' '}
              {list.total === 1 ? 'order' : 'orders'}
            </span>
            <div className="ol-pager">
              <div className="ol-select">
                <label htmlFor="oper">Per page</label>
                <div className="ol-select__box">
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
              {list.pages > 1 && (
                <Pagination
                  page={list.page}
                  pageCount={list.pages}
                  hrefFor={(target) => {
                    const next = new URLSearchParams(params);
                    next.set('page', String(target));
                    return `/orders?${next.toString()}` as Route;
                  }}
                  onPage={(target) => {
                    const next = new URLSearchParams(params);
                    next.set('page', String(target));
                    commit(next, { keepPage: true });
                  }}
                  label="Order board pages"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The line under the title: how many orders, and where they go when that is
 * one place. Read off the site facet, never off the rows on this page.
 */
function Sub({ list }: { list: OrderList | null }): React.JSX.Element {
  if (list === null) return <>Counting your orders…</>;
  const sites = list.facets.site.filter((o) => o.count > 0);
  const n = list.total.toLocaleString('en-IN');
  return (
    <>
      <span className="mono">{n}</span> {list.total === 1 ? 'order' : 'orders'}
      {sites.length === 1 && (
        <>
          {' '}
          · {list.total === 1 ? 'shipping' : 'all shipping'} to {sites[0]!.label}
        </>
      )}
      {sites.length > 1 && (
        <>
          {' '}
          · <span className="mono">{sites.length}</span> delivery sites
        </>
      )}
    </>
  );
}

/* ==========================================================================
 * The columns
 * ======================================================================== */

// The dash the reference draws, with the words behind it for a screen reader.
const NONE_GIVEN = (
  <>
    <span className="ol-empty notmeasured" aria-hidden="true">
      —
    </span>
    <span className="sr-only notmeasured">None given</span>
  </>
);

/**
 * Seven columns.
 *
 * Facts that qualify another fact ride in its cell rather than taking a column
 * of their own: the date under the order number, the city under the site, the
 * deadline under the status.
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
      <span className="ol-order">
        <a className="ol-id mono" href={`/orders/${o.orderNumber}`}>
          {o.orderNumber}
        </a>
        <span className="ol-date">{boardDate(o.placedAt)}</span>
        {/* Why this row is in a serial search. A result with no visible reason
            reads as a mistake. */}
        {o.matchedSerials.length > 0 && (
          <span className="ol-hit mono">matched {o.matchedSerials.join(', ')}</span>
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
        <span className="ol-status">
          <Pill tone={state.tone} label={state.label} />
          {/* The one deadline this product imposes on a buyer. Stated as the
              instant, not as a ticking clock — a board is read down a column,
              and ten counters racing each other is noise, not information. */}
          {o.approval?.status === 'PENDING' && (
            <span className="ol-due mono">held until {inIst(o.approval.expiresAt)}</span>
          )}
        </span>
      );
    },
  },
  {
    key: 'site',
    header: 'Delivery site',
    cell: (o) => (
      <span className="ol-siteCell">
        <span className="ol-site">
          {o.deliverySiteLabel ?? (
            <span className="notmeasured">Site no longer on your account</span>
          )}
        </span>
        {o.deliveryCity && <span className="ol-site-city">{o.deliveryCity}</span>}
      </span>
    ),
  },
  {
    key: 'machines',
    header: 'Machines',
    numeric: true,
    cell: (o) => <span className="mono">{o.unitsAllocated}</span>,
  },
  {
    key: 'po',
    header: (
      <>
        <span aria-hidden="true">Your PO</span>
        <span className="sr-only">Your PO reference</span>
      </>
    ),
    // An absence renders as an absence. An empty cell reads as a recorded
    // value, and this one prints on our invoice.
    cell: (o) => (o.buyerPoNumber ? <span className="mono">{o.buyerPoNumber}</span> : NONE_GIVEN),
  },
  {
    key: 'value',
    header: (
      <>
        <span aria-hidden="true">Value</span>
        <span className="sr-only">Order value</span>
      </>
    ),
    numeric: true,
    sortable: true,
    cell: (o) => (
      <span className="ol-valueCell">
        <span className="ol-value mono">{rupees(o.grandTotal)}</span>
        <span className="ol-value-note">incl. GST</span>
      </span>
    ),
  },
  {
    key: 'action',
    header: 'Open',
    headerHidden: true,
    // An unpaid order's row action goes to the sales order, which is where
    // the payment lives. Filled, as the reference draws it.
    cell: (o) =>
      o.status === 'PAYMENT_PENDING' && o.paymentStatus !== 'PAID' ? (
        <a className="ol-btn ol-btn--primary" href={`/orders/${o.orderNumber}/sales-order`}>
          Pay now
        </a>
      ) : (
        <a className="ol-btn" href={`/orders/${o.orderNumber}`}>
          View
        </a>
      ),
  },
];

/**
 * The pill.
 *
 * `warn` on a live approval and on an unpaid order, because each is a genuine
 * hold-up somebody has to act on. Neutral everywhere else: green and red are
 * PASS and FAIL, and an order state is neither a pass nor a failure. This is
 * the record's `statusOf` said again over the list's narrower payload — the
 * same words for the same facts, because a board and a record that disagree
 * about a status is worse than either being wrong alone.
 */
function statusOf(order: OrderSummary): { tone: Tone; label: string } {
  const approval = order.approval;
  if (approval?.status === 'PENDING') return { tone: 'warn', label: 'Awaiting approval' };
  if (approval?.status === 'REJECTED') return { tone: 'neutral', label: 'Approval declined' };
  if (approval?.status === 'EXPIRED') return { tone: 'neutral', label: 'Approval expired' };
  if (order.status === 'PAYMENT_PENDING') return { tone: 'warn', label: 'Payment pending' };
  return { tone: toneOf(order.status), label: buyerOrderStatusLabel(order.status) };
}

/** The reference's badge: a tinted capsule with a dot, one family per state. */
function Pill({ tone, label }: { tone: Tone; label: string }): React.JSX.Element {
  return (
    <span className={`ol-pill ol-pill--${tone}`}>
      <span className={`ol-dot ol-dot--${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
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
      <div className="empty ol-empty">
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
    <div className="empty ol-empty">
      <h3>No order on your account matches that</h3>
      <p>
        Every status tab still shows how many orders it would return on its own, so the one that
        took the count to zero is the one reading <span className="mono">0</span>. Pick another, or
        clear the filters and start again. If you were looking for a specific number, check it
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
          <a className="pill acc" href="/sign-in?next=%2Forders">
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

/* ==========================================================================
 * Icons — stroke only, inherit colour, never carry meaning on their own
 * ======================================================================== */

function AlertIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
