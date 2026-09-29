import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Button, DataBoard, EmptyState, Input, Modal, Skeleton, cn, type Column } from '@trugrade/ui';
import { useAuth } from '../../lib/auth';
import { pincodeStateMismatch } from '../../lib/pincode-region';
import { nowMs } from '../../lib/clock';
import { useResource } from '../../lib/useResource';
import { send } from '../qc/api';
import {
  humanise,
  onDate,
  OPS_API,
  rupees,
  type AssignResult,
  type OpsOrderMachine,
  type OpsOrderRecord,
  type OpsPurchaseOrderOnOrder,
  type OpsSubOrder,
  type OpsTimelineEvent,
  type OpsOrderVisit,
  type TechnicianLoad,
  type TechnicianOption,
  type VerifyResult,
} from './api';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * One order end-to-end — `03_UX_SPEC.md` §3C.4 — and the two decisions the
 * order-first flow puts on the platform's desk: assign a technician, then
 * verify each machine they named. The last verification raises the purchase
 * orders and starts the buyer's payment clock.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.xo-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the boards:
 *
 * - **Every figure is read.** The stepper is the order's own events; the money
 *   tiles are the server's `money` and `margin`; the tracking alert is what
 *   the supply point typed at dispatch. Nothing on this screen is a placeholder.
 * - **The machine tables are still `DataBoard`**, restyled through their
 *   wrapper class; the totals line under each is drawn to the design's
 *   `tfoot` rather than adding a footer slot to the shared component.
 * - **The design's "Add AWB number" button is not here.** No endpoint records
 *   a tracking number after dispatch, and a control that looks live and is
 *   not is the dead-control pattern. The one primary action is the real next
 *   step of the flow, verifying what the technician recorded.
 *
 * **This is the only screen in the product where both sides sit together**:
 * the buyer's side and the purchase orders we raised against it, with the
 * margin between them. ADMIN-only; the seam is enforced on the server.
 *
 * **The margin is refused rather than approximated.** A margin over partial
 * cover would read as the real one and be wrong by whatever those machines
 * cost. The server decides, and sends the reason; the tile prints it in
 * `--ink-4`, never a figure.
 */

/* ---- words for the enum -------------------------------------------------- */

const STATUS_PILL: Readonly<Record<string, { label: string; cls: string }>> = {
  PAYMENT_PENDING: { label: 'Payment pending', cls: 'xo-pill--pp' },
  CONFIRMED: { label: 'Confirmed', cls: 'xo-pill--cf' },
  VENDOR_ACCEPTED: { label: 'Vendor accepted', cls: 'xo-pill--va' },
  DISPATCHED: { label: 'Dispatched', cls: 'xo-pill--dp' },
  DELIVERED: { label: 'Delivered', cls: 'xo-pill--dl' },
};
const statusPill = (status: string): { label: string; cls: string } =>
  STATUS_PILL[status] ?? { label: humanise(status), cls: 'xo-pill--nt' };

const EVENT_TITLE: Readonly<Record<string, string>> = {
  'order.placed': 'Order placed',
  'order.approval_requested': 'Approval requested',
  'order.technician_assigned': 'Technician assigned',
  'order.inspected': 'Order inspected',
  'order.verified': 'Order verified',
  'order.paid': 'Order paid',
  PO_DISPATCHED: 'PO dispatched',
  PO_VENDOR_RESPONSE: 'Vendor responded',
  ORDER_STATUS: 'Status changed',
  STATUS_CHANGE: 'Status changed',
};
const eventTitle = (type: string): string => EVENT_TITLE[type] ?? humanise(type);

/** "11:00 am" — the stepper and the feed show the clock; the header shows the date. */
const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

const num = (money: string): number => Number(money);
const money = (n: number): string => rupees(n.toFixed(2));

/** A tracking number has digits in it. "no air way bill" is a note, not one. */
const usableAwb = (awb: string | null): boolean => awb !== null && /\d/.test(awb);

