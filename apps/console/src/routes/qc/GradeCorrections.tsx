import * as React from 'react';
import { money } from '@trugrade/contracts';
import { Button, EmptyState, GradeBadge, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { send } from './api';
import { Blank, TD, TH } from './controls';
import type { GradeCorrectionRow } from './types';

/**
 * Grade corrections, and where each one is in its two-day window.
 *
 * The whole screen is organised around one fact: **no response auto-applies the
 * corrected grade**, and that reprices a machine. So the sort is by time
 * remaining, soonest first, and the deadline is a column rather than something a
 * manager has to work out from a notification timestamp.
 *
 * `hoursUntilAutoApply` is computed server-side (see `types.ts`). A console that
 * subtracted two dates in the browser would let a laptop with a wrong clock move
 * a money deadline, and would show two people different numbers for the same row.
 *
 * The only action here is upholding a dispute, because it is the only decision on
 * this screen that is ours. Accept, reprice and withdraw are the vendor's, and
 * they arrive through the vendor portal. Upholding sets
 * `counts_against_accuracy = FALSE` — the scorecard is a real consequence and a
 * correction we got wrong must not sit on it.
 */

const RESPONSE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  ACCEPT_NEW_GRADE: 'Accepted the new grade',
  ACCEPT_AND_REPRICE: 'Accepted and repriced',
  WITHDRAW_UNIT: 'Withdrew the unit',
  DISPUTE: 'Disputed',
});

function Deadline({ row }: { row: GradeCorrectionRow }): React.JSX.Element {
  if (row.autoAppliedAt) {
    return <StatusPill tone="neutral" label={`Auto-applied ${row.autoAppliedAt}`} />;
  }
  if (row.vendorResponse) {
    return <StatusPill tone="info" label={RESPONSE_LABEL[row.vendorResponse] ?? row.vendorResponse} />;
  }
  if (row.hoursUntilAutoApply <= 0) {
    return <StatusPill tone="fail" label="Window closed — auto-applies on the next run" />;
  }
  return (
    <StatusPill
      tone={row.hoursUntilAutoApply <= 12 ? 'warn' : 'neutral'}
      label={`${Math.floor(row.hoursUntilAutoApply)}h left to respond`}
    />
  );
}

export function GradeCorrectionsRoute(): React.JSX.Element {
  const { data, error } = useResource<GradeCorrectionRow[]>(
    '/api/qc/grade-corrections',
    'The correction queue is unavailable',
  );
  const [upheld, setUpheld] = React.useState<Record<string, 'saving' | 'done' | string>>({});

  const rows = React.useMemo(
    () => [...(data ?? [])].sort((a, b) => a.hoursUntilAutoApply - b.hoursUntilAutoApply),
    [data],
  );

  async function uphold(id: string): Promise<void> {
    setUpheld((s) => ({ ...s, [id]: 'saving' }));
    try {
      await send<void>(
        `/api/qc/grade-corrections/${id}/uphold-dispute`,
        'POST',
        {},
        'Could not uphold the dispute',
      );
      setUpheld((s) => ({ ...s, [id]: 'done' }));
    } catch (e) {
      setUpheld((s) => ({ ...s, [id]: (e as Error).message }));
    }
  }

  if (error) {
    return (
      <EmptyState
        title="The correction queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No open grade corrections"
        body="A correction appears here the moment an inspection finds a machine is not the grade it was declared as."
      />
    );
  }

  const disputed = rows.filter((r) => r.vendorResponse === 'DISPUTE').length;
  const closing = rows.filter(
    (r) => !r.vendorResponse && !r.autoAppliedAt && r.hoursUntilAutoApply <= 12,
  ).length;

  return (
    <div>
      <h1 className="text-h1 text-ink">Grade corrections</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        {rows.length} open
        {closing > 0 && ` · ${closing} auto-apply within 12 hours`}
        {disputed > 0 && ` · ${disputed} disputed and waiting on us`}.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Grade corrections, soonest to auto-apply first.
          </caption>
          <thead>
            <tr className="border-b border-rule">
              <th scope="col" className={TH}>
                Unit
              </th>
              <th scope="col" className={TH}>
                Vendor
              </th>
              <th scope="col" className={TH}>
                Grade
              </th>
              <th scope="col" className={TH}>
                Price
              </th>
              <th scope="col" className={TH}>
                Reason
              </th>
              <th scope="col" className={TH}>
                Vendor
              </th>
              <th scope="col" className={TH}>
                Scorecard
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const state = upheld[r.id];
              return (
                <tr key={r.id} className="border-b border-rule-2 hover:bg-sheet-2">
                  <td className={TD}>
                    <code className="font-mono text-data text-ink">{r.serialNumber}</code>
                    <span className="block text-body-sm text-ink-3">{r.skuLabel}</span>
                  </td>
                  <td className={TD}>{r.vendorName}</td>
                  <td className={TD}>
                    <GradeBadge
                      grade={r.gradeCorrected}
                      variant="corrected"
                      previousGrade={r.gradeDeclared}
                    />
                  </td>
                  <td className={`${TD} tnum`}>
                    {r.priceBefore ? (
                      <>
                        <span className="text-ink-3 line-through">
                          {money(r.priceBefore).format()}
                        </span>
                        {r.priceSuggested && (
                          <span className="block text-ink">{money(r.priceSuggested).format()}</span>
                        )}
                      </>
                    ) : (
                      <Blank why="The listing carried no price when the correction was raised" />
                    )}
                  </td>
                  <td className={`${TD} max-w-sm`}>{r.reason}</td>
                  <td className={TD}>
                    <Deadline row={r} />
                    <span className="mt-1 block text-body-sm text-ink-3">
                      Notified {r.vendorNotifiedAt}
                    </span>
                  </td>
                  <td className={TD}>
                    {state === 'done' || !r.countsAgainstAccuracy ? (
                      <StatusPill tone="neutral" label="Does not count" />
                    ) : r.vendorResponse === 'DISPUTE' ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={state === 'saving'}
                          onClick={() => void uphold(r.id)}
                        >
                          Uphold the dispute
                        </Button>
                        {typeof state === 'string' && state !== 'saving' && (
                          <span className="mt-1 block text-body-sm text-fail" role="alert">
                            {state}
                          </span>
                        )}
                      </>
                    ) : (
                      <StatusPill tone="warn" label="Counts against accuracy" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
