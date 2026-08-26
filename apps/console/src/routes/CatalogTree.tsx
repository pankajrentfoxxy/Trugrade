import * as React from 'react';
import { EmptyState, Input, Skeleton, StatusPill } from '@trugrade/ui';
import { useResource } from '../lib/useResource';

export interface CatalogSku {
  id: string;
  /** Generated and immutable — shown in mono so it reads as an identifier, not a name. */
  skuCode: string;
  label: string;
  isActive: boolean;
  /** Deprecating a SKU with live listings is blocked, so the count is the reason. */
  liveListingCount: number;
}

export interface CatalogModel {
  id: string;
  name: string;
  skus: CatalogSku[];
}

export interface CatalogSeries {
  id: string;
  name: string;
  models: CatalogModel[];
}

export interface CatalogBrand {
  id: string;
  name: string;
  series: CatalogSeries[];
}

/**
 * Filter on the whole path rather than each level.
 *
 * Typing a model name has to keep its SKUs, and typing a brand has to keep
 * everything under it. Matching the joined path gives both without four nested
 * passes, and it is why searching "latitude 5420" and "dell 512" both work.
 */
function filterBrands(brands: CatalogBrand[], query: string): CatalogBrand[] {
  const q = query.trim().toLowerCase();
  if (!q) return brands;
  const keep = (...parts: string[]): boolean => parts.join(' ').toLowerCase().includes(q);

  return brands
    .map((b) => ({
      ...b,
      series: b.series
        .map((se) => ({
          ...se,
          models: se.models
            .map((m) => ({
              ...m,
              skus: m.skus.filter((s) => keep(b.name, se.name, m.name, s.skuCode, s.label)),
            }))
            .filter((m) => m.skus.length > 0),
        }))
        .filter((se) => se.models.length > 0),
    }))
    .filter((b) => b.series.length > 0);
}

function SkuRow({ sku }: { sku: CatalogSku }): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-rule-2 py-2 pl-5">
      <code className="font-mono text-data tnum text-ink-2">{sku.skuCode}</code>
      <span className="text-body-sm text-ink">{sku.label}</span>
      {!sku.isActive && <StatusPill tone="neutral" label="Deprecated" />}
      {sku.liveListingCount > 0 && (
        <span className="text-body-sm text-ink-3">
          {sku.liveListingCount} live {sku.liveListingCount === 1 ? 'listing' : 'listings'}
        </span>
      )}
    </li>
  );
}

export function CatalogTreeRoute(): React.JSX.Element {
  const { data, error } = useResource<CatalogBrand[]>('/api/catalog/tree', 'Catalog unavailable');
  const [query, setQuery] = React.useState('');

  const brands = React.useMemo(() => filterBrands(data ?? [], query), [data, query]);

  if (error) {
    return (
      <EmptyState
        title="The catalog did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }
  if (!data) return <Skeleton lines={8} />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="The catalog is empty"
        body="Start with a brand, then a series under it, then the models and their configurations. A vendor cannot list anything until a SKU exists to list it against."
        action={
          <a className="text-acc-hi underline underline-offset-4" href="/catalog/brands/new">
            Add the first brand
          </a>
        }
      />
    );
  }

  const skuCount = brands.reduce(
    (n, b) =>
      n + b.series.reduce((m, se) => m + se.models.reduce((k, x) => k + x.skus.length, 0), 0),
    0,
  );

  return (
    <div>
      <h1 className="text-h1 text-ink">Catalog</h1>
      <p className="mt-2 text-body-sm text-ink-2">
        Brand, series, model, configuration. A vendor lists against a SKU and QC verifies against
        its declared specification, which is why the last two levels stay separate.
      </p>

      <div className="mt-6 max-w-md">
        <Input
          label="Filter"
          placeholder="Brand, model or SKU code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {brands.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={`Nothing matches “${query.trim()}”`}
            body="The catalog is not empty — this filter is. Clear it to see everything, or ask ops whether the machine needs a SKU request."
          />
        </div>
      ) : (
        <>
          <p className="mt-5 text-body-sm text-ink-3">
            {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'} across {brands.length}{' '}
            {brands.length === 1 ? 'brand' : 'brands'}
          </p>
          <div className="mt-3">
            {brands.map((brand) => (
              // <details> rather than a controlled accordion: the browser already
              // handles the keyboard, the ARIA and the open state, and a filter
              // that re-mounts the tree gets the open-by-default behaviour free.
              <details key={brand.id} open className="border-b border-rule">
                <summary className="cursor-pointer py-3 text-h3 text-ink">{brand.name}</summary>
                {brand.series.map((series) => (
                  <details key={series.id} open className="pl-4">
                    <summary className="cursor-pointer py-2 text-body text-ink-2">
                      {series.name}
                    </summary>
                    {series.models.map((model) => (
                      <div key={model.id} className="pl-4 pb-3">
                        <h4 className="py-2 font-mono text-label uppercase tracking-[0.13em] text-ink-2">
                          {model.name}
                        </h4>
                        <ul>
                          {model.skus.map((sku) => (
                            <SkuRow key={sku.id} sku={sku} />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </details>
                ))}
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
