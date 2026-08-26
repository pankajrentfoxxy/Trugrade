import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '@trugrade/ui';
import type { SerialBatch } from '@trugrade/contracts';
import { API, postJson } from './api';
import { SerialCsvPanel } from './wizard/StepSerials';

/**
 * Bulk CSV upload against an existing listing — dry run first, always.
 *
 * The dry-run table is `SerialCsvPanel`, the same component step 3 of the wizard
 * uses. Two implementations of "what will this file do" is two vocabularies for
 * one outcome, and the one the vendor reads at 6pm is whichever they happen to
 * be on.
 *
 * Deliberately scoped to **one listing**. A cross-SKU importer — a file naming
 * a SKU code, grade, battery band and payout per row — is a different thing
 * needing a column schema and a server endpoint that do not exist yet. Guessing
 * at either would produce a file format we then have to support.
 */
export function BulkUploadRoute(): React.JSX.Element {
  const { id } = useParams();
  const [pending, setPending] = React.useState<string[]>([]);
  const [added, setAdded] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function commit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const outcome = await postJson<{ added: string[]; batch: SerialBatch }>(
        API.listingUnits(id ?? ''),
        { serials: pending },
      );
      setAdded(outcome.added.length);
      setPending([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link
        className="text-body-sm text-acc-ink underline underline-offset-4"
        to={`/vendor/listings/${id}`}
      >
        Back to the listing
      </Link>

      <h1 className="mt-3 text-h1 text-ink">Add serials from a file</h1>
      <p className="mt-2 max-w-prose text-body-sm text-ink-2">
        Up to 5,000 machines on one listing. Every row is checked against every live listing on the
        platform before anything is written, and rows with errors are simply left out — the good
        rows still go in.
      </p>

      {added !== null && (
        <p className="mt-6 rounded border border-pass bg-sheet-2 p-5 text-body-sm text-pass">
          {added} {added === 1 ? 'machine' : 'machines'} added.{' '}
          <Link className="underline underline-offset-4" to={`/vendor/listings/${id}`}>
            See them
          </Link>
        </p>
      )}

      <div className="mt-6">
        <SerialCsvPanel onAccepted={(serials) => setPending(serials)} />
      </div>

      {error && (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      <div className="mt-7 border-t border-rule pt-6">
        <Button
          variant="primary"
          loading={busy}
          disabledReason={
            pending.length === 0 ? 'Upload a file first — nothing is written until you do.' : ''
          }
          onClick={() => void commit()}
        >
          Add {pending.length} {pending.length === 1 ? 'machine' : 'machines'}
        </Button>
      </div>
    </div>
  );
}
