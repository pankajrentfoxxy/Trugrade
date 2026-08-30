import * as React from 'react';
import { Link, useParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SealChip,
  SidePanel,
  Skeleton,
  StatusPill,
  TickRule,
  type Column,
  type SealStatus,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { useAuth } from '../../lib/auth';
import { Board, Datum, NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  onDate,
  postJson,
  rupees,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
} from './api';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * One purchase order — `03_UX_SPEC.md` §3B.3, `/vendor/orders/[poId]`.
 *
 * The lines name **specific serials and specific seal codes**, because those
 * exact machines were allocated to a buyer at the moment they paid. This is not
 * a request for two Latitudes; it is a request for these two Latitudes, and the
 * screen is built so a person can carry it to a shelf.
 *
 * **The buyer is absent by construction.** The server's allow-list carries a
 * delivery city and no more: no legal name, no GSTIN, no contact, no order
 * number. The full street address exists on the pick list, which is a separate
 * route because that is the point at which the goods have to physically travel.
 */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'processing'> = {
  RAISED: 'warn',
  ACKNOWLEDGED: 'processing',
  DISPATCH_READY: 'processing',
  DISPATCHED: 'processing',
  RECEIVED: 'processing',
  INVOICED: 'processing',
  MATCHED: 'processing',
  PAYABLE: 'info',
  PAID: 'neutral',
  CANCELLED: 'neutral',
  DISPUTED: 'warn',
};

/**
 * The seal codes a warehouse compares against a sticker, in mono and tabular.
 *
 * `SealChip` renders the status; the code sits beside it. There is deliberately
 * **no barcode**: `Barcode` in `@trugrade/ui` is placeholder geometry that
 * encodes nothing (recorded as such in the build ledger), and a barcode beside a
 * real seal code on a picking screen is an invitation to scan something that
 * cannot be scanned. A code that will not scan is worse than no code at all.
 */
function Seal({ seal }: { seal: PurchaseOrderLine['seal'] }): React.JSX.Element {
  if (!seal) {
    return (
      <NotMeasured
        why="No seal is recorded against the inspection this machine was bought on"
        label="No seal recorded"
      />
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono tnum text-ink">{seal.code}</span>
      <SealChip status={seal.status as SealStatus} />
    </span>
  );
}

export function VendorPurchaseOrderRoute(): React.JSX.Element {
  const { poId = '' } = useParams();
  const { principal } = useAuth();
  const [reloadKey, setReloadKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [accepted, setAccepted] = React.useState<PurchaseOrderDetail | null>(null);

  const { data, error } = useResource<PurchaseOrderDetail>(
    `${API.purchaseOrder(poId)}?_=${reloadKey}`,
    'That purchase order is unavailable',
  );
  const po = accepted ?? data;

  /**
   * VENDOR_FINANCE and VENDOR_VIEWER read a PO and cannot promise the machines.
   * The API refuses them either way; this is what stops the screen offering a
   * button that will always fail, and it says who can instead of going quiet.
   */
  const canAcknowledge = principal?.permissions.includes('procurement.po.acknowledge') ?? false;

  async function acknowledge(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      setAccepted(await postJson<PurchaseOrderDetail>(API.acknowledgePo(poId), {}));
      setReloadKey((k) => k + 1);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns = React.useMemo<ReadonlyArray<Column<PurchaseOrderLine>>>(
    () => [
      {
        key: 'serial',
        header: 'Serial',
        cell: (l) =>
          l.serialNumber ? (
            // Wide tracking on a serial is not decoration: this string is read
            // off a screen and compared to a sticker character by character.
            <span className="font-mono tnum tracking-[0.06em] text-ink">{l.serialNumber}</span>
          ) : (
            <NotMeasured
              why="This machine is no longer on your stock records"
              label="Serial unavailable"
            />
          ),
      },
      { key: 'seal', header: 'Seal code', cell: (l) => <Seal seal={l.seal} /> },
      {
        key: 'grade',
        header: 'Grade',
        // Neutral, always. A+, A and B are all sellable — a grade is a position
        // on a scale and never a verdict, and `GradeBadge` is the only thing
        // that renders one.
        cell: (l) => <GradeBadge grade={l.gradeAtPo as Grade} />,
      },
      {
        key: 'machine',
        header: 'Machine',
        cell: (l) =>
          l.title ? (
            <span className="flex flex-col">
              <span className="text-ink">{l.title}</span>
              {l.specSummary && <span className="text-body-sm text-ink-2">{l.specSummary}</span>}
            </span>
          ) : (
            <NotMeasured
              why="The catalog entry for this machine could not be read"
              label="No catalog entry"
            />
          ),
      },
      {
        key: 'payout',
        header: 'You are owed',
        numeric: true,
        cell: (l) => rupees(l.agreedNetPayout),
      },
    ],
    [],
  );

  if (error) {
    return (
      <EmptyState
        title="That purchase order did not load"
        body={`${error}. If you followed a link, the purchase order may not be yours.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/orders">
            Back to your purchase orders
          </Link>
        }
      />
    );
  }

  if (!po) {
    // The header is real and the lines are a skeleton, as §3B.3 asks: the PO
    // number is in the URL the vendor clicked, so there is nothing honest about
    // hiding the page behind a spinner.
    return (
      <div className="tg-stack">
        <Breadcrumb items={[{ label: 'Purchase orders', href: '/vendor/orders' }, { label: '…' }]} />
        <RecordHeader title="Purchase order" subtitle="Loading the machines on this order." />
        <Board>
          <div className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[46px] w-full" />
            ))}
          </div>
        </Board>
      </div>
    );
  }

  const settled = po.status !== 'RAISED';

  return (
    <div className="tg-stack">
      <Breadcrumb
        items={[{ label: 'Purchase orders', href: '/vendor/orders' }, { label: po.poNumber }]}
      />

      <RecordHeader
        title={po.poNumber}
        subtitle={
          <>
            We are buying {po.units} {po.units === 1 ? 'machine' : 'machines'} from you against this
            order. Payment terms are {po.termsDays} days,{' '}
            {po.valuationMethod === 'MARGIN'
              ? 'and it is treated under the margin scheme, Rule 32(5).'
              : 'under the regular GST channel.'}
          </>
        }
        status={
          <StatusPill
            tone={STATUS_TONE[po.status] ?? 'neutral'}
            label={po.status.replaceAll('_', ' ')}
          />
        }
        identifiers={[
          { label: 'Raised', value: onDate(po.raisedAt) },
          {
            label: 'Deliver to',
            value: po.deliverTo ? (
              `${po.deliverTo.city}, ${po.deliverTo.state}`
            ) : (
              <NotMeasured
                why="The delivery address on this order could not be resolved"
                label="Destination unresolved"
              />
            ),
          },
          {
            label: 'Accepted',
            value: po.acknowledgedAt ? (
              onDate(po.acknowledgedAt)
            ) : (
              <NotMeasured why="You have not accepted this purchase order yet" label="Not yet" />
            ),
          },
        ]}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h2 className="text-h3 text-ink">The machines on this order</h2>
          <TickRule />
          <p className="mt-3 max-w-prose text-body-sm text-ink-2">
            These serials were allocated when the buyer paid, so they are the only machines that can
            satisfy this order. Check each seal is intact before it leaves your floor — a broken
            seal at the door stops the pickup.
          </p>

          <Board className="mt-4" tableMinWidth={620}>
            <DataBoard
              caption={`${po.lines.length} ${po.lines.length === 1 ? 'machine' : 'machines'} on ${po.poNumber}.`}
              columns={columns}
              rows={po.lines}
              rowKey={(l) => l.unitId}
              empty={
                <EmptyState
                  title="This purchase order has no lines"
                  body="That should not happen — a purchase order is written with its lines in one transaction. Please raise a ticket quoting the PO number."
                />
              }
            />
          </Board>

          <div className="mt-6 max-w-prose">
            <Datum label="What we agreed to pay">{rupees(po.totalNet)}</Datum>
            <Datum label="TDS deducted at source">
              {/* Every percentage carries its denominator. A rate with no base
                  is a number nobody can check, and this one is 0% for a reason
                  that has to be legible rather than assumed. */}
              <span className="font-mono tnum">{po.tdsRatePct}%</span> —{' '}
              <span className="font-mono tnum">{rupees(po.tdsAmount)}</span> of{' '}
              <span className="font-mono tnum">{rupees(po.totalNet)}</span>
              <span className="mt-1 block text-body-sm text-ink-2">
                Section 393(1) Sl. 8(ii), computed on value excluding GST, deducted at credit or
                payment whichever is earlier — credit is when this order was raised. Your{' '}
                <Link className="underline underline-offset-4" to="/vendor/payables">
                  payables
                </Link>{' '}
                show the full deduction stack and why this figure is what it is.
              </span>
            </Datum>
            <Datum label="Expected dispatch">
              {po.expectedDispatchAt ? (
                onDate(po.expectedDispatchAt)
              ) : (
                <NotMeasured
                  why="No dispatch date has been agreed on this purchase order"
                  label="Not agreed"
                />
              )}
            </Datum>
            {po.rejectedAt && (
              <Datum label="Rejected">
                {onDate(po.rejectedAt)}
                {po.rejectionReason ? ` — ${po.rejectionReason}` : ''}
              </Datum>
            )}
            {po.cancelledAt && <Datum label="Cancelled">{onDate(po.cancelledAt)}</Datum>}
          </div>
        </div>

        <SidePanel
          title={settled ? 'This order is accepted' : 'Accept this order'}
          description={
            settled
              ? 'Nothing more is needed here. Print the pick list when you are ready to pack.'
              : 'Accepting tells us these machines are yours to produce. It does not release them — the pickup is arranged separately.'
          }
          footnote={
            /* §3B.3 asks for "the acceptance deadline with the penalty for
               missing it, stated before acceptance". There is no acceptance
               window in platform_config and no penalty rule behind one, so
               there is no deadline to state and inventing 24 or 48 hours would
               put a number on this screen that nobody agreed to. Reported.

               Only before acceptance, because "stated before acceptance" is
               the whole point of it — a deadline note under an order already
               accepted is noise on the one screen that must stay scannable. */
            settled ? undefined : po.acknowledgeBy ? (
              <>
                Accept by <span className="font-mono tnum">{onDate(po.acknowledgeBy)}</span>.
              </>
            ) : (
              <span className="text-ink-4">
                No acceptance deadline has been set for purchase orders on this platform, so there
                is none to show and none to miss.
              </span>
            )
          }
        >
          {actionError && (
            <p className="mb-3 text-body-sm text-fail" role="alert">
              {actionError}
            </p>
          )}

          {settled ? (
            <Link
              className="text-ink underline underline-offset-4 hover:text-acc-ink"
              to={`/vendor/orders/${po.poId}/pick-list`}
            >
              Open the pick list
            </Link>
          ) : (
            <div className="flex flex-col gap-3">
              {/* The one amber control on this screen. `Button` defaults to
                  `secondary`, so the primary has to be asked for by name. */}
              <Button
                variant="primary"
                loading={busy}
                disabledReason={
                  canAcknowledge
                    ? ''
                    : 'Accepting a purchase order needs the Operations, Admin or Owner role. Ask an owner in your organisation.'
                }
                onClick={() => void acknowledge()}
              >
                Accept {po.poNumber}
              </Button>
              <Link
                className="text-ink underline underline-offset-4 hover:text-acc-ink"
                to={`/vendor/orders/${po.poId}/pick-list`}
              >
                Open the pick list
              </Link>
            </div>
          )}
        </SidePanel>
      </div>
    </div>
  );
}
