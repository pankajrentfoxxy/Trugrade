import * as React from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, GradeBadge, SealChip, Skeleton, StatusPill } from '@trugrade/ui';
import type { Grade } from '@trugrade/contracts';
import { useResource } from '../../lib/useResource';
import { API, gradeLabel, onDate, rupees, type VendorUnit } from './api';

/**
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

function Timeline({ unit }: { unit: VendorUnit }): React.JSX.Element {
  const halted = HALTED[unit.status];
  const reached = STAGE_OF[unit.status] ?? 0;

  return (
    <div>
      <ol className="mt-5 flex flex-col gap-0">
        {STAGES.map((stage, i) => {
          const done = !halted && i <= reached;
          const current = !halted && i === reached;
          return (
            <li key={stage} className="flex items-start gap-4">
              <span className="flex flex-col items-center self-stretch">
                <span
                  aria-hidden="true"
                  className={[
                    'mt-1 h-3 w-3 shrink-0 rounded-full border',
                    done ? 'border-acc bg-acc' : 'border-rule bg-sheet',
                  ].join(' ')}
                />
                {i < STAGES.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={['w-px flex-1', done ? 'bg-acc' : 'bg-rule'].join(' ')}
                  />
                )}
              </span>
              <span className="pb-5">
                <span
                  className={['block text-body-sm', done ? 'text-ink' : 'text-ink-3'].join(' ')}
                >
                  {stage}
                  {/* Colour is never the only signal — the reached stage says so. */}
                  {current && <span className="sr-only"> — where this machine is now</span>}
                </span>
                {stage === 'Inspected' && unit.qcPassedAt && (
                  <span className="block text-body-sm text-ink-2">
                    {onDate(unit.qcPassedAt)}
                    {unit.qcValidUntil && ` · valid to ${onDate(unit.qcValidUntil)}`}
                  </span>
                )}
                {stage === 'Graded' && unit.gradeActual && (
                  <span className="block text-body-sm text-ink-2">
                    Declared {gradeLabel(unit.gradeDeclared)}, inspected as{' '}
                    {gradeLabel(unit.gradeActual)}
                    {unit.gradeActual !== unit.gradeDeclared && ' — a grade correction'}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {halted && (
        <div className="rounded border border-warn p-5">
          <p className="text-body-sm font-medium text-warn">
            {unit.status.replaceAll('_', ' ')}
          </p>
          <p className="mt-3 max-w-prose text-body-sm text-ink-2">{halted}</p>
        </div>
      )}
    </div>
  );
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

export function ListingUnitsRoute(): React.JSX.Element {
  const { id } = useParams();
  const { data, error } = useUnits(id);

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
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1 text-ink">
          {data.length} {data.length === 1 ? 'machine' : 'machines'}
        </h1>
        <Link
          className="text-acc-ink underline underline-offset-4"
          to={`/vendor/listings/${id}/bulk-upload`}
        >
          Add more from a CSV
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-rule">
        <table className="w-full text-body-sm">
          <thead className="bg-sheet-2">
            <tr>
              {['Serial', 'Grade', 'Status', 'Sellable', 'Where', 'Your ask'].map((h) => (
                <th
                  key={h}
                  className="p-3 text-left font-mono text-label uppercase tracking-[0.13em] text-ink-2"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-t border-rule-2">
                <td className="p-3">
                  <Link
                    className="font-mono text-data text-acc-ink underline underline-offset-4"
                    to={`/vendor/listings/${id}/units/${u.id}`}
                  >
                    {u.serialNumber}
                  </Link>
                </td>
                <td className="p-3">
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
                </td>
                <td className="p-3">
                  <StatusPill
                    tone={HALTED[u.status] ? 'warn' : u.isSellable ? 'pass' : 'processing'}
                    label={u.status.replaceAll('_', ' ')}
                  />
                </td>
                <td className="p-3 text-ink-2">{u.isSellable ? 'Yes' : 'No'}</td>
                <td className="p-3 text-ink-2">{u.location}</td>
                <td className="p-3 font-mono text-data tnum text-ink">
                  {rupees(u.vendorAskPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

  return (
    <div>
      <Link
        className="text-body-sm text-acc-ink underline underline-offset-4"
        to={`/vendor/listings/${id}`}
      >
        Back to the listing
      </Link>

      <h1 className="mt-3 font-mono text-h1 text-ink">{unit.serialNumber}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <GradeBadge
          grade={(unit.gradeActual ?? unit.gradeDeclared) as Grade}
          variant={unit.gradeActual ? 'verified' : 'declared'}
        />
        <StatusPill
          tone={HALTED[unit.status] ? 'warn' : unit.isSellable ? 'pass' : 'processing'}
          label={unit.status.replaceAll('_', ' ')}
        />
        {/* The seal code is not on `VendorUnitView`, so the chip states the fact
            the status carries and no more. Inventing a code here would be worse
            than not showing one. */}
        <SealChip
          status={
            unit.status === 'SEAL_BROKEN'
              ? 'BROKEN'
              : (STAGE_OF[unit.status] ?? 0) >= 3
                ? 'INTACT'
                : 'NOT_APPLIED'
          }
        />
      </div>

      <dl className="mt-6 grid max-w-lg grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-body-sm">
        {[
          ['Declared', `Grade ${gradeLabel(unit.gradeDeclared)} on ${onDate(unit.createdAt)}`],
          ['Inspected', unit.gradeActual ? `Grade ${gradeLabel(unit.gradeActual)}` : 'Not yet'],
          ['Inspection valid to', onDate(unit.qcValidUntil)],
          ['Where', unit.location],
          ['Your ask', rupees(unit.vendorAskPrice)],
        ].map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </React.Fragment>
        ))}
      </dl>

      <h2 className="mt-9 text-h3 text-ink">Where this machine is</h2>
      <Timeline unit={unit} />
    </div>
  );
}
