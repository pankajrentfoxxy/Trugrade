'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Button, Skeleton, StatusPill } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { inIst } from '../../../../lib/deadline';
import { OrderNav } from './OrderNav';
import { getOrder, payOrder, type OrderRecord as Order } from './api';
import { DownloadIcon, InfoIcon, TickIcon } from './icons';
import {
  problem,
  rupees,
  shortIst,
  standing,
  statusOf,
  type OrderPhase,
  type Standing,
} from './order-state';

/**
 * Everything above the tabs, drawn once for the record and every sub-route.
 *
 * The order's identity — number, status, one sentence, the confirmation PDF and
 * the one primary action — plus the five-step progress strip and the "what
 * happens next" banner. Before this, the record drew its own header and each
 * tab drew a different one, so the same order changed its name five times as a
 * buyer moved across the strip.
 *
 * It reads the order once and hands the result down through `OrderContext`, so
 * the record body underneath does not ask the API the same question a second
 * time. A tab that reads its own endpoint (units, documents, delivery) ignores
 * the context and keeps its own states.
 *
 * On a refused or missing order the chrome draws nothing but leaves the page to
 * say so: the record body and every tab already render their own signed-out,
 * missing and failed states, and two copies of "sign in" on one screen is one
 * too many.
 */

export { OrderContext, ReloadContext, useReloadOrder, useSharedOrder } from './order-context';
import { OrderContext, ReloadContext } from './order-context';

