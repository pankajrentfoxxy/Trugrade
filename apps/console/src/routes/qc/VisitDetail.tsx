import * as React from 'react';
import { useNavigate, useParams } from 'react-router';
import { money } from '@trugrade/contracts';
import {
  Barcode,
  Breadcrumb,
  Button,
  DataBoard,
  EmptyState,
  GradeBadge,
  RecordHeader,
  SealChip,
  Skeleton,
  StatusPill,
  type Column,
  type StatusPillProps,
} from '@trugrade/ui';
import { Datum, NotMeasured, Section } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import type { ManifestUnit, SealRow, ToolRunRow, UnitOutcome, VisitDetail } from './types';

/**
 * ARCHETYPE C — Record. Identity header + evidence panels + one action.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
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
  // Not red. UNTESTABLE is "we could not measure it", which is a different claim
  // from "it failed" and the one the vendor's appeal turns on. A missing
  // measurement must not render as a passing one, and it must not render as a
  // failing one either.
  UNTESTABLE: 'warn',
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

const MANIFEST_COLUMNS: ReadonlyArray<Column<ManifestUnit>> = [
  {
    key: 'sequenceNo',
    header: '#',
    numeric: true,
    cell: (u) => <span className="text-ink-3">{u.sequenceNo}</span>,
  },
  {
    key: 'serial',
    header: 'Serial',
    cell: (u) => <code className="font-mono text-data text-ink">{u.serialNumber}</code>,
  },
  { key: 'sku', header: 'SKU', cell: (u) => u.skuLabel },
  {
    key: 'declared',
    header: 'Declared',
    cell: (u) =>
      u.declaredGrade ? (
        <GradeBadge grade={u.declaredGrade} variant="declared" />
      ) : (
        <NotMeasured why="The vendor declared no grade" label="None declared" />
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
  {
    key: 'duration',
    header: 'Time on unit',
    cell: (u) =>
      u.durationSeconds === null ? (
        <NotMeasured why="This unit was not inspected" label="Not inspected" />
      ) : (
        <span className="font-mono tnum">{Math.round(u.durationSeconds / 60)} min</span>
      ),
  },
];

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
      {/* The schema says NOT NULL — there is no seal without a photograph — but
          an empty string still reaches the browser as a broken image with the
          alt text spilled across the card. Say what is missing instead. */}
      {seal.appliedPhotoUrl ? (
        <img
          src={seal.appliedPhotoUrl}
          alt={`Seal ${seal.sealCode} applied to the machine`}
          className="h-28 w-40 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex h-28 w-40 shrink-0 items-center justify-center rounded border border-dashed border-rule text-center text-body-sm text-ink-4">
          Photograph missing
        </div>
      )}
      <div className="min-w-0">
        <SealChip sealCode={seal.sealCode} status={seal.status} />
        {/* The barcode is derived from the seal code and shown beside it — a
            motif that carries information, per 09_FRONTEND_LOCKED.md §4. */}
        <Barcode code={seal.sealCode} className="mt-2" />
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
  const navigate = useNavigate();
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
    <div className="tg-stack">
      <Breadcrumb items={[{ label: 'All visits', href: '/qc/visits' }, { label: 'Visit' }]} />

      <RecordHeader
        title={data.visitNumber}
        subtitle={`${data.vendorName} · ${data.facilityLabel}`}
        status={<StatusPill tone="info" label={data.status.replace(/_/g, ' ')} />}
        identifiers={[
          {
            label: 'Scheduled',
            value: data.scheduledDate ?? 'Not scheduled',
          },
          { label: 'Units requested', value: data.unitsRequested },
          { label: 'Units inspected', value: data.unitsInspected },
        ]}
        // The one amber control on the screen, and the only thing here that
        // writes anything.
        // `Button` has no `asChild`, so a primary action that navigates is a
        // button that navigates. Reported as a packages/ui gap rather than
        // re-implementing the amber fill on a <Link> here — a second copy of the
        // primary style is how the primary style drifts.
        action={
          <Button
            variant="primary"
            onClick={() => void navigate(`/qc/visits/${visitId}/inspect`)}
          >
            Record an inspection by hand
          </Button>
        }
      />

      {overVariance && (
        <div
          role="alert"
          className="tg-card rounded-lg border border-fail bg-sheet-2 text-body-sm text-fail"
        >
          Checked in <span className="font-mono tnum">{data.geoVarianceMetres} m</span> from the
          registered facility address, above the{' '}
          <span className="font-mono tnum">{data.geoVarianceAlertMetres} m</span> threshold. A
          technician inspecting from somewhere other than the warehouse is a signal, not a rounding
          error.
        </div>
      )}

      <Section title="The visit">
        <div className="grid gap-x-6 md:grid-cols-3">
          <Datum label="Status">{data.status.replace(/_/g, ' ')}</Datum>
          <Datum label="Technician">
            {data.technicianName ?? (
              <NotMeasured why="No technician has been assigned" label="Not assigned" />
            )}
          </Datum>
          <Datum label="Requested">{data.requestedAt}</Datum>
          <Datum label="Arrived">
            {data.arrivedAt ?? <NotMeasured why="The technician has not arrived" label="Not arrived" />}
          </Datum>
          <Datum label="Started">
            {data.startedAt ?? <NotMeasured why="The visit has not started" label="Not started" />}
          </Datum>
          <Datum label="Completed">
            {data.completedAt ?? (
              <NotMeasured why="The visit is not finished" label="Not completed" />
            )}
          </Datum>
          <Datum label="Vendor sign-off">
            {data.vendorSignoffAt ? (
              <>
                {data.vendorSignoffName}, {data.vendorSignoffAt}
                <span className="block text-ink-2">
                  This is the document that stops &ldquo;you never told me it failed&rdquo;.
                </span>
              </>
            ) : (
              <NotMeasured
                why="The vendor contact has not signed off by OTP yet"
                label="Not signed off"
              />
            )}
          </Datum>
          <Datum label="Visit fee">
            {data.visitFee ? (
              <span className="font-mono tnum">
                {money(data.visitFee).format()}
                {data.feeBearer && <span className="text-ink-2"> · borne by {data.feeBearer}</span>}
              </span>
            ) : (
              <NotMeasured why="No fee has been recorded for this visit" label="No fee recorded" />
            )}
          </Datum>
          <Datum label="Units">
            <span className="font-mono tnum">
              {data.unitsPresented} presented, {data.unitsInspected} inspected, {data.unitsPassed}{' '}
              passed, {data.unitsGradeCorrected} corrected, {data.unitsFailed} failed,{' '}
              {data.unitsAbsent} absent
            </span>
          </Datum>
        </div>
        {data.notes && <p className="mt-4 text-body-sm text-ink-2">{data.notes}</p>}
      </Section>

      <Section
        title="Manifest"
        subtitle={`${data.manifest.length} units presented against ${data.unitsRequested} requested.`}
      >
        <DataBoard
          caption="The units on this visit and what happened to each."
          columns={MANIFEST_COLUMNS}
          rows={data.manifest}
          rowKey={(u) => u.visitUnitId}
          empty={
            <EmptyState
              title="Nothing on the manifest yet"
              body="Units appear here when the technician records what the vendor presented."
            />
          }
        />
      </Section>

      <Section
        title="Tool runs"
        subtitle="Stored verbatim before anything was parsed. This is the evidence, so it is readable."
      >
        {data.toolRuns.length === 0 ? (
          <EmptyState
            title="No tool run ingested"
            body="Nothing has been submitted by a diagnostic tool for this visit yet."
          />
        ) : (
          data.toolRuns.map((r) => <ToolRunCard key={r.id} run={r} />)
        )}
      </Section>

      <Section
        title="Photographs"
        subtitle="The actual machines, not the representative images the listing shows."
      >
        {data.photos.length === 0 ? (
          <EmptyState
            title="No photographs uploaded"
            body="Photographs are captured during the inspection and appear here once the technician uploads them."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.photos.map((p) => (
              // No viewfinder brackets: `PhotoRow` carries no serial, and a
              // bracket asserts "this unit was captured and identified". A motif
              // on evidence it cannot vouch for is the one thing §4 forbids.
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
      </Section>

      <Section title="Seals">
        {data.seals.length === 0 ? (
          <EmptyState
            title="No seals applied yet"
            body="A passed unit is sealed and the seal is photographed on the machine — there is no record of one without the other."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.seals.map((s) => (
              <SealCard key={s.sealCode} seal={s} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
