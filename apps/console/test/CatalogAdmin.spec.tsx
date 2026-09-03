import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { CatalogTreeRoute, type CatalogBrand } from '../src/routes/CatalogTree';
import { SkuRequestsRoute, type SkuRequestRow } from '../src/routes/SkuRequests';

function skuCount(brands: CatalogBrand[]): number {
  return brands.reduce(
    (n, b) =>
      n + b.series.reduce((m, se) => m + se.models.reduce((k, x) => k + x.skus.length, 0), 0),
    0,
  );
}

function flattenCatalog(brands: CatalogBrand[]) {
  const rows: Array<{
    brandId: string;
    brandName: string;
    seriesName: string;
    modelName: string;
    sku: CatalogBrand['series'][0]['models'][0]['skus'][0];
  }> = [];
  for (const brand of brands) {
    for (const series of brand.series) {
      for (const model of series.models) {
        for (const sku of model.skus) {
          rows.push({
            brandId: brand.id,
            brandName: brand.name,
            seriesName: series.name,
            modelName: model.name,
            sku,
          });
        }
      }
    }
  }
  return rows;
}

function mockJson(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = String(input);
    if (url.includes('/api/catalog/sku-requests')) {
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  });
}

function mockCatalogApi(brands: CatalogBrand[], pageSize = 25): void {
  const rows = flattenCatalog(brands);
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/catalog/brands') {
      return Promise.resolve({
        ok: true,
        json: async () =>
          brands.map((b) => ({ id: b.id, name: b.name, skuCount: skuCount([b]) })),
      } as Response);
    }
    if (url.pathname === '/api/catalog/board') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const brandId = url.searchParams.get('brandId') ?? '';
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const size = Number(url.searchParams.get('pageSize') ?? String(pageSize)) || pageSize;
      let filtered = rows;
      if (brandId) filtered = filtered.filter((r) => r.brandId === brandId);
      if (q) {
        filtered = filtered.filter((r) =>
          [r.brandName, r.seriesName, r.modelName, r.sku.skuCode, r.sku.label]
            .join(' ')
            .toLowerCase()
            .includes(q),
        );
      }
      const total = filtered.length;
      const slice = filtered.slice((page - 1) * size, page * size);
      return Promise.resolve({
        ok: true,
        json: async () => ({ rows: slice, total, page, pageSize: size }),
      } as Response);
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  });
}

const CATALOG: CatalogBrand[] = [
  {
    id: 'b1',
    name: 'Dell',
    series: [
      {
        id: 's1',
        name: 'Latitude',
        models: [
          {
            id: 'm1',
            name: 'Latitude 5420',
            skus: [
              {
                id: 'k1',
                skuCode: 'DEL-LAT5420-I5-16-512',
                label: 'i5-1145G7 · 16 GB · 512 GB NVMe',
                isActive: true,
                liveListingCount: 4,
              },
              {
                id: 'k2',
                skuCode: 'DEL-LAT5420-I5-8-256',
                label: 'i5-1145G7 · 8 GB · 256 GB NVMe',
                isActive: false,
                liveListingCount: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'b2',
    name: 'Lenovo',
    series: [
      {
        id: 's2',
        name: 'ThinkPad',
        models: [
          {
            id: 'm2',
            name: 'ThinkPad T14 Gen 2',
            skus: [
              {
                id: 'k3',
                skuCode: 'LEN-T14G2-I7-16-512',
                label: 'i7-1165G7 · 16 GB · 512 GB NVMe',
                isActive: true,
                liveListingCount: 0,
              },
            ],
          },
        ],
      },
    ],
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the catalog tree keeps all four levels', () => {
  it('shows brand, series, model and the SKU code under it', async () => {
    mockCatalogApi(CATALOG);
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: 'DEL-LAT5420-I5-16-512' })).toBeInTheDocument();
    expect(screen.getAllByText('Latitude 5420').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dell · Latitude').length).toBeGreaterThan(0);
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
    expect(screen.getByText('4 live listings')).toBeInTheDocument();
  });

  it('filters on the whole path, so a brand name keeps the SKUs under it', async () => {
    mockCatalogApi(CATALOG);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: 'DEL-LAT5420-I5-16-512' });

    await user.type(screen.getByLabelText('Search'), 'lenovo');

    expect(await screen.findByText('ThinkPad T14 Gen 2')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryAllByText('Latitude 5420')).toHaveLength(0);
    });
  });

  it('distinguishes a filtered-empty result from an empty catalog', async () => {
    mockCatalogApi(CATALOG);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: 'DEL-LAT5420-I5-16-512' });

    await user.type(screen.getByLabelText('Search'), 'macbook');

    expect(await screen.findByText(/The catalog is not empty/)).toBeInTheDocument();
    expect(screen.queryByText('The catalog is empty')).not.toBeInTheDocument();
  });

  it('points an empty catalog at the importer, and offers no route that does not exist', async () => {
    mockCatalogApi([]);
    const { container } = render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    expect(await screen.findByText('The catalog is empty')).toBeInTheDocument();
    expect(screen.getByText(/api\/catalog\/skus\/import/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /add the first brand/i })).toBeNull();
    expect(container.querySelector('a[href*="brands/new"]')).toBeNull();
  });

  it('says the catalog did not load, and that nothing changed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    expect(await screen.findByText('The catalog did not load')).toBeInTheDocument();
    expect(screen.getByText(/Catalog brands unavailable \(500\)|Catalog unavailable \(500\)/)).toBeInTheDocument();
  });
});

