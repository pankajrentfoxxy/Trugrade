import * as React from 'react';
import { Link } from 'react-router';
import { Button, Input, Skeleton, cn } from '@trugrade/ui';
import { Select } from '../../../lib/controls';
import { API, type CatalogModelHit, type SkuDetail } from '../api';
import type { WizardDraft } from './draft';

/** Step 1 of ARCHETYPE D — `Wizard.tsx` owns the shape; this is its content. */

interface ModelSearchResponse {
  hits: CatalogModelHit[];
  total: number;
  matchedBy: 'FULL_TEXT' | 'TRIGRAM';
}

interface SpecChoice {
  processor: string;
  memory: string;
  storage: string;
  graphics: string;
  screen: string;
}

const EMPTY_CHOICE: SpecChoice = {
  processor: '',
  memory: '',
  storage: '',
  graphics: '',
  screen: '',
};

function processorKey(sku: SkuDetail): string {
  return [sku.cpuBrand, sku.cpuFamily, sku.cpuModel, sku.cpuGeneration].join('|');
}

function processorLabel(sku: SkuDetail): string {
  return [sku.cpuBrand, sku.cpuFamily, sku.cpuModel, sku.cpuGeneration].filter(Boolean).join(' ');
}

function memoryKey(sku: SkuDetail): string {
  return String(sku.ramGb);
}

function memoryLabel(sku: SkuDetail): string {
  return `${sku.ramGb} GB`;
}

function storageKey(sku: SkuDetail): string {
  return `${sku.storageGb}|${sku.storageType}`;
}

function storageLabel(sku: SkuDetail): string {
  return `${sku.storageGb} GB ${sku.storageType.replace(/_/g, ' ')}`;
}

function graphicsKey(sku: SkuDetail): string {
  return `${sku.gpuType}|${sku.gpuModel ?? ''}`;
}

function graphicsLabel(sku: SkuDetail): string {
  return sku.gpuModel ? `${sku.gpuType} · ${sku.gpuModel}` : sku.gpuType;
}

function screenKey(sku: SkuDetail): string {
  return `${sku.screenSizeIn}|${sku.resolution}|${sku.isTouch ? '1' : '0'}`;
}

function screenLabel(sku: SkuDetail): string {
  return `${sku.screenSizeIn}" ${sku.resolution}${sku.isTouch ? ' touch' : ''}`;
}

function osLabel(sku: SkuDetail): string {
  return sku.osLicenceType ? `${sku.osSupported} · ${sku.osLicenceType} licence` : sku.osSupported;
}

function matches(sku: SkuDetail, choice: SpecChoice, except?: keyof SpecChoice): boolean {
  if (except !== 'processor' && choice.processor && processorKey(sku) !== choice.processor)
    return false;
  if (except !== 'memory' && choice.memory && memoryKey(sku) !== choice.memory) return false;
  if (except !== 'storage' && choice.storage && storageKey(sku) !== choice.storage) return false;
  if (except !== 'graphics' && choice.graphics && graphicsKey(sku) !== choice.graphics)
    return false;
  if (except !== 'screen' && choice.screen && screenKey(sku) !== choice.screen) return false;
  return true;
}

function uniqueOptions(
  skus: readonly SkuDetail[],
  keyOf: (s: SkuDetail) => string,
  labelOf: (s: SkuDetail) => string,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const sku of skus) {
    const key = keyOf(sku);
    if (!seen.has(key)) seen.set(key, labelOf(sku));
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function choiceFromSku(sku: SkuDetail): SpecChoice {
  return {
    processor: processorKey(sku),
    memory: memoryKey(sku),
    storage: storageKey(sku),
    graphics: graphicsKey(sku),
    screen: screenKey(sku),
  };
}

const SPEC_FIELDS: Array<{
  key: keyof SpecChoice;
  of: (s: SkuDetail) => string;
}> = [
  { key: 'processor', of: processorKey },
  { key: 'memory', of: memoryKey },
  { key: 'storage', of: storageKey },
  { key: 'graphics', of: graphicsKey },
  { key: 'screen', of: screenKey },
];

function prune(skus: readonly SkuDetail[], start: SpecChoice): SpecChoice {
  let next = { ...start };
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of SPEC_FIELDS) {
      if (!next[field.key]) continue;
      const pool = skus.filter((s) => matches(s, next, field.key));
      if (!pool.some((s) => field.of(s) === next[field.key])) {
        next = { ...next, [field.key]: '' };
        changed = true;
      }
    }
  }
  return next;
}

