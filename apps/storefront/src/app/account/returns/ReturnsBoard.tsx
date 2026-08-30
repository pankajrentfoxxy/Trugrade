'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { DataBoard, EmptyState, StatusPill, type Column, type SortDirection } from '@trugrade/ui';
import type { ApiFailure } from '../../register/api';
import { getReturns, RETURN_STATUS, type ReturnView } from './api';

/**
 * The returns board. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash. Board state
 * arrives as `query` from the server, which read it off the URL.
 */

const SORT_VALUES = {
  raised: (r: ReturnView): number => Date.parse(r.raisedAt),
  serial: (r: ReturnView): string => r.serialNumber,
  order: (r: ReturnView): string => r.orderNumber,
} as const;

type SortKey = keyof typeof SORT_VALUES;
const isSortKey = (v: string): v is SortKey => v in SORT_VALUES;

const SORT_CAPTION: Record<SortKey, string> = {
  raised: 'when it was raised',
  serial: 'serial number',
  order: 'order number',
};

function compare(a: ReturnView, b: ReturnView, key: SortKey, dir: SortDirection): number {
  const av = SORT_VALUES[key](a);
  const bv = SORT_VALUES[key](b);
  const base = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
  return dir === 'desc' ? -base : base;
}

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; returns: ReturnView[] };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your returns just now. That is our problem, not yours — the returns themselves are unaffected.'
    : failure.message;

export function ReturnsBoard({ query }: { query: string }): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const params = React.useMemo(() => new URLSearchParams(query), [query]);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getReturns();
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', returns: result.data.returns });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, []);

  const commit = React.useCallback(
    (next: URLSearchParams): void => {
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      router.push((qs ? `/account/returns?${qs}` : '/account/returns') as Route, { scroll: false });
    },
    [router],
  );

  const setValue = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    commit(next);
  };

  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const loading = phase.k === 'loading';
  const all = phase.k === 'ready' ? phase.returns : [];
  // `?order=` is how the delivery screen links here, so a buyer arriving from a
  // consignment sees that order's returns and not a list of everything.
  const order = params.get('order') ?? '';
  const show = params.get('show') ?? '';
  const scoped = order ? all.filter((r) => r.orderNumber === order) : all;
  const open = scoped.filter((r) => r.open);
  const sortParam = params.get('sort') ?? 'raised';
  const sortKey: SortKey = isSortKey(sortParam) ? sortParam : 'raised';
  const direction: SortDirection = params.get('dir') === 'asc' ? 'asc' : 'desc';

  const rows = [...(show === 'open' ? open : scoped)].sort((a, b) =>
    compare(a, b, sortKey, direction),
  );

  const onSort = (key: string): void => {
    if (!isSortKey(key)) return;
    const next = new URLSearchParams(params);
    next.set('sort', key);
    next.set('dir', sortKey === key && direction === 'desc' ? 'asc' : 'desc');
    commit(next);
  };

  return (
    <>
      <div className="wshead rthead">
        <h1>Your returns</h1>
        <p>
          Every machine you have sent back, and what happened to it. A return goes to us — we
          bought the machine, we sold it to you and we carry the take-back ourselves. There is
          nobody else for you to contact about any of these.
        </p>
      </div>

      <div className="rbar rtbar">
        <span className="cnt">
          {loading ? (
            <span className="ink4">Reading your returns…</span>
          ) : (
            <>
              <b className="mono">{rows.length}</b> of <b className="mono">{scoped.length}</b>{' '}
              {scoped.length === 1 ? 'return' : 'returns'}
              {order && (
                <>
                  {' on order '}
                  <span className="mono">{order}</span>
                </>
              )}
            </>
          )}
        </span>

        <div className="ubfilters" role="group" aria-label="Filter these returns">
          <button
            type="button"
            className={show === 'open' ? 'chipf' : 'chipf on'}
            aria-pressed={show !== 'open'}
            onClick={() => setValue('show', '')}
          >
            All returns
          </button>
          <button
            type="button"
            className={show === 'open' ? 'chipf on' : 'chipf'}
            aria-pressed={show === 'open'}
            onClick={() => setValue('show', 'open')}
            disabled={!loading && open.length === 0 && show !== 'open'}
          >
            Still with us <span className="mono">{loading ? '—' : open.length}</span>
          </button>
          {order && (
            <button type="button" className="chipf" onClick={() => setValue('order', '')}>
              Show every order
            </button>
          )}
        </div>

        {/* The one amber control. A board a buyer opens to check on a return is
            also the board they open when something has just gone wrong, and a
            list with no way to start one is a list with a dead end at the top. */}
        <a
          className="pill acc rtnew"
          href={order ? `/account/returns/new?order=${encodeURIComponent(order)}` : '/account/returns/new'}
        >
          Send a machine back
        </a>
      </div>

      {/* **The empty state is rendered INSTEAD of the board, not inside it.**
          `DataBoard` puts its `empty` slot in a `<td colSpan>`, so the panel
          inherits the table's intrinsic width — seven columns of it — and on a
          phone the whole message sits off the right edge of a horizontal scroll
          nobody knows is there. That is fine for a table of data, which is
          supposed to scroll; it is wrong for the one sentence explaining why
          there is no data. Reported for the shared component rather than
          changed there. */}
      {!loading && rows.length === 0 ? (
        show === 'open' ? (
          <EmptyState
            className="rtempty"
            title="Nothing is with us right now"
            body={
              <>
                All <span className="mono">{scoped.length}</span> of your returns are settled.
              </>
            }
            action={
              <button type="button" className="pill wire" onClick={() => setValue('show', '')}>
                Show every return
              </button>
            }
          />
        ) : (
          <EmptyState
            className="rtempty"
            title="You have never sent a machine back"
            body={
              <>
                That is the outcome we are aiming for. If something is wrong with a machine you can
                send it back within the inspection window that opens when it arrives — the window
                and the exact deadline are on each order&rsquo;s delivery tab.
              </>
            }
            action={
              <a className="pill wire" href="/account/orders">
                Your orders
              </a>
            }
          />
        )
      ) : (
        <div className="tbl rttable">
          <DataBoard
            caption={
              loading
                ? 'Reading your returns.'
                : `${rows.length} of ${scoped.length} returns, sorted by ${SORT_CAPTION[sortKey]}, ${direction === 'asc' ? 'oldest first' : 'newest first'}.`
            }
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.returnNumber}
            sort={{ key: sortKey, direction }}
            onSort={onSort}
            loading={loading}
            skeletonRows={4}
          />
        </div>
      )}

      <p className="fnote off rtfoot">
        A return is settled by us and only by us. We collect the machine at our cost, inspect it
        against the report it was sold under, and refund or replace it — you are never asked to
        deal with whoever dispatched it.
      </p>
    </>
  );
}

