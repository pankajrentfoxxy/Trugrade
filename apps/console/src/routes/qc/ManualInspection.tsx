import * as React from 'react';
import { Link, useParams } from 'react-router';
import { GRADES, QC_AREA_SCORE, type Grade } from '@trugrade/contracts';
import { Button, EmptyState, Skeleton, cn } from '@trugrade/ui';
import { nowMs } from '../../lib/clock';
import { useResource } from '../../lib/useResource';
import { send, uploadPhoto } from './api';
import { atTime } from './OrderInspections';
import {
  checkInspection,
  emptyInspection,
  gradeCap,
  modelsOf,
  resolveUnit,
  toPayload,
  type AreaChoice,
  type HardwareEntry,
  type InspectionState,
  type OrderTarget,
  type PayloadTarget,
} from './inspection';
import type { OrderInspectionView } from './order-inspection-types';
import {
  AREA_LABEL,
  PHOTO_ANGLES,
  PHOTO_LABEL,
  QC_AREA_CODES,
  type QcAreaCode,
  type TechnicianOption,
  type UploadedFile,
  type Verdict,
  type VisitDetail,
} from './types';

/**
 * ARCHETYPE D — Flow. Step rail + the step + the reason each field is asked.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * The whole inspection, on a keyboard.
 *
 * It is one long form rather than four routes on purpose — a technician holding
 * a machine does not want to be routed — so the rail is a map of the form and
 * every entry says how much of that part is still outstanding. That is the
 * flow's whole promise kept without splitting the submission into four that
 * can half-fail.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.rf-*` in `index.css`, `--admin-*` in
 * `globals.css`), on the same terms as the other admin screens. Two things the
 * design draws are not here: **"Save draft"**, because nothing is written until
 * Record — a half-recorded inspection is worse than none — and a draft button
 * would promise one that does not exist; and **"Scan"**, because no scanner is
 * wired to this console and a camera-less button is a dead one. Everything
 * else is the design's, and every count on it is the form's own arithmetic.
 *
 * PHASE_04_QC.md is blunt about why this exists: the mobile app runs offline in a
 * warehouse and is the highest-risk piece of the project, so *"build the web
 * console first so that fallback exists from day one"*. It is also what an ops
 * person uses to correct a bad record months later, which means it has to be
 * able to say everything the app can say — including the awkward things. Twelve
 * area results, detected hardware, six photographs, the seal and its photograph,
 * a score, a grade, and a written reason when the grade is overridden.
 *
 * Two things this screen refuses to make easy, both deliberate:
 *
 * **There is no "all pass" button.** It would be used, and it would be used on a
 * machine nobody looked at. Twelve decisions is the point.
 *
 * **"Not measured" is offered on every area and on the cycle count.** Anything
 * else and never-fabricate becomes a slogan: with only Pass/Warn/Fail available,
 * the area a technician could not test gets marked Pass, because the form will
 * not let them submit otherwise. The unmeasured answer has to be reachable or
 * the honest technician is the one who is punished.
 *
 * **There is no dropdown of machines.** The serial the technician reads off the
 * sticker is the identity. On a stock visit it finds the manifest line, and a
 * serial the manifest does not carry is the hard stop. On an order visit there
 * is no manifest line yet — an ordered machine has no serial until the
 * technician gives it one — so the serial names a vacant slot on the order, and
 * the server creates the unit and the line when the report is recorded. Only
 * when the order mixes models does the form ask which ordered machine this is.
 *
 * Everything that decides anything lives in `inspection.ts` and is unit-tested
 * there. What follows is layout.
 */

const gradeLabel = (g: Grade): string => g.replace('_PLUS', '+');
/** Now, in the browser's zone, as a `datetime-local` value: the next machine's start time. */
const localNow = (): string => {
  const d = new Date(nowMs());
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const AREA_CHOICES: Array<{ value: AreaChoice; label: string; cls: string }> = [
  { value: 'PASS', label: 'Pass', cls: 'p' },
  { value: 'WARN', label: 'Warn', cls: 'w' },
  { value: 'FAIL', label: 'Fail', cls: 'f' },
  { value: 'NOT_MEASURED', label: 'Not measured', cls: 'n' },
];

const TRISTATE = [
  { value: 'UNKNOWN', label: 'not checked' },
  { value: 'NO', label: 'none' },
  { value: 'YES', label: 'present' },
] as const;

const VERDICTS: Array<{ value: Verdict; label: string; cls: string }> = [
  { value: 'PASS', label: '✓ Pass', cls: 'pass' },
  { value: 'PASS_WITH_NOTE', label: '✓ Pass, with a note', cls: 'pass' },
  { value: 'MISMATCH', label: 'Mismatch against the declared spec', cls: 'warn' },
  { value: 'FAIL', label: '✕ Fail', cls: 'fail' },
];

const CameraIcon = (): React.JSX.Element => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
const InfoIcon = (): React.JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.5v.01" />
  </svg>
);

/* ==========================================================================
 * One photograph
 * ======================================================================== */

