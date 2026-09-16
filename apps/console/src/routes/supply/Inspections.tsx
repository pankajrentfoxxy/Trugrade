import { useState } from 'react';
import { Button, Drawer, Modal } from '@trugrade/ui';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { nowMs } from '../../lib/clock';
import { BoardScreen } from '../../boards/BoardScreen';
import { Id, StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import type { BoardConfig } from '../../boards/types';
import { day } from '../fulfilment/api';

/** Archetype B — board, with a pipeline. */

interface InspectionRow {
  id: string;
  visitNumber: string;
  status: string;
  vendorOrgId: string;
  vendorName: string | null;
  technicianId: string | null;
  technicianName: string | null;
  scheduledDate: string | null;
  slotFrom: string | null;
  requestedAt: string;
  waitingDays: number;
  unitsRequested: number;
  unitsInspected: number;
  unitsPassed: number;
  unitsFailed: number;
  unitsGradeCorrected: number;
  listingIds: string[];
}

interface TechnicianLoad {
  technicianId: string;
  name: string | null;
  byDay: Record<string, number>;
  openVisits: number;
}

/**
 * The inspection queue.
 *
 * **Unscheduled first**, because that is the only view where the next move is
 * ours: a visit with no technician is a vendor whose listing cannot go live and
 * who is waiting on us right now. Every other view is watching work already in
 * flight.
 *
 * The pipeline reads left to right as the machine's own journey — requested,
 * assigned, on site, inspected — and the outcome columns say what came out the
 * other end, which is the thing the spec calls "report to live".
 */
const config: BoardConfig<InspectionRow> = {
  kind: 'inspection',
  title: 'Inspections',
  endpoint: '/api/qc/inspections',
  rowKey: (r) => r.id,
  searchHint: 'Visit number',
  facets: [{ key: 'technician', label: 'Technician' }],
  empty: {
    head: 'No inspections here',
    why: 'A visit is raised the moment a vendor submits a listing — in the same transaction, so a submit cannot succeed without one.',
  },
  pipeline: {
    stages: [
      { key: 'REQUESTED', label: 'Requested', who: 'Ours to assign' },
      { key: 'SCHEDULED', label: 'Scheduled', who: 'Technician booked' },
      { key: 'IN_PROGRESS', label: 'On site', who: 'Being inspected' },
      { key: 'PARTIALLY_COMPLETED', label: 'Partial', who: 'Some failed' },
      { key: 'COMPLETED', label: 'Done', who: 'Listing live' },
    ],
    stageOf: (r) =>
      r.status === 'QUOTED'
        ? 'REQUESTED'
        : r.status === 'TECH_ASSIGNED'
          ? 'SCHEDULED'
          : r.status === 'EN_ROUTE'
            ? 'IN_PROGRESS'
            : r.status,
    card: (r) => (
      <span className="flex flex-col gap-0.5">
        <span className="mono text-body-sm text-ink">{r.visitNumber}</span>
        <span className="text-caption text-ink-3">{r.vendorName ?? '—'}</span>
        <span className="mono tnum text-caption text-ink-2">{r.unitsRequested} machines</span>
      </span>
    ),
  },
  columns: [
    { key: 'visit', header: 'Visit', cell: (r) => <Id>{r.visitNumber}</Id> },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => <StatusDot tone={toneOf(r.status)} label={word(r.status)} />,
    },
    { key: 'vendor', header: 'Vendor', cell: (r) => r.vendorName ?? '—' },
    {
      key: 'tech',
      header: 'Technician',
      cell: (r) => r.technicianName ?? <Unmeasured label="Unassigned" />,
    },
    {
      key: 'waiting',
      header: 'Waiting',
      numeric: true,
      // Days since the vendor asked. On the unscheduled view this is the only
      // number that matters, and it is the one that sorts the queue.
      cell: (r) => <span className="mono tnum">{r.waitingDays}d</span>,
    },
    { key: 'units', header: 'Machines', numeric: true, cell: (r) => r.unitsRequested },
    {
      key: 'outcome',
      header: 'Passed',
      numeric: true,
      // Passed against inspected, never passed alone — and "Not inspected"
      // rather than 0 of 0, because nothing has been measured yet.
      cell: (r) =>
        r.unitsInspected === 0 ? (
          <Unmeasured label="Not inspected" />
        ) : (
          <span className="mono tnum">
            {r.unitsPassed} of {r.unitsInspected}
          </span>
        ),
    },
    {
      key: 'scheduled',
      header: 'Scheduled',
      cell: (r) => (r.scheduledDate ? day(r.scheduledDate) : <Unmeasured label="—" />),
    },
  ],
};

