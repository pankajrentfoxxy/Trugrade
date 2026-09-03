import * as React from 'react';
import { Link } from 'react-router';
import { Button, Input, Skeleton, cn } from '@trugrade/ui';
import { API, type SkuDetail, type SkuHit } from '../api';
import type { WizardDraft } from './draft';

/** Step 1 of ARCHETYPE D — `Wizard.tsx` owns the shape; this is its content. */

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
    <div className="tg-card mt-5 rounded-lg border border-rule bg-sheet">
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
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const showPanel = open && trimmed.length >= 2;

  // Debounced, because this runs against a full-text index on every keystroke
  // and the vendor types a model name faster than a round trip completes.
  React.useEffect(() => {
    if (trimmed.length < 2) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(API.catalogSearch(trimmed), { credentials: 'include' });
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
  }, [trimmed]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  async function pick(hit: SkuHit): Promise<void> {
    try {
      const res = await fetch(API.sku(hit.skuId), { credentials: 'include' });
      if (!res.ok) throw new Error(`Could not open ${hit.skuCode} (${res.status})`);
      patch({ sku: (await res.json()) as SkuDetail });
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
      setOpen(true);
    }
  }

  return (
    <div>
      <div ref={boxRef} className="relative max-w-xl">
        <Input
          label="Search the catalog"
          placeholder="Latitude 5420, or ThinkPad 16GB 512"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (trimmed.length >= 2) setOpen(true);
          }}
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="catalog-suggest"
        />

        {showPanel && (
          <div
            id="catalog-suggest"
            role="listbox"
            aria-label="Catalog matches"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[min(24rem,50vh)] overflow-y-auto rounded-lg border border-rule bg-sheet shadow-3"
          >
            {searching && !result && (
              <div className="p-4">
                <Skeleton lines={4} />
              </div>
            )}

            {error && (
              <p className="p-4 text-body-sm text-fail" role="alert">
                {error}
              </p>
            )}

            {result && result.matchedBy === 'TRIGRAM' && (
              <p className="border-b border-rule-2 px-4 py-3 text-body-sm text-ink-2">
                Nothing matched exactly, so these are the closest spellings we hold.
              </p>
            )}

            {result && result.hits.length === 0 && !searching && (
              <div className="p-4 text-body-sm text-ink-2">
                <p className="font-medium text-ink">No SKU matches this configuration</p>
                <p className="mt-1">
                  This is either a machine we have not catalogued yet or a search worth rephrasing.
                  Requesting a SKU keeps everything you have entered so far — you will come straight
                  back here.
                </p>
                <Link
                  className="mt-3 inline-block text-acc-ink underline underline-offset-4"
                  to={`/vendor/sku-request?brand=${encodeURIComponent(trimmed)}`}
                  onClick={() => setOpen(false)}
                >
                  Request this SKU
                </Link>
              </div>
            )}

            {result && result.hits.length > 0 && (
              <ul>
                {result.hits.map((hit) => (
                  <li
                    key={hit.skuId}
                    role="option"
                    aria-selected={draft.sku?.skuId === hit.skuId}
                    className={cn(
                      'flex flex-wrap items-center gap-3 border-b border-l-2 border-rule-2 px-4 py-3 last:border-b-0',
                      draft.sku?.skuId === hit.skuId ? 'border-l-acc bg-sheet-2' : 'border-l-transparent',
                    )}
                  >
                    <code className="font-mono text-data tnum text-ink-2">{hit.skuCode}</code>
                    <span className="text-body-sm text-ink">
                      {hit.brandName} {hit.modelName}
                    </span>
                    <span className="text-body-sm text-ink-3">
                      {hit.cpuFamily} · {hit.ramGb} GB · {hit.storageGb} GB · {hit.screenSizeIn}&quot;
                    </span>
                    {draft.sku?.skuId === hit.skuId ? (
                      <span className="ml-auto font-mono text-label uppercase tracking-[0.13em] text-acc-ink">
                        Selected
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="ml-auto"
                        onClick={() => void pick(hit)}
                      >
                        Select
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {draft.sku && <DeclaredSpec sku={draft.sku} />}
    </div>
  );
}
