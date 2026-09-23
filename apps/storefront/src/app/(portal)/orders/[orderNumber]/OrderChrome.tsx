'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { Button, Skeleton, StatusPill } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { inIst } from '../../../../lib/deadline';
import { OrderNav } from './OrderNav';
import { getOrder, type OrderRecord as Order } from './api';
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

export const OrderContext = React.createContext<OrderPhase | null>(null);

/** The order the chrome read, or null when rendered outside it (tests). */
export function useSharedOrder(): OrderPhase | null {
  return React.useContext(OrderContext);
}

export function OrderChrome({
  orderNumber,
  children,
}: {
  orderNumber: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<OrderPhase>({ k: 'loading' });
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
  }, [orderNumber]);

  const live = phase.k === 'ready' || phase.k === 'loading';

  return (
    <OrderContext.Provider value={phase}>
      <div className="od">
        {phase.k === 'ready' ? (
          <Head order={phase.order} pathname={pathname ?? ''} />
        ) : phase.k === 'loading' ? (
          <HeadSkeleton />
        ) : null}
        {live && <OrderNav orderNumber={orderNumber} />}
        {children}
      </div>
    </OrderContext.Provider>
  );
}

/* ==========================================================================
 * The header, the progress and the next step
 * ======================================================================== */

function Head({ order, pathname }: { order: Order; pathname: string }): React.JSX.Element {
  const at = standing(order);
  const state = statusOf(order);
  const pdf = `/api/buyer/orders/${encodeURIComponent(order.orderNumber)}/confirmation.pdf`;
  // The sales order is the document the payment is against, and it carries the
  // pay control beside its own total. Drawing a second one in the header on
  // that tab would be two primary actions on one screen.
  const onSalesOrder = pathname.endsWith('/sales-order');

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
            {at.payable && !onSalesOrder && <PayButton amount={order.grandTotal} />}
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
 * The one primary action on the screen.
 *
 * Online payment is not connected in this product yet — there is no gateway
 * adapter and no `/checkout/pay` route, only the spec for one — so the control
 * is here, for the amount, with the reason it cannot be pressed stated on it.
 * It is never drawn as a working button that leads nowhere: `disabledReason`
 * keeps it reachable and says what will change it.
 */
function PayButton({ amount }: { amount: string }): React.JSX.Element {
  return (
    <Button
      variant="primary"
      className="od-btn--primary"
      disabledReason="Online payment is not connected yet. Your account manager will send payment instructions for this amount, and this button will take the payment once it is."
    >
      Pay <span className="mono">{rupees(amount)}</span>
    </Button>
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
  const answered = order.supply.filter((l) => l.qtyAvailable !== null).length;
  const total = order.supply.length;

  const steps: Step[] = [
    {
      label: 'Order placed',
      meta: <span className="mono">{shortIst(order.placedAt)}</span>,
      done: true,
    },
    {
      label: 'Stock confirmed',
      meta: at.stockConfirmed
        ? total > 0 && answered === total
          ? 'Every line confirmed'
          : 'By dispatch point'
        : total > 0 && answered > 0
          ? `${answered} of ${total} lines so far`
          : 'By dispatch point',
      done: at.stockConfirmed,
    },
    {
      label: 'Payment',
      meta:
        order.paymentMode === 'CREDIT'
          ? PAYMENT_STEP.CREDIT
          : (PAYMENT_STEP[order.paymentStatus] ?? 'Waiting for you'),
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
  const points = order.dispatchGroups
    .map((g) => g.label)
    .filter((l) => l.startsWith('Supply Point '));
  const named = points.length === 0 ? 'the dispatch point' : points.join(' and ');
  const plural = points.length > 1;
  // For the two sentences that open with the name, since the fallback is lowercase.
  const Named = named.charAt(0).toUpperCase() + named.slice(1);

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
  } else if (!at.stockConfirmed) {
    body = at.paid ? (
      <>
        <strong>Next: stock confirmation.</strong> {Named} {plural ? 'are' : 'is'} confirming your
        machines by serial number. We will tell you when {plural ? 'they have' : 'it has'}.
      </>
    ) : (
      <>
        <strong>Next: stock confirmation.</strong> {Named} {plural ? 'are' : 'is'} confirming your
        machines by serial number. Payment comes after that, and nothing has been charged yet.
      </>
    );
  } else if (!at.paid) {
    body = (
      <>
        <strong>Next: complete payment.</strong> Nothing has been charged yet. {named}{' '}
        {plural ? 'have' : 'has'} confirmed your machines, so payment is the last step before they
        ship.
      </>
    );
    link = { href: `${base}/sales-order` as Route, label: 'Payment options →' };
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
