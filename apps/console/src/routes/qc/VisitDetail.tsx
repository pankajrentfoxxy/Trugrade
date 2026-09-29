import * as React from 'react';
import { Link, useParams } from 'react-router';
import { money } from '@trugrade/contracts';
import { EmptyState, Modal, Skeleton, StatusPill, cn } from '@trugrade/ui';
import { NotMeasured } from '../../lib/controls';
import { usePrincipal } from '../../lib/auth';
import { useResource } from '../../lib/useResource';
import { VisitActions } from './VisitActions';
import { atTime, elapsed, initials, onDay, shortName } from './OrderInspections';
import {
  PHOTO_ANGLES,
  type ManifestUnit,
  type PhotoAngle,
  type PhotoRow,
  type SealRow,
  type ToolRunRow,
  type UnitOutcome,
  type VisitDetail,
  type VisitStatus,
} from './types';

/**
 * ARCHETYPE C — Record. Identity header + evidence panels + the actions the
 * visit's state allows.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * One visit, read the way a QC manager reads it: what happened to each
 * machine, and whether the record adds up. The raw tool payload is viewable
 * here and that is not a debugging convenience — when a buyer disputes a grade
 * in four months the original is the evidence, and evidence nobody can look at
 * is filing.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.vd-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the other admin screens:
 *
 * - **"This visit doesn't add up" is arithmetic on the record, not a
 *   judgement.** Every line in it is something the data contradicts itself
 *   on: one photograph filed under several angles or machines, inspections
 *   that add up to more time than the visit ran or fall outside it, a visit
 *   closed before its scheduled day, closed with no arrival or sign-off, passes
 *   with no tool run behind them, a check-in far from the warehouse, a tool
 *   that read a serial not on the manifest. The design's first line — "the
 *   photos aren't of these machines" — needs a pair of eyes, so it is not
 *   claimed; the reused-image check is the part of it a machine can state.
 *   Whether the machines are on sale is read from each unit, never assumed.
 * - **The design's two header actions are not here.** "Schedule a recheck"
 *   and "Pull listings & reopen" have no endpoint that takes a visit; rechecks
 *   are sampled by the audit job and a listing is pulled from the listing.
 *   Two buttons that lead nowhere would teach the reader the capability
 *   exists. The actions the visit's state does allow — booking, arrival,
 *   sign-off, closing — are in the side column.
 * - **A step that has not happened is drawn as not happened.** On a closed
 *   visit a missing arrival or sign-off is a red dashed step, because the
 *   visit was closed over the top of it; on an open visit the same step is a
 *   grey dashed step still to come.
 */

const OUTCOME_LABEL: Readonly<Record<UnitOutcome, string>> = Object.freeze({
  PENDING: 'Not inspected yet',
  PASS: 'Passed',
  PASS_GRADE_CORRECTED: 'Passed, grade corrected',
  PASS_WITH_NOTE: 'Passed, with a note',
  FAIL: 'Failed',
  // Not red. UNTESTABLE is "we could not measure it", a different claim from
  // "it failed" and the one the vendor's appeal turns on.
  UNTESTABLE: 'Untestable',
  ABSENT: 'Not presented',
});
const OUTCOME_PILL: Readonly<Record<UnitOutcome, string>> = Object.freeze({
  PENDING: 'vd-pill--neutral',
  PASS: 'vd-pill--ok',
  PASS_GRADE_CORRECTED: 'vd-pill--ok',
  PASS_WITH_NOTE: 'vd-pill--ok',
  FAIL: 'vd-pill--bad',
  UNTESTABLE: 'vd-pill--warn',
  ABSENT: 'vd-pill--neutral',
});
const PHOTO_SHORT: Readonly<Record<PhotoAngle, string>> = Object.freeze({
  LID: 'Lid',
  PALMREST: 'Palmrest',
  SCREEN_ON: 'Screen on',
  BASE: 'Base',
  PORTS: 'Ports',
  WORST_DEFECT: 'Worst defect',
});
const BEARER: Readonly<Record<NonNullable<VisitDetail['feeBearer']>, string>> = Object.freeze({
  TRUETECH: 'paid by TrueTech',
  VENDOR: 'paid by the vendor',
  SPLIT: 'split with the vendor',
  WAIVED: 'waived',
});

