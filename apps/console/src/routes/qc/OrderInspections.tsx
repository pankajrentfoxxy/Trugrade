import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, DataBoard, EmptyState, cn, type Column } from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import type { OrderInspectionSlot, OrderInspectionView } from './order-inspection-types';

/**
 * ARCHETYPE B — Board. Stage tiles + filter rail + data table with an
 * expandable machine list under each row.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * The queue of order inspections: one row per technician visit, each for one
 * order's machines at one supply point. A technician sees their own; ops
 * (anyone holding `qc.visit.schedule`) sees every visit on the platform.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.oi-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as `/orders` and `/procurement/pos`:
 *
 * - **The table is still `DataBoard`**, restyled through its wrapper class.
 *   The machine list under a row is its `detail` row, added to the shared
 *   component for this screen rather than drawn as a second table here.
 * - **Every figure is derived from the visits the API returned**, all of them
 *   — the endpoint is not paged — so the tiles, the progress bars and the
 *   "5 machines verified" are counts over the same rows the table shows.
 * - **The four stages are read off the visit and its machines.** A visit the
 *   technician has finished is "waiting for verification" until every machine
 *   on it carries `verifiedAt`; only then is it "completed". The visit's own
 *   status does not know about verification, which happens on the order.
 * - **Filters live in the URL**: `stage`, `tech`, `sp` and `q`. Which rows are
 *   expanded does not — that is a reading position, not a view.
 */

type Stage = 'waiting' | 'progress' | 'verification' | 'completed' | 'cancelled';

const STAGES: ReadonlyArray<{ key: Stage; label: string; dot: string; pill: string; zero: string }> = [
  { key: 'waiting', label: 'Waiting for technician', dot: 'd--warn', pill: 'oi-pill--warn', zero: 'No visit assigned yet' },
  { key: 'progress', label: 'Inspection in progress', dot: 'd--info', pill: 'oi-pill--info', zero: 'Technician at the supply point' },
  { key: 'verification', label: 'Waiting for verification', dot: 'd--violet', pill: 'oi-pill--violet', zero: 'Needs an admin to check' },
  { key: 'completed', label: 'Completed', dot: 'd--ok', pill: 'oi-pill--ok', zero: 'No machines verified yet' },
];

export const stageMeta = (key: Stage): { label: string; pill: string } =>
  STAGES.find((s) => s.key === key) ?? { label: 'Cancelled', pill: 'oi-pill--neutral' };

