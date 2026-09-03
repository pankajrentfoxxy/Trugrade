import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, DataBoard, EmptyState, StatusPill, type Column } from '@trugrade/ui';
import { Board, NotMeasured, Section, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  PAYABLE_STATUSES,
  onDate,
  onDateTime,
  rupees,
  type PayableRow,
  type PayablesView,
} from './api';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * What we owe, and when it becomes payable — `03_UX_SPEC.md` §3B.4.
 *
 * **This screen's hardest job is the part with no data behind it.**
 * `procurement.payout_run` and `payout_line` are empty and nothing writes them,
 * and nothing sets `vendor_payable.eligible_at`. So there is no payout to show
 * and no date to promise, and the screen says both in as many words rather than
 * deriving an "expected on" from `procurement.default_payout_cycle`. That figure
 * is one a vendor plans cash against; inventing it would be the same defect as
 * rendering an unmeasured value as a passing one, with money behind it.
 *
 * The one real clock is the MSME one. A vendor with a Udyam registration on
 * record is bound to be paid within 45 days of the goods being accepted under
 * s.15 of the MSMED Act — an obligation with compound interest behind it, not a
 * cycle — so where that applies the screen names the date, keyed off the actual
 * registration and a real recorded delivery.
 */

/**
 * **A payable is not a verdict and an unpaid one is not a failure.**
 *
 * Green and red are PASS/FAIL only, so neither appears here. `warn` is the
 * attention channel and it is used for the two rows that need somebody to act —
 * and on this screen the somebody is usually us, which the copy says.
 */
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'processing'> = {
  ACCRUED: 'processing',
  ELIGIBLE: 'info',
  IN_RUN: 'processing',
  PAID: 'neutral',
  ON_HOLD: 'warn',
  CANCELLED: 'neutral',
};

/**
 * The sentence §3B.4 requires on every row: what this is waiting on, with its
 * dates. Composed here from a server-decided code — the two clock comparisons
 * behind `INSPECTION_WINDOW_OPEN` and `NO_PAYOUT_RUN` are money deadlines and
 * are made against the API's clock, never the browser's.
 */
function WaitingOn({ row }: { row: PayableRow }): React.JSX.Element {
  const delivered = <span className="font-mono tnum">{onDate(row.deliveredAt)}</span>;
  const closes = <span className="font-mono tnum">{onDateTime(row.inspectionWindowClosesAt)}</span>;

  const wrap = (children: React.ReactNode): React.JSX.Element => (
    <span className="payables-waiting">{children}</span>
  );

  switch (row.waitingOn) {
    case 'PAID':
      return wrap(
        <>
          Paid <span className="font-mono tnum">{onDate(row.paidAt)}</span>
        </>,
      );
    case 'CANCELLED':
      return wrap(<>This purchase order was cancelled.</>);
    case 'ON_HOLD':
      return wrap(
        <>
          {row.holdReason ?? 'Held. No reason was recorded, which is itself a defect — raise a ticket.'}
        </>,
      );
    case 'NOT_DELIVERED':
      return wrap(<>Not delivered yet. Nothing is payable until the machines reach the buyer.</>);
    case 'WINDOW_NOT_CONFIGURED':
      return wrap(
        <>
          Delivered {delivered}.{' '}
          <NotMeasured
            why="The inspection window is not configured on this platform, so the payable date cannot be derived"
            label="Inspection window not set"
          />
        </>,
      );
    case 'INSPECTION_WINDOW_OPEN':
      return wrap(
        <>Delivered {delivered} · the buyer’s inspection window closes {closes}.</>,
      );
    case 'NO_PAYOUT_RUN':
      return wrap(
        <>
          Payable since {closes}. <strong className="font-normal text-ink">No payout run has been executed</strong>,
          so this is ours to move, not yours.
        </>,
      );
  }
}

/** One fact in the payment-rules panel — title, value, explanation. */
function PaymentFact({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="payables-fact">
      <p className="payables-fact-label">{label}</p>
      <div className="payables-fact-value">{value}</div>
      <p className="payables-fact-detail">{detail}</p>
    </div>
  );
}

/**
 * The deduction stack as a ledger — gross down through deductions to net.
 * Every line stays visible even at ₹0; dropping a zero line hides a policy.
 */
