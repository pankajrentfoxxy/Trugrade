import * as React from 'react';
import {
  DataBoard,
  EmptyState,
  ScanBox,
  StatusPill,
  Tabs,
  TickRule,
  type Column,
} from '@trugrade/ui';
import { Field } from '../../../lib/controls';
import { normalisePastedSerial, splitSerialBlock, type SerialBatch } from '@trugrade/contracts';
import { API, postJson, type SerialCsvReport, type SerialCsvRow } from '../api';

/** Step 3 of ARCHETYPE D — `Wizard.tsx` owns the shape; this is its content. */

/**
 * Step 3 — serials, by paste, by CSV or by camera.
 *
 * **Paste is the default and the fastest route**, because it is the one that
 * makes "50 units in under 10 minutes" true. A warehouse already has the serials
 * in a spreadsheet column or a barcode wedge scanner that types them; both land
 * in this textarea. The camera is for the machine in your hands with no list,
 * and typing is always the fallback — a worn label defeats every scanner ever
 * built, and the vendor still owns the machine.
 *
 * Validation is `POST serials/validate`, which writes nothing, so it is safe on
 * every keystroke. The rules themselves are the shared `validateSerialBatch` in
 * contracts (VR-META-01), so what the vendor sees while typing and what the
 * server decides on submit are the same constant. Nothing here re-implements a
 * brand pattern, a length band or a normalisation rule.
 *
 * One rule governs the whole screen: **a brand-shape mismatch warns and never
 * blocks.** You will meet machines whose labels are worn.
 */

const EMPTY_BATCH: SerialBatch = { accepted: [], errors: [], warnings: [] };

const NEWLINE = String.fromCharCode(10);
/** One per line, because that is what a spreadsheet column pastes as. */
const SERIAL_PLACEHOLDER = ['7XKQ1P3', '8LMR2Q4', '…'].join(NEWLINE);

