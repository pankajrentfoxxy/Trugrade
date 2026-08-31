import * as React from 'react';
import { Link, useParams } from 'react-router';
import { type Grade } from '@trugrade/contracts';
import {
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  Timeline,
  type Column,
  type TimelineEvent,
} from '@trugrade/ui';
import { Board, Datum, NotMeasured, Section } from '../../lib/controls';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import {
  APPROVAL_TONE,
  humanise,
  onDate,
  onDateTime,
  OPS_API,
  ORDER_TONE,
  PAYMENT_TONE,
  PO_TONE,
  partyLine,
  rupees,
  type OpsOrderMachine,
  type OpsOrderRecord,
  type OpsPurchaseOrderOnOrder,
} from './api';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * One order end-to-end — `03_UX_SPEC.md` §3C.4.
 *
 * **This is the only screen in the product where both sides sit together**, and
 * the spec says so: the buyer's side and the purchase orders we raised against
 * it, with the margin between them, ADMIN-only. The buyer's own
 * `/account/orders/[orderNumber]` reads `procurement` nowhere at all and must
 * never learn to; the vendor's `/vendor/orders/[poId]` carries no buyer and not
 * even the buyer's order number. The seam is enforced on the server in three
 * separate services, and this is the one permitted to see across it.
 *
 * **The margin is refused rather than approximated.** Three orders on this
 * database have machines and no purchase order at all, two of them delivered —
 * a margin over partial cover would read as the real one and be wrong by
 * whatever those machines cost. The server decides, and sends the reason.
 *
 * **No action panel action, and the panel says why.** Cancel, reallocate and
 * force-progress are all transactions no service in this codebase performs. The
 * side panel names them and names what is missing, which is the honest form of a
 * control that does not exist.
 */

const MACHINE_COLUMNS: ReadonlyArray<Column<OpsOrderMachine>> = [
  {
    key: 'serial',
    header: 'Serial',
    cell: (m) => (
      // 0.08em tracking because a serial is compared to a sticker by a person
      // holding the laptop, exactly as T32's pick list found.
      <span className="font-mono tnum tracking-[0.08em] text-ink">{m.serialNumber}</span>
    ),
  },
  {
    key: 'title',
    header: 'Machine',
    cell: (m) =>
      m.title ?? (
        <NotMeasured
          why="The SKU behind this line has been withdrawn from the catalog"
          label="Model withdrawn"
        />
      ),
  },
  {
    key: 'grade',
    header: 'Grade',
    // Neutral, always. A+/A/B are all sellable and a position on a scale is not
    // a verdict — that is what `GradeBadge` exists to keep true.
    cell: (m) => <GradeBadge grade={m.grade as Grade} />,
  },
  { key: 'sold', header: 'Sold at', numeric: true, cell: (m) => rupees(m.unitPrice) },
  {
    key: 'cost',
    header: 'We pay',
    numeric: true,
    cell: (m) =>
      m.purchaseCost === null ? (
        <NotMeasured
          why="No purchase-order line covers this serial, so what we agreed to pay for it is not recorded"
          label="No PO line"
        />
      ) : (
        <span className="text-ink-2">{rupees(m.purchaseCost)}</span>
      ),
  },
  {
    key: 'status',
    header: 'Unit state',
    cell: (m) => <span className="text-ink-2">{humanise(m.status)}</span>,
  },
];

/**
 * `canOpenPos` gates the ONE link on this table, and it is not decoration.
 *
 * The purchase-order board is guarded on `procurement.po.read_any`, which is a
 * different permission from the one guarding this screen — SUPPORT, whose screen
 * §3C.4 says this is, does not hold it. Linking the number for them would put a
 * control that 403s on the record they use all day.
 */