/* ==========================================================================
 * The columns
 * ======================================================================== */

const COLUMNS: readonly Column<ReturnView>[] = [
  {
    key: 'return',
    header: 'Return',
    cell: (r) => (
      <div className="rtid">
        <a className="mono rtnum" href={`/account/returns/${encodeURIComponent(r.returnNumber)}`}>
          {r.returnNumber}
        </a>
        <span className="rtreason">{r.reasonLabel}</span>
      </div>
    ),
  },
  {
    key: 'serial',
    header: 'Machine',
    sortable: true,
    cell: (r) => (
      <div className="rtid">
        {r.passportPath ? (
          <a className="mono rtserial" href={r.passportPath}>
            {r.serialNumber}
          </a>
        ) : (
          <span className="notmeasured">{r.serialNumber}</span>
        )}
        <span className="rttitle">
          {r.title ?? <span className="notmeasured">Model no longer catalogued</span>}
        </span>
      </div>
    ),
  },
  {
    key: 'order',
    header: 'Order',
    sortable: true,
    cell: (r) =>
      r.orderNumber ? (
        <a className="mono" href={`/account/orders/${encodeURIComponent(r.orderNumber)}`}>
          {r.orderNumber}
        </a>
      ) : (
        <span className="notmeasured">Not on your account</span>
      ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => {
      const s = RETURN_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
      return <StatusPill tone={s.tone} label={s.label} />;
    },
  },
  {
    key: 'evidence',
    header: 'Evidence',
    numeric: true,
    cell: (r) =>
      // Zero files is a real answer, not a missing one, and it is said as words
      // rather than as "0" — a bare zero beside "Evidence" reads as a failure to
      // upload rather than as a reason that needed none.
      r.evidenceCount === 0 ? (
        <span className="notmeasured">None needed</span>
      ) : (
        <>
          <span className="mono">{r.evidenceCount}</span>{' '}
          <span className="denom">{r.evidenceCount === 1 ? 'file' : 'files'}</span>
        </>
      ),
  },
  {
    key: 'raised',
    header: 'Raised',
    numeric: true,
    sortable: true,
    cell: (r) => <span className="mono">{r.raisedOn}</span>,
  },
  {
    key: 'outcome',
    header: 'Outcome',
    cell: (r) =>
      r.resolution === null ? (
        <span className="notmeasured">Not decided yet</span>
      ) : (
        <span>{r.resolution}</span>
      ),
  },
];

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see your returns"
        body="A return belongs to the organisation that raised it, so we need to know who is asking. Signing in brings you straight back here."
        action={
          <a className="pill acc" href={`/sign-in?next=${encodeURIComponent('/account/returns')}`}>
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
        <h3>We could not load your returns</h3>
        <p>{message}</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
