import * as React from 'react';
import { Link } from 'react-router';
import { Button, DataBoard, EmptyState, cn, type Column } from '@trugrade/ui';
import { Board, NotMeasured } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { initials, shortName } from './OrderInspections';
import { qs } from './api';
import type { VisitRow, VisitStatus } from './types';

/**
 * ARCHETYPE B — Board. Status chips + attention strip + filter rail + data
 * table grouped by month + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Every visit, in date order.
 *
 * The board is sorted by scheduled date because a QC manager's question is
 * almost always "what is happening, and what is late" rather than "show me
 * everything". The attention strip answers the second half before the table
 * is read: which visits are overdue, which one has been open for a month,
 * where a technician is booked in two places at once, and whether check-ins
 * are being recorded at all.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.vs-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the other admin boards:
 *
 * - **The table is still `DataBoard`**, restyled through its wrapper class,
 *   with its month headings drawn through the shared `group` prop.
 * - **Every count is arithmetic over the rows the API returned** — the board
 *   endpoint returns every visit, unpaged — and every date judgement
 *   ("7 days overdue", "Today") uses the server's calendar, which travels on
 *   the row as `daysOverdue` and `today`.
 * - **Green and red on this board belong to the machines.** The bar and the
 *   "3 passed" line are PASS and FAIL. A late visit or a vendor who was out is
 *   drawn in the design's `--admin-bad`, a fact about our process, never a
 *   verdict on a machine.
 *
 * **Two of the design's buttons are not here.** "Schedule a visit" has no
 * creation form in this console — booking happens on the Scheduling week — so
 * the header links there instead. "Reschedule" would need a bulk endpoint;
 * the overdue line offers "Show them", which is what it can honestly do.
 *
 * **Geo variance stays on the row.** A technician checking in a long way from
 * the registered warehouse is the cheapest fraud signal in the phase, and the
 * alert threshold travels on the row (`qc.geo_variance_alert_metres`) so this
 * screen never renders 500 from a literal.
 *
 * Every filter is in the query string. "The three visits Ramesh has in Gurugram
 * next Tuesday" has to be a link someone can paste into chat.
 */

const NO_SHOW: ReadonlyArray<VisitStatus> = ['NO_SHOW_VENDOR', 'NO_SHOW_TECH'];

/** The chips, in the design's order. Each is a predicate over a row. */
type ChipKey = '' | 'overdue' | 'in_progress' | 'completed' | 'no_show';
const CHIPS: ReadonlyArray<{ key: ChipKey; label: string; dot: string | null; is: (v: VisitRow) => boolean }> = [
  { key: '', label: 'All', dot: null, is: () => true },
  { key: 'overdue', label: 'Overdue', dot: 'd--bad', is: (v) => (v.daysOverdue ?? 0) > 0 },
  { key: 'in_progress', label: 'In progress', dot: 'd--violet', is: (v) => v.status === 'IN_PROGRESS' || v.status === 'EN_ROUTE' },
  { key: 'completed', label: 'Completed', dot: 'd--ok', is: (v) => v.status === 'COMPLETED' || v.status === 'PARTIALLY_COMPLETED' },
  { key: 'no_show', label: 'Vendor no-show', dot: 'd--noshow', is: (v) => NO_SHOW.includes(v.status) },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dateOf = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);
/** `22 Sep`. */
const onDay = (ymd: string): string => `${dateOf(ymd).getUTCDate()} ${MONTHS[dateOf(ymd).getUTCMonth()]}`;
/** `September 2026`. */
const monthOf = (ymd: string): string => `${MONTHS_LONG[dateOf(ymd).getUTCMonth()]} ${dateOf(ymd).getUTCFullYear()}`;
/** `09:30:00` → `9:30 am`. */
export function clock12(t: string): string {
  const [h = '0', m = '00'] = t.split(':');
  const hour = Number(h);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${m} ${suffix}`;
}
/** `21–24 Sep`, or `21 Sep – 2 Oct` across a month boundary. */
export function dateRange(from: string, to: string): string {
  if (from === to) return onDay(from);
  const a = dateOf(from);
  const b = dateOf(to);
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${onDay(to)}` : `${onDay(from)} – ${onDay(to)}`;
}
const daysBetween = (fromIso: string, toYmd: string): number =>
  Math.max(0, Math.floor((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(fromIso)) / 86_400_000));

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The city, when the site label carries one after a comma; else the label. */
const cityOf = (facilityLabel: string): string => {
  const parts = facilityLabel.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? facilityLabel;
};

