'use client';

import * as React from 'react';
import {
  AddressCard,
  EmptyState,
  GradeBadge,
  PriceBreakup,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  type Address,
  type PriceLine,
} from '@trugrade/ui';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { Money, type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../../register/api';
import { Deadline, inIst } from './Deadline';
import {
  getOrder,
  type DispatchGroup,
  type OrderAddress,
  type OrderApproval,
  type OrderRecord as Order,
} from './api';

/**
 * One order, read back. See `page.tsx` for the archetype and the rules.
 *
 * A client component because the call is authenticated, because it can come back
 * 401 — a signed-out visitor is a state this screen renders, not a crash — and
 * because the approval deadline has to stay true while the tab is open.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();

const isGrade = (g: string): g is Grade => g === 'A_PLUS' || g === 'A' || g === 'B';

const machines = (n: number): string => `${n} machine${n === 1 ? '' : 's'}`;

type Phase =
  | { k: 'loading' }
  /** No session. Not a failure: a path exists and it comes back here. */
  | { k: 'signed-out' }
  /** No such order on this account. Deliberately the same screen either way. */
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; order: Order };

/**
 * What went wrong, in the server's words where it had any.
 *
 * `call`'s fallback for `UNKNOWN` and `NETWORK` describes a registration form,
 * and a refusal that describes the wrong screen is worse than a plain one.
 */