const CLOSED: readonly VisitStatus[] = ['COMPLETED', 'PARTIALLY_COMPLETED'];
const isClosed = (s: VisitStatus): boolean => CLOSED.includes(s);
const passedOutcome = (o: UnitOutcome): boolean => o.startsWith('PASS');

function statusPill(s: VisitStatus): { cls: string; label: string } {
  const label = s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');
  if (s === 'COMPLETED') return { cls: 'vd-pill--ok', label };
  if (s === 'PARTIALLY_COMPLETED') return { cls: 'vd-pill--warn', label: 'Partly completed' };
  if (s === 'CANCELLED' || s === 'NO_SHOW_VENDOR' || s === 'NO_SHOW_TECH') return { cls: 'vd-pill--bad', label: label.replace('No show', 'No-show:') };
  if (s === 'IN_PROGRESS' || s === 'EN_ROUTE') return { cls: 'vd-pill--info', label };
  return { cls: 'vd-pill--neutral', label };
}

const gradeLabel = (g: string): string => g.replace('_PLUS', '+');
/** `3½ min`, `24 min`, `under a minute` — the design's way of writing a duration. */
export function spanOf(seconds: number): string {
  if (seconds < 30) return 'under a minute';
  const whole = Math.floor(seconds / 60);
  const half = seconds % 60 >= 30;
  if (whole === 0) return '½ min';
  return `${whole}${half ? '½' : ''} min`;
}
const secondsBetween = (a: string, b: string): number => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
/** `YYYY-MM-DD` in IST, the calendar the schedule is kept in. */
const istDay = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const dayNoYear = (iso: string): string => onDay(iso).replace(/ \d{4}$/, '');
/** `a, b and c`. */
const listWords = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ---- the integrity checks --------------------------------------------- */

export interface Problem {
  severity: 'bad' | 'warn';
  title: string;
  detail: string;
}

/**
 * Where the record contradicts itself. Pure, so it can be tested without a
 * screen; sorted worst first.
 */
