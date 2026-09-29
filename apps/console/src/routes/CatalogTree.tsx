import * as React from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataBoard, EmptyState, Pagination, Skeleton, type Column, type RowGroup } from '@trugrade/ui';
import { Board } from '../lib/controls';
import { useResource } from '../lib/useResource';

/**
 * ARCHETYPE B — Board. Filter rail + data table + row actions.
 * DENSITY: compact (admin), set on the app root by the shell.
 *
 * Pagination and every filter live in the URL and on the server. The nested
 * tree endpoint remains for callers that need the whole hierarchy; this board
 * reads `/api/catalog/board` one page at a time.
 *
 * DRAWN TO A SUPPLIED DESIGN, its markup, metrics and colours verbatim at the
 * product owner's direction (`.ct-*` in `index.css`, `--admin-*` in
 * `globals.css`). Two things it keeps from the codebase rather than the mock:
 *
 * - **The table is still `DataBoard`.** The mock's own `<table>` would have
 *   been a second table component; the shared one grew a `group` prop instead,
 *   which is what folds each model's configurations under its header row.
 * - **Every figure is read, not typed.** The mock's "201 SKUs across 8
 *   brands", its "9 configurations", its "1 live listing" are the shape; the
 *   numbers come from `/api/catalog/brands` and per-row model totals the board
 *   endpoint now returns. A model header counts the whole model, not just the
 *   configurations that happen to fall on this page.
 *
 * Two of the mock's controls have no destination of their own here and go to
 * the nearest honest one: "Add SKU" opens the SKU-request queue, which is how
 * a SKU is added on this product (the other way is the CSV importer, which has
 * no screen); "Open model" filters this board to that model.
 *
 * The section tabs the mock draws above the title are the shell's tab strip,
 * already rendered by `OpsShell` for the Catalog domain — not repeated here.
 */

export interface CatalogSku {
  id: string;
  skuCode: string;
  label: string;
  isActive: boolean;
  liveListingCount: number;
  cpuFamily: string;
  cpuModel: string;
  ramGb: number;
  storageGb: number;
  storageType: string;
  screenSizeInch: number;
  resolution: string;
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
  modelId: string;
  modelName: string;
  modelSkuCount: number;
  modelLiveListingCount: number;
  sku: CatalogSku;
}

