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
import { Button, EmptyState, GradeBadge, Input, Skeleton, StatusPill } from '@trugrade/ui';
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
          : 'border-b border-l border-fail bg-sheet-2 px-2 py-3 text-center font-semibold text-fail'
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

/* ==========================================================================
 * Bulk upload
 * ======================================================================== */

/** The bulk endpoint's per-file verdict, exactly as the API declares it. */
interface BulkFileView {
  filename: string;
  ok: boolean;
  grade: Grade | null;
  viewCode: ConditionViewCode | null;
  sortOrder: number | null;
  imageId: string | null;
  error: string | null;
  expected: string | null;
  key: string | null;
  url: string | null;
  fields: Record<string, string> | null;
}

interface BulkResponse {
  dryRun: boolean;
  attached: number;
  rejected: number;
  modelName: string | null;
  convention: string;
  maxBytes: number;
  files: BulkFileView[];
}

/**
 * The three formats the presign route will issue a URL for.
 *
 * Checked here only so a `.heic` off somebody's phone does not fail the *whole*
 * request on the enum and take the per-file report down with it. The name is
 * still sent, and the parser still rejects it by extension with a sentence
 * naming what we can store — which is the answer the operator needs.
 */
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Post, and surface the sentence the API wrote for the person reading it.
 *
 * The domain filter nests its message under `error`, which the shared vendor
 * `postJson` does not know — same note as `SkuRequests.tsx`: fixing that helper
 * is the better change and it is another lane's file.
 */
async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  // 204 on a retire and a reorder, so an empty body is a success, not a parse
  // failure.
  const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | T | null;
  if (!res.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `That did not go through (${res.status}).`);
  }
  return payload as T;
}

const postJson = <T,>(url: string, body: unknown): Promise<T> => send<T>('POST', url, body);

const CAPTION_MIN = 10;
const caption = (captions: Record<string, string>, filename: string): string =>
  (captions[filename] ?? '').trim();

/** `Grade B · Lid · frame 1`, which is what the file is about to become. */
function assignment(file: BulkFileView): string {
  if (!file.grade || !file.viewCode) return 'Not assigned';
  return `Grade ${gradeLabel(file.grade)} · ${VIEW_LABEL[file.viewCode]} · frame ${file.sortOrder}`;
}

/**
 * One dropped file, with its verdict and — when it parsed — its caption box.
 *
 * The caption is not prefilled. A generated description satisfies the ten
 * characters and describes nothing, and `alt_text` is what a screen reader
 * announces and what a search engine indexes; the whole point of the field is
 * that a person looked at the photograph.
 *
 * ponytail: sixty empty boxes is a real cost. If ops asks, the lazy fix is a
 * "same caption for every frame of this grade" control, not a generator.
 */
function FileRow({
  file,
  value,
  onCaption,
}: {
  file: BulkFileView;
  value: string;
  onCaption: (v: string) => void;
}): React.JSX.Element {
  return (
    <li className="border-b border-rule-2 py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-body-sm text-ink">{file.filename}</span>
        {file.imageId ? (
          <StatusPill tone="pass" label="Stored" />
        ) : file.ok ? (
          <StatusPill tone="neutral" label={assignment(file)} />
        ) : (
          <StatusPill tone="fail" label="Not stored" />
        )}
      </div>

      {file.error && (
        <p className="mt-2 text-body-sm text-fail">
          {file.error}
          {file.expected && (
            <>
              {' '}
              <span className="text-ink-2">Expected {file.expected}</span>
            </>
          )}
        </p>
      )}

      {file.ok && !file.imageId && (
        <div className="mt-2 max-w-xl">
          <Input
            label={assignment(file)}
            required
            value={value}
            placeholder={`e.g. Grade ${file.grade ? gradeLabel(file.grade) : 'B'} lid with fine scratches near the hinge`}
            onChange={(e) => onCaption(e.target.value)}
            error={
              value.length > 0 && value.trim().length < CAPTION_MIN
                ? 'At least ten characters — this is what a screen reader announces.'
                : undefined
            }
          />
        </div>
      )}
    </li>
  );
}

/**
 * The frames a model already has, and the three things that can be done to one.
 *
 * No thumbnails, and that is a missing dependency rather than a choice: there is
 * no route that turns an `s3_key` into something a browser can render, and
 * inventing one here would put a signed object URL on a screen that does not
 * need to display the photograph to reorder it. Every frame is still uniquely
 * identified by grade, view and position, which is what the controls act on.
 *
 * ponytail: add previews when a presigned-download route exists; nothing else on
 * this panel changes.
 */
