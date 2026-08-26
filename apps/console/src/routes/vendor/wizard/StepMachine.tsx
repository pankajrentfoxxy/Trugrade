import * as React from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, Input, Skeleton } from '@trugrade/ui';
import { API, type SkuDetail, type SkuHit } from '../api';
import type { WizardDraft } from './draft';

interface SearchResponse {
  hits: SkuHit[];
  total: number;
  matchedBy: 'FILTER' | 'FULL_TEXT' | 'TRIGRAM';
}

/** What the catalog says this machine is. Read-only: the vendor cannot free-text a title. */
function DeclaredSpec({ sku }: { sku: SkuDetail }): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ['Processor', [sku.cpuBrand, sku.cpuFamily, sku.cpuModel, sku.cpuGeneration].filter(Boolean).join(' ')],
    ['Memory', `${sku.ramGb} GB`],
    ['Storage', `${sku.storageGb} GB ${sku.storageType}`],
    ['Graphics', sku.gpuModel ? `${sku.gpuType} · ${sku.gpuModel}` : sku.gpuType],
    ['Screen', `${sku.screenSizeIn}" ${sku.resolution}${sku.isTouch ? ' touch' : ''}`],
    ['Operating system', sku.osLicenceType ? `${sku.osSupported} · ${sku.osLicenceType} licence` : sku.osSupported],
  ];

  return (
    <div className="mt-5 rounded-lg border border-rule bg-sheet p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-h3 text-ink">
          {sku.brandName} {sku.modelName}
        </h3>
        <code className="font-mono text-data tnum text-ink-2">{sku.skuCode}</code>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-body-sm">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="font-mono text-label uppercase tracking-[0.13em] text-ink-3">{label}</dt>
            <dd className="text-ink">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {/* The declaration in step 2 is measured against this specification, and a
          mismatch is a grade correction. Saying so here costs one sentence. */}
      <p className="mt-4 text-body-sm text-ink-2">
        This is what we will inspect against. If any of it is wrong for the machines you are
        listing, this is the wrong SKU — go back and search again.
      </p>
    </div>
  );
}

export function StepMachine({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (p: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [result, setResult] = React.useState<SearchResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);

  // Debounced, because this runs against a full-text index on every keystroke
  // and the vendor types a model name faster than a round trip completes.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(API.catalogSearch(q), { credentials: 'include' });
          if (!res.ok) throw new Error(`Catalog search unavailable (${res.status})`);
          const data = (await res.json()) as SearchResponse;
          if (!cancelled) {
            setResult(data);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function pick(hit: SkuHit): Promise<void> {
    try {
      const res = await fetch(API.sku(hit.skuId), { credentials: 'include' });
      if (!res.ok) throw new Error(`Could not open ${hit.skuCode} (${res.status})`);
      patch({ sku: (await res.json()) as SkuDetail });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 className="text-h2 text-ink">Pick the machine</h2>
      <p className="mt-2 max-w-prose text-body-sm text-ink-2">
        Search the master catalog by model or configuration. Every listing is against a SKU we
        already carry — that is what lets a buyer compare your machine with anyone else&rsquo;s.
      </p>

      <div className="mt-6 max-w-md">
        <Input
          label="Search the catalog"
          placeholder="Latitude 5420, or ThinkPad 16GB 512"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <p className="mt-4 text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      {searching && !result && (
        <div className="mt-5">
          <Skeleton lines={4} />
        </div>
      )}

      {result && result.matchedBy === 'TRIGRAM' && (
        <p className="mt-5 text-body-sm text-ink-2">
          Nothing matched exactly, so these are the closest spellings we hold.
        </p>
      )}

      {result && result.hits.length === 0 && (
        <div className="mt-5">
          <EmptyState
            title="No SKU matches this configuration"
            body="This is either a machine we have not catalogued yet or a search worth rephrasing. Requesting a SKU keeps everything you have entered so far — you will come straight back here."
            action={
              // The handoff PHASE_03 Task 3 step 1 requires. The draft is already
              // in sessionStorage, so "without losing wizard state" costs a link
              // rather than a query string carrying twenty fields.
              <Link
                className="text-acc-ink underline underline-offset-4"
                to={`/vendor/sku-request?brand=${encodeURIComponent(query.trim())}`}
              >
                Request this SKU
              </Link>
            }
          />
        </div>
      )}

      {result && result.hits.length > 0 && (
        <ul className="mt-5">
          {result.hits.map((hit) => (
            <li
              key={hit.skuId}
              className="flex flex-wrap items-center gap-3 border-b border-rule-2 py-3"
            >
              <code className="font-mono text-data tnum text-ink-2">{hit.skuCode}</code>
              <span className="text-body-sm text-ink">
                {hit.brandName} {hit.modelName}
              </span>
              <span className="text-body-sm text-ink-3">
                {hit.cpuFamily} · {hit.ramGb} GB · {hit.storageGb} GB · {hit.screenSizeIn}&quot;
              </span>
              <Button
                variant={draft.sku?.skuId === hit.skuId ? 'primary' : 'secondary'}
                size="sm"
                className="ml-auto"
                onClick={() => void pick(hit)}
              >
                {draft.sku?.skuId === hit.skuId ? 'Selected' : 'Select'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {draft.sku && <DeclaredSpec sku={draft.sku} />}
    </div>
  );
}
