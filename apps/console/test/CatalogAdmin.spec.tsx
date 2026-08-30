import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { CatalogTreeRoute, type CatalogBrand } from '../src/routes/CatalogTree';
import { SkuRequestsRoute, type SkuRequestRow } from '../src/routes/SkuRequests';

function mockJson(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => body } as Response);
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
    mockJson(CATALOG);
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Dell');

    expect(screen.getByText('Latitude')).toBeInTheDocument();
    expect(screen.getByText('Latitude 5420')).toBeInTheDocument();
    expect(screen.getByText('DEL-LAT5420-I5-16-512')).toBeInTheDocument();
    // A deprecated SKU stays visible: it is still the SKU that past orders and
    // past QC reports were written against.
    expect(screen.getByText('Deprecated')).toBeInTheDocument();
    expect(screen.getByText('4 live listings')).toBeInTheDocument();
  });

  it('filters on the whole path, so a brand name keeps the SKUs under it', async () => {
    mockJson(CATALOG);
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Dell');

    await userEvent.type(screen.getByLabelText('Filter'), 'lenovo');

    expect(screen.getByText('ThinkPad T14 Gen 2')).toBeInTheDocument();
    expect(screen.queryByText('Latitude 5420')).not.toBeInTheDocument();
  });

  it('distinguishes a filtered-empty result from an empty catalog', async () => {
    mockJson(CATALOG);
    render(
      <MemoryRouter>
        <CatalogTreeRoute />
      </MemoryRouter>,
    );
    await screen.findByText('Dell');

    await userEvent.type(screen.getByLabelText('Filter'), 'macbook');

    // The failure this catches: telling an admin the catalog is empty when it is
    // their filter that is, which invites a duplicate brand being created.
    expect(screen.getByText(/The catalog is not empty/)).toBeInTheDocument();
    expect(screen.queryByText('The catalog is empty')).not.toBeInTheDocument();
  });

  /**
   * The empty state used to offer "Add the first brand", linking to
   * `/catalog/brands/new` — a route with no `<Route>` behind it and no endpoint
   * underneath it. There is no brand-create anywhere: the SKU importer writes
   * `catalog.brand`, `series` and `model` on its way to a SKU.
   *
   * So this asserts the absence as well as the presence. A guidance sentence
   * naming a screen that does not exist is worse than no guidance at all — the
   * person following it concludes the console is broken rather than that they
   * are looking in the wrong place.
   */
  it('points an empty catalog at the importer, and offers no route that does not exist', async () => {
    mockJson([]);
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
    expect(screen.getByText(/Catalog unavailable \(500\)/)).toBeInTheDocument();
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
    // The score is stated, not implied by position: 100% and 82% both sit at the
    // top of a short list and only one of them is a merge.
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
    // aria-disabled, not disabled: the reason has to be reachable, and the
    // failure it prevents — a duplicate SKU splitting every listing, price band
    // and image set that follows — is not guessable from a greyed-out button.
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

  /**
   * `catalog.sku_request` has never held a row, so "every request has been
   * decided" — what this state used to say — was a sentence about a history that
   * does not exist. An operator opening an empty worklist needs to know what
   * would put something in it, and that it is not being handled somewhere else.
   */
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
