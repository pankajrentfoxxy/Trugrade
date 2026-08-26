import * as React from 'react';
import { Link, useParams } from 'react-router';
import { money } from '@trugrade/contracts';
import {
  EmptyState,
  GradeBadge,
  SealChip,
  Skeleton,
  StatusPill,
  type StatusPillProps,
} from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { Blank, Datum, Panel, TD, TH } from './controls';
import type { ManifestUnit, SealRow, ToolRunRow, UnitOutcome, VisitDetail } from './types';

/**
 * One visit, in full: the manifest, what happened to each unit, every tool run
 * with its raw payload, the photographs and the seals.
 *
 * The raw payload is viewable here and that is not a debugging convenience. Task
 * 2's first instruction is to store the payload verbatim *before* any parsing,
 * because when a buyer disputes a grade in four months the original is the
 * evidence. Evidence nobody can look at is filing, so it is on the screen,
 * collapsed, exactly as it arrived — no pretty-printing of values, no dropped
 * keys, no reordering.
 *
 * `serial_matches = FALSE` is rendered as loudly as it deserves. It means the
 * label does not belong to the laptop, and the correct reading of it is not
 * "a data quality issue".
 */

const OUTCOME_TONE: Readonly<Record<UnitOutcome, StatusPillProps['tone']>> = Object.freeze({
  PENDING: 'neutral',
  PASS: 'pass',
  PASS_GRADE_CORRECTED: 'warn',
  PASS_WITH_NOTE: 'warn',
  FAIL: 'fail',
  UNTESTABLE: 'fail',
  ABSENT: 'neutral',
});

const OUTCOME_LABEL: Readonly<Record<UnitOutcome, string>> = Object.freeze({
  PENDING: 'Not inspected yet',
  PASS: 'Pass',
  PASS_GRADE_CORRECTED: 'Pass, grade corrected',
  PASS_WITH_NOTE: 'Pass, with a note',
  FAIL: 'Fail',
  UNTESTABLE: 'Untestable',
  ABSENT: 'Not presented',
});