function DeductionStack({ view }: { view: PayablesView }): React.JSX.Element {
  const { statement: s } = view;
  return (
    <div className="payables-ledger">
      <div className="payables-ledger-row">
        <div>
          <p className="payables-ledger-label">Gross</p>
          <p className="payables-ledger-hint">
            {s.payables} unpaid {s.payables === 1 ? 'payable' : 'payables'}
          </p>
        </div>
        <span className="payables-ledger-amount font-mono tnum">{rupees(s.gross)}</span>
      </div>

      <div className="payables-ledger-row payables-ledger-deduct">
        <div>
          <p className="payables-ledger-label">Less TDS deducted at source</p>
          {s.tds.ratePct === null ? (
            <p className="payables-ledger-hint">
              <NotMeasured
                why="The TDS policy is not configured, so no rate can be stated"
                label="Rate not configured"
              />
            </p>
          ) : (
            <p className="payables-ledger-hint">
              <span className="font-mono tnum">{s.tds.ratePct}%</span> above the threshold, on{' '}
              <span className="font-mono tnum">{rupees(s.tds.financialYearPurchases)}</span> purchased
              from you in FY <span className="font-mono tnum">{s.tds.financialYear}</span>.{' '}
              {s.tds.reason}
              {!s.tds.hasVerifiedPan &&
                ' This is the higher no-PAN rate — a verified PAN on your profile brings it down.'}
            </p>
          )}
          <p className="payables-ledger-hint mt-2">
            Section 393(1) Sl. 8(ii), section code 1031, reported on Form 26Q. Deducted at credit or
            payment, whichever is earlier — credit is when each purchase order was raised.
          </p>
        </div>
        <span className="payables-ledger-amount font-mono tnum text-ink-2">
          − {rupees(s.tds.amount)}
        </span>
      </div>

      <div className="payables-ledger-row payables-ledger-deduct">
        <div>
          <p className="payables-ledger-label">Less penalties</p>
          <p className="payables-ledger-hint">
            Nothing has been charged against you. Any penalty would be itemised here with its rule,
            its evidence and the date.
          </p>
        </div>
        <span className="payables-ledger-amount font-mono tnum text-ink-2">
          − {rupees(s.penalties)}
        </span>
      </div>

      <div className="payables-ledger-row payables-ledger-deduct">
        <div>
          <p className="payables-ledger-label">Less inspection fees</p>
          <p className="payables-ledger-hint">
            Inspections are paid for by us, so this line is zero by policy rather than by coincidence.
          </p>
        </div>
        <span className="payables-ledger-amount font-mono tnum text-ink-2">
          − {rupees(s.qcFees)}
        </span>
      </div>

      <div className="payables-ledger-total">
        <span className="payables-ledger-label">Net payable to you</span>
        <span className="font-mono tnum text-h2 text-acc-ink">{rupees(s.net)}</span>
      </div>
    </div>
  );
}

