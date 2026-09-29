import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, DataBoard, EmptyState, Pagination, cn, type Column } from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import {
  humanise,
  onDate,
  OPS_API,
  rupees,
  type OpsOrderAttention,
  type OpsOrderBoard,
  type OpsOrderRow,
} from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Every order on the platform — `03_UX_SPEC.md` §3C.4.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.ao-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as `/catalog`:
 *
 * - **The table is still `DataBoard`**, restyled through its wrapper class.
 * - **Every figure is read, not typed.** The "Needs attention" strip is the
 *   server's `attention` block, counted over every order rather than the page;
 *   the status chips are the server's facets; nothing here is a placeholder.
 *
 * **One box over seven identifiers.** §3C.4 asks for search by order number, PO
 * number, serial, seal code, GSTIN, buyer name and mobile, and the box takes all
 * seven without asking which one you have. The box **matches** — it never
 * parses — and the board still prints what it compared against, so nobody
 * concludes it does not take seal codes because theirs found nothing.
 *
 * **A row says why it matched.** A seal-code search landing on a row with no
 * seal column reads as a bug, so the value that produced the match is printed
 * on the row, under the order number.
 *
 * **The design's red.** The supplied design paints a prepaid order we
 * delivered without being paid in its own red, and its "Unpaid" word in the
 * same. That is a fact about OUR process, not a verdict on the buyer, and it is
 * drawn in the design's `--admin-bad`, never `--fail` — the PASS/FAIL pair
 * stays reserved. An order unpaid because it is on credit terms gets neither
 * the colour nor the row wash: `paymentMode` is what tells the two apart.
 *
 * **Read-only, and the screen says so rather than showing a dead button.**
 * §3C.4 asks for cancel-with-reason, reallocate-a-unit and force-progress. All
 * three are transactions no service in this codebase performs; the honest form
 * is their absence, named on the record.
 */

/** The design's five chips, and the neutral fallback every other status gets. */
const STATUS_META: Readonly<Record<string, { label: string; pill: string; dot: string }>> = {
  PAYMENT_PENDING: { label: 'Payment pending', pill: 's-pp', dot: 'd--pp' },
  CONFIRMED: { label: 'Confirmed', pill: 's-cf', dot: 'd--cf' },
  VENDOR_ACCEPTED: { label: 'Vendor accepted', pill: 's-va', dot: 'd--va' },
  DISPATCHED: { label: 'Dispatched', pill: 's-dp', dot: 'd--dp' },
  DELIVERED: { label: 'Delivered', pill: 's-dl', dot: 'd--dl' },
};

const statusMeta = (status: string): { label: string; pill: string; dot: string } =>
  STATUS_META[status] ?? { label: humanise(status), pill: 's-nt', dot: 'd--nt' };

/** The order pipeline, for chip order. A status the pipeline does not know sorts last. */
const PIPELINE = [
  'CREATED',
  'AWAITING_APPROVAL',
  'AWAITING_INSPECTION',
  'QC_IN_PROGRESS',
  'AWAITING_VERIFICATION',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'VENDOR_ACCEPTED',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
];
const pipelineIndex = (status: string): number => {
  const i = PIPELINE.indexOf(status);
  return i === -1 ? PIPELINE.length : i;
};

/**
 * The two exceptions the design flags on a row, decided the same way the
 * server decides the attention strip: prepaid, unpaid, and already moving.
 */
const isDeliveredUnpaid = (o: OpsOrderRow): boolean =>
  o.status === 'DELIVERED' && o.paymentStatus !== 'PAID' && o.paymentMode === 'PREPAID';
const isAcceptedUnpaid = (o: OpsOrderRow): boolean =>
  (o.status === 'VENDOR_ACCEPTED' || o.status === 'DISPATCHED') &&
  o.paymentStatus === 'PENDING' &&
  o.paymentMode === 'PREPAID';

function boardQuery(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const key of ['q', 'status', 'payment', 'approval', 'sort', 'page'] as const) {
    const value = params.get(key);
    if (value) q.set(key, value);
  }
  q.set('per', '25');
  return q.toString();
}

/* ---- icons, as the design draws them ---------------------------------- */

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const CheckIcon = (): React.JSX.Element => (
  <svg width="13" height="13" strokeWidth="3" {...svgProps}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);
