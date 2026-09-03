import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataBoard, EmptyState, Input, Pagination, Skeleton, StatusPill, type Column } from '@trugrade/ui';
import { Board, PageHeader } from '../lib/controls';
import { useResource } from '../lib/useResource';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Pagination and search live in the URL and on the server. The nested tree
 * endpoint remains for callers that need the whole hierarchy; this board reads
 * `/api/catalog/board` one page at a time.
 */

export interface CatalogSku {
  id: string;
  skuCode: string;
  label: string;
  isActive: boolean;
  liveListingCount: number;
}

/** Kept for tests and any caller that still types the tree shape. */
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

interface CatalogBrandOption {
  id: string;
  name: string;
  skuCount: number;
}

interface CatalogRow {
  brandId: string;
  brandName: string;
  seriesName: string;
  modelName: string;
  sku: CatalogSku;
}

interface CatalogPage {
  rows: CatalogRow[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 25;

export function CatalogTreeRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const brandId = params.get('brand') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const boardQuery = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (query.trim()) boardQuery.set('q', query.trim());
  if (brandId) boardQuery.set('brandId', brandId);

  const {
    data: brands,
    error: brandsError,
  } = useResource<CatalogBrandOption[]>('/api/catalog/brands', 'Catalog brands unavailable');

  const { data: board, error: boardError } = useResource<CatalogPage>(
    `/api/catalog/board?${boardQuery.toString()}`,
    'Catalog unavailable',
  );

  const error = brandsError ?? boardError;

  function patchParams(mutate: (next: URLSearchParams) => void): void {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      { replace: true },
    );
  }

  function setFilter(key: string, value: string): void {
    patchParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
    });
  }

  function setSearch(value: string): void {
    patchParams((next) => {
      if (value === '') next.delete('q');
      else next.set('q', value);
      next.delete('page');
    });
  }

  function pickBrand(id: string): void {
    patchParams((next) => {
      if (id) next.set('brand', id);
      else next.delete('brand');
      next.delete('page');
    });
  }

  const columns = React.useMemo<ReadonlyArray<Column<CatalogRow>>>(
    () => [
      {
        key: 'path',
        header: 'Machine',
        cell: (r) => (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-sm font-medium text-ink">{r.modelName}</span>
            <span className="text-body-sm text-ink-3">{`${r.brandName} · ${r.seriesName}`}</span>
          </span>
        ),
      },
      {
        key: 'skuCode',
        header: 'SKU',
        cell: (r) => (
          <Link
            to={`/catalog/skus/${r.sku.id}`}
            className="font-mono text-data tnum text-ink underline underline-offset-4 hover:text-acc-ink"
          >
            {r.sku.skuCode}
          </Link>
        ),
      },
      {
        key: 'label',
        header: 'Configuration',
        cell: (r) => <span className="text-body-sm text-ink-2">{r.sku.label}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (r) =>
          r.sku.isActive ? (
            <StatusPill tone="neutral" label="Active" />
          ) : (
            <StatusPill tone="neutral" label="Deprecated" />
          ),
      },
      {
        key: 'listings',
        header: 'Live listings',
        numeric: true,
        cell: (r) =>
          r.sku.liveListingCount > 0 ? (
            <span className="font-mono tnum text-ink-2">
              {`${r.sku.liveListingCount} live ${r.sku.liveListingCount === 1 ? 'listing' : 'listings'}`}
            </span>
          ) : (
            <span className="text-ink-4">None</span>
          ),
      },
    ],
    [],
  );

  if (error) {
    return (
      <EmptyState
        title="The catalog did not load"
        body={`${error}. Nothing has been changed — reload to try again.`}
      />
    );
  }

  if (!brands) {
    return (
      <div className="tg-stack catalog-board">
        <PageHeader title="Catalog">Loading the catalog.</PageHeader>
        <Skeleton lines={8} />
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <EmptyState
        title="The catalog is empty"
        body={
          <>
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

  const totalSkus = brands.reduce((n, b) => n + b.skuCount, 0);
  const pageCount = board ? Math.max(1, Math.ceil(board.total / board.pageSize)) : 1;
  const filteredBySearch = query.trim() !== '';
  const filteredByBrand = brandId !== '';
  const filteredEmpty = board !== null && board.total === 0 && (filteredBySearch || filteredByBrand);

  return (
    <div className="tg-stack catalog-board">
      <PageHeader title="Catalog">
        Brand, series, model, configuration. Search or pick a brand — every SKU is one row, with
        the full path visible so you can jump straight to the record.
      </PageHeader>

      <div className="catalog-toolbar">
        <div className="catalog-search">
          <Input
            label="Search"
            placeholder="Brand, model or SKU code"
            value={query}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="catalog-brand-rail" role="group" aria-label="Filter by brand">
          <button
            type="button"
            className={`catalog-brand-chip${brandId === '' ? ' catalog-brand-chip-active' : ''}`}
            onClick={() => pickBrand('')}
          >
            All brands
            <span className="font-mono tnum">{totalSkus}</span>
          </button>
          {brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              className={`catalog-brand-chip${brandId === brand.id ? ' catalog-brand-chip-active' : ''}`}
              onClick={() => pickBrand(brand.id)}
            >
              {brand.name}
              <span className="font-mono tnum">{brand.skuCount}</span>
            </button>
          ))}
        </div>
      </div>

      {board === null ? (
        <Skeleton lines={8} />
      ) : filteredEmpty ? (
        <EmptyState
          title={
            query.trim() ? `Nothing matches “${query.trim()}”` : 'Nothing matches this filter'
          }
          body="The catalog is not empty — this filter is. Clear it to see everything, or ask ops whether the machine needs a SKU request."
        />
      ) : (
        <>
          <Board>
            <DataBoard
              caption={
                filteredBySearch || filteredByBrand
                  ? `${board.total} of ${totalSkus} SKUs match.`
                  : `${board.total} ${board.total === 1 ? 'SKU' : 'SKUs'} across ${brands.length} ${brands.length === 1 ? 'brand' : 'brands'}.`
              }
              columns={columns}
              rows={board.rows}
              rowKey={(r) => r.sku.id}
              empty={
                <EmptyState
                  title="Nothing on this page"
                  body="This page is empty. Go back a page or clear your filters."
                />
              }
            />
          </Board>

          {pageCount > 1 && (
            <Pagination
              page={page}
              pageCount={pageCount}
              onPage={(next) => setFilter('page', String(next))}
              label="Catalog board pages"
            />
          )}
        </>
      )}
    </div>
  );
}
