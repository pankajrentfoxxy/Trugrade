import { useState } from 'react';
import { Button, Modal } from '@trugrade/ui';
import { usePrincipal, apiFetch } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import { inr, when, type ShipmentRow } from './api';

/** Archetype C — record, in a drawer. */

interface ShipmentDetail {
  id: string;
  awb: string | null;
  status: string;
  carrier: string | null;
  orderNumber: string | null;
  routeType: string | null;
  quotedFreight: string | null;
  freightCost: string | null;
  sealId: string | null;
  sealVerifiedAt: string | null;
  podKey: string | null;
  labelKey: string | null;
  chosenCarrier: string | null;
  excluded: Array<{ carrier: string; reason: string }>;
  bookingError: string | null;
  tracking: Array<{ code: string; description: string | null; location: string | null; at: string }>;
  attempts: Array<{ attemptNo: number; outcome: string; reason: string | null; at: string }>;
  custody: Array<{ scan: string; from: string; to: string; at: string }>;
}

export function ShipmentRecord({ shipment }: { shipment: ShipmentRow }): React.JSX.Element {
  const [reloadToken, setReload] = useState(0);
  const { data, error } = useResource<ShipmentDetail>(
    `/api/ops/shipments/${encodeURIComponent(shipment.id)}`,
    'We could not load this shipment.',
    reloadToken,
  );

  if (error) return <p className="text-body-sm text-fail">{error}</p>;
  if (!data) return <p className="text-body-sm text-ink-3">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      {data.bookingError && (
        <p className="rounded border border-fail-line bg-fail-wash px-3 py-2 text-body-sm text-fail">
          {data.bookingError}
        </p>
      )}

      <Facts
        items={[
          ['Carrier', data.carrier ?? '—'],
          ['Route', data.routeType ?? '—'],
          ['Quoted', inr(data.quotedFreight)],
          ['Billed', data.freightCost ? inr(data.freightCost) : <Unmeasured label="Not billed" />],
        ]}
      />

      {/* Why this carrier and not the others. Recorded at booking, because a
          rate card edited since would give a different answer today. */}
      <Panel title="Carrier choice">
        <p className="text-body-sm text-ink-2">
          Chosen <strong className="text-ink">{data.chosenCarrier ?? data.carrier ?? '—'}</strong>
        </p>
        {data.excluded.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {data.excluded.map((x) => (
              <li key={x.carrier} className="flex gap-3 text-body-sm">
                <span className="w-24 shrink-0 text-ink-3">{x.carrier}</span>
                <span className="text-ink-2">{x.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-ink-4">No other carrier was in scope for this lane.</p>
        )}
      </Panel>

      <Panel title="Seal">
        {data.sealId ? (
          <div className="flex flex-wrap items-center gap-4">
            <Id>{data.sealId}</Id>
            <StatusDot
              tone={data.sealVerifiedAt ? 'ok' : 'idle'}
              label={data.sealVerifiedAt ? `Checked ${when(data.sealVerifiedAt)}` : 'Unchecked'}
            />
          </div>
        ) : (
          <Unmeasured label="No seal on this consignment" />
        )}
        {data.custody.length > 0 && (
          <ol className="flex flex-col gap-1">
            {data.custody.map((c, i) => (
              <li key={`${c.at}-${i}`} className="flex gap-3 text-body-sm">
                <span className="mono w-32 shrink-0 text-ink-3">{when(c.at)}</span>
                <span className="text-ink-2">
                  {c.scan} · {c.from} → {c.to}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Tracking">
        {data.tracking.length === 0 ? (
          <p className="text-body-sm text-ink-4">
            Nothing from the carrier yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {data.tracking.map((t, i) => (
              <li key={`${t.at}-${i}`} className="flex gap-3 text-body-sm">
                <span className="mono w-32 shrink-0 text-ink-3">{when(t.at)}</span>
                <span className="text-ink-2">
                  {t.description ?? t.code}
                  {t.location && <span className="text-ink-4"> · {t.location}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {data.attempts.length > 0 && (
        <Panel title="Delivery attempts">
          <ol className="flex flex-col gap-1">
            {data.attempts.map((a) => (
              <li key={a.attemptNo} className="flex gap-3 text-body-sm">
                <span className="mono w-8 shrink-0 text-ink-3">#{a.attemptNo}</span>
                <StatusDot tone={toneOf(a.outcome)} label={word(a.outcome)} />
                <span className="text-ink-2">{a.reason ?? ''}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Proof of delivery">
        {data.podKey ? (
          <Id>{data.podKey}</Id>
        ) : (
          <Unmeasured label="No proof captured" />
        )}
      </Panel>

      <RecordDelivery
        orderNumber={data.orderNumber}
        delivered={data.status === 'DELIVERED'}
        onDone={() => setReload((n) => n + 1)}
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ items }: { items: Array<[string, React.ReactNode]> }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
          <dd className="mono tnum text-body-sm text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The escape hatch for a carrier whose webhook never fires.
 *
 * `POST /ops/orders/:orderNumber/delivery` has existed with no caller at all —
 * the one manual override in the delivery path, reachable only with curl. It is
 * here, labelled as an override, requiring a reason, and it says out loud that
 * it starts the seven-day return window, because that is the consequence an
 * operator will not otherwise connect to the button they just pressed.
 */
function RecordDelivery({
  orderNumber,
  delivered,
  onDone,
}: {
  orderNumber: string | null;
  delivered: boolean;
  onDone: () => void;
}): React.JSX.Element {
  const principal = usePrincipal();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const held = principal?.permissions.includes('ordering.any.override') ?? false;
  if (!held || !orderNumber) return <></>;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      const res = await apiFetch(`/api/ops/orders/${encodeURIComponent(orderNumber)}/delivery`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? 'The override was refused.');
      }
      setOpen(false);
      setReason('');
      onDone();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        {...(delivered ? { disabledReason: 'Already delivered' } : {})}
      >
        {delivered ? 'Already delivered' : 'Record delivery'}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record delivery — override"
        description="Use this only when the carrier's webhook never arrived. It starts the seven-day return window from now."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void submit()}
              {...(reason.trim().length < 8 ? { disabledReason: 'Say why' } : {})}
            >
              Record it
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink-2">Why you are overriding</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="rounded border border-rule bg-sheet px-3 py-2 text-body-sm text-ink"
            placeholder="Carrier confirmed by phone; webhook never arrived."
          />
        </label>
        {failed && <p className="text-body-sm text-fail">{failed}</p>}
      </Modal>
    </>
  );
}
