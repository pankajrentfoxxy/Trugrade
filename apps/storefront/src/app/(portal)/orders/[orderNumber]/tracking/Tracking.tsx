'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { EmptyState, Skeleton, StatusPill, Timeline, type TimelineEvent } from '@trugrade/ui';
import type { ApiFailure } from '../../../../register/api';
import {
  getDelivery,
  type DeliveryConsignment,
  type DeliveryStage,
  type DeliveryStep,
  type DeliveryView,
} from '../delivery/api';

/**
 * Where each consignment on this order has got to.
 *
 * `OrderNav`'s own doc comment and the record's layout both named `/tracking`
 * as spec'd, and the route did not exist — two promises and a 404.
 *
 * **What this screen deliberately does not show: a carrier, an AWB or an ETA.**
 * `logistics.shipment` and `logistics.shipment_tracking` model all three, and
 * both have zero rows and no writer anywhere in this product — the ops
 * dashboard says so in its own words rather than rendering a count that would
 * read as "none failed" instead of "we are not recording deliveries". Inventing
 * a carrier name and a delivery date here would be the first fabricated fact on
 * a buyer-facing screen, so what is missing says what will bring it.
 *
 * What IS real is the consignment itself: which supply point it left, the
 * status the order carries, the instant it arrived when it has, and the
 * inspection window that opens on arrival. `DeliveryConsignment.status` has
 * existed on this type all along and was rendered nowhere.
 *
 * No vendor, anywhere. A consignment is `Delivery 2 of 3 · Supply Point A ·
 * Gurugram`, which is the same label the delivery screen uses.
 */

type Phase =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: DeliveryView };

const problem = (f: ApiFailure): string =>
  f.code === 'UNKNOWN' || f.code === 'NETWORK'
    ? 'We could not reach your order just now. That is our problem, not yours — the delivery is unaffected.'
    : f.message;

/** IST, because a delivery happened at a time of day somebody was standing there. */
const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * The status a consignment carries, in the buyer's words.
 *
 * Every `order_status` the consignment row can hold is here, because the
 * fallback used to print the enum — and `VENDOR_ACCEPTED`, the state a real
 * order sits in longest, put the word "vendor" on a buyer's screen. A status
 * this map still does not know says "In progress" rather than naming itself.
 */