const ClockIcon = (): React.JSX.Element => (
  <svg width="13" height="13" strokeWidth="2.4" {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const WarnIcon = (): React.JSX.Element => (
  <svg width="13" height="13" strokeWidth="2.4" {...svgProps}>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);
const ChevronIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const SearchIcon = (): React.JSX.Element => (
  <svg width="18" height="18" strokeWidth="2" {...svgProps}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
const InfoIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2" {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </svg>
);

/* ---- cells ------------------------------------------------------------- */

function PaymentCell({ o }: { o: OpsOrderRow }): React.JSX.Element {
  if (isDeliveredUnpaid(o)) {
    return (
      <>
        <span className="p-bad">
          <WarnIcon />
          Unpaid
        </span>
        <div className="ao-flag ao-flag--bad">Delivered without payment</div>
      </>
    );
  }
  switch (o.paymentStatus) {
    case 'PAID':
      return (
        <span className="p-paid">
          <CheckIcon />
          Paid
        </span>
      );
    case 'PENDING':
      return (
        <>
          <span className="p-pending">
            <ClockIcon />
            Pending
          </span>
          {isAcceptedUnpaid(o) && (
            <div className="ao-flag ao-flag--warn">
              {o.status === 'DISPATCHED' ? 'Dispatched before payment' : 'Accepted before payment'}
            </div>
          )}
        </>
      );
    case 'PARTIAL':
      return (
        <span className="p-pending">
          <ClockIcon />
          Part paid
        </span>
      );
    case 'FAILED':
      return (
        <span className="p-bad">
          <WarnIcon />
          Failed
        </span>
      );
    default:
      return <span className="p-neutral">{humanise(o.paymentStatus)}</span>;
  }
}

function StatusCell({ o }: { o: OpsOrderRow }): React.JSX.Element {
  const meta = statusMeta(o.status);
  const approval = o.approval;
  const held = approval !== null && (approval.status === 'PENDING' || approval.breached);
  return (
    <>
      <span className={cn('ao-pill', meta.pill)}>{meta.label}</span>
      {held && (
        // A breached approval deadline is warn, never fail: the deadline was one
        // WE set on the buyer's own approver, and letting it lapse is ours.
        <div
          className={cn(
            'ao-flag',
            approval.breached ? 'ao-flag--warn text-warn' : 'ao-flag--muted',
          )}
        >
          {approval.breached
            ? `Approver deadline passed · ${onDate(approval.expiresAt)}`
            : `Held for ${approval.approverName} · until ${onDate(approval.expiresAt)}`}
        </div>
      )}
    </>
  );
}

/* ---- the attention strip ---------------------------------------------- */

function Attention({ attention }: { attention: OpsOrderAttention }): React.JSX.Element | null {
  const items: React.ReactNode[] = [];

  for (const o of attention.deliveredUnpaid) {
    items.push(
      <div className="ao-attn__item" key={`bad-${o.orderNumber}`}>
        <span className="sev sev--bad" aria-hidden="true" />
        <span className="txt">
          <strong>Delivered but not paid.</strong> <span className="mono">{o.orderNumber}</span>{' '}
          reached {o.buyerName ?? 'the buyer'} and {rupees(o.grandTotal)} is still pending.
        </span>
        <Link to={`/orders/${o.orderNumber}`}>Open order →</Link>
      </div>,
    );
  }
  for (const o of attention.acceptedUnpaid) {
    items.push(
      <div className="ao-attn__item" key={`warn-${o.orderNumber}`}>
        <span className="sev sev--warn" aria-hidden="true" />
        <span className="txt">
          <strong>
            {o.status === 'DISPATCHED' ? 'Dispatched before payment.' : 'Vendor accepted before payment.'}
          </strong>{' '}
          <span className="mono">{o.orderNumber}</span> is prepaid, but the vendor has{' '}
          {o.status === 'DISPATCHED' ? 'dispatched' : 'accepted'} it with {rupees(o.grandTotal)}{' '}
          unpaid.
        </span>
        <Link to={`/orders/${o.orderNumber}`}>Open order →</Link>
      </div>,
    );
  }
  const pending = attention.paymentPending;
  if (pending.count > 0) {
    items.push(
      <div className="ao-attn__item" key="pending">
        <span className="sev sev--warn" aria-hidden="true" />
        <span className="txt">
          <strong>
            {pending.count} {pending.count === 1 ? 'order' : 'orders'} waiting for payment
          </strong>
          , {rupees(pending.total)} in total.
          {pending.oldestPlacedAt
            ? ` The oldest was placed on ${onDate(pending.oldestPlacedAt)}.`
            : ''}
        </span>
        <Link to="/orders?status=PAYMENT_PENDING">Show them →</Link>
      </div>,
    );
  }

  // Nothing to attend to is nothing to draw: a titled strip with no rows under
  // it is a reassurance nobody asked for.
  if (items.length === 0) return null;
  return (
    <section className="ao-attn" aria-label="Needs attention">
      <div className="ao-attn__head">
        <InfoIcon />
        Needs attention
      </div>
      {items}
    </section>
  );
}

/* ======================================================================== */

export function OpsOrderBoardRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  // Board state lives in the URL, all of it: an ops manager forwarding "the six
  // waiting on payment" to a colleague is the case, and the dashboard's tiles
  // are links into exactly these filters.
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const payment = params.get('payment') ?? '';
  const approval = params.get('approval') ?? '';
  const sort = params.get('sort') ?? 'recent';
  const page = Number(params.get('page') ?? '1');
  const filtered = Boolean(q || status || payment || approval);

  // The box is committed on Enter and blur rather than per keystroke, but the
  // URL is still the source of truth.
  const [typed, setTyped] = React.useState(q);
  React.useEffect(() => setTyped(q), [q]);

  const { data, error } = useResource<OpsOrderBoard>(
    `${OPS_API.orders}?${boardQuery(params)}`,
    'The order board is unavailable',
  );

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change returns to page 1: a kept page number on a smaller
    // result set lands on an empty board that looks like a broken filter.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  // Whether the purchase-order count may be a link at all.
  //
  // `procurement.po.read_any` is a DIFFERENT permission from the one guarding
  // this screen, and SUPPORT — whose board this is, per §3C.4 — does not hold
  // it. A link that 403s for the very role the screen exists for is the
  // dead-control pattern, so the count stays a number for them and becomes a
  // link for everyone who can open it.
  const { principal } = useAuth();
  const canOpenPos = principal?.permissions.includes('procurement.po.read_any') ?? false;

  const columns = React.useMemo<ReadonlyArray<Column<OpsOrderRow>>>(
    () => [
      {
        key: 'orderNumber',
        header: 'Order',
        cell: (o) => (
          <>
            <Link className="ao-id" to={`/orders/${o.orderNumber}`}>
              {o.orderNumber}
            </Link>
            <div className="ao-small">
              {onDate(o.placedAt)} ·{' '}
              {o.purchaseOrders > 0 ? (
                <>
                  {canOpenPos ? (
                    <Link to={`/procurement/pos?q=${encodeURIComponent(o.orderNumber)}`}>
                      {o.purchaseOrders}
                    </Link>
                  ) : (
                    <span>{o.purchaseOrders}</span>
                  )}{' '}
                  {o.purchaseOrders === 1 ? 'PO' : 'POs'}
                </>
              ) : (
                // **Never a bare 0 here.** On a DISPATCHED or DELIVERED row it
                // means we shipped a machine with no record of buying it.
                <NotMeasured
                  why="No purchase order was ever raised for this order, so what we paid for its machines is not recorded"
                  label="None raised"
                />
              )}
            </div>
            {o.matchedOn.length > 0 && (
              // Why this row is in the result. Without it, a seal-code search
              // lands on a board with no seal column and reads as a mistake.
              <div className="ao-small">
                matched on{' '}
                {o.matchedOn.map((m, i) => (
                  <React.Fragment key={`${m.kind}-${m.value}`}>
                    {i > 0 && ', '}
                    <span className={m.kind === 'serial' || m.kind === 'seal' ? 'mono' : undefined}>
                      {m.value}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}
          </>
        ),
      },
      {
        key: 'buyer',
        header: 'Buyer',
        cell: (o) =>
          o.buyer ? (
            <>
              <div className="ao-buyer">{o.buyer.legalName}</div>
              {o.buyer.tradeName && o.buyer.tradeName !== o.buyer.legalName && (
                <div className="ao-buyer-sub">{o.buyer.tradeName}</div>
              )}
            </>
          ) : (
            <NotMeasured
              why="The organisation on this order could not be resolved"
              label="Buyer unresolved"
            />
          ),
      },
      { key: 'status', header: 'Status', cell: (o) => <StatusCell o={o} /> },
      { key: 'payment', header: 'Payment', cell: (o) => <PaymentCell o={o} /> },
      { key: 'units', header: 'Machines', numeric: true, cell: (o) => o.units },
      {
        key: 'grandTotal',
        header: 'Order value',
        numeric: true,
        cell: (o) => <span className="ao-val">{rupees(o.grandTotal)}</span>,
      },
      {
        key: 'open',
        header: 'Open',
        headerHidden: true,
        numeric: true,
        cell: (o) => (
          <Link className="ao-open" to={`/orders/${o.orderNumber}`} aria-label={`Open ${o.orderNumber}`}>
            <ChevronIcon />
          </Link>
        ),
      },
    ],
    [canOpenPos],
  );

  if (error) {
    return (
      <EmptyState
        title="The order board did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  const statusFacets = [...(data?.facets.status ?? [])].sort(
    (a, b) => pipelineIndex(a.value) - pipelineIndex(b.value),
  );
  const allCount = statusFacets.reduce((n, f) => n + f.count, 0);
  const from = data && data.total > 0 ? (data.page - 1) * data.per + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.per) : 0;

  return (
    <div className="orders-board">
      <div className="ao-head">
        <h1 className="ao-title">Orders</h1>
        <p className="ao-sub">Every buyer order on the platform, newest first.</p>
      </div>

      {data?.attention && <Attention attention={data.attention} />}

      <form
        className="ao-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', typed.trim());
        }}
      >
        <label className="ao-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Order no., PO, serial, seal code, buyer, GSTIN or mobile"
            aria-label="Search orders"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setFilter('q', typed.trim())}
          />
        </label>
        <label className="ao-select">
          Payment
          <select value={payment} onChange={(e) => setFilter('payment', e.target.value)}>
            <option value="">Any</option>
            {(data?.facets.payment ?? []).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ao-select">
          Approval
          <select value={approval} onChange={(e) => setFilter('approval', e.target.value)}>
            <option value="">Any</option>
            <option value="pending">Needs approval</option>
            <option value="approved">Approved</option>
            <option value="none">Not required</option>
          </select>
        </label>
        <label className="ao-select">
          Sort
          <select value={sort} onChange={(e) => setFilter('sort', e.target.value)}>
            <option value="recent">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="value">Value: high to low</option>
          </select>
        </label>
      </form>
      {data?.searchedFor && (
        <p className="ao-hint">Compared against {data.searchedFor.join(', ')}.</p>
      )}

      <div className="ao-status" role="group" aria-label="Order status">
        <button
          type="button"
          className="ao-chip"
          aria-pressed={status === ''}
          onClick={() => setFilter('status', '')}
        >
          All <span className="n">{allCount}</span>
        </button>
        {statusFacets.map((f) => {
          const meta = statusMeta(f.value);
          return (
            <button
              key={f.value}
              type="button"
              className="ao-chip"
              aria-pressed={status === f.value}
              onClick={() => setFilter('status', status === f.value ? '' : f.value)}
            >
              <span className={cn('d', meta.dot)} aria-hidden="true" />
              {meta.label} <span className="n">{f.count}</span>
            </button>
          );
        })}
      </div>

      <Board className="ao-card">
        <DataBoard
          className="ao-table"
          caption={
            data
              ? `${data.total} ${data.total === 1 ? 'order' : 'orders'} match, ${
                  sort === 'oldest' ? 'oldest first' : sort === 'value' ? 'largest first' : 'newest first'
                }.`
              : 'Loading the order board.'
          }
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(o) => o.orderNumber}
          rowClassName={(o) =>
            isDeliveredUnpaid(o) ? 'is-bad' : isAcceptedUnpaid(o) ? 'is-warn' : undefined
          }
          loading={!data}
          skeletonRows={8}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'No orders yet'}
              body={
                filtered
                  ? 'Orders do exist — this filter has none of them. The box matches anywhere inside a value, so a partial serial does find its order; a wrong character or a stray space does not.'
                  : 'An order appears here the moment a buyer completes checkout. Nothing has gone wrong.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <div className="ao-foot">
          <span>
            {data ? (
              <>
                Showing{' '}
                <strong>
                  {from}–{to}
                </strong>{' '}
                of <strong>{data.total}</strong> {data.total === 1 ? 'order' : 'orders'}
              </>
            ) : (
              'Loading the order board.'
            )}
          </span>
          {data && data.pages > 1 ? (
            <Pagination
              className="ao-pages"
              page={page}
              pageCount={data.pages}
              onPage={(next) => setFilter('page', String(next))}
              label="Pages"
            />
          ) : null}
        </div>
      </Board>
    </div>
  );
}
