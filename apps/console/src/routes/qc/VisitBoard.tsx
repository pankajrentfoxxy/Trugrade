import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, Skeleton, StatusPill, type StatusPillProps } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { qs } from './api';
import { Blank, Select, TD, TH } from './controls';
import { VISIT_STATUSES, type VisitRow, type VisitStatus } from './types';

/**
 * Every visit, by status, technician, date and vendor.
 *
 * The board is sorted by scheduled date because a QC manager's question is
 * almost always "what is happening, and what is late" rather than "show me
 * everything". Two things are pulled out of the row and given their own column
 * for the same reason:
 *
 * **Geo variance.** A technician checking in a long way from the registered
 * warehouse is the cheapest fraud signal in the phase, and it is worthless
 * buried inside a detail page nobody opens. The alert threshold travels on the
 * row (`qc.geo_variance_alert_metres`) so this screen never renders 500 from a
 * literal that stops being true the day someone changes the key.
 *
 * **Absent units.** A visit that inspected 30 of 40 because ten machines were
 * not there is not a successful visit, and `units_absent` is the number that
 * says so. `v_visit_economics` costs a visit per *inspected* unit, so absences
 * are the thing quietly making QC-at-source uneconomic.
 */

const STATUS_TONE: Readonly<Record<VisitStatus, StatusPillProps['tone']>> = Object.freeze({
  REQUESTED: 'neutral',
  QUOTED: 'neutral',
  SCHEDULED: 'info',
  TECH_ASSIGNED: 'info',
  EN_ROUTE: 'processing',
  IN_PROGRESS: 'processing',
  COMPLETED: 'pass',
  PARTIALLY_COMPLETED: 'warn',
  CANCELLED: 'neutral',
  NO_SHOW_VENDOR: 'fail',
  NO_SHOW_TECH: 'fail',
  RESCHEDULED: 'warn',
});

const humanise = (s: string): string =>
  s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function GeoCell({ visit }: { visit: VisitRow }): React.JSX.Element {
  if (visit.geoVarianceMetres === null) {
    return <Blank why="The technician has not checked in yet" />;
  }
  const over = visit.geoVarianceMetres > visit.geoVarianceAlertMetres;
  return (
    <span className={over ? 'font-semibold text-fail' : 'text-ink-2'}>
      <span className="tnum">{visit.geoVarianceMetres} m</span>
      {over && (
        <span className="block text-body-sm">
          over the {visit.geoVarianceAlertMetres} m alert threshold
        </span>
      )}
    </span>
  );
}

export function VisitBoardRoute(): React.JSX.Element {
  const [status, setStatus] = React.useState<VisitStatus | ''>('');
  const [technicianId, setTechnicianId] = React.useState('');
  const [vendorOrgId, setVendorOrgId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  const url = `/api/qc/visits${qs({ status, technicianId, vendorOrgId, from, to })}`;
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
    return [...seen].map(([id, name]) => ({ value: id, label: name }));
  }, [data]);

  const rows = React.useMemo(
    () =>
      [...(data ?? [])].sort(
        (a, b) => (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') ||
          a.visitNumber.localeCompare(b.visitNumber),
      ),
    [data],
  );

  const alerts = rows.filter(
    (v) => v.geoVarianceMetres !== null && v.geoVarianceMetres > v.geoVarianceAlertMetres,
  ).length;

  return (
    <div>
      <h1 className="text-h1 text-ink">QC visits</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        One technician, one vendor site, one day.
        {alerts > 0 && (
          <>
            {' '}
            <span className="font-semibold text-fail">
              {alerts} {alerts === 1 ? 'visit' : 'visits'} checked in outside the registered
              warehouse
            </span>
            .
          </>
        )}
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-5">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as VisitStatus | '')}
          options={[
            { value: '', label: 'Any status' },
            ...VISIT_STATUSES.map((s) => ({ value: s, label: humanise(s) })),
          ]}
        />
        <Select
          label="Technician"
          value={technicianId}
          onChange={(e) => setTechnicianId(e.target.value)}
          options={[{ value: '', label: 'Any technician' }, ...technicians]}
        />
        <Select
          label="Vendor"
          value={vendorOrgId}
          onChange={(e) => setVendorOrgId(e.target.value)}
          options={[{ value: '', label: 'Any vendor' }, ...vendors]}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="visit-from" className="text-body-sm font-medium text-ink-2">
            Scheduled from
          </label>
          <input
            id="visit-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11 rounded border border-rule bg-sheet px-4 text-body-sm text-ink"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="visit-to" className="text-body-sm font-medium text-ink-2">
            Scheduled to
          </label>
          <input
            id="visit-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11 rounded border border-rule bg-sheet px-4 text-body-sm text-ink"
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          className="mt-6"
          title="The visit board did not load"
          body={`${error}. Nothing has been changed — reload to try again.`}
        />
      ) : !data ? (
        <div className="mt-6">
          <Skeleton lines={8} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No visits match"
          body="Widen the filters, or wait for a vendor to request an inspection."
        />
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">QC visits, soonest first.</caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className={TH}>
                  Visit
                </th>
                <th scope="col" className={TH}>
                  Vendor and site
                </th>
                <th scope="col" className={TH}>
                  Scheduled
                </th>
                <th scope="col" className={TH}>
                  Technician
                </th>
                <th scope="col" className={TH}>
                  Status
                </th>
                <th scope="col" className={TH}>
                  Units
                </th>
                <th scope="col" className={TH}>
                  Check-in variance
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-rule-2 hover:bg-sheet-2">
                  <td className={TD}>
                    <Link
                      to={`/qc/visits/${v.id}`}
                      className="font-mono text-data text-acc-ink underline decoration-rule underline-offset-4"
                    >
                      {v.visitNumber}
                    </Link>
                  </td>
                  <td className={TD}>
                    {v.vendorName}
                    <span className="block text-body-sm text-ink-3">{v.facilityLabel}</span>
                  </td>
                  <td className={`${TD} tnum`}>
                    {v.scheduledDate ?? <Blank why="Not scheduled yet" />}
                    {v.slotFrom && (
                      <span className="block text-body-sm text-ink-3">
                        {v.slotFrom}–{v.slotTo}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    {v.technicianName ?? <Blank why="No technician assigned yet" />}
                  </td>
                  <td className={TD}>
                    <StatusPill tone={STATUS_TONE[v.status]} label={humanise(v.status)} />
                  </td>
                  <td className={`${TD} tnum`}>
                    <span className="text-ink">
                      {v.unitsInspected}/{v.unitsRequested} inspected
                    </span>
                    <span className="block text-body-sm text-ink-2">
                      {v.unitsPassed} passed · {v.unitsGradeCorrected} corrected · {v.unitsFailed}{' '}
                      failed
                    </span>
                    {v.unitsAbsent > 0 && (
                      <span className="block text-body-sm text-warn">
                        {v.unitsAbsent} not presented
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <GeoCell visit={v} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
