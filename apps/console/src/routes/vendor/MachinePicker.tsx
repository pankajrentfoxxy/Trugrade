import * as React from 'react';
import { Skeleton } from '@trugrade/ui';
import { Select } from '../../lib/controls';
import { API, type PickerBrand, type PickerModel, type SkuDetail } from './api';

/**
 * Choosing the machine, one narrowing question at a time.
 *
 * A vendor does not think "DEL-LAT5420-I51135G7-16-512". They think Dell, then
 * Latitude 5420, then the i5, then the generation, then 16 GB, then the 512.
 * Each rung is answered from what the catalog actually carries under the rung
 * above it, so a vendor can never assemble a configuration that does not exist
 * — the free-text SKU search this replaces let them type a machine we do not
 * stock and returned nothing, with no way to tell a typo from a catalog gap.
 *
 * The last rung exists because those six axes do not always identify one SKU:
 * two entries can agree on processor, generation, RAM and storage and differ on
 * screen or graphics. Rather than resolve to whichever row came back first —
 * which lists the vendor's stock against the wrong catalog entry — it asks.
 */

export interface MachinePickerProps {
  /** Seeds the cascade when a draft is reopened. Read once, not controlled. */
  initialSku?: SkuDetail | null;
  /** Fires on every change of resolution; `null` while the cascade is unfinished. */
  onSelect: (sku: SkuDetail | null) => void;
  /** Rendered under the last rung — the "my machine is not listed" escape. */
  footer?: React.ReactNode;
}

interface Choice {
  brandId: string;
  modelId: string;
  processor: string;
  generation: string;
  ram: string;
  storage: string;
  variant: string;
}

const EMPTY: Choice = {
  brandId: '',
  modelId: '',
  processor: '',
  generation: '',
  ram: '',
  storage: '',
  variant: '',
};

/**
 * The cascade, in order. Changing a rung clears every rung below it, because a
 * generation valid for an i5 is usually not valid for the i7 the vendor just
 * switched to, and quietly keeping it resolves a SKU nobody chose.
 */
const RUNGS: readonly (keyof Choice)[] = [
  'brandId',
  'modelId',
  'processor',
  'generation',
  'ram',
  'storage',
  'variant',
];

/** The four spec rungs, in cascade order, as key + label + sort. */
const SPEC_RUNGS = ['processor', 'generation', 'ram', 'storage'] as const;
type SpecRung = (typeof SPEC_RUNGS)[number];

interface Option {
  value: string;
  label: string;
}

function processorKey(sku: SkuDetail): string {
  return [sku.cpuBrand, sku.cpuFamily, sku.cpuModel].join('|');
}

/**
 * "Intel i5-1135G7", not "Intel Core i5 i5-1135G7".
 *
 * `cpu_family` is "Core i5" and `cpu_model` is "i5-1135G7", so joining all three
 * says i5 twice. The family is dropped when the model already opens with it.
 */
function processorLabel(sku: SkuDetail): string {
  const family = sku.cpuFamily.trim();
  const model = sku.cpuModel.trim();
  const tail = family.split(/\s+/).at(-1) ?? '';
  const spec =
    model && tail && model.toLowerCase().startsWith(tail.toLowerCase())
      ? model
      : [family, model].filter(Boolean).join(' ');
  return [sku.cpuBrand, spec].filter(Boolean).join(' ');
}

function storageKey(sku: SkuDetail): string {
  return `${sku.storageGb}|${sku.storageType}`;
}

function storageLabel(sku: SkuDetail): string {
  const size = sku.storageGb >= 1024 ? `${sku.storageGb / 1024} TB` : `${sku.storageGb} GB`;
  return `${size} ${sku.storageType.replace(/_/g, ' ')}`;
}

/**
 * "Latitude 3420", not "Latitude Latitude 3420".
 *
 * Most `model.name` values already carry the series ("Latitude 5420"), but not
 * all do, and a model named only "9310" under "XPS" is unidentifiable on its
 * own. So the series is a prefix only where the name does not already have it.
 */
function modelLabel(model: PickerModel): string {
  const series = model.seriesName.trim();
  const name = model.modelName.trim();
  if (!series || name.toLowerCase().startsWith(series.toLowerCase())) return name;
  return `${series} ${name}`;
}

function variantLabel(sku: SkuDetail): string {
  const screen = `${sku.screenSizeIn}" ${sku.resolution}${sku.isTouch ? ' touch' : ''}`;
  return `${screen} · ${sku.gpuModel ? `${sku.gpuType} ${sku.gpuModel}` : sku.gpuType}`;
}

const KEY_OF: Record<SpecRung, (s: SkuDetail) => string> = {
  processor: processorKey,
  generation: (s) => s.cpuGeneration,
  ram: (s) => String(s.ramGb),
  storage: storageKey,
};

const LABEL_OF: Record<SpecRung, (s: SkuDetail) => string> = {
  processor: processorLabel,
  generation: (s) => s.cpuGeneration,
  ram: (s) => `${s.ramGb} GB`,
  storage: storageLabel,
};