/** KPI row + payment rules — the summary a finance user reads first. */
function PayablesSummary({ view }: { view: PayablesView }): React.JSX.Element {
  const { statement: s, rows } = view;
  const overdue = rows.filter((r) => r.overdue).length;
  const waitingDelivery = rows.filter((r) => r.waitingOn === 'NOT_DELIVERED').length;
  const hasMoney = s.payables > 0;

  return (
    <>
      <div className="payables-hero">
        <div className="payables-hero-main">
          <p className="payables-hero-kicker">What we owe you</p>
          <p className="payables-hero-amount font-mono tnum">
            {hasMoney ? rupees(s.net) : 'Nothing owed right now'}
          </p>
          <p className="payables-hero-sub">
            {hasMoney ? (
              <>
                Net payable across {s.payables} open{' '}
                {s.payables === 1 ? 'payable' : 'payables'}. Money moves after delivery and the
                buyer’s inspection window closes — not when the purchase order is raised.
              </>
            ) : (
              <>
                A payable appears the moment we buy a machine from you. It becomes ours to settle once
                the buyer has taken delivery and their inspection window has closed.
              </>
            )}
          </p>
        </div>
        <div className="payables-hero-badges">
          {overdue > 0 ? (
            <StatusPill tone="warn" label={`${overdue} past our deadline`} />
          ) : null}
          {waitingDelivery > 0 ? (
            <StatusPill tone="processing" label={`${waitingDelivery} awaiting delivery`} />
          ) : null}
          {hasMoney ? <StatusPill tone="info" label={`${s.payables} open`} /> : null}
        </div>
      </div>

      <div className="unit-kpi-grid">
        <div className={`unit-kpi-tile${hasMoney ? ' payables-kpi-net' : ''}`}>
          <p className="unit-kpi-label">Net to you</p>
          <p className={`unit-kpi-value font-mono tnum${hasMoney ? ' text-acc-ink' : ''}`}>
            {hasMoney ? rupees(s.net) : '₹0.00'}
          </p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Open payables</p>
          <p className="unit-kpi-value font-mono tnum">{s.payables}</p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Gross before deductions</p>
          <p className="unit-kpi-value font-mono tnum">{rupees(s.gross)}</p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">TDS withheld</p>
          <p className="unit-kpi-value font-mono tnum">{rupees(s.tds.amount)}</p>
        </div>
      </div>

      <div className="payables-summary-stack">
        <Section
          title="Your statement"
          subtitle="Every deduction, every line, whether or not it is zero."
          className="!mt-0 payables-panel"
        >
          {hasMoney ? (
            <DeductionStack view={view} />
          ) : (
            <div className="payables-empty-state">
              <p className="text-body-sm text-ink-2">
                Nothing is owed to you right now. The moment a payable exists this is where the whole
                deduction stack appears — gross, TDS with the rule it was struck under, any penalty with
                its evidence, inspection fees, and the net.
              </p>
            </div>
          )}
        </Section>

        <Section
          title="When this money moves"
          subtitle="Clocks, rules, and where it would land."
          className="!mt-0 payables-panel"
        >
          <div className="payables-facts payables-facts-grid">
            <PaymentFact
              label="Payout runs"
              value={
                view.payoutsEver === 0 ? (
                  <span className="text-ink">No. Not once, for any supplier.</span>
                ) : (
                  <span className="font-mono tnum text-ink">{view.payoutsEver}</span>
                )
              }
              detail={
                view.payoutsEver === 0
                  ? 'Payout runs are not live on this platform yet. Everything accrued is owed; none of it has been through a settlement run, and there is no date we can give you for one.'
                  : 'Completed settlement runs that included your organisation.'
              }
            />

            <PaymentFact
              label="Your payment clock"
              value={
                view.msme.registered ? (
                  <>
                    MSME · <span className="font-mono tnum">{view.msme.udyamNumber}</span>
                  </>
                ) : (
                  <>PO payment terms apply</>
                )
              }
              detail={
                view.msme.registered ? (
                  view.msme.maxPaymentDays === null ? (
                    <NotMeasured
                      why="The statutory MSME payment period is not configured on this platform"
                      label="Statutory period not configured"
                    />
                  ) : (
                    <>
                      Section 15 of the MSMED Act binds us to pay within{' '}
                      <span className="font-mono tnum">{view.msme.maxPaymentDays}</span> days of
                      acceptance. Section 16 charges compound interest at three times the RBI bank rate
                      on any delay — a legal deadline, not a payout cycle.
                    </>
                  )
                ) : (
                  <>
                    No Udyam registration is on record. With one you are an MSME and the MSMED Act
                    would bind us to a{' '}
                    {view.msme.maxPaymentDays === null ? (
                      'statutory'
                    ) : (
                      <span className="font-mono tnum">{view.msme.maxPaymentDays}-day</span>
                    )}{' '}
                    deadline instead.
                  </>
                )
              }
            />

            <PaymentFact
              label="Inspection window"
              value={
                view.inspectionWindowHours === null ? (
                  <NotMeasured
                    why="The buyer inspection window is not configured on this platform"
                    label="Not configured"
                  />
                ) : (
                  <span className="font-mono tnum">{view.inspectionWindowHours} hours</span>
                )
              }
              detail="From delivery. A buyer can return a machine inside it, so a payable does not become ours to settle until it has closed."
            />

            <PaymentFact
              label="Payout account"
              value={
                view.account === null ? (
                  <span className="text-ink">No account on record</span>
                ) : (
                  <>
                    {view.account.holderName}
                    {view.account.bankName ? ` · ${view.account.bankName}` : ''} ·{' '}
                    <span className="font-mono tnum">••••{view.account.last4}</span>
                  </>
                )
              }
              detail={
                view.account === null ? (
                  <>
                    Nothing can be paid until a bank account is added and the ₹1 penny-drop confirms
                    the name your bank holds. This is the one item on this page you can clear yourself.
                  </>
                ) : (
                  <>
                    {view.account.verified
                      ? 'Verified by penny-drop.'
                      : `Not yet verified — penny-drop is ${view.account.pennyDropStatus.toLowerCase()}. Payouts are blocked until it succeeds.`}
                    {view.account.frozenUntil && (
                      <>
                        {' '}
                        Payouts frozen until{' '}
                        <span className="font-mono tnum">{onDateTime(view.account.frozenUntil)}</span>{' '}
                        after a recent bank-account change.
                      </>
                    )}
                  </>
                )
              }
            />
          </div>
        </Section>
      </div>
    </>
  );
}

