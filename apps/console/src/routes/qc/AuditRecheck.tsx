import * as React from 'react';
import { EmptyState, GradeBadge, ScoreRing, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { Blank, Panel, TD, TH } from './controls';
import type { AuditDashboard, AuditRecheckRow, TechnicianDivergenceRow } from './types';

/**
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

function TechnicianRow({
  row,
  alertPct,
}: {
  row: TechnicianDivergenceRow;
  alertPct: number;
}): React.JSX.Element {
  const rate = Number(row.divergenceRate);
  // Under ten rechecks a rate is not yet a measurement of anything. Saying so is
  // the same rule the vendor scorecard follows, and for the same reason.
  const thin = row.rechecked < 10;
  const over = !thin && rate > alertPct;

  return (
    <tr className="border-b border-rule-2">
      <th scope="row" className={`${TD} font-normal`}>
        {row.name}
        <span className="block font-mono text-label uppercase tracking-[0.13em] text-ink-3">
          {row.employeeCode}
        </span>
      </th>
      <td className={`${TD} tnum`}>{row.unitsInspectedTotal}</td>
      <td className={`${TD} tnum`}>
        {row.rechecked}
        {row.unitsInspectedTotal > 0 && (
          <span className="block text-body-sm text-ink-3">
            {((row.rechecked / row.unitsInspectedTotal) * 100).toFixed(1)}% of their work
          </span>
        )}
      </td>
      <td className={TD}>
        {thin ? (
          <StatusPill tone="neutral" label={`${row.diverged} of ${row.rechecked} rechecked`} />
        ) : (
          <>
            <span className={over ? 'font-semibold tnum text-fail' : 'tnum text-ink'}>
              {row.divergenceRate}%
            </span>
            {over && (
              <span className="block text-body-sm text-fail">
                Above the {alertPct}% alert line. Sit with them before anything else.
              </span>
            )}
          </>
        )}
      </td>
      <td className={TD}>
        {row.isActive ? (
          <StatusPill tone="pass" label="Active" />
        ) : (
          <StatusPill tone="neutral" label="Inactive" />
        )}
      </td>
    </tr>
  );
}

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

  return (
    <div>
      <h1 className="text-h1 text-ink">Audit rechecks</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        A second technician re-inspects a share of completed work. Divergence is a training signal
        first.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-5 rounded-lg border border-rule bg-sheet p-5">
        <ScoreRing value={Math.round(actualPct)} label="% rechecked" />
        <div>
          <p className="text-body-sm text-ink">
            {rechecked} of {inspected} inspections rechecked, against a {data.targetRecheckPct}%
            target.
          </p>
          {underTarget && (
            <p className="mt-1 text-body-sm text-warn">
              Below target. The recheck is the only independent read on whether the grades we sell
              are the grades in the boxes.
            </p>
          )}
        </div>
      </div>

      <Panel title="Technician divergence" subtitle="Worst first.">
        {technicians.length === 0 ? (
          <p className="text-body-sm text-ink-2">No technicians have completed an inspection yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">Divergence rate by technician.</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className={TH}>
                    Technician
                  </th>
                  <th scope="col" className={TH}>
                    Inspected
                  </th>
                  <th scope="col" className={TH}>
                    Rechecked
                  </th>
                  <th scope="col" className={TH}>
                    Divergence
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {technicians.map((t) => (
                  <TechnicianRow
                    key={t.technicianId}
                    row={t}
                    alertPct={data.divergenceAlertPct}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recheck queue" subtitle={`${data.rechecks.length} rechecks recorded.`}>
        {data.rechecks.length === 0 ? (
          <p className="text-body-sm text-ink-2">Nothing has been rechecked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">Audit rechecks and where the two reports differ.</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className={TH}>
                    Unit
                  </th>
                  <th scope="col" className={TH}>
                    Original
                  </th>
                  <th scope="col" className={TH}>
                    Recheck
                  </th>
                  <th scope="col" className={TH}>
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rechecks.map((r) => (
                  <tr key={r.id} className="border-b border-rule-2">
                    <td className={TD}>
                      <code className="font-mono text-data text-ink">{r.serialNumber}</code>
                      <span className="block text-body-sm text-ink-3">{r.createdAt}</span>
                    </td>
                    <td className={TD}>
                      {r.originalGrade ? (
                        <GradeBadge grade={r.originalGrade} />
                      ) : (
                        <Blank why="The original report carried no grade" />
                      )}
                      <span className="mt-1 block text-body-sm text-ink-2">
                        {r.originalTechnicianName}
                        {r.originalScore !== null && ` · ${r.originalScore}`}
                      </span>
                    </td>
                    <td className={TD}>
                      {r.recheckGrade ? (
                        <GradeBadge grade={r.recheckGrade} />
                      ) : (
                        <Blank why="The recheck carried no grade" />
                      )}
                      <span className="mt-1 block text-body-sm text-ink-2">
                        {r.auditorName}
                        {r.recheckScore !== null && ` · ${r.recheckScore}`}
                      </span>
                    </td>
                    <td className={TD}>
                      {r.originalGrade && r.recheckGrade && r.originalGrade !== r.recheckGrade && (
                        <StatusPill
                          tone="fail"
                          label={`${gradeLabel(r.originalGrade)} to ${gradeLabel(r.recheckGrade)}`}
                        />
                      )}
                      <div className="mt-1">
                        <DivergenceDetail row={r} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
