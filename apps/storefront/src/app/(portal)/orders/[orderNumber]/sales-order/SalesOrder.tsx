'use client';

import * as React from 'react';
import { EmptyState, GradeBadge, Skeleton, StatusPill } from '@trugrade/ui';
import { BRAND } from '@trugrade/config/brand';
import { Money, type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../../../../register/api';
import { Deadline, inIst } from '../../../../../lib/deadline';
import { PayButton, useReloadOrder } from '../OrderChrome';
import { getSalesOrder, type SalesOrder as SalesOrderView, type SalesOrderLine } from './api';
import Link from 'next/link';

/**
 * The sales order: what we verified, and what it comes to.
 *
 * Under the order-first flow nobody waits on a dispatch point to answer. Our
 * technician names each machine at the supply point, we verify every one, and
 * at that moment there is a sales order to price and the buyer is asked to pay.
 * The tab has four faces, each drawn as itself:
 *
 * - **Waiting.** Machines are still being inspected or verified. There are no
 *   totals — a total of a partly verified order is a figure the buyer would be
 *   asked to pay and then asked to pay again — and nothing has been charged.
 *   Each line shows what was ordered, how many have a serial, how many are
 *   verified.
 * - **Verified, unpaid.** Every verified machine priced, then GST and freight,
 *   the deadline, and the payment — the one primary action on this screen.
 * - **Paid.** The same figures as what was paid, with when.
 * - **Cancelled.** Nothing is owed, said plainly.
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

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function SalesOrder({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });
  const [generation, setGeneration] = React.useState(0);
  const reloadOrder = useReloadOrder();

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
  }, [orderNumber, generation]);

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
            <Link
              className="pill acc"
              href={`/sign-in?next=${encodeURIComponent(`/orders/${orderNumber}/sales-order`)}`}
            >
              Sign in
            </Link>
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

  return (
    <Record
      data={phase.data}
      onPaid={() => {
        // The tab and the chrome above it both re-read the order: one payment,
        // one truth, no patched copy.
        setGeneration((n) => n + 1);
        reloadOrder();
      }}
    />
  );
}

/* ==========================================================================
 * The record
 * ======================================================================== */

/**
 * The pill. `warn` where somebody has to act — the buyer, once verified and
 * unpaid — and neutral everywhere else: green and red are PASS and FAIL, and an
 * order state is neither.
 */
function pillOf(data: SalesOrderView): { tone: 'neutral' | 'warn'; label: string } {
  switch (data.stage) {
    case 'INSPECTION':
      return {
        tone: 'warn',
        label: data.machines.inspected > 0 ? 'Inspection in progress' : 'Awaiting inspection',
      };
    case 'VERIFICATION':
      return { tone: 'warn', label: 'Awaiting verification' };
    case 'PAYMENT':
      return { tone: 'warn', label: 'Verified · pay now' };
    case 'PAID':
      return { tone: 'neutral', label: data.payment.mode === 'CREDIT' ? 'On credit terms' : 'Paid' };
    case 'CANCELLED':
      return { tone: 'neutral', label: 'Cancelled' };
  }
}

function Record({ data, onPaid }: { data: SalesOrderView; onPaid: () => void }): React.JSX.Element {
  const pill = pillOf(data);
  const m = data.machines;

  return (
    <div className="od-grid">
      <div className="od-col">
        <section className="od-card" aria-labelledby="so-head">
          <header className="od-card__head">
            <h2 id="so-head">
              Sales order · <span className="mono">{data.orderNumber}</span>
            </h2>
            <StatusPill tone={pill.tone} label={pill.label} />
          </header>
          <div className="od-card__body">
            <p className="od-lead">
              <Headline data={data} />
            </p>
            <dl className="od-facts">
              <div>
                <dt>Machines verified</dt>
                <dd className="mono">
                  {m.verified} of {m.ordered}
                </dd>
              </div>
              <div>
                <dt>Verified on</dt>
                <dd className={data.verifiedAt ? 'mono' : 'notmeasured'}>
                  {data.verifiedAt ? inIst(data.verifiedAt) : 'Not yet'}
                </dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>
                  {PAYMENT_MODE[data.payment.mode] ?? data.payment.mode}
                  {data.paidAt ? (
                    <>
                      {' '}
                      · paid <span className="mono">{inIst(data.paidAt)}</span>
                    </>
                  ) : data.payment.payable && data.payBy ? (
                    <>
                      {' '}
                      · due <span className="mono">{inIst(data.payBy)}</span>
                    </>
                  ) : (
                    ` · ${(PAYMENT_STATUS[data.payment.status] ?? data.payment.status).toLowerCase()}`
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {data.state === 'WAITING' && <Waiting data={data} />}
        {data.state === 'CANCELLED' && (
          <section className="od-card oappr" role="status" aria-labelledby="so-cancelled">
            <header className="od-card__head">
              <h2 id="so-cancelled">This order was cancelled</h2>
            </header>
            <div className="od-card__body">
              <p className="oapprlead">
                There is no sales order and nothing is owed.{' '}
                {data.payment.status === 'PAID'
                  ? 'What was paid is refunded to the account it came from.'
                  : 'Nothing was charged.'}{' '}
                If you still need these machines, put them in a cart again — we will hold whatever
                is in stock.
              </p>
            </div>
          </section>
        )}

        <section className="od-card" aria-labelledby="so-lines">
          <header className="od-card__head">
            <h2 id="so-lines">
              {data.state === 'READY' ? (data.stage === 'PAID' ? 'What you were invoiced for' : 'What you will be invoiced for') : 'The lines on this order'}
            </h2>
            <span>
              {data.state === 'READY'
                ? 'Verified machines only. A machine we did not verify is not on the invoice.'
                : 'Each machine is named by our technician, then verified by us'}
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
          <Summary data={data} totals={data.totals} onPaid={onPaid} />
        ) : (
          <section className="od-card od-summary" aria-labelledby="so-money">
            <h2 id="so-money">
              {data.state === 'CANCELLED' ? 'Nothing is owed' : 'No amount to pay yet'}
            </h2>
            <p className="od-lead">
              {data.state === 'CANCELLED'
                ? 'No sales order exists for this booking, so there is no invoice and no payment.'
                : `The price, the GST and the freight appear here once every machine is verified — ${m.verified} of ${m.ordered} ${plural(m.verified, 'is', 'are')} so far. Nothing is charged until then.`}
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
  const m = data.machines;
  if (data.state === 'CANCELLED') {
    return <>This order was cancelled. Nothing is owed{data.payment.status === 'PAID' ? ', and what was paid is refunded' : ' and nothing was charged'}.</>;
  }
  if (data.state === 'WAITING') {
    return data.stage === 'VERIFICATION' ? (
      <>
        Every machine has a serial recorded by our technician; we are verifying each one. The sales
        order — the machines, the price, the GST and the freight — appears here the moment the last
        one is verified, and that is when you pay.
      </>
    ) : (
      <>
        Our technician is naming each machine at the supply point and recording its serial; we then
        verify every one. The sales order — the machines, the price, the GST and the freight —
        appears here the moment the last one is verified, and that is when you pay.
      </>
    );
  }
  if (data.stage === 'PAID') {
    return (
      <>
        <b className="mono">{m.verified}</b> of the <b className="mono">{m.ordered}</b> machines you
        ordered were verified by us{data.verifiedAt ? ` on ${inIst(data.verifiedAt)}` : ''}, and{' '}
        {data.payment.mode === 'CREDIT' ? (
          <>this is what {BRAND.legalEntity} invoices on your credit terms.</>
        ) : (
          <>
            you paid {BRAND.legalEntity} in full{data.paidAt ? ` on ${inIst(data.paidAt)}` : ''}. The
            dispatch point is sending your verified machines.
          </>
        )}
      </>
    );
  }
  return (
    <>
      <b className="mono">{m.verified}</b> of the <b className="mono">{m.ordered}</b> machines you
      ordered were verified by us{data.verifiedAt ? ` on ${inIst(data.verifiedAt)}` : ''}, and this is
      what they come to from {BRAND.legalEntity} on one invoice. Pay to confirm the order
      {data.payBy ? (
        <>
          {' '}
          by <b className="mono">{inIst(data.payBy)}</b>
        </>
      ) : null}
      .
    </>
  );
}

function Waiting({ data }: { data: SalesOrderView }): React.JSX.Element {
  const m = data.machines;
  return (
    <section className="od-card oappr pending" role="status" aria-labelledby="so-waiting">
      <header className="od-card__head">
        <h2 id="so-waiting">Waiting for every machine to be verified</h2>
      </header>
      <div className="od-card__body">
        <p className="oapprlead">
          <b className="mono">{m.inspected}</b> of <b className="mono">{m.ordered}</b> machines{' '}
          {plural(m.ordered, 'has', 'have')} a serial recorded by our technician, and{' '}
          <b className="mono">{m.verified}</b> of <b className="mono">{m.ordered}</b>{' '}
          {plural(m.verified, 'is', 'are')} verified. Until the last one is verified there is no
          sales order to price, so there is no amount here and <b>nothing has been charged</b>. You
          will see the verified machines, the price, the GST and the freight the moment it lands,
          with the date to pay by.
        </p>
      </div>
    </section>
  );
}

function Line({ line, ready }: { line: SalesOrderLine; ready: boolean }): React.JSX.Element {
  const short = ready && line.qtyVerified < line.qtyOrdered;
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
            <dt>Serial recorded</dt>
            <dd className="mono">
              {line.qtyInspected} of {line.qtyOrdered}
            </dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd className="mono">
              {line.qtyVerified} of {line.qtyOrdered}
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
          <span className="mono">{line.qtyVerified}</span> of the{' '}
          <span className="mono">{line.qtyOrdered}</span> you ordered were verified. Only the
          verified machines are priced here; the rest are not charged.
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
  onPaid,
}: {
  data: SalesOrderView;
  totals: NonNullable<SalesOrderView['totals']>;
  onPaid: () => void;
}): React.JSX.Element {
  const tax = totals.tax;
  const taxable = Money.parse(totals.subtotal).add(Money.parse(totals.freight));
  const paid = data.payment.status === 'PAID';
  return (
    <section className="od-card od-summary" aria-labelledby="so-money">
      <h2 id="so-money">{paid ? 'What you paid' : 'What this sales order comes to'}</h2>
      <p className="od-lead">
        The verified machines, the freight to your site, and the GST on both.{' '}
        {paid ? 'This is the figure on your invoice.' : 'This is the figure the invoice will carry.'}
      </p>
      <dl className="od-lines">
        <div>
          <dt>Verified machines</dt>
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
      <PayControl data={data} onPaid={onPaid} />
      <dl className="od-kv">
        <div>
          <dt>Payment</dt>
          <dd>
            {PAYMENT_STATUS[data.payment.status] ?? data.payment.status}
            {data.paidAt ? (
              <>
                {' '}
                · <span className="mono">{inIst(data.paidAt)}</span>
              </>
            ) : null}
          </dd>
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
 * The one primary action on this screen: the same button the order record
 * offers, so paying from either tab is the same payment.
 */
function PayControl({ data, onPaid }: { data: SalesOrderView; onPaid: () => void }): React.JSX.Element | null {
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
  if (!data.payment.payable) {
    return (
      <p className="fnote off">
        {data.payBy
          ? `The time to pay ran out at ${inIst(data.payBy)}. The machines have gone back on sale; put them in a cart again if you still need them.`
          : 'This order cannot be paid here right now.'}
      </p>
    );
  }
  return (
    <div className="od-paynow__body">
      {data.payBy && (
        <p className="od-paynow__deadline">
          Pay by <span className="mono">{inIst(data.payBy)}</span> · <Deadline expiresAt={data.payBy} />.
          After that the order is cancelled and the machines go back on sale.
        </p>
      )}
      <PayButton orderNumber={data.orderNumber} amount={data.totals.grandTotal} onPaid={onPaid} />
    </div>
  );
}