/* ---- icons, as the design draws them ------------------------------------ */

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
const InfoIcon = ({ size = 20 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} strokeWidth="2" {...svg}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </svg>
);
const CheckIcon = (): React.JSX.Element => (
  <svg width="18" height="18" strokeWidth="2.4" {...svg}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
const ClockIcon = (): React.JSX.Element => (
  <svg width="18" height="18" strokeWidth="2.4" {...svg}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/* ---- the stepper ---------------------------------------------------------- */

interface Step {
  label: string;
  at: string | null;
}

/**
 * Seven stations, each dated by the event that reached it (or the field the
 * server keeps for it), so the strip is the order's own history and not a
 * guess from its status.
 */
function steps(data: OpsOrderRecord): Step[] {
  const earliest = (type: string): string | null => {
    // The feed is newest-first; the station is reached at the FIRST such event.
    const hits = data.timeline.filter((e) => e.type === type);
    return hits.length > 0 ? hits[hits.length - 1]!.at : null;
  };
  const machines = data.subOrders.flatMap((s) => s.machines);
  const latest = (dates: Array<string | null>): string | null => {
    const known = dates.filter((d): d is string => d !== null).sort();
    return known.length > 0 ? known[known.length - 1]! : null;
  };
  const firstOf = (dates: Array<string | null>): string | null => {
    const known = dates.filter((d): d is string => d !== null).sort();
    return known[0] ?? null;
  };
  return [
    { label: 'Placed', at: data.placedAt },
    { label: 'Technician assigned', at: earliest('order.technician_assigned') },
    { label: 'Inspected', at: earliest('order.inspected') ?? latest(machines.map((m) => m.inspectedAt)) },
    { label: 'Verified', at: earliest('order.verified') ?? data.verifiedAt },
    { label: 'Paid', at: earliest('order.paid') ?? data.paidAt },
    {
      label: 'Dispatched',
      at: earliest('PO_DISPATCHED') ?? firstOf(data.purchaseOrders.map((po) => po.dispatchedAt)),
    },
    {
      label: 'Delivered',
      at:
        latest(data.subOrders.map((s) => s.deliveredAt)) ??
        (data.status === 'DELIVERED'
          ? (data.timeline.find((e) => e.toStatus === 'DELIVERED')?.at ?? null)
          : null),
    },
  ];
}

function Stepper({ data }: { data: OpsOrderRecord }): React.JSX.Element {
  const list = steps(data);
  // The furthest station reached is the current one; a cancelled order has no
  // current station, only the ones it got to.
  let current = -1;
  list.forEach((s, i) => {
    if (s.at !== null) current = i;
  });
  if (data.status === 'CANCELLED') current = -1;
  return (
    <ol className="xo-steps" aria-label="Order progress">
      {list.map((s, i) => {
        const state = s.at === null ? 'is-next' : i === current ? 'is-current' : 'is-done';
        return (
          <li
            key={s.label}
            className={cn('xo-step', state)}
            aria-current={state === 'is-current' ? 'step' : undefined}
          >
            <div className="xo-step__track">
              <span className="xo-step__dot" />
              <span className="xo-step__line" />
            </div>
            <span className="xo-step__label">{s.label}</span>
            <span className="xo-step__time">{s.at ? clock(s.at) : '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---- machines --------------------------------------------------------------- */

const machineColumns = (
  canVerify: boolean,
  busySlot: string | null,
  onVerify: (slotId: string) => void,
): ReadonlyArray<Column<OpsOrderMachine>> => [
  {
    key: 'serial',
    header: 'Serial',
    cell: (m) =>
      m.serialNumber ? (
        // 0.08em tracking because a serial is compared to a sticker by a person
        // holding the laptop.
        <span className="xo-serial tnum">{m.serialNumber}</span>
      ) : (
        <span className="xo-none">Not recorded</span>
      ),
  },
  {
    key: 'title',
    header: 'Machine',
    cell: (m) => m.title ?? <span className="xo-none">Model withdrawn</span>,
  },
  { key: 'grade', header: 'Grade', cell: (m) => <span className="xo-grade">{m.grade.replace('_PLUS', '+')}</span> },
  { key: 'sold', header: 'Sold at', numeric: true, cell: (m) => rupees(m.unitPrice) },
  {
    key: 'cost',
    header: 'We pay',
    numeric: true,
    // Never ₹0 for a machine no purchase order covers: that is a missing value.
    cell: (m) =>
      m.purchaseCost === null ? <span className="xo-none">No PO line</span> : rupees(m.purchaseCost),
  },
  {
    key: 'margin',
    header: 'Margin',
    numeric: true,
    cell: (m) =>
      m.purchaseCost === null ? (
        <span className="xo-none">—</span>
      ) : (
        money(num(m.unitPrice) - num(m.purchaseCost))
      ),
  },
  {
    key: 'verified',
    header: 'Verified',
    cell: (m) =>
      m.verifiedAt ? (
        <>
          <span className="xo-ok">✓</span> <span className="xo-time">{clock(m.verifiedAt)}</span>
        </>
      ) : m.inspectedAt ? (
        <>
          {/* The engine's word on the machine, so a verifier knows whether they
              are confirming a certified pass or reviewing one the engine held. */}
          {m.status === 'QC_MISMATCH' ? (
            <span className="xo-warn">Held for review</span>
          ) : m.status === 'QC_FAILED' ? (
            <span className="xo-bad">Failed</span>
          ) : (
            <span className="xo-ok">Passed</span>
          )}{' '}
          <span className="xo-time">· inspected {clock(m.inspectedAt)}</span>
        </>
      ) : (
        <span className="xo-none">Not yet</span>
      ),
  },
  {
    key: 'actions',
    header: 'Actions',
    headerHidden: true,
    numeric: true,
    cell: (m) =>
      // A failed machine is not verified for purchase; it is re-inspected or refused.
      canVerify && m.inspectedAt && !m.verifiedAt && m.status !== 'QC_FAILED' ? (
        <Button variant="secondary" size="sm" loading={busySlot === m.slotId} onClick={() => onVerify(m.slotId)}>
          Verify
        </Button>
      ) : null,
  },
];

function Consignment({
  sub,
  canVerify,
  busySlot,
  onVerify,
}: {
  sub: OpsSubOrder;
  canVerify: boolean;
  busySlot: string | null;
  onVerify: (slotId: string) => void;
}): React.JSX.Element {
  const pill = statusPill(sub.status);
  const sold = sub.machines.reduce((n, m) => n + num(m.unitPrice), 0);
  const costKnown = sub.machines.length > 0 && sub.machines.every((m) => m.purchaseCost !== null);
  const cost = costKnown ? sub.machines.reduce((n, m) => n + num(m.purchaseCost!), 0) : null;
  const n = sub.machines.length;
  return (
    <>
      <div className="xo-sp">
        <div>
          <div className="xo-sp__name">{sub.vendorLegalName ?? 'Supply point unresolved'}</div>
          <div className="xo-sp__meta">
            Consignment <span className="mono">{sub.subOrderNumber}</span> · {n}{' '}
            {n === 1 ? 'machine' : 'machines'} · {rupees(sub.subtotal)} ex GST
          </div>
        </div>
        <div className="xo-sp__right">
          <span className={cn('xo-pill xo-pill--sm', pill.cls)}>{pill.label}</span>
        </div>
      </div>
      <DataBoard
        className="xo-table"
        caption={`${n} ${n === 1 ? 'machine' : 'machines'} from ${sub.vendorLegalName ?? 'this supply point'}.`}
        columns={machineColumns(canVerify, busySlot, onVerify)}
        rows={sub.machines}
        rowKey={(m) => m.slotId}
        empty={
          <EmptyState
            title="No machine is on this consignment"
            body="A consignment with no slots against it means the order was written by a path that does not create them."
          />
        }
      />
      {n > 0 && (
        <div className="xo-tfoot" aria-label="Consignment totals">
          <span>
            {n} {n === 1 ? 'machine' : 'machines'}
          </span>
          <span className="mono tnum">{money(sold)}</span>
          <span className="mono tnum">{cost === null ? <span className="xo-none">—</span> : money(cost)}</span>
          <span className="mono tnum">
            {cost === null ? <span className="xo-none">—</span> : money(sold - cost)}
          </span>
        </div>
      )}
    </>
  );
}

/* ---- activity ---------------------------------------------------------------- */

function Activity({ events }: { events: OpsTimelineEvent[] }): React.JSX.Element {
  return (
    <ol className="xo-feed">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className={cn('xo-ev', i === 0 && 'xo-ev--current')}>
          <span className="xo-ev__dot" aria-hidden="true" />
          <div className="xo-ev__top">
            <span className="xo-ev__title">{eventTitle(e.type)}</span>
            {e.fromStatus && e.toStatus && (
              <span className="xo-ev__move">
                <span>{humanise(e.fromStatus)}</span>→<span>{humanise(e.toStatus)}</span>
              </span>
            )}
            <span className="xo-ev__when">{clock(e.at)}</span>
          </div>
          <div className="xo-ev__by">
            {e.actorName ? (
              <>
                by <strong>{e.actorName}</strong>
              </>
            ) : (
              'No person recorded against this event'
            )}
          </div>
          {e.note && <p className="xo-ev__note">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ============================================================================ */

export function OpsOrderRecordRoute(): React.JSX.Element {
  const { orderNumber = '' } = useParams();
  const { principal } = useAuth();
  const canOpenPos = principal?.permissions.includes('procurement.po.read_any') ?? false;
  const canAssign = principal?.permissions.includes('qc.visit.schedule') ?? false;
  const canVerify = principal?.permissions.includes('ordering.any.override') ?? false;
  const [reloadToken, setReloadToken] = React.useState(0);
  const { data, error } = useResource<OpsOrderRecord>(
    OPS_API.order(orderNumber),
    'That order could not be opened',
    reloadToken,
  );

  const [busySlot, setBusySlot] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  async function verify(slotIds: string[]): Promise<void> {
    setBusySlot(slotIds[0] ?? 'ALL');
    setFailure(null);
    try {
      const result = await send<VerifyResult>(
        OPS_API.verify(orderNumber),
        'POST',
        { slotIds },
        'The machines could not be verified',
      );
      setNotice(
        result.payBy
          ? `Every machine verified. ${result.purchaseOrders} purchase ${result.purchaseOrders === 1 ? 'order is' : 'orders are'} with the supply points and the buyer has until ${onDate(result.payBy)}, ${clock(result.payBy)} to pay.`
          : result.status === 'CONFIRMED'
            ? 'Every machine verified. Confirmed on the buyer’s credit terms; the supply points have their purchase orders.'
            : `${result.verified} of ${result.total} machines verified.`,
      );
      setReloadToken((n) => n + 1);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusySlot(null);
    }
  }

  if (error) {
    return (
      <EmptyState
        title="That order did not load"
        body={
          <>
            {error}. Nothing has been changed.{' '}
            <Link className="text-acc-ink underline underline-offset-4" to="/orders">
              Back to the order board
            </Link>
            .
          </>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="order-record">
        <Skeleton lines={3} />
        <div className="xo-card xo-card__body">
          <Skeleton lines={6} />
        </div>
      </div>
    );
  }

  const { inspection } = data;
  const verifiable = inspection.inspected - inspection.verified;
  const needsTechnician =
    (data.status === 'AWAITING_INSPECTION' || data.status === 'QC_IN_PROGRESS') && canAssign;
  const prepaid = data.paymentMode === 'PREPAID';
  const unpaidDelivered = data.status === 'DELIVERED' && data.paymentStatus !== 'PAID' && prepaid;

  const status = statusPill(data.status);
  const payment: { label: string; cls: string } =
    data.paymentStatus === 'PAID'
      ? { label: 'Paid', cls: 'xo-pill--ok' }
      : data.paymentStatus === 'PENDING'
        ? unpaidDelivered
          ? { label: 'Unpaid', cls: 'xo-pill--bad' }
          : { label: 'Pending', cls: 'xo-pill--warn' }
        : data.paymentStatus === 'PARTIAL'
          ? { label: 'Part paid', cls: 'xo-pill--warn' }
          : data.paymentStatus === 'FAILED'
            ? { label: 'Failed', cls: 'xo-pill--bad' }
            : { label: humanise(data.paymentStatus), cls: 'xo-pill--nt' };

  // The consignments that left without a tracking number anybody can use.
  const untracked: OpsPurchaseOrderOnOrder[] = data.purchaseOrders.filter(
    (po) => (po.status === 'DISPATCHED' || po.dispatchedAt) && !usableAwb(po.awb),
  );

  const poTotal = data.purchaseOrders.reduce((n, po) => n + num(po.totalNet), 0);
  const tdsTotal = data.purchaseOrders.reduce((n, po) => n + num(po.tdsAmount), 0);
  const machineCount = inspection.machines;
  const pct = data.margin ? Number(data.margin.pct) : null;
  const payPct = pct === null ? null : Math.max(0, 100 - pct);
  const mismatch = data.shipTo ? pincodeStateMismatch(data.shipTo.pincode, data.shipTo.state) : null;

  const poRef = (po: OpsPurchaseOrderOnOrder, className?: string): React.ReactNode =>
    canOpenPos ? (
      <Link className={className} to={`/procurement/pos?q=${encodeURIComponent(po.poNumber)}`}>
        {po.poNumber}
      </Link>
    ) : (
      <span className={className}>{po.poNumber}</span>
    );

  return (
    <div className="order-record">
      {/* ---- header --------------------------------------------------- */}
      <div>
        <nav className="xo-crumb" aria-label="Breadcrumb">
          <Link to="/orders">Orders</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{data.orderNumber}</span>
        </nav>
        <div className="xo-head">
          <div>
            <div className="xo-title-row">
              <h1 className="xo-title">
                Order <span className="mono">{data.orderNumber}</span>
              </h1>
              <span className={cn('xo-pill', status.cls)}>{status.label}</span>
              <span className={cn('xo-pill', payment.cls)}>{payment.label}</span>
            </div>
            <p className="xo-sub">
              <strong>{data.buyer?.legalName ?? 'Buyer unresolved'}</strong> · {machineCount}{' '}
              {machineCount === 1 ? 'machine' : 'machines'} · placed {onDate(data.placedAt)},{' '}
              {clock(data.placedAt)}
              {data.placedByName ? ` by ${data.placedByName}` : ''}
            </p>
          </div>
          <div className="xo-actions">
            {/* Each purchase order, as the design's secondary buttons. A link
                only for a caller who may open the procurement board. */}
            {data.purchaseOrders.map((po) => (
              <React.Fragment key={po.poId}>{poRef(po, 'xo-btn mono')}</React.Fragment>
            ))}
            {canVerify && verifiable > 0 && (
              <button
                type="button"
                className="xo-btn xo-btn--primary"
                aria-disabled={busySlot === 'ALL' || undefined}
                onClick={() => {
                  if (busySlot === null) void verify([]);
                }}
              >
                {busySlot === 'ALL'
                  ? 'Verifying…'
                  : `Verify ${verifiable === machineCount ? 'every machine' : `${verifiable} inspected`}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- alerts --------------------------------------------------- */}
      {notice && (
        <div className="xo-alert xo-alert--ok" role="status">
          <CheckIcon />
          <p className="txt">{notice}</p>
        </div>
      )}
      {failure && (
        <div className="xo-alert xo-alert--bad" role="alert">
          <InfoIcon />
          <p className="txt">{failure}</p>
        </div>
      )}
      {untracked.map((po) => (
        <div className="xo-alert" role="status" key={po.poId}>
          <InfoIcon />
          <p className="txt">
            <strong>Dispatched without a usable tracking number.</strong>{' '}
            {po.vendorLegalName ?? 'The supply point'} sent <span className="mono">{po.poNumber}</span>
            {po.carrier ? ` by ${po.carrier}` : ''}, but{' '}
            {po.awb ? (
              <>
                the AWB recorded is <span className="mono">“{po.awb}”</span>
              </>
            ) : (
              'no AWB number was recorded'
            )}
            , so neither we nor the buyer can track the shipment.
          </p>
        </div>
      ))}
      {unpaidDelivered && (
        <div className="xo-alert xo-alert--bad" role="status">
          <InfoIcon />
          <p className="txt">
            <strong>Delivered but not paid.</strong> This prepaid order reached the buyer with{' '}
            {rupees(data.money.grandTotal)} still pending.
          </p>
        </div>
      )}

      {/* ---- progress ------------------------------------------------- */}
      <Stepper data={data} />

      <div className="xo-grid">
        <div className="xo-col">
          {/* ---- money -------------------------------------------------- */}
          <section className="xo-card" aria-labelledby="xo-money-h">
            <div className="xo-card__head">
              <h2 id="xo-money-h">Money on this order</h2>
              <span className="meta">Only admins see both sides</span>
            </div>
            <div className="xo-card__body">
              <div className="xo-money">
                <div className="xo-fig">
                  <span className="xo-fig__label">{data.paidAt ? 'Buyer paid' : 'Buyer pays'}</span>
                  <span className="xo-fig__value tnum">{rupees(data.money.grandTotal)}</span>
                  <span className="xo-fig__note">
                    {data.paidAt
                      ? `All in · ${onDate(data.paidAt)}, ${clock(data.paidAt)}`
                      : data.payBy
                        ? `All in · due by ${onDate(data.payBy)}, ${clock(data.payBy)}`
                        : 'All in'}
                  </span>
                </div>
                <div className="xo-fig">
                  <span className="xo-fig__label">We pay supply points</span>
                  {data.purchaseOrders.length > 0 ? (
                    <>
                      <span className="xo-fig__value tnum">{money(poTotal)}</span>
                      <span className="xo-fig__note">
                        {data.purchaseOrders.length} {data.purchaseOrders.length === 1 ? 'PO' : 'POs'} ·{' '}
                        {tdsTotal > 0 ? `TDS ${money(tdsTotal)}` : 'no TDS'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="xo-fig__value xo-none">No PO yet</span>
                      <span className="xo-fig__note">Raised when the last machine is verified</span>
                    </>
                  )}
                </div>
                <div className="xo-fig xo-fig--margin">
                  <span className="xo-fig__label">Our margin</span>
                  {data.margin ? (
                    <>
                      <span className="xo-fig__value tnum">{rupees(data.margin.amount)}</span>
                      <span className="xo-fig__note">
                        {data.margin.pct}% of machine price, ex GST &amp; freight
                      </span>
                    </>
                  ) : (
                    // No amount, no share, no zero: a margin we cannot state is
                    // a sentence in --ink-4, the colour of a value we do not have.
                    <p className="xo-fig__note text-ink-4">
                      {data.marginUnavailable ?? 'Not calculated.'}
                    </p>
                  )}
                </div>
              </div>

              {data.margin && pct !== null && payPct !== null && (
                <div className="xo-split">
                  <div className="xo-split__bar" aria-hidden="true">
                    <span className="pay" style={{ width: `${payPct}%` }} />
                    <span className="mar" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="xo-split__legend">
                    <span>
                      <i className="pay" />
                      Supply points {payPct.toFixed(1)}%
                    </span>
                    <span>
                      <i className="mar" />
                      Our margin {data.margin.pct}%
                    </span>
                    {/* Every percentage carries its denominator. */}
                    <span>As a share</span>
                    <span>
                      <b className="mono tnum">{data.margin.pct}%</b> of {rupees(data.margin.soldFor)} sold,
                      ex GST and ex freight
                    </span>
                  </div>
                </div>
              )}

              <div className="xo-sides">
                <div>
                  <h3>What the buyer is charged</h3>
                  <dl className="xo-lines">
                    <div>
                      <dt>Machines, ex GST</dt>
                      <dd className="tnum">{rupees(data.money.subtotal)}</dd>
                    </div>
                    <div>
                      <dt>Freight</dt>
                      <dd className="tnum">{rupees(data.money.freight)}</dd>
                    </div>
                    <div>
                      <dt>GST</dt>
                      <dd className="tnum">{rupees(data.money.gstTotal)}</dd>
                    </div>
                    <div>
                      <dt>TCS</dt>
                      <dd className="tnum">{rupees(data.money.tcs)}</dd>
                    </div>
                    <div className="total">
                      <dt>Buyer pays</dt>
                      <dd className="tnum">{rupees(data.money.grandTotal)}</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h3>What we owe supply points</h3>
                  {data.purchaseOrders.length > 0 ? (
                    <dl className="xo-lines">
                      {data.purchaseOrders.map((po) => (
                        <div key={po.poId}>
                          <dt>
                            {po.vendorLegalName ?? 'Supply point unresolved'} · {po.poNumber}
                          </dt>
                          <dd className="tnum">{rupees(po.totalNet)}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>TDS deducted</dt>
                        <dd className="tnum">{money(tdsTotal)}</dd>
                      </div>
                      <div className="total">
                        <dt>We pay</dt>
                        <dd className="tnum">{money(poTotal)}</dd>
                      </div>
                      <div>
                        <dt className="note">PO raised when the last machine was verified</dt>
                        <dd className="note">{onDate(data.purchaseOrders[0]!.raisedAt)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="xo-lines note" style={{ fontSize: 13, color: 'inherit' }}>
                      No purchase order yet. One is raised to each supply point inside the
                      transaction that verifies the last machine; until then nothing is committed
                      to a vendor.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ---- machines --------------------------------------------- */}
          <section className="xo-card" aria-labelledby="xo-mach-h">
            <div className="xo-card__head">
              <h2 id="xo-mach-h">Machines &amp; inspection</h2>
              <span className="meta">
                <strong>
                  {inspection.verified} of {machineCount} verified
                </strong>
              </span>
            </div>
            {inspection.visits.length > 0 ? (
              inspection.visits.map((v) => {
                const done = v.status === 'COMPLETED';
                return (
                  <div className="xo-qc" key={v.visitId}>
                    <span className={cn('xo-qc__icon', !done && 'xo-qc__icon--pending')}>
                      {done ? <CheckIcon /> : <ClockIcon />}
                    </span>
                    <div className="xo-qc__main">
                      {v.technicianName ? (
                        <>
                          Inspected by <strong>{v.technicianName}</strong> at the supply point
                        </>
                      ) : (
                        'No technician on this visit'
                      )}{' '}
                      · {v.unitsInspected} of {v.unitsRequested} serials recorded
                      <br />
                      <span className="mono">{v.visitNumber}</span>
                    </div>
                    <span className={cn('xo-pill xo-pill--sm', done ? 'xo-pill--ok' : 'xo-pill--warn')}>
                      {done ? 'QC completed' : humanise(v.status)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="xo-qc">
                <span className="xo-qc__icon xo-qc__icon--pending">
                  <ClockIcon />
                </span>
                <div className="xo-qc__main">
                  No technician has been sent yet.{' '}
                  {canAssign
                    ? 'Assign one from the panel on the right.'
                    : 'Somebody with scheduling rights assigns one from this screen.'}
                </div>
              </div>
            )}
            {data.subOrders.map((sub) => (
              <Consignment
                key={sub.subOrderNumber}
                sub={sub}
                canVerify={canVerify}
                busySlot={busySlot}
                onVerify={(slotId) => void verify([slotId])}
              />
            ))}
          </section>

          {/* ---- activity --------------------------------------------- */}
          <section className="xo-card" aria-labelledby="xo-act-h">
            <div className="xo-card__head">
              <h2 id="xo-act-h">Activity</h2>
              <span className="meta">
                Newest first{data.timeline[0] ? ` · ${onDate(data.timeline[0].at)}` : ''}
              </span>
            </div>
            {data.timeline.length > 0 ? (
              <Activity events={data.timeline} />
            ) : (
              <EmptyState
                title="No event was ever written for this order"
                body="An order carries an event for every state it passes through. None here means the order was written by a path that does not record them."
              />
            )}
          </section>
        </div>

        {/* ---- side ----------------------------------------------------- */}
        <aside className="xo-col">
          {needsTechnician && (
            <section className="xo-card xo-side" aria-labelledby="xo-tech-h">
              <h2 id="xo-tech-h">Technician</h2>
              <AssignTechnician
                orderNumber={data.orderNumber}
                visit={inspection.visits[0] ?? null}
                onAssigned={(result) => {
                  setNotice(
                    `${result.technicianName} is assigned to ${result.visits.length === 1 ? 'the visit' : `${result.visits.length} visits`} for ${result.orderNumber}.`,
                  );
                  setReloadToken((n) => n + 1);
                }}
              />
            </section>
          )}

          <section className="xo-card xo-side" aria-labelledby="xo-buyer-h">
            <h2 id="xo-buyer-h">Buyer</h2>
            <dl className="xo-kv">
              <div>
                <dt>Business</dt>
                <dd>{data.buyer?.legalName ?? <span className="empty">Unresolved</span>}</dd>
              </div>
              <div>
                <dt>GSTIN</dt>
                <dd className="mono tnum">
                  {data.buyerGstin ?? <span className="empty">Not recorded</span>}
                </dd>
              </div>
              <div>
                <dt>Placed by</dt>
                <dd>{data.placedByName ?? <span className="empty">Unresolved</span>}</dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd>
                  {data.placedByMobile ? (
                    <a href={`tel:${data.placedByMobile}`} className="mono tnum">
                      {data.placedByMobile}
                    </a>
                  ) : (
                    <span className="empty">Not recorded</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Payment mode</dt>
                <dd>{humanise(data.paymentMode)}</dd>
              </div>
              <div>
                <dt>Buyer&rsquo;s PO ref</dt>
                <dd>{data.buyerPoNumber ?? <span className="empty">None given</span>}</dd>
              </div>
              <div>
                <dt>Cost centre</dt>
                <dd>{data.costCentre ?? <span className="empty">None given</span>}</dd>
              </div>
              {data.approval && (
                <div>
                  <dt>Approval</dt>
                  {/* A breached deadline is warn, never fail: the deadline was
                      one WE set on the buyer's own approver. */}
                  <dd className={data.approval.breached ? 'text-warn' : undefined}>
                    {humanise(data.approval.status)} · {data.approval.approverName}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="xo-card xo-side" aria-labelledby="xo-ship-h">
            <h2 id="xo-ship-h">Ships to</h2>
            {data.shipTo ? (
              <>
                {data.shipTo.label && <div className="xo-addr-name">{data.shipTo.label}</div>}
                <address className="xo-addr">
                  {data.shipTo.line1}
                  {data.shipTo.line2 ? `, ${data.shipTo.line2}` : ''}
                  <br />
                  {data.shipTo.city}, {data.shipTo.state}{' '}
                  <span className="mono tnum">{data.shipTo.pincode}</span>
                  <br />
                  {data.shipTo.contactName} ·{' '}
                  <span className="mono tnum">{data.shipTo.contactMobile}</span>
                </address>
                {mismatch && (
                  <div className="xo-mini-warn" role="note">
                    <InfoIcon size={14} />
                    <span>
                      <span className="mono">{data.shipTo.pincode}</span> is{' '}
                      {mismatch.length === 1 ? `a ${mismatch[0]}` : `${mismatch.join(' or ')}`} PIN,
                      but the state is {data.shipTo.state}. Check before the courier is booked.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <p className="xo-addr xo-none">
                The delivery address on this order could not be resolved. Do not dispatch against
                it.
              </p>
            )}
          </section>

          <p className="xo-hint">
            Grade is the grade the listing was sold at. A+, A and B are all sellable, so a grade is
            not a pass or fail.
          </p>
          <p className="xo-hint">
            Cancel, reallocate and force-progress are not offered on this screen. None of the three
            is built: each is a transaction that releases units, reverses the purchase order and
            its payable, and no service performs it yet.
          </p>
        </aside>
      </div>
    </div>
  );
}

/**
 * The technician select, in the side column.
 *
 * Reads the roster once the panel is on screen; the assign call creates one
 * visit per consignment on the order, or moves the technician on the existing
 * ones. Never the primary colour: the primary action on this screen is
 * verification.
 */
/**
 * Who goes, and when.
 *
 * The card states the booking — the person, the day, the slot — and one button
 * opens the dialog that changes it. The dialog asks for the same three facts
 * the stock-visit dialog asks for, because the visit this books sits on the
 * same Visits and Schedule boards, and a visit with a person but no slot is one
 * nobody can plan a day around. Each technician's load on the chosen day sits
 * beside their name for the same reason the stock dialog shows it:
 * `SchedulingService` refuses a day over capacity anyway, and being refused
 * after choosing is the worse experience.
 */
function AssignTechnician({
  orderNumber,
  visit,
  onAssigned,
}: {
  orderNumber: string;
  visit: OpsOrderVisit | null;
  onAssigned: (result: AssignResult) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const current = visit?.technicianName ?? null;
  return (
    <div className="flex flex-col gap-3" data-testid="assign-technician">
      <dl className="xo-kv">
        <div>
          <dt>Technician</dt>
          <dd>{current ?? <span className="empty">Not assigned</span>}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd className="mono tnum">
            {visit?.scheduledDate ? onDate(visit.scheduledDate) : <span className="empty">Not booked</span>}
          </dd>
        </div>
        <div>
          <dt>Slot</dt>
          <dd className="mono tnum">
            {visit?.slotFrom && visit.slotTo ? (
              `${visit.slotFrom}–${visit.slotTo}`
            ) : (
              <span className="empty">Not booked</span>
            )}
          </dd>
        </div>
      </dl>
      <div>
        <button type="button" className="xo-btn" onClick={() => setOpen(true)}>
          {current ? 'Reassign' : 'Assign technician'}
        </button>
      </div>
      <AssignDialog
        open={open}
        onClose={() => setOpen(false)}
        orderNumber={orderNumber}
        current={current}
        onAssigned={(result) => {
          setOpen(false);
          onAssigned(result);
        }}
      />
    </div>
  );
}

export function AssignDialog({
  open,
  onClose,
  orderNumber,
  current,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  current: string | null;
  onAssigned: (result: AssignResult) => void;
}): React.JSX.Element {
  // Fetched only while the dialog is open: the roster and the fortnight's load
  // are the decision's data, not the record's.
  const { data: technicians, error } = useResource<TechnicianOption[]>(
    open ? OPS_API.technicians : '',
    'The technician roster is unavailable',
  );
  const { data: loads } = useResource<TechnicianLoad[]>(
    open ? OPS_API.technicianWorkload : '',
    'The workload could not be loaded',
  );
  // Tomorrow. A visit booked for today is a visit whose slot has usually gone.
  const [date, setDate] = React.useState(new Date(nowMs() + 86_400_000).toISOString().slice(0, 10));
  // `qc_visit.slot_from` is a `time` column and the endpoint wants `HH:MM`,
  // which is exactly what a time input gives.
  const [from, setFrom] = React.useState('10:00');
  const [to, setTo] = React.useState('13:00');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const active = (technicians ?? []).filter((t) => t.isActive);
  const loadOf = new Map((loads ?? []).map((l) => [l.technicianId, l]));

  // Padded, because both notations reach the endpoint and '09:30' sorts before
  // '09:30:00' as a raw string.
  const asSeconds = (t: string): string => (t.length === 5 ? `${t}:00` : t);
  const slotBackwards = Boolean(from && to) && asSeconds(to) <= asSeconds(from);
  const blocker = !date
    ? 'Pick the date of the visit.'
    : !from || !to
      ? 'Give the slot a start and an end time.'
      : slotBackwards
        ? 'The slot has to end after it starts.'
        : undefined;

  async function assign(technicianId: string): Promise<void> {
    if (blocker) {
      setFailure(blocker);
      return;
    }
    setBusy(technicianId);
    setFailure(null);
    try {
      const result = await send<AssignResult>(
        OPS_API.assignTechnician,
        'POST',
        { orderNumber, technicianId, scheduledDate: date, slotFrom: from, slotTo: to },
        'The technician could not be assigned',
      );
      onAssigned(result);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={current ? `Reassign from ${current}` : 'Assign a technician'}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input label="Slot from" type="time" mono value={from} onChange={(e) => setFrom(e.target.value)} required />
        <Input
          label="Slot to"
          type="time"
          mono
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
          error={slotBackwards ? 'End time must be later than the start time.' : undefined}
        />
      </div>
      {(failure ?? error) && (
        <p className="text-body-sm text-fail" role="alert">
          {failure ?? error}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {active.map((t) => {
          const load = loadOf.get(t.id);
          const onThatDay = load?.byDay[date] ?? 0;
          return (
            <li key={t.id} className="flex items-center justify-between gap-3">
              <span className="text-body-sm text-ink">
                {t.name}
                <span className="mono tnum text-ink-4">
                  {' '}
                  {t.employeeCode}
                  {load ? ` · ${onThatDay} that day · ${load.openVisits} open` : ''}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === t.id}
                {...(blocker ? { disabledReason: blocker } : {})}
                onClick={() => void assign(t.id)}
              >
                Assign
              </Button>
            </li>
          );
        })}
        {technicians && active.length === 0 && (
          <li className="text-body-sm text-ink-4">No active technician is on the roster.</li>
        )}
        {!technicians && !error && <li className="text-body-sm text-ink-4">Loading the roster…</li>}
      </ul>
      <p className="text-body-sm text-ink-3">
        The visit is booked into their day and appears on the Inspections, Visits and Schedule boards.
      </p>
    </Modal>
  );
}