interface CatalogPage {
  rows: CatalogRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface CatalogFacets {
  cpuFamilies: string[];
  ramGb: number[];
}

const PAGE_SIZE = 25;

/**
 * The catalog stores codes (`NVME_SSD`, `RETINA`); the board prints the words
 * a buyer would. Anything not listed falls back to the code with its
 * underscores as spaces, so a new value is readable rather than invisible.
 */
const STORAGE_TYPE: Readonly<Record<string, string>> = { NVME_SSD: 'NVMe SSD', EMMC: 'eMMC' };
const RESOLUTION: Readonly<Record<string, string>> = { RETINA: 'Retina' };

/** "512 GB NVMe SSD", "1 TB NVMe SSD" — a whole number of terabytes reads as one. */
function storage(gb: number, type: string): string {
  const size = gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
  return `${size} ${STORAGE_TYPE[type] ?? type.replace(/_/g, ' ')}`;
}

const resolution = (code: string): string => RESOLUTION[code] ?? code.replace(/_/g, ' ');

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function Chevron(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const COLUMNS: ReadonlyArray<Column<CatalogRow>> = [
  {
    key: 'skuCode',
    header: 'SKU code',
    cell: (r) => (
      <Link to={`/catalog/skus/${r.sku.id}`} className="ct-sku">
        {r.sku.skuCode}
      </Link>
    ),
  },
  { key: 'cpu', header: 'Processor', cell: (r) => <span className="ct-spec">{r.sku.cpuModel}</span> },
  { key: 'ram', header: 'RAM', cell: (r) => <span className="ct-spec">{r.sku.ramGb} GB</span> },
  {
    key: 'storage',
    header: 'Storage',
    cell: (r) => <span className="ct-spec">{storage(r.sku.storageGb, r.sku.storageType)}</span>,
  },
  {
    key: 'display',
    header: 'Display',
    cell: (r) => (
      <span className="ct-spec--muted">
        {r.sku.screenSizeInch}″ {resolution(r.sku.resolution)}
      </span>
    ),
  },
  {
    key: 'live',
    header: 'Live listings',
    cell: (r) =>
      r.sku.liveListingCount > 0 ? (
        <span className="ct-live">{r.sku.liveListingCount} live</span>
      ) : (
        <span className="ct-none" aria-label="No live listings">
          —
        </span>
      ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) =>
      r.sku.isActive ? (
        <span className="ct-status">Active</span>
      ) : (
        <span className="ct-status ct-status--off">Deprecated</span>
      ),
  },
];

/** Each model's configurations under one header row — the board's grouping. */
const GROUP: RowGroup<CatalogRow> = {
  of: (r) => r.modelId,
  className: 'ct-model',
  header: ({ rows, expanded, toggle }) => {
    const m = rows[0]!;
    return (
      <div className="ct-model__wrap">
        <button
          type="button"
          className="ct-model__toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${m.modelName}`}
          onClick={toggle}
        >
          <Chevron />
        </button>
        <div>
          <div className="ct-model__name">{m.modelName}</div>
          <div className="ct-model__path">
            {m.brandName} · {m.seriesName}
          </div>
        </div>
        <div className="ct-model__meta">
          <span>
            <strong>{m.modelSkuCount}</strong>{' '}
            {plural(m.modelSkuCount, 'configuration', 'configurations')}
          </span>
          <span>
            {m.modelLiveListingCount > 0 ? (
              <>
                <strong>{m.modelLiveListingCount}</strong>{' '}
                live {plural(m.modelLiveListingCount, 'listing', 'listings')}
              </>
            ) : (
              'No live listings'
            )}
          </span>
          <Link to={`/catalog?model=${m.modelId}`}>Open model</Link>
        </div>
      </div>
    );
  },
};

export function CatalogTreeRoute(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const brandId = params.get('brand') ?? '';
  const modelId = params.get('model') ?? '';
  const cpu = params.get('cpu') ?? '';
  const ram = params.get('ram') ?? '';
  const liveOnly = params.get('live') === '1';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const boardQuery = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (query.trim()) boardQuery.set('q', query.trim());
  if (brandId) boardQuery.set('brandId', brandId);
  if (modelId) boardQuery.set('modelId', modelId);
  if (cpu) boardQuery.set('cpuFamily', cpu);
  if (ram) boardQuery.set('ramGb', ram);
  if (liveOnly) boardQuery.set('live', '1');

  const { data: brands, error: brandsError } = useResource<CatalogBrandOption[]>(
    '/api/catalog/brands',
    'Catalog brands unavailable',
  );
  // The two selects. A failed read leaves them at "Any" rather than blocking
  // the board — the filter is a convenience, the SKUs are the point.
  const { data: facets } = useResource<CatalogFacets>(
    '/api/catalog/board/facets',
    'Catalog filters unavailable',
  );
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

  /** Every filter resets the page; a brand change also drops a model filter, which was inside a brand. */
  function setFilter(key: string, value: string): void {
    patchParams((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      if (key === 'brand') next.delete('model');
    });
  }

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
      <div className="catalog-board">
        <div className="ct-head">
          <div>
            <h1 className="ct-title">Catalog</h1>
            <p className="ct-sub">Loading the catalog.</p>
          </div>
        </div>
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
  const filtered = Boolean(query.trim() || brandId || modelId || cpu || ram || liveOnly);
  const from = board && board.total > 0 ? (board.page - 1) * board.pageSize + 1 : 0;
  const to = board ? Math.min(board.total, board.page * board.pageSize) : 0;

  return (
    <div className="catalog-board">
      <div className="ct-head">
        <div>
          <h1 className="ct-title">Catalog</h1>
          <p className="ct-sub">
            <strong>
              {totalSkus} {plural(totalSkus, 'SKU', 'SKUs')}
            </strong>{' '}
            across {brands.length} {plural(brands.length, 'brand', 'brands')}. Each SKU is one
            model in one configuration.
          </p>
        </div>
        <Link
          to="/catalog/sku-requests"
          className="ct-btn ct-btn--primary"
          title="A SKU is added by approving a vendor's request, or by the CSV importer"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add SKU
        </Link>
      </div>

      <div className="ct-filters">
        <div className="ct-row">
          <label className="ct-search">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search brand, model or SKU code"
              aria-label="Search the catalog"
              value={query}
              onChange={(e) => setFilter('q', e.target.value)}
            />
          </label>
          <label className="ct-select">
            Processor
            <select value={cpu} onChange={(e) => setFilter('cpu', e.target.value)}>
              <option value="">Any</option>
              {(facets?.cpuFamilies ?? []).map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </select>
          </label>
          <label className="ct-select">
            RAM
            <select value={ram} onChange={(e) => setFilter('ram', e.target.value)}>
              <option value="">Any</option>
              {(facets?.ramGb ?? []).map((gb) => (
                <option key={gb} value={String(gb)}>
                  {gb} GB
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ct-toggle"
            aria-pressed={liveOnly}
            onClick={() => setFilter('live', liveOnly ? '' : '1')}
          >
            Only with live listings
          </button>
        </div>
        <div className="ct-brands" role="group" aria-label="Brand">
          <button
            type="button"
            className="ct-brand"
            aria-pressed={brandId === ''}
            onClick={() => setFilter('brand', '')}
          >
            All brands <span>{totalSkus}</span>
          </button>
          {brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              className="ct-brand"
              aria-pressed={brandId === brand.id}
              onClick={() => setFilter('brand', brand.id)}
            >
              {brand.name} <span>{brand.skuCount}</span>
            </button>
          ))}
        </div>
      </div>

      <Board className="ct-card">
        <DataBoard
          className="ct-table"
          caption={
            board
              ? filtered
                ? `${board.total} of ${totalSkus} SKUs match, grouped by model.`
                : `${board.total} ${plural(board.total, 'SKU', 'SKUs')} across ${brands.length} ${plural(brands.length, 'brand', 'brands')}, grouped by model.`
              : 'Loading the catalog.'
          }
          columns={COLUMNS}
          rows={board?.rows ?? []}
          rowKey={(r) => r.sku.id}
          rowClassName={() => 'ct-sku-row'}
          loading={board === null}
          skeletonRows={8}
          group={GROUP}
          empty={
            <EmptyState
              title={
                query.trim() ? `Nothing matches “${query.trim()}”` : 'Nothing matches this filter'
              }
              body="The catalog is not empty — this filter is. Clear it to see everything, or ask ops whether the machine needs a SKU request."
            />
          }
        />
        <div className="ct-foot">
          <span>
            {board ? (
              <>
                Showing SKUs{' '}
                <strong>
                  {from}–{to}
                </strong>{' '}
                of <strong>{board.total}</strong>
              </>
            ) : (
              'Loading the catalog.'
            )}
          </span>
          {board && pageCount > 1 ? (
            <Pagination
              className="ct-pages"
              page={page}
              pageCount={pageCount}
              onPage={(next) => setFilter('page', String(next))}
              label="Pages"
            />
          ) : null}
        </div>
      </Board>
    </div>
  );
}
