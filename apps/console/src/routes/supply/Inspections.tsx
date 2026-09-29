import { useMemo, useState } from 'react';
import { Button, DataBoard, Drawer, EmptyState, Input, Modal, cn, type Column } from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { nowMs } from '../../lib/clock';
import { useBoard } from '../../boards/useBoard';
import { StatusDot, Unmeasured, toneOf, word } from '../../boards/bits';
import { initials, shortName } from '../qc/OrderInspections';

/**
 * ARCHETYPE B — Board. Stage chips + attention strip + filter rail + data
 * table + row actions, with a pipeline view.
 * DENSITY: compact (admin); the design's Roomy toggle lives in the URL.
 *
 * The stock-inspection queue: technician visits to check a vendor's declared
 * machines at the supply point, before the listing goes live.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.vi-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the other admin boards:
 *
 * - **The table is still `DataBoard`**, restyled through its wrapper class, and
 *   board state still lives in the URL through `useBoard` — the same keys as
 *   before, so a bookmarked view or technician filter keeps working.
 * - **Every sentence in the attention strip is the server's arithmetic**, over
 *   every open visit rather than the page: which are overdue and between which
 *   dates, which have nobody, which supply point could be one trip. Nothing is
 *   typed in.
 * - **A visit that is late says so on the row** — "6 days overdue" under the
 *   date, from the server's calendar, not the browser's.
 *
 * **Two of the design's buttons are not here.** "Reschedule" would need a bulk
 * rescheduling endpoint, and "Plan one trip" a planning one; neither exists.
 * The overdue line offers "Show them" instead, which is what it can honestly
 * do. "Assign technician" is real: it opens the oldest unassigned visit
 * straight into the same dialog the row uses.
 */

