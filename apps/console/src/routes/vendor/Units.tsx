import * as React from 'react';
import { Link, useParams } from 'react-router';
import {
  Breadcrumb,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SealChip,
  Skeleton,
  StatusPill,
  Stepper,
  type Column,
  type Step,
} from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { Board, Datum, NotMeasured, PageHeader, Section } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import { API, NO_DATE, gradeLabel, onDate, rupees, type VendorUnit } from './api';

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
          tone={HALTED[u.status] ? 'warn' : u.isSellable ? 'pass' : 'processing'}
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
    { key: 'location', header: 'Where', cell: (u) => <span className="text-ink-2">{u.location}</span> },
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

  return (
    <div className="tg-stack">
      <Breadcrumb
        items={[
          { label: 'Your stock', href: '/vendor/listings' },
          { label: 'Units', href: `/vendor/listings/${id}` },
          { label: 'Machine' },
        ]}
      />

      <RecordHeader
        title={unit.serialNumber}
        subtitle={`Declared Grade ${gradeLabel(unit.gradeDeclared)} on ${onDate(unit.createdAt)}`}
        status={
          <StatusPill
            tone={halted ? 'warn' : unit.isSellable ? 'pass' : 'processing'}
            label={unit.status.replaceAll('_', ' ')}
          />
        }
        identifiers={[
          { label: 'Serial', value: unit.serialNumber },
          { label: 'Where', value: unit.location },
        ]}
        secondaryActions={
          <>
            <GradeBadge
              grade={(unit.gradeActual ?? unit.gradeDeclared) as Grade}
              variant={unit.gradeActual ? 'verified' : 'declared'}
            />
            {/* The seal code is not on `VendorUnitView`, so the chip states the
                fact the status carries and no more. Inventing a code here would
                be worse than not showing one. */}
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

      <Section title="What we know about this machine">
        <div className="grid gap-x-6 md:grid-cols-2">
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
        </div>
      </Section>

      <Section title="Where this machine is">
        <Stepper label="Machine lifecycle" steps={lifecycleSteps(unit)} />
      </Section>
    </div>
  );
}