export function stageOf(v: OrderInspectionView): Stage {
  if (v.status === 'CANCELLED') return 'cancelled';
  if (v.status === 'TECH_ASSIGNED') return 'waiting';
  if (v.status === 'IN_PROGRESS') return 'progress';
  const allVerified = v.slots.length > 0 && v.slots.every((s) => s.verifiedAt !== null);
  return allVerified ? 'completed' : 'verification';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `28 Sep 2026`, as the design writes it. */
export function onDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** `11:07 am`. */
export const atTime = (iso: string): string =>
  new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();

/** `5 min`, `1 h 12 min`, `under a minute`. */
export function elapsed(fromIso: string, toIso: string): string {
  const minutes = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** The legal name without its legal suffix. The full name stays in the title. */
export const shortName = (legal: string): string =>
  legal.replace(/[\s,]+(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|llp|inc\.?)$/i, '').trim();

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

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
  <svg width="14" height="14" strokeWidth="2.4" {...svgProps}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const OpenIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M7 17L17 7M9 7h8v8" />
  </svg>
);

/* ---- the expanded row ------------------------------------------------- */

function Detail({ v }: { v: OrderInspectionView }): React.JSX.Element {
  const recorded = v.slots.filter((s) => s.inspectedAt !== null).length;
  return (
    <div className="oi-detail__box">
      <div className="oi-times">
        <div className="oi-time">
          <span className="oi-time__label">Technician assigned</span>
          <span className="oi-time__value">{v.assignedAt ? atTime(v.assignedAt) : 'Not yet'}</span>
          <span className="oi-time__who">
            {v.assignedByName ? `by ${v.assignedByName}` : 'assigner not recorded'}
          </span>
        </div>
        <div className="oi-time">
          <span className="oi-time__label">All machines recorded</span>
          <span className="oi-time__value">{v.completedAt ? atTime(v.completedAt) : 'Not yet'}</span>
          <span className="oi-time__who">
            {v.completedAt
              ? `by ${v.technicianName ?? 'the technician'}${
                  v.assignedAt ? ` · ${elapsed(v.assignedAt, v.completedAt)}` : ''
                }`
              : `${recorded} of ${v.slots.length} so far`}
          </span>
        </div>
        <div className="oi-time">
          <span className="oi-time__label">Verified</span>
          <span className="oi-time__value">{v.verifiedAt ? atTime(v.verifiedAt) : 'Not yet'}</span>
          <span className="oi-time__who">
            {v.verifiedAt
              ? `by ${v.verifiedByName ?? 'an admin'}${
                  v.completedAt ? ` · ${elapsed(v.completedAt, v.verifiedAt)}` : ''
                }`
              : v.completedAt
                ? 'waiting for an admin'
                : 'after every machine is recorded'}
          </span>
        </div>
      </div>
      <table className="oi-mtable">
        <caption className="sr-only">
          {v.slots.length} {plural(v.slots.length, 'machine', 'machines')} on {v.orderNumber}
        </caption>
        <thead>
          <tr>
            <th scope="col">Serial</th>
            <th scope="col">Machine</th>
            <th scope="col">Grade sold at</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {v.slots.map((s) => (
            <tr key={s.slotId}>
              <td className="mono">
                {s.serialNumber ?? <span className="oi-none">Not recorded</span>}
              </td>
              <td>
                {s.title ?? (
                  <NotMeasured why="The SKU on this order line could not be resolved" label="Machine unresolved" />
                )}
              </td>
              <td>
                <span className="oi-grade">{s.grade}</span>
              </td>
              <td>
                <Result s={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Result({ s }: { s: OrderInspectionSlot }): React.JSX.Element {
  if (s.verifiedAt) return <span className="oi-ok">✓ Verified</span>;
  if (s.inspectedAt) return <span className="oi-pending">Recorded, not verified</span>;
  return <span className="oi-none">Not recorded</span>;
}

/* ======================================================================== */

export function OrderInspectionsRoute(): React.JSX.Element {
  // `usePrincipal`, not `useAuth`: null outside the provider keeps the screen
  // renderable in isolation, and a null principal is honestly a technician view.
  const principal = usePrincipal();
  const isOps = principal?.permissions.includes('qc.visit.schedule') ?? false;
  const canOpenOrders = principal?.permissions.includes('ordering.any.read') ?? false;
  const { data, error } = useResource<OrderInspectionView[]>(
    isOps ? '/api/qc/order-inspections' : '/api/qc/order-inspections/mine',
    'The inspection queue is unavailable',
  );

  const [params, setParams] = useSearchParams();
  const stage = params.get('stage') ?? '';
  const tech = params.get('tech') ?? '';
  const sp = params.get('sp') ?? '';
  const q = params.get('q') ?? '';
  const filtered = Boolean(stage || tech || sp || q);
  const [typed, setTyped] = React.useState(q);
  React.useEffect(() => setTyped(q), [q]);

  function setFilter(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const all = React.useMemo(() => data ?? [], [data]);

  // The tiles count every visit, not the filtered ones: a tile is a filter,
  // and a filter that counts only what is already filtered cannot be compared.
  const tiles = React.useMemo(
    () =>
      STAGES.map((s) => {
        const visits = all.filter((v) => stageOf(v) === s.key);
        const slots = visits.flatMap((v) => v.slots);
        const recorded = slots.filter((x) => x.inspectedAt !== null).length;
        const verified = slots.filter((x) => x.verifiedAt !== null).length;
        let meta = s.zero;
        if (visits.length > 0) {
          meta =
            s.key === 'waiting'
              ? `${slots.length} ${plural(slots.length, 'machine', 'machines')} to record`
              : s.key === 'progress'
                ? `${recorded} of ${slots.length} machines recorded`
                : s.key === 'verification'
                  ? `${slots.length - verified} ${plural(slots.length - verified, 'machine', 'machines')} to verify`
                  : `${verified} ${plural(verified, 'machine', 'machines')} verified`;
        }
        return { ...s, count: visits.length, meta };
      }),
    [all],
  );

  const technicians = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of all) if (v.technicianId && v.technicianName) seen.set(v.technicianId, v.technicianName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const supplyPoints = React.useMemo(
    () => [...new Set(all.map((v) => v.vendorLegalName).filter((n): n is string => Boolean(n)))].sort(),
    [all],
  );

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (v) =>
        (!stage || stageOf(v) === stage) &&
        (!tech || v.technicianId === tech) &&
        (!sp || v.vendorLegalName === sp) &&
        (!needle ||
          v.orderNumber.toLowerCase().includes(needle) ||
          v.visitNumber.toLowerCase().includes(needle) ||
          v.slots.some((s) => s.serialNumber?.toLowerCase().includes(needle))),
    );
  }, [all, stage, tech, sp, q]);

  const columns = React.useMemo<ReadonlyArray<Column<OrderInspectionView>>>(
    () => [
      {
        key: 'order',
        header: 'Order & inspection',
        cell: (v) => {
          const expanded = open.has(v.visitId);
          return (
            <div className="oi-order">
              <button
                type="button"
                className="oi-toggle"
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Hide' : 'Show'} machines for ${v.orderNumber}`}
                onClick={() => toggle(v.visitId)}
              >
                <ChevronIcon />
              </button>
              <div>
                {canOpenOrders ? (
                  <Link className="oi-id" to={`/orders/${v.orderNumber}`}>
                    {v.orderNumber}
                  </Link>
                ) : (
                  <Link className="oi-id" to={`/qc/orders/${v.visitId}`}>
                    {v.orderNumber}
                  </Link>
                )}
                <div className="oi-ref">{v.visitNumber}</div>
              </div>
            </div>
          );
        },
      },
      {
        key: 'site',
        header: 'Supply point',
        cell: (v) => (
          <>
            {v.vendorLegalName ? (
              <div className="oi-sp" title={v.vendorLegalName}>
                {shortName(v.vendorLegalName)}
              </div>
            ) : (
              <NotMeasured why="The supply point on this visit could not be resolved" label="Supply point unresolved" />
            )}
            {v.site && (
              <div className="oi-sp-sub">
                {v.site.city} <span className="mono">{v.site.pincode}</span>
              </div>
            )}
          </>
        ),
      },
      {
        key: 'tech',
        header: 'Technician',
        cell: (v) =>
          v.technicianName ? (
            <div className="oi-tech">
              <span className="oi-avatar" aria-hidden="true">
                {initials(v.technicianName)}
              </span>
              {v.technicianName}
            </div>
          ) : (
            <NotMeasured why="No technician has been assigned to this visit" label="Unassigned" />
          ),
      },
      {
        key: 'progress',
        header: 'Machines recorded',
        cell: (v) => {
          const total = v.slots.length;
          const done = v.slots.filter((s) => s.inspectedAt !== null).length;
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);
          return (
            <div className="oi-prog">
              <span className="oi-prog__txt">
                <strong>
                  {done} of {total}
                </strong>{' '}
                recorded
              </span>
              <span className="oi-bar" role="img" aria-label={`${pct}% – ${done} of ${total} machines`}>
                <span style={{ width: `${pct}%` }} />
              </span>
            </div>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        cell: (v) => {
          const meta = stageMeta(stageOf(v));
          return <span className={cn('oi-pill', meta.pill)}>{meta.label}</span>;
        },
      },
      {
        key: 'assigned',
        header: 'Assigned',
        cell: (v) =>
          v.assignedAt ? (
            <span className="oi-date">{onDay(v.assignedAt)}</span>
          ) : (
            <span className="oi-none">Not yet</span>
          ),
      },
      {
        key: 'open',
        header: 'Open',
        headerHidden: true,
        numeric: true,
        cell: (v) => (
          <Link
            className="oi-open"
            to={`/qc/orders/${v.visitId}`}
            aria-label={`Open inspection for ${v.orderNumber}`}
          >
            <OpenIcon />
          </Link>
        ),
      },
    ],
    [open, canOpenOrders],
  );

  if (error) {
    return (
      <EmptyState
        title="The inspection queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  return (
    <div className="order-inspections">
      <div className="oi-head">
        <h1 className="oi-title">Order inspections</h1>
        <p className="oi-sub">
          {isOps
            ? 'Technician visits to supply points, one per consignment. Expand a row to see each machine that was recorded.'
            : 'Orders you have been sent to inspect. Open one, go to the supply point, and record each machine’s serial as you inspect it.'}
        </p>
      </div>

      {data && (
        <div className="oi-stages" role="group" aria-label="Filter by stage">
          {tiles.map((t) => (
            <button
              key={t.key}
              type="button"
              className={cn('oi-stage', t.count === 0 && 'oi-stage--zero')}
              aria-pressed={stage === t.key}
              onClick={() => setFilter('stage', stage === t.key ? '' : t.key)}
            >
              <span className="oi-stage__top">
                <span className={cn('d', t.dot)} aria-hidden="true" />
                {t.label}
              </span>
              <span className="oi-stage__count">{t.count}</span>
              <span className="oi-stage__meta">{t.meta}</span>
            </button>
          ))}
        </div>
      )}

      <form
        className="oi-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', typed.trim());
        }}
      >
        <label className="oi-search">
          <SearchIcon />
          <input
            type="search"
            placeholder="Order number, inspection ref or serial"
            aria-label="Search inspections"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setFilter('q', typed.trim())}
          />
        </label>
        {isOps && (
          <label className="oi-select">
            Technician
            <select value={tech} onChange={(e) => setFilter('tech', e.target.value)}>
              <option value="">All</option>
              {technicians.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="oi-select">
          Supply point
          <select value={sp} onChange={(e) => setFilter('sp', e.target.value)}>
            <option value="">All</option>
            {supplyPoints.map((name) => (
              <option key={name} value={name}>
                {shortName(name)}
              </option>
            ))}
          </select>
        </label>
      </form>

      <Board className="oi-card">
        <DataBoard
          className="oi-table"
          caption={
            data
              ? `${rows.length} ${plural(rows.length, 'inspection', 'inspections')}, open visits first, then newest.`
              : 'Loading the inspection queue.'
          }
          columns={columns}
          rows={rows}
          rowKey={(v) => v.visitId}
          rowClassName={(v) => cn('oi-row', open.has(v.visitId) && 'is-open')}
          detail={{ open: (v) => open.has(v.visitId), render: (v) => <Detail v={v} />, className: 'oi-detail' }}
          loading={!data}
          skeletonRows={4}
          empty={
            <EmptyState
              title={filtered ? 'Nothing matches this filter' : 'Nothing to inspect'}
              body={
                filtered
                  ? 'Inspections do exist — this filter has none of them. The box matches anywhere inside an order number, inspection ref or serial.'
                  : isOps
                    ? 'No order has a technician assigned yet. Assign one from an order’s record.'
                    : 'No order is assigned to you right now. Ops assigns one from the order record and it appears here.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                    Clear the filter
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <div className="oi-foot">
          {data ? (
            <>
              Showing <strong>{rows.length}</strong> {plural(rows.length, 'inspection', 'inspections')}
              {rows.length !== all.length ? <> of <strong>{all.length}</strong></> : null} · open visits
              first, then newest
            </>
          ) : (
            'Loading the inspection queue.'
          )}
        </div>
      </Board>
    </div>
  );
}
