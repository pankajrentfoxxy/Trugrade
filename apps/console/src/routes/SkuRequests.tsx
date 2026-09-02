import * as React from 'react';
import { SKU_IMPORT_COLUMNS, type SkuImportColumn } from '@trugrade/contracts';
import { Button, EmptyState, Skeleton, StatusPill, Input } from '@trugrade/ui';
import { PageHeader, Textarea } from '../lib/controls';
import { useResource } from '../lib/useResource';

/**
 * ARCHETYPE B — Board. A worklist of records, each with its own row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 */

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

/** What `POST /api/catalog/sku-requests/:id/decision` accepts and answers. */
type Decision =
  | { decision: 'APPROVE'; spec: Record<string, string> }
  | { decision: 'MAP'; skuId: string }
  | { decision: 'REJECT'; reason: string };

interface DecisionResult {
  status: 'RESOLVED_NEW' | 'RESOLVED_MAPPED' | 'REJECTED';
  skuId: string | null;
}

/**
 * Post a decision, and surface the message the API wrote for the person reading
 * it rather than a status code.
 *
 * Not `postJson` from the vendor helpers: that one reads `message` off the top
 * level of the body, and the domain filter nests it under `error` — so every
 * refusal it reports comes out as "that did not go through (422)" and the
 * sentence explaining what to fix is thrown away. Fixing the shared helper is
 * the better change; it is another lane's file, so this screen reads the real
 * envelope and the helper is flagged rather than quietly forked everywhere.
 */
