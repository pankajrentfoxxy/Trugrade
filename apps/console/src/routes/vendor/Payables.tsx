import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, DataBoard, EmptyState, StatusPill, TickRule, type Column } from '@trugrade/ui';
import { Board, Datum, NotMeasured, PageHeader, Section, Select } from '../../lib/controls';
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

  switch (row.waitingOn) {
    case 'PAID':
      return (
        <span className="text-ink-2">
          Paid <span className="font-mono tnum">{onDate(row.paidAt)}</span>
        </span>
      );
    case 'CANCELLED':
      return <span className="text-ink-2">This purchase order was cancelled.</span>;
    case 'ON_HOLD':
      return (
        <span className="text-ink-2">
          {row.holdReason ?? 'Held. No reason was recorded, which is itself a defect — raise a ticket.'}
        </span>
      );
    case 'NOT_DELIVERED':
      return (
        <span className="text-ink-2">
          Not delivered yet. Nothing is payable until the machines reach the buyer.
        </span>
      );
    case 'WINDOW_NOT_CONFIGURED':
      return (
        <span className="text-ink-2">
          Delivered {delivered}.{' '}
          <NotMeasured
            why="The inspection window is not configured on this platform, so the payable date cannot be derived"
            label="Inspection window not set"
          />
        </span>
      );
    case 'INSPECTION_WINDOW_OPEN':
      return (
        <span className="text-ink-2">
          Delivered {delivered} · the buyer’s inspection window closes {closes}.
        </span>
      );
    case 'NO_PAYOUT_RUN':
      return (
        <span className="text-ink-2">
          Payable since {closes}. <span className="text-ink">No payout run has been executed</span>,
          so this is ours to move, not yours.
        </span>
      );
  }
}

/**
 * The deduction stack, every line, always — §3B.4.
 *
 * A ₹0 line is still a line and still carries its reason; dropping it would
 * leave a vendor to work out from a matching gross and net that nothing was
 * deducted, which is the same as not telling them.
 *
 * **The net is the server's, not a sum computed here.** `vendor_payable` carries
 * a CHECK constraint — `net_payable = gross - tds - penalties - qc_fee` — so the
 * arithmetic is guaranteed by the database on every row rather than by a
 * component that could be handed two figures that disagree.
 */
