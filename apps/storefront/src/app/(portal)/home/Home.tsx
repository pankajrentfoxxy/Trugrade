'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Button,
  EmptyState,
  HubKpiRow,
  HubPageHeader,
  Panel,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import { Money } from '@trugrade/contracts';
import type { ApiFailure } from '../../register/api';
import { Deadline, inIst } from '../../../lib/deadline';
import {
  getDashboard,
  updateCommercialProfile,
  type ApprovalRow,
  type OrderDashboard,
} from '../api';
import { usePortal } from '../shell/PortalContext';
import { ANNUAL_VOLUMES, EMPLOYEE_BANDS } from '../../register/picklists';
import { Select } from '../../../lib/controls';

/**
 * The buyer's home. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the calls are authenticated and because the
 * approval deadlines have to stay true while the tab is open.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

const orders = (n: number): string => (n === 1 ? 'order' : 'orders');

type Phase =
  | { k: 'loading' }
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

export function Home(): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const summary = await getDashboard();
      if (!live) return;
      if (summary.ok) setPhase({ k: 'ready', data: summary.data });
      else setPhase({ k: 'error', message: problem(summary) });
    })();
    return () => {
      live = false;
    };
  }, []);

  const startPurchasing = (
    <Button variant="primary" onClick={() => router.push('/')}>
      Start purchasing
    </Button>
  );

  return (
    <div className="hub-page">
      <HubPageHeader
        title="Home"
        // A title and a count. What is on order and what has a clock against it
        // are the KPI row and the "Needs you" panel directly below.
        subtitle={
          phase.k === 'ready'
            ? `${phase.data.orders} ${phase.data.orders === 1 ? 'order' : 'orders'}`
            : undefined
        }
        actions={startPurchasing}
      />

      {phase.k === 'loading' ? (
        <Skeleton lines={8} />
      ) : phase.k === 'error' ? (
        <EmptyState title="Your orders did not load" body={phase.message} />
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
  const { approvals } = usePortal();
  return (
    <>
      {data.orders === 0 ? (
        // First run. A row of four zeroes is a true statement and a useless
        // screen: the honest reading of "no orders" is that there is nothing
        // to measure yet, not that four metrics all measured zero.
        <EmptyState
          title="No orders yet"
          body="Nothing has been ordered on your organisation's account. When something is, this is where you will see what is on order, what is waiting on an approver, and how long it has left."
          action={
            <Link className="hub-banner__cta" href="/">
              Browse inspected laptops
            </Link>
          }
        />
      ) : (
        <HubKpiRow cells={kpis(data)} />
      )}

      <div className="hub-split">
        <div className="hub-split__main">
          <Panel
            title="Needs you"
            count={approvals.length || undefined}
            actions={
              data.approvalSlaHours !== null ? (
                <Link href="/approvals">Open approvals</Link>
              ) : (
                'Soonest deadline first'
              )
            }
          >
            {approvals.length === 0 ? (
              <div className="px-5 py-4">
                <EmptyState
                  title="Nothing is waiting on anybody"
                  body="No order on your account is held up for a signature. When one is, it appears here with the deadline it is running against."
                />
              </div>
            ) : (
              <Approvals approvals={approvals} />
            )}
          </Panel>
        </div>

        {/*
          The dock now holds the pricing questions and nothing else. The team
          list, the profile card and the "Everything else" links were all asked
          off this screen — the rail beside it is the way to every place in the
          portal, and a second list of the same eight doors was the rail twice.
        */}
        <PricingPanel orders={data.orders} />
      </div>
    </>
  );
}

/**
 * The KPI row — six figures from the API, arranged as four cells.
 *
 * Money rides in the sub-line rather than as a cell of its own, because a rupee
 * total and the count it came from are one fact and splitting them across two
 * cells invites somebody to read the total as a separate metric.
 */
function kpis(data: OrderDashboard): { label: string; value: string; sub: string }[] {
  return [
    {
      label: 'Orders placed',
      value: String(data.orders),
      sub: `${orders(data.orders)} on your organisation's account`,
    },
    {
      label: 'Machines on order',
      value: String(data.machines),
      sub: 'each named by its own serial number',
    },
    {
      label: 'Awaiting approval',
      value: String(data.awaitingApproval.orders),
      sub: `${rupees(data.awaitingApproval.value)} held, nothing charged`,
    },
    {
      label: 'Placed, not yet paid',
      value: String(data.awaitingPayment.orders),
      sub: `${rupees(data.awaitingPayment.value)} — we have set no due date on these`,
    },
  ];
}

