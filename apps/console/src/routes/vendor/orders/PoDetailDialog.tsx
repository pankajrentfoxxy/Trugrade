import * as React from 'react';
import {
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  Modal,
  Skeleton,
  StatusPill,
  type Column,
} from '@trugrade/ui';
import { Money, type Grade } from '@trugrade/contracts';
import { useAuth } from '../../../lib/auth';
import { Board, NotMeasured } from '../../../lib/controls';
import { useResource } from '../../../lib/useResource';
import {
  API,
  humanise,
  onDate,
  postJson,
  rupees,
  type AttachableUnit,
  type PoLineGroup,
  type PurchaseOrderDetail,
} from '../api';
import {
  asMoneyString,
  draftsComplete,
  emptyDrafts,
  lineError,
  lineKey,
  owedFor,
  submitLabel,
  tally,
  tdsOn,
  toPayload,
} from './availability';

/**
 * One purchase order, in a dialog over the board.
 *
 * The vendor's answer is a quantity per line — "of the 3 you asked for, I can
 * supply 2" — not an accept or a reject. Every box must be answered before the
 * one button enables, 0 is a legitimate answer, and the buyer sees the
 * confirmed quantity on their order the moment it is saved.
 */

function gradeLabel(g: string): string {
  return g.replace('_PLUS', '+');
}

/** What the vendor's answer on one line reads as, once given. */
function answerLabel(status: PoLineGroup['lineStatus']): string {
  switch (status) {
    case 'ACCEPTED':
      return 'Confirmed';
    case 'REJECTED':
      return 'Not available';
    case 'MIXED':
      return 'Partly available';
    default:
      return humanise(status);
  }
}

/** A line the vendor confirmed at least one machine on — the ones that still need serials. */
const hasConfirmedMachines = (g: PoLineGroup): boolean =>
  g.lineStatus === 'ACCEPTED' || g.lineStatus === 'MIXED';

/** How many machines this line still owes a serial. Confirmed count, never the count asked for. */
const confirmedQty = (g: PoLineGroup): number => g.qtyAvailable ?? g.qty;