const poColumns = (canOpenPos: boolean): ReadonlyArray<Column<OpsPurchaseOrderOnOrder>> => [
  {
    key: 'poNumber',
    header: 'Purchase order',
    cell: (po) => (
      <span className="flex flex-wrap items-center gap-2">
        {canOpenPos ? (
          <Link
            className="whitespace-nowrap font-mono tnum text-ink underline underline-offset-4 hover:text-acc-ink"
            to={`/procurement/pos?q=${encodeURIComponent(po.poNumber)}`}
          >
            {po.poNumber}
          </Link>
        ) : (
          <span className="whitespace-nowrap font-mono tnum text-ink">{po.poNumber}</span>
        )}
        <StatusPill
          tone={PO_TONE[po.status] ?? 'neutral'}
          label={humanise(po.status)}
          className="whitespace-nowrap"
        />
      </span>
    ),
  },
  {
    key: 'vendor',
    header: 'Supply point',
    cell: (po) =>
      po.vendorLegalName ?? (
        <NotMeasured
          why="The supplier organisation on this purchase order could not be resolved"
          label="Unresolved"
        />
      ),
  },
  { key: 'lines', header: 'Machines', numeric: true, cell: (po) => po.lines },
  { key: 'totalNet', header: 'We pay', numeric: true, cell: (po) => rupees(po.totalNet) },
  { key: 'tds', header: 'TDS on it', numeric: true, cell: (po) => rupees(po.tdsAmount) },
  {
    key: 'accepted',
    header: 'Accepted',
    cell: (po) =>
      po.acknowledgedAt ? (
        <span className="font-mono tnum text-ink-2">{onDate(po.acknowledgedAt)}</span>
      ) : (
        <NotMeasured
          why="The supply point has not accepted this purchase order yet. There is no acceptance deadline in this product, so it is not late"
          label="Not accepted"
        />
      ),
  },
];