const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach your order just now. That is our problem, not yours — the order itself is unaffected.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function OrderRecord({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

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

  if (phase.k === 'loading') return <OrderSkeleton />;
  if (phase.k === 'signed-out') return <SignedOut orderNumber={orderNumber} />;
  if (phase.k === 'missing') return <Missing orderNumber={orderNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  return <Record order={phase.order} />;
}

/* ==========================================================================
 * The record
 * ======================================================================== */

function Record({ order }: { order: Order }): React.JSX.Element {
  const held = order.approval !== null && order.approval.status === 'PENDING';
  const released =
    order.approval !== null &&
    (order.approval.status === 'EXPIRED' || order.approval.status === 'REJECTED');
  const state = statusOf(order);

  return (
    <>
      <RecordHeader
        title={`Order ${order.orderNumber}`}
        subtitle={<Headline order={order} />}
        identifiers={[
          { label: 'Placed', value: inIst(order.placedAt) },
          { label: 'Machines', value: String(order.unitsAllocated) },
          {
            label: 'Dispatch points',
            value: String(order.dispatchGroups.length),
          },
        ]}
        status={<StatusPill tone={state.tone} label={state.label} />}
      />

      <div className="rec">
        <main className="evid">
          {/* The approval comes first, above the machines, because until it is
              answered it is the only thing about this order that is not yet
              settled. */}
          {order.approval && <ApprovalPanel approval={order.approval} order={order} />}

          <section aria-labelledby="machines">
            <div className="sh">
              <div className="shrow">
                <h2 id="machines">
                  {held
                    ? // NOT "your machines". They are off sale to everyone else
                      // and committed to nobody until the approval lands.
                      'The machines held against this order'
                    : released
                      ? 'The machines this order asked for'
                      : 'The machines allocated to you'}
                </h2>
                <span className="sub">
                  {order.dispatchGroups.length === 1
                    ? 'All from one dispatch point'
                    : `From ${order.dispatchGroups.length} dispatch points, so they can arrive on different days`}
                </span>
              </div>
            </div>
            <div className="omach">
              {order.dispatchGroups.map((group) => (
                <DispatchBlock key={group.label} group={group} released={released} />
              ))}
            </div>
          </section>

          <section aria-labelledby="delivery">
            <div className="sh">
              <div className="shrow">
                <h2 id="delivery">Where it goes</h2>
                <span className="sub">
                  The delivery state is what decided the tax split, not the GSTIN
                </span>
              </div>
            </div>
            <AddressCard address={asAddress(order.deliveryAddress)} />
          </section>

          <Documents order={order} />
        </main>

        <div className="sidep">
          <SidePanel
            title={
              held
                ? 'What this order would come to'
                : released
                  ? 'What this order would have come to'
                  : 'What this order comes to'
            }
            description={
              held
                ? 'Nothing is charged while it is with your approver, and this is the figure they were asked to sign off.'
                : released
                  ? 'Kept here so the figure that was asked for is on the record. No invoice was raised against it.'
                  : 'Every charge on this order is named here. Nothing was added afterwards.'
            }
            footnote={<Footnote order={order} />}
          >
            <Breakup order={order} />
            <dl className="facts">
              <div>
                <dt>Billed to</dt>
                <dd>{order.billedTo.legalName}</dd>
              </div>
              <div>
                <dt>
                  GSTIN <span className="denom">decides the billing entity</span>
                </dt>
                <dd className="mono">{order.billedTo.gstin}</dd>
              </div>
              <div>
                <dt>
                  Place of supply <span className="denom">s.10(1)(a) IGST Act</span>
                </dt>
                <dd>
                  {order.tax.placeOfSupplyState}{' '}
                  <span className="mono">{order.tax.placeOfSupplyStateCode}</span>
                </dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>{PAYMENT_MODE[order.paymentMode] ?? order.paymentMode}</dd>
              </div>
              <div>
                <dt>Cost centre</dt>
                {/* An absence renders as an absence. Never a blank that reads
                    as a recorded value. */}
                <dd className={order.costCentre ? undefined : 'notmeasured'}>
                  {order.costCentre ?? 'Not recorded'}
                </dd>
              </div>
            </dl>
          </SidePanel>
        </div>
      </div>
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
      {machines(order.unitsAllocated)} allocated to you by serial number, from{' '}
      {BRAND.legalEntity} on one invoice.
    </>
  );
}

/* ==========================================================================
 * The approval — what is held, for whom, until when, and what happens next
 * ======================================================================== */

function ApprovalPanel({
  approval,
  order,
}: {
  approval: OrderApproval;
  order: Order;
}): React.JSX.Element {
  const pending = approval.status === 'PENDING';
  return (
    <section
      aria-labelledby="approval"
      className={pending ? 'oappr pending' : 'oappr'}
      // Not `alert`: nothing here is urgent enough to interrupt a screen
      // reader mid-sentence, and the region is announced when it is reached.
      role="status"
    >
      <div className="sh">
        <div className="shrow">
          <h2 id="approval">
            {pending
              ? 'This order needs a signature before it can be placed'
              : approval.status === 'REJECTED'
                ? 'This order was declined'
                : approval.status === 'EXPIRED'
                  ? 'The approval window closed'
                  : 'This order was approved'}
          </h2>
        </div>
      </div>

      <p className="oapprlead">
        {pending ? (
          <>
            At <span className="mono">{rupees(approval.orderValue)}</span> this order is over the
            limit your organisation set for orders you may place on your own, so it sits at{' '}
            <b>awaiting approval</b>. It is <b>not confirmed</b>, nothing has been charged, and we
            have not bought anything on your behalf. What we have done is take the exact machines
            below off sale so they are still there when the answer comes.
          </>
        ) : approval.status === 'REJECTED' ? (
          <>
            The hold was released the moment it was declined, and those machines went back on sale
            to everyone. Nothing was charged and no order was placed.
          </>
        ) : approval.status === 'EXPIRED' ? (
          <>
            Stock cannot be held indefinitely waiting for an answer, so an approval expires after 24
            hours and the hold releases. Nothing was charged and no order was placed. If you still
            need these machines, put them in a cart again — we will hold whatever is still there.
          </>
        ) : (
          <>The hold became an allocation, and the machines below are yours by serial number.</>
        )}
      </p>

      <dl className="oapprfacts">
        <div>
          <dt>What is held</dt>
          <dd>
            {pending ? (
              <>
                <span className="mono">{order.unitsAllocated}</span> machines,{' '}
                <span className="mono">{rupees(approval.orderValue)}</span>
              </>
            ) : (
              <span className="notmeasured">
                Nothing — {approval.status === 'APPROVED' ? 'allocated' : 'the hold was released'}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Who was asked</dt>
          <dd>{approval.approverName}</dd>
        </div>
        <div>
          <dt>Who asked</dt>
          <dd>{approval.requestedByName}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd className="mono">{inIst(approval.requestedAt)}</dd>
        </div>
        <div>
          <dt>{pending ? 'Held until' : approval.status === 'EXPIRED' ? 'Expired' : 'Deadline was'}</dt>
          <dd className="mono">
            {inIst(approval.expiresAt)}
            {pending && (
              <>
                {' · '}
                <Deadline expiresAt={approval.expiresAt} />
              </>
            )}
          </dd>
        </div>
        {approval.decidedAt && (
          <div>
            <dt>Answered</dt>
            <dd className="mono">{inIst(approval.decidedAt)}</dd>
          </div>
        )}
        {/* Only once somebody actually answered — which `decidedAt` is the
            record of, and an expiry is not. "Note from the approver — none
            recorded" against a request nobody opened reads as though they
            looked at it and chose to say nothing. */}
        {approval.decidedAt !== null && (
          <div>
            <dt>{approval.status === 'REJECTED' ? 'Reason given' : 'Note from the approver'}</dt>
            {/* A missing reason is a missing reason. Inventing "not specified"
                would read as a recorded fact. */}
            <dd className={approval.comment ? undefined : 'notmeasured'}>
              {approval.comment ?? 'None recorded'}
            </dd>
          </div>
        )}
      </dl>

      {pending && (
        <p className="fnote off">
          If {approval.approverName} does not answer by{' '}
          <span className="mono">{inIst(approval.expiresAt)}</span>, the hold releases on its own,
          those machines go back on sale to everyone, and you are told. Nothing else happens — there
          is no charge and no order to cancel. This is the only deadline on this screen, and it is
          one we set ourselves so that stock is not held out of the market indefinitely.
        </p>
      )}
    </section>
  );
}

/* ==========================================================================
 * The machines
 * ======================================================================== */

function DispatchBlock({
  group,
  released,
}: {
  group: DispatchGroup;
  released: boolean;
}): React.JSX.Element {
  return (
    <div className="tbl odisp">
      <div className="tbh">
        <b>{group.label}</b>
        <span className="m">
          {group.machines.length} {group.machines.length === 1 ? 'machine' : 'machines'}
        </span>
      </div>
      <ul className="omlist">
        {group.machines.map((m) => (
          <li key={m.serialNumber}>
            <div className="omid">
              {/* The serial is the link. A buyer checking one machine wants the
                  passport for that machine, not the model page. */}
              <a className="mono omserial" href={`/unit/${m.serialNumber}`}>
                {m.serialNumber}
              </a>
              <span className="omtitle">
                {m.title ?? <span className="notmeasured">Model no longer catalogued</span>}
              </span>
              {m.specSummary && <span className="omspec">{m.specSummary}</span>}
            </div>
            <div className="omright">
              {isGrade(m.grade) ? (
                <GradeBadge grade={m.grade} />
              ) : (
                <span className="notmeasured">Grade not recorded</span>
              )}
              <span className="mono omprice">{rupees(m.unitPrice)}</span>
            </div>
          </li>
        ))}
      </ul>
      {released && (
        <p className="omreleased">
          These serials are no longer held. They are back on sale and may already have gone to
          someone else.
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * Documents — PHASE_06 Task 6, and the distinction it exists to protect
 * ======================================================================== */

/**
 * The documents on this order.
 *
 * PHASE_06 Task 6 lists three documents and warns that they must not be
 * confused. Two of them belong to the buyer and are here: **their own PO
 * reference**, which their procurement system issued and which prints on our
 * invoice, and **our order confirmation to them**, which is this page. The
 * third — our purchase order to a supply point — is vendor-and-admin-only, and
 * the way that stays true is that no buyer-reachable endpoint reads it, so there
 * is nothing on this screen to omit.
 *
 * The proforma and the tax invoice say **not issued yet** rather than showing a
 * disabled download that would suggest a file exists. Neither is generated yet
 * (the proforma is the rest of Task 6; the tax invoice is Phase 7), and a
 * missing document drawn as a present one is the same failure as a missing
 * measurement drawn as a passing one.
 */
function Documents({ order }: { order: Order }): React.JSX.Element {
  const confirmed = order.approval === null || order.approval.status === 'APPROVED';
  return (
    <section aria-labelledby="documents">
      <div className="sh">
        <div className="shrow">
          <h2 id="documents">Documents on this order</h2>
          <span className="sub">One seller, one invoice</span>
        </div>
      </div>
      <div className="tbl odocs">
        <dl>
          <div>
            <dt>
              Your PO reference
              <span className="d">
                Issued by your procurement system. It prints on our invoice.
              </span>
            </dt>
            <dd className={order.buyerPoNumber ? 'mono' : 'notmeasured'}>
              {order.buyerPoNumber ?? 'None given'}
            </dd>
          </div>
          <div>
            <dt>
              Our order confirmation
              <span className="d">
                What {LEGAL_DISCLOSURE.legalName} has recorded against{' '}
                <span className="mono">{order.orderNumber}</span>.
              </span>
            </dt>
            <dd>This page</dd>
          </div>
          <div>
            <dt>
              Proforma invoice
              <span className="d">For your finance team to raise payment against.</span>
            </dt>
            <dd className="notmeasured">Not issued yet</dd>
          </div>
          <div>
            <dt>
              Tax invoice
              <span className="d">
                Raised when the machines are dispatched, not before.
              </span>
            </dt>
            <dd className="notmeasured">
              {confirmed ? 'Not issued yet' : 'Not issued — this order is not confirmed'}
            </dd>
          </div>
        </dl>
        <p className="fnote off">
          {BRAND.legalEntity} is the seller on this order, so there is one invoice and it is ours.
          Every document that concerns you is listed above; there is no other paperwork for you to
          chase and none of it is issued by anyone else.
        </p>
      </div>
    </section>
  );
}

/* ==========================================================================
 * Money
 * ======================================================================== */

function Breakup({ order }: { order: Order }): React.JSX.Element {
  const lines: PriceLine[] = [
    { label: 'Machines', amount: Money.parse(order.subtotal) },
    {
      label: 'Freight',
      amount: Money.parse(order.freight),
      note: `to ${order.deliveryAddress.pincode}`,
    },
  ];
  if (order.tax.interState) {
    lines.push({ label: `IGST ${order.tax.ratePct}%`, amount: Money.parse(order.tax.igst) });
  } else {
    lines.push({ label: `CGST ${order.tax.ratePct / 2}%`, amount: Money.parse(order.tax.cgst) });
    lines.push({
      label: `${order.tax.stateTaxLabel} ${order.tax.ratePct / 2}%`,
      amount: Money.parse(order.tax.sgst),
    });
  }
  return (
    <PriceBreakup
      lines={lines}
      valuationMethod="REGULAR"
      taxNote={
        order.tax.interState
          ? `Inter-state supply — we are registered in ${LEGAL_DISCLOSURE.registeredOffice.state} (${order.tax.ourStateCode}) and the movement terminates in ${order.tax.placeOfSupplyState} (${order.tax.placeOfSupplyStateCode}), so the whole tax is IGST.`
          : `Intra-state supply — the movement terminates in ${order.tax.placeOfSupplyState} (${order.tax.placeOfSupplyStateCode}), where we are registered too, so it splits into CGST and ${order.tax.stateTaxLabel}.`
      }
    />
  );
}

function Footnote({ order }: { order: Order }): React.JSX.Element {
  if (order.approval?.status === 'PENDING') {
    return (
      <>
        <b>Nothing has been charged.</b> This is what the order would come to if it is approved. If
        the price of a machine changes between now and then, the figure on the confirmation is the
        one we honour.
      </>
    );
  }
  if (order.approval?.status === 'REJECTED' || order.approval?.status === 'EXPIRED') {
    return (
      <>
        <b>Nothing was charged.</b> This is what the order would have come to. No invoice exists and
        none will.
      </>
    );
  }
  return (
    <>
      <b>Nothing has been charged yet.</b> This is the figure the invoice will carry, and it is the
      whole of it — {order.tax.basis}.
    </>
  );
}

/* ==========================================================================
 * States that are not the record
 * ======================================================================== */

export function OrderSkeleton(): React.JSX.Element {
  return (
    <div className="recskel">
      <Skeleton className="h-9 w-72 rounded" />
      <div className="rec">
        <div className="evid">
          <Skeleton className="h-44 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <div className="sidep">
          <Skeleton className="h-72 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function SignedOut({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to see this order"
        body="An order belongs to the organisation that placed it, so we need to know who is asking. Signing in brings you straight back to this order."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/orders/${orderNumber}`)}`}
          >
            Sign in
          </a>
        }
      />
    </div>
  );
}

/**
 * No such order **on this account**.
 *
 * Deliberately the same screen for an order that does not exist and one that
 * belongs to another organisation — the API answers 404 for both. Order numbers
 * are sequential, so a screen that distinguished them would let anyone with an
 * account count our orders.
 *
 * Hand-rolled on `.empty` rather than `EmptyState` for one reason: two order
 * numbers appear in the sentence and both have to be mono. `EmptyState.body` is
 * typed `string`, so it cannot carry a `<span className="mono">`. The fix
 * belongs in the component and is reported in the ledger.
 */
function Missing({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty">
        <h3>We have no order with that number on your account</h3>
        <p>
          Nothing on your organisation&rsquo;s account is numbered{' '}
          <span className="mono">{orderNumber}</span>. Check it against your confirmation — ours
          look like <span className="mono">TT-26-00004</span> — or ask whoever placed it to share
          it from their account.
        </p>
        <p className="retry">
          <a className="pill acc" href="/search">
            Browse laptops
          </a>
        </p>
      </div>
    </div>
  );
}

function Failed({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty err" role="alert">
        <h3>We could not open this order</h3>
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
 * Small mappings
 * ======================================================================== */

const PAYMENT_MODE: Record<string, string> = {
  PREPAID: 'Prepaid',
  PARTIAL_ADVANCE: 'Part advance, balance before dispatch',
  CREDIT: 'On our credit terms',
};

/**
 * The pill.
 *
 * `warn` on a live approval because it is a genuine hold-up somebody has to act
 * on. Neutral everywhere else: green and red are PASS and FAIL, and an order
 * state is neither a pass nor a failure. In particular an order awaiting a
 * signature never carries a word suggesting it is confirmed or paid.
 */
function statusOf(order: Order): { tone: 'neutral' | 'warn'; label: string } {
  const approval = order.approval;
  if (approval?.status === 'PENDING') return { tone: 'warn', label: 'Awaiting approval' };
  if (approval?.status === 'REJECTED') return { tone: 'neutral', label: 'Approval declined' };
  if (approval?.status === 'EXPIRED') return { tone: 'neutral', label: 'Approval expired' };
  if (order.status === 'PAYMENT_PENDING')
    return { tone: 'neutral', label: 'Placed · payment pending' };
  return { tone: 'neutral', label: order.status.replace(/_/g, ' ').toLowerCase() };
}

const asAddress = (a: OrderAddress): Address => ({
  label: a.label ?? `${a.city} site`,
  line1: a.line1,
  ...(a.line2 ? { line2: a.line2 } : {}),
  city: a.city,
  state: a.state,
  pincode: a.pincode,
  ...(a.landmark ? { landmark: a.landmark } : {}),
  contactName: a.contactName,
  contactMobile: a.contactMobile,
  ...(a.gateInstructions ? { gateInstructions: a.gateInstructions } : {}),
});
