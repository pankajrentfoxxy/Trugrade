'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { DataBoard, EmptyState, Pagination, StatusPill, type Column } from '@trugrade/ui';
import { Money } from '@trugrade/contracts';
import type { ApiFailure } from '../../register/api';
import { Deadline, inIst } from '../../../lib/deadline';
import { getApprovals, type ApprovalInbox, type ApprovalRow } from '../api';

/**
 * The approval inbox. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated and can come back 401 —
 * a signed-out visitor is a state this screen renders, not a crash. The board's
 * state is not client state: it arrives as `query`, read off the URL by the
 * server, and every control pushes the router rather than setting anything.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

const machines = (n: number): string => (n === 1 ? 'machine' : 'machines');

/** Parameters that are not filters, so they never appear as an applied chip. */
const NOT_A_FILTER = new Set(['page', 'per']);

const PER_PAGE = [10, 25, 50] as const;

/**
 * The pill per state.
 *
 * `pass` and `fail` appear here and nowhere else on a buyer's screens, because
 * an approved or rejected order genuinely IS a verdict — the one use the design
 * system reserves those two colours for. Pending is neutral: waiting is not a
 * result. Expired is neutral too, and the row says in words that nothing was
 * charged, because a deadline that passed is not a decision anybody took.
 */
const PILL: Record<
  ApprovalRow['status'],
  { tone: 'pass' | 'fail' | 'neutral'; label: string }
> = {
  PENDING: { tone: 'neutral', label: 'Waiting on you' },
  APPROVED: { tone: 'pass', label: 'Approved' },
  REJECTED: { tone: 'fail', label: 'Declined' },
  EXPIRED: { tone: 'neutral', label: 'Window closed' },
};

