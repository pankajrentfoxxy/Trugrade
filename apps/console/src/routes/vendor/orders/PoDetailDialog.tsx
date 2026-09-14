import * as React from 'react';
import {
  Button,
  EmptyState,
  GradeBadge,
  Modal,
  Skeleton,
  StatusPill,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { useAuth } from '../../../lib/auth';
import { useResource } from '../../../lib/useResource';
import {
  API,
  PO_LINE_REJECTION_REASONS,
  humanise,
  onDate,
  postJson,
  rupees,
  type AttachableUnit,
  type PoLineGroup,
  type PurchaseOrderDetail,
} from '../api';

type LineDraft = { accept: boolean; reason: string };

function gradeLabel(g: string): string {
  return g.replace('_PLUS', '+');
}

function submitLabel(groups: PoLineGroup[], drafts: Map<string, LineDraft>): string {
  let accept = 0;
  let reject = 0;
  for (const g of groups) {
    const d = drafts.get(g.lineIds[0]!);
    if (!d) continue;
    if (d.accept) accept += g.qty;
    else reject += g.qty;
  }
  const total = accept + reject;
  if (reject === 0) return `Accept all ${total} line${total === 1 ? '' : 's'}`;
  if (accept === 0) return 'Reject the whole order';
  return `Accept ${accept}, reject ${reject}`;
}

function draftsValid(groups: PoLineGroup[], drafts: Map<string, LineDraft>): boolean {
  for (const g of groups) {
    const d = drafts.get(g.lineIds[0]!);
    if (!d) return false;
    if (!d.accept && !d.reason) return false;
  }
  return groups.length > 0;
}

function expandDrafts(groups: PoLineGroup[], drafts: Map<string, LineDraft>) {
  return groups.flatMap((g) => {
    const d = drafts.get(g.lineIds[0]!)!;
    return g.lineIds.map((lineId) => ({
      lineId,
      accept: d.accept,
      reason: d.accept ? undefined : d.reason,
    }));
  });
}

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
  const [drafts, setDrafts] = React.useState<Map<string, LineDraft>>(new Map());
  const [attachGroup, setAttachGroup] = React.useState<PoLineGroup | null>(null);
  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [carrier, setCarrier] = React.useState('');
  const [awb, setAwb] = React.useState('');

  const { data, error: loadError } = useResource<PurchaseOrderDetail>(
    `${API.purchaseOrder(poId)}?_=${reloadKey}`,
    'Purchase order unavailable',
  );

  React.useEffect(() => {
    if (!data || data.status !== 'RAISED') return;
    const next = new Map<string, LineDraft>();
    for (const g of data.lineGroups) {
      next.set(g.lineIds[0]!, { accept: true, reason: '' });
    }
    setDrafts(next);
  }, [data?.poId, data?.status, reloadKey]);

  const canAck = principal?.permissions.includes('procurement.po.acknowledge') ?? false;
  const canRespond = canAck && data?.status === 'RAISED';
  const canAttach =
    canAck && data != null && ['ACKNOWLEDGED', 'PARTIAL'].includes(data.status);
  /** Empty when dispatch is allowed — it gates the button and names the block. */
  const dispatchBlockedReason =
    data && ['ACKNOWLEDGED', 'PARTIAL'].includes(data.status)
      ? (() => {
          const missing = data.lineGroups
            .filter((g) => g.lineStatus === 'ACCEPTED')
            .reduce((n, g) => n + Math.max(0, g.qty - g.attachedCount), 0);
          if (missing > 0) {
            return `${missing} accepted machine${missing === 1 ? '' : 's'} still need${missing === 1 ? 's' : ''} a serial attached.`;
          }
          return '';
        })()
      : '';

  async function submitResponse(): Promise<void> {
    if (!data || !draftsValid(data.lineGroups, drafts)) return;
    setBusy(true);
    setError(null);
    try {
      await postJson<PurchaseOrderDetail>(API.respondPo(poId), {
        lines: expandDrafts(data.lineGroups, drafts),
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

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-label text-ink-3">
                    <th className="py-2 pr-3">Machine</th>
                    <th className="py-2 pr-3">Grade</th>
                    <th className="py-2 pr-3 text-right">Qty</th>
                    <th className="py-2 pr-3 text-right">Unit price</th>
                    <th className="py-2 pr-3 text-right">Line total</th>
                    <th className="py-2 pr-3">Serials</th>
                    <th className="py-2">Response</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lineGroups.map((g) => {
                    const key = g.lineIds[0]!;
                    const draft = drafts.get(key);
                    const rejected = g.lineStatus === 'REJECTED' || draft?.accept === false;
                    return (
                      <tr
                        key={key}
                        className={`border-b border-rule ${rejected ? 'bg-fail-wash' : ''}`}
                      >
                        <td className="py-3 pr-3">
                          <p className="text-ink">{g.title ?? g.skuCode ?? 'Unknown model'}</p>
                          <p className="text-label text-ink-3">{g.specSummary}</p>
                        </td>
                        <td className="py-3 pr-3">
                          <GradeBadge grade={g.gradeAtPo as Grade} />
                        </td>
                        <td className="py-3 pr-3 text-right font-mono tnum">{g.qty}</td>
                        <td className="py-3 pr-3 text-right font-mono tnum">{rupees(g.unitPrice)}</td>
                        <td className="py-3 pr-3 text-right font-mono tnum">{rupees(g.lineTotal)}</td>
                        <td className="py-3 pr-3 font-mono tnum text-ink-2">
                          {g.attachedCount}/{g.qty}
                          {g.serials.map((s) => (
                            <span key={s.unitId} className="block text-ink">
                              {s.serialNumber ?? '—'}
                            </span>
                          ))}
                        </td>
                        <td className="py-3">
                          {canRespond && draft ? (
                            <div className="flex flex-col gap-2">
                              <div className="inline-flex overflow-hidden rounded border border-rule">
                                <button
                                  type="button"
                                  className={`px-3 py-1 text-label ${draft.accept ? 'bg-acc-wash text-acc-ink' : 'text-ink-2'}`}
                                  onClick={() =>
                                    setDrafts((m) => new Map(m).set(key, { accept: true, reason: '' }))
                                  }
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  className={`px-3 py-1 text-label ${!draft.accept ? 'bg-fail-wash text-fail' : 'text-ink-2'}`}
                                  onClick={() =>
                                    setDrafts((m) =>
                                      new Map(m).set(key, { accept: false, reason: draft.reason }),
                                    )
                                  }
                                >
                                  Reject
                                </button>
                              </div>
                              {!draft.accept && (
                                <select
                                  className="rounded border border-rule bg-sheet px-2 py-1 text-body-sm"
                                  value={draft.reason}
                                  onChange={(e) =>
                                    setDrafts((m) =>
                                      new Map(m).set(key, { accept: false, reason: e.target.value }),
                                    )
                                  }
                                >
                                  <option value="">Pick a reason…</option>
                                  {PO_LINE_REJECTION_REASONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                      {r.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ) : (
                            <span className="text-label text-ink-3">{humanise(g.lineStatus)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!canAck && data.status === 'RAISED' && (
              <p className="text-body-sm text-ink-3">
                Your role cannot accept purchase orders. Ask the account owner or operations manager.
              </p>
            )}

            <div className="rounded border border-rule bg-sheet p-4">
              <dl className="grid gap-2 text-body-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-2">Order total ({data.units} lines)</dt>
                  <dd className="font-mono tnum text-ink">{rupees(data.totals.orderTotal)}</dd>
                </div>
                {Number(data.totals.rejectedTotal) > 0 && (
                  <div className="flex justify-between gap-4 text-fail">
                    <dt>Rejected lines</dt>
                    <dd className="font-mono tnum">− {rupees(data.totals.rejectedTotal)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-2">TDS deducted</dt>
                  <dd className="font-mono tnum text-ink">{rupees(data.totals.tdsAmount)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-rule pt-2">
                  <dt className="text-ink">You are owed if you accept</dt>
                  <dd className="font-mono tnum text-ink">{rupees(data.totals.owedIfAccepted)}</dd>
                </div>
              </dl>
            </div>

            {canRespond && (
              <div className="flex justify-end">
                <Button
                  loading={busy}
                  disabledReason={
                    !draftsValid(data.lineGroups, drafts)
                      ? 'Every rejected line needs a reason before you submit.'
                      : ''
                  }
                  onClick={() => void submitResponse()}
                >
                  {submitLabel(data.lineGroups, drafts)}
                </Button>
              </div>
            )}

            {canAttach && (
              <section>
                <h3 className="mb-2 text-body font-medium text-ink">Serial numbers</h3>
                <ul className="flex list-none flex-col gap-2 p-0">
                  {data.lineGroups
                    .filter((g) => g.lineStatus === 'ACCEPTED')
                    .map((g) => (
                      <li
                        key={g.lineIds[0]}
                        className="flex flex-wrap items-center justify-between gap-3 rounded border border-rule px-4 py-3"
                      >
                        <div>
                          <p className="text-ink">{g.title}</p>
                          <p className="font-mono tnum text-ink-2">
                            {g.attachedCount} of {g.qty} attached
                          </p>
                        </div>
                        {g.attachedCount < g.qty && (
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
  const needed = group.qty - group.attachedCount;

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
        setPickError(`This line needs exactly ${needed} machine${needed === 1 ? '' : 's'}. Deselect one first.`);
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
        <EmptyState title="No sealed machines match" body="List matching stock at this facility first." />
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