function ManifestTable({ units }: { units: ManifestUnit[] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <caption className="sr-only">The units on this visit and what happened to each.</caption>
        <thead>
          <tr className="border-b border-rule">
            <th scope="col" className={TH}>
              #
            </th>
            <th scope="col" className={TH}>
              Serial
            </th>
            <th scope="col" className={TH}>
              SKU
            </th>
            <th scope="col" className={TH}>
              Declared
            </th>
            <th scope="col" className={TH}>
              Outcome
            </th>
            <th scope="col" className={TH}>
              Time on unit
            </th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.visitUnitId} className="border-b border-rule-2">
              <td className={`${TD} tnum text-ink-3`}>{u.sequenceNo}</td>
              <td className={TD}>
                <code className="font-mono text-data text-ink">{u.serialNumber}</code>
              </td>
              <td className={TD}>{u.skuLabel}</td>
              <td className={TD}>
                {u.declaredGrade ? (
                  <GradeBadge grade={u.declaredGrade} variant="declared" />
                ) : (
                  <Blank why="The vendor declared no grade" />
                )}
              </td>
              <td className={TD}>
                <StatusPill tone={OUTCOME_TONE[u.outcome]} label={OUTCOME_LABEL[u.outcome]} />
                {u.absentReason && (
                  <span className="mt-1 block text-body-sm text-ink-2">{u.absentReason}</span>
                )}
              </td>
              <td className={`${TD} tnum`}>
                {u.durationSeconds === null ? (
                  <Blank why="Not inspected" />
                ) : (
                  `${Math.round(u.durationSeconds / 60)} min`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToolRunCard({ run }: { run: ToolRunRow }): React.JSX.Element {
  return (
    <article className="mt-4 rounded border border-rule bg-sheet-2 p-4" data-testid="tool-run">
      <header className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-data text-ink">
          {run.toolProviderCode} {run.toolVersion}
        </code>
        <StatusPill
          tone={
            run.parseStatus === 'PARSED'
              ? 'pass'
              : run.parseStatus === 'PARSE_FAILED'
                ? 'fail'
                : 'neutral'
          }
          label={run.parseStatus.replace(/_/g, ' ')}
        />
        {run.serialMatches === false && <StatusPill tone="fail" label="Serial mismatch" />}
        <span className="ml-auto text-body-sm text-ink-3">{run.ingestedAt}</span>
      </header>

      {run.serialMatches === false && (
        <p className="mt-3 text-body-sm text-fail" role="alert">
          The tool read <code className="font-mono">{run.serialFromTool}</code>, which is not the
          serial on the manifest. The label does not belong to this laptop — it is not graded, not
          sealed and not listed until somebody has looked at it.
        </p>
      )}

      {run.parseError && (
        <p className="mt-3 text-body-sm text-fail">
          Parse failed: {run.parseError}. The raw payload below is retained, and the technician can
          still enter the inspection by hand — a parser regression does not stop their day.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-body-sm">
        <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">Run id</dt>
        <dd className="font-mono text-data text-ink-2">
          {run.toolRunId ?? 'none — this provider sends no run id, so its submissions are not idempotent'}
        </dd>
        <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">SHA-256</dt>
        <dd className="break-all font-mono text-data text-ink-2">{run.rawReportHash}</dd>
      </dl>

      <details className="mt-3">
        <summary className="cursor-pointer text-body-sm text-acc-ink underline underline-offset-4">
          The payload exactly as it arrived
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded bg-sheet p-4 font-mono text-data text-ink-2">
          {JSON.stringify(run.rawReportJson, null, 2)}
        </pre>
      </details>
    </article>
  );
}

function SealCard({ seal }: { seal: SealRow }): React.JSX.Element {
  return (
    <article className="flex gap-4 rounded border border-rule bg-sheet-2 p-4">
      <img
        src={seal.appliedPhotoUrl}
        alt={`Seal ${seal.sealCode} applied to the machine`}
        className="h-28 w-40 shrink-0 rounded object-cover"
      />
      <div className="min-w-0">
        <SealChip sealCode={seal.sealCode} status={seal.status} />
        <p className="mt-2 text-body-sm text-ink-2">
          Applied {seal.appliedAt} by {seal.appliedByName}.
        </p>
        {seal.verifiedAt && (
          <p className="text-body-sm text-ink-2">
            Verified at pickup {seal.verifiedAt} by {seal.verifiedByName}.
          </p>
        )}
        {seal.brokenAt && (
          <p className="text-body-sm text-fail">
            Broken {seal.brokenAt}: {seal.brokenReason}. The unit goes back through QC and through
            the hub.
          </p>
        )}
        {seal.replacedBySealCode && (
          <p className="text-body-sm text-ink-2">Replaced by {seal.replacedBySealCode}.</p>
        )}
      </div>
    </article>
  );
}

export function VisitDetailRoute(): React.JSX.Element {
  const { visitId = '' } = useParams<{ visitId: string }>();
  const { data, error } = useResource<VisitDetail>(
    `/api/qc/visits/${visitId}`,
    'This visit is unavailable',
  );

  if (error) {
    return (
      <EmptyState
        title="This visit did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;

  const overVariance =
    data.geoVarianceMetres !== null && data.geoVarianceMetres > data.geoVarianceAlertMetres;

  return (
    <div>
      <p className="text-body-sm text-ink-2">
        <Link to="/qc/visits" className="text-acc-ink underline decoration-rule underline-offset-4">
          All visits
        </Link>
      </p>
      <h1 className="mt-2 text-h1 text-ink">{data.visitNumber}</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        {data.vendorName} · {data.facilityLabel} · {data.scheduledDate ?? 'not scheduled'}
      </p>

      <div className="mt-5 flex flex-wrap gap-4">
        <Link
          to={`/qc/visits/${visitId}/inspect`}
          className="rounded bg-acc-dk px-5 py-2.5 text-body-sm font-medium text-white hover:bg-acc"
        >
          Record an inspection by hand
        </Link>
      </div>

      {overVariance && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-fail bg-sheet-2 p-5 text-body-sm text-fail"
        >
          Checked in {data.geoVarianceMetres} m from the registered facility address, above the{' '}
          {data.geoVarianceAlertMetres} m threshold. A technician inspecting from somewhere other
          than the warehouse is a signal, not a rounding error.
        </div>
      )}

      <Panel title="The visit">
        <div className="grid gap-x-6 md:grid-cols-3">
          <Datum label="Status">{data.status.replace(/_/g, ' ')}</Datum>
          <Datum label="Technician">
            {data.technicianName ?? <Blank why="No technician assigned" />}
          </Datum>
          <Datum label="Requested">{data.requestedAt}</Datum>
          <Datum label="Arrived">{data.arrivedAt ?? <Blank why="Not arrived" />}</Datum>
          <Datum label="Started">{data.startedAt ?? <Blank why="Not started" />}</Datum>
          <Datum label="Completed">{data.completedAt ?? <Blank why="Not completed" />}</Datum>
          <Datum label="Vendor sign-off">
            {data.vendorSignoffAt ? (
              <>
                {data.vendorSignoffName}, {data.vendorSignoffAt}
                <span className="block text-ink-2">
                  This is the document that stops &ldquo;you never told me it failed&rdquo;.
                </span>
              </>
            ) : (
              <Blank why="The vendor contact has not signed off by OTP yet" />
            )}
          </Datum>
          <Datum label="Visit fee">
            {data.visitFee ? (
              <span className="tnum">
                {money(data.visitFee).format()}
                {data.feeBearer && <span className="text-ink-2"> · borne by {data.feeBearer}</span>}
              </span>
            ) : (
              <Blank why="No fee recorded" />
            )}
          </Datum>
          <Datum label="Units">
            <span className="tnum">
              {data.unitsPresented} presented, {data.unitsInspected} inspected, {data.unitsPassed}{' '}
              passed, {data.unitsGradeCorrected} corrected, {data.unitsFailed} failed,{' '}
              {data.unitsAbsent} absent
            </span>
          </Datum>
        </div>
        {data.notes && <p className="mt-4 text-body-sm text-ink-2">{data.notes}</p>}
      </Panel>

      <Panel
        title="Manifest"
        subtitle={`${data.manifest.length} units presented against ${data.unitsRequested} requested.`}
      >
        {data.manifest.length === 0 ? (
          <p className="text-body-sm text-ink-2">Nothing on the manifest yet.</p>
        ) : (
          <ManifestTable units={data.manifest} />
        )}
      </Panel>

      <Panel
        title="Tool runs"
        subtitle="Stored verbatim before anything was parsed. This is the evidence, so it is readable."
      >
        {data.toolRuns.length === 0 ? (
          <p className="text-body-sm text-ink-2">No tool run has been ingested for this visit.</p>
        ) : (
          data.toolRuns.map((r) => <ToolRunCard key={r.id} run={r} />)
        )}
      </Panel>

      <Panel
        title="Photographs"
        subtitle="The actual machines, not the representative images the listing shows."
      >
        {data.photos.length === 0 ? (
          <p className="text-body-sm text-ink-2">No photographs uploaded for this visit.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.photos.map((p) => (
              <figure key={p.fileKey} className="flex flex-col gap-2">
                <img
                  src={p.url}
                  alt={p.angle.replace(/_/g, ' ').toLowerCase()}
                  className="aspect-[3/2] w-full rounded border border-rule object-cover"
                />
                <figcaption className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">
                  {p.angle.replace(/_/g, ' ')}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Seals">
        {data.seals.length === 0 ? (
          <p className="text-body-sm text-ink-2">
            No seals applied yet. A passed unit is sealed and the seal is photographed on the
            machine — there is no record of one without the other.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.seals.map((s) => (
              <SealCard key={s.sealCode} seal={s} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