export function OpsOrderRecordRoute(): React.JSX.Element {
  const { orderNumber = '' } = useParams();
  const { principal } = useAuth();
  const canOpenPos = principal?.permissions.includes('procurement.po.read_any') ?? false;
  const { data, error } = useResource<OpsOrderRecord>(
    OPS_API.order(orderNumber),
    'That order could not be opened',
  );

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
      <div className="tg-stack">
        <Skeleton lines={3} />
        <div className="tg-card rounded-lg border border-rule bg-sheet">
          <Skeleton lines={6} />
        </div>
      </div>
    );
  }

  const machines = data.subOrders.reduce((n, s) => n + s.machines.length, 0);

  const timeline: TimelineEvent[] = data.timeline.map((e, i) => ({
    key: `${e.at}-${i}`,
    action:
      e.fromStatus && e.toStatus
        ? `${humanise(e.type)} — ${humanise(e.fromStatus)} to ${humanise(e.toStatus)}`
        : humanise(e.type),
    // Required by `TimelineEvent` and deliberately not defaulted to "System":
    // an audit line whose actor is a guess is worse than one that admits it
    // does not know which person, or that no person was involved.
    actor: e.actorName ?? 'No person recorded against this event',
    at: onDateTime(e.at),
    dateTime: e.at,
    ...(e.note ? { reason: e.note } : {}),
    ...(i === 0 ? { current: true } : {}),
  }));

  return (
    <div className="tg-stack">
      <RecordHeader
        title={data.orderNumber}
        subtitle={partyLine(data.buyer) ?? 'The organisation on this order could not be resolved'}
        status={
          <StatusPill tone={ORDER_TONE[data.status] ?? 'neutral'} label={humanise(data.status)} />
        }
        identifiers={[
          { label: 'Placed', value: onDate(data.placedAt) },
          {
            label: 'Their PO reference',
            value: data.buyerPoNumber ?? (
              <NotMeasured why="Their procurement system gave no reference" label="None given" />
            ),
          },
          {
            label: 'GSTIN',
            value: data.buyerGstin ?? (
              <NotMeasured
                why="No GST registration is recorded against this order"
                label="Not recorded"
              />
            ),
          },
        ]}
      />

      <div className="grid [&>*]:min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* T35. `min-w-0` on the evidence column: a grid item's default
            `min-width` is `auto`, so without it this column refuses to shrink
            below the min-content of the widest machine table and the PAGE
            scrolls sideways at 600px, under a footer that stops at the viewport
            edge. Measured here at 736px inside a 600px viewport. */}
        <div className="min-w-0">
          {/* ------------------------------------------------------------- */}
          <Section
            title="The two sides"
            subtitle="What the buyer is charged, what the supply points are owed, and the difference. This screen is the only one in the product that shows both."
          >
            <div className="grid gap-x-8 sm:grid-cols-2">
              <Datum label="Machines, ex GST">{rupees(data.money.subtotal)}</Datum>
              <Datum label="Freight">{rupees(data.money.freight)}</Datum>
              <Datum label="GST">{rupees(data.money.gstTotal)}</Datum>
              <Datum label="TCS">{rupees(data.money.tcs)}</Datum>
              <Datum label="Buyer pays, all in">
                <span className="text-ink">{rupees(data.money.grandTotal)}</span>
              </Datum>
              <Datum label="Payment">
                <StatusPill
                  tone={PAYMENT_TONE[data.paymentStatus] ?? 'neutral'}
                  label={humanise(data.paymentStatus)}
                />
              </Datum>
            </div>

            <div className="mt-5 rounded border border-rule bg-sheet-2 p-4">
              {data.margin ? (
                <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
                  <div className="flex flex-col gap-1">
                    <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                      Sold for
                    </dt>
                    <dd className="font-mono tnum text-body text-ink">
                      {rupees(data.margin.soldFor)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                      We pay
                    </dt>
                    <dd className="font-mono tnum text-body text-ink">
                      {rupees(data.margin.paid)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                      Margin
                    </dt>
                    {/* Amber, and this is the one measured value on the screen
                        that earns it — rule 1's second meaning. */}
                    <dd className="font-mono tnum text-h3 text-acc-ink">
                      {rupees(data.margin.amount)}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                      As a share
                    </dt>
                    {/* Every percentage carries its denominator. */}
                    <dd className="text-body-sm text-ink-2">
                      <span className="font-mono tnum text-ink">{data.margin.pct}%</span> of{' '}
                      <span className="font-mono tnum">{rupees(data.margin.soldFor)}</span> sold, ex
                      GST and ex freight
                    </dd>
                  </div>
                </dl>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                    Margin
                  </span>
                  {/* Never a zero and never a dash. `--ink-4`, with the reason. */}
                  <p className="max-w-prose text-body-sm text-ink-4">
                    {data.marginUnavailable ?? 'Not calculated.'}
                  </p>
                </div>
              )}
            </div>
          </Section>

          {/* ------------------------------------------------------------- */}
          <Section
            title="Purchase orders we raised"
            subtitle={
              data.purchaseOrders.length > 0
                ? 'One per supply point on this order. A purchase order is created inside the order-confirmation transaction and is never raised by hand.'
                : undefined
            }
          >
            {data.purchaseOrders.length > 0 ? (
              <Board tableMinWidth={620}>
                <DataBoard
                  caption={`${data.purchaseOrders.length} purchase ${data.purchaseOrders.length === 1 ? 'order' : 'orders'} on this order.`}
                  columns={poColumns(canOpenPos)}
                  rows={data.purchaseOrders}
                  rowKey={(po) => po.poId}
                />
              </Board>
            ) : (
              <EmptyState
                title="No purchase order was ever raised"
                body={
                  <>
                    A purchase order is written inside the order-confirmation transaction, so an
                    order with machines and none of them is a gap in the record rather than a stage
                    not yet reached. Nothing on this screen can create one — that is a leg of the
                    order transaction, not a button.
                  </>
                }
              />
            )}
          </Section>

          {/* ------------------------------------------------------------- */}
          {data.subOrders.map((sub) => (
            <Section
              key={sub.subOrderNumber}
              title={sub.vendorLegalName ?? 'Supply point unresolved'}
              subtitle={
                <>
                  Consignment{' '}
                  <span className="font-mono tnum text-ink-2">{sub.subOrderNumber}</span> ·{' '}
                  {sub.machines.length} {sub.machines.length === 1 ? 'machine' : 'machines'} ·{' '}
                  {rupees(sub.subtotal)} ex GST
                </>
              }
              aside={
                <StatusPill
                  tone={ORDER_TONE[sub.status] ?? 'neutral'}
                  label={humanise(sub.status)}
                />
              }
            >
              <div className="mb-4 grid gap-x-8 sm:grid-cols-2">
                <Datum label="Dispatch due">
                  {sub.dispatchSlaDueAt ? (
                    onDateTime(sub.dispatchSlaDueAt)
                  ) : (
                    <NotMeasured
                      why="No dispatch deadline was recorded on this consignment"
                      label="Not set"
                    />
                  )}
                </Datum>
                <Datum label="Delivered">
                  {sub.deliveredAt ? (
                    onDateTime(sub.deliveredAt)
                  ) : (
                    <NotMeasured
                      why="This consignment has not been recorded as delivered"
                      label="Not yet"
                    />
                  )}
                </Datum>
              </div>
              <Board tableMinWidth={680}>
                <DataBoard
                  caption={`${sub.machines.length} ${sub.machines.length === 1 ? 'machine' : 'machines'} leaving ${sub.vendorLegalName ?? 'this supply point'}.`}
                  columns={MACHINE_COLUMNS}
                  rows={sub.machines}
                  rowKey={(m) => m.serialNumber}
                  empty={
                    <EmptyState
                      title="No machine is allocated to this consignment"
                      body="A consignment with no serials against it means allocation never completed. Nothing was shipped."
                    />
                  }
                />
              </Board>
            </Section>
          ))}

          {/* ------------------------------------------------------------- */}
          <Section
            title="Everything that happened"
            subtitle="Every event on this order, with the person behind it where one was recorded."
          >
            {timeline.length > 0 ? (
              <Timeline events={timeline} label="Order timeline" />
            ) : (
              <EmptyState
                title="No event was ever written for this order"
                body="An order carries an event for every state it passes through. None here means the order was written by a path that does not record them."
              />
            )}
          </Section>
        </div>

        {/* --------------------------------------------------------------- */}
        <SidePanel
          title="This order"
          description="A record screen, and read-only. Everything below is a fact, not a control."
          footnote={
            <>
              §3C.4 also asks for cancel-with-reason, reallocate-a-unit and force-progress. None of
              the three is built: cancelling releases units back to sellable, reverses the purchase
              order, the payable and the TDS accrual inside one transaction, and no service in this
              product does any of that. A button that looks like it works and does not is worse than
              its absence.
            </>
          }
        >
          <div className="flex flex-col">
            <Datum label="Machines on this order">
              <span className="font-mono tnum">{machines}</span>
            </Datum>
            <Datum label="Payment mode">{humanise(data.paymentMode)}</Datum>
            <Datum label="Cost centre">
              {data.costCentre ?? (
                <NotMeasured why="The buyer recorded no cost centre" label="None given" />
              )}
            </Datum>
            <Datum label="Placed by">
              {data.placedByName ?? (
                <NotMeasured
                  why="The user who placed this order could not be resolved"
                  label="Unresolved"
                />
              )}
            </Datum>
            <Datum label="Their mobile">
              {data.placedByMobile ? (
                <span className="font-mono tnum">{data.placedByMobile}</span>
              ) : (
                <NotMeasured
                  why="No mobile is recorded against that account"
                  label="Not recorded"
                />
              )}
            </Datum>
            {data.approval && (
              <Datum label="Approval">
                <span className="flex flex-col gap-1">
                  <StatusPill
                    tone={
                      data.approval.breached
                        ? 'warn'
                        : (APPROVAL_TONE[data.approval.status] ?? 'neutral')
                    }
                    label={humanise(data.approval.status)}
                  />
                  <span className="text-body-sm text-ink-2">
                    {data.approval.approverName}, by{' '}
                    <span className="font-mono tnum">{onDateTime(data.approval.expiresAt)}</span>
                  </span>
                </span>
              </Datum>
            )}
          </div>

          <div className="mt-4">
            <h3 className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              Ships to
            </h3>
            {data.shipTo ? (
              <address className="mt-2 not-italic text-body-sm text-ink-2">
                {data.shipTo.label && <span className="block text-ink">{data.shipTo.label}</span>}
                <span className="block">{data.shipTo.line1}</span>
                {data.shipTo.line2 && <span className="block">{data.shipTo.line2}</span>}
                <span className="block">
                  {data.shipTo.city}, {data.shipTo.state}{' '}
                  <span className="font-mono tnum">{data.shipTo.pincode}</span>
                </span>
                <span className="mt-2 block">
                  {data.shipTo.contactName} ·{' '}
                  <span className="font-mono tnum">{data.shipTo.contactMobile}</span>
                </span>
              </address>
            ) : (
              <p className="mt-2 text-body-sm text-ink-4">
                The delivery address on this order could not be resolved. Do not dispatch against
                it.
              </p>
            )}
          </div>

          <p className="mt-4 text-body-sm text-ink-3">
            Grades on this screen are the inspected grade recorded at the time of the purchase
            order. A+, A and B are all sellable, so the badge carries no verdict.
          </p>
        </SidePanel>
      </div>
    </div>
  );
}
