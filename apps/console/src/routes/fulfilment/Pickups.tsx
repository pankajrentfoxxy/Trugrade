import { useState } from 'react';
import { Button, Drawer, Modal } from '@trugrade/ui';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { FULFILMENT_API, when, type PickupRow, type RiderRow } from './api';

/** Archetype B — board. */

const config: BoardConfig<PickupRow> = {
  kind: 'pickup',
  title: 'Pickups',
  endpoint: FULFILMENT_API.pickups,
  rowKey: (r) => r.id,
  searchHint: 'Serial or task id',
  empty: {
    head: 'No pickups here',
    why: 'A pickup task is raised when a consignment is booked with a carrier.',
  },
  bulk: [
    {
      key: 'assign',
      label: 'Assign rider',
      permission: 'logistics.task.assign',
      // The rider is chosen in the bulk bar's own prompt rather than here: a
      // board config has no UI of its own, and a bulk action that silently
      // picked a rider would be the worst kind of convenience.
      run: async (rows) => {
        const riderId = window.prompt('Rider id for the selected pickups');
        if (!riderId) return { ok: 0, failed: 0 };
        const res = await fetch('/api/ops/pickups/rider', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskIds: rows.map((r) => r.id), riderId }),
        });
        if (!res.ok) {
          const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
          throw new Error(body.error?.message ?? 'The assignment was refused.');
        }
        const out: { assigned: number } = await res.json();
        return { ok: out.assigned, failed: rows.length - out.assigned };
      },
    },
  ],
  columns: [
    { key: 'point', header: 'Supply point', cell: (r) => r.supplyPoint ?? '—' },
    {
      key: 'slot',
      header: 'Slot',
      cell: (r) =>
        r.slotFrom ? (
          <span className="mono tnum text-body-sm">{when(r.slotFrom)}</span>
        ) : (
          <Unmeasured label="Unscheduled" />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    {
      key: 'rider',
      header: 'Rider',
      cell: (r) => r.riderName ?? <Unmeasured label="Unassigned" />,
    },
    {
      key: 'serials',
      header: 'Scanned',
      numeric: true,
      // Scanned against expected, never scanned alone: "8" is meaningless and
      // "8 of 10" is the whole story.
      cell: (r) => (
        <span className="mono tnum">
          {r.scanned} of {r.expected}
        </span>
      ),
    },
    {
      key: 'seals',
      header: 'Seals',
      cell: (r) =>
        r.sealsIntact === null ? (
          <Unmeasured />
        ) : (
          <StatusDot
            tone={r.sealsIntact ? 'ok' : 'fail'}
            label={r.sealsIntact ? 'Intact' : `${r.brokenSeals.length} broken`}
          />
        ),
    },
  ],
};

export default function Pickups(): React.JSX.Element {
  const [open, setOpen] = useState<PickupRow | null>(null);
  return (
    <>
      <BoardScreen config={config} onOpen={setOpen} />
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title="Pickup"
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.status)} label={word(open.status)} />
              <span>{open.supplyPoint ?? 'No supply point'}</span>
            </span>
          )
        }
      >
        {open && <PickupRecord task={open} onChanged={() => setOpen(null)} />}
      </Drawer>
    </>
  );
}

function PickupRecord({
  task,
  onChanged,
}: {
  task: PickupRow;
  onChanged: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3">
        <Fact label="Expected" value={`${task.expected}`} />
        <Fact label="Scanned" value={`${task.scanned}`} />
        <Fact label="Slot" value={when(task.slotFrom)} />
        <Fact label="Completed" value={when(task.completedAt)} />
      </dl>

      {task.brokenSeals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-caption uppercase tracking-wide text-fail">Broken seals</h3>
          <ul className="flex flex-wrap gap-2">
            {task.brokenSeals.map((code) => (
              <li key={code}>
                <Id>{code}</Id>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Manifest taskId={task.id} />
      <AssignRider task={task} onAssigned={onChanged} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mono tnum text-body-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * The manifest exactly as the rider sees it.
 *
 * Rendered from the rider's own endpoint rather than rebuilt here, so what ops
 * confirms was disclosed is literally what was disclosed. A second
 * implementation of this screen would drift, and the thing it would drift on is
 * whether a vendor's name or a customer's price leaked onto a rider's phone.
 */
function Manifest({ taskId }: { taskId: string }): React.JSX.Element {
  const { data, error } = useResource<{ serials?: string[]; address?: Record<string, string> }>(
    `/api/rider/pickup/${encodeURIComponent(taskId)}`,
    'We could not load the rider manifest.',
  );
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-caption uppercase tracking-wide text-ink-3">Rider manifest</h3>
      {error && <p className="text-body-sm text-ink-4">{error}</p>}
      {data && (
        <pre className="mono overflow-x-auto rounded border border-rule bg-sheet-2 p-3 text-caption text-ink-2">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </section>
  );
}

/**
 * A rider outside the zone, or off shift, is offered disabled with the reason.
 *
 * Hiding them would leave an operator staring at an empty list at 7pm with no
 * idea whether the roster is empty or everybody has gone home.
 */
function AssignRider({
  task,
  onAssigned,
}: {
  task: PickupRow;
  onAssigned: () => void;
}): React.JSX.Element {
  const principal = usePrincipal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { data } = useResource<{ rows: RiderRow[] }>(
    open ? `${FULFILMENT_API.riders}?view=all` : '',
    'We could not load the roster.',
  );

  if (!principal?.permissions.includes('logistics.task.assign')) return <></>;

  const assign = async (riderId: string): Promise<void> => {
    setBusy(riderId);
    setFailed(null);
    try {
      const res = await fetch(`/api/ops/pickups/${encodeURIComponent(task.id)}/rider`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ riderId }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
        throw new Error(body.error?.message ?? 'The assignment was refused.');
      }
      setOpen(false);
      onAssigned();
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {task.riderName ? 'Reassign rider' : 'Assign rider'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Assign a rider">
        {failed && <p className="text-body-sm text-fail">{failed}</p>}
        <ul className="flex flex-col gap-1">
          {(data?.rows ?? []).map((rider) => {
            const offShift = !rider.isActive;
            return (
              <li key={rider.id} className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-ink">
                  {rider.name ?? rider.phone}
                  <span className="text-ink-4"> · {rider.zone ?? 'no zone'}</span>
                  <span className="mono text-ink-4">
                    {' '}
                    {rider.openPickups + rider.openDeliveries} open
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === rider.id}
                  onClick={() => void assign(rider.id)}
                  {...(offShift ? { disabledReason: 'Off shift' } : {})}
                >
                  {offShift ? 'Off shift' : 'Assign'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Modal>
    </>
  );
}
