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
import {
  asMoneyString,
  draftsComplete,
  emptyDrafts,
  lineError,
  lineKey,
  owedFor,
  submitLabel,
  tdsOn,
  toPayload,
} from './orders/availability';

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
  PARTIAL: 'warn',
  REJECTED: 'neutral',
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

const ATTACHABLE = new Set(['ACKNOWLEDGED', 'PARTIAL']);

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

  // One box per line, empty until the vendor types. Empty is "not answered",
  // which is neither 0 nor "all", and the button says so until every box is.
  const [drafts, setDrafts] = React.useState<Map<string, string>>(new Map());
  React.useEffect(() => {
    if (!data || data.status !== 'RAISED') return;
    setDrafts(emptyDrafts(data.lineGroups));
  }, [data?.poId, data?.status]);

  async function confirmAvailability(): Promise<void> {
    if (!po || !draftsComplete(po.lineGroups, drafts)) return;
    setBusy(true);
    setActionError(null);
    try {
      setAccepted(
        await postJson<PurchaseOrderDetail>(API.confirmPoAvailability(poId), {
          lines: toPayload(po.lineGroups, drafts),
        }),
      );
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
              disabledReason="Confirm what you can supply first. Attaching a machine is available after you confirm."
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
        <Breadcrumb
          items={[{ label: 'Purchase orders', href: '/vendor/orders' }, { label: '…' }]}
        />
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
            label: 'Answered',
            value: po.acknowledgedAt ? (
              onDate(po.acknowledgedAt)
            ) : (
              <NotMeasured why="You have not answered this purchase order yet" label="Not yet" />
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
          title={settled ? 'You have answered this order' : 'Confirm what you can supply'}
          description={
            settled
              ? remaining > 0
                ? `Attach the remaining ${remaining} ${remaining === 1 ? 'machine' : 'machines'} from your listings.`
                : 'Every machine on this order has been attached.'
              : 'Enter how many of each line you can supply — 0 for a line you cannot. The buyer sees the quantity you confirm on their order. After you confirm, attach each machine from your listings.'
          }
          footnote={
            settled ? undefined : po.acknowledgeBy ? (
              <>
                Answer by <span className="font-mono tnum">{onDate(po.acknowledgeBy)}</span>.
              </>
            ) : (
              <span className="text-ink-4">
                No deadline has been set for answering purchase orders on this platform, so there is
                none to show and none to miss.
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
            <div className="flex flex-col gap-4">
              <ul className="flex list-none flex-col gap-3 p-0">
                {po.lineGroups.map((g) => {
                  const key = lineKey(g);
                  const raw = drafts.get(key) ?? '';
                  const problem = lineError(raw, g.qty);
                  const inputId = `po-avail-${key}`;
                  return (
                    <li key={key} className="flex flex-col gap-1">
                      <label htmlFor={inputId} className="text-body-sm text-ink">
                        {g.title ?? g.skuCode ?? 'Unknown model'}{' '}
                        <span className="text-ink-3">
                          · Grade {g.gradeAtPo.replace('_PLUS', '+')} · asked for{' '}
                          <span className="font-mono tnum">{g.qty}</span>
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={inputId}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={g.qty}
                          step={1}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? `${inputId}-error` : undefined}
                          className="w-20 rounded border border-rule bg-sheet px-3 py-2 font-mono tnum text-ink"
                          placeholder={`0–${g.qty}`}
                          value={raw}
                          disabled={!canAcknowledge}
                          onChange={(e) => setDrafts((m) => new Map(m).set(key, e.target.value))}
                        />
                        <span className="font-mono tnum text-ink-2">of {g.qty}</span>
                      </div>
                      {problem && (
                        <p id={`${inputId}-error`} className="text-body-sm text-fail" role="alert">
                          {problem}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {draftsComplete(po.lineGroups, drafts) && (
                <Datum label="You are owed for what you confirmed, after TDS">
                  {rupees(
                    asMoneyString(
                      owedFor(po.lineGroups, drafts).sub(
                        tdsOn(owedFor(po.lineGroups, drafts), po.tdsRatePct),
                      ),
                    ),
                  )}
                </Datum>
              )}

              <Button
                variant="primary"
                loading={busy}
                disabledReason={
                  !canAcknowledge
                    ? 'Answering a purchase order needs the Operations, Admin or Owner role. Ask an owner in your organisation.'
                    : draftsComplete(po.lineGroups, drafts)
                      ? ''
                      : 'Enter the quantity available for every line first.'
                }
                onClick={() => void confirmAvailability()}
              >
                {submitLabel(po.lineGroups, drafts)}
              </Button>
            </div>
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
