import * as React from 'react';
import { Link, useParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  Modal,
  RecordHeader,
  SidePanel,
  Skeleton,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { useAuth } from '../../lib/auth';
import { Board, Datum, NotMeasured } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import {
  API,
  humanise,
  onDate,
  postJson,
  rupees,
  type AttachableUnit,
  type PurchaseOrderDemand,
  type PurchaseOrderDetail,
} from './api';

/**
 * ARCHETYPE C — Record. Identity header + evidence panel + actions side panel.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * One purchase order — `/vendor/orders/[poId]`.
 *
 * The lines are SKU + grade + qty. After the vendor accepts, they attach a
 * matching machine from their listing; serials stay off this table. The pick
 * list is stood down until attach is the path a warehouse walks.
 *
 * **The buyer is absent by construction.** The server's allow-list carries a
 * delivery city and no more: no legal name, no GSTIN, no contact, no order
 * number.
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

const ATTACHABLE = new Set(['ACKNOWLEDGED']);

function AttachModal({
  poId,
  demand,
  canAttach,
  onClose,
  onAttached,
}: {
  poId: string;
  demand: PurchaseOrderDemand;
  canAttach: boolean;
  onClose: () => void;
  onAttached: (next: PurchaseOrderDetail) => void;
}): React.JSX.Element {
  const { data, error } = useResource<AttachableUnit[]>(
    API.attachableUnits(poId, demand.skuId, demand.gradeAtPo),
    'Matching machines unavailable',
  );
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [attachError, setAttachError] = React.useState<string | null>(null);

  async function attach(unitId: string): Promise<void> {
    setBusyId(unitId);
    setAttachError(null);
    try {
      onAttached(
        await postJson<PurchaseOrderDetail>(API.attachPoUnit(poId), {
          skuId: demand.skuId,
          grade: demand.gradeAtPo,
          unitId,
        }),
      );
      onClose();
    } catch (e) {
      setAttachError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Attach a device"
      description={`Pick a ${demand.title ?? 'machine'} at Grade ${demand.gradeAtPo.replace('_PLUS', '+')} from your listings.`}
      size="lg"
    >
      {attachError && (
        <p className="mb-3 text-body-sm text-fail" role="alert">
          {attachError}
        </p>
      )}
      {error ? (
        <p className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      ) : !data ? (
        <Skeleton lines={4} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No matching machine is free"
          body="List a unit of this SKU and grade, or wait until a reserved machine for this order is free to attach."
        />
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {data.map((u) => (
            <li
              key={u.unitId}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-rule bg-sheet px-4 py-3"
            >
              <div className="flex flex-col">
                <span className="font-mono tnum tracking-[0.06em] text-ink">{u.serialNumber}</span>
                <span className="text-label text-ink-3">{humanise(u.status)}</span>
              </div>
              <Button
                variant="secondary"
                loading={busyId === u.unitId}
                disabledReason={
                  !canAttach
                    ? 'Attaching a machine needs the Operations, Admin or Owner role.'
                    : busyId && busyId !== u.unitId
                      ? 'Attaching another machine.'
                      : ''
                }
                onClick={() => void attach(u.unitId)}
              >
                Attach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function VendorPurchaseOrderRoute(): React.JSX.Element {
  const { poId = '' } = useParams();
  const { principal } = useAuth();
  const [reloadKey, setReloadKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [accepted, setAccepted] = React.useState<PurchaseOrderDetail | null>(null);
  const [attaching, setAttaching] = React.useState<PurchaseOrderDemand | null>(null);

  const { data, error } = useResource<PurchaseOrderDetail>(
    `${API.purchaseOrder(poId)}?_=${reloadKey}`,
    'That purchase order is unavailable',
  );
  const po = accepted ?? data;

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

  const columns = React.useMemo<ReadonlyArray<Column<PurchaseOrderDemand>>>(
    () => [
      {
        key: 'sku',
        header: 'SKU',
        cell: (d) =>
          d.skuCode ? (
            <span className="font-mono tnum text-ink">{d.skuCode}</span>
          ) : (
            <NotMeasured
              why="The catalog entry for this machine could not be read"
              label="SKU unavailable"
            />
          ),
      },
      {
        key: 'grade',
        header: 'Grade',
        cell: (d) => <GradeBadge grade={d.gradeAtPo as Grade} />,
      },
      {
        key: 'machine',
        header: 'Machine',
        cell: (d) =>
          d.title ? (
            <span className="flex flex-col">
              <span className="text-ink">{d.title}</span>
              {d.specSummary && <span className="text-body-sm text-ink-2">{d.specSummary}</span>}
            </span>
          ) : (
            <NotMeasured
              why="The catalog entry for this machine could not be read"
              label="No catalog entry"
            />
          ),
      },
      {
        key: 'qty',
        header: 'Qty',
        numeric: true,
        cell: (d) => (
          <span className="font-mono tnum text-ink">
            {d.attachedCount} of {d.qty}
          </span>
        ),
      },
      {
        key: 'payout',
        header: 'You are owed',
        numeric: true,
        cell: (d) => rupees(d.agreedNetPayout),
      },
      {
        key: 'action',
        header: 'Action',
        cell: (d) =>
          d.attachedCount >= d.qty ? (
            <span className="text-body-sm text-ink-3">Attached</span>
          ) : ATTACHABLE.has(po?.status ?? '') ? (
            <Button variant="secondary" onClick={() => setAttaching(d)}>
              Attach device
            </Button>
          ) : po?.status === 'RAISED' ? (
            <Button
              variant="secondary"
              disabledReason="Accept this purchase order first. Attaching a machine is available after you accept."
            >
              Attach device
            </Button>
          ) : (
            <span className="text-body-sm text-ink-4">Not attachable</span>
          ),
      },
    ],
    [po?.status],
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
  const remaining = po.demands.reduce((n, d) => n + (d.qty - d.attachedCount), 0);

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

      <div className="grid [&>*]:min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <h2 className="text-h3 text-ink">The machines on this order</h2>
          <p className="mt-3 max-w-prose text-body-sm text-ink-2">
            Attach a machine of that SKU and grade from your listings for each quantity. Serials are
            not shown here — they appear when you pick the device.
          </p>

          <Board className="mt-4" tableMinWidth={720}>
            <DataBoard
              caption={`${po.units} ${po.units === 1 ? 'machine' : 'machines'} on ${po.poNumber}.`}
              columns={columns}
              rows={po.demands}
              rowKey={(d) => `${d.skuId}:${d.gradeAtPo}`}
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
              ? remaining > 0
                ? `Attach the remaining ${remaining} ${remaining === 1 ? 'machine' : 'machines'} from your listings.`
                : 'Every machine on this order has been attached.'
              : 'Accepting tells us you will produce these machines. After you accept, attach each one from your listings.'
          }
          footnote={
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

          {!settled && (
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
          )}
          {/* Pick list is stood down while attach is how a machine is named. */}
        </SidePanel>
      </div>

      {attaching && (
        <AttachModal
          poId={po.poId}
          demand={attaching}
          canAttach={canAcknowledge}
          onClose={() => setAttaching(null)}
          onAttached={(next) => {
            setAccepted(next);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
