'use client';

import * as React from 'react';
import { EmptyState, KpiRow, QueueList, Skeleton, TickRule, type Kpi } from '@trugrade/ui';
import { Money } from '@trugrade/contracts';
import type { ApiFailure } from '../register/api';
import { Deadline, inIst } from '../../lib/deadline';
import { getDashboard, type OrderDashboard, type PendingApproval } from './api';

/**
 * The buyer's dashboard. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated, because it can come
 * back 401 — a signed-out visitor is a state this screen renders, not a crash —
 * and because the approval deadlines have to stay true while the tab is open.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

const orders = (n: number): string => `${n === 1 ? 'order' : 'orders'}`;

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: OrderDashboard };

/**
 * What went wrong, in the server's words where it had any. `call`'s fallback
 * for `UNKNOWN` and `NETWORK` describes a registration form, and a refusal that
 * describes the wrong screen is worse than a plain one.
 */
const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your account just now. That is our problem, not yours — your orders are unaffected.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function Dashboard(): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getDashboard();
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', data: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="wspace">
      <div className="wshead">
        <h1>Your account</h1>
        <p>
          What your organisation has on order with us, and the one thing on it that has a clock
          against it.
        </p>
        <TickRule />
      </div>

      {phase.k === 'loading' ? (
        <DashboardSkeleton />
      ) : phase.k === 'signed-out' ? (
        <SignedOut />
      ) : phase.k === 'error' ? (
        <Failed message={phase.message} />
      ) : (
        <Workspace data={phase.data} />
      )}
    </div>
  );
}

/* ==========================================================================
 * The workspace
 * ======================================================================== */

function Workspace({ data }: { data: OrderDashboard }): React.JSX.Element {
  const breached = data.approvals.filter((a) => a.breached).length;

  // First run. A row of four zeroes is a true statement and a useless screen:
  // the honest reading of "no orders" is that there is nothing to measure yet,
  // not that four metrics all measured zero.
  if (data.orders === 0) {
    return (
      <div className="ostate">
        <EmptyState
          title="No orders yet"
          body="Nothing has been ordered on your organisation's account. When something is, this is where you will see what is on order, what is waiting on an approver, and how long it has left."
          action={
            <a className="pill acc" href="/search">
              Browse inspected laptops
            </a>
          }
        />
      </div>
    );
  }

  return (
    <>
      <KpiRow label="What is on order" items={kpis(data)} />

      {/*
        The queue. `QueueList` does the ordering itself — "ordered by SLA
        breach" is the archetype's rule, and a rule every caller re-implements
        is a rule one caller gets wrong.

        There is one item because there is one SLA. Nothing else on a buyer's
        account has a promise attached to it that we could be late on, and a
        second queue would need an invented `slaHours` to sit beside this one.
      */}
      {data.approvalSlaHours === null ? (
        <section className="wqempty" aria-labelledby="queues">
          <h2 id="queues">Nothing is waiting on anybody</h2>
          <p>
            No order on your account is held up for a signature. When one is, it appears here with
            the deadline it is running against.
          </p>
        </section>
      ) : (
        <QueueList
          label="What is waiting"
          items={[
            {
              key: 'approvals',
              label: 'Orders waiting on an approver',
              href: '/account/orders?status=AWAITING_APPROVAL',
              count: data.awaitingApproval.orders,
              breachedCount: breached,
              ...(data.oldestApprovalWaitHours === null
                ? {}
                : { oldestWaitHours: data.oldestApprovalWaitHours }),
              slaHours: data.approvalSlaHours,
              description: (
                <>
                  Stock is held off sale while an approver answers.{' '}
                  <span className="mono">{rupees(data.awaitingApproval.value)}</span> across{' '}
                  <span className="mono">{data.awaitingApproval.orders}</span>{' '}
                  {orders(data.awaitingApproval.orders)} — nothing charged.
                </>
              ),
            },
          ]}
        />
      )}

      {data.approvals.length > 0 && <Approvals approvals={data.approvals} />}
    </>
  );
}

/**
 * The KPI row — six figures from the API, arranged as four tiles.
 *
 * Money rides in the hint rather than as a tile of its own, because a rupee
 * total and the count it came from are one fact and splitting them across two
 * tiles invites somebody to read the total as a separate metric.
 */
