import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, Skeleton, cn } from '@trugrade/ui';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { initials, shortName } from './OrderInspections';
import { qs, send } from './api';
import type { ScheduleOverdueVisit, ScheduleTechnician, ScheduleTechnicianDay, ScheduleVisit, ScheduleWeek } from './types';

/**
 * ARCHETYPE E — Workspace. A week of technicians against a week of days, with
 * the work that has no day beneath it.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Two capacities constrain a QC week, they fail in completely different ways,
 * and a calendar that shows only the first is the one that produces the bad day:
 *
 * **Per-technician capacity** — `daily_capacity_units` (40) and
 * `max_sites_per_day` (3). Overbooking here means a technician runs out of
 * daylight, which is visible in advance and recoverable. It is the bar and the
 * three site dots in every day cell.
 *
 * **Licence seats** — `qc_tool_provider.licence_seats` is a hard cap on how many
 * technicians can be certifying at once, enforced inside DeviceSure and not by
 * us. Overbooking here means the thirteenth technician's agent refuses to
 * certify, in a warehouse, with the vendor watching, and nothing on our side can
 * fix it that morning. It gets the loud banner.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.sc-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the other admin screens:
 *
 * - **The week, its dates and "today" are the server's.** A browser clock
 *   deciding what today means is how a scheduler quietly shows the wrong week
 *   to somebody in a different timezone.
 * - **The suggested plan is arithmetic, and booking it is real.** Each overdue
 *   visit is placed on the first free weekday after today where its
 *   technician's day still has the units and the sites, keeping its own time
 *   window. "Book suggested plan" and a drop onto a day both go through
 *   `POST /qc/visits/:id/schedule`, which runs the scheduler's six checks; a
 *   refusal is printed in the scheduler's words and nothing else is booked in
 *   its place. Dashed cards are not booked.
 * - **"Schedule a visit" is not here.** There is no creation form: a visit is
 *   raised by a vendor's listing or a buyer's order, and this screen gives it
 *   a day.
 */

