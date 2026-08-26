import * as React from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumb, Button } from '@trugrade/ui';
import type { SerialBatch } from '@trugrade/contracts';
import { PageHeader } from '../../lib/controls';
import { API, postJson } from './api';
import { SerialCsvPanel } from './wizard/StepSerials';

/**
 * ARCHETYPE F — Focus. One task, no competing controls.
 * DENSITY: default (vendor portal), set on the app root by the shell.
 *
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
    <div className="tg-stack">
      <Breadcrumb
        items={[
          { label: 'Your stock', href: '/vendor/listings' },
          { label: 'Units', href: `/vendor/listings/${id}` },
          { label: 'Add serials' },
        ]}
      />

      <PageHeader title="Add serials from a file">
        Up to 5,000 machines on one listing. Every row is checked against every live listing on the
        platform before anything is written, and rows with errors are simply left out — the good
        rows still go in.
      </PageHeader>

      {added !== null && (
        <p role="status" className="tg-card rounded border border-pass bg-sheet-2 text-body-sm text-pass">
          {added} {added === 1 ? 'machine' : 'machines'} added.{' '}
          <Link className="underline underline-offset-4" to={`/vendor/listings/${id}`}>
            See them
          </Link>
        </p>
      )}

      <SerialCsvPanel onAccepted={(serials) => setPending(serials)} />

      {error && (
        <p className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      <div className="border-t border-rule pt-6">
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
