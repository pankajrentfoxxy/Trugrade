import * as React from 'react';
import { Link, useParams } from 'react-router';
import { GRADES, QC_AREA_SCORE, type Grade } from '@trugrade/contracts';
import { Button, EmptyState, GradeBadge, Input, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../../lib/useResource';
import { send, uploadPhoto } from './api';
import { Datum, Panel, Select, Textarea, TD, TH } from './controls';
import {
  checkInspection,
  emptyInspection,
  gradeCap,
  toPayload,
  type AreaChoice,
  type HardwareEntry,
  type InspectionState,
} from './inspection';
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
 * The whole inspection, on a keyboard.
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
 * Everything that decides anything lives in `inspection.ts` and is unit-tested
 * there. What follows is layout.
 */

const gradeLabel = (g: Grade): string => g.replace('_PLUS', '+');

const AREA_CHOICES: Array<{ value: AreaChoice; label: string }> = [
  { value: 'PASS', label: 'Pass' },
  { value: 'WARN', label: 'Warn' },
  { value: 'FAIL', label: 'Fail' },
  { value: 'NOT_MEASURED', label: 'Not measured' },
];

const TRISTATE = [
  { value: 'UNKNOWN', label: 'Not checked' },
  { value: 'NO', label: 'No' },
  { value: 'YES', label: 'Yes' },
] as const;

const VERDICTS: Array<{ value: Verdict; label: string }> = [
  { value: 'PASS', label: 'Pass' },
  { value: 'PASS_WITH_NOTE', label: 'Pass, with a note' },
  { value: 'MISMATCH', label: 'Mismatch against the declared specification' },
  { value: 'FAIL', label: 'Fail' },
];

/* ==========================================================================
 * One photograph
 * ======================================================================== */

function PhotoSlot({
  slot,
  label,
  file,
  onUploaded,
}: {
  slot: string;
  label: string;
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
    <div className="flex flex-col gap-2 rounded border border-rule bg-sheet-2 p-3">
      <label htmlFor={inputId} className="text-body-sm font-medium text-ink-2">
        {label}
      </label>
      {file ? (
        <img
          src={file.url}
          alt={`${label} of the unit being inspected`}
          className="aspect-[3/2] w-full rounded object-cover"
        />
      ) : (
        <div className="flex aspect-[3/2] w-full items-center justify-center rounded border border-dashed border-rule text-body-sm text-ink-3">
          {busy ? 'Uploading…' : 'Not photographed'}
        </div>
      )}
      <input
        id={inputId}
        type="file"
        // `capture` makes a phone or a tablet open the camera rather than the
        // gallery — this form is meant to be usable on the tablet that stands in
        // for the mobile app.
        accept="image/*"
        capture="environment"
        onChange={(e) => void onPick(e)}
        className="text-body-sm text-ink-2 file:mr-3 file:rounded file:border file:border-rule file:bg-sheet file:px-3 file:py-1 file:text-body-sm file:text-ink"
      />
      {file && <code className="truncate font-mono text-label text-ink-3">{file.hash}</code>}
      {error && (
        <p className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
 * The twelve areas
 * ======================================================================== */

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
  return (
    <tr className="border-b border-rule-2" data-area={area}>
      <th scope="row" className={`${TD} font-normal`}>
        {AREA_LABEL[area]}
        <code className="ml-2 font-mono text-label uppercase tracking-[0.13em] text-ink-3">
          {area}
        </code>
      </th>
      <td className={TD}>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">{AREA_LABEL[area]} result</legend>
          {AREA_CHOICES.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-body-sm text-ink">
              <input
                type="radio"
                name={`area-${area}`}
                value={c.value}
                checked={entry.status === c.value}
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
              {c.label}
            </label>
          ))}
        </fieldset>
      </td>
      <td className={TD}>
        <input
          type="number"
          min={QC_AREA_SCORE.min}
          max={QC_AREA_SCORE.max}
          step={1}
          value={entry.score}
          disabled={!measured}
          aria-label={`${AREA_LABEL[area]} score out of ${QC_AREA_SCORE.max}`}
          onChange={(e) => onChange({ ...entry, score: e.target.value })}
          className="h-9 w-20 rounded border border-rule bg-sheet px-3 text-body-sm tnum text-ink disabled:opacity-45"
        />
      </td>
      <td className={TD}>
        <input
          type="text"
          value={entry.note}
          aria-label={`${AREA_LABEL[area]} note`}
          placeholder={entry.status === 'NOT_MEASURED' ? 'Why could it not be measured?' : 'Note'}
          onChange={(e) => onChange({ ...entry, note: e.target.value })}
          className="h-9 w-full min-w-[12rem] rounded border border-rule bg-sheet px-3 text-body-sm text-ink placeholder:text-ink-3"
        />
      </td>
    </tr>
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
    <div className="grid gap-5 md:grid-cols-2">
      <Input
        label="RAM detected (GB)"
        type="number"
        min={0}
        value={value.ramDetectedGb}
        onChange={(e) => set('ramDetectedGb', e.target.value)}
        hint={
          'Enter the installed capacity from the module labels. Windows reports what the OS ' +
          'can use — 16 GB installed shows as 15 GB once the integrated graphics take their ' +
          'share — and typing the usable figure here fires a false mismatch on every unit ' +
          '(07 section 3.4).'
        }
      />
      <Input
        label="RAM modules"
        type="number"
        min={0}
        value={value.ramModules}
        onChange={(e) => set('ramModules', e.target.value)}
      />
      <Input
        label="Storage type"
        value={value.storageType}
        mono
        placeholder="NVMe"
        onChange={(e) => set('storageType', e.target.value)}
      />
      <Input
        label="Storage detected (GB)"
        type="number"
        min={0}
        value={value.storageDetectedGb}
        onChange={(e) => set('storageDetectedGb', e.target.value)}
        hint="The nominal marketed capacity — a 512 GB drive measures 477 GiB and the buyer bought 512."
      />
      <Select
        label="SMART status"
        value={value.smartStatus}
        onChange={(e) => set('smartStatus', e.target.value as HardwareEntry['smartStatus'])}
        options={[
          { value: '', label: 'Not read' },
          { value: 'OK', label: 'OK' },
          { value: 'WARNING', label: 'Warning' },
          { value: 'FAILING', label: 'Failing' },
        ]}
      />
      <Input
        label="Battery health (%)"
        type="number"
        min={0}
        max={100}
        value={value.batteryHealthPct}
        onChange={(e) => set('batteryHealthPct', e.target.value)}
        hint="Measured full-charge capacity against design capacity. One value, computed once."
      />

      <div className="flex flex-col gap-2">
        <Input
          label="Cycle count"
          type="number"
          min={0}
          value={value.cycleCountNotReported ? '' : value.cycleCount}
          disabled={value.cycleCountNotReported}
          onChange={(e) => set('cycleCount', e.target.value)}
        />
        <label className="flex items-start gap-3 text-body-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.cycleCountNotReported}
            onChange={(e) => set('cycleCountNotReported', e.target.checked)}
          />
          <span>
            Not reported by this system
            <span className="block text-ink-2">
              A cycle count of 0 on a battery with real wear is not a measurement, it is a default.
              Leave it unreported rather than writing a number a buyer will rely on.
            </span>
          </span>
        </label>
      </div>

      <div className="grid gap-4">
        <Select
          label="BIOS or firmware password set"
          value={value.biosLocked}
          onChange={(e) => set('biosLocked', e.target.value as HardwareEntry['biosLocked'])}
          options={TRISTATE}
        />
        <Select
          label="MDM enrolment present"
          value={value.mdmLocked}
          onChange={(e) => set('mdmLocked', e.target.value as HardwareEntry['mdmLocked'])}
          options={TRISTATE}
        />
        <Select
          label="Computrace active"
          value={value.computraceActive}
          onChange={(e) =>
            set('computraceActive', e.target.value as HardwareEntry['computraceActive'])
          }
          options={TRISTATE}
          hint={'"Not checked" is a real answer, and it is the right one when nobody looked.'}
        />
      </div>
    </div>
  );
}

/* ==========================================================================
 * The screen
 * ======================================================================== */

export function ManualInspectionRoute(): React.JSX.Element {
  const { visitId = '' } = useParams<{ visitId: string }>();
  const visit = useResource<VisitDetail>(`/api/qc/visits/${visitId}`, 'This visit is unavailable');
  const techs = useResource<TechnicianOption[]>(
    '/api/qc/technicians',
    'The technician list is unavailable',
  );

  const [state, setState] = React.useState<InspectionState>(() => emptyInspection());
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [savedReportId, setSavedReportId] = React.useState<string | null>(null);
  const [untestableReason, setUntestableReason] = React.useState('');
  const [showBlockers, setShowBlockers] = React.useState(false);

  const manifest = React.useMemo(() => visit.data?.manifest ?? [], [visit.data]);
  const check = React.useMemo(() => checkInspection(state, manifest), [state, manifest]);
  const unit = manifest.find((m) => m.visitUnitId === state.visitUnitId);
  const cap = gradeCap(state.areas);

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
    if (check.blockers.length > 0 || !unit || !visit.data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { reportId } = await send<{ reportId: string }>(
        '/api/qc/reports/manual',
        'POST',
        toPayload(state, visit.data.id, unit, check.normalisedSerial),
        'The inspection did not save',
      );
      setSavedReportId(reportId);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
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
      <EmptyState
        title="This visit did not load"
        body={`${visit.error}. Nothing has been recorded — reload to try again.`}
      />
    );
  }
  if (!visit.data) return <Skeleton lines={12} />;

  if (savedReportId !== null) {
    return (
      <EmptyState
        title={savedReportId ? 'Inspection recorded' : 'Unit recorded as untestable'}
        body={
          savedReportId
            ? 'The report is on the unit and supersedes any earlier one. The prior report is kept — history is the evidence.'
            : 'The QC manager has been notified. The unit is not graded, not sealed and not listed.'
        }
        action={
          <Link to={`/qc/visits/${visitId}`} className="text-acc-ink underline underline-offset-4">
            Back to {visit.data.visitNumber}
          </Link>
        }
      />
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <h1 className="text-h1 text-ink">Manual inspection</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        <Link
          to={`/qc/visits/${visitId}`}
          className="text-acc-ink underline decoration-rule underline-offset-4"
        >
          {visit.data.visitNumber}
        </Link>{' '}
        · {visit.data.vendorName} · {visit.data.facilityLabel}
      </p>
      <p className="mt-1 text-body-sm text-ink-3">
        Everything the technician app captures, captured here instead. Nothing on this form is
        optional because the machine is in a hurry.
      </p>

      {check.hardStop && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-fail bg-sheet-2 p-5 text-body-sm text-fail"
        >
          <strong className="block text-h3">Stop. This is not the machine on the manifest.</strong>
          <p className="mt-2">
            The label does not belong to this laptop. Do not grade it, do not seal it, do not list
            it. Record it untestable and raise it to the QC manager.
          </p>
        </div>
      )}

      {/* ---- the machine ---- */}
      <Panel title="The machine" subtitle="Which unit, and does the label belong to it.">
        <div className="grid gap-5 md:grid-cols-2">
          <Select
            label="Unit on the manifest"
            value={state.visitUnitId}
            onChange={(e) => set('visitUnitId', e.target.value)}
            options={[
              { value: '', label: 'Choose a unit…' },
              ...manifest.map((m) => ({
                value: m.visitUnitId,
                label: `${m.sequenceNo}. ${m.serialNumber} · ${m.skuLabel}`,
              })),
            ]}
          />
          <Select
            label="Technician"
            value={state.technicianId}
            onChange={(e) => set('technicianId', e.target.value)}
            options={[
              { value: '', label: 'Choose a technician…' },
              ...(techs.data ?? [])
                .filter((t) => t.isActive || t.id === state.technicianId)
                .map((t) => ({ value: t.id, label: `${t.name} · ${t.employeeCode}` })),
            ]}
          />
          <Input
            label="Serial read off the machine"
            mono
            value={state.serialScanned}
            onChange={(e) => set('serialScanned', e.target.value)}
            verifyState={
              !unit || check.normalisedSerial === ''
                ? 'idle'
                : check.hardStop
                  ? 'rejected'
                  : 'verified'
            }
            verifyDetail={
              unit && !check.hardStop && check.normalisedSerial !== ''
                ? `Matches the manifest: ${unit.serialNumber}`
                : undefined
            }
            error={
              check.hardStop && unit
                ? `The manifest says ${unit.serialNumber}. Do not proceed.`
                : undefined
            }
            hint="Scan it, or type it as printed. Prefixes and spacing are stripped; O and 0 are not guessed at."
          />
          {unit && (
            <div>
              <Datum label="Declared grade">
                {unit.declaredGrade ? (
                  <GradeBadge grade={unit.declaredGrade} variant="declared" />
                ) : (
                  'None declared'
                )}
              </Datum>
              <Datum label="SKU">{unit.skuLabel}</Datum>
            </div>
          )}
          <Input
            label="Started"
            type="datetime-local"
            value={state.startedAt}
            onChange={(e) => set('startedAt', e.target.value)}
          />
          <Input
            label="Completed"
            type="datetime-local"
            value={state.completedAt}
            onChange={(e) => set('completedAt', e.target.value)}
          />
        </div>
      </Panel>

      {/* ---- the twelve areas ---- */}
      <Panel
        title="The twelve inspection areas"
        subtitle={
          <>
            Every area needs an answer. <strong>Not measured</strong> writes no row at all and
            prints &ldquo;not measured&rdquo; on the report face — it is never stored as a pass.
          </>
        }
        aside={
          cap ? (
            <StatusPill tone="warn" label={`Caps this machine at ${gradeLabel(cap.cap)}`} />
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              The twelve functional inspection areas, each with a result, a score out of ten and a
              note.
            </caption>
            <thead>
              <tr className="border-b border-rule">
                <th scope="col" className={TH}>
                  Area
                </th>
                <th scope="col" className={TH}>
                  Result
                </th>
                <th scope="col" className={TH}>
                  Score / {QC_AREA_SCORE.max}
                </th>
                <th scope="col" className={TH}>
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {QC_AREA_CODES.map((area) => (
                <AreaRow
                  key={area}
                  area={area}
                  entry={state.areas[area]}
                  onChange={(next) => set('areas', { ...state.areas, [area]: next })}
                />
              ))}
            </tbody>
          </table>
        </div>
        {cap && (
          <p className="mt-4 text-body-sm text-warn">
            {cap.reason} A weighted mean would swallow that — eleven areas at ten and one at three
            still averages well. The floor rule is what stops it, so this machine cannot be graded
            above {gradeLabel(cap.cap)}.
          </p>
        )}
      </Panel>

      <Panel
        title="Detected hardware"
        subtitle="What the machine actually is, as measured. Not what the vendor declared."
      >
        <HardwareFields value={state.hardware} onChange={(h) => set('hardware', h)} />
      </Panel>

      <Panel
        title="Photographs"
        subtitle="Six, minimum. These are the real machine, and they are what makes the representative images on the listing honest."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PHOTO_ANGLES.map((angle) => (
            <PhotoSlot
              key={angle}
              slot={angle}
              label={PHOTO_LABEL[angle]}
              file={state.photos[angle]}
              onUploaded={(f) => set('photos', { ...state.photos, [angle]: f })}
            />
          ))}
        </div>
      </Panel>

      <Panel
        title="Seal"
        subtitle="A passed unit is sealed and the seal is photographed on the machine. The seal is what makes a twelve-minute inspection still mean something three weeks later, when the machine has sat at the vendor's premises the whole time."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Input
            label="Seal code"
            mono
            value={state.sealCode}
            placeholder="TRG-26HR-0004821"
            onChange={(e) => set('sealCode', e.target.value.toUpperCase())}
            hint="Exactly as printed on the seal you applied."
          />
          <PhotoSlot
            slot="seal"
            label="The seal, applied to this machine"
            file={state.sealPhoto ?? undefined}
            onUploaded={(f) => set('sealPhoto', f ?? null)}
          />
        </div>
      </Panel>

      <Panel title="Verdict" subtitle="The grade is our claim under CP e-Comm r.7(5), not the tool's.">
        <div className="grid gap-5 md:grid-cols-2">
          <Select
            label="Verdict"
            value={state.verdict}
            onChange={(e) => set('verdict', e.target.value as Verdict)}
            options={VERDICTS}
          />
          <Input
            label="QC score"
            type="number"
            min={0}
            max={100}
            value={state.qcScore}
            onChange={(e) => set('qcScore', e.target.value)}
          />
          <Select
            label="Grade proposed"
            value={state.gradeProposed}
            onChange={(e) => set('gradeProposed', e.target.value as Grade | '')}
            options={[
              { value: '', label: 'Not listable' },
              ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) })),
            ]}
            hint="What the thresholds give you before any judgement."
          />
          <Select
            label="Grade final"
            value={state.gradeFinal}
            onChange={(e) => set('gradeFinal', e.target.value as Grade | '')}
            options={[
              { value: '', label: 'Not listable' },
              ...GRADES.map((g) => ({ value: g, label: gradeLabel(g) })),
            ]}
            hint="What we will sell it as. We list A+, A and B only."
          />
        </div>
        {state.gradeProposed !== state.gradeFinal && (
          <Textarea
            className="mt-5"
            label="Why the final grade differs from the proposed grade"
            rows={3}
            value={state.gradeOverrideReason}
            onChange={(e) => set('gradeOverrideReason', e.target.value)}
            hint="Required by chk_override_reason, and by anyone reading this report in six months."
          />
        )}
        <Textarea
          className="mt-5"
          label="Notes"
          rows={3}
          value={state.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Panel>

      {check.notices.map((n) => (
        <p key={n} className="mt-4 text-body-sm text-warn">
          {n}
        </p>
      ))}

      {showBlockers && check.blockers.length > 0 && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-fail bg-sheet-2 p-5"
          data-testid="blockers"
        >
          <h2 className="text-h3 text-fail">
            {check.blockers.length === 1
              ? 'One thing is stopping this inspection being recorded'
              : `${check.blockers.length} things are stopping this inspection being recorded`}
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body-sm text-fail">
            {check.blockers.map((b) => (
              <li key={b.field + b.message}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {saveError} Nothing was recorded.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" loading={saving}>
          Record the inspection
        </Button>
        {check.hardStop && (
          <>
            <input
              type="text"
              value={untestableReason}
              aria-label="Reason the unit is untestable"
              placeholder="What you found, in one line"
              onChange={(e) => setUntestableReason(e.target.value)}
              className="h-11 min-w-[18rem] flex-1 rounded border border-rule bg-sheet px-4 text-body-sm text-ink placeholder:text-ink-3"
            />
            <Button type="button" variant="danger" onClick={() => void onUntestable()}>
              Record as untestable
            </Button>
          </>
        )}
        <span className="text-body-sm text-ink-3">
          {check.blockers.length === 0
            ? 'Ready to record.'
            : `${check.blockers.length} outstanding.`}
        </span>
      </div>
    </form>
  );
}