/** Numeric rungs sort by magnitude — "8 GB" before "16 GB", not after it. */
const SORT_OF: Partial<Record<SpecRung, (s: SkuDetail) => number>> = {
  ram: (s) => s.ramGb,
  storage: (s) => s.storageGb,
};

/** The SKUs still possible given every rung ABOVE `rung`. */
function narrow(skus: readonly SkuDetail[], choice: Choice, rung: SpecRung | 'variant'): SkuDetail[] {
  const above = RUNGS.slice(2, RUNGS.indexOf(rung)) as SpecRung[];
  return skus.filter((s) => above.every((a) => !choice[a] || KEY_OF[a](s) === choice[a]));
}

function optionsFor(skus: readonly SkuDetail[], rung: SpecRung): Option[] {
  const sortOf = SORT_OF[rung];
  const seen = new Map<string, { label: string; sort: number }>();
  for (const sku of skus) {
    const key = KEY_OF[rung](sku);
    if (!seen.has(key)) {
      seen.set(key, { label: LABEL_OF[rung](sku), sort: sortOf ? sortOf(sku) : 0 });
    }
  }
  return [...seen.entries()]
    .map(([value, v]) => ({ value, label: v.label, sort: v.sort }))
    .sort((a, b) => (sortOf ? a.sort - b.sort : a.label.localeCompare(b.label)))
    .map(({ value, label }) => ({ value, label }));
}