/** The design's pill for a visit, and the flag under it. */
export function pillOf(v: VisitRow): { label: string; cls: string; flag: { text: string; tone: 'bad' | 'warn' } | null } {
  const overdue = (v.daysOverdue ?? 0) > 0 ? { text: `${v.daysOverdue} ${plural(v.daysOverdue!, 'day', 'days')} overdue`, tone: 'bad' as const } : null;
  switch (v.status) {
    case 'COMPLETED':
      return { label: 'Completed', cls: 'p-done', flag: null };
    case 'PARTIALLY_COMPLETED':
      return { label: 'Partly done', cls: 'p-sched', flag: v.unitsAbsent > 0 ? { text: `${v.unitsAbsent} not presented`, tone: 'warn' } : null };
    case 'IN_PROGRESS':
    case 'EN_ROUTE': {
      const since = v.startedAt ?? v.arrivedAt;
      const open = since ? daysBetween(since, v.today) : null;
      return { label: v.status === 'EN_ROUTE' ? 'En route' : 'In progress', cls: 'p-prog', flag: open !== null && open >= 1 ? { text: `Open for ${open} ${plural(open, 'day', 'days')}`, tone: 'warn' } : null };
    }
    case 'TECH_ASSIGNED':
      return { label: 'Technician assigned', cls: 'p-tech', flag: overdue };
    case 'SCHEDULED':
    case 'RESCHEDULED':
      return { label: v.status === 'RESCHEDULED' ? 'Rescheduled' : 'Scheduled', cls: 'p-sched', flag: overdue };
    case 'NO_SHOW_VENDOR':
      return { label: 'Vendor no-show', cls: 'p-noshow', flag: { text: 'Not rescheduled', tone: 'bad' } };
    case 'NO_SHOW_TECH':
      return { label: 'Technician no-show', cls: 'p-noshow', flag: { text: 'Not rescheduled', tone: 'bad' } };
    case 'CANCELLED':
      return { label: 'Cancelled', cls: 'p-sched', flag: null };
    default:
      return { label: v.status.charAt(0) + v.status.slice(1).toLowerCase().replace(/_/g, ' '), cls: 'p-sched', flag: null };
  }
}

/** Two open visits, one technician, one day, overlapping slots, two addresses. */
export function doubleBookings(rows: readonly VisitRow[]): Array<{ technicianName: string; date: string; slotFrom: string; slotTo: string; sites: string[] }> {
  const out: Array<{ technicianName: string; date: string; slotFrom: string; slotTo: string; sites: string[] }> = [];
  const byKey = new Map<string, VisitRow[]>();
  for (const v of rows) {
    if (!v.technicianId || !v.scheduledDate || !v.slotFrom || !v.slotTo) continue;
    const key = `${v.technicianId}|${v.scheduledDate}`;
    byKey.set(key, [...(byKey.get(key) ?? []), v]);
  }
  for (const group of byKey.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i]!;
        const b = group[j]!;
        const overlap = a.slotFrom! < b.slotTo! && b.slotFrom! < a.slotTo!;
        if (overlap && a.addressId !== b.addressId) {
          out.push({
            technicianName: a.technicianName ?? 'A technician',
            date: a.scheduledDate!,
            slotFrom: a.slotFrom! < b.slotFrom! ? b.slotFrom! : a.slotFrom!,
            slotTo: a.slotTo! < b.slotTo! ? a.slotTo! : b.slotTo!,
            sites: [cityOf(a.facilityLabel), cityOf(b.facilityLabel)],
          });
        }
      }
    }
  }
  return out;
}

