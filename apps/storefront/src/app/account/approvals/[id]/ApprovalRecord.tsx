'use client';

import * as React from 'react';
import {
  AddressCard,
  Button,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  type Address,
} from '@trugrade/ui';
import { Money, type Grade } from '@trugrade/contracts';
import type { ApiFailure } from '../../../register/api';
import { Deadline, inIst } from '../../../../lib/deadline';
import {
  decideApproval,
  getApproval,
  type ApprovalRecord as ApprovalRecordView,
  type ApprovalRow,
} from '../../api';
import type { OrderAddress } from '../../orders/[orderNumber]/api';

/**
 * One approval and the decision on it. See `page.tsx` for the archetype.
 *
 * A client component because the read is authenticated, because the decision is
 * a write this screen has to reflect immediately, and because the deadline has
 * to stay true while somebody reads the evidence.
 */

const rupees = (decimal: string): string => Money.parse(decimal).format();
const machines = (n: number): string => (n === 1 ? 'machine' : 'machines');

const GRADES = ['A_PLUS', 'A', 'B'] as const;
const isGrade = (value: string): value is Grade => (GRADES as readonly string[]).includes(value);

/** See the board for why `pass`/`fail` are legitimate here and nowhere else. */
const PILL: Record<ApprovalRow['status'], { tone: 'pass' | 'fail' | 'neutral'; label: string }> = {
  PENDING: { tone: 'neutral', label: 'Waiting on you' },
  APPROVED: { tone: 'pass', label: 'Approved' },
  REJECTED: { tone: 'fail', label: 'Declined' },
  EXPIRED: { tone: 'neutral', label: 'Window closed' },
};

/** The server refuses anything shorter. Said here first so nobody meets that. */
const REASON_MIN = 10;

type Phase =
  | { k: 'loading' }
  | { k: 'signed-out' }
  | { k: 'missing' }
  | { k: 'error'; message: string }
  | { k: 'ready'; record: ApprovalRecordView };

const problem = (failure: ApiFailure): string =>
  failure.code === 'UNKNOWN' || failure.code === 'NETWORK'
    ? 'We could not reach this approval just now. That is our problem, not yours — nothing has been decided and the hold has not moved.'
    : failure.message;

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function ApprovalRecord({ approvalId }: { approvalId: string }): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>({ k: 'loading' });

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const result = await getApproval(approvalId);
      if (!live) return;
      if (result.ok) setPhase({ k: 'ready', record: result.data });
      else if (result.status === 401) setPhase({ k: 'signed-out' });
      else if (result.status === 404 || result.status === 422) setPhase({ k: 'missing' });
      else setPhase({ k: 'error', message: problem(result) });
    })();
    return () => {
      live = false;
    };
  }, [approvalId]);

  if (phase.k === 'loading') return <ApprovalSkeleton />;
  if (phase.k === 'signed-out') return <SignedOut approvalId={approvalId} />;
  if (phase.k === 'missing') return <Missing />;
  if (phase.k === 'error') return <Failed message={phase.message} />;

  return (
    <Record
      record={phase.record}
      onDecided={(approval) => setPhase({ k: 'ready', record: { ...phase.record, approval } })}
    />
  );
}

/* ==========================================================================
 * The record
 * ======================================================================== */