function variantOptionsFor(skus: readonly SkuDetail[], choice: Choice): Option[] {
  return narrow(skus, choice, 'variant')
    .map((s) => ({ value: s.skuId, label: variantLabel(s) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function choiceFromSku(sku: SkuDetail): Omit<Choice, 'brandId' | 'modelId'> {
  return {
    processor: processorKey(sku),
    generation: sku.cpuGeneration,
    ram: String(sku.ramGb),
    storage: storageKey(sku),
    variant: sku.skuId,
  };
}

/** Clears `field` and every rung below it. */
function clearBelow(choice: Choice, field: keyof Choice, value: string): Choice {
  const next = { ...choice, [field]: value };
  for (const rung of RUNGS.slice(RUNGS.indexOf(field) + 1)) next[rung] = '';
  return next;
}

/**
 * A rung with exactly one answer is not a question.
 *
 * Filling it saves a click and, more usefully, stops a single-configuration
 * model from looking like an unfinished form. Returns `choice` itself when
 * there was nothing to fill, so the caller can compare by identity.
 */
function autoFill(skus: readonly SkuDetail[], choice: Choice): Choice {
  let next = choice;
  for (const rung of SPEC_RUNGS) {
    if (next[rung]) continue;
    const opts = optionsFor(narrow(skus, next, rung), rung);
    if (opts.length !== 1) return next;
    next = { ...next, [rung]: opts[0]!.value };
  }
  if (!next.variant) {
    const opts = variantOptionsFor(skus, next);
    if (opts.length === 1) next = { ...next, variant: opts[0]!.value };
  }
  return next;
}

export function MachinePicker({
  initialSku,
  onSelect,
  footer,
}: MachinePickerProps): React.JSX.Element {
  const [brands, setBrands] = React.useState<PickerBrand[] | null>(null);
  const [models, setModels] = React.useState<PickerModel[] | null>(null);
  const [skus, setSkus] = React.useState<SkuDetail[] | null>(null);
  const [choice, setChoice] = React.useState<Choice>(EMPTY);
  const [error, setError] = React.useState<string | null>(null);

  // Seeded once. `initialSku` is a reopened draft, not a controlled value —
  // re-seeding on each render would fight the vendor for the dropdowns.
  const seed = React.useRef(initialSku ?? null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(API.catalogPickerBrands, { credentials: 'include' });
        if (!res.ok) throw new Error(`Catalog unavailable (${res.status})`);
        const rows = (await res.json()) as PickerBrand[];
        if (cancelled) return;
        setBrands(rows);
        const seeded = seed.current;
        const brand = seeded ? rows.find((b) => b.brandName === seeded.brandName) : undefined;
        if (brand) setChoice((c) => ({ ...c, brandId: brand.brandId }));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!choice.brandId) {
      setModels(null);
      return;
    }
    let cancelled = false;
    setModels(null);
    void (async () => {
      try {
        const res = await fetch(API.catalogPickerModels(choice.brandId), {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Models unavailable (${res.status})`);
        const rows = (await res.json()) as PickerModel[];
        if (cancelled) return;
        setModels(rows);
        setError(null);
        const seededModel = seed.current?.modelId;
        if (seededModel && rows.some((m) => m.modelId === seededModel)) {
          setChoice((c) => ({ ...c, modelId: seededModel }));
        } else if (rows.length === 1) {
          setChoice((c) => ({ ...c, modelId: rows[0]!.modelId }));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [choice.brandId]);

  React.useEffect(() => {
    if (!choice.modelId) {
      setSkus(null);
      return;
    }
    let cancelled = false;
    setSkus(null);
    void (async () => {
      try {
        const res = await fetch(API.catalogModelSkus(choice.modelId), { credentials: 'include' });
        if (!res.ok) throw new Error(`Configurations unavailable (${res.status})`);
        const rows = (await res.json()) as SkuDetail[];
        if (cancelled) return;
        setSkus(rows);
        setError(null);
        const seeded = seed.current;
        if (seeded && rows.some((s) => s.skuId === seeded.skuId)) {
          setChoice((c) => ({ ...c, ...choiceFromSku(seeded) }));
          seed.current = null;
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [choice.modelId]);

  React.useEffect(() => {
    if (!skus) return;
    const filled = autoFill(skus, choice);
    if (filled !== choice) setChoice(filled);
  }, [skus, choice]);

  const pool = skus ?? [];
  const resolved = choice.variant ? (pool.find((s) => s.skuId === choice.variant) ?? null) : null;

  // Reported by id, not by object identity: the parent re-renders on every rung
  // and a fresh row object each time would loop through its own state.
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const reported = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = resolved?.skuId ?? null;
    if (reported.current === id) return;
    reported.current = id;
    onSelectRef.current(resolved);
  }, [resolved]);

  function set(field: keyof Choice, value: string): void {
    seed.current = null;
    setChoice((c) => clearBelow(c, field, value));
  }

  const placeholder = (label: string): Option[] => [{ value: '', label }];

  return (
    <div className="flex flex-col gap-4" data-testid="machine-picker">
      {error && (
        <p className="text-body-sm text-fail" role="alert">
          {error}
        </p>
      )}

      {brands ? (
        <Select
          label="Brand"
          value={choice.brandId}
          onChange={(e) => set('brandId', e.target.value)}
          options={[
            ...placeholder('Choose a brand'),
            ...brands.map((b) => ({ value: b.brandId, label: b.brandName })),
          ]}
        />
      ) : (
        <Skeleton lines={1} />
      )}

      <Select
        label="Model"
        value={choice.modelId}
        disabled={!choice.brandId || !models}
        hint={
          choice.brandId && models?.length === 0
            ? 'We do not carry this brand yet. Request the machine below.'
            : undefined
        }
        onChange={(e) => set('modelId', e.target.value)}
        options={[
          ...placeholder(
            !choice.brandId ? 'Pick a brand first' : !models ? 'Loading…' : 'Choose a model',
          ),
          ...(models ?? []).map((m) => ({ value: m.modelId, label: modelLabel(m) })),
        ]}
      />

      <Select
        label="Processor"
        value={choice.processor}
        disabled={!choice.modelId || !skus}
        onChange={(e) => set('processor', e.target.value)}
        options={[
          ...placeholder(
            !choice.modelId ? 'Pick a model first' : !skus ? 'Loading…' : 'Choose a processor',
          ),
          ...optionsFor(narrow(pool, choice, 'processor'), 'processor'),
        ]}
      />

      <Select
        label="Generation"
        value={choice.generation}
        disabled={!choice.processor}
        onChange={(e) => set('generation', e.target.value)}
        options={[
          ...placeholder(!choice.processor ? 'Pick a processor first' : 'Choose a generation'),
          ...optionsFor(narrow(pool, choice, 'generation'), 'generation'),
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="RAM"
          value={choice.ram}
          disabled={!choice.generation}
          onChange={(e) => set('ram', e.target.value)}
          options={[
            ...placeholder(!choice.generation ? 'Pick a generation first' : 'Choose the memory'),
            ...optionsFor(narrow(pool, choice, 'ram'), 'ram'),
          ]}
        />

        <Select
          label="Hard disk"
          value={choice.storage}
          disabled={!choice.ram}
          onChange={(e) => set('storage', e.target.value)}
          options={[
            ...placeholder(!choice.ram ? 'Pick the memory first' : 'Choose the storage'),
            ...optionsFor(narrow(pool, choice, 'storage'), 'storage'),
          ]}
        />
      </div>

      {choice.storage && variantOptionsFor(pool, choice).length > 1 && (
        <Select
          label="Screen and graphics"
          hint="This configuration comes in more than one screen. Pick the one you hold."
          value={choice.variant}
          onChange={(e) => set('variant', e.target.value)}
          options={[...placeholder('Choose the screen'), ...variantOptionsFor(pool, choice)]}
        />
      )}

      {resolved && (
        <p aria-live="polite" className="text-body-sm text-ink-2" data-testid="machine-picker-resolved">
          {/* The catalog entry the vendor has landed on, named once and
              prominently: everything downstream — commission, inspection,
              the buyer's product page — is computed from this row. */}
          <span className="font-mono font-bold tnum text-pass">{resolved.skuCode}</span>
          {' · '}
          {resolved.brandName} {resolved.modelName} · {processorLabel(resolved)}{' '}
          {resolved.cpuGeneration} · <span className="font-mono tnum">{resolved.ramGb}</span> GB ·{' '}
          {storageLabel(resolved)}
        </p>
      )}

      {footer}
    </div>
  );
}
