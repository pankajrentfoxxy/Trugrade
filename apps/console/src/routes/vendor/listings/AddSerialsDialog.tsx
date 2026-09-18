import * as React from 'react';
import { Button, Modal } from '@trugrade/ui';
import { normalisePastedSerial, splitSerialBlock } from '@trugrade/contracts';
import { Field } from '../../../lib/controls';
import { API, postJson, type AddUnitsOutcome } from '../api';

/**
 * Serials typed by hand, for the listing that already exists.
 *
 * The CSV route is the right one for a warehouse export of four hundred rows.
 * It is the wrong one for the three machines somebody is holding — that vendor
 * was being asked to open a spreadsheet, save a file and upload it to add three
 * lines they could type in ten seconds.
 *
 * **The verdict is per serial, not per batch.** `POST /listings/:id/units`
 * already writes every serial it can and reports the rest, so a paste of ten
 * where two are duplicates adds eight. Reporting that as one failure would be a
 * lie about eight machines, and reporting it as one success a lie about two.
 * Each line is coloured by what happened to it and every refusal is quoted
 * underneath in the server's own words.
 *
 * On a partial result the box is refilled with only the serials that failed:
 * the ones that landed are in, and offering them back for a second attempt
 * would produce a duplicate error for a machine that is already on the listing.
 */

/** What the server said about one typed line. */
interface Verdict {
  serial: string;
  added: boolean;
  message?: string;
}

/**
 * One verdict per typed LINE, not per distinct serial.
 *
 * A serial typed twice is one machine written and one line refused — the server
 * says exactly that, keying its refusal to line 3 while `added` names the serial
 * once. Matching those refusals by serial value instead marks both copies with
 * the same verdict, and the count then reads "3 of 3 added" over a batch that
 * wrote two. `line` is 1-based over the array we posted.
 */
function verdicts(serials: readonly string[], outcome: AddUnitsOutcome): Verdict[] {
  const added = new Set(outcome.added);
  const byLine = new Map(outcome.batch.errors.map((e) => [e.line, e.message]));
  // Only for a refusal carrying no usable line: then the serial is all there is.
  const bySerial = new Map(
    outcome.batch.errors.filter((e) => !e.line).map((e) => [e.serial, e.message]),
  );

  return serials.map((serial, i) => {
    const refusal = byLine.get(i + 1) ?? bySerial.get(serial);
    if (refusal) return { serial, added: false, message: refusal };
    if (added.has(serial)) return { serial, added: true };
    // Neither written nor refused: still not on the listing, and silence about
    // it would read as success.
    return {
      serial,
      added: false,
      message:
        'This serial was not added, and the server did not say why. Try it again on its own.',
    };
  });
}

export function AddSerialsDialog({
  listingId,
  open,
  onClose,
  onAdded,
}: {
  listingId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Fired on close, once, when at least one serial was written.
   *
   * On close and not on write: the board's fetch blanks its own data while it
   * is in flight, so the route falls back to its skeleton and takes this dialog
   * down with it — destroying the verdicts the vendor opened it to read. The
   * reload is worth exactly one render, and it can wait until they are done.
   */
  onAdded: () => void;
}): React.JSX.Element {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Verdict[] | null>(null);
  const wrote = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
    setResults(null);
    wrote.current = false;
  }, [open]);

  const close = (): void => {
    if (wrote.current) onAdded();
    onClose();
  };

  const typed = splitSerialBlock(text).map(normalisePastedSerial).filter(Boolean);
  const failed = results?.filter((r) => !r.added) ?? [];
  const addedCount = results?.filter((r) => r.added).length ?? 0;

  async function add(): Promise<void> {
    if (typed.length === 0) {
      setError('Type at least one serial, one per line.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await postJson<AddUnitsOutcome>(API.listingUnits(listingId), {
        serials: typed,
      });
      const verdict = verdicts(typed, outcome);
      setResults(verdict);
      if (outcome.added.length > 0) wrote.current = true;
      // Only what still needs fixing stays in the box.
      const rejected = verdict.filter((v) => !v.added).map((v) => v.serial);
      if (rejected.length !== typed.length) setText(rejected.join('\n'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add serials"
      description="One per line. Paste a column from a spreadsheet, or type them."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Serials, one per line"
          htmlFor="manual-serials"
          hint={
            typed.length > 0 ? (
              <>
                <span className="font-mono tnum">{typed.length}</span>{' '}
                {typed.length === 1 ? 'serial' : 'serials'} typed
              </>
            ) : undefined
          }
        >
          <textarea
            id="manual-serials"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={12}
            spellCheck={false}
            placeholder={'CND4233328\nCND4233329\nCND4233330'}
            className="rounded border border-rule bg-sheet p-4 font-mono text-data uppercase tracking-wide text-ink placeholder:text-ink-4"
          />
        </Field>

        {error && (
          <p className="text-body-sm text-fail" role="alert">
            {error}
          </p>
        )}

        {results && (
          <div className="flex flex-col gap-3" data-testid="serial-results">
            <p className="text-body-sm text-ink-2" role="status">
              <span className="font-mono tnum text-ink">{addedCount}</span> of{' '}
              <span className="font-mono tnum text-ink">{results.length}</span>{' '}
              {results.length === 1 ? 'serial was' : 'serials were'} added.
              {failed.length > 0 ? ' The rest are still in the box above, to fix and try again.' : ''}
            </p>

            {/* Green is added, red is refused — the only two outcomes there are. */}
            <ul className="flex flex-wrap gap-2">
              {/* Keyed by line: the same serial can legitimately appear twice. */}
              {results.map((r, i) => (
                <li
                  key={`${i}-${r.serial}`}
                  data-added={r.added ? 'true' : 'false'}
                  className={
                    r.added
                      ? 'rounded border border-pass-line bg-pass-wash px-2 py-1 font-mono text-data tnum text-pass'
                      : 'rounded border border-fail-line bg-fail-wash px-2 py-1 font-mono text-data tnum text-fail'
                  }
                >
                  {r.serial}
                </li>
              ))}
            </ul>

            {failed.length > 0 && (
              <ul className="flex flex-col gap-1" data-testid="serial-errors">
                {failed.map((r, i) => (
                  <li key={`${i}-${r.serial}`} className="text-body-sm text-ink-2">
                    <code className="font-mono text-data text-fail">{r.serial}</code> — {r.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {addedCount > 0 && failed.length === 0 ? 'Done' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            {...(typed.length === 0 ? { disabledReason: 'Type a serial first.' } : {})}
            onClick={() => void add()}
          >
            {results ? 'Add these' : 'Add'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