export function integrityProblems(v: VisitDetail): Problem[] {
  const out: Problem[] = [];
  const closed = isClosed(v.status);
  const unitNo = new Map(v.manifest.filter((u) => u.qcReportId !== null).map((u) => [u.qcReportId as string, u.sequenceNo]));
  const where = (reportId: string): string => `#${unitNo.get(reportId) ?? '?'}`;

  // One image filed as several photographs.
  const uses = new Map<string, string[]>();
  const use = (key: string, as: string): void => {
    uses.set(key, [...(uses.get(key) ?? []), as]);
  };
  for (const p of v.photos) use(p.fileKey, `${PHOTO_SHORT[p.angle]} on ${where(p.qcReportId)}`);
  for (const s of v.seals) use(s.appliedPhotoKey, `the seal on ${where(s.qcReportId)}`);
  const reused = [...uses.values()].filter((l) => l.length > 1);
  if (reused.length > 0) {
    out.push({
      severity: 'bad',
      title: reused.length === 1 ? 'The same photograph is used more than once.' : `${reused.length} photographs are each used more than once.`,
      detail: `${reused.map((l) => `One image is ${listWords(l)}.`).join(' ')} A photograph is evidence of one machine from one angle.`,
    });
  }

  // The inspections' clocks against the visit's.
  const timed = v.manifest.filter((u) => u.durationSeconds !== null);
  if (v.startedAt && v.completedAt && timed.length > 0) {
    const claimed = timed.reduce((n, u) => n + (u.durationSeconds ?? 0), 0);
    const ran = secondsBetween(v.startedAt, v.completedAt);
    if (claimed > ran + 60) {
      out.push({
        severity: 'bad',
        title: 'The times contradict each other.',
        detail: `It says ${timed.map((u) => spanOf(u.durationSeconds ?? 0)).join(' + ')} = ${spanOf(claimed)} on units, but the visit ran ${spanOf(ran)} (${atTime(v.startedAt)} – ${atTime(v.completedAt)}).`,
      });
    }
    const outside = v.manifest.filter(
      (u) => (u.startedAt !== null && u.startedAt < v.startedAt!) || (u.completedAt !== null && u.completedAt > v.completedAt!),
    );
    if (outside.length > 0) {
      out.push({
        severity: 'bad',
        title: outside.length === 1 ? 'An inspection is timed outside the visit.' : `${outside.length} inspections are timed outside the visit.`,
        detail: `${outside
          .map((u) => `#${u.sequenceNo} is timed ${u.startedAt ? atTime(u.startedAt) : '?'} – ${u.completedAt ? atTime(u.completedAt) : '?'} on ${dayNoYear(u.startedAt ?? u.completedAt ?? v.startedAt!)}`)
          .join('; ')}, and the visit ran ${atTime(v.startedAt)} – ${atTime(v.completedAt)} on ${dayNoYear(v.startedAt)}.`,
      });
    }
  }

  // Closed before the day it was booked for.
  if (v.completedAt && v.scheduledDate && istDay(v.completedAt) < v.scheduledDate) {
    out.push({
      severity: 'bad',
      title: 'It was closed before its date.',
      detail: `Scheduled for ${dayNoYear(v.scheduledDate)}, it was completed on ${dayNoYear(v.completedAt)}, ${elapsed(v.requestedAt, v.completedAt)} after it was requested.`,
    });
  }

  // A check-in far from the warehouse.
  if (v.geoVarianceMetres !== null && v.geoVarianceMetres > v.geoVarianceAlertMetres) {
    out.push({
      severity: 'bad',
      title: `The check-in was ${v.geoVarianceMetres} m from the warehouse.`,
      detail: `Above the ${v.geoVarianceAlertMetres} m threshold. A technician inspecting from somewhere other than the site is a signal, not a rounding error.`,
    });
  }

  // A tool that read a label belonging to a different laptop.
  const mismatched = v.toolRuns.filter((r) => r.serialMatches === false);
  if (mismatched.length > 0) {
    out.push({
      severity: 'bad',
      title: 'A tool read a serial that is not on the manifest.',
      detail: `${listWords(mismatched.map((r) => r.serialFromTool ?? 'an unreadable serial'))} — the label does not belong to the laptop it was on. Nothing under it is graded, sealed or listed until somebody has looked.`,
    });
  }

  // Closed over the top of the steps that put the technician in the building.
  if (closed && (!v.arrivedAt || !v.vendorSignoffAt)) {
    const gaps = [!v.arrivedAt ? 'No arrival was recorded' : '', !v.vendorSignoffAt ? 'the vendor never signed off' : ''].filter(Boolean);
    const first = gaps.join(', and ');
    out.push({
      severity: 'warn',
      title: `${first.charAt(0).toUpperCase()}${first.slice(1)}, yet the visit is closed.`,
      detail: 'Arrival is what puts the technician at the site; the sign-off is what puts the vendor behind the result.',
    });
  }

  // Passes with nothing but the technician's word behind them.
  const passes = v.manifest.filter((u) => passedOutcome(u.outcome));
  if (v.toolRuns.length === 0 && passes.length > 0) {
    out.push({
      severity: 'warn',
      title: 'No diagnostic tool run was submitted.',
      detail: `${passes.length === 1 ? 'The pass rests' : passes.length === 2 ? 'Both passes rest' : `All ${passes.length} passes rest`} on the technician's word alone.`,
    });
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'bad' ? -1 : 1));
}

/** The one line under the heading: are these machines on sale on the strength of this? */
export function onSaleLine(v: VisitDetail): string {
  const n = v.manifest.length;
  if (n === 0) return 'No machine is on the manifest.';
  const onSale = v.manifest.filter((u) => u.isSellable).length;
  const all = n === 1 ? 'The machine' : n === 2 ? 'Both machines' : `All ${n} machines`;
  if (onSale === n) return `${all} ${n === 1 ? 'is' : 'are'} already on sale on the strength of it.`;
  if (onSale === 0) return `${n === 1 ? 'The machine is not' : n === 2 ? 'Neither machine is' : 'None of the machines is'} on sale: ${listWords([...new Set(v.manifest.map((u) => u.unitStatus.toLowerCase().replaceAll('_', ' ')))])}.`;
  return `${onSale} of ${n} machines are on sale on the strength of it.`;
}

/* ---- icons ------------------------------------------------------------- */

const CheckIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5 9-10" />
  </svg>
);
const WarnIcon = (): React.JSX.Element => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);
const PhotoIcon = (): React.JSX.Element => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-5-5-8 8" />
  </svg>
);

/* ---- the tool run, verbatim ------------------------------------------- */