const REQUEST: SkuRequestRow = {
  id: 'r1',
  vendorName: 'Alpha Systems Private Limited',
  rawBrand: 'Dell',
  rawModel: 'Latitide 5420',
  rawConfig: 'i5 11th gen, 16GB, 512 NVMe, 14 inch FHD',
  ageHours: 19,
  proposedSpec: { RAM: '16 GB', Storage: '512 GB NVMe', CPU: 'i5-1145G7' },
  nearMatches: [
    {
      skuId: 'k1',
      skuCode: 'DEL-LAT5420-I5-16-512',
      label: 'Dell Latitude 5420 · i5-1145G7 · 16 GB · 512 GB',
      similarity: 1,
      exact: true,
    },
    {
      skuId: 'k2',
      skuCode: 'DEL-LAT5420-I5-8-256',
      label: 'Dell Latitude 5420 · i5-1145G7 · 8 GB · 256 GB',
      similarity: 0.82,
      exact: false,
    },
  ],
};

describe('the SKU request queue is built for duplicates', () => {
  it('puts the proposed spec beside the closest SKUs and states each score', async () => {
    mockJson([REQUEST]);
    render(
      <MemoryRouter>
        <SkuRequestsRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Dell Latitide 5420');

    expect(screen.getByText('i5 11th gen, 16GB, 512 NVMe, 14 inch FHD')).toBeInTheDocument();
    expect(screen.getByText('512 GB NVMe')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('Same specification')).toBeInTheDocument();
  });

  it('blocks Approve when a SKU with the same specification already exists', async () => {
    mockJson([REQUEST]);
    render(
      <MemoryRouter>
        <SkuRequestsRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Dell Latitide 5420');

    const approve = screen.getByRole('button', { name: /approve and create the sku/i });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
    expect(approve).toHaveAccessibleDescription(/Merge into it instead/);
    expect(screen.getByText(/1 already exist under another name/)).toBeInTheDocument();
  });

  it('allows Approve when nothing close exists', async () => {
    mockJson([{ ...REQUEST, nearMatches: [] }]);
    render(
      <MemoryRouter>
        <SkuRequestsRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Dell Latitide 5420');

    expect(screen.getByRole('button', { name: /approve and create the sku/i })).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(screen.getByText(/genuinely new configuration/)).toBeInTheDocument();
  });

  it('says what a request is and what makes one appear, rather than claiming a cleared queue', async () => {
    mockJson([]);
    render(
      <MemoryRouter>
        <SkuRequestsRoute />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument();
    expect(screen.getByText(/Request this machine/)).toBeInTheDocument();
    expect(screen.getByText(/no vendor has hit a machine we do not carry/)).toBeInTheDocument();
    expect(screen.queryByText(/every vendor request has been decided/i)).toBeNull();
  });
});
