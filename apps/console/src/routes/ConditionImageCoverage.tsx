import * as React from 'react';
import {
  GRADES,
  REQUIRED_VIEWS,
  isPublishable,
  type ConditionImage,
  type ConditionViewCode,
  type Grade,
  type PublishCheck,
} from '@trugrade/contracts';
import { EmptyState, GradeBadge, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../lib/useResource';

export interface ModelCoverage {
  modelId: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  /** Every live image anchored to this model. The grid is derived here, never served. */
  images: ConditionImage[];
}

const VIEW_LABEL: Record<ConditionViewCode, string> = {
  LID_TOP: 'Lid',
  PALMREST: 'Palmrest',
  KEYBOARD: 'Keys',
  SCREEN_ON: 'Screen',
  PORTS_LEFT: 'Ports L',
  PORTS_RIGHT: 'Ports R',
  BASE: 'Base',
  HINGE: 'Hinge',
  CORNER_WEAR: 'Corner wear',
  SCREEN_DEFECT: 'Screen defect',
};

const gradeLabel = (g: Grade): string => g.replace('_PLUS', '+');

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const COLUMN_COUNT = 2 + GRADES.length * REQUIRED_VIEWS.length;

interface Row {
  model: ModelCoverage;
  /** `grade|viewCode` for every slot that has a live image. */
  present: Set<string>;
  gapCount: number;
  checks: Array<{ grade: Grade; check: PublishCheck }>;
  blockedGrades: number;
}

function toRow(model: ModelCoverage): Row {
  const present = new Set(model.images.map((i) => `${i.grade}|${i.viewCode}`));
  const checks = GRADES.map((grade) => ({ grade, check: isPublishable(grade, model.images) }));
  return {
    model,
    present,
    gapCount: checks.reduce((n, c) => n + c.check.gaps.length, 0),
    checks,
    blockedGrades: checks.filter((c) => !c.check.publishable).length,
  };
}

/**
 * What a buyer gets instead of this photograph, in the words the storefront uses.
 *
 * `resolveConditionImages` falls back through model then series then placeholder
 * but never across grades, so an empty slot is either someone else's machine or
 * an explicit placeholder. Both are worse than the real frame, and neither is
 * visible from the admin side unless this cell says so.
 */
function gapSentence(model: ModelCoverage, grade: Grade, view: ConditionViewCode): string {
  return (
    `No image for ${model.modelName} · Grade ${gradeLabel(grade)} · ` +
    `${VIEW_LABEL[view].toLowerCase()} — buyers see the generic set for the range, ` +
    `or a placeholder if there is none.`
  );
}

/**
 * One (grade, view) slot.
 *
 * A filled cell is deliberately the quiet one. Most slots are filled, and a wall
 * of green makes the handful of empty ones no easier to find than a wall of
 * grey — the gap is the only thing on this screen worth looking at.
 */
function Cell({
  row,
  grade,
  view,
}: {
  row: Row;
  grade: Grade;
  view: ConditionViewCode;
}): React.JSX.Element {
  const filled = row.present.has(`${grade}|${view}`);
  const sentence = gapSentence(row.model, grade, view);
  return (
    <td
      data-state={filled ? 'filled' : 'gap'}
      title={filled ? undefined : sentence}
      className={
        filled
          ? 'border-b border-l border-rule-2 px-2 py-3 text-center text-ink-3'
          : 'border-b border-l border-fail bg-fail-wash px-2 py-3 text-center font-semibold text-fail'
      }
    >
      {/* Never colour alone: the glyph carries the same distinction as the fill. */}
      <span aria-hidden="true">{filled ? '•' : '✕'}</span>
      <span className="sr-only">
        {filled ? `Grade ${gradeLabel(grade)} ${VIEW_LABEL[view]} present` : sentence}
      </span>
    </td>
  );
}

/** The per-grade publish gate, shown only where something is blocking it. */
function PublishReasons({ row }: { row: Row }): React.JSX.Element {
  return (
    <tr className="border-b border-rule">
      <td colSpan={COLUMN_COUNT} className="bg-sheet-2 px-3 py-4">
        <ul className="flex flex-col gap-3">
          {row.checks.map(({ grade, check }) => (
            <li key={grade} className="flex flex-wrap items-center gap-3">
              <GradeBadge grade={grade} />
              {check.publishable ? (
                <StatusPill tone="pass" label="Publishable" />
              ) : (
                <StatusPill tone="fail" label="Cannot publish" />
              )}
              {check.reasons.map((reason) => (
                <span key={reason} className="text-body-sm text-ink-2">
                  {reason}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

/** Zero gaps is not the same as publishable — Grade B also needs its worst-wear frame. */
function CoverageCell({ row }: { row: Row }): React.JSX.Element {
  if (row.gapCount > 0) {
    return <StatusPill tone="fail" label={plural(row.gapCount, 'gap', 'gaps')} />;
  }
  if (row.blockedGrades > 0) {
    return (
      <StatusPill tone="fail" label={`${plural(row.blockedGrades, 'grade', 'grades')} blocked`} />
    );
  }
  return <StatusPill tone="pass" label="Complete" />;
}

export function ConditionImageCoverageRoute(): React.JSX.Element {
  const { data, error } = useResource<ModelCoverage[]>(
    '/api/catalog/condition-images/coverage',
    'Coverage unavailable',
  );

  // Worst first. The screen exists to surface gaps, and a gap sorted below two
  // hundred complete models is a gap nobody sees until a buyer does.
  const rows = React.useMemo(
    () =>
      (data ?? [])
        .map(toRow)
        .sort((a, b) => b.gapCount - a.gapCount || b.blockedGrades - a.blockedGrades),
    [data],
  );

  if (error) {
    return (
      <EmptyState
        title="The coverage grid did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={10} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No models in the catalog yet"
        body="The grid fills in as models are added. A grade cannot be sold for a model until its image set is complete."
      />
    );
  }

  const totalGaps = rows.reduce((n, r) => n + r.gapCount, 0);
  const modelsWithGaps = rows.filter((r) => r.gapCount > 0).length;
  const blocked = rows.reduce((n, r) => n + r.blockedGrades, 0);

  return (
    <div>
      <h1 className="text-h1 text-ink">Condition image coverage</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        {modelsWithGaps > 0 ? (
          <>
            <span className="font-semibold text-fail">
              {modelsWithGaps} of {rows.length} models have gaps
            </span>{' '}
            · {plural(totalGaps, 'empty slot', 'empty slots')} ·{' '}
            {plural(blocked, 'grade', 'grades')} cannot be published
          </>
        ) : blocked > 0 ? (
          <>
            Every slot is filled, but{' '}
            <span className="font-semibold text-fail">
              {plural(blocked, 'grade', 'grades')} cannot be published
            </span>
            .
          </>
        ) : (
          <>Every model has a complete set in every grade.</>
        )}
      </p>
      <p className="mt-1 text-body-sm text-ink-3">
        <span aria-hidden="true">✕</span> marks an empty slot, and an empty slot is what puts a
        placeholder on a live listing. <span aria-hidden="true">•</span> is a live image.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">
            Condition image coverage by model, grade and view. Empty slots are marked as gaps.
          </caption>
          <thead>
            <tr className="border-b border-rule text-left">
              <th
                rowSpan={2}
                scope="col"
                className="px-3 py-2 font-mono text-label uppercase tracking-[0.13em] text-ink-2"
              >
                Model
              </th>
              {GRADES.map((grade) => (
                <th
                  key={grade}
                  colSpan={REQUIRED_VIEWS.length}
                  scope="colgroup"
                  className="border-l border-rule px-2 py-2 text-center font-mono text-label uppercase tracking-[0.13em] text-ink-2"
                >
                  Grade {gradeLabel(grade)}
                </th>
              ))}
              <th
                rowSpan={2}
                scope="col"
                className="border-l border-rule px-3 py-2 font-mono text-label uppercase tracking-[0.13em] text-ink-2"
              >
                Coverage
              </th>
            </tr>
            <tr className="border-b border-rule">
              {GRADES.flatMap((grade) =>
                REQUIRED_VIEWS.map((view) => (
                  <th
                    key={`${grade}|${view}`}
                    scope="col"
                    className="border-l border-rule-2 px-2 py-2 text-center text-body-sm font-normal text-ink-3"
                  >
                    {VIEW_LABEL[view]}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <React.Fragment key={row.model.modelId}>
                <tr className="border-b border-rule-2 hover:bg-sheet-2">
                  <td className="px-3 py-3">
                    <span className="text-ink">{row.model.modelName}</span>
                    <span className="block text-body-sm text-ink-3">
                      {row.model.brandName} · {row.model.seriesName}
                    </span>
                  </td>
                  {GRADES.flatMap((grade) =>
                    REQUIRED_VIEWS.map((view) => (
                      <Cell key={`${grade}|${view}`} row={row} grade={grade} view={view} />
                    )),
                  )}
                  <td className="border-l border-rule-2 px-3 py-3">
                    <CoverageCell row={row} />
                  </td>
                </tr>
                {row.blockedGrades > 0 && <PublishReasons row={row} />}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
