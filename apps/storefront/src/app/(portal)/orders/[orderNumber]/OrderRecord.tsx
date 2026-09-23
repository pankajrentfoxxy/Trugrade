'use client';

import * as React from 'react';
import Link from 'next/link';
import { EmptyState, GradeBadge, InfoPopover, Skeleton, StatusPill } from '@trugrade/ui';
import { BRAND, LEGAL_DISCLOSURE } from '@trugrade/config/brand';
import { Money } from '@trugrade/contracts';
import { Deadline, inIst } from '../../../../lib/deadline';
import { useSharedOrder } from './OrderChrome';
import { FileIcon, LaptopIcon, LinesIcon, PinIcon } from './icons';
import { isGrade, problem, rupees, standing, type OrderPhase, type Standing } from './order-state';
import {
  getOrder,
  type DispatchGroup,
  type OrderAddress,
  type OrderApproval,
  type OrderRecord as Order,
  type SupplyLine,
} from './api';

/**
 * One order, read back. See `page.tsx` for the archetype and the rules.
 *
 * The body under the order's chrome: machines, what each dispatch point can
 * send, delivery and documents on the left; the money and the billing entity on
 * the right. The header, the progress strip, the next-step banner and the tab
 * strip are `OrderChrome`'s, mounted by the layout, so they are the same on
 * every tab of this order.
 *
 * A client component because the call is authenticated, because it can come back
 * 401 — a signed-out visitor is a state this screen renders, not a crash — and
 * because the approval deadline has to stay true while the tab is open. Inside
 * the chrome it reads the order the chrome already fetched; rendered on its own
 * (tests, or any future host) it fetches for itself.
 */

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function OrderRecord({ orderNumber }: { orderNumber: string }): React.JSX.Element {
  const shared = useSharedOrder();
  const [own, setOwn] = React.useState<OrderPhase>({ k: 'loading' });
  const standalone = shared === null;

  React.useEffect(() => {
    if (!standalone) return;
    let live = true;
    void (async () => {
      const result = await getOrder(orderNumber);
      if (!live) return;
      if (result.ok) setOwn({ k: 'ready', order: result.data });
      else if (result.status === 401) setOwn({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setOwn({ k: 'missing' });
      else setOwn({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [orderNumber, standalone]);

  const phase = shared ?? own;

  if (phase.k === 'loading') return <OrderSkeleton />;
  if (phase.k === 'signed-out') return <SignedOut orderNumber={orderNumber} />;
  if (phase.k === 'missing') return <Missing orderNumber={orderNumber} />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  return <Body order={phase.order} />;
}

/* ==========================================================================
 * The record
 * ======================================================================== */

function Body({ order }: { order: Order }): React.JSX.Element {
  const at = standing(order);
  const pdf = `/api/buyer/orders/${encodeURIComponent(order.orderNumber)}/confirmation.pdf`;

  return (
    <div className="od-grid">
      <div className="od-col">
        {order.approval && <ApprovalPanel approval={order.approval} order={order} />}

        <MachinesCard order={order} at={at} />

        {/* Only once the order is placed: a held or released order has no
            consignment for a dispatch point to answer, so there is nothing
            honest to show. */}
        {at.placed && order.supply.length > 0 && <SupplySection lines={order.supply} />}

        <DeliveryCard address={order.deliveryAddress} />

        <Documents order={order} pdf={pdf} />
      </div>

      <aside className="od-col">
        <Summary order={order} at={at} />
        <Billing order={order} />
        <p className="od-help">
          Questions about this order?{' '}
          <a className="hub-link" href={`mailto:${BRAND.support}`}>
            Contact support
          </a>
        </p>
      </aside>
    </div>
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
      className={pending ? 'od-card oappr pending' : 'od-card oappr'}
      // Not `alert`: nothing here is urgent enough to interrupt a screen
      // reader mid-sentence, and the region is announced when it is reached.
      role="status"
    >
      <header className="od-card__head">
        <h2 id="approval">
          {pending
            ? 'This order needs a signature before it can be placed'
            : approval.status === 'REJECTED'
              ? 'This order was declined'
              : approval.status === 'EXPIRED'
                ? 'The approval window closed'
                : 'This order was approved'}
        </h2>
      </header>
      <div className="od-card__body">
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
              Stock cannot be held indefinitely waiting for an answer, so an approval expires after
              24 hours and the hold releases. Nothing was charged and no order was placed. If you
              still need these machines, put them in a cart again — we will hold whatever is still
              there.
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
            <dt>
              {pending ? 'Held until' : approval.status === 'EXPIRED' ? 'Expired' : 'Deadline was'}
            </dt>
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
            those machines go back on sale to everyone, and you are told. Nothing else happens —
            there is no charge and no order to cancel. This is the only deadline on this screen, and
            it is one we set ourselves so that stock is not held out of the market indefinitely.
          </p>
        )}
      </div>
    </section>
  );
}

/* ==========================================================================
 * The machines
 * ======================================================================== */

function MachinesCard({ order, at }: { order: Order; at: Standing }): React.JSX.Element {
  const n = order.unitsAllocated;
  return (
    <section className="od-card" aria-labelledby="machines">
      <header className="od-card__head">
        <h2 id="machines">
          {at.held
            ? 'The machines held against this order'
            : at.released
              ? 'The machines that were held'
              : n === 1
                ? 'Your machine'
                : 'Your machines'}
        </h2>
        <span>
          {at.held
            ? 'Off sale to everyone else until the answer comes'
            : at.released
              ? 'The hold is gone'
              : 'Allocated by serial number'}
        </span>
      </header>
      {order.dispatchGroups.map((g, i) => (
        <DispatchBlock
          key={`${g.label}-${i}`}
          group={g}
          supply={order.supply.filter((l) => l.label === g.label)}
          at={at}
          orderNumber={order.orderNumber}
        />
      ))}
    </section>
  );
}

function DispatchBlock({
  group,
  supply,
  at,
  orderNumber,
}: {
  group: DispatchGroup;
  /** This dispatch point's lines, for the stock pill. Empty until it is asked. */
  supply: SupplyLine[];
  at: Standing;
  /** So a serial can link to this order's own machines board. */
  orderNumber: string;
}): React.JSX.Element {
  return (
    <div className="od-dispatch">
      {group.machines.map((m, i) => (
        <div className="od-machine" key={`${m.serialNumber}-${i}`}>
          <div className="od-thumb" aria-hidden="true">
            <LaptopIcon />
          </div>
          <div className="od-machine__body">
            <div className="od-machine__name">
              {m.title ?? <span className="notmeasured">Model no longer catalogued</span>}
              {isGrade(m.grade) ? (
                <GradeBadge grade={m.grade} />
              ) : (
                <span className="notmeasured od-machine__nograde">Grade not recorded</span>
              )}
            </div>
            {m.specSummary && (
              <div className="od-specs">
                {m.specSummary.split(' · ').map((part, j) => (
                  <span key={`${part}-${j}`}>{part}</span>
                ))}
              </div>
            )}
            {/*
              The serial is the link, and it stays inside the portal.

              It used to go straight to `/unit/[serial]` — the PUBLIC passport,
              outside the portal chrome — so a buyer checking one machine on
              their own order left the portal without meaning to. The primary
              click is this order's own machines board, which carries the QC
              verdict, the battery health and the seal. The passport is still
              one click from there.
            */}
            {m.serialNumber ? (
              <Link
                className="mono od-serial"
                href={`/orders/${encodeURIComponent(orderNumber)}/units#${m.serialNumber}`}
              >
                {m.serialNumber}
              </Link>
            ) : (
              // A line the dispatch point has not yet put a serial against.
              // An absence, never an empty link.
              <span className="notmeasured od-serial">Serial not yet allocated</span>
            )}
          </div>
          <div className="od-price">
            <div className="od-price__amt mono">{rupees(m.unitPrice)}</div>
            <div className="od-price__note">excl. GST</div>
          </div>
        </div>
      ))}
      <div className="od-ship">
        <PinIcon />
        <span>
          {at.placed ? 'Ships from' : 'Held at'} <strong>{group.label}</strong>
        </span>
        {/* Once it has left, what the dispatch point said beforehand is history:
            the chip says so rather than contradicting the progress strip. */}
        {at.placed &&
          (at.shipped ? (
            <StatusPill tone="neutral" label="Shipped" className="od-stock" />
          ) : (
            <StockPill lines={supply} />
          ))}
      </div>
      {at.released && (
        <p className="od-ship od-ship--note">
          These serials are no longer held. They are back on sale and may already have gone to
          someone else.
        </p>
      )}
    </div>
  );
}

/**
 * What this dispatch point has said about its lines, in one chip.
 *
 * Unanswered is an absence — "not confirmed yet" in `--ink-4` — never a count.
 * Confirmed always carries its denominator.
 */
function StockPill({ lines }: { lines: SupplyLine[] }): React.JSX.Element | null {
  if (lines.length === 0) return null;
  const unanswered = lines.some((l) => l.qtyAvailable === null);
  if (unanswered) {
    return <span className="od-stock notmeasured">Stock not confirmed yet</span>;
  }
  const ordered = lines.reduce((n, l) => n + l.qtyOrdered, 0);
  const confirmed = lines.reduce((n, l) => n + (l.qtyAvailable ?? 0), 0);
  return (
    <StatusPill
      tone="neutral"
      label={confirmed === ordered ? 'Stock confirmed' : `${confirmed} of ${ordered} confirmed`}
      className="od-stock"
    />
  );
}

/* ==========================================================================
 * Supply — what each dispatch point said it can send
 * ======================================================================== */

/**
 * Line by line: what was ordered, and how many the dispatch point confirmed.
 *
 * An unanswered line is neither "0" nor "all of them". It renders as an
 * absence, in `--ink-4`, until the dispatch point has answered — and once it
 * has, the confirmed quantity always carries its denominator.
 */
function SupplySection({ lines }: { lines: SupplyLine[] }): React.JSX.Element {
  const answered = lines.filter((l) => l.qtyAvailable !== null);
  const short = answered.filter((l) => (l.qtyAvailable ?? 0) < l.qtyOrdered);
  return (
    <section className="od-card" aria-labelledby="supply">
      <header className="od-card__head">
        <h2 id="supply">What each dispatch point can send</h2>
        <span>
          {answered.length === 0
            ? 'Waiting for the dispatch points to confirm'
            : answered.length < lines.length
              ? `${answered.length} of ${lines.length} lines confirmed so far`
              : short.length === 0
                ? 'Every line confirmed in full'
                : `${short.length} of ${lines.length} lines short — we are sourcing the rest`}
        </span>
      </header>
      <ul className="od-sup">
        {lines.map((l, i) => {
          const isShort = l.qtyAvailable !== null && l.qtyAvailable < l.qtyOrdered;
          return (
            <li key={`${l.label}-${l.title ?? ''}-${l.grade}-${i}`}>
              <div className="od-sup__row">
                <div className="od-sup__id">
                  <span className="od-sup__label">{l.label}</span>
                  <span className="od-sup__title">
                    {l.title ?? <span className="notmeasured">Model no longer catalogued</span>}
                    {isGrade(l.grade) ? (
                      <GradeBadge grade={l.grade} />
                    ) : (
                      <span className="notmeasured">Grade not recorded</span>
                    )}
                  </span>
                  {l.specSummary && <span className="od-sup__spec">{l.specSummary}</span>}
                </div>
                <div className="od-sup__qty">
                  {l.qtyAvailable === null ? (
                    <span>
                      <span className="mono">{l.qtyOrdered}</span> ordered ·{' '}
                      <span className="notmeasured">not confirmed yet</span>
                    </span>
                  ) : (
                    <>
                      <span>
                        <span className="mono">{l.qtyAvailable}</span> of{' '}
                        <span className="mono">{l.qtyOrdered}</span> confirmed
                      </span>
                      {l.answeredAt && (
                        <span className="od-sup__when mono">{inIst(l.answeredAt)}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              {isShort && (
                <p className="od-sup__short">
                  This dispatch point can send <span className="mono">{l.qtyAvailable}</span> of the{' '}
                  <span className="mono">{l.qtyOrdered}</span> you ordered. We are sourcing the
                  rest, and nothing extra is charged until it is settled.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ==========================================================================
 * Delivery
 * ======================================================================== */

function DeliveryCard({ address }: { address: OrderAddress }): React.JSX.Element {
  return (
    <section className="od-card" aria-labelledby="delivery">
      <header className="od-card__head">
        <h2 id="delivery">Delivery</h2>
        {/* /addresses had zero inbound links: the rail was its only entry. */}
        <Link className="hub-link od-card__link" href="/addresses">
          Your delivery sites
        </Link>
      </header>
      <div className="od-delivery">
        <div>
          <div className="od-block">
            <div className="od-label">Deliver to</div>
            <div className="od-addr-name">{address.label ?? `${address.city} site`}</div>
            <address className="od-addr">
              {address.line1}
              {address.line2 && (
                <>
                  <br />
                  {address.line2}
                </>
              )}
              <br />
              {address.city}, {address.state} <span className="mono">{address.pincode}</span>
            </address>
          </div>
          <div className="od-block">
            <div className="od-label">Receiver</div>
            <div className="od-addr">{address.contactName}</div>
            <a className="mono od-tel" href={`tel:${address.contactMobile}`}>
              {address.contactMobile}
            </a>
          </div>
        </div>
        <div>
          <dl className="od-kv">
            {/* Every absence below is an absence, in --ink-4 — never a blank
                that reads as a recorded value. */}
            <div>
              <dt>Receiving hours</dt>
              <dd className={address.receivingHours ? undefined : 'notmeasured'}>
                {address.receivingHours ?? 'Not added'}
              </dd>
            </div>
            <div>
              <dt>Gate instructions</dt>
              <dd className={address.gateInstructions ? undefined : 'notmeasured'}>
                {address.gateInstructions ?? 'None added'}
              </dd>
            </div>
            <div>
              <dt>Landmark</dt>
              <dd className={address.landmark ? undefined : 'notmeasured'}>
                {address.landmark ?? 'None added'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
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
 * invoice, and **our order confirmation to them**. The third — our purchase
 * order to a supply point — is vendor-and-admin-only, and the way that stays
 * true is that no buyer-reachable endpoint reads it, so there is nothing on
 * this screen to omit.
 *
 * The proforma, the tax invoice and the e-way bill are NOT restated here. They
 * were hard-coded to "not issued yet" while nothing could issue one; T22 built
 * the issuance and gave them a screen that reads their real state, so this panel
 * points at it rather than keeping a second copy that would go stale the first
 * time an invoice was raised.
 */
function Documents({ order, pdf }: { order: Order; pdf: string }): React.JSX.Element {
  return (
    <section className="od-card" aria-labelledby="documents">
      <header className="od-card__head">
        <h2 id="documents">Documents</h2>
        <span>One seller, one invoice</span>
      </header>
      <div className="od-doc">
        <div className="od-doc__icon od-doc__icon--on" aria-hidden="true">
          <FileIcon />
        </div>
        <div className="od-doc__body">
          <div className="od-doc__title">Our order confirmation</div>
          <div className="od-doc__meta">
            Issued by {LEGAL_DISCLOSURE.legalName} against{' '}
            <span className="mono">{order.orderNumber}</span> · PDF
          </div>
        </div>
        {/*
          `OrderPdfService` renders a real confirmation per request from the
          order itself, so it cannot go stale. This used to read, as the value
          of a named document, the literal words "This page".
        */}
        <a className="od-doc__action hub-link" href={pdf}>
          Open the PDF
        </a>
      </div>
      <div className="od-doc">
        <div className="od-doc__icon" aria-hidden="true">
          <LinesIcon />
        </div>
        <div className="od-doc__body">
          <div className="od-doc__title">Your PO reference</div>
          <div className="od-doc__meta">
            Issued by your procurement system. It prints on our invoice.
          </div>
        </div>
        <span className={order.buyerPoNumber ? 'mono od-doc__value' : 'notmeasured od-doc__value'}>
          {order.buyerPoNumber ?? 'None given'}
        </span>
      </div>
      <p className="od-doc__note fnote off">
        {BRAND.legalEntity} is the seller, so the invoice is ours.{' '}
        <InfoPopover label="Where the other documents are">
          The proforma, the tax invoice per delivery and the e-way bill are on the Documents tab,
          each with its number and its date — or the moment that brings it into existence.
        </InfoPopover>
      </p>
    </section>
  );
}

/* ==========================================================================
 * Money
 * ======================================================================== */

function Summary({ order, at }: { order: Order; at: Standing }): React.JSX.Element {
  const taxable = Money.parse(order.subtotal).add(Money.parse(order.freight));
  const tax = order.tax;
  return (
    <section className="od-card od-summary" aria-labelledby="summary">
      <h2 id="summary">
        {at.held
          ? 'What this order would come to'
          : at.released
            ? 'What this order would have come to'
            : 'Payment summary'}
      </h2>
      <dl className="od-lines">
        <div>
          <dt>
            Machines (<span className="mono">{order.unitsAllocated}</span>)
          </dt>
          <dd>{rupees(order.subtotal)}</dd>
        </div>
        <div>
          <dt>
            Freight to <span className="mono">{order.deliveryAddress.pincode}</span>
          </dt>
          <dd>{rupees(order.freight)}</dd>
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
          <div className="od-total__label">
            {at.held
              ? 'Would come to'
              : at.released
                ? 'Would have come to'
                : order.paymentStatus === 'PAID'
                  ? 'Total paid'
                  : 'Total payable'}
          </div>
          <div className="od-total__note">Landed price, incl. tax &amp; freight</div>
        </div>
        <div className="od-total__amt mono">{rupees(order.grandTotal)}</div>
      </div>
    </section>
  );
}

function Billing({ order }: { order: Order }): React.JSX.Element {
  return (
    <section className="od-card od-billing" aria-labelledby="billing">
      <h2 id="billing">Billing</h2>
      <dl className="od-kv">
        <div>
          <dt>Billed to</dt>
          <dd className="strong">{order.billedTo.legalName}</dd>
        </div>
        <div>
          <dt>GSTIN</dt>
          <dd className="mono od-kv__gstin">{order.billedTo.gstin}</dd>
        </div>
        <div>
          <dt>
            Place of supply
            {/* The citation and the reasoning behind a `?`, not a paragraph
                under a fact most readers already accept. */}
            <InfoPopover label="Why this state decides the tax">{order.tax.basis}</InfoPopover>
          </dt>
          <dd>
            {order.tax.placeOfSupplyState} (
            <span className="mono">{order.tax.placeOfSupplyStateCode}</span>)
          </dd>
        </div>
        <div>
          <dt>Payment terms</dt>
          <dd>{PAYMENT_MODE[order.paymentMode] ?? order.paymentMode}</dd>
        </div>
        <div>
          <dt>Cost centre</dt>
          {/* An absence renders as an absence. Never a blank that reads as a
              recorded value. */}
          <dd className={order.costCentre ? undefined : 'notmeasured'}>
            {order.costCentre ?? 'Not recorded'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/* ==========================================================================
 * States that are not the record
 * ======================================================================== */

export function OrderSkeleton(): React.JSX.Element {
  return (
    <div className="od-grid" aria-busy="true">
      <div className="od-col">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-52 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
      <div className="od-col">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
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
          look like <span className="mono">TT-26-00004</span> — or ask whoever placed it to share it
          from their account.
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