function Verdicts({ batch }: { batch: SerialBatch }): React.JSX.Element | null {
  if (batch.errors.length === 0 && batch.warnings.length === 0) return null;
  return (
    <div className="mt-5 flex flex-col gap-4">
      {batch.errors.length > 0 && (
        <div className="tg-card rounded border border-fail bg-sheet-2">
          <p className="text-body-sm font-medium text-fail">
            {batch.errors.length} {batch.errors.length === 1 ? 'line has' : 'lines have'} to be
            fixed
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {batch.errors.map((e) => (
              <li key={`${e.line}-${e.serial}`} className="text-body-sm text-ink">
                <span className="font-mono text-data tnum text-ink-2">Line {e.line}</span>{' '}
                <code className="font-mono text-data">{e.serial || '(empty)'}</code> — {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {batch.warnings.length > 0 && (
        <div className="tg-card rounded border border-warn">
          <p className="text-body-sm font-medium text-warn">
            {batch.warnings.length} to look at — none of them stops you
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {batch.warnings.map((w) => (
              <li key={`${w.line}-${w.serial}`} className="text-body-sm text-ink">
                <span className="font-mono text-data tnum text-ink-2">Line {w.line}</span>{' '}
                <code className="font-mono text-data">{w.serial}</code> — {w.message}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-body-sm text-ink-2">
            An unrecognised shape usually means a worn or reprinted label, not a wrong serial.
            Check the sticker; if it reads as printed, carry on.
          </p>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
 * CSV — dry run, per-row report, downloadable corrections file
 * ======================================================================== */

/** Line, serial, verdict. The first two are numbers or identifiers, so both are mono. */
const CSV_COLUMNS: ReadonlyArray<Column<SerialCsvRow>> = [
  {
    key: 'lineNumber',
    header: 'Line',
    numeric: true,
    cell: (row) => row.lineNumber,
  },
  {
    key: 'serial',
    header: 'Serial',
    cell: (row) => <span className="font-mono text-data text-ink">{row.serial}</span>,
  },
  {
    key: 'outcome',
    header: 'Outcome',
    cell: (row) => (
      <>
        <StatusPill
          tone={row.outcome === 'ERROR' ? 'fail' : row.outcome === 'WARN' ? 'warn' : 'pass'}
          label={row.outcome === 'WILL_ADD' ? 'Will add' : row.outcome}
        />
        {row.reason && <span className="ml-3 text-ink-2">{row.reason}</span>}
      </>
    ),
  },
];

/**
 * Exported because `/vendor/listings/:id/bulk-upload` is the same operation
 * against an existing listing. Two copies of a dry-run table is two places for
 * the outcome vocabulary to drift.
 */
export function SerialCsvPanel({
  brandName,
  onAccepted,
}: {
  brandName?: string;
  onAccepted: (serials: string[], report: SerialCsvReport) => void;
}): React.JSX.Element {
  const [report, setReport] = React.useState<SerialCsvReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function onFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const csv = await file.text();
      const r = await postJson<SerialCsvReport>(API.validateSerialsCsv, { csv, brandName });
      setReport(r);
      onAccepted(
        r.rows.filter((row) => row.outcome !== 'ERROR').map((row) => normalisePastedSerial(row.serial)),
        r,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="flex flex-col gap-2">
        <span className="text-body-sm font-medium text-ink-2">
          A CSV with one column of serial numbers
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-busy={busy || undefined}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
          className="text-body-sm text-ink-2 file:mr-4 file:h-11 file:rounded file:border file:border-rule file:bg-sheet-2 file:px-5 file:text-body-sm file:text-ink"
        />
      </label>
      <p className="mt-2 text-body-sm text-ink-2">
        Nothing is written until you finish the wizard. This is a dry run: every row is checked and
        reported back, and the file itself is never stored.
      </p>

      {error && (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-5">
          {report.fileErrors.length > 0 && (
            <div className="tg-card rounded border border-fail bg-sheet-2">
              {report.fileErrors.map((f) => (
                <p key={f} className="text-body-sm text-fail">
                  {f}
                </p>
              ))}
            </div>
          )}

          {report.rows.length > 0 && (
            <>
              {/* The sentence PHASE_03 asks for verbatim in spirit: what is about
                  to happen to the whole file, before anything happens. */}
              <p className="text-body text-ink">
                {report.willAdd} of {report.rows.length} rows will be added.
                {report.errors > 0 && ` ${report.errors} have errors and will not.`}
                {report.warnings > 0 && ` ${report.warnings} carry a warning and still will.`}
              </p>

              {report.errors > 0 && (
                <p className="mt-3">
                  <a
                    className="text-acc-ink underline underline-offset-4"
                    download="serial-errors.csv"
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(report.errorReportCsv)}`}
                  >
                    Download the {report.errors} failing rows
                  </a>{' '}
                  <span className="text-body-sm text-ink-2">
                    — line numbers match your own file.
                  </span>
                </p>
              )}

              <div className="mt-4 max-h-96 overflow-y-auto rounded border border-rule">
                <DataBoard
                  caption={`${report.willAdd} of ${report.rows.length} rows will be added.`}
                  columns={CSV_COLUMNS}
                  rows={report.rows}
                  rowKey={(row) => String(row.lineNumber)}
                  stickyHeader
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
 * Camera — zxing-js
 * ======================================================================== */

/**
 * The camera path.
 *
 * `@zxing/browser` is imported dynamically, and not for bundle size: the reader
 * touches `navigator.mediaDevices` on construction, so a static import would
 * make every test and every server render pay for a device API that is not
 * there. Loading it when the tab opens is also when the vendor has consented to
 * the camera prompt.
 *
 * Scanned codes go into the same paste buffer as everything else rather than a
 * list of their own, so one validation path covers all three input methods and
 * a mis-scan is corrected by editing text.
 */
function CameraScan({ onScan }: { onScan: (serial: string) => void }): React.JSX.Element {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [last, setLast] = React.useState<string | null>(null);

  React.useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'This browser cannot open a camera. Paste or type the serials instead — a USB barcode scanner types straight into the paste box.',
        );
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current ?? undefined,
          (result) => {
            if (!result) return;
            const serial = normalisePastedSerial(result.getText());
            if (!serial) return;
            setLast(serial);
            onScan(serial);
          },
        );
        if (cancelled) controls.stop();
        else stop = () => controls.stop();
      } catch (e) {
        // Almost always a denied permission or a camera another app holds.
        // Neither is recoverable here, and neither is a reason to lose the step.
        setError(
          `${(e as Error).message}. Paste or type the serials instead — nothing you have entered is lost.`,
        );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [onScan]);

  if (error) {
    return <EmptyState title="The camera did not open" body={error} />;
  }

  return (
    <div>
      {/* The scan line says "this feed is live", which is the one thing it is
          allowed to say. It stops under `prefers-reduced-motion`. */}
      <ScanBox className="w-full max-w-lg overflow-hidden rounded-lg border border-rule bg-sheet-2">
        <video ref={videoRef} className="w-full" muted playsInline />
      </ScanBox>
      <p className="mt-3 text-body-sm text-ink-2" role="status">
        {last ? (
          <>
            Last read: <code className="font-mono text-data text-ink">{last}</code>. Every scan is
            appended to the paste box, so a mis-read is fixed by editing the text.
          </>
        ) : (
          'Hold the asset label in the frame. Codes are added to the paste box as they are read.'
        )}
      </p>
    </div>
  );
}

/* ==========================================================================
 * The step
 * ======================================================================== */

type Method = 'PASTE' | 'CSV' | 'SCAN';

export function StepSerials({
  serialText,
  brandName,
  onChange,
}: {
  serialText: string;
  brandName?: string;
  /** Both the raw text and the accepted list — the step keeps the vendor's own paste. */
  onChange: (text: string, accepted: string[]) => void;
}): React.JSX.Element {
  const [method, setMethod] = React.useState<Method>('PASTE');
  const [batch, setBatch] = React.useState<SerialBatch>(EMPTY_BATCH);
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Debounced: the endpoint writes nothing, but it does two database lookups,
  // and a vendor pasting 5,000 lines should not fire 5,000 of them.
  React.useEffect(() => {
    const text = serialText.trim();
    if (!text) {
      setBatch(EMPTY_BATCH);
      onChange(serialText, []);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const b = await postJson<SerialBatch>(API.validateSerials, { text, brandName });
          if (cancelled) return;
          setBatch(b);
          setError(null);
          onChange(serialText, [...b.accepted]);
        } catch (e) {
          if (cancelled) return;
          setError((e as Error).message);
          // The server could not be reached, so uniqueness and the blacklist are
          // unknown. The local rules still hold and are still worth showing —
          // but nothing is accepted on their strength alone.
          setBatch({ ...EMPTY_BATCH, accepted: splitSerialBlock(text).map(normalisePastedSerial) });
          onChange(serialText, []);
        } finally {
          if (!cancelled) setChecking(false);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `onChange` is the parent's stable patch callback; including it would
    // re-run the check on every render of the wizard shell.
  }, [serialText, brandName]);

  const append = React.useCallback(
    (serial: string) => {
      // A scanner reads the same label several times a second. Appending a
      // duplicate would be caught as a duplicate-within-paste, which is a true
      // verdict about a false problem.
      const lines = splitSerialBlock(serialText).map(normalisePastedSerial);
      if (lines.includes(serial)) return;
      onChange(serialText ? `${serialText.replace(/\s*$/, '')}\n${serial}` : serial, []);
    },
    [serialText, onChange],
  );

  return (
    <div>
      <h2 className="text-h2 text-ink">Serial numbers</h2>
      <TickRule />
      <p className="mt-2 max-w-prose text-body-sm text-ink-2">
        One serial per machine. We check each one against every live listing on the platform, so
        &ldquo;already listed&rdquo; appears here rather than after you submit.
      </p>

      <Tabs
        className="mt-6"
        label="How to enter serials"
        value={method}
        onChange={(k) => setMethod(k as Method)}
        items={[
          {
            key: 'PASTE',
            label: 'Paste or type',
            panel: (
              <Field
                label="Paste a column from your spreadsheet, or type them one per line"
                htmlFor="serial-paste"
              >
                <textarea
                  id="serial-paste"
                  value={serialText}
                  onChange={(e) => onChange(e.target.value, [])}
                  rows={12}
                  spellCheck={false}
                  placeholder={SERIAL_PLACEHOLDER}
                  className="rounded border border-rule bg-sheet p-4 font-mono text-data uppercase tracking-wide text-ink placeholder:text-ink-4"
                />
              </Field>
            ),
          },
          {
            key: 'CSV',
            label: 'Upload a CSV',
            panel: (
              <SerialCsvPanel
                brandName={brandName}
                onAccepted={(serials) => onChange(serials.join(NEWLINE), [])}
              />
            ),
          },
          { key: 'SCAN', label: 'Scan with the camera', panel: <CameraScan onScan={append} /> },
        ]}
      />

      {error && (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {error} Nothing has been added.
        </p>
      )}

      {method !== 'CSV' && (
        <>
          <p className="mt-5 text-body-sm text-ink-2" role="status" aria-live="polite">
            {checking
              ? 'Checking…'
              : `${batch.accepted.length} ${batch.accepted.length === 1 ? 'serial' : 'serials'} ready to add`}
          </p>
          <Verdicts batch={batch} />
        </>
      )}
    </div>
  );
}