function statusLabel(a: ApprovalRow, boardStatus: string): string {
  if (a.status === 'PENDING' && boardStatus === 'held' && !a.decidable) {
    return 'Held for approval';
  }
  return PILL[a.status].label;
}

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; inbox: ApprovalInbox };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your approvals just now. That is our problem, not yours — nothing has been decided either way and no hold has moved.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function ApprovalsBoard({ query }: { query: string }): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const params = React.useMemo(() => new URLSearchParams(query), [query]);

  React.useEffect(() => {
    let live = true;
    setPhase({ k: 'loading' });
    void (async () => {
      const result = await getApprovals(query);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', inbox: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [query]);

  const commit = React.useCallback(
    (next: URLSearchParams, { keepPage = false } = {}): void => {
      if (!keepPage) next.delete('page');
      const qs = next.toString();
      // `typedRoutes` cannot prove a string built at runtime is a real route.
      // The cast is on the ONE line that builds it.
      router.push((qs ? `/account/approvals?${qs}` : '/account/approvals') as Route, {
        scroll: false,
      });
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
    return `/account/approvals?${next.toString()}` as Route;
  };

  if (phase.k === 'signed-out') return <SignedOut />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  const inbox = phase.k === 'ready' ? phase.inbox : null;
  const status = params.get('status') ?? 'held';
  const applied = [...params.entries()].filter(([k, v]) => !NOT_A_FILTER.has(k) && v !== '');

  return (
    <>
      <div className="wshead obhead">
        {/* The heading follows the filter. "Orders waiting on you" over a board
            of settled ones is a false statement about somebody's money. */}
        <h1>
          {status === 'held'
            ? 'Orders held for approval'
            : status === 'waiting'
              ? 'Orders waiting on you'
              : status === 'decided'
                ? 'Orders you have decided'
                : 'Every order sent to you'}
        </h1>
        <p>
          {status === 'held'
            ? 'Each of these is an order your organisation has raised, with the machines already held off sale, waiting for the named approver to sign off. Nothing has been charged and no order has been placed with a supply point until they do.'
            : status === 'waiting'
              ? 'Each of these is an order somebody at your organisation has raised, with the machines already held off sale, waiting for you to say yes. Nothing has been charged and no order has been placed with a supply point until you do.'
              : 'Every approval addressed to you, settled or not. A decision is kept after it is taken, with the reason you gave, because it is the record of who committed the spend.'}
        </p>
      </div>

      <div className="cols">
        <Rail
          inbox={inbox}
          status={status}
          applied={applied}
          onSet={setValue}
          onClear={() => commit(new URLSearchParams())}
        />

        <main>
          <div className="rbar">
            <span className="cnt">
              {inbox === null ? (
                <span className="ink4">Counting what is waiting…</span>
              ) : (
                <>
                  <b className="mono">{inbox.total.toLocaleString('en-IN')}</b> approval
                  {inbox.total === 1 ? '' : 's'}
                  {status !== 'all' && (
                    <>
                      {' '}
                      {status === 'held'
                        ? 'held for approval'
                        : status === 'waiting'
                          ? 'still waiting on you'
                          : 'already decided'}
                    </>
                  )}
                </>
              )}
            </span>
            {inbox !== null && inbox.waitingOnYou > 0 && status !== 'waiting' && (
              <div className="r">
                <button type="button" className="sel gh" onClick={() => setValue('status', 'waiting')}>
                  Show the <span className="mono">{inbox.waitingOnYou}</span> still waiting
                </button>
              </div>
            )}
          </div>

          {inbox !== null && inbox.total === 0 ? (
            <Nothing status={status} onClear={() => commit(new URLSearchParams())} />
          ) : (
            <div className="tbl aboard">
              <DataBoard
                caption={
                  inbox === null
                    ? status === 'held'
                      ? 'Loading what your organisation has held for approval.'
                      : 'Loading the approvals addressed to you.'
                    : `${inbox.approvals.length} approval${inbox.approvals.length === 1 ? '' : 's'} on this page of ${inbox.total}, soonest deadline first.`
                }
                columns={columnsFor(status)}
                rows={inbox?.approvals ?? []}
                rowKey={(a) => a.id}
                loading={inbox === null}
                skeletonRows={6}
              />
            </div>
          )}

          {inbox !== null && inbox.total > inbox.per && (
            <div className="pager">
              <p className="shown">
                Page <b className="mono">{inbox.page}</b> of <b className="mono">{inbox.pages}</b> ·{' '}
                <b className="mono">{inbox.total}</b> approvals
              </p>
              <Pagination
                page={inbox.page}
                pageCount={inbox.pages}
                hrefFor={(target) => href('page', String(target))}
                onPage={(target) => {
                  const next = new URLSearchParams(params);
                  next.set('page', String(target));
                  commit(next, { keepPage: true });
                }}
                label="Approval inbox pages"
              />
              <div className="perpage">
                <label htmlFor="aper">Per page</label>
                <select
                  id="aper"
                  value={String(inbox.per)}
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

/**
 * Five columns.
 *
 * The row action is **Review**, not Approve. 03_UX_SPEC wants the landed cost,
 * the requester and the policy clause on screen before the button, and none of
 * those fit in a table cell — a one-click approve in a list is a signature given
 * without reading what is being signed.
 */
const COLUMNS: ReadonlyArray<Column<ApprovalRow>> = [
  {
    key: 'order',
    header: 'Order',
    cell: (a) => (
      <span className="obord">
        <a className="mono" href={`/account/approvals/${a.id}`}>
          {a.orderNumber}
        </a>
        <span className="obwhen">sent {inIst(a.requestedAt)}</span>
      </span>
    ),
  },
  {
    key: 'who',
    header: 'Raised by',
    cell: (a) => (
      <span className="obord">
        <b>{a.requestedByName}</b>
        <span className="obwhen">for {a.approverName} to sign off</span>
      </span>
    ),
  },
  {
    key: 'value',
    header: 'Value',
    numeric: true,
    cell: (a) => (
      <span className="obord r">
        <b className="mono">{rupees(a.orderValue)}</b>
        <span className="obwhen mono">
          {a.unitsHeld} {machines(a.unitsHeld)}
        </span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'State',
    cell: (a) => (
      <span className="obord">
        <StatusPill tone={PILL[a.status].tone} label={PILL[a.status].label} />
        {a.status === 'PENDING' ? (
          <span className="obdue">
            <Deadline expiresAt={a.expiresAt} />
          </span>
        ) : a.status === 'EXPIRED' ? (
          <span className="obdue">
            closed {inIst(a.expiresAt)} · nothing charged
          </span>
        ) : (
          <span className="obdue">
            {a.decidedAt === null ? (
              // Decided and we do not hold when. Never drawn as a date.
              <span className="notmeasured">decision time not recorded</span>
            ) : (
              <>decided {inIst(a.decidedAt)}</>
            )}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'act',
    header: 'Action',
    cell: (a) =>
      a.decidable ? (
        <a className="sel gh" href={`/account/approvals/${a.id}`}>
          Review
        </a>
      ) : a.status === 'PENDING' ? (
        // A pending one you may not decide. The reason is stated rather than
        // left as a greyed-out control with no explanation.
        <span className="ablocked">{a.blockedReason ?? 'Not yours to decide.'}</span>
      ) : (
        <a className="sel gh" href={`/account/approvals/${a.id}`}>
          Open
        </a>
      ),
  },
];

const columnsFor = (boardStatus: string): ReadonlyArray<Column<ApprovalRow>> =>
  COLUMNS.map((col) =>
    col.key === 'status'
      ? {
          ...col,
          cell: (a) => (
            <span className="obord">
              <StatusPill tone={PILL[a.status].tone} label={statusLabel(a, boardStatus)} />
              {a.status === 'PENDING' ? (
                <span className="obdue">
                  <Deadline expiresAt={a.expiresAt} />
                </span>
              ) : a.status === 'EXPIRED' ? (
                <span className="obdue">
                  closed {inIst(a.expiresAt)} · nothing charged
                </span>
              ) : (
                <span className="obdue">
                  {a.decidedAt === null ? (
                    <span className="notmeasured">decision time not recorded</span>
                  ) : (
                    <>decided {inIst(a.decidedAt)}</>
                  )}
                </span>
              )}
            </span>
          ),
        }
      : col,
  );

/* ==========================================================================
 * The rail
 * ======================================================================== */

function Rail({
  inbox,
  status,
  applied,
  onSet,
  onClear,
}: {
  inbox: ApprovalInbox | null;
  status: string;
  applied: Array<[string, string]>;
  onSet: (key: string, value: string) => void;
  onClear: () => void;
}): React.JSX.Element {
  const [sheetOpen, setSheetOpen] = React.useState(false);

  return (
    <div className="railzone">
      {/* Under 900px the rail is a full-screen sheet behind this button. It is
          hidden on desktop by CSS, never by a resize listener in JavaScript. */}
      <button
        type="button"
        className="fsheetbtn"
        onClick={() => setSheetOpen(true)}
        aria-expanded={sheetOpen}
        aria-controls="approval-filters"
      >
        Filters
      </button>

      <aside
        id="approval-filters"
        className={sheetOpen ? 'filters open' : 'filters'}
        aria-label="Approval filters"
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

        <details open>
          <summary>What to show</summary>
          <div className="fbody">
            {inbox === null ? (
              <p className="fnote">Counting…</p>
            ) : (
              inbox.facets.map((f) => {
                const on = status === f.value;
                // Zero-count options are disabled, never hidden: a group that
                // vanishes tells a reader the dimension does not exist.
                const empty = f.count === 0 && !on;
                return (
                  <label key={f.value} className={empty ? 'fopt off' : 'fopt'}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={empty}
                      onChange={() => onSet('status', on ? '' : f.value)}
                    />
                    {f.label}
                    <span className="c mono">{f.count}</span>
                  </label>
                );
              })
            )}
          </div>
        </details>

        <p className="fnote off">
          <b>Held for approval</b> is everything your organisation has waiting on a signature.
          <b> Waiting on you</b> is only the ones addressed to you — use that filter when you are
          the named approver.
        </p>

        <div className="fdone">
          <button type="button" onClick={() => setSheetOpen(false)}>
            Show these approvals
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

/* ==========================================================================
 * States that are not the board
 * ======================================================================== */

/**
 * The calm empty state 03_UX_SPEC asks for by name.
 *
 * "Nothing waiting on you" is a finished condition, not a gap: no red, no
 * suggestion, and no primary action, because there is nothing to do and saying
 * otherwise would manufacture a task.
 */
function Nothing({ status, onClear }: { status: string; onClear: () => void }): React.JSX.Element {
  if (status === 'held') {
    return (
      <div className="empty calm">
        <h3>Nothing held for approval</h3>
        <p>
          No order at your organisation is waiting on a signature right now. When one is, it
          appears here with what it costs, who raised it, who must sign off, and how long the
          machines are held for.
        </p>
      </div>
    );
  }
  if (status === 'waiting') {
    return (
      <div className="empty calm">
        <h3>Nothing waiting on you</h3>
        <p>
          No order at your organisation is held up for your signature. When one is, it appears here
          with what it costs, who raised it and how long the machines are held for.
        </p>
      </div>
    );
  }
  if (status === 'decided') {
    return (
      <div className="empty calm">
        <h3>Nothing decided yet</h3>
        <p>
          You have not approved or declined an order on this account. Approvals you have settled
          stay here afterwards, with the reason you gave.
        </p>
      </div>
    );
  }
  return (
    <div className="empty">
      <h3>No approval has ever been sent to you</h3>
      <p>
        Your organisation sets a value above which an order needs a signature, and names who gives
        it. Nothing above that line has been raised with you as the approver.
      </p>
      <p className="retry">
        <button type="button" className="pill acc" onClick={onClear}>
          Clear the filter
        </button>
      </p>
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see what is waiting on you"
        body="An approval is addressed to one person at one organisation, so we need to know who is asking. Signing in brings you straight back here."
        action={
          <a className="pill acc" href="/sign-in?next=%2Faccount%2Fapprovals">
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
        <h3>We could not open your approvals</h3>
        <p>{message}</p>
        <p>
          Nothing has been approved or declined, and every hold is where it was. If a deadline is
          close, the order screen shows the same figures.
        </p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