export default function Inspections(): React.JSX.Element {
  const [open, setOpen] = useState<InspectionRow | null>(null);
  return (
    <>
      <BoardScreen config={config} onOpen={setOpen} />
      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        size="xl"
        title={<span className="mono">{open?.visitNumber ?? 'Visit'}</span>}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.status)} label={word(open.status)} />
              <span>{open.vendorName ?? '—'}</span>
              <span className="text-ink-4">waiting {open.waitingDays}d</span>
            </span>
          )
        }
      >
        {open && <VisitRecord visit={open} onAssigned={() => setOpen(null)} />}
      </Drawer>
    </>
  );
}

function VisitRecord({
  visit,
  onAssigned,
}: {
  visit: InspectionRow;
  onAssigned: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Requested" value={day(visit.requestedAt)} />
        <Fact label="Machines" value={String(visit.unitsRequested)} />
        <Fact
          label="Inspected"
          value={visit.unitsInspected === 0 ? 'None yet' : String(visit.unitsInspected)}
        />
        <Fact label="Listings" value={String(visit.listingIds.length)} />
      </dl>

      {visit.unitsInspected > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-caption uppercase tracking-wide text-ink-3">Outcome</h3>
          <div className="flex flex-wrap gap-4">
            <Outcome tone="ok" label="Passed" n={visit.unitsPassed} />
            <Outcome tone="warn" label="Grade corrected" n={visit.unitsGradeCorrected} />
            <Outcome tone="fail" label="Failed" n={visit.unitsFailed} />
          </div>
          {/* Per unit, never per listing. Nine passing out of ten is nine
              machines live and one held back, not a listing that failed. */}
          <p className="text-body-sm text-ink-2">
            {visit.unitsPassed} of {visit.unitsInspected} went live.
          </p>
        </section>
      )}

      <AssignTechnician visit={visit} onAssigned={onAssigned} />
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

function Outcome({
  tone,
  label,
  n,
}: {
  tone: 'ok' | 'warn' | 'fail';
  label: string;
  n: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <StatusDot tone={tone} label={label} />
      <span className="mono tnum text-h2 text-ink">{n}</span>
    </div>
  );
}

/**
 * One click, against the endpoint that already runs the six checks.
 *
 * The workload beside each name is what stops the operator booking a fourth
 * visit on a day the technician already has three — `SchedulingService` refuses
 * it anyway, and being refused after choosing is a worse experience than seeing
 * the number first.
 */
function AssignTechnician({
  visit,
  onAssigned,
}: {
  visit: InspectionRow;
  onAssigned: () => void;
}): React.JSX.Element {
  const principal = usePrincipal();
  const [open, setOpen] = useState(false);
    // Tomorrow. A visit booked for today is a visit whose slot has usually gone.
  const [date, setDate] = useState(new Date(nowMs() + 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const { data: loads } = useResource<TechnicianLoad[]>(
    open ? '/api/qc/inspections/workload' : '',
    'We could not load the roster.',
  );

  if (!principal?.permissions.includes('qc.visit.schedule')) return <></>;

  const assign = async (technicianId: string): Promise<void> => {
    setBusy(technicianId);
    setFailed(null);
    try {
      const res = await fetch(`/api/qc/visits/${encodeURIComponent(visit.id)}/schedule`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          technicianId,
          scheduledDate: date,
          slotFrom: `${date}T10:00:00.000Z`,
          slotTo: `${date}T13:00:00.000Z`,
        }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
        // The scheduler's refusals are written for a human — "that technician is
        // not certified on this tool" — so they are shown as-is rather than
        // replaced with a generic failure.
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
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        {visit.technicianName ? 'Reassign' : 'Assign technician'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Assign a technician">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink-2">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 w-48 rounded border border-rule bg-sheet px-3 text-body-sm text-ink"
          />
        </label>
        {failed && <p className="text-body-sm text-fail">{failed}</p>}
        <ul className="flex flex-col gap-1">
          {(loads ?? []).map((tech) => {
            const onDay = tech.byDay[date] ?? 0;
            return (
              <li key={tech.technicianId} className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-ink">
                  {tech.name ?? tech.technicianId.slice(0, 8)}
                  <span className="mono tnum text-ink-4">
                    {' '}
                    {onDay} that day · {tech.openVisits} open
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === tech.technicianId}
                  onClick={() => void assign(tech.technicianId)}
                >
                  Assign
                </Button>
              </li>
            );
          })}
          {loads?.length === 0 && (
            <li className="text-body-sm text-ink-4">
              No active technicians. Add one before assigning a visit.
            </li>
          )}
        </ul>
      </Modal>
    </>
  );
}
