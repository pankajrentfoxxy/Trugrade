import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Breadcrumb,
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SealChip,
  SidePanel,
  Skeleton,
  StatusPill,
  TickRule,
  type Column,
  type SealStatus,
  type StatusPillProps,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import {
  Board,
  Datum,
  NotMeasured,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import {
  API,
  VISIT_STATUSES,
  onDate,
  onDateTime,
  postJson,
  rupees,
  type FacilityCalendar,
  type UnitOutcome,
  type VendorVisit,
  type VendorVisitDetail,
  type VisitFee,
  type VisitManifestUnit,
  type VisitStatus,
} from './api';

/**
 * The vendor's side of an inspection: the visits they have asked for, the day
 * one is booked, and what we found.
 *
 * ARCHETYPE B (`/vendor/qc/visits`), ARCHETYPE C (`/vendor/qc/visits/:id`) and
 * ARCHETYPE B again for the results (`/vendor/qc/visits/:id/results`).
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * ## Why these are not the ops console's visit screens
 *
 * `apps/console/src/routes/qc/VisitBoard.tsx` and `VisitDetail.tsx` are a QC
 * manager's queues: they span every vendor, name each one, and show the
 * technician's geo variance, the raw tool payloads and the seal photographs.
 * Four vendor roles used to hold the permission behind them, so a vendor could
 * open a competitor's manifest by id. That is closed at the API, and this file
 * is the other half of the fix — the same domain, a different audience, no
 * shared route and no shared payload.
 *
 * ## The three rules this screen exists to keep
 *
 * **A visit that has not happened has no result.** Every count, score, grade and
 * seal is absent rather than zero until a technician has actually opened the
 * machine. A `0` in a score column and an empty seal cell both read as findings,
 * and the finding they imply is the wrong one. "Not inspected yet" in `--ink-4`,
 * every time.
 *
 * **`UNTESTABLE` is not a failure.** It is where a serial mismatch lands: we
 * could not measure the machine, which is a different claim from "it failed" and
 * is precisely what a vendor's appeal turns on. Green and red are PASS and FAIL
 * only — a visit STATUS is never either, and `NO_SHOW_VENDOR` is not red.
 *
 * **The fee is never a bare zero.** `₹0` reads as "nothing to pay" whether the
 * truth is a waiver, our cost, or a visit nobody has priced. See `FeeLine`.
 */

/* ==========================================================================
 * Tones — the place this screen is most likely to go wrong
 * ======================================================================== */

/**
 * A visit status is not a verdict on anything.
 *
 * Nothing here is `pass` or `fail`. A completed visit is not a PASS — the
 * verdicts belong to the machines and the results screen spends them there — and
 * a vendor who was out when we arrived has not FAILED. The statuses that need
 * somebody to do something are `warn`, which is outlined and reads as an
 * instruction; the live ones are `processing`; everything else is neutral and
 * carries its meaning in its own label.
 */
const STATUS_TONE: Readonly<Record<VisitStatus, StatusPillProps['tone']>> = Object.freeze({
  REQUESTED: 'neutral',
  QUOTED: 'neutral',
  SCHEDULED: 'neutral',
  TECH_ASSIGNED: 'neutral',
  EN_ROUTE: 'processing',
  IN_PROGRESS: 'processing',
  COMPLETED: 'neutral',
  PARTIALLY_COMPLETED: 'warn',
  CANCELLED: 'neutral',
  NO_SHOW_VENDOR: 'warn',
  NO_SHOW_TECH: 'warn',
  RESCHEDULED: 'warn',
});

/** What each status means to the vendor, rather than what the column contains. */
const STATUS_LABEL: Readonly<Record<VisitStatus, string>> = Object.freeze({
  REQUESTED: 'Requested',
  QUOTED: 'Quoted',
  SCHEDULED: 'Date booked',
  TECH_ASSIGNED: 'Technician assigned',
  EN_ROUTE: 'On the way',
  IN_PROGRESS: 'Inspecting now',
  COMPLETED: 'Completed',
  PARTIALLY_COMPLETED: 'Completed in part',
  CANCELLED: 'Cancelled',
  NO_SHOW_VENDOR: 'Nobody at the site',
  NO_SHOW_TECH: 'We did not arrive',
  RESCHEDULED: 'Being rescheduled',
});

const OUTCOME_TONE: Readonly<Record<UnitOutcome, StatusPillProps['tone']>> = Object.freeze({
  PENDING: 'neutral',
  PASS: 'pass',
  // Not green: the grade moved, and the machine is priced at the new one. Not
  // red either — it passed. `warn` says the one true thing: look at this row.
  PASS_GRADE_CORRECTED: 'warn',
  PASS_WITH_NOTE: 'warn',
  FAIL: 'fail',
  // Not red. "We could not measure it" is not "it failed", and a vendor
  // disputing an untestable machine is disputing a measurement that never
  // happened rather than a verdict against them.
  UNTESTABLE: 'warn',
  // Not red and not a verdict at all: nobody opened this laptop.
  ABSENT: 'neutral',
});

const OUTCOME_LABEL: Readonly<Record<UnitOutcome, string>> = Object.freeze({
  PENDING: 'Not inspected yet',
  PASS: 'Passed',
  PASS_GRADE_CORRECTED: 'Passed at a corrected grade',
  PASS_WITH_NOTE: 'Passed, with a note',
  FAIL: 'Failed',
  UNTESTABLE: 'Could not be measured',
  ABSENT: 'Not presented',
});

const AREA_LABEL = (area: string): string =>
  area.charAt(0) + area.slice(1).toLowerCase().replace(/_/g, ' ');

/* ==========================================================================
 * Shared bits
 * ======================================================================== */

/** The booked day and slot, or the fact that there is not one. */
function When({ v }: { v: VendorVisit }): React.JSX.Element {
  if (v.scheduledDate === null) {
    return (
      <NotMeasured
        why="No date has been agreed for this inspection yet"
        label="Not scheduled yet"
      />
    );
  }
  return (
    <>
      <span className="font-mono tnum text-ink">{v.scheduledDate}</span>
      {v.slotFrom && v.slotTo && (
        <span className="block font-mono text-body-sm tnum text-ink-3">
          {v.slotFrom.slice(0, 5)}–{v.slotTo.slice(0, 5)}
        </span>
      )}
    </>
  );
}

/**
 * How far through the machines this visit is.
 *
 * Every figure carries its denominator, and a visit nobody has arrived at shows
 * no figures at all — `0 of 6 inspected` on a visit booked for next Tuesday is
 * arithmetically true and reads as a bad start.
 */
function Machines({ v }: { v: VendorVisit }): React.JSX.Element {
  if (v.arrivedAt === null) {
    return (
      <>
        <span className="font-mono tnum text-ink">{v.unitsRequested}</span>
        <span className="text-ink-2"> requested</span>
        <span className="block text-body-sm">
          <NotMeasured
            why="Nobody has been to the site, so nothing has been inspected"
            label="Not inspected yet"
          />
        </span>
      </>
    );
  }
  return (
    <>
      <span className="font-mono tnum text-ink">
        {v.unitsInspected} of {v.unitsRequested}
      </span>
      <span className="text-ink-2"> inspected</span>
      {/* No breakdown when nothing was opened. `0 passed, 0 regraded, 0 failed`
          on a visit where the technician arrived and nobody was there reads as a
          fully-measured result of zero - the same defect as a missing value
          rendering as a passing one, pointed the other way. */}
      {v.unitsInspected > 0 ? (
        <span className="block text-body-sm text-ink-2">
          {v.unitsPassed} passed · {v.unitsGradeCorrected} regraded · {v.unitsFailed} failed
        </span>
      ) : (
        <span className="block text-body-sm">
          <NotMeasured
            why="Nobody opened a machine at this visit, so there is nothing measured"
            label="No machine was opened"
          />
        </span>
      )}
      {v.unitsAbsent > 0 && (
        <span className="block text-body-sm text-warn">
          {v.unitsAbsent} not presented on the day
        </span>
      )}
    </>
  );
}

/**
 * The visit fee, said as a sentence rather than shown as a figure.
 *
 * `₹0` on its own is the rendering this component exists to prevent. A vendor
 * looking at a zero cannot tell whether the fee was waived, whether we are
 * bearing it, or whether nobody has priced the visit — and only one of those is
 * a fact they can rely on when the payout statement arrives.
 */
function FeeLine({
  fee,
  units,
  brief = false,
}: {
  fee: VisitFee;
  units: number;
  /**
   * The board's version: the amount and who bears it, on one line.
   *
   * The full sentence is right on a record and wrong on a board — seven rows
   * each carrying "and we stop charging the fee above 50" is one paragraph
   * repeated seven times, and a column nobody can scan is a column nobody
   * reads. The reason lives on the record, one click away, where it is asked
   * for rather than repeated.
   */
  brief?: boolean;
}): React.JSX.Element {
  const nothing = Number(fee.amount) === 0;

  if (fee.bearer === 'WAIVED' || (nothing && fee.waiverReason)) {
    if (brief) return <span className="text-ink-2">Waived - no fee</span>;
    return (
      <>
        <span className="text-ink">No fee for this inspection.</span>{' '}
        <span className="text-ink-2">
          {fee.waiverReason ??
            (fee.waivedAboveUnits === null ? (
              <NotMeasured
                why="The waiver threshold is not configured, so we cannot say what waived it"
                label="Reason not recorded"
              />
            ) : (
              `Waived — a batch over ${fee.waivedAboveUnits} machines carries no visit fee.`
            ))}
        </span>
      </>
    );
  }

  if (fee.bearer === 'TRUETECH') {
    if (brief) return <span className="text-ink-2">Ours &mdash; nothing to pay</span>;
    // A fee of zero borne by us is "this inspection is at our cost", not
    // "Trugrade is bearing the ₹0.00 visit fee" — which is what naming the
    // amount produces on every visit ops file, because `createVisit` prices
    // nothing. The figure only appears when there is one.
    return (
      <>
        <span className="text-ink">Nothing to pay.</span>{' '}
        <span className="text-ink-2">
          {nothing ? (
            'This inspection is at our cost.'
          ) : (
            <>
              Trugrade is bearing the <span className="font-mono tnum">{rupees(fee.amount)}</span>{' '}
              visit fee for this inspection.
            </>
          )}
        </span>
      </>
    );
  }

  if (nothing) {
    // Neither waived nor ours, and no amount: nobody has priced it. That is a
    // gap, and saying so is better than a zero the vendor would plan against.
    return (
      <NotMeasured
        why="No visit fee has been recorded against this inspection yet"
        label="Not priced yet"
      />
    );
  }

  if (brief) {
    return (
      <>
        <span className="font-mono tnum text-ink">{rupees(fee.amount)}</span>
        <span className="block text-body-sm text-ink-3">
          {fee.bearer === 'SPLIT' ? 'shared with us' : 'yours to pay'}
        </span>
      </>
    );
  }

  return (
    <>
      <span className="font-mono tnum text-ink">{rupees(fee.amount)}</span>{' '}
      <span className="text-ink-2">
        {fee.bearer === 'SPLIT' ? 'shared between us' : 'is yours to pay'}
        {fee.waivedAboveUnits !== null && (
          <>
            {' '}
            — {units} {units === 1 ? 'machine' : 'machines'} on this visit, and we stop charging the
            fee above {fee.waivedAboveUnits}.
          </>
        )}
      </span>
    </>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * When we can come to this site, and — the part §3B asks for by name — when we
 * cannot.
 *
 * "Facility hours drive QC visit scheduling and pickup windows — the screen
 * states that a closed day cannot be booked." The scheduler already refuses a
 * holiday and a shut weekday with a 412; a vendor learning the rule by being
 * tripped over it has not been told it.
 *
 * An empty calendar is not a shut warehouse. `assertSiteOpen` treats a facility
 * with no published hours as unconstrained, so this says that rather than
 * drawing a blank week.
 */
function SiteCalendar({ calendar }: { calendar: FacilityCalendar }): React.JSX.Element {
  const open = calendar.hours.filter((h) => !h.isClosed);
  const closed = calendar.hours.filter((h) => h.isClosed);

  if (calendar.hours.length === 0) {
    return (
      <p className="text-body-sm text-ink-2">
        You have not published opening hours for this site, so no day is blocked. Adding them stops
        a technician being sent on a day the warehouse is shut.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-body-sm">
      <ul className="flex flex-col gap-1">
        {open.map((h) => (
          <li key={h.dayOfWeek} className="flex justify-between gap-4">
            <span className="text-ink-2">{DAY_NAMES[h.dayOfWeek]}</span>
            <span className="font-mono tnum text-ink">
              {h.openTime?.slice(0, 5) ?? '—'}–{h.closeTime?.slice(0, 5) ?? '—'}
            </span>
          </li>
        ))}
        {closed.map((h) => (
          <li key={h.dayOfWeek} className="flex justify-between gap-4">
            <span className="text-ink-2">{DAY_NAMES[h.dayOfWeek]}</span>
            <span className="text-ink-4">Closed — cannot be booked</span>
          </li>
        ))}
      </ul>

      {calendar.holidays.length > 0 && (
        <div className="border-t border-rule-2 pt-3">
          <p className="text-ink-2">Days this site is shut and no visit can be booked:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {calendar.holidays.map((d) => (
              <li key={d.date}>
                <span className="font-mono tnum text-ink">{d.date}</span>
                {d.reason && <span className="text-ink-2"> — {d.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
 * The board
 * ======================================================================== */

const BOARD_COLUMNS: ReadonlyArray<Column<VendorVisit>> = [
  {
    key: 'visit',
    header: 'Inspection',
    cell: (v) => (
      <>
        <Link
          to={`/vendor/qc/visits/${v.id}`}
          className="whitespace-nowrap font-mono text-data tnum text-ink underline decoration-rule underline-offset-4"
        >
          {v.visitNumber}
        </Link>
        <span className="block text-body-sm text-ink-3">Requested {onDate(v.requestedAt)}</span>
      </>
    ),
  },
  {
    key: 'site',
    header: 'Site',
    cell: (v) =>
      v.siteLabel || (
        <NotMeasured why="The address on this visit could not be read" label="Site unresolved" />
      ),
  },
  { key: 'when', header: 'When', cell: (v) => <When v={v} /> },
  {
    key: 'technician',
    header: 'Technician',
    cell: (v) =>
      // §3B: identified by code, never by name. That is deliberate — a name
      // gives a vendor a person to lean on about a grade.
      v.technicianCode ? (
        <span className="font-mono text-data tnum text-ink-2">{v.technicianCode}</span>
      ) : (
        <NotMeasured why="Nobody has been assigned to this visit yet" label="Not assigned yet" />
      ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (v) => (
      <StatusPill
        tone={STATUS_TONE[v.status]}
        label={STATUS_LABEL[v.status]}
        className="whitespace-nowrap"
      />
    ),
  },
  { key: 'machines', header: 'Machines', cell: (v) => <Machines v={v} /> },
  {
    key: 'fee',
    header: 'Visit fee',
    cell: (v) => (
      <span className="text-body-sm">
        <FeeLine fee={v.fee} units={v.unitsRequested} brief />
      </span>
    ),
  },
];

export function VendorVisitsRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useUrlState('status');
  const { data, error } = useResource<VendorVisit[]>(API.visits, 'Your inspections did not load');

  // Filtered in the browser and stated in the URL. The list is one vendor's
  // whole inspection history — six rows for the busiest supply point in the
  // database — so a round trip per filter change buys nothing and can fail on
  // its own. The URL is still the state, because a colleague has to be able to
  // open the same board.
  const rows = React.useMemo(
    () => (data ?? []).filter((v) => !status || v.status === status),
    [data, status],
  );

  const awaiting = (data ?? []).filter((v) => v.arrivedAt === null).length;

  return (
    <div className="tg-stack">
      <PageHeader
        title="Inspections"
        action={
          // The one amber control. It is a primary action and it is the real
          // path: a visit is requested by submitting a listing, and there is no
          // second way to raise one — so this links to the wizard rather than
          // opening a form that would duplicate it.
          //
          // `navigate` and not `location.assign`: the console holds its access
          // token in memory, so a full page load signs the vendor out on the way
          // to the screen the button promised.
          <Button variant="primary" onClick={() => void navigate('/vendor/listings/new')}>
            List stock for inspection
          </Button>
        }
      >
        A technician comes to your site, opens every machine on the manifest and grades it.
        {data && awaiting > 0 && (
          <>
            {' '}
            <span className="text-ink">
              {awaiting} {awaiting === 1 ? 'inspection has' : 'inspections have'} not been carried
              out yet.
            </span>
          </>
        )}
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Any status' },
            ...VISIT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          ]}
        />
      </div>

      {error ? (
        <EmptyState
          title="Your inspections did not load"
          body={`${error}. Nothing has been changed — reload to try again.`}
        />
      ) : (
        <Board tableMinWidth={1080}>
          <DataBoard
            caption={
              data
                ? `${rows.length} of ${data.length} inspections, soonest first.`
                : 'Loading your inspections.'
            }
            columns={BOARD_COLUMNS}
            rows={rows}
            rowKey={(v) => v.id}
            loading={!data}
            skeletonRows={6}
            empty={
              status ? (
                <EmptyState
                  title="No inspection is at that stage"
                  body="Clear the status filter to see every inspection on your account."
                  action={
                    <Link
                      className="text-acc-ink underline underline-offset-4"
                      to="/vendor/qc/visits"
                    >
                      Clear the filter
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  title="No inspections requested"
                  body={
                    <>
                      Submitting a listing raises an inspection request — it is the only way one is
                      raised, and nothing goes on sale until a technician has held the machines.{' '}
                      <Link
                        className="text-acc-ink underline underline-offset-4"
                        to="/vendor/listings"
                      >
                        Your listings
                      </Link>{' '}
                      shows what is waiting.
                    </>
                  }
                />
              )
            }
          />
        </Board>
      )}
    </div>
  );
}

/* ==========================================================================
 * The record
 * ======================================================================== */

const MANIFEST_COLUMNS: ReadonlyArray<Column<VisitManifestUnit>> = [
  {
    key: 'seq',
    header: '#',
    numeric: true,
    cell: (u) => <span className="text-ink-3">{u.sequenceNo ?? ''}</span>,
  },
  {
    key: 'serial',
    header: 'Serial',
    cell: (u) => (
      <code className="font-mono text-data tnum tracking-[0.08em] text-ink">{u.serialNumber}</code>
    ),
  },
  {
    key: 'sku',
    header: 'Model',
    cell: (u) =>
      u.skuCode || (
        <NotMeasured why="The catalog entry for this machine could not be read" label="No model" />
      ),
  },
  {
    key: 'declared',
    header: 'You declared',
    cell: (u) =>
      u.gradeDeclared ? (
        <GradeBadge grade={u.gradeDeclared as Grade} variant="declared" />
      ) : (
        <NotMeasured why="No grade was declared for this machine" label="None declared" />
      ),
  },
  {
    key: 'outcome',
    header: 'Outcome',
    cell: (u) => (
      <>
        <StatusPill tone={OUTCOME_TONE[u.outcome]} label={OUTCOME_LABEL[u.outcome]} />
        {u.absentReason && (
          <span className="mt-1 block text-body-sm text-ink-2">{u.absentReason}</span>
        )}
      </>
    ),
  },
];

/** What to have ready. Content, not data — so it is printed, not downloaded. */
const CHECKLIST: readonly string[] = [
  'Every machine on the manifest, in one place, powered and charged above 20%.',
  'The charger for each machine — a laptop that cannot be powered cannot be graded.',
  'A table and a power point for the technician, with room to open six machines at once.',
  'Somebody on site who can answer for the stock and sign off by OTP at the end.',
  'A machine you cannot produce on the day comes off the manifest and stays your stock.',
];

export function VendorVisitDetailRoute(): React.JSX.Element {
  const { id } = useParams();
  const { data, error } = useResource<VendorVisitDetail>(
    id ? API.visit(id) : '',
    'This inspection did not load',
  );

  /** The server's answer after a cancellation, which replaces what was fetched. */
  const [after, setAfter] = React.useState<VendorVisitDetail | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  if (error) {
    return (
      <EmptyState
        title="This inspection did not load"
        body={`${error}. It may not be on your account. Nothing has been changed.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/qc/visits">
            Back to your inspections
          </Link>
        }
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;

  const v = after ?? data;
  const visited = v.arrivedAt !== null;

  async function cancel(): Promise<void> {
    if (!id) return;
    setBusy(true);
    setFailure(null);
    try {
      setAfter(await postJson<VendorVisitDetail>(API.cancelVisit(id), { reason: reason.trim() }));
      setConfirming(false);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tg-stack">
      <Breadcrumb
        items={[{ label: 'Inspections', href: '/vendor/qc/visits' }, { label: v.visitNumber }]}
      />

      <RecordHeader
        title={v.visitNumber}
        subtitle={v.siteLabel || 'The address on this visit could not be read.'}
        status={<StatusPill tone={STATUS_TONE[v.status]} label={STATUS_LABEL[v.status]} />}
        identifiers={[
          { label: 'Booked for', value: v.scheduledDate ?? 'Not scheduled yet' },
          { label: 'Machines requested', value: v.unitsRequested },
          { label: 'Technician', value: v.technicianCode ?? 'Not assigned yet' },
        ]}
        secondaryActions={
          visited ? (
            <Link
              to={`/vendor/qc/visits/${v.id}/results`}
              className="text-body-sm text-acc-ink underline underline-offset-4"
            >
              What we found, machine by machine
            </Link>
          ) : undefined
        }
      />

      {v.cancellationReason && (
        <div className="tg-card rounded-lg border border-rule bg-sheet-2 text-body-sm text-ink-2">
          {/* Not `--fail`. A cancelled or missed visit is not a verdict on a
              machine, and red here would read as one two clicks from a real
              FAIL chip. */}
          <span className="text-ink">{STATUS_LABEL[v.status]}.</span> {v.cancellationReason}
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <Section title="Where this visit has got to">
            <div className="grid gap-x-6 md:grid-cols-2">
              <Datum label="Requested">{onDateTime(v.requestedAt)}</Datum>
              <Datum label="Booked for">
                {v.scheduledDate ? (
                  <>
                    <span className="font-mono tnum">{v.scheduledDate}</span>
                    {v.slotFrom && v.slotTo && (
                      <span className="font-mono tnum text-ink-2">
                        {' '}
                        {v.slotFrom.slice(0, 5)}–{v.slotTo.slice(0, 5)}
                      </span>
                    )}
                  </>
                ) : (
                  <NotMeasured
                    why="No date has been agreed for this inspection yet"
                    label="Not scheduled yet"
                  />
                )}
              </Datum>
              <Datum label="Technician arrived">
                {v.arrivedAt ? (
                  onDateTime(v.arrivedAt)
                ) : (
                  <NotMeasured
                    why="Nobody has arrived at the site for this inspection"
                    label="Not arrived"
                  />
                )}
              </Datum>
              <Datum label="Inspection started">
                {v.startedAt ? (
                  onDateTime(v.startedAt)
                ) : (
                  <NotMeasured why="The inspection has not started" label="Not started" />
                )}
              </Datum>
              <Datum label="Finished">
                {v.completedAt ? (
                  onDateTime(v.completedAt)
                ) : (
                  <NotMeasured why="The inspection is not finished" label="Not finished" />
                )}
              </Datum>
              <Datum label="Your sign-off">
                {v.vendorSignoffAt ? (
                  <>
                    {v.vendorSignoffName ?? 'Signed'}, {onDateTime(v.vendorSignoffAt)}
                  </>
                ) : (
                  <NotMeasured
                    why="Nobody at your site has signed off on this inspection by OTP yet"
                    label="Not signed off"
                  />
                )}
              </Datum>
              <Datum label="Machines">
                {visited ? (
                  <span className="font-mono tnum">
                    {v.unitsInspected} of {v.unitsRequested} inspected
                    {v.unitsAbsent > 0 && ` · ${v.unitsAbsent} not presented`}
                  </span>
                ) : (
                  <NotMeasured
                    why="Nobody has been to the site, so nothing has been inspected"
                    label="Not inspected yet"
                  />
                )}
              </Datum>
              <Datum label="Rescheduled">
                <span className="font-mono tnum">{v.rescheduleCount}</span>
                <span className="text-ink-2"> {v.rescheduleCount === 1 ? 'time' : 'times'}</span>
              </Datum>
            </div>
            {v.notes && <p className="mt-4 max-w-prose text-body-sm text-ink-2">{v.notes}</p>}
          </Section>

          <Section
            title="The manifest"
            subtitle={
              v.manifest.length > 0
                ? `${v.manifest.length} ${v.manifest.length === 1 ? 'machine' : 'machines'} against ${v.unitsRequested} requested. Have every one of these ready on the day.`
                : undefined
            }
            aside={
              visited && v.manifest.length > 0 ? (
                <Link
                  to={`/vendor/qc/visits/${v.id}/results`}
                  className="text-body-sm text-acc-ink underline underline-offset-4"
                >
                  See what we found
                </Link>
              ) : undefined
            }
          >
            <Board tableMinWidth={620}>
              <DataBoard
                caption="The machines on this inspection."
                columns={MANIFEST_COLUMNS}
                rows={v.manifest}
                rowKey={(u) => u.visitUnitId}
                empty={
                  <EmptyState
                    title="The manifest is not prepared yet"
                    body="The serials on this inspection appear here once they are attached to it. Until then the request names a number of machines, not which ones."
                  />
                }
              />
            </Board>
          </Section>
        </div>

        <div className="flex flex-col gap-5">
          <SidePanel
            title="The visit fee"
            description="What this inspection costs, and who is paying it."
          >
            <p className="text-body-sm">
              <FeeLine fee={v.fee} units={v.unitsRequested} />
            </p>
            {v.fee.standardFee !== null && v.fee.bearer === 'VENDOR' && (
              <p className="text-body-sm text-ink-3">
                The standard visit fee is{' '}
                <span className="font-mono tnum">{rupees(v.fee.standardFee)}</span>. It comes off
                your payout, not a separate invoice.
              </p>
            )}
          </SidePanel>

          <SidePanel title="When we can come" description="Your own opening hours for this site.">
            <SiteCalendar calendar={v.calendar} />
          </SidePanel>

          <SidePanel
            title="Before we arrive"
            description="Five things that decide whether the day is a full one."
          >
            <ul className="flex list-disc flex-col gap-2 pl-5 text-body-sm text-ink-2">
              {CHECKLIST.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </SidePanel>

          {v.cancellable && (
            <SidePanel
              title="Call this inspection off"
              description="The machines stay yours and stay unlisted. You can request another at any time."
            >
              {/* Not the amber primary and not `danger`: `--fail` means FAIL on
                  this screen, and a red button beside a FAIL chip is the exact
                  confusion the colour rule exists to stop. */}
              {/* §3B says "cancelling inside the notice window triggers a visit
                  fee, and the fee is stated on the cancel confirmation before it
                  is charged". **There is no notice window in this product.**
                  There is no `platform_config` key for one, `advance()` does not
                  touch `visit_fee`, and nothing anywhere charges for a
                  cancellation. So this says what is true rather than inventing a
                  deadline a vendor would plan around: the fee already on the
                  record, and the fact that calling it off does not move it. */}
              <p className="text-body-sm text-ink-2">
                {Number(v.fee.amount) > 0 ? (
                  <>
                    The <span className="font-mono tnum text-ink">{rupees(v.fee.amount)}</span>{' '}
                    visit fee already recorded against this inspection does not change if you call
                    it off.{' '}
                  </>
                ) : (
                  <>Calling this off costs you nothing. </>
                )}
                There is no cancellation notice period set, so nothing extra is charged and nothing
                is refunded.
              </p>
              {!confirming ? (
                <Button onClick={() => setConfirming(true)}>Cancel this inspection</Button>
              ) : (
                <>
                  <Textarea
                    label="Why are you calling it off?"
                    hint="This goes on the record and is read by the technician whose day it was."
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  {failure && (
                    <p className="text-body-sm text-fail" role="alert">
                      {failure}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => void cancel()}
                      loading={busy}
                      {...(reason.trim().length < 10
                        ? { disabledReason: 'Say why, in a sentence — at least ten characters.' }
                        : {})}
                    >
                      Confirm the cancellation
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      Keep it
                    </Button>
                  </div>
                </>
              )}
            </SidePanel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * The results
 * ======================================================================== */

/**
 * One machine's measurements.
 *
 * Every number carries its denominator and every missing one says so. A machine
 * with no report renders nothing at all here — not a zero score, not an empty
 * seal chip, not a blank grade cell that reads as "nothing found".
 */
function ResultCells({ u }: { u: VisitManifestUnit }): React.JSX.Element {
  if (!u.result) {
    return (
      <NotMeasured
        why="Nobody opened this machine, so there is nothing measured against it"
        label={u.outcome === 'ABSENT' ? 'Not presented — never opened' : 'Not inspected yet'}
      />
    );
  }
  const r = u.result;
  return (
    <div className="flex flex-col gap-1">
      <span>
        {r.qcScore === null ? (
          <NotMeasured why="No inspection score was recorded" label="Score not measured" />
        ) : (
          <>
            <span className="font-mono tnum text-ink">{r.qcScore} of 100</span>
            <span className="text-ink-2"> inspection score</span>
          </>
        )}
      </span>
      <span>
        {r.batteryHealthPct === null ? (
          <NotMeasured
            why="The battery could not be read on this machine"
            label="Battery not measured"
          />
        ) : (
          <>
            <span className="font-mono tnum text-ink">{r.batteryHealthPct}%</span>
            <span className="text-ink-2"> of the battery&rsquo;s design capacity</span>
          </>
        )}
      </span>
      {r.findings.length > 0 && (
        // Worst first, four at a time. A failed machine is marked down on every
        // one of its twelve areas, and a cell listing all twelve buries the two
        // that decided the verdict — which is the sentence a vendor appeals
        // against. The count keeps the rest from vanishing silently.
        <span className="text-body-sm text-ink-2">
          Marked down on{' '}
          {r.findings
            .slice(0, 4)
            .map((f) => `${AREA_LABEL(f.area)} ${f.score} of ${f.maxScore}`)
            .join(' · ')}
          {r.findings.length > 4 && <> and {r.findings.length - 4} more areas</>}
        </span>
      )}
    </div>
  );
}

const RESULT_COLUMNS: ReadonlyArray<Column<VisitManifestUnit>> = [
  {
    key: 'serial',
    header: 'Serial',
    cell: (u) => (
      <>
        <code className="font-mono text-data tnum tracking-[0.08em] text-ink">
          {u.serialNumber}
        </code>
        <span className="block text-body-sm text-ink-3">
          {u.skuCode || (
            <NotMeasured
              why="The catalog entry for this machine could not be read"
              label="No model"
            />
          )}
        </span>
      </>
    ),
  },
  {
    key: 'grades',
    header: 'Declared, then inspected',
    cell: (u) => (
      <div className="flex flex-wrap items-center gap-2">
        {u.gradeDeclared ? (
          <GradeBadge grade={u.gradeDeclared as Grade} variant="declared" />
        ) : (
          <NotMeasured why="No grade was declared for this machine" label="None declared" />
        )}
        <span className="text-ink-4">→</span>
        {u.result?.grade ? (
          // Neutral, always. A+, A and B are all sellable — a position on a
          // scale is not a verdict, and the verdict has its own column.
          <GradeBadge grade={u.result.grade as Grade} />
        ) : (
          <NotMeasured why="This machine has no inspected grade" label="Not graded" />
        )}
      </div>
    ),
  },
  {
    key: 'outcome',
    header: 'Outcome',
    cell: (u) => (
      <>
        <StatusPill tone={OUTCOME_TONE[u.outcome]} label={OUTCOME_LABEL[u.outcome]} />
        {u.absentReason && (
          <span className="mt-1 block text-body-sm text-ink-2">{u.absentReason}</span>
        )}
        {u.outcome === 'UNTESTABLE' && (
          <span className="mt-1 block text-body-sm text-ink-2">
            We could not measure this machine. That is not a failure, and it is not a grade — it
            goes back through inspection rather than on sale.
          </span>
        )}
      </>
    ),
  },
  { key: 'measured', header: 'What was measured', cell: (u) => <ResultCells u={u} /> },
  {
    key: 'seal',
    header: 'Seal',
    cell: (u) =>
      u.result?.seal ? (
        <SealChip sealCode={u.result.seal.code} status={u.result.seal.status as SealStatus} />
      ) : (
        <NotMeasured
          why="A machine is sealed only once it has passed, so there is no seal on this one"
          label="Not sealed"
        />
      ),
  },
];

export function VendorVisitResultsRoute(): React.JSX.Element {
  const { id } = useParams();
  const { data, error } = useResource<VendorVisitDetail>(
    id ? API.visit(id) : '',
    'These results did not load',
  );

  if (error) {
    return (
      <EmptyState
        title="These results did not load"
        body={`${error}. It may not be on your account. Nothing has been changed.`}
        action={
          <Link className="text-acc-ink underline underline-offset-4" to="/vendor/qc/visits">
            Back to your inspections
          </Link>
        }
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;

  const inspected = data.manifest.filter((u) => u.result !== null);
  const corrected = data.manifest.filter((u) => u.outcome === 'PASS_GRADE_CORRECTED');

  return (
    <div className="tg-stack">
      <Breadcrumb
        items={[
          { label: 'Inspections', href: '/vendor/qc/visits' },
          { label: data.visitNumber, href: `/vendor/qc/visits/${data.id}` },
          { label: 'Results' },
        ]}
      />

      <PageHeader title={`What we found — ${data.visitNumber}`}>
        {data.arrivedAt === null
          ? 'Nobody has been to your site for this inspection, so there is nothing to report yet.'
          : `${inspected.length} of ${data.manifest.length} machines on the manifest were opened and graded.`}
      </PageHeader>

      {data.arrivedAt === null ? (
        <EmptyState
          title="This inspection has not happened yet"
          body="Results appear here once a technician has been to the site and opened the machines. Nothing has been graded, nothing has been sealed, and nothing on this inspection is on sale."
          action={
            <Link
              className="text-acc-ink underline underline-offset-4"
              to={`/vendor/qc/visits/${data.id}`}
            >
              Back to the inspection
            </Link>
          }
        />
      ) : (
        <>
          {corrected.length > 0 && (
            <div className="tg-card rounded-lg border border-rule bg-sheet-2 text-body-sm text-ink-2">
              <span className="text-ink">
                {corrected.length} {corrected.length === 1 ? 'machine was' : 'machines were'} graded
                differently from your declaration.
              </span>{' '}
              A regrade changes what you are paid for it, and you have a window to answer.{' '}
              <Link className="text-acc-ink underline underline-offset-4" to="/vendor/corrections">
                Your grade corrections
              </Link>
            </div>
          )}

          <Section
            title="Machine by machine"
            subtitle="A machine that failed is never listed and never sold — it stays your stock and comes back to you."
          >
            <Board tableMinWidth={1040}>
              <DataBoard
                caption={`${data.manifest.length} machines on this inspection.`}
                columns={RESULT_COLUMNS}
                rows={data.manifest}
                rowKey={(u) => u.visitUnitId}
                empty={
                  <EmptyState
                    title="No machines were on this manifest"
                    body="Nothing was attached to this inspection, so there is nothing to report against it."
                  />
                }
              />
            </Board>
          </Section>

          <div className="flex flex-col gap-2">
            <h2 className="text-h3 text-ink">The count</h2>
            <TickRule />
            <p className="max-w-prose text-body-sm text-ink-2">
              <span className="font-mono tnum text-ink">
                {data.unitsPassed} of {data.unitsInspected}
              </span>{' '}
              machines opened at this visit passed and are sellable.{' '}
              <span className="font-mono tnum text-ink">{data.unitsGradeCorrected}</span> were
              graded differently from your declaration and{' '}
              <span className="font-mono tnum text-ink">{data.unitsFailed}</span> failed.
              {data.unitsAbsent > 0 && (
                <>
                  {' '}
                  <span className="font-mono tnum text-ink">{data.unitsAbsent}</span> were not
                  presented on the day and were never opened.
                </>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