/* ==========================================================================
 * The queue — what is happening on each held order, and who was asked
 * ======================================================================== */

/**
 * The approvals, soonest deadline first — the server orders them by
 * `expires_at`, which is the same thing as "closest to a promise being broken".
 *
 * **The decision is not taken here.** It is taken on the approval itself, where
 * the serials, the landed cost and the policy clause that fired are all on
 * screen. Every row leads there.
 */
/**
 * The orders waiting on a signature, from the one source that serves them.
 *
 * These rows used to come from `/orders/summary`'s own `PendingApproval` while
 * `/approvals` rendered the same rows from `ApprovalRow` — two endpoints, two
 * DTOs, one fact. The shell already reads the first page of the approvals
 * inbox for the rail's badge, so Home reads that.
 */
function Approvals({ approvals }: { approvals: readonly ApprovalRow[] }): React.JSX.Element {
  return (
    <ul className="divide-y divide-rule-2" data-testid="held-orders">
      {approvals.map((a) => (
        <li
          key={a.orderNumber}
          className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
        >
          <div className="min-w-0">
            <Link
              className="hub-link font-mono"
              href={`/orders/${encodeURIComponent(a.orderNumber)}`}
            >
              {a.orderNumber}
            </Link>
            <p className="mt-1 text-body-sm text-ink-2">
              <span className="font-mono tnum">{a.unitsHeld}</span>{' '}
              {a.unitsHeld === 1 ? 'machine' : 'machines'} held ·{' '}
              <span className="font-mono tnum">{rupees(a.orderValue)}</span> · raised by{' '}
              {a.requestedByName} {inIst(a.requestedAt)}
            </p>
            <p className="mt-1 text-body-sm text-ink-3">
              Waiting on {a.approverName}. If nobody answers within{' '}
              <span className="font-mono tnum">{a.slaHours}</span> hours the hold releases and the
              machines go back on sale.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* The server's own verdict. `EXPIRED` past the deadline is decided
                there and never by subtracting dates in the browser. */}
            {a.status === 'EXPIRED' ? (
              <StatusPill tone="warn" label="Past its deadline" />
            ) : (
              <Deadline expiresAt={a.expiresAt} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ==========================================================================
 * The dock — profile completion and the people on the account
 * ======================================================================== */

/**
 * The two pricing-desk questions, asked once and only after a first order.
 *
 * They used to be required on the profile before a buyer could order at all,
 * which had the pricing desk gating the first sale on facts that only matter
 * from the second. Dismissable, because a question a buyer has decided not to
 * answer is not a task — the dismissal is per-browser on purpose: it is a
 * preference about this screen, not a fact about the organisation.
 */
function PricingPanel({ orders }: { orders: number }): React.JSX.Element | null {
  const { session, profile, reload } = usePortal();
  const [dismissed, setDismissed] = React.useState(true);
  const [employees, setEmployees] = React.useState('');
  const [volume, setVolume] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const answered = Boolean(profile?.employeeCountBand && profile?.annualTurnoverBand);
  const mayWrite = session.permissions.includes('identity.user.write');

  React.useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem('tg-pricing-card') === 'dismissed');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (orders === 0 || answered || dismissed || !mayWrite) return null;

  const close = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem('tg-pricing-card', 'dismissed');
    } catch {
      // A browser that refuses storage still gets to dismiss it for this visit.
    }
  };

  const save = async (): Promise<void> => {
    if (!employees && !volume) return;
    setBusy(true);
    setFailed(null);
    const result = await updateCommercialProfile({
      ...(employees ? { employeeCountBand: employees } : {}),
      ...(volume ? { annualTurnoverBand: volume } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setFailed(result.message);
      return;
    }
    close();
    reload();
  };

  return (
    // The dock itself, drawn only when there is something to put in it. An
    // empty bordered box beside the approvals would read as a panel that
    // failed to load.
    <aside className="hub-dock" aria-label="Pricing questions">
      <section aria-labelledby="home-pricing">
        <h2 id="home-pricing" className="hub-dock__title">
          Help us price for you
        </h2>
        <p className="text-body-sm text-ink-2">
          Two questions. They change nothing about this order.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <Select
            label="Employees"
            options={EMPLOYEE_BANDS}
            value={employees}
            onChange={(e) => setEmployees(e.target.value)}
          />
          <Select
            label="Laptops bought in a year"
            options={ANNUAL_VOLUMES}
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              disabled={!employees && !volume}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Not now
            </Button>
          </div>
          {failed ? (
            <p role="alert" className="text-body-sm text-fail">
              {failed}
            </p>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