async function postDecision(requestId: string, body: Decision): Promise<DecisionResult> {
  const res = await fetch(`/api/catalog/sku-requests/${requestId}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as
    | { error?: { message?: string } }
    | DecisionResult
    | null;
  if (!res.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `That decision did not go through (${res.status}).`);
  }
  return payload as DecisionResult;
}

/**
 * The reviewer types the specification; nothing parses it out of the vendor's
 * free text.
 *
 * These are the CSV importer's own column names, and the server hands them
 * straight to the same `validateRow` a bulk import runs. That is what makes the
 * two paths produce the identical normalised key — the field whose entire job is
 * to be computed the same way everywhere — so the labels are derived from the
 * constant rather than written out again here.
 */
const FIELD_LABEL: Record<SkuImportColumn, string> = {
  brand: 'Brand',
  series: 'Series',
  model: 'Model',
  cpu_brand: 'CPU brand',
  cpu_family: 'CPU family',
  cpu_model: 'CPU model',
  cpu_generation: 'CPU generation',
  ram_gb: 'RAM (GB)',
  storage_gb: 'Storage (GB)',
  storage_type: 'Storage type',
  gpu_type: 'GPU type',
  gpu_model: 'GPU model',
  screen_size_in: 'Screen size (in)',
  resolution: 'Resolution',
  is_touch: 'Touch',
  os: 'Operating system',
  hsn_code: 'HSN code',
  sku_code: 'SKU code (optional)',
};

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
function NearMatchRow({
  match,
  onMerge,
  busy,
}: {
  match: NearMatch;
  onMerge: () => void;
  busy: boolean;
}): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-rule-2 py-3">
      {/* A similarity is a measured value, so it is amber and it carries its
          scale. A bare "94%" reads as a proportion of something it is not. */}
      <span className="font-mono text-data tnum text-acc-ink">
        {Math.round(match.similarity * 100)}%
      </span>
      <span className="font-mono text-label uppercase tracking-[0.13em] text-ink-4">
        match
      </span>
      <code className="font-mono text-data text-ink-2">{match.skuCode}</code>
      <span className="text-body-sm text-ink">{match.label}</span>
      {match.exact && <StatusPill tone="info" label="Same specification" />}
      <Button variant="secondary" size="sm" className="ml-auto" loading={busy} onClick={onMerge}>
        Merge into this
      </Button>
    </li>
  );
}

function RequestCard({
  request,
  onDecided,
}: {
  request: SkuRequestRow;
  onDecided: (id: string, message: string) => void;
}): React.JSX.Element {
  const exact = request.nearMatches.find((m) => m.exact);
  const [panel, setPanel] = React.useState<'none' | 'approve' | 'reject'>('none');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState('');
  // Prefilled with what the vendor said, because they are usually right about
  // the brand and the model and wrong only about the shape we need it in.
  const [spec, setSpec] = React.useState<Record<string, string>>({
    brand: request.rawBrand,
    model: request.rawModel,
  });

  async function decide(body: Decision, done: (r: DecisionResult) => string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onDecided(request.id, done(await postDecision(request.id, body)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="tg-card mt-5 rounded-lg border border-rule bg-sheet">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-h3 text-ink">
          {request.rawBrand} {request.rawModel}
        </h2>
        <span className="text-body-sm text-ink-3">
          {request.vendorName} · <span className="font-mono tnum">{request.ageHours}h</span> waiting
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
                <NearMatchRow
                  key={match.skuId}
                  match={match}
                  busy={busy}
                  onMerge={() =>
                    void decide(
                      { decision: 'MAP', skuId: match.skuId },
                      () => `Mapped onto ${match.skuCode}. The vendor can list against it now.`,
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          // Secondary, not primary: this button only opens the specification
          // panel. The screen's one amber control is the button inside it that
          // actually writes the SKU — nine cards each carrying a primary is nine
          // primaries on one screen.
          variant="secondary"
          // Approving creates a second SKU for a machine we already carry, and a
          // duplicate in the master catalog splits every listing, price band and
          // image set that follows from it. Merging is the action here.
          disabledReason={
            exact
              ? `${exact.skuCode} already has this exact specification. Merge into it instead — approving would create a duplicate SKU.`
              : ''
          }
          onClick={() => setPanel(panel === 'approve' ? 'none' : 'approve')}
        >
          Approve and create the SKU
        </Button>
        <Button variant="ghost" onClick={() => setPanel(panel === 'reject' ? 'none' : 'reject')}>
          Reject with a reason
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-body-sm text-fail">
          {error}
        </p>
      )}

      {panel === 'approve' && (
        <form
          className="mt-5 border-t border-rule pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void decide({ decision: 'APPROVE', spec }, (r) =>
              r.status === 'RESOLVED_MAPPED'
                ? 'That specification already existed, so the request was mapped onto the SKU we carry rather than duplicating it.'
                : 'SKU created. The vendor can list against it now.',
            );
          }}
        >
          <p className="max-w-prose text-body-sm text-ink-2">
            Type the specification as the catalog will hold it. It is validated by the same rules as
            a CSV import, so &ldquo;NVMe&rdquo; and &ldquo;1920x1080&rdquo; are understood; leave
            the SKU code blank to have one generated.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SKU_IMPORT_COLUMNS.map((column) => (
              <Input
                key={column}
                label={FIELD_LABEL[column]}
                value={spec[column] ?? ''}
                onChange={(e) => setSpec((s) => ({ ...s, [column]: e.target.value }))}
              />
            ))}
          </div>
          <Button type="submit" variant="primary" className="mt-4" loading={busy}>
            Create the SKU
          </Button>
        </form>
      )}

      {panel === 'reject' && (
        <form
          className="mt-5 border-t border-rule pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void decide(
              { decision: 'REJECT', reason },
              () => 'Rejected. The vendor has been given the reason.',
            );
          }}
        >
          <Textarea
            id={`why-${request.id}`}
            label="Why this is not going into the catalog"
            hint="The vendor reads this and it is the only thing they can act on, so name the machine and say what would change the answer."
            rows={3}
            minLength={10}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="submit" variant="danger" className="mt-3" loading={busy}>
            Reject this request
          </Button>
        </form>
      )}
    </article>
  );
}

export function SkuRequestsRoute(): React.JSX.Element {
  const { data, error } = useResource<SkuRequestRow[]>(
    '/api/catalog/sku-requests',
    'The request queue is unavailable',
  );
  // A decided request is removed from the list here rather than by refetching.
  // The server has already committed it, the queue is a worklist rather than a
  // live view, and a refetch would reorder the cards under the reviewer's cursor
  // in the middle of working through them.
  const [decided, setDecided] = React.useState<Record<string, string>>({});

  if (error) {
    return (
      <EmptyState
        title="The SKU request queue did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={6} />;

  const pending = data.filter((r) => !(r.id in decided));

  if (data.length === 0) {
    return (
      <div className="tg-stack">
        <PageHeader title="SKU requests">
          A vendor asking us to carry a machine the catalog does not have.
        </PageHeader>
        {/*
          The queue is genuinely empty and has been since the table was created,
          so this cannot say "everything has been decided" — nothing has been
          submitted. What an operator opening an empty worklist needs is what
          would put a row in it, and the answer is a specific place in a specific
          screen, not a definition.
        */}
        <EmptyState
          title="Nothing is waiting"
          body={
            <>
              {/* `EmptyState.body` renders inside a <p>, so these are blocks
                  rather than paragraphs — a <p> in a <p> is closed by the
                  parser and the rest of the copy escapes the container. */}
              <span className="block">
                A vendor listing stock starts by searching the catalog for their machine. When the
                search returns nothing that matches, step 1 of the listing wizard offers{' '}
                <strong>&ldquo;Request this machine&rdquo;</strong>, and what they type there —
                brand, model, and the configuration in their own words — arrives here.
              </span>
              <span className="mt-3 block">
                Each request arrives with the SKUs we already carry that are closest to it, scored,
                because most requests are a machine we have under a different name. Three answers:{' '}
                <strong>merge</strong> into the SKU we carry, <strong>approve</strong> to create a
                new one, or <strong>reject</strong> with a reason the vendor reads. Approving or
                merging unblocks their draft listing immediately.
              </span>
              <span className="mt-3 block text-ink-3">
                An empty queue means no vendor has hit a machine we do not carry — not that requests
                are being handled elsewhere. Nothing else writes to this table.
              </span>
            </>
          }
        />
      </div>
    );
  }

  const duplicates = pending.filter((r) => r.nearMatches.some((m) => m.exact)).length;

  return (
    <div>
      <PageHeader title="SKU requests">
        {pending.length} waiting, oldest first
        {duplicates > 0 && ` · ${duplicates} already exist under another name`}.
      </PageHeader>

      {Object.entries(decided).map(([id, message]) => (
        <p
          key={id}
          role="status"
          className="mt-4 rounded border border-pass bg-sheet-2 p-3 text-body-sm text-ink"
        >
          {message}
        </p>
      ))}

      {pending.length === 0 ? (
        <EmptyState
          title="Queue cleared"
          body="Everything that was waiting has been decided. Reload to pick up anything that has come in since."
        />
      ) : (
        pending.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            onDecided={(id, message) => setDecided((d) => ({ ...d, [id]: message }))}
          />
        ))
      )}
    </div>
  );
}