function Record({
  record,
  onDecided,
}: {
  record: ApprovalRecordView;
  onDecided: (approval: ApprovalRow) => void;
}): React.JSX.Element {
  const { approval, order, policyRule } = record;
  const pending = approval.status === 'PENDING';

  return (
    <>
      <RecordHeader
        title={`Order ${approval.orderNumber}`}
        subtitle={<Headline approval={approval} />}
        identifiers={[
          { label: 'Raised by', value: approval.requestedByName },
          { label: 'Sent', value: inIst(approval.requestedAt) },
          { label: 'Machines', value: String(approval.unitsHeld) },
        ]}
        status={<StatusPill tone={PILL[approval.status].tone} label={PILL[approval.status].label} />}
      />

      {/* `apprrec` only exists to keep the evidence above the decision on a
          phone. `.sidep` is `order:-1` under 1000px because on a product page
          the pincode is the first thing to answer; here the panel holds the
          button, and a signature offered before the serials is the one thing
          this screen must not do. */}
      <div className="rec apprrec">
        <main className="evid">
          <WhyPanel approval={approval} policyRule={policyRule} />

          <section aria-labelledby="machines">
            <div className="sh">
              <div className="shrow">
                <h2 id="machines">
                  {pending
                    ? // Not "the machines on this order": until this is signed
                      // they are held and committed to nobody.
                      'The machines you would be approving'
                    : approval.status === 'APPROVED'
                      ? 'The machines you approved'
                      : 'The machines this order asked for'}
                </h2>
                <span className="sub">
                  {order.dispatchGroups.length === 1
                    ? 'All from one dispatch point'
                    : `From ${order.dispatchGroups.length} dispatch points`}
                </span>
              </div>
            </div>
            <div className="omach">
              {order.dispatchGroups.map((group) => (
                <div className="tbl odisp" key={group.label}>
                  <div className="tbh">
                    <b>{group.label}</b>
                    <span className="m">
                      {group.machines.length} {machines(group.machines.length)}
                    </span>
                  </div>
                  <ul className="omlist">
                    {group.machines.map((m) => (
                      <li key={m.serialNumber}>
                        <div className="omid">
                          <a className="mono omserial" href={`/unit/${m.serialNumber}`}>
                            {m.serialNumber}
                          </a>
                          <span className="omtitle">
                            {m.title ?? (
                              <span className="notmeasured">Model no longer catalogued</span>
                            )}
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
                </div>
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
        </main>

        <div className="sidep">
          <SidePanel
            title={pending ? 'What you are approving' : 'What this order came to'}
            description={
              pending
                ? 'Nothing is charged until this is signed, and nothing is ordered from a supply point either. This is the figure the request was raised for.'
                : approval.status === 'APPROVED'
                  ? 'The figure you signed off. Payment is a separate step and is not part of an approval.'
                  : 'The figure this order was raised for. It was never charged.'
            }
          >
            <dl className="facts">
              <div>
                <dt>Goods</dt>
                <dd className="mono">{rupees(order.subtotal)}</dd>
              </div>
              <div>
                <dt>Delivery</dt>
                <dd className="mono">{rupees(order.freight)}</dd>
              </div>
              <div>
                <dt>
                  GST{' '}
                  <span className="denom">
                    at {order.tax.ratePct}% ·{' '}
                    {order.tax.interState
                      ? 'IGST'
                      : `CGST + ${order.tax.stateTaxLabel}`}
                  </span>
                </dt>
                <dd className="mono">{rupees(order.gstTotal)}</dd>
              </div>
              <div className="tot">
                <dt>Order value</dt>
                <dd className="mono">{rupees(order.grandTotal)}</dd>
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
                <dt>
                  Their PO reference <span className="denom">your own, on our invoice</span>
                </dt>
                <dd className="mono">
                  {order.buyerPoNumber ?? <span className="notmeasured">None given</span>}
                </dd>
              </div>
              <div>
                <dt>Cost centre</dt>
                <dd className="mono">
                  {order.costCentre ?? <span className="notmeasured">None given</span>}
                </dd>
              </div>
            </dl>
          </SidePanel>

          <Decision approval={approval} onDecided={onDecided} />
        </div>
      </div>
    </>
  );
}

/** The sentence under the order number. It changes with the state, entirely. */
function Headline({ approval }: { approval: ApprovalRow }): React.JSX.Element {
  switch (approval.status) {
    case 'PENDING':
      return (
        <>
          <b>{approval.requestedByName}</b> has raised{' '}
          <span className="mono">{rupees(approval.orderValue)}</span> of stock and it needs your
          signature. <span className="mono">{approval.unitsHeld}</span>{' '}
          {machines(approval.unitsHeld)} are held off sale until you answer.
        </>
      );
    case 'APPROVED':
      return (
        <>
          You approved this on{' '}
          {approval.decidedAt === null ? (
            <span className="notmeasured">a date we did not record</span>
          ) : (
            <span className="mono">{inIst(approval.decidedAt)}</span>
          )}
          . The order went ahead and the machines are committed by serial number.
        </>
      );
    case 'REJECTED':
      return (
        <>
          You declined this on{' '}
          {approval.decidedAt === null ? (
            <span className="notmeasured">a date we did not record</span>
          ) : (
            <span className="mono">{inIst(approval.decidedAt)}</span>
          )}
          . The order was cancelled, the machines went back on sale, and nothing was charged.
        </>
      );
    default:
      return (
        <>
          Nobody answered by <span className="mono">{inIst(approval.expiresAt)}</span>, so the hold
          released on its own. The machines are back on sale and nothing was charged — the order has
          to be placed again.
        </>
      );
  }
}

/* ==========================================================================
 * Why this needs a signature at all
 * ======================================================================== */

function WhyPanel({
  approval,
  policyRule,
}: {
  approval: ApprovalRow;
  policyRule: string | null;
}): React.JSX.Element {
  return (
    <section aria-labelledby="why" className="awhy">
      <div className="sh">
        <div className="shrow">
          <h2 id="why">Why you were asked</h2>
          <span className="sub">The rule your organisation set</span>
        </div>
      </div>

      <p className="oapprlead">
        {policyRule ?? (
          // The row points at a policy we can no longer read. Summarising the
          // threshold from the order value would invent the rule.
          <span className="notmeasured">
            The rule that triggered this approval is no longer on your account, so we cannot state
            it. The request itself stands.
          </span>
        )}
      </p>

      <dl className="oapprfacts">
        <div>
          <dt>Raised by</dt>
          <dd>{approval.requestedByName}</dd>
        </div>
        <div>
          <dt>Sent to</dt>
          <dd>{approval.approverName}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd className="mono">{inIst(approval.requestedAt)}</dd>
        </div>
        <div>
          <dt>
            Held until{' '}
            <span className="denom">
              <span className="mono">{approval.slaHours}</span> hours from the request
            </span>
          </dt>
          <dd className="mono">
            {inIst(approval.expiresAt)}
            {approval.status === 'PENDING' && (
              <>
                {' · '}
                <Deadline expiresAt={approval.expiresAt} />
              </>
            )}
          </dd>
        </div>
        {approval.comment !== null && (
          <div>
            <dt>The reason you gave</dt>
            {/* Verbatim. The requester reads exactly this string on their order. */}
            <dd>{approval.comment}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ==========================================================================
 * The decision — the control that did not exist before T25
 * ======================================================================== */

type Submitting = null | 'APPROVE' | 'REJECT';

function Decision({
  approval,
  onDecided,
}: {
  approval: ApprovalRow;
  onDecided: (approval: ApprovalRow) => void;
}): React.JSX.Element {
  const [declining, setDeclining] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState<Submitting>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const reasonTooShort = reason.trim().length < REASON_MIN;

  const send = async (decision: 'APPROVE' | 'REJECT'): Promise<void> => {
    // The refusal is checked here as well as printed, because `Button`'s
    // `disabledReason` deliberately leaves the element enabled so a screen
    // reader can reach it — which leaves `onClick` live. T16 shipped that defect
    // once already.
    if (decision === 'REJECT' && reasonTooShort) return;
    setBusy(decision);
    setFailure(null);
    const result = await decideApproval(approval.id, {
      decision,
      ...(decision === 'REJECT' ? { comment: reason.trim() } : {}),
    });
    setBusy(null);
    if (result.ok) {
      setDeclining(false);
      onDecided(result.data.approval);
    } else {
      setFailure(result.message);
    }
  };

  if (approval.status !== 'PENDING') return <Settled approval={approval} />;

  if (!approval.decidable) {
    return (
      <SidePanel
        title="This one is not yours to decide"
        description="It is still waiting, but not on you."
      >
        <p className="ablock" role="note">
          {approval.blockedReason ??
            'This approval was addressed to somebody else at your organisation.'}
        </p>
        <p className="fnote off">
          An approval is a second pair of eyes on somebody&rsquo;s spending, so the person who
          raised an order can never be the person who signs it off. If the named approver is away,
          an account owner can change who approves what — the approver on an order is set by your
          organisation&rsquo;s approval policy, not by a role.
        </p>
      </SidePanel>
    );
  }

  return (
    <SidePanel
      title="Your decision"
      description="Approving places the order and commits these exact machines. Declining cancels it and puts them back on sale. Either way the person who raised it is told."
    >
      {failure !== null && (
        <p className="adecfail" role="alert">
          {failure}
        </p>
      )}

      {!declining ? (
        <div className="adec">
          <Button
            variant="primary"
            block
            loading={busy === 'APPROVE'}
            onClick={() => void send('APPROVE')}
          >
            Approve this order
          </Button>
          <Button variant="ghost" block onClick={() => setDeclining(true)}>
            Decline it
          </Button>
          <p className="fnote off">
            Nothing is charged at this point either way. Approving raises the order with the supply
            point; payment is a separate step.
          </p>
        </div>
      ) : (
        <div className="adec">
          <label className="adecreason" htmlFor="areason">
            <span className="l">Why are you declining?</span>
            <span className="d">
              <b>{approval.requestedByName} reads this word for word</b> on their own order screen,
              so say what would make it approvable — &ldquo;over budget this quarter, resubmit in
              October&rdquo; saves them a phone call.
            </span>
            <textarea
              id="areason"
              rows={4}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Over budget this quarter — resubmit in October."
            />
          </label>
          {/* The reason is printed under the button, not only in a tooltip. */}
          {reasonTooShort && (
            <p className="adechint">
              A reason of at least <span className="mono">{REASON_MIN}</span> characters is
              required. You have written <span className="mono">{reason.trim().length}</span>.
            </p>
          )}
          {/* Not `danger`. Red is PASS/FAIL only, and a decline is not a verdict
              until it has been given — the REJECTED pill afterwards is where the
              fail colour legitimately lands. */}
          <Button
            variant="secondary"
            block
            loading={busy === 'REJECT'}
            {...(reasonTooShort
              ? { disabledReason: 'Give a reason first — the requester is sent it verbatim.' }
              : {})}
            onClick={() => void send('REJECT')}
          >
            Decline and send this reason
          </Button>
          <Button
            variant="ghost"
            block
            onClick={() => {
              setDeclining(false);
              setFailure(null);
            }}
          >
            Back
          </Button>
        </div>
      )}
    </SidePanel>
  );
}

/** What the panel becomes once a decision has been taken, or the clock ran out. */
function Settled({ approval }: { approval: ApprovalRow }): React.JSX.Element {
  if (approval.status === 'EXPIRED') {
    return (
      <SidePanel
        title="The window closed"
        description="This is not a decision anybody took — the deadline we set on our own stock passed."
      >
        <p className="ablock">
          The hold ran out at <span className="mono">{inIst(approval.expiresAt)}</span>, so those{' '}
          <span className="mono">{approval.unitsHeld}</span> {machines(approval.unitsHeld)} went
          back on sale and may already have gone to somebody else. Nothing was charged and there is
          no order to cancel. {approval.requestedByName} can place it again.
        </p>
        <p className="retry">
          <a className="sel gh" href={`/account/orders/${approval.orderNumber}`}>
            Open the order
          </a>
        </p>
      </SidePanel>
    );
  }

  const approved = approval.status === 'APPROVED';
  return (
    <SidePanel
      title={approved ? 'You approved this' : 'You declined this'}
      description={
        approved
          ? 'The order went ahead with these exact serial numbers.'
          : 'The order was cancelled and the machines went back on sale.'
      }
    >
      <dl className="facts">
        <div>
          <dt>Decided</dt>
          <dd className="mono">
            {approval.decidedAt === null ? (
              <span className="notmeasured">Not recorded</span>
            ) : (
              inIst(approval.decidedAt)
            )}
          </dd>
        </div>
        <div>
          <dt>Order value</dt>
          <dd className="mono">{rupees(approval.orderValue)}</dd>
        </div>
      </dl>
      <p className="retry">
        <a className="sel gh" href={`/account/orders/${approval.orderNumber}`}>
          Open the order
        </a>
      </p>
    </SidePanel>
  );
}

/* ==========================================================================
 * Bits
 * ======================================================================== */

/** `OrderAddress` in `AddressCard`'s vocabulary. Absent fields stay absent. */
function asAddress(a: OrderAddress): Address {
  return {
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
  };
}

export function ApprovalSkeleton(): React.JSX.Element {
  return (
    <div className="oskel">
      <Skeleton className="h-32 w-full rounded-lg" />
      <div className="oskelrec">
        <Skeleton className="h-96 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    </div>
  );
}

function Missing(): React.JSX.Element {
  return (
    <div className="ostate">
      <div className="empty">
        <h3>We could not find that approval</h3>
        <p>
          Either it was never on your organisation&rsquo;s account, or the link is wrong. Approvals
          are not deleted when they are decided, so a settled one is still here — check the inbox.
        </p>
        <p className="retry">
          <a className="pill acc" href="/account/approvals?status=all">
            Every approval sent to you
          </a>
        </p>
      </div>
    </div>
  );
}

function SignedOut({ approvalId }: { approvalId: string }): React.JSX.Element {
  return (
    <div className="ostate">
      <EmptyState
        title="Sign in to answer this"
        body="An approval is addressed to one person, so we need to know who is asking. Signing in brings you straight back to it."
        action={
          <a
            className="pill acc"
            href={`/sign-in?next=${encodeURIComponent(`/account/approvals/${approvalId}`)}`}
          >
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
        <h3>We could not open this approval</h3>
        <p>{message}</p>
        <p>Nothing has been approved or declined, and the hold is where it was.</p>
        <p className="retry">
          <button type="button" className="pill acc" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