function DeductionStack({ view }: { view: PayablesView }): React.JSX.Element {
  const { statement: s } = view;
  return (
    <div className="max-w-prose">
      <Datum label={`Gross — ${s.payables} unpaid ${s.payables === 1 ? 'payable' : 'payables'}`}>
        <span className="font-mono tnum">{rupees(s.gross)}</span>
      </Datum>

      <Datum label="Less TDS deducted at source">
        <span className="font-mono tnum">{rupees(s.tds.amount)}</span>
        {s.tds.ratePct === null ? (
          <span className="mt-1 block">
            <NotMeasured
              why="The TDS policy is not configured, so no rate can be stated"
              label="Rate not configured"
            />
          </span>
        ) : (
          <span className="mt-1 block text-body-sm text-ink-2">
            {/* Every percentage carries its denominator. The rate here is the
                one that WOULD apply above the threshold — deriving it from
                ₹0 ÷ gross would print 0% and tell a vendor the rate is zero
                when it is the threshold that has not been crossed. */}
            <span className="font-mono tnum">{s.tds.ratePct}%</span> above the threshold, on{' '}
            <span className="font-mono tnum">{rupees(s.tds.financialYearPurchases)}</span> purchased
            from you in FY <span className="font-mono tnum">{s.tds.financialYear}</span>.{' '}
            {s.tds.reason}
            {!s.tds.hasVerifiedPan && (
              <>
                {' '}
                This is the higher no-PAN rate — a verified PAN on your profile brings it down.
              </>
            )}
          </span>
        )}
        <span className="mt-1 block text-body-sm text-ink-2">
          Section 393(1) Sl. 8(ii), section code 1031, reported on Form 26Q. Computed on value
          excluding GST and deducted at credit or payment, whichever is earlier — credit is when
          each purchase order was raised.
        </span>
      </Datum>

      <Datum label="Less penalties">
        <span className="font-mono tnum">{rupees(s.penalties)}</span>
        <span className="mt-1 block text-body-sm text-ink-2">
          Nothing has been charged against you. Any penalty would be itemised here with its rule,
          its evidence and the date.
        </span>
      </Datum>

      <Datum label="Less inspection fees">
        <span className="font-mono tnum">{rupees(s.qcFees)}</span>
        <span className="mt-1 block text-body-sm text-ink-2">
          Inspections are paid for by us, so this line is zero by policy rather than by coincidence.
        </span>
      </Datum>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-rule pt-4">
        <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
          Net payable to you
        </span>
        {/* The one amber figure on this screen: rule 1's second meaning, a
            measured value, and this is the measurement the whole page is about. */}
        <span className="font-mono tnum text-h2 text-acc-ink">{rupees(s.net)}</span>
      </div>
    </div>
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
      { key: 'net', header: 'Net to you', numeric: true, cell: (r) => rupees(r.net) },
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
    return (
      <EmptyState
        title="Your payables did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  return (
    <div className="tg-stack">
      <PageHeader title="What we owe you">
        A payable is raised the moment we buy a machine from you. It becomes payable once the buyer
        has taken delivery and their inspection window has closed — that rule is on every row below,
        not in a help article.
      </PageHeader>

      {!data ? (
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
      ) : (
        <>
          {/* Two columns from lg. The statement and the terms that govern it are
              one thought, and each is prose-width — stacked full-bleed they left
              half the page empty beside a 60ch paragraph, which reads as a
              broken layout rather than as a deliberate measure. */}
          <div className="grid items-start gap-5 lg:grid-cols-2">
          <Section
            title="Your statement"
            subtitle="Every deduction, every line, whether or not it is zero."
          >
            {data.statement.payables === 0 ? (
              // A vendor who is owed nothing has no statement, and printing the
              // whole stack as five zeros makes "5% above the threshold, on
              // ₹0.00 purchased from you" a sentence nobody needs to read. What
              // is worth saying is what will appear here when there is money.
              <p className="max-w-prose text-body-sm text-ink-2">
                Nothing is owed to you right now. The moment a payable exists this is where the
                whole deduction stack appears — gross, TDS with the rule it was struck under, any
                penalty with its evidence, inspection fees, and the net.
              </p>
            ) : (
              <DeductionStack view={data} />
            )}
          </Section>

          <Section title="When this money moves">
            <div className="max-w-prose">
              <Datum label="Has a payout ever been run">
                {data.payoutsEver === 0 ? (
                  <>
                    <span className="text-ink">No. Not once, for any supplier.</span>
                    <span className="mt-1 block text-body-sm text-ink-2">
                      Payout runs are not live on this platform yet. Everything above is accrued and
                      owed; none of it has been through a settlement run, and there is no date we
                      can give you for one. We would rather say that than show you a date to plan
                      against.
                    </span>
                  </>
                ) : (
                  <span className="font-mono tnum text-ink">{data.payoutsEver}</span>
                )}
              </Datum>

              <Datum label="Your payment clock">
                {data.msme.registered ? (
                  <>
                    <span className="text-ink">
                      MSME —{' '}
                      <span className="font-mono tnum">{data.msme.udyamNumber}</span>
                    </span>
                    <span className="mt-1 block text-body-sm text-ink-2">
                      {data.msme.maxPaymentDays === null ? (
                        <NotMeasured
                          why="The statutory MSME payment period is not configured on this platform"
                          label="Statutory period not configured"
                        />
                      ) : (
                        <>
                          Section 15 of the MSMED Act 2006 binds us to pay you within{' '}
                          <span className="font-mono tnum">{data.msme.maxPaymentDays}</span> days of
                          the goods being accepted, and section 16 charges us compound interest at
                          three times the RBI bank rate on any delay. That is a legal deadline, not
                          a payout cycle, and it is the date in the last column.
                        </>
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-ink">
                      Your purchase orders’ own payment terms apply.
                    </span>
                    <span className="mt-1 block text-body-sm text-ink-2">
                      No Udyam registration is on record for your organisation. With one you are an
                      MSME and the MSMED Act would bind us to a{' '}
                      {data.msme.maxPaymentDays === null ? (
                        'statutory'
                      ) : (
                        <span className="font-mono tnum">{data.msme.maxPaymentDays}-day</span>
                      )}{' '}
                      deadline instead. Add it during registration or ask your account manager.
                    </span>
                  </>
                )}
              </Datum>

              <Datum label="The inspection window">
                {data.inspectionWindowHours === null ? (
                  <NotMeasured
                    why="The buyer inspection window is not configured on this platform"
                    label="Not configured"
                  />
                ) : (
                  <>
                    <span className="font-mono tnum text-ink">
                      {data.inspectionWindowHours} hours
                    </span>
                    <span className="mt-1 block text-body-sm text-ink-2">
                      from delivery. A buyer can return a machine inside it, so a payable does not
                      become ours to settle until it has closed.
                    </span>
                  </>
                )}
              </Datum>

              <Datum label="Where the money would go">
                {data.account === null ? (
                  <>
                    <span className="text-ink">
                      We have no payout account on record for you.
                    </span>
                    <span className="mt-1 block text-body-sm text-ink-2">
                      Nothing above can be paid until a bank account is added and the ₹1 penny-drop
                      confirms the name your bank holds. This is the one item on this page you can
                      clear yourself.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-ink">
                      {data.account.holderName}
                      {data.account.bankName ? ` · ${data.account.bankName}` : ''} ·{' '}
                      <span className="font-mono tnum">••••{data.account.last4}</span>
                    </span>
                    <span className="mt-1 block text-body-sm text-ink-2">
                      {data.account.verified
                        ? 'Verified by penny-drop.'
                        : `Not yet verified — penny-drop is ${data.account.pennyDropStatus.toLowerCase()}. Payouts are blocked until it succeeds.`}
                      {data.account.frozenUntil && (
                        <>
                          {' '}
                          Payouts are frozen until{' '}
                          <span className="font-mono tnum">
                            {onDateTime(data.account.frozenUntil)}
                          </span>{' '}
                          after a recent bank-account change.
                        </>
                      )}
                    </span>
                  </>
                )}
              </Datum>
            </div>
          </Section>
          </div>

          <div className="mt-6">
            <h2 className="text-h3 text-ink">Every payable</h2>
            <TickRule />
          </div>

          <div className="flex flex-wrap items-end gap-4">
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
          </div>

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
