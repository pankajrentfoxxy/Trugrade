import * as React from 'react';
import { Link } from 'react-router';
import { DataBoard, EmptyState, Skeleton, StatusPill, cn, type Column } from '@trugrade/ui';
import { Board, DateField, PageHeader } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { qs } from './api';
import type { ScheduleTechnician, ScheduleTechnicianDay, ScheduleWeek } from './types';

/**
 * ARCHETYPE B — Board. One row per technician, one column per day.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * A week of technicians against a week of days.
 *
 * Two capacities constrain a QC week, they fail in completely different ways,
 * and a calendar that shows only the first is the one that produces the bad day:
 *
 * **Per-technician capacity** — `daily_capacity_units` (40) and
 * `max_sites_per_day` (3). Overbooking here means a technician runs out of
 * daylight, which is visible in advance and recoverable.
 *
 * **Licence seats** — `qc_tool_provider.licence_seats` is a hard cap on how many
 * technicians can be certifying at once, enforced inside DeviceSure and not by
 * us. Overbooking here means the thirteenth technician's agent refuses to
 * certify, in a warehouse, with the vendor watching, and nothing on our side can
 * fix it that morning. It gets the loud banner.
 *
 * The week comes from the server — including which week "this week" is. A
 * browser clock deciding what today means is how a scheduler quietly shows the
 * wrong week to somebody in a different timezone.
 */

function capacityTone(day: ScheduleTechnicianDay, tech: ScheduleTechnician): 'over' | 'full' | 'ok' {
  if (day.bookedUnits > tech.dailyCapacityUnits || day.sites > tech.maxSitesPerDay) return 'over';
  if (day.bookedUnits === tech.dailyCapacityUnits || day.sites === tech.maxSitesPerDay)
    return 'full';
  return 'ok';
}

const UNAVAILABLE = new Set(['LEAVE', 'TRAVEL', 'HOLIDAY']);

function DayCell({
  tech,
  day,
}: {
  tech: ScheduleTechnician;
  day: ScheduleTechnicianDay;
}): React.JSX.Element {
  const tone = capacityTone(day, tech);
  const unavailable = UNAVAILABLE.has(day.availability);

  return (
    <div
      data-state={unavailable ? 'unavailable' : tone}
      className={cn(
        'flex flex-col text-body-sm',
        unavailable && 'text-ink-3',
        // Over capacity is a FAIL: the day will not fit. WARN would read as
        // "keep an eye on it", which is the wrong instruction for a day that is
        // already impossible.
        tone === 'over' && 'text-fail',
      )}
    >
      {unavailable ? (
        <span className="font-mono text-label uppercase tracking-[0.13em]">
          {day.availability.toLowerCase()}
        </span>
      ) : (
        <>
          <span className="block font-mono tnum">
            {day.bookedUnits}/{tech.dailyCapacityUnits} units
          </span>
          <span className="block font-mono tnum text-ink-3">
            {day.sites}/{tech.maxSitesPerDay} sites
          </span>
          {day.visits.map((v) => (
            <Link
              key={v.id}
              to={`/qc/visits/${v.id}`}
              className="mt-1 block truncate text-acc-ink underline decoration-rule underline-offset-2"
              title={`${v.visitNumber} · ${v.vendorName} · ${v.units} units`}
            >
              {v.vendorName}
            </Link>
          ))}
          {tone === 'over' && (
            <span className="mt-1 block font-semibold">Over capacity — this day will not fit</span>
          )}
        </>
      )}
    </div>
  );
}

export function ScheduleRoute(): React.JSX.Element {
  // In the URL, so "the week of the 14th" is a link and not a click path.
  const [from, setFrom] = useUrlState('from');
  const { data, error } = useResource<ScheduleWeek>(
    `/api/qc/schedule${qs({ from })}`,
    'The schedule is unavailable',
  );

  const columns = React.useMemo<ReadonlyArray<Column<ScheduleTechnician>>>(
    () => [
      {
        key: 'technician',
        header: 'Technician',
        cell: (t) => (
          <>
            {t.name}
            <span className="block font-mono text-label uppercase tracking-[0.13em] text-ink-3">
              {t.employeeCode} · {t.zones.join(', ') || 'no zone'} ·{' '}
              {t.certifiedTools.join(', ') || 'no certified tool'}
            </span>
          </>
        ),
      },
      ...(data?.dates ?? []).map((d) => ({
        key: d,
        header: d,
        cell: (t: ScheduleTechnician) => {
          const day = t.days.find((x) => x.date === d) ?? {
            date: d,
            availability: 'UNSET' as const,
            bookedUnits: 0,
            sites: 0,
            visits: [],
          };
          return <DayCell tech={t} day={day} />;
        },
      })),
    ],
    [data],
  );

  if (error) {
    return (
      <EmptyState
        title="The schedule did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;

  const seatBreaches = data.licence.flatMap((l) =>
    data.dates
      .filter((d) => (l.seatsUsedPerDate[d] ?? 0) > l.seats)
      .map((d) => ({
        provider: l.providerCode,
        date: d,
        used: l.seatsUsedPerDate[d] ?? 0,
        seats: l.seats,
      })),
  );

  return (
    <div className="tg-stack">
      <PageHeader title="Scheduling">
        {data.from} to {data.to} · {data.technicians.length} technicians
      </PageHeader>

      <div className="flex flex-wrap items-end gap-4">
        <DateField
          id="week-from"
          label="Week beginning"
          value={from || data.from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <div className="flex flex-wrap gap-3 pb-2">
          {data.licence.map((l) => (
            <StatusPill
              key={l.providerCode}
              tone={seatBreaches.some((b) => b.provider === l.providerCode) ? 'fail' : 'neutral'}
              label={`${l.providerCode} · ${l.seats} seats`}
            />
          ))}
        </div>
      </div>

      {seatBreaches.length > 0 && (
        <div
          role="alert"
          className="tg-card rounded-lg border border-fail bg-sheet-2 text-body-sm text-fail"
          data-testid="seat-breach"
        >
          <strong className="block text-h3">More technicians than licence seats</strong>
          <ul className="mt-2 list-disc pl-5">
            {seatBreaches.map((b) => (
              <li key={`${b.provider}-${b.date}`}>
                {b.date}: {b.used} technicians scheduled against {b.seats} {b.provider} seats.
              </li>
            ))}
          </ul>
          <p className="mt-2">
            The cap is enforced inside the tool, not by us. Whoever is over the line will not be able
            to certify anything that day.
          </p>
        </div>
      )}

      <Board>
        <DataBoard
          caption={`Technician availability and booked capacity for ${data.from} to ${data.to}.`}
          columns={columns}
          rows={data.technicians}
          rowKey={(t) => t.id}
          empty={
            <EmptyState
              title="No technicians available this week"
              body="Every technician is on leave, travelling, or none has been set up yet."
            />
          }
        />
      </Board>
    </div>
  );
}
