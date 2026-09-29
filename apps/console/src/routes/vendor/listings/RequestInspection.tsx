import * as React from 'react';
import { Button } from '@trugrade/ui';
import { usePrincipal } from '../../../lib/auth';
import { API, postJson, type SubmitAccepted, type SubmitResult, type VendorListing } from '../api';

/**
 * Send a draft listing to ops for approval, from the listing's own record.
 *
 * Only the wizard used to call `POST /vendor/listings/:id/submit`. A draft made
 * from the quick Create dialog, or one whose submit failed after it was
 * created, ended up in `/vendor/listings` with no way to send it. This is that
 * way.
 *
 * Nothing goes on sale here. Ops approve the listing onto the storefront, and
 * nothing is inspected until a buyer orders — so there is no fee, no visit and
 * no question to answer, just the one button.
 */
export function RequestInspection({
  listing,
  unitCount,
  onSubmitted,
}: {
  listing: VendorListing;
  /** The declared quantity. Zero means the draft cannot be sent yet. */
  unitCount: number;
  /**
   * Called once the listing is with ops. The record reloads — which unmounts
   * this panel — so the confirmation is the caller's to keep on screen.
   */
  onSubmitted: (accepted: SubmitAccepted) => void;
}): React.JSX.Element | null {
  const principal = usePrincipal();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canWrite = principal?.permissions.includes('listing.own.write') ?? false;
  if (!canWrite || listing.status !== 'DRAFT') return null;

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await postJson<SubmitResult>(API.submit(listing.id), {});
      onSubmitted(outcome);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tg-card rounded-lg border border-rule p-5" data-testid="request-inspection">
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink-2">
          This listing is a draft. Nothing is on sale until our team has approved it.{' '}
          {unitCount > 0 ? (
            <>
              It declares <span className="font-mono tnum text-ink">{unitCount}</span>{' '}
              {unitCount === 1 ? 'machine' : 'machines'}; serials are recorded by our technician
              at your site once a buyer orders.
            </>
          ) : (
            'Set how many machines it offers before sending it.'
          )}
        </p>
        <div>
          <Button
            variant="primary"
            loading={busy}
            disabledReason={unitCount === 0 ? 'Set the quantity on this listing first.' : undefined}
            onClick={() => void send()}
          >
            Send for approval
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-body-sm text-fail">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** What a successful send says, kept by the record across its reload. */
export function InspectionRequested({ accepted }: { accepted: SubmitAccepted }): React.JSX.Element {
  return (
    <p role="status" className="rounded border border-rule bg-sheet-2 p-4 text-body text-ink">
      Sent for approval. <span className="font-mono tnum">{accepted.unitCount}</span>{' '}
      {accepted.unitCount === 1 ? 'machine' : 'machines'} declared. Our team reviews the listing and
      puts it on the storefront; nothing is inspected until a buyer orders.
    </p>
  );
}
