import * as React from 'react';
import { Link, useParams } from 'react-router';
import {
  Breadcrumb,
  cn,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SealChip,
  SidePanel,
  Skeleton,
  StatusPill,
  Timeline,
  type Column,
  type Step,
  type StepStatus,
  type TimelineEvent,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { Board, Datum, NotMeasured, PageHeader, Section } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, NO_DATE, gradeLabel, humanise, locationLabel, onDate, onDateTime, rupees, type VendorUnit, type VendorUnitMovement } from './api';

/**
 * ARCHETYPE B (the list) and C (one serial). Board, then record.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
 * Every serial under one listing, and the full life of one of them.
 *
 * Both screens read the same endpoint — `GET /vendor/listings/:id/units` — and
 * the detail view finds its unit in that list. One request instead of two, and
 * nothing to keep consistent between them.
 */

/** The lifecycle PHASE_03 Task 7 asks for, in order. */
const STAGES = [
  'Declared',
  'Inspected',
  'Graded',
  'Sealed',
  'Listed',
  'Reserved',
  'Dispatched',
  'Delivered',
] as const;

/**
 * How far along a unit is, from `listing.unit.status`.
 *
 * Statuses that are *interruptions* rather than progress — failed, expired,
 * seal broken, returned — are deliberately not points on this line. A failed
 * machine has not reached a later stage; it has left the line, and drawing it as
 * "stuck at step 3" invites the vendor to wait for step 4.
 */
const STAGE_OF: Record<string, number> = {
  DRAFT: 0,
  AWAITING_QC: 0,
  QC_SCHEDULED: 0,
  QC_IN_PROGRESS: 1,
  QC_PASSED: 2,
  QC_MISMATCH: 2,
  QC_SEALED: 3,
  LISTED: 4,
  RESERVED: 5,
  DISPATCHED: 6,
  DELIVERED: 7,
};

/** What has gone wrong, said as what it means for the vendor rather than as a code. */
const HALTED: Record<string, string> = {
  QC_FAILED:
    'This machine did not pass inspection. It is not listed and it will not be — it is returning to your own stock. The report says what we measured.',
  QC_EXPIRED:
    'The inspection is more than 90 days old, so this machine stopped being sellable automatically. A re-inspection puts it back.',
  SEAL_BROKEN:
    'The tamper seal is broken, so we can no longer vouch for what is inside. The machine is out of sale until it is inspected and sealed again.',
  RETURNED_TO_VENDOR:
    'This machine is back with you. Its serial is free to be listed again whenever you want.',
};

/**
 * The lifecycle as `Stepper`, not as `Timeline`.
 *
 * `Timeline` in `@trugrade/ui` requires an actor and a timestamp on every event,
 * and rightly so — an audit line whose actor is a guess is worse than none. Five
 * of these eight stages have not happened yet, so there is no actor and no time
 * to give them, and inventing either is precisely the fabrication the component
 * refuses. A stage that is still ahead is an `upcoming` step, which is what
 * `Stepper` is for.
 */
function lifecycleSteps(unit: VendorUnit): Step[] {
  const halted = HALTED[unit.status];
  const reached = STAGE_OF[unit.status] ?? 0;

  return STAGES.map((stage, i) => {
    const inspected = stage === 'Inspected' && unit.qcPassedAt;
    const graded = stage === 'Graded' && unit.gradeActual;
    return {
      key: stage,
      label: stage,
      status: halted
        ? // Nothing on a halted machine is "current": it has left the line.
          i <= reached
          ? 'complete'
          : 'blocked'
        : i < reached
          ? 'complete'
          : i === reached
            ? 'current'
            : 'upcoming',
      ...(inspected
        ? {
            summary: `${onDate(unit.qcPassedAt)}${
              unit.qcValidUntil ? ` · valid to ${onDate(unit.qcValidUntil)}` : ''
            }`,
          }
        : {}),
      ...(graded
        ? {
            summary: `Declared ${gradeLabel(unit.gradeDeclared)}, inspected as ${gradeLabel(
              unit.gradeActual ?? '',
            )}${unit.gradeActual !== unit.gradeDeclared ? ' — a grade correction' : ''}`,
          }
        : {}),
      ...(halted && i === reached + 1 ? { blockers: [halted] } : {}),
    };
  });
}

const LIFECYCLE_STATUS: Record<StepStatus, string | null> = {
  complete: 'Complete',
  current: 'In progress',
  upcoming: 'Pending',
  blocked: 'Blocked',
};