export function VendorPayablesRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';

  const query = new URLSearchParams();
  if (status) query.set('status', status);
  const { data, error } = useResource<PayablesView>(
    `${API.payables}${query.toString() ? `?${query}` : ''}`,
    'Your payables are unavailable',
  );

  function setFilter(value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
  }

  const columns = React.useMemo<ReadonlyArray<Column<PayableRow>>>(
    () => [
      {
        key: 'po',
        header: 'Purchase order',
        cell: (r) => (
          <span className="flex flex-wrap items-center gap-2">
            <Link
              className="font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/vendor/orders/${r.poId}`}
            >
              {r.poNumber}
            </Link>
            <StatusPill
              tone={STATUS_TONE[r.status] ?? 'neutral'}
              label={r.status.replaceAll('_', ' ')}
              className="whitespace-nowrap"
            />
            {r.overdue && <StatusPill tone="warn" label="PAST OUR DEADLINE" />}
          </span>
        ),
      },
      { key: 'units', header: 'Machines', numeric: true, cell: (r) => r.units },
      { key: 'gross', header: 'Gross', numeric: true, cell: (r) => rupees(r.gross) },
      {
        key: 'tds',
        header: 'TDS',
        numeric: true,
        cell: (r) => <span className="text-ink-2">{rupees(r.tds)}</span>,
      },
      { key: 'net', header: 'Net to you', numeric: true, cell: (r) => (
          <span className="font-mono tnum font-medium text-ink">{rupees(r.net)}</span>
        ) },
      { key: 'waiting', header: 'Waiting on', cell: (r) => <WaitingOn row={r} /> },
      {
        key: 'payBy',
        header: 'We must pay by',
        cell: (r) =>
          r.payBy === null ? (
            // Never a date and never a dash: an undelivered order has no clock,
            // and a blank in a column of deadlines reads as one already met.
            <NotHere />
          ) : (
            <span className="flex flex-col">
              <span className="font-mono tnum text-ink">{onDate(r.payBy)}</span>
              <span className="text-body-sm text-ink-2">
                {r.payByBasis === 'MSMED_ACT'
                  ? `${r.payByDays} days — MSMED Act s.15`
                  : `${r.payByDays}-day payment terms`}
              </span>
            </span>
          ),
      },
    ],
    [],
  );

  if (error) {
    const forbidden = error.includes('(403)');
    return (
      <EmptyState
        title="Your payables did not load"
        body={
          forbidden
            ? `${error}. Your account may not have payables access yet — sign out and sign back in so your permissions refresh. Use owner@northgate.example, finance@northgate.example, or admin@northgate.example.`
            : `${error}. Nothing has been changed — reload to try again.`
        }
      />
    );
  }

  return (
    <div className="tg-stack payables-record">
      {!data ? (
        <>
          <div className="payables-hero payables-hero-loading">
            <p className="payables-hero-kicker">What we owe you</p>
            <p className="payables-hero-amount font-mono tnum">Loading…</p>
          </div>
          <Board>
            <DataBoard
              caption="Loading your payables."
              columns={columns}
              rows={[]}
              rowKey={(r) => r.payableId}
              loading
              skeletonRows={6}
            />
          </Board>
        </>
      ) : (
        <>
          <PayablesSummary view={data} />

          <Section
            title="Every payable"
            subtitle="One row per purchase order. What each is waiting on and when we must pay."
            className="payables-panel"
            aside={
              <Select
                label="Status"
                value={status}
                onChange={(e) => setFilter(e.target.value)}
                options={[
                  { value: '', label: 'Every status' },
                  ...PAYABLE_STATUSES.map((s) => ({
                    value: s,
                    label: s.replaceAll('_', ' ').toLowerCase(),
                  })),
                ]}
              />
            }
          >
            <Board>
              <DataBoard
                caption={`${data.rows.length} ${data.rows.length === 1 ? 'payable' : 'payables'}.`}
                columns={columns}
                rows={data.rows}
                rowKey={(r) => r.payableId}
                empty={
                  <EmptyState
                    title={status ? 'Nothing matches this filter' : 'Nothing payable yet'}
                    body={
                      status
                        ? 'You do have payables — this filter has none. Clear it to see them.'
                        : 'A payable appears here the moment a buyer orders one of your machines and we raise a purchase order for it. It becomes payable once that buyer has taken delivery and their inspection window has closed.'
                    }
                    action={
                      status ? (
                        <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                          Clear the filter
                        </Button>
                      ) : (
                        <Link
                          className="text-acc-ink underline underline-offset-4"
                          to="/vendor/listings"
                        >
                          See your live stock
                        </Link>
                      )
                    }
                  />
                }
              />
            </Board>
          </Section>
        </>
      )}
    </div>
  );
}

/** No clock has started on this one. Words, never a dash and never a date. */
function NotHere(): React.JSX.Element {
  return (
    <NotMeasured
      why="Nothing has been delivered against this purchase order, so no payment deadline has started"
      label="Clock not started"
    />
  );
}