const DEFAULT_SLOT = { from: '10:00:00', to: '13:00:00' };
const UNAVAILABLE = new Set(['LEAVE', 'TRAVEL', 'HOLIDAY']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateOf = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);
const shiftDate = (ymd: string, days: number): string => {
  const d = dateOf(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** `28 Sep – 4 Oct 2026`, or `5 – 11 Oct 2026` inside one month. */
export function weekLabel(from: string, to: string): string {
  const a = dateOf(from);
  const b = dateOf(to);
  const year = b.getUTCFullYear();
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${year}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${year}`;
}
/** `Wed 30 Sep`. */
const dayLabel = (ymd: string): string => `${WEEKDAYS[dateOf(ymd).getUTCDay()]} ${dateOf(ymd).getUTCDate()} ${MONTHS[dateOf(ymd).getUTCMonth()]}`;
/** `09:30:00` → 9.5. */
const hours = (t: string): number => {
  const [h = '0', m = '0'] = t.split(':');
  return Number(h) + Number(m) / 60;
};
/** 9.5 → `9:30 am`; whole hours drop the minutes, as the design writes them. */
export function clock(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  const suffix = whole >= 12 ? 'pm' : 'am';
  const twelve = whole % 12 === 0 ? 12 : whole % 12;
  return mins === 0 ? `${twelve} ${suffix}` : `${twelve}:${String(mins).padStart(2, '0')} ${suffix}`;
}
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const isWeekend = (ymd: string): boolean => [0, 6].includes(dateOf(ymd).getUTCDay());
const pct = (n: number, of: number): string => `${of <= 0 ? 0 : Math.min(100, (n / of) * 100)}%`;

/* ---- the suggestion ---------------------------------------------------- */

export interface Suggestion {
  visit: ScheduleOverdueVisit;
  technicianId: string;
  technicianName: string;
  date: string;
  slotFrom: string;
  slotTo: string;
}

/**
 * Give each overdue visit the first free weekday after today.
 *
 * Its own technician when it has one, otherwise the chosen (or only) one. A
 * day is free when the technician is not away, the units still fit under the
 * daily cap, and the site count — distinct addresses, booked and suggested —
 * stays within the day's limit. The visit keeps its own time window. Nothing
 * here checks site hours, zones or tool certification: that is the
 * scheduler's job, and it still runs when the suggestion is booked.
 */
export function suggest(week: ScheduleWeek, fallbackTechId: string | null): { placed: Suggestion[]; unplaced: ScheduleOverdueVisit[] } {
  const placed: Suggestion[] = [];
  const unplaced: ScheduleOverdueVisit[] = [];
  const load = new Map<string, { units: number; sites: Set<string> }>();
  for (const t of week.technicians) {
    for (const d of t.days) {
      load.set(`${t.id}|${d.date}`, { units: d.bookedUnits, sites: new Set(d.visits.map((v) => v.addressId)) });
    }
  }
  const candidates = week.dates.filter((d) => d > week.today && !isWeekend(d));
  for (const v of week.overdue) {
    const techId = v.technicianId ?? fallbackTechId;
    const tech = week.technicians.find((t) => t.id === techId);
    if (!tech) {
      unplaced.push(v);
      continue;
    }
    const day = candidates.find((d) => {
      const td = tech.days.find((x) => x.date === d);
      if (td && UNAVAILABLE.has(td.availability)) return false;
      const l = load.get(`${tech.id}|${d}`) ?? { units: 0, sites: new Set<string>() };
      const sites = l.sites.has(v.addressId) ? l.sites.size : l.sites.size + 1;
      return l.units + v.units <= tech.dailyCapacityUnits && sites <= tech.maxSitesPerDay;
    });
    if (!day) {
      unplaced.push(v);
      continue;
    }
    const l = load.get(`${tech.id}|${day}`) ?? { units: 0, sites: new Set<string>() };
    l.units += v.units;
    l.sites.add(v.addressId);
    load.set(`${tech.id}|${day}`, l);
    placed.push({ visit: v, technicianId: tech.id, technicianName: tech.name, date: day, slotFrom: v.slotFrom ?? DEFAULT_SLOT.from, slotTo: v.slotTo ?? DEFAULT_SLOT.to });
  }
  return { placed, unplaced };
}

/* ---- icons ------------------------------------------------------------- */

const svgProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const PrevIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
const NextIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2.2" {...svgProps}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const SparkIcon = (): React.JSX.Element => (
  <svg width="16" height="16" strokeWidth="2" {...svgProps}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);

/* ---- cells ------------------------------------------------------------- */

const emptyDay = (date: string): ScheduleTechnicianDay => ({ date, availability: 'UNSET', bookedUnits: 0, sites: 0, visits: [] });

/** One booked, running or finished visit in a day cell. */
function VisitCard({ v }: { v: ScheduleVisit }): React.JSX.Element {
  const done = v.status === 'COMPLETED' || v.status === 'PARTIALLY_COMPLETED';
  const live = v.status === 'IN_PROGRESS' || v.status === 'EN_ROUTE';
  return (
    <Link to={`/qc/visits/${v.id}`} className={cn('sc-visit', done ? 'sc-visit--done' : live ? 'sc-visit--live' : 'sc-visit--booked')} title={v.visitNumber}>
      <span className="sc-visit__sp">{shortName(v.vendorName)}</span>
      <span className="sc-visit__meta">
        {v.units} {plural(v.units, 'unit', 'units')}
        {v.orderNumber ? ` · order ${v.orderNumber}` : ''}
      </span>
      <span className="sc-visit__meta mono">{v.visitNumber.slice(-8)}</span>
      {v.slotFrom && v.slotTo && (
        <span className="sc-visit__meta">
          {clock(hours(v.slotFrom))} – {clock(hours(v.slotTo))}
        </span>
      )}
      <span className="st">{done ? 'Completed' : live ? 'In progress' : 'Booked'}</span>
    </Link>
  );
}

/** The suggestions on one day for one technician, one dashed card per site. */
function PlanCards({ items }: { items: Suggestion[] }): React.JSX.Element {
  const bySite = new Map<string, Suggestion[]>();
  for (const s of items) bySite.set(s.visit.addressId, [...(bySite.get(s.visit.addressId) ?? []), s]);
  return (
    <>
      {[...bySite.values()].map((group) => {
        const units = group.reduce((n, s) => n + s.visit.units, 0);
        const first = group[0]!;
        return (
          <div key={group.map((s) => s.visit.id).join('+')} className="sc-visit sc-visit--plan" title={`Suggested for ${first.technicianName}`}>
            <span className="sc-visit__sp">{shortName(first.visit.vendorName)}</span>
            <span className="sc-visit__meta">
              {units} {plural(units, 'unit', 'units')}
              {group.length > 1 ? ` · ${group.length} visits` : ''}
            </span>
            <span className="sc-visit__meta mono">{group.map((s) => s.visit.visitNumber.slice(-8)).join(' + ')}</span>
            <span className="st">Suggested</span>
          </div>
        );
      })}
    </>
  );
}

interface DayCellProps {
  tech: ScheduleTechnician;
  day: ScheduleTechnicianDay;
  today: string;
  plan: Suggestion[];
  droppable: boolean;
  over: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

function DayCell({ tech, day, today, plan, droppable, over, onDragOver, onDragLeave, onDrop }: DayCellProps): React.JSX.Element {
  const { date } = day;
  if (UNAVAILABLE.has(day.availability)) {
    return (
      <div className={cn('sc-day sc-day--off', date < today && 'sc-day--past')}>
        <span className="sc-away" data-state="unavailable">
          {day.availability.toLowerCase()}
        </span>
      </div>
    );
  }
  const planned = plan.reduce((n, s) => n + s.visit.units, 0);
  const total = day.bookedUnits + planned;
  const bookedSites = new Set(day.visits.map((v) => v.addressId));
  const planSites = new Set(plan.map((s) => s.visit.addressId).filter((a) => !bookedSites.has(a)));
  const sites = bookedSites.size + planSites.size;
  const overCap = day.bookedUnits > tech.dailyCapacityUnits || day.sites > tech.maxSitesPerDay;
  const full = !overCap && (day.bookedUnits === tech.dailyCapacityUnits || day.sites === tech.maxSitesPerDay);
  const free = Math.max(0, tech.dailyCapacityUnits - total);

  return (
    <div
      className={cn('sc-day', date === today && 'sc-day--today', date < today && 'sc-day--past', over && 'sc-day--drop', overCap && 'sc-day--over')}
      data-state={overCap ? 'over' : full ? 'full' : 'ok'}
      onDragOver={droppable ? onDragOver : undefined}
      onDragLeave={droppable ? onDragLeave : undefined}
      onDrop={droppable ? onDrop : undefined}
    >
      <div className="sc-cap">
        <div className="sc-cap__txt">
          <span>
            <strong>{total}</strong> / {tech.dailyCapacityUnits} units
          </span>
        </div>
        <div className="sc-cap__bar" aria-hidden="true">
          <span className="used" style={{ width: pct(day.bookedUnits, tech.dailyCapacityUnits) }} />
          <span className="plan" style={{ width: pct(planned, tech.dailyCapacityUnits) }} />
        </div>
      </div>
      <div className="sc-sites" title="Sites">
        {Array.from({ length: Math.max(tech.maxSitesPerDay, sites) }, (_, i) => (
          <i key={i} className={i < bookedSites.size ? 'on' : i < sites ? 'plan' : undefined} />
        ))}
        <span className="sc-sites__txt">
          {sites} / {tech.maxSitesPerDay} sites
        </span>
      </div>
      {overCap && <span className="sc-over">Over capacity — this day will not fit</span>}
      {day.visits.map((v) => (
        <VisitCard key={v.id} v={v} />
      ))}
      {plan.length > 0 && <PlanCards items={plan} />}
      {!overCap && date >= today && (
        <div className="sc-free">
          {free} {plural(free, 'unit', 'units')} free
        </div>
      )}
    </div>
  );
}

/* ======================================================================== */

export function ScheduleRoute(): React.JSX.Element {
  // In the URL, so "the week of the 28th" is a link and not a click path.
  const [from, setFrom] = useUrlState('from');
  const [reloadToken, setReloadToken] = React.useState(0);
  const { data, error } = useResource<ScheduleWeek>(`/api/qc/schedule${qs({ from })}`, 'The schedule is unavailable', reloadToken);
  const principal = usePrincipal();
  const canBook = principal?.permissions.includes('qc.visit.schedule') ?? false;

  const [dismissed, setDismissed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);

  const fallbackTechId = data?.technicians.find((t) => t.isActive)?.id ?? data?.technicians[0]?.id ?? null;
  const plan = React.useMemo(() => (data ? suggest(data, fallbackTechId) : { placed: [], unplaced: [] }), [data, fallbackTechId]);
  const suggested = dismissed ? [] : plan.placed;

  async function book(items: Suggestion[]): Promise<void> {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    let done = 0;
    const refused: string[] = [];
    for (const s of items) {
      try {
        await send<unknown>(
          `/api/qc/visits/${encodeURIComponent(s.visit.id)}/schedule`,
          'POST',
          { technicianId: s.technicianId, scheduledDate: s.date, slotFrom: s.slotFrom.slice(0, 5), slotTo: s.slotTo.slice(0, 5) },
          'The visit could not be booked',
        );
        done += 1;
      } catch (e) {
        refused.push(`${s.visit.visitNumber}: ${(e as Error).message}`);
      }
    }
    if (done > 0) setNotice(`${done} ${plural(done, 'visit', 'visits')} booked. ${done === 1 ? 'It is' : 'They are'} on the week and the technician's day.`);
    if (refused.length > 0) setFailure(refused.join(' '));
    setBusy(false);
    setReloadToken((n) => n + 1);
  }

  function onDrop(tech: ScheduleTechnician, date: string, visitId: string): void {
    setOver(null);
    const v = data?.overdue.find((o) => o.id === visitId);
    if (!v) return;
    void book([{ visit: v, technicianId: tech.id, technicianName: tech.name, date, slotFrom: v.slotFrom ?? DEFAULT_SLOT.from, slotTo: v.slotTo ?? DEFAULT_SLOT.to }]);
  }

  if (error) {
    return <EmptyState title="The schedule did not load" body={`${error}. Nothing has been changed — reload to try again.`} />;
  }
  if (!data) {
    return (
      <div className="schedule-week">
        <div className="sc-head">
          <div>
            <h1 className="sc-title">Schedule</h1>
            <p className="sc-sub">Loading the week.</p>
          </div>
        </div>
        <div className="sc-card" style={{ padding: 22 }}>
          <Skeleton lines={8} />
        </div>
      </div>
    );
  }

  const seatBreaches = data.licence.flatMap((l) =>
    data.dates.filter((d) => (l.seatsUsedPerDate[d] ?? 0) > l.seats).map((d) => ({ provider: l.providerCode, date: d, used: l.seatsUsedPerDate[d] ?? 0, seats: l.seats })),
  );
  const techs = data.technicians;
  const dayOf = (t: ScheduleTechnician, d: string): ScheduleTechnicianDay => t.days.find((x) => x.date === d) ?? emptyDay(d);
  const weekUnits = techs.reduce((n, t) => n + t.dailyCapacityUnits * data.dates.length, 0);
  const weekSites = techs.reduce((n, t) => n + t.maxSitesPerDay * data.dates.length, 0);
  const bookedWeek = techs.reduce((n, t) => n + t.days.reduce((m, d) => m + d.bookedUnits, 0), 0);
  const sitesWeek = techs.reduce((n, t) => n + t.days.reduce((m, d) => m + d.sites, 0), 0);
  const overdueUnits = data.overdue.reduce((n, v) => n + v.units, 0);
  const suggestedDays = [...new Set(suggested.map((s) => s.date))].sort();
  const suggestedFor = (visitId: string): Suggestion | undefined => plan.placed.find((s) => s.visit.id === visitId);
  const planOn = (techId: string, d: string): Suggestion[] => suggested.filter((s) => s.technicianId === techId && s.date === d);
  const firstName = (name: string): string => name.split(' ')[0] ?? name;
  const dayRange =
    suggestedDays.length === 1
      ? dayLabel(suggestedDays[0]!)
      : `${WEEKDAYS[dateOf(suggestedDays[0]!).getUTCDay()]}–${WEEKDAYS[dateOf(suggestedDays[suggestedDays.length - 1]!).getUTCDay()]}`;

  return (
    <div className="schedule-week">
      <div className="sc-head">
        <div>
          <h1 className="sc-title">Schedule</h1>
          <p className="sc-sub">
            Week of {weekLabel(data.from, data.to)} · {techs.length} {plural(techs.length, 'technician', 'technicians')}
          </p>
        </div>
        <div className="sc-weeknav">
          <button type="button" className="sc-icon" aria-label="Previous week" onClick={() => setFrom(shiftDate(data.from, -7))}>
            <PrevIcon />
          </button>
          <button type="button" className="sc-btn" onClick={() => setFrom('')}>
            This week
          </button>
          <button type="button" className="sc-icon" aria-label="Next week" onClick={() => setFrom(shiftDate(data.from, 7))}>
            <NextIcon />
          </button>
          <input type="date" className="sc-date" aria-label="Week beginning" value={from || data.from} onChange={(e) => setFrom(e.target.value)} />
        </div>
      </div>

      <div className="sc-stats">
        <div className="sc-stat">
          <span className="sc-stat__label">Booked this week</span>
          <span className="sc-stat__value">
            {bookedWeek}
            <small>of {weekUnits} units</small>
          </span>
          <span className="sc-stat__bar" aria-hidden="true">
            <span style={{ width: pct(bookedWeek, weekUnits) }} />
          </span>
        </div>
        <div className="sc-stat">
          <span className="sc-stat__label">Site slots used</span>
          <span className="sc-stat__value">
            {sitesWeek}
            <small>of {weekSites}</small>
          </span>
          <span className="sc-stat__bar" aria-hidden="true">
            <span style={{ width: pct(sitesWeek, weekSites) }} />
          </span>
        </div>
        <div className={cn('sc-stat', data.overdue.length > 0 && 'sc-stat--bad')}>
          <span className="sc-stat__label">Overdue visits waiting for a day</span>
          <span className="sc-stat__value">
            {data.overdue.length}
            <small>
              {plural(data.overdue.length, 'visit', 'visits')} · {overdueUnits} {plural(overdueUnits, 'unit', 'units')}
            </small>
          </span>
        </div>
      </div>

      {seatBreaches.length > 0 && (
        <div role="alert" className="sc-alert" data-testid="seat-breach">
          <strong>More technicians than licence seats</strong>
          <ul>
            {seatBreaches.map((b) => (
              <li key={`${b.provider}-${b.date}`}>
                {b.date}: {b.used} technicians scheduled against {b.seats} {b.provider} seats.
              </li>
            ))}
          </ul>
          <p>The cap is enforced inside the tool, not by us. Whoever is over the line will not be able to certify anything that day.</p>
        </div>
      )}
      {notice && (
        <p role="status" className="sc-note">
          {notice}
        </p>
      )}
      {failure && (
        <p role="alert" className="sc-note sc-note--bad">
          {failure}
        </p>
      )}

      <div className="sc-card">
        <div className="sc-grid" role="table" aria-label={`Technician availability and booked capacity, ${data.from} to ${data.to}`}>
          <div className="sc-corner" role="columnheader">
            Technician
          </div>
          {data.dates.map((d) => (
            <div key={d} role="columnheader" className={cn('sc-dh', d === data.today && 'sc-dh--today', d < data.today && 'sc-dh--past')}>
              <div className="sc-dh__w">{WEEKDAYS[dateOf(d).getUTCDay()]}</div>
              <div className="sc-dh__d">
                {dateOf(d).getUTCDate()} <span className="sc-dh__m">{MONTHS[dateOf(d).getUTCMonth()]}</span>
                {d === data.today && <span className="sc-dh__tag">Today</span>}
              </div>
            </div>
          ))}
          {techs.length === 0 && (
            <div className="sc-empty">
              <EmptyState title="No technicians available this week" body="Every technician is on leave, travelling, or none has been set up yet." />
            </div>
          )}
          {techs.map((t) => {
            const bookedT = t.days.reduce((n, d) => n + d.bookedUnits, 0);
            const suggestedT = suggested.filter((s) => s.technicianId === t.id).reduce((n, s) => n + s.visit.units, 0);
            return (
              <React.Fragment key={t.id}>
                <div className="sc-tech" role="rowheader">
                  <div className="sc-tech__top">
                    <span className="sc-avatar" aria-hidden="true">
                      {initials(t.name)}
                    </span>
                    <div>
                      <div className="sc-tech__name">{t.name}</div>
                      <div className="sc-tech__meta mono">{t.employeeCode}</div>
                    </div>
                  </div>
                  {(t.zones.length > 0 || t.certifiedTools.length > 0) && (
                    <div className="sc-tags">
                      {t.zones.map((z) => (
                        <span key={z}>{z}</span>
                      ))}
                      {t.certifiedTools.map((tool) => (
                        <span key={tool}>{tool === 'DEVICESURE' ? 'DeviceSure' : tool}</span>
                      ))}
                    </div>
                  )}
                  <div className="sc-tech__load">
                    This week: <strong>{bookedT}</strong> booked
                    {suggestedT > 0 && (
                      <>
                        {' '}
                        + <strong>{suggestedT}</strong> suggested
                      </>
                    )}{' '}
                    of <strong>{t.dailyCapacityUnits * data.dates.length}</strong> units
                  </div>
                  <div className="sc-tech__load">
                    Daily limit: {t.dailyCapacityUnits} units · {t.maxSitesPerDay} sites
                  </div>
                </div>
                {data.dates.map((d) => {
                  const day = dayOf(t, d);
                  const key = `${t.id}|${d}`;
                  return (
                    <DayCell
                      key={key}
                      tech={t}
                      day={day}
                      today={data.today}
                      plan={planOn(t.id, d)}
                      droppable={canBook && d > data.today && !isWeekend(d)}
                      over={over === key}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (over !== key) setOver(key);
                      }}
                      onDragLeave={() => setOver((o) => (o === key ? null : o))}
                      onDrop={(e) => {
                        e.preventDefault();
                        onDrop(t, d, e.dataTransfer.getData('text/plain'));
                      }}
                    />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>

        {suggested.length > 0 && canBook && (
          <div className="sc-plan">
            <SparkIcon />
            <span>
              <strong>Suggested plan:</strong>{' '}
              {plan.unplaced.length === 0 ? `fit all ${suggested.length} overdue ${plural(suggested.length, 'visit', 'visits')}` : `fit ${suggested.length} of ${suggested.length + plan.unplaced.length} overdue visits`} into{' '}
              {dayRange}
              {techs.length === 1 ? ` inside ${firstName(techs[0]!.name)}'s daily limit` : ' inside each technician’s daily limit'}. Dashed cards are not booked yet.
              {plan.unplaced.length > 0 && ` ${plan.unplaced.length} ${plural(plan.unplaced.length, 'needs', 'need')} a later week or a technician.`}
            </span>
            <span className="spacer" />
            <button type="button" className="sc-btn sc-btn--sm" onClick={() => setDismissed(true)}>
              Dismiss
            </button>
            <button type="button" className="sc-btn sc-btn--primary sc-btn--sm" disabled={busy} onClick={() => void book(suggested)}>
              {busy ? 'Booking…' : 'Book suggested plan'}
            </button>
          </div>
        )}
      </div>

      <section aria-labelledby="sc-tray-h" className="sc-tray">
        <div className="sc-tray__head">
          <h2 id="sc-tray-h">Waiting for a day</h2>
          <span>
            {data.overdue.length === 0
              ? 'Every open visit has a day that has not passed.'
              : canBook
                ? 'Drag a card onto a day to book it'
                : `${data.overdue.length} overdue ${plural(data.overdue.length, 'visit', 'visits')}`}
          </span>
        </div>
        {data.overdue.length > 0 && (
          <div className="sc-tray__list">
            {data.overdue.map((v) => {
              const s = suggestedFor(v.id);
              return (
                <div
                  key={v.id}
                  className="sc-wait"
                  draggable={canBook}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', v.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setOver(null)}
                >
                  <div className="sc-wait__top">
                    <Link to={`/qc/visits/${v.id}`} className="sc-wait__id">
                      {v.visitNumber.slice(-8)}
                    </Link>
                    <span className="sc-wait__late">
                      {v.daysLate} {plural(v.daysLate, 'day', 'days')} overdue
                    </span>
                  </div>
                  <span className="sc-wait__sp">{shortName(v.vendorName)}</span>
                  <span className="sc-wait__meta">
                    {v.units} {plural(v.units, 'unit', 'units')} · {v.technicianName ?? <span className="warn">no technician</span>}
                  </span>
                  {s && !dismissed && <span className="sc-wait__go">Suggested: {dayLabel(s.date)}</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
