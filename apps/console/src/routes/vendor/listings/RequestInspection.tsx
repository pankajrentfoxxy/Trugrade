import * as React from 'react';
import { Button } from '@trugrade/ui';
import { usePrincipal } from '../../../lib/auth';
import {
  API,
  postJson,
  rupees,
  type SubmitAccepted,
  type SubmitResult,
  type VendorListing,
} from '../api';

/**
 * Request an inspection for a listing that already exists.
 *
 * Only the wizard used to call `POST /vendor/listings/:id/submit`. A draft made
 * from the quick Create dialog, a batch added by CSV, a listing HELD below the
 * visit minimum, or one whose submit failed after it was created all ended up in
 * `/vendor/listings` with no way to send them — and re-running the wizard built a
 * second listing that then collided with the first on its own serials.
 *
 * This does not put anything on sale. The fee is stated before it is accepted.
 */
export function RequestInspection({
  listing,
  unitCount,
  onSubmitted,
}: {
  listing: VendorListing;
  unitCount: number;
  /**
   * Called once a visit exists. The record reloads — which unmounts this panel —
   * so the confirmation is the caller's to keep on screen.
   */
  onSubmitted: (accepted: SubmitAccepted) => void;
}): React.JSX.Element | null {
  const principal = usePrincipal();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Exclude<SubmitResult, SubmitAccepted> | null>(null);

  const canWrite = principal?.permissions.includes('listing.own.write') ?? false;
  if (!canWrite || unitCount === 0 || listing.status !== 'DRAFT') return null;

  const send = async (choice?: 'HOLD' | 'ACCEPT_FEE'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await postJson<SubmitResult>(
        API.submit(listing.id),
        choice ? { choice } : {},
      );
      if (outcome.outcome === 'SUBMITTED') {
        onSubmitted(outcome);
        return;
      }
      setResult(outcome);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tg-card rounded-lg border border-rule p-5" data-testid="request-inspection">
      {result?.outcome === 'DECISION_REQUIRED' ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink">
            <span className="font-mono tnum">{result.unitCount}</span>{' '}
            {result.unitCount === 1 ? 'machine is' : 'machines are'} fewer than the{' '}
            <span className="font-mono tnum">{result.minUnitsPerVisit}</span> a visit is worth. Hold
            until you reach it, or we come now for a visit fee of{' '}
            <span className="font-mono tnum">{rupees(result.visitFee)}</span>.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" loading={busy} onClick={() => void send('HOLD')}>
              Hold until I reach {result.minUnitsPerVisit}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void send('ACCEPT_FEE')}>
              Inspect now for {rupees(result.visitFee)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {result?.outcome === 'HELD' ? (
            <p className="text-body text-ink">
              Held. A visit needs <span className="font-mono tnum">{result.minUnitsPerVisit}</span>{' '}
              machines and this listing has{' '}
              <span className="font-mono tnum">{result.unitCount}</span>. Add{' '}
              <span className="font-mono tnum">{result.shortBy}</span> more, or ask again and accept
              the visit fee.
            </p>
          ) : (
            <p className="text-body text-ink-2">
              This listing is a draft. Nothing is inspected or on sale until you request an
              inspection.
            </p>
          )}
          <div>
            <Button variant="primary" loading={busy} onClick={() => void send()}>
              Request inspection
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** What a successful request says, kept by the record across its reload. */
export function InspectionRequested({ accepted }: { accepted: SubmitAccepted }): React.JSX.Element {
  return (
    <p role="status" className="rounded border border-rule bg-sheet-2 p-4 text-body text-ink">
      Inspection requested. Visit <span className="font-mono tnum">{accepted.visitNumber}</span>{' '}
      covers <span className="font-mono tnum">{accepted.unitCount}</span>{' '}
      {accepted.unitCount === 1 ? 'machine' : 'machines'}, visit fee{' '}
      <span className="font-mono tnum">{rupees(accepted.visitFee)}</span>. Nothing goes on sale
      until it has been inspected.
    </p>
  );
}