/* ---- icons, as the design draws them ---------------------------------- */

const svgProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const PinIcon = (): React.JSX.Element => (
  <svg width="13" height="13" strokeWidth="2" {...svgProps}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
const ChevronIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/* ---- cells ------------------------------------------------------------- */

function WhenCell({ v }: { v: VisitRow }): React.JSX.Element {
  if (!v.scheduledDate) {
    return <NotMeasured why="This visit has no date yet" label="Not scheduled" />;
  }
  const d = dateOf(v.scheduledDate);
  return (
    <div className="vs-when">
      <div className="vs-cal" aria-hidden="true">
        <div className="vs-cal__d">{d.getUTCDate()}</div>
        <div className="vs-cal__w">{WEEKDAYS[d.getUTCDay()]}</div>
      </div>
      <div>
        <div className="vs-day">
          {onDay(v.scheduledDate)}
          {v.scheduledDate === v.today && <span className="vs-today">Today</span>}
        </div>
        {v.slotFrom && v.slotTo ? (
          <div className="vs-time">
            {clock12(v.slotFrom)} – {clock12(v.slotTo)}
          </div>
        ) : (
          <div className="vs-time vs-time--none">No time window</div>
        )}
      </div>
    </div>
  );
}

function UnitsCell({ v }: { v: VisitRow }): React.JSX.Element {
  const total = v.unitsRequested;
  const pct = (n: number): string => (total === 0 ? '0%' : `${(n / total) * 100}%`);
  return (
    <div className="vs-units">
      <span className="vs-units__top">
        <strong>
          {v.unitsInspected} of {total}
        </strong>{' '}
        inspected
      </span>
      <span className="vs-bar" role="img" aria-label={`${v.unitsPassed} passed, ${v.unitsGradeCorrected} corrected, ${v.unitsFailed} failed of ${total}`}>
        <span className="ok" style={{ width: pct(v.unitsPassed) }} />
        <span className="fx" style={{ width: pct(v.unitsGradeCorrected) }} />
        <span className="ko" style={{ width: pct(v.unitsFailed) }} />
      </span>
      {v.unitsInspected > 0 && (
        <div className="vs-units__res">
          <span className="ok">{v.unitsPassed} passed</span> · {v.unitsGradeCorrected} corrected · {v.unitsFailed} failed
        </div>
      )}
      {/* A visit that inspected 30 of 40 because ten machines were not there is
          not a successful visit, and `unitsAbsent` is the number that says so. */}
      {v.unitsAbsent > 0 && <div className="vs-flag vs-flag--warn">{v.unitsAbsent} not presented</div>}
    </div>
  );
}

/** `11:12 am`, in IST. */
const atTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase();

/**
 * The check-in is the arrival; the geo variance is what it measured. A visit
 * can have arrived with no variance recorded, and that is said as such rather
 * than as "not checked in".
 */
function CheckInCell({ v }: { v: VisitRow }): React.JSX.Element {
  if (v.arrivedAt === null) {
    return <span className="vs-checkin">— Not checked in</span>;
  }
  const over = v.geoVarianceMetres !== null && v.geoVarianceMetres > v.geoVarianceAlertMetres;
  return (
    <span className={cn('vs-checkin', over ? 'vs-checkin--bad' : 'vs-checkin--ok')}>
      <span>
        Checked in <span className="mono">{atTime(v.arrivedAt)}</span>
      </span>
      {v.geoVarianceMetres === null ? (
        <span className="vs-checkin__sub">distance not recorded</span>
      ) : (
        <span className="vs-checkin__sub">
          <span className="mono">{v.geoVarianceMetres} m</span> from the site
          {over && ` · over the ${v.geoVarianceAlertMetres} m alert threshold`}
        </span>
      )}
    </span>
  );
}

/* ======================================================================== */

export function VisitBoardRoute(): React.JSX.Element {
  const [status, setStatus] = useUrlState('status');
  const [technicianId, setTechnicianId] = useUrlState('technicianId');
  const [vendorOrgId, setVendorOrgId] = useUrlState('vendorOrgId');
  const [from, setFrom] = useUrlState('from');
  const [to, setTo] = useUrlState('to');
  const principal = usePrincipal();
  const canSchedule = principal?.permissions.includes('qc.visit.schedule') ?? false;

  // The chips are groups the server does not know ("overdue" is a calendar
  // fact), so status is filtered here over the rows; the other three filters
  // travel to the server. "Not assigned" is a value the server has no id for.
  const unassignedOnly = technicianId === 'none';
  const url = `/api/qc/visits${qs({
    technicianId: unassignedOnly ? '' : technicianId,
    vendorOrgId,
    from,
    to,
  })}`;
  const { data, error } = useResource<VisitRow[]>(url, 'The visit board is unavailable');

  // Derived from the loaded page rather than fetched: the filter is a
  // convenience over what is on screen, and a second round trip to populate two
  // dropdowns is a round trip that can fail on its own.
  const technicians = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of data ?? []) if (v.technicianId) seen.set(v.technicianId, v.technicianName ?? v.technicianId);
    return [...seen].map(([id, name]) => ({ value: id, label: name }));
  }, [data]);
  const vendors = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of data ?? []) seen.set(v.vendorOrgId, v.vendorName);
    return [...seen].map(([id, name]) => ({ value: id, label: shortName(name) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const all = React.useMemo(
    () =>
      [...(data ?? [])]
        .filter((v) => !unassignedOnly || v.technicianId === null)
        .sort(
          (a, b) =>
            (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') ||
            (a.slotFrom ?? '99').localeCompare(b.slotFrom ?? '99') ||
            a.visitNumber.localeCompare(b.visitNumber),
        ),
    [data, unassignedOnly],
  );
  const chip = CHIPS.find((c) => c.key === status);
  // An old bookmark may still carry an exact status; it keeps working.
  const rows = React.useMemo(
    () => (chip ? all.filter(chip.is) : all.filter((v) => v.status === status)),
    [all, chip, status],
  );

  /* ---- the strip's arithmetic, over every row on the board ---- */
  const overdue = all.filter((v) => (v.daysOverdue ?? 0) > 0);
  const overdueDates = overdue.map((v) => v.scheduledDate!).sort();
  const overdueMachines = overdue.reduce((n, v) => n + v.unitsRequested, 0);
  const overdueUnassigned = overdue.filter((v) => !v.technicianId).length;
  const stale = all
    .filter((v) => (v.status === 'IN_PROGRESS' || v.status === 'EN_ROUTE') && (v.startedAt ?? v.arrivedAt))
    .map((v) => ({ v, days: daysBetween((v.startedAt ?? v.arrivedAt)!, v.today) }))
    .filter((s) => s.days >= 1)
    .sort((a, b) => b.days - a.days);
  const clashes = doubleBookings(all);
  const alerts = all.filter((v) => v.geoVarianceMetres !== null && v.geoVarianceMetres > v.geoVarianceAlertMetres);
  const attended = all.filter((v) => !['SCHEDULED', 'TECH_ASSIGNED', 'RESCHEDULED', 'CANCELLED', 'REQUESTED', 'QUOTED'].includes(v.status));
  const unchecked = attended.filter((v) => v.arrivedAt === null);
  const uncheckedCompleted = unchecked.filter((v) => v.status === 'COMPLETED' || v.status === 'PARTIALLY_COMPLETED').length;

  const columns: ReadonlyArray<Column<VisitRow>> = [
    { key: 'when', header: 'When', cell: (v) => <WhenCell v={v} /> },
    {
      key: 'visit',
      header: 'Visit & supply point',
      cell: (v) => (
        <>
          <Link to={`/qc/visits/${v.id}`} className="vs-id">
            {v.visitNumber}
          </Link>
          <div className="vs-sp">
            <PinIcon /> {shortName(v.vendorName)} <span>· {cityOf(v.facilityLabel)}</span>
          </div>
        </>
      ),
    },
    {
      key: 'technician',
      header: 'Technician',
      cell: (v) =>
        v.technicianName ? (
          <div className="vs-tech">
            <span className="vs-avatar" aria-hidden="true">
              {initials(v.technicianName)}
            </span>
            {v.technicianName}
          </div>
        ) : (
          <div className="vs-unassigned">Not assigned</div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (v) => {
        const p = pillOf(v);
        return (
          <>
            <span className={cn('vs-pill', p.cls)}>{p.label}</span>
            {p.flag && <div className={cn('vs-flag', `vs-flag--${p.flag.tone}`)}>{p.flag.text}</div>}
          </>
        );
      },
    },
    { key: 'units', header: 'Machines', cell: (v) => <UnitsCell v={v} /> },
    { key: 'checkin', header: 'Check-in', cell: (v) => <CheckInCell v={v} /> },
    {
      key: 'open',
      header: 'Open',
      headerHidden: true,
      numeric: true,
      cell: (v) => (
        <Link to={`/qc/visits/${v.id}`} className="vs-open" aria-label={`Open ${v.visitNumber}`}>
          <ChevronIcon />
        </Link>
      ),
    },
  ];

  if (error) {
    return <EmptyState title="The visit board did not load" body={`${error}. Nothing has been changed — reload to try again.`} />;
  }

  const filtered = Boolean(status || technicianId || vendorOrgId || from || to);
  const items: React.ReactNode[] = [];
  if (alerts.length > 0) {
    items.push(
      <div className="vs-attn__item" key="geo">
        <span className="sev sev--bad" aria-hidden="true" />
        <span className="txt">
          <strong>
            {alerts.length} {plural(alerts.length, 'visit', 'visits')} checked in outside the registered warehouse
          </strong>
          . The cheapest fraud signal there is; open each one.
        </span>
      </div>,
    );
  }
  if (overdue.length > 0) {
    items.push(
      <div className="vs-attn__item" key="overdue">
        <span className="sev sev--bad" aria-hidden="true" />
        <span className="txt">
          <strong>
            {overdue.length} {plural(overdue.length, 'visit is', 'visits are')} overdue
          </strong>{' '}
          ({dateRange(overdueDates[0]!, overdueDates[overdueDates.length - 1]!)}, {overdueMachines} {plural(overdueMachines, 'machine', 'machines')}).
          {overdueUnassigned > 0 && ` ${overdueUnassigned === 1 ? 'One of them has' : `${overdueUnassigned} of them have`} no technician.`}
        </span>
        <button type="button" className="vs-btn vs-btn--sm" onClick={() => setStatus('overdue')}>
          Show them
        </button>
      </div>,
    );
  }
  for (const s of stale) {
    items.push(
      <div className="vs-attn__item" key={`stale-${s.v.id}`}>
        <span className="sev sev--warn" aria-hidden="true" />
        <span className="txt">
          <strong>1 visit has been in progress since {onDay((s.v.startedAt ?? s.v.arrivedAt)!.slice(0, 10))}.</strong>{' '}
          <span className="mono">{s.v.visitNumber}</span> stopped at {s.v.unitsInspected} of {s.v.unitsRequested} machines.
        </span>
        <Link to={`/qc/visits/${s.v.id}`} className="vs-btn vs-btn--sm">
          Open visit
        </Link>
      </div>,
    );
  }
  for (const c of clashes) {
    items.push(
      <div className="vs-attn__item" key={`clash-${c.technicianName}-${c.date}-${c.sites.join()}`}>
        <span className="sev sev--warn" aria-hidden="true" />
        <span className="txt">
          <strong>
            {c.technicianName} was double-booked on {onDay(c.date)}
          </strong>
          , {clock12(c.slotFrom)} – {clock12(c.slotTo)}, in both {c.sites[0]} and {c.sites[1]}.
        </span>
      </div>,
    );
  }
  if (attended.length > 0 && unchecked.length > 0) {
    items.push(
      <div className="vs-attn__item" key="checkin">
        <span className="sev sev--muted" aria-hidden="true" />
        <span className="txt">
          <strong>
            {unchecked.length === attended.length ? 'No visit has a check-in' : `${unchecked.length} of ${attended.length} attended visits have no check-in`}
          </strong>
          {uncheckedCompleted > 0 && `, including ${uncheckedCompleted === 1 ? 'a completed one' : `${uncheckedCompleted} completed ones`}`}. On-site times aren&rsquo;t being recorded for them.
        </span>
      </div>,
    );
  }

  return (
    <div className="visit-board">
      <div className="vs-head">
        <div>
          <h1 className="vs-title">Visits</h1>
          <p className="vs-sub">Every technician trip to a supply point, in date order.</p>
        </div>
        {canSchedule && (
          // Booking lives on the Scheduling week; there is no visit-creation
          // form here, so the button says where it goes rather than promising one.
          <Link to="/qc/schedule" className="vs-btn">
            Open the schedule
          </Link>
        )}
      </div>

      {data && (
        <div className="vs-chips" role="group" aria-label="Filter by status">
          {CHIPS.map((c) => {
            const n = all.filter(c.is).length;
            return (
              <button key={c.key || 'all'} type="button" className="vs-chip" aria-pressed={status === c.key} onClick={() => setStatus(c.key)}>
                {c.dot && n > 0 && <span className={cn('d', c.dot)} aria-hidden="true" />}
                {c.label} <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <section className="vs-attn" aria-label="Needs attention">
          {items}
        </section>
      )}

      <div className="vs-filters">
        <label className="vs-f">
          Technician
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">Anyone</option>
            {technicians.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
            <option value="none">Not assigned</option>
          </select>
        </label>
        <label className="vs-f">
          Supply point
          <select value={vendorOrgId} onChange={(e) => setVendorOrgId(e.target.value)}>
            <option value="">All</option>
            {vendors.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="vs-f">
          <span>Scheduled between</span>
          <div className="vs-range">
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>–</span>
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      <Board className="vs-card">
        <DataBoard
          className="vs-table"
          caption={data ? `${rows.length} QC ${plural(rows.length, 'visit', 'visits')}, oldest first.` : 'Loading the visit board.'}
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          rowClassName={(v) => {
            const p = pillOf(v);
            return p.flag?.tone === 'bad' ? 'is-bad' : p.flag?.tone === 'warn' ? 'is-warn' : undefined;
          }}
          group={{
            of: (v) => (v.scheduledDate ? monthOf(v.scheduledDate) : 'Not scheduled'),
            header: ({ key }) => <span className="vs-month">{key}</span>,
            className: 'vs-month-row',
          }}
          loading={!data}
          skeletonRows={6}
          empty={
            <EmptyState
              title={filtered ? 'No visits match' : 'No visits yet'}
              body={filtered ? 'Widen the filters, or wait for a vendor to request an inspection.' : 'A visit is raised the moment a vendor submits a listing.'}
              action={
                filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setStatus('');
                      setTechnicianId('');
                      setVendorOrgId('');
                      setFrom('');
                      setTo('');
                    }}
                  >
                    Clear the filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <div className="vs-foot">
          <span>
            {data ? (
              <>
                Showing <strong>{rows.length}</strong> {plural(rows.length, 'visit', 'visits')}
                {rows.length !== all.length && <> of <strong>{all.length}</strong></>} · oldest first
              </>
            ) : (
              'Loading the visit board.'
            )}
          </span>
          <span>
            Bar: <span className="lg-ok">passed</span> · <span className="lg-fx">corrected</span> · <span className="lg-ko">failed</span>
          </span>
        </div>
      </Board>
    </div>
  );
}