export function PoDetailDialog({
  poId,
  open,
  onClose,
  onUpdated,
}: {
  poId: string;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}): React.JSX.Element | null {
  const { principal } = useAuth();
  const [reloadKey, setReloadKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Map<string, string>>(new Map());
  const [attachGroup, setAttachGroup] = React.useState<PoLineGroup | null>(null);
  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [carrier, setCarrier] = React.useState('');
  const [awb, setAwb] = React.useState('');

  const { data, error: loadError } = useResource<PurchaseOrderDetail>(
    `${API.purchaseOrder(poId)}?_=${reloadKey}`,
    'Purchase order unavailable',
  );

  // Every box starts empty. An empty box is "not answered yet", which is a
  // different fact from 0 and from "all of them", and the button says so.
  React.useEffect(() => {
    if (!data || data.status !== 'RAISED') return;
    setDrafts(emptyDrafts(data.lineGroups));
  }, [data?.poId, data?.status, reloadKey]);

  const canAck = principal?.permissions.includes('procurement.po.acknowledge') ?? false;
  const canRespond = canAck && data?.status === 'RAISED';

  const setDraft = (key: string, raw: string): void => setDrafts((m) => new Map(m).set(key, raw));

  const lineColumns: ReadonlyArray<Column<PoLineGroup>> = [
    {
      key: 'machine',
      header: 'Machine',
      cell: (g) => (
        <>
          <p className="text-ink">{g.title ?? g.skuCode ?? 'Unknown model'}</p>
          <p className="text-label text-ink-3">{g.specSummary}</p>
        </>
      ),
    },
    { key: 'grade', header: 'Grade', cell: (g) => <GradeBadge grade={g.gradeAtPo as Grade} /> },
    { key: 'qty', header: 'Qty', numeric: true, cell: (g) => g.qty },
    { key: 'unit', header: 'Unit price', numeric: true, cell: (g) => rupees(g.unitPrice) },
    { key: 'total', header: 'Line total', numeric: true, cell: (g) => rupees(g.lineTotal) },
    {
      key: 'serials',
      header: 'Serials',
      cell: (g) => (
        <span className="font-mono tnum text-ink-2">
          {g.attachedCount} of {g.qty} attached
          {g.serials.map((sn) => (
            <span key={sn.unitId} className="block text-ink">
              {sn.serialNumber ?? (
                <NotMeasured label="Not recorded" why="No serial on this unit yet." />
              )}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      cell: (g) => {
        const key = lineKey(g);
        if (canRespond) {
          const raw = drafts.get(key) ?? '';
          const problem = lineError(raw, g.qty);
          const inputId = `avail-${key}`;
          return (
            <div className="flex min-w-[8.5rem] flex-col gap-1">
              <div className="flex items-center gap-2 whitespace-nowrap">
                <input
                  id={inputId}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={g.qty}
                  step={1}
                  aria-label={`Quantity available of ${g.title ?? g.skuCode ?? 'this model'}, grade ${gradeLabel(g.gradeAtPo)}`}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? `${inputId}-error` : undefined}
                  className="w-20 rounded border border-rule bg-sheet px-3 py-2 font-mono tnum text-ink"
                  placeholder={`0–${g.qty}`}
                  value={raw}
                  onChange={(e) => setDraft(key, e.target.value)}
                />
                <span className="font-mono tnum text-ink-2">of {g.qty}</span>
              </div>
              {problem && (
                <p
                  id={`${inputId}-error`}
                  className="whitespace-normal text-body-sm text-fail"
                  role="alert"
                >
                  {problem}
                </p>
              )}
            </div>
          );
        }
        if (g.qtyAvailable === null) {
          return (
            <NotMeasured
              label="Not confirmed"
              why={
                canAck
                  ? 'This line has not been answered yet.'
                  : 'Your role cannot answer purchase orders. Ask the account owner or operations manager.'
              }
            />
          );
        }
        return (
          <span className="flex flex-col">
            <span className="font-mono tnum text-ink">
              {g.qtyAvailable} of {g.qty}
            </span>
            <span className="text-label text-ink-3">{answerLabel(g.lineStatus)}</span>
          </span>
        );
      },
    },
  ];
  const canAttach = canAck && data != null && ['ACKNOWLEDGED', 'PARTIAL'].includes(data.status);
  /** Empty when dispatch is allowed — it gates the button and names the block. */
  const dispatchBlockedReason =
    data && ['ACKNOWLEDGED', 'PARTIAL'].includes(data.status)
      ? (() => {
          const missing = data.lineGroups
            .filter(hasConfirmedMachines)
            .reduce((n, g) => n + Math.max(0, confirmedQty(g) - g.attachedCount), 0);
          if (missing > 0) {
            return `${missing} confirmed machine${missing === 1 ? '' : 's'} still need${missing === 1 ? 's' : ''} a serial attached.`;
          }
          return '';
        })()
      : '';

  async function submitAvailability(): Promise<void> {
    if (!data || !draftsComplete(data.lineGroups, drafts)) return;
    setBusy(true);
    setError(null);
    try {
      await postJson<PurchaseOrderDetail>(API.confirmPoAvailability(poId), {
        lines: toPayload(data.lineGroups, drafts),
      });
      setReloadKey((k) => k + 1);
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitDispatch(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await postJson<PurchaseOrderDetail>(API.dispatchPo(poId), { carrier, awb });
      setDispatchOpen(false);
      setReloadKey((k) => k + 1);
      onUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const complete = data ? draftsComplete(data.lineGroups, drafts) : false;
  const owed = data ? owedFor(data.lineGroups, drafts) : null;
  const counts = data ? tally(data.lineGroups, drafts) : null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={data ? data.poNumber : 'Purchase order'}
        description={
          data
            ? `${data.modelCount} model${data.modelCount === 1 ? '' : 's'}, ${data.units} machine${data.units === 1 ? '' : 's'} · raised ${onDate(data.raisedAt)}`
            : undefined
        }
        size="lg"
      >
        {loadError && (
          <p className="text-body-sm text-fail" role="alert">
            {loadError}
          </p>
        )}
        {error && (
          <p className="mb-3 text-body-sm text-fail" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          <Skeleton lines={8} />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-label text-ink-3">Deliver to</p>
                <p className="text-body text-ink">
                  {data.deliverTo
                    ? `${data.deliverTo.city}, ${data.deliverTo.state}`
                    : 'Not resolved'}
                </p>
              </div>
              <div>
                <p className="text-label text-ink-3">Status</p>
                <StatusPill tone="processing" label={humanise(data.status)} />
              </div>
              <div>
                <p className="text-label text-ink-3">Payment terms</p>
                <p className="font-mono tnum text-ink">{data.termsDays} days</p>
              </div>
              <div>
                <p className="text-label text-ink-3">Consignment</p>
                <p className="font-mono tnum text-ink">
                  {data.consignmentAwb
                    ? `${data.consignmentCarrier ?? 'Courier'} · ${data.consignmentAwb}`
                    : 'Not dispatched'}
                </p>
              </div>
            </div>

            {canRespond && (
              <p className="text-body-sm text-ink-2">
                Enter how many of each line you can supply. Enter{' '}
                <span className="font-mono tnum">0</span> for a line you cannot supply. The buyer
                sees the quantity you confirm on their order.
              </p>
            )}

            <Board tableMinWidth={720}>
              <DataBoard
                caption={`${data.lineGroups.length} ${data.lineGroups.length === 1 ? 'line' : 'lines'} on ${data.poNumber}.`}
                columns={lineColumns}
                rows={data.lineGroups}
                rowKey={(g) => g.lineIds.join(',')}
              />
            </Board>

            {!canAck && data.status === 'RAISED' && (
              <p className="text-body-sm text-ink-3">
                Your role cannot answer purchase orders. Ask the account owner or operations
                manager.
              </p>
            )}

            <div className="rounded border border-rule bg-sheet p-4">
              <dl className="grid gap-2 text-body-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-2">Order total ({data.units} lines)</dt>
                  <dd className="font-mono tnum text-ink">{rupees(data.totals.orderTotal)}</dd>
                </div>
                {canRespond && owed && counts ? (
                  <>
                    {complete && counts.confirmed < counts.asked && (
                      <div className="flex justify-between gap-4 text-ink-2">
                        <dt>
                          Not available ({counts.asked - counts.confirmed} of {counts.asked})
                        </dt>
                        <dd className="font-mono tnum">
                          − {rupees(asMoneyString(Money.parse(data.totals.orderTotal).sub(owed)))}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-2">
                        TDS deducted at <span className="font-mono tnum">{data.tdsRatePct}%</span>
                      </dt>
                      <dd className="font-mono tnum text-ink">
                        {complete ? rupees(asMoneyString(tdsOn(owed, data.tdsRatePct))) : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-rule pt-2">
                      <dt className="text-ink">
                        {complete
                          ? `You are owed for ${counts.confirmed} of ${counts.asked}`
                          : 'You are owed for what you confirm'}
                      </dt>
                      <dd className="font-mono tnum text-ink">
                        {complete
                          ? rupees(asMoneyString(owed.sub(tdsOn(owed, data.tdsRatePct))))
                          : '—'}
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    {Number(data.totals.rejectedTotal) > 0 && (
                      <div className="flex justify-between gap-4 text-ink-2">
                        <dt>Not available</dt>
                        <dd className="font-mono tnum">− {rupees(data.totals.rejectedTotal)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-2">TDS deducted</dt>
                      <dd className="font-mono tnum text-ink">{rupees(data.totals.tdsAmount)}</dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-rule pt-2">
                      <dt className="text-ink">
                        {data.status === 'RAISED'
                          ? 'You are owed if you confirm all'
                          : 'You are owed'}
                      </dt>
                      <dd className="font-mono tnum text-ink">
                        {rupees(data.totals.owedIfAccepted)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </div>

            {canRespond && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  loading={busy}
                  disabledReason={
                    complete ? '' : 'Enter the quantity available for every line first.'
                  }
                  onClick={() => void submitAvailability()}
                >
                  {submitLabel(data.lineGroups, drafts)}
                </Button>
              </div>
            )}

            {canAttach && (
              <section>
                <h3 className="mb-2 text-body font-medium text-ink">Serial numbers</h3>
                <ul className="flex list-none flex-col gap-2 p-0">
                  {data.lineGroups.filter(hasConfirmedMachines).map((g) => (
                    <li
                      key={g.lineIds[0]}
                      className="flex flex-wrap items-center justify-between gap-3 rounded border border-rule px-4 py-3"
                    >
                      <div>
                        <p className="text-ink">{g.title}</p>
                        <p className="font-mono tnum text-ink-2">
                          {g.attachedCount} of {confirmedQty(g)} attached
                        </p>
                      </div>
                      {g.attachedCount < confirmedQty(g) && (
                        <Button variant="secondary" onClick={() => setAttachGroup(g)}>
                          Attach
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {canAck && ['ACKNOWLEDGED', 'PARTIAL'].includes(data.status) && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
                <p className="text-body-sm text-ink-3">
                  {dispatchBlockedReason || 'Ready to mark dispatched.'}
                </p>
                <Button
                  disabledReason={dispatchBlockedReason}
                  onClick={() => setDispatchOpen(true)}
                >
                  Mark dispatched
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {attachGroup && data && (
        <AttachPicker
          poId={poId}
          group={attachGroup}
          onClose={() => setAttachGroup(null)}
          onAttached={() => {
            setAttachGroup(null);
            setReloadKey((k) => k + 1);
            onUpdated();
          }}
        />
      )}

      {dispatchOpen && data && (
        <Modal
          open
          onClose={() => setDispatchOpen(false)}
          title="Mark dispatched"
          description="Courier and AWB appear on the order once saved."
          size="md"
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-body-sm">
              <span className="text-label text-ink-3">Courier</span>
              <input
                className="rounded border border-rule bg-sheet px-3 py-2"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-body-sm">
              <span className="text-label text-ink-3">AWB</span>
              <input
                className="rounded border border-rule bg-sheet px-3 py-2 font-mono tnum"
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDispatchOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabledReason={!carrier.trim() || !awb.trim() ? 'Enter courier and AWB.' : ''}
                onClick={() => void submitDispatch()}
              >
                Confirm dispatch
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * A unit shows up here `RESERVED` when it is the exact machine our system
 * committed at the moment the buyer's order was placed — see
 * `hold.service.ts` / `order-transaction.service.ts`. The attachable-units
 * query only ever returns a `RESERVED` row when it is reserved for *this*
 * order (`reservedUnitIdsForOrder`), so it can never be someone else's stock
 * leaking in. It is the machine the vendor is expected to confirm, not a
 * blocker — which is why it is pre-selected below rather than merely shown.
 */
function unitStatusPill(status: string): React.JSX.Element {
  return status === 'RESERVED' ? (
    <StatusPill tone="processing" label="Reserved for this order" />
  ) : (
    <StatusPill tone="info" label="Available" />
  );
}

function AttachPicker({
  poId,
  group,
  onClose,
  onAttached,
}: {
  poId: string;
  group: PoLineGroup;
  onClose: () => void;
  onAttached: () => void;
}): React.JSX.Element {
  const { data, error } = useResource<AttachableUnit[]>(
    API.attachableUnits(poId, group.skuId, group.gradeAtPo),
    'Matching machines unavailable',
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [pickError, setPickError] = React.useState<string | null>(null);
  const needed = confirmedQty(group) - group.attachedCount;

  // The machines already reserved for this exact order are the ones the
  // vendor almost always wants — pre-check them so the normal case is
  // "confirm and go" rather than "guess which of these is the right one".
  // Guarded on `selected.size === 0` so a reopened picker never clobbers a
  // choice the vendor already made.
  React.useEffect(() => {
    if (!data || selected.size > 0) return;
    const reserved = data.filter((u) => u.status === 'RESERVED').slice(0, needed);
    if (reserved.length > 0) setSelected(new Set(reserved.map((u) => u.unitId)));
    // `needed` is read but intentionally not a dependency: it is constant for
    // the life of this dialog (derived from `group`, not restated fetches),
    // and this effect's own job is "run once when the fetch lands", not "run
    // again whenever the demand count is recomputed".
  }, [data]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return data ?? [];
    return data.filter((u) => u.serialNumber.toLowerCase().includes(q));
  }, [data, query]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= needed) {
        setPickError(
          `This line needs exactly ${needed} machine${needed === 1 ? '' : 's'}. Deselect one first.`,
        );
        return prev;
      } else next.add(id);
      setPickError(null);
      return next;
    });
  }

  async function confirm(): Promise<void> {
    if (selected.size !== needed) {
      setPickError(`Select exactly ${needed} machine${needed === 1 ? '' : 's'}.`);
      return;
    }
    setBusy(true);
    try {
      for (const unitId of selected) {
        await postJson(API.attachPoUnit(poId), {
          skuId: group.skuId,
          grade: group.gradeAtPo,
          unitId,
        });
      }
      onAttached();
    } catch (e) {
      setPickError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Attach serials"
      description={`${group.title ?? 'Machine'} · Grade ${gradeLabel(group.gradeAtPo)} · pick ${needed}`}
      size="lg"
    >
      {pickError && (
        <p className="mb-3 text-body-sm text-fail" role="alert">
          {pickError}
        </p>
      )}
      {error ? (
        <p className="text-body-sm text-fail">{error}</p>
      ) : !data ? (
        <Skeleton lines={4} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No sealed machines match"
          body="List matching stock at this facility first."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-body-sm">
            <span className="text-label text-ink-3">Search serials</span>
            <input
              type="search"
              className="rounded border border-rule bg-sheet px-3 py-2 font-mono tnum"
              placeholder="Type part of a serial number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <p className="text-body-sm text-ink-2">
            <span className="font-mono tnum text-ink">{selected.size}</span> of{' '}
            <span className="font-mono tnum">{needed}</span> selected
          </p>

          {filtered.length === 0 ? (
            <p className="text-body-sm text-ink-3">No serial matches “{query.trim()}”.</p>
          ) : (
            <ul className="flex max-h-[min(24rem,50vh)] list-none flex-col gap-2 overflow-y-auto p-0">
              {filtered.map((u) => (
                <li
                  key={u.unitId}
                  className={`flex cursor-pointer items-center gap-3 rounded border px-4 py-3 ${
                    selected.has(u.unitId) ? 'border-acc bg-acc-wash' : 'border-rule bg-sheet'
                  }`}
                  onClick={() => toggle(u.unitId)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(u.unitId)}
                    onChange={() => toggle(u.unitId)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select serial ${u.serialNumber}`}
                    className="h-4 w-4 shrink-0 accent-acc"
                  />
                  <span className="flex-1 font-mono tnum text-ink">{u.serialNumber}</span>
                  {unitStatusPill(u.status)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button loading={busy} onClick={() => void confirm()}>
          Attach {selected.size} of {needed}
        </Button>
      </div>
    </Modal>
  );
}