function kpis(data: OrderDashboard): Kpi[] {
  return [
    {
      key: 'orders',
      label: 'Orders placed',
      value: data.orders,
      unit: orders(data.orders),
      href: '/account/orders',
      hint: 'Everything your organisation has placed with us',
    },
    {
      key: 'machines',
      label: 'Machines on order',
      value: data.machines,
      unit: data.machines === 1 ? 'machine' : 'machines',
      hint: 'Each one named by its own serial number on the order it belongs to',
    },
    {
      key: 'approval',
      label: 'Awaiting approval',
      value: data.awaitingApproval.orders,
      unit: orders(data.awaitingApproval.orders),
      href: '/account/orders?status=AWAITING_APPROVAL',
      hint: (
        <>
          <span className="mono">{rupees(data.awaitingApproval.value)}</span> held, nothing charged
        </>
      ),
    },
    {
      key: 'payment',
      label: 'Placed, not yet paid',
      value: data.awaitingPayment.orders,
      unit: orders(data.awaitingPayment.orders),
      href: '/account/orders?status=PAYMENT_PENDING',
      hint: (
        <>
          <span className="mono">{rupees(data.awaitingPayment.value)}</span> — we have set no due
          date on these
        </>
      ),
    },
  ];
}

/* ==========================================================================
 * The queue itself — what is happening on each held order, and who was asked
 * ======================================================================== */

/**
 * The approvals, soonest deadline first — the server orders them by
 * `expires_at`, which is the same thing as "closest to a promise being broken".
 *
 * Every row states the same five facts the order screen states, because they
 * are the facts an approval needs to be honest about: what is held, for whom,
 * until when, who was asked, and what happens if nobody answers.
 *
 * **No approve button.** Nothing in this product can decide an approval yet, and
 * the decision would not be the requester's to take in any case. A control that
 * led nowhere would be worse than none.
 */
function Approvals({ approvals }: { approvals: readonly PendingApproval[] }): React.JSX.Element {
  return (
    <section aria-labelledby="held" className="wappr">
      <div className="sh">
        <div className="shrow">
          <h2 id="held">The orders being held</h2>
          <span className="sub">Soonest deadline first</span>
        </div>
      </div>

      <ul className="wapprlist">
        {approvals.map((a) => (
          <li key={a.orderNumber} className={a.breached ? 'gone' : undefined}>
            <div className="wal">
              <a className="mono waord" href={`/account/orders/${a.orderNumber}`}>
                {a.orderNumber}
              </a>
              <span className="wameta">
                <span className="mono">{a.unitsHeld}</span>{' '}
                {a.unitsHeld === 1 ? 'machine' : 'machines'} ·{' '}
                <span className="mono">{rupees(a.orderValue)}</span>
              </span>
              <span className="wameta">
                Asked of <b>{a.approverName}</b> by {a.requestedByName}, sent{' '}
                <span className="mono">{inIst(a.requestedAt)}</span>
              </span>
            </div>

            <div className="war">
              {a.breached ? (
                <>
                  <span className="waclock over">
                    The <span className="mono">{a.slaHours}</span>-hour window closed
                  </span>
                  <span className="wawhen mono">{inIst(a.expiresAt)}</span>
                  <span className="wanote">
                    The hold has released and those machines are back on sale. Nothing was charged.
                  </span>
                </>
              ) : (
                <>
                  <span className="waclock">
                    <Deadline expiresAt={a.expiresAt} />
                  </span>
                  <span className="wawhen mono">{inIst(a.expiresAt)}</span>
                  <span className="wanote">
                    of the <span className="mono">{a.slaHours}</span> hours we hold stock for a
                    signature
                  </span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="fnote off">
        Nobody can approve an order from this account yet, so there is no button here to press. What
        this screen is for is knowing which request is closest to its deadline and who to go and
        ask. If the deadline passes, the hold releases on its own, the machines go back on sale to
        everyone, and you are told — there is no charge and no order to cancel.
      </p>
    </section>
  );
}

/* ==========================================================================
 * States that are not the workspace
 * ======================================================================== */

export function DashboardSkeleton(): React.JSX.Element {
  return (
    <div className="wskel">
      <div className="wskelrow">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-52 w-full rounded-lg" />
    </div>
  );
}

function SignedOut(): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see your account"
        body="Orders belong to the organisation that placed them, so we need to know who is asking. Signing in brings you straight back here."
        action={
          <a className="pill acc" href="/sign-in?next=%2Faccount">
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
        <h3>We could not open your account</h3>
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
