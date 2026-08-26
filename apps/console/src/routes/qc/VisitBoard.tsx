import * as React from 'react';
import { Link } from 'react-router';
import {
  DataBoard,
  EmptyState,
  StatusPill,
  type Column,
  type StatusPillProps,
} from '@trugrade/ui';
import { Board, DateField, NotMeasured, PageHeader, Select } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { qs } from './api';
import { VISIT_STATUSES, type VisitRow, type VisitStatus } from './types';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
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
 *
 * Every filter is in the query string. "The three visits Ramesh has in Gurugram
 * next Tuesday" has to be a link someone can paste into chat.
 */

const STATUS_TONE: Readonly<Record<VisitStatus, StatusPillProps['tone']>> = Object.freeze({
  REQUESTED: 'neutral',
  QUOTED: 'neutral',
  // Not amber: a scheduled visit is a future fact, not an active state. Amber
  // stays for EN_ROUTE and IN_PROGRESS, which `processing` already carries.
  SCHEDULED: 'neutral',
  TECH_ASSIGNED: 'neutral',
  EN_ROUTE: 'processing',
  IN_PROGRESS: 'processing',
  COMPLETED: 'pass',
  PARTIALLY_COMPLETED: 'warn',
  CANCELLED: 'neutral',
  NO_SHOW_VENDOR: 'fail',
  NO_SHOW_TECH: 'fail',
  RESCHEDULED: 'warn',
});

const humanise = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function GeoCell({ visit }: { visit: VisitRow }): React.JSX.Element {
  if (visit.geoVarianceMetres === null) {
    return <NotMeasured why="The technician has not checked in yet" label="Not checked in" />;
  }
  const over = visit.geoVarianceMetres > visit.geoVarianceAlertMetres;
  return (
    <span className={over ? 'font-semibold text-fail' : 'text-ink-2'}>
      <span className="font-mono tnum">{visit.geoVarianceMetres} m</span>
      {over && (
        <span className="block text-body-sm">
          over the {visit.geoVarianceAlertMetres} m alert threshold
        </span>
      )}
    </span>
  );
}

const COLUMNS: ReadonlyArray<Column<VisitRow>> = [
  {
    key: 'visit',
    header: 'Visit',
    cell: (v) => (
      <Link
        to={`/qc/visits/${v.id}`}
        className="whitespace-nowrap font-mono text-data text-acc-ink underline decoration-rule underline-offset-4"
      >
        {v.visitNumber}
      </Link>
    ),
  },
  {
    key: 'vendor',
    header: 'Vendor and site',
    cell: (v) => (
      <>
        {v.vendorName}
        <span className="block text-body-sm text-ink-3">{v.facilityLabel}</span>
      </>
    ),
  },
  {
    key: 'scheduled',
    header: 'Scheduled',
    cell: (v) =>
      v.scheduledDate === null ? (
        <NotMeasured why="This visit has no date yet" label="Not scheduled" />
      ) : (
        <>
          <span className="font-mono tnum">{v.scheduledDate}</span>
          {v.slotFrom && (
            <span className="block font-mono text-body-sm tnum text-ink-3">
              {v.slotFrom}–{v.slotTo}
            </span>
          )}
        </>
      ),
  },
  {
    key: 'technician',
    header: 'Technician',
    cell: (v) =>
      v.technicianName ?? (
        <NotMeasured why="No technician has been assigned yet" label="Not assigned" />
      ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (v) => (
      <StatusPill
        tone={STATUS_TONE[v.status]}
        label={humanise(v.status)}
        className="whitespace-nowrap"
      />
    ),
  },
  {
    key: 'units',
    header: 'Units',
    cell: (v) => (
      <>
        <span className="font-mono tnum text-ink">
          {v.unitsInspected}/{v.unitsRequested} inspected
        </span>
        <span className="block text-body-sm text-ink-2">
          {v.unitsPassed} passed · {v.unitsGradeCorrected} corrected · {v.unitsFailed} failed
        </span>
        {v.unitsAbsent > 0 && (
          <span className="block text-body-sm text-warn">{v.unitsAbsent} not presented</span>
        )}
      </>
    ),
  },
  { key: 'geo', header: 'Check-in variance', cell: (v) => <GeoCell visit={v} /> },
];

export function VisitBoardRoute(): React.JSX.Element {
  const [status, setStatus] = useUrlState('status');
  const [technicianId, setTechnicianId] = useUrlState('technicianId');
  const [vendorOrgId, setVendorOrgId] = useUrlState('vendorOrgId');
  const [from, setFrom] = useUrlState('from');
  const [to, setTo] = useUrlState('to');

  const url = `/api/qc/visits${qs({ status, technicianId, vendorOrgId, from, to })}`;
  const { data, error } = useResource<VisitRow[]>(url, 'The visit board is unavailable');

  // Derived from the loaded page rather than fetched: the filter is a
  // convenience over what is on screen, and a second round trip to populate two
  // dropdowns is a round trip that can fail on its own.
  const technicians = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of data ?? [])
      if (v.technicianId) seen.set(v.technicianId, v.technicianName ?? v.technicianId);
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
        (a, b) =>
          (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') ||
          a.visitNumber.localeCompare(b.visitNumber),
      ),
    [data],
  );

  const alerts = rows.filter(
    (v) => v.geoVarianceMetres !== null && v.geoVarianceMetres > v.geoVarianceAlertMetres,
  ).length;

  return (
    <div className="tg-stack">
      <PageHeader title="QC visits">
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
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-5">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
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
        <DateField
          id="visit-from"
          label="Scheduled from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <DateField
          id="visit-to"
          label="Scheduled to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {error ? (
        <EmptyState
          title="The visit board did not load"
          body={`${error}. Nothing has been changed — reload to try again.`}
        />
      ) : (
        <Board>
          <DataBoard
            caption={data ? `${rows.length} QC visits, soonest first.` : 'Loading the visit board.'}
            columns={COLUMNS}
            rows={rows}
            rowKey={(v) => v.id}
            loading={!data}
            skeletonRows={8}
            empty={
              <EmptyState
                title="No visits match"
                body="Widen the filters, or wait for a vendor to request an inspection."
              />
            }
          />
        </Board>
      )}
    </div>
  );
}