function PhotoSlot({
  slot,
  label,
  required,
  tall,
  file,
  onUploaded,
}: {
  slot: string;
  label: string;
  required?: boolean;
  tall?: boolean;
  file: UploadedFile | undefined;
  onUploaded: (f: UploadedFile | undefined) => void;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = `photo-${slot}`;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadPhoto<UploadedFile>(picked, 'The photograph did not upload'));
    } catch (err) {
      setError((err as Error).message);
      onUploaded(undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rf-photo">
      <span className="rf-photo__label">
        {label} {required && <span className="req">*</span>}
      </span>
      <label className={cn('rf-drop', tall && 'rf-drop--tall', file && 'rf-drop--filled')} htmlFor={inputId}>
        <input
          id={inputId}
          type="file"
          // `capture` makes a phone or a tablet open the camera rather than the
          // gallery — this form is meant to be usable on the tablet that stands in
          // for the mobile app.
          accept="image/*"
          capture="environment"
          aria-label={`Photo: ${label}`}
          onChange={(e) => void onPick(e)}
        />
        {file ? (
          <img src={file.url} alt={`${label} of the unit being inspected`} />
        ) : (
          <>
            <span className="ic">
              <CameraIcon />
            </span>
            <span>{busy ? 'Uploading…' : 'Take or upload a photo'}</span>
          </>
        )}
      </label>
      {file && <code className="rf-hash">{file.hash}</code>}
      {error && (
        <p className="rf-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * The twelve areas
 * ======================================================================== */

/**
 * One inspection area.
 *
 * A radiogroup per area rather than a row of a `<table>`. Twelve rows of radio
 * groups, a number box and a free-text note is a **form**, and `DataBoard` — the
 * one table component, three densities — reads data rather than collecting it.
 *
 * `data-area` stays on the container: it is how a caller, and the test suite,
 * addresses one area's controls as a group.
 */
function AreaRow({
  area,
  entry,
  onChange,
}: {
  area: QcAreaCode;
  entry: InspectionState['areas'][QcAreaCode];
  onChange: (next: InspectionState['areas'][QcAreaCode]) => void;
}): React.JSX.Element {
  const measured = entry.status !== '' && entry.status !== 'NOT_MEASURED';
  const nameId = `a-${area.toLowerCase()}`;
  return (
    <div className="rf-area" role="radiogroup" aria-labelledby={nameId} data-area={area}>
      <div>
        <div className="rf-area__name" id={nameId}>
          {AREA_LABEL[area]}
        </div>
        <div className="rf-area__code">{area}</div>
      </div>
      <div className="rf-seg">
        {AREA_CHOICES.map((c) => (
          <label key={c.value}>
            <input
              type="radio"
              name={`area-${area}`}
              value={c.value}
              className={c.cls}
              checked={entry.status === c.value}
              aria-label={c.label}
              onChange={() =>
                onChange({
                  ...entry,
                  status: c.value,
                  // A score on a row that will never be written is a number
                  // that later reads as evidence of a measurement.
                  score: c.value === 'NOT_MEASURED' ? '' : entry.score,
                })
              }
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      <div className="rf-area__extra">
        <input
          type="number"
          min={QC_AREA_SCORE.min}
          max={QC_AREA_SCORE.max}
          step={1}
          className="rf-input"
          value={entry.score}
          disabled={!measured}
          aria-label={`${AREA_LABEL[area]} score out of ${QC_AREA_SCORE.max}`}
          placeholder={`Score / ${QC_AREA_SCORE.max}`}
          onChange={(e) => onChange({ ...entry, score: e.target.value })}
        />
        <input
          type="text"
          className="rf-input"
          value={entry.note}
          aria-label={`${AREA_LABEL[area]} note`}
          placeholder={entry.status === 'NOT_MEASURED' ? 'Why could it not be measured?' : 'Note (optional)'}
          onChange={(e) => onChange({ ...entry, note: e.target.value })}
        />
      </div>
    </div>
  );
}

/* ==========================================================================
 * Detected hardware
 * ======================================================================== */

function HardwareFields({
  value,
  onChange,
}: {
  value: HardwareEntry;
  onChange: (next: HardwareEntry) => void;
}): React.JSX.Element {
  const set = <K extends keyof HardwareEntry>(k: K, v: HardwareEntry[K]): void =>
    onChange({ ...value, [k]: v });

  return (
    <div className="rf-grid">
      <div className="rf-field">
        <label htmlFor="f-ram">RAM installed</label>
        <div className="rf-suffix">
          <input id="f-ram" inputMode="numeric" type="number" min={0} placeholder="e.g. 16" value={value.ramDetectedGb} onChange={(e) => set('ramDetectedGb', e.target.value)} />
          <span>GB</span>
        </div>
        <span className="rf-hint">
          Use the module label. Windows may show 15 GB for 16 GB because graphics borrows some. Enter 16.
        </span>
      </div>
      <div className="rf-field">
        <label htmlFor="f-mods">RAM modules</label>
        <input id="f-mods" className="rf-input" type="number" min={0} placeholder="e.g. 2" value={value.ramModules} onChange={(e) => set('ramModules', e.target.value)} />
      </div>
      <div className="rf-field">
        <label htmlFor="f-stype">Storage type</label>
        <input id="f-stype" className="rf-input mono" placeholder="NVMe" value={value.storageType} onChange={(e) => set('storageType', e.target.value)} />
      </div>
      <div className="rf-field">
        <label htmlFor="f-scap">Storage size</label>
        <div className="rf-suffix">
          <input id="f-scap" inputMode="numeric" type="number" min={0} placeholder="e.g. 512" value={value.storageDetectedGb} onChange={(e) => set('storageDetectedGb', e.target.value)} />
          <span>GB</span>
        </div>
        <span className="rf-hint">Enter the marketed size. A 512 GB drive shows as 477 GiB. Enter 512.</span>
      </div>
      <div className="rf-field">
        <label htmlFor="f-smart">SMART status</label>
        <select id="f-smart" className="rf-select" value={value.smartStatus} onChange={(e) => set('smartStatus', e.target.value as HardwareEntry['smartStatus'])}>
          <option value="">Not read</option>
          <option value="OK">Good</option>
          <option value="WARNING">Caution</option>
          <option value="FAILING">Bad</option>
        </select>
      </div>
      <div className="rf-field">
        <label htmlFor="f-bh">Battery health</label>
        <div className="rf-suffix">
          <input id="f-bh" inputMode="numeric" type="number" min={0} max={100} placeholder="e.g. 86" value={value.batteryHealthPct} onChange={(e) => set('batteryHealthPct', e.target.value)} />
          <span>%</span>
        </div>
        <span className="rf-hint">Full-charge capacity ÷ design capacity. Measure once.</span>
      </div>
      <div className="rf-field">
        <label htmlFor="f-cyc">Cycle count</label>
        <input
          id="f-cyc"
          className="rf-input"
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="e.g. 312"
          value={value.cycleCountNotReported ? '' : value.cycleCount}
          disabled={value.cycleCountNotReported}
          onChange={(e) => set('cycleCount', e.target.value)}
        />
        <label className="rf-check">
          <input type="checkbox" checked={value.cycleCountNotReported} onChange={(e) => set('cycleCountNotReported', e.target.checked)} />
          <span>
            This machine doesn&rsquo;t report it
            <br />
            <span className="rf-hint">
              {/* A cycle count of 0 on a battery with real wear is not a
                  measurement, it is a default. */}
              Don&rsquo;t enter 0 for a used battery. Leave it unreported instead.
            </span>
          </span>
        </label>
      </div>
      <div className="rf-field">
        <span className="lbl">Security checks</span>
        <div className="rf-stack">
          <select className="rf-select" aria-label="BIOS or firmware password set" value={value.biosLocked} onChange={(e) => set('biosLocked', e.target.value as HardwareEntry['biosLocked'])}>
            {TRISTATE.map((t) => (
              <option key={t.value} value={t.value}>
                BIOS password: {t.value === 'YES' ? 'set' : t.label}
              </option>
            ))}
          </select>
          <select className="rf-select" aria-label="MDM enrolment present" value={value.mdmLocked} onChange={(e) => set('mdmLocked', e.target.value as HardwareEntry['mdmLocked'])}>
            {TRISTATE.map((t) => (
              <option key={t.value} value={t.value}>
                MDM enrolment: {t.label}
              </option>
            ))}
          </select>
          <select className="rf-select" aria-label="Computrace active" value={value.computraceActive} onChange={(e) => set('computraceActive', e.target.value as HardwareEntry['computraceActive'])}>
            {TRISTATE.map((t) => (
              <option key={t.value} value={t.value}>
                Computrace: {t.value === 'YES' ? 'active' : t.value === 'NO' ? 'off' : t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * The rail
 * ======================================================================== */

/**
 * The six parts of the form, and the blocker fields each one owns.
 *
 * The counts come from the same `checkInspection` blockers the submit button
 * reads, so the rail cannot say "done" about a section the API will refuse.
 * A blocker's `field` is prefixed with the part it belongs to, which is what
 * lets one list drive both.
 */
const PARTS: ReadonlyArray<{ key: string; num: string; label: string; fields: readonly string[] }> = [
  { key: 's1', num: '01', label: 'The machine', fields: ['slotId', 'technicianId', 'serialScanned', 'startedAt', 'completedAt'] },
  { key: 's2', num: '02', label: '12 check areas', fields: ['areas'] },
  { key: 's3', num: '03', label: 'Detected hardware', fields: ['hardware'] },
  { key: 's4', num: '04', label: 'Photos', fields: ['photos'] },
  { key: 's5', num: '05', label: 'Seal', fields: ['sealCode', 'sealPhoto'] },
  { key: 's6', num: '06', label: 'Verdict', fields: ['verdict', 'qcScore', 'grade'] },
];

/** What the sticky bar calls the next thing to answer. */
const NEXT_LABEL: ReadonlyArray<[string, string]> = [
  ['slotId.pending', 'the order’s machines, once they load'],
  ['slotId', 'which ordered machine this is'],
  ['technicianId', 'technician'],
  ['serialScanned', 'serial number'],
  ['startedAt', 'start time'],
  ['completedAt', 'completion time'],
  ['areas', 'the check areas'],
  ['hardware', 'detected hardware'],
  ['photos', 'photos'],
  ['sealCode', 'seal code'],
  ['sealPhoto', 'seal photo'],
  ['verdict', 'verdict'],
  ['qcScore', 'QC score'],
  ['gradeOverrideReason', 'reason for the grade'],
  ['grade', 'final grade'],
];

const partOf = (field: string): (typeof PARTS)[number] | undefined =>
  PARTS.find((p) => p.fields.some((f) => field.startsWith(f)));

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function ManualInspectionRoute(): React.JSX.Element {
  const { visitId = '' } = useParams<{ visitId: string }>();
  // Bumped after every recording, so the manifest and the order's slots say
  // what is left before the next machine is started.
  const [reloadToken, setReloadToken] = React.useState(0);
  const visit = useResource<VisitDetail>(`/api/qc/visits/${visitId}`, 'This visit is unavailable', reloadToken);
  const techs = useResource<TechnicianOption[]>('/api/qc/technicians', 'The technician list is unavailable');

  const [state, setState] = React.useState<InspectionState>(() => emptyInspection());
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedReportId, setSavedReportId] = React.useState<string | null>(null);
  const [untestableReason, setUntestableReason] = React.useState('');
  const [showBlockers, setShowBlockers] = React.useState(false);

  // An order visit's machines have no manifest line until a serial names one,
  // so the order's still-open slots are what the serial can name. Fetched only
  // on an order visit; a stock visit's manifest is on the visit already.
  const isOrder = Boolean(visit.data?.orderNumber);
  const order = useResource<OrderInspectionView>(
    isOrder ? `/api/qc/order-inspections/${visitId}` : '',
    'The order’s machines are unavailable',
    reloadToken,
  );
  const openSlots = React.useMemo(() => (order.data?.slots ?? []).filter((s) => s.serialNumber === null), [order.data]);
  const orderLoaded = order.data !== null;
  const target: OrderTarget | undefined = React.useMemo(
    () => (isOrder ? { openSlots, loaded: orderLoaded } : undefined),
    [isOrder, openSlots, orderLoaded],
  );
  const models = React.useMemo(() => modelsOf(openSlots), [openSlots]);

  const manifest = React.useMemo(() => visit.data?.manifest ?? [], [visit.data]);
  const check = React.useMemo(() => checkInspection(state, manifest, target), [state, manifest, target]);
  // The denominator for the progress bar: how much an empty form has to say.
  const blank = React.useMemo(() => checkInspection(emptyInspection(), manifest, target).blockers.length, [manifest, target]);
  const unit = isOrder ? undefined : resolveUnit(state, manifest);
  const cap = gradeCap(state.areas);

  // One model on the order means there is nothing to ask: the serial goes into
  // that model's next open slot. Re-picked when the open list changes under us.
  const currentSlotOpen = openSlots.some((s) => s.slotId === state.slotId);
  React.useEffect(() => {
    if (!isOrder || currentSlotOpen) return;
    const next = models.length === 1 ? (models[0]?.slotIds[0] ?? '') : '';
    setState((s) => (s.slotId === next ? s : { ...s, slotId: next }));
  }, [isOrder, currentSlotOpen, models]);

  // The visit's own technician is the overwhelmingly common answer, so it is the
  // default — but it stays editable, because this screen is also how a QC manager
  // enters an inspection somebody else did on paper.
  const assignedTechnicianId = visit.data?.technicianId ?? '';
  React.useEffect(() => {
    if (assignedTechnicianId) {
      setState((s) => (s.technicianId ? s : { ...s, technicianId: assignedTechnicianId }));
    }
  }, [assignedTechnicianId]);

  const set = <K extends keyof InspectionState>(k: K, v: InspectionState[K]): void =>
    setState((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setShowBlockers(true);
    if (check.blockers.length > 0 || !visit.data) return;
    const payloadTarget: PayloadTarget | null = isOrder ? (state.slotId ? { slotId: state.slotId } : null) : unit ? { unit } : null;
    if (!payloadTarget) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { reportId } = await send<{ reportId: string }>(
        '/api/qc/reports/manual',
        'POST',
        toPayload(state, visit.data.id, check.normalisedSerial, payloadTarget),
        'The inspection did not save',
      );
      setSavedReportId(reportId);
      setReloadToken((n) => n + 1);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * The next machine, one click away. A fresh form — every answer belongs to
   * one laptop — keeping only what does not change between two machines on
   * the same visit: the technician. The start time is now, and on an order
   * with one model the slot picks itself.
   */
  function nextMachine(): void {
    setState({ ...emptyInspection(state.technicianId), startedAt: localNow() });
    setSavedReportId(null);
    setSaveError(null);
    setShowBlockers(false);
    setUntestableReason('');
    document.querySelector('.rf-title')?.scrollIntoView?.({ block: 'start' });
  }

  async function onUntestable(): Promise<void> {
    if (!unit) return;
    setSaving(true);
    setSaveError(null);
    try {
      await send<void>(
        `/api/qc/visits/${visitId}/units/${unit.visitUnitId}/untestable`,
        'POST',
        {
          reason:
            untestableReason.trim() ||
            `Serial on the machine reads ${check.normalisedSerial}; manifest says ${unit.serialNumber}.`,
          serialScanned: check.normalisedSerial,
        },
        'Could not record the unit as untestable',
      );
      setSavedReportId('');
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (visit.error) {
    return (
      <EmptyState title="This visit did not load" body={`${visit.error}. Nothing has been recorded — reload to try again.`} />
    );
  }
  if (!visit.data) {
    return (
      <div className="record-inspection rf">
        <h1 className="rf-title">Record an inspection</h1>
        <p className="rf-sub">Loading the visit.</p>
        <div className="rf-card" style={{ marginTop: 22, padding: 22 }}>
          <Skeleton lines={8} />
        </div>
      </div>
    );
  }

  if (savedReportId !== null) {
    // What is still to do on this visit, from the refetched order or manifest.
    // Null while that refetch is in flight — a count is never guessed.
    const left: number | null = isOrder
      ? order.data
        ? openSlots.length
        : null
      : manifest.filter((m) => m.outcome === 'PENDING').length;
    const waiting = isOrder && !order.data && !order.error;
    return (
      <EmptyState
        title={savedReportId ? 'Inspection recorded' : 'Unit recorded as untestable'}
        body={
          savedReportId
            ? isOrder
              ? `The machine is named on order ${visit.data.orderNumber} and its report is on the unit.${
                  left === 0 ? ' That was the last one: the visit is complete and ops verifies the order next.' : ''
                }`
              : `The report is on the unit and supersedes any earlier one. The prior report is kept — history is the evidence.${
                  left === 0 ? ' Every machine on the manifest now has an outcome.' : ''
                }`
            : 'The QC manager has been notified. The unit is not graded, not sealed and not listed.'
        }
        action={
          <div className="rf-done">
            {waiting && <span className="rf-hint">Checking what is left on the order…</span>}
            {left !== null && left > 0 && (
              <button type="button" className="rf-btn rf-btn--primary" onClick={nextMachine}>
                Record the next machine ({left} left)
              </button>
            )}
            <Link to={`/qc/visits/${visitId}`} className="text-acc-ink underline underline-offset-4">
              Back to {visit.data.visitNumber}
            </Link>
          </div>
        }
      />
    );
  }

  // The serials already done on this visit, so the technician can see where
  // they are. An order's come from its slots; a stock visit's from the manifest.
  const recorded: Array<{ serial: string; note: string }> = isOrder
    ? (order.data?.slots ?? [])
        .filter((s): s is typeof s & { serialNumber: string } => s.serialNumber !== null)
        .map((s) => ({ serial: s.serialNumber, note: s.inspectedAt ? `recorded ${atTime(s.inspectedAt)}` : 'named' }))
    : manifest.filter((m) => m.outcome !== 'PENDING').map((m) => ({ serial: m.serialNumber, note: m.outcome.toLowerCase().replaceAll('_', ' ') }));

  /* ---- the counts every part of the chrome reads ---- */
  const outstanding = check.blockers.length;
  const leftIn = (part: (typeof PARTS)[number]): number =>
    check.blockers.filter((b) => part.fields.some((f) => b.field.startsWith(f))).length;
  const firstPart = check.blockers.length > 0 ? partOf(check.blockers[0]!.field) : undefined;
  const nextLabel =
    check.blockers.length > 0
      ? (NEXT_LABEL.find(([prefix]) => check.blockers[0]!.field.startsWith(prefix))?.[1] ?? 'the next answer')
      : null;
  const progress = blank === 0 ? 100 : Math.round(((blank - Math.min(outstanding, blank)) / blank) * 100);
  const answeredAreas = QC_AREA_CODES.filter((a) => state.areas[a].status !== '').length;
  const photosTaken = PHOTO_ANGLES.filter((a) => state.photos[a]).length;
  const touched = Boolean(unit) || state.serialScanned !== '' || state.slotId !== '';
  // An order visit whose every slot is named has nothing this form can add.
  const nothingLeft = isOrder && order.data !== null && openSlots.length === 0;

  return (
    <form className="record-inspection rf" onSubmit={(e) => void onSubmit(e)} noValidate>
      <nav className="rf-crumb" aria-label="Breadcrumb">
        <Link to="/qc/visits">Visits</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/qc/visits/${visitId}`} className="mono">
          {visit.data.visitNumber}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Record an inspection</span>
      </nav>
      <h1 className="rf-title">Record an inspection</h1>
      <p className="rf-sub">
        One machine at a time, at {visit.data.vendorName} · {visit.data.facilityLabel}. Answer every section,
        then record it. Nothing is saved until you do.
      </p>

      {check.hardStop && (
        <div role="alert" className="rf-stop">
          <strong>Stop. This is not the machine on the manifest.</strong>
          <p>
            {unit
              ? `The manifest says ${unit.serialNumber}; the sticker says ${check.normalisedSerial}. `
              : `No unit on this visit’s manifest carries ${check.normalisedSerial}. `}
            The label does not belong to this laptop. Do not grade it, do not seal it, do not list it.
            Record it untestable and raise it to the QC manager.
          </p>
          {!unit && manifest.length > 0 && (
            <div className="rf-field rf-stop__unit">
              <label htmlFor="f-stop-unit">Manifest unit the label was on</label>
              <select id="f-stop-unit" className="rf-select" value={state.visitUnitId} onChange={(e) => set('visitUnitId', e.target.value)}>
                <option value="">Choose the unit…</option>
                {manifest.map((m) => (
                  <option key={m.visitUnitId} value={m.visitUnitId}>
                    {m.sequenceNo}. {m.serialNumber} · {m.skuLabel}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="rf-layout">
        {/* ---- the rail ---- */}
        <nav className="rf-steps" aria-label="Sections">
          <div className="rf-steps__head">
            <div className="rf-steps__count">{outstanding}</div>
            <div className="rf-steps__label">{outstanding === 1 ? 'answer still needed' : 'answers still needed'}</div>
            <div className="rf-steps__bar" role="img" aria-label={`${progress}% answered`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          <ol>
            {PARTS.map((part, i) => {
              const left = leftIn(part);
              const done = left === 0 && touched;
              return (
                <li key={part.key} className={cn(done && 'is-done')}>
                  <a href={`#${part.key}`} aria-current={firstPart?.key === part.key ? 'step' : undefined}>
                    <span className="n" aria-hidden="true">
                      {i + 1}
                    </span>
                    {part.label}
                    {left > 0 ? (
                      <span className="left">{left}</span>
                    ) : part.key === 's3' ? (
                      <span className="left left--opt">optional</span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="rf-main">
          {/* ---- 01 the machine ---- */}
          <section className="rf-card" id="s1" aria-labelledby="h1">
            <div className="rf-card__head">
              <span className="rf-card__num">01</span>
              <div>
                <h2 id="h1">The machine</h2>
                <p>Which unit you&rsquo;re inspecting, and whether its label matches.</p>
              </div>
              {leftIn(PARTS[0]!) > 0 && <span className="left">{leftIn(PARTS[0]!)} left</span>}
            </div>
            <div className="rf-card__body">
              {recorded.length > 0 && (
                <div className="rf-recorded" data-testid="recorded-on-visit">
                  <span className="lbl">
                    Recorded on this visit <span className="n">{recorded.length}</span>
                  </span>
                  <ul>
                    {recorded.map((r) => (
                      <li key={r.serial}>
                        <span className="mono">{r.serial}</span>
                        <span>{r.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {isOrder && order.error && (
                <div className="rf-callout rf-callout--warn" style={{ marginTop: 0, marginBottom: 18 }}>
                  <InfoIcon />
                  <span>
                    <strong>The order&rsquo;s machines did not load.</strong> {order.error}. Nothing can be recorded until they
                    do &mdash; reload to try again.
                  </span>
                </div>
              )}
              {isOrder && order.data && openSlots.length === 0 && (
                <div className="rf-callout rf-callout--warn" style={{ marginTop: 0, marginBottom: 18 }}>
                  <InfoIcon />
                  <span>
                    <strong>Every machine on order {visit.data.orderNumber} has been recorded.</strong> There is nothing left
                    to inspect on this visit. <Link to={`/qc/orders/${visitId}`}>Open the visit&rsquo;s record</Link>
                  </span>
                </div>
              )}
              <div className="rf-grid">
                {isOrder && models.length === 1 && (
                  <div className="rf-field rf-full">
                    <span className="lbl">Ordered machine</span>
                    <div className="rf-model" data-testid="ordered-machine">
                      <strong>{models[0]?.title ?? 'Model withdrawn'}</strong> · Grade {models[0]?.grade}
                      {models[0]?.specSummary ? ` · ${models[0].specSummary}` : ''}
                      <span className="rf-model__left">
                        {openSlots.length} of {order.data?.slots.length ?? 0} still to record
                      </span>
                    </div>
                  </div>
                )}
                {isOrder && models.length > 1 && (
                  <fieldset className="rf-field rf-full rf-fieldset">
                    <legend className="lbl">
                      Which ordered machine is this? <span className="req">*</span>
                    </legend>
                    <div className="rf-seg rf-seg--wrap" data-testid="ordered-machine">
                      {models.map((m) => (
                        <label key={m.key}>
                          <input
                            type="radio"
                            name="ordered-model"
                            className="m"
                            checked={m.slotIds.includes(state.slotId)}
                            onChange={() => set('slotId', m.slotIds[0] ?? '')}
                          />
                          <span>
                            {m.title ?? 'Model withdrawn'} · {m.grade} · {m.slotIds.length} left
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <div className="rf-field">
                  <label htmlFor="f-tech">
                    Technician <span className="req">*</span>
                  </label>
                  <select id="f-tech" className="rf-select" value={state.technicianId} onChange={(e) => set('technicianId', e.target.value)}>
                    <option value="">Choose a technician…</option>
                    {(techs.data ?? [])
                      .filter((t) => t.isActive || t.id === state.technicianId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {t.employeeCode}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="rf-field rf-full">
                  <label htmlFor="f-serial">
                    Serial number, read off the machine <span className="req">*</span>
                  </label>
                  <input
                    id="f-serial"
                    className={cn('rf-input rf-input--serial', check.hardStop && 'is-bad')}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Type as printed"
                    value={state.serialScanned}
                    onChange={(e) => set('serialScanned', e.target.value)}
                    aria-invalid={check.hardStop ? true : undefined}
                  />
                  {check.hardStop ? (
                    <span className="rf-error" role="alert">
                      {unit ? `The manifest says ${unit.serialNumber}. Do not proceed.` : 'Not on this visit’s manifest. Do not proceed.'}
                    </span>
                  ) : unit && check.normalisedSerial !== '' ? (
                    <>
                      <span className="rf-ok">Matches the manifest: {unit.serialNumber}</span>
                      <span className="rf-hint">
                        #{unit.sequenceNo} · {unit.skuLabel} · declared grade {unit.declaredGrade ? gradeLabel(unit.declaredGrade) : 'none'}
                      </span>
                    </>
                  ) : isOrder && openSlots.length > 0 && check.normalisedSerial !== '' ? (
                    <span className="rf-ok">
                      {check.normalisedSerial} will name this machine on order {visit.data.orderNumber} when you record. It is checked
                      for uniqueness and against the stolen list then.
                    </span>
                  ) : (
                    <span className="rf-hint">
                      Prefixes and spaces are removed automatically. We never guess between O and 0, so type exactly what&rsquo;s printed.
                    </span>
                  )}
                </div>
                <div className="rf-field">
                  <label htmlFor="f-start">
                    Started <span className="req">*</span>
                  </label>
                  <input id="f-start" type="datetime-local" className="rf-input" value={state.startedAt} onChange={(e) => set('startedAt', e.target.value)} />
                </div>
                <div className="rf-field">
                  <label htmlFor="f-end">
                    Completed <span className="req">*</span>
                  </label>
                  <input id="f-end" type="datetime-local" className="rf-input" value={state.completedAt} onChange={(e) => set('completedAt', e.target.value)} />
                </div>
              </div>
            </div>
          </section>

          {/* ---- 02 the twelve areas ---- */}
          <section className="rf-card" id="s2" aria-labelledby="h2">
            <div className="rf-card__head">
              <span className="rf-card__num">02</span>
              <div>
                <h2 id="h2">12 check areas</h2>
                <p>Every area needs an answer. Add the score you gave and a note when it helps.</p>
              </div>
              {answeredAreas < 12 && (
                <span className="left">{answeredAreas === 0 ? 'All 12 unanswered' : `${12 - answeredAreas} unanswered`}</span>
              )}
            </div>
            <div className="rf-card__body">
              <div className="rf-legend">
                <span>
                  <i className="lg-p" />
                  Pass
                </span>
                <span>
                  <i className="lg-w" />
                  Warn: works, but a buyer should know
                </span>
                <span>
                  <i className="lg-f" />
                  Fail
                </span>
                <span>
                  <i className="lg-n" />
                  Not measured: prints &ldquo;not measured&rdquo; on the report, never counts as a pass
                </span>
              </div>
              {QC_AREA_CODES.map((area) => (
                <AreaRow key={area} area={area} entry={state.areas[area]} onChange={(next) => set('areas', { ...state.areas, [area]: next })} />
              ))}
              {cap && (
                <div className="rf-callout rf-callout--warn">
                  <InfoIcon />
                  <span>
                    <strong>Caps this machine at {gradeLabel(cap.cap)}.</strong> {cap.reason} A weighted mean would swallow
                    that — eleven areas at ten and one at three still averages well. The floor rule is what stops it, so
                    this machine cannot be graded above {gradeLabel(cap.cap)}.
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* ---- 03 detected hardware ---- */}
          <section className="rf-card" id="s3" aria-labelledby="h3">
            <div className="rf-card__head">
              <span className="rf-card__num">03</span>
              <div>
                <h2 id="h3">Detected hardware</h2>
                <p>What the machine actually has, as measured. Not what the vendor declared.</p>
              </div>
              {leftIn(PARTS[2]!) > 0 && <span className="left">{leftIn(PARTS[2]!)} to fix</span>}
            </div>
            <div className="rf-card__body">
              <HardwareFields value={state.hardware} onChange={(h) => set('hardware', h)} />
              <div className="rf-callout" style={{ marginTop: 18 }}>
                <InfoIcon />
                <span>
                  <strong>&ldquo;Not checked&rdquo; is an honest answer.</strong> Use it when nobody looked. Never guess.
                </span>
              </div>
            </div>
          </section>

          {/* ---- 04 photos ---- */}
          <section className="rf-card" id="s4" aria-labelledby="h4">
            <div className="rf-card__head">
              <span className="rf-card__num">04</span>
              <div>
                <h2 id="h4">Photos</h2>
                <p>At least these six, of the real machine. They become the listing&rsquo;s photos.</p>
              </div>
              {photosTaken < PHOTO_ANGLES.length && (
                <span className="left">{photosTaken === 0 ? 'No photos yet' : `${PHOTO_ANGLES.length - photosTaken} to take`}</span>
              )}
            </div>
            <div className="rf-card__body">
              <div className="rf-photos">
                {PHOTO_ANGLES.map((angle) => (
                  <PhotoSlot
                    key={angle}
                    slot={angle}
                    label={PHOTO_LABEL[angle]}
                    required
                    file={state.photos[angle]}
                    onUploaded={(f) => set('photos', { ...state.photos, [angle]: f })}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* ---- 05 seal ---- */}
          <section className="rf-card" id="s5" aria-labelledby="h5">
            <div className="rf-card__head">
              <span className="rf-card__num">05</span>
              <div>
                <h2 id="h5">Seal</h2>
                <p>
                  Seal every passed machine and photograph the seal on it. It proves nothing was swapped while the
                  machine waits at the vendor.
                </p>
              </div>
              {leftIn(PARTS[4]!) > 0 && <span className="left">{leftIn(PARTS[4]!)} left</span>}
            </div>
            <div className="rf-card__body">
              <div className="rf-grid">
                <div className="rf-field">
                  <label htmlFor="f-seal">
                    Seal code <span className="req">*</span>
                  </label>
                  <input
                    id="f-seal"
                    className="rf-input rf-input--serial"
                    placeholder="TRG-26HR-0004821"
                    autoComplete="off"
                    spellCheck={false}
                    value={state.sealCode}
                    onChange={(e) => set('sealCode', e.target.value.toUpperCase())}
                  />
                  <span className="rf-hint">Exactly as printed on the seal you applied.</span>
                </div>
                <PhotoSlot
                  slot="seal"
                  label="Seal, applied to this machine"
                  required
                  tall
                  file={state.sealPhoto ?? undefined}
                  onUploaded={(f) => set('sealPhoto', f ?? null)}
                />
              </div>
            </div>
          </section>

          {/* ---- 06 verdict ---- */}
          <section className="rf-card" id="s6" aria-labelledby="h6">
            <div className="rf-card__head">
              <span className="rf-card__num">06</span>
              <div>
                <h2 id="h6">Verdict</h2>
                <p>The grade is our own claim under CP e-Comm r.7(5), not the testing tool&rsquo;s.</p>
              </div>
              {leftIn(PARTS[5]!) > 0 && <span className="left">{leftIn(PARTS[5]!)} left</span>}
            </div>
            <div className="rf-card__body">
              <div className="rf-grid">
                <div className="rf-field rf-full">
                  <span className="lbl" id="v-l">
                    Verdict <span className="req">*</span>
                  </span>
                  <div className="rf-verdict" role="radiogroup" aria-labelledby="v-l">
                    {VERDICTS.map((v) => (
                      <label key={v.value}>
                        <input type="radio" name="verdict" value={v.value} checked={state.verdict === v.value} aria-label={v.label} onChange={() => set('verdict', v.value)} />
                        <span className={v.cls}>{v.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rf-field">
                  <label htmlFor="f-score">
                    QC score <span className="req">*</span>
                  </label>
                  <div className="rf-suffix">
                    <input id="f-score" inputMode="numeric" type="number" min={0} max={100} placeholder="0–100" value={state.qcScore} onChange={(e) => set('qcScore', e.target.value)} />
                    <span>/ 100</span>
                  </div>
                </div>
                <div className="rf-field">
                  <label htmlFor="f-gp">Grade the thresholds suggest</label>
                  <select id="f-gp" className="rf-select" value={state.gradeProposed} onChange={(e) => set('gradeProposed', e.target.value as Grade | '')}>
                    <option value="">Not listable</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {gradeLabel(g)}
                      </option>
                    ))}
                  </select>
                  <span className="rf-hint">Worked out from the check areas, before any judgement.</span>
                </div>
                <div className="rf-field">
                  <label htmlFor="f-gf">
                    Final grade <span className="req">*</span>
                  </label>
                  <select id="f-gf" className="rf-select" value={state.gradeFinal} onChange={(e) => set('gradeFinal', e.target.value as Grade | '')}>
                    <option value="">Not listable</option>
                    {GRADES.map((g) => (
                      <option key={g} value={g}>
                        {gradeLabel(g)}
                      </option>
                    ))}
                  </select>
                  <span className="rf-hint">What we&rsquo;ll sell it as. Only A+, A and B can be listed.</span>
                </div>
                {state.gradeProposed !== state.gradeFinal && (
                  <div className="rf-field">
                    <label htmlFor="f-why">
                      Why the final grade differs <span className="req">*</span>
                    </label>
                    <textarea id="f-why" className="rf-textarea" value={state.gradeOverrideReason} onChange={(e) => set('gradeOverrideReason', e.target.value)} />
                    <span className="rf-hint">Required by chk_override_reason, and by anyone reading this report in six months.</span>
                  </div>
                )}
                <div className="rf-field rf-full">
                  <label htmlFor="f-notes">
                    Notes <span className="opt">(optional)</span>
                  </label>
                  <textarea id="f-notes" className="rf-textarea" placeholder="Anything the next person should know" value={state.notes} onChange={(e) => set('notes', e.target.value)} />
                </div>
              </div>
            </div>
          </section>

          {check.notices.map((n) => (
            <div key={n} className="rf-callout rf-callout--warn">
              <InfoIcon />
              <span>{n}</span>
            </div>
          ))}

          {showBlockers && check.blockers.length > 0 && (
            <div role="alert" className="rf-blockers" data-testid="blockers">
              <h2>
                {check.blockers.length === 1
                  ? 'One thing is stopping this inspection being recorded'
                  : `${check.blockers.length} things are stopping this inspection being recorded`}
              </h2>
              <ul>
                {check.blockers.map((b) => (
                  <li key={b.field + b.message}>{b.message}</li>
                ))}
              </ul>
            </div>
          )}

          {saveError && (
            <p className="rf-error" role="alert">
              {saveError} Nothing was recorded.
            </p>
          )}
        </div>
      </div>

      {/* ---- sticky footer ---- */}
      <div className="rf-bar">
        <span className="rf-bar__status">
          <span className={cn('d', outstanding === 0 && 'd--ok')} aria-hidden="true" />
          <span>
            {outstanding === 0 ? (
              <strong className="ok">Ready to record.</strong>
            ) : (
              <>
                <strong>
                  {outstanding} {outstanding === 1 ? 'answer' : 'answers'} still needed
                </strong>
                {firstPart && nextLabel && (
                  <>
                    {' '}
                    · next: <a href={`#${firstPart.key}`}>{nextLabel}</a>
                  </>
                )}
              </>
            )}
          </span>
        </span>
        <span className="spacer" />
        {check.hardStop && (
          <>
            <input
              type="text"
              className="rf-input rf-bar__reason"
              aria-label="Reason the unit is untestable"
              value={untestableReason}
              placeholder="What you found, in one line"
              onChange={(e) => setUntestableReason(e.target.value)}
            />
            <Button
              type="button"
              variant="danger"
              {...(unit ? {} : { disabledReason: 'Say which manifest unit carried this label.' })}
              onClick={() => void onUntestable()}
            >
              Record as untestable
            </Button>
          </>
        )}
        {/* Enabled while incomplete on purpose: pressing it lists what is
            missing, which beats a dead button that leaves the reader guessing.
            The one dead case is real: an order with nothing left to record. */}
        <button
          type="submit"
          className={cn('rf-btn rf-btn--primary', outstanding > 0 && 'is-waiting')}
          disabled={saving || nothingLeft}
          title={nothingLeft ? 'Every machine on this order has been recorded.' : undefined}
        >
          {saving ? 'Recording…' : nothingLeft ? 'Nothing left to record' : 'Record inspection'}
        </button>
      </div>
    </form>
  );
}