const STATE: Readonly<Record<string, { label: string; tone: 'pass' | 'info' | 'neutral' }>> = {
  CREATED: { label: 'Not yet placed', tone: 'neutral' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'neutral' },
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'neutral' },
  VENDOR_ACCEPTED: { label: 'Being prepared', tone: 'neutral' },
  PICKUP_SCHEDULED: { label: 'Being prepared', tone: 'neutral' },
  PACKED: { label: 'Being prepared', tone: 'neutral' },
  INVOICED: { label: 'Being prepared', tone: 'neutral' },
  QC_IN_PROGRESS: { label: 'Being prepared', tone: 'neutral' },
  QC_HOLD: { label: 'Being prepared', tone: 'neutral' },
  QC_CLEARED: { label: 'Being prepared', tone: 'neutral' },
  PICKED_UP: { label: 'On its way', tone: 'info' },
  DISPATCHED: { label: 'On its way', tone: 'info' },
  AT_HUB: { label: 'On its way', tone: 'info' },
  IN_TRANSIT: { label: 'On its way', tone: 'info' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'pass' },
  PARTIALLY_FULFILLED: { label: 'Delivered', tone: 'pass' },
  COMPLETED: { label: 'Delivered', tone: 'pass' },
  RETURN_REQUESTED: { label: 'Return requested', tone: 'neutral' },
  RETURNED: { label: 'Returned', tone: 'neutral' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  VENDOR_REJECTED: { label: 'Cancelled', tone: 'neutral' },
  RTO: { label: 'Cancelled', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};
const UNKNOWN_STATE = { label: 'In progress', tone: 'neutral' as const };

/** Green is for arrived, blue for moving, neutral for everything else. Never red: none of these is a verdict. */
const TONE: Readonly<Record<DeliveryStage, 'pass' | 'info' | 'neutral'>> = {
  PLACED: 'neutral',
  APPROVED: 'neutral',
  CONFIRMED: 'neutral',
  PREPARING: 'neutral',
  DISPATCHED: 'info',
  DELIVERED: 'pass',
  RECEIVED: 'pass',
  CANCELLED: 'neutral',
};

/**
 * Who did it, per stage. We are the seller, so everything between the buyer's
 * own actions is "Trugrade" — never a supply point's operator by name.
 */
const ACTOR: Readonly<Record<DeliveryStage, string>> = {
  PLACED: 'Your team',
  APPROVED: 'Your approver',
  CONFIRMED: 'Trugrade',
  PREPARING: 'Trugrade',
  DISPATCHED: 'Trugrade',
  DELIVERED: 'Trugrade',
  RECEIVED: 'Your team',
  CANCELLED: 'Trugrade',
};

/** A done step with no recorded instant says so. It never borrows a neighbour's time. */
/**
 * One rail for the whole journey. A stage still to come is an upcoming event
 * on the same list rather than a second list underneath: the buyer is asking
 * "where is it", and the answer is a position on a path, which needs the path.
 */
const toEvent = (step: DeliveryStep): TimelineEvent =>
  step.state === 'upcoming'
    ? { key: step.stage, action: step.label, upcoming: true }
    : {
        key: step.stage,
        action: step.label,
        actor: ACTOR[step.stage],
        at: step.at ? when(step.at) : 'Time not recorded',
        dateTime: step.at ?? undefined,
        current: step.state === 'current',
      };

export function Tracking({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getDelivery(orderNumber);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', data: result.data });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [orderNumber]);

  if (phase.k === 'loading') {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (phase.k === 'error') {
    return (
      <div className="ostate">
        <EmptyState title="This order did not load" body={phase.message} />
      </div>
    );
  }

  const { consignments } = phase.data;

  return (
    <>
      {consignments.length === 0 ? (
        <EmptyState
          title="Nothing has been dispatched yet"
          body="When the machines on this order leave a supply point, each consignment appears here with where it went and when it arrived."
        />
      ) : (
        <div className="od-col">
          {consignments.map((c) => (
            <Consignment key={c.index} consignment={c} orderNumber={orderNumber} />
          ))}
        </div>
      )}
    </>
  );
}

function Consignment({
  consignment: c,
  orderNumber,
}: {
  consignment: DeliveryConsignment;
  orderNumber: string;
}): React.JSX.Element {
  // The pill and the rail must agree. `sub_order.status` lags the events — a
  // vendor's acknowledgement writes an event and leaves the row at CONFIRMED —
  // so when the timeline has a current step, that step is what the pill names.
  const current = c.timeline.find((s) => s.state === 'current');
  const state = current
    ? { label: current.label, tone: TONE[current.stage] }
    : (STATE[c.status] ?? UNKNOWN_STATE);
  // What is holding the delivery, in the server's own words. The consignment
  // sentence first; then each machine that carries its own reason, because
  // "TGD…397 has a seal we cannot vouch for" and the sentence under that serial
  // are two different levels of the same fact. Nothing here is decided in the
  // browser — `blockedReason` arrives already decided.
  const held = c.machines.filter((m) => m.blockedReason !== null);

  return (
    <section className="od-card dvcons" aria-label={c.label}>
      <header className="od-card__head dvconshead">
        <h2>{c.label}</h2>
        <StatusPill tone={state.tone} label={state.label} />
      </header>

      <div className="od-card__body">
        <dl className="od-kv od-kv--row">
          <div>
            <dt>Machines</dt>
            <dd className="mono">{c.machines.length}</dd>
          </div>
          <div>
            <dt>Arrived</dt>
            {/* A delivery that has not happened says so. It is never "today". */}
            <dd className={c.deliveredAt ? 'mono' : 'ink4'}>
              {c.deliveredAt ? when(c.deliveredAt) : 'Not yet'}
            </dd>
          </div>
          <div>
            <dt>Signed for</dt>
            <dd className={c.receiptConfirmedAt ? 'mono' : 'ink4'}>
              {c.receiptConfirmedAt ? when(c.receiptConfirmedAt) : 'Not yet'}
            </dd>
          </div>
          {c.window ? (
            <div>
              <dt>Inspection window</dt>
              <dd>
                {c.window.open ? (
                  <>
                    <span className="mono">{c.window.hoursRemaining}</span> hours left
                  </>
                ) : (
                  'Closed'
                )}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="dvtl">
          <h3>Where it has got to</h3>
          <Timeline events={c.timeline.map(toEvent)} label={`${c.label} timeline`} />
          {c.blockedReason !== null || held.length > 0 ? (
            <div className="dvhold" data-testid="delivery-hold">
              <h4>What is holding it</h4>
              {c.blockedReason !== null ? <p>{c.blockedReason}</p> : null}
              {held.length > 0 ? (
                <ul aria-label="Machines with something to resolve">
                  {held.map((m, i) => (
                    <li key={m.serialNumber ?? `slot-${i}`}>
                      <span className="dvholdwho">
                        {m.serialNumber !== null ? (
                          <span className="mono">{m.serialNumber}</span>
                        ) : (
                          <span className="notmeasured">Serial not assigned yet</span>
                        )}
                        {m.title ? <> · {m.title}</> : null}
                        {m.specSummary ? <span className="dvspec"> · {m.specSummary}</span> : null}
                      </span>
                      {/* A seal we cannot vouch for is the one verdict on this
                        screen and keeps the manifest's red; everything else is
                        a wait, in --ink-2. */}
                      <span
                        className={
                          m.seal !== null &&
                          (m.seal.status === 'BROKEN' || m.seal.status === 'MISSING')
                            ? 'dvstop'
                            : 'dvtodo'
                        }
                      >
                        {m.blockedReason}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        {/*
        The half of tracking this product cannot answer, said plainly rather
        than left as an empty row that reads like a value we have.
        `documents/api.ts` carries a `whenItWillExist` sentence per document for
        exactly this reason; this is the same grammar.
      */}
        <p className="fnote off">
          {c.deliveredAt
            ? 'Carrier scans are not recorded on this order. What is above is what our own people logged at the door.'
            : 'No carrier scan has reached us, so there is no courier reference or estimated date to show. We record the arrival ourselves when the machines reach you.'}
        </p>

        <p className="dvgo">
          <Link
            href={`/orders/${encodeURIComponent(orderNumber)}/delivery` as Route}
            className="hub-link"
          >
            Check the seals on this delivery
          </Link>
        </p>
      </div>
    </section>
  );
}