function FrameList({
  model,
  onChanged,
}: {
  model: ModelCoverage;
  onChanged: () => void;
}): React.JSX.Element | null {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retiring, setRetiring] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');

  // Same order the resolver renders in, so what is shown here is the order a
  // buyer would see rather than whatever the query returned.
  const byGrade = GRADES.map((grade) => ({
    grade,
    frames: model.images
      .filter((i) => i.grade === grade)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.viewCode.localeCompare(b.viewCode)),
  })).filter((g) => g.frames.length > 0);

  if (byGrade.length === 0) return null;

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Move one frame, and send the whole grade back in its new order.
   *
   * The API refuses a partial list on purpose: the frames left out would keep
   * positions the listed ones are about to be given.
   */
  function move(frames: ConditionImage[], index: number, delta: number): void {
    const next = [...frames];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved!);
    void run(() =>
      send('POST', '/api/catalog/condition-images/reorder', { imageIds: next.map((f) => f.id) }),
    );
  }

  return (
    <section className="mb-4">
      <h3 className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
        Frames already on {model.modelName}
      </h3>
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-fail">
          {error}
        </p>
      )}

      {byGrade.map(({ grade, frames }) => (
        <div key={grade} className="mt-3">
          <GradeBadge grade={grade} />
          <ul className="mt-2">
            {frames.map((frame, index) => (
              <li key={frame.id} className="flex flex-wrap items-center gap-2 border-b border-rule-2 py-2">
                <span className="min-w-[12rem] text-body-sm text-ink">
                  {VIEW_LABEL[frame.viewCode]} · frame {frame.sortOrder}
                </span>
                {frame.isPrimary ? (
                  <StatusPill tone="info" label="Hero frame" />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        send('POST', `/api/catalog/condition-images/${frame.id}/primary`, {}),
                      )
                    }
                  >
                    Make hero
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || index === 0}
                  aria-label={`Move ${VIEW_LABEL[frame.viewCode]} frame ${frame.sortOrder} earlier`}
                  onClick={() => move(frames, index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || index === frames.length - 1}
                  aria-label={`Move ${VIEW_LABEL[frame.viewCode]} frame ${frame.sortOrder} later`}
                  onClick={() => move(frames, index, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setRetiring(retiring === frame.id ? null : frame.id);
                    setReason('');
                  }}
                >
                  Retire
                </Button>

                {retiring === frame.id && (
                  <form
                    className="flex w-full flex-wrap items-end gap-3 pt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await send('DELETE', `/api/catalog/condition-images/${frame.id}`, {
                          reason: reason.trim(),
                        });
                        setRetiring(null);
                      });
                    }}
                  >
                    <div className="min-w-[24rem] flex-1">
                      {/* The row survives — it is the record of what a buyer was
                          shown — so "retired" alone tells the next person nothing
                          about whether the photograph was wrong or the machine
                          was simply re-shot. */}
                      <Input
                        label="Why is this frame going out of service?"
                        required
                        value={reason}
                        placeholder="e.g. re-shot under better lighting"
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      variant="danger"
                      loading={busy}
                      disabledReason={
                        reason.trim().length < 3 ? 'Say why, in words the next person can use.' : ''
                      }
                    >
                      Retire this frame
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * Drop a shoot onto a model.
 *
 * Two passes over one endpoint. The first sends only the *names*: the server
 * parses them, says what each file becomes, and hands back a presigned target
 * for the ones it could read. The bytes then go straight to object storage, and
 * the second pass hands the keys back to be written.
 *
 * Nothing here parses a filename. There is one parser and it lives on the
 * server, so the assignment shown on this screen is produced by the code that
 * will do the writing — a preview computed separately is a preview of something
 * else, and what it would be previewing is which grade a photograph is about to
 * claim to represent.
 */
function BulkUpload({
  model,
  onCommitted,
}: {
  model: ModelCoverage;
  onCommitted: () => void;
}): React.JSX.Element {
  const [over, setOver] = React.useState(false);
  const [chosen, setChosen] = React.useState<File[]>([]);
  const [plan, setPlan] = React.useState<BulkResponse | null>(null);
  const [captions, setCaptions] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function read(list: FileList | null): Promise<void> {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    setChosen(files);
    setError(null);
    setBusy('Reading the filenames…');
    try {
      setPlan(
        await postJson<BulkResponse>('/api/catalog/condition-images/bulk', {
          anchor: 'MODEL',
          anchorId: model.modelId,
          dryRun: true,
          files: files.map((f) => ({
            filename: f.name,
            ...(PHOTO_MIME.includes(f.type) ? { contentType: f.type } : {}),
          })),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ready = (plan?.files ?? []).filter((f) => f.ok && f.url && f.key && !f.imageId);
  const uncaptioned = ready.filter((f) => caption(captions, f.filename).length < CAPTION_MIN);

  async function commit(): Promise<void> {
    if (!plan) return;
    setError(null);
    const byName = new Map(chosen.map((f) => [f.name, f]));
    try {
      setBusy(`Uploading ${plural(ready.length, 'photograph', 'photographs')}…`);
      for (const file of ready) {
        const blob = byName.get(file.filename);
        if (!blob) throw new Error(`"${file.filename}" is no longer selected. Drop the folder again.`);
        // Straight to object storage on the presigned URL. The bytes never pass
        // through the API, which is why the browser is allowed to send 5 MB.
        const put = await fetch(file.url!, {
          method: 'PUT',
          headers: { 'content-type': blob.type || 'image/jpeg' },
          body: blob,
        });
        if (!put.ok) {
          throw new Error(`"${file.filename}" did not reach storage (${put.status}). Nothing was written.`);
        }
      }

      setBusy('Attaching the frames…');
      const committed = await postJson<BulkResponse>('/api/catalog/condition-images/bulk', {
        anchor: 'MODEL',
        anchorId: model.modelId,
        dryRun: false,
        // No batch `reason`: the server records the filename each frame came
        // from, and a single reason for sixty rows would erase that.
        files: ready.map((f) => ({
          filename: f.filename,
          s3Key: f.key,
          altText: caption(captions, f.filename),
        })),
      });
      // The files the dry run already rejected stay on screen with their
      // reasons. They were never uploaded, so the commit has nothing to say
      // about them, and dropping them would be the silent skip this whole
      // screen exists to avoid.
      setPlan({
        ...committed,
        files: [...committed.files, ...plan.files.filter((f) => !f.ok)],
      });
      onCommitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-sheet-2 px-3 py-4">
      <FrameList model={model} onChanged={onCommitted} />
      <div
        onDragOver={(e) => {
          // Without preventDefault the browser navigates to the dropped file.
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void read(e.dataTransfer.files);
        }}
        className={`rounded border-2 border-dashed p-6 text-center ${
          over ? 'border-acc bg-ground' : 'border-rule'
        }`}
      >
        <p className="text-body-sm text-ink">
          Drop the shoot for <span className="font-semibold">{model.modelName}</span> here.
        </p>
        <p className="mt-1 text-body-sm text-ink-2">
          Named <span className="font-mono">{plan?.convention ?? '<model>_<grade>_<view>_<n>.jpg'}</span>{' '}
          — for example{' '}
          <span className="font-mono">{model.modelName}_B_LID_TOP_1.jpg</span>. The grade and the
          view are read off the name; anything else is reported rather than skipped.
        </p>
        {/* A drop zone is unreachable by keyboard, so the file input is the
            control and the drop is the shortcut. */}
        <label className="mt-4 inline-flex cursor-pointer items-center rounded border border-rule bg-sheet px-5 py-2 text-body-sm text-ink hover:bg-ground">
          Choose photographs
          <input
            type="file"
            multiple
            accept={PHOTO_MIME.join(',')}
            className="sr-only"
            onChange={(e) => void read(e.target.files)}
          />
        </label>
      </div>

      {busy && (
        <p role="status" className="mt-3 text-body-sm text-ink-2">
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-body-sm text-fail">
          {error}
        </p>
      )}

      {plan && (
        <>
          <p className="mt-4 text-body-sm text-ink-2">
            {plan.dryRun
              ? `${plural(plan.files.length - plan.rejected, 'file', 'files')} ready · ${plural(plan.rejected, 'file', 'files')} to fix`
              : `${plural(plan.attached, 'frame', 'frames')} stored · ${plural(plan.rejected, 'file', 'files')} not stored`}
          </p>
          <ul className="mt-2">
            {plan.files.map((file) => (
              <FileRow
                key={file.filename}
                file={file}
                value={captions[file.filename] ?? ''}
                onCaption={(v) => setCaptions((c) => ({ ...c, [file.filename]: v }))}
              />
            ))}
          </ul>

          {ready.length > 0 && (
            <Button
              variant="primary"
              className="mt-4"
              loading={Boolean(busy)}
              disabledReason={
                uncaptioned.length > 0
                  ? `${plural(uncaptioned.length, 'photograph', 'photographs')} still ${uncaptioned.length === 1 ? 'needs' : 'need'} a caption. It is what a screen reader announces and what a search engine reads, so it is not optional.`
                  : ''
              }
              onClick={() => void commit()}
            >
              Upload {plural(ready.length, 'photograph', 'photographs')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ======================================================================== */

export function ConditionImageCoverageRoute(): React.JSX.Element {
  // Bumped after a bulk upload so the grid re-reads itself. The API ignores the
  // parameter; `useResource` keys its effect on the URL, and this is a smaller
  // change than teaching it to refetch.
  const [reload, setReload] = React.useState(0);
  const [openModel, setOpenModel] = React.useState<string | null>(null);

  const { data, error } = useResource<ModelCoverage[]>(
    `/api/catalog/condition-images/coverage?v=${reload}`,
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
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1 px-0"
                      aria-expanded={openModel === row.model.modelId}
                      onClick={() =>
                        setOpenModel(openModel === row.model.modelId ? null : row.model.modelId)
                      }
                    >
                      {openModel === row.model.modelId ? 'Close' : 'Add photographs'}
                    </Button>
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
                {openModel === row.model.modelId && (
                  <tr className="border-b border-rule">
                    <td colSpan={COLUMN_COUNT} className="p-0">
                      <BulkUpload
                        model={row.model}
                        onCommitted={() => setReload((n) => n + 1)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