/** Lifecycle as a horizontal rail — same vocabulary as the listing wizard. */
function UnitLifecycleRail({ unit }: { unit: VendorUnit }): React.JSX.Element {
  const steps = lifecycleSteps(unit);

  return (
    <nav aria-label="Machine lifecycle" className="wizard-progress">
      <ol className="wizard-progress-list">
        {steps.map((step, i) => {
          const n = i + 1;
          const statusLabel = LIFECYCLE_STATUS[step.status];
          return (
            <li key={step.key} className="wizard-progress-item">
              <div className="wizard-progress-step">
                <div
                  className="wizard-progress-hit"
                  aria-current={step.status === 'current' ? 'step' : undefined}
                >
                  <span
                    className={cn(
                      'wizard-progress-circle',
                      step.status === 'complete' && 'wizard-progress-circle-complete',
                      step.status === 'current' && 'wizard-progress-circle-current',
                      (step.status === 'upcoming' || step.status === 'blocked') &&
                        'wizard-progress-circle-upcoming',
                    )}
                    aria-hidden="true"
                  >
                    {step.status === 'complete' ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path
                          d="M2.5 7.2 5.5 10.2 11.5 3.8"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <span className="font-mono text-data tnum">{n}</span>
                    )}
                  </span>
                  <span className="wizard-progress-copy">
                    <span
                      className={cn(
                        'wizard-progress-title',
                        step.status === 'current' ? 'text-ink' : 'text-ink-2',
                      )}
                    >
                      {step.label}
                    </span>
                    {statusLabel ? (
                      <span
                        className={cn(
                          'wizard-progress-status',
                          step.status === 'complete' && 'text-pass',
                          step.status === 'current' && 'text-acc-ink',
                          step.status === 'upcoming' && 'text-ink-3',
                          step.status === 'blocked' && 'text-fail',
                        )}
                      >
                        {statusLabel}
                      </span>
                    ) : null}
                    {step.summary ? (
                      <span className="mt-1 block text-body-sm text-ink-2">{step.summary}</span>
                    ) : null}
                    {step.blockers?.map((b) => (
                      <span
                        key={b}
                        className="mt-2 block rounded border border-warn px-3 py-2 text-body-sm text-warn"
                        role="status"
                      >
                        {b}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
              {i < steps.length - 1 ? (
                <span className="wizard-progress-line" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function movementTimeline(
  movements: readonly VendorUnitMovement[],
  currentLocation: string,
): TimelineEvent[] {
  if (movements.length === 0) {
    return [
      {
        key: 'current',
        action: `Currently ${locationLabel(currentLocation).toLowerCase()}`,
        actor: 'Trugrade',
        at: onDate(new Date().toISOString()),
        current: true,
        detail: 'No movements have been recorded for this serial yet.',
      },
    ];
  }

  return movements.map((m, i) => {
    const last = i === movements.length - 1;
    const action =
      m.fromStatus === null
        ? `First recorded as ${humanise(m.toStatus)}`
        : `${humanise(m.fromStatus)} → ${humanise(m.toStatus)}`;

    let detail: string | undefined;
    if (m.toLocation) {
      detail =
        m.fromLocation === m.toLocation
          ? `${locationLabel(m.toLocation)}, location unchanged`
          : m.fromLocation
            ? `${locationLabel(m.fromLocation)} → ${locationLabel(m.toLocation)}`
            : locationLabel(m.toLocation);
    }

    return {
      key: `${m.at}-${i}`,
      action,
      actor: 'Trugrade',
      at: onDateTime(m.at),
      dateTime: m.at,
      ...(m.reason ? { reason: m.reason } : {}),
      ...(detail ? { detail } : {}),
      ...(last ? { current: true } : {}),
    };
  });
}

function useUnits(listingId: string | undefined): {
  data: VendorUnit[] | null;
  error: string | null;
} {
  // `id` is always present on these routes — React Router only matches with it.
  // The `?? ''` produces a 404 rather than a crash if that ever stops being true.
  return useResource<VendorUnit[]>(
    API.listingUnits(listingId ?? ''),
    'These units are unavailable',
  );
}

function unitColumns(listingId: string | undefined): ReadonlyArray<Column<VendorUnit>> {
  return [
    {
      key: 'serial',
      header: 'Serial',
      cell: (u) => (
        <Link
          className="font-mono text-data text-acc-ink underline underline-offset-4"
          to={`/vendor/listings/${listingId}/units/${u.id}`}
        >
          {u.serialNumber}
        </Link>
      ),
    },
    {
      key: 'grade',
      header: 'Grade',
      cell: (u) => (
        <GradeBadge
          grade={(u.gradeActual ?? u.gradeDeclared) as Grade}
          variant={
            u.gradeActual
              ? u.gradeActual === u.gradeDeclared
                ? 'verified'
                : 'corrected'
              : 'declared'
          }
          previousGrade={
            u.gradeActual && u.gradeActual !== u.gradeDeclared
              ? (u.gradeDeclared as Grade)
              : undefined
          }
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) => (
        <StatusPill
          // Not green. `is_sellable` is a lifecycle state — LISTED, sealed, QC
          // in date — and the grade badge one column left is what carries the
          // inspection's verdict. Two greens meaning two different things on one
          // row is how the QC one stops being read.
          tone={HALTED[u.status] ? 'warn' : u.isSellable ? 'info' : 'processing'}
          label={u.status.replaceAll('_', ' ')}
          className="whitespace-nowrap"
        />
      ),
    },
    {
      key: 'sellable',
      header: 'Sellable',
      cell: (u) => <span className="text-ink-2">{u.isSellable ? 'Yes' : 'No'}</span>,
    },
    { key: 'location', header: 'Where', cell: (u) => <span className="text-ink-2">{locationLabel(u.location)}</span> },
    {
      key: 'ask',
      header: 'Your ask',
      numeric: true,
      cell: (u) =>
        u.vendorAskPrice === null ? (
          <NotMeasured why="No price has been set on this machine" label="No price set" />
        ) : (
          rupees(u.vendorAskPrice)
        ),
    },
  ];
}

export function ListingUnitsRoute(): React.JSX.Element {
  const { id } = useParams();
  const { data, error } = useUnits(id);
  const columns = React.useMemo(() => unitColumns(id), [id]);

  if (error) {
    return (
      <EmptyState title="The units did not load" body={`${error}. Nothing has been changed.`} />
    );
  }
  if (!data) return <Skeleton lines={8} />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="No serials on this listing yet"
        body="A listing with no serials has nothing to inspect and nothing to sell."
        action={
          <Link
            className="text-acc-ink underline underline-offset-4"
            to={`/vendor/listings/${id}/bulk-upload`}
          >
            Upload a CSV of serials
          </Link>
        }
      />
    );
  }

  return (
    <div className="tg-stack">
      <Breadcrumb items={[{ label: 'Your stock', href: '/vendor/listings' }, { label: 'Units' }]} />

      <PageHeader
        title={`${data.length} ${data.length === 1 ? 'machine' : 'machines'}`}
        action={
          <Link
            className="text-acc-ink underline underline-offset-4"
            to={`/vendor/listings/${id}/bulk-upload`}
          >
            Add more from a CSV
          </Link>
        }
      >
        Every serial on this listing, and where each one is.
      </PageHeader>

      <Board>
        <DataBoard
          caption={`${data.length} machines on this listing.`}
          columns={columns}
          rows={data}
          rowKey={(u) => u.id}
        />
      </Board>
    </div>
  );
}

export function UnitDetailRoute(): React.JSX.Element {
  const { id, unitId } = useParams();
  const { data, error } = useUnits(id);
  const movements = useResource<VendorUnitMovement[]>(
    API.listingUnitMovements(id ?? '', unitId ?? ''),
    'Movement history unavailable',
  );
  const unit = data?.find((u) => u.id === unitId);

  if (error) {
    return (
      <EmptyState title="This machine did not load" body={`${error}. Nothing has been changed.`} />
    );
  }
  if (!data) return <Skeleton lines={8} />;
  if (!unit) {
    return (
      <EmptyState
        title="No such machine on this listing"
        body="It may have been withdrawn, or the link may be stale."
        action={
          <Link className="text-acc-ink underline underline-offset-4" to={`/vendor/listings/${id}`}>
            Back to the listing
          </Link>
        }
      />
    );
  }

  const halted = HALTED[unit.status];
  const validUntil = onDate(unit.qcValidUntil);
  const timeline = movementTimeline(movements.data ?? [], unit.location);
  const gradeVariant =
    unit.gradeActual === null
      ? 'declared'
      : unit.gradeActual === unit.gradeDeclared
        ? 'verified'
        : 'corrected';

  return (
    <div className="tg-stack unit-record">
      <Breadcrumb
        items={[
          { label: 'Your stock', href: '/vendor/listings' },
          { label: 'Units', href: `/vendor/listings/${id}` },
          { label: unit.serialNumber },
        ]}
      />

      {halted ? (
        <div className="unit-alert" role="status">
          <p className="text-body-sm text-ink">{halted}</p>
        </div>
      ) : null}

      <RecordHeader
        title={unit.serialNumber}
        subtitle={`Declared Grade ${gradeLabel(unit.gradeDeclared)} on ${onDate(unit.createdAt)}`}
        status={
          <StatusPill
            tone={halted ? 'warn' : unit.isSellable ? 'info' : 'processing'}
            label={humanise(unit.status)}
          />
        }
        identifiers={[
          { label: 'Where', value: locationLabel(unit.location) },
          {
            label: 'Sellable',
            value: unit.isSellable ? 'Yes' : 'No',
          },
          {
            label: 'Your ask',
            value:
              unit.vendorAskPrice === null ? (
                <NotMeasured why="No price has been set on this machine" label="No price set" />
              ) : (
                rupees(unit.vendorAskPrice)
              ),
          },
          {
            label: 'Inspection valid to',
            value:
              validUntil === NO_DATE ? (
                <NotMeasured
                  why="There is no passed inspection on this machine"
                  label="No inspection on record"
                />
              ) : (
                validUntil
              ),
          },
        ]}
        secondaryActions={
          <>
            <GradeBadge
              grade={(unit.gradeActual ?? unit.gradeDeclared) as Grade}
              variant={gradeVariant}
              previousGrade={
                gradeVariant === 'corrected' ? (unit.gradeDeclared as Grade) : undefined
              }
            />
            <SealChip
              status={
                unit.status === 'SEAL_BROKEN'
                  ? 'BROKEN'
                  : (STAGE_OF[unit.status] ?? 0) >= 3
                    ? 'INTACT'
                    : 'NOT_APPLIED'
              }
            />
          </>
        }
      />

      <div className="unit-kpi-grid">
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Location</p>
          <p className="unit-kpi-value">{locationLabel(unit.location)}</p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Grade</p>
          <p className="unit-kpi-value">
            {unit.gradeActual ? (
              <>
                {gradeLabel(unit.gradeActual)}
                {unit.gradeActual !== unit.gradeDeclared ? (
                  <span className="ml-2 font-normal text-ink-2">
                    (declared {gradeLabel(unit.gradeDeclared)})
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-2">Declared {gradeLabel(unit.gradeDeclared)}</span>
            )}
          </p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Sellable</p>
          <p className="unit-kpi-value">{unit.isSellable ? 'Yes' : 'No'}</p>
        </div>
        <div className="unit-kpi-tile">
          <p className="unit-kpi-label">Your ask</p>
          <p className="unit-kpi-value font-mono tnum">
            {unit.vendorAskPrice === null ? (
              <span className="font-sans text-ink-4">No price set</span>
            ) : (
              rupees(unit.vendorAskPrice)
            )}
          </p>
        </div>
      </div>

      <div className="grid [&>*]:min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-5">
          <Section
            title="Machine lifecycle"
            subtitle="Where this serial is in the journey from declaration to delivery."
            className="!mt-0"
          >
            <UnitLifecycleRail unit={unit} />
          </Section>

          <Section
            title="Where this machine is"
            subtitle="Every custody move, oldest first. The current location is marked on the latest entry."
            className="!mt-0"
          >
            <div className="unit-location-banner">
              <span className="unit-location-dot" aria-hidden="true" />
              <div>
                <p className="text-body-sm font-medium text-ink">Current location</p>
                <p className="mt-1 text-body text-ink">{locationLabel(unit.location)}</p>
              </div>
            </div>
            {movements.error ? (
              <p className="text-body-sm text-fail" role="alert">
                {movements.error}. The current location above is still accurate.
              </p>
            ) : !movements.data ? (
              <Skeleton lines={4} />
            ) : (
              <Timeline events={timeline} label="Machine location history" />
            )}
          </Section>
        </div>

        <SidePanel
          title="What we know"
          description="Facts recorded against this serial. Nothing here can be edited — corrections go through grade correction or a fresh inspection."
          footnote={
            unit.payoutLocked ? (
              <>
                This machine&apos;s payout is locked — a purchase order has named it. Repricing applies
                only to machines not yet committed.
              </>
            ) : undefined
          }
        >
          <Datum label="Declared">
            Grade {gradeLabel(unit.gradeDeclared)} on{' '}
            <span className="font-mono tnum">{onDate(unit.createdAt)}</span>
          </Datum>
          <Datum label="Inspected">
            {unit.gradeActual ? (
              `Grade ${gradeLabel(unit.gradeActual)}`
            ) : (
              <NotMeasured why="This machine has not been inspected yet" label="Not inspected" />
            )}
          </Datum>
          <Datum label="Inspection valid to">
            {validUntil === NO_DATE ? (
              <NotMeasured
                why="There is no passed inspection on this machine"
                label="No inspection on record"
              />
            ) : (
              <span className="font-mono tnum">{validUntil}</span>
            )}
          </Datum>
          <Datum label="Your ask">
            {unit.vendorAskPrice === null ? (
              <NotMeasured why="No price has been set on this machine" label="No price set" />
            ) : (
              <span className="font-mono tnum">{rupees(unit.vendorAskPrice)}</span>
            )}
          </Datum>
          <div className="flex flex-col gap-2 pt-2">
            <Link
              className="text-body-sm text-acc-ink underline underline-offset-4"
              to={`/vendor/listings/${id}`}
            >
              All machines on this listing
            </Link>
            <Link
              className="text-body-sm text-acc-ink underline underline-offset-4"
              to="/vendor/listings"
            >
              Back to your stock
            </Link>
          </div>
        </SidePanel>
      </div>
    </div>
  );
}
