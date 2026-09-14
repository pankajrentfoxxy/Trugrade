import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VendorListing } from '../api';

const auth = vi.hoisted(() => ({ permissions: ['listing.own.read', 'listing.own.write'] }));
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePrincipal: () => ({ permissions: auth.permissions }),
}));

import { RequestInspection } from './RequestInspection';

const listing = (status = 'DRAFT'): VendorListing => ({ id: 'l1', status }) as VendorListing;

const reply = (status: number, body: unknown): Response =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

afterEach(() => {
  vi.restoreAllMocks();
  auth.permissions = ['listing.own.read', 'listing.own.write'];
});

describe('requesting an inspection from the listing record', () => {
  it('submits the draft and hands the visit to the record', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(200, {
        outcome: 'SUBMITTED',
        listingId: 'l1',
        unitCount: 24,
        visitNumber: 'QV-0042',
        visitFee: '0.00',
      }),
    );
    const onSubmitted = vi.fn();
    render(<RequestInspection listing={listing()} unitCount={24} onSubmitted={onSubmitted} />);

    await user.click(screen.getByRole('button', { name: 'Request inspection' }));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/vendor/listings/l1/submit',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ visitNumber: 'QV-0042' }));
  });

  it('states the visit fee before the vendor accepts it, and sends that choice', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        reply(200, {
          outcome: 'DECISION_REQUIRED',
          unitCount: 6,
          minUnitsPerVisit: 20,
          shortBy: 14,
          visitFee: '1500.00',
          options: ['HOLD', 'ACCEPT_FEE'],
        }),
      )
      .mockResolvedValueOnce(
        reply(200, { outcome: 'HELD', unitCount: 6, minUnitsPerVisit: 20, shortBy: 14 }),
      );
    render(<RequestInspection listing={listing()} unitCount={6} onSubmitted={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Request inspection' }));
    expect(await screen.findByRole('button', { name: /Inspect now for ₹/ })).toBeTruthy();
    expect(screen.getByTestId('request-inspection').textContent).toContain('1,500');

    await user.click(screen.getByRole('button', { name: 'Hold until I reach 20' }));
    expect(JSON.parse(String((fetchSpy.mock.calls[1]![1] as RequestInit).body))).toEqual({
      choice: 'HOLD',
    });
    expect(await screen.findByText(/more, or ask again and accept/)).toBeTruthy();
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      reply(409, { error: { message: 'This listing has already been submitted.' } }),
    );
    render(<RequestInspection listing={listing()} unitCount={3} onSubmitted={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Request inspection' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This listing has already been submitted.',
    );
  });

  it('is absent for a seat that cannot write, a listing with no serials, or one already past draft', () => {
    auth.permissions = ['listing.own.read'];
    const { rerender, container } = render(
      <RequestInspection listing={listing()} unitCount={3} onSubmitted={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();

    auth.permissions = ['listing.own.read', 'listing.own.write'];
    rerender(<RequestInspection listing={listing()} unitCount={0} onSubmitted={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <RequestInspection listing={listing('AWAITING_QC')} unitCount={3} onSubmitted={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the listing record', () => {
  it('offers the request on a draft listing with serials', async () => {
    const { MemoryRouter, Route, Routes } = await import('react-router');
    const { ListingUnitsRoute } = await import('../Units');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/vendor/listings/l1/units')) {
        return Promise.resolve(
          reply(200, [
            {
              id: 'u1',
              serialNumber: '5CD1234XYZ',
              gradeDeclared: 'A',
              gradeActual: null,
              status: 'DRAFT',
              isSellable: false,
              location: 'VENDOR_SITE',
              vendorAskPrice: '42000.00',
            },
          ]),
        );
      }
      return Promise.resolve(
        reply(200, {
          id: 'l1',
          status: 'DRAFT',
          grade: 'A',
          sku: null,
          qtyTotal: 1,
          vendorAskPrice: '42000.00',
        }),
      );
    });

    render(
      <MemoryRouter initialEntries={['/vendor/listings/l1']}>
        <Routes>
          <Route path="/vendor/listings/:id" element={<ListingUnitsRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Request inspection' })).toBeTruthy();
  });
});
