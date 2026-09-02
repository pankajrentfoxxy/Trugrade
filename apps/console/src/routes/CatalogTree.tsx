import * as React from 'react';
import { Link } from 'react-router';
import { EmptyState, Input, Skeleton, StatusPill } from '@trugrade/ui';
import { PageHeader } from '../lib/controls';
import { useResource } from '../lib/useResource';
import { useUrlState } from '../lib/urlState';

/**
 * ARCHETYPE B — Board. The filter is the rail; the tree is the table.
 * DENSITY: compact (admin), set on the app root by the shell.
 */

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
      {/* The code is the link, not a separate "view" action: it is the
          identifier somebody is already reading, and fifty rows x one amber
          link is fifty amber controls on a screen entitled to one. */}
      <Link
        to={`/catalog/skus/${sku.id}`}
        className="font-mono text-data tnum text-ink-2 underline underline-offset-4 hover:text-ink"
      >
        {sku.skuCode}
      </Link>
      <span className="text-body-sm text-ink">{sku.label}</span>
      {/* Deprecated is a state, not a verdict: neutral, never red. */}
      {!sku.isActive && <StatusPill tone="neutral" label="Deprecated" />}
      {sku.liveListingCount > 0 && (
        <span className="ml-auto text-body-sm text-ink-3">
          {sku.liveListingCount} live {sku.liveListingCount === 1 ? 'listing' : 'listings'}
        </span>
      )}
    </li>
  );
}

export function CatalogTreeRoute(): React.JSX.Element {
  const { data, error } = useResource<CatalogBrand[]>('/api/catalog/tree', 'Catalog unavailable');
  // In the URL: "the Latitude corner of the catalog" has to be a link someone
  // can paste, and the filter is the only state this board carries.
  const [query, setQuery] = useUrlState('q');

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
        body={
          <>
            {/* There is no brand-create route and no brand-create endpoint. The
                importer is what writes `catalog.brand`, `series` and `model`, on
                the way to a SKU — so the empty state points at the thing that
                exists rather than at a screen somebody would have to build to
                make this sentence true. */}
            <span className="block">
              A vendor cannot list anything until a SKU exists to list it against, and there is no
              standalone &ldquo;add a brand&rdquo; step: brands, series and models are created by
              the SKU importer on the way to the configurations underneath them.
            </span>
            <span className="mt-3 block">
              Post a CSV to <span className="font-mono">/api/catalog/skus/import</span> — the same
              validation a SKU request approval runs, so both paths produce the same normalised key
              — or approve the first vendor request when one arrives.
            </span>
          </>
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
    <div className="tg-stack">
      <PageHeader title="Catalog">
        Brand, series, model, configuration. A vendor lists against a SKU and QC verifies against
        its declared specification, which is why the last two levels stay separate.
      </PageHeader>

      <div className="max-w-md">
        <Input
          label="Filter"
          placeholder="Brand, model or SKU code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {brands.length === 0 ? (
        <EmptyState
          title={`Nothing matches “${query.trim()}”`}
          body="The catalog is not empty — this filter is. Clear it to see everything, or ask ops whether the machine needs a SKU request."
        />
      ) : (
        <>
          <p className="text-body-sm text-ink-3">
            {skuCount} {skuCount === 1 ? 'SKU' : 'SKUs'} across {brands.length}{' '}
            {brands.length === 1 ? 'brand' : 'brands'}
          </p>
          <div>
            {brands.map((brand) => (
              // <details> rather than a controlled accordion: the browser already
              // handles the keyboard, the ARIA and the open state, and a filter
              // that re-mounts the tree gets the open-by-default behaviour free.
              <details key={brand.id} open className="border-b border-rule">
                <summary className="cursor-pointer py-3 text-h3 text-ink">{brand.name}</summary>
                {brand.series.map((series) => (
                  <details key={series.id} open className="pl-4">
                    <summary className="cursor-pointer py-2 text-body-sm text-ink-2">
                      {series.name}
                    </summary>
                    {series.models.map((model) => (
                      <div key={model.id} className="pb-3 pl-4">
                        <h4 className="pt-2 font-mono text-label uppercase tracking-[0.13em] text-ink-2">
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
