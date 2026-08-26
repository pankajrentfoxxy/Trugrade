import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { qs } from './api';
import { TD, TH } from './controls';
import type { ScheduleTechnician, ScheduleTechnicianDay, ScheduleWeek } from './types';

/**
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
    <td
      data-state={unavailable ? 'unavailable' : tone}
      className={[
        'border-l border-rule-2 px-2 py-3 align-top text-body-sm',
        unavailable ? 'bg-sheet-2 text-ink-3' : '',
        tone === 'over' ? 'bg-sheet-2 text-fail' : '',
      ].join(' ')}
    >
      {unavailable ? (
        <span className="font-mono text-label uppercase tracking-[0.13em]">
          {day.availability.toLowerCase()}
        </span>
      ) : (
        <>
          <span className="tnum block">
            {day.bookedUnits}/{tech.dailyCapacityUnits} units
          </span>
          <span className="tnum block text-ink-3">
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
    </td>
  );
}

export function ScheduleRoute(): React.JSX.Element {
  const [from, setFrom] = React.useState('');
  const { data, error } = useResource<ScheduleWeek>(
    `/api/qc/schedule${qs({ from })}`,
    'The schedule is unavailable',
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
      .map((d) => ({ provider: l.providerCode, date: d, used: l.seatsUsedPerDate[d] ?? 0, seats: l.seats })),
  );

  return (
    <div>
      <h1 className="text-h1 text-ink">Scheduling</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        {data.from} to {data.to} · {data.technicians.length} technicians
      </p>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="week-from" className="text-body-sm font-medium text-ink-2">
            Week beginning
          </label>
          <input
            id="week-from"
            type="date"
            value={from || data.from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11 rounded border border-rule bg-sheet px-4 text-body-sm text-ink"
          />
        </div>
        <div className="flex flex-wrap gap-3">
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
          className="mt-5 rounded-lg border border-fail bg-sheet-2 p-5 text-body-sm text-fail"
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

      {data.technicians.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No technicians available this week"
          body="Every technician is on leave, travelling, or none has been set up yet."
        />
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Technician availability and booked capacity, by day.
            </caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className={TH}>
                  Technician
                </th>
                {data.dates.map((d) => (
                  <th key={d} scope="col" className={`${TH} border-l border-rule`}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.technicians.map((t) => (
                <tr key={t.id} className="border-b border-rule-2">
                  <th scope="row" className={`${TD} font-normal`}>
                    {t.name}
                    <span className="block font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                      {t.employeeCode} · {t.zones.join(', ') || 'no zone'} ·{' '}
                      {t.certifiedTools.join(', ') || 'no certified tool'}
                    </span>
                  </th>
                  {data.dates.map((d) => {
                    const day = t.days.find((x) => x.date === d) ?? {
                      date: d,
                      availability: 'UNSET' as const,
                      bookedUnits: 0,
                      sites: 0,
                      visits: [],
                    };
                    return <DayCell key={d} tech={t} day={day} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