export interface InspectionRow {
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
  daysOverdue?: number | null;
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

interface Attention {
  overdue: {
    count: number;
    ofOpen: number;
    machines: number;
    machinesInspected: number;
    from: string | null;
    to: string | null;
  };
  unassigned: { count: number; oldest: InspectionRow | null };
  cluster: { vendorName: string; visits: number; machines: number } | null;
  load: { technicianName: string; visits: number; machines: number } | null;
}

/** The envelope. The extras are optional only because the surface sweep renders the generic one. */
interface ExtraBoard {
  late?: Record<string, number>;
  totals?: { machinesWaiting: number };
  attention?: Attention;
}

const ENDPOINT = '/api/qc/inspections';
const FACETS = ['technician', 'late'] as const;

/** The design's stage vocabulary: a dot colour per chip that has one. */
const STAGE_DOT: Readonly<Record<string, string>> = {
  scheduled: 'd--info',
  onsite: 'd--violet',
  partial: 'd--warn',
  done: 'd--ok',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `22 Sep`, as the design writes it. */
const onDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
/** `21–24 Sep`, or `21 Sep – 2 Oct` across a month boundary. */
export function dateRange(from: string, to: string): string {
  if (from === to) return onDay(from);
  const a = new Date(from);
  const b = new Date(to);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${onDay(to)}`
    : `${onDay(from)} – ${onDay(to)}`;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The design's pill for a visit, read off its status and whether anyone is on it. */
export function pillOf(v: InspectionRow): { label: string; tone: string } {
  switch (v.status) {
    case 'COMPLETED':
      return { label: 'Completed', tone: 'vi-pill--ok' };
    case 'PARTIALLY_COMPLETED':
      return { label: 'Partly done', tone: 'vi-pill--warn' };
    case 'IN_PROGRESS':
    case 'EN_ROUTE':
      return { label: 'On site', tone: 'vi-pill--violet' };
    case 'SCHEDULED':
    case 'TECH_ASSIGNED':
      return v.technicianId
        ? { label: 'Technician assigned', tone: 'vi-pill--info' }
        : { label: 'Needs technician', tone: 'vi-pill--warn' };
    case 'REQUESTED':
    case 'QUOTED':
      return { label: 'Needs technician', tone: 'vi-pill--warn' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'vi-pill--neutral' };
    case 'NO_SHOW_VENDOR':
      return { label: 'Vendor no-show', tone: 'vi-pill--bad' };
    default:
      return { label: word(v.status), tone: 'vi-pill--neutral' };
  }
}

/* ---- icons, as the design draws them ---------------------------------- */

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};
const SearchIcon = (): React.JSX.Element => (
  <svg width="18" height="18" strokeWidth="2" {...svgProps}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
const ChevronIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const InfoIcon = (): React.JSX.Element => (
  <svg width="14" height="14" strokeWidth="2.4" {...svgProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <path d="M12 16.5v.01" />
  </svg>
);

/* ======================================================================== */

export default function Inspections(): React.JSX.Element {
  const board = useBoard<InspectionRow>(ENDPOINT, FACETS);
  const { state, data, error, set, clearFilters, filtered, reload } = board;
  const extra = data as (typeof data & ExtraBoard) | null;
  const principal = usePrincipal();
  const canSchedule = principal?.permissions.includes('qc.visit.schedule') ?? false;

  const [mode, setMode] = useState<'table' | 'pipeline'>('table');
  const [typed, setTyped] = useState(state.q);
  const [open, setOpen] = useState<InspectionRow | null>(null);
  // The assignment writes through `/qc/visits/:id/schedule`, not through the
  // board, so the row underneath the drawer still says "Unassigned" until the
  // page is fetched again.
  const assigned = (): void => {
    setOpen(null);
    reload();
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const view = state.view || data?.views[0]?.key || 'unscheduled';
  const viewLabel = (data?.views.find((v) => v.key === view)?.label ?? view).toLowerCase();
  const technician = state.facets.technician ?? '';
  const lateOnly = state.facets.late === '1';
  const roomy = state.density === 'default';

  const columns: ReadonlyArray<Column<InspectionRow>> = [
    {
      key: 'visit',
      header: 'Visit',
      cell: (r) => (
        <>
          <button type="button" className="vi-id" onClick={() => setOpen(r)}>
            {r.visitNumber}
          </button>
          <div className="vi-small">
            Created {onDay(r.requestedAt)} · waiting {r.waitingDays} {plural(r.waitingDays, 'day', 'days')}
          </div>
        </>
      ),
    },
    {
      key: 'vendor',
      header: 'Supply point',
      cell: (r) =>
        r.vendorName ? (
          <div className="vi-sp" title={r.vendorName}>
            {shortName(r.vendorName)}
          </div>
        ) : (
          <NotMeasured why="The supply point on this visit could not be resolved" label="Supply point unresolved" />
        ),
    },
    {
      key: 'tech',
      header: 'Technician',
      cell: (r) =>
        r.technicianName ? (
          <div className="vi-tech">
            <span className="vi-avatar" aria-hidden="true">
              {initials(r.technicianName)}
            </span>
            {r.technicianName}
          </div>
        ) : r.technicianId ? (
          // Booked on the id even when the name lookup found nobody to print.
          <div className="vi-tech">
            <span className="vi-avatar" aria-hidden="true">
              ?
            </span>
            Assigned, name unknown
          </div>
        ) : (
          <div className="vi-unassigned">
            <InfoIcon />
            Unassigned
            {canSchedule && (
              <button
                type="button"
                className="vi-btn vi-btn--sm"
                aria-label={`Assign ${r.visitNumber}`}
                onClick={() => setOpen(r)}
              >
                Assign
              </button>
            )}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => {
        const p = pillOf(r);
        return <span className={cn('vi-pill', p.tone)}>{p.label}</span>;
      },
    },
    {
      key: 'scheduled',
      header: 'Scheduled for',
      cell: (r) =>
        r.scheduledDate ? (
          <>
            <div className="vi-date">{onDay(r.scheduledDate)}</div>
            {typeof r.daysOverdue === 'number' && r.daysOverdue > 0 && (
              <div className="vi-late">
                {r.daysOverdue} {plural(r.daysOverdue, 'day', 'days')} overdue
              </div>
            )}
          </>
        ) : (
          <NotMeasured why="No date has been booked for this visit" label="Not scheduled" />
        ),
    },
    {
      key: 'progress',
      header: 'Progress',
      cell: (r) => {
        const pct = r.unitsRequested === 0 ? 0 : Math.round((r.unitsInspected / r.unitsRequested) * 100);
        return (
          <div className="vi-prog">
            <span className="vi-prog__txt">
              <strong>
                {r.unitsInspected} of {r.unitsRequested}
              </strong>{' '}
              inspected
            </span>
            <span className="vi-bar" role="img" aria-label={`${pct}% – ${r.unitsInspected} of ${r.unitsRequested} machines`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
        );
      },
    },
    {
      key: 'open',
      header: 'Open',
      headerHidden: true,
      numeric: true,
      cell: (r) => (
        <button type="button" className="vi-open" aria-label={`Open ${r.visitNumber}`} onClick={() => setOpen(r)}>
          <ChevronIcon />
        </button>
      ),
    },
  ];

  if (error) {
    return <EmptyState title="The inspection board did not load" body={`${error}. Nothing has been changed — reload to try again.`} />;
  }

  const attention = extra?.attention;
  const scheduledCount = data?.views.find((v) => v.key === 'scheduled')?.count ?? 0;

  return (
    <div className={cn('stock-inspections', roomy && 'vi--roomy')}>
      <div className="vi-head">
        <div>
          <h1 className="vi-title">Inspections</h1>
          <p className="vi-sub">Technician visits to check vendor stock at the supply point.</p>
        </div>
        <div className="vi-seg" role="group" aria-label="View">
          {(['table', 'pipeline'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === 'table' ? 'Table' : 'Pipeline'}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="vi-stages" role="group" aria-label="Filter by stage">
          {data.views.map((v) => {
            const late = extra?.late?.[v.key] ?? 0;
            return (
              <button
                key={v.key}
                type="button"
                className={cn('vi-chip', v.count === 0 && 'vi-chip--zero')}
                aria-pressed={view === v.key}
                onClick={() => set({ view: v.key })}
              >
                {STAGE_DOT[v.key] && v.count > 0 && <span className={cn('d', STAGE_DOT[v.key])} aria-hidden="true" />}
                {v.label} <span className="n">{v.count}</span>
                {late > 0 && <span className="late">{late} late</span>}
              </button>
            );
          })}
        </div>
      )}

      {attention && (
        <AttentionStrip
          attention={attention}
          scheduledCount={scheduledCount}
          canSchedule={canSchedule}
          onShowOverdue={() => set({ view: 'scheduled', facets: { late: '1' } })}
          onAssign={(row) => setOpen(row)}
        />
      )}

      <form
        className="vi-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: typed.trim() });
        }}
      >
        <label className="vi-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Visit number or supply point"
            aria-label="Search visits"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => set({ q: typed.trim() })}
          />
        </label>
        <label className="vi-select">
          Technician
          <select value={technician} onChange={(e) => set({ facets: { technician: e.target.value } })}>
            <option value="">Anyone</option>
            {(data?.facets.technician ?? []).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <div className="vi-seg" role="group" aria-label="Row density">
          <button type="button" aria-pressed={!roomy} onClick={() => set({ density: 'compact' })}>
            Compact
          </button>
          <button type="button" aria-pressed={roomy} onClick={() => set({ density: 'default' })}>
            Roomy
          </button>
        </div>
      </form>

      {lateOnly && (
        <p className="vi-hint">
          Showing only visits whose scheduled date has passed.{' '}
          <button type="button" className="vi-link" onClick={() => set({ facets: { late: '' } })}>
            Show all
          </button>
        </p>
      )}

      {mode === 'pipeline' && data ? (
        <PipelineView rows={rows} views={data.views} onOpen={setOpen} onStage={(k) => set({ view: k })} />
      ) : (
        <Board className="vi-card">
          <DataBoard
            className="vi-table"
            caption={data ? `${data.total} ${plural(data.total, 'visit', 'visits')} ${viewLabel}, oldest first.` : 'Loading the inspection board.'}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={!data}
            skeletonRows={5}
            empty={
              <EmptyState
                title={filtered ? 'Nothing matches this filter' : 'No inspections here'}
                body={
                  filtered
                    ? 'Visits do exist — this filter has none of them. The box matches anywhere inside a visit number or a supply point’s name.'
                    : 'A visit is raised the moment a vendor submits a listing — in the same transaction, so a submit cannot succeed without one.'
                }
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear the filter
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          <div className="vi-foot">
            <span>
              {data ? (
                <>
                  Showing <strong>{rows.length}</strong> {view === 'all' ? '' : `${viewLabel} `}of{' '}
                  <strong>{data.grandTotal}</strong> visits · oldest first
                </>
              ) : (
                'Loading the inspection board.'
              )}
            </span>
            {extra?.totals && extra.totals.machinesWaiting > 0 && (
              <span>
                {extra.totals.machinesWaiting} {plural(extra.totals.machinesWaiting, 'machine', 'machines')} waiting to be
                inspected
              </span>
            )}
          </div>
        </Board>
      )}

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        size="xl"
        title={<span className="mono">{open?.visitNumber ?? 'Visit'}</span>}
        subtitle={
          open && (
            <span className="flex items-center gap-3">
              <StatusDot tone={toneOf(open.status)} label={pillOf(open).label} />
              <span>{open.vendorName ?? '—'}</span>
              <span className="text-ink-4">waiting {open.waitingDays}d</span>
            </span>
          )
        }
      >
        {open && <VisitRecord visit={open} onAssigned={assigned} />}
      </Drawer>
    </div>
  );
}

/* ---- the attention strip ---------------------------------------------- */

function AttentionStrip({
  attention,
  scheduledCount,
  canSchedule,
  onShowOverdue,
  onAssign,
}: {
  attention: Attention;
  scheduledCount: number;
  canSchedule: boolean;
  onShowOverdue: () => void;
  onAssign: (row: InspectionRow) => void;
}): React.JSX.Element | null {
  const items: React.ReactNode[] = [];
  const od = attention.overdue;
  if (od.count > 0) {
    const every = od.count === od.ofOpen && od.count === scheduledCount;
    items.push(
      <div className="vi-attn__item" key="overdue">
        <span className="sev sev--bad" aria-hidden="true" />
        <span className="txt">
          <strong>
            {every
              ? 'Every scheduled visit is overdue.'
              : `${od.count} ${plural(od.count, 'visit is', 'visits are')} overdue.`}
          </strong>{' '}
          {od.count === 1 ? 'Its date' : 'Their dates'}
          {od.from && od.to ? ` (${dateRange(od.from, od.to)})` : ''}{' '}
          {od.count === 1 ? 'has' : 'have'} passed and{' '}
          {od.machinesInspected === 0
            ? `none of the ${od.machines} machines has been inspected yet.`
            : `${od.machinesInspected} of the ${od.machines} machines have been inspected.`}
        </span>
        <button type="button" className="vi-btn" onClick={onShowOverdue}>
          Show them
        </button>
      </div>,
    );
  }
  const un = attention.unassigned;
  if (un.count > 0) {
    const o = un.oldest;
    items.push(
      <div className="vi-attn__item" key="unassigned">
        <span className="sev sev--warn" aria-hidden="true" />
        <span className="txt">
          <strong>
            {un.count} {plural(un.count, 'visit has', 'visits have')} no technician.
          </strong>
          {o && (
            <>
              {' '}
              <span className="mono">{o.visitNumber}</span> at{' '}
              {o.vendorName ? shortName(o.vendorName) : 'an unresolved supply point'} has waited {o.waitingDays}{' '}
              {plural(o.waitingDays, 'day', 'days')}.
            </>
          )}
        </span>
        {o && canSchedule && (
          <button type="button" className="vi-btn vi-btn--primary" onClick={() => onAssign(o)}>
            Assign technician
          </button>
        )}
      </div>,
    );
  }
  if (attention.cluster) {
    const c = attention.cluster;
    const l = attention.load;
    items.push(
      <div className="vi-attn__item" key="cluster">
        <span className="sev sev--info" aria-hidden="true" />
        <span className="txt">
          <strong>
            {c.visits} visits are to {shortName(c.vendorName)}
          </strong>{' '}
          ({c.machines} machines). One trip could cover them all.
          {l && ` ${l.technicianName} alone has ${l.machines} machines across ${l.visits} ${plural(l.visits, 'visit', 'visits')}.`}
        </span>
      </div>,
    );
  }
  if (items.length === 0) return null;
  return (
    <section className="vi-attn" aria-label="Needs attention">
      {items}
    </section>
  );
}

/* ---- the pipeline view ------------------------------------------------ */

function PipelineView({
  rows,
  views,
  onOpen,
  onStage,
}: {
  rows: readonly InspectionRow[];
  views: ReadonlyArray<{ key: string; label: string; count: number }>;
  onOpen: (row: InspectionRow) => void;
  onStage: (key: string) => void;
}): React.JSX.Element {
  const stageOf = (r: InspectionRow): string =>
    r.status === 'COMPLETED'
      ? 'done'
      : r.status === 'PARTIALLY_COMPLETED'
        ? 'partial'
        : r.status === 'IN_PROGRESS' || r.status === 'EN_ROUTE'
          ? 'onsite'
          : r.status === 'SCHEDULED' || r.status === 'TECH_ASSIGNED'
            ? 'scheduled'
            : 'unscheduled';
  return (
    <div className="vi-pipe">
      {views
        .filter((v) => v.key !== 'all')
        .map((v) => {
          const inStage = rows.filter((r) => stageOf(r) === v.key);
          return (
            <section key={v.key} className="vi-pipe__col">
              <header>
                <h2>{v.label}</h2>
                <span className="n">{v.count}</span>
              </header>
              {inStage.map((r) => (
                <button key={r.id} type="button" className="vi-pipe__card" onClick={() => onOpen(r)}>
                  <span className="mono">{r.visitNumber}</span>
                  <span className="vi-small">{r.vendorName ? shortName(r.vendorName) : 'Supply point unresolved'}</span>
                  <span className="vi-small">
                    {r.unitsRequested} {plural(r.unitsRequested, 'machine', 'machines')}
                  </span>
                </button>
              ))}
              {inStage.length < v.count && (
                <button type="button" className="vi-link" onClick={() => onStage(v.key)}>
                  {v.count - inStage.length} more
                </button>
              )}
            </section>
          );
        })}
    </div>
  );
}

/* ---- the record drawer ------------------------------------------------ */

function VisitRecord({ visit, onAssigned }: { visit: InspectionRow; onAssigned: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Requested" value={onDay(visit.requestedAt)} />
        {/* Who and when, because the one action on this record is to set them,
            and a record that does not show its own answer looks unanswered. */}
        <Fact label="Scheduled" value={visit.scheduledDate ? onDay(visit.scheduledDate) : <Unmeasured label="Not yet" />} />
        <Fact label="Technician" mono={false} value={visit.technicianName ?? <Unmeasured label="Unassigned" />} />
        <Fact label="Machines" value={String(visit.unitsRequested)} />
        <Fact label="Inspected" value={visit.unitsInspected === 0 ? 'None yet' : String(visit.unitsInspected)} />
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

function Outcome({ tone, label, n }: { tone: 'ok' | 'warn' | 'fail'; label: string; n: number }): React.JSX.Element {
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
function AssignTechnician({ visit, onAssigned }: { visit: InspectionRow; onAssigned: () => void }): React.JSX.Element {
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

  const { data: loads } = useResource<TechnicianLoad[]>(open ? '/api/qc/inspections/workload' : '', 'We could not load the roster.');

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
        body: JSON.stringify({ technicianId, scheduledDate: date, slotFrom: from, slotTo: to }),
      });
      if (!res.ok) {
        const body: { error?: { message?: string; fields?: Record<string, string> } } = await res.json().catch(() => ({}));
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
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <Input label="Slot from" type="time" mono value={from} onChange={(e) => setFrom(e.target.value)} required />
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
            const onThatDay = tech.byDay[date] ?? 0;
            return (
              <li key={tech.technicianId} className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-ink">
                  {tech.name ?? tech.technicianId.slice(0, 8)}
                  <span className="mono tnum text-ink-4">
                    {' '}
                    {onThatDay} that day · {tech.openVisits} open
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === tech.technicianId}
                  {...(slotBackwards ? { disabledReason: 'The slot has to end after it starts.' } : {})}
                  onClick={() => void assign(tech.technicianId)}
                >
                  Assign
                </Button>
              </li>
            );
          })}
          {loads?.length === 0 && <li className="text-body-sm text-ink-4">No active technicians. Add one before assigning a visit.</li>}
        </ul>
      </Modal>
    </>
  );
}