function ToolRunCard({ run }: { run: ToolRunRow }): React.JSX.Element {
  return (
    <article className="mt-4 rounded border border-rule bg-sheet-2 p-4" data-testid="tool-run">
      <header className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-data text-ink">
          {run.toolProviderCode} {run.toolVersion}
        </code>
        <StatusPill tone={run.parseStatus === 'PARSED' ? 'pass' : run.parseStatus === 'PARSE_FAILED' ? 'fail' : 'neutral'} label={run.parseStatus.replace(/_/g, ' ')} />
        {run.serialMatches === false && <StatusPill tone="fail" label="Serial mismatch" />}
        <span className="ml-auto text-body-sm text-ink-3">{run.ingestedAt}</span>
      </header>

      {run.serialMatches === false && (
        <p className="mt-3 text-body-sm text-fail" role="alert">
          The tool read <code className="font-mono">{run.serialFromTool}</code>, which is not the serial on the manifest. The label does not belong to this laptop — it is not graded, not sealed and not
          listed until somebody has looked at it.
        </p>
      )}

      {run.parseError && (
        <p className="mt-3 text-body-sm text-fail">
          Parse failed: {run.parseError}. The raw payload below is retained, and the technician can still enter the inspection by hand — a parser regression does not stop their day.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-body-sm">
        <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">Run id</dt>
        <dd className="font-mono text-data text-ink-2">{run.toolRunId ?? 'none — this provider sends no run id, so its submissions are not idempotent'}</dd>
        <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">SHA-256</dt>
        <dd className="break-all font-mono text-data text-ink-2">{run.rawReportHash}</dd>
      </dl>

      <details className="mt-3">
        <summary className="cursor-pointer text-body-sm text-acc-ink underline underline-offset-4">The payload exactly as it arrived</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded bg-sheet p-4 font-mono text-data text-ink-2">{JSON.stringify(run.rawReportJson, null, 2)}</pre>
      </details>
    </article>
  );
}

/* ---- the photographs, large --------------------------------------------- */

/** One photograph as the viewer shows it: the image, what it is, and whether it is also filed elsewhere. */
export interface Frame {
  url: string;
  label: string;
  flagged: boolean;
}

/**
 * A photograph opened large, in the page. The frames are one machine's
 * photographs in angle order, so the arrows walk the machine; Escape and the
 * close button hand back to the record. Nothing leaves the site.
 */
function Lightbox({ frames, index, onIndex, onClose }: { frames: Frame[]; index: number; onIndex: (i: number) => void; onClose: () => void }): React.JSX.Element {
  const frame = frames[index];
  const prev = (): void => onIndex((index + frames.length - 1) % frames.length);
  const next = (): void => onIndex((index + 1) % frames.length);
  // The arrows work wherever focus sits — the dialog puts it on the heading.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!frame) return <></>;
  return (
    <Modal open onClose={onClose} title={frame.label} description={`${index + 1} of ${frames.length}`} size="lg" dismissOnBackdrop>
      <div className="vd-view">
        <img src={frame.url} alt={frame.label} className="vd-view__img" />
        {frame.flagged && (
          <p className="vd-view__flag" role="note">
            This image is also filed as another photograph on this visit.
          </p>
        )}
        {frames.length > 1 && (
          <div className="vd-view__nav">
            <button type="button" className="vd-view__btn" onClick={prev} aria-label="Previous photograph">
              ‹ Previous
            </button>
            <button type="button" className="vd-view__btn" onClick={next} aria-label="Next photograph">
              Next ›
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---- one machine ------------------------------------------------------- */

function Machine({
  unit,
  photos,
  seal,
  reusedKeys,
  onOpen,
}: {
  unit: ManifestUnit;
  photos: PhotoRow[];
  seal: SealRow | undefined;
  reusedKeys: ReadonlySet<string>;
  onOpen: (frames: Frame[], index: number) => void;
}): React.JSX.Element {
  const byAngle = new Map(photos.map((p) => [p.angle, p]));
  const hasEvidence = photos.length > 0 || seal !== undefined;
  // The machine's photographs in angle order, the seal last — what the viewer walks.
  const frames: Frame[] = [
    ...PHOTO_ANGLES.flatMap((angle) => {
      const p = byAngle.get(angle);
      return p ? [{ url: p.url, label: `${PHOTO_SHORT[angle]} · ${unit.serialNumber}`, flagged: reusedKeys.has(p.fileKey) }] : [];
    }),
    ...(seal ? [{ url: seal.appliedPhotoUrl, label: `Seal ${seal.sealCode} · ${unit.serialNumber}`, flagged: reusedKeys.has(seal.appliedPhotoKey) }] : []),
  ];
  const openAt = (url: string): void => onOpen(frames, Math.max(0, frames.findIndex((f) => f.url === url)));
  return (
    <div className="vd-unit" data-testid="machine">
      <div className="vd-unit__top">
        <span className="vd-unit__n" aria-hidden="true">
          {unit.sequenceNo}
        </span>
        <div>
          <div className="vd-unit__name">
            {unit.skuTitle ?? unit.skuLabel}
            {unit.declaredGrade ? (
              <span className="vd-grade" title="Declared grade">
                {gradeLabel(unit.declaredGrade)}
              </span>
            ) : (
              <NotMeasured why="The vendor declared no grade" label="No grade declared" />
            )}
          </div>
          {unit.specSummary && <div className="vd-unit__spec">{unit.specSummary}</div>}
          <div className="vd-unit__ids">
            <span>
              Serial <span className="mono">{unit.serialNumber}</span>
            </span>
            {unit.skuTitle && (
              <span>
                SKU <span className="mono vd-unit__sku">{unit.skuLabel}</span>
              </span>
            )}
            {seal && (
              <span>
                Seal <span className="mono">{seal.sealCode}</span> · applied {atTime(seal.appliedAt)}
              </span>
            )}
            {unit.qcScore !== null && (
              <span>
                Score <span className="mono">{unit.qcScore}</span>
              </span>
            )}
            {unit.gradeFinal && (
              <span>
                Graded <span className="mono">{gradeLabel(unit.gradeFinal)}</span>
              </span>
            )}
          </div>
        </div>
        <div className="vd-unit__right">
          <span className={cn('vd-pill vd-pill--sm', OUTCOME_PILL[unit.outcome])}>{OUTCOME_LABEL[unit.outcome]}</span>
          <span className="vd-unit__time">
            {unit.durationSeconds === null ? (
              <NotMeasured why="This unit was not inspected" label="Not inspected" />
            ) : (
              <>
                Time on unit <span className="mono">{spanOf(unit.durationSeconds)}</span>
              </>
            )}
          </span>
          <span className="vd-unit__time">{unit.isSellable ? 'On sale' : `Not on sale · ${unit.unitStatus.toLowerCase().replaceAll('_', ' ')}`}</span>
        </div>
      </div>
      {unit.absentReason && (
        <div className="vd-note">
          <strong>Reason:</strong> {unit.absentReason}
        </div>
      )}
      {unit.gradeOverrideReason && (
        <div className="vd-note">
          <strong>Grade override:</strong> {unit.gradeOverrideReason}
        </div>
      )}
      {hasEvidence && (
        <div className="vd-photos">
          {PHOTO_ANGLES.map((angle) => {
            const p = byAngle.get(angle);
            const flagged = p !== undefined && reusedKeys.has(p.fileKey);
            return (
              <div key={angle} className="vd-ph">
                {p ? (
                  <button type="button" className={cn('vd-ph__img vd-ph__btn', flagged && 'vd-ph__img--flag')} title={flagged ? 'This image is also filed as another photograph' : 'Open large'} onClick={() => openAt(p.url)}>
                    <img src={p.url} alt={`${PHOTO_SHORT[angle]} of ${unit.serialNumber}`} />
                  </button>
                ) : (
                  <div className="vd-ph__img">
                    <PhotoIcon />
                  </div>
                )}
                <span className="vd-ph__l">{PHOTO_SHORT[angle]}</span>
              </div>
            );
          })}
          <div className="vd-ph">
            {seal ? (
              <button
                type="button"
                className={cn('vd-ph__img vd-ph__img--seal vd-ph__btn', reusedKeys.has(seal.appliedPhotoKey) && 'vd-ph__img--flag')}
                title={reusedKeys.has(seal.appliedPhotoKey) ? 'The seal photograph is also filed as another photograph' : 'Open large'}
                onClick={() => openAt(seal.appliedPhotoUrl)}
              >
                <img src={seal.appliedPhotoUrl} alt={`Seal ${seal.sealCode} applied to the machine`} />
              </button>
            ) : (
              <div className="vd-ph__img vd-ph__img--seal">No seal</div>
            )}
            <span className="vd-ph__l">Seal</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================================================================== */

export function VisitDetailRoute(): React.JSX.Element {
  const { visitId = '' } = useParams<{ visitId: string }>();
  const [reloadToken, setReloadToken] = React.useState(0);
  const [viewing, setViewing] = React.useState<{ frames: Frame[]; index: number } | null>(null);
  const principal = usePrincipal();
  const canInspect = principal?.permissions.includes('qc.visit.execute') ?? false;
  const { data, error } = useResource<VisitDetail>(`/api/qc/visits/${visitId}`, 'This visit is unavailable', reloadToken);

  if (error) {
    return <EmptyState title="This visit did not load" body={`${error}. Nothing has been changed — reload to try again.`} />;
  }
  if (!data) {
    return (
      <div className="visit-detail">
        <div className="vd-head">
          <div>
            <h1 className="vd-title">Visit</h1>
            <p className="vd-sub">Loading the visit.</p>
          </div>
        </div>
        <div className="vd-card" style={{ padding: 22 }}>
          <Skeleton lines={8} />
        </div>
      </div>
    );
  }

  const closed = isClosed(data.status);
  const open = !closed && data.status !== 'CANCELLED';
  const pill = statusPill(data.status);
  const problems = integrityProblems(data);
  const vendor = shortName(data.vendorName);

  // Photographs and seals, by the machine they belong to.
  const photosOf = new Map<string, PhotoRow[]>();
  for (const p of data.photos) photosOf.set(p.qcReportId, [...(photosOf.get(p.qcReportId) ?? []), p]);
  const sealOf = new Map(data.seals.map((s) => [s.qcReportId, s]));
  const reportIds = new Set(data.manifest.map((u) => u.qcReportId).filter((id): id is string => id !== null));
  const strayPhotos = data.photos.filter((p) => !reportIds.has(p.qcReportId));
  const straySeals = data.seals.filter((s) => !reportIds.has(s.qcReportId));
  const keyUses = new Map<string, number>();
  for (const k of [...data.photos.map((p) => p.fileKey), ...data.seals.map((s) => s.appliedPhotoKey)]) keyUses.set(k, (keyUses.get(k) ?? 0) + 1);
  const reusedKeys = new Set([...keyUses.entries()].filter(([, n]) => n > 1).map(([k]) => k));

  const steps: Array<{ label: string; at: string | null; missing: string; extra?: string }> = [
    { label: 'Requested', at: data.requestedAt, missing: 'Not recorded' },
    { label: 'Arrived', at: data.arrivedAt, missing: 'Not recorded' },
    { label: 'Started', at: data.startedAt, missing: 'Not started' },
    {
      label: 'Completed',
      at: data.completedAt,
      missing: 'Not completed',
      ...(data.startedAt && data.completedAt ? { extra: spanOf(secondsBetween(data.startedAt, data.completedAt)) } : {}),
    },
    { label: 'Vendor sign-off', at: data.vendorSignoffAt, missing: 'Not signed', ...(data.vendorSignoffName ? { extra: `by ${data.vendorSignoffName}` } : {}) },
  ];
  const stepState = (at: string | null): 'done' | 'missing' | 'next' => (at ? 'done' : closed ? 'missing' : 'next');
  const firstDay = istDay(data.requestedAt);

  const tiles: Array<{ n: number; label: string; tone?: 'ok' | 'bad' }> = [
    { n: data.unitsPresented, label: 'Presented' },
    { n: data.unitsInspected, label: 'Inspected' },
    { n: data.unitsPassed, label: 'Passed', tone: 'ok' },
    { n: data.unitsGradeCorrected, label: 'Corrected' },
    { n: data.unitsFailed, label: 'Failed', tone: 'bad' },
    { n: data.unitsAbsent, label: 'Absent' },
  ];

  return (
    <div className="visit-detail">
      <div>
        <nav className="vd-crumb" aria-label="Breadcrumb">
          <Link to="/qc/visits">Visits</Link>
          <span aria-hidden="true">/</span>
          <span>
            {vendor}
            {data.scheduledDate ? ` · ${dayNoYear(data.scheduledDate)}` : ''}
          </span>
        </nav>
        <div className="vd-head">
          <div>
            <div className="vd-title-row">
              <h1 className="vd-title">Visit to {vendor}</h1>
              <span className={cn('vd-pill', pill.cls)}>{pill.label}</span>
              {problems.length > 0 && <span className="vd-pill vd-pill--bad">{count(problems.length, 'problem', 'problems')}</span>}
            </div>
            <p className="vd-sub">
              <span className="mono">{data.visitNumber}</span> · {data.facilityLabel} · scheduled for{' '}
              <strong>{data.scheduledDate ? onDay(data.scheduledDate) : 'no day yet'}</strong>
              {data.slotFrom && data.slotTo ? ` (${data.slotFrom.slice(0, 5)}–${data.slotTo.slice(0, 5)})` : ''} · technician{' '}
              <strong>{data.technicianName ?? 'not assigned'}</strong> · {count(data.unitsRequested, 'unit', 'units')} requested
            </p>
          </div>
          {canInspect && open && (
            <div className="vd-actions">
              <Link to={`/qc/visits/${visitId}/inspect`} className="vd-btn">
                Record an inspection
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="vd-outcome" aria-label="Units">
        {tiles.map((t) => (
          <div key={t.label} className={cn('vd-o', t.n === 0 ? 'vd-o--zero' : t.tone === 'ok' ? 'vd-o--ok' : t.tone === 'bad' ? 'vd-o--bad' : undefined)}>
            <div className="vd-o__n">{t.n}</div>
            <div className="vd-o__l">{t.label}</div>
          </div>
        ))}
      </div>

      {problems.length > 0 && (
        <section className="vd-integ" aria-labelledby="vd-i-h" data-testid="integrity">
          <div className="vd-integ__head">
            <WarnIcon />
            <h2 id="vd-i-h">This visit doesn&rsquo;t add up</h2>
            <p>{onSaleLine(data)}</p>
          </div>
          <ul>
            {problems.map((p) => (
              <li key={p.title}>
                <span className={cn('sev', p.severity === 'bad' && 'sev--bad')} aria-label={p.severity === 'bad' ? 'Serious' : 'Worth a look'} />
                <span>
                  <strong>{p.title}</strong> {p.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="vd-steps" aria-label={`Visit timeline, ${onDay(data.requestedAt)} (IST)`}>
        {steps.map((s, i) => {
          const state = stepState(s.at);
          const nextState = i + 1 < steps.length ? stepState(steps[i + 1]!.at) : 'done';
          return (
            <li key={s.label} className={cn('vd-step', state === 'missing' && 'is-missing', state === 'next' && 'is-next', nextState !== 'done' && 'before-missing')}>
              <div className="vd-step__track">
                <span className="vd-step__dot" aria-hidden="true">
                  {state === 'done' ? <CheckIcon /> : '?'}
                </span>
                <span className="vd-step__line" />
              </div>
              <span className="vd-step__label">{s.label}</span>
              <span className="vd-step__meta">
                {s.at ? (
                  <>
                    <span className="mono">{atTime(s.at)}</span>
                    {istDay(s.at) !== firstDay || i === 0 ? ` · ${dayNoYear(s.at)}` : ''}
                    {s.extra ? ` · ${s.extra}` : ''}
                  </>
                ) : (
                  s.missing
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="vd-grid">
        <section className="vd-card" aria-labelledby="vd-m-h">
          <div className="vd-card__head">
            <h2 id="vd-m-h">Machines</h2>
            <span className="meta">
              {data.manifest.length} presented against {data.unitsRequested} requested
              {data.photos.length > 0 ? ' · photos grouped by machine' : ''}
            </span>
          </div>
          {data.manifest.length === 0 ? (
            <div className="vd-card__empty">
              <EmptyState title="Nothing on the manifest yet" body="Machines appear here as the technician records them." />
            </div>
          ) : (
            data.manifest.map((u) => (
              <Machine
                key={u.visitUnitId}
                unit={u}
                photos={u.qcReportId ? (photosOf.get(u.qcReportId) ?? []) : []}
                seal={u.qcReportId ? sealOf.get(u.qcReportId) : undefined}
                reusedKeys={reusedKeys}
                onOpen={(frames, index) => setViewing({ frames, index })}
              />
            ))
          )}
          {(straySeals.length > 0 || strayPhotos.length > 0) && (
            <div className="vd-seals" data-testid="stray-evidence">
              <p>Evidence on this visit that no machine on the manifest claims. It is kept, and shown, because it exists.</p>
              {straySeals.map((s) => (
                <div key={s.sealCode} className="vd-seal">
                  <button type="button" className="vd-ph__btn vd-seal__btn" title="Open large" onClick={() => setViewing({ frames: [{ url: s.appliedPhotoUrl, label: `Seal ${s.sealCode}`, flagged: reusedKeys.has(s.appliedPhotoKey) }], index: 0 })}>
                    <img src={s.appliedPhotoUrl} alt={`Seal ${s.sealCode} applied to the machine`} />
                  </button>
                  <span>
                    Seal <span className="mono">{s.sealCode}</span> · {s.status.toLowerCase()} · applied {atTime(s.appliedAt)} by {s.appliedByName}
                    {s.brokenAt ? ` · broken ${atTime(s.brokenAt)}: ${s.brokenReason ?? 'no reason given'}` : ''}
                  </span>
                </div>
              ))}
              {strayPhotos.map((p) => (
                <div key={p.fileKey} className="vd-seal">
                  <button type="button" className="vd-ph__btn vd-seal__btn" title="Open large" onClick={() => setViewing({ frames: [{ url: p.url, label: PHOTO_SHORT[p.angle], flagged: reusedKeys.has(p.fileKey) }], index: 0 })}>
                    <img src={p.url} alt={`${PHOTO_SHORT[p.angle]}, not tied to a machine`} />
                  </button>
                  <span>{PHOTO_SHORT[p.angle]}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="vd-col">
          <section className="vd-card vd-side" aria-labelledby="vd-v-h">
            <h2 id="vd-v-h">Visit</h2>
            <div className="vd-person">
              {data.technicianName ? (
                <>
                  <span className="vd-avatar" aria-hidden="true">
                    {initials(data.technicianName)}
                  </span>
                  <div>
                    <div className="vd-person__name">{data.technicianName}</div>
                    <div className="vd-person__role">Technician</div>
                  </div>
                </>
              ) : (
                <NotMeasured why="No technician has been assigned to this visit" label="No technician assigned" />
              )}
            </div>
            <dl className="vd-kv">
              <div>
                <dt>Supply point</dt>
                <dd title={data.vendorName}>{vendor}</dd>
              </div>
              <div>
                <dt>Scheduled for</dt>
                <dd>{data.scheduledDate ? onDay(data.scheduledDate) : <NotMeasured why="No day has been booked" label="No day booked" />}</dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>
                  {dayNoYear(data.requestedAt)}, {atTime(data.requestedAt)}
                </dd>
              </div>
              <div>
                <dt>Arrived</dt>
                <dd className={cn(!data.arrivedAt && closed && 'bad')}>{data.arrivedAt ? `${dayNoYear(data.arrivedAt)}, ${atTime(data.arrivedAt)}` : closed ? 'Not recorded' : 'Not yet'}</dd>
              </div>
              <div>
                <dt>Check-in distance</dt>
                <dd>
                  {data.geoVarianceMetres === null ? (
                    <NotMeasured why="No check-in with coordinates was recorded" label="Not recorded" />
                  ) : (
                    <span className={cn('mono', data.geoVarianceMetres > data.geoVarianceAlertMetres && 'bad')}>{data.geoVarianceMetres} m</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Vendor sign-off</dt>
                <dd className={cn(!data.vendorSignoffAt && closed && 'bad')}>
                  {data.vendorSignoffAt ? `${data.vendorSignoffName ?? 'Signed'}, ${atTime(data.vendorSignoffAt)}` : closed ? 'Not signed' : 'Not yet'}
                </dd>
              </div>
              <div>
                <dt>Visit fee</dt>
                <dd>
                  {data.visitFee ? (
                    <>
                      <span className="mono">{money(data.visitFee).format()}</span>
                      {data.feeBearer ? ` · ${BEARER[data.feeBearer]}` : ''}
                    </>
                  ) : (
                    <NotMeasured why="No fee has been recorded for this visit" label="No fee recorded" />
                  )}
                </dd>
              </div>
            </dl>
            {data.notes && <p className="vd-next" style={{ marginTop: 10 }}>{data.notes}</p>}
          </section>

          <section className="vd-card vd-side" aria-labelledby="vd-t-h">
            <h2 id="vd-t-h">Diagnostic tool runs</h2>
            {data.toolRuns.length === 0 ? (
              <div className="vd-empty">
                <strong>No tool run submitted</strong>
                Raw output is stored here exactly as the tool sent it.
              </div>
            ) : (
              data.toolRuns.map((r) => <ToolRunCard key={r.id} run={r} />)
            )}
          </section>

          <VisitActions visit={data} onChanged={() => setReloadToken((n) => n + 1)} />
        </aside>
      </div>

      {viewing && <Lightbox frames={viewing.frames} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} />}
    </div>
  );
}