export function OrderChrome({
  orderNumber,
  children,
}: {
  orderNumber: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<OrderPhase>({ k: 'loading' });
  // Bumped after a payment, so the chrome and every panel under it re-read
  // the order rather than patching a copy of it.
  const [generation, setGeneration] = React.useState(0);
  const pathname = usePathname();

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getOrder(orderNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', order: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [orderNumber, generation]);

  const live = phase.k === 'ready' || phase.k === 'loading';

  const reload = React.useCallback(() => setGeneration((n) => n + 1), []);

  return (
    <OrderContext.Provider value={phase}>
      <ReloadContext.Provider value={reload}>
      <div className="od">
        {phase.k === 'ready' ? (
          <Head
            order={phase.order}
            pathname={pathname ?? ''}
            onPaid={() => setGeneration((n) => n + 1)}
          />
        ) : phase.k === 'loading' ? (
          <HeadSkeleton />
        ) : null}
        {live && <OrderNav orderNumber={orderNumber} />}
        {children}
      </div>
      </ReloadContext.Provider>
    </OrderContext.Provider>
  );
}

/* ==========================================================================
 * The header, the progress and the next step
 * ======================================================================== */

function Head({
  order,
  pathname,
  onPaid,
}: {
  order: Order;
  pathname: string;
  onPaid: () => void;
}): React.JSX.Element {
  const at = standing(order);
  const state = statusOf(order);
  const pdf = `/api/buyer/orders/${encodeURIComponent(order.orderNumber)}/confirmation.pdf`;
  // The record body draws the payment panel with the deadline beside it, and
  // that panel is where the one primary action lives. The header carries the
  // button only on the other tabs, so no screen has two of them.
  const onRecord = pathname === `/orders/${encodeURIComponent(order.orderNumber)}`;

  return (
    <>
      <div>
        <nav className="od-crumb" aria-label="Breadcrumb">
          <Link href="/orders">Orders</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{order.orderNumber}</span>
        </nav>
        <div className="od-head">
          <div>
            <div className="od-title-row">
              <h1 className="od-title">
                Order <span className="mono">{order.orderNumber}</span>
              </h1>
              <StatusPill tone={state.tone} label={state.label} />
            </div>
            <p className="od-sub">
              <Headline order={order} />
            </p>
          </div>
          <div className="od-actions">
            <a className="od-btn" href={pdf}>
              <DownloadIcon />
              Order confirmation
            </a>
            {at.payable && !onRecord && (
              <PayButton orderNumber={order.orderNumber} amount={order.grandTotal} onPaid={onPaid} />
            )}
          </div>
        </div>
      </div>

      {at.placed && !at.over && <Progress order={order} at={at} />}

      <NextStep order={order} at={at} pathname={pathname} />
    </>
  );
}

function HeadSkeleton(): React.JSX.Element {
  return (
    <>
      <div aria-busy="true">
        <Skeleton className="h-4 w-40 rounded" />
        <div className="od-head">
          <Skeleton className="h-9 w-80 rounded" />
          <Skeleton className="h-11 w-56 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </>
  );
}

/** The one sentence under the order number. It changes with the state, entirely. */
function Headline({ order }: { order: Order }): React.JSX.Element {
  const approval = order.approval;
  if (approval?.status === 'PENDING') {
    return (
      <>
        <b className="mono">{order.unitsAllocated}</b> machines are held while{' '}
        <b>{approval.approverName}</b> signs this off. Nothing is committed, nothing is charged, and
        they are on sale to nobody else until then.
      </>
    );
  }
  if (approval?.status === 'REJECTED') {
    return (
      <>
        <b>{approval.approverName}</b> declined this order, so the hold on those{' '}
        <b className="mono">{order.unitsAllocated}</b> machines was released and they went back on
        sale. Nothing was charged.
      </>
    );
  }
  if (approval?.status === 'EXPIRED') {
    return (
      <>
        The 24 hours we hold stock for an approval ran out before <b>{approval.approverName}</b>{' '}
        answered, so those <b className="mono">{order.unitsAllocated}</b> machines went back on
        sale. Nothing was charged.
      </>
    );
  }
  return (
    <>
      Placed <span className="mono">{inIst(order.placedAt)}</span> ·{' '}
      <span className="mono">{order.unitsAllocated}</span>{' '}
      {order.unitsAllocated === 1 ? 'machine' : 'machines'} · Sold by {BRAND.legalEntity}
    </>
  );
}

/**
 * The one primary action on the screen: pay for a verified order.
 *
 * `POST /api/buyer/orders/:n/pay` records the payment and confirms the order.
 * There is no gateway in front of it yet, so the press is the payment; when a
 * gateway arrives it lands in front of this call. A refusal — the 24-hour
 * window closed, the order already paid — is the server's own sentence and is
 * printed beside the button.
 */
export function PayButton({
  orderNumber,
  amount,
  onPaid,
}: {
  orderNumber: string;
  amount: string;
  onPaid: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function pay(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await payOrder(orderNumber);
    setBusy(false);
    if (result.ok) onPaid();
    else setFailure(problem(result));
  }

  return (
    <span className="od-pay">
      <Button
        variant="primary"
        className="od-btn--primary"
        loading={busy}
        disabled={busy}
        onClick={() => void pay()}
      >
        Pay <span className="mono">{rupees(amount)}</span>
      </Button>
      {failure && (
        <span role="alert" className="od-pay__err">
          {failure}
        </span>
      )}
    </span>
  );
}

/* ==========================================================================
 * Progress — five steps, each read off the order, none invented
 * ======================================================================== */

/** What the payment step reads as. The enum never reaches the screen. */
const PAYMENT_STEP: Readonly<Record<string, string>> = {
  PENDING: 'Waiting for you',
  AUTHORIZED: 'Authorised, not yet captured',
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partly paid',
  FAILED: 'Last payment failed',
  REFUNDED: 'Refunded',
  CREDIT: 'On credit terms',
};

interface Step {
  label: string;
  meta: React.ReactNode;
  done: boolean;
}

function Progress({ order, at }: { order: Order; at: Standing }): React.JSX.Element {
  const base = `/orders/${encodeURIComponent(order.orderNumber)}`;
  const total = order.unitsAllocated;

  const steps: Step[] = [
    {
      label: 'Order placed',
      meta: <span className="mono">{shortIst(order.placedAt)}</span>,
      done: true,
    },
    {
      // Each machine is named by our technician at the supply point. The count
      // carries its denominator; a step nobody has started says so.
      label: 'Inspected',
      meta: at.inspected ? (
        'Every machine recorded'
      ) : order.unitsInspected > 0 ? (
        <>
          <span className="mono">{order.unitsInspected}</span> of{' '}
          <span className="mono">{total}</span> recorded
        </>
      ) : (
        'By our technician'
      ),
      done: at.inspected || at.verified,
    },
    {
      label: 'Verified',
      meta: at.verified ? (
        'Every machine verified'
      ) : order.unitsVerified > 0 ? (
        <>
          <span className="mono">{order.unitsVerified}</span> of{' '}
          <span className="mono">{total}</span> verified
        </>
      ) : (
        'Then you pay'
      ),
      done: at.verified,
    },
    {
      label: 'Payment',
      meta:
        order.paymentMode === 'CREDIT'
          ? PAYMENT_STEP.CREDIT
          : at.payable && order.payBy
            ? `Due ${shortIst(order.payBy)}`
            : (PAYMENT_STEP[order.paymentStatus] ?? 'After verification'),
      done: at.paid,
    },
    {
      label: 'Shipped',
      meta: at.shipped ? (
        <Link className="hub-link" href={`${base}/tracking` as Route}>
          See tracking
        </Link>
      ) : (
        'Tracking appears here'
      ),
      done: at.shipped,
    },
    {
      label: 'Delivered',
      meta: at.delivered ? (
        <Link className="hub-link" href={`${base}/delivery` as Route}>
          Run delivery check
        </Link>
      ) : (
        'Then run delivery check'
      ),
      done: at.delivered,
    },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <section className="od-card" aria-label="Order progress">
      <ol className="od-steps">
        {steps.map((s, i) => {
          const cls = s.done ? 'od-step is-done' : i === current ? 'od-step is-current' : 'od-step';
          return (
            <li key={s.label} className={cls} aria-current={i === current ? 'step' : undefined}>
              <div className="od-step__track">
                <span className="od-step__dot">{s.done && <TickIcon />}</span>
                <span className="od-step__line" />
              </div>
              <span className="od-step__label">{s.label}</span>
              <span className="od-step__meta">{s.meta}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ==========================================================================
 * What happens next
 * ======================================================================== */

function NextStep({
  order,
  at,
  pathname,
}: {
  order: Order;
  at: Standing;
  pathname: string;
}): React.JSX.Element {
  const base = `/orders/${encodeURIComponent(order.orderNumber)}`;
  // Only a real `Supply Point X · City` reads as a name in a sentence. The
  // API's placeholder for a line nobody has been asked about yet does not,
  // so it falls back to "the dispatch point".
  const points = [
    ...new Set(order.dispatchGroups.map((g) => g.label).filter((l) => l.startsWith('Supply Point '))),
  ];
  const named = points.length === 0 ? 'the dispatch point' : points.join(' and ');

  let body: React.ReactNode;
  let link: { href: Route; label: string } | null = null;

  if (at.held && order.approval) {
    body = (
      <>
        <strong>Next: {order.approval.approverName} signs this off.</strong> Nothing is committed
        and nothing is charged until then. The machines are held for nobody else.
      </>
    );
  } else if (at.released) {
    body = (
      <>
        <strong>Next: nothing — the hold is released.</strong> If you still need these machines, put
        them in a cart again and we will hold whatever is still there.
      </>
    );
    link = { href: '/search', label: 'Browse laptops →' };
  } else if (at.over) {
    body = (
      <>
        <strong>This order is cancelled.</strong> Nothing more is owed on it. If anything was paid,
        the refund shows on the Documents tab as a credit note.
      </>
    );
  } else if (at.delivered) {
    body = (
      <>
        <strong>Next: run the delivery check.</strong> Check each seal and record what arrived while
        the inspection window is open.
      </>
    );
    link = { href: `${base}/delivery` as Route, label: 'Delivery check →' };
  } else if (at.shipped) {
    body = (
      <>
        <strong>Next: delivery.</strong> The consignment has left {named}. Run the delivery check
        when it arrives.
      </>
    );
    link = { href: `${base}/tracking` as Route, label: 'Tracking →' };
  } else if (!at.inspected && !at.verified) {
    body = (
      <>
        <strong>Next: inspection.</strong> Our technician goes to {named}, inspects each machine
        and records its serial. Nothing has been charged yet; payment comes once every machine is
        verified.
      </>
    );
  } else if (!at.verified) {
    body = (
      <>
        <strong>Next: verification.</strong> Every machine has been inspected and named. We are
        checking each one against its inspection; you pay once the last one is verified, and
        nothing has been charged yet.
      </>
    );
  } else if (!at.paid) {
    body = (
      <>
        <strong>Next: pay.</strong> Every machine is verified. Nothing has been charged yet;
        {order.payBy ? (
          <>
            {' '}
            pay by <span className="mono">{inIst(order.payBy)}</span> or the machines go back on
            sale.
          </>
        ) : (
          ' payment is the last step before they ship.'
        )}
      </>
    );
    link = { href: base as Route, label: 'Pay now →' };
  } else {
    body = (
      <>
        <strong>Next: dispatch.</strong> Your machines are packed and shipped from {named}. Tracking
        appears here the moment they leave.
      </>
    );
    link = { href: `${base}/tracking` as Route, label: 'Tracking →' };
  }

  return (
    <div className="od-banner" role="status">
      <div className="od-banner__icon">
        <InfoIcon />
      </div>
      <p className="od-banner__text">{body}</p>
      {/* A link to the tab already open is a control that does nothing. */}
      {link && link.href !== pathname && (
        <Link className="od-banner__link" href={link.href}>
          {link.label}
        </Link>
      )}
    </div>
  );
}
