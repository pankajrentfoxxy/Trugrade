import * as React from 'react';
import {
  DataBoard,
  EmptyState,
  GradeBadge,
  KpiRow,
  Skeleton,
  StatusPill,
  type Column,
  type Kpi,
} from '@trugrade/ui';
import { NotMeasured, PageHeader, Section } from '../../lib/controls';
import { useResource } from '../../lib/useResource';
import type { AuditDashboard, AuditRecheckRow, TechnicianDivergenceRow } from './types';

/**
 * ARCHETYPE E — Workspace. A KPI row, then the queues it drills into.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * The 5% second look, and what it says about the people doing the first look.
 *
 * The framing matters more than the arithmetic here: **a technician whose
 * divergence rises is a training problem before it is a fraud problem.** So the
 * table sorts by divergence and says what the number means, rather than
 * colouring the top row red and leaving the reader to draw the conclusion.
 * Sample size sits next to every rate for the same reason a vendor with three
 * inspected units gets "new supplier" instead of 100% — a divergence rate over
 * four rechecks is noise wearing a percentage sign.
 *
 * Both thresholds arrive on the DTO (`qc.audit_recheck_pct` and the divergence
 * alert), because they are `platform_config` keys and a console that renders
 * them from literals is a console that lies the day one changes.
 */

const gradeLabel = (g: string): string => g.replace('_PLUS', '+');

