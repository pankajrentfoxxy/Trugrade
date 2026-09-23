import { useState } from 'react';
import { Button, Drawer, Input, Modal } from '@trugrade/ui';
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
  // The assignment writes through `/qc/visits/:id/schedule`, not through the
  // board, so the row underneath the drawer still says "Unassigned" until the
  // page is fetched again. Closing the drawer without that meant the operator's
  // next "Open" showed the visit as they found it, with the same button.
  const [reloadToken, setReloadToken] = useState(0);
  const assigned = (): void => {
    setOpen(null);
    setReloadToken((n) => n + 1);
  };
  return (
    <>
      <BoardScreen config={config} onOpen={setOpen} reloadToken={reloadToken} />
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
        {open && <VisitRecord visit={open} onAssigned={assigned} />}
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
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Requested" value={day(visit.requestedAt)} />
        {/* Who and when, because the one action on this record is to set them,
            and a record that does not show its own answer looks unanswered. */}
        <Fact
          label="Scheduled"
          value={visit.scheduledDate ? day(visit.scheduledDate) : <Unmeasured label="Not yet" />}
        />
        <Fact
          label="Technician"
          mono={false}
          value={visit.technicianName ?? <Unmeasured label="Unassigned" />}
        />
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

function Fact({
  label,
  value,
  // Dates and counts are numbers and set in mono; a person's name is not.
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className={`${mono ? 'mono tnum ' : ''}text-body-sm text-ink`}>{value}</dd>
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
  // The slot the visit is booked into. `qc_visit.slot_from` is a `time` column
  // and the endpoint wants `HH:MM`, which is exactly what a time input gives.
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('13:00');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const { data: loads } = useResource<TechnicianLoad[]>(
    open ? '/api/qc/inspections/workload' : '',
    'We could not load the roster.',
  );

  if (!principal?.permissions.includes('qc.visit.schedule')) return <></>;

  // Padded, because both notations reach the endpoint and '09:30' sorts before
  // '09:30:00' as a raw string — the same trap the DTO's rule pads out of.
  const asSeconds = (t: string): string => (t.length === 5 ? `${t}:00` : t);
  const slotBackwards = Boolean(from && to) && asSeconds(to) <= asSeconds(from);

  const assign = async (technicianId: string): Promise<void> => {
    // Caught here so the operator is told which end is wrong, rather than
    // spending a round trip to be told the slot has to end after it starts.
    if (!from || !to) {
      setFailed('Give the slot a start and an end time.');
      return;
    }
    if (slotBackwards) {
      setFailed('End time must be later than the start time.');
      return;
    }
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
          slotFrom: from,
          slotTo: to,
        }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string; fields?: Record<string, string> } } = await res
          .json()
          .catch(() => ({}));
        // The scheduler's refusals are written for a human — "that technician is
        // not certified on this tool" — so they are shown as-is rather than
        // replaced with a generic failure. A field-level refusal carries its
        // answer in `fields`; the top-level message for one of those is
        // "Some of the details need fixing", which names nothing.
        const field = Object.values(body.error?.fields ?? {})[0];
        throw new Error(field ?? body.error?.message ?? 'The assignment was refused.');
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
        {/* On the id, not the name: a booked visit is booked whether or not the
            name lookup found a person to print. */}
        {visit.technicianId ? 'Reassign' : 'Assign technician'}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Assign a technician">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
          <Input
            label="Slot from"
            type="time"
            mono
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
          <Input
            label="Slot to"
            type="time"
            mono
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
            error={slotBackwards ? 'End time must be later than the start time.' : undefined}
          />
        </div>
        {failed && (
          <p className="text-body-sm text-fail" role="alert">
            {failed}
          </p>
        )}
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
                  {...(slotBackwards
                    ? { disabledReason: 'The slot has to end after it starts.' }
                    : {})}
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
