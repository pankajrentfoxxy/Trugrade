import * as React from 'react';
import { Button, EmptyState, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../lib/useResource';

/** Mirrors `NearMatch` from the catalog module — one SKU we already carry. */
export interface NearMatch {
  skuId: string;
  skuCode: string;
  label: string;
  /** 0–1. 1.0 means the normalised keys are identical: it IS this SKU. */
  similarity: number;
  exact: boolean;
}

export interface SkuRequestRow {
  id: string;
  vendorName: string;
  rawBrand: string;
  rawModel: string;
  rawConfig: string;
  ageHours: number;
  /** Whatever the wizard captured in fields. Free text alone still submits. */
  proposedSpec: Record<string, string> | null;
  nearMatches: NearMatch[];
}

function SpecTable({ spec }: { spec: Record<string, string> }): React.JSX.Element {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-body-sm">
      {Object.entries(spec).map(([field, value]) => (
        <React.Fragment key={field}>
          <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{field}</dt>
          <dd className="text-ink">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * One candidate, with its score.
 *
 * The score is stated as a number rather than implied by ordering: 0.94 and 0.41
 * both sit at the top of a short list, and only one of them is worth merging
 * into. An exact key match is called out in words because it is not a judgement
 * call — the machine is already in the catalog under another name.
 */
function NearMatchRow({ match }: { match: NearMatch }): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-rule-2 py-3">
      <span className="font-mono text-data tnum text-ink-2">
        {Math.round(match.similarity * 100)}%
      </span>
      <code className="font-mono text-data text-ink-2">{match.skuCode}</code>
      <span className="text-body-sm text-ink">{match.label}</span>
      {match.exact && <StatusPill tone="info" label="Same specification" />}
      <Button variant="secondary" size="sm" className="ml-auto">
        Merge into this
      </Button>
    </li>
  );
}

function RequestCard({ request }: { request: SkuRequestRow }): React.JSX.Element {
  const exact = request.nearMatches.find((m) => m.exact);

  return (
    <article className="mt-5 rounded-lg border border-rule bg-sheet p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-h3 text-ink">
          {request.rawBrand} {request.rawModel}
        </h2>
        <span className="text-body-sm text-ink-3">
          {request.vendorName} · {request.ageHours}h waiting
        </span>
      </header>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
            What the vendor proposed
          </h3>
          <p className="mt-3 text-body-sm text-ink">{request.rawConfig}</p>
          {request.proposedSpec && <SpecTable spec={request.proposedSpec} />}
        </section>

        <section>
          <h3 className="font-mono text-label uppercase tracking-[0.13em] text-ink-2">
            Closest SKUs we already carry
          </h3>
          {request.nearMatches.length === 0 ? (
            <p className="mt-3 text-body-sm text-ink-2">
              Nothing close. This is most likely a genuinely new configuration.
            </p>
          ) : (
            <ul className="mt-1">
              {request.nearMatches.map((match) => (
                <NearMatchRow key={match.skuId} match={match} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          // Approving creates a second SKU for a machine we already carry, and a
          // duplicate in the master catalog splits every listing, price band and
          // image set that follows from it. Merging is the action here.
          disabledReason={
            exact
              ? `${exact.skuCode} already has this exact specification. Merge into it instead — approving would create a duplicate SKU.`
              : ''
          }
        >
          Approve and create the SKU
        </Button>
        <Button variant="danger">Reject with a reason</Button>
      </div>
    </article>
  );
}

export function SkuRequestsRoute(): React.JSX.Element {
  const { data, error } = useResource<SkuRequestRow[]>(
    '/api/catalog/sku-requests',
    'The request queue is unavailable',
  );

  if (error) {
    return (
      <EmptyState
        title="The SKU request queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={6} />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="No pending requests"
        body="Every vendor request has been decided. A new one appears here the moment a vendor cannot find their machine in the catalog."
      />
    );
  }

  const duplicates = data.filter((r) => r.nearMatches.some((m) => m.exact)).length;

  return (
    <div>
      <h1 className="text-h1 text-ink">SKU requests</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        {data.length} waiting, oldest first
        {duplicates > 0 && ` · ${duplicates} already exist under another name`}.
      </p>

      {data.map((request) => (
        <RequestCard key={request.id} request={request} />
      ))}
    </div>
  );
}
