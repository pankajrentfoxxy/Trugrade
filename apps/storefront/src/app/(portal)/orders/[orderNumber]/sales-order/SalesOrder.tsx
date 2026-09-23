'use client';

import * as React from 'react';
import { Button, EmptyState, GradeBadge, Skeleton, StatusPill } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { Money, type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../../../../register/api';
import { inIst } from '../../../../../lib/deadline';
import { getSalesOrder, type SalesOrder as SalesOrderView, type SalesOrderLine } from './api';

/**
 * The sales order: what the dispatch points confirmed, and what it comes to.
 *
 * Three states, each drawn as itself:
 *
 * - **Waiting.** Not every dispatch point has answered. There are no totals,
 *   because a total of a partly answered order is a figure the buyer would be
 *   asked to pay and then asked to pay again. The lines are listed with what
 *   was ordered and, per line, what has been confirmed so far or "not confirmed
 *   yet" as an absence.
 * - **Ready.** Every line's confirmed quantity, priced, then GST and freight,
 *   then the payment — the one primary action on this screen.
 * - **Cancelled.** Every dispatch point refused. Nothing is owed, said plainly.
 *
 * The order's own header, progress and tab strip are the layout's `OrderChrome`;
 * this is the body under them. No vendor anywhere: a dispatch point is
 * `Supply Point F · Noida`.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

const isGrade = (g: string): g is Grade => g === 'A_PLUS' || g === 'A' || g === 'B';

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: SalesOrderView };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your order just now. That is our problem, not yours — the order itself is unaffected.'
    : failure.message;

/** What the payment line reads as. The enum never reaches the screen. */
const PAYMENT_STATUS: Readonly<Record<string, string>> = {
  PENDING: 'Not paid yet',
  AUTHORIZED: 'Authorised, not yet captured',
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partly paid',
  FAILED: 'Last payment failed',
  REFUNDED: 'Refunded',
  CREDIT: 'On credit terms',
};

const PAYMENT_MODE: Readonly<Record<string, string>> = {
  PREPAID: 'Prepaid',
  PARTIAL_ADVANCE: 'Part advance',
  CREDIT: 'Credit terms',
};

export function SalesOrder({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getSalesOrder(orderNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', data: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [orderNumber]);

  if (phase.k === 'loading') {
    return (
      <div className="od-grid" aria-busy="true">
        <div className="od-col">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="od-col">
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }
  if (phase.k === 'signed-out') {
    return (
      <div className="ostate">
        <EmptyState
          title="Sign in to see this sales order"
          body="An order belongs to the organisation that placed it, so we need to know who is asking."
          action={
            <a
              className="pill acc"
              href={`/sign-in?next=${encodeURIComponent(`/orders/${orderNumber}/sales-order`)}`}
            >
              Sign in
            </a>
          }
        />
      </div>
    );
  }
  if (phase.k === 'missing') {
    return (
      <div className="ostate">
        <EmptyState
          title="We have no order with that number on your account"
          body="Check it against your confirmation, or ask whoever placed it to share it from their account."
        />
      </div>
    );
  }
  if (phase.k === 'error') {
    return (
      <div className="ostate">
        <div className="empty err" role="alert">
          <h3>We could not open this sales order</h3>
          <p>{phase.message}</p>
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

  return <Record data={phase.data} />;
}

/* ==========================================================================
 * The record
 * ======================================================================== */

function Record({ data }: { data: SalesOrderView }): React.JSX.Element {
  const state =
    data.state === 'READY'
      ? { tone: 'neutral' as const, label: 'Confirmed' }
      : data.state === 'CANCELLED'
        ? { tone: 'neutral' as const, label: 'Cancelled' }
        : { tone: 'warn' as const, label: 'Waiting for confirmation' };

  return (
    <div className="od-grid">
      <div className="od-col">
        <section className="od-card" aria-labelledby="so-head">
          <header className="od-card__head">
            <h2 id="so-head">
              Sales order · <span className="mono">{data.orderNumber}</span>
            </h2>
            <StatusPill tone={state.tone} label={state.label} />
          </header>
          <div className="od-card__body">
            <p className="od-lead">
              <Headline data={data} />
            </p>
            <dl className="od-facts">
              <div>
                <dt>Dispatch points confirmed</dt>
                <dd className="mono">
                  {data.dispatchPointsAnswered} of {data.dispatchPoints}
                </dd>
              </div>
              <div>
                <dt>Confirmed on</dt>
                <dd className={data.confirmedAt ? 'mono' : 'notmeasured'}>
                  {data.confirmedAt ? inIst(data.confirmedAt) : 'Not yet'}
                </dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{PAYMENT_MODE[data.payment.mode] ?? data.payment.mode}</dd>
              </div>
            </dl>
          </div>
        </section>

        {data.state === 'WAITING' && <Waiting data={data} />}
        {data.state === 'CANCELLED' && (
          <section className="od-card oappr" role="status" aria-labelledby="so-cancelled">
            <header className="od-card__head">
              <h2 id="so-cancelled">Every dispatch point turned this order down</h2>
            </header>
            <div className="od-card__body">
              <p className="oapprlead">
                None of the machines you ordered could be supplied, so there is no sales order and
                nothing is owed. Nothing was charged. If you still need these machines, put them in
                a cart again — we will hold whatever is in stock.
              </p>
            </div>
          </section>
        )}

        <section className="od-card" aria-labelledby="so-lines">
          <header className="od-card__head">
            <h2 id="so-lines">
              {data.state === 'READY' ? 'What you will be invoiced for' : 'The lines on this order'}
            </h2>
            <span>
              {data.state === 'READY'
                ? 'Confirmed quantities only. A machine nobody can supply is not on the invoice.'
                : 'Quantities appear here as each dispatch point confirms them'}
            </span>
          </header>
          <ul className="od-sup">
            {data.lines.map((l, i) => (
              <Line key={`${l.label}-${l.grade}-${i}`} line={l} ready={data.state === 'READY'} />
            ))}
          </ul>
        </section>
      </div>

      <aside className="od-col">
        {data.state === 'READY' && data.totals ? (
          <Summary data={data} totals={data.totals} />
        ) : (
          <section className="od-card od-summary" aria-labelledby="so-money">
            <h2 id="so-money">
              {data.state === 'CANCELLED' ? 'Nothing is owed' : 'No amount to pay yet'}
            </h2>
            <p className="od-lead">
              {data.state === 'CANCELLED'
                ? 'No sales order exists for this booking, so there is no invoice and no payment.'
                : `The price, the GST and the freight appear here once every dispatch point has confirmed what it can send — ${data.dispatchPointsAnswered} of ${data.dispatchPoints} ${data.dispatchPoints === 1 ? 'has' : 'have'} so far. Nothing is charged until then.`}
            </p>
            <div className="od-total">
              <div className="od-total__label">Total</div>
              <p className="notmeasured">Total not available yet</p>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function Headline({ data }: { data: SalesOrderView }): React.JSX.Element {
  if (data.state === 'WAITING') {
    return (
      <>
        Waiting for {data.dispatchPoints === 1 ? 'the dispatch point' : 'the dispatch points'} to
        confirm what {data.dispatchPoints === 1 ? 'it' : 'they'} can send. The sales order — the
        quantities, the price, the GST and the freight — appears here the moment the last one
        answers.
      </>
    );
  }
  if (data.state === 'CANCELLED') {
    return <>Every dispatch point refused this order. Nothing is owed and nothing was charged.</>;
  }
  const confirmed = data.lines.reduce((n, l) => n + (l.qtyConfirmed ?? 0), 0);
  const ordered = data.lines.reduce((n, l) => n + l.qtyOrdered, 0);
  return (
    <>
      <b className="mono">{confirmed}</b> of the <b className="mono">{ordered}</b> machines you
      ordered are confirmed by the dispatch points, and this is what they come to from{' '}
      {BRAND.legalEntity} on one invoice.
    </>
  );
}

function Waiting({ data }: { data: SalesOrderView }): React.JSX.Element {
  return (
    <section className="od-card oappr pending" role="status" aria-labelledby="so-waiting">
      <header className="od-card__head">
        <h2 id="so-waiting">Waiting for the dispatch points to confirm</h2>
      </header>
      <div className="od-card__body">
        <p className="oapprlead">
          <b className="mono">{data.dispatchPointsAnswered}</b> of{' '}
          <b className="mono">{data.dispatchPoints}</b>{' '}
          {data.dispatchPoints === 1 ? 'dispatch point has' : 'dispatch points have'} confirmed what
          they can send. Until the last one answers there is no sales order to price, so there is no
          amount here and <b>nothing has been charged</b>. You will see the confirmed quantities,
          the price, the GST and the freight the moment it lands.
        </p>
      </div>
    </section>
  );
}

function Line({ line, ready }: { line: SalesOrderLine; ready: boolean }): React.JSX.Element {
  const short = line.qtyConfirmed !== null && line.qtyConfirmed < line.qtyOrdered;
  return (
    <li>
      <div className="od-sup__row">
        <div className="od-sup__id">
          <span className="od-sup__label">{line.label}</span>
          <span className="od-sup__title">
            {line.title ?? <span className="notmeasured">Model no longer catalogued</span>}
            {isGrade(line.grade) ? (
              <GradeBadge grade={line.grade} />
            ) : (
              <span className="notmeasured">Grade not recorded</span>
            )}
          </span>
          {line.specSummary && <span className="od-sup__spec">{line.specSummary}</span>}
        </div>
        <dl className="od-sup__facts">
          <div>
            <dt>Ordered</dt>
            <dd className="mono">{line.qtyOrdered}</dd>
          </div>
          <div>
            <dt>Confirmed</dt>
            <dd className={line.qtyConfirmed === null ? 'notmeasured' : 'mono'}>
              {line.qtyConfirmed === null ? 'Not yet' : line.qtyConfirmed}
            </dd>
          </div>
          <div>
            <dt>Unit price</dt>
            <dd className="mono">{rupees(line.unitPrice)}</dd>
          </div>
          <div>
            <dt>GST</dt>
            <dd className="mono">{line.gstRatePct}%</dd>
          </div>
          {ready && line.lineTotal !== null && (
            <div>
              <dt>Line total</dt>
              <dd className="mono">{rupees(line.lineTotal)}</dd>
            </div>
          )}
        </dl>
      </div>
      {short && (
        <p className="od-sup__short">
          This dispatch point can send <span className="mono">{line.qtyConfirmed}</span> of the{' '}
          <span className="mono">{line.qtyOrdered}</span> you ordered.{' '}
          {ready ? 'Only the confirmed machines are priced here.' : 'We are sourcing the rest.'}
        </p>
      )}
    </li>
  );
}

/* ==========================================================================
 * Money
 * ======================================================================== */

function Summary({
  data,
  totals,
}: {
  data: SalesOrderView;
  totals: NonNullable<SalesOrderView['totals']>;
}): React.JSX.Element {
  const tax = totals.tax;
  const taxable = Money.parse(totals.subtotal).add(Money.parse(totals.freight));
  const paid = data.payment.status === 'PAID';
  return (
    <section className="od-card od-summary" aria-labelledby="so-money">
      <h2 id="so-money">What this sales order comes to</h2>
      <p className="od-lead">
        The confirmed machines, the freight to your site, and the GST on both. This is the figure
        the invoice will carry.
      </p>
      <dl className="od-lines">
        <div>
          <dt>Confirmed machines</dt>
          <dd>{rupees(totals.subtotal)}</dd>
        </div>
        <div>
          <dt>Freight</dt>
          <dd>{rupees(totals.freight)}</dd>
        </div>
        <div className="sep">
          <dt>Taxable value</dt>
          <dd>{taxable.format()}</dd>
        </div>
        {tax.interState ? (
          <div>
            <dt>
              IGST <span className="mono">{tax.ratePct}%</span>
            </dt>
            <dd>{rupees(tax.igst)}</dd>
          </div>
        ) : (
          <>
            <div>
              <dt>
                CGST <span className="mono">{tax.ratePct / 2}%</span>
              </dt>
              <dd>{rupees(tax.cgst)}</dd>
            </div>
            <div>
              <dt>
                {tax.stateTaxLabel} <span className="mono">{tax.ratePct / 2}%</span>
              </dt>
              <dd>{rupees(tax.sgst)}</dd>
            </div>
          </>
        )}
      </dl>
      <div className="od-total">
        <div>
          <div className="od-total__label">{paid ? 'Total paid' : 'Total payable'}</div>
          <div className="od-total__note">Landed price, incl. tax &amp; freight</div>
        </div>
        <div className="od-total__amt mono">{rupees(totals.grandTotal)}</div>
      </div>
      <PayControl data={data} />
      <dl className="od-kv">
        <div>
          <dt>Payment</dt>
          <dd>{PAYMENT_STATUS[data.payment.status] ?? data.payment.status}</dd>
        </div>
        <div>
          <dt>Seller</dt>
          <dd>{BRAND.legalEntity}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The one primary action on this screen.
 *
 * Online payment is not connected in this product yet — there is no gateway
 * adapter and no `/checkout/pay` route, only the spec for one — so the control
 * is here, for the amount, with the reason it cannot be pressed stated on it.
 * It is never drawn as a working button that leads nowhere: `disabledReason`
 * keeps it reachable and says what will change it.
 */
function PayControl({ data }: { data: SalesOrderView }): React.JSX.Element | null {
  if (!data.totals) return null;
  if (data.payment.status === 'PAID') {
    return (
      <p className="fnote">
        <StatusPill tone="pass" label="Paid" /> Nothing more is owed on this sales order.
      </p>
    );
  }
  if (data.payment.mode === 'CREDIT') {
    return (
      <p className="fnote off">
        This order is on credit terms. The invoice is paid on the agreed terms, so there is nothing
        to pay at a button.
      </p>
    );
  }
  if (!data.payment.payable) return null;
  return (
    <Button
      variant="primary"
      block
      className="od-btn--primary"
      disabledReason="Online payment is not connected yet. Your account manager will send payment instructions for this amount, and this button will take the payment once it is."
    >
      Pay {rupees(data.totals.grandTotal)}
    </Button>
  );
}