function autoFill(skus: readonly SkuDetail[], start: SpecChoice): SpecChoice {
  let next = prune(skus, start);
  for (const field of SPEC_FIELDS) {
    const pool = skus.filter((s) => matches(s, next, field.key));
    const options = uniqueOptions(pool, field.of, field.of);
    if (options.length === 1) next = { ...next, [field.key]: options[0]!.value };
  }
  return next;
}

function resolveSku(skus: readonly SkuDetail[], choice: SpecChoice): SkuDetail | null {
  const left = skus.filter((s) => matches(s, choice));
  return left.length === 1 ? left[0]! : null;
}

export function StepMachine({
  draft,
  patch,
}: {
  draft: WizardDraft;
  patch: (p: Partial<WizardDraft>) => void;
}): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [result, setResult] = React.useState<ModelSearchResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<CatalogModelHit | null>(
    draft.catalogModel,
  );
  const [variants, setVariants] = React.useState<SkuDetail[]>([]);
  const [variantsFor, setVariantsFor] = React.useState<string | null>(null);
  const [loadingVariants, setLoadingVariants] = React.useState(false);
  const [choice, setChoice] = React.useState<SpecChoice>(() =>
    draft.sku ? choiceFromSku(draft.sku) : EMPTY_CHOICE,
  );
  const [resolvedSku, setResolvedSku] = React.useState<SkuDetail | null>(draft.sku);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const model =
    picked ??
    draft.catalogModel ??
    (draft.sku?.modelId
      ? {
          modelId: draft.sku.modelId,
          brandName: draft.sku.brandName,
          modelName: draft.sku.modelName,
        }
      : null);
  const trimmed = query.trim();
  const showPanel = open && trimmed.length >= 2;

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
          const res = await fetch(API.catalogModelSearch(trimmed), { credentials: 'include' });
          if (!res.ok) throw new Error(`Catalog search unavailable (${res.status})`);
          const data = (await res.json()) as ModelSearchResponse;
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

  const applyChoice = React.useCallback(
    (hit: CatalogModelHit, rows: readonly SkuDetail[], start: SpecChoice): void => {
      const filled = autoFill(rows, start);
      const resolved = resolveSku(rows, filled);
      setChoice(resolved ? choiceFromSku(resolved) : filled);
      setResolvedSku(resolved);
      patch({ catalogModel: hit, sku: resolved });
    },
    [patch],
  );

  const loadVariants = React.useCallback(
    async (hit: CatalogModelHit, preferred?: SkuDetail | null): Promise<void> => {
      setPicked(hit);
      setVariantsFor(hit.modelId);
      setLoadingVariants(true);
      try {
        const res = await fetch(API.catalogModelSkus(hit.modelId), { credentials: 'include' });
        if (!res.ok) {
          throw new Error(`Could not open ${hit.brandName} ${hit.modelName} (${res.status})`);
        }
        const rows = (await res.json()) as SkuDetail[];
        setVariants(rows);
        applyChoice(hit, rows, preferred ? choiceFromSku(preferred) : EMPTY_CHOICE);
      } finally {
        setLoadingVariants(false);
      }
    },
    [applyChoice],
  );

  const modelId = model?.modelId ?? null;
  const modelLabel = model ? `${model.brandName} ${model.modelName}` : '';

  React.useEffect(() => {
    if (modelId && modelLabel) setQuery(modelLabel);
  }, [modelId, modelLabel]);

  React.useEffect(() => {
    if (!model || variantsFor === model.modelId) return;
    void loadVariants(model, draft.sku).catch((e: Error) => setError(e.message));
  }, [model, variantsFor, draft.sku, loadVariants]);

  async function pick(hit: CatalogModelHit): Promise<void> {
    try {
      await loadVariants(hit);
      setQuery(`${hit.brandName} ${hit.modelName}`);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
      setOpen(true);
    }
  }

  function changeSpec(field: keyof SpecChoice, value: string): void {
    if (!model) return;
    applyChoice(model, variants, { ...choice, [field]: value });
  }

  const pool = (except: keyof SpecChoice): SkuDetail[] =>
    variants.filter((s) => matches(s, choice, except));

  const processorOptions = uniqueOptions(pool('processor'), processorKey, processorLabel);
  const memoryOptions = uniqueOptions(pool('memory'), memoryKey, memoryLabel);
  const storageOptions = uniqueOptions(pool('storage'), storageKey, storageLabel);
  const graphicsOptions = uniqueOptions(pool('graphics'), graphicsKey, graphicsLabel);
  const screenOptions = uniqueOptions(pool('screen'), screenKey, screenLabel);
  const osSku = draft.sku ?? variants.find((s) => matches(s, choice)) ?? variants[0] ?? null;

  return (
    <div>
      <div ref={boxRef} className="relative max-w-xl">
        <Input
          label="Search the catalog"
          placeholder="Dell Latitude 3420"
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
                <p className="font-medium text-ink">No model matches this search</p>
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
                {result.hits.map((hit) => {
                  const selected = model?.modelId === hit.modelId;
                  return (
                    <li
                      key={hit.modelId}
                      role="option"
                      aria-selected={selected}
                      className={cn(
                        'flex flex-wrap items-center gap-3 border-b border-l-2 border-rule-2 px-4 py-3 last:border-b-0',
                        selected ? 'border-l-acc bg-sheet-2' : 'border-l-transparent',
                      )}
                    >
                      <span className="text-body-sm text-ink">
                        {hit.brandName} {hit.modelName}
                      </span>
                      {selected ? (
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
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {model && (
        <div className="tg-card mt-5 rounded-lg border border-rule bg-sheet">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h3 className="text-h3 text-ink">
              {model.brandName} {model.modelName}
            </h3>
            {resolvedSku ? (
              <p
                aria-live="polite"
                className="font-mono text-h3 font-bold tnum text-pass"
              >
                {resolvedSku.skuCode}
              </p>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {loadingVariants && variants.length === 0 ? (
              <div className="md:col-span-3">
                <Skeleton lines={3} />
              </div>
            ) : (
              <>
                <Select
                  className="min-w-0"
                  label="Processor"
                  required
                  value={choice.processor}
                  options={[{ value: '', label: 'Select processor' }, ...processorOptions]}
                  onChange={(e) => changeSpec('processor', e.target.value)}
                />
                <Select
                  className="min-w-0"
                  label="Memory"
                  required
                  value={choice.memory}
                  options={[{ value: '', label: 'Select memory' }, ...memoryOptions]}
                  onChange={(e) => changeSpec('memory', e.target.value)}
                />
                <Select
                  className="min-w-0"
                  label="Storage"
                  required
                  value={choice.storage}
                  options={[{ value: '', label: 'Select storage' }, ...storageOptions]}
                  onChange={(e) => changeSpec('storage', e.target.value)}
                />
                <Select
                  className="min-w-0"
                  label="Graphics"
                  required
                  value={choice.graphics}
                  options={[{ value: '', label: 'Select graphics' }, ...graphicsOptions]}
                  onChange={(e) => changeSpec('graphics', e.target.value)}
                />
                <Select
                  className="min-w-0"
                  label="Screen"
                  required
                  value={choice.screen}
                  options={[{ value: '', label: 'Select screen' }, ...screenOptions]}
                  onChange={(e) => changeSpec('screen', e.target.value)}
                />
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-body-sm font-medium text-ink-2">Operating system</p>
                  <p
                    className={cn(
                      'flex h-11 items-center text-body-sm',
                      osSku ? 'text-ink' : 'text-ink-4',
                    )}
                  >
                    {osSku ? osLabel(osSku) : 'Not measured'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