function DivergenceDetail({ row }: { row: AuditRecheckRow }): React.JSX.Element {
  const fields = Object.entries(row.divergence);
  return (
    <details>
      <summary className="cursor-pointer text-body-sm text-acc-ink underline underline-offset-4">
        {fields.length === 0
          ? 'Agreed on everything'
          : `${fields.length} ${fields.length === 1 ? 'field' : 'fields'} disagreed`}
      </summary>
      {fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-x-5 gap-y-1 text-body-sm">
          <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">Field</dt>
          <dd className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">Original</dd>
          <dd className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">Recheck</dd>
          {fields.map(([field, v]) => (
            <React.Fragment key={field}>
              <dt className="text-ink-2">{field}</dt>
              <dd className="text-ink">{String(v.original)}</dd>
              <dd className="text-ink">{String(v.recheck)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </details>
  );
}

/**
 * The divergence cell: a rate, its denominator, and what to do about it.
 *
 * The denominator is not decoration. `09_FRONTEND_LOCKED.md`: every percentage
 * carries its sample, because 13.33% over 15 rechecks and 13.33% over 900 are
 * different facts and only one of them is worth a conversation.
 */
function divergenceColumns(alertPct: number): ReadonlyArray<Column<TechnicianDivergenceRow>> {
  return [
    {
      key: 'name',
      header: 'Technician',
      cell: (row) => (
        <>
          {row.name}
          <span className="block font-mono text-label uppercase tracking-[0.13em] text-ink-3">
            {row.employeeCode}
          </span>
        </>
      ),
    },
    {
      key: 'inspected',
      header: 'Inspected',
      numeric: true,
      cell: (row) => row.unitsInspectedTotal,
    },
    {
      key: 'rechecked',
      header: 'Rechecked',
      cell: (row) => (
        <span className="font-mono tnum">
          {row.rechecked}
          {row.unitsInspectedTotal > 0 && (
            <span className="block text-body-sm text-ink-3">
              {((row.rechecked / row.unitsInspectedTotal) * 100).toFixed(1)}% of{' '}
              {row.unitsInspectedTotal} inspections
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'divergence',
      header: 'Divergence',
      cell: (row) => {
        const rate = Number(row.divergenceRate);
        // Under ten rechecks a rate is not yet a measurement of anything. Saying
        // so is the same rule the vendor scorecard follows, for the same reason.
        const thin = row.rechecked < 10;
        const over = !thin && rate > alertPct;
        if (thin) {
          return <StatusPill tone="neutral" label={`${row.diverged} of ${row.rechecked} rechecked`} />;
        }
        return (
          <>
            <span className={over ? 'font-semibold tnum text-fail' : 'tnum text-ink'}>
              {row.divergenceRate}%
            </span>
            <span className="block font-mono text-label uppercase tracking-[0.13em] text-ink-4">
              {row.diverged} of {row.rechecked} rechecked
            </span>
            {over && (
              <span className="block text-body-sm text-fail">
                Above the {alertPct}% alert line. Sit with them before anything else.
              </span>
            )}
          </>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) =>
        row.isActive ? (
          <StatusPill tone="pass" label="Active" />
        ) : (
          <StatusPill tone="neutral" label="Inactive" />
        ),
    },
  ];
}

const RECHECK_COLUMNS: ReadonlyArray<Column<AuditRecheckRow>> = [
  {
    key: 'unit',
    header: 'Unit',
    cell: (r) => (
      <>
        <code className="font-mono text-data text-ink">{r.serialNumber}</code>
        <span className="block text-body-sm text-ink-3">{r.createdAt}</span>
      </>
    ),
  },
  {
    key: 'original',
    header: 'Original',
    cell: (r) => (
      <>
        {r.originalGrade ? (
          <GradeBadge grade={r.originalGrade} />
        ) : (
          <NotMeasured why="The original report carried no grade" label="No grade recorded" />
        )}
        <span className="mt-1 block text-body-sm text-ink-2">
          {r.originalTechnicianName}
          {r.originalScore !== null && ` · ${r.originalScore}`}
        </span>
      </>
    ),
  },
  {
    key: 'recheck',
    header: 'Recheck',
    cell: (r) => (
      <>
        {r.recheckGrade ? (
          <GradeBadge grade={r.recheckGrade} />
        ) : (
          <NotMeasured why="The recheck carried no grade" label="No grade recorded" />
        )}
        <span className="mt-1 block text-body-sm text-ink-2">
          {r.auditorName}
          {r.recheckScore !== null && ` · ${r.recheckScore}`}
        </span>
      </>
    ),
  },
  {
    key: 'difference',
    header: 'Difference',
    cell: (r) => (
      <>
        {r.originalGrade && r.recheckGrade && r.originalGrade !== r.recheckGrade && (
          // WARN, not FAIL. Two technicians disagreeing is a discrepancy to
          // resolve; red is reserved for a machine that failed inspection.
          <StatusPill
            tone="warn"
            label={`${gradeLabel(r.originalGrade)} to ${gradeLabel(r.recheckGrade)}`}
          />
        )}
        <div className="mt-1">
          <DivergenceDetail row={r} />
        </div>
      </>
    ),
  },
];

export function AuditRecheckRoute(): React.JSX.Element {
  const { data, error } = useResource<AuditDashboard>(
    '/api/qc/audit',
    'The audit dashboard is unavailable',
  );

  const technicians = React.useMemo(
    () =>
      [...(data?.technicians ?? [])].sort(
        (a, b) => Number(b.divergenceRate) - Number(a.divergenceRate),
      ),
    [data],
  );

  if (error) {
    return (
      <EmptyState
        title="The audit dashboard did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;

  const inspected = technicians.reduce((n, t) => n + t.unitsInspectedTotal, 0);
  const rechecked = technicians.reduce((n, t) => n + t.rechecked, 0);
  const actualPct = inspected === 0 ? 0 : (rechecked / inspected) * 100;
  const underTarget = actualPct < data.targetRecheckPct;
  const overAlert = technicians.filter(
    (t) => t.rechecked >= 10 && Number(t.divergenceRate) > data.divergenceAlertPct,
  ).length;

  /**
   * `KpiPercentage` will not compile without a denominator, which is the type
   * doing the design rule's enforcement: a rate with no sample size behind it
   * cannot reach this screen.
   */
  const kpis: Kpi[] = [
    {
      key: 'recheck-rate',
      label: 'Rechecked',
      // `null` when nothing has been inspected: "no reading" and "0%" are
      // different facts and the tile must not render them alike.
      pct: inspected === 0 ? null : Number(actualPct.toFixed(1)),
      denominator: inspected,
      denominatorLabel: 'inspections',
      hint: `Against a ${data.targetRecheckPct}% target.`,
    },
    {
      key: 'rechecks',
      label: 'Rechecks recorded',
      value: data.rechecks.length,
      unit: data.rechecks.length === 1 ? 'recheck' : 'rechecks',
    },
    {
      key: 'over-alert',
      label: 'Technicians over the alert line',
      value: overAlert,
      unit: 'of ' + technicians.length,
      hint: `Above ${data.divergenceAlertPct}% divergence over ten or more rechecks.`,
    },
  ];

  return (
    <div className="tg-stack">
      <PageHeader title="Audit rechecks">
        A second technician re-inspects a share of completed work. Divergence is a training signal
        first.
      </PageHeader>

      <KpiRow label="This period" items={kpis} />

      {underTarget && (
        <p className="text-body-sm text-warn">
          {rechecked} of {inspected} inspections rechecked, against a {data.targetRecheckPct}%
          target. Below target. The recheck is the only independent read on whether the grades we
          sell are the grades in the boxes.
        </p>
      )}

      <Section title="Technician divergence" subtitle="Worst first.">
        <DataBoard
          caption="Divergence rate by technician, highest first."
          columns={divergenceColumns(data.divergenceAlertPct)}
          rows={technicians}
          rowKey={(t) => t.technicianId}
          empty={
            <EmptyState
              title="No inspections yet"
              body="No technician has completed an inspection, so there is nothing to recheck against."
            />
          }
        />
      </Section>

      <Section title="Recheck queue" subtitle={`${data.rechecks.length} rechecks recorded.`}>
        <DataBoard
          caption="Audit rechecks and where the two reports differ."
          columns={RECHECK_COLUMNS}
          rows={data.rechecks}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              title="Nothing has been rechecked yet"
              body="A recheck appears here once a second technician re-inspects a completed unit."
            />
          }
        />
      </Section>
    </div>
  );
}
